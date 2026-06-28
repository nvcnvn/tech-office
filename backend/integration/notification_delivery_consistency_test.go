package integration

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestNotificationDeliveryConsistency validates that:
//   - persistent notifications are stored and appear in the inbox
//   - live_only notifications are NOT stored and do not appear in the inbox
//   - acknowledgement correctly transitions pending to acknowledged
//   - unread-only filter excludes acknowledged notifications
func TestNotificationDeliveryConsistency(t *testing.T) {

	t.Run("when a persistent notification is published", func(t *testing.T) {
		w := newTestWorld(t)
		emp := w.withEmployee()

		notifID := w.publishPersistentNotification(emp.ID, "dc-persistent")
		time.Sleep(200 * time.Millisecond)

		t.Run("it appears in the full notification list", func(t *testing.T) {
			all := w.listNotifications(emp, false)
			n := findNotification(all, notifID)
			require.NotNil(t, n, "persistent notification should be stored")
			assert.Equal(t, "dc-persistent", n.Title)
		})

		t.Run("it has pending acknowledgement_status", func(t *testing.T) {
			all := w.listNotifications(emp, false)
			n := findNotification(all, notifID)
			require.NotNil(t, n)
			assert.Equal(t, "pending", n.AcknowledgementStatus)
		})

		t.Run("it appears in the unread-only list", func(t *testing.T) {
			unread := w.listNotifications(emp, true)
			n := findNotification(unread, notifID)
			require.NotNil(t, n, "pending notification should be in unread-only list")
		})

		t.Run("it carries policy_key and source_category", func(t *testing.T) {
			all := w.listNotifications(emp, false)
			n := findNotification(all, notifID)
			require.NotNil(t, n)
			assert.Equal(t, "chat_message", n.PolicyKey)
			assert.Equal(t, "activity", n.SourceCategory)
		})

		t.Run("it carries navigation_target with domain and resource_type", func(t *testing.T) {
			all := w.listNotifications(emp, false)
			n := findNotification(all, notifID)
			require.NotNil(t, n)
			require.NotNil(t, n.NavigationTarget)
			assert.Equal(t, "chat", n.NavigationTarget.Domain)
			assert.Equal(t, "channel", n.NavigationTarget.ResourceType)
		})
	})

	t.Run("when a live_only notification is published", func(t *testing.T) {
		w := newTestWorld(t)
		emp := w.withEmployee()

		notifID := w.publishLiveOnlyNotification(emp.ID, "dc-live-only")
		time.Sleep(200 * time.Millisecond)

		t.Run("it does NOT appear in the notification list", func(t *testing.T) {
			all := w.listNotifications(emp, false)
			n := findNotification(all, notifID)
			assert.Nil(t, n, "live_only notification must not be stored in inbox")
		})
	})

	t.Run("when a notification is acknowledged via destination_open", func(t *testing.T) {
		w := newTestWorld(t)
		emp := w.withEmployee()

		notifID := w.publishPersistentNotification(emp.ID, "dc-ack-dest-open")
		time.Sleep(200 * time.Millisecond)

		all := w.listNotifications(emp, false)
		n := findNotification(all, notifID)
		require.NotNil(t, n)

		count := w.acknowledgeNotifications(emp, "destination_open", n.NotificationRecipientId)
		require.EqualValues(t, 1, count)

		t.Run("acknowledgement_status becomes acknowledged", func(t *testing.T) {
			all2 := w.listNotifications(emp, false)
			n2 := findNotification(all2, notifID)
			require.NotNil(t, n2)
			assert.Equal(t, "acknowledged", n2.AcknowledgementStatus)
			assert.Equal(t, "destination_open", n2.AcknowledgementAction)
		})

		t.Run("it disappears from the unread-only list", func(t *testing.T) {
			unread := w.listNotifications(emp, true)
			assert.Nil(t, findNotification(unread, notifID))
		})
	})

	t.Run("when a notification is acknowledged via explicit_ack", func(t *testing.T) {
		w := newTestWorld(t)
		emp := w.withEmployee()

		notifID := w.publishPersistentNotification(emp.ID, "dc-ack-explicit")
		time.Sleep(200 * time.Millisecond)

		all := w.listNotifications(emp, false)
		n := findNotification(all, notifID)
		require.NotNil(t, n)

		count := w.acknowledgeNotifications(emp, "explicit_ack", n.NotificationRecipientId)
		require.EqualValues(t, 1, count)

		t.Run("acknowledgement_status becomes acknowledged", func(t *testing.T) {
			all2 := w.listNotifications(emp, false)
			n2 := findNotification(all2, notifID)
			require.NotNil(t, n2)
			assert.Equal(t, "acknowledged", n2.AcknowledgementStatus)
			assert.Equal(t, "explicit_ack", n2.AcknowledgementAction)
		})

		t.Run("it disappears from the unread-only list", func(t *testing.T) {
			unread := w.listNotifications(emp, true)
			assert.Nil(t, findNotification(unread, notifID))
		})
	})

	t.Run("when acknowledge_all_before_timestamp is called", func(t *testing.T) {
		w := newTestWorld(t)
		emp := w.withEmployee()

		notifID1 := w.publishPersistentNotification(emp.ID, "dc-ack-all-1")
		notifID2 := w.publishPersistentNotification(emp.ID, "dc-ack-all-2")
		time.Sleep(200 * time.Millisecond)

		count := w.acknowledgeAllBeforeTimestamp(emp, time.Now().Add(1*time.Minute), "explicit_ack")
		require.GreaterOrEqual(t, count, int32(2))

		t.Run("all covered notifications become acknowledged", func(t *testing.T) {
			all := w.listNotifications(emp, false)
			n1 := findNotification(all, notifID1)
			n2 := findNotification(all, notifID2)
			require.NotNil(t, n1)
			require.NotNil(t, n2)
			assert.Equal(t, "acknowledged", n1.AcknowledgementStatus)
			assert.Equal(t, "acknowledged", n2.AcknowledgementStatus)
		})

		t.Run("none appear in unread-only list", func(t *testing.T) {
			unread := w.listNotifications(emp, true)
			assert.Nil(t, findNotification(unread, notifID1))
			assert.Nil(t, findNotification(unread, notifID2))
		})
	})

	t.Run("when a recipient is from a different org", func(t *testing.T) {
		// Use separate worlds to avoid w.OrgID/w.ownerToken conflicts.
		wInsider := newTestWorld(t)
		insider := wInsider.withEmployee()

		wOutsider := newTestWorld(t)
		outsider := wOutsider.withEmployee()

		notifID := wInsider.publishPersistentNotification(insider.ID, "dc-isolation")
		time.Sleep(200 * time.Millisecond)

		t.Run("the outsider cannot see the notification", func(t *testing.T) {
			// listNotifications uses outsider.Token; server scopes results to outsider's org.
			all := wInsider.listNotifications(outsider, false)
			assert.Nil(t, findNotification(all, notifID), "cross-org notification must not leak")
		})
	})
}
