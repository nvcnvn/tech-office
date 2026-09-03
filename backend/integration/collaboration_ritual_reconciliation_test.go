package integration

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/notification"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ---------------------------------------------------------------------------
// Arrange: a ritual instance whose deadline the test controls
// ---------------------------------------------------------------------------

// lateRitual is one generated ritual instance with a completion deadline the test chose,
// plus everything needed to assert on it afterwards.
type lateRitual struct {
	projectID    string
	taskID       string
	definitionID string
	requirements []*rpcv1.EvidenceRequirementDetail
}

// newLateRitual creates a ritual project, a definition with the given completion window
// and requirements, generates one instance, and rewrites that instance's deadline so the
// test decides how late it is. Generation would otherwise put the deadline a few hours
// from now, which is not a thing a test can assert against without sleeping.
func (w *testWorld) newLateRitual(
	owner testUser,
	assignees []testUser,
	completionWindowHours int32,
	deadline time.Time,
	requirements []*rpcv1.CreateEvidenceRequirementInput,
) lateRitual {
	w.t.Helper()

	proj := w.createProjectWithMode(owner, "Reconciliation Project", uniqueProjectKey("RECON"),
		rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)

	assigneeIDs := make([]string, 0, len(assignees))
	for _, a := range assignees {
		w.addProjectMember(owner, proj.ID, a.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		assigneeIDs = append(assigneeIDs, a.ID.String())
	}

	def := w.createRitualDefinitionWithAssigneesRequirementsAndWindow(
		owner, proj.ID, "Reconciliation Ritual", dailyRecurrenceRule(),
		completionWindowHours, assigneeIDs, requirements,
	)

	w.generateRitualInstances(owner)
	instances := w.listTasksWithKind(owner, proj.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))
	require.NotEmpty(w.t, instances, "expected the definition to generate at least one instance")

	// Keep exactly one instance in play. A daily rule generates a window's worth, and a
	// sweep that moved thirty instances would make every count assertion meaningless.
	kept := instances[0]
	for _, extra := range instances[1:] {
		w.detachRitualInstanceFromSweep(extra.Id)
	}

	w.setRitualDeadline(kept.Id, deadline)

	return lateRitual{
		projectID:    proj.ID,
		taskID:       kept.Id,
		definitionID: def.Id,
		requirements: def.EvidenceRequirements,
	}
}

// setRitualDeadline rewrites only an instance's completion deadline. Written directly
// because no RPC exposes it — the deadline is derived at generation time and is not
// user-editable, yet it is the single input the lateness rules read.
//
// scheduled_date is deliberately left alone: it is half of the uniqueness constraint that
// keeps one instance per definition per day, and moving it would make the fixture fight
// the schema for no gain.
func (w *testWorld) setRitualDeadline(taskID string, deadline time.Time) {
	w.t.Helper()
	_, err := globalDB.Exec(context.Background(),
		`UPDATE collaboration.task SET completion_deadline = $2::timestamptz WHERE id = $1`,
		dbuuid.MustParse(taskID), deadline)
	require.NoError(w.t, err)
}

// clearRitualDeadline models an instance with no completion deadline at all (FR-005).
func (w *testWorld) clearRitualDeadline(taskID string) {
	w.t.Helper()
	_, err := globalDB.Exec(context.Background(),
		`UPDATE collaboration.task SET completion_deadline = NULL WHERE id = $1`,
		dbuuid.MustParse(taskID))
	require.NoError(w.t, err)
}

// detachRitualInstanceFromSweep takes an instance out of the candidate set the way a user
// detaching it would, so surplus generated instances cannot pollute a pass's counts.
func (w *testWorld) detachRitualInstanceFromSweep(taskID string) {
	w.t.Helper()
	_, err := globalDB.Exec(context.Background(),
		`UPDATE collaboration.task SET detached_from_ritual = TRUE WHERE id = $1`,
		dbuuid.MustParse(taskID))
	require.NoError(w.t, err)
}

// deleteRitualStates removes a project's overdue and missed state rows, which is the
// cheapest way to make one organization's reconciliation fail without breaking the
// database for everyone else (scenario 14).
func (w *testWorld) deleteRitualStates(projectID string, categories ...string) {
	w.t.Helper()
	for _, category := range categories {
		_, err := globalDB.Exec(context.Background(),
			`DELETE FROM collaboration.project_state WHERE project_id = $1 AND category = $2`,
			dbuuid.MustParse(projectID), category)
		require.NoError(w.t, err)
	}
}

// ritualStateCategory reads the stored state category of an instance. This is the
// assertion that matters throughout: the feature's whole point is that lateness is a
// stored state rather than something a reader computes.
func (w *testWorld) ritualStateCategory(taskID string) string {
	w.t.Helper()
	var category string
	err := globalDB.QueryRow(context.Background(),
		`SELECT ps.category
		 FROM collaboration.task t
		 JOIN collaboration.project_state ps ON ps.id = t.state_id
		 WHERE t.id = $1`,
		dbuuid.MustParse(taskID)).Scan(&category)
	require.NoError(w.t, err)
	return category
}

