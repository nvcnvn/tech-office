package iam

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"

	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/database/txn"
	"github.com/nvcnvn/tech-office/backend/internal/interceptor"
	v1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// === PIN Authentication ===

func (s *IAMServiceConnect) LoginWithPIN(
	ctx context.Context,
	req *connect.Request[v1.LoginWithPINRequest],
) (*connect.Response[v1.LoginWithPINResponse], error) {
	slog.InfoContext(ctx, "LoginWithPIN called",
		"subdomain", req.Msg.OrganizationSubdomain,
		"login_identifier", req.Msg.LoginIdentifier,
	)

	// Resolve org from subdomain using AdminPool (global query)
	queries := database.New()
	var org *database.GetOrgBySubdomainRow
	err := txn.WithTxn(ctx, s.adminPool, func(ctx context.Context, tx database.DBTX) error {
		var lookupErr error
		org, lookupErr = queries.GetOrgBySubdomain(ctx, tx, req.Msg.OrganizationSubdomain)
		return lookupErr
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("organization not found"))
		}
		slog.WarnContext(ctx, "LoginWithPIN: org lookup failed", "error", err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to look up organization"))
	}

	// PIN auth uses AdminPool directly (auto-commit mode) for LoginWithPIN so that
	// lockout escalation writes commit even when authentication fails (wrong PIN).
	// If we wrapped this in WithTxn, a wrong-PIN error would roll back the lockout write.
	var result *LoginWithPINResult
	var loginErr error
	result, loginErr = s.logic.LoginWithPIN(ctx, s.adminPool, org.ID, req.Msg.LoginIdentifier, req.Msg.Pin)
	if loginErr != nil {
		slog.WarnContext(ctx, "LoginWithPIN failed",
			"error", loginErr,
			"subdomain", req.Msg.OrganizationSubdomain,
			"login_identifier", req.Msg.LoginIdentifier,
		)
		return nil, ToConnectError(loginErr)
	}

	// If full login (not pin-change-required), create session in its own transaction
	if !result.PINChangeRequired && result.JTI != "" {
		err = txn.WithTxn(ctx, s.adminPool, func(ctx context.Context, tx database.DBTX) error {
			_, err := s.logic.CreateSessionForUser(ctx, tx, result.UserID, result.JTI,
				time.Now(), time.Unix(result.ExpiresAt, 0),
				extractIPAddress(req.Header()), extractUserAgent(req.Header()))
			return err
		})
		if err != nil {
			slog.WarnContext(ctx, "LoginWithPIN: failed to create session", "error", err)
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create session"))
		}
	}

	slog.InfoContext(ctx, "LoginWithPIN success",
		"subdomain", req.Msg.OrganizationSubdomain,
		"pin_change_required", result.PINChangeRequired,
	)

	return connect.NewResponse(&v1.LoginWithPINResponse{
		AccessToken:       result.AccessToken,
		ExpiresAt:         result.ExpiresAt,
		PinChangeRequired: result.PINChangeRequired,
		PinChangeToken:    result.PINChangeToken,
	}), nil
}

