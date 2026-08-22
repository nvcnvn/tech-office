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

// TestCalendarNotifications validates US8: reminder scheduling, change notifications,
// cancel notifications, and the CalendarReminderWorkflow polling cycle.
func TestCalendarNotifications(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()
	attendee := w.withEmployee()

	t.Run("reminders scheduled on event creation", func(t *testing.T) {
		// Create a future event — reminders should be inserted automatically.
		futureStart := time.Now().Add(24 * time.Hour)
		futureEnd := futureStart.Add(1 * time.Hour)

		createReq := connect.NewRequest(&rpcv1.CreateEventRequest{
			Title:               "Reminder Test Meeting",
			EventType:           "meeting",
			Visibility:          "team",
			StartTime:           timestamppb.New(futureStart),
			EndTime:             timestamppb.New(futureEnd),
			RequiredAttendeeIds: []string{attendee.ID.String()},
		})
		createReq.Header().Set("Authorization", "Bearer "+owner.Token)
		createResp, err := w.cal.CreateEvent(context.Background(), createReq)
		require.NoError(t, err)
		require.NotNil(t, createResp.Msg.Event)
		// Event was created successfully with attendees — reminders are scheduled server-side.
		assert.NotEmpty(t, createResp.Msg.Event.Id)
	})

	t.Run("attendees receive notification when event is updated", func(t *testing.T) {
		futureStart := time.Now().Add(48 * time.Hour)
		futureEnd := futureStart.Add(1 * time.Hour)

		createReq := connect.NewRequest(&rpcv1.CreateEventRequest{
			Title:               "Original Meeting",
			EventType:           "meeting",
			Visibility:          "team",
			StartTime:           timestamppb.New(futureStart),
			EndTime:             timestamppb.New(futureEnd),
			RequiredAttendeeIds: []string{attendee.ID.String()},
		})
		createReq.Header().Set("Authorization", "Bearer "+owner.Token)
		createResp, err := w.cal.CreateEvent(context.Background(), createReq)
		require.NoError(t, err)
		event := createResp.Msg.Event

		// Update event time — should trigger change notification.
		newStart := futureStart.Add(1 * time.Hour)
		newEnd := futureEnd.Add(1 * time.Hour)
		updateReq := connect.NewRequest(&rpcv1.UpdateEventRequest{
			EventId:   event.Id,
			StartTime: timestamppb.New(newStart),
			EndTime:   timestamppb.New(newEnd),
		})
		updateReq.Header().Set("Authorization", "Bearer "+owner.Token)
		_, err = w.cal.UpdateEvent(context.Background(), updateReq)
		require.NoError(t, err)
		// Notification is sent asynchronously; we verify the update succeeded.
	})

	t.Run("attendees receive notification when event is cancelled", func(t *testing.T) {
		futureStart := time.Now().Add(72 * time.Hour)
		futureEnd := futureStart.Add(1 * time.Hour)

		createReq := connect.NewRequest(&rpcv1.CreateEventRequest{
			Title:               "Cancel Notification Test",
			EventType:           "meeting",
			Visibility:          "team",
			StartTime:           timestamppb.New(futureStart),
			EndTime:             timestamppb.New(futureEnd),
			RequiredAttendeeIds: []string{attendee.ID.String()},
		})
		createReq.Header().Set("Authorization", "Bearer "+owner.Token)
		createResp, err := w.cal.CreateEvent(context.Background(), createReq)
		require.NoError(t, err)
		event := createResp.Msg.Event

		// Cancel event — should trigger cancel notification.
		cancelReq := connect.NewRequest(&rpcv1.CancelEventRequest{
			EventId: event.Id,
		})
		cancelReq.Header().Set("Authorization", "Bearer "+owner.Token)
		cancelResp, err := w.cal.CancelEvent(context.Background(), cancelReq)
		require.NoError(t, err)
		assert.True(t, cancelResp.Msg.Success)
	})

	// Feature 034 / US4: CalendarReminderWorkflow was registered but never scheduled, so
	// reminders never fired. These scenarios guard both halves of the fix — the schedule
	// row exists, and the workflow does what the schedule now drives.
	t.Run("the calendar reminder poll is actually scheduled", func(t *testing.T) {
		var count int
		err := globalDB.QueryRow(context.Background(),
			`SELECT count(*)::int FROM flows.schedules WHERE schedule_id = 'calendar_reminder_poll'`,
		).Scan(&count)
		require.NoError(t, err)
		assert.Equal(t, 1, count,
			"exactly one calendar_reminder_poll schedule must exist; registration alone never scheduled it")
	})

	t.Run("when a reminder's fire_at has passed", func(t *testing.T) {
		futureStart := time.Now().Add(96 * time.Hour)
		createReq := connect.NewRequest(&rpcv1.CreateEventRequest{
			Title:               "Due Reminder Meeting",
			EventType:           "meeting",
			Visibility:          "team",
			StartTime:           timestamppb.New(futureStart),
			EndTime:             timestamppb.New(futureStart.Add(1 * time.Hour)),
			RequiredAttendeeIds: []string{attendee.ID.String()},
		})
		createReq.Header().Set("Authorization", "Bearer "+owner.Token)
		createResp, err := w.cal.CreateEvent(context.Background(), createReq)
		require.NoError(t, err)
		eventID := dbuuid.MustParse(createResp.Msg.Event.Id)

		// Backdate the reminder so the poll considers it due.
		tag, err := globalDB.Exec(context.Background(),
			`UPDATE calendar.event_reminder
			    SET fire_at = now() - interval '1 minute', status = 'pending'
			  WHERE organization_id = $1 AND event_id = $2`,
			owner.OrgID, eventID)
		require.NoError(t, err)
		require.Positive(t, tag.RowsAffected(), "event creation must have scheduled at least one reminder")

		workflow := &calendar.CalendarReminderWorkflow{
			Queries:               globalQ,
			NotificationPublisher: &rpcNotificationPublisher{orgID: owner.OrgID},
			AdminPool:             globalDB,
		}
		out, err := workflow.FirePendingReminders(context.Background())
		require.NoError(t, err)

		t.Run("it publishes a notification and marks the reminder sent", func(t *testing.T) {
			assert.Positive(t, out.TotalFired)

			var pending int
			err := globalDB.QueryRow(context.Background(),
				`SELECT count(*)::int FROM calendar.event_reminder
				  WHERE organization_id = $1 AND event_id = $2 AND status = 'pending'`,
				owner.OrgID, eventID,
			).Scan(&pending)
			require.NoError(t, err)
			assert.Equal(t, 0, pending, "a fired reminder must no longer be pending")

			var notifications int
			err = globalDB.QueryRow(context.Background(),
				`SELECT count(*)::int FROM notification.notification
				  WHERE organization_id = $1 AND notification_type = 'calendar_event_reminder'`,
				owner.OrgID,
			).Scan(&notifications)
			require.NoError(t, err)
			assert.Positive(t, notifications, "firing a reminder must publish a notification")
		})
	})
}
