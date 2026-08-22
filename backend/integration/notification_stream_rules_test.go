package integration

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

func TestNotificationStreamRules(t *testing.T) {
	t.Parallel()
	t.Run("chat message reaches channel members with all preference", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		allUser := w.withEmployee()

		channelID := w.createChannel(owner, "stream-pref-all", false)
		w.inviteToChannel(owner, channelID, allUser.ID)
		w.updateChannelNotificationPreference(allUser, channelID, rpcv1.NotificationPreference_NOTIFICATION_PREFERENCE_ALL)

		allStream, allConnectionID, cancelAll := w.openNotificationHTTPStream(allUser, 6*time.Second)
		defer cancelAll()
		requireHTTPConnectionReady(t, w, allConnectionID)

		messageID := w.sendMessage(owner, channelID, "regular message for channel preference")
		time.Sleep(300 * time.Millisecond)

		// V2: regular chat messages are live-only and NOT persisted in inbox.
		persistedForAll := findNotificationByActionData(w.listNotifications(allUser, false), "chat", "message", "messageId", messageID)
		assert.Nil(t, persistedForAll, "regular chat messages should be live-only under V2")

		// But the SSE stream should still receive the event.
		allEvent := w.receiveNextHTTPNotificationEvent(allStream)
		require.NotNil(t, allEvent)
		require.NotNil(t, allEvent.Notification)
		assert.Equal(t, "notification", allEvent.EventType)
		assert.Equal(t, "chat", allEvent.Notification.SourceDomain)
		assert.Equal(t, "message", allEvent.Notification.NotificationType)
		assert.Equal(t, channelID, allEvent.Notification.ActionData["channelId"])
		assert.Equal(t, messageID, allEvent.Notification.ActionData["messageId"])
		assert.Equal(t, "chat", allEvent.Notification.ActionData["channelType"])
		assert.Equal(t, "stream-pref-all", allEvent.Notification.ActionData["channelName"])
		assert.Equal(t, owner.ID.String(), allEvent.Notification.ActionData["senderEmployeeId"])
	})

	t.Run("chat message notification preview strips html markup", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		allUser := w.withEmployee()

		channelID := w.createChannel(owner, "stream-pref-html-preview", false)
		w.inviteToChannel(owner, channelID, allUser.ID)
		w.updateChannelNotificationPreference(allUser, channelID, rpcv1.NotificationPreference_NOTIFICATION_PREFERENCE_ALL)

		allStream, allConnectionID, cancelAll := w.openNotificationHTTPStream(allUser, 6*time.Second)
		defer cancelAll()
		requireHTTPConnectionReady(t, w, allConnectionID)

		messageID := w.sendMessage(owner, channelID, `<p>Hello <b>team</b> &amp; welcome<br>today.</p>`)
		time.Sleep(300 * time.Millisecond)

		allEvent := w.receiveNextHTTPNotificationEvent(allStream)
		require.NotNil(t, allEvent)
		require.NotNil(t, allEvent.Notification)
		assert.Equal(t, messageID, allEvent.Notification.ActionData["messageId"])
		assert.Equal(t, "Hello team & welcome today.", allEvent.Notification.Message)
		assert.NotContains(t, allEvent.Notification.Message, "<")
	})

	t.Run("chat message is skipped for mentions-only preference", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		mentionsUser := w.withEmployee()

		channelID := w.createChannel(owner, "stream-pref-mentions-only", false)
		w.inviteToChannel(owner, channelID, mentionsUser.ID)
		w.updateChannelNotificationPreference(mentionsUser, channelID, rpcv1.NotificationPreference_NOTIFICATION_PREFERENCE_MENTIONS)

		mentionsStream, mentionsConnectionID, cancelMentions := w.openNotificationHTTPStream(mentionsUser, 3*time.Second)
		defer cancelMentions()
		requireHTTPConnectionReady(t, w, mentionsConnectionID)

		messageID := w.sendMessage(owner, channelID, "regular message should be filtered")
		time.Sleep(300 * time.Millisecond)

		assert.Nil(t, w.tryReceiveNextHTTPNotificationEvent(mentionsStream), "mentions-only user should not get regular message stream event")
		assert.Nil(t, findNotificationByActionData(w.listNotifications(mentionsUser, false), "chat", "message", "messageId", messageID))
	})

	t.Run("chat mention reaches mentions-only preference", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		mentionedUser := w.withEmployee()

		channelID := w.createChannel(owner, "stream-pref-mention", false)
		w.inviteToChannel(owner, channelID, mentionedUser.ID)
		w.updateChannelNotificationPreference(mentionedUser, channelID, rpcv1.NotificationPreference_NOTIFICATION_PREFERENCE_MENTIONS)

		mentionedStream, mentionedConnectionID, cancelMentioned := w.openNotificationHTTPStream(mentionedUser, 6*time.Second)
		defer cancelMentioned()
		requireHTTPConnectionReady(t, w, mentionedConnectionID)

		messageID := w.sendMentionMessage(owner, channelID, mentionedUser.ID)
		time.Sleep(300 * time.Millisecond)

		persistedForMentioned := findNotificationByActionData(w.listNotifications(mentionedUser, false), "chat", "mention", "messageId", messageID)
		require.NotNil(t, persistedForMentioned)
		assert.Equal(t, "chat_mention", persistedForMentioned.PolicyKey)
		assert.Equal(t, "mention", persistedForMentioned.SourceCategory)

		mentionedEvent := w.receiveNextHTTPNotificationEvent(mentionedStream)
		require.NotNil(t, mentionedEvent)
		require.NotNil(t, mentionedEvent.Notification)
		assert.Equal(t, "mention", mentionedEvent.Notification.NotificationType)
		assert.Equal(t, channelID, mentionedEvent.Notification.ActionData["channelId"])
		assert.Equal(t, messageID, mentionedEvent.Notification.ActionData["messageId"])
		assert.Equal(t, "chat", mentionedEvent.Notification.ActionData["channelType"])
		assert.Equal(t, "stream-pref-mention", mentionedEvent.Notification.ActionData["channelName"])
		assert.Equal(t, owner.ID.String(), mentionedEvent.Notification.ActionData["senderEmployeeId"])
	})

	t.Run("chat mention still reaches an explicitly mentioned muted user", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		mutedUser := w.withEmployee()

		channelID := w.createChannel(owner, "stream-pref-muted", false)
		w.inviteToChannel(owner, channelID, mutedUser.ID)
		w.updateChannelNotificationPreference(mutedUser, channelID, rpcv1.NotificationPreference_NOTIFICATION_PREFERENCE_MUTED)

		mutedStream, mutedConnectionID, cancelMuted := w.openNotificationHTTPStream(mutedUser, 3*time.Second)
		defer cancelMuted()
		requireHTTPConnectionReady(t, w, mutedConnectionID)

		messageID := w.sendMentionMessage(owner, channelID, mutedUser.ID)
		time.Sleep(300 * time.Millisecond)

		persistedForMutedMention := findNotificationByActionData(w.listNotifications(mutedUser, false), "chat", "mention", "messageId", messageID)
		require.NotNil(t, persistedForMutedMention)
		assert.Equal(t, "chat_mention", persistedForMutedMention.PolicyKey)
		assert.Equal(t, "mention", persistedForMutedMention.SourceCategory)

		mutedEvent := w.receiveNextHTTPNotificationEvent(mutedStream)
		require.NotNil(t, mutedEvent)
		require.NotNil(t, mutedEvent.Notification)
		assert.Equal(t, "mention", mutedEvent.Notification.NotificationType)
		assert.Equal(t, channelID, mutedEvent.Notification.ActionData["channelId"])
		assert.Equal(t, messageID, mutedEvent.Notification.ActionData["messageId"])
		assert.Equal(t, "chat", mutedEvent.Notification.ActionData["channelType"])
		assert.Equal(t, owner.ID.String(), mutedEvent.Notification.ActionData["senderEmployeeId"])
	})

	t.Run("task status reaches active watchers", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		users := w.withEmployees(2)
		watcher, actor := users[0], users[1]

		project := w.createProject(owner, "Stream Task Rules", uniqueProjectKey("STR"))
		level0 := levelByDepth(project.Levels, 0)
		require.NotNil(t, level0)
		w.addProjectMember(owner, project.ID, watcher.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		w.addProjectMember(owner, project.ID, actor.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		task := w.createTask(owner, project.ID, "Watch this task", level0.Id)
		w.watchTask(watcher, task.Id)

		watcherStream, watcherConnectionID, cancelWatcher := w.openNotificationHTTPStream(watcher, 6*time.Second)
		defer cancelWatcher()
		requireHTTPConnectionReady(t, w, watcherConnectionID)

		inProgress := stateByCategory(project.States, rpcv1.StateCategory_STATE_CATEGORY_IN_PROGRESS)
		require.NotNil(t, inProgress)
		w.moveTask(actor, task.Id, inProgress.Id)
		time.Sleep(300 * time.Millisecond)

		persistedWhileWatching := findNotificationByNavigationResource(w.listNotifications(watcher, false), "projects", "task_status_changed", task.Id)
		require.NotNil(t, persistedWhileWatching)
		assert.Equal(t, "task_status", persistedWhileWatching.PolicyKey)
		assert.Equal(t, "activity", persistedWhileWatching.SourceCategory)
		require.NotNil(t, persistedWhileWatching.NavigationTarget)
		assert.Equal(t, task.Id, persistedWhileWatching.NavigationTarget.ResourceId)

		watcherEvent := w.receiveNextHTTPNotificationEvent(watcherStream)
		require.NotNil(t, watcherEvent)
		require.NotNil(t, watcherEvent.Notification)
		assert.Equal(t, "projects", watcherEvent.Notification.SourceDomain)
		assert.Equal(t, "task_status_changed", watcherEvent.Notification.NotificationType)
	})

	t.Run("task status is skipped after unwatch", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		users := w.withEmployees(2)
		watcher, actor := users[0], users[1]

		project := w.createProject(owner, "Stream Task Unwatch", uniqueProjectKey("STU"))
		level0 := levelByDepth(project.Levels, 0)
		require.NotNil(t, level0)
		w.addProjectMember(owner, project.ID, watcher.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		w.addProjectMember(owner, project.ID, actor.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		task := w.createTask(owner, project.ID, "Stop watching this task", level0.Id)
		w.watchTask(watcher, task.Id)

		w.unwatchTask(watcher, task.Id)
		beforeAfterUnwatch := countMatchingNotificationsByResource(w.listNotifications(watcher, false), "projects", "task_status_changed", task.Id)

		noEventStream, noEventConnectionID, cancelNoEvent := w.openNotificationHTTPStream(watcher, 3*time.Second)
		defer cancelNoEvent()
		requireHTTPConnectionReady(t, w, noEventConnectionID)
		doneState := stateByCategory(project.States, rpcv1.StateCategory_STATE_CATEGORY_DONE)
		require.NotNil(t, doneState)
		w.moveTask(actor, task.Id, doneState.Id)
		time.Sleep(300 * time.Millisecond)

		assert.Nil(t, w.tryReceiveNextHTTPNotificationEvent(noEventStream), "unwatched user should not get task status stream event")
		afterAfterUnwatch := countMatchingNotificationsByResource(w.listNotifications(watcher, false), "projects", "task_status_changed", task.Id)
		assert.Equal(t, beforeAfterUnwatch, afterAfterUnwatch, "unwatched user should not get persisted task status notification")
	})

	t.Run("document update reaches followers", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		users := w.withEmployees(2)
		follower, editor := users[0], users[1]

		docID := w.createDocument(owner, "Stream Doc Rules", `{"type":"doc","content":[]}`)
		w.setDocumentAccess(owner, docID, follower.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)
		w.setDocumentAccess(owner, docID, editor.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_WRITE_UPDATE)
		w.followDocument(follower, docID)

		followerStream, followerConnectionID, cancelFollower := w.openNotificationHTTPStream(follower, 6*time.Second)
		defer cancelFollower()
		requireHTTPConnectionReady(t, w, followerConnectionID)
		w.updateDocument(editor, docID, `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Follower should see this update"}]}]}`)
		time.Sleep(300 * time.Millisecond)

		persistedWhileFollowing := findNotificationByNavigationResource(w.listNotifications(follower, false), "docs", "doc_updated", docID)
		require.NotNil(t, persistedWhileFollowing)
		assert.Equal(t, "document_update", persistedWhileFollowing.PolicyKey)
		assert.Equal(t, "activity", persistedWhileFollowing.SourceCategory)
		require.NotNil(t, persistedWhileFollowing.NavigationTarget)
		assert.Equal(t, docID, persistedWhileFollowing.NavigationTarget.ResourceId)

		followerEvent := w.receiveNextHTTPNotificationEvent(followerStream)
		require.NotNil(t, followerEvent)
		require.NotNil(t, followerEvent.Notification)
		assert.Equal(t, "docs", followerEvent.Notification.SourceDomain)
		assert.Equal(t, "doc_updated", followerEvent.Notification.NotificationType)
	})

	t.Run("document update is skipped after unfollow", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		users := w.withEmployees(2)
		follower, editor := users[0], users[1]

		docID := w.createDocument(owner, "Stream Doc Unfollow", `{"type":"doc","content":[]}`)
		w.setDocumentAccess(owner, docID, follower.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)
		w.setDocumentAccess(owner, docID, editor.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_WRITE_UPDATE)
		w.followDocument(follower, docID)

		w.unfollowDocument(follower, docID)
		beforeAfterUnfollow := countMatchingNotificationsByResource(w.listNotifications(follower, false), "docs", "doc_updated", docID)

		noEventStream, noEventConnectionID, cancelNoEvent := w.openNotificationHTTPStream(follower, 3*time.Second)
		defer cancelNoEvent()
		requireHTTPConnectionReady(t, w, noEventConnectionID)
		w.updateDocument(editor, docID, `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Follower should not see this update"}]}]}`)
		time.Sleep(300 * time.Millisecond)

		assert.Nil(t, w.tryReceiveNextHTTPNotificationEvent(noEventStream), "unfollowed user should not get doc update stream event")
		afterAfterUnfollow := countMatchingNotificationsByResource(w.listNotifications(follower, false), "docs", "doc_updated", docID)
		assert.Equal(t, beforeAfterUnfollow, afterAfterUnfollow, "unfollowed user should not get persisted doc update notification")
	})
}

