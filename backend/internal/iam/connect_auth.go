package iam

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgtype"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbcrud"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/database/txn"
	"github.com/nvcnvn/tech-office/backend/internal/interceptor"
	"github.com/nvcnvn/tech-office/backend/internal/notification"
	v1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/nvcnvn/tech-office/backend/rpc/v1/rpcv1connect"
)

// IAMServiceConnect is the RPC handler layer for IAM operations.
// It owns connection pools, manages transactions, extracts auth context,
// and delegates to the logic layer.
//
// Pool usage:
//   - AdminPool: Global user operations (login, registration, profile, SSO, password resets, sessions)
//   - TenantPool: Org-scoped operations (invitations, member listing)
type IAMServiceConnect struct {
	rpcv1connect.UnimplementedIAMServiceHandler
	logic        IAMLogic
	adminPool    database.AdminDatabaseConnector
	tenantPool   database.TenantDatabaseConnector
	jwtSigner    *InternalJWTSigner
	jwksVerifier *JWKSVerifier
	emailSender  EmailSender
}

// NewIAMServiceConnect creates a new IAM service connect layer.
func NewIAMServiceConnect(
	logic IAMLogic,
	adminPool database.AdminDatabaseConnector,
	tenantPool database.TenantDatabaseConnector,
	jwtSigner *InternalJWTSigner,
	jwksVerifier *JWKSVerifier,
	emailSender EmailSender,
) *IAMServiceConnect {
	if emailSender == nil {
		emailSender = NewLoggingEmailSender("")
	}

	return &IAMServiceConnect{
		logic:        logic,
		adminPool:    adminPool,
		tenantPool:   tenantPool,
		jwtSigner:    jwtSigner,
		jwksVerifier: jwksVerifier,
		emailSender:  emailSender,
	}
}

// === SSO Authentication ===

func (s *IAMServiceConnect) ExchangeToken(
	ctx context.Context,
	req *connect.Request[v1.ExchangeTokenRequest],
) (*connect.Response[v1.ExchangeTokenResponse], error) {
	slog.InfoContext(ctx, "ExchangeToken called", "provider", req.Msg.Provider)

	provider, err := ssoProviderToString(req.Msg.Provider)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	// Verify SSO token
	claims, err := s.jwksVerifier.VerifyProviderToken(ctx, provider, req.Msg.IdToken)
	if err != nil {
		slog.WarnContext(ctx, "ExchangeToken: SSO token verification failed", "error", err, "provider", provider)
		return nil, ToConnectError(err)
	}

	var user *database.IamUser
	var isNewUser bool
	var tokenStr string
	var expiresAt int64

	err = txn.WithTxn(ctx, s.adminPool, func(ctx context.Context, tx database.DBTX) error {
		var ssoErr error
		user, _, isNewUser, ssoErr = s.logic.FindOrCreateSSOUser(ctx, tx, claims, provider)
		if ssoErr != nil {
			return ssoErr
		}

		// Generate JWT — embed org context if the client specified one, else auto-detect.
		var jti string
		if req.Msg.OrganizationId != nil && *req.Msg.OrganizationId != "" {
			orgID, parseErr := dbuuid.Parse(*req.Msg.OrganizationId)
			if parseErr != nil {
				return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization_id: %w", parseErr))
			}
			// Auto-accept a pending invitation if the user isn't a member yet.
			if valErr := s.logic.ValidateUserOrgMembership(ctx, tx, user.ID, orgID); valErr != nil {
				if _, autoErr := s.logic.AutoAcceptPendingInvitation(ctx, tx, user, orgID); autoErr != nil {
					return ToConnectError(autoErr)
				}
				// Re-validate after potential auto-accept.
				if valErr = s.logic.ValidateUserOrgMembership(ctx, tx, user.ID, orgID); valErr != nil {
					return ToConnectError(valErr)
				}
			}
			tokenStr, jti, expiresAt, ssoErr = s.jwtSigner.GenerateTokenWithOrg(user.ID, user.Email.String, orgID)
		} else {
			orgs, orgsErr := s.logic.GetUserOrganizationMemberships(ctx, tx, user.ID)
			if orgsErr == nil && len(orgs) > 0 {
				tokenStr, jti, expiresAt, ssoErr = s.jwtSigner.GenerateTokenWithOrg(user.ID, user.Email.String, orgs[0].OrganizationID)
			} else {
				tokenStr, jti, expiresAt, ssoErr = s.jwtSigner.GenerateToken(user.ID, user.Email.String)
			}
		}
		if ssoErr != nil {
			return ssoErr
		}

		// Create session
		_, ssoErr = s.logic.CreateSessionForUser(ctx, tx, user.ID, jti,
			time.Now(), time.Unix(expiresAt, 0),
			extractIPAddress(req.Header()), extractUserAgent(req.Header()))
		return ssoErr
	})
	if err != nil {
		slog.WarnContext(ctx, "ExchangeToken failed", "error", err)
		return nil, ToConnectError(err)
	}

	slog.InfoContext(ctx, "ExchangeToken success", "user_id", user.ID, "is_new_user", isNewUser)

	return connect.NewResponse(&v1.ExchangeTokenResponse{
		AccessToken: tokenStr,
		ExpiresAt:   expiresAt,
		User:        userToProto(user),
		IsNewUser:   isNewUser,
	}), nil
}

// === Password Authentication ===

