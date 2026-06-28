package docs

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"

	"connectrpc.com/connect"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/database/txn"
	"github.com/nvcnvn/tech-office/backend/internal/interceptor"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/nvcnvn/tech-office/backend/rpc/v1/rpcv1connect"
)

// ============================================================================
// Version Service Connect Layer
// ============================================================================

// VersionServiceConnect is the RPC handler for version history operations.
type VersionServiceConnect struct {
	rpcv1connect.UnimplementedDocumentVersionServiceHandler

	Logic      DocumentLogic
	TenantPool database.TenantDatabaseConnector
}

// NewVersionServiceConnect creates a new version service connect layer
func NewVersionServiceConnect(
	logic DocumentLogic,
	tenantPool database.TenantDatabaseConnector,
) *VersionServiceConnect {
	return &VersionServiceConnect{
		Logic:      logic,
		TenantPool: tenantPool,
	}
}

func (s *VersionServiceConnect) extractAuthContext(ctx context.Context) (employeeID, organizationID dbuuid.UUID, err error) {
	userID, ok := interceptor.UserIDFromContext(ctx)
	if !ok || userID == "" {
		return dbuuid.UUID{}, dbuuid.UUID{}, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("user ID not found in context"))
	}

	orgIDStr, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok || orgIDStr == "" {
		return dbuuid.UUID{}, dbuuid.UUID{}, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("organization ID not found in context"))
	}

	employeeID = dbuuid.MustParse(userID)
	organizationID = dbuuid.MustParse(orgIDStr)
	return employeeID, organizationID, nil
}

func (s *VersionServiceConnect) ListVersions(
	ctx context.Context,
	req *connect.Request[rpcv1.ListVersionsRequest],
) (*connect.Response[rpcv1.ListVersionsResponse], error) {
	slog.DebugContext(ctx, "ListVersions RPC called",
		"function", "ListVersions",
		"documentID", req.Msg.DocumentId,
	)

	// Validate documentId is not empty
	if req.Msg.DocumentId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("document_id is required"))
	}

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var versions []*rpcv1.DocumentVersion

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		docID := dbuuid.MustParse(req.Msg.DocumentId)

		// Check access
		accessLevel, isOwner, accessErr := s.Logic.CheckAccess(ctx, tx, organizationID, employeeID, docID)
		if accessErr != nil {
			return accessErr
		}

		if accessLevel == rpcv1.AccessLevel_ACCESS_LEVEL_NONE && !isOwner {
			return ErrAccessDenied
		}

		var cursor *int32
		if req.Msg.Cursor != "" {
			cursorVal, parseErr := strconv.Atoi(req.Msg.Cursor)
			if parseErr == nil {
				c := int32(cursorVal)
				cursor = &c
			}
		}

		limit := req.Msg.Limit
		if limit <= 0 || limit > 100 {
			limit = 20
		}

		var txErr error
		versions, txErr = s.Logic.ListVersions(ctx, tx, organizationID, docID, cursor, limit)
		return txErr
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	var nextCursor string
	if len(versions) > 0 {
		nextCursor = strconv.Itoa(int(versions[len(versions)-1].VersionNumber))
	}

	return connect.NewResponse(&rpcv1.ListVersionsResponse{
		Versions:   versions,
		NextCursor: nextCursor,
	}), nil
}

func (s *VersionServiceConnect) GetVersion(
	ctx context.Context,
	req *connect.Request[rpcv1.GetVersionRequest],
) (*connect.Response[rpcv1.GetVersionResponse], error) {
	slog.DebugContext(ctx, "GetVersion RPC called",
		"function", "GetVersion",
		"documentID", req.Msg.DocumentId,
		"versionNumber", req.Msg.VersionNumber,
	)

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var version *rpcv1.DocumentVersion

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		docID := dbuuid.MustParse(req.Msg.DocumentId)

		// Check access
		accessLevel, isOwner, accessErr := s.Logic.CheckAccess(ctx, tx, organizationID, employeeID, docID)
		if accessErr != nil {
			return accessErr
		}

		if accessLevel == rpcv1.AccessLevel_ACCESS_LEVEL_NONE && !isOwner {
			return ErrAccessDenied
		}

		var txErr error
		version, txErr = s.Logic.GetVersion(ctx, tx, organizationID, docID, req.Msg.VersionNumber)
		return txErr
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	return connect.NewResponse(&rpcv1.GetVersionResponse{
		Version: version,
	}), nil
}

func (s *VersionServiceConnect) GetVersionDiff(
	ctx context.Context,
	req *connect.Request[rpcv1.GetVersionDiffRequest],
) (*connect.Response[rpcv1.GetVersionDiffResponse], error) {
	slog.DebugContext(ctx, "GetVersionDiff RPC called",
		"function", "GetVersionDiff",
		"documentID", req.Msg.DocumentId,
		"fromVersion", req.Msg.FromVersion,
		"toVersion", req.Msg.ToVersion,
	)

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var changes []*rpcv1.DiffChange
	var fromVersion, toVersion *rpcv1.DocumentVersion

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		docID := dbuuid.MustParse(req.Msg.DocumentId)

		// Check access
		accessLevel, isOwner, accessErr := s.Logic.CheckAccess(ctx, tx, organizationID, employeeID, docID)
		if accessErr != nil {
			return accessErr
		}

		if accessLevel == rpcv1.AccessLevel_ACCESS_LEVEL_NONE && !isOwner {
			return ErrAccessDenied
		}

		var txErr error
		changes, fromVersion, toVersion, txErr = s.Logic.GetVersionDiff(ctx, tx, organizationID, docID, req.Msg.FromVersion, req.Msg.ToVersion)
		return txErr
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	return connect.NewResponse(&rpcv1.GetVersionDiffResponse{
		Changes:     changes,
		FromVersion: fromVersion,
		ToVersion:   toVersion,
	}), nil
}

func (s *VersionServiceConnect) GetBlame(
	ctx context.Context,
	req *connect.Request[rpcv1.GetBlameRequest],
) (*connect.Response[rpcv1.GetBlameResponse], error) {
	slog.DebugContext(ctx, "GetBlame RPC called",
		"function", "GetBlame",
		"documentID", req.Msg.DocumentId,
	)

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var blocks []*rpcv1.BlameBlock

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		docID := dbuuid.MustParse(req.Msg.DocumentId)

		// Check access
		accessLevel, isOwner, accessErr := s.Logic.CheckAccess(ctx, tx, organizationID, employeeID, docID)
		if accessErr != nil {
			return accessErr
		}

		if accessLevel == rpcv1.AccessLevel_ACCESS_LEVEL_NONE && !isOwner {
			return ErrAccessDenied
		}

		var txErr error
		blocks, txErr = s.Logic.GetBlame(ctx, tx, organizationID, docID)
		return txErr
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	return connect.NewResponse(&rpcv1.GetBlameResponse{
		Blocks: blocks,
	}), nil
}

func (s *VersionServiceConnect) handleError(err error) error {
	switch {
	case err == ErrDocumentNotFound:
		return connect.NewError(connect.CodeNotFound, err)
	case err == ErrVersionNotFound:
		return connect.NewError(connect.CodeNotFound, err)
	case err == ErrAccessDenied:
		return connect.NewError(connect.CodePermissionDenied, err)
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}
