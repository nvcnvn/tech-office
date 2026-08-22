package integration

import (
	"testing"
	"time"

	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestChatNotificationStream verifies that chat messages are delivered over the
// notification SSE stream, with regular channel messages staying live-only and
// direct messages remaining streamable even though they are persisted.
func TestChatNotificationStream(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	users := w.withEmployees(2)
	alice, bob := users[0], users[1]

	t.Run("when bob is subscribed to the notification stream and alice sends a channel message", func(t *testing.T) {
		channelID := w.createChannel(alice, "stream-debug", false)
		w.inviteToChannel(alice, channelID, bob.ID)

		stream, connectionID, cancel := w.openNotificationHTTPStream(bob, 10*time.Second)
		defer cancel()
		require.True(t, w.connectionExists(dbuuid.MustParse(connectionID)), "stream connection should be registered before sending message")

		messageID := w.sendMessage(alice, channelID, "stream message for bob")

		event := w.receiveNextHTTPNotificationEvent(stream)

		t.Run("bob receives a chat notification event on the stream", func(t *testing.T) {
			require.NotNil(t, event)
			assert.Equal(t, "notification", event.EventType)
			require.NotNil(t, event.Notification)
			assert.Equal(t, "chat", event.Notification.SourceDomain)
			assert.Equal(t, "message", event.Notification.NotificationType)
		})

		t.Run("the event points to the same channel and message", func(t *testing.T) {
			require.NotNil(t, event.Notification)
			assert.Equal(t, channelID, event.Notification.ActionData["channelId"])
			assert.Equal(t, messageID, event.Notification.ActionData["messageId"])
			assert.Equal(t, "chat", event.Notification.ActionData["channelType"])
			assert.Equal(t, "stream-debug", event.Notification.ActionData["channelName"])
			assert.Equal(t, alice.ID.String(), event.Notification.ActionData["senderEmployeeId"])
			assert.NotEmpty(t, event.Notification.ActionData["senderName"])
		})

		t.Run("regular channel messages are live_only and not persisted to inbox", func(t *testing.T) {
			// Regular channel messages remain live_only per the notification architecture.
			// They are ephemeral SSE events, not stored in the notification inbox.
			time.Sleep(200 * time.Millisecond) // wait for any async processing
			notifications := w.listNotifications(bob, false)
			for _, n := range notifications {
				if n.SourceDomain == "chat" && n.NotificationType == "message" && n.ActionData["messageId"] == messageID {
					t.Fatal("live_only regular channel message should not be persisted to inbox")
				}
			}
		})
	})

	t.Run("when bob is subscribed to the notification stream and alice sends a direct message", func(t *testing.T) {
		dmChannelID := w.createOrGetDM(alice, bob.ID)

		stream, connectionID, cancel := w.openNotificationHTTPStream(bob, 10*time.Second)
		defer cancel()
		require.True(t, w.connectionExists(dbuuid.MustParse(connectionID)), "stream connection should be registered before sending DM")

		messageID := w.sendMessage(alice, dmChannelID, "private ping")
		event := w.receiveNextHTTPNotificationEvent(stream)

		require.NotNil(t, event)
		require.NotNil(t, event.Notification)
		assert.Equal(t, "chat", event.Notification.SourceDomain)
		assert.Equal(t, "message", event.Notification.NotificationType)
		assert.Equal(t, dmChannelID, event.Notification.ActionData["channelId"])
		assert.Equal(t, messageID, event.Notification.ActionData["messageId"])
		assert.Equal(t, "direct_message", event.Notification.ActionData["channelType"])
		assert.Equal(t, alice.ID.String(), event.Notification.ActionData["senderEmployeeId"])
		assert.NotEmpty(t, event.Notification.ActionData["senderName"])
	})
}
