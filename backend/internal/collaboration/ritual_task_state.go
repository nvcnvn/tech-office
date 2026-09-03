package collaboration

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

type taskEvidenceSnapshot struct {
	progress               *rpcv1.TaskEvidenceProgress
	requiredCount          int32
	requiredSubmittedCount int32
	requiredApprovedCount  int32
	requiredRejectedCount  int32
}

func (l *logicImpl) loadTaskEvidenceSnapshot(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	task *database.CollaborationTask,
) (*taskEvidenceSnapshot, error) {
	if task.TaskKind != TaskKindRitualInstance || !task.RitualDefinitionID.Valid {
		return &taskEvidenceSnapshot{progress: &rpcv1.TaskEvidenceProgress{}}, nil
	}

	requirements, err := l.Queries.ListEvidenceRequirements(ctx, tx, &database.ListEvidenceRequirementsParams{
		OrganizationID:     orgID,
		RitualDefinitionID: dbuuid.UUID(task.RitualDefinitionID.UUID),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list evidence requirements: %w", err)
	}

	submissions, err := l.Queries.ListEvidenceSubmissions(ctx, tx, &database.ListEvidenceSubmissionsParams{
		OrganizationID: orgID,
		TaskID:         task.ID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list evidence submissions: %w", err)
	}

	latestByRequirementID := make(map[dbuuid.UUID]*database.CollaborationEvidenceSubmission, len(requirements))
	for _, submission := range submissions {
		latestByRequirementID[submission.EvidenceRequirementID] = submission
	}

	snapshot := &taskEvidenceSnapshot{
		progress: &rpcv1.TaskEvidenceProgress{
			TotalRequirements: int32(len(requirements)),
		},
	}

	for _, requirement := range requirements {
		requirementID := dbuuid.UUID(requirement.ID)
		latestSubmission := latestByRequirementID[requirementID]

		if requirement.IsRequired {
			snapshot.requiredCount++
			snapshot.progress.RequiredCount++
		}

		if latestSubmission == nil {
			continue
		}

		snapshot.progress.SubmittedCount++
		if requirement.IsRequired {
			snapshot.requiredSubmittedCount++
		}

		switch latestSubmission.ApprovalStatus {
		case ApprovalStatusApproved:
			snapshot.progress.ApprovedCount++
			if requirement.IsRequired {
				snapshot.requiredApprovedCount++
			}
		case ApprovalStatusRejected:
			snapshot.progress.RejectedCount++
			if requirement.IsRequired {
				snapshot.requiredRejectedCount++
			}
		case ApprovalStatusPendingReview:
			snapshot.progress.PendingReviewCount++
		}
	}

	snapshot.progress.AllRequiredApproved = snapshot.requiredCount == 0 || snapshot.requiredApprovedCount == snapshot.requiredCount

	return snapshot, nil
}

// ritualStateOutcome reports what reconcileRitualTaskStateForTask actually did, so a caller
// sweeping many instances can count transitions without re-reading every row.
type ritualStateOutcome struct {
	Changed bool
	From    string // state category before
	To      string // state category after
}

func (l *logicImpl) reconcileRitualTaskState(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	taskID dbuuid.UUID,
	now time.Time,
) error {
	task, err := l.Queries.GetTask(ctx, tx, &database.GetTaskParams{
		OrganizationID: orgID,
		ID:             taskID,
	})
	if err != nil {
		return fmt.Errorf("failed to get ritual task for state reconciliation: %w", err)
	}

	_, err = l.reconcileRitualTaskStateForTask(ctx, tx, orgID, task, now)
	return err
}

// reconcileRitualTaskStateForTask is the single writer of ritual instance state. The
// evidence path (submit/approve/reject) and the reconciliation sweep both go through it,
// which is why an instance's state never depends on which path last touched it (FR-007),
// and why the overdue/missed notification is published here rather than at either call
// site (FR-020).
func (l *logicImpl) reconcileRitualTaskStateForTask(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	task *database.CollaborationTask,
	now time.Time,
) (ritualStateOutcome, error) {
	if task.TaskKind != TaskKindRitualInstance || task.DetachedFromRitual {
		return ritualStateOutcome{}, nil
	}

	states, err := l.Queries.ListProjectStates(ctx, tx, &database.ListProjectStatesParams{
		OrganizationID: orgID,
		ProjectID:      dbuuid.UUID(task.ProjectID),
	})
	if err != nil {
		return ritualStateOutcome{}, fmt.Errorf("failed to list ritual project states: %w", err)
	}

	currentState := findProjectStateByID(states, dbuuid.UUID(task.StateID))
	if currentState == nil {
		return ritualStateOutcome{}, nil
	}

	// verified, missed and skipped are terminal: nothing automatic moves an instance out
	// of them, which is also what stops a missed instance being re-notified (FR-003).
	if currentState.Category == StateCategoryVerified || currentState.Category == StateCategoryMissed || currentState.Category == StateCategorySkipped {
		return ritualStateOutcome{}, nil
	}

	snapshot, err := l.loadTaskEvidenceSnapshot(ctx, tx, orgID, task)
	if err != nil {
		return ritualStateOutcome{}, err
	}

	graceWindow, ritualName := l.ritualLatenessContext(ctx, tx, orgID, task)

	targetCategory := determineRitualTaskStateCategory(task, snapshot, graceWindow, now)
	if targetCategory == "" || targetCategory == currentState.Category {
		return ritualStateOutcome{}, nil
	}

	targetState := findProjectStateByCategory(states, targetCategory)
	if targetState == nil {
		// A project whose ritual states were never seeded, or were deleted, cannot hold
		// the instance's correct state. Leaving it where it is is the safe outcome, but
		// silence here is what made this class of breakage invisible before.
		slog.WarnContext(ctx, "ritual reconciliation: project has no state for target category",
			"orgID", orgID,
			"projectID", dbuuid.UUID(task.ProjectID),
			"taskID", task.ID,
			"targetCategory", targetCategory,
		)
		return ritualStateOutcome{}, nil
	}

	// Compare-and-set on the state we decided from. Two overlapping passes can both read
	// the row before either writes; the predicate makes the loser match zero rows, so it
	// neither rewrites the state nor publishes a duplicate notification.
	_, err = l.Queries.UpdateRitualTaskStateIfUnchanged(ctx, tx, &database.UpdateRitualTaskStateIfUnchangedParams{
		OrganizationID:  orgID,
		ID:              task.ID,
		StateID:         dbuuid.UUID(targetState.ID),
		ExpectedStateID: dbuuid.UUID(task.StateID),
		UpdatedAt:       pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Another pass got there first. Its transition is the one that counts.
			return ritualStateOutcome{}, nil
		}
		return ritualStateOutcome{}, fmt.Errorf("failed to update ritual task state: %w", err)
	}

	outcome := ritualStateOutcome{Changed: true, From: currentState.Category, To: targetCategory}

	l.notifyRitualLatenessTransition(ctx, tx, orgID, task, ritualName, outcome, now)

	return outcome, nil
}

// ritualLatenessContext resolves the two things the lateness rules need from the instance's
// ritual definition: the grace window between overdue and missed, and the definition name
// used in the notification body.
//
// A definition that cannot be loaded yields a zero grace window, which makes the "missed"
// row of the precedence table unreachable while leaving "overdue" live — an instance whose
// definition has gone missing can still be flagged late, but is never silently written into
// a terminal state on incomplete information.
func (l *logicImpl) ritualLatenessContext(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	task *database.CollaborationTask,
) (graceWindow time.Duration, ritualName string) {
	ritualName = task.Title

	if !task.RitualDefinitionID.Valid {
		return 0, ritualName
	}

	def, err := l.Queries.GetRitualDefinition(ctx, tx, &database.GetRitualDefinitionParams{
		OrganizationID: orgID,
		ID:             dbuuid.UUID(task.RitualDefinitionID.UUID),
	})
	if err != nil {
		slog.WarnContext(ctx, "ritual reconciliation: failed to load definition for grace window",
			"error", err,
			"orgID", orgID,
			"taskID", task.ID,
			"ritualDefinitionID", dbuuid.UUID(task.RitualDefinitionID.UUID),
		)
		return 0, ritualName
	}

	if def.Name != "" {
		ritualName = def.Name
	}

	return time.Duration(def.CompletionWindowHours) * time.Hour, ritualName
}

// determineRitualTaskStateCategory is the single authority on what state a ritual instance
// belongs in. Both the evidence path and the reconciliation sweep call it, which is what
// makes an instance's state independent of which path last touched it (FR-007).
//
// The precedence is deliberate and order-sensitive:
//
//  1. verified     all required evidence approved; nothing outranks a finished ritual
//  2. submitted    all required evidence in and none rejected; the reviewer owes the
//     next move, so lateness is not the worker's fault
//  3. missed       the deadline and the whole grace window elapsed, evidence incomplete
//  4. overdue      the deadline elapsed, evidence incomplete
//  5. in_progress  some evidence submitted, deadline not yet passed. This sits BELOW
//     rows 3 and 4 (FR-006): partial progress does not hide lateness.
//  6. scheduled    the instance is for a future day
//  7. todo         everything else
//
// graceWindow is the definition's completion_window_hours. A zero or negative graceWindow
// means "no grace period is known" — row 3 becomes unreachable while row 4 stays live, so an
// unloadable definition can make an instance overdue but never silently terminal.
// A NULL completion_deadline makes both rows unreachable: no deadline means never late (FR-005).
func determineRitualTaskStateCategory(
	task *database.CollaborationTask,
	snapshot *taskEvidenceSnapshot,
	graceWindow time.Duration,
	now time.Time,
) string {
	if snapshot == nil || snapshot.progress == nil {
		return ""
	}

	if snapshot.progress.AllRequiredApproved {
		return StateCategoryVerified
	}

	if snapshot.requiredCount > 0 && snapshot.requiredSubmittedCount == snapshot.requiredCount && snapshot.requiredRejectedCount == 0 {
		return StateCategorySubmitted
	}

	if task.CompletionDeadline.Valid {
		deadline := task.CompletionDeadline.Time
		if graceWindow > 0 && now.After(deadline.Add(graceWindow)) {
			return StateCategoryMissed
		}
		if now.After(deadline) {
			return StateCategoryOverdue
		}
	}

	if snapshot.progress.SubmittedCount > 0 {
		return StateCategoryInProgress
	}

	if task.ScheduledDate.Valid {
		today := startOfOverviewDay(now)
		scheduledDay := startOfOverviewDay(task.ScheduledDate.Time)
		if scheduledDay.After(today) {
			return StateCategoryScheduled
		}
	}

	return StateCategoryTodo
}

// shouldSuppressRitualLatenessNotification decides whether a lateness transition happens
// quietly. It answers "is this instance older than we are willing to shout about", and the
// question is asked of the stored completion_deadline, never of how long ago the state
// changed — so the answer is deterministic and a repeated pass cannot flip it (FR-021).
//
// Without this, the first deployment of the sweep would alert every worker about every
// historical instance at once, and the alert would be muted before it ever did its job.
func shouldSuppressRitualLatenessNotification(task *database.CollaborationTask, now time.Time) bool {
	if !task.CompletionDeadline.Valid {
		return false
	}
	return now.Sub(task.CompletionDeadline.Time) > ritualReconciliationBackfillHorizon
}

// notifyRitualLatenessTransition publishes the notification for a transition that
// reconcileRitualTaskStateForTask has just performed — and only for one it performed.
//
// This lives inside the writer rather than at its call sites so a transition caused by an
// evidence write and one caused by the sweep notify identically (FR-020). An instance
// already in the target state never reaches here, because the caller returns before
// writing, which is what makes repeated passes silent (FR-010).
func (l *logicImpl) notifyRitualLatenessTransition(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	task *database.CollaborationTask,
	ritualName string,
	outcome ritualStateOutcome,
	now time.Time,
) {
	if !outcome.Changed {
		return
	}
	if outcome.To != StateCategoryOverdue && outcome.To != StateCategoryMissed {
		return
	}

	if shouldSuppressRitualLatenessNotification(task, now) {
		slog.InfoContext(ctx, "ritual reconciliation: lateness notification suppressed by backfill horizon",
			"orgID", orgID,
			"taskID", task.ID,
			"from", outcome.From,
			"to", outcome.To,
		)
		return
	}

	switch outcome.To {
	case StateCategoryOverdue:
		l.notifyRitualInstanceOverdue(ctx, tx, orgID, task, ritualName, now)
	case StateCategoryMissed:
		l.notifyRitualInstanceMissed(ctx, tx, orgID, task, ritualName, now)
	}
}

func findProjectStateByID(states []*database.CollaborationProjectState, stateID dbuuid.UUID) *database.CollaborationProjectState {
	for _, state := range states {
		if dbuuid.UUID(state.ID) == stateID {
			return state
		}
	}

	return nil
}

func findProjectStateByCategory(states []*database.CollaborationProjectState, category string) *database.CollaborationProjectState {
	for _, state := range states {
		if state.Category == category {
			return state
		}
	}

	return nil
}
