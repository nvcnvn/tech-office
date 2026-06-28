package integration

import (
	"fmt"
	"testing"
	"time"

	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRitualSubmissionFlow(t *testing.T) {
	// FR-001, FR-002, FR-003, FR-004
	t.Run("when an assigned employee opens an active ritual instance", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		worker := w.withEmployee()

		project := w.createProjectWithMode(
			owner,
			"Ritual Submission Worker",
			uniqueProjectKey("RSFW"),
			rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL,
		)
		w.addProjectMember(owner, project.ID, worker.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		definition := w.createRitualDefinitionWithAssigneesAndRequirements(
			owner,
			project.ID,
			"Daily Safety Walk",
			dailyRecurrenceRule(),
			[]string{worker.ID.String()},
			[]*rpcv1.CreateEvidenceRequirementInput{
				{
					Name:          "Front gate photo",
					EvidenceTypes: []rpcv1.EvidenceType{rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE},
					IsRequired:    true,
					ApprovalMode:  rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL,
				},
			},
		)
		require.Len(t, definition.EvidenceRequirements, 1)
		w.generateRitualInstances(owner)

		instances := w.listTasksWithKind(owner, project.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))
		require.NotEmpty(t, instances)
		taskID := instances[0].Id
		requirementID := definition.EvidenceRequirements[0].Id

		t.Run("the task detail shows the current proof checklist and submission states", func(t *testing.T) {
			requirements := w.listEvidenceRequirements(worker, definition.Id)
			submissions := w.listEvidenceSubmissions(worker, taskID)

			require.Len(t, requirements, 1)
			assert.Equal(t, "Front gate photo", requirements[0].Name)
			assert.Empty(t, submissions, "a fresh ritual instance should start without submissions")
		})

		t.Run("submitting proof for a missing requirement keeps the user in the same ritual instance", func(t *testing.T) {
			submission := w.submitTextEvidence(worker, taskID, requirementID, "Gate checked at 08:00")
			submissions := w.listEvidenceSubmissions(worker, taskID)

			require.NotEmpty(t, submission.Id)
			assert.Equal(t, taskID, submission.TaskId)
			assert.Equal(t, rpcv1.ApprovalStatus_APPROVAL_STATUS_PENDING_REVIEW, submission.ApprovalStatus)
			require.Len(t, submissions, 1)
			assert.Equal(t, taskID, submissions[0].TaskId)
		})

		t.Run("opening a ritual definition does not expose live submission actions for a specific run", func(t *testing.T) {
			otherDefinition := w.getRitualDefinition(worker, definition.Id)
			otherInstances := w.listTasksWithKind(worker, project.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))

			require.NotNil(t, otherDefinition)
			require.NotEmpty(t, otherInstances)
			assert.Equal(t, definition.Id, otherDefinition.Id)
			assert.Len(t, w.listEvidenceSubmissions(worker, otherInstances[len(otherInstances)-1].Id), 0,
				"submissions stay attached to a specific ritual instance task, not the template")
		})
	})

	// FR-005, FR-006, FR-007
	t.Run("when an authorized reviewer handles pending ritual evidence", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		worker := w.withEmployee()
		reviewer := w.withEmployee()
		explicitReviewer := w.withEmployee()

		project := w.createProjectWithMode(
			owner,
			"Ritual Submission Review",
			uniqueProjectKey("RSFR"),
			rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL,
		)
		submittedState := stateByCategory(project.States, rpcv1.StateCategory_STATE_CATEGORY_SUBMITTED)
		inProgressState := stateByCategory(project.States, rpcv1.StateCategory_STATE_CATEGORY_IN_PROGRESS)
		verifiedState := stateByCategory(project.States, rpcv1.StateCategory_STATE_CATEGORY_VERIFIED)
		require.NotNil(t, submittedState)
		require.NotNil(t, inProgressState)
		require.NotNil(t, verifiedState)
		w.addProjectMember(owner, project.ID, worker.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		w.addProjectMember(owner, project.ID, reviewer.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_ADMIN)
		w.addProjectMember(owner, project.ID, explicitReviewer.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		definition := w.createRitualDefinitionWithAssigneesAndRequirements(
			owner,
			project.ID,
			"Shift Handover",
			dailyRecurrenceRule(),
			[]string{worker.ID.String()},
			[]*rpcv1.CreateEvidenceRequirementInput{
				{
					Name:          "Operator note",
					EvidenceTypes: []rpcv1.EvidenceType{rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE},
					IsRequired:    true,
					ApprovalMode:  rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL,
				},
			},
		)
		require.Len(t, definition.EvidenceRequirements, 1)
		requirementID := definition.EvidenceRequirements[0].Id
		w.generateRitualInstances(owner)

		instances := w.listTasksWithKind(owner, project.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))
		require.GreaterOrEqual(t, len(instances), 2)
		w.assignTask(owner, instances[0].Id, explicitReviewer.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_REVIEWER)
		w.assignTask(owner, instances[1].Id, explicitReviewer.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_REVIEWER)

		firstSubmission := w.submitTextEvidence(worker, instances[0].Id, requirementID, "Night shift done")
		secondSubmission := w.submitTextEvidence(worker, instances[1].Id, requirementID, "Morning shift done")
		firstTaskAfterSubmit := w.getTask(reviewer, instances[0].Id)
		secondTaskAfterSubmit := w.getTask(reviewer, instances[1].Id)
		assert.Equal(t, submittedState.Id, firstTaskAfterSubmit.StateId)
		assert.Equal(t, submittedState.Id, secondTaskAfterSubmit.StateId)

		t.Run("review actions stay hidden from workers who cannot review ritual evidence", func(t *testing.T) {
			workerView := w.listEvidenceSubmissions(worker, instances[0].Id)

			require.Len(t, workerView, 1)
			assert.Equal(t, rpcv1.ApprovalStatus_APPROVAL_STATUS_PENDING_REVIEW, workerView[0].ApprovalStatus)
			assert.Empty(t, workerView[0].ReviewedByEmployeeId)
		})

		t.Run("the reviewer can identify pending submissions without opening every task", func(t *testing.T) {
			tasks := w.listTasksWithKind(reviewer, project.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))
			var pendingTaskIDs []string
			for _, task := range tasks {
				submissions := w.listEvidenceSubmissions(reviewer, task.Id)
				for _, submission := range submissions {
					if submission.ApprovalStatus == rpcv1.ApprovalStatus_APPROVAL_STATUS_PENDING_REVIEW {
						pendingTaskIDs = append(pendingTaskIDs, task.Id)
						break
					}
				}
			}

			assert.Contains(t, pendingTaskIDs, instances[0].Id)
			assert.Contains(t, pendingTaskIDs, instances[1].Id)
		})

		t.Run("explicit reviewer assignees receive pending review notifications", func(t *testing.T) {
			notification := waitForNotificationType(w, explicitReviewer, "evidence_submitted")

			require.NotNil(t, notification)
			require.NotNil(t, notification.NavigationTarget)
			assert.Equal(t, "task", notification.NavigationTarget.ResourceType)
			assert.Contains(t, []string{instances[0].Id, instances[1].Id}, notification.NavigationTarget.ResourceId)
			assert.Equal(t, project.ID, notification.ActionData["projectId"])
			assert.Equal(t, "review_pending", notification.ActionData["focusIntent"])
			assert.Equal(t, requirementID, notification.ActionData["requirementId"])
		})

		t.Run("approving a submission updates the ritual instance review state", func(t *testing.T) {
			reviewed := w.approveEvidence(reviewer, firstSubmission.Id, "Looks correct")
			submissions := w.listEvidenceSubmissions(worker, instances[0].Id)
			refreshedTask := w.getTask(worker, instances[0].Id)

			assert.Equal(t, rpcv1.ApprovalStatus_APPROVAL_STATUS_APPROVED, reviewed.ApprovalStatus)
			require.Len(t, submissions, 1)
			assert.Equal(t, rpcv1.ApprovalStatus_APPROVAL_STATUS_APPROVED, submissions[0].ApprovalStatus)
			assert.Equal(t, "Looks correct", submissions[0].ReviewerComment)
			assert.Equal(t, verifiedState.Id, refreshedTask.StateId)
		})

		t.Run("rejecting a submission returns actionable feedback to the worker", func(t *testing.T) {
			rejected := w.rejectEvidence(reviewer, secondSubmission.Id, "Add more detail about the handover")
			taskAfterReject := w.getTask(worker, instances[1].Id)
			resubmission := w.submitTextEvidence(worker, instances[1].Id, requirementID, "Morning shift done with checklist")
			submissions := w.listEvidenceSubmissions(worker, instances[1].Id)
			taskAfterResubmission := w.getTask(worker, instances[1].Id)

			assert.Equal(t, rpcv1.ApprovalStatus_APPROVAL_STATUS_REJECTED, rejected.ApprovalStatus)
			assert.Equal(t, "Add more detail about the handover", rejected.ReviewerComment)
			assert.Equal(t, inProgressState.Id, taskAfterReject.StateId)
			require.Len(t, submissions, 2)
			assert.Equal(t, rpcv1.ApprovalStatus_APPROVAL_STATUS_PENDING_REVIEW, resubmission.ApprovalStatus)
			assert.Equal(t, "Add more detail about the handover", submissions[0].ReviewerComment)
			assert.Equal(t, submittedState.Id, taskAfterResubmission.StateId)
		})
	})

	// FR-008, FR-009, FR-015
	t.Run("when template management stays separate from live ritual work", func(t *testing.T) {
		t.Run("a dual-role owner can still submit evidence while keeping review visibility", func(t *testing.T) {
			w := newTestWorld(t)
			owner := w.withOwner()
			worker := w.withEmployee()

			project := w.createProjectWithMode(
				owner,
				"Ritual Submission Dual Role",
				uniqueProjectKey("RSFD"),
				rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL,
			)
			w.addProjectMember(owner, project.ID, worker.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

			definition := w.createRitualDefinitionWithAssigneesAndRequirements(
				owner,
				project.ID,
				"Lock-up Checklist",
				dailyRecurrenceRule(),
				[]string{owner.ID.String(), worker.ID.String()},
				[]*rpcv1.CreateEvidenceRequirementInput{
					{
						Name:          "Front door note",
						EvidenceTypes: []rpcv1.EvidenceType{rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE},
						IsRequired:    true,
						ApprovalMode:  rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL,
					},
					{
						Name:          "Alarm panel note",
						EvidenceTypes: []rpcv1.EvidenceType{rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE},
						IsRequired:    true,
						ApprovalMode:  rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL,
					},
				},
			)
			require.Len(t, definition.EvidenceRequirements, 2)
			w.generateRitualInstances(owner)

			instances := w.listTasksWithKind(owner, project.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))
			require.NotEmpty(t, instances)
			taskID := instances[0].Id

			ownerSubmission := w.submitTextEvidence(owner, taskID, definition.EvidenceRequirements[0].Id, "Owner completed lock-up")
			workerSubmission := w.submitTextEvidence(worker, taskID, definition.EvidenceRequirements[1].Id, "Worker checked alarm")
			reviewed := w.approveEvidence(owner, workerSubmission.Id, "Alarm panel proof looks good")
			submissions := w.listEvidenceSubmissions(owner, taskID)

			require.Len(t, submissions, 2)
			assert.Equal(t, rpcv1.ApprovalStatus_APPROVAL_STATUS_APPROVED, reviewed.ApprovalStatus)
			assert.Equal(t, rpcv1.ApprovalStatus_APPROVAL_STATUS_PENDING_REVIEW, ownerSubmission.ApprovalStatus)
			assert.Contains(t, []string{submissions[0].Id, submissions[1].Id}, ownerSubmission.Id)
			assert.Contains(t, []string{submissions[0].Id, submissions[1].Id}, workerSubmission.Id)
		})

		t.Run("a skipped ritual instance keeps its instance-specific outcome after template edits", func(t *testing.T) {
			w := newTestWorld(t)
			owner := w.withOwner()

			project := w.createProjectWithMode(
				owner,
				"Ritual Submission Exceptional",
				uniqueProjectKey("RSFE"),
				rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL,
			)

			definition := w.createRitualDefinitionWithAssigneesAndRequirements(
				owner,
				project.ID,
				"Warehouse Sweep",
				dailyRecurrenceRule(),
				[]string{owner.ID.String()},
				[]*rpcv1.CreateEvidenceRequirementInput{
					{
						Name:          "Sweep note",
						EvidenceTypes: []rpcv1.EvidenceType{rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE},
						IsRequired:    true,
						ApprovalMode:  rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL,
					},
				},
			)
			w.generateRitualInstances(owner)

			instances := w.listTasksWithKind(owner, project.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))
			require.NotEmpty(t, instances)
			taskID := instances[0].Id

			skippedTask, err := w.skipRitualInstance(owner, taskID, "Site closed for maintenance")
			require.NoError(t, err)
			renamed := "Warehouse Sweep v2"
			updatedDefinition := w.updateRitualDefinition(owner, definition.Id, &renamed)
			refreshedTasks := w.listTasksWithKind(owner, project.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))

			require.NotNil(t, skippedTask)
			require.NotNil(t, updatedDefinition)
			assert.Equal(t, renamed, updatedDefinition.Name)
			assert.Equal(t, "Site closed for maintenance", skippedTask.SkipReason)
			require.NotEmpty(t, refreshedTasks)
			assert.Equal(t, taskID, refreshedTasks[0].Id)
			assert.Equal(t, "Site closed for maintenance", refreshedTasks[0].SkipReason)
		})
	})

	// FR-010, FR-011, FR-012
	t.Run("when ritual work is opened from summaries and notifications", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		worker := w.withEmployee()

		project := w.createProjectWithMode(
			owner,
			"Ritual Submission Routing",
			uniqueProjectKey("RSFN"),
			rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL,
		)
		w.addProjectMember(owner, project.ID, worker.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		definition := w.createRitualDefinitionWithAssigneesAndRequirements(
			owner,
			project.ID,
			"Boiler Room Check",
			dailyRecurrenceRule(),
			[]string{worker.ID.String()},
			[]*rpcv1.CreateEvidenceRequirementInput{
				{
					Name:          "Pressure note",
					EvidenceTypes: []rpcv1.EvidenceType{rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE},
					IsRequired:    true,
					ApprovalMode:  rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL,
				},
			},
		)
		require.Len(t, definition.EvidenceRequirements, 1)
		w.generateRitualInstances(owner)

		instances := w.listTasksWithKind(worker, project.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))
		require.NotEmpty(t, instances)
		taskID := instances[0].Id
		requirementID := definition.EvidenceRequirements[0].Id

		t.Run("today and list summaries still point at the live ritual instance", func(t *testing.T) {
			assert.Equal(t, taskID, instances[0].Id)
			assert.Equal(t, definition.Id, instances[0].RitualDefinitionId)
			assert.Empty(t, instances[0].SkipReason)
		})

		t.Run("review notifications carry project and task routing data for the ritual instance", func(t *testing.T) {
			w.submitTextEvidence(worker, taskID, requirementID, "Pressure stable at 09:00")
			submittedNotification := waitForNotificationType(w, owner, "evidence_submitted")

			require.NotNil(t, submittedNotification)
			require.NotNil(t, submittedNotification.NavigationTarget)
			assert.Equal(t, "projects", submittedNotification.SourceDomain)
			assert.Equal(t, "task", submittedNotification.NavigationTarget.ResourceType)
			assert.Equal(t, taskID, submittedNotification.NavigationTarget.ResourceId)
			assert.Equal(t, project.ID, submittedNotification.ActionData["projectId"])
			assert.Equal(t, taskID, submittedNotification.ActionData["taskId"])
			assert.Equal(t, fmt.Sprintf("tasks/%s/%s", project.ID, taskID), submittedNotification.ActionData["deepLink"])
			assert.Equal(t, "review_pending", submittedNotification.ActionData["focusIntent"])
			assert.Equal(t, requirementID, submittedNotification.ActionData["requirementId"])
		})

		t.Run("rejection notifications route workers back to the same ritual instance", func(t *testing.T) {
			submissions := w.listEvidenceSubmissions(owner, taskID)
			require.NotEmpty(t, submissions)
			w.rejectEvidence(owner, submissions[0].Id, "Add the actual pressure reading")

			rejectedNotification := waitForNotificationType(w, worker, "evidence_rejected")

			require.NotNil(t, rejectedNotification)
			require.NotNil(t, rejectedNotification.NavigationTarget)
			assert.Equal(t, "task", rejectedNotification.NavigationTarget.ResourceType)
			assert.Equal(t, taskID, rejectedNotification.NavigationTarget.ResourceId)
			assert.Equal(t, project.ID, rejectedNotification.ActionData["projectId"])
			assert.Equal(t, fmt.Sprintf("tasks/%s/%s", project.ID, taskID), rejectedNotification.ActionData["deepLink"])
		})
	})
}

func waitForNotificationType(w *testWorld, actor testUser, notificationType string) *rpcv1.NotificationSummary {
	w.t.Helper()

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		notifications := w.listNotifications(actor, false)
		for _, notification := range notifications {
			if notification.NotificationType == notificationType {
				return notification
			}
		}

		time.Sleep(200 * time.Millisecond)
	}

	return nil
}
