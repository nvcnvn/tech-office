package interceptor

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/lestrrat-go/jwx/v3/jwt"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"

	rpc "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

type ctxKey string

const (
	userOrgIDKey       ctxKey = "user_org_id"
	userPermissionsKey ctxKey = "user_permissions"
	userIDKey          ctxKey = "user_id"
)

var (
	ErrAuthTokenRequired       = errors.New("authentication token required")
	ErrInsufficientPermissions = errors.New("insufficient permissions")
)

// PermissionLookup queries user permissions from the database.
type PermissionLookup interface {
	// GetPermissionsForUserInOrg returns the permission strings a user has in a specific organization.
	GetPermissionsForUserInOrg(ctx context.Context, userID, orgID string) ([]string, error)
}

// AuthInterceptor handles both authentication and authorization in a single step
// based on the proto schema definition.
type AuthInterceptor struct {
	jwtVerifier      JWTVerifierInterface
	permissionLookup PermissionLookup // Optional: for looking up permissions from DB (internal JWT)
}

// JWTVerifierInterface abstracts JWT verification for easier testing and dependency injection
type JWTVerifierInterface interface {
	Verify(ctx context.Context, token string) (jwt.Token, error)
}

// NewAuthInterceptor creates a new unified authentication and authorization interceptor
func NewAuthInterceptor(jwtVerifier JWTVerifierInterface) *AuthInterceptor {
	return &AuthInterceptor{
		jwtVerifier:      jwtVerifier,
		permissionLookup: nil,
	}
}

// WithPermissionLookup configures DB-based permission lookup for internal JWTs.
func (a *AuthInterceptor) WithPermissionLookup(pl PermissionLookup) *AuthInterceptor {
	a.permissionLookup = pl
	return a
}

// WrapUnary implements connect.Interceptor for unary RPCs
func (u *AuthInterceptor) WrapUnary(next connect.UnaryFunc) connect.UnaryFunc {
	return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
		// Extract method descriptor to read access control options
		reqMethodDescriptor, ok := req.Spec().Schema.(protoreflect.MethodDescriptor)
		if !ok {
			slog.ErrorContext(ctx, "unexpected request schema", "schema", req.Spec().Schema)
			return nil, connect.NewError(connect.CodeUnknown, errors.New("unexpected request schema"))
		}
		slog.DebugContext(ctx, "processing request", "method", reqMethodDescriptor.FullName())

		// Get access control configuration from proto schema
		accessControl, found := u.extractAccessControl(reqMethodDescriptor)
		if !found {
			// If no access control is defined, deny by default (fail-safe)
			slog.WarnContext(ctx, "method without access_control option", "method", reqMethodDescriptor.FullName())
			return nil, connect.NewError(connect.CodePermissionDenied, errors.New("access control not defined"))
		}
		slog.DebugContext(ctx, "extracted access control", "method", reqMethodDescriptor.FullName(), "accessControl", accessControl)

		// Extract and verify JWT token (always attempt if present)
		token := bearerTokenFromHeader(req.Header().Get("Authorization"))

		if !accessControl.AllowUnauthenticated && token == "" {
			slog.DebugContext(ctx, "missing authentication token", "method", reqMethodDescriptor.FullName())
			return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("authentication token required"))
		}

		// For AllowUnauthenticated endpoints with no token, skip auth entirely.
		// If a token IS present we still verify it — silently accepting an unverified
		// token would let handlers accidentally trust attacker-supplied headers.
		if accessControl.AllowUnauthenticated && token == "" {
			slog.DebugContext(ctx, "allowing unauthenticated access (no token)", "method", reqMethodDescriptor.FullName())
			return next(ctx, req)
		}

		slog.DebugContext(ctx, "verifying JWT token", "method", reqMethodDescriptor.FullName())

		claims, err := u.verifyToken(ctx, token)
		if err != nil {
			slog.DebugContext(ctx, "JWT verification failed", "error", err)
			return nil, connect.NewError(connect.CodeUnauthenticated, err)
		}
		slog.DebugContext(ctx, "JWT verified successfully", "method", reqMethodDescriptor.FullName())

		// Extract user information from claims
		userID, orgID, userPermissions, err := u.extractUserInfo(ctx, claims)
		if err != nil {
			slog.DebugContext(ctx, "failed to extract user info from token", "error", err)
			return nil, connect.NewError(connect.CodeUnauthenticated, err)
		}
		slog.DebugContext(ctx, "extracted user info from token",
			"user_id", userID,
			"user_permissions_count", len(userPermissions),
		)

		// Check permission-based authorization (skip for AllowUnauthenticated — the
		// token was optional and we only populated context as a courtesy).
		if !accessControl.AllowUnauthenticated && !u.hasRequiredPermission(userPermissions, accessControl.RequiredPermissions) {
			slog.DebugContext(ctx, "insufficient permissions",
				"user_id", userID,
				"required_permissions", accessControl.RequiredPermissions)
			return nil, connect.NewError(connect.CodePermissionDenied, errors.New("insufficient permissions"))
		}
		slog.DebugContext(ctx, "user authorized",
			"user_id", userID,
		)

		// Add user context for downstream handlers
		ctx = context.WithValue(ctx, userIDKey, userID)
		permissions := make([]string, 0, len(userPermissions))
		for perm := range userPermissions {
			permissions = append(permissions, perm)
		}
		ctx = context.WithValue(ctx, userPermissionsKey, permissions)
		if orgID != "" {
			ctx = context.WithValue(ctx, userOrgIDKey, orgID)
		}

		slog.DebugContext(ctx, "access granted",
			"method", reqMethodDescriptor.FullName(),
			"user_org_id", ctx.Value(userOrgIDKey),
			"user_id", userID)

		return next(ctx, req)
	}
}

