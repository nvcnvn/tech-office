package integration

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/timestamppb"

	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/calendar"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// ---------------------------------------------------------------------------
// Arrange: shift events
// ---------------------------------------------------------------------------

// calCreateShift creates a non-recurring shift event with the given attendees. The
// organiser is the actor, which is the manager publishing the rota — deliberately not the
// same person as the people being rostered.
func (w *testWorld) calCreateShift(actor testUser, title string, start, end time.Time, attendeeIDs []string) *rpcv1.CalendarEvent {
	w.t.Helper()
	return w.calCreateShiftFull(actor, title, start, end, attendeeIDs, "", "team", false)
}

// calCreateShiftFull is the whole shift-creation surface these scenarios need: recurrence,
// visibility and the all-day flag are all part of the coverage rules under test.
func (w *testWorld) calCreateShiftFull(
	actor testUser,
	title string,
	start, end time.Time,
	attendeeIDs []string,
	rrule string,
	visibility string,
	allDay bool,
) *rpcv1.CalendarEvent {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CreateEventRequest{
		Title:               title,
		EventType:           "shift",
		Visibility:          visibility,
		StartTime:           timestamppb.New(start),
		EndTime:             timestamppb.New(end),
		AllDay:              allDay,
		RecurrenceRule:      rrule,
		RequiredAttendeeIds: attendeeIDs,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.cal.CreateEvent(context.Background(), req)
	require.NoError(w.t, err, "calCreateShiftFull: %s", title)
	require.NotNil(w.t, resp.Msg.Event)
	return resp.Msg.Event
}

func (w *testWorld) calCancelEvent(actor testUser, eventID string) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CancelEventRequest{EventId: eventID})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	_, err := w.cal.CancelEvent(context.Background(), req)
	require.NoError(w.t, err, "calCancelEvent")
}

// employeesOnShift drives the real calendar logic — the same object cmd/server.go injects
// into collaboration — over the real database.
func (w *testWorld) employeesOnShift(orgID dbuuid.UUID, candidates []dbuuid.UUID, dayStart, dayEnd time.Time) []dbuuid.UUID {
	w.t.Helper()
	logic := calendar.NewLogic(globalQ, nil, nil, nil)
	covered, err := logic.EmployeesOnShift(context.Background(), globalDB, orgID, candidates, dayStart, dayEnd)
	require.NoError(w.t, err)
	return covered
}

// countCalendarEvents is how the read-only guarantee is asserted: a coverage read must
// leave the event table exactly as it found it.
func (w *testWorld) countCalendarEvents(orgID dbuuid.UUID) int {
	w.t.Helper()
	var count int
	err := globalDB.QueryRow(context.Background(),
		`SELECT count(*) FROM calendar.event WHERE organization_id = $1`, orgID).Scan(&count)
	require.NoError(w.t, err)
	return count
}

func employeeIDs(users ...testUser) []dbuuid.UUID {
	out := make([]dbuuid.UUID, 0, len(users))
	for _, u := range users {
		out = append(out, u.ID)
	}
	return out
}

func employeeIDStrings(users ...testUser) []string {
	out := make([]string, 0, len(users))
	for _, u := range users {
		out = append(out, u.ID.String())
	}
	return out
}

// utcDay returns the half-open [start, end) instants bounding a UTC calendar date, which
// is the shape EmployeesOnShift takes.
func utcDay(t time.Time) (time.Time, time.Time) {
	y, m, d := t.UTC().Date()
	start := time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	return start, start.AddDate(0, 0, 1)
}

// ---------------------------------------------------------------------------
// TestCalendarShiftCoverage
// ---------------------------------------------------------------------------

