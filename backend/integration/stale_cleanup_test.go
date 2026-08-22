package integration

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

// TestStaleConnectionCleanup covers the presence janitor: connections silent past the
// removal window are deleted, and connections still inside it are preserved so a
// recovering client finds its row intact.
func TestStaleConnectionCleanup(t *testing.T) {
	w := newTestWorld(t)
	owner := w.withOwner()

	t.Run("when a connection has been silent beyond the removal window", func(t *testing.T) {
		expiredConn := w.insertStaleConnection(owner.ID, 2*time.Minute, "expired-instance")
		// Unresponsive but still inside the removal window: it must survive, because a
		// pong before removal restores it without a reconnect.
		unresponsiveConn := w.insertStaleConnection(owner.ID, 60*time.Second, "unresponsive-instance")
		freshConn := w.insertStaleConnection(owner.ID, 10*time.Second, "fresh-instance")

		w.deleteExpiredConnections()

		t.Run("the expired connection is removed", func(t *testing.T) {
			assert.False(t, w.connectionExists(expiredConn))
		})

		t.Run("an unresponsive connection inside the removal window is preserved", func(t *testing.T) {
			assert.True(t, w.connectionExists(unresponsiveConn))
		})

		t.Run("the fresh connection is preserved", func(t *testing.T) {
			assert.True(t, w.connectionExists(freshConn))
		})
	})

	t.Run("when nothing has expired", func(t *testing.T) {
		t.Run("the sweep is idempotent", func(t *testing.T) {
			assert.Equal(t, int64(0), w.deleteExpiredConnections())
		})
	})
}
