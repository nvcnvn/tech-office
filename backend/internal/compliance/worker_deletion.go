package compliance

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/nvcnvn/flows"
	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/database/txn"
)

// WorkflowNameAccountDeletion identifies the background erase on the flows queue.
const WorkflowNameAccountDeletion = "compliance-account-deletion/v1"

// AccountDeletionInput identifies one organization's share of an erase.
type AccountDeletionInput struct {
	OrganizationID dbuuid.UUID `json:"organization_id"`
	DeletionID     dbuuid.UUID `json:"deletion_id"`
	UserID         dbuuid.UUID `json:"user_id"`
	EmployeeID     dbuuid.UUID `json:"employee_id"`
}

type AccountDeletionOutput struct {
	State            string `json:"state"`
	GlobalUserPurged bool   `json:"global_user_purged"`
}

// EnqueueAccountErase writes the resumable record for one organization and puts
// the work on the background queue, inside the caller's transaction so the record
// and the job commit together.
//
// Sessions are invalidated synchronously by the caller before this runs, so a
// backed-up queue cannot leave a deleted person still signed in (FR-003).
func (l *Logic) EnqueueAccountErase(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	trigger string,
) (*database.ComplianceAccountDeletion, error) {
	now := time.Now()
	record, err := l.Queries.CreateAccountDeletion(ctx, tx, &database.CreateAccountDeletionParams{
		OrganizationID: orgID,
		// iam.user.id, iam.identity.id and organization.employee.id are the same
		// UUID for a person (research.md R2), so the employee id is the user id.
		UserID:    employeeID,
		Trigger:   trigger,
		CreatedAt: nowTS(now),
	})
	if err != nil {
		return nil, fmt.Errorf("create account deletion record: %w", err)
	}

	if l.DeletionWorkflow != nil {
		if _, err := flows.BeginTx(ctx, l.FlowsClient, tx, l.DeletionWorkflow, &AccountDeletionInput{
			OrganizationID: orgID,
			DeletionID:     record.ID,
			UserID:         employeeID,
			EmployeeID:     employeeID,
		}); err != nil {
			return nil, fmt.Errorf("enqueue account deletion workflow: %w", err)
		}
	}
	return record, nil
}

// DeletionWorkflows holds the workflow this domain registers with the queue.
type DeletionWorkflows struct {
	AccountDeletion flows.Workflow[AccountDeletionInput, AccountDeletionOutput]
}

type accountDeletionWorkflow struct {
	logic     *Logic
	adminPool database.AdminDatabaseConnector
}

// NewDeletionWorkflows builds the background erase. It takes AdminPool rather than
// TenantPool: the final step deletes the global iam.user row, which is not
// tenant-scoped, and the worker runs with no request context to derive a tenant
// from (Constitution Principle I — documented AdminPool justification).
func NewDeletionWorkflows(logic *Logic, adminPool database.AdminDatabaseConnector) *DeletionWorkflows {
	return &DeletionWorkflows{
		AccountDeletion: &accountDeletionWorkflow{logic: logic, adminPool: adminPool},
	}
}

func (w *accountDeletionWorkflow) Name() string { return WorkflowNameAccountDeletion }

