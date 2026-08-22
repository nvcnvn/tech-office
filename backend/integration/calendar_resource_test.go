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
// Act helpers for Resource operations
// ---------------------------------------------------------------------------

func (w *testWorld) calCreateResource(actor testUser, name, resourceType string, capacity int32) *rpcv1.CalendarResource {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CreateResourceRequest{
		Name:         name,
		ResourceType: resourceType,
		Capacity:     capacity,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.cal.CreateResource(context.Background(), req)
	require.NoError(w.t, err, "calCreateResource: %s", name)
	require.NotNil(w.t, resp.Msg.Resource)
	return resp.Msg.Resource
}

// ---------------------------------------------------------------------------
// US3: Resource Booking with Conflict Prevention
// ---------------------------------------------------------------------------

func TestResourceBooking(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()

	now := time.Now().UTC().Truncate(time.Second)
	eventStart := now.Add(2 * time.Hour)
	eventEnd := eventStart.Add(1 * time.Hour)

	t.Run("create and list resources", func(t *testing.T) {
		room := w.calCreateResource(owner, "Conference Room A", "room", 10)
		assert.NotEmpty(t, room.Id)
		assert.Equal(t, "Conference Room A", room.Name)
		assert.Equal(t, "room", room.ResourceType)
		assert.Equal(t, int32(10), room.Capacity)

		listReq := connect.NewRequest(&rpcv1.ListResourcesRequest{
			ResourceType: "room",
		})
		listReq.Header().Set("Authorization", "Bearer "+owner.Token)
		listResp, err := w.cal.ListResources(context.Background(), listReq)
		require.NoError(t, err)
		assert.NotEmpty(t, listResp.Msg.Resources)
	})

	t.Run("booking a resource with an event succeeds", func(t *testing.T) {
		room := w.calCreateResource(owner, "Meeting Room B", "room", 8)

		createReq := connect.NewRequest(&rpcv1.CreateEventRequest{
			Title:       "Room Booking Test",
			EventType:   "meeting",
			Visibility:  "team",
			StartTime:   timestamppb.New(eventStart),
			EndTime:     timestamppb.New(eventEnd),
			ResourceIds: []string{room.Id},
		})
		createReq.Header().Set("Authorization", "Bearer "+owner.Token)
		createResp, err := w.cal.CreateEvent(context.Background(), createReq)
		require.NoError(t, err)
		require.NotNil(t, createResp.Msg.Event)
		assert.NotEmpty(t, createResp.Msg.Event.ResourceBookings, "event should have resource bookings")
	})

	t.Run("double-booking the same resource is prevented", func(t *testing.T) {
		room := w.calCreateResource(owner, "Conflict Room", "room", 6)

		// First booking succeeds.
		req1 := connect.NewRequest(&rpcv1.CreateEventRequest{
			Title:       "First Booking",
			EventType:   "meeting",
			Visibility:  "team",
			StartTime:   timestamppb.New(eventStart),
			EndTime:     timestamppb.New(eventEnd),
			ResourceIds: []string{room.Id},
		})
		req1.Header().Set("Authorization", "Bearer "+owner.Token)
		_, err := w.cal.CreateEvent(context.Background(), req1)
		require.NoError(t, err)

		// Second booking at the same time should fail.
		req2 := connect.NewRequest(&rpcv1.CreateEventRequest{
			Title:       "Conflict Booking",
			EventType:   "meeting",
			Visibility:  "team",
			StartTime:   timestamppb.New(eventStart),
			EndTime:     timestamppb.New(eventEnd),
			ResourceIds: []string{room.Id},
		})
		req2.Header().Set("Authorization", "Bearer "+owner.Token)
		_, err = w.cal.CreateEvent(context.Background(), req2)
		require.Error(t, err, "double-booking should be rejected")
		assert.Equal(t, connect.CodeAlreadyExists, connect.CodeOf(err), "conflict error should be AlreadyExists")
	})

	t.Run("cancelling an event releases the resource", func(t *testing.T) {
		room := w.calCreateResource(owner, "Release Room", "room", 4)
		start := eventStart.Add(24 * time.Hour)
		end := eventEnd.Add(24 * time.Hour)

		// Book the resource.
		createReq := connect.NewRequest(&rpcv1.CreateEventRequest{
			Title:       "To Cancel",
			EventType:   "meeting",
			Visibility:  "team",
			StartTime:   timestamppb.New(start),
			EndTime:     timestamppb.New(end),
			ResourceIds: []string{room.Id},
		})
		createReq.Header().Set("Authorization", "Bearer "+owner.Token)
		createResp, err := w.cal.CreateEvent(context.Background(), createReq)
		require.NoError(t, err)

		// Cancel the event.
		cancelReq := connect.NewRequest(&rpcv1.CancelEventRequest{
			EventId: createResp.Msg.Event.Id,
		})
		cancelReq.Header().Set("Authorization", "Bearer "+owner.Token)
		_, err = w.cal.CancelEvent(context.Background(), cancelReq)
		require.NoError(t, err)

		// Now booking the same slot should succeed.
		rebookReq := connect.NewRequest(&rpcv1.CreateEventRequest{
			Title:       "Rebook After Cancel",
			EventType:   "meeting",
			Visibility:  "team",
			StartTime:   timestamppb.New(start),
			EndTime:     timestamppb.New(end),
			ResourceIds: []string{room.Id},
		})
		rebookReq.Header().Set("Authorization", "Bearer "+owner.Token)
		_, err = w.cal.CreateEvent(context.Background(), rebookReq)
		require.NoError(t, err, "rebooking after cancel should succeed")
	})

	t.Run("update resource details", func(t *testing.T) {
		room := w.calCreateResource(owner, "Old Name", "room", 5)

		updateReq := connect.NewRequest(&rpcv1.UpdateResourceRequest{
			ResourceId: room.Id,
			Name:       "New Name",
			Capacity:   12,
		})
		updateReq.Header().Set("Authorization", "Bearer "+owner.Token)
		updateResp, err := w.cal.UpdateResource(context.Background(), updateReq)
		require.NoError(t, err)
		assert.Equal(t, "New Name", updateResp.Msg.Resource.Name)
		assert.Equal(t, int32(12), updateResp.Msg.Resource.Capacity)
	})

	t.Run("set resource ACL", func(t *testing.T) {
		room := w.calCreateResource(owner, "ACL Room", "room", 10)
		employee := w.withEmployee()

		aclReq := connect.NewRequest(&rpcv1.SetResourceACLRequest{
			ResourceId: room.Id,
			Entries: []*rpcv1.ResourceACLEntry{
				{
					EmployeeId: employee.ID.String(),
					Role:       "manager",
				},
			},
		})
		aclReq.Header().Set("Authorization", "Bearer "+owner.Token)
		aclResp, err := w.cal.SetResourceACL(context.Background(), aclReq)
		require.NoError(t, err)
		assert.True(t, aclResp.Msg.Success)
	})
}
