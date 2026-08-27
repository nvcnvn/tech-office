package integration

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// TestBlocking covers blocking direct contact: what a block refuses, what it
// deliberately leaves alone, and the silence it must keep.
//
// The scope is the point: a block stops direct conversations and calls, and does
// nothing to shared workplace channels. Hiding a colleague's messages in a shared
// channel would let someone silently conceal instructions addressed to them, which
// is why FR-021a says the opposite of what a reviewer might expect.
func TestBlocking(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	users := w.withEmployees(2)
	blocker, blocked := users[0], users[1]

	t.Run("when a person blocks someone", func(t *testing.T) {
		resp := w.blockPerson(blocker, blocked.ID)

		t.Run("the block is recorded", func(t *testing.T) { // FR-019
			require.NotEmpty(t, resp.BlockId)
			list := w.listBlockedPeople(blocker)
			found := false
			for _, b := range list {
				if b.EmployeeId == blocked.ID.String() {
					found = true
				}
			}
			assert.True(t, found, "blocked person should appear in the blocker's list")
		})

		t.Run("the blocked person is not notified", func(t *testing.T) { // FR-022
			// Any notification at all would give the block away, so the assertion is
			// over the person's whole inbox, not one type.
			var total int
			err := globalDB.QueryRow(context.Background(),
				`SELECT COUNT(*)
				 FROM notification.notification_recipient r
				 WHERE r.employee_id = $1 AND r.organization_id = $2`,
				blocked.ID, blocked.OrgID,
			).Scan(&total)
			require.NoError(t, err)
			assert.Zero(t, total, "blocking must not produce any notification for the blocked person")
		})

		t.Run("no RPC reveals to the blocked person that they are blocked", func(t *testing.T) { // FR-022
			// The only listing that exists returns the caller's own blocks. From the
			// blocked person's side there is nothing to see.
			assert.Empty(t, w.listBlockedPeople(blocked),
				"the blocked person's own block list must stay empty")
		})
	})

	t.Run("when a blocked person starts a direct conversation", func(t *testing.T) {
		t.Run("it is refused", func(t *testing.T) { // FR-020
			_, err := w.createOrGetDMResult(blocked, blocker.ID)
			require.Error(t, err)
			assert.Equal(t, connect.CodeFailedPrecondition, connect.CodeOf(err))
			assert.NotContains(t, err.Error(), "block",
				"the refusal must not tell the blocked person a block exists")
		})
	})

	t.Run("when the blocker starts a direct conversation", func(t *testing.T) {
		t.Run("it is refused in that direction too", func(t *testing.T) { // FR-020
			// The guard is symmetric so that comparing outcomes cannot reveal which
			// direction the block runs in.
			_, err := w.createOrGetDMResult(blocker, blocked.ID)
			require.Error(t, err)
			assert.Equal(t, connect.CodeFailedPrecondition, connect.CodeOf(err))
		})
	})

	t.Run("when a blocked person posts in a shared channel", func(t *testing.T) {
		channelID := w.createChannel(blocker, "Shared work", false)
		w.inviteToChannel(blocker, channelID, blocked.ID)
		msgID := w.sendMessage(blocked, channelID, "The delivery is at four.")

		t.Run("their message is still visible to the blocker", func(t *testing.T) { // FR-021a
			msgs := w.listMessages(blocker, channelID)
			assert.NotNil(t, findMessage(msgs, msgID),
				"shared-channel messages stay visible: blocking is scoped to direct contact")
		})

		t.Run("both people remain members of every shared channel", func(t *testing.T) { // FR-023
			var count int
			err := globalDB.QueryRow(context.Background(),
				`SELECT COUNT(*) FROM chat.channel_membership
				 WHERE organization_id = $1 AND channel_id = $2 AND employee_id IN ($3, $4)`,
				blocker.OrgID, dbUUIDFromString(t, channelID), blocker.ID, blocked.ID,
			).Scan(&count)
			require.NoError(t, err)
			assert.Equal(t, 2, count, "a block must never change channel membership")
		})
	})

	t.Run("when a person tries to block themselves", func(t *testing.T) {
		t.Run("it is rejected", func(t *testing.T) { // FR-019
			_, err := w.blockPersonResult(blocker, blocker.ID)
			require.Error(t, err)
			assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
		})
	})

	t.Run("when a person blocks someone already blocked", func(t *testing.T) {
		t.Run("it does not create a duplicate", func(t *testing.T) { // FR-019
			before := len(w.listBlockedPeople(blocker))
			w.blockPerson(blocker, blocked.ID)
			assert.Len(t, w.listBlockedPeople(blocker), before,
				"re-blocking is idempotent")
		})
	})

	t.Run("when a person lists who they have blocked", func(t *testing.T) {
		t.Run("every current block appears", func(t *testing.T) { // FR-024
			list := w.listBlockedPeople(blocker)
			require.Len(t, list, 1)
			assert.Equal(t, blocked.ID.String(), list[0].EmployeeId)
			assert.NotEmpty(t, list[0].DisplayName)
		})
	})

	t.Run("when a person unblocks someone", func(t *testing.T) {
		w.unblockPerson(blocker, blocked.ID)

		t.Run("direct conversations work again", func(t *testing.T) { // FR-019
			channelID, err := w.createOrGetDMResult(blocker, blocked.ID)
			require.NoError(t, err)
			assert.NotEmpty(t, channelID)
		})

		t.Run("the blocked list is empty", func(t *testing.T) { // FR-024
			assert.Empty(t, w.listBlockedPeople(blocker))
		})

		t.Run("unblocking again succeeds", func(t *testing.T) { // FR-019
			// Idempotent: a client retrying an unblock must not see an error.
			w.unblockPerson(blocker, blocked.ID)
		})
	})

	t.Run("when a blocked person and blocker are added to a new group conversation", func(t *testing.T) {
		// Edge case: a block must not make a shared channel unusable for either of
		// them, or for anyone else in it.
		third := w.withEmployee()
		w.blockPerson(blocker, blocked.ID)
		channelID := w.createChannel(third, "Project standup", false)
		w.inviteToChannel(third, channelID, blocker.ID)
		w.inviteToChannel(third, channelID, blocked.ID)

		t.Run("neither is removed and the conversation works", func(t *testing.T) {
			blockerMsg := w.sendMessage(blocker, channelID, "Morning.")
			blockedMsg := w.sendMessage(blocked, channelID, "Morning.")
			msgs := w.listMessages(third, channelID)
			assert.NotNil(t, findMessage(msgs, blockerMsg))
			assert.NotNil(t, findMessage(msgs, blockedMsg))
		})
		w.unblockPerson(blocker, blocked.ID)
	})
}

func findMessage(msgs []*rpcv1.Message, id string) *rpcv1.Message {
	for _, m := range msgs {
		if m.Id == id {
			return m
		}
	}
	return nil
}
