package collaboration

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/notification"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

func appendUniqueRecipient(recipientIDs []string, seen map[string]struct{}, employeeID dbuuid.UUID) []string {
	key := employeeID.String()
	if _, ok := seen[key]; ok {
		return recipientIDs
	}
	seen[key] = struct{}{}
	return append(recipientIDs, key)
}

// notifyRitualInstancesScheduled sends a single summary notification to an employee after a
// bulk ritual generation run has assigned instanceCount new instances to them.
// It bypasses the task-subscription fanout and goes directly to the target employee.
func (l *logicImpl) notifyRitualInstancesScheduled(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	employeeID dbuuid.UUID,
	instanceCount int,
	ritualName string,
) {
	if l.NotificationPublisher == nil {
		return
	}

	var message string
	if instanceCount == 1 {
		message = fmt.Sprintf("You have 1 new ritual task scheduled for: %s", ritualName)
	} else {
		message = fmt.Sprintf("You have %d new ritual tasks scheduled for: %s", instanceCount, ritualName)
	}

	_, err := l.NotificationPublisher.PublishNotification(ctx, tx, &rpcv1.PublishNotificationRequest{
		Recipients: &rpcv1.NotificationRecipients{
			EmployeeIds: []string{employeeID.String()},
		},
		OrganizationId:   orgID.String(),
		SourceDomain:     notification.SourceDomainProjects,
		NotificationType: NotificationTypeRitualInstancesScheduled,
		Priority:         2,
		Title:            "Ritual tasks scheduled",
		Message:          message,
		PolicyKey:        notification.PolicyKeyTaskAssignment,
		DeliveryClass:    notification.DeliveryClassPersistent,
		SourceCategory:   notification.SourceCategorySystem,
	})
	if err != nil {
		slog.WarnContext(ctx, "failed to publish ritual_instances_scheduled notification",
			"error", err,
			"orgID", orgID,
			"employeeID", employeeID,
			"instanceCount", instanceCount,
		)
	}
}

// notifyEvidenceSubmitted sends a review notification when evidence remains pending review.
func (l *logicImpl) notifyEvidenceSubmitted(ctx context.Context, tx database.DBTX, orgID, taskID, requirementID, actorID dbuuid.UUID, taskTitle string) {
	if l.NotificationPublisher == nil {
		return
	}

	task, err := l.Queries.GetTask(ctx, tx, &database.GetTaskParams{
		OrganizationID: orgID,
		ID:             taskID,
	})
	if err != nil {
		slog.WarnContext(ctx, "failed to load task for evidence review notification",
			"error", err,
			"taskID", taskID,
		)
		return
	}

	recipientIDs := make([]string, 0, 4)
	seenRecipients := make(map[string]struct{})

	members, err := l.Queries.ListProjectMembers(ctx, tx, &database.ListProjectMembersParams{
		OrganizationID: orgID,
		ProjectID:      dbuuid.UUID(task.ProjectID),
	})
	if err != nil {
		slog.WarnContext(ctx, "failed to list project owners for evidence review notification",
			"error", err,
			"taskID", taskID,
		)
	} else {
		for _, member := range members {
			if member.Role != ProjectMemberRoleOwner {
				continue
			}
			if member.EmployeeID == actorID {
				continue
			}
			recipientIDs = appendUniqueRecipient(recipientIDs, seenRecipients, member.EmployeeID)
		}
	}

	assignees, err := l.Queries.ListTaskAssignees(ctx, tx, &database.ListTaskAssigneesParams{
		OrganizationID: orgID,
		TaskID:         taskID,
	})
	if err != nil {
		slog.WarnContext(ctx, "failed to list explicit ritual reviewers for evidence review notification",
			"error", err,
			"taskID", taskID,
		)
	} else {
		for _, assignee := range assignees {
			if assignee.Role != TaskAssigneeRoleReviewer {
				continue
			}
			if assignee.EmployeeID == actorID {
				continue
			}
			recipientIDs = appendUniqueRecipient(recipientIDs, seenRecipients, assignee.EmployeeID)
		}
	}

	slog.DebugContext(ctx, "evidence review notification recipient resolution",
		"taskID", taskID.String(),
		"requirementID", requirementID.String(),
		"eligibleRecipients", len(recipientIDs),
	)

	if len(recipientIDs) == 0 {
		return
	}

	title := "Evidence Submitted"
	messageTaskTitle := taskTitle
	if messageTaskTitle == "" {
		messageTaskTitle = task.Title
	}
	message := fmt.Sprintf("Evidence has been submitted for review: %s", messageTaskTitle)
	actionData := map[string]string{
		"taskId":        taskID.String(),
		"projectId":     dbuuid.UUID(task.ProjectID).String(),
		"deepLink":      fmt.Sprintf("tasks/%s/%s", dbuuid.UUID(task.ProjectID).String(), taskID.String()),
		"focusIntent":   "review_pending",
		"requirementId": requirementID.String(),
	}
	navigationTarget := &rpcv1.NavigationTarget{
		Domain:       notification.SourceDomainProjects,
		ResourceType: "task",
		ResourceId:   taskID.String(),
	}
	policyKey, sourceCategory := taskNotificationPolicy(NotificationTypeEvidenceSubmitted, false)

	_, err = l.NotificationPublisher.PublishNotification(ctx, tx, &rpcv1.PublishNotificationRequest{
		Recipients: &rpcv1.NotificationRecipients{
			EmployeeIds: recipientIDs,
		},
		OrganizationId:   orgID.String(),
		SourceDomain:     notification.SourceDomainProjects,
		NotificationType: NotificationTypeEvidenceSubmitted,
		Priority:         2,
		Title:            title,
		Message:          message,
		PolicyKey:        policyKey,
		DeliveryClass:    notification.DeliveryClassPersistent,
		SourceCategory:   sourceCategory,
		ActionData:       actionData,
		NavigationTarget: navigationTarget,
	})
	if err != nil {
		slog.WarnContext(ctx, "failed to publish evidence review notification",
			"error", err,
			"taskID", taskID,
			"requirementID", requirementID,
		)
	}
}

// notifyEvidenceApproved sends a notification when evidence is approved.
func (l *logicImpl) notifyEvidenceApproved(ctx context.Context, tx database.DBTX, orgID, taskID, actorID dbuuid.UUID, taskTitle string) {
	l.notifyTaskWatchers(ctx, tx, orgID, taskID, actorID,
		NotificationTypeEvidenceApproved, 2, false,
		"Evidence Approved",
		fmt.Sprintf("Evidence has been approved for: %s", taskTitle),
	)
}

// notifyEvidenceRejected sends a notification when evidence is rejected.
func (l *logicImpl) notifyEvidenceRejected(ctx context.Context, tx database.DBTX, orgID, taskID, actorID dbuuid.UUID, taskTitle string) {
	l.notifyTaskWatchers(ctx, tx, orgID, taskID, actorID,
		NotificationTypeEvidenceRejected, 2, false,
		"Evidence Rejected",
		fmt.Sprintf("Evidence has been rejected for: %s", taskTitle),
	)
}
