package calendar

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/flows"

	"github.com/nvcnvn/tech-office/backend/database"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// CalendarReminderInput is the per-run input for the reminder workflow.
type CalendarReminderInput struct{}

// CalendarReminderOutput captures how many reminders were fired.
type CalendarReminderOutput struct {
	TotalFired int `json:"total_fired"`
}

// CalendarReminderWorkflow polls calendar.event_reminder rows where
// status='pending' AND fire_at <= now(), publishes a notification for each,
// and marks the row status='sent'. Safe to re-run on crash.
type CalendarReminderWorkflow struct {
	Queries               *database.Queries
	NotificationPublisher NotificationPublisher
	AdminPool             database.AdminDatabaseConnector
}

func (w *CalendarReminderWorkflow) Name() string { return "CalendarReminderWorkflow" }

func (w *CalendarReminderWorkflow) Run(ctx context.Context, wf *flows.Context, _ *CalendarReminderInput) (*CalendarReminderOutput, error) {
	out, err := flows.Execute(ctx, wf, "fire_pending_reminders/v1",
		func(ctx context.Context, _ *CalendarReminderInput) (*CalendarReminderOutput, error) {
			return w.FirePendingReminders(ctx)
		},
		&CalendarReminderInput{},
		flows.RetryPolicy{MaxRetries: 2},
	)
	if err != nil {
		return nil, err
	}
	return out, nil
}

// FirePendingReminders publishes every due pending reminder and marks it sent. Exported so
// integration tests can drive one poll without standing up a flows worker.
func (w *CalendarReminderWorkflow) FirePendingReminders(ctx context.Context) (*CalendarReminderOutput, error) {
	now := time.Now()
	const batchSize int32 = 100

	reminders, err := w.Queries.ListPendingRemindersGlobal(ctx, w.AdminPool, &database.ListPendingRemindersGlobalParams{
		FireAt: pgtype.Timestamptz{Time: now, Valid: true},
		Limit:  batchSize,
	})
	if err != nil {
		return nil, fmt.Errorf("list pending reminders: %w", err)
	}

	fired := 0
	for _, r := range reminders {
		// Publish reminder notification.
		_, pubErr := w.NotificationPublisher.PublishNotification(ctx, w.AdminPool, &rpcv1.PublishNotificationRequest{
			Recipients: &rpcv1.NotificationRecipients{
				EmployeeIds: []string{r.AttendeeEmployeeID.String()},
			},
			OrganizationId:   r.OrganizationID.String(),
			SourceDomain:     SourceDomainCalendar,
			NotificationType: NotificationTypeCalendarEventReminder,
			// Priority 0 = deliver always. A reminder exists precisely for the person who
			// is not looking at the app: at priority 2 ("deliver when online only") it was
			// suppressed for exactly the absent user it is meant to reach.
			Priority: 0,
			Title:    "Event Reminder",
			// The title has to be in the body: on a lock screen this line is all the user
			// sees, and "an upcoming event" does not say which one.
			Message: fmt.Sprintf("%s starts in %d minutes", r.EventTitle, r.ReminderOffsetMinutes),
			PolicyKey:        PolicyKeyCalendarEventReminder,
			DeliveryClass:    "persistent",
			SourceCategory:   "system",
			NavigationTarget: &rpcv1.NavigationTarget{
				Domain:       SourceDomainCalendar,
				ResourceType: "calendar_event",
				ResourceId:   r.EventID.String(),
			},
		})
		if pubErr != nil {
			slog.WarnContext(ctx, "failed to publish calendar reminder",
				"reminderID", r.ID,
				"eventID", r.EventID,
				"error", pubErr,
			)
			continue
		}

		// Mark reminder as sent.
		markErr := w.Queries.UpdateEventReminderStatus(ctx, w.AdminPool, &database.UpdateEventReminderStatusParams{
			OrganizationID:     r.OrganizationID,
			EventID:            r.EventID,
			AttendeeEmployeeID: r.AttendeeEmployeeID,
			Status:             EventReminderStatusSent,
		})
		if markErr != nil {
			slog.WarnContext(ctx, "failed to mark reminder as sent",
				"reminderID", r.ID,
				"error", markErr,
			)
			continue
		}
		fired++
	}

	slog.InfoContext(ctx, "calendar reminder workflow complete",
		"totalPending", len(reminders),
		"totalFired", fired,
	)

	return &CalendarReminderOutput{TotalFired: fired}, nil
}

// CalendarReminderScheduleID returns the flows schedule ID for the global reminder poll.
func CalendarReminderScheduleID() string {
	return "calendar_reminder_poll"
}

// ReminderSchedule returns a flows.Schedule that fires every minute.
func ReminderSchedule() flows.Schedule {
	return flows.Every(1 * time.Minute)
}