func (s *IAMServiceConnect) Login(
	ctx context.Context,
	req *connect.Request[v1.LoginRequest],
) (*connect.Response[v1.LoginResponse], error) {
	slog.InfoContext(ctx, "Login called", "email", req.Msg.Email)

	var user *database.IamUser
	var tokenStr string
	var expiresAt int64

	err := txn.WithTxn(ctx, s.adminPool, func(ctx context.Context, tx database.DBTX) error {
		var loginErr error
		user, loginErr = s.logic.LoginWithPassword(ctx, tx, req.Msg.Email, req.Msg.Password)
		if loginErr != nil {
			return loginErr
		}

		// Embed org context in token so permission-based access control works immediately.
		var jti string
		if req.Msg.OrganizationId != nil && *req.Msg.OrganizationId != "" {
			// Client specified which org — validate membership then embed it.
			orgID, parseErr := dbuuid.Parse(*req.Msg.OrganizationId)
			if parseErr != nil {
				return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization_id: %w", parseErr))
			}
			if valErr := s.logic.ValidateUserOrgMembership(ctx, tx, user.ID, orgID); valErr != nil {
				return ToConnectError(valErr)
			}
			tokenStr, jti, expiresAt, loginErr = s.jwtSigner.GenerateTokenWithOrg(user.ID, user.Email.String, orgID)
		} else {
			// Fallback: pick the user's first org (e.g. single-org users or legacy clients).
			orgs, orgsErr := s.logic.GetUserOrganizationMemberships(ctx, tx, user.ID)
			if orgsErr == nil && len(orgs) > 0 {
				tokenStr, jti, expiresAt, loginErr = s.jwtSigner.GenerateTokenWithOrg(user.ID, user.Email.String, orgs[0].OrganizationID)
			} else {
				tokenStr, jti, expiresAt, loginErr = s.jwtSigner.GenerateToken(user.ID, user.Email.String)
			}
		}
		if loginErr != nil {
			return loginErr
		}

		_, loginErr = s.logic.CreateSessionForUser(ctx, tx, user.ID, jti,
			time.Now(), time.Unix(expiresAt, 0),
			extractIPAddress(req.Header()), extractUserAgent(req.Header()))
		return loginErr
	})
	if err != nil {
		slog.WarnContext(ctx, "Login failed", "error", err)
		return nil, ToConnectError(err)
	}

	slog.InfoContext(ctx, "Login success", "user_id", user.ID)

	return connect.NewResponse(&v1.LoginResponse{
		AccessToken: tokenStr,
		ExpiresAt:   expiresAt,
		User:        userToProto(user),
	}), nil
}

// === Password Management ===

func (s *IAMServiceConnect) ChangePassword(
	ctx context.Context,
	req *connect.Request[v1.ChangePasswordRequest],
) (*connect.Response[v1.ChangePasswordResponse], error) {
	userID, err := userIDFromContext(ctx)
	if err != nil {
		return nil, err
	}
	slog.InfoContext(ctx, "ChangePassword called", "user_id", userID)

	err = txn.WithTxn(ctx, s.adminPool, func(ctx context.Context, tx database.DBTX) error {
		if err := s.logic.ChangePasswordForUser(ctx, tx, userID, req.Msg.CurrentPassword, req.Msg.NewPassword); err != nil {
			return err
		}
		return s.logic.InvalidateAllUserSessions(ctx, tx, userID)
	})
	if err != nil {
		slog.WarnContext(ctx, "ChangePassword failed", "error", err, "user_id", userID)
		return nil, ToConnectError(err)
	}

	slog.InfoContext(ctx, "ChangePassword success", "user_id", userID)
	return connect.NewResponse(&v1.ChangePasswordResponse{
		Message: "Password changed successfully. All sessions have been invalidated.",
	}), nil
}

func (s *IAMServiceConnect) RequestPasswordReset(
	ctx context.Context,
	req *connect.Request[v1.RequestPasswordResetRequest],
) (*connect.Response[v1.RequestPasswordResetResponse], error) {
	slog.InfoContext(ctx, "RequestPasswordReset called")
	var resetToken string

	err := txn.WithTxn(ctx, s.adminPool, func(ctx context.Context, tx database.DBTX) error {
		var err error
		resetToken, err = s.logic.RequestPasswordResetForEmail(ctx, tx, req.Msg.Email)
		return err
	})
	if err != nil {
		slog.ErrorContext(ctx, "RequestPasswordReset internal error", "error", err)
		// Don't return error to client — always show generic message
	}

	if resetToken != "" {
		if sendErr := s.emailSender.SendPasswordReset(ctx, PasswordResetEmailInput{
			ToEmail:   req.Msg.Email,
			Token:     resetToken,
			ExpiresIn: ResetTokenExpiry,
		}); sendErr != nil {
			slog.ErrorContext(ctx, "failed to send password reset email", "error", sendErr, "email", req.Msg.Email)
		}
	}

	return connect.NewResponse(&v1.RequestPasswordResetResponse{
		Message: "If that email exists in our system, you will receive a password reset link.",
	}), nil
}

func (s *IAMServiceConnect) ResetPassword(
	ctx context.Context,
	req *connect.Request[v1.ResetPasswordRequest],
) (*connect.Response[v1.ResetPasswordResponse], error) {
	slog.InfoContext(ctx, "ResetPassword called")

	err := txn.WithTxn(ctx, s.adminPool, func(ctx context.Context, tx database.DBTX) error {
		userID, err := s.logic.ResetPasswordWithToken(ctx, tx, req.Msg.Token, req.Msg.NewPassword)
		if err != nil {
			return err
		}
		return s.logic.InvalidateAllUserSessions(ctx, tx, userID)
	})
	if err != nil {
		slog.WarnContext(ctx, "ResetPassword failed", "error", err)
		return nil, ToConnectError(err)
	}

	slog.InfoContext(ctx, "ResetPassword success")
	return connect.NewResponse(&v1.ResetPasswordResponse{
		Message: "Password reset successfully. Please log in with your new password.",
	}), nil
}

// === Session Management ===

func (s *IAMServiceConnect) Logout(
	ctx context.Context,
	req *connect.Request[v1.LogoutRequest],
) (*connect.Response[v1.LogoutResponse], error) {
	userID, err := userIDFromContext(ctx)
	if err != nil {
		return nil, err
	}
	slog.InfoContext(ctx, "Logout called", "user_id", userID)

	// Find the most recent active session for this user and invalidate it.
	// When the auth interceptor is rewritten to store JTI in context,
	// this can be refined to invalidate the exact current session.
	queries := database.New()
	session, sessErr := queries.GetMostRecentSession(ctx, s.adminPool, userID)
	if sessErr == nil {
		if err := queries.InvalidateSession(ctx, s.adminPool, session.ID); err != nil {
			slog.WarnContext(ctx, "failed to invalidate session", "error", err)
		}
	}

	return connect.NewResponse(&v1.LogoutResponse{
		Message: "Logged out successfully.",
	}), nil
}

