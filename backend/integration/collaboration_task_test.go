package integration

import (
	"strings"
	"testing"

	"connectrpc.com/connect"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestTask covers task creation integrations, hierarchy validation, state transitions,
// filtering, assignees, and watch/unwatch.
func TestTask(t *testing.T) {
	w := newTestWorld(t)
	owner := w.withOwner()

	t.Run("when a task is created", func(t *testing.T) {
		proj := w.createProject(owner, "Task Test", uniqueProjectKey("TASK"))
		level0 := levelByDepth(proj.Levels, 0)
		require.NotNil(t, level0)

		task := w.createTask(owner, proj.ID, "First Task", level0.Id)

		t.Run("it gets an auto-generated identifier", func(t *testing.T) {
			assert.NotEmpty(t, task.Id)
			assert.True(t, strings.HasPrefix(task.Identifier, proj.Key+"-"),
				"identifier should start with project key")
		})

		t.Run("it has an integrated chat channel", func(t *testing.T) {
			assert.NotNil(t, task.ChannelId, "task should have an associated chat channel")
		})

		t.Run("it has an integrated description document", func(t *testing.T) {
			assert.NotNil(t, task.DescriptionDocumentId, "task should have a description document")
		})
	})

	t.Run("when creating tasks with hierarchy", func(t *testing.T) {
		proj := w.createProject(owner, "Hierarchy Test", uniqueProjectKey("HIER"))
		level0 := levelByDepth(proj.Levels, 0)
		level1 := levelByDepth(proj.Levels, 1)
		level2 := levelByDepth(proj.Levels, 2)
		require.NotNil(t, level0)
		require.NotNil(t, level1)
		require.NotNil(t, level2)

		epic := w.createTask(owner, proj.ID, "Epic", level0.Id)

		t.Run("a valid child at deeper level succeeds", func(t *testing.T) {
			story := w.createChildTask(owner, proj.ID, "Story under Epic", level1.Id, epic.Id)
			assert.NotEmpty(t, story.Id)
			assert.Equal(t, epic.Id, *story.ParentTaskId)
		})

		t.Run("a child at the same level as parent is rejected", func(t *testing.T) {
			err := w.createChildTaskError(owner, proj.ID, "Bad Same Level", level0.Id, epic.Id)
			require.Error(t, err)
			assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
		})

		t.Run("a child at a shallower level than parent is rejected", func(t *testing.T) {
			story := w.createChildTask(owner, proj.ID, "Story", level1.Id, epic.Id)
			err := w.createChildTaskError(owner, proj.ID, "Epic under Story", level0.Id, story.Id)
			require.Error(t, err)
			assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
		})
	})

	t.Run("when moving a task to a different state", func(t *testing.T) {
		proj := w.createProject(owner, "Move Test", uniqueProjectKey("MOVE"))
		level0 := levelByDepth(proj.Levels, 0)
		require.NotNil(t, level0)

		inProgressState := stateByCategory(proj.States, rpcv1.StateCategory_STATE_CATEGORY_IN_PROGRESS)
		require.NotNil(t, inProgressState)

		task := w.createTask(owner, proj.ID, "Moving Task", level0.Id)

		t.Run("the state changes to the target state", func(t *testing.T) {
			w.moveTask(owner, task.Id, inProgressState.Id)
			updated := w.getTask(owner, task.Id)
			assert.Equal(t, inProgressState.Id, updated.StateId)
		})
	})

	t.Run("when assigning users to a task", func(t *testing.T) {
		proj := w.createProject(owner, "Assign Test", uniqueProjectKey("ASGN"))
		level0 := levelByDepth(proj.Levels, 0)
		require.NotNil(t, level0)

		employee := w.withEmployee()
		w.addProjectMember(owner, proj.ID, employee.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		task := w.createTask(owner, proj.ID, "Assigned Task", level0.Id)

		w.assignTask(owner, task.Id, employee.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE)
		w.assignTask(owner, task.Id, owner.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_REVIEWER)

		t.Run("the task has multiple assignees with different roles", func(t *testing.T) {
			fetched := w.getTask(owner, task.Id)
			require.Len(t, fetched.Assignees, 2)
			roles := map[rpcv1.TaskAssigneeRole]bool{}
			for _, a := range fetched.Assignees {
				roles[a.Role] = true
			}
			assert.True(t, roles[rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE])
			assert.True(t, roles[rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_REVIEWER])
		})
	})

	t.Run("when filtering tasks by state", func(t *testing.T) {
		proj := w.createProject(owner, "Filter Test", uniqueProjectKey("FILT"))
		level0 := levelByDepth(proj.Levels, 0)
		require.NotNil(t, level0)

		todoState := stateByCategory(proj.States, rpcv1.StateCategory_STATE_CATEGORY_TODO)
		ipState := stateByCategory(proj.States, rpcv1.StateCategory_STATE_CATEGORY_IN_PROGRESS)
		require.NotNil(t, todoState)
		require.NotNil(t, ipState)

		w.createTask(owner, proj.ID, "Todo Task", level0.Id)
		ipTask := w.createTask(owner, proj.ID, "IP Task", level0.Id)
		w.moveTask(owner, ipTask.Id, ipState.Id)

		t.Run("only tasks matching the filter are returned", func(t *testing.T) {
			tasks := w.listTasksWithFilter(owner, proj.ID, &ipState.Id, nil)
			require.Len(t, tasks, 1)
			assert.Equal(t, ipTask.Id, tasks[0].Id)
		})
	})

	t.Run("when watching and unwatching a task", func(t *testing.T) {
		proj := w.createProject(owner, "Watch Test", uniqueProjectKey("WTCH"))
		level0 := levelByDepth(proj.Levels, 0)
		require.NotNil(t, level0)
		task := w.createTask(owner, proj.ID, "Watchable Task", level0.Id)

		t.Run("watch and unwatch succeed without error", func(t *testing.T) {
			w.watchTask(owner, task.Id)
			w.unwatchTask(owner, task.Id)
		})
	})

	t.Run("when creating multiple tasks they get unique IDs", func(t *testing.T) {
		proj := w.createProject(owner, "Multi Test", uniqueProjectKey("MLTI"))
		level0 := levelByDepth(proj.Levels, 0)
		require.NotNil(t, level0)

		t1 := w.createTask(owner, proj.ID, "Task 1", level0.Id)
		t2 := w.createTask(owner, proj.ID, "Task 2", level0.Id)

		assert.NotEqual(t, t1.Id, t2.Id, "task IDs must be unique")
		assert.NotEqual(t, t1.Identifier, t2.Identifier, "identifiers must be sequential")
	})
}

// TestTaskKindFiltering covers filtering tasks by task_kind (standard vs ritual_instance).
func TestTaskKindFiltering(t *testing.T) {
	w := newTestWorld(t)
	owner := w.withOwner()

	// Set up a project that supports both standard and ritual tasks (mixed mode)
	proj := w.createProjectWithMode(owner, "TaskKind Filter Project", uniqueProjectKey("TKNDF"), rpcv1.CollaborationMode_COLLABORATION_MODE_MIXED)
	require.NotEmpty(t, proj.Levels, "expected at least one task level")
	levelID := proj.Levels[0].Id

	// Create a standard task
	standardTask := w.createTask(owner, proj.ID, "Standard Task for Kind Test", levelID)
	require.NotNil(t, standardTask)

	// Generate ritual instances
	_ = w.createRitualDefinition(owner, proj.ID, "Kind Filter Ritual", dailyRecurrenceRule())
	w.generateRitualInstances(owner)
	ritualInstances := w.listTasksWithKind(owner, proj.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))
	require.NotEmpty(t, ritualInstances)

	t.Run("when listing tasks without task_kind filter", func(t *testing.T) {
		allTasks := w.listTasksWithKind(owner, proj.ID, nil)

		t.Run("it returns both standard and ritual instance tasks", func(t *testing.T) {
			ids := make([]string, len(allTasks))
			for i, task := range allTasks {
				ids[i] = task.Id
			}
			assert.Contains(t, ids, standardTask.Id)
			assert.Contains(t, ids, ritualInstances[0].Id)
		})
	})

	t.Run("when listing tasks with task_kind = standard", func(t *testing.T) {
		standardTasks := w.listTasksWithKind(owner, proj.ID, ptr(rpcv1.TaskKind_TASK_KIND_STANDARD))

		t.Run("it returns only standard tasks", func(t *testing.T) {
			for _, task := range standardTasks {
				assert.Equal(t, rpcv1.TaskKind_TASK_KIND_STANDARD, task.TaskKind)
			}
			ids := make([]string, len(standardTasks))
			for i, task := range standardTasks {
				ids[i] = task.Id
			}
			assert.Contains(t, ids, standardTask.Id)
		})
	})

	t.Run("when listing tasks with task_kind = ritual_instance", func(t *testing.T) {
		rituals := w.listTasksWithKind(owner, proj.ID, ptr(rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE))

		t.Run("it returns only ritual instances", func(t *testing.T) {
			for _, task := range rituals {
				assert.Equal(t, rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE, task.TaskKind)
			}
			assert.NotContains(t, func() []string {
				ids := make([]string, len(rituals))
				for i, task := range rituals {
					ids[i] = task.Id
				}
				return ids
			}(), standardTask.Id)
		})
	})
}
