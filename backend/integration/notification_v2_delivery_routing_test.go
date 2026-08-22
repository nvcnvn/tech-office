package integration

// TestNotificationV2DeliveryRouting validates the V2 delivery class and persistence semantics.
//
// V2 delivery model:
//   - persistent: notification stored in inbox AND streamed live when user is online
//   - live_only: streamed live when online; NOT stored in inbox (no inbox record)

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nvcnvn/tech-office/backend/internal/notification"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

func TestNotificationV2DeliveryRouting(t *testing.T) {
	t.Parallel()

	t.Run("regular chat message is live-only and not persisted", func(t *testing.T) {
		// PASSES: chat_message notifications should not appear in the notification inbox.
		w := newTestWorld(t)
		owner := w.withOwner()
		member := w.withEmployee()

		channelID := w.createChannel(owner, "v2-live-only-msg", false)
		w.inviteToChannel(owner, channelID, member.ID)
		w.updateChannelNotificationPreference(member, channelID,
			rpcv1.NotificationPreference_NOTIFICATION_PREFERENCE_ALL)

		w.sendMessage(owner, channelID, "V2 routing test message — should not persist")
		time.Sleep(300 * time.Millisecond)

		notifications := w.listNotifications(member, false)

		t.Run("no message notification appears in the inbox", func(t *testing.T) {
			for _, n := range notifications {
				if n.SourceDomain == notification.SourceDomainChat &&
					n.NotificationType == notification.NotificationTypeMessage {
					assert.Fail(t, "live-only chat messages should not appear in inbox",
						"found notification: type=%s policy=%s", n.NotificationType, n.PolicyKey)
					break
				}
			}
		})
	})

	t.Run("direct message is persisted and appears in inbox", func(t *testing.T) {
		w := newTestWorld(t)
		sender := w.withOwner()
		recipient := w.withEmployee()

		dmChannelID := w.createOrGetDM(sender, recipient.ID)
		messageID := w.sendMessage(sender, dmChannelID, "V2 routing test direct message — should persist")
		time.Sleep(300 * time.Millisecond)

		n := findNotificationByActionData(
			w.listNotifications(recipient, false),
			notification.SourceDomainChat, notification.NotificationTypeMessage,
			"messageId", messageID)

		t.Run("the direct-message notification appears in the inbox", func(t *testing.T) {
			require.NotNil(t, n, "direct message should be persisted in inbox")
			assert.Equal(t, notification.PolicyKeyChatMessage, n.PolicyKey)
			assert.NotEmpty(t, n.NotificationId)
		})

		t.Run("the persisted notification keeps direct-message routing metadata", func(t *testing.T) {
			require.NotNil(t, n)
			assert.Equal(t, "direct_message", n.ActionData["channelType"])
			assert.Equal(t, dmChannelID, n.ActionData["channelId"])
		})
	})

	t.Run("chat mention IS persisted and appears in inbox", func(t *testing.T) {
		// PASSES: mention notifications use delivery_class=persistent.
		w := newTestWorld(t)
		owner := w.withOwner()
		target := w.withEmployee()

		channelID := w.createChannel(owner, "v2-persist-mention", false)
		w.inviteToChannel(owner, channelID, target.ID)

		msgID := w.sendMentionMessage(owner, channelID, target.ID)
		time.Sleep(300 * time.Millisecond)

		n := findNotificationByActionData(
			w.listNotifications(target, false),
			notification.SourceDomainChat, notification.NotificationTypeMention,
			"messageId", msgID)

		t.Run("the mention notification appears in the inbox", func(t *testing.T) {
			require.NotNil(t, n, "mention should be persisted in inbox")
			assert.Equal(t, notification.PolicyKeyChatMention, n.PolicyKey)
		})

		t.Run("the mention notification ID is populated", func(t *testing.T) {
			require.NotNil(t, n)
			assert.NotEmpty(t, n.NotificationId, "persisted notification must have an ID")
		})
	})

	t.Run("task status change IS persisted for watchers", func(t *testing.T) {
		// PASSES: task_status_changed uses delivery_class=persistent.
		w := newTestWorld(t)
		owner := w.withOwner()
		watcher := w.withEmployee()
		actor := w.withEmployee()

		project := w.createProject(owner, "V2 Status Persist", uniqueProjectKey("V2SP"))
		level0 := levelByDepth(project.Levels, 0)
		require.NotNil(t, level0)
		w.addProjectMember(owner, project.ID, watcher.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		w.addProjectMember(owner, project.ID, actor.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		task := w.createTask(owner, project.ID, "V2 Status Persist Task", level0.Id)
		w.watchTask(watcher, task.Id)

		inProgress := stateByCategory(project.States, rpcv1.StateCategory_STATE_CATEGORY_IN_PROGRESS)
		require.NotNil(t, inProgress)
		w.moveTask(actor, task.Id, inProgress.Id)
		time.Sleep(300 * time.Millisecond)

		n := findNotificationByNavigationResource(
			w.listNotifications(watcher, false),
			notification.SourceDomainProjects, notification.NotificationTypeTaskStatusChanged,
			task.Id)

		t.Run("the task_status_changed notification is persisted in inbox", func(t *testing.T) {
			require.NotNil(t, n, "task_status_changed should be persisted")
			assert.Equal(t, notification.PolicyKeyTaskStatus, n.PolicyKey)
			assert.NotEmpty(t, n.NotificationId)
		})
	})

	t.Run("task assignment IS persisted for assignee", func(t *testing.T) {
		// PASSES: task_assigned uses delivery_class=persistent.
		w := newTestWorld(t)
		owner := w.withOwner()
		assignee := w.withEmployee()

		project := w.createProject(owner, "V2 Assign Persist", uniqueProjectKey("V2AP"))
		level0 := levelByDepth(project.Levels, 0)
		require.NotNil(t, level0)
		w.addProjectMember(owner, project.ID, assignee.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		task := w.createTask(owner, project.ID, "V2 Assign Persist Task", level0.Id)
		w.assignTask(owner, task.Id, assignee.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE)
		time.Sleep(300 * time.Millisecond)

		n := findNotificationByNavigationResource(
			w.listNotifications(assignee, false),
			notification.SourceDomainProjects, notification.NotificationTypeTaskAssigned,
			task.Id)

		t.Run("the task_assigned notification is persisted in inbox", func(t *testing.T) {
			require.NotNil(t, n)
			assert.Equal(t, notification.PolicyKeyTaskAssignment, n.PolicyKey)
			assert.NotEmpty(t, n.NotificationId)
		})
	})

	t.Run("document update IS persisted for followers", func(t *testing.T) {
		// PASSES: doc_updated uses delivery_class=persistent.
		w := newTestWorld(t)
		owner := w.withOwner()
		follower := w.withEmployee()
		editor := w.withEmployee()

		docID := w.createDocument(owner, "V2 Doc Persist", `{"type":"doc","content":[]}`)
		w.setDocumentAccess(owner, docID, follower.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)
		w.setDocumentAccess(owner, docID, editor.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_WRITE_UPDATE)
		w.followDocument(follower, docID)

		w.updateDocument(editor, docID,
			`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"V2 persist test"}]}]}`)
		time.Sleep(300 * time.Millisecond)

		n := findNotificationByNavigationResource(
			w.listNotifications(follower, false),
			notification.SourceDomainDocs, notification.NotificationTypeDocUpdated,
			docID)

		t.Run("the doc_updated notification is persisted in inbox", func(t *testing.T) {
			require.NotNil(t, n, "doc_updated should be persisted in inbox")
			assert.Equal(t, notification.PolicyKeyDocumentUpdate, n.PolicyKey)
			assert.NotEmpty(t, n.NotificationId)
		})
	})

	t.Run("document comment IS persisted for followers", func(t *testing.T) {
		// PASSES: doc_commented uses delivery_class=persistent.
		w := newTestWorld(t)
		owner := w.withOwner()
		follower := w.withEmployee()
		commenter := w.withEmployee()

		docID := w.createDocument(owner, "V2 Doc Comment Persist", `{"type":"doc","content":[]}`)
		w.setDocumentAccess(owner, docID, follower.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)
		w.setDocumentAccess(owner, docID, commenter.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)
		w.followDocument(follower, docID)

		w.addDocumentComment(commenter, docID, "V2 persistence test comment")
		time.Sleep(300 * time.Millisecond)

		n := findNotificationByNavigationResource(
			w.listNotifications(follower, false),
			notification.SourceDomainDocs, notification.NotificationTypeDocCommented,
			docID)

		t.Run("the doc_commented notification is persisted in inbox", func(t *testing.T) {
			require.NotNil(t, n, "doc_commented should be persisted in inbox")
			assert.Equal(t, notification.PolicyKeyDocumentComment, n.PolicyKey)
			assert.NotEmpty(t, n.NotificationId)
		})
	})

	t.Run("actor does not receive their own activity notifications", func(t *testing.T) {
		// PASSES: Self-notifications are suppressed in all domains.
		t.Run("task status self-change is suppressed", func(t *testing.T) {
			w := newTestWorld(t)
			actor := w.withOwner()

			project := w.createProject(actor, "V2 Self Suppress", uniqueProjectKey("V2SS"))
			level0 := levelByDepth(project.Levels, 0)
			require.NotNil(t, level0)

			task := w.createTask(actor, project.ID, "Self Change Task", level0.Id)
			w.watchTask(actor, task.Id)

			inProgress := stateByCategory(project.States, rpcv1.StateCategory_STATE_CATEGORY_IN_PROGRESS)
			require.NotNil(t, inProgress)
			w.moveTask(actor, task.Id, inProgress.Id)
			time.Sleep(300 * time.Millisecond)

			n := findNotificationByNavigationResource(
				w.listNotifications(actor, false),
				notification.SourceDomainProjects, notification.NotificationTypeTaskStatusChanged,
				task.Id)

			assert.Nil(t, n, "actor should not receive task_status_changed for their own change")
		})

		t.Run("document self-update is suppressed", func(t *testing.T) {
			w := newTestWorld(t)
			creator := w.withOwner()

			docID := w.createDocument(creator, "V2 Self Doc", `{"type":"doc","content":[]}`)
			w.followDocument(creator, docID)

			w.updateDocument(creator, docID,
				`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Self update"}]}]}`)
			time.Sleep(300 * time.Millisecond)

			n := findNotificationByNavigationResource(
				w.listNotifications(creator, false),
				notification.SourceDomainDocs, notification.NotificationTypeDocUpdated,
				docID)

			assert.Nil(t, n, "document creator should not receive doc_updated for their own edit")
		})
	})

	t.Run("unread count decrements after mark-as-read", func(t *testing.T) {
		// PASSES: basic inbox lifecycle test for persistent notifications.
		w := newTestWorld(t)
		owner := w.withOwner()
		recipient := w.withEmployee()

		project := w.createProject(owner, "V2 Unread Count", uniqueProjectKey("V2UC"))
		level0 := levelByDepth(project.Levels, 0)
		require.NotNil(t, level0)
		w.addProjectMember(owner, project.ID, recipient.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		task := w.createTask(owner, project.ID, "Count Task", level0.Id)
		w.watchTask(recipient, task.Id)

		inProgress := stateByCategory(project.States, rpcv1.StateCategory_STATE_CATEGORY_IN_PROGRESS)
		require.NotNil(t, inProgress)
		w.moveTask(owner, task.Id, inProgress.Id)
		time.Sleep(300 * time.Millisecond)

		unreadBefore := w.getUnreadCount(recipient)
		require.Greater(t, unreadBefore, int32(0), "recipient should have unread notifications")

		notifications := w.listNotifications(recipient, true)
		require.NotEmpty(t, notifications)
		ids := make([]string, 0, len(notifications))
		for _, n := range notifications {
			ids = append(ids, n.NotificationRecipientId)
		}
		w.markAsRead(recipient, ids...)
		time.Sleep(100 * time.Millisecond)

		unreadAfter := w.getUnreadCount(recipient)
		assert.Zero(t, unreadAfter, "unread count should be 0 after marking all as read")
	})
}
