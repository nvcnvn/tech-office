package integration

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// TestNotificationFrontendParity validates the backend contracts that frontend
// clients depend on: navigation metadata, acknowledgement fields, policy/source
// category, and delivery class behaviour. These tests act as a contract check
// so changes to the backend payload break loudly before frontend breakage.
func TestNotificationFrontendParity(t *testing.T) {

	t.Run("when a persistent notification is listed", func(t *testing.T) {
		w := newTestWorld(t)
		emp := w.withEmployee()

		notifID := w.publishPersistentNotification(emp.ID, "parity-persistent")
		time.Sleep(200 * time.Millisecond)

		all := w.listNotifications(emp, false)
		n := findNotification(all, notifID)
		require.NotNil(t, n, "persistent notification must be in inbox")

		t.Run("navigation_target has domain field", func(t *testing.T) {
			require.NotNil(t, n.NavigationTarget, "navigation_target must not be nil")
			assert.NotEmpty(t, n.NavigationTarget.Domain, "domain must be set")
		})

		t.Run("navigation_target has resource_type field", func(t *testing.T) {
			assert.NotEmpty(t, n.NavigationTarget.ResourceType, "resource_type must be set")
		})

		t.Run("navigation_target has resource_id field", func(t *testing.T) {
			assert.NotEmpty(t, n.NavigationTarget.ResourceId, "resource_id must be set")
		})

		t.Run("policy_key matches chat_message", func(t *testing.T) {
			assert.Equal(t, "chat_message", n.PolicyKey)
		})

		t.Run("source_category is activity", func(t *testing.T) {
			assert.Equal(t, "activity", n.SourceCategory)
		})

		t.Run("acknowledgement_status starts as pending", func(t *testing.T) {
			assert.Equal(t, "pending", n.AcknowledgementStatus)
		})

		t.Run("acknowledgement_action is empty before any action", func(t *testing.T) {
			assert.Empty(t, n.AcknowledgementAction)
		})
	})

	t.Run("when a notification is acknowledged and then listed", func(t *testing.T) {
		w := newTestWorld(t)
		emp := w.withEmployee()

		notifID := w.publishPersistentNotification(emp.ID, "parity-ack")
		time.Sleep(200 * time.Millisecond)

		all := w.listNotifications(emp, false)
		n := findNotification(all, notifID)
		require.NotNil(t, n)

		w.acknowledgeNotifications(emp, "explicit_ack", n.NotificationRecipientId)

		t.Run("acknowledgement_status becomes acknowledged", func(t *testing.T) {
			all2 := w.listNotifications(emp, false)
			n2 := findNotification(all2, notifID)
			require.NotNil(t, n2)
			assert.Equal(t, "acknowledged", n2.AcknowledgementStatus)
		})

		t.Run("acknowledgement_action is set to explicit_ack", func(t *testing.T) {
			all2 := w.listNotifications(emp, false)
			n2 := findNotification(all2, notifID)
			require.NotNil(t, n2)
			assert.Equal(t, "explicit_ack", n2.AcknowledgementAction)
		})

		t.Run("acknowledged_at is set", func(t *testing.T) {
			all2 := w.listNotifications(emp, false)
			n2 := findNotification(all2, notifID)
			require.NotNil(t, n2)
			assert.NotNil(t, n2.AcknowledgedAt, "acknowledged_at must be populated after ack")
		})
	})

	t.Run("when a live_only notification is published", func(t *testing.T) {
		w := newTestWorld(t)
		emp := w.withEmployee()

		notifID := w.publishLiveOnlyNotification(emp.ID, "parity-live-only")
		time.Sleep(200 * time.Millisecond)

		t.Run("it does not appear in the inbox", func(t *testing.T) {
			all := w.listNotifications(emp, false)
			n := findNotification(all, notifID)
			assert.Nil(t, n, "live_only delivery class must not persist notification to inbox")
		})
	})

	t.Run("when a mention-typed notification is published", func(t *testing.T) {
		w := newTestWorld(t)
		emp := w.withEmployee()

		sysToken := w.systemToken()
		req := connect.NewRequest(&rpcv1.PublishNotificationRequest{
			OrganizationId: w.OrgID.String(),
			Recipients: &rpcv1.NotificationRecipients{
				EmployeeIds: []string{emp.ID.String()},
			},
			SourceDomain:        "chat",
			NotificationType:    "mention",
			Title:               "parity-mention",
			Message:             "You were mentioned",
			ActionCategory:      "integration",
			Priority:            1,
			PublishingServiceId: "integration-tests",
			PolicyKey:           "chat_mention",
			DeliveryClass:       "persistent",
			SourceCategory:      "mention",
			NavigationTarget: &rpcv1.NavigationTarget{
				Domain:       "chat",
				ResourceType: "channel",
				ResourceId:   "test-mention-channel",
			},
		})
		req.Header().Set("Authorization", "Bearer "+sysToken)
		resp, err := w.notif.PublishNotification(context.Background(), req)
		require.NoError(t, err)
		mentionNotifID := resp.Msg.NotificationId
		time.Sleep(200 * time.Millisecond)

		t.Run("notification has source_category=mention", func(t *testing.T) {
			all := w.listNotifications(emp, false)
			n := findNotification(all, mentionNotifID)
			require.NotNil(t, n, "mention notification must appear in inbox")
			assert.Equal(t, "mention", n.SourceCategory)
		})

		t.Run("notification has policy_key=chat_mention", func(t *testing.T) {
			all := w.listNotifications(emp, false)
			n := findNotification(all, mentionNotifID)
			require.NotNil(t, n)
			assert.Equal(t, "chat_mention", n.PolicyKey)
		})
	})

	t.Run("when alice acknowledges her notification it does not affect bob", func(t *testing.T) {
		w := newTestWorld(t)
		emps := w.withEmployees(2)
		alice, bob := emps[0], emps[1]

		notifIDAlice := w.publishPersistentNotification(alice.ID, "parity-isolation-alice")
		notifIDBob := w.publishPersistentNotification(bob.ID, "parity-isolation-bob")
		time.Sleep(200 * time.Millisecond)

		allAlice := w.listNotifications(alice, false)
		nAlice := findNotification(allAlice, notifIDAlice)
		require.NotNil(t, nAlice)

		w.acknowledgeNotifications(alice, "explicit_ack", nAlice.NotificationRecipientId)

		t.Run("alice notification becomes acknowledged", func(t *testing.T) {
			all := w.listNotifications(alice, false)
			n := findNotification(all, notifIDAlice)
			require.NotNil(t, n)
			assert.Equal(t, "acknowledged", n.AcknowledgementStatus)
		})

		t.Run("bob notification remains pending (no cross-user side effect)", func(t *testing.T) {
			all := w.listNotifications(bob, false)
			n := findNotification(all, notifIDBob)
			require.NotNil(t, n)
			assert.Equal(t, "pending", n.AcknowledgementStatus)
		})
	})
}