// Run advances one deletion record through anonymising -> purging -> done.
//
// Each step is idempotent, so a retry after a partial failure repeats work rather
// than skipping it: anonymising an already-anonymised employee is a no-op UPDATE,
// and deleting already-deleted identity rows deletes nothing. That is what makes
// "re-running the worker completes it" true without tracking sub-steps.
func (w *accountDeletionWorkflow) Run(
	ctx context.Context,
	wf *flows.Context,
	input *AccountDeletionInput,
) (*AccountDeletionOutput, error) {
	if _, err := flows.Execute(ctx, wf, "anonymise-employee/v1", w.anonymise, input, flows.RetryPolicy{}); err != nil {
		w.markFailed(ctx, input, DeletionStateAnonymising, err)
		return nil, err
	}

	purged, err := flows.Execute(ctx, wf, "purge-identity/v1", w.purge, input, flows.RetryPolicy{})
	if err != nil {
		w.markFailed(ctx, input, DeletionStatePurging, err)
		return nil, err
	}

	w.advance(ctx, input, DeletionStateDone, nil)
	slog.InfoContext(ctx, "account erase complete",
		"deletion_id", input.DeletionID.String(),
		"organization_id", input.OrganizationID.String(),
		"global_user_purged", purged.GlobalUserPurged,
	)
	return &AccountDeletionOutput{State: DeletionStateDone, GlobalUserPurged: purged.GlobalUserPurged}, nil
}

func (w *accountDeletionWorkflow) anonymise(ctx context.Context, in *AccountDeletionInput) (*AccountDeletionOutput, error) {
	w.advance(ctx, in, DeletionStateAnonymising, nil)
	if err := txn.WithTxn(ctx, w.adminPool, func(ctx context.Context, tx database.DBTX) error {
		return w.logic.Eraser.AnonymiseEmployee(ctx, tx, in.OrganizationID, in.EmployeeID)
	}); err != nil {
		return nil, fmt.Errorf("anonymise employee: %w", err)
	}
	return &AccountDeletionOutput{State: DeletionStateAnonymising}, nil
}

func (w *accountDeletionWorkflow) purge(ctx context.Context, in *AccountDeletionInput) (*AccountDeletionOutput, error) {
	w.advance(ctx, in, DeletionStatePurging, nil)
	if err := txn.WithTxn(ctx, w.adminPool, func(ctx context.Context, tx database.DBTX) error {
		return w.logic.Eraser.PurgeOrgIdentity(ctx, tx, in.OrganizationID, in.EmployeeID)
	}); err != nil {
		return nil, fmt.Errorf("purge org identity: %w", err)
	}

	// Whichever organization purges last finds no identity rows left anywhere and
	// destroys the global record. No marker column is needed, and two workers
	// racing here both simply find nothing to delete on the second pass.
	globalPurged, err := w.logic.Eraser.PurgeGlobalUserIfLastMembership(ctx, in.UserID)
	if err != nil {
		return nil, fmt.Errorf("purge global user: %w", err)
	}
	return &AccountDeletionOutput{State: DeletionStatePurging, GlobalUserPurged: globalPurged}, nil
}

// advance records the state the record has reached. A failure to record it is
// logged rather than returned: losing the breadcrumb must not abort the erase.
func (w *accountDeletionWorkflow) advance(ctx context.Context, in *AccountDeletionInput, state string, cause error) {
	params := &database.AdvanceAccountDeletionStateParams{
		OrganizationID: in.OrganizationID,
		ID:             in.DeletionID,
		State:          state,
		UpdatedAt:      nowTS(time.Now()),
	}
	if cause != nil {
		params.FailureReason = nullText(cause.Error())
	}
	if err := txn.WithTxn(ctx, w.adminPool, func(ctx context.Context, tx database.DBTX) error {
		_, advErr := w.logic.Queries.AdvanceAccountDeletionState(ctx, tx, params)
		return advErr
	}); err != nil {
		slog.ErrorContext(ctx, "failed to record account deletion state",
			"deletion_id", in.DeletionID.String(),
			"state", state,
			"error", err,
		)
	}
}

// markFailed leaves the record in 'failed' with the reason attached. The step it
// was on is recoverable by re-running the workflow, because every step is
// idempotent.
func (w *accountDeletionWorkflow) markFailed(ctx context.Context, in *AccountDeletionInput, during string, cause error) {
	slog.ErrorContext(ctx, "account erase failed",
		"deletion_id", in.DeletionID.String(),
		"during", during,
		"error", cause,
	)
	w.advance(ctx, in, DeletionStateFailed, cause)
}