func (s *IAMServiceConnect) SetPIN(
	ctx context.Context,
	req *connect.Request[v1.SetPINRequest],
) (*connect.Response[v1.SetPINResponse], error) {
	var userID dbuuid.UUID
	var orgID dbuuid.UUID

	viaPINChangeToken := req.Msg.PinChangeToken != nil && *req.Msg.PinChangeToken != ""
	currentPIN := ""
	if req.Msg.CurrentPin != nil {
		currentPIN = *req.Msg.CurrentPin
	}

	// Determine auth: either via pin_change_token or standard auth context
	if viaPINChangeToken {
		// Parse the pin_change_token (it's a JWT with user_id + org_id)
		claims, err := s.jwtSigner.ParseToken(*req.Msg.PinChangeToken)
		if err != nil {
			return nil, ToConnectError(ErrInvalidPINChangeToken)
		}
		userID, err = dbuuid.Parse(claims.Subject)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("invalid user ID in token"))
		}
		orgID, err = dbuuid.Parse(claims.OrgID)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("invalid org ID in token"))
		}
	} else {
		var err error
		userID, err = userIDFromContext(ctx)
		if err != nil {
			return nil, err
		}
		orgIDStr, ok := interceptor.UserOrgIDFromContext(ctx)
		if !ok || orgIDStr == "" {
			return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("organization context required"))
		}
		orgID = dbuuid.MustParse(orgIDStr)
	}

	slog.InfoContext(ctx, "SetPIN called", "user_id", userID, "org_id", orgID)

	// Use adminPool because SetPIN may be called with a pin_change_token (no JWT/org context).
	// All queries pass orgID and userID explicitly, so tenant-scoped RLS is not required.
	if err := txn.WithTxn(ctx, s.adminPool, func(ctx context.Context, tx database.DBTX) error {
		return s.logic.SetPIN(ctx, tx, orgID, userID, req.Msg.NewPin, currentPIN, viaPINChangeToken)
	}); err != nil {
		slog.WarnContext(ctx, "SetPIN failed", "error", err, "user_id", userID)
		return nil, ToConnectError(err)
	}

	// After SetPIN, issue a full JWT
	tokenStr, _, expiresAt, err := s.jwtSigner.GenerateTokenWithOrg(userID, "", orgID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to generate token: %w", err))
	}

	slog.InfoContext(ctx, "SetPIN success", "user_id", userID)

	return connect.NewResponse(&v1.SetPINResponse{
		AccessToken: tokenStr,
		ExpiresAt:   expiresAt,
	}), nil
}

// === Org Account Management ===

func (s *IAMServiceConnect) CreateOrgAccount(
	ctx context.Context,
	req *connect.Request[v1.CreateOrgAccountRequest],
) (*connect.Response[v1.CreateOrgAccountResponse], error) {
	userID, orgID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	slog.InfoContext(ctx, "CreateOrgAccount called",
		"org_id", orgID,
		"login_identifier", req.Msg.LoginIdentifier,
	)

	var result *CreateOrgAccountResult
	err = txn.WithTxn(ctx, s.tenantPool, func(ctx context.Context, tx database.DBTX) error {
		var createErr error
		result, createErr = s.logic.CreateOrgAccount(ctx, tx, orgID, userID, CreateOrgAccountParams{
			LoginIdentifier: req.Msg.LoginIdentifier,
			DisplayName:     req.Msg.DisplayName,
			GivenName:       req.Msg.GivenName,
			FamilyName:      req.Msg.FamilyName,
			DepartmentID:    req.Msg.DepartmentId,
			DateOfBirth:     req.Msg.DateOfBirth,
			PhoneNumber:     req.Msg.PhoneNumber,
		})
		return createErr
	})
	if err != nil {
		slog.WarnContext(ctx, "CreateOrgAccount failed", "error", err)
		return nil, ToConnectError(err)
	}

	slog.InfoContext(ctx, "CreateOrgAccount success",
		"id", result.ID,
		"login_identifier", result.LoginIdentifier,
	)

	return connect.NewResponse(&v1.CreateOrgAccountResponse{
		Id:              result.ID.String(),
		LoginIdentifier: result.LoginIdentifier,
		TemporaryPin:    result.TemporaryPIN,
	}), nil
}

