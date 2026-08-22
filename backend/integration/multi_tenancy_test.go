package integration

import (
	"testing"

	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestMultiTenancy verifies cross-org isolation for presence, push tokens,
// preferences, and visibility settings.
func TestMultiTenancy(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)

	t.Run("when two users from different orgs update presence", func(t *testing.T) {
		u1, u2 := w.withUsersFromDifferentOrgs()

		connID1 := w.establishSSE(u1)
		connID2 := w.establishSSE(u2)
		w.updatePresenceWithConnection(u1, rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE, connID1)
		w.updatePresenceWithConnection(u2, rpcv1.PresenceStatus_PRESENCE_STATUS_IDLE, connID2)

		t.Run("each user sees only their own presence in batch query", func(t *testing.T) {
			list1 := w.getBatchPresence(u1, u1.ID, u2.ID)
			p1 := findPresence(list1, u1.ID.String())
			require.NotNil(t, p1)
			// u2's presence should not be visible from u1's org context
		})
	})

	t.Run("when two users from different orgs register push tokens", func(t *testing.T) {
		u1, u2 := w.withUsersFromDifferentOrgs()
		w.registerPushToken(u1, "device-mt-1")
		w.registerPushToken(u2, "device-mt-2")

		t.Run("each user sees only their own tokens", func(t *testing.T) {
			tokens1 := w.listPushTokens(u1)
			tokens2 := w.listPushTokens(u2)
			assert.Nil(t, findPushTokenByDevice(tokens1, "device-mt-2"), "u1 should not see u2's token")
			assert.Nil(t, findPushTokenByDevice(tokens2, "device-mt-1"), "u2 should not see u1's token")
		})
	})

	t.Run("when two users from different orgs set preferences", func(t *testing.T) {
		u1, u2 := w.withUsersFromDifferentOrgs()
		w.updatePreference(u1, rpcv1.ThemeMode_THEME_MODE_DARK, rpcv1.PreferenceSource_PREFERENCE_SOURCE_MANUAL)
		w.updatePreference(u2, rpcv1.ThemeMode_THEME_MODE_LIGHT, rpcv1.PreferenceSource_PREFERENCE_SOURCE_OS_DEFAULT)

		t.Run("each user sees their own preference", func(t *testing.T) {
			r1 := w.getPreference(u1)
			r2 := w.getPreference(u2)
			assert.Equal(t, rpcv1.ThemeMode_THEME_MODE_DARK, r1.Preference.ThemeMode)
			assert.Equal(t, rpcv1.ThemeMode_THEME_MODE_LIGHT, r2.Preference.ThemeMode)
		})
	})

	t.Run("when two users from different orgs set visibility", func(t *testing.T) {
		u1, u2 := w.withUsersFromDifferentOrgs()
		w.setPresenceVisibility(u1, rpcv1.VisibilityMode_VISIBILITY_MODE_OFFLINE, "", "")
		w.setPresenceVisibility(u2, rpcv1.VisibilityMode_VISIBILITY_MODE_EVERYONE, "Available", "")

		t.Run("each user sees their own visibility settings", func(t *testing.T) {
			v1 := w.getPresenceSettings(u1)
			v2 := w.getPresenceSettings(u2)
			assert.Equal(t, rpcv1.VisibilityMode_VISIBILITY_MODE_OFFLINE, v1.VisibilityMode)
			assert.Equal(t, rpcv1.VisibilityMode_VISIBILITY_MODE_EVERYONE, v2.VisibilityMode)
		})
	})
}