func (s *IAMServiceConnect) LogoutAllSessions(
	ctx context.Context,
	req *connect.Request[v1.LogoutAllSessionsRequest],
) (*connect.Response[v1.LogoutAllSessionsResponse], error) {
	userID, err := userIDFromContext(ctx)
	if err != nil {
		return nil, err
	}
	slog.InfoContext(ctx, "LogoutAllSessions called", "user_id", userID)

	// Count active sessions before invalidation
	queries := database.New()
	sessions, _ := queries.GetActiveSessions(ctx, s.adminPool, userID)
	count := int32(len(sessions))

	if err := s.logic.InvalidateAllUserSessions(ctx, s.adminPool, userID); err != nil {
		slog.ErrorContext(ctx, "LogoutAllSessions failed", "error", err, "user_id", userID)
		return nil, ToConnectError(err)
	}

	slog.InfoContext(ctx, "LogoutAllSessions success", "user_id", userID, "count", count)
	return connect.NewResponse(&v1.LogoutAllSessionsResponse{
		SessionsInvalidated: count,
	}), nil
}

func (s *IAMServiceConnect) GetActiveSessions(
	ctx context.Context,
	req *connect.Request[v1.GetActiveSessionsRequest],
) (*connect.Response[v1.GetActiveSessionsResponse], error) {
	userID, err := userIDFromContext(ctx)
	if err != nil {
		return nil, err
	}

	sessions, err := s.logic.GetActiveSessionsForUser(ctx, s.adminPool, userID)
	if err != nil {
		return nil, ToConnectError(err)
	}

	protoSessions := make([]*v1.Session, 0, len(sessions))
	for _, sess := range sessions {
		protoSessions = append(protoSessions, sessionToProto(sess))
	}

	return connect.NewResponse(&v1.GetActiveSessionsResponse{
		Sessions: protoSessions,
	}), nil
}

// === User Profile ===

func (s *IAMServiceConnect) GetProfile(
	ctx context.Context,
	req *connect.Request[v1.GetProfileRequest],
) (*connect.Response[v1.GetProfileResponse], error) {
	userID, err := userIDFromContext(ctx)
	if err != nil {
		return nil, err
	}

	queries := database.New()

	user, err := s.logic.GetUserProfile(ctx, s.adminPool, userID)
	if err != nil {
		return nil, ToConnectError(err)
	}

	ssoIdentities, err := queries.GetUserSSOIdentities(ctx, s.adminPool, userID)
	if err != nil {
		slog.WarnContext(ctx, "failed to get SSO identities", "error", err)
		ssoIdentities = nil
	}

	_, passwordErr := queries.GetPasswordCredential(ctx, s.adminPool, userID)
	hasPassword := passwordErr == nil

	memberships, err := s.logic.GetUserOrganizationMemberships(ctx, s.adminPool, userID)
	if err != nil {
		slog.WarnContext(ctx, "failed to get memberships", "error", err)
		memberships = nil
	}

	protoSSO := make([]*v1.SSOIdentity, 0, len(ssoIdentities))
	for _, sso := range ssoIdentities {
		protoSSO = append(protoSSO, ssoIdentityToProto(sso))
	}

	protoOrgs := make([]*v1.OrganizationMembership, 0, len(memberships))
	for _, m := range memberships {
		protoOrgs = append(protoOrgs, membershipRowToProto(m))
	}

	return connect.NewResponse(&v1.GetProfileResponse{
		User:          userToProto(user),
		SsoIdentities: protoSSO,
		HasPassword:   hasPassword,
		Organizations: protoOrgs,
	}), nil
}

func (s *IAMServiceConnect) UpdateProfile(
	ctx context.Context,
	req *connect.Request[v1.UpdateProfileRequest],
) (*connect.Response[v1.UpdateProfileResponse], error) {
	userID, err := userIDFromContext(ctx)
	if err != nil {
		return nil, err
	}

	var user *database.IamUser
	err = txn.WithTxn(ctx, s.adminPool, func(ctx context.Context, tx database.DBTX) error {
		var updateErr error
		user, updateErr = s.logic.UpdateUserProfile(ctx, tx, userID, req.Msg.DisplayName, req.Msg.ProfilePictureUrl)
		return updateErr
	})
	if err != nil {
		return nil, ToConnectError(err)
	}

	return connect.NewResponse(&v1.UpdateProfileResponse{
		User: userToProto(user),
	}), nil
}

// === SSO Identity Management ===

func (s *IAMServiceConnect) LinkSSOIdentity(
	ctx context.Context,
	req *connect.Request[v1.LinkSSOIdentityRequest],
) (*connect.Response[v1.LinkSSOIdentityResponse], error) {
	userID, err := userIDFromContext(ctx)
	if err != nil {
		return nil, err
	}

	provider, err := ssoProviderToString(req.Msg.Provider)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	claims, err := s.jwksVerifier.VerifyProviderToken(ctx, provider, req.Msg.IdToken)
	if err != nil {
		return nil, ToConnectError(err)
	}

	var ssoIdentity *database.IamSsoIdentity
	err = txn.WithTxn(ctx, s.adminPool, func(ctx context.Context, tx database.DBTX) error {
		var linkErr error
		ssoIdentity, linkErr = s.logic.LinkSSOToUser(ctx, tx, userID, claims, provider)
		return linkErr
	})
	if err != nil {
		return nil, ToConnectError(err)
	}

	return connect.NewResponse(&v1.LinkSSOIdentityResponse{
		SsoIdentity: ssoIdentityToProto(ssoIdentity),
	}), nil
}

func (s *IAMServiceConnect) UnlinkSSOIdentity(
	ctx context.Context,
	req *connect.Request[v1.UnlinkSSOIdentityRequest],
) (*connect.Response[v1.UnlinkSSOIdentityResponse], error) {
	userID, err := userIDFromContext(ctx)
	if err != nil {
		return nil, err
	}

	ssoIdentityID, err := dbuuid.Parse(req.Msg.SsoIdentityId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid sso_identity_id: %w", err))
	}

	err = txn.WithTxn(ctx, s.adminPool, func(ctx context.Context, tx database.DBTX) error {
		return s.logic.UnlinkSSOFromUser(ctx, tx, userID, ssoIdentityID)
	})
	if err != nil {
		return nil, ToConnectError(err)
	}

	return connect.NewResponse(&v1.UnlinkSSOIdentityResponse{
		Message: "SSO identity unlinked successfully.",
	}), nil
}

// === Organization Membership ===