func (s *IAMServiceConnect) BatchCreateOrgAccounts(
	ctx context.Context,
	req *connect.Request[v1.BatchCreateOrgAccountsRequest],
) (*connect.Response[v1.BatchCreateOrgAccountsResponse], error) {
	userID, orgID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	slog.InfoContext(ctx, "BatchCreateOrgAccounts called",
		"org_id", orgID,
		"count", len(req.Msg.Accounts),
	)

	var results []*v1.BatchCreateOrgAccountResult
	var successCount, failureCount int32

	for _, acct := range req.Msg.Accounts {
		var result *CreateOrgAccountResult
		createErr := txn.WithTxn(ctx, s.tenantPool, func(ctx context.Context, tx database.DBTX) error {
			var err error
			result, err = s.logic.CreateOrgAccount(ctx, tx, orgID, userID, CreateOrgAccountParams{
				LoginIdentifier: acct.LoginIdentifier,
				DisplayName:     acct.DisplayName,
				GivenName:       acct.GivenName,
				FamilyName:      acct.FamilyName,
				DepartmentID:    acct.DepartmentId,
				DateOfBirth:     acct.DateOfBirth,
				PhoneNumber:     acct.PhoneNumber,
			})
			return err
		})

		if createErr != nil {
			failureCount++
			results = append(results, &v1.BatchCreateOrgAccountResult{
				LoginIdentifier: acct.LoginIdentifier,
				Success:         false,
				Error:           createErr.Error(),
			})
		} else {
			successCount++
			results = append(results, &v1.BatchCreateOrgAccountResult{
				LoginIdentifier: result.LoginIdentifier,
				Success:         true,
				TemporaryPin:    result.TemporaryPIN,
				Id:              result.ID.String(),
			})
		}
	}

	slog.InfoContext(ctx, "BatchCreateOrgAccounts complete",
		"success", successCount,
		"failure", failureCount,
	)

	return connect.NewResponse(&v1.BatchCreateOrgAccountsResponse{
		Results:      results,
		SuccessCount: successCount,
		FailureCount: failureCount,
	}), nil
}

func (s *IAMServiceConnect) DeactivateOrgAccount(
	ctx context.Context,
	req *connect.Request[v1.DeactivateOrgAccountRequest],
) (*connect.Response[v1.DeactivateOrgAccountResponse], error) {
	actorID, orgID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	identityID, err := dbuuid.Parse(req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid id: %w", err))
	}

	slog.InfoContext(ctx, "DeactivateOrgAccount called", "org_id", orgID, "identity_id", identityID)

	err = txn.WithTxn(ctx, s.tenantPool, func(ctx context.Context, tx database.DBTX) error {
		if dErr := s.logic.DeactivateOrgAccount(ctx, tx, orgID, identityID); dErr != nil {
			return dErr
		}
		// Offboarding the ordinary way does what an outstanding removal request was
		// asking for, so the request is resolved as a side effect rather than left
		// sitting in the owner queue (Feature 036, spec edge case).
		if s.removalRequestResolver == nil {
			return nil
		}
		return s.removalRequestResolver.ResolveOutstandingRemovalRequests(ctx, tx, orgID, identityID, actorID)
	})
	if err != nil {
		slog.WarnContext(ctx, "DeactivateOrgAccount failed", "error", err)
		return nil, ToConnectError(err)
	}

	slog.InfoContext(ctx, "DeactivateOrgAccount success", "identity_id", identityID)
	return connect.NewResponse(&v1.DeactivateOrgAccountResponse{}), nil
}

func (s *IAMServiceConnect) UnlockOrgAccount(
	ctx context.Context,
	req *connect.Request[v1.UnlockOrgAccountRequest],
) (*connect.Response[v1.UnlockOrgAccountResponse], error) {
	_, orgID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	identityID, err := dbuuid.Parse(req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid id: %w", err))
	}

	slog.InfoContext(ctx, "UnlockOrgAccount called", "org_id", orgID, "identity_id", identityID)

	var tempPIN *string
	err = txn.WithTxn(ctx, s.tenantPool, func(ctx context.Context, tx database.DBTX) error {
		var unlockErr error
		tempPIN, unlockErr = s.logic.UnlockOrgAccount(ctx, tx, orgID, identityID, req.Msg.ResetPin)
		return unlockErr
	})
	if err != nil {
		slog.WarnContext(ctx, "UnlockOrgAccount failed", "error", err)
		return nil, ToConnectError(err)
	}

	resp := &v1.UnlockOrgAccountResponse{}
	if tempPIN != nil {
		resp.TemporaryPin = tempPIN
	}

	slog.InfoContext(ctx, "UnlockOrgAccount success", "identity_id", identityID)
	return connect.NewResponse(resp), nil
}

