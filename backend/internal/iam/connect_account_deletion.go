package iam

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"connectrpc.com/connect"
	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/database/txn"
	v1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// EraseEnqueuer is the slice of the compliance domain this handler needs: it
// writes the resumable deletion record and puts the erase on the background queue.
// Declared here as an interface so internal/iam keeps no dependency on
// internal/compliance.
type EraseEnqueuer interface {
	EnqueueAccountErase(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, trigger string) (*database.ComplianceAccountDeletion, error)
}

// TriggerSelfService mirrors compliance.DeletionTriggerSelfService. It is repeated
// rather than imported for the same reason EraseEnqueuer is declared locally.
const TriggerSelfService = "self_service"

// SetEraseEnqueuer wires the compliance domain in. Deletion is refused outright
// while it is unset, rather than half-performed.
func (s *IAMServiceConnect) SetEraseEnqueuer(e EraseEnqueuer) { s.eraseEnqueuer = e }

// SetAccountDeleter wires the erase operations in.
func (s *IAMServiceConnect) SetAccountDeleter(d *AccountDeleter) { s.accountDeleter = d }

// erasedCategories and retainedCategories are assembled on the server so mobile
// and web cannot drift into describing different behaviour (FR-002). The retained
// list is not a disclaimer bolted on: it describes the tombstone honestly.
func erasedCategories() []*v1.DeletionCategory {
	return []*v1.DeletionCategory{
		{Label: "Your name, email address and contact details"},
		{Label: "Your date of birth, phone number and home address"},
		{Label: "Your sign-in credentials, including any PIN or linked sign-in provider"},
		{Label: "Your sessions on every device"},
		{Label: "Your personal settings and preferences"},
	}
}

func retainedCategories() []*v1.DeletionCategory {
	return []*v1.DeletionCategory{
		{
			Label:  "Messages you sent in a workspace",
			Reason: "They are part of that workspace's record of its own work. They stay readable but no longer carry your name.",
		},
		{
			Label:  "Files you uploaded and documents you wrote",
			Reason: "Same reason: the workspace keeps its business records, de-identified.",
		},
		{
			Label:  "Tasks you were assigned or completed",
			Reason: "Removing them would leave gaps in the workspace's history. They are attributed to nobody instead.",
		},
		{
			Label:  "Reports filed about content you posted",
			Reason: "A report has to stay reviewable after its subject is gone, otherwise deleting an account would erase the evidence.",
		},
	}
}

// GetAccountDeletionPreview states what deletion does before anyone confirms it.
func (s *IAMServiceConnect) GetAccountDeletionPreview(
	ctx context.Context,
	_ *connect.Request[v1.GetAccountDeletionPreviewRequest],
) (*connect.Response[v1.GetAccountDeletionPreviewResponse], error) {
	userID, err := userIDFromContext(ctx)
	if err != nil {
		return nil, err
	}
	if s.accountDeleter == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, fmt.Errorf("account deletion is not configured"))
	}

	affected, err := s.accountDeleter.SurveyOrganizations(ctx, userID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	orgs := make([]*v1.AffectedOrganization, len(affected))
	blocked := false
	for i, org := range affected {
		orgs[i] = &v1.AffectedOrganization{
			OrganizationId:   org.OrganizationID.String(),
			OrganizationName: org.OrganizationName,
			MemberCount:      org.MemberCount,
			BlocksDeletion:   org.BlocksDeletion,
		}
		blocked = blocked || org.BlocksDeletion
	}

	return connect.NewResponse(&v1.GetAccountDeletionPreviewResponse{
		Erased:             erasedCategories(),
		Retained:           retainedCategories(),
		Organizations:      orgs,
		Blocked:            blocked,
		ConfirmationPhrase: DeletionConfirmationPhrase,
	}), nil
}