func (s *IAMServiceConnect) GetUserOrganizations(
	ctx context.Context,
	req *connect.Request[v1.GetUserOrganizationsRequest],
) (*connect.Response[v1.GetUserOrganizationsResponse], error) {
	userID, err := userIDFromContext(ctx)
	if err != nil {
		return nil, err
	}

	memberships, err := s.logic.GetUserOrganizationMemberships(ctx, s.adminPool, userID)
	if err != nil {
		return nil, ToConnectError(err)
	}

	protoOrgs := make([]*v1.OrganizationMembership, 0, len(memberships))
	for _, m := range memberships {
		protoOrgs = append(protoOrgs, membershipRowToProto(m))
	}

	return connect.NewResponse(&v1.GetUserOrganizationsResponse{
		Organizations: protoOrgs,
	}), nil
}

func (s *IAMServiceConnect) SwitchOrganization(
	ctx context.Context,
	req *connect.Request[v1.SwitchOrganizationRequest],
) (*connect.Response[v1.SwitchOrganizationResponse], error) {
	userID, err := userIDFromContext(ctx)
	if err != nil {
		return nil, err
	}

	orgID, err := dbuuid.Parse(req.Msg.OrganizationId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization_id: %w", err))
	}

	// Validate membership
	if err := s.logic.ValidateUserOrgMembership(ctx, s.adminPool, userID, orgID); err != nil {
		return nil, ToConnectError(err)
	}

	// Get role names for response
	roleNames, err := s.logic.GetUserRoleNamesInOrg(ctx, s.adminPool, userID, orgID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to get role names: %w", err))
	}

	// Get user for email
	user, err := s.logic.GetUserProfile(ctx, s.adminPool, userID)
	if err != nil {
		return nil, ToConnectError(err)
	}

	// Generate new JWT with org context
	tokenStr, jti, expiresAt, err := s.jwtSigner.GenerateTokenWithOrg(userID, user.Email.String, orgID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to generate token: %w", err))
	}

	// Create session
	err = txn.WithTxn(ctx, s.adminPool, func(ctx context.Context, tx database.DBTX) error {
		_, err := s.logic.CreateSessionForUser(ctx, tx, userID, jti,
			time.Now(), time.Unix(expiresAt, 0),
			extractIPAddress(req.Header()), extractUserAgent(req.Header()))
		return err
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&v1.SwitchOrganizationResponse{
		AccessToken: tokenStr,
		ExpiresAt:   expiresAt,
		RoleNames:   roleNames,
	}), nil
}

// === Invitations ===

func (s *IAMServiceConnect) InviteUser(
	ctx context.Context,
	req *connect.Request[v1.InviteUserRequest],
) (*connect.Response[v1.InviteUserResponse], error) {
	userID, err := userIDFromContext(ctx)
	if err != nil {
		return nil, err
	}

	orgID, err := dbuuid.Parse(req.Msg.OrganizationId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization_id: %w", err))
	}

	roleID, err := dbuuid.Parse(req.Msg.RoleId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid role_id: %w", err))
	}

	slog.InfoContext(ctx, "InviteUser called", "email", req.Msg.Email, "role_id", roleID, "org_id", orgID)

	var invitation *database.IamInvitation
	err = txn.WithTxn(ctx, s.adminPool, func(ctx context.Context, tx database.DBTX) error {
		var invErr error
		invitation, invErr = s.logic.CreateInvitationForOrg(ctx, tx, orgID, req.Msg.Email, roleID, userID)
		return invErr
	})
	if err != nil {
		slog.WarnContext(ctx, "InviteUser failed", "error", err)
		return nil, ToConnectError(err)
	}

	slog.InfoContext(ctx, "InviteUser success", "invitation_id", invitation.ID, "email", req.Msg.Email)

	if sendErr := s.emailSender.SendOrganizationInvitation(ctx, OrganizationInvitationEmailInput{
		ToEmail:          invitation.Email,
		Token:            invitation.Token,
		OrganizationName: s.lookupOrganizationName(ctx, invitation.OrganizationID),
		RoleName:         s.lookupRoleName(ctx, invitation.OrganizationID, invitation.RoleID),
		ExpiresIn:        time.Until(invitation.ExpiresAt.Time),
	}); sendErr != nil {
		slog.ErrorContext(ctx, "failed to send invitation email", "error", sendErr, "email", req.Msg.Email, "invitation_id", invitation.ID)
	}

	return connect.NewResponse(&v1.InviteUserResponse{
		Invitation: invitationToProto(invitation),
	}), nil
}

func (s *IAMServiceConnect) lookupOrganizationName(ctx context.Context, orgID dbuuid.UUID) string {
	var companyName string
	if err := s.adminPool.QueryRow(ctx, "SELECT company_name FROM public.organization WHERE id = $1", orgID).Scan(&companyName); err != nil {
		slog.WarnContext(ctx, "failed to load organization name for invitation email", "error", err, "org_id", orgID)
		return ""
	}
	return companyName
}

func (s *IAMServiceConnect) lookupRoleName(ctx context.Context, orgID, roleID dbuuid.UUID) string {
	role, err := database.New().GetIAMRole(ctx, s.adminPool, &database.GetIAMRoleParams{
		OrganizationID: orgID,
		ID:             roleID,
	})
	if err != nil {
		slog.WarnContext(ctx, "failed to load role name for invitation email", "error", err, "org_id", orgID, "role_id", roleID)
		return ""
	}
	return role.Name
}

func (s *IAMServiceConnect) CancelInvitation(
	ctx context.Context,
	req *connect.Request[v1.CancelInvitationRequest],
) (*connect.Response[v1.CancelInvitationResponse], error) {
	orgID, err := dbuuid.Parse(req.Msg.OrganizationId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization_id: %w", err))
	}

	invitationID, err := dbuuid.Parse(req.Msg.InvitationId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid invitation_id: %w", err))
	}

	err = txn.WithTxn(ctx, s.adminPool, func(ctx context.Context, tx database.DBTX) error {
		return s.logic.CancelInvitationInOrg(ctx, tx, invitationID, orgID)
	})
	if err != nil {
		return nil, ToConnectError(err)
	}

	return connect.NewResponse(&v1.CancelInvitationResponse{
		Message: "Invitation cancelled.",
	}), nil
}

func (s *IAMServiceConnect) ListInvitations(
	ctx context.Context,
	req *connect.Request[v1.ListInvitationsRequest],
) (*connect.Response[v1.ListInvitationsResponse], error) {
	orgID, err := dbuuid.Parse(req.Msg.OrganizationId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization_id: %w", err))
	}

	var status *string
	if req.Msg.Status != nil {
		s := invitationStatusToString(*req.Msg.Status)
		status = &s
	}

	invitations, err := s.logic.ListInvitationsForOrg(ctx, s.adminPool, orgID, status)
	if err != nil {
		return nil, ToConnectError(err)
	}

	protoInvitations := make([]*v1.Invitation, 0, len(invitations))
	for _, inv := range invitations {
		protoInvitations = append(protoInvitations, invitationToProto(inv))
	}

	return connect.NewResponse(&v1.ListInvitationsResponse{
		Invitations: protoInvitations,
	}), nil
}

func (s *IAMServiceConnect) AcceptInvitation(
	ctx context.Context,
	req *connect.Request[v1.AcceptInvitationRequest],
) (*connect.Response[v1.AcceptInvitationResponse], error) {
	slog.InfoContext(ctx, "AcceptInvitation called")

	var ssoClaims *SSOClaims
	var provider *string
	if req.Msg.SsoProvider != nil && req.Msg.SsoIdToken != nil {
		p, err := ssoProviderToString(*req.Msg.SsoProvider)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		}
		claims, err := s.jwksVerifier.VerifyProviderToken(ctx, p, *req.Msg.SsoIdToken)
		if err != nil {
			return nil, ToConnectError(err)
		}
		ssoClaims = claims
		provider = &p
	}

	var user *database.IamUser
	var orgID dbuuid.UUID
	var tokenStr string
	var expiresAt int64

	err := txn.WithTxn(ctx, s.adminPool, func(ctx context.Context, tx database.DBTX) error {
		var acceptErr error
		user, orgID, acceptErr = s.logic.AcceptInvitationWithToken(ctx, tx, req.Msg.Token, ssoClaims, provider, req.Msg.Password, req.Msg.DisplayName)
		if acceptErr != nil {
			return acceptErr
		}

		var jti string
		tokenStr, jti, expiresAt, acceptErr = s.jwtSigner.GenerateTokenWithOrg(user.ID, user.Email.String, orgID)
		if acceptErr != nil {
			return acceptErr
		}

		_, acceptErr = s.logic.CreateSessionForUser(ctx, tx, user.ID, jti,
			time.Now(), time.Unix(expiresAt, 0),
			extractIPAddress(req.Header()), extractUserAgent(req.Header()))
		return acceptErr
	})
	if err != nil {
		slog.WarnContext(ctx, "AcceptInvitation failed", "error", err)
		return nil, ToConnectError(err)
	}

	slog.InfoContext(ctx, "AcceptInvitation success", "user_id", user.ID, "org_id", orgID)

	return connect.NewResponse(&v1.AcceptInvitationResponse{
		AccessToken: tokenStr,
		ExpiresAt:   expiresAt,
		User:        userToProto(user),
		Membership: &v1.OrganizationMembership{
			Id:             user.ID.String(),
			OrganizationId: orgID.String(),
		},
	}), nil
}

