package iam

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/txn"
	v1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
	"time"
)

// CurrentTermsVersion is the single definition of which terms are being served.
//
// Constitution Principle VIII: the same string appears in
// frontend/packages/apis/src/legal.ts and is rendered on /terms and /privacy.
// Bumping it makes every stored acceptance stale, which is the re-prompt trigger —
// so bump it only when the text people agreed to has actually changed (R9).
const CurrentTermsVersion = "2026-08-27"

// ErrStaleTermsVersion is returned when a client offers a version that is not the
// one being served, so a stale build cannot record acceptance of terms nobody is
// showing.
var ErrStaleTermsVersion = errors.New("those are not the terms currently in force; please reload and read the current version")

// AcceptTerms records this person's acceptance of the current terms.
func (s *IAMServiceConnect) AcceptTerms(
	ctx context.Context,
	req *connect.Request[v1.AcceptTermsRequest],
) (*connect.Response[v1.AcceptTermsResponse], error) {
	userID, err := userIDFromContext(ctx)
	if err != nil {
		return nil, err
	}
	if req.Msg.GetTermsVersion() != CurrentTermsVersion {
		return nil, connect.NewError(connect.CodeFailedPrecondition, ErrStaleTermsVersion)
	}

	acceptedAt := time.Now()
	if err := txn.WithTxn(ctx, s.adminPool, func(ctx context.Context, tx database.DBTX) error {
		_, aErr := database.New().AcceptTerms(ctx, tx, &database.AcceptTermsParams{
			ID:                   userID,
			TermsVersionAccepted: pgtype.Text{String: CurrentTermsVersion, Valid: true},
			TermsAcceptedAt:      pgtype.Timestamptz{Time: acceptedAt, Valid: true},
		})
		return aErr
	}); err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("record terms acceptance: %w", err))
	}

	return connect.NewResponse(&v1.AcceptTermsResponse{
		AcceptedAt: timestamppb.New(acceptedAt),
	}), nil
}

// GetTermsStatus reports the current version and whether this person has accepted
// it. Admin-provisioned workers never saw a signup screen, so gating first use on
// this is the only way acceptance can hold for accounts an administrator created
// (FR-012).
func (s *IAMServiceConnect) GetTermsStatus(
	ctx context.Context,
	_ *connect.Request[v1.GetTermsStatusRequest],
) (*connect.Response[v1.GetTermsStatusResponse], error) {
	userID, err := userIDFromContext(ctx)
	if err != nil {
		return nil, err
	}

	resp := &v1.GetTermsStatusResponse{CurrentVersion: CurrentTermsVersion}
	if err := txn.WithTxn(ctx, s.adminPool, func(ctx context.Context, tx database.DBTX) error {
		row, gErr := database.New().GetTermsAcceptance(ctx, tx, userID)
		if gErr != nil {
			return gErr
		}
		resp.AcceptedVersion = row.TermsVersionAccepted.String
		if row.TermsAcceptedAt.Valid {
			resp.AcceptedAt = timestamppb.New(row.TermsAcceptedAt.Time)
		}
		resp.IsCurrent = row.TermsVersionAccepted.Valid && row.TermsVersionAccepted.String == CurrentTermsVersion
		return nil
	}); err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("read terms status: %w", err))
	}
	return connect.NewResponse(resp), nil
}

// ValidateAcceptedTermsVersion rejects a signup or invitation acceptance that does
// not acknowledge the current terms (FR-010). Callers pass the value straight from
// the request.
func ValidateAcceptedTermsVersion(version string) error {
	if version == "" {
		return fmt.Errorf("%w: the terms must be accepted to create an account", ErrStaleTermsVersion)
	}
	if version != CurrentTermsVersion {
		return ErrStaleTermsVersion
	}
	return nil
}
