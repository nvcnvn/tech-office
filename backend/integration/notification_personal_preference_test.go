package integration

import (
	"testing"

	"connectrpc.com/connect"
	"github.com/nvcnvn/tech-office/backend/internal/notification"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestNotificationPersonalPreference is the behavioural contract for the personal
// notification preference record.
//
// Source: specs/051-notification-preference-completeness/contracts/test-scenarios.md
//
// Every scenario here is first coverage rather than regression coverage. The table
// notification.personal_preference has enforced domain muting and do-not-disturb since
// the initial schema, but it had exactly one query against it — a SELECT — and no RPC,
// so no row could ever be created through a supported path. The suppression machinery
// these scenarios exercise has therefore never run against a record a person made.
//
// The existing notification_preference_test.go covers per-channel and per-resource
// preferences and is untouched; this covers the personal record.
func TestNotificationPersonalPreference(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	w.withOwner()

	// ── The stored record and its contract ──────────────────────────────────

	// FR-006, FR-011: defaults are documented, not accidental
	t.Run("a person who has never set preferences reads the documented defaults", func(t *testing.T) {
		fresh := w.withEmployee()

		read := w.getNotificationPreferences(fresh)

		assert.False(t, read.Exists, "no record has been stored, and the client is told so")
		assert.True(t, read.Preferences.InAppAlertsEnabled, "alerts are on until someone turns them off")
		assert.Empty(t, read.Preferences.MutedDomains, "nothing is muted by default")
		assert.False(t, read.Preferences.DndEnabled)
		assert.Empty(t, read.Preferences.DndStart)
		assert.Empty(t, read.Preferences.DndEnd)
		assert.Nil(t, read.Preferences.UpdatedAt, "there is no last-written time for a record that does not exist")
	})

	// FR-004, FR-010, FR-013: the first change creates the record
	t.Run("the first change creates the record and reads back exactly", func(t *testing.T) {
		person := w.withEmployee()
		require.False(t, w.getNotificationPreferences(person).Exists)

		written := w.updateNotificationPreferences(person, &rpcv1.UpdateNotificationPreferencesRequest{
			InAppAlertsEnabled: false,
			MutedDomains:       []string{"calendar", "docs"},
			DndEnabled:         true,
			DndStart:           "22:00",
			DndEnd:             "06:30",
		})

		assert.False(t, written.InAppAlertsEnabled)
		assert.Equal(t, []string{"calendar", "docs"}, written.MutedDomains)
		assert.True(t, written.DndEnabled)
		assert.Equal(t, "22:00", written.DndStart)
		assert.Equal(t, "06:30", written.DndEnd)
		assert.NotNil(t, written.UpdatedAt, "a stored record knows when it was written")

		// The same values are what the next read — on any device — returns.
		read := w.getNotificationPreferences(person)
		assert.True(t, read.Exists)
		assert.False(t, read.Preferences.InAppAlertsEnabled)
		assert.Equal(t, []string{"calendar", "docs"}, read.Preferences.MutedDomains)
		assert.Equal(t, "22:00", read.Preferences.DndStart)
		assert.Equal(t, "06:30", read.Preferences.DndEnd)
	})

	// FR-005: the person is taken from the session, never from the request
	t.Run("a person reads and writes only their own preferences", func(t *testing.T) {
		alice := w.withEmployee()
		bob := w.withEmployee()

		w.muteDomains(alice, "chat")

		bobsRead := w.getNotificationPreferences(bob)
		assert.False(t, bobsRead.Exists, "alice's write must not create a record for bob")
		assert.Empty(t, bobsRead.Preferences.MutedDomains)
		assert.True(t, bobsRead.Preferences.InAppAlertsEnabled)
	})

	// FR-009: whole-record replacement, so two settings cannot drift apart
	t.Run("a change replaces the whole record", func(t *testing.T) {
		person := w.withEmployee()
		w.updateNotificationPreferences(person, &rpcv1.UpdateNotificationPreferencesRequest{
			InAppAlertsEnabled: true,
			DndEnabled:         true,
			DndStart:           "21:00",
			DndEnd:             "07:00",
		})

		// A client changing the mute list sends back the record it read, so the
		// do-not-disturb window it never touched survives.
		current := w.getNotificationPreferences(person).Preferences
		afterMute := w.updateNotificationPreferences(person, &rpcv1.UpdateNotificationPreferencesRequest{
			InAppAlertsEnabled: current.InAppAlertsEnabled,
			MutedDomains:       []string{"support"},
			DndEnabled:         current.DndEnabled,
			DndStart:           current.DndStart,
			DndEnd:             current.DndEnd,
		})
		assert.Equal(t, []string{"support"}, afterMute.MutedDomains)
		assert.True(t, afterMute.DndEnabled, "an untouched setting must survive a change to another")
		assert.Equal(t, "21:00", afterMute.DndStart)

		// And a record that says do-not-disturb is off clears the window rather than
		// merging with what was there.
		cleared := w.updateNotificationPreferences(person, &rpcv1.UpdateNotificationPreferencesRequest{
			InAppAlertsEnabled: true,
			MutedDomains:       []string{"support"},
			DndEnabled:         false,
		})
		assert.False(t, cleared.DndEnabled)
		assert.Empty(t, cleared.DndStart, "a whole-record write clears what it does not carry")
		assert.Empty(t, cleared.DndEnd)
	})

	// ── Validation ──────────────────────────────────────────────────────────

	// FR-007: a refusal names the value, and stores nothing
	t.Run("a domain the system does not recognise is refused by name and stores nothing", func(t *testing.T) {
		person := w.withEmployee()
		before := w.muteDomains(person, "chat", "finance")

		_, err := w.updateNotificationPreferencesErr(person, &rpcv1.UpdateNotificationPreferencesRequest{
			InAppAlertsEnabled: true,
			MutedDomains:       []string{"chat", "marketing"},
		})

		require.Error(t, err)
		assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
		assert.Contains(t, err.Error(), "marketing", "the person is told which value was refused")

		after := w.getNotificationPreferences(person).Preferences
		assert.Equal(t, before.MutedDomains, after.MutedDomains,
			"a refused write must leave the stored record byte-identical")
	})

	// FR-008: the same set always stores the same way
	t.Run("a domain named twice is stored once", func(t *testing.T) {
		person := w.withEmployee()

		stored := w.muteDomains(person, "chat", "chat", "calendar")

		assert.Equal(t, []string{"calendar", "chat"}, stored.MutedDomains,
			"deduplicated and sorted, so two clients sending the same set agree")
	})

	// data-model rule 3
	t.Run("a malformed do-not-disturb time is refused", func(t *testing.T) {
		person := w.withEmployee()

		_, err := w.updateNotificationPreferencesErr(person, &rpcv1.UpdateNotificationPreferencesRequest{
			InAppAlertsEnabled: true,
			DndEnabled:         true,
			DndStart:           "25:00",
			DndEnd:             "06:00",
		})

		require.Error(t, err)
		assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
		assert.False(t, w.getNotificationPreferences(person).Exists, "nothing was written")
	})

	// ── Calendar, and the completeness property ─────────────────────────────

	// FR-001: drift D28, stated on its own so a regression is legible
	t.Run("calendar can be muted", func(t *testing.T) {
		person := w.withEmployee()

		stored := w.muteDomains(person, "calendar")

		assert.Equal(t, []string{"calendar"}, stored.MutedDomains)
	})

	// FR-002, SC-002: the guard that stops the four lists drifting again
	t.Run("every source domain the system publishes from can be muted", func(t *testing.T) {
		person := w.withEmployee()

		for _, domain := range notification.AllSourceDomains() {
			stored, err := w.updateNotificationPreferencesErr(person, &rpcv1.UpdateNotificationPreferencesRequest{
				InAppAlertsEnabled: true,
				MutedDomains:       []string{domain},
			})
			require.NoErrorf(t, err,
				"%q is a domain the system publishes from but nobody can mute — the "+
					"muted_domains CHECK has fallen behind notification.AllSourceDomains", domain)
			assert.Equal(t, []string{domain}, stored.MutedDomains)
		}
	})

	// ── Delivery behaviour ──────────────────────────────────────────────────

	// FR-015: muting a domain suppresses its push
	t.Run("muting calendar suppresses push for a calendar notification", func(t *testing.T) {
		person := w.withEmployee()
		w.registerPushToken(person, "device-mute-calendar")
		w.muteDomains(person, "calendar")

		notifID := w.publishDomainNotification(person.ID, "calendar", "calendar_event_invite",
			"calendar_event_invite", 1, "Standup moved")

		reasons := w.deliveryAttemptReasons(w.recipientRowID(notifID, person.ID))
		assert.Contains(t, reasons, notification.FallbackReasonSuppressedByPreference)
	})

	// FR-016, SC-006: muting takes away the buzz, not the notification
	t.Run("a muted domain's notification is still listed and still counts as unread", func(t *testing.T) {
		person := w.withEmployee()
		w.registerPushToken(person, "device-still-listed")
		w.muteDomains(person, "calendar")
		before := w.getUnreadCount(person)

		w.publishDomainNotification(person.ID, "calendar", "calendar_event_invite",
			"calendar_event_invite", 1, "Muted but still recorded")

		listed := w.listNotifications(person, false)
		titles := make([]string, 0, len(listed))
		for _, n := range listed {
			titles = append(titles, n.Title)
		}
		assert.Contains(t, titles, "Muted but still recorded",
			"a muted domain still lands in the alerts list")
		assert.Greater(t, w.getUnreadCount(person), before,
			"and still counts as unread")
	})

	// FR-018: muting is per domain, not a global switch
	t.Run("muting one domain leaves another domain's push alone", func(t *testing.T) {
		person := w.withEmployee()
		w.registerPushToken(person, "device-one-domain")
		w.muteDomains(person, "calendar")

		notifID := w.publishDomainNotification(person.ID, "chat", "message",
			"chat_message", 1, "Chat still buzzes")

		reasons := w.deliveryAttemptReasons(w.recipientRowID(notifID, person.ID))
		assert.NotContains(t, reasons, notification.FallbackReasonSuppressedByPreference,
			"muting calendar must not silence chat")
	})

	// FR-017, SC-005: priority 0 is never suppressed
	t.Run("with every domain muted a mention still pushes", func(t *testing.T) {
		person := w.withEmployee()
		w.registerPushToken(person, "device-everything-muted")
		w.muteDomains(person, notification.AllSourceDomains()...)

		notifID := w.publishDomainNotification(person.ID, "chat", "mention",
			"chat_mention", 0, "You were mentioned")

		reasons := w.deliveryAttemptReasons(w.recipientRowID(notifID, person.ID))
		assert.NotContains(t, reasons, notification.FallbackReasonSuppressedByPreference,
			"mentions and incoming calls always come through")
	})

	// US2 scenario 6
	t.Run("unmuting restores push with no further action", func(t *testing.T) {
		person := w.withEmployee()
		w.registerPushToken(person, "device-unmute")

		w.muteDomains(person, "calendar")
		mutedNotif := w.publishDomainNotification(person.ID, "calendar", "calendar_event_invite",
			"calendar_event_invite", 1, "While muted")
		require.Contains(t, w.deliveryAttemptReasons(w.recipientRowID(mutedNotif, person.ID)),
			notification.FallbackReasonSuppressedByPreference)

		w.muteDomains(person)
		afterNotif := w.publishDomainNotification(person.ID, "calendar", "calendar_event_invite",
			"calendar_event_invite", 1, "After unmuting")

		assert.NotContains(t, w.deliveryAttemptReasons(w.recipientRowID(afterNotif, person.ID)),
			notification.FallbackReasonSuppressedByPreference,
			"unmuting takes effect on the next notification, with nothing else to do")
	})

	// ── In-app alerts do not touch delivery ─────────────────────────────────

	// FR-012: the switch removes one client-drawn banner and nothing else
	t.Run("turning in-app alerts off changes nothing the server does", func(t *testing.T) {
		person := w.withEmployee()
		w.registerPushToken(person, "device-alerts-off")
		w.updateNotificationPreferences(person, &rpcv1.UpdateNotificationPreferencesRequest{
			InAppAlertsEnabled: false,
		})
		before := w.getUnreadCount(person)

		notifID := w.publishDomainNotification(person.ID, "chat", "message",
			"chat_message", 1, "Alerts off but still delivered")

		listed := w.listNotifications(person, false)
		titles := make([]string, 0, len(listed))
		for _, n := range listed {
			titles = append(titles, n.Title)
		}
		assert.Contains(t, titles, "Alerts off but still delivered", "still recorded and still listed")
		assert.Greater(t, w.getUnreadCount(person), before, "still counted as unread")
		assert.NotContains(t, w.deliveryAttemptReasons(w.recipientRowID(notifID, person.ID)),
			notification.FallbackReasonSuppressedByPreference,
			"and still pushed — in_app_alerts_enabled is never read by the delivery pipeline")
	})
}