// WrapStreamingHandler implements connect.Interceptor for streaming RPCs.
// This enables SSE endpoints to authenticate JWT tokens from streaming RPCs.
func (u *AuthInterceptor) WrapStreamingHandler(next connect.StreamingHandlerFunc) connect.StreamingHandlerFunc {
	return func(ctx context.Context, conn connect.StreamingHandlerConn) error {
		// Extract method descriptor to read access control options
		reqMethodDescriptor, ok := conn.Spec().Schema.(protoreflect.MethodDescriptor)
		if !ok {
			slog.ErrorContext(ctx, "unexpected request schema", "schema", conn.Spec().Schema)
			return connect.NewError(connect.CodeUnknown, errors.New("unexpected request schema"))
		}
		slog.DebugContext(ctx, "processing streaming request", "method", reqMethodDescriptor.FullName())

		// Get access control configuration from proto schema
		accessControl, found := u.extractAccessControl(reqMethodDescriptor)
		if !found {
			// If no access control is defined, deny by default (fail-safe)
			slog.WarnContext(ctx, "streaming method without access_control option", "method", reqMethodDescriptor.FullName())
			return connect.NewError(connect.CodePermissionDenied, errors.New("access control not defined"))
		}
		slog.DebugContext(ctx, "extracted access control for streaming", "method", reqMethodDescriptor.FullName(), "accessControl", accessControl)

		// Extract and verify JWT token (always attempt if present)
		token := bearerTokenFromHeader(conn.RequestHeader().Get("Authorization"))

		if !accessControl.AllowUnauthenticated && token == "" {
			slog.DebugContext(ctx, "missing authentication token for streaming", "method", reqMethodDescriptor.FullName())
			return connect.NewError(connect.CodeUnauthenticated, errors.New("authentication token required"))
		}

		// For AllowUnauthenticated endpoints with no token, skip auth entirely.
		// If a token IS present we still verify it — silently accepting an unverified
		// token would let handlers accidentally trust attacker-supplied headers.
		if accessControl.AllowUnauthenticated && token == "" {
			slog.DebugContext(ctx, "allowing unauthenticated streaming access (no token)", "method", reqMethodDescriptor.FullName())
			return next(ctx, conn)
		}

		slog.DebugContext(ctx, "verifying JWT token for streaming", "method", reqMethodDescriptor.FullName())

		claims, err := u.verifyToken(ctx, token)
		if err != nil {
			slog.DebugContext(ctx, "JWT verification failed for streaming", "error", err)
			return connect.NewError(connect.CodeUnauthenticated, err)
		}
		slog.DebugContext(ctx, "JWT verified successfully for streaming", "method", reqMethodDescriptor.FullName())

		// Extract user information from claims
		userID, orgID, userPermissions, err := u.extractUserInfo(ctx, claims)
		if err != nil {
			slog.DebugContext(ctx, "failed to extract user info from streaming token", "error", err)
			return connect.NewError(connect.CodeUnauthenticated, err)
		}
		slog.DebugContext(ctx, "extracted user info from streaming token",
			"user_id", userID,
			"user_permissions_count", len(userPermissions),
		)

		// Check permission-based authorization (skip for AllowUnauthenticated — the
		// token was optional and we only populated context as a courtesy).
		if !accessControl.AllowUnauthenticated && !u.hasRequiredPermission(userPermissions, accessControl.RequiredPermissions) {
			slog.DebugContext(ctx, "insufficient permissions for streaming",
				"user_id", userID,
				"required_permissions", accessControl.RequiredPermissions)
			return connect.NewError(connect.CodePermissionDenied, errors.New("insufficient permissions"))
		}
		slog.DebugContext(ctx, "user authorized for streaming",
			"user_id", userID,
		)

		// Add user context for downstream handlers
		ctx = context.WithValue(ctx, userIDKey, userID)
		permissions := make([]string, 0, len(userPermissions))
		for perm := range userPermissions {
			permissions = append(permissions, perm)
		}
		ctx = context.WithValue(ctx, userPermissionsKey, permissions)
		if orgID != "" {
			ctx = context.WithValue(ctx, userOrgIDKey, orgID)
		}

		slog.DebugContext(ctx, "streaming access granted",
			"method", reqMethodDescriptor.FullName(),
			"user_org_id", ctx.Value(userOrgIDKey),
			"user_id", userID)

		return next(ctx, conn)
	}
}

