package integration

import (
	"testing"

	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestPresenceStatus covers status transitions, active channel tracking, and batch queries.
func TestPresenceStatus(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()

	t.Run("when updating presence to each status", func(t *testing.T) {
		statuses := []rpcv1.PresenceStatus{
			rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE,
			rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE_HIDDEN,
			rpcv1.PresenceStatus_PRESENCE_STATUS_IDLE,
			rpcv1.PresenceStatus_PRESENCE_STATUS_OFFLINE,
		}

		for _, s := range statuses {
			w.updatePresence(owner, s)
			p := w.getPresence(owner, owner.ID)

			t.Run("status "+s.String()+" is persisted", func(t *testing.T) {
				require.NotNil(t, p)
				assert.Equal(t, s, p.Status)
			})
		}
	})

	t.Run("when tracking the active channel", func(t *testing.T) {
		chID := w.createChannel(owner, "Active Channel", false)
		w.updatePresenceWithChannel(owner, rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE, chID)

		p := w.getPresence(owner, owner.ID)

		t.Run("the active channel is recorded", func(t *testing.T) {
			assert.Equal(t, chID, p.ActiveChannelId)
		})
	})

	t.Run("when querying batch presence", func(t *testing.T) {
		employees := w.withEmployees(3)
		for _, e := range employees {
			w.updatePresence(e, rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE)
		}

		ids := make([]dbuuid.UUID, len(employees))
		for i, e := range employees {
			ids[i] = e.ID
		}
		result := w.getBatchPresence(owner, ids...)

		t.Run("all queried employees are returned", func(t *testing.T) {
			assert.Len(t, result, len(employees))
		})
	})

	t.Run("when setting visibility to OFFLINE mode", func(t *testing.T) {
		employees := w.withEmployees(2)
		actor := employees[0]
		observer := employees[1]

		w.updatePresence(actor, rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE)
		w.setPresenceVisibility(actor, rpcv1.VisibilityMode_VISIBILITY_MODE_OFFLINE, "", "")

		p := w.getPresence(observer, actor.ID)

		t.Run("others see the user as OFFLINE", func(t *testing.T) {
			assert.Equal(t, rpcv1.PresenceStatus_PRESENCE_STATUS_OFFLINE, p.Status)
		})
	})

	t.Run("when retrieving visibility settings", func(t *testing.T) {
		w.setPresenceVisibility(owner, rpcv1.VisibilityMode_VISIBILITY_MODE_EVERYONE, "", "")
		settings := w.getPresenceSettings(owner)

		t.Run("the current mode is returned", func(t *testing.T) {
			require.NotNil(t, settings)
		})
	})
}