// === Employee Listing ===

func (s *IAMServiceConnect) ListEmployees(
	ctx context.Context,
	req *connect.Request[v1.ListEmployeesRequest],
) (*connect.Response[v1.ListEmployeesResponse], error) {
	// Get org ID from JWT context (set by SwitchOrganization/Login)
	orgIDStr, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok || orgIDStr == "" {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("missing organization context: please use SwitchOrganization to set org context"))
	}
	orgID, err := dbuuid.Parse(orgIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("invalid org ID in token: %w", err))
	}

	// Pagination defaults
	pageNumber := req.Msg.PageNumber
	if pageNumber < 1 {
		pageNumber = 1
	}
	pageSize := req.Msg.PageSize
	if pageSize <= 0 || pageSize > 200 {
		pageSize = 50
	}
	offset := (pageNumber - 1) * pageSize

	// Optional email filter
	var emailFilter pgtype.Text
	if req.Msg.EmailFilter != nil && *req.Msg.EmailFilter != "" {
		emailFilter = pgtype.Text{String: *req.Msg.EmailFilter, Valid: true}
	}

	// Sort field (default: hire_date)
	var sortBy pgtype.Text
	if req.Msg.SortBy != nil && (*req.Msg.SortBy == "hire_date" || *req.Msg.SortBy == "date_of_birth") {
		sortBy = pgtype.Text{String: *req.Msg.SortBy, Valid: true}
	} else {
		sortBy = pgtype.Text{String: "hire_date", Valid: true}
	}

	// Sort direction (default: ASC)
	var sortDirection pgtype.Text
	if req.Msg.SortDirection != nil && *req.Msg.SortDirection == "DESC" {
		sortDirection = pgtype.Text{String: "DESC", Valid: true}
	} else {
		sortDirection = pgtype.Text{String: "ASC", Valid: true}
	}

	queries := database.New()

	totalCount, err := queries.CountEmployees(ctx, s.adminPool, &database.CountEmployeesParams{
		OrganizationID: orgID,
		Email:          emailFilter,
	})
	if err != nil {
		slog.WarnContext(ctx, "ListEmployees count failed", "error", err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to count employees: %w", err))
	}

	employees, err := queries.ListEmployees(ctx, s.adminPool, &database.ListEmployeesParams{
		OrganizationID: orgID,
		Email:          emailFilter,
		SortBy:         sortBy,
		SortDirection:  sortDirection,
		Offset:         offset,
		PageSize:       pageSize,
	})
	if err != nil {
		slog.WarnContext(ctx, "ListEmployees query failed", "error", err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to list employees: %w", err))
	}

	protoEmployees := make([]*v1.EmployeeListItem, 0, len(employees))

	// Collect employee IDs for batch enrichment
	empIDs := make([]dbuuid.UUID, 0, len(employees))
	for _, emp := range employees {
		empIDs = append(empIDs, emp.ID)
	}

	// Batch-fetch role names for all listed employees
	roleMap := make(map[string][]string) // employee_id -> role_names
	if len(empIDs) > 0 {
		roleRows, roleErr := queries.GetRoleNamesForEmployeeBatch(ctx, s.adminPool, &database.GetRoleNamesForEmployeeBatchParams{
			OrganizationID: orgID,
			EmployeeIds:    empIDs,
		})
		if roleErr != nil {
			slog.WarnContext(ctx, "ListEmployees: role batch fetch failed", "error", roleErr)
			// Non-fatal: continue without role data
		} else {
			for _, r := range roleRows {
				key := r.EmployeeID.String()
				roleMap[key] = append(roleMap[key], r.RoleName)
			}
		}
	}

	// Batch-fetch is_org_managed flags and user emails
	orgManagedMap := make(map[string]bool)  // user_id -> is_org_managed
	userEmailMap := make(map[string]string) // user_id -> user_email
	if len(empIDs) > 0 {
		managedRows, managedErr := queries.GetIsOrgManagedForBatch(ctx, s.adminPool, empIDs)
		if managedErr != nil {
			slog.WarnContext(ctx, "ListEmployees: org-managed batch fetch failed", "error", managedErr)
			// Non-fatal: continue without org-managed data
		} else {
			for _, r := range managedRows {
				orgManagedMap[r.ID.String()] = r.IsOrgManaged
				if r.UserEmail.Valid && r.UserEmail.String != "" {
					userEmailMap[r.ID.String()] = r.UserEmail.String
				}
			}
		}
	}

	// Batch-fetch login_identifiers for org-managed workers
	loginIdentifierMap := make(map[string]string) // employee_id -> login_identifier
	if len(empIDs) > 0 {
		loginRows, loginErr := queries.GetLoginIdentifierBatch(ctx, s.adminPool, &database.GetLoginIdentifierBatchParams{
			OrganizationID: orgID,
			IdentityIds:    empIDs,
		})
		if loginErr != nil {
			slog.WarnContext(ctx, "ListEmployees: login_identifier batch fetch failed", "error", loginErr)
			// Non-fatal: continue without login_identifier data
		} else {
			for _, r := range loginRows {
				if r.LoginIdentifier.Valid {
					loginIdentifierMap[r.ID.String()] = r.LoginIdentifier.String
				}
			}
		}
	}

	for _, emp := range employees {
		empIDStr := emp.ID.String()
		item := &v1.EmployeeListItem{
			Id:           empIDStr,
			Email:        emp.Email,
			GivenName:    emp.GivenName,
			FamilyName:   emp.FamilyName,
			IsActive:     emp.IsActive,
			RoleNames:    roleMap[empIDStr],
			IsOrgManaged: orgManagedMap[empIDStr],
		}
		// Attach login_identifier for org-managed workers
		if li, ok := loginIdentifierMap[empIDStr]; ok {
			item.LoginIdentifier = &li
		}
		// Attach user account email
		if ue, ok := userEmailMap[empIDStr]; ok {
			item.UserAccountEmail = &ue
		}
		if emp.HireDate.Valid {
			hd := emp.HireDate.Time.Format("2006-01-02")
			item.HireDate = &hd
		}
		if emp.DateOfBirth.Valid {
			dob := emp.DateOfBirth.Time.Format("2006-01-02")
			item.DateOfBirth = &dob
		}
		if emp.PhoneNumber.Valid {
			pn := emp.PhoneNumber.String
			item.PhoneNumber = &pn
		}
		if emp.HomeAddress.Valid {
			ha := emp.HomeAddress.String
			item.HomeAddress = &ha
		}
		protoEmployees = append(protoEmployees, item)
	}

	totalPages := int32((totalCount + int64(pageSize) - 1) / int64(pageSize))

	slog.InfoContext(ctx, "ListEmployees success", "org_id", orgIDStr, "count", len(employees), "total", totalCount)

	return connect.NewResponse(&v1.ListEmployeesResponse{
		Employees: protoEmployees,
		Pagination: &v1.EmployeeListPagination{
			TotalCount:      totalCount,
			PageNumber:      pageNumber,
			PageSize:        pageSize,
			TotalPages:      totalPages,
			HasPreviousPage: pageNumber > 1,
			HasNextPage:     int64(pageNumber)*int64(pageSize) < totalCount,
		},
	}), nil
}

// === Employee Cards — lightweight batch lookup for UI ===

func (s *IAMServiceConnect) GetEmployeeCards(
	ctx context.Context,
	req *connect.Request[v1.GetEmployeeCardsRequest],
) (*connect.Response[v1.GetEmployeeCardsResponse], error) {
	orgIDStr, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok || orgIDStr == "" {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("missing organization context"))
	}
	orgID, err := dbuuid.Parse(orgIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("invalid org ID in token: %w", err))
	}

	if len(req.Msg.EmployeeIds) == 0 {
		return connect.NewResponse(&v1.GetEmployeeCardsResponse{}), nil
	}
	if len(req.Msg.EmployeeIds) > 100 {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("too many employee IDs: max 100, got %d", len(req.Msg.EmployeeIds)))
	}

	employeeIDs := make([]dbuuid.UUID, 0, len(req.Msg.EmployeeIds))
	for _, idStr := range req.Msg.EmployeeIds {
		id, parseErr := dbuuid.Parse(idStr)
		if parseErr != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid employee ID %q: %w", idStr, parseErr))
		}
		employeeIDs = append(employeeIDs, id)
	}

	queries := database.New()
	rows, err := queries.GetEmployeeCardsByIDs(ctx, s.adminPool, &database.GetEmployeeCardsByIDsParams{
		Column1:        employeeIDs,
		OrganizationID: orgID,
	})
	if err != nil {
		slog.WarnContext(ctx, "GetEmployeeCards query failed", "error", err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch employee cards: %w", err))
	}
	presenceRows, err := queries.GetLatestEmployeePresenceByIDs(ctx, s.adminPool, &database.GetLatestEmployeePresenceByIDsParams{
		OrganizationID:          orgID,
		EmployeeIds:             employeeIDs,
		ResponsiveWindowSeconds: notification.ResponsiveWindowSeconds,
	})
	if err != nil {
		slog.WarnContext(ctx, "GetEmployeeCards presence query failed", "error", err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to fetch employee presence: %w", err))
	}

	presenceByEmployee := make(map[dbuuid.UUID]string, len(presenceRows))
	for _, row := range presenceRows {
		ps, _ := row.PresenceStatus.(string)
		if ps == "" {
			continue
		}
		presenceByEmployee[row.EmployeeID] = ps
	}

	cards := make([]*v1.EmployeeCard, 0, len(rows))
	for _, row := range rows {
		presenceStatus := "offline"
		if ps, ok := presenceByEmployee[row.ID]; ok {
			presenceStatus = ps
		}

		card := &v1.EmployeeCard{
			Id:             row.ID.String(),
			GivenName:      row.GivenName,
			FamilyName:     row.FamilyName,
			Email:          row.Email,
			IsActive:       row.IsActive,
			PresenceStatus: presenceStatus,
		}
		if row.DepartmentName.Valid {
			card.DepartmentName = &row.DepartmentName.String
		}
		cards = append(cards, card)
	}

	slog.InfoContext(ctx, "GetEmployeeCards success", "org_id", orgIDStr, "requested", len(req.Msg.EmployeeIds), "found", len(cards))
	return connect.NewResponse(&v1.GetEmployeeCardsResponse{Cards: cards}), nil
}

// === Employee Import ===

func (s *IAMServiceConnect) PreviewEmployeeImport(
	ctx context.Context,
	req *connect.Request[v1.PreviewEmployeeImportRequest],
) (*connect.Response[v1.PreviewEmployeeImportResponse], error) {
	orgIDStr, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok || orgIDStr == "" {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("missing organization context"))
	}
	orgID, err := dbuuid.Parse(orgIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("invalid org ID in token: %w", err))
	}

	input := req.Msg.Employees
	if len(input) == 0 {
		return connect.NewResponse(&v1.PreviewEmployeeImportResponse{}), nil
	}

	// Collect all emails for duplicate check
	emails := make([]string, 0, len(input))
	for _, e := range input {
		emails = append(emails, e.Email)
	}

	queries := database.New()
	existing, err := queries.CheckDuplicateEmployeeEmailsBatch(ctx, s.adminPool, &database.CheckDuplicateEmployeeEmailsBatchParams{
		OrganizationID: orgID,
		Column2:        emails,
	})
	if err != nil {
		slog.WarnContext(ctx, "PreviewEmployeeImport duplicate check failed", "error", err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to check duplicates: %w", err))
	}

	duplicateSet := make(map[string]struct{}, len(existing))
	for _, row := range existing {
		duplicateSet[row.Email] = struct{}{}
	}

	items := make([]*v1.EmployeeImportPreviewItem, 0, len(input))
	var importCount, duplicateCount int32
	for _, e := range input {
		_, isDuplicate := duplicateSet[e.Email]
		willImport := !isDuplicate && e.Email != ""
		if willImport {
			importCount++
		} else {
			duplicateCount++
		}
		item := &v1.EmployeeImportPreviewItem{
			Employee:       e,
			WillBeImported: willImport,
			IsDuplicate:    isDuplicate,
		}
		items = append(items, item)
	}

	return connect.NewResponse(&v1.PreviewEmployeeImportResponse{
		Items:          items,
		ImportCount:    importCount,
		DuplicateCount: duplicateCount,
	}), nil
}