func TestCalendarShiftCoverage(t *testing.T) {
	t.Parallel()

	// FR-003: a shift event covers a scheduled date when its span overlaps that date.
	t.Run("when a shift covers one day", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		manager := w.withOwner()
		worker := w.withEmployee()

		day := time.Now().UTC().AddDate(0, 0, 3)
		dayStart, dayEnd := utcDay(day)
		w.calCreateShift(manager, "Late shift", dayStart.Add(14*time.Hour), dayStart.Add(22*time.Hour),
			employeeIDStrings(worker))

		t.Run("an employee on a shift that covers the day is reported as working", func(t *testing.T) {
			assert.Equal(t, employeeIDs(worker), w.employeesOnShift(worker.OrgID, employeeIDs(worker), dayStart, dayEnd))
		})

		t.Run("an employee whose shift is on a different day is not reported as working", func(t *testing.T) {
			otherStart, otherEnd := utcDay(day.AddDate(0, 0, 1))
			assert.Empty(t, w.employeesOnShift(worker.OrgID, employeeIDs(worker), otherStart, otherEnd))
		})
	})

	// FR-003: all-day and overnight shifts need no special-casing.
	t.Run("when a shift is all day or overnight", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		manager := w.withOwner()
		allDayWorker := w.withEmployee()
		nightWorker := w.withEmployee()

		friday := time.Now().UTC().AddDate(0, 0, 5)
		fridayStart, fridayEnd := utcDay(friday)
		saturdayStart, saturdayEnd := utcDay(friday.AddDate(0, 0, 1))

		w.calCreateShiftFull(manager, "All day cover", fridayStart, fridayEnd,
			employeeIDStrings(allDayWorker), "", "team", true)
		// 22:00 Friday to 06:00 Saturday.
		w.calCreateShift(manager, "Night shift", fridayStart.Add(22*time.Hour), saturdayStart.Add(6*time.Hour),
			employeeIDStrings(nightWorker))

		t.Run("an all-day shift covers every date in its span", func(t *testing.T) {
			assert.Contains(t, w.employeesOnShift(allDayWorker.OrgID, employeeIDs(allDayWorker), fridayStart, fridayEnd),
				allDayWorker.ID)
		})

		t.Run("an overnight shift from Friday evening to Saturday morning covers both dates", func(t *testing.T) {
			assert.Contains(t, w.employeesOnShift(nightWorker.OrgID, employeeIDs(nightWorker), fridayStart, fridayEnd),
				nightWorker.ID, "the Friday the shift starts on")
			assert.Contains(t, w.employeesOnShift(nightWorker.OrgID, employeeIDs(nightWorker), saturdayStart, saturdayEnd),
				nightWorker.ID, "the Saturday the shift ends on")
		})
	})

	// FR-003: cancellation is a soft state and must be honoured.
	t.Run("when a shift event is cancelled", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		manager := w.withOwner()
		worker := w.withEmployee()

		dayStart, dayEnd := utcDay(time.Now().UTC().AddDate(0, 0, 4))
		event := w.calCreateShift(manager, "Cancelled shift", dayStart.Add(9*time.Hour), dayStart.Add(17*time.Hour),
			employeeIDStrings(worker))
		require.Contains(t, w.employeesOnShift(worker.OrgID, employeeIDs(worker), dayStart, dayEnd), worker.ID)

		w.calCancelEvent(manager, event.Id)

		t.Run("a cancelled shift event covers nobody", func(t *testing.T) {
			assert.Empty(t, w.employeesOnShift(worker.OrgID, employeeIDs(worker), dayStart, dayEnd))
		})
	})

	// FR-004: a declined shift is not work; every other RSVP is.
	t.Run("when attendees have answered the shift invitation differently", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		manager := w.withOwner()
		decliner := w.withEmployee()
		silent := w.withEmployee()
		accepter := w.withEmployee()
		tentative := w.withEmployee()

		dayStart, dayEnd := utcDay(time.Now().UTC().AddDate(0, 0, 6))
		event := w.calCreateShift(manager, "Mixed RSVP shift", dayStart.Add(8*time.Hour), dayStart.Add(16*time.Hour),
			employeeIDStrings(decliner, silent, accepter, tentative))

		w.calRespondToInvite(decliner, event.Id, rpcv1.RSVPResponse_RSVP_RESPONSE_DECLINED)
		w.calRespondToInvite(accepter, event.Id, rpcv1.RSVPResponse_RSVP_RESPONSE_ACCEPTED)
		w.calRespondToInvite(tentative, event.Id, rpcv1.RSVPResponse_RSVP_RESPONSE_TENTATIVE)

		covered := w.employeesOnShift(manager.OrgID,
			employeeIDs(decliner, silent, accepter, tentative), dayStart, dayEnd)

		t.Run("an employee who declined the shift invitation is not reported as working", func(t *testing.T) {
			assert.NotContains(t, covered, decliner.ID)
		})
		t.Run("an employee who has not responded to the shift is reported as working", func(t *testing.T) {
			assert.Contains(t, covered, silent.ID)
		})
		t.Run("an employee who accepted or is tentative is reported as working", func(t *testing.T) {
			assert.Contains(t, covered, accepter.ID)
			assert.Contains(t, covered, tentative.ID)
		})
	})

	// FR-003: recurring series occurrences and their exceptions.
	t.Run("when the shift is a recurring series", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		manager := w.withOwner()
		worker := w.withEmployee()

		// Anchor the series on a fixed weekday so the occurrence dates are predictable.
		base := time.Now().UTC().AddDate(0, 0, 2).Truncate(24 * time.Hour)
		seriesStart := base.Add(9 * time.Hour)
		series := w.calCreateShiftFull(manager, "Daily shift", seriesStart, seriesStart.Add(8*time.Hour),
			employeeIDStrings(worker), "FREQ=DAILY;COUNT=10", "team", false)

		thirdStart, thirdEnd := utcDay(base.AddDate(0, 0, 2))

		t.Run("an occurrence generated from a recurring shift series is reported as working", func(t *testing.T) {
			assert.Contains(t, w.employeesOnShift(worker.OrgID, employeeIDs(worker), thirdStart, thirdEnd), worker.ID)
		})

		t.Run("an occurrence cancelled by a recurrence exception is not reported as working", func(t *testing.T) {
			skippedStart, skippedEnd := utcDay(base.AddDate(0, 0, 3))
			w.calEditEventSeries(manager, &rpcv1.EditEventSeriesRequest{
				EventId:           series.Id,
				InstanceStartTime: timestamppb.New(seriesStart.AddDate(0, 0, 3)),
				ChangeScope:       rpcv1.EventEditScope_EVENT_EDIT_SCOPE_THIS_INSTANCE,
				SkipInstance:      true,
			})
			assert.Empty(t, w.employeesOnShift(worker.OrgID, employeeIDs(worker), skippedStart, skippedEnd))
		})

		t.Run("a moved occurrence is reported on its new date and not on its original date", func(t *testing.T) {
			originalStart := seriesStart.AddDate(0, 0, 4)
			movedStart := originalStart.AddDate(0, 0, 30) // far outside the series' own span
			movedEnd := movedStart.Add(8 * time.Hour)

			w.calEditEventSeries(manager, &rpcv1.EditEventSeriesRequest{
				EventId:           series.Id,
				InstanceStartTime: timestamppb.New(originalStart),
				ChangeScope:       rpcv1.EventEditScope_EVENT_EDIT_SCOPE_THIS_INSTANCE,
				StartTime:         timestamppb.New(movedStart),
				EndTime:           timestamppb.New(movedEnd),
			})

			origDayStart, origDayEnd := utcDay(originalStart)
			newDayStart, newDayEnd := utcDay(movedStart)

			assert.Empty(t, w.employeesOnShift(worker.OrgID, employeeIDs(worker), origDayStart, origDayEnd),
				"the original date is no longer covered")
			assert.Contains(t, w.employeesOnShift(worker.OrgID, employeeIDs(worker), newDayStart, newDayEnd), worker.ID,
				"the replacement event covers the new date")
		})
	})

	// FR-002 boundary: the reader narrows the candidate list, it never widens it.
	t.Run("when the candidate list is narrow or empty", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		manager := w.withOwner()
		rostered := w.withEmployee()
		unrelated := w.withEmployee()

		dayStart, dayEnd := utcDay(time.Now().UTC().AddDate(0, 0, 7))
		w.calCreateShift(manager, "Narrow shift", dayStart.Add(9*time.Hour), dayStart.Add(17*time.Hour),
			employeeIDStrings(rostered))

		t.Run("an employee on shift who is not in the candidate list is not returned", func(t *testing.T) {
			assert.Empty(t, w.employeesOnShift(manager.OrgID, employeeIDs(unrelated), dayStart, dayEnd))
		})

		t.Run("an empty candidate list returns nobody without querying", func(t *testing.T) {
			assert.Empty(t, w.employeesOnShift(manager.OrgID, nil, dayStart, dayEnd))
			assert.Empty(t, w.employeesOnShift(manager.OrgID, []dbuuid.UUID{}, dayStart, dayEnd))
		})
	})

	// FR-021: rituals read the rota, they never write it.
	t.Run("when coverage is read repeatedly", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		manager := w.withOwner()
		worker := w.withEmployee()

		dayStart, dayEnd := utcDay(time.Now().UTC().AddDate(0, 0, 8))
		w.calCreateShift(manager, "Immutable shift", dayStart.Add(9*time.Hour), dayStart.Add(17*time.Hour),
			employeeIDStrings(worker))

		t.Run("reading coverage does not create modify or delete any calendar event", func(t *testing.T) {
			before := w.countCalendarEvents(manager.OrgID)
			for i := 0; i < 3; i++ {
				w.employeesOnShift(manager.OrgID, employeeIDs(worker), dayStart, dayEnd)
			}
			assert.Equal(t, before, w.countCalendarEvents(manager.OrgID))
		})
	})

	// Research R4 / R5 and the event_type boundary.
	t.Run("when the event is not an ordinary team shift", func(t *testing.T) {
		t.Parallel()
		w := newTestWorld(t)
		manager := w.withOwner()
		worker := w.withEmployee()

		day := time.Now().UTC().AddDate(0, 0, 9)
		dayStart, dayEnd := utcDay(day)

		t.Run("the organiser of a shift is not reported as working unless also an attendee", func(t *testing.T) {
			w.calCreateShift(manager, "Organised shift", dayStart.Add(9*time.Hour), dayStart.Add(17*time.Hour),
				employeeIDStrings(worker))
			covered := w.employeesOnShift(manager.OrgID, employeeIDs(manager, worker), dayStart, dayEnd)
			assert.Contains(t, covered, worker.ID)
			assert.NotContains(t, covered, manager.ID,
				"the manager publishing the rota is not thereby rostered onto every shift")
		})

		t.Run("a shift marked private still reports its attendees as working", func(t *testing.T) {
			privateDayStart, privateDayEnd := utcDay(day.AddDate(0, 0, 1))
			w.calCreateShiftFull(manager, "Private shift",
				privateDayStart.Add(9*time.Hour), privateDayStart.Add(17*time.Hour),
				employeeIDStrings(worker), "", "private", false)
			assert.Contains(t, w.employeesOnShift(manager.OrgID, employeeIDs(worker), privateDayStart, privateDayEnd),
				worker.ID)
		})

		t.Run("an event that is not of type shift never contributes coverage", func(t *testing.T) {
			meetingDayStart, meetingDayEnd := utcDay(day.AddDate(0, 0, 2))
			w.calCreateEventWithRequiredAttendees(manager, "Standup",
				meetingDayStart.Add(9*time.Hour), meetingDayStart.Add(10*time.Hour),
				employeeIDStrings(worker))
			assert.Empty(t, w.employeesOnShift(manager.OrgID, employeeIDs(worker), meetingDayStart, meetingDayEnd))
		})
	})
}