// WrapStreamingClient wraps streaming clients with authentication and authorization.
// This is the client-side counterpart to WrapStreamingHandler.
func (u *AuthInterceptor) WrapStreamingClient(next connect.StreamingClientFunc) connect.StreamingClientFunc {
	return func(ctx context.Context, spec connect.Spec) connect.StreamingClientConn {
		// For client-side, authentication is typically handled by adding headers
		// This is mainly for consistency with the full Interceptor interface
		slog.DebugContext(ctx, "wrapping streaming client", "procedure", spec.Procedure)
		return next(ctx, spec)
	}
}

// extractAccessControl extracts the access control configuration from method options
func (u *AuthInterceptor) extractAccessControl(methodDescriptor protoreflect.MethodDescriptor) (*rpc.PermissionBasedAccessControl, bool) {
	var accessControl *rpc.PermissionBasedAccessControl
	found := false

	slog.Debug("extracting access control from method options", "method", methodDescriptor.FullName())
	methodDescriptor.Options().ProtoReflect().Range(func(fd protoreflect.FieldDescriptor, v protoreflect.Value) bool {
		slog.Debug("inspecting method option", "field", fd.FullName())
		if fd.FullName() == rpc.E_AccessControl.TypeDescriptor().FullName() {
			found = true
			b, err := proto.Marshal(v.Message().Interface())
			if err != nil {
				slog.Error("failed to marshal access control", "error", err)
				return false
			}

			accessControl = &rpc.PermissionBasedAccessControl{}
			if err := proto.Unmarshal(b, accessControl); err != nil {
				slog.Error("failed to unmarshal access control", "error", err)
				found = false
				return false
			}
			return false // Stop iteration
		}
		return true // Continue iteration
	})

	return accessControl, found
}

// verifyToken verifies the JWT using the internal verifier
func (u *AuthInterceptor) verifyToken(ctx context.Context, token string) (jwt.Token, error) {
	return u.jwtVerifier.Verify(ctx, token)
}

// systemPermissionAll is a sentinel permission granted to ROLE_SYSTEM tokens,
// allowing hasRequiredPermission to short-circuit without a DB lookup.
const systemPermissionAll = "system:*"

// extractUserInfo extracts user ID, permissions, and org ID from internal JWT claims.
// Uses org_id claim for organization context and DB permission lookup for authorization.
func (u *AuthInterceptor) extractUserInfo(ctx context.Context, tk jwt.Token) (userID string, orgID string, userPermissions map[string]struct{}, err error) {
	// Extract user ID from 'sub' claim
	sub, ok := tk.Subject()
	if !ok || sub == "" {
		return "", "", nil, errors.New("invalid user ID in token")
	}
	userID = sub
	userPermissions = map[string]struct{}{}

	// Extract org_id claim if present
	var tokenOrgID string
	if err := tk.Get("org_id", &tokenOrgID); err == nil && tokenOrgID != "" {
		orgID = tokenOrgID
	}

	// System tokens carry ROLE_SYSTEM and are not present in the permissions DB.
	// Grant them a sentinel permission that bypasses the per-method check.
	// Use interface{} because JSON-decoded arrays come as []interface{}, not []string.
	var rolesRaw interface{}
	if err := tk.Get("roles", &rolesRaw); err == nil {
		isSystem := false
		switch v := rolesRaw.(type) {
		case []interface{}:
			for _, r := range v {
				if s, ok := r.(string); ok && s == "ROLE_SYSTEM" {
					isSystem = true
					break
				}
			}
		case []string:
			for _, s := range v {
				if s == "ROLE_SYSTEM" {
					isSystem = true
					break
				}
			}
		}
		if isSystem {
			userPermissions[systemPermissionAll] = struct{}{}
			slog.DebugContext(ctx, "system token granted full permissions", "user_id", userID)
			return userID, orgID, userPermissions, nil
		}
	}

	// Look up permissions from DB if permission lookup is configured and org context is available
	if u.permissionLookup != nil && orgID != "" {
		// Use a bounded timeout so a slow/exhausted DB pool doesn't hang the request forever.
		lookupCtx, lookupCancel := context.WithTimeout(ctx, 5*time.Second)
		defer lookupCancel()
		start := time.Now()
		permissions, lookupErr := u.permissionLookup.GetPermissionsForUserInOrg(lookupCtx, userID, orgID)
		elapsed := time.Since(start)
		if lookupErr != nil {
			slog.WarnContext(ctx, "permission lookup failed", "error", lookupErr, "user_id", userID, "org_id", orgID, "duration_ms", elapsed.Milliseconds())
		} else {
			slog.InfoContext(ctx, "permission lookup completed", "user_id", userID, "org_id", orgID, "permission_count", len(permissions), "duration_ms", elapsed.Milliseconds())
			for _, perm := range permissions {
				userPermissions[perm] = struct{}{}
			}
		}
	}

	return userID, orgID, userPermissions, nil
}

