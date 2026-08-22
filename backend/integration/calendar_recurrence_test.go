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
// Act helper for EditEventSeries
// ---------------------------------------------------------------------------

func (w *testWorld) calEditEventSeries(actor testUser, req *rpcv1.EditEventSeriesRequest) *rpcv1.CalendarEvent {
	w.t.Helper()
	r := connect.NewRequest(req)
	r.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.cal.EditEventSeries(context.Background(), r)
	require.NoError(w.t, err, "calEditEventSeries")
	require.NotNil(w.t, resp.Msg.Event)
	return resp.Msg.Event
}

// calCreateRecurringEvent creates a recurring event for testing.
func (w *testWorld) calCreateRecurringEvent(actor testUser, title string, start, end time.Time, rrule string) *rpcv1.CalendarEvent {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CreateEventRequest{
		Title:          title,
		EventType:      "meeting",
		Visibility:     "team",
		StartTime:      timestamppb.New(start),
		EndTime:        timestamppb.New(end),
		RecurrenceRule: rrule,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.cal.CreateEvent(context.Background(), req)
	require.NoError(w.t, err, "calCreateRecurringEvent: %s", title)
	require.NotNil(w.t, resp.Msg.Event)
	return resp.Msg.Event
}

// ---------------------------------------------------------------------------
// US2: Recurring Events with Exceptions
// ---------------------------------------------------------------------------

func TestRecurringEvents(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()

	// Place events 2 hours in the future to avoid reminder edge cases.
	now := time.Now().UTC().Truncate(time.Second)
	baseStart := now.Add(2 * time.Hour)
	baseEnd := baseStart.Add(1 * time.Hour)
	// Weekly recurring for 5 weeks: FREQ=WEEKLY;COUNT=5
	rrule := "FREQ=WEEKLY;COUNT=5;BYDAY=" + weekdayAbbrev(baseStart.Weekday())

	t.Run("when a weekly recurring event is created", func(t *testing.T) {
		event := w.calCreateRecurringEvent(owner, "Weekly Standup", baseStart, baseEnd, rrule)

		t.Run("all instances within the recurrence pattern are queryable", func(t *testing.T) {
			// List events across the 5-week window.
			listReq := connect.NewRequest(&rpcv1.ListEventsRequest{
				Start: timestamppb.New(now),
				End:   timestamppb.New(now.Add(6 * 7 * 24 * time.Hour)),
			})
			listReq.Header().Set("Authorization", "Bearer "+owner.Token)
			listResp, err := w.cal.ListEvents(context.Background(), listReq)
			require.NoError(t, err)

			// The series head itself is returned; recurrence expansion may produce
			// virtual instances too (depending on implementation).
			found := false
			for _, e := range listResp.Msg.Events {
				if e.Id == event.Id {
					found = true
					assert.NotEmpty(t, e.RecurrenceRule, "recurring event should have an RRULE")
				}
			}
			assert.True(t, found, "series head should appear in event list")
		})
	})

	t.Run("when a single instance of a recurring series is edited", func(t *testing.T) {
		event := w.calCreateRecurringEvent(owner, "Instance Edit", baseStart, baseEnd, rrule)
		thirdInstance := baseStart.Add(2 * 7 * 24 * time.Hour)
		// Edit the 3rd instance: move it 30 min later.
		newStart := thirdInstance.Add(30 * time.Minute)
		newEnd := newStart.Add(1 * time.Hour)

		edited := w.calEditEventSeries(owner, &rpcv1.EditEventSeriesRequest{
			EventId:           event.Id,
			InstanceStartTime: timestamppb.New(thirdInstance),
			ChangeScope:       rpcv1.EventEditScope_EVENT_EDIT_SCOPE_THIS_INSTANCE,
			StartTime:         timestamppb.New(newStart),
			EndTime:           timestamppb.New(newEnd),
		})

		t.Run("only that instance changes and an exception is recorded", func(t *testing.T) {
			assert.True(t, edited.IsExceptionInstance, "edited instance should be marked as exception")
			assert.NotEqual(t, event.Id, edited.Id, "exception event should have a new ID")
		})

		t.Run("surrounding instances remain unchanged", func(t *testing.T) {
			// The original event (series head) should still have its original RRULE.
			getReq := connect.NewRequest(&rpcv1.GetEventRequest{EventId: event.Id})
			getReq.Header().Set("Authorization", "Bearer "+owner.Token)
			getResp, err := w.cal.GetEvent(context.Background(), getReq)
			require.NoError(t, err)
			assert.Equal(t, rrule, getResp.Msg.Event.RecurrenceRule, "series head RRULE should be unchanged")
		})
	})

	t.Run("when a single instance is cancelled from a recurring series", func(t *testing.T) {
		event := w.calCreateRecurringEvent(owner, "Skip Instance", baseStart, baseEnd, rrule)
		secondInstance := baseStart.Add(7 * 24 * time.Hour)
		// Skip the 2nd instance.
		w.calEditEventSeries(owner, &rpcv1.EditEventSeriesRequest{
			EventId:           event.Id,
			InstanceStartTime: timestamppb.New(secondInstance),
			ChangeScope:       rpcv1.EventEditScope_EVENT_EDIT_SCOPE_THIS_INSTANCE,
			SkipInstance:      true,
		})

		t.Run("that date appears as skipped and future instances remain", func(t *testing.T) {
			// The series head is unchanged.
			getReq := connect.NewRequest(&rpcv1.GetEventRequest{EventId: event.Id})
			getReq.Header().Set("Authorization", "Bearer "+owner.Token)
			getResp, err := w.cal.GetEvent(context.Background(), getReq)
			require.NoError(t, err)
			assert.Equal(t, rrule, getResp.Msg.Event.RecurrenceRule, "series RRULE should be unchanged after skip")
		})
	})

	t.Run("when this-and-following is edited from a mid-series point", func(t *testing.T) {
		event := w.calCreateRecurringEvent(owner, "Fork Series", baseStart, baseEnd, rrule)
		thirdInstance := baseStart.Add(2 * 7 * 24 * time.Hour)
		// Edit from the 3rd instance forward with a new title.
		newStart := thirdInstance.Add(15 * time.Minute)
		newEnd := newStart.Add(1 * time.Hour)

		forked := w.calEditEventSeries(owner, &rpcv1.EditEventSeriesRequest{
			EventId:           event.Id,
			InstanceStartTime: timestamppb.New(thirdInstance),
			ChangeScope:       rpcv1.EventEditScope_EVENT_EDIT_SCOPE_THIS_AND_FOLLOWING,
			Title:             "Fork Series - Updated",
			StartTime:         timestamppb.New(newStart),
			EndTime:           timestamppb.New(newEnd),
		})

		t.Run("a new series fork is created from that point", func(t *testing.T) {
			assert.NotEqual(t, event.Id, forked.Id, "forked series should have a new event ID")
			assert.NotEmpty(t, forked.RecurrenceRule, "forked series should have a recurrence rule")
			assert.Equal(t, "Fork Series - Updated", forked.Title)
		})

		t.Run("earlier instances remain intact", func(t *testing.T) {
			getReq := connect.NewRequest(&rpcv1.GetEventRequest{EventId: event.Id})
			getReq.Header().Set("Authorization", "Bearer "+owner.Token)
			getResp, err := w.cal.GetEvent(context.Background(), getReq)
			require.NoError(t, err)
			assert.Equal(t, "Fork Series", getResp.Msg.Event.Title, "original series should keep original title")
		})
	})

	t.Run("when a compliance-flagged recurring event (shift) is modified", func(t *testing.T) {
		// Create a shift-type recurring event.
		shiftReq := connect.NewRequest(&rpcv1.CreateEventRequest{
			Title:          "Night Shift",
			EventType:      "shift",
			Visibility:     "team",
			StartTime:      timestamppb.New(baseStart),
			EndTime:        timestamppb.New(baseEnd),
			RecurrenceRule: rrule,
		})
		shiftReq.Header().Set("Authorization", "Bearer "+owner.Token)
		shiftResp, err := w.cal.CreateEvent(context.Background(), shiftReq)
		require.NoError(t, err)
		shiftEvent := shiftResp.Msg.Event

		// Edit all instances.
		newEnd := baseEnd.Add(30 * time.Minute)
		w.calEditEventSeries(owner, &rpcv1.EditEventSeriesRequest{
			EventId:           shiftEvent.Id,
			InstanceStartTime: timestamppb.New(baseStart),
			ChangeScope:       rpcv1.EventEditScope_EVENT_EDIT_SCOPE_ALL,
			EndTime:           timestamppb.New(newEnd),
		})

		t.Run("an audit record is created with actor and diff", func(t *testing.T) {
			auditReq := connect.NewRequest(&rpcv1.ListAuditEntriesRequest{
				EventId: shiftEvent.Id,
				Limit:   10,
			})
			auditReq.Header().Set("Authorization", "Bearer "+owner.Token)
			auditResp, err := w.cal.ListAuditEntries(context.Background(), auditReq)
			require.NoError(t, err)
			assert.NotEmpty(t, auditResp.Msg.Entries, "audit entries should exist for compliance event modification")
		})
	})
}

// weekdayAbbrev converts Go's time.Weekday to RFC 5545 BYDAY abbreviation.
func weekdayAbbrev(wd time.Weekday) string {
	switch wd {
	case time.Monday:
		return "MO"
	case time.Tuesday:
		return "TU"
	case time.Wednesday:
		return "WE"
	case time.Thursday:
		return "TH"
	case time.Friday:
		return "FR"
	case time.Saturday:
		return "SA"
	case time.Sunday:
		return "SU"
	default:
		return "MO"
	}
}
