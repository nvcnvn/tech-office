package integration

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

// TestStaleConnectionCleanup covers removal of stale active connections
// based on heartbeat age while preserving recent ones.
func TestStaleConnectionCleanup(t *testing.T) {
	w := newTestWorld(t)
	owner := w.withOwner()

	t.Run("when a connection has a stale heartbeat beyond 60s", func(t *testing.T) {
		staleConn := w.insertStaleConnection(owner.ID, 2*time.Minute, "stale-instance")
		freshConn := w.insertStaleConnection(owner.ID, 10*time.Second, "fresh-instance")

		w.cleanupStaleConnections(60 * time.Second)

		t.Run("the stale connection is removed", func(t *testing.T) {
			assert.False(t, w.connectionExists(staleConn))
		})

		t.Run("the fresh connection is preserved", func(t *testing.T) {
			assert.True(t, w.connectionExists(freshConn))
		})
	})

	t.Run("when the table is empty", func(t *testing.T) {
		t.Run("cleanup is idempotent", func(t *testing.T) {
			w.cleanupStaleConnections(60 * time.Second) // should not error
		})
	})
}
