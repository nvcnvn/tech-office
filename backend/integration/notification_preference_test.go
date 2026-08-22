package integration

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

func TestNotificationPreferences(t *testing.T) {
	t.Parallel()

	t.Run("FT-01 task watcher default preference receives all notifications", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		alice := w.withEmployee()

		proj := w.createProject(owner, "Pref Default", uniqueProjectKey("PDT"))
		level0 := levelByDepth(proj.Levels, 0)
		require.NotNil(t, level0)

		w.addProjectMember(owner, proj.ID, alice.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		task := w.createTask(owner, proj.ID, "Default Pref Task", level0.Id)
		w.watchTask(alice, task.Id)

		time.Sleep(200 * time.Millisecond)
		before := w.listNotifications(alice, false)

		inProgressState := stateByCategory(proj.States, rpcv1.StateCategory_STATE_CATEGORY_IN_PROGRESS)
		require.NotNil(t, inProgressState)

		w.moveTask(owner, task.Id, inProgressState.Id)
		time.Sleep(300 * time.Millisecond)

		after := w.listNotifications(alice, false)
		assert.Greater(t, len(after), len(before), "watcher with default preference should receive notification")
	})

	t.Run("FT-13 multiple events produce separate notifications", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		alice := w.withEmployee()

		proj := w.createProject(owner, "MultiEvent", uniqueProjectKey("MEV"))
		level0 := levelByDepth(proj.Levels, 0)
		require.NotNil(t, level0)

		w.addProjectMember(owner, proj.ID, alice.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		task := w.createTask(owner, proj.ID, "Multi Event Task", level0.Id)
		w.watchTask(alice, task.Id)

		time.Sleep(200 * time.Millisecond)
		before := w.listNotifications(alice, false)

		w.assignTask(owner, task.Id, alice.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE)
		time.Sleep(200 * time.Millisecond)

		inProgressState := stateByCategory(proj.States, rpcv1.StateCategory_STATE_CATEGORY_IN_PROGRESS)
		require.NotNil(t, inProgressState)

		w.moveTask(owner, task.Id, inProgressState.Id)
		time.Sleep(300 * time.Millisecond)

		after := w.listNotifications(alice, false)
		newCount := len(after) - len(before)
		assert.GreaterOrEqual(t, newCount, 2, "two distinct events should produce at least 2 notifications")

		if newCount >= 2 {
			types := map[string]bool{}
			for i := 0; i < newCount; i++ {
				types[after[i].NotificationType] = true
			}
			assert.True(t, types["task_assigned"], "should have task_assigned notification")
			assert.True(t, types["task_status_changed"], "should have task_status_changed notification")
		}
	})

	t.Run("FT-15 chat notification preference regression", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		emps := w.withEmployees(2)
		alice, bob := emps[0], emps[1]

		channel := w.createChannel(owner, "Chat Regression Test", false)
		w.inviteToChannel(owner, channel, alice.ID)
		w.inviteToChannel(owner, channel, bob.ID)

		time.Sleep(200 * time.Millisecond)
		beforeAlice := w.listNotifications(alice, false)
		beforeBob := w.listNotifications(bob, false)

		w.sendMessage(owner, channel, "Hello from owner")
		time.Sleep(300 * time.Millisecond)

		afterAlice := w.listNotifications(alice, false)
		afterBob := w.listNotifications(bob, false)

		t.Run("alice does NOT receive chat message in inbox (V2: live-only)", func(t *testing.T) {
			assert.Equal(t, len(beforeAlice), len(afterAlice),
				"regular chat messages are live-only under V2")
		})

		t.Run("bob does NOT receive chat message in inbox (V2: live-only)", func(t *testing.T) {
			assert.Equal(t, len(beforeBob), len(afterBob),
				"regular chat messages are live-only under V2")
		})

		w.updateChannelNotificationPreference(alice, channel, rpcv1.NotificationPreference_NOTIFICATION_PREFERENCE_MUTED)
		time.Sleep(200 * time.Millisecond)

		beforeAliceMuted := w.listNotifications(alice, false)
		beforeBobAfterMute := w.listNotifications(bob, false)

		w.sendMessage(owner, channel, "Another message after mute")
		time.Sleep(300 * time.Millisecond)

		afterAliceMuted := w.listNotifications(alice, false)
		afterBobAfterMute := w.listNotifications(bob, false)

		t.Run("alice muted does NOT get new notification", func(t *testing.T) {
			assert.Equal(t, len(beforeAliceMuted), len(afterAliceMuted), "muted alice should not get notification")
		})

		t.Run("bob does NOT get inbox notification after alice mutes (V2: live-only)", func(t *testing.T) {
			assert.Equal(t, len(beforeBobAfterMute), len(afterBobAfterMute),
				"regular chat messages are live-only under V2")
		})
	})

	t.Run("multi-tenant isolation for notifications", func(t *testing.T) {
		w1 := newTestWorld(t)
		owner1 := w1.withOwner()
		emp1 := w1.withEmployee()

		w2 := newTestWorld(t)
		owner2 := w2.withOwner()
		emp2 := w2.withEmployee()

		w1.publishNotification(emp1.ID, "Org1 notification")
		time.Sleep(200 * time.Millisecond)

		w2.publishNotification(emp2.ID, "Org2 notification")
		time.Sleep(200 * time.Millisecond)

		notifs1 := w1.listNotifications(emp1, false)
		notifs2 := w2.listNotifications(emp2, false)

		for _, n := range notifs1 {
			assert.NotContains(t, n.Title, "Org2", "org1 employee should not see org2 notifications")
		}

		for _, n := range notifs2 {
			assert.NotContains(t, n.Title, "Org1", "org2 employee should not see org1 notifications")
		}

		_ = owner1
		_ = owner2
	})
}