// countNotificationsFor counts an employee's notifications of one type that name the given
// task. Counting by task rather than by listing the inbox keeps the assertion immune to
// whatever else the parallel test suite is publishing for that employee.
func (w *testWorld) countNotificationsFor(employeeID dbuuid.UUID, notificationType, taskID string) int {
	w.t.Helper()
	var count int
	err := globalDB.QueryRow(context.Background(),
		`SELECT count(*)
		 FROM notification.notification n
		 JOIN notification.notification_recipient r
		   ON r.notification_id = n.id AND r.organization_id = n.organization_id
		 WHERE r.employee_id = $1
		   AND n.notification_type = $2
		   AND n.action_data->>'taskId' = $3`,
		employeeID, notificationType, taskID).Scan(&count)
	require.NoError(w.t, err)
	return count
}

// notificationEnvelopeFor reads back the delivery envelope of the notification published
// for a task, so US4 can assert these alerts carry no special case.
func (w *testWorld) notificationEnvelopeFor(notificationType, taskID string) (priority int32, policyKey, deliveryClass, sourceDomain, focusIntent string) {
	w.t.Helper()
	err := globalDB.QueryRow(context.Background(),
		`SELECT n.priority, n.policy_key, n.delivery_class, n.source_domain, n.action_data->>'focusIntent'
		 FROM notification.notification n
		 WHERE n.notification_type = $1 AND n.action_data->>'taskId' = $2
		 LIMIT 1`,
		notificationType, taskID).Scan(&priority, &policyKey, &deliveryClass, &sourceDomain, &focusIntent)
	require.NoError(w.t, err)
	return
}

func requiredTextEvidence(name string) *rpcv1.CreateEvidenceRequirementInput {
	return &rpcv1.CreateEvidenceRequirementInput{
		Name:          name,
		EvidenceTypes: []rpcv1.EvidenceType{rpcv1.EvidenceType_EVIDENCE_TYPE_TEXT_NOTE},
		IsRequired:    true,
		ApprovalMode:  rpcv1.ApprovalMode_APPROVAL_MODE_MANUAL,
	}
}

// ---------------------------------------------------------------------------
// TestRitualReconciliation
// ---------------------------------------------------------------------------