// DeleteMyAccount erases this person's account.
//
// Order matters: refuse first, then invalidate sessions synchronously, then queue
// the erase. Signing out is cheap and must happen even if the queue is backed up
// (FR-003); the erase itself touches one employee row per organization plus a
// global cascade, which is not work to do inside a request (research.md R3).
func (s *IAMServiceConnect) DeleteMyAccount(
	ctx context.Context,
	req *connect.Request[v1.DeleteMyAccountRequest],
) (*connect.Response[v1.DeleteMyAccountResponse], error) {
	userID, err := userIDFromContext(ctx)
	if err != nil {
		return nil, err
	}
	if s.accountDeleter == nil || s.eraseEnqueuer == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, fmt.Errorf("account deletion is not configured"))
	}

	if !strings.EqualFold(strings.TrimSpace(req.Msg.GetConfirmationPhrase()), DeletionConfirmationPhrase) {
		return nil, connect.NewError(connect.CodeInvalidArgument, ErrConfirmationPhraseMismatch)
	}

	// 1. An admin-provisioned worker did not create this account, and the workplace
	//    content in it is their employer's record. Their path is a removal request
	//    that an owner acts on (FR-007a).
	var orgManaged bool
	if err := txn.WithTxn(ctx, s.adminPool, func(ctx context.Context, tx database.DBTX) error {
		var mErr error
		orgManaged, mErr = s.accountDeleter.IsOrgManaged(ctx, tx, userID)
		return mErr
	}); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if orgManaged {
		return nil, connect.NewError(connect.CodeFailedPrecondition, ErrOrgManagedCannotSelfDelete)
	}

	// 2. Refuse rather than strand a workspace without an owner, and say which ones
	//    so the client can offer transfer-or-close for each (FR-005).
	blocking, err := s.accountDeleter.IsSoleOwnerOfPopulatedOrg(ctx, userID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if len(blocking) > 0 {
		return nil, soleOwnerBlocksDeletionError(blocking)
	}

	orgIDs, err := s.accountDeleter.ListMemberships(ctx, userID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// 3. Sign out everywhere, and queue one erase per organization, in one
	//    transaction so a crash between the two cannot leave a signed-out person
	//    whose data is never erased.
	var firstDeletionID string
	if err := txn.WithTxn(ctx, s.adminPool, func(ctx context.Context, tx database.DBTX) error {
		if sErr := s.accountDeleter.InvalidateAllSessions(ctx, tx, userID); sErr != nil {
			return sErr
		}
		for _, orgID := range orgIDs {
			record, eErr := s.eraseEnqueuer.EnqueueAccountErase(ctx, tx, orgID, userID, TriggerSelfService)
			if eErr != nil {
				return eErr
			}
			if firstDeletionID == "" {
				firstDeletionID = record.ID.String()
			}
		}
		return nil
	}); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	slog.InfoContext(ctx, "account deletion requested",
		"user_id", userID.String(),
		"organizations", len(orgIDs),
	)

	return connect.NewResponse(&v1.DeleteMyAccountResponse{
		DeletionId: firstDeletionID,
		State:      v1.AccountDeletionState_ACCOUNT_DELETION_STATE_PENDING,
	}), nil
}

// soleOwnerBlocksDeletionError attaches the structured detail so the client can
// list the blocking workspaces and link to transfer-or-close for each, rather than
// rendering one unhelpful sentence (Constitution Principle X).
func soleOwnerBlocksDeletionError(blocking []BlockingOrganization) *connect.Error {
	domainErr := &ErrSoleOwnerBlocksDeletion{Organizations: blocking}
	cErr := connect.NewError(connect.CodeFailedPrecondition, domainErr)

	detail := &v1.SoleOwnerBlocksDeletion{
		Organizations: make([]*v1.BlockingOrganization, len(blocking)),
	}
	for i, org := range blocking {
		detail.Organizations[i] = &v1.BlockingOrganization{
			OrganizationId:   org.OrganizationID.String(),
			OrganizationName: org.OrganizationName,
			MemberCount:      org.MemberCount,
		}
	}
	if d, dErr := connect.NewErrorDetail(detail); dErr == nil {
		cErr.AddDetail(d)
	}
	return cErr
}

// RemovalRequestResolver closes an outstanding removal request when an
// administrator offboards the worker by the ordinary route. Declared here as an
// interface for the same reason as EraseEnqueuer.
type RemovalRequestResolver interface {
	ResolveOutstandingRemovalRequests(ctx context.Context, tx database.DBTX, orgID, employeeID, actorID dbuuid.UUID) error
}

// SetRemovalRequestResolver wires the compliance domain in.
func (s *IAMServiceConnect) SetRemovalRequestResolver(r RemovalRequestResolver) {
	s.removalRequestResolver = r
}
