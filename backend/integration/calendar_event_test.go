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
// Act helpers for Calendar
// ---------------------------------------------------------------------------

// calCreateEvent creates a calendar event and fails the test on error.
func (w *testWorld) calCreateEvent(actor testUser, title string, start, end time.Time) *rpcv1.CalendarEvent {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CreateEventRequest{
		Title:      title,
		EventType:  "meeting",
		Visibility: "personal_shared",
		StartTime:  timestamppb.New(start),
		EndTime:    timestamppb.New(end),
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.cal.CreateEvent(context.Background(), req)
	require.NoError(w.t, err, "calCreateEvent: %s", title)
	require.NotNil(w.t, resp.Msg.Event)
	return resp.Msg.Event
}

func (w *testWorld) calCreateEventWithRequiredAttendees(
	actor testUser,
	title string,
	start, end time.Time,
	requiredAttendeeIDs []string,
) *rpcv1.CalendarEvent {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CreateEventRequest{
		Title:               title,
		EventType:           "meeting",
		Visibility:          "team",
		StartTime:           timestamppb.New(start),
		EndTime:             timestamppb.New(end),
		RequiredAttendeeIds: requiredAttendeeIDs,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.cal.CreateEvent(context.Background(), req)
	require.NoError(w.t, err, "calCreateEventWithRequiredAttendees: %s", title)
	require.NotNil(w.t, resp.Msg.Event)
	return resp.Msg.Event
}

// calRespondToInvite sends an RSVP response and returns the updated attendee.
func (w *testWorld) calRespondToInvite(actor testUser, eventID string, rsvp rpcv1.RSVPResponse) *rpcv1.EventAttendee {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.RespondToInviteRequest{
		EventId:    eventID,
		RsvpStatus: rsvp,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.cal.RespondToInvite(context.Background(), req)
	require.NoError(w.t, err, "calRespondToInvite")
	require.NotNil(w.t, resp.Msg.Attendee)
	return resp.Msg.Attendee
}

func (w *testWorld) calRespondToInviteError(actor testUser, eventID string, rsvp rpcv1.RSVPResponse) error {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.RespondToInviteRequest{
		EventId:    eventID,
		RsvpStatus: rsvp,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.cal.RespondToInvite(context.Background(), req)
	return err
}

// ---------------------------------------------------------------------------
// US1: Personal Calendar & RSVP
// ---------------------------------------------------------------------------

// TestCalendarPersonalEvent covers event CRUD for the organizer's own calendar.
func TestCalendarPersonalEvent(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()

	now := time.Now().UTC().Truncate(time.Second)
	start := now.Add(2 * time.Hour)
	end := now.Add(3 * time.Hour)

	t.Run("when creating a personal event", func(t *testing.T) {
		event := w.calCreateEvent(owner, "Team Sync", start, end)

		t.Run("the event is returned with correct fields", func(t *testing.T) {
			assert.Equal(t, "Team Sync", event.Title)
			assert.Equal(t, "meeting", event.EventType)
			assert.NotEmpty(t, event.Id)
			assert.Equal(t, owner.ID.String(), event.OrganizerEmployeeId)
		})

		t.Run("the organizer is listed as an attendee with role=organizer", func(t *testing.T) {
			req := connect.NewRequest(&rpcv1.ListEventAttendeesRequest{
				EventId: event.Id,
			})
			req.Header().Set("Authorization", "Bearer "+owner.Token)
			resp, err := w.cal.ListEventAttendees(context.Background(), req)
			require.NoError(t, err)
			require.Len(t, resp.Msg.Attendees, 1)
			assert.Equal(t, "organizer", resp.Msg.Attendees[0].Role)
			assert.Equal(t, "accepted", resp.Msg.Attendees[0].RsvpStatus)
		})
	})

	t.Run("when getting a personal event", func(t *testing.T) {
		event := w.calCreateEvent(owner, "GetEvent Test", start, end)

		req := connect.NewRequest(&rpcv1.GetEventRequest{
			EventId: event.Id,
		})
		req.Header().Set("Authorization", "Bearer "+owner.Token)
		resp, err := w.cal.GetEvent(context.Background(), req)
		require.NoError(t, err)
		assert.Equal(t, event.Id, resp.Msg.Event.Id)
	})

	t.Run("when listing events in time range", func(t *testing.T) {
		_ = w.calCreateEvent(owner, "In Range", start, end)

		req := connect.NewRequest(&rpcv1.ListEventsRequest{
			Start: timestamppb.New(now),
			End:   timestamppb.New(now.Add(24 * time.Hour)),
		})
		req.Header().Set("Authorization", "Bearer "+owner.Token)
		resp, err := w.cal.ListEvents(context.Background(), req)
		require.NoError(t, err)
		assert.NotEmpty(t, resp.Msg.Events)
	})

	t.Run("when updating an event", func(t *testing.T) {
		event := w.calCreateEvent(owner, "Original Title", start, end)

		req := connect.NewRequest(&rpcv1.UpdateEventRequest{
			EventId: event.Id,
			Title:   "Updated Title",
		})
		req.Header().Set("Authorization", "Bearer "+owner.Token)
		resp, err := w.cal.UpdateEvent(context.Background(), req)
		require.NoError(t, err)
		assert.Equal(t, "Updated Title", resp.Msg.Event.Title)
	})

	t.Run("when cancelling an event", func(t *testing.T) {
		event := w.calCreateEvent(owner, "To Cancel", start, end)

		req := connect.NewRequest(&rpcv1.CancelEventRequest{
			EventId: event.Id,
		})
		req.Header().Set("Authorization", "Bearer "+owner.Token)
		resp, err := w.cal.CancelEvent(context.Background(), req)
		require.NoError(t, err)
		assert.True(t, resp.Msg.Success)
	})

	t.Run("when a non-organizer tries to cancel", func(t *testing.T) {
		event := w.calCreateEvent(owner, "Organizer Only", start, end)
		other := w.withEmployee()

		req := connect.NewRequest(&rpcv1.CancelEventRequest{
			EventId: event.Id,
		})
		req.Header().Set("Authorization", "Bearer "+other.Token)
		_, err := w.cal.CancelEvent(context.Background(), req)
		require.Error(t, err, "non-organizer should not be able to cancel")
	})
}

// TestCalendarRSVP covers invite/RSVP flow for attendees.
func TestCalendarRSVP(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()
	attendee := w.withEmployee()

	now := time.Now().UTC().Truncate(time.Second)
	start := now.Add(2 * time.Hour)
	end := now.Add(3 * time.Hour)

	t.Run("when adding attendees to an event", func(t *testing.T) {
		req := connect.NewRequest(&rpcv1.CreateEventRequest{
			Title:               "Team Meeting",
			EventType:           "meeting",
			Visibility:          "team",
			StartTime:           timestamppb.New(start),
			EndTime:             timestamppb.New(end),
			RequiredAttendeeIds: []string{attendee.ID.String()},
		})
		req.Header().Set("Authorization", "Bearer "+owner.Token)
		createResp, err := w.cal.CreateEvent(context.Background(), req)
		require.NoError(t, err)
		event := createResp.Msg.Event

		t.Run("the attendee appears with rsvp_status=pending", func(t *testing.T) {
			listReq := connect.NewRequest(&rpcv1.ListEventAttendeesRequest{
				EventId: event.Id,
			})
			listReq.Header().Set("Authorization", "Bearer "+owner.Token)
			listResp, err := w.cal.ListEventAttendees(context.Background(), listReq)
			require.NoError(t, err)
			var found bool
			for _, a := range listResp.Msg.Attendees {
				if a.EmployeeId == attendee.ID.String() {
					found = true
					assert.Equal(t, "pending", a.RsvpStatus)
					assert.Equal(t, "required", a.Role)
				}
			}
			assert.True(t, found, "invited attendee should appear in attendee list")
		})
	})

	t.Run("when an attendee accepts the invite", func(t *testing.T) {
		req := connect.NewRequest(&rpcv1.CreateEventRequest{
			Title:               "RSVP Test",
			EventType:           "meeting",
			Visibility:          "team",
			StartTime:           timestamppb.New(start),
			EndTime:             timestamppb.New(end),
			RequiredAttendeeIds: []string{attendee.ID.String()},
		})
		req.Header().Set("Authorization", "Bearer "+owner.Token)
		createResp, err := w.cal.CreateEvent(context.Background(), req)
		require.NoError(t, err)
		event := createResp.Msg.Event

		a := w.calRespondToInvite(attendee, event.Id, rpcv1.RSVPResponse_RSVP_RESPONSE_ACCEPTED)
		assert.Equal(t, "accepted", a.RsvpStatus)
		assert.NotNil(t, a.ResponseTime)
	})

	t.Run("when an attendee declines the invite", func(t *testing.T) {
		req := connect.NewRequest(&rpcv1.CreateEventRequest{
			Title:               "Decline Test",
			EventType:           "meeting",
			Visibility:          "team",
			StartTime:           timestamppb.New(start),
			EndTime:             timestamppb.New(end),
			RequiredAttendeeIds: []string{attendee.ID.String()},
		})
		req.Header().Set("Authorization", "Bearer "+owner.Token)
		createResp, err := w.cal.CreateEvent(context.Background(), req)
		require.NoError(t, err)
		event := createResp.Msg.Event

		a := w.calRespondToInvite(attendee, event.Id, rpcv1.RSVPResponse_RSVP_RESPONSE_DECLINED)
		assert.Equal(t, "declined", a.RsvpStatus)
	})

	t.Run("when RSVP is reset after changing event time", func(t *testing.T) {
		req := connect.NewRequest(&rpcv1.CreateEventRequest{
			Title:               "Time Change Test",
			EventType:           "meeting",
			Visibility:          "team",
			StartTime:           timestamppb.New(start),
			EndTime:             timestamppb.New(end),
			RequiredAttendeeIds: []string{attendee.ID.String()},
		})
		req.Header().Set("Authorization", "Bearer "+owner.Token)
		createResp, err := w.cal.CreateEvent(context.Background(), req)
		require.NoError(t, err)
		event := createResp.Msg.Event

		// Attendee accepts
		w.calRespondToInvite(attendee, event.Id, rpcv1.RSVPResponse_RSVP_RESPONSE_ACCEPTED)

		// Organizer changes the time
		newStart := start.Add(1 * time.Hour)
		newEnd := end.Add(1 * time.Hour)
		updateReq := connect.NewRequest(&rpcv1.UpdateEventRequest{
			EventId:   event.Id,
			StartTime: timestamppb.New(newStart),
			EndTime:   timestamppb.New(newEnd),
		})
		updateReq.Header().Set("Authorization", "Bearer "+owner.Token)
		_, err = w.cal.UpdateEvent(context.Background(), updateReq)
		require.NoError(t, err)

		// Attendee RSVP should have been reset to pending
		listReq := connect.NewRequest(&rpcv1.ListEventAttendeesRequest{
			EventId: event.Id,
		})
		listReq.Header().Set("Authorization", "Bearer "+owner.Token)
		listResp, err := w.cal.ListEventAttendees(context.Background(), listReq)
		require.NoError(t, err)
		for _, a := range listResp.Msg.Attendees {
			if a.EmployeeId == attendee.ID.String() {
				assert.Equal(t, "pending", a.RsvpStatus, "RSVP should be reset to pending after time change")
			}
		}
	})
}