// hasRequiredPermission checks if the user has at least one of the required permissions (OR semantics).
func (u *AuthInterceptor) hasRequiredPermission(userPermissions map[string]struct{}, requiredPermissions []string) bool {
	if len(requiredPermissions) == 0 {
		return true // No specific permissions required — just authenticated
	}

	// System tokens bypass all per-method permission checks.
	if _, ok := userPermissions[systemPermissionAll]; ok {
		return true
	}

	for _, requiredPerm := range requiredPermissions {
		if _, ok := userPermissions[requiredPerm]; ok {
			return true
		}
	}
	return false
}

// UserIDFromContext extracts the user ID from the context.
func UserIDFromContext(ctx context.Context) (string, bool) {
	userID, ok := ctx.Value(userIDKey).(string)
	return userID, ok
}

// UserPermissionsFromContext extracts the user permissions from the context.
func UserPermissionsFromContext(ctx context.Context) ([]string, bool) {
	permissions, ok := ctx.Value(userPermissionsKey).([]string)
	return permissions, ok
}

// UserOrgIDFromContext extracts the user's organization ID from the context.
func UserOrgIDFromContext(ctx context.Context) (string, bool) {
	orgID, ok := ctx.Value(userOrgIDKey).(string)
	return orgID, ok
}

func bearerTokenFromHeader(header string) string {
	if strings.HasPrefix(header, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
	}
	return ""
}

// AuthenticateHTTPRequest applies the same JWT verification and permission checks used for ConnectRPC
// requests to a plain HTTP request. Returns a context populated with user metadata when
// authentication succeeds.
func (u *AuthInterceptor) AuthenticateHTTPRequest(
	ctx context.Context,
	r *http.Request,
	requiredPermissions []string,
) (context.Context, error) {
	// Extract bearer token from Authorization header first.
	token := bearerTokenFromHeader(r.Header.Get("Authorization"))
	if token == "" {
		// Fallback to token query parameter to support EventSource clients that cannot
		// set custom headers. Value is trimmed to avoid whitespace issues.
		token = strings.TrimSpace(r.URL.Query().Get("token"))
	}

	if token == "" {
		slog.DebugContext(ctx, "AuthenticateHTTPRequest: missing authentication token", "path", r.URL.Path)
		return ctx, ErrAuthTokenRequired
	}

	claims, err := u.verifyToken(ctx, token)
	if err != nil {
		slog.DebugContext(ctx, "AuthenticateHTTPRequest: JWT verification failed", "error", err, "path", r.URL.Path)
		return ctx, err
	}

	userID, orgID, userPermissions, err := u.extractUserInfo(ctx, claims)
	if err != nil {
		slog.DebugContext(ctx, "AuthenticateHTTPRequest: failed to extract user info", "error", err, "path", r.URL.Path)
		return ctx, err
	}

	if !u.hasRequiredPermission(userPermissions, requiredPermissions) {
		slog.DebugContext(ctx, "AuthenticateHTTPRequest: insufficient permissions",
			"path", r.URL.Path,
			"user_id", userID,
			"required_permissions", requiredPermissions,
		)
		return ctx, ErrInsufficientPermissions
	}

	permissions := make([]string, 0, len(userPermissions))
	for perm := range userPermissions {
		permissions = append(permissions, perm)
	}

	ctx = context.WithValue(ctx, userIDKey, userID)
	ctx = context.WithValue(ctx, userPermissionsKey, permissions)

	if orgID != "" {
		ctx = context.WithValue(ctx, userOrgIDKey, orgID)
	}

	slog.DebugContext(ctx, "AuthenticateHTTPRequest: authentication succeeded",
		"path", r.URL.Path,
		"user_id", userID,
	)

	return ctx, nil
}
