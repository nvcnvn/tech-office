package integration

import (
	"testing"
	"time"

	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestNotificationRouting verifies that presence status and push token
// infrastructure support smart notification routing decisions.
func TestNotificationRouting(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	employee := w.withEmployee()

	t.Run("when an employee is ONLINE", func(t *testing.T) {
		w.updatePresence(employee, rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE)

		t.Run("presence status is retrievable for routing decisions", func(t *testing.T) {
			p := w.getPresence(employee, employee.ID)
			assert.Equal(t, rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE, p.Status)
		})
	})

	t.Run("when an employee is ONLINE_HIDDEN (tab not focused)", func(t *testing.T) {
		w.updatePresence(employee, rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE_HIDDEN)

		t.Run("routing can detect the hidden status for push notification fallback", func(t *testing.T) {
			p := w.getPresence(employee, employee.ID)
			assert.Equal(t, rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE_HIDDEN, p.Status)
		})
	})

	t.Run("when an employee registers a push token", func(t *testing.T) {
		deviceID := uniqueSlug("device-routing")
		tokenID := w.registerPushToken(employee, deviceID)

		t.Run("the token is available for routing queries", func(t *testing.T) {
			tokens := w.listPushTokens(employee)
			tok := findPushTokenByID(tokens, tokenID)
			require.NotNil(t, tok)
			assert.True(t, tok.IsValid)
		})
	})

	t.Run("when an employee is actively viewing a channel", func(t *testing.T) {
		channelID := w.createChannel(employee, "context-routing", false)
		w.updatePresenceWithChannel(employee, rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE, channelID)

		t.Run("active_channel_id is tracked for context-aware suppression", func(t *testing.T) {
			p := w.getPresence(employee, employee.ID)
			assert.Equal(t, channelID, p.ActiveChannelId)
		})
	})

	t.Run("when an employee goes OFFLINE", func(t *testing.T) {
		w.updatePresence(employee, rpcv1.PresenceStatus_PRESENCE_STATUS_OFFLINE)

		t.Run("routing detects offline status for push-only delivery", func(t *testing.T) {
			p := w.getPresence(employee, employee.ID)
			assert.Equal(t, rpcv1.PresenceStatus_PRESENCE_STATUS_OFFLINE, p.Status)
			assert.Empty(t, p.ActiveChannelId, "offline users have no active channel")
		})
	})

	t.Run("when an employee only has a stale active connection", func(t *testing.T) {
		staleEmployee := w.withEmployee()
		w.insertStaleConnection(staleEmployee.ID, 2*time.Minute, "stale-instance")

		t.Run("routing treats the employee as offline", func(t *testing.T) {
			p := w.getPresence(staleEmployee, staleEmployee.ID)
			assert.Equal(t, rpcv1.PresenceStatus_PRESENCE_STATUS_OFFLINE, p.Status)
		})
	})

	t.Run("when an employee sets visibility to OFFLINE but is actually ONLINE", func(t *testing.T) {
		w.setPresenceVisibility(employee, rpcv1.VisibilityMode_VISIBILITY_MODE_OFFLINE, "", "")
		w.updatePresence(employee, rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE)

		t.Run("routing uses actual status, not visibility facade", func(t *testing.T) {
			p := w.getPresence(employee, employee.ID)
			assert.Equal(t, rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE, p.Status)
		})
	})

	t.Run("when a notification is published while employee has push token", func(t *testing.T) {
		notifID := w.publishNotification(employee.ID, "Push Routing Test")

		t.Run("the notification is delivered regardless of push capability", func(t *testing.T) {
			list := w.listNotifications(employee, false)
			n := findNotification(list, notifID)
			require.NotNil(t, n)
			assert.Equal(t, "Push Routing Test", n.Title)
		})
	})

	t.Run("when push token is revoked and notification is published", func(t *testing.T) {
		// Revoke all tokens
		tokens := w.listPushTokens(employee)
		for _, tok := range tokens {
			if tok.IsValid {
				w.revokePushTokenByID(employee, tok.TokenId)
			}
		}

		notifID := w.publishNotification(employee.ID, "Post-Revoke Notification")

		t.Run("notifications still work without push tokens", func(t *testing.T) {
			list := w.listNotifications(employee, false)
			n := findNotification(list, notifID)
			require.NotNil(t, n)
			assert.Equal(t, "Post-Revoke Notification", n.Title)
		})
	})

	t.Run("when a persistent notification is published while the recipient has a live stream", func(t *testing.T) {
		w := newTestWorld(t)
		recipient := w.withEmployee()
		stream, connectionID, cancel := w.openNotificationStream(recipient, 5*time.Second)
		defer cancel()

		notifID := w.publishPersistentNotification(recipient.ID, "rescue-online-queued")
		event := w.receiveNextNotificationEvent(stream)
		require.NotNil(t, event.Notification)
		require.Equal(t, notifID, event.Notification.NotificationId)
		require.NotEmpty(t, event.Notification.NotificationRecipientId)

		t.Run("rescue push is queued instead of skipped permanently", func(t *testing.T) {
			status, reason, dueAt := w.queryFallbackState(event.Notification.NotificationRecipientId)
			assert.Equal(t, "queued", status)
			assert.Equal(t, "recipient_online", reason)
			assert.True(t, dueAt.Valid, "queued fallback should have a due time")
		})

		t.Run("a visible web receipt suppresses the queued rescue push", func(t *testing.T) {
			confirmed := w.confirmNotificationReceipt(recipient, connectionID, "web", "foreground", "visible", event.Notification.NotificationRecipientId)
			require.EqualValues(t, 1, confirmed)

			status, reason, dueAt := w.queryFallbackState(event.Notification.NotificationRecipientId)
			assert.Equal(t, "skipped", status)
			assert.Equal(t, "sse_receipt_confirmed", reason)
			assert.False(t, dueAt.Valid, "receipt-suppressed fallback should clear due time")
		})
	})

	t.Run("when a hidden web tab confirms receipt", func(t *testing.T) {
		w := newTestWorld(t)
		recipient := w.withEmployee()
		stream, connectionID, cancel := w.openNotificationStream(recipient, 5*time.Second)
		defer cancel()

		notifID := w.publishPersistentNotification(recipient.ID, "rescue-hidden-not-suppressing")
		event := w.receiveNextNotificationEvent(stream)
		require.NotNil(t, event.Notification)
		require.Equal(t, notifID, event.Notification.NotificationId)

		confirmed := w.confirmNotificationReceipt(recipient, connectionID, "web", "foreground", "hidden", event.Notification.NotificationRecipientId)
		require.EqualValues(t, 1, confirmed)

		t.Run("the rescue push remains queued", func(t *testing.T) {
			status, reason, dueAt := w.queryFallbackState(event.Notification.NotificationRecipientId)
			assert.Equal(t, "queued", status)
			assert.Equal(t, "recipient_online", reason)
			assert.True(t, dueAt.Valid)
		})
	})
}
