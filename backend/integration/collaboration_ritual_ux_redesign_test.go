package integration

import (
	"testing"
	"time"

	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func findTaskByRitualDefinitionID(tasks []*rpcv1.Task, definitionID string) *rpcv1.Task {
	for _, task := range tasks {
		if task.RitualDefinitionId == definitionID {
			return task
		}
	}

	return nil
}

func hasSubmissionWithStatus(submissions []*rpcv1.EvidenceSubmission, status rpcv1.ApprovalStatus) bool {
	for _, submission := range submissions {
		if submission.ApprovalStatus == status {
			return true
		}
	}

	return false
}

func TestCollaborationRitualUXRedesign(t *testing.T) {
	t.Run("when a member opens a standard project without an explicit view", func(t *testing.T) {
		// FR-001, FR-002, Phase 3 / T011
		w := newTestWorld(t)
		owner := w.withOwner()
		member := w.withEmployee()

		project := w.createProjectWithMode(
			owner,
			"Ritual UX Standard Entry",
			uniqueProjectKey("RUXS"),
			rpcv1.CollaborationMode_COLLABORATION_MODE_STANDARD,
		)
		w.addProjectMember(owner, project.ID, member.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		planningTask := w.createTask(owner, project.ID, "Plan the morning checklist", project.Levels[0].Id)
		fetchedProject := w.getProject(member, project.ID)
		tasks := w.listTasks(member, project.ID)

		t.Run("the project keeps standard collaboration mode for planning-first routing", func(t *testing.T) {
			require.NotNil(t, fetchedProject)
			assert.Equal(t, rpcv1.CollaborationMode_COLLABORATION_MODE_STANDARD, fetchedProject.CollaborationMode)
		})

		t.Run("ritual-only navigation data is absent from the standard task list", func(t *testing.T) {
			require.Len(t, tasks, 1)
			assert.Equal(t, planningTask.Id, tasks[0].Id)
			assert.Equal(t, rpcv1.TaskKind_TASK_KIND_STANDARD, tasks[0].TaskKind)
			assert.Empty(t, tasks[0].RitualDefinitionId)
		})
	})

	t.Run("when a worker opens a ritual project without an explicit view", func(t *testing.T) {
		// FR-001, FR-003, FR-005, FR-006, FR-007, FR-021, Phase 3 / T011
		w := newTestWorld(t)
		owner := w.withOwner()
		worker := w.withEmployee()

		project := w.createProjectWithMode(
			owner,
			"Ritual UX Worker Entry",
			uniqueProjectKey("RUXR"),
			rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL,
		)
		w.addProjectMember(owner, project.ID, worker.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		rejectedDefinition := w.createRitualDefinitionWithAssigneesAndRequirements(
			owner,
			project.ID,
			"Retry Fire Door Check",
			dailyRecurrenceRule(),
			[]string{worker.ID.String()},
			[]*rpcv1.CreateEvidenceRequirementInput{{
				Name:          "Fire door note",
				EvidenceTypes: []rpcv1.EvidenceType{rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE},
				IsRequired:    true,
				ApprovalMode:  rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL,
			}},
		)
		pendingDefinition := w.createRitualDefinitionWithAssigneesAndRequirements(
			owner,
			project.ID,
			"Pending Review Valve Check",
			dailyRecurrenceRule(),
			[]string{worker.ID.String()},
			[]*rpcv1.CreateEvidenceRequirementInput{{
				Name:          "Valve reading note",
				EvidenceTypes: []rpcv1.EvidenceType{rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE},
				IsRequired:    true,
				ApprovalMode:  rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL,
			}},
		)
		w.generateRitualInstances(owner)

		workerRitualTasks := w.listTasksWithKind(worker, project.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))
		rejectedTask := findTaskByRitualDefinitionID(workerRitualTasks, rejectedDefinition.Id)
		pendingTask := findTaskByRitualDefinitionID(workerRitualTasks, pendingDefinition.Id)
		require.NotNil(t, rejectedTask)
		require.NotNil(t, pendingTask)

		rejectedSubmission := w.submitTextEvidence(worker, rejectedTask.Id, rejectedDefinition.EvidenceRequirements[0].Id, "Door photo was blurry")
		w.rejectEvidence(owner, rejectedSubmission.Id, "Upload a readable note for the fire door.")
		w.submitTextEvidence(worker, pendingTask.Id, pendingDefinition.EvidenceRequirements[0].Id, "Valve reading submitted")
		rejectedSubmissions := w.listEvidenceSubmissions(worker, rejectedTask.Id)
		pendingSubmissions := w.listEvidenceSubmissions(worker, pendingTask.Id)

		t.Run("the project exposes ritual collaboration mode so clients can default to Today", func(t *testing.T) {
			fetchedProject := w.getProject(worker, project.ID)
			require.NotNil(t, fetchedProject)
			assert.Equal(t, rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL, fetchedProject.CollaborationMode)
		})

		t.Run("needs-resubmission entries remain visible as live ritual instances", func(t *testing.T) {
			assert.Equal(t, rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE, rejectedTask.TaskKind)
			require.NotEmpty(t, rejectedSubmissions)
			assert.Equal(t, rpcv1.ApprovalStatus_APPROVAL_STATUS_REJECTED, rejectedSubmissions[0].ApprovalStatus)
		})

		t.Run("pending-review items remain visible as secondary evidence progress on the live instance", func(t *testing.T) {
			require.NotEmpty(t, pendingSubmissions)
			assert.Equal(t, rpcv1.ApprovalStatus_APPROVAL_STATUS_PENDING_REVIEW, pendingSubmissions[0].ApprovalStatus)
		})

		t.Run("opening a ritual row resolves to the live instance task instead of the ritual template", func(t *testing.T) {
			require.NotNil(t, rejectedTask)
			instance := w.getTask(worker, rejectedTask.Id)
			submissions := w.listEvidenceSubmissions(worker, rejectedTask.Id)

			require.NotNil(t, instance)
			assert.Equal(t, rejectedTask.Id, instance.Id)
			assert.Equal(t, rejectedDefinition.Id, instance.RitualDefinitionId)
			require.NotEmpty(t, submissions)
			assert.Equal(t, rejectedDefinition.EvidenceRequirements[0].Id, submissions[0].EvidenceRequirementId)
		})
	})

	t.Run("when an owner or reviewer opens a ritual project", func(t *testing.T) {
		// FR-008, FR-009, FR-010, FR-011
		t.Run("today review health calendar and worklist are exposed as distinct ritual surfaces", func(t *testing.T) {
			w := newTestWorld(t)
			owner := w.withOwner()
			reviewer := w.withEmployee()
			worker := w.withEmployee()

			project := w.createProjectWithMode(
				owner,
				"Ritual UX Owner Surfaces",
				uniqueProjectKey("RUXO"),
				rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL,
			)
			w.addProjectMember(owner, project.ID, reviewer.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_ADMIN)
			w.addProjectMember(owner, project.ID, worker.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

			definition := w.createRitualDefinitionWithAssigneesAndRequirements(
				owner,
				project.ID,
				"Owner Review Separation",
				dailyRecurrenceRule(),
				[]string{worker.ID.String()},
				[]*rpcv1.CreateEvidenceRequirementInput{{
					Name:          "Supervisor proof note",
					EvidenceTypes: []rpcv1.EvidenceType{rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE},
					IsRequired:    true,
					ApprovalMode:  rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL,
				}},
			)
			w.generateRitualInstances(owner)

			ritualTasks := w.listTasksWithKind(owner, project.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))
			task := findTaskByRitualDefinitionID(ritualTasks, definition.Id)
			require.NotNil(t, task)

			w.submitTextEvidence(worker, task.Id, definition.EvidenceRequirements[0].Id, "Pending owner review")
			submissions := w.listEvidenceSubmissions(reviewer, task.Id)
			now := time.Now()
			start := timestamppb.New(now.AddDate(0, 0, -7))
			end := timestamppb.New(now.AddDate(0, 0, 7))
			health := w.getOperationalHealth(owner, project.ID, start, end)
			compliance := w.getRitualComplianceSummary(owner, project.ID, definition.Id, start, end)

			t.Run("review work is represented as pending evidence on the live ritual instance", func(t *testing.T) {
				require.NotEmpty(t, submissions)
				assert.True(t, hasSubmissionWithStatus(submissions, rpcv1.ApprovalStatus_APPROVAL_STATUS_PENDING_REVIEW))
				assert.Equal(t, task.Id, submissions[0].TaskId)
			})

			t.Run("health data is available as a separate project-level aggregate", func(t *testing.T) {
				require.NotNil(t, health)
				assert.Equal(t, project.ID, health.Summary.ProjectId)
				assert.GreaterOrEqual(t, health.Summary.TotalInstances, int32(1))
				require.NotEmpty(t, health.RitualDetails)
			})

			t.Run("calendar and worklist can both be hydrated from the ritual instance list", func(t *testing.T) {
				require.NotEmpty(t, ritualTasks)
				assert.Equal(t, rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE, task.TaskKind)
				assert.NotEmpty(t, task.RitualDefinitionId)
				assert.NotNil(t, task.ScheduledDate)
				assert.NotNil(t, task.CompletionDeadline)
			})

			t.Run("compliance summaries stay separate from pending review instance data", func(t *testing.T) {
				assert.GreaterOrEqual(t, len(compliance), 0)
			})
		})

		t.Run("worklist behaves as the primary ritual browsing surface instead of the generic board", func(t *testing.T) {
			w := newTestWorld(t)
			owner := w.withOwner()
			worker := w.withEmployee()

			project := w.createProjectWithMode(
				owner,
				"Ritual UX Worklist",
				uniqueProjectKey("RUXW"),
				rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL,
			)
			w.addProjectMember(owner, project.ID, worker.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

			definition := w.createRitualDefinitionWithAssigneesAndRequirements(
				owner,
				project.ID,
				"Primary Worklist Ritual",
				dailyRecurrenceRule(),
				[]string{worker.ID.String()},
				nil,
			)
			w.generateRitualInstances(owner)

			ritualTasks := w.listTasks(owner, project.ID)
			task := findTaskByRitualDefinitionID(ritualTasks, definition.Id)

			t.Run("the list endpoint returns live ritual instances for ritual browsing", func(t *testing.T) {
				require.NotNil(t, task)
				assert.Equal(t, rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE, task.TaskKind)
				assert.Equal(t, definition.Id, task.RitualDefinitionId)
			})

			t.Run("the ritual project does not require separate standard work items to browse operations", func(t *testing.T) {
				require.NotEmpty(t, ritualTasks)
				for _, listedTask := range ritualTasks {
					assert.Equal(t, rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE, listedTask.TaskKind)
				}
			})
		})

		t.Run("if a board is available it is not the default route or first ritual call to action", func(t *testing.T) {
			w := newTestWorld(t)
			owner := w.withOwner()

			project := w.createProjectWithMode(
				owner,
				"Ritual UX Board Secondary",
				uniqueProjectKey("RUXB"),
				rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL,
			)

			fetchedProject := w.getProject(owner, project.ID)
			ritualTasks := w.listTasks(owner, project.ID)

			t.Run("the project collaboration mode remains ritual for client-side default routing", func(t *testing.T) {
				require.NotNil(t, fetchedProject)
				assert.Equal(t, rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL, fetchedProject.CollaborationMode)
			})

			t.Run("no standard planning task is synthesized as the primary ritual browsing artifact", func(t *testing.T) {
				for _, listedTask := range ritualTasks {
					assert.NotEqual(t, rpcv1.TaskKind_TASK_KIND_STANDARD, listedTask.TaskKind)
				}
			})
		})

		t.Run("template management remains separate from live submission actions", func(t *testing.T) {
			w := newTestWorld(t)
			owner := w.withOwner()
			worker := w.withEmployee()

			project := w.createProjectWithMode(
				owner,
				"Ritual UX Templates",
				uniqueProjectKey("RUXT"),
				rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL,
			)
			w.addProjectMember(owner, project.ID, worker.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

			definition := w.createRitualDefinitionWithAssigneesAndRequirements(
				owner,
				project.ID,
				"Separate Template Definition",
				dailyRecurrenceRule(),
				[]string{worker.ID.String()},
				[]*rpcv1.CreateEvidenceRequirementInput{{
					Name:          "Template evidence",
					EvidenceTypes: []rpcv1.EvidenceType{rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE},
					IsRequired:    true,
					ApprovalMode:  rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL,
				}},
			)
			w.generateRitualInstances(owner)

			definitions := w.listRitualDefinitions(owner, project.ID, false)
			require.Len(t, definitions, 1)
			instanceTasks := w.listTasksWithKind(owner, project.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))
			instance := findTaskByRitualDefinitionID(instanceTasks, definition.Id)
			require.NotNil(t, instance)
			fetchedDefinition := w.getRitualDefinition(owner, definition.Id)

			t.Run("template management is backed by ritual definition records", func(t *testing.T) {
				require.NotNil(t, fetchedDefinition)
				assert.Equal(t, definition.Id, fetchedDefinition.Id)
				assert.Equal(t, project.ID, fetchedDefinition.ProjectId)
			})

			t.Run("live submission actions remain attached to generated ritual instance tasks", func(t *testing.T) {
				assert.Equal(t, definition.Id, instance.RitualDefinitionId)
				assert.NotEqual(t, definition.Id, instance.Id)
				assert.Equal(t, rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE, instance.TaskKind)
			})
		})
	})

	t.Run("when a member opens a mixed project without an explicit view", func(t *testing.T) {
		// FR-004, FR-012, FR-013, FR-014, FR-015
		t.Run("the project opens on Overview with both planned-work risk and routine-operations exceptions", func(t *testing.T) {
			w := newTestWorld(t)
			owner := w.withOwner()
			member := w.withEmployee()

			project := w.createProjectWithMode(
				owner,
				"Ritual UX Mixed Overview",
				uniqueProjectKey("RUXM"),
				rpcv1.CollaborationMode_COLLABORATION_MODE_MIXED,
			)
			w.addProjectMember(owner, project.ID, member.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
			planningTask := w.createTask(owner, project.ID, "Plan weekly stocktake", project.Levels[0].Id)
			definition := w.createRitualDefinitionWithAssigneesAndRequirements(
				owner,
				project.ID,
				"Daily Equipment Check",
				dailyRecurrenceRule(),
				[]string{member.ID.String()},
				nil,
			)
			w.generateRitualInstances(owner)

			fetchedProject := w.getProject(member, project.ID)
			listedTasks := w.listTasks(member, project.ID)
			ritualTasks := w.listTasksWithKind(member, project.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))
			ritualTask := findTaskByRitualDefinitionID(ritualTasks, definition.Id)
			listedPlanningTask := w.getTask(member, planningTask.Id)

			require.NotNil(t, fetchedProject)
			require.NotNil(t, ritualTask)
			require.NotNil(t, listedPlanningTask)
			assert.Equal(t, rpcv1.CollaborationMode_COLLABORATION_MODE_MIXED, fetchedProject.CollaborationMode)
			assert.Len(t, listedTasks, len(ritualTasks)+1)
			assert.Equal(t, planningTask.Id, listedPlanningTask.Id)
			assert.Equal(t, rpcv1.TaskKind_TASK_KIND_STANDARD, listedPlanningTask.TaskKind)
			assert.Equal(t, rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE, ritualTask.TaskKind)
			assert.Equal(t, definition.Id, ritualTask.RitualDefinitionId)
		})

		t.Run("Today keeps standard tasks and ritual runs in separate labeled sections", func(t *testing.T) {
			w := newTestWorld(t)
			owner := w.withOwner()
			member := w.withEmployee()

			project := w.createProjectWithMode(
				owner,
				"Ritual UX Mixed Today",
				uniqueProjectKey("RUXD"),
				rpcv1.CollaborationMode_COLLABORATION_MODE_MIXED,
			)
			w.addProjectMember(owner, project.ID, member.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
			standardTask := w.createTask(owner, project.ID, "Prepare delivery board", project.Levels[0].Id)
			definition := w.createRitualDefinitionWithAssigneesAndRequirements(
				owner,
				project.ID,
				"Daily Fridge Temperature",
				dailyRecurrenceRule(),
				[]string{member.ID.String()},
				nil,
			)
			w.generateRitualInstances(owner)

			listedTasks := w.listTasks(member, project.ID)
			ritualTasks := w.listTasksWithKind(member, project.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))
			ritualTask := findTaskByRitualDefinitionID(ritualTasks, definition.Id)

			require.NotNil(t, ritualTask)
			assert.NotEmpty(t, listedTasks)
			assert.Equal(t, rpcv1.TaskKind_TASK_KIND_STANDARD, standardTask.TaskKind)
			assert.Equal(t, rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE, ritualTask.TaskKind)
			assert.Empty(t, standardTask.RitualDefinitionId)
			assert.NotEmpty(t, ritualTask.RitualDefinitionId)
		})

		t.Run("planned work and routine operations route to non-overlapping destinations", func(t *testing.T) {
			w := newTestWorld(t)
			owner := w.withOwner()
			member := w.withEmployee()

			project := w.createProjectWithMode(
				owner,
				"Ritual UX Mixed Routing",
				uniqueProjectKey("RUXP"),
				rpcv1.CollaborationMode_COLLABORATION_MODE_MIXED,
			)
			w.addProjectMember(owner, project.ID, member.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
			planningTask := w.createTask(owner, project.ID, "Plan next inventory cycle", project.Levels[0].Id)
			definition := w.createRitualDefinitionWithAssigneesAndRequirements(
				owner,
				project.ID,
				"Morning Safety Sweep",
				dailyRecurrenceRule(),
				[]string{member.ID.String()},
				nil,
			)
			w.generateRitualInstances(owner)

			standardInstance := w.getTask(member, planningTask.Id)
			ritualTask := findTaskByRitualDefinitionID(
				w.listTasksWithKind(member, project.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE)),
				definition.Id,
			)

			require.NotNil(t, standardInstance)
			require.NotNil(t, ritualTask)
			assert.Equal(t, rpcv1.TaskKind_TASK_KIND_STANDARD, standardInstance.TaskKind)
			assert.Empty(t, standardInstance.RitualDefinitionId)
			assert.Equal(t, rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE, ritualTask.TaskKind)
			assert.Equal(t, definition.Id, ritualTask.RitualDefinitionId)
			assert.NotEqual(t, standardInstance.Id, ritualTask.Id)
		})
	})

	t.Run("when a mobile worker or reviewer opens a ritual instance from tasks or alerts", func(t *testing.T) {
		// FR-016, FR-017, FR-018, FR-019
		t.Run("the mobile flow lands on the live instance with an obvious next proof action", func(t *testing.T) {
			w := newTestWorld(t)
			owner := w.withOwner()
			worker := w.withEmployee()

			project := w.createProjectWithMode(
				owner,
				"Ritual UX Mobile Worker Flow",
				uniqueProjectKey("RUXM"),
				rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL,
			)
			w.addProjectMember(owner, project.ID, worker.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
			definition := w.createRitualDefinitionWithAssigneesAndRequirements(
				owner,
				project.ID,
				"Opening Checklist",
				dailyRecurrenceRule(),
				[]string{worker.ID.String()},
				[]*rpcv1.CreateEvidenceRequirementInput{{
					Name:          "Door note",
					EvidenceTypes: []rpcv1.EvidenceType{rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE},
					IsRequired:    true,
					ApprovalMode:  rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL,
				}},
			)
			w.generateRitualInstances(owner)

			task := findTaskByRitualDefinitionID(
				w.listTasksWithKind(worker, project.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE)),
				definition.Id,
			)
			require.NotNil(t, task)

			submission := w.submitTextEvidence(worker, task.Id, definition.EvidenceRequirements[0].Id, "Door opened at 06:00")
			w.rejectEvidence(owner, submission.Id, "Add the actual door condition.")

			instance := w.getTask(worker, task.Id)
			submissions := w.listEvidenceSubmissions(worker, task.Id)

			require.NotNil(t, instance)
			require.Len(t, submissions, 1)
			assert.Equal(t, rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE, instance.TaskKind)
			assert.Equal(t, definition.Id, instance.RitualDefinitionId)
			assert.Equal(t, definition.EvidenceRequirements[0].Id, submissions[0].EvidenceRequirementId)
			assert.Equal(t, rpcv1.ApprovalStatus_APPROVAL_STATUS_REJECTED, submissions[0].ApprovalStatus)
			if assert.NotNil(t, instance.EvidenceProgress) {
				assert.Equal(t, int32(1), instance.EvidenceProgress.RejectedCount)
				assert.False(t, instance.EvidenceProgress.AllRequiredApproved)
			}
		})

		t.Run("alert-driven review entry highlights the pending submission instead of a backlog queue", func(t *testing.T) {
			w := newTestWorld(t)
			owner := w.withOwner()
			worker := w.withEmployee()

			project := w.createProjectWithMode(
				owner,
				"Ritual UX Review Alert",
				uniqueProjectKey("RUXA"),
				rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL,
			)
			w.addProjectMember(owner, project.ID, worker.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
			definition := w.createRitualDefinitionWithAssigneesAndRequirements(
				owner,
				project.ID,
				"Cooling Log",
				dailyRecurrenceRule(),
				[]string{worker.ID.String()},
				[]*rpcv1.CreateEvidenceRequirementInput{{
					Name:          "Temperature note",
					EvidenceTypes: []rpcv1.EvidenceType{rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE},
					IsRequired:    true,
					ApprovalMode:  rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL,
				}},
			)
			w.generateRitualInstances(owner)

			task := findTaskByRitualDefinitionID(
				w.listTasksWithKind(owner, project.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE)),
				definition.Id,
			)
			require.NotNil(t, task)
			w.watchTask(owner, task.Id)

			w.submitTextEvidence(worker, task.Id, definition.EvidenceRequirements[0].Id, "3.9C at 08:15")
			notification := waitForNotificationType(w, owner, "evidence_submitted")
			instance := w.getTask(owner, task.Id)
			submissions := w.listEvidenceSubmissions(owner, task.Id)

			require.NotNil(t, notification)
			require.NotNil(t, notification.NavigationTarget)
			require.NotNil(t, instance)
			require.Len(t, submissions, 1)
			assert.Equal(t, "task", notification.NavigationTarget.ResourceType)
			assert.Equal(t, task.Id, notification.NavigationTarget.ResourceId)
			assert.Equal(t, project.ID, notification.ActionData["projectId"])
			assert.Equal(t, task.Id, notification.ActionData["taskId"])
			assert.Equal(t, rpcv1.ApprovalStatus_APPROVAL_STATUS_PENDING_REVIEW, submissions[0].ApprovalStatus)
			if assert.NotNil(t, instance.EvidenceProgress) {
				assert.Equal(t, int32(1), instance.EvidenceProgress.PendingReviewCount)
			}
		})

		t.Run("dual-role users see separate proof and review sections", func(t *testing.T) {
			w := newTestWorld(t)
			owner := w.withOwner()
			worker := w.withEmployee()

			project := w.createProjectWithMode(
				owner,
				"Ritual UX Dual Role",
				uniqueProjectKey("RUXU"),
				rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL,
			)
			w.addProjectMember(owner, project.ID, worker.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
			definition := w.createRitualDefinitionWithAssigneesAndRequirements(
				owner,
				project.ID,
				"Close-down Checks",
				dailyRecurrenceRule(),
				[]string{owner.ID.String(), worker.ID.String()},
				[]*rpcv1.CreateEvidenceRequirementInput{
					{
						Name:          "Exit note",
						EvidenceTypes: []rpcv1.EvidenceType{rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE},
						IsRequired:    true,
						ApprovalMode:  rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL,
					},
					{
						Name:          "Alarm note",
						EvidenceTypes: []rpcv1.EvidenceType{rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE},
						IsRequired:    true,
						ApprovalMode:  rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL,
					},
				},
			)
			w.generateRitualInstances(owner)

			task := findTaskByRitualDefinitionID(
				w.listTasksWithKind(owner, project.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE)),
				definition.Id,
			)
			require.NotNil(t, task)

			w.submitTextEvidence(worker, task.Id, definition.EvidenceRequirements[0].Id, "Worker finished exit checks")
			instance := w.getTask(owner, task.Id)
			submissions := w.listEvidenceSubmissions(owner, task.Id)
			assigneeIDs := make([]string, 0, len(instance.Assignees))
			for _, assignee := range instance.Assignees {
				assigneeIDs = append(assigneeIDs, assignee.EmployeeId)
			}

			require.NotNil(t, instance)
			require.Len(t, submissions, 1)
			assert.Contains(t, assigneeIDs, owner.ID.String())
			assert.Contains(t, assigneeIDs, worker.ID.String())
			assert.Equal(t, worker.ID.String(), submissions[0].SubmittedByEmployeeId)
			assert.Equal(t, rpcv1.ApprovalStatus_APPROVAL_STATUS_PENDING_REVIEW, submissions[0].ApprovalStatus)
			assert.Len(t, definition.EvidenceRequirements, 2)
			assert.NotEqual(t, definition.EvidenceRequirements[0].Id, definition.EvidenceRequirements[1].Id)
			assert.Equal(t, definition.EvidenceRequirements[0].Id, submissions[0].EvidenceRequirementId)
		})
	})

	t.Run("when the ritual instance is skipped detached or already completed", func(t *testing.T) {
		// FR-020
		t.Run("instance-specific exceptional context is preserved across task and notification entry", func(t *testing.T) {
			w := newTestWorld(t)
			owner := w.withOwner()

			project := w.createProjectWithMode(
				owner,
				"Ritual UX Exceptional Context",
				uniqueProjectKey("RUXE"),
				rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL,
			)
			definition := w.createRitualDefinition(owner, project.ID, "Exceptional Sweep", dailyRecurrenceRule())
			w.generateRitualInstances(owner)

			skippedTask := findTaskByRitualDefinitionID(
				w.listTasksWithKind(owner, project.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE)),
				definition.Id,
			)
			require.NotNil(t, skippedTask)

			updatedSkippedTask, err := w.skipRitualInstance(owner, skippedTask.Id, "Site closed for maintenance")
			require.NoError(t, err)

			detachedDefinition := w.createRitualDefinition(owner, project.ID, "Detached Sweep", dailyRecurrenceRule())
			w.generateRitualInstances(owner)
			detachedTask := findTaskByRitualDefinitionID(
				w.listTasksWithKind(owner, project.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE)),
				detachedDefinition.Id,
			)
			require.NotNil(t, detachedTask)
			w.getTask(owner, detachedTask.Id)
			w.changeRitualDefinitionSchedule(owner, detachedDefinition.Id, weeklyRecurrenceRule())

			refreshedSkippedTask := w.getTask(owner, skippedTask.Id)
			refreshedDetachedTask := w.getTask(owner, detachedTask.Id)
			listedTasks := w.listTasks(owner, project.ID)
			listedTaskIDs := make([]string, 0, len(listedTasks))
			for _, task := range listedTasks {
				listedTaskIDs = append(listedTaskIDs, task.Id)
			}

			require.NotNil(t, refreshedSkippedTask)
			require.NotNil(t, refreshedDetachedTask)
			assert.Equal(t, "Site closed for maintenance", updatedSkippedTask.SkipReason)
			assert.Equal(t, "Site closed for maintenance", refreshedSkippedTask.SkipReason)
			assert.True(t, refreshedDetachedTask.DetachedFromRitual)
			assert.Equal(t, rpcv1.TaskKind_TASK_KIND_STANDARD, refreshedDetachedTask.TaskKind)
			assert.Empty(t, refreshedDetachedTask.RitualDefinitionId)
			assert.Contains(t, listedTaskIDs, refreshedSkippedTask.Id)
			assert.Contains(t, listedTaskIDs, refreshedDetachedTask.Id)
		})
	})
}