func (s *IAMServiceConnect) ExecuteEmployeeImport(
	ctx context.Context,
	req *connect.Request[v1.ExecuteEmployeeImportRequest],
) (*connect.Response[v1.ExecuteEmployeeImportResponse], error) {
	orgIDStr, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok || orgIDStr == "" {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("missing organization context"))
	}
	orgID, err := dbuuid.Parse(orgIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("invalid org ID in token: %w", err))
	}
	inviterID, err := userIDFromContext(ctx)
	if err != nil {
		return nil, err
	}

	input := req.Msg.Employees
	results := make([]*v1.EmployeeImportResult, 0, len(input))
	var successCount, failureCount int32

	for _, empData := range input {
		result := s.importSingleEmployee(ctx, orgID, inviterID, empData)
		if result.Success {
			successCount++
		} else {
			failureCount++
		}
		results = append(results, result)
	}

	slog.InfoContext(ctx, "ExecuteEmployeeImport done",
		"org_id", orgIDStr, "success", successCount, "failure", failureCount)

	return connect.NewResponse(&v1.ExecuteEmployeeImportResponse{
		Results:      results,
		SuccessCount: successCount,
		FailureCount: failureCount,
	}), nil
}

// importSingleEmployee creates one organization.employee record and its invitation in a transaction.
// Returns a result with success=false on error (partial failure is allowed).
func (s *IAMServiceConnect) importSingleEmployee(
	ctx context.Context,
	orgID dbuuid.UUID,
	inviterID dbuuid.UUID,
	empData *v1.ImportEmployeeData,
) *v1.EmployeeImportResult {
	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}
	empID := dbuuid.Must()

	hireDate := pgtype.Date{}
	if empData.HireDate != nil && *empData.HireDate != "" {
		if t, parseErr := time.Parse("2006-01-02", *empData.HireDate); parseErr == nil {
			hireDate = pgtype.Date{Time: t, Valid: true}
		}
	}
	dob := pgtype.Date{}
	if empData.DateOfBirth != nil && *empData.DateOfBirth != "" {
		if t, parseErr := time.Parse("2006-01-02", *empData.DateOfBirth); parseErr == nil {
			dob = pgtype.Date{Time: t, Valid: true}
		}
	}
	phone := pgtype.Text{}
	if empData.PhoneNumber != nil {
		phone = pgtype.Text{String: *empData.PhoneNumber, Valid: true}
	}
	addr := pgtype.Text{}
	if empData.HomeAddress != nil {
		addr = pgtype.Text{String: *empData.HomeAddress, Valid: true}
	}

	var txErr error
	txErr = txn.WithTxn(ctx, s.adminPool, func(ctx context.Context, tx database.DBTX) error {
		emp := database.OrganizationEmployee{
			ID:             empID,
			OrganizationID: orgID,
			GivenName:      empData.GivenName,
			FamilyName:     empData.FamilyName,
			Email:          empData.Email,
			HireDate:       hireDate,
			DateOfBirth:    dob,
			PhoneNumber:    phone,
			HomeAddress:    addr,
			IsActive:       true,
			UpdatedAt:      now,
		}
		if createErr := dbcrud.Create(ctx, tx, &emp); createErr != nil {
			return fmt.Errorf("create employee: %w", createErr)
		}
		// Look up the default "employee" role for this org
		queries := database.New()
		empRole, roleErr := queries.GetOrgRoleBySourceDefault(ctx, tx, &database.GetOrgRoleBySourceDefaultParams{
			OrganizationID:      orgID,
			SourceDefaultRoleID: pgtype.Text{String: DefaultRoleEmployee, Valid: true},
		})
		if roleErr != nil {
			return fmt.Errorf("get default employee role: %w", roleErr)
		}
		if _, invErr := s.logic.CreateInvitationForOrg(ctx, tx, orgID, empData.Email, empRole.ID, inviterID); invErr != nil {
			return fmt.Errorf("create invitation: %w", invErr)
		}
		return nil
	})

	if txErr != nil {
		slog.WarnContext(ctx, "importSingleEmployee failed", "email", empData.Email, "error", txErr)
		return &v1.EmployeeImportResult{Email: empData.Email, Success: false, Error: txErr.Error()}
	}
	return &v1.EmployeeImportResult{Email: empData.Email, Success: true}
}

