package integration

// TestNotificationV2TaskSubscription validates V2 task parent-subscription bundle semantics.
//
// These tests describe the V2 behavior where following a task subscribes a user
// to routine activity from the task record, its discussion channel, and its description
// document — all through a single parent-resource subscription.
//
// V2 implementation:
//   - task_status_changed via watchTask: PASSES (watcher → V2 subscription sync)
//   - task comments notifying task subscribers: PASSES (chat bridge via resource_surface)
//   - task_description_modified: PASSES (version_logic bridge via resource_surface)
//   - unfollow stops task discussion: PASSES (V2 eligibility filtering via subscription_state)
//   - comment-driven subscription: PASSES (chat bridge auto-subscribes commenter)
//   - task_assigned direct target: PASSES
//   - resource_surface population: PASSES (task creation registers surfaces)

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nvcnvn/tech-office/backend/internal/notification"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

func TestNotificationV2TaskSubscription(t *testing.T) {

	t.Run("when a user follows a task", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		watcher := w.withEmployee()
		actor := w.withEmployee()

		project := w.createProject(owner, "V2 Task Bundle", uniqueProjectKey("V2TB"))
		level0 := levelByDepth(project.Levels, 0)
		require.NotNil(t, level0)
		w.addProjectMember(owner, project.ID, watcher.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		w.addProjectMember(owner, project.ID, actor.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		task := w.createTask(owner, project.ID, "V2 Bundle Task", level0.Id)
		w.watchTask(watcher, task.Id)
		time.Sleep(100 * time.Millisecond)

		t.Run("when task status changes", func(t *testing.T) {
			// PASSES: existing watcher → V2 subscription path notifies on status change.
			inProgress := stateByCategory(project.States, rpcv1.StateCategory_STATE_CATEGORY_IN_PROGRESS)
			require.NotNil(t, inProgress)
			w.moveTask(actor, task.Id, inProgress.Id)
			time.Sleep(300 * time.Millisecond)

			n := findNotificationByNavigationResource(
				w.listNotifications(watcher, false), "projects",
				notification.NotificationTypeTaskStatusChanged, task.Id)

			t.Run("the watcher receives task_status_changed", func(t *testing.T) {
				require.NotNil(t, n, "watcher should receive task_status_changed")
				assert.Equal(t, notification.PolicyKeyTaskStatus, n.PolicyKey)
				assert.Equal(t, notification.SourceCategoryActivity, n.SourceCategory)
			})
		})

		t.Run("when a comment is posted to the task discussion channel", func(t *testing.T) {
			// V2: The chat bridge detects task discussion channels and emits task_commented
			// to parent-task subscribers via resource_surface inheritance.
			task = w.getTask(watcher, task.Id) // refresh to get ChannelId
			if task.ChannelId == nil {
				t.Skip("task has no discussion channel; skipping comment routing test")
			}

			// Ensure actor is a channel member so they can post messages.
			w.inviteToChannel(owner, *task.ChannelId, actor.ID)

			before := countMatchingNotificationsByResource(
				w.listNotifications(watcher, false), "projects",
				notification.NotificationTypeTaskCommented, task.Id)

			w.sendTaskComment(actor, task, "V2 test comment on task")
			time.Sleep(300 * time.Millisecond)

			after := countMatchingNotificationsByResource(
				w.listNotifications(watcher, false), "projects",
				notification.NotificationTypeTaskCommented, task.Id)

			t.Run("the task subscriber receives task_commented via parent subscription", func(t *testing.T) {
				assert.Greater(t, after, before,
					"task_commented should reach parent-task subscribers via V2 bridge")
			})
		})

		t.Run("when the task description document is edited", func(t *testing.T) {
			// V2: Editing a task's description document should notify parent-task subscribers
			// with task_description_modified via the resource_surface bridge.
			task = w.getTask(watcher, task.Id)
			if task.DescriptionDocumentId == nil {
				t.Skip("task has no description document; skipping description-modified test")
			}

			descDocID := *task.DescriptionDocumentId

			// Grant the actor write access to the description document.
			w.setDocumentAccess(owner, descDocID, actor.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_WRITE_UPDATE)

			before := countMatchingNotificationsByResource(
				w.listNotifications(watcher, false), "projects",
				notification.NotificationTypeTaskDescriptionModified, task.Id)

			w.updateDocument(actor, descDocID,
				`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"V2 description edit"}]}]}`)
			time.Sleep(300 * time.Millisecond)

			after := countMatchingNotificationsByResource(
				w.listNotifications(watcher, false), "projects",
				notification.NotificationTypeTaskDescriptionModified, task.Id)

			t.Run("the task subscriber receives task_description_modified", func(t *testing.T) {
				assert.Greater(t, after, before,
					"task_description_modified should reach parent-task subscribers via V2 bridge")
			})
		})
	})

	t.Run("when a user unfollows a task", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		watcher := w.withEmployee()
		actor := w.withEmployee()

		project := w.createProject(owner, "V2 Task Unfollow", uniqueProjectKey("V2TU"))
		level0 := levelByDepth(project.Levels, 0)
		require.NotNil(t, level0)
		w.addProjectMember(owner, project.ID, watcher.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		w.addProjectMember(owner, project.ID, actor.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		task := w.createTask(owner, project.ID, "Unfollow Bundle Task", level0.Id)
		w.watchTask(watcher, task.Id)
		time.Sleep(50 * time.Millisecond)
		w.unwatchTask(watcher, task.Id)
		time.Sleep(50 * time.Millisecond)

		t.Run("when task status changes after unfollow", func(t *testing.T) {
			// PASSES: existing watcher mechanism respects unwatchTask.
			before := countMatchingNotificationsByResource(
				w.listNotifications(watcher, false), "projects",
				notification.NotificationTypeTaskStatusChanged, task.Id)

			doneState := stateByCategory(project.States, rpcv1.StateCategory_STATE_CATEGORY_DONE)
			require.NotNil(t, doneState)
			w.moveTask(actor, task.Id, doneState.Id)
			time.Sleep(300 * time.Millisecond)

			after := countMatchingNotificationsByResource(
				w.listNotifications(watcher, false), "projects",
				notification.NotificationTypeTaskStatusChanged, task.Id)

			t.Run("routine task status notifications stop", func(t *testing.T) {
				assert.Equal(t, before, after, "unfollowed user should not receive task_status_changed")
			})
		})

		t.Run("when a task comment is posted after unfollow", func(t *testing.T) {
			// V2: Unfollow (subscription_state=unfollowed) prevents task_commented delivery.
			task = w.getTask(watcher, task.Id)
			if task.ChannelId == nil {
				t.Skip("task has no discussion channel")
			}

			// Ensure actor can post to the task channel.
			w.inviteToChannel(owner, *task.ChannelId, actor.ID)

			before := countMatchingNotificationsByResource(
				w.listNotifications(watcher, false), "projects",
				notification.NotificationTypeTaskCommented, task.Id)

			w.sendTaskComment(actor, task, "Comment after unwatch")
			time.Sleep(300 * time.Millisecond)

			after := countMatchingNotificationsByResource(
				w.listNotifications(watcher, false), "projects",
				notification.NotificationTypeTaskCommented, task.Id)

			t.Run("task discussion notifications stop", func(t *testing.T) {
				assert.Equal(t, before, after,
					"unfollowed task subscriber should not receive task_commented")
			})
		})
	})

	t.Run("when a user comments on a task", func(t *testing.T) {
		// V2 contract: commenting on a task discussion channel should record a 'commented'
		// subscription reason on the parent task, so the commenter receives future task activity.
		// The existing watcher mechanism subscribes via join; V2 uses the resource_subscription table.
		w := newTestWorld(t)
		owner := w.withOwner()
		commenter := w.withEmployee()

		project := w.createProject(owner, "V2 Task Comment Subscribe", uniqueProjectKey("V2CS"))
		level0 := levelByDepth(project.Levels, 0)
		require.NotNil(t, level0)
		w.addProjectMember(owner, project.ID, commenter.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		task := w.createTask(owner, project.ID, "Comment Subscribe Task", level0.Id)
		task = w.getTask(commenter, task.Id)
		if task.ChannelId == nil {
			t.Skip("task has no discussion channel; skipping comment-subscribe test")
		}

		// Ensure commenter can post to the task channel.
		w.inviteToChannel(owner, *task.ChannelId, commenter.ID)

		// Commenter has no prior subscription
		_, _, foundBefore := w.queryResourceSubscription(commenter.ID, notification.ResourceDomainTask, task.Id)

		w.sendTaskComment(commenter, task, "Commenting to subscribe to V2 task")
		time.Sleep(300 * time.Millisecond)

		state, _, found := w.queryResourceSubscription(commenter.ID, notification.ResourceDomainTask, task.Id)
		reasons := w.queryResourceSubscriptionReasons(commenter.ID, notification.ResourceDomainTask, task.Id)

		t.Run("the commenter becomes subscribed to the parent task", func(t *testing.T) {
			if foundBefore {
				t.Skip("commenter already had a prior task subscription; cannot assert subscribe-on-comment")
			}
			// V2: Sending a message to a task channel auto-subscribes with 'commented' reason.
			assert.True(t, found,
				"commenter should have a task subscription after posting to task discussion")
			if found {
				assert.Equal(t, notification.ResourceSubscriptionStateActive, state)
				assert.Contains(t, reasons, notification.ResourceSubscriptionReasonCommented)
			}
		})
	})

	t.Run("when a task is assigned", func(t *testing.T) {
		// PASSES: existing assignTask path notifies assignee with task_assigned (direct target).
		w := newTestWorld(t)
		owner := w.withOwner()
		assignee := w.withEmployee()

		project := w.createProject(owner, "V2 Assignment", uniqueProjectKey("V2AG"))
		level0 := levelByDepth(project.Levels, 0)
		require.NotNil(t, level0)
		w.addProjectMember(owner, project.ID, assignee.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		task := w.createTask(owner, project.ID, "V2 Assign Task", level0.Id)
		w.assignTask(owner, task.Id, assignee.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE)
		time.Sleep(300 * time.Millisecond)

		n := findNotificationByNavigationResource(
			w.listNotifications(assignee, false), "projects",
			notification.NotificationTypeTaskAssigned, task.Id)

		t.Run("the assignee receives task_assigned notification", func(t *testing.T) {
			require.NotNil(t, n, "assignee should receive task_assigned notification")
			assert.Equal(t, notification.PolicyKeyTaskAssignment, n.PolicyKey)
			assert.Equal(t, notification.SourceCategorySystem, n.SourceCategory)
		})

		t.Run("the assignee does NOT receive a notification for their own self-assignment", func(t *testing.T) {
			// Self-assignment should be suppressed; the notification is only relevant when
			// the actor is different from the assignee.
			//
			// Arrange: a fresh task assigned to owner by owner themselves
			w2 := newTestWorld(t)
			selfOwner := w2.withOwner()
			project2 := w2.createProject(selfOwner, "V2 Self-Assign", uniqueProjectKey("V2SA"))
			level := levelByDepth(project2.Levels, 0)
			require.NotNil(t, level)

			task2 := w2.createTask(selfOwner, project2.ID, "Self-assign Task", level.Id)
			w2.assignTask(selfOwner, task2.Id, selfOwner.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE)
			time.Sleep(300 * time.Millisecond)

			n2 := findNotificationByNavigationResource(
				w2.listNotifications(selfOwner, false), "projects",
				notification.NotificationTypeTaskAssigned, task2.Id)
			assert.Nil(t, n2, "actor should not receive task_assigned when they assign themselves")
		})
	})

	t.Run("when a task creates resource surfaces", func(t *testing.T) {
		// V2 schema contract: task creation should register surface rows in
		// notification.resource_surface linking the parent task to:
		//   - its discussion channel (surface_type=task_discussion, surface_domain=chat_channel)
		//   - its description document (surface_type=task_description, surface_domain=document)
		w := newTestWorld(t)
		owner := w.withOwner()

		project := w.createProject(owner, "V2 Surface Task", uniqueProjectKey("V2SR"))
		level0 := levelByDepth(project.Levels, 0)
		require.NotNil(t, level0)

		task := w.createTask(owner, project.ID, "Surface Task", level0.Id)
		time.Sleep(100 * time.Millisecond)

		surfaces := w.queryResourceSurfaces(notification.ResourceDomainTask, task.Id)

		t.Run("a task_discussion surface is registered", func(t *testing.T) {
			s := findSurfaceByType(surfaces, notification.ResourceSurfaceTypeTaskDiscussion)
			// V2: Task creation now populates resource_surface rows.
			assert.NotNil(t, s,
				"task should have a task_discussion surface row in notification.resource_surface")
			if s != nil {
				assert.Equal(t, notification.ResourceSurfaceDomainChatChannel, s.SurfaceDomain)
				assert.True(t, s.InheritsSubscription)
			}
		})

		t.Run("a task_description surface is registered", func(t *testing.T) {
			task = w.getTask(owner, task.Id)
			if task.DescriptionDocumentId == nil {
				t.Skip("task has no description document")
			}
			s := findSurfaceByType(surfaces, notification.ResourceSurfaceTypeTaskDescription)
			// V2: Task creation now populates resource_surface rows.
			assert.NotNil(t, s,
				"task should have a task_description surface row in notification.resource_surface")
			if s != nil {
				assert.Equal(t, notification.ResourceSurfaceDomainDocument, s.SurfaceDomain)
				assert.True(t, s.InheritsSubscription)
			}
		})
	})
}
