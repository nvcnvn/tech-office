package collaboration

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/notification"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// AssignTask assigns an employee to a task and sends a task_assigned notification.
func (l *logicImpl) AssignTask(
	ctx context.Context,
	tx database.DBTX,
	orgID, assignedByID dbuuid.UUID,
	taskID, employeeID dbuuid.UUID,
	role string,
) (*rpcv1.TaskAssignee, error) {
	return l.doAssignTask(ctx, tx, orgID, assignedByID, taskID, employeeID, role, true)
}

// assignTaskSilent assigns an employee to a task without sending a task_assigned notification.
// Used by the scheduler so that per-instance notifications are suppressed in favour of a
// single post-loop summary notification (ritual_instances_scheduled).
func (l *logicImpl) assignTaskSilent(
	ctx context.Context,
	tx database.DBTX,
	orgID, assignedByID dbuuid.UUID,
	taskID, employeeID dbuuid.UUID,
	role string,
) (*rpcv1.TaskAssignee, error) {
	return l.doAssignTask(ctx, tx, orgID, assignedByID, taskID, employeeID, role, false)
}

// doAssignTask is the shared implementation for AssignTask and assignTaskSilent.
func (l *logicImpl) doAssignTask(
	ctx context.Context,
	tx database.DBTX,
	orgID, assignedByID dbuuid.UUID,
	taskID, employeeID dbuuid.UUID,
	role string,
	notify bool,
) (*rpcv1.TaskAssignee, error) {
	slog.DebugContext(ctx, "AssignTask",
		"taskID", taskID,
		"employeeID", employeeID,
		"role", role,
	)

	// Validate role
	if !IsValidTaskAssigneeRole(role) {
		return nil, ErrInvalidAssigneeRole
	}

	// Check if task exists
	task, err := l.Queries.GetTask(ctx, tx, &database.GetTaskParams{
		OrganizationID: orgID,
		ID:             taskID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrTaskNotFound
		}
		return nil, fmt.Errorf("failed to get task: %w", err)
	}

	// Check if already assigned with same role
	existingAssignees, err := l.Queries.ListTaskAssignees(ctx, tx, &database.ListTaskAssigneesParams{
		OrganizationID: orgID,
		TaskID:         taskID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to check existing assignments: %w", err)
	}
	for _, existing := range existingAssignees {
		if existing.EmployeeID == employeeID && existing.Role == role {
			if _, err := l.upsertTaskResourceSubscription(ctx, tx, orgID, taskID, employeeID, notification.ResourceSubscriptionStateActive); err != nil {
				return nil, fmt.Errorf("failed to sync task assignee subscription: %w", err)
			}
			if err := l.syncTaskResourceSubscriptionReason(ctx, tx, orgID, taskID, employeeID, notification.ResourceSubscriptionReasonAssignee, false); err != nil {
				return nil, fmt.Errorf("failed to sync task assignee reason: %w", err)
			}
			// Already exists, return existing
			return &rpcv1.TaskAssignee{
				EmployeeId: existing.EmployeeID.String(),
				Role:       stringToAssigneeRoleProto(existing.Role),
				AssignedAt: timestamppb.New(existing.AssignedAt.Time),
			}, nil
		}
	}

	// Create assignment
	assignee, err := l.Queries.CreateTaskAssignee(ctx, tx, &database.CreateTaskAssigneeParams{
		ID:                   dbuuid.Must(),
		OrganizationID:       orgID,
		TaskID:               taskID,
		EmployeeID:           employeeID,
		Role:                 role,
		AssignedByEmployeeID: assignedByID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create task assignee",
			"error", err,
		)
		return nil, fmt.Errorf("failed to assign task: %w", err)
	}

	// Auto-watch task
	err = l.createTaskWatcher(ctx, tx, orgID, taskID, employeeID, TaskWatchReasonAssigned)
	if err != nil {
		slog.WarnContext(ctx, "failed to add assignee as watcher",
			"error", err,
		)
	}

	// Auto-enroll assignee in task channel membership so it appears in their chat sidebar.
	if task.ChannelID.Valid {
		if err := l.Queries.EnsureChannelMembership(ctx, tx, &database.EnsureChannelMembershipParams{
			OrganizationID: orgID,
			ChannelID:      dbuuid.UUID(task.ChannelID.UUID),
			EmployeeID:     employeeID,
		}); err != nil {
			slog.WarnContext(ctx, "failed to enroll task assignee in channel membership",
				"error", err, "taskID", taskID, "employeeID", employeeID,
			)
		}
	}

	// Notify the assignee (if different from assigner) — skipped during bulk scheduler generation
	// so that the caller can send a single summary notification instead.
	if notify && employeeID != assignedByID {
		l.notifyTaskWatchers(ctx, tx, orgID, taskID, assignedByID,
			NotificationTypeTaskAssigned, 0, false,
			fmt.Sprintf("You were assigned to task %s", task.Identifier),
			fmt.Sprintf("You have been assigned to task %s", task.Identifier),
		)
	}

	slog.InfoContext(ctx, "task assigned successfully",
		"taskID", taskID,
		"employeeID", employeeID,
		"role", role,
	)

	return &rpcv1.TaskAssignee{
		EmployeeId: assignee.EmployeeID.String(),
		Role:       stringToAssigneeRoleProto(assignee.Role),
		AssignedAt: timestamppb.New(assignee.AssignedAt.Time),
	}, nil
}

// UnassignTask removes an employee from a task
func (l *logicImpl) UnassignTask(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	taskID, employeeID dbuuid.UUID,
	role string,
) error {
	slog.DebugContext(ctx, "UnassignTask",
		"taskID", taskID,
		"employeeID", employeeID,
		"role", role,
	)

	// Validate role
	if !IsValidTaskAssigneeRole(role) {
		return ErrInvalidAssigneeRole
	}

	// Delete assignment
	err := l.Queries.DeleteTaskAssignee(ctx, tx, &database.DeleteTaskAssigneeParams{
		OrganizationID: orgID,
		TaskID:         taskID,
		EmployeeID:     employeeID,
		Role:           pgtype.Text{String: role, Valid: true},
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to delete task assignee",
			"error", err,
		)
		return fmt.Errorf("failed to unassign task: %w", err)
	}

	remainingAssignees, err := l.Queries.ListTaskAssignees(ctx, tx, &database.ListTaskAssigneesParams{
		OrganizationID: orgID,
		TaskID:         taskID,
	})
	if err != nil {
		return fmt.Errorf("failed to list remaining task assignees: %w", err)
	}

	hasRemainingAssignment := false
	for _, assignee := range remainingAssignees {
		if assignee.EmployeeID == employeeID {
			hasRemainingAssignment = true
			break
		}
	}

	if !hasRemainingAssignment {
		if err := l.syncTaskResourceSubscriptionReason(ctx, tx, orgID, taskID, employeeID, notification.ResourceSubscriptionReasonAssignee, true); err != nil {
			return fmt.Errorf("failed to sync task assignee reason removal: %w", err)
		}
	}

	// Note: We don't auto-remove watch when unassigned - user can manually unwatch

	slog.InfoContext(ctx, "task unassigned successfully",
		"taskID", taskID,
		"employeeID", employeeID,
		"role", role,
	)

	return nil
}

// WatchTask adds an employee as a watcher to a task
func (l *logicImpl) WatchTask(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	taskID, employeeID dbuuid.UUID,
) (*rpcv1.TaskWatcher, error) {
	slog.DebugContext(ctx, "WatchTask",
		"taskID", taskID,
		"employeeID", employeeID,
	)

	// Check if task exists
	_, err := l.Queries.GetTask(ctx, tx, &database.GetTaskParams{
		OrganizationID: orgID,
		ID:             taskID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrTaskNotFound
		}
		return nil, fmt.Errorf("failed to get task: %w", err)
	}

	// Check if already watching via V2 subscription
	existing, err := l.Queries.GetResourceSubscriptionByEmployee(ctx, tx, &database.GetResourceSubscriptionByEmployeeParams{
		OrganizationID: orgID,
		EmployeeID:     employeeID,
		ResourceDomain: notification.ResourceDomainTask,
		ResourceID:     taskID,
	})
	if err == nil && existing.SubscriptionState == notification.ResourceSubscriptionStateActive {
		// Already watching — ensure manual_follow reason is present
		if err := l.syncTaskResourceSubscriptionReason(ctx, tx, orgID, taskID, employeeID, notification.ResourceSubscriptionReasonManualFollow, false); err != nil {
			return nil, fmt.Errorf("failed to sync task subscription reason: %w", err)
		}
		return &rpcv1.TaskWatcher{
			EmployeeId:  employeeID.String(),
			WatchReason: TaskWatchReasonManual,
		}, nil
	} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("failed to check existing subscription: %w", err)
	}

	// Create watcher via V2 subscription
	err = l.createTaskWatcher(ctx, tx, orgID, taskID, employeeID, TaskWatchReasonManual)
	if err != nil {
		slog.ErrorContext(ctx, "failed to create task watcher",
			"error", err,
		)
		return nil, fmt.Errorf("failed to watch task: %w", err)
	}

	slog.InfoContext(ctx, "now watching task",
		"taskID", taskID,
		"employeeID", employeeID,
	)

	return &rpcv1.TaskWatcher{
		EmployeeId:  employeeID.String(),
		WatchReason: TaskWatchReasonManual,
	}, nil
}