// === Helpers ===

func userIDFromContext(ctx context.Context) (dbuuid.UUID, error) {
	userIDStr, ok := interceptor.UserIDFromContext(ctx)
	if !ok {
		return dbuuid.UUID{}, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("missing user ID in context"))
	}
	id, err := dbuuid.Parse(userIDStr)
	if err != nil {
		return dbuuid.UUID{}, connect.NewError(connect.CodeInternal, fmt.Errorf("invalid user ID: %w", err))
	}
	return id, nil
}

func extractIPAddress(headers interface{ Get(string) string }) string {
	if xff := headers.Get("X-Forwarded-For"); xff != "" {
		return xff
	}
	if xri := headers.Get("X-Real-IP"); xri != "" {
		return xri
	}
	return ""
}

func extractUserAgent(headers interface{ Get(string) string }) string {
	return headers.Get("User-Agent")
}

func userToProto(user *database.IamUser) *v1.User {
	u := &v1.User{
		Id:          user.ID.String(),
		Email:       user.Email.String,
		DisplayName: user.DisplayName.String,
		Status:      userStatusToProto(user.Status),
		CreatedAt:   timestamppb.New(user.CreatedAt.Time),
	}
	if user.ProfilePictureUrl.Valid {
		u.ProfilePictureUrl = user.ProfilePictureUrl.String
	}
	if user.LastLoginAt.Valid {
		u.LastLoginAt = timestamppb.New(user.LastLoginAt.Time)
	}
	return u
}

