package integration

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestPushToken covers registration, duplicate handling, listing, and revocation.
func TestPushToken(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()

	t.Run("when registering a new push token", func(t *testing.T) {
		tokenID := w.registerPushToken(owner, "device-A")

		t.Run("it returns a token ID", func(t *testing.T) {
			assert.NotEmpty(t, tokenID)
		})
	})

	t.Run("when registering with the same device identifier", func(t *testing.T) {
		id1 := w.registerPushTokenFull(owner, "fcm-token-1", "device-dup")
		id2 := w.registerPushTokenFull(owner, "fcm-token-2", "device-dup")

		t.Run("the existing token is updated (upsert)", func(t *testing.T) {
			assert.Equal(t, id1, id2, "same device should reuse the token ID")
		})
	})

	t.Run("when registering the same fcm token with a different device identifier", func(t *testing.T) {
		employee := w.withEmployee()
		w.registerPushTokenFull(employee, "fcm-token-reused-device", "device-old")
		w.registerPushTokenFull(employee, "fcm-token-reused-device", "device-new")

		tokens := w.listPushTokens(employee)

		t.Run("only the newest device registration remains", func(t *testing.T) {
			require.Len(t, tokens, 1)
			assert.Equal(t, "device-new", tokens[0].DeviceIdentifier)
		})
	})

	t.Run("when the same fcm token moves to another employee in the same organization", func(t *testing.T) {
		firstEmployee := w.withEmployee()
		secondEmployee := w.withEmployee()

		w.registerPushTokenFull(firstEmployee, "fcm-token-shared-employee", "device-first")
		w.registerPushTokenFull(secondEmployee, "fcm-token-shared-employee", "device-second")

		t.Run("the previous employee no longer retains that token", func(t *testing.T) {
			assert.Len(t, w.listPushTokens(firstEmployee), 0)
		})

		t.Run("the latest employee keeps the token", func(t *testing.T) {
			tokens := w.listPushTokens(secondEmployee)
			require.Len(t, tokens, 1)
			assert.Equal(t, "device-second", tokens[0].DeviceIdentifier)
		})
	})

	t.Run("when listing push tokens", func(t *testing.T) {
		employee := w.withEmployee()
		w.registerPushToken(employee, "list-device-1")
		w.registerPushToken(employee, "list-device-2")

		tokens := w.listPushTokens(employee)

		t.Run("all registered tokens are returned", func(t *testing.T) {
			require.GreaterOrEqual(t, len(tokens), 2)
		})
	})

	t.Run("when revoking a token by ID", func(t *testing.T) {
		employee := w.withEmployee()
		tokenID := w.registerPushToken(employee, "revoke-by-id")

		w.revokePushTokenByID(employee, tokenID)

		tokens := w.listPushTokens(employee)
		t.Run("the token is removed from the list", func(t *testing.T) {
			found := findPushTokenByID(tokens, tokenID)
			assert.Nil(t, found)
		})
	})

	t.Run("when revoking a token by device identifier", func(t *testing.T) {
		employee := w.withEmployee()
		w.registerPushToken(employee, "revoke-by-device")

		w.revokePushTokenByDevice(employee, "revoke-by-device")

		tokens := w.listPushTokens(employee)
		t.Run("the token is removed from the list", func(t *testing.T) {
			found := findPushTokenByDevice(tokens, "revoke-by-device")
			assert.Nil(t, found)
		})
	})
}