// UnwatchTask removes an employee as a watcher from a task
func (l *logicImpl) UnwatchTask(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	taskID, employeeID dbuuid.UUID,
) error {
	slog.DebugContext(ctx, "UnwatchTask",
		"taskID", taskID,
		"employeeID", employeeID,
	)

	if _, err := l.upsertTaskResourceSubscription(ctx, tx, orgID, taskID, employeeID, notification.ResourceSubscriptionStateUnfollowed); err != nil {
		return fmt.Errorf("failed to mark task subscription unfollowed: %w", err)
	}
	if err := l.syncTaskResourceSubscriptionReason(ctx, tx, orgID, taskID, employeeID, notification.ResourceSubscriptionReasonManualFollow, true); err != nil {
		return fmt.Errorf("failed to remove task manual follow reason: %w", err)
	}

	slog.InfoContext(ctx, "no longer watching task",
		"taskID", taskID,
		"employeeID", employeeID,
	)

	return nil
}

// ListTaskAssignees lists all assignees of a task
func (l *logicImpl) ListTaskAssignees(
	ctx context.Context,
	tx database.DBTX,
	orgID, taskID dbuuid.UUID,
) ([]*rpcv1.TaskAssignee, error) {
	slog.DebugContext(ctx, "ListTaskAssignees",
		"taskID", taskID,
	)

	dbAssignees, err := l.Queries.ListTaskAssignees(ctx, tx, &database.ListTaskAssigneesParams{
		OrganizationID: orgID,
		TaskID:         taskID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list assignees: %w", err)
	}

	assignees := make([]*rpcv1.TaskAssignee, len(dbAssignees))
	for i, a := range dbAssignees {
		assignees[i] = &rpcv1.TaskAssignee{
			EmployeeId: a.EmployeeID.String(),
			Role:       stringToAssigneeRoleProto(a.Role),
			AssignedAt: timestamppb.New(a.AssignedAt.Time),
		}
	}

	return assignees, nil
}

// ListTaskWatchers lists all watchers of a task via V2 subscriptions
func (l *logicImpl) ListTaskWatchers(
	ctx context.Context,
	tx database.DBTX,
	orgID, taskID dbuuid.UUID,
) ([]*rpcv1.TaskWatcher, error) {
	slog.DebugContext(ctx, "ListTaskWatchers",
		"taskID", taskID,
	)

	subscriptions, err := l.Queries.ListActiveResourceSubscriptionsByResource(ctx, tx, &database.ListActiveResourceSubscriptionsByResourceParams{
		OrganizationID: orgID,
		ResourceDomain: notification.ResourceDomainTask,
		ResourceID:     taskID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list task subscriptions: %w", err)
	}

	subReasons, err := l.Queries.ListResourceSubscriptionReasonsForResource(ctx, tx, &database.ListResourceSubscriptionReasonsForResourceParams{
		OrganizationID: orgID,
		ResourceDomain: notification.ResourceDomainTask,
		ResourceID:     taskID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list subscription reasons: %w", err)
	}

	reasonsBySubID := make(map[dbuuid.UUID]string)
	for _, r := range subReasons {
		reasonsBySubID[r.SubscriptionID] = subscriptionReasonToWatchReason(r.ReasonType)
	}

	watchers := make([]*rpcv1.TaskWatcher, len(subscriptions))
	for i, s := range subscriptions {
		reason := reasonsBySubID[s.ID]
		if reason == "" {
			reason = TaskWatchReasonManual
		}
		watchers[i] = &rpcv1.TaskWatcher{
			EmployeeId:  s.EmployeeID.String(),
			WatchReason: reason,
		}
	}

	return watchers, nil
}
