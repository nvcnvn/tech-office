package integration

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
)

// TestGetEmployeeCards covers the batch employee card lookup endpoint.
//
// Historical context: this endpoint previously used a correlated subquery that
// joined notification.active_connection (notification schema, distributed table)
// inside a query against organization.employee (organization schema). On Citus
// this produced:
//
//	ERROR: complex joins are only supported when all distributed tables are
//	       co-located and joined on their distribution columns (SQLSTATE 0A000)
//
// The fix splits the work into two separate queries:
//  1. GetEmployeeCardsByIDs — joins only within the organization schema.
//  2. GetLatestEmployeePresenceByIDs — queries notification.active_connection alone.
//
// These tests guard against regression of that bug and verify the endpoint core contracts.
func TestGetEmployeeCards(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()

	t.Run("empty request returns empty response without error", func(t *testing.T) {
		cards, err := w.getEmployeeCards(owner)
		require.NoError(t, err)
		assert.Empty(t, cards)
	})

	t.Run("returns cards for valid employee IDs", func(t *testing.T) {
		employees := w.withEmployees(3)

		ids := make([]dbuuid.UUID, len(employees))
		for i, e := range employees {
			ids[i] = e.ID
		}

		cards, err := w.getEmployeeCards(owner, ids...)
		require.NoError(t, err)
		assert.Len(t, cards, 3)

		returnedIDs := make(map[string]bool, len(cards))
		for _, c := range cards {
			returnedIDs[c.Id] = true
			assert.NotEmpty(t, c.GivenName, "given_name should be set")
			assert.NotEmpty(t, c.FamilyName, "family_name should be set")
		}
		for _, e := range employees {
			assert.True(t, returnedIDs[e.ID.String()], "employee missing from response: %s", e.ID)
		}
	})

	t.Run("presence_status defaults to offline when employee has no active connection", func(t *testing.T) {
		emp := w.withEmployee()

		cards, err := w.getEmployeeCards(owner, emp.ID)
		require.NoError(t, err)
		require.Len(t, cards, 1)
		assert.Equal(t, "offline", cards[0].PresenceStatus)
	})

	t.Run("presence_status reflects online when employee has active connection", func(t *testing.T) {
		emp := w.withEmployee()
		w.updatePresence(emp, rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE)

		cards, err := w.getEmployeeCards(owner, emp.ID)
		require.NoError(t, err)
		require.Len(t, cards, 1)
		assert.Equal(t, "online", cards[0].PresenceStatus)
	})

	t.Run("online_hidden presence is normalized to offline for observers", func(t *testing.T) {
		emp := w.withEmployee()
		w.updatePresence(emp, rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE_HIDDEN)

		cards, err := w.getEmployeeCards(owner, emp.ID)
		require.NoError(t, err)
		require.Len(t, cards, 1)
		assert.Equal(t, "offline", cards[0].PresenceStatus,
			"online_hidden must be normalized to offline in GetEmployeeCards")
	})

	t.Run("employees from a different org are silently excluded", func(t *testing.T) {
		emp := w.withEmployee()

		w2 := newTestWorld(t)
		outsider := w2.withEmployee()

		cards, err := w.getEmployeeCards(owner, emp.ID, outsider.ID)
		require.NoError(t, err)

		assert.Len(t, cards, 1)
		assert.Equal(t, emp.ID.String(), cards[0].Id)
	})

	t.Run("returns error when more than 100 employee IDs are requested", func(t *testing.T) {
		ids := make([]dbuuid.UUID, 101)
		for i := range ids {
			ids[i] = dbuuid.Must()
		}

		_, err := w.getEmployeeCards(owner, ids...)
		require.Error(t, err)

		var connectErr *connect.Error
		require.ErrorAs(t, err, &connectErr)
		assert.Equal(t, connect.CodeInvalidArgument, connectErr.Code())
		assert.True(t, strings.Contains(connectErr.Message(), "100"),
			"error message should mention the 100-ID limit")
	})

	t.Run("returns unauthenticated error when called without a token", func(t *testing.T) {
		emp := w.withEmployee()
		req := connect.NewRequest(&rpcv1.GetEmployeeCardsRequest{
			EmployeeIds: []string{emp.ID.String()},
		})
		_, err := w.iamClient.GetEmployeeCards(context.Background(), req)
		require.Error(t, err)
		var connectErr *connect.Error
		require.ErrorAs(t, err, &connectErr)
		assert.Equal(t, connect.CodeUnauthenticated, connectErr.Code())
	})
}
