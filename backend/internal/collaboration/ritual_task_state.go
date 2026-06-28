package collaboration

import (
	"context"
	"fmt"
	"time"

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

func (l *logicImpl) reconcileRitualTaskState(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	taskID dbuuid.UUID,
) error {
	task, err := l.Queries.GetTask(ctx, tx, &database.GetTaskParams{
		OrganizationID: orgID,
		ID:             taskID,
	})
	if err != nil {
		return fmt.Errorf("failed to get ritual task for state reconciliation: %w", err)
	}

	return l.reconcileRitualTaskStateForTask(ctx, tx, orgID, task)
}

func (l *logicImpl) reconcileRitualTaskStateForTask(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	task *database.CollaborationTask,
) error {
	if task.TaskKind != TaskKindRitualInstance || task.DetachedFromRitual {
		return nil
	}

	states, err := l.Queries.ListProjectStates(ctx, tx, &database.ListProjectStatesParams{
		OrganizationID: orgID,
		ProjectID:      dbuuid.UUID(task.ProjectID),
	})
	if err != nil {
		return fmt.Errorf("failed to list ritual project states: %w", err)
	}

	currentState := findProjectStateByID(states, dbuuid.UUID(task.StateID))
	if currentState == nil {
		return nil
	}

	if currentState.Category == StateCategoryVerified || currentState.Category == StateCategoryMissed || currentState.Category == StateCategorySkipped {
		return nil
	}

	snapshot, err := l.loadTaskEvidenceSnapshot(ctx, tx, orgID, task)
	if err != nil {
		return err
	}

	targetCategory := determineRitualTaskStateCategory(task, snapshot, time.Now())
	if targetCategory == "" || targetCategory == currentState.Category {
		return nil
	}

	targetState := findProjectStateByCategory(states, targetCategory)
	if targetState == nil {
		return nil
	}

	_, err = l.Queries.UpdateTaskState(ctx, tx, &database.UpdateTaskStateParams{
		OrganizationID: orgID,
		ID:             task.ID,
		StateID:        dbuuid.UUID(targetState.ID),
		UpdatedAt:      pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
	if err != nil {
		return fmt.Errorf("failed to update ritual task state: %w", err)
	}

	return nil
}

func determineRitualTaskStateCategory(
	task *database.CollaborationTask,
	snapshot *taskEvidenceSnapshot,
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

	if snapshot.progress.SubmittedCount > 0 {
		return StateCategoryInProgress
	}

	if task.CompletionDeadline.Valid && task.CompletionDeadline.Time.Before(now) {
		return StateCategoryOverdue
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
