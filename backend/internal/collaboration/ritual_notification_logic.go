package collaboration

import (
	"context"
	"fmt"
	"log/slog"
	"time"

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

// Focus intents carried in the notification's action_data. Both clients map a notification
// type to one of these and open the ritual instance screen already pointed at the right
// thing.
const (
	// ritualFocusIntentSubmitRequirement opens an overdue instance ready to submit,
	// because the recipient can still recover the work — that recoverability is the
	// entire point of alerting early.
	ritualFocusIntentSubmitRequirement = "submit_requirement"
	// ritualFocusIntentViewInstance opens a missed instance read-only: the state is
	// terminal and there is nothing left to submit.
	ritualFocusIntentViewInstance = "view_instance"
)

// ritualLatenessRecipients resolves who hears about a late ritual instance: its assignees,
// its reviewers and its approvers, deduplicated by employee ID so a person holding two
// roles is told once (FR-014, FR-015).
//
// hasReviewer reports whether the task carried a reviewer or approver at all, which is what
// decides whether a missed instance escalates to the project's owners and admins (FR-016).
func (l *logicImpl) ritualLatenessRecipients(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	task *database.CollaborationTask,
) (recipientIDs []string, hasReviewer bool) {
	recipientIDs = make([]string, 0, 4)
	seen := make(map[string]struct{})

	assignees, err := l.Queries.ListTaskAssignees(ctx, tx, &database.ListTaskAssigneesParams{
		OrganizationID: orgID,
		TaskID:         task.ID,
	})
	if err != nil {
		slog.WarnContext(ctx, "failed to list task assignees for ritual lateness notification",
			"error", err,
			"taskID", task.ID,
		)
		return recipientIDs, false
	}

	for _, assignee := range assignees {
		switch assignee.Role {
		case TaskAssigneeRoleReviewer, TaskAssigneeRoleApprover:
			hasReviewer = true
		case TaskAssigneeRoleAssignee:
		default:
			continue
		}
		recipientIDs = appendUniqueRecipient(recipientIDs, seen, assignee.EmployeeID)
	}

	return recipientIDs, hasReviewer
}

// publishRitualLatenessNotification is the one publish path both lateness notifications
// share. Keeping the envelope in a single place is what makes Story 4 true by
// construction: ordinary priority, an ordinary policy key, no special case anywhere, so
// do-not-disturb, domain mute and presence apply without this feature knowing they exist.
func (l *logicImpl) publishRitualLatenessNotification(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	task *database.CollaborationTask,
	recipientIDs []string,
	notificationType string,
	title string,
	message string,
	focusIntent string,
) {
	if len(recipientIDs) == 0 {
		return
	}

	taskID := dbuuid.UUID(task.ID).String()
	projectID := dbuuid.UUID(task.ProjectID).String()

	_, err := l.NotificationPublisher.PublishNotification(ctx, tx, &rpcv1.PublishNotificationRequest{
		Recipients: &rpcv1.NotificationRecipients{
			EmployeeIds: recipientIDs,
		},
		OrganizationId:   orgID.String(),
		SourceDomain:     notification.SourceDomainProjects,
		NotificationType: notificationType,
		// Priority 2 is ordinary. It is deliberately NOT the always-deliver priority
		// reserved for mentions and incoming calls: the most useful alert in the product
		// must not be the one people mute (FR-018).
		Priority:       2,
		Title:          title,
		Message:        message,
		PolicyKey:      notification.PolicyKeyTaskStatus,
		DeliveryClass:  notification.DeliveryClassPersistent,
		SourceCategory: notification.SourceCategoryActivity,
		ActionData: map[string]string{
			"taskId":      taskID,
			"projectId":   projectID,
			"deepLink":    fmt.Sprintf("tasks/%s/%s", projectID, taskID),
			"focusIntent": focusIntent,
		},
		NavigationTarget: &rpcv1.NavigationTarget{
			Domain:       notification.SourceDomainProjects,
			ResourceType: "task",
			ResourceId:   taskID,
		},
	})
	if err != nil {
		// The state change is the more important half. A failed publish is logged and
		// swallowed rather than rolling back a correct transition.
		slog.WarnContext(ctx, "failed to publish ritual lateness notification",
			"error", err,
			"orgID", orgID,
			"taskID", task.ID,
			"notificationType", notificationType,
		)
	}
}

// ritualLatenessDescription renders how late an instance is, in the coarsest unit that
// still says something useful.
func ritualLatenessDescription(deadline, now time.Time) string {
	late := now.Sub(deadline)
	switch {
	case late < time.Hour:
		return "is overdue by less than an hour"
	case late < 48*time.Hour:
		return fmt.Sprintf("is %d hours overdue", int(late.Hours()))
	default:
		return fmt.Sprintf("is %d days overdue", int(late.Hours()/24))
	}
}

// ritualScheduledDateLabel is the day the ritual was for, as it appears in both bodies.
func ritualScheduledDateLabel(task *database.CollaborationTask) string {
	if !task.ScheduledDate.Valid {
		return "an unscheduled date"
	}
	return task.ScheduledDate.Time.Format("2006-01-02")
}

// notifyRitualInstanceOverdue tells the people responsible for an instance that its
// completion deadline passed without complete evidence.
func (l *logicImpl) notifyRitualInstanceOverdue(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	task *database.CollaborationTask,
	ritualName string,
	now time.Time,
) {
	if l.NotificationPublisher == nil {
		return
	}

	recipientIDs, _ := l.ritualLatenessRecipients(ctx, tx, orgID, task)

	// An instance nobody is responsible for produces no overdue notification: there is
	// nobody to tell, and inventing a recipient here would mean alerting people who
	// cannot act. The missed transition is where that hole is closed instead.
	if len(recipientIDs) == 0 {
		return
	}

	var lateness string
	if task.CompletionDeadline.Valid {
		lateness = ritualLatenessDescription(task.CompletionDeadline.Time, now)
	} else {
		lateness = "is overdue"
	}

	l.publishRitualLatenessNotification(ctx, tx, orgID, task, recipientIDs,
		NotificationTypeRitualInstanceOverdue,
		"Ritual overdue",
		fmt.Sprintf("%q for %s %s", ritualName, ritualScheduledDateLabel(task), lateness),
		ritualFocusIntentSubmitRequirement,
	)
}

// notifyRitualInstanceMissed escalates an instance the system has given up on. Unlike the
// overdue notification this one always reaches somebody with authority: when the task
// carries no reviewer and no approver, the project's owners and admins are added (FR-016).
// That is what stops an unassigned ritual failing silently.
func (l *logicImpl) notifyRitualInstanceMissed(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	task *database.CollaborationTask,
	ritualName string,
	now time.Time,
) {
	if l.NotificationPublisher == nil {
		return
	}

	recipientIDs, hasReviewer := l.ritualLatenessRecipients(ctx, tx, orgID, task)

	if !hasReviewer {
		recipientIDs = l.appendProjectAuthorityRecipients(ctx, tx, orgID, task, recipientIDs)
	}

	l.publishRitualLatenessNotification(ctx, tx, orgID, task, recipientIDs,
		NotificationTypeRitualInstanceMissed,
		"Ritual missed",
		fmt.Sprintf("%q for %s was missed — no evidence was submitted", ritualName, ritualScheduledDateLabel(task)),
		ritualFocusIntentViewInstance,
	)
}

// appendProjectAuthorityRecipients adds the project's owners and admins to an existing
// recipient list, deduplicated against it.
//
// Deliberately not used on the overdue path: escalating every late checklist to the
// project's owners is how an alert becomes noise, and noise is how the alert gets muted.
func (l *logicImpl) appendProjectAuthorityRecipients(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	task *database.CollaborationTask,
	recipientIDs []string,
) []string {
	members, err := l.Queries.ListProjectMembers(ctx, tx, &database.ListProjectMembersParams{
		OrganizationID: orgID,
		ProjectID:      dbuuid.UUID(task.ProjectID),
	})
	if err != nil {
		slog.WarnContext(ctx, "failed to list project members for missed ritual escalation",
			"error", err,
			"taskID", task.ID,
		)
		return recipientIDs
	}

	seen := make(map[string]struct{}, len(recipientIDs))
	for _, id := range recipientIDs {
		seen[id] = struct{}{}
	}

	for _, member := range members {
		if member.Role != ProjectMemberRoleOwner && member.Role != ProjectMemberRoleAdmin {
			continue
		}
		recipientIDs = appendUniqueRecipient(recipientIDs, seen, member.EmployeeID)
	}

	return recipientIDs
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
//
// The submitter is named explicitly rather than left to the task's watcher list: they are
// the person waiting on the answer, and whether they happen to hold a subscription on the
// task is beside the point. Actor exclusion still applies, so a reviewer approving their
// own submission notifies nobody while the decision is still recorded against them.
func (l *logicImpl) notifyEvidenceApproved(
	ctx context.Context,
	tx database.DBTX,
	orgID, taskID, actorID, submitterID dbuuid.UUID,
	taskTitle, reviewerComment string,
) {
	message := fmt.Sprintf("Evidence has been approved for: %s", taskTitle)
	if reviewerComment != "" {
		message = fmt.Sprintf("%s — %s", message, reviewerComment)
	}
	l.notifyTaskWatchers(ctx, tx, orgID, taskID, actorID,
		NotificationTypeEvidenceApproved, 2, false,
		"Evidence Approved",
		message,
		submitterID,
	)
}

// notifyEvidenceRejected sends a notification when evidence is rejected.
//
// The reviewer's reason is carried into the body. A rejection reason that stops at the
// database tells the submitter nothing about what to fix, which is the whole point of
// requiring one.
func (l *logicImpl) notifyEvidenceRejected(
	ctx context.Context,
	tx database.DBTX,
	orgID, taskID, actorID, submitterID dbuuid.UUID,
	taskTitle, reason string,
) {
	message := fmt.Sprintf("Evidence has been rejected for: %s", taskTitle)
	if reason != "" {
		message = fmt.Sprintf("%s — %s", message, reason)
	}
	l.notifyTaskWatchers(ctx, tx, orgID, taskID, actorID,
		NotificationTypeEvidenceRejected, 2, false,
		"Evidence Rejected",
		message,
		submitterID,
	)
}

// ---------------------------------------------------------------------------
// Feature 042: on-shift assignment notifications
// ---------------------------------------------------------------------------

// notifyRitualSlotAssigned tells an employee that a ritual instance is now theirs because
// the rota put them on it.
//
// It is a task_assigned notification rather than a new type: from the recipient's seat
// nothing distinguishes "a manager assigned this to you" from "the rota did", and a
// second type would mean a second row in every client's notification switch for no
// behavioural difference.
//
// Published only by a caller whose compare-and-set reported a changed row, which is what
// makes two overlapping resolution passes notify once.
func (l *logicImpl) notifyRitualSlotAssigned(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	task *database.CollaborationTask,
	employeeID dbuuid.UUID,
	ritualName string,
) {
	if l.NotificationPublisher == nil {
		return
	}
	l.publishRitualLatenessNotification(ctx, tx, orgID, task, []string{employeeID.String()},
		NotificationTypeTaskAssigned,
		"Ritual assigned to you",
		fmt.Sprintf("%q for %s is yours — you are on shift that day", ritualName, ritualScheduledDateLabel(task)),
		ritualFocusIntentSubmitRequirement,
	)
}

// notifyRitualSlotWithdrawn tells the previous holder of a slot that a rota change moved
// the instance off them. Without it a shift swap silently removes work from somebody's
// list, which is exactly the kind of change people discover too late.
func (l *logicImpl) notifyRitualSlotWithdrawn(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	task *database.CollaborationTask,
	employeeID dbuuid.UUID,
	ritualName string,
) {
	if l.NotificationPublisher == nil {
		return
	}
	l.publishRitualLatenessNotification(ctx, tx, orgID, task, []string{employeeID.String()},
		NotificationTypeTaskUpdated,
		"Ritual no longer yours",
		fmt.Sprintf("%q for %s is no longer yours — the rota for that day changed", ritualName, ritualScheduledDateLabel(task)),
		ritualFocusIntentViewInstance,
	)
}

// notifyRitualInstanceUnassigned alerts the project's owners and admins that a ritual
// instance reached its scheduled date with nobody in the department rostered, so it was
// never assigned to anyone.
//
// Deliberately its own notification type rather than reusing ritual_instance_missed:
// missed means somebody was asked to do the work and did not, and this means nobody was
// ever asked. Collapsing the two would tell an owner to chase a person who does not exist.
func (l *logicImpl) notifyRitualInstanceUnassigned(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	task *database.CollaborationTask,
	ritualName string,
) {
	if l.NotificationPublisher == nil {
		return
	}

	recipientIDs := l.appendProjectAuthorityRecipients(ctx, tx, orgID, task, nil)

	l.publishRitualLatenessNotification(ctx, tx, orgID, task, recipientIDs,
		NotificationTypeRitualInstanceUnassigned,
		"Ritual could not be assigned",
		fmt.Sprintf("%q for %s has nobody assigned — no one in the department was rostered for that day",
			ritualName, ritualScheduledDateLabel(task)),
		ritualFocusIntentViewInstance,
	)
}