func requireHTTPConnectionReady(t *testing.T, w *testWorld, connectionID string) {
	t.Helper()
	parsedID := dbuuid.MustParse(connectionID)
	require.Eventually(t, func() bool {
		return w.connectionExists(parsedID)
	}, 2*time.Second, 25*time.Millisecond, "stream connection should be registered before sending notifications")
}

func findNotificationByActionData(
	notifications []*rpcv1.NotificationSummary,
	sourceDomain string,
	notificationType string,
	actionKey string,
	actionValue string,
) *rpcv1.NotificationSummary {
	for _, notification := range notifications {
		if notification.SourceDomain != sourceDomain {
			continue
		}
		if notification.NotificationType != notificationType {
			continue
		}
		if notification.ActionData[actionKey] == actionValue {
			return notification
		}
	}
	return nil
}

func countMatchingNotifications(
	notifications []*rpcv1.NotificationSummary,
	sourceDomain string,
	notificationType string,
	actionKey string,
	actionValue string,
) int {
	count := 0
	for _, notification := range notifications {
		if notification.SourceDomain == sourceDomain &&
			notification.NotificationType == notificationType &&
			notification.ActionData[actionKey] == actionValue {
			count++
		}
	}
	return count
}

func findNotificationByNavigationResource(
	notifications []*rpcv1.NotificationSummary,
	sourceDomain string,
	notificationType string,
	resourceID string,
) *rpcv1.NotificationSummary {
	for _, notification := range notifications {
		if notification.SourceDomain != sourceDomain {
			continue
		}
		if notification.NotificationType != notificationType {
			continue
		}
		if notification.NavigationTarget != nil && notification.NavigationTarget.ResourceId == resourceID {
			return notification
		}
	}
	return nil
}

func countMatchingNotificationsByResource(
	notifications []*rpcv1.NotificationSummary,
	sourceDomain string,
	notificationType string,
	resourceID string,
) int {
	count := 0
	for _, notification := range notifications {
		if notification.SourceDomain == sourceDomain &&
			notification.NotificationType == notificationType &&
			notification.NavigationTarget != nil &&
			notification.NavigationTarget.ResourceId == resourceID {
			count++
		}
	}
	return count
}
