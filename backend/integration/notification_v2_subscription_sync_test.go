package integration

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nvcnvn/tech-office/backend/internal/notification"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

func TestNotificationV2SubscriptionSync(t *testing.T) {
	t.Parallel()
	t.Run("when a task is manually watched and later unwatched", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		watcher := w.withEmployee()

		project := w.createProject(owner, "V2 Task Subscription", uniqueProjectKey("V2TS"))
		level0 := levelByDepth(project.Levels, 0)
		require.NotNil(t, level0)

		task := w.createTask(owner, project.ID, "Task subscription sync", level0.Id)
		w.watchTask(watcher, task.Id)

		state, preference, found := w.queryResourceSubscription(watcher.ID, notification.ResourceDomainTask, task.Id)
		reasons := w.queryResourceSubscriptionReasons(watcher.ID, notification.ResourceDomainTask, task.Id)

		t.Run("it records an active task subscription", func(t *testing.T) {
			require.True(t, found)
			assert.Equal(t, notification.ResourceSubscriptionStateActive, state)
			assert.Equal(t, notification.NotificationPreferenceAll, preference)
		})

		t.Run("it records the manual follow reason", func(t *testing.T) {
			assert.Contains(t, reasons, notification.ResourceSubscriptionReasonManualFollow)
		})

		w.unwatchTask(watcher, task.Id)
		state, preference, found = w.queryResourceSubscription(watcher.ID, notification.ResourceDomainTask, task.Id)
		reasons = w.queryResourceSubscriptionReasons(watcher.ID, notification.ResourceDomainTask, task.Id)

		t.Run("it marks the subscription as unfollowed", func(t *testing.T) {
			require.True(t, found)
			assert.Equal(t, notification.ResourceSubscriptionStateUnfollowed, state)
			assert.Equal(t, notification.NotificationPreferenceAll, preference)
		})

		t.Run("it removes the manual follow reason", func(t *testing.T) {
			assert.NotContains(t, reasons, notification.ResourceSubscriptionReasonManualFollow)
		})
	})

	t.Run("when a task is assigned", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		assignee := w.withEmployee()

		project := w.createProject(owner, "V2 Assignment Subscription", uniqueProjectKey("V2AS"))
		level0 := levelByDepth(project.Levels, 0)
		require.NotNil(t, level0)

		task := w.createTask(owner, project.ID, "Task assignment sync", level0.Id)
		w.assignTask(owner, task.Id, assignee.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE)

		state, _, found := w.queryResourceSubscription(assignee.ID, notification.ResourceDomainTask, task.Id)
		reasons := w.queryResourceSubscriptionReasons(assignee.ID, notification.ResourceDomainTask, task.Id)

		t.Run("it records an active task subscription", func(t *testing.T) {
			require.True(t, found)
			assert.Equal(t, notification.ResourceSubscriptionStateActive, state)
		})

		t.Run("it records the assignee reason", func(t *testing.T) {
			assert.Contains(t, reasons, notification.ResourceSubscriptionReasonAssignee)
		})
	})

	t.Run("when a document is created", func(t *testing.T) {
		w := newTestWorld(t)
		creator := w.withOwner()

		docID := w.createDocument(creator, "V2 creator reason", `{"type":"doc","content":[]}`)
		state, _, found := w.queryResourceSubscription(creator.ID, notification.ResourceDomainDocument, docID)
		reasons := w.queryResourceSubscriptionReasons(creator.ID, notification.ResourceDomainDocument, docID)

		t.Run("it records an active document subscription", func(t *testing.T) {
			require.True(t, found)
			assert.Equal(t, notification.ResourceSubscriptionStateActive, state)
		})

		t.Run("it records the creator reason without treating it as manual follow", func(t *testing.T) {
			assert.Contains(t, reasons, notification.ResourceSubscriptionReasonCreator)
			assert.NotContains(t, reasons, notification.ResourceSubscriptionReasonManualFollow)
		})
	})

	t.Run("when a document is manually followed and later unfollowed", func(t *testing.T) {
		w := newTestWorld(t)
		follower := w.withOwner()

		docID := w.createDocument(follower, "V2 manual follow", `{"type":"doc","content":[]}`)
		w.followDocument(follower, docID)

		state, preference, found := w.queryResourceSubscription(follower.ID, notification.ResourceDomainDocument, docID)
		reasons := w.queryResourceSubscriptionReasons(follower.ID, notification.ResourceDomainDocument, docID)

		t.Run("it records an active document subscription", func(t *testing.T) {
			require.True(t, found)
			assert.Equal(t, notification.ResourceSubscriptionStateActive, state)
			assert.Equal(t, notification.NotificationPreferenceAll, preference)
		})

		t.Run("it records the manual follow reason", func(t *testing.T) {
			assert.Contains(t, reasons, notification.ResourceSubscriptionReasonManualFollow)
		})

		w.unfollowDocument(follower, docID)
		state, _, found = w.queryResourceSubscription(follower.ID, notification.ResourceDomainDocument, docID)
		reasons = w.queryResourceSubscriptionReasons(follower.ID, notification.ResourceDomainDocument, docID)

		t.Run("it marks the document subscription as unfollowed", func(t *testing.T) {
			require.True(t, found)
			assert.Equal(t, notification.ResourceSubscriptionStateUnfollowed, state)
		})

		t.Run("it removes the manual follow reason", func(t *testing.T) {
			assert.NotContains(t, reasons, notification.ResourceSubscriptionReasonManualFollow)
		})
	})

	t.Run("when a user comments on a document", func(t *testing.T) {
		w := newTestWorld(t)
		commenter := w.withOwner()

		docID := w.createDocument(commenter, "V2 comment reason", `{"type":"doc","content":[]}`)
		w.addDocumentComment(commenter, docID, "Comment for V2 subscription sync")

		state, _, found := w.queryResourceSubscription(commenter.ID, notification.ResourceDomainDocument, docID)
		reasons := w.queryResourceSubscriptionReasons(commenter.ID, notification.ResourceDomainDocument, docID)

		t.Run("it records an active document subscription", func(t *testing.T) {
			require.True(t, found)
			assert.Equal(t, notification.ResourceSubscriptionStateActive, state)
		})

		t.Run("it records the commented reason without converting it to manual follow", func(t *testing.T) {
			assert.Contains(t, reasons, notification.ResourceSubscriptionReasonCommented)
			assert.NotContains(t, reasons, notification.ResourceSubscriptionReasonManualFollow)
		})
	})
}
