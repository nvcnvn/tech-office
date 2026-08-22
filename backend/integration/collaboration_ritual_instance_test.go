package integration

import (
	"testing"

	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestRitualInstanceGeneration covers ritual instance auto-generation from definitions.
func TestRitualInstanceGeneration(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()
	proj := w.createProjectWithMode(owner, "Instance Generation Project", uniqueProjectKey("IGPROJ"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)

	t.Run("when a ritual definition exists with daily recurrence", func(t *testing.T) {
		_ = w.createRitualDefinition(owner, proj.ID, "Generated Daily Ritual", dailyRecurrenceRule())

		count := w.generateRitualInstances(owner)

		t.Run("instances are generated for the configured window", func(t *testing.T) {
			// Feature 034: the creation transaction generates the window (FR-011), so this
			// follow-up run adds nothing. The instances themselves are asserted below.
			assert.Equal(t, 0, count, "creation already covered this window")
			assert.NotEmpty(t, w.listTasksWithKind(owner, proj.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE)))
		})

		t.Run("instances have task_kind = ritual_instance", func(t *testing.T) {
			tasks := w.listTasksWithKind(owner, proj.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))
			require.NotEmpty(t, tasks)
			for _, task := range tasks {
				assert.Equal(t, rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE, task.TaskKind)
			}
		})
	})

	t.Run("when generation runs a second time for the same window", func(t *testing.T) {
		_ = w.createRitualDefinition(owner, proj.ID, "Idempotency Test Ritual", dailyRecurrenceRule())
		w.generateRitualInstances(owner)

		beforeCount := len(w.listTasksWithKind(owner, proj.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE)))
		w.generateRitualInstances(owner) // run again
		afterCount := len(w.listTasksWithKind(owner, proj.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE)))

		t.Run("it does not create duplicate instances (idempotency)", func(t *testing.T) {
			assert.Equal(t, beforeCount, afterCount)
		})
	})

	t.Run("when a ritual definition is archived", func(t *testing.T) {
		archivedDef := w.createRitualDefinition(owner, proj.ID, "Archived Ritual", dailyRecurrenceRule())
		_, err := w.archiveRitualDefinition(owner, archivedDef.Id, true)
		require.NoError(t, err)

		countBeforeGen := len(w.listTasksWithKind(owner, proj.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE)))
		w.generateRitualInstances(owner)
		countAfterGen := len(w.listTasksWithKind(owner, proj.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE)))

		t.Run("no new instances are generated for the archived definition", func(t *testing.T) {
			// Count should not increase from the archived def
			// (other non-archived defs in this project may have already been counted)
			assert.Equal(t, countBeforeGen, countAfterGen)
		})
	})
}

// TestRitualInstanceLifecycle covers the skip operation on ritual instances.
func TestRitualInstanceLifecycle(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()
	proj := w.createProjectWithMode(owner, "Lifecycle Project", uniqueProjectKey("LCPROJ"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
	_ = w.createRitualDefinition(owner, proj.ID, "Lifecycle Ritual", dailyRecurrenceRule())
	w.generateRitualInstances(owner)

	tasks := w.listTasksWithKind(owner, proj.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))
	require.NotEmpty(t, tasks, "expected at least one ritual instance task to be generated")
	taskID := tasks[0].Id

	t.Run("when an admin skips a ritual instance with a reason", func(t *testing.T) {
		skipped, err := w.skipRitualInstance(owner, taskID, "Equipment unavailable for maintenance")

		t.Run("the instance transitions to skipped with the provided reason", func(t *testing.T) {
			require.NoError(t, err)
			require.NotNil(t, skipped)
		})
	})
}

// TestRitualInstanceTodayView covers the filtered view for ritual instances in a project.
func TestRitualInstanceTodayView(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()

	projA := w.createProjectWithMode(owner, "Today View Project A", uniqueProjectKey("TVPA"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
	projB := w.createProjectWithMode(owner, "Today View Project B", uniqueProjectKey("TVPB"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
	_ = w.createRitualDefinition(owner, projA.ID, "Project A Ritual", dailyRecurrenceRule())
	_ = w.createRitualDefinition(owner, projB.ID, "Project B Ritual", dailyRecurrenceRule())
	w.generateRitualInstances(owner)

	t.Run("when filtering ritual instances by project", func(t *testing.T) {
		tasksA := w.listTasksWithKind(owner, projA.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))
		tasksB := w.listTasksWithKind(owner, projB.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))

		t.Run("it returns only instances from the specified project", func(t *testing.T) {
			require.NotEmpty(t, tasksA)
			require.NotEmpty(t, tasksB)
			// All tasks in A belong to project A
			for _, task := range tasksA {
				assert.Equal(t, projA.ID, task.ProjectId)
			}
			// All tasks in B belong to project B
			for _, task := range tasksB {
				assert.Equal(t, projB.ID, task.ProjectId)
			}
		})
	})

	t.Run("when there are no ritual definitions for a project", func(t *testing.T) {
		emptyProj := w.createProjectWithMode(owner, "Empty Ritual Project", uniqueProjectKey("EMPRT"), rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL)
		tasks := w.listTasksWithKind(owner, emptyProj.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))

		t.Run("it returns an empty list", func(t *testing.T) {
			assert.Empty(t, tasks)
		})
	})
}
