package integration

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestNotificationLifecycle covers publish, list, mark-as-read, mark-all, and delete.
func TestNotificationLifecycle(t *testing.T) {
	w := newTestWorld(t)
	owner := w.withOwner()
	emp := w.withEmployee()

	t.Run("when a notification is published", func(t *testing.T) {
		initialCount := w.getUnreadCount(emp)
		notifID := w.publishNotification(emp.ID, "lifecycle-test")

		t.Run("the unread count increments", func(t *testing.T) {
			newCount := w.getUnreadCount(emp)
			require.GreaterOrEqual(t, newCount, initialCount+1)
		})

		t.Run("the notification appears in the full list", func(t *testing.T) {
			all := w.listNotifications(emp, false)
			n := findNotification(all, notifID)
			require.NotNil(t, n)
			assert.Equal(t, "lifecycle-test", n.Title)
			assert.Equal(t, "chat", n.SourceDomain)
			assert.False(t, n.ReadStatus)
		})

		t.Run("when marked as read", func(t *testing.T) {
			all := w.listNotifications(emp, false)
			n := findNotification(all, notifID)
			require.NotNil(t, n)
			updated := w.markAsRead(emp, n.NotificationRecipientId)
			assert.EqualValues(t, 1, updated)

			t.Run("it disappears from the unread-only list", func(t *testing.T) {
				unread := w.listNotifications(emp, true)
				assert.Nil(t, findNotification(unread, notifID))
			})

			t.Run("the read status is true in the full list", func(t *testing.T) {
				all2 := w.listNotifications(emp, false)
				n2 := findNotification(all2, notifID)
				require.NotNil(t, n2)
				assert.True(t, n2.ReadStatus)
			})
		})

		t.Run("when deleted", func(t *testing.T) {
			all := w.listNotifications(emp, false)
			n := findNotification(all, notifID)
			require.NotNil(t, n)
			w.deleteNotification(emp, n.NotificationRecipientId)

			t.Run("it disappears from all lists", func(t *testing.T) {
				final := w.listNotifications(emp, false)
				assert.Nil(t, findNotification(final, notifID))
			})
		})
	})

	t.Run("when mark-all-before-timestamp is called", func(t *testing.T) {
		notifID := w.publishNotification(emp.ID, "markall-test")
		updated := w.markAllBeforeTimestamp(emp, time.Now().Add(1*time.Minute))
		require.GreaterOrEqual(t, updated, int32(1))

		t.Run("the notification is marked as read", func(t *testing.T) {
			all := w.listNotifications(emp, false)
			n := findNotification(all, notifID)
			require.NotNil(t, n)
			assert.True(t, n.ReadStatus)
		})

		t.Run("it disappears from unread-only list", func(t *testing.T) {
			unread := w.listNotifications(emp, true)
			assert.Nil(t, findNotification(unread, notifID))
		})
	})

	t.Run("when mark-all-before-timestamp is called without a timestamp (nil)", func(t *testing.T) {
		notifID := w.publishNotification(emp.ID, "markall-no-ts-test")

		t.Run("it still marks all existing notifications as read", func(t *testing.T) {
			updated := w.markAllNoTimestamp(emp)
			require.GreaterOrEqual(t, updated, int32(1), "nil timestamp should mark all current notifications, not zero")

			all := w.listNotifications(emp, false)
			n := findNotification(all, notifID)
			require.NotNil(t, n)
			assert.True(t, n.ReadStatus)
		})

		t.Run("the unread list is empty afterwards", func(t *testing.T) {
			unread := w.listNotifications(emp, true)
			assert.Nil(t, findNotification(unread, notifID))
		})
	})

	t.Run("when delivery status is checked via DB", func(t *testing.T) {
		notifID := w.publishNotification(emp.ID, "delivery-status-check")
		all := w.listNotifications(emp, false)
		n := findNotification(all, notifID)
		require.NotNil(t, n)

		t.Run("the delivery status is stored", func(t *testing.T) {
			status, _ := w.queryDeliveryStatus(n.NotificationRecipientId)
			require.NotEmpty(t, status)
		})
	})

	_ = owner // owner used to set up org context
}
