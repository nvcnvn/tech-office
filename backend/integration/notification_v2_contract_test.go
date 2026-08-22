package integration

// TestNotificationV2Contract validates the V2 notification type taxonomy contract.
//
// Ensures each system action emits the correct notification_type + policy_key pair,
// and validates all constants against the IsValid* functions (which reflect DB constraints).

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nvcnvn/tech-office/backend/internal/notification"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

func TestNotificationV2Contract(t *testing.T) {
	t.Parallel()

	t.Run("notification type taxonomy validation", func(t *testing.T) {
		t.Run("all defined notification types are validated by IsValidNotificationType", func(t *testing.T) {
			for _, nt := range notification.AllNotificationTypes() {
				assert.True(t, notification.IsValidNotificationType(nt),
					"notification type %q should be valid", nt)
			}
		})

		t.Run("all defined policy keys are validated by IsValidPolicyKey", func(t *testing.T) {
			policyKeys := []string{
				notification.PolicyKeyChatMessage,
				notification.PolicyKeyChatMention,
				notification.PolicyKeyChatReply,
				notification.PolicyKeyChatTypingLive,
				notification.PolicyKeyChatReactionLive,
				notification.PolicyKeyTaskAssignment,
				notification.PolicyKeyTaskComment,
				notification.PolicyKeyTaskMention,
				notification.PolicyKeyTaskStatus,
				notification.PolicyKeyTaskDescriptionModified,
				notification.PolicyKeyTaskUpdate,
				notification.PolicyKeyDocumentUpdate,
				notification.PolicyKeyDocumentComment,
				notification.PolicyKeyDocumentMention,
				notification.PolicyKeyPersistentDefault,
			}
			for _, key := range policyKeys {
				assert.True(t, notification.IsValidPolicyKey(key),
					"policy key %q should be valid", key)
			}
		})

		t.Run("all defined source domains are validated by IsValidSourceDomain", func(t *testing.T) {
			for _, domain := range notification.AllSourceDomains() {
				assert.True(t, notification.IsValidSourceDomain(domain),
					"source domain %q should be valid", domain)
			}
		})

		t.Run("all defined source categories are validated by IsValidSourceCategory", func(t *testing.T) {
			categories := []string{
				notification.SourceCategoryActivity,
				notification.SourceCategoryMention,
				notification.SourceCategorySystem,
			}
			for _, cat := range categories {
				assert.True(t, notification.IsValidSourceCategory(cat),
					"source category %q should be valid", cat)
			}
		})

		t.Run("all defined delivery classes are validated by IsValidDeliveryClass", func(t *testing.T) {
			classes := []string{
				notification.DeliveryClassPersistent,
				notification.DeliveryClassLiveOnly,
			}
			for _, cls := range classes {
				assert.True(t, notification.IsValidDeliveryClass(cls),
					"delivery class %q should be valid", cls)
			}
		})

		t.Run("all resource domains are validated by IsValidResourceDomain", func(t *testing.T) {
			domains := []string{
				notification.ResourceDomainTask,
				notification.ResourceDomainDocument,
				notification.ResourceDomainChannel,
			}
			for _, d := range domains {
				assert.True(t, notification.IsValidResourceDomain(d),
					"resource domain %q should be valid", d)
			}
		})

		t.Run("all subscription reason types are validated by IsValidResourceSubscriptionReasonType", func(t *testing.T) {
			reasons := []string{
				notification.ResourceSubscriptionReasonCreator,
				notification.ResourceSubscriptionReasonReporter,
				notification.ResourceSubscriptionReasonAssignee,
				notification.ResourceSubscriptionReasonManualFollow,
				notification.ResourceSubscriptionReasonCommented,
				notification.ResourceSubscriptionReasonMentioned,
				notification.ResourceSubscriptionReasonSystem,
			}
			for _, r := range reasons {
				assert.True(t, notification.IsValidResourceSubscriptionReasonType(r),
					"subscription reason type %q should be valid", r)
			}
		})
	})

	t.Run("chat mention emits correct type and policy_key in persisted record", func(t *testing.T) {
		// Contract: type=mention, policy=chat_mention, category=mention, domain=chat
		w := newTestWorld(t)
		owner := w.withOwner()
		target := w.withEmployee()

		channelID := w.createChannel(owner, "v2-contract-mention", false)
		w.inviteToChannel(owner, channelID, target.ID)
		msgID := w.sendMentionMessage(owner, channelID, target.ID)
		time.Sleep(300 * time.Millisecond)

		n := findNotificationByActionData(
			w.listNotifications(target, false),
			notification.SourceDomainChat, notification.NotificationTypeMention,
			"messageId", msgID)
		require.NotNil(t, n, "target should receive mention notification")

		assert.Equal(t, notification.NotificationTypeMention, n.NotificationType)
		assert.Equal(t, notification.PolicyKeyChatMention, n.PolicyKey)
		assert.Equal(t, notification.SourceCategoryMention, n.SourceCategory)
		assert.Equal(t, notification.SourceDomainChat, n.SourceDomain)
	})

	t.Run("task status change emits correct type and policy_key", func(t *testing.T) {
		// Contract: type=task_status_changed, policy=task_status, category=activity, domain=projects
		w := newTestWorld(t)
		owner := w.withOwner()
		watcher := w.withEmployee()
		mover := w.withEmployee()

		project := w.createProject(owner, "V2 Contract Status", uniqueProjectKey("V2CTS"))
		level0 := levelByDepth(project.Levels, 0)
		require.NotNil(t, level0)
		w.addProjectMember(owner, project.ID, watcher.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		w.addProjectMember(owner, project.ID, mover.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		task := w.createTask(owner, project.ID, "Contract Status Task", level0.Id)
		w.watchTask(watcher, task.Id)

		inProgress := stateByCategory(project.States, rpcv1.StateCategory_STATE_CATEGORY_IN_PROGRESS)
		require.NotNil(t, inProgress)
		w.moveTask(mover, task.Id, inProgress.Id)
		time.Sleep(300 * time.Millisecond)

		n := findNotificationByNavigationResource(
			w.listNotifications(watcher, false),
			notification.SourceDomainProjects, notification.NotificationTypeTaskStatusChanged, task.Id)
		require.NotNil(t, n, "watcher should receive task_status_changed")

		assert.Equal(t, notification.NotificationTypeTaskStatusChanged, n.NotificationType)
		assert.Equal(t, notification.PolicyKeyTaskStatus, n.PolicyKey)
		assert.Equal(t, notification.SourceCategoryActivity, n.SourceCategory)
		assert.Equal(t, notification.SourceDomainProjects, n.SourceDomain)
	})

	t.Run("task assignment emits correct type and policy_key", func(t *testing.T) {
		// Contract: type=task_assigned, policy=task_assignment, category=system, domain=projects
		w := newTestWorld(t)
		owner := w.withOwner()
		assignee := w.withEmployee()

		project := w.createProject(owner, "V2 Contract Assign", uniqueProjectKey("V2CA"))
		level0 := levelByDepth(project.Levels, 0)
		require.NotNil(t, level0)
		w.addProjectMember(owner, project.ID, assignee.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		task := w.createTask(owner, project.ID, "Contract Assign Task", level0.Id)
		w.assignTask(owner, task.Id, assignee.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE)
		time.Sleep(300 * time.Millisecond)

		n := findNotificationByNavigationResource(
			w.listNotifications(assignee, false),
			notification.SourceDomainProjects, notification.NotificationTypeTaskAssigned, task.Id)
		require.NotNil(t, n, "assignee should receive task_assigned")

		assert.Equal(t, notification.NotificationTypeTaskAssigned, n.NotificationType)
		assert.Equal(t, notification.PolicyKeyTaskAssignment, n.PolicyKey)
		assert.Equal(t, notification.SourceCategorySystem, n.SourceCategory)
		assert.Equal(t, notification.SourceDomainProjects, n.SourceDomain)
	})

	t.Run("document update emits correct type and policy_key", func(t *testing.T) {
		// Contract: type=doc_updated, policy=document_update, category=activity, domain=docs
		w := newTestWorld(t)
		owner := w.withOwner()
		follower := w.withEmployee()
		editor := w.withEmployee()

		docID := w.createDocument(owner, "V2 Contract Doc", `{"type":"doc","content":[]}`)
		w.setDocumentAccess(owner, docID, follower.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)
		w.setDocumentAccess(owner, docID, editor.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_WRITE_UPDATE)
		w.followDocument(follower, docID)

		w.updateDocument(editor, docID,
			`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Contract test"}]}]}`)
		time.Sleep(300 * time.Millisecond)

		n := findNotificationByNavigationResource(
			w.listNotifications(follower, false),
			notification.SourceDomainDocs, notification.NotificationTypeDocUpdated, docID)
		require.NotNil(t, n, "follower should receive doc_updated")

		assert.Equal(t, notification.NotificationTypeDocUpdated, n.NotificationType)
		assert.Equal(t, notification.PolicyKeyDocumentUpdate, n.PolicyKey)
		assert.Equal(t, notification.SourceCategoryActivity, n.SourceCategory)
		assert.Equal(t, notification.SourceDomainDocs, n.SourceDomain)
	})

	t.Run("document comment emits correct type and policy_key", func(t *testing.T) {
		// Contract: type=doc_commented, policy=document_comment, category=activity, domain=docs
		w := newTestWorld(t)
		owner := w.withOwner()
		follower := w.withEmployee()
		commenter := w.withEmployee()

		docID := w.createDocument(owner, "V2 Contract Doc Comment", `{"type":"doc","content":[]}`)
		w.setDocumentAccess(owner, docID, follower.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)
		w.setDocumentAccess(owner, docID, commenter.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)
		w.followDocument(follower, docID)

		w.addDocumentComment(commenter, docID, "V2 contract test comment")
		time.Sleep(300 * time.Millisecond)

		n := findNotificationByNavigationResource(
			w.listNotifications(follower, false),
			notification.SourceDomainDocs, notification.NotificationTypeDocCommented, docID)
		require.NotNil(t, n, "follower should receive doc_commented")

		assert.Equal(t, notification.NotificationTypeDocCommented, n.NotificationType)
		assert.Equal(t, notification.PolicyKeyDocumentComment, n.PolicyKey)
		assert.Equal(t, notification.SourceCategoryActivity, n.SourceCategory)
		assert.Equal(t, notification.SourceDomainDocs, n.SourceDomain)
	})

	t.Run("task discussion message emits task_commented via V2 bridge", func(t *testing.T) {
		// V2: A message to a task discussion channel should emit type=task_commented
		// to parent-task subscribers through the resource_surface bridge.
		w := newTestWorld(t)
		owner := w.withOwner()
		watcher := w.withEmployee()
		poster := w.withEmployee()

		project := w.createProject(owner, "V2 Contract Task Chat", uniqueProjectKey("V2CTC"))
		level0 := levelByDepth(project.Levels, 0)
		require.NotNil(t, level0)
		w.addProjectMember(owner, project.ID, watcher.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)
		w.addProjectMember(owner, project.ID, poster.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

		task := w.createTask(owner, project.ID, "Contract Chat Task", level0.Id)
		task = w.getTask(watcher, task.Id)
		if task.ChannelId == nil {
			t.Skip("task has no discussion channel")
		}
		w.watchTask(watcher, task.Id)
		w.inviteToChannel(owner, *task.ChannelId, watcher.ID)
		w.inviteToChannel(owner, *task.ChannelId, poster.ID)
		time.Sleep(100 * time.Millisecond)

		w.sendMessage(poster, *task.ChannelId, "V2 contract task discussion message")
		time.Sleep(300 * time.Millisecond)

		taskCommented := findNotificationByNavigationResource(
			w.listNotifications(watcher, false),
			notification.SourceDomainProjects, notification.NotificationTypeTaskCommented, task.Id)

		t.Run("task_commented is emitted for task discussion messages", func(t *testing.T) {
			require.NotNil(t, taskCommented,
				"task_commented should be emitted for task discussion messages via V2 bridge")
			assert.Equal(t, notification.NotificationTypeTaskCommented, taskCommented.NotificationType)
			assert.Equal(t, notification.PolicyKeyTaskComment, taskCommented.PolicyKey)
			assert.Equal(t, notification.SourceCategoryActivity, taskCommented.SourceCategory)
			assert.Equal(t, notification.SourceDomainProjects, taskCommented.SourceDomain)
		})

		t.Run("task_commented actionData includes channelId and deepLink for chat routing", func(t *testing.T) {
			require.NotNil(t, taskCommented,
				"task_commented should be emitted for task discussion messages via V2 bridge")
			assert.NotEmpty(t, taskCommented.ActionData["channelId"],
				"task_commented actionData must include channelId so mobile can route to chat")
			assert.NotEmpty(t, taskCommented.ActionData["deepLink"],
				"task_commented actionData must include deepLink so mobile can route to chat")
			assert.Contains(t, taskCommented.ActionData["deepLink"], "chat/",
				"task_commented deepLink should point to the chat channel")
		})

		t.Run("task_commented notification has non-empty message body", func(t *testing.T) {
			require.NotNil(t, taskCommented,
				"task_commented should be emitted for task discussion messages via V2 bridge")
			assert.NotEmpty(t, taskCommented.Message,
				"task_commented notification must have a non-empty message body for push delivery")
		})
	})

	t.Run("subscription reason types are correct for each triggering action", func(t *testing.T) {
		t.Run("manual watch stores manual_follow reason", func(t *testing.T) {
			w := newTestWorld(t)
			owner := w.withOwner()
			watcher := w.withEmployee()

			project := w.createProject(owner, "V2 Watch Reason", uniqueProjectKey("V2WR"))
			level0 := levelByDepth(project.Levels, 0)
			require.NotNil(t, level0)

			task := w.createTask(owner, project.ID, "Watch Reason Task", level0.Id)
			w.watchTask(watcher, task.Id)

			reasons := w.queryResourceSubscriptionReasons(watcher.ID, notification.ResourceDomainTask, task.Id)
			assert.Contains(t, reasons, notification.ResourceSubscriptionReasonManualFollow)
			assert.NotContains(t, reasons, notification.ResourceSubscriptionReasonAssignee)
		})

		t.Run("task assignment stores assignee reason", func(t *testing.T) {
			w := newTestWorld(t)
			owner := w.withOwner()
			assignee := w.withEmployee()

			project := w.createProject(owner, "V2 Assignee Reason", uniqueProjectKey("V2AR"))
			level0 := levelByDepth(project.Levels, 0)
			require.NotNil(t, level0)
			w.addProjectMember(owner, project.ID, assignee.ID, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER)

			task := w.createTask(owner, project.ID, "Assignee Reason Task", level0.Id)
			w.assignTask(owner, task.Id, assignee.ID, rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE)

			reasons := w.queryResourceSubscriptionReasons(assignee.ID, notification.ResourceDomainTask, task.Id)
			assert.Contains(t, reasons, notification.ResourceSubscriptionReasonAssignee)
			assert.NotContains(t, reasons, notification.ResourceSubscriptionReasonManualFollow)
		})

		t.Run("document creation stores creator reason", func(t *testing.T) {
			w := newTestWorld(t)
			creator := w.withOwner()

			docID := w.createDocument(creator, "V2 Creator Reason", `{"type":"doc","content":[]}`)
			reasons := w.queryResourceSubscriptionReasons(creator.ID, notification.ResourceDomainDocument, docID)
			assert.Contains(t, reasons, notification.ResourceSubscriptionReasonCreator)
		})

		t.Run("document manual follow stores manual_follow reason", func(t *testing.T) {
			w := newTestWorld(t)
			owner := w.withOwner()
			follower := w.withEmployee()

			docID := w.createDocument(owner, "V2 Follow Reason", `{"type":"doc","content":[]}`)
			w.setDocumentAccess(owner, docID, follower.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)
			w.followDocument(follower, docID)

			reasons := w.queryResourceSubscriptionReasons(follower.ID, notification.ResourceDomainDocument, docID)
			assert.Contains(t, reasons, notification.ResourceSubscriptionReasonManualFollow)
		})

		t.Run("document comment stores commented reason", func(t *testing.T) {
			w := newTestWorld(t)
			owner := w.withOwner()
			commenter := w.withEmployee()

			docID := w.createDocument(owner, "V2 Comment Reason", `{"type":"doc","content":[]}`)
			w.setDocumentAccess(owner, docID, commenter.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)
			w.addDocumentComment(commenter, docID, "Reason test comment")

			reasons := w.queryResourceSubscriptionReasons(commenter.ID, notification.ResourceDomainDocument, docID)
			assert.Contains(t, reasons, notification.ResourceSubscriptionReasonCommented)
		})
	})
}
