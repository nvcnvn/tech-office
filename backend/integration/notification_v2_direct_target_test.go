package integration

// TestNotificationV2DirectTarget validates that direct targeting (@mention) overrides
// mute/preference settings and always delivers the notification to the mentioned user.

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nvcnvn/tech-office/backend/internal/notification"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

func TestNotificationV2DirectTarget(t *testing.T) {
	t.Parallel()

	t.Run("chat channel mention overrides muted preference", func(t *testing.T) {
		// PASSES: baseline scenario — muted user still receives @mention.
		w := newTestWorld(t)
		owner := w.withOwner()
		mutedUser := w.withEmployee()

		channelID := w.createChannel(owner, "v2-direct-target-mute-ref", false)
		w.inviteToChannel(owner, channelID, mutedUser.ID)
		w.updateChannelNotificationPreference(mutedUser, channelID,
			rpcv1.NotificationPreference_NOTIFICATION_PREFERENCE_MUTED)

		messageID := w.sendMentionMessage(owner, channelID, mutedUser.ID)
		time.Sleep(300 * time.Millisecond)

		notifications := w.listNotifications(mutedUser, false)
		n := findNotificationByActionData(notifications, notification.SourceDomainChat, "mention", "messageId", messageID)

		t.Run("the muted user still receives the mention notification", func(t *testing.T) {
			require.NotNil(t, n, "muted channel member should receive mention notification")
			assert.Equal(t, notification.NotificationTypeMention, n.NotificationType)
			assert.Equal(t, notification.PolicyKeyChatMention, n.PolicyKey)
			assert.Equal(t, notification.SourceCategoryMention, n.SourceCategory)
			assert.Equal(t, "chat", n.ActionData["channelType"])
			assert.Equal(t, owner.ID.String(), n.ActionData["senderEmployeeId"])
		})

		t.Run("the mention notification is persisted not just live-only", func(t *testing.T) {
			require.NotNil(t, n)
			assert.NotEmpty(t, n.NotificationId, "mention notification should have a persistent record ID")
		})
	})

	t.Run("chat reply reaches the original author", func(t *testing.T) {
		// PASSES: reply notifications use direct targeting on the original message author.
		w := newTestWorld(t)
		owner := w.withOwner()
		replyTarget := w.withEmployee()

		channelID := w.createChannel(owner, "v2-direct-reply-ref", false)
		w.inviteToChannel(owner, channelID, replyTarget.ID)
		originalMsgID := w.sendMessage(replyTarget, channelID, "Original message for V2 reply test")
		time.Sleep(100 * time.Millisecond)

		w.replyToMessage(owner, originalMsgID, "This is a V2 direct reply")
		time.Sleep(300 * time.Millisecond)

		notifications := w.listNotifications(replyTarget, false)
		n := findNotificationByActionData(notifications, notification.SourceDomainChat, "reply", "parentMessageId", originalMsgID)

		t.Run("the original author receives a reply notification", func(t *testing.T) {
			require.NotNil(t, n, "original message author should receive reply notification")
			assert.Equal(t, notification.NotificationTypeReply, n.NotificationType)
			assert.Equal(t, notification.PolicyKeyChatReply, n.PolicyKey)
			assert.Equal(t, channelID, n.ActionData["channelId"])
			assert.Equal(t, "chat", n.ActionData["channelType"])
			assert.Equal(t, owner.ID.String(), n.ActionData["senderEmployeeId"])
			assert.Equal(t, originalMsgID, n.ActionData["parentMessageId"])
		})
	})

	t.Run("task assignment reaches assignee even without prior task subscription", func(t *testing.T) {
		// PASSES: task_assigned is a direct-target event — bypasses subscription state.
		w := newTestWorld(t)
		owner := w.withOwner()
		assignee := w.withEmployee()

		project := w.createProject(owner, "V2 Direct Assign", uniqueProjectKey("V2DA"))
		level0 := levelByDepth(project.Levels, 0)
		require.NotNil(t, level0)
		w.addProjectMember(owner, project.ID, assignee.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		task := w.createTask(owner, project.ID, "Direct Assign Task", level0.Id)
		_, _, found := w.queryResourceSubscription(assignee.ID, notification.ResourceDomainTask, task.Id)
		require.False(t, found, "assignee should have no prior task subscription")

		w.assignTask(owner, task.Id, assignee.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE)
		time.Sleep(300 * time.Millisecond)

		n := findNotificationByNavigationResource(
			w.listNotifications(assignee, false), notification.SourceDomainProjects,
			notification.NotificationTypeTaskAssigned, task.Id)

		t.Run("the assignee receives task_assigned", func(t *testing.T) {
			require.NotNil(t, n, "assignee should receive task_assigned even without prior subscription")
			assert.Equal(t, notification.PolicyKeyTaskAssignment, n.PolicyKey)
			assert.Equal(t, notification.SourceCategorySystem, n.SourceCategory)
		})
	})

	t.Run("document mention without prior follow", func(t *testing.T) {
		// V2: A user mentioned in a document comment should receive doc_mentioned
		// even if they never followed the document (direct-target routing).
		w := newTestWorld(t)
		owner := w.withOwner()
		mentionedUser := w.withEmployee()
		commenter := w.withEmployee()

		docID := w.createDocument(owner, "V2 Doc Mention Target", `{"type":"doc","content":[]}`)
		w.setDocumentAccess(owner, docID, mentionedUser.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)
		w.setDocumentAccess(owner, docID, commenter.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)
		time.Sleep(50 * time.Millisecond)

		state, _, followed := w.queryResourceSubscription(mentionedUser.ID, notification.ResourceDomainDocument, docID)
		if followed && state == notification.ResourceSubscriptionStateActive {
			t.Skip("mentionedUser is already a document follower; cannot test mention-without-subscription")
		}

		commentText := `<p>Hey <span data-type="mention" data-id="` + mentionedUser.ID.String() +
			`" data-label="Colleague">@Colleague</span>, please review this</p>`
		w.addDocumentComment(commenter, docID, commentText)
		time.Sleep(300 * time.Millisecond)

		n := findNotificationByNavigationResource(
			w.listNotifications(mentionedUser, false), notification.SourceDomainDocs,
			notification.NotificationTypeDocMentioned, docID)

		t.Run("the mentioned user receives doc_mentioned without prior follow", func(t *testing.T) {
			assert.NotNil(t, n,
				"mentioned user should receive doc_mentioned even without following the document")
		})

		if n != nil {
			t.Run("the notification carries doc_mentioned type and document_mention policy_key", func(t *testing.T) {
				assert.Equal(t, notification.NotificationTypeDocMentioned, n.NotificationType)
				assert.Equal(t, notification.PolicyKeyDocumentMention, n.PolicyKey)
				assert.Equal(t, notification.SourceCategoryMention, n.SourceCategory)
			})
		}
	})

	t.Run("task mention in discussion channel without prior task subscription", func(t *testing.T) {
		// V2: A user mentioned in a task discussion channel message should receive
		// task_mentioned even if they never watched the task (direct-target routing).
		w := newTestWorld(t)
		owner := w.withOwner()
		mentionedUser := w.withEmployee()
		commenter := w.withEmployee()

		project := w.createProject(owner, "V2 Task Mention", uniqueProjectKey("V2TM"))
		level0 := levelByDepth(project.Levels, 0)
		require.NotNil(t, level0)
		w.addProjectMember(owner, project.ID, mentionedUser.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		w.addProjectMember(owner, project.ID, commenter.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		task := w.createTask(owner, project.ID, "Task Mention Target", level0.Id)
		task = w.getTask(mentionedUser, task.Id)
		if task.ChannelId == nil {
			t.Skip("task has no discussion channel")
		}

		// Ensure commenter can post to the task channel.
		w.inviteToChannel(owner, *task.ChannelId, commenter.ID)

		_, _, found := w.queryResourceSubscription(mentionedUser.ID, notification.ResourceDomainTask, task.Id)
		if found {
			t.Skip("mentionedUser already has a task subscription; cannot test mention-without-subscription")
		}

		w.sendMentionMessage(commenter, *task.ChannelId, mentionedUser.ID)
		time.Sleep(300 * time.Millisecond)

		n := findNotificationByNavigationResource(
			w.listNotifications(mentionedUser, false), notification.SourceDomainProjects,
			notification.NotificationTypeTaskMentioned, task.Id)

		t.Run("the mentioned user receives task_mentioned via direct-target routing", func(t *testing.T) {
			// V2: Chat bridge detects task channel and emits task_mentioned for @mentions.
			require.NotNil(t, n,
				"mentioned user should receive task_mentioned from task discussion channel")
			assert.Equal(t, notification.NotificationTypeTaskMentioned, n.NotificationType)
			assert.Equal(t, notification.PolicyKeyTaskMention, n.PolicyKey)
			assert.Equal(t, notification.SourceCategoryMention, n.SourceCategory)
		})
	})
}