func TestRitualReconciliation(t *testing.T) {
	t.Parallel()

	// ── Scenario 1, 2 ────────────────────────────────────────────────────────────
	t.Run("when a checklist's deadline passes with no evidence", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		owner := w.withOwner()
		worker := w.withEmployee()

		deadline := time.Now().Add(-2 * time.Hour)
		ritual := w.newLateRitual(owner, []testUser{worker}, 24, deadline,
			[]*rpcv1.CreateEvidenceRequirementInput{requiredTextEvidence("Photo of the checklist")})

		counts := w.reconcileOrganizationAt(owner, deadline.Add(time.Hour))

		t.Run("the instance is written into the overdue state", func(t *testing.T) {
			assert.Equal(t, "overdue", w.ritualStateCategory(ritual.taskID))
		})

		t.Run("the sweep reports the transition", func(t *testing.T) {
			assert.Equal(t, 1, counts.MarkedOverdue)
			assert.Equal(t, 1, counts.InstancesExamined)
		})

		t.Run("the assignee is told exactly once", func(t *testing.T) {
			assert.Equal(t, 1, w.countNotificationsFor(worker.ID, "ritual_instance_overdue", ritual.taskID))
		})

		t.Run("three further passes change nothing and notify nobody", func(t *testing.T) {
			for i := 0; i < 3; i++ {
				later := w.reconcileOrganizationAt(owner, deadline.Add(time.Duration(i+2)*time.Hour))
				assert.Zero(t, later.MarkedOverdue, "pass %d should have moved nothing into overdue", i+2)
			}
			assert.Equal(t, "overdue", w.ritualStateCategory(ritual.taskID))
			assert.Equal(t, 1, w.countNotificationsFor(worker.ID, "ritual_instance_overdue", ritual.taskID),
				"a repeated pass must not re-notify")
		})
	})

	// ── Scenario 3 ───────────────────────────────────────────────────────────────
	t.Run("when evidence arrives after an instance has gone overdue", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		owner := w.withOwner()
		worker := w.withEmployee()

		deadline := time.Now().Add(-2 * time.Hour)
		ritual := w.newLateRitual(owner, []testUser{worker}, 24, deadline,
			[]*rpcv1.CreateEvidenceRequirementInput{requiredTextEvidence("Closing note")})

		w.reconcileOrganizationAt(owner, deadline.Add(time.Hour))
		require.Equal(t, "overdue", w.ritualStateCategory(ritual.taskID))

		w.submitTextEvidence(worker, ritual.taskID, ritual.requirements[0].Id, "Done, late")

		t.Run("the evidence path takes the instance out of overdue", func(t *testing.T) {
			assert.Equal(t, "submitted", w.ritualStateCategory(ritual.taskID))
		})

		t.Run("a later pass no longer treats it as a candidate", func(t *testing.T) {
			before := w.ritualStateCategory(ritual.taskID)
			w.reconcileOrganizationAt(owner, deadline.Add(48*time.Hour))
			assert.Equal(t, before, w.ritualStateCategory(ritual.taskID),
				"a submitted instance is the reviewer's delay, not the worker's")
		})
	})

	// ── Scenario 4 ───────────────────────────────────────────────────────────────
	t.Run("when an instance is not late", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		owner := w.withOwner()
		worker := w.withEmployee()

		future := time.Now().Add(48 * time.Hour)
		ritual := w.newLateRitual(owner, []testUser{worker}, 24, future,
			[]*rpcv1.CreateEvidenceRequirementInput{requiredTextEvidence("Not yet due")})
		before := w.ritualStateCategory(ritual.taskID)

		w.reconcileOrganizationAt(owner, time.Now())

		t.Run("a future deadline is left alone", func(t *testing.T) {
			assert.Equal(t, before, w.ritualStateCategory(ritual.taskID))
			assert.Zero(t, w.countNotificationsFor(worker.ID, "ritual_instance_overdue", ritual.taskID))
		})

		t.Run("a NULL completion deadline is never late", func(t *testing.T) {
			w.clearRitualDeadline(ritual.taskID)
			w.reconcileOrganizationAt(owner, time.Now().AddDate(0, 0, 90))
			assert.Equal(t, before, w.ritualStateCategory(ritual.taskID))
			assert.Zero(t, w.countNotificationsFor(worker.ID, "ritual_instance_overdue", ritual.taskID))
		})
	})

	// ── Scenario 5 ───────────────────────────────────────────────────────────────
	t.Run("when only some required evidence was submitted before the deadline", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		owner := w.withOwner()
		worker := w.withEmployee()

		// The evidence lands while the instance is still on time, so it genuinely reaches
		// in_progress. Backdating the deadline first would let the evidence write itself
		// mark the instance overdue, and the test would prove nothing about the sweep.
		deadline := time.Now().Add(4 * time.Hour)
		ritual := w.newLateRitual(owner, []testUser{worker}, 24, deadline,
			[]*rpcv1.CreateEvidenceRequirementInput{
				requiredTextEvidence("First half"),
				requiredTextEvidence("Second half"),
			})
		w.submitTextEvidence(worker, ritual.taskID, ritual.requirements[0].Id, "Half done")
		require.Equal(t, "in_progress", w.ritualStateCategory(ritual.taskID))

		w.setRitualDeadline(ritual.taskID, time.Now().Add(-2*time.Hour))
		w.reconcileOrganizationAt(owner, time.Now())

		t.Run("partial progress does not hide lateness", func(t *testing.T) {
			assert.Equal(t, "overdue", w.ritualStateCategory(ritual.taskID),
				"one of two requirements past the deadline is overdue, not in_progress")
		})
	})

	// ── Scenario 12 ──────────────────────────────────────────────────────────────
	t.Run("when a submission was rejected before the deadline", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		owner := w.withOwner()
		worker := w.withEmployee()

		deadline := time.Now().Add(-2 * time.Hour)
		ritual := w.newLateRitual(owner, []testUser{worker}, 24, deadline,
			[]*rpcv1.CreateEvidenceRequirementInput{requiredTextEvidence("Rejected evidence")})

		sub := w.submitTextEvidence(worker, ritual.taskID, ritual.requirements[0].Id, "Blurry photo")
		w.rejectEvidence(owner, sub.Id, "Cannot read it")

		w.reconcileOrganizationAt(owner, deadline.Add(time.Hour))

		t.Run("a rejected submission does not shelter the instance", func(t *testing.T) {
			assert.Equal(t, "overdue", w.ritualStateCategory(ritual.taskID))
		})
	})

	// ── Scenario 13 ──────────────────────────────────────────────────────────────
	t.Run("when the ritual definition was archived after the instance was generated", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		owner := w.withOwner()
		worker := w.withEmployee()

		// Archiving soft-deletes instances still sitting in scheduled or todo, so the
		// instance that outlives its definition is one that had already been started —
		// which means the evidence has to land while the instance is still on time.
		ritual := w.newLateRitual(owner, []testUser{worker}, 24, time.Now().Add(4*time.Hour),
			[]*rpcv1.CreateEvidenceRequirementInput{
				requiredTextEvidence("First half"),
				requiredTextEvidence("Second half"),
			})
		w.submitTextEvidence(worker, ritual.taskID, ritual.requirements[0].Id, "Started before archival")
		require.Equal(t, "in_progress", w.ritualStateCategory(ritual.taskID))

		_, err := w.archiveRitualDefinition(owner, ritual.definitionID, true)
		require.NoError(t, err)

		w.setRitualDeadline(ritual.taskID, time.Now().Add(-2*time.Hour))
		w.reconcileOrganizationAt(owner, time.Now())

		t.Run("the instance is still reconciled", func(t *testing.T) {
			// Discovery goes through late instances, not active definitions. Reusing the
			// generation sweep's organization query would silently skip this instance.
			assert.Equal(t, "overdue", w.ritualStateCategory(ritual.taskID))
		})
	})

	// ── Scenario 16 ──────────────────────────────────────────────────────────────
	t.Run("when one organization holds more late instances than a pass may examine", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		owner := w.withOwner()
		worker := w.withEmployee()

		// The production bound is 500; generating that many instances per pass would make
		// the test minutes long for no extra coverage. What is asserted instead is the
		// property the bound exists for: ordering is by deadline ascending, so a pass
		// always drains the oldest backlog first and progress is strictly monotonic.
		const backlog = 12
		deadlines := make([]time.Time, backlog)
		base := time.Now().Add(-72 * time.Hour)

		proj := w.createProjectWithMode(owner, "Backlog Project", uniqueProjectKey("BKLOG"),
			rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
		w.addProjectMember(owner, proj.ID, worker.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		def := w.createRitualDefinitionWithAssigneesRequirementsAndWindow(
			owner, proj.ID, "Backlog Ritual", dailyRecurrenceRule(), 24*30,
			[]string{worker.ID.String()},
			[]*rpcv1.CreateEvidenceRequirementInput{requiredTextEvidence("Backlog evidence")},
		)
		require.NotNil(t, def)

		w.generateRitualInstances(owner)
		instances := w.listTasksWithKind(owner, proj.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))
		require.GreaterOrEqual(t, len(instances), backlog)

		taskIDs := make([]string, 0, backlog)
		for i, inst := range instances {
			if i >= backlog {
				w.detachRitualInstanceFromSweep(inst.Id)
				continue
			}
			deadlines[i] = base.Add(time.Duration(i) * time.Hour)
			w.setRitualDeadline(inst.Id, deadlines[i])
			taskIDs = append(taskIDs, inst.Id)
		}

		counts := w.reconcileOrganizationAt(owner, time.Now())

		t.Run("every late instance in the backlog is accounted for exactly once", func(t *testing.T) {
			assert.GreaterOrEqual(t, counts.InstancesExamined, backlog)
			for i, taskID := range taskIDs {
				assert.Equal(t, "overdue", w.ritualStateCategory(taskID),
					"instance %d (deadline %s) should be overdue", i, deadlines[i])
			}
		})

		t.Run("a second pass finds nothing left to move", func(t *testing.T) {
			second := w.reconcileOrganizationAt(owner, time.Now())
			for _, taskID := range taskIDs {
				assert.Equal(t, "overdue", w.ritualStateCategory(taskID))
			}
			assert.Zero(t, second.MarkedOverdue, "nothing is double-counted across passes")
		})

		t.Run("the candidate query returns them oldest deadline first", func(t *testing.T) {
			rows, err := globalQ.ListRitualInstancesForReconciliation(context.Background(), globalDB,
				&database.ListRitualInstancesForReconciliationParams{
					OrganizationID: owner.OrgID,
					Now:            pgtype.Timestamptz{Time: time.Now(), Valid: true},
					InstanceLimit:  5,
				})
			require.NoError(t, err)
			assert.LessOrEqual(t, len(rows), 5, "the pass is bounded")
			for i := 1; i < len(rows); i++ {
				assert.False(t, rows[i].CompletionDeadline.Time.Before(rows[i-1].CompletionDeadline.Time),
					"a partially drained backlog must progress strictly")
			}
		})
	})

	// ── Scenario 6, 8 ────────────────────────────────────────────────────────────
	t.Run("when the deadline and the whole completion window have passed", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		owner := w.withOwner()
		worker := w.withEmployee()
		reviewer := w.withEmployee()

		deadline := time.Now().Add(-4 * time.Hour)
		ritual := w.newLateRitual(owner, []testUser{worker}, 2, deadline,
			[]*rpcv1.CreateEvidenceRequirementInput{requiredTextEvidence("Never submitted")})
		w.addProjectMember(owner, ritual.projectID, reviewer.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		w.assignTask(owner, ritual.taskID, reviewer.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_REVIEWER)

		counts := w.reconcileOrganizationAt(owner, deadline.Add(3*time.Hour))

		t.Run("the instance becomes missed", func(t *testing.T) {
			assert.Equal(t, "missed", w.ritualStateCategory(ritual.taskID))
			assert.GreaterOrEqual(t, counts.MarkedMissed, 1)
		})

		t.Run("the assignee and the reviewer are each told once", func(t *testing.T) {
			assert.Equal(t, 1, w.countNotificationsFor(worker.ID, "ritual_instance_missed", ritual.taskID))
			assert.Equal(t, 1, w.countNotificationsFor(reviewer.ID, "ritual_instance_missed", ritual.taskID))
		})

		t.Run("missed is terminal", func(t *testing.T) {
			for i := 0; i < 3; i++ {
				later := w.reconcileOrganizationAt(owner, deadline.Add(time.Duration(4+i)*time.Hour))
				assert.Zero(t, later.MarkedMissed)
			}
			assert.Equal(t, "missed", w.ritualStateCategory(ritual.taskID))
			assert.Equal(t, 1, w.countNotificationsFor(worker.ID, "ritual_instance_missed", ritual.taskID))
			assert.Zero(t, w.countNotificationsFor(worker.ID, "ritual_instance_overdue", ritual.taskID),
				"an instance that was already past its grace window never pauses at overdue")
		})
	})

	// ── Scenario 9 ───────────────────────────────────────────────────────────────
	t.Run("when the deadline and grace both elapsed before any pass ran", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		owner := w.withOwner()
		worker := w.withEmployee()

		deadline := time.Now().Add(-30 * time.Hour)
		ritual := w.newLateRitual(owner, []testUser{worker}, 4, deadline,
			[]*rpcv1.CreateEvidenceRequirementInput{requiredTextEvidence("Long forgotten")})

		w.reconcileOrganizationAt(owner, time.Now())

		t.Run("one pass reaches missed without stopping at overdue", func(t *testing.T) {
			assert.Equal(t, "missed", w.ritualStateCategory(ritual.taskID))
			assert.Zero(t, w.countNotificationsFor(worker.ID, "ritual_instance_overdue", ritual.taskID))
			assert.Equal(t, 1, w.countNotificationsFor(worker.ID, "ritual_instance_missed", ritual.taskID))
		})
	})

	// ── Scenario 7 ───────────────────────────────────────────────────────────────
	t.Run("when a missed instance has no reviewer and no approver", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		owner := w.withOwner()
		admin := w.withEmployee()
		worker := w.withEmployee()

		deadline := time.Now().Add(-30 * time.Hour)
		ritual := w.newLateRitual(owner, []testUser{worker}, 4, deadline,
			[]*rpcv1.CreateEvidenceRequirementInput{requiredTextEvidence("Nobody reviews this")})
		w.addProjectMember(owner, ritual.projectID, admin.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_ADMIN)

		w.reconcileOrganizationAt(owner, time.Now())

		t.Run("the escalation reaches the project's owner and admin", func(t *testing.T) {
			assert.Equal(t, "missed", w.ritualStateCategory(ritual.taskID))
			assert.Equal(t, 1, w.countNotificationsFor(owner.ID, "ritual_instance_missed", ritual.taskID))
			assert.Equal(t, 1, w.countNotificationsFor(admin.ID, "ritual_instance_missed", ritual.taskID))
		})

		t.Run("the assignee is still told, once", func(t *testing.T) {
			assert.Equal(t, 1, w.countNotificationsFor(worker.ID, "ritual_instance_missed", ritual.taskID))
		})
	})

	t.Run("when a missed instance has no assignee at all", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		owner := w.withOwner()

		deadline := time.Now().Add(-30 * time.Hour)
		ritual := w.newLateRitual(owner, nil, 4, deadline,
			[]*rpcv1.CreateEvidenceRequirementInput{requiredTextEvidence("Unowned ritual")})

		w.reconcileOrganizationAt(owner, time.Now())

		t.Run("it still escalates to someone with authority", func(t *testing.T) {
			// This is the hole the escalation exists to close: an unassigned ritual
			// failing with nobody at all being told.
			assert.Equal(t, "missed", w.ritualStateCategory(ritual.taskID))
			assert.Equal(t, 1, w.countNotificationsFor(owner.ID, "ritual_instance_missed", ritual.taskID))
		})
	})

	t.Run("when an overdue instance has no assignee, reviewer or approver", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		owner := w.withOwner()

		deadline := time.Now().Add(-2 * time.Hour)
		ritual := w.newLateRitual(owner, nil, 24, deadline,
			[]*rpcv1.CreateEvidenceRequirementInput{requiredTextEvidence("Unowned ritual")})

		w.reconcileOrganizationAt(owner, deadline.Add(time.Hour))

		t.Run("the state changes but no overdue notification is produced", func(t *testing.T) {
			assert.Equal(t, "overdue", w.ritualStateCategory(ritual.taskID))
			assert.Zero(t, w.countNotificationsFor(owner.ID, "ritual_instance_overdue", ritual.taskID),
				"escalating every late checklist to project owners is how an alert becomes noise")
		})
	})

	// ── Scenario 10 ──────────────────────────────────────────────────────────────
	t.Run("when an instance already has an accounted-for outcome", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		owner := w.withOwner()
		worker := w.withEmployee()

		deadline := time.Now().Add(-30 * time.Hour)

		skipped := w.newLateRitual(owner, []testUser{worker}, 4, deadline,
			[]*rpcv1.CreateEvidenceRequirementInput{requiredTextEvidence("Skipped evidence")})
		_, err := w.skipRitualInstance(owner, skipped.taskID, "Site was closed")
		require.NoError(t, err)

		verified := w.newLateRitual(owner, []testUser{worker}, 4, deadline, nil)

		detached := w.newLateRitual(owner, []testUser{worker}, 4, deadline,
			[]*rpcv1.CreateEvidenceRequirementInput{requiredTextEvidence("Detached evidence")})
		w.detachRitualInstanceFromSweep(detached.taskID)
		detachedBefore := w.ritualStateCategory(detached.taskID)

		require.Equal(t, "skipped", w.ritualStateCategory(skipped.taskID))

		// A ritual with nothing to prove verifies on its first reconciliation rather than
		// going overdue — row 1 of the precedence table outranks lateness.
		w.reconcileOrganizationAt(owner, time.Now())
		require.Equal(t, "verified", w.ritualStateCategory(verified.taskID))

		w.reconcileOrganizationAt(owner, time.Now())

		t.Run("skipped, verified and detached instances are all left alone", func(t *testing.T) {
			assert.Equal(t, "skipped", w.ritualStateCategory(skipped.taskID))
			assert.Equal(t, "verified", w.ritualStateCategory(verified.taskID))
			assert.Equal(t, detachedBefore, w.ritualStateCategory(detached.taskID))
		})

		t.Run("and none of them produces a notification", func(t *testing.T) {
			for _, taskID := range []string{skipped.taskID, verified.taskID, detached.taskID} {
				assert.Zero(t, w.countNotificationsFor(worker.ID, "ritual_instance_overdue", taskID))
				assert.Zero(t, w.countNotificationsFor(worker.ID, "ritual_instance_missed", taskID))
			}
		})
	})

	// ── Scenario 11 ──────────────────────────────────────────────────────────────
	t.Run("when all required evidence is in and awaiting review past the deadline", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		owner := w.withOwner()
		worker := w.withEmployee()

		deadline := time.Now().Add(-30 * time.Hour)
		ritual := w.newLateRitual(owner, []testUser{worker}, 4, deadline,
			[]*rpcv1.CreateEvidenceRequirementInput{requiredTextEvidence("Submitted on time")})
		w.submitTextEvidence(worker, ritual.taskID, ritual.requirements[0].Id, "All done")
		require.Equal(t, "submitted", w.ritualStateCategory(ritual.taskID))

		w.reconcileOrganizationAt(owner, time.Now())

		t.Run("the reviewer's delay is not the worker's fault", func(t *testing.T) {
			assert.Equal(t, "submitted", w.ritualStateCategory(ritual.taskID))
			assert.Zero(t, w.countNotificationsFor(worker.ID, "ritual_instance_overdue", ritual.taskID))
			assert.Zero(t, w.countNotificationsFor(worker.ID, "ritual_instance_missed", ritual.taskID))
		})
	})

	// ── Scenario 15 ──────────────────────────────────────────────────────────────
	t.Run("when an instance's deadline passed longer ago than the backfill horizon", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		owner := w.withOwner()
		worker := w.withEmployee()

		deadline := time.Now().AddDate(0, 0, -30)
		ritual := w.newLateRitual(owner, []testUser{worker}, 4, deadline,
			[]*rpcv1.CreateEvidenceRequirementInput{requiredTextEvidence("Ancient history")})

		counts := w.reconcileOrganizationAt(owner, time.Now())

		t.Run("the state transition still happens", func(t *testing.T) {
			assert.Equal(t, "missed", w.ritualStateCategory(ritual.taskID))
			assert.GreaterOrEqual(t, counts.MarkedMissed, 1)
		})

		t.Run("but nobody is alerted about a month-old failure", func(t *testing.T) {
			// A first deployment must not alert every worker about every historical
			// instance at once; the alert would be muted before it did its job.
			assert.Zero(t, w.countNotificationsFor(worker.ID, "ritual_instance_missed", ritual.taskID))
			assert.Zero(t, w.countNotificationsFor(owner.ID, "ritual_instance_missed", ritual.taskID))
		})
	})

	// ── US4: the escalation respects how the person asked to be reached ──────────
	t.Run("when a lateness notification is published", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		owner := w.withOwner()
		worker := w.withEmployee()

		deadline := time.Now().Add(-2 * time.Hour)
		ritual := w.newLateRitual(owner, []testUser{worker}, 24, deadline,
			[]*rpcv1.CreateEvidenceRequirementInput{requiredTextEvidence("Envelope check")})

		w.reconcileOrganizationAt(owner, deadline.Add(time.Hour))
		require.Equal(t, 1, w.countNotificationsFor(worker.ID, "ritual_instance_overdue", ritual.taskID))

		t.Run("the overdue envelope is ordinary in every respect", func(t *testing.T) {
			priority, policyKey, deliveryClass, sourceDomain, focusIntent :=
				w.notificationEnvelopeFor("ritual_instance_overdue", ritual.taskID)

			// Ordinary priority is the whole of Story 4: because nothing here is special
			// cased, do-not-disturb, domain mute and presence all apply for free.
			assert.EqualValues(t, 2, priority, "must not use the always-deliver priority reserved for mentions and calls")
			assert.Equal(t, "task_status", policyKey)
			assert.Equal(t, "persistent", deliveryClass)
			assert.Equal(t, "projects", sourceDomain, "a recipient who muted the projects domain is covered by the generic path")
			assert.Equal(t, "submit_requirement", focusIntent, "overdue is still recoverable, so it opens ready to submit")
		})

		t.Run("the missed envelope opens read-only because the state is terminal", func(t *testing.T) {
			missed := w.newLateRitual(owner, []testUser{worker}, 2, deadline,
				[]*rpcv1.CreateEvidenceRequirementInput{requiredTextEvidence("Terminal")})
			w.reconcileOrganizationAt(owner, deadline.Add(4*time.Hour))
			require.Equal(t, "missed", w.ritualStateCategory(missed.taskID))

			priority, policyKey, deliveryClass, sourceDomain, focusIntent :=
				w.notificationEnvelopeFor("ritual_instance_missed", missed.taskID)

			assert.EqualValues(t, 2, priority)
			assert.Equal(t, "task_status", policyKey)
			assert.Equal(t, "persistent", deliveryClass)
			assert.Equal(t, "projects", sourceDomain)
			assert.Equal(t, "view_instance", focusIntent)
		})
	})
}