func sessionToProto(sess *database.IamSession) *v1.Session {
	s := &v1.Session{
		Id:             sess.ID.String(),
		IssuedAt:       timestamppb.New(sess.IssuedAt.Time),
		ExpiresAt:      timestamppb.New(sess.ExpiresAt.Time),
		LastActivityAt: timestamppb.New(sess.LastActivityAt.Time),
	}
	if sess.IpAddress != nil {
		s.IpAddress = sess.IpAddress.String()
	}
	if sess.UserAgent.Valid {
		s.UserAgent = sess.UserAgent.String
	}
	return s
}

func ssoIdentityToProto(sso *database.IamSsoIdentity) *v1.SSOIdentity {
	return &v1.SSOIdentity{
		Id:         sso.ID.String(),
		Provider:   ssoProviderFromString(sso.Provider),
		Email:      sso.Email,
		CreatedAt:  timestamppb.New(sso.CreatedAt.Time),
		LastUsedAt: timestamppb.New(sso.LastUsedAt.Time),
	}
}

func membershipRowToProto(m *database.GetUserOrganizationsRow) *v1.OrganizationMembership {
	return &v1.OrganizationMembership{
		Id:                    m.ID.String(),
		OrganizationId:        m.OrganizationID.String(),
		OrganizationName:      m.CompanyName,
		OrganizationSubdomain: m.Subdomain,
		RoleNames:             m.RoleNames,
		JoinedAt:              timestamppb.New(m.JoinedAt.Time),
	}
}

func invitationToProto(inv *database.IamInvitation) *v1.Invitation {
	return &v1.Invitation{
		Id:          inv.ID.String(),
		Email:       inv.Email,
		RoleId:      inv.RoleID.String(),
		Status:      invitationStatusFromString(inv.Status),
		ExpiresAt:   timestamppb.New(inv.ExpiresAt.Time),
		CreatedAt:   timestamppb.New(inv.CreatedAt.Time),
		InvitedById: inv.InvitedBy.String(),
	}
}

func ssoProviderToString(p v1.SSOProvider) (string, error) {
	switch p {
	case v1.SSOProvider_SSO_PROVIDER_GOOGLE:
		return SSOProviderGoogle, nil
	case v1.SSOProvider_SSO_PROVIDER_APPLE:
		return SSOProviderApple, nil
	default:
		return "", fmt.Errorf("invalid SSO provider: %v", p)
	}
}

func ssoProviderFromString(s string) v1.SSOProvider {
	switch s {
	case SSOProviderGoogle:
		return v1.SSOProvider_SSO_PROVIDER_GOOGLE
	case SSOProviderApple:
		return v1.SSOProvider_SSO_PROVIDER_APPLE
	default:
		return v1.SSOProvider_SSO_PROVIDER_UNSPECIFIED
	}
}

func userStatusToProto(status string) v1.UserStatus {
	switch status {
	case UserStatusActive:
		return v1.UserStatus_USER_STATUS_ACTIVE
	case UserStatusSuspended:
		return v1.UserStatus_USER_STATUS_SUSPENDED
	case UserStatusDeleted:
		return v1.UserStatus_USER_STATUS_DELETED
	default:
		return v1.UserStatus_USER_STATUS_UNSPECIFIED
	}
}

func invitationStatusToString(s v1.InvitationStatus) string {
	switch s {
	case v1.InvitationStatus_INVITATION_STATUS_PENDING:
		return InvitationStatusPending
	case v1.InvitationStatus_INVITATION_STATUS_ACCEPTED:
		return InvitationStatusAccepted
	case v1.InvitationStatus_INVITATION_STATUS_CANCELLED:
		return InvitationStatusCancelled
	case v1.InvitationStatus_INVITATION_STATUS_EXPIRED:
		return InvitationStatusExpired
	default:
		return InvitationStatusPending
	}
}

func invitationStatusFromString(s string) v1.InvitationStatus {
	switch s {
	case InvitationStatusPending:
		return v1.InvitationStatus_INVITATION_STATUS_PENDING
	case InvitationStatusAccepted:
		return v1.InvitationStatus_INVITATION_STATUS_ACCEPTED
	case InvitationStatusCancelled:
		return v1.InvitationStatus_INVITATION_STATUS_CANCELLED
	case InvitationStatusExpired:
		return v1.InvitationStatus_INVITATION_STATUS_EXPIRED
	default:
		return v1.InvitationStatus_INVITATION_STATUS_UNSPECIFIED
	}
}
