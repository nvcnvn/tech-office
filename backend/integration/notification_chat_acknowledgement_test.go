package integration

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nvcnvn/tech-office/backend/internal/notification"
)

func TestNotificationChatAcknowledgement(t *testing.T) {
	t.Run("when a user opens a channel with a pending chat notification", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		mentionedUser := w.withEmployee()

		channelID := w.createChannel(owner, "notification-chat-ack", false)
		w.inviteToChannel(owner, channelID, mentionedUser.ID)

		initialUnreadCount := w.getUnreadCount(mentionedUser)
		messageID := w.sendMentionMessage(owner, channelID, mentionedUser.ID)
		time.Sleep(300 * time.Millisecond)

		notificationsBeforeRead := w.listNotifications(mentionedUser, false)
		mentionNotification := findNotificationByActionData(
			notificationsBeforeRead,
			notification.SourceDomainChat,
			notification.NotificationTypeMention,
			"messageId",
			messageID,
		)
		require.NotNil(t, mentionNotification)

		t.Run("the notification contributes to the unread count", func(t *testing.T) {
			assert.Equal(t, "pending", mentionNotification.AcknowledgementStatus)
			assert.GreaterOrEqual(t, w.getUnreadCount(mentionedUser), initialUnreadCount+1)
		})

		w.markChannelAsRead(mentionedUser, channelID)

		t.Run("the notification is acknowledged as destination_open", func(t *testing.T) {
			notificationsAfterRead := w.listNotifications(mentionedUser, false)
			updatedNotification := findNotification(notificationsAfterRead, mentionNotification.NotificationId)
			require.NotNil(t, updatedNotification)
			assert.Equal(t, "acknowledged", updatedNotification.AcknowledgementStatus)
			assert.Equal(t, notification.AckActionDestinationOpen, updatedNotification.AcknowledgementAction)
		})

		t.Run("the unread count returns to its prior value", func(t *testing.T) {
			assert.Equal(t, initialUnreadCount, w.getUnreadCount(mentionedUser))
		})

		t.Run("the notification disappears from the unread-only list", func(t *testing.T) {
			unreadNotifications := w.listNotifications(mentionedUser, true)
			assert.Nil(t, findNotification(unreadNotifications, mentionNotification.NotificationId))
		})
	})

	t.Run("when a user opens a channel where someone replied to their message", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		replier := w.withEmployee()

		channelID := w.createChannel(owner, "notification-reply-ack", false)
		w.inviteToChannel(owner, channelID, replier.ID)

		initialUnreadCount := w.getUnreadCount(owner)
		parentMessageID := w.sendMessage(owner, channelID, "hello folks")
		w.replyToMessage(replier, parentMessageID, "reply here")
		time.Sleep(300 * time.Millisecond)

		notificationsBeforeRead := w.listNotifications(owner, false)
		replyNotification := findNotificationByActionData(
			notificationsBeforeRead,
			notification.SourceDomainChat,
			notification.NotificationTypeReply,
			"parentMessageId",
			parentMessageID,
		)
		require.NotNil(t, replyNotification, "owner should have a pending reply notification")

		t.Run("the reply notification is pending and increases unread count", func(t *testing.T) {
			assert.Equal(t, "pending", replyNotification.AcknowledgementStatus)
			assert.GreaterOrEqual(t, w.getUnreadCount(owner), initialUnreadCount+1)
		})

		w.markChannelAsRead(owner, channelID)

		t.Run("the reply notification is acknowledged after marking channel read", func(t *testing.T) {
			notificationsAfterRead := w.listNotifications(owner, false)
			updatedNotification := findNotification(notificationsAfterRead, replyNotification.NotificationId)
			require.NotNil(t, updatedNotification)
			assert.Equal(t, "acknowledged", updatedNotification.AcknowledgementStatus)
			assert.Equal(t, notification.AckActionDestinationOpen, updatedNotification.AcknowledgementAction)
		})

		t.Run("the unread count returns to its prior value", func(t *testing.T) {
			assert.Equal(t, initialUnreadCount, w.getUnreadCount(owner))
		})
	})

	t.Run("when a channel has both mention and reply notifications pending", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		employee := w.withEmployee()

		channelID := w.createChannel(owner, "notification-bulk-ack", false)
		w.inviteToChannel(owner, channelID, employee.ID)

		initialUnreadCount := w.getUnreadCount(employee)

		// owner → mention employee, then reply to employee's message
		w.sendMentionMessage(owner, channelID, employee.ID)
		empMessageID := w.sendMessage(employee, channelID, "my message")
		w.replyToMessage(owner, empMessageID, "a reply")
		time.Sleep(300 * time.Millisecond)

		notificationsBeforeRead := w.listNotifications(employee, true)
		require.GreaterOrEqual(t, len(notificationsBeforeRead), 2, "should have at least 2 unread notifications")
		pendingCount := w.getUnreadCount(employee)
		assert.GreaterOrEqual(t, pendingCount, initialUnreadCount+2)

		w.markChannelAsRead(employee, channelID)
		time.Sleep(100 * time.Millisecond)

		t.Run("all unread notifications for that channel are cleared in one call", func(t *testing.T) {
			for _, n := range notificationsBeforeRead {
				if n.ActionData["channelId"] != channelID {
					continue
				}
				updated := findNotification(w.listNotifications(employee, false), n.NotificationId)
				require.NotNil(t, updated)
				assert.Equal(t, "acknowledged", updated.AcknowledgementStatus)
			}
		})

		t.Run("the unread count drops by the number of cleared notifications", func(t *testing.T) {
			assert.Equal(t, initialUnreadCount, w.getUnreadCount(employee))
		})
	})

	t.Run("when a user reads channel B, notifications from channel A are not affected", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		employee := w.withEmployee()

		channelA := w.createChannel(owner, "notification-iso-chan-a", false)
		channelB := w.createChannel(owner, "notification-iso-chan-b", false)
		w.inviteToChannel(owner, channelA, employee.ID)
		w.inviteToChannel(owner, channelB, employee.ID)

		w.sendMentionMessage(owner, channelA, employee.ID)
		time.Sleep(300 * time.Millisecond)

		notificationsBeforeRead := w.listNotifications(employee, false)
		mentionNotif := findNotificationByActionData(
			notificationsBeforeRead,
			notification.SourceDomainChat,
			notification.NotificationTypeMention,
			"channelId",
			channelA,
		)
		require.NotNil(t, mentionNotif, "should have a pending mention in channel A")
		assert.Equal(t, "pending", mentionNotif.AcknowledgementStatus)

		// read channel B — channel A notification must stay pending
		w.markChannelAsRead(employee, channelB)

		t.Run("the channel A notification remains pending", func(t *testing.T) {
			notificationsAfter := w.listNotifications(employee, false)
			updated := findNotification(notificationsAfter, mentionNotif.NotificationId)
			require.NotNil(t, updated)
			assert.Equal(t, "pending", updated.AcknowledgementStatus)
		})
	})
}