// TestRitualLatenessNotificationRespectsDoNotDisturb proves the property Story 4 asks for:
// the state change and the notification record survive a do-not-disturb window, while the
// push is suppressed — and this feature contains no code that knows do-not-disturb exists.
// It holds because the envelope is ordinary, not because anything special was written.
func TestRitualLatenessNotificationRespectsDoNotDisturb(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()
	worker := w.withEmployee()

	w.setDoNotDisturbAllDay(worker)

	deadline := time.Now().Add(-2 * time.Hour)
	ritual := w.newLateRitual(owner, []testUser{worker}, 24, deadline,
		[]*rpcv1.CreateEvidenceRequirementInput{requiredTextEvidence("DND evidence")})

	w.reconcileOrganizationAt(owner, deadline.Add(time.Hour))

	t.Run("the state change happens regardless of quiet hours", func(t *testing.T) {
		assert.Equal(t, "overdue", w.ritualStateCategory(ritual.taskID))
	})

	t.Run("the notification is still recorded so it is waiting when they look", func(t *testing.T) {
		assert.Equal(t, 1, w.countNotificationsFor(worker.ID, "ritual_instance_overdue", ritual.taskID))
	})

	t.Run("but the push is suppressed at the priority this feature publishes", func(t *testing.T) {
		priority, _, _, sourceDomain, _ := w.notificationEnvelopeFor("ritual_instance_overdue", ritual.taskID)
		assert.True(t, w.pushWouldBeSuppressed(worker, priority, sourceDomain),
			"an ordinary-priority notification must not push during a do-not-disturb window")
	})

	t.Run("and would not have been suppressed at the always-deliver priority", func(t *testing.T) {
		// The contrast is the point: this feature could have bypassed quiet hours by
		// choosing priority 0, and deliberately did not.
		assert.False(t, w.pushWouldBeSuppressed(worker, 0, "projects"))
	})
}

