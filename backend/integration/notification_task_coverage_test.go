package integration

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// TestNotificationTaskCoverage validates that task-driven notifications carry
// the correct policy_key, source_category, and navigation_target fields, and
// that actor-exclusion and recipient eligibility rules are respected.
func TestNotificationTaskCoverage(t *testing.T) {

	t.Run("when a task is assigned to an employee", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		assignee := w.withEmployee()

		proj := w.createProject(owner, "TaskCoverage Assign", uniqueProjectKey("TCA"))
		level0 := levelByDepth(proj.Levels, 0)
		require.NotNil(t, level0)

		w.addProjectMember(owner, proj.ID, assignee.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		task := w.createTask(owner, proj.ID, "Assignable Task", level0.Id)

		time.Sleep(200 * time.Millisecond)
		beforeAssignee := w.listNotifications(assignee, false)
		beforeOwner := w.listNotifications(owner, false)

		w.assignTask(owner, task.Id, assignee.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE)
		time.Sleep(300 * time.Millisecond)

		afterAssignee := w.listNotifications(assignee, false)
		afterOwner := w.listNotifications(owner, false)

		t.Run("assignee receives task_assigned notification", func(t *testing.T) {
			assert.Greater(t, len(afterAssignee), len(beforeAssignee), "assignee should receive notification")
		})

		t.Run("actor owner does NOT receive own assignment notification", func(t *testing.T) {
			assert.Equal(t, len(beforeOwner), len(afterOwner), "owner/actor should not get own notification")
		})

		t.Run("the notification carries policy_key=task_assignment", func(t *testing.T) {
			all := w.listNotifications(assignee, false)
			if len(all) > len(beforeAssignee) {
				newest := all[0]
				assert.Equal(t, "task_assignment", newest.PolicyKey,
					"task assignment notification must use task_assignment policy key")
			}
		})

		t.Run("the notification carries source_category=system (V2: direct-targeted)", func(t *testing.T) {
			all := w.listNotifications(assignee, false)
			if len(all) > len(beforeAssignee) {
				newest := all[0]
				assert.Equal(t, "system", newest.SourceCategory)
			}
		})

		t.Run("the notification carries navigation_target pointing to the task", func(t *testing.T) {
			all := w.listNotifications(assignee, false)
			if len(all) > len(beforeAssignee) {
				newest := all[0]
				require.NotNil(t, newest.NavigationTarget, "notification must carry navigation_target")
				assert.Equal(t, "projects", newest.NavigationTarget.Domain)
				assert.Equal(t, "task", newest.NavigationTarget.ResourceType)
				assert.Equal(t, task.Id, newest.NavigationTarget.ResourceId)
			}
		})

		t.Run("notification has pending acknowledgement_status", func(t *testing.T) {
			all := w.listNotifications(assignee, false)
			if len(all) > len(beforeAssignee) {
				newest := all[0]
				assert.Equal(t, "pending", newest.AcknowledgementStatus)
			}
		})
	})

	t.Run("when a task status changes and watcher is not the actor", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		emps := w.withEmployees(2)
		watcher, actor := emps[0], emps[1]

		proj := w.createProject(owner, "TaskCoverage Status", uniqueProjectKey("TCS"))
		level0 := levelByDepth(proj.Levels, 0)
		require.NotNil(t, level0)

		w.addProjectMember(owner, proj.ID, watcher.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		w.addProjectMember(owner, proj.ID, actor.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		task := w.createTask(owner, proj.ID, "Status Change Task", level0.Id)
		w.watchTask(watcher, task.Id)

		inProgressState := stateByCategory(proj.States, rpcv1.StateCategory_STATE_CATEGORY_IN_PROGRESS)
		require.NotNil(t, inProgressState)

		time.Sleep(200 * time.Millisecond)
		beforeWatcher := w.listNotifications(watcher, false)
		beforeActor := w.listNotifications(actor, false)

		w.moveTask(actor, task.Id, inProgressState.Id)
		time.Sleep(300 * time.Millisecond)

		afterWatcher := w.listNotifications(watcher, false)
		afterActor := w.listNotifications(actor, false)

		t.Run("watcher receives task_status_changed notification", func(t *testing.T) {
			assert.Greater(t, len(afterWatcher), len(beforeWatcher), "watcher should receive notification")
		})

		t.Run("actor does NOT receive own status-change notification", func(t *testing.T) {
			assert.Equal(t, len(beforeActor), len(afterActor), "actor should not get own notification")
		})

		t.Run("the notification carries policy_key=task_status", func(t *testing.T) {
			all := w.listNotifications(watcher, false)
			if len(all) > len(beforeWatcher) {
				newest := all[0]
				assert.Equal(t, "task_status", newest.PolicyKey)
			}
		})

		t.Run("the notification carries navigation_target with task resource_id", func(t *testing.T) {
			all := w.listNotifications(watcher, false)
			if len(all) > len(beforeWatcher) {
				newest := all[0]
				require.NotNil(t, newest.NavigationTarget)
				assert.Equal(t, "projects", newest.NavigationTarget.Domain)
				assert.Equal(t, "task", newest.NavigationTarget.ResourceType)
				assert.Equal(t, task.Id, newest.NavigationTarget.ResourceId)
			}
		})

		_ = owner
	})

	t.Run("when a task has multiple assignees and status changes", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		emps := w.withEmployees(3)
		alice, bob, charlie := emps[0], emps[1], emps[2]

		proj := w.createProject(owner, "TaskCoverage Multi", uniqueProjectKey("TCM"))
		level0 := levelByDepth(proj.Levels, 0)
		require.NotNil(t, level0)

		w.addProjectMember(owner, proj.ID, alice.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		w.addProjectMember(owner, proj.ID, bob.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		w.addProjectMember(owner, proj.ID, charlie.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		task := w.createTask(owner, proj.ID, "Multi-assignee Task", level0.Id)
		w.assignTask(owner, task.Id, alice.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE)
		w.assignTask(owner, task.Id, bob.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE)

		inProgressState := stateByCategory(proj.States, rpcv1.StateCategory_STATE_CATEGORY_IN_PROGRESS)
		require.NotNil(t, inProgressState)

		time.Sleep(300 * time.Millisecond)
		beforeAlice := w.listNotifications(alice, false)
		beforeBob := w.listNotifications(bob, false)
		beforeCharlie := w.listNotifications(charlie, false)

		w.moveTask(charlie, task.Id, inProgressState.Id)
		time.Sleep(300 * time.Millisecond)

		afterAlice := w.listNotifications(alice, false)
		afterBob := w.listNotifications(bob, false)
		afterCharlie := w.listNotifications(charlie, false)

		t.Run("assignee alice receives notification", func(t *testing.T) {
			assert.Greater(t, len(afterAlice), len(beforeAlice), "alice should receive notification")
		})

		t.Run("assignee bob receives notification", func(t *testing.T) {
			assert.Greater(t, len(afterBob), len(beforeBob), "bob should receive notification")
		})

		t.Run("actor charlie does NOT receive notification", func(t *testing.T) {
			assert.Equal(t, len(beforeCharlie), len(afterCharlie), "charlie/actor should not get own notification")
		})

		_ = owner
	})
}