func (s *IAMServiceConnect) ResetOrgAccountCredential(
	ctx context.Context,
	req *connect.Request[v1.ResetOrgAccountCredentialRequest],
) (*connect.Response[v1.ResetOrgAccountCredentialResponse], error) {
	_, orgID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	identityID, err := dbuuid.Parse(req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid id: %w", err))
	}

	slog.InfoContext(ctx, "ResetOrgAccountCredential called", "org_id", orgID, "identity_id", identityID)

	var tempPIN string
	err = txn.WithTxn(ctx, s.tenantPool, func(ctx context.Context, tx database.DBTX) error {
		var resetErr error
		tempPIN, resetErr = s.logic.ResetOrgAccountCredential(ctx, tx, orgID, identityID)
		return resetErr
	})
	if err != nil {
		slog.WarnContext(ctx, "ResetOrgAccountCredential failed", "error", err)
		return nil, ToConnectError(err)
	}

	slog.InfoContext(ctx, "ResetOrgAccountCredential success", "identity_id", identityID)
	return connect.NewResponse(&v1.ResetOrgAccountCredentialResponse{
		TemporaryPin: tempPIN,
	}), nil
}

func (s *IAMServiceConnect) ListOrgAccounts(
	ctx context.Context,
	req *connect.Request[v1.ListOrgAccountsRequest],
) (*connect.Response[v1.ListOrgAccountsResponse], error) {
	_, orgID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	slog.InfoContext(ctx, "ListOrgAccounts called", "org_id", orgID)

	limit := req.Msg.Limit
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	var cursor *dbuuid.UUID
	if req.Msg.Cursor != nil && *req.Msg.Cursor != "" {
		c, parseErr := dbuuid.Parse(*req.Msg.Cursor)
		if parseErr != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid cursor: %w", parseErr))
		}
		cursor = &c
	}

	var rows []*OrgAccountRow
	var totalCount int32
	err = txn.WithTxn(ctx, s.tenantPool, func(ctx context.Context, tx database.DBTX) error {
		var listErr error
		rows, totalCount, listErr = s.logic.ListOrgAccounts(ctx, tx, orgID, cursor, int(limit), req.Msg.StatusFilter)
		return listErr
	})
	if err != nil {
		slog.WarnContext(ctx, "ListOrgAccounts failed", "error", err)
		return nil, ToConnectError(err)
	}

	accounts := make([]*v1.OrgAccountListItem, 0, len(rows))
	for _, row := range rows {
		item := &v1.OrgAccountListItem{
			Id:            row.ID.String(),
			DisplayName:   row.DisplayName.String,
			GivenName:     row.GivenName,
			FamilyName:    row.FamilyName,
			Status:        row.AccountStatus,
			PinConfigured: row.PinConfigured,
		}
		if row.LoginIdentifier.Valid {
			item.LoginIdentifier = row.LoginIdentifier.String
		}
		if row.CreatedAt.Valid {
			item.CreatedAt = row.CreatedAt.Time.Format(time.RFC3339)
		}
		if row.LastLoginAt.Valid {
			item.LastLoginAt = row.LastLoginAt.Time.Format(time.RFC3339)
		}
		accounts = append(accounts, item)
	}

	resp := &v1.ListOrgAccountsResponse{
		Accounts:   accounts,
		TotalCount: totalCount,
	}

	// Set next cursor if there are more results
	if len(rows) == int(limit) {
		lastID := rows[len(rows)-1].ID.String()
		resp.NextCursor = &lastID
	}

	return connect.NewResponse(resp), nil
}

// extractAuthContext extracts user ID and org ID from the auth context.
func extractAuthContext(ctx context.Context) (dbuuid.UUID, dbuuid.UUID, error) {
	userID, err := userIDFromContext(ctx)
	if err != nil {
		return dbuuid.UUID{}, dbuuid.UUID{}, err
	}

	orgIDStr, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok || orgIDStr == "" {
		return dbuuid.UUID{}, dbuuid.UUID{}, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("organization context required"))
	}

	orgID := dbuuid.MustParse(orgIDStr)
	return userID, orgID, nil
}