// TestRitualLatenessNotificationRespectsDomainMute covers the other half of the same
// property: a recipient who muted the projects domain is handled by the same generic path.
func TestRitualLatenessNotificationRespectsDomainMute(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()
	worker := w.withEmployee()

	w.muteNotificationDomain(worker, "projects")

	deadline := time.Now().Add(-2 * time.Hour)
	ritual := w.newLateRitual(owner, []testUser{worker}, 24, deadline,
		[]*rpcv1.CreateEvidenceRequirementInput{requiredTextEvidence("Muted domain evidence")})

	w.reconcileOrganizationAt(owner, deadline.Add(time.Hour))

	assert.Equal(t, "overdue", w.ritualStateCategory(ritual.taskID))
	assert.Equal(t, 1, w.countNotificationsFor(worker.ID, "ritual_instance_overdue", ritual.taskID),
		"muting a domain silences the push, it does not erase the record")
	assert.True(t, w.pushWouldBeSuppressed(worker, 2, "projects"))
}

// setDoNotDisturbAllDay puts an employee inside a do-not-disturb window that covers the
// whole day, so the test does not depend on what time it runs.
func (w *testWorld) setDoNotDisturbAllDay(employee testUser) {
	w.t.Helper()
	_, err := globalDB.Exec(context.Background(),
		`INSERT INTO notification.personal_preference (organization_id, employee_id, dnd_enabled, dnd_start, dnd_end)
		 VALUES ($1, $2, TRUE, TIME '00:00:00', TIME '23:59:59')
		 ON CONFLICT (organization_id, employee_id)
		 DO UPDATE SET dnd_enabled = TRUE, dnd_start = TIME '00:00:00', dnd_end = TIME '23:59:59'`,
		employee.OrgID, employee.ID)
	require.NoError(w.t, err)
}

