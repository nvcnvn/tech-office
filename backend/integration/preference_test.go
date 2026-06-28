package integration

import (
	"testing"

	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
)

// TestPreference covers get defaults, update/toggle, reset, and cross-org isolation.
func TestPreference(t *testing.T) {
	w := newTestWorld(t)
	emp := w.withEmployee()

	// Start clean
	w.resetPreference(emp)

	t.Run("when a new user has no preference set", func(t *testing.T) {
		resp := w.getPreference(emp)

		t.Run("defaults are returned with exists=false", func(t *testing.T) {
			assert.False(t, resp.Exists)
			assert.Equal(t, rpcv1.ThemeMode_THEME_MODE_LIGHT, resp.Preference.ThemeMode)
			assert.Equal(t, rpcv1.PreferenceSource_PREFERENCE_SOURCE_OS_DEFAULT, resp.Preference.PreferenceSource)
		})
	})

	t.Run("when a user updates their preference to dark mode", func(t *testing.T) {
		pref := w.updatePreference(emp, rpcv1.ThemeMode_THEME_MODE_DARK, rpcv1.PreferenceSource_PREFERENCE_SOURCE_MANUAL)

		t.Run("the returned preference reflects the change", func(t *testing.T) {
			assert.Equal(t, rpcv1.ThemeMode_THEME_MODE_DARK, pref.ThemeMode)
			assert.Equal(t, rpcv1.PreferenceSource_PREFERENCE_SOURCE_MANUAL, pref.PreferenceSource)
		})

		t.Run("get returns the updated value with exists=true", func(t *testing.T) {
			resp := w.getPreference(emp)
			assert.True(t, resp.Exists)
			assert.Equal(t, rpcv1.ThemeMode_THEME_MODE_DARK, resp.Preference.ThemeMode)
		})
	})

	t.Run("when the user toggles back to light mode", func(t *testing.T) {
		pref := w.updatePreference(emp, rpcv1.ThemeMode_THEME_MODE_LIGHT, rpcv1.PreferenceSource_PREFERENCE_SOURCE_MANUAL)

		t.Run("the preference is updated", func(t *testing.T) {
			assert.Equal(t, rpcv1.ThemeMode_THEME_MODE_LIGHT, pref.ThemeMode)
		})
	})

	t.Run("when the user resets their preference", func(t *testing.T) {
		// First set a preference
		w.updatePreference(emp, rpcv1.ThemeMode_THEME_MODE_DARK, rpcv1.PreferenceSource_PREFERENCE_SOURCE_MANUAL)
		w.resetPreference(emp)

		t.Run("get returns defaults with exists=false", func(t *testing.T) {
			resp := w.getPreference(emp)
			assert.False(t, resp.Exists)
			assert.Equal(t, rpcv1.ThemeMode_THEME_MODE_LIGHT, resp.Preference.ThemeMode)
		})
	})

	t.Run("when reset is called on a user with no preference (idempotent)", func(t *testing.T) {
		w.resetPreference(emp) // already reset above
		w.resetPreference(emp) // should not error

		t.Run("no error is returned", func(t *testing.T) {
			// resetPreference asserts NoError internally
		})
	})

	t.Run("when two users from different orgs set preferences", func(t *testing.T) {
		u1, u2 := w.withUsersFromDifferentOrgs()
		w.updatePreference(u1, rpcv1.ThemeMode_THEME_MODE_DARK, rpcv1.PreferenceSource_PREFERENCE_SOURCE_MANUAL)
		w.updatePreference(u2, rpcv1.ThemeMode_THEME_MODE_LIGHT, rpcv1.PreferenceSource_PREFERENCE_SOURCE_OS_DEFAULT)

		t.Run("each user sees only their own preference", func(t *testing.T) {
			r1 := w.getPreference(u1)
			r2 := w.getPreference(u2)
			assert.Equal(t, rpcv1.ThemeMode_THEME_MODE_DARK, r1.Preference.ThemeMode)
			assert.Equal(t, rpcv1.ThemeMode_THEME_MODE_LIGHT, r2.Preference.ThemeMode)
		})
	})
}
