package integration

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/timestamppb"

	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// ---------------------------------------------------------------------------
// US4: Team Calendar Visibility & Delegation
// ---------------------------------------------------------------------------

func TestTeamCalendarVisibility(t *testing.T) {
	w := newTestWorld(t)
	owner := w.withOwner()
	member := w.withEmployee()

	now := time.Now().UTC().Truncate(time.Second)
	eventStart := now.Add(2 * time.Hour)
	eventEnd := eventStart.Add(1 * time.Hour)

	t.Run("private events are redacted for non-participants", func(t *testing.T) {
		// Owner creates a private event.
		createReq := connect.NewRequest(&rpcv1.CreateEventRequest{
			Title:      "Secret Meeting",
			EventType:  "meeting",
			Visibility: "private",
			StartTime:  timestamppb.New(eventStart),
			EndTime:    timestamppb.New(eventEnd),
		})
		createReq.Header().Set("Authorization", "Bearer "+owner.Token)
		_, err := w.cal.CreateEvent(context.Background(), createReq)
		require.NoError(t, err)

		// Member queries owner's calendar — private event should appear as "Busy".
		listReq := connect.NewRequest(&rpcv1.ListEventsRequest{
			Start:            timestamppb.New(now),
			End:              timestamppb.New(now.Add(24 * time.Hour)),
			TargetEmployeeId: owner.ID.String(),
		})
		listReq.Header().Set("Authorization", "Bearer "+member.Token)
		listResp, err := w.cal.ListEvents(context.Background(), listReq)
		require.NoError(t, err)
		for _, e := range listResp.Msg.Events {
			if e.OrganizerEmployeeId == owner.ID.String() && e.Visibility == "private" {
				assert.Equal(t, "Busy", e.Title, "private event should be redacted to 'Busy'")
				assert.Empty(t, e.Description, "private event description should be empty")
			}
		}
	})

	t.Run("team events are visible to org members", func(t *testing.T) {
		createReq := connect.NewRequest(&rpcv1.CreateEventRequest{
			Title:      "Team Standup",
			EventType:  "meeting",
			Visibility: "team",
			StartTime:  timestamppb.New(eventStart.Add(24 * time.Hour)),
			EndTime:    timestamppb.New(eventEnd.Add(24 * time.Hour)),
		})
		createReq.Header().Set("Authorization", "Bearer "+owner.Token)
		_, err := w.cal.CreateEvent(context.Background(), createReq)
		require.NoError(t, err)

		listReq := connect.NewRequest(&rpcv1.ListEventsRequest{
			Start: timestamppb.New(now),
			End:   timestamppb.New(now.Add(48 * time.Hour)),
		})
		listReq.Header().Set("Authorization", "Bearer "+member.Token)
		listResp, err := w.cal.ListEvents(context.Background(), listReq)
		require.NoError(t, err)
		found := false
		for _, e := range listResp.Msg.Events {
			if e.Title == "Team Standup" {
				found = true
				break
			}
		}
		assert.True(t, found, "team event should be visible to org member")
	})
}

func TestDelegation(t *testing.T) {
	w := newTestWorld(t)
	owner := w.withOwner()
	delegate := w.withEmployee()

	now := time.Now().UTC().Truncate(time.Second)
	eventStart := now.Add(2 * time.Hour)
	eventEnd := eventStart.Add(1 * time.Hour)

	t.Run("grant and list delegation", func(t *testing.T) {
		grantReq := connect.NewRequest(&rpcv1.GrantDelegationRequest{
			DelegateId: delegate.ID.String(),
		})
		grantReq.Header().Set("Authorization", "Bearer "+owner.Token)
		_, err := w.cal.GrantDelegation(context.Background(), grantReq)
		require.NoError(t, err)

		listReq := connect.NewRequest(&rpcv1.ListDelegationsRequest{})
		listReq.Header().Set("Authorization", "Bearer "+delegate.Token)
		listResp, err := w.cal.ListDelegations(context.Background(), listReq)
		require.NoError(t, err)
		assert.NotEmpty(t, listResp.Msg.GrantedToMe, "delegate should see granted delegation")
	})

	t.Run("delegate can create events on behalf of owner", func(t *testing.T) {
		createReq := connect.NewRequest(&rpcv1.CreateEventRequest{
			Title:               "Delegated Meeting",
			EventType:           "meeting",
			Visibility:          "team",
			StartTime:           timestamppb.New(eventStart),
			EndTime:             timestamppb.New(eventEnd),
			OrganizerOverrideId: owner.ID.String(),
		})
		createReq.Header().Set("Authorization", "Bearer "+delegate.Token)
		resp, err := w.cal.CreateEvent(context.Background(), createReq)
		require.NoError(t, err)
		assert.Equal(t, owner.ID.String(), resp.Msg.Event.OrganizerEmployeeId, "organizer should be the owner")
	})

	t.Run("revoke delegation prevents further creates", func(t *testing.T) {
		revokeReq := connect.NewRequest(&rpcv1.RevokeDelegationRequest{
			DelegateId: delegate.ID.String(),
		})
		revokeReq.Header().Set("Authorization", "Bearer "+owner.Token)
		_, err := w.cal.RevokeDelegation(context.Background(), revokeReq)
		require.NoError(t, err)

		// Creating event on behalf of owner should now fail.
		createReq := connect.NewRequest(&rpcv1.CreateEventRequest{
			Title:               "Should Fail",
			EventType:           "meeting",
			Visibility:          "team",
			StartTime:           timestamppb.New(eventStart.Add(48 * time.Hour)),
			EndTime:             timestamppb.New(eventEnd.Add(48 * time.Hour)),
			OrganizerOverrideId: owner.ID.String(),
		})
		createReq.Header().Set("Authorization", "Bearer "+delegate.Token)
		_, err = w.cal.CreateEvent(context.Background(), createReq)
		require.Error(t, err, "revoked delegate should not be able to create events on behalf of owner")
	})
}