// muteNotificationDomain mutes one source domain for an employee.
func (w *testWorld) muteNotificationDomain(employee testUser, domain string) {
	w.t.Helper()
	_, err := globalDB.Exec(context.Background(),
		`INSERT INTO notification.personal_preference (organization_id, employee_id, muted_domains)
		 VALUES ($1, $2, ARRAY[$3::text])
		 ON CONFLICT (organization_id, employee_id)
		 DO UPDATE SET muted_domains = ARRAY[$3::text]`,
		employee.OrgID, employee.ID, domain)
	require.NoError(w.t, err)
}

// pushWouldBeSuppressed asks the notification service's own routing rules what they would
// do with an envelope of this shape. Asserting the decision rather than the absence of a
// delivery row keeps the test meaningful: with no registered push token, "no push
// happened" would be true no matter what the rules said.
func (w *testWorld) pushWouldBeSuppressed(employee testUser, priority int32, sourceDomain string) bool {
	w.t.Helper()
	routing := notification.NewRoutingLogic(globalQ, nil, nil)
	suppressed, err := routing.ShouldSuppressPush(context.Background(), globalDB,
		employee.ID, employee.OrgID, priority, sourceDomain)
	require.NoError(w.t, err)
	return suppressed
}

// TestRitualReconciliationIsolatesOrganizationFailures drives the real platform-wide sweep,
// which is the only way to observe that one organization's failure does not abort the pass.
//
// It deliberately does NOT call t.Parallel(): a cross-organization sweep reconciles every
// other test's instances too, and a parallel run would let it perform transitions the
// owning test is trying to assert on.
func TestRitualReconciliationIsolatesOrganizationFailures(t *testing.T) {
	wBroken := newTestWorld(t)
	ownerBroken := wBroken.withOwner()
	workerBroken := wBroken.withEmployee()

	wHealthy := newTestWorld(t)
	ownerHealthy := wHealthy.withOwner()
	workerHealthy := wHealthy.withEmployee()

	deadline := time.Now().Add(-2 * time.Hour)
	broken := wBroken.newLateRitual(ownerBroken, []testUser{workerBroken}, 24, deadline,
		[]*rpcv1.CreateEvidenceRequirementInput{requiredTextEvidence("Broken org evidence")})
	healthy := wHealthy.newLateRitual(ownerHealthy, []testUser{workerHealthy}, 24, deadline,
		[]*rpcv1.CreateEvidenceRequirementInput{requiredTextEvidence("Healthy org evidence")})

	brokenBefore := wBroken.ritualStateCategory(broken.taskID)

	// The cheapest realistic fault: a project that has no state row to move the instance
	// into. Reconciliation for that organization can make no progress.
	wBroken.deleteRitualStates(broken.projectID, "overdue", "missed")

	out := wHealthy.runRitualReconciliationSweepAt(deadline.Add(time.Hour))

	t.Run("the pass returns without error and covers both organizations", func(t *testing.T) {
		assert.GreaterOrEqual(t, out.OrganizationsProcessed, 2)
	})

	t.Run("the healthy organization is reconciled", func(t *testing.T) {
		assert.Equal(t, "overdue", wHealthy.ritualStateCategory(healthy.taskID))
	})

	t.Run("the broken organization is left unchanged rather than half-written", func(t *testing.T) {
		assert.Equal(t, brokenBefore, wBroken.ritualStateCategory(broken.taskID))
		assert.Zero(t, wBroken.countNotificationsFor(workerBroken.ID, "ritual_instance_overdue", broken.taskID))
	})
}
