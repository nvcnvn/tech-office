package integration

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

func TestNotificationTasks(t *testing.T) {
	t.Parallel()

	t.Run("FT-02 task assignment emits task_assigned type", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		alice := w.withEmployee()

		proj := w.createProject(owner, "TaskAssign Notif", uniqueProjectKey("TAN"))
		level0 := levelByDepth(proj.Levels, 0)
		require.NotNil(t, level0)

		w.addProjectMember(owner, proj.ID, alice.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		task := w.createTask(owner, proj.ID, "Assignable Task", level0.Id)
		w.watchTask(alice, task.Id)

		time.Sleep(200 * time.Millisecond)
		beforeAlice := w.listNotifications(alice, false)

		w.assignTask(owner, task.Id, alice.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE)
		time.Sleep(300 * time.Millisecond)

		afterAlice := w.listNotifications(alice, false)

		assert.Greater(t, len(afterAlice), len(beforeAlice), "alice should have new notification after assignment")
		if len(afterAlice) > len(beforeAlice) {
			newest := afterAlice[0]
			assert.Equal(t, "task_assigned", newest.NotificationType)
			assert.Equal(t, "projects", newest.SourceDomain)
		}
	})

	t.Run("FT-02 task status change emits task_status_changed type", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		alice := w.withEmployee()

		proj := w.createProject(owner, "TaskMove Notif", uniqueProjectKey("TMN"))
		level0 := levelByDepth(proj.Levels, 0)
		require.NotNil(t, level0)

		w.addProjectMember(owner, proj.ID, alice.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		task := w.createTask(owner, proj.ID, "Movable Task", level0.Id)
		w.watchTask(alice, task.Id)

		time.Sleep(200 * time.Millisecond)
		beforeAlice := w.listNotifications(alice, false)

		inProgressState := stateByCategory(proj.States, rpcv1.StateCategory_STATE_CATEGORY_IN_PROGRESS)
		require.NotNil(t, inProgressState)

		w.moveTask(owner, task.Id, inProgressState.Id)
		time.Sleep(300 * time.Millisecond)

		afterAlice := w.listNotifications(alice, false)

		assert.Greater(t, len(afterAlice), len(beforeAlice), "alice should have notification after status change")
		if len(afterAlice) > len(beforeAlice) {
			newest := afterAlice[0]
			assert.Equal(t, "task_status_changed", newest.NotificationType)
			assert.Equal(t, "projects", newest.SourceDomain)
		}
	})

	t.Run("FT-04 watcher receives notifications non-watcher does not", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		emps := w.withEmployees(2)
		alice, bob := emps[0], emps[1]

		proj := w.createProject(owner, "Watch Notif", uniqueProjectKey("WNF"))
		level0 := levelByDepth(proj.Levels, 0)
		require.NotNil(t, level0)

		w.addProjectMember(owner, proj.ID, alice.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		w.addProjectMember(owner, proj.ID, bob.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		task := w.createTask(owner, proj.ID, "Watch Test Task", level0.Id)
		w.watchTask(alice, task.Id)

		time.Sleep(200 * time.Millisecond)
		beforeAlice := w.listNotifications(alice, false)
		beforeBob := w.listNotifications(bob, false)

		inProgressState := stateByCategory(proj.States, rpcv1.StateCategory_STATE_CATEGORY_IN_PROGRESS)
		require.NotNil(t, inProgressState)

		w.moveTask(owner, task.Id, inProgressState.Id)
		time.Sleep(300 * time.Millisecond)

		afterAlice := w.listNotifications(alice, false)
		afterBob := w.listNotifications(bob, false)

		t.Run("alice watcher receives notification", func(t *testing.T) {
			assert.Greater(t, len(afterAlice), len(beforeAlice))
		})

		t.Run("bob non-watcher does NOT receive notification", func(t *testing.T) {
			assert.Equal(t, len(beforeBob), len(afterBob), "bob should not get notification")
		})
	})

	t.Run("FT-04 unwatch stops notifications", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		alice := w.withEmployee()

		proj := w.createProject(owner, "Unwatch Notif", uniqueProjectKey("UWN"))
		level0 := levelByDepth(proj.Levels, 0)
		require.NotNil(t, level0)

		w.addProjectMember(owner, proj.ID, alice.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		task := w.createTask(owner, proj.ID, "Unwatch Test Task", level0.Id)
		w.watchTask(alice, task.Id)
		time.Sleep(100 * time.Millisecond)

		beforeWatch := w.listNotifications(alice, false)

		inProgressState := stateByCategory(proj.States, rpcv1.StateCategory_STATE_CATEGORY_IN_PROGRESS)
		require.NotNil(t, inProgressState)

		w.moveTask(owner, task.Id, inProgressState.Id)
		time.Sleep(300 * time.Millisecond)

		afterWatch := w.listNotifications(alice, false)
		assert.Greater(t, len(afterWatch), len(beforeWatch), "alice should get notification while watching")

		w.unwatchTask(alice, task.Id)
		time.Sleep(100 * time.Millisecond)

		beforeUnwatch := w.listNotifications(alice, false)

		doneState := stateByCategory(proj.States, rpcv1.StateCategory_STATE_CATEGORY_DONE)
		require.NotNil(t, doneState)

		w.moveTask(owner, task.Id, doneState.Id)
		time.Sleep(300 * time.Millisecond)

		afterUnwatch := w.listNotifications(alice, false)
		assert.Equal(t, len(beforeUnwatch), len(afterUnwatch), "alice should NOT get notification after unwatching")
	})
}
