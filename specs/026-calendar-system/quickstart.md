# Quickstart: Calendar System Implementation

**Feature**: `026-calendar-system`  
**Branch**: `026-calendar-system`  
**Date**: 2026-03-20

---

## Prerequisites

Understand these existing systems before implementing:

1. **Flows framework** — `github.com/nvcnvn/flows` used for background scheduling (reminder workflow). Study `backend/internal/collaboration/scheduler_workflow.go` and `RitualSchedulerWorkflow` for the pattern.
2. **Notification hub** — `backend/internal/notification/` — publication, SSE, presence. Calendar reminders and RSVP notifications route through this system.
3. **Files domain** — `backend/internal/files/` — file upload contexts. Calendar uses `ContextTypeCalendarEvent`.
4. **Collaboration domain** — `backend/internal/collaboration/` — task and ritual overlay reader interfaces will be defined in `backend/internal/calendar/` and implemented here.
5. **Citus sharding rules** — All calendar tables must include `organization_id` as first PK column. No triggers. No `ON DELETE SET NULL` (except documented exception in `booking_link`).

---

## Dev Environment Setup

```bash
# From repo root — start the database
cd backend
docker compose up -d

# Run existing migrations
DATABASE_URL=postgres://postgres:postgres@localhost:15432/tech_office_db ./scripts/migrate.sh

# Generate sqlc after adding calendar queries
sqlc generate

# Run integration tests to verify baseline
go test ./integration/... -timeout 120s
```

---

## Implementation Order

Follow this exact order to avoid dependency gaps:

### Step 1: Schema & Migration

1. **Update `backend/database/scripts/schema.sql`** — Add all 12 `calendar.*` tables (see `data-model.md`).
2. **Create a paired migration** under `backend/k8s/base/database/migrations/YYYYMMDDHHMMSS_calendar_schema.up.sql` and `.down.sql`.
3. **Extend notification CHECK constraints** in a separate migration:
   - `notification.notification.source_domain` → add `'calendar'`
   - `notification.notification.notification_type` → add `calendar_event_invite`, `calendar_event_cancel`, `calendar_event_change`, `calendar_event_reminder`, `calendar_check_in_missed`
   - `notification.notification.policy_key` → add matching calendar policy keys
   - `notification.resource_subscription.resource_domain` → add `'calendar_event'`
4. **Extend presence CHECK constraint**: `notification.active_connection.presence_status` → add `'in_meeting'`.
5. **Run migration**: `DATABASE_URL=... ./scripts/migrate.sh`

### Step 2: sqlc Queries

Create `backend/database/scripts/calendar.query.sql` with all required queries:

```sql
-- name: InsertEvent :one
-- name: GetEvent :one
-- name: ListEventsForEmployee :many         (by org + employee_id + time range)
-- name: ListEventsForOrg :many             (org-wide events)
-- name: CancelEvent :one                   (set cancelled_at, cancelled_by_id)
-- name: InsertAttendee :one
-- name: ListAttendees :many                (by org + event_id)
-- name: UpdateAttendeeRSVP :one
-- name: ResetAttendeesRSVP :exec          (when time/location changes)
-- name: InsertRecurrenceException :one
-- name: ListRecurrenceExceptions :many    (by org + series_id)
-- name: InsertResourceBooking :one
-- name: DetectResourceConflict :one       (SELECT COUNT FOR UPDATE — conflict detection)
-- name: DeleteResourceBookingsForEvent :exec
-- name: UpsertWorkingHours :one
-- name: ListWorkingHours :many            (by org + employee_id)
-- name: InsertCheckIn :one
-- name: UpdateCheckInEvidence :one
-- name: ListCheckIns :many               (by org + event_id)
-- name: InsertAuditEntry :exec           (append-only — no UPDATE/DELETE)
-- name: ListAuditEntries :many           (by org + event_id, cursor-paginated)
-- name: InsertBookingLink :one
-- name: GetBookingLinkByToken :one
-- name: ClaimBookingLink :one            (SELECT FOR UPDATE + update status + claimed_event_id)
-- name: InsertDelegation :one
-- name: GetDelegation :one
-- name: DeleteDelegation :exec
-- name: InsertResource :one
-- name: ListResources :many
-- name: UpdateResource :one
```

Run `sqlc generate` after completing the SQL file.

### Step 3: Constants

Add to `backend/internal/notification/constants.go`:
```go
PresenceStatusInMeeting = "in_meeting"

// Notification types and policy keys (see data-model.md for full list)
NotificationTypeCalendarEventInvite = "calendar_event_invite"
// ...
SourceDomainCalendar = "calendar"
```

Create `backend/internal/calendar/constants.go` with all calendar domain constants (see `data-model.md`).

Update `backend/internal/files/constants.go` — add `UploadContextCalendar = "calendar"` and add it to `ValidUploadContexts()`.

### Step 4: Proto & Generated Code

Copy `contracts/calendar.proto` to `backend/rpc/v1/calendar.proto`.

```bash
cd backend
buf generate
```

This generates `backend/rpc/v1/calendar.pb.go` and the connect handlers in `backend/rpc/v1/rpcv1connect/`.

### Step 5: Logic Layer

Create `backend/internal/calendar/`:

```
backend/internal/calendar/
├── constants.go           # all calendar constants
├── logic.go               # CalendarLogic interface (full API surface)
├── event_logic.go         # event CRUD, attendee management, recurrence
├── recurrence.go          # recurrence rule computation (computeInstances, detectConflicts)
├── scheduling.go          # FreeBusy computation, SuggestSlots
├── resource_logic.go      # resource CRUD, conflict detection (SELECT FOR UPDATE)
├── booking_link_logic.go  # booking link creation, token generation, slot claiming
├── delegation_logic.go    # delegation grant/revoke, delegate verification
├── overlay_logic.go       # CollaborationOverlayReader, DocsOverlayReader interfaces
│                          # + overlay item aggregation
├── compliance_logic.go    # check_in, evidence submission, audit_entry writing
├── reminder_workflow.go   # flows.Workflow for event reminders (CalendarReminderWorkflow)
└── presence_logic.go      # in_meeting presence signal on event start/end
```

**Key interface definitions in `overlay_logic.go`**:

```go
// Implemented by collaboration.Logic
type CollaborationOverlayReader interface {
    GetTasksDueInRange(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, from, to time.Time) ([]*OverlayItem, error)
    GetRitualInstancesInRange(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, from, to time.Time) ([]*OverlayItem, error)
}

// Implemented by docs.Logic
type DocsOverlayReader interface {
    GetDocDeadlinesInRange(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, from, to time.Time) ([]*OverlayItem, error)
}
```

**CalendarLogic full interface** (in `logic.go`):

```go
type Logic interface {
    // Events
    CreateEvent(ctx, tx, orgID, actorID dbuuid.UUID, req *CreateEventParams) (*rpcv1.CalendarEvent, error)
    GetEvent(ctx, tx, orgID, actorID, eventID dbuuid.UUID) (*rpcv1.CalendarEvent, error)
    ListEvents(ctx, tx, orgID, actorID dbuuid.UUID, from, to time.Time) ([]*rpcv1.CalendarEvent, error)
    UpdateEvent(ctx, tx, orgID, actorID, eventID dbuuid.UUID, req *UpdateEventParams) (*rpcv1.CalendarEvent, error)
    CancelEvent(ctx, tx, orgID, actorID, eventID dbuuid.UUID) error
    EditEventSeries(ctx, tx, orgID, actorID, eventID dbuuid.UUID, req *EditSeriesParams) (*rpcv1.CalendarEvent, error)
    // RSVP
    RespondToInvite(ctx, tx, orgID, actorID, eventID dbuuid.UUID, rsvp string, note string) (*rpcv1.EventAttendee, error)
    // Working hours
    GetWorkingHours(ctx, tx, orgID, employeeID dbuuid.UUID) ([]*rpcv1.WorkingHours, error)
    SetWorkingHours(ctx, tx, orgID, employeeID dbuuid.UUID, hours []*rpcv1.WorkingHours) ([]*rpcv1.WorkingHours, error)
    // Scheduling assistant
    GetFreeBusy(ctx, tx, orgID dbuuid.UUID, employeeIDs []dbuuid.UUID, from, to time.Time) ([]*rpcv1.EmployeeFreeBusy, error)
    SuggestSlots(ctx, tx, orgID dbuuid.UUID, employeeIDs []dbuuid.UUID, duration time.Duration, from, to time.Time, max int) ([]*rpcv1.FreeBusySlot, error)
    // Resources
    ListResources(ctx, tx, orgID dbuuid.UUID, filter *ResourceFilter) ([]*rpcv1.CalendarResource, error)
    CreateResource(ctx, tx, orgID, actorID dbuuid.UUID, req *CreateResourceParams) (*rpcv1.CalendarResource, error)
    UpdateResource(ctx, tx, orgID, actorID, resourceID dbuuid.UUID, req *UpdateResourceParams) (*rpcv1.CalendarResource, error)
    // Booking links
    CreateBookingLink(ctx, tx, orgID, actorID dbuuid.UUID, req *CreateBookingLinkParams) (*rpcv1.BookingLink, string, error)
    GetBookingLinkByToken(ctx, tx, orgID dbuuid.UUID, token string) (*rpcv1.BookingLink, []*rpcv1.FreeBusySlot, error)
    ClaimBookingSlot(ctx, tx, orgID, claimerID dbuuid.UUID, token string, slotStart time.Time) (*rpcv1.CalendarEvent, error)
    // Delegation
    GrantDelegation(ctx, tx, orgID, ownerID, delegateID dbuuid.UUID, expiresAt *time.Time) error
    RevokeDelegation(ctx, tx, orgID, ownerID, delegateID dbuuid.UUID) error
    VerifyDelegation(ctx, tx, orgID, ownerID, delegateID dbuuid.UUID) (bool, error)
    // Compliance
    CheckInToEvent(ctx, tx, orgID, actorID, eventID dbuuid.UUID) (*rpcv1.CalendarCheckIn, error)
    SubmitCheckInEvidence(ctx, tx, orgID, actorID, eventID dbuuid.UUID, fileIDs []dbuuid.UUID) (*rpcv1.CalendarCheckIn, error)
    ListAuditEntries(ctx, tx, orgID, eventID, cursor dbuuid.NullUUID, limit int) ([]*rpcv1.CalendarAuditEntry, dbuuid.NullUUID, error)
    WriteAuditEntry(ctx, tx, orgID, eventID, actorID dbuuid.UUID, delegateID dbuuid.NullUUID, action string, diff any) error
    // Overlays
    ListOverlayItems(ctx, tx, orgID, actorID dbuuid.UUID, from, to time.Time, opts *OverlayOptions) ([]*rpcv1.OverlayItem, error)
    // Search
    SearchEvents(ctx, tx, orgID, actorID dbuuid.UUID, req *SearchEventsParams) ([]*rpcv1.CalendarEvent, dbuuid.NullUUID, error)
}
```

### Step 6: Connect Layer

Create `backend/internal/calendar/connect.go` — `CalendarServiceServer` struct implementing the generated connect interface. Follows the same pattern as `backend/internal/collaboration/connect.go`:
- Extracts `orgID`, `actorID` from auth context
- Opens transactions via `txn.WithTxn()`
- Calls logic layer methods
- Translates `pgx.ErrNoRows` → `connect.CodeNotFound`, etc.

### Step 7: Server Wiring

In `backend/cmd/server.go`:

```go
// Initialize calendar logic
calendarLogic := calendar.NewLogic(
    queries,
    notificationLogic,     // for PublishNotification (reminders, RSVP)
    presenceLogic,         // for UpdatePresenceStatus (in_meeting signals)
    fileLogic,             // for file upload context validation
    collaborationLogic,    // implements CollaborationOverlayReader
    docsLogic,             // implements DocsOverlayReader
)

// Register CalendarReminderWorkflow
calendarReminderWorkflow := &calendar.CalendarReminderWorkflow{
    Logic:     calendarLogic,
    AdminPool: adminPool,
}
flows.Register(flowsRegistry, calendarReminderWorkflow)

// Register CalendarPresenceWorkflow (signals in_meeting status at event boundaries)
calendarPresenceWorkflow := &calendar.CalendarPresenceWorkflow{
    Logic:     calendarLogic,
    AdminPool: adminPool,
}
flows.Register(flowsRegistry, calendarPresenceWorkflow)

// Mount CalendarServiceServer
calendarServer := &calendar.CalendarServiceServer{
    Logic:      calendarLogic,
    TenantPool: tenantPool,
}
mux.Handle(rpcv1connect.CalendarServiceHandler(calendarServer, connectOpts...))
```

### Step 8: Frontend Routes

Create under `frontend/apps/web/src/app/workspace/calendar/`:

```
calendar/
├── page.tsx              # Default view (week view, personal calendar)
├── layout.tsx            # Sidebar: overlay toggles, mini-month nav
├── loading.tsx           # Skeleton loaders
├── [eventId]/
│   └── page.tsx          # Event detail / edit
└── booking/
    └── [token]/
        └── page.tsx      # Booking link recipient view
```

Create `frontend/packages/apis/src/calendar.ts` with all wrapper functions and TypeScript interfaces.

### Step 9: Integration Tests

Create `backend/integration/calendar_events_test.go`, `calendar_recurrence_test.go`, `calendar_resources_test.go`, `calendar_scheduling_test.go`, `calendar_compliance_test.go`.

**Run full suite after implementation:**
```bash
cd backend
go test ./integration/... -timeout 300s
```

---

## Critical Implementation Notes

### Recurrence Expansion

When rendering a calendar view, the server expands recurring event instances for the requested time range on-the-fly (not pre-generated). The expansion parses `recurrence_rule TEXT` (RFC 5545 RRULE string) via `teambition/rrule-go` and applies exceptions from `calendar.recurrence_exception`. Keep expansion in the logic layer (`recurrence.go`).

```go
import "github.com/teambition/rrule-go"

func expandInstances(rule string, dtstart time.Time, from, to time.Time) ([]time.Time, error) {
    r, err := rrule.StrToRRule(rule)
    if err != nil {
        return nil, err
    }
    r.DTStart(dtstart)
    return r.Between(from, to, true), nil
}
```

### Resource Conflict Detection

Always use `SELECT ... FOR UPDATE`:

```sql
-- name: DetectResourceConflict :one
SELECT COUNT(*) FROM calendar.resource_booking
WHERE organization_id = $1
  AND resource_id = $2
  AND start_time < $4      -- proposed end
  AND end_time > $3        -- proposed start
FOR UPDATE;
```

If `count > 0` → return `connect.CodeAlreadyExists` with a conflict error detail.

### Audit Entries (Append-Only)

The `WriteAuditEntry` method MUST only INSERT. There must be NO UPDATE or DELETE query against `calendar.audit_entry` in the entire codebase.

### Presence Signal Timing

The `CalendarPresenceWorkflow` runs via `flows` polling. It queries events that start or end within the next 1-minute window and haven't been signaled yet:
- Event starting → call `PresenceLogic.UpdatePresenceStatus(in_meeting)` for all attendees who accepted
- Event ending → call `PresenceLogic.UpdatePresenceStatus(online)` for all attendees of that event, unless they have another active meeting in the next 0-minute window

Use a `calendar.presence_signal` UNLOGGED table to track which signals have been sent (avoid duplicate signals on re-poll).

### Private Event Visibility

In `ListEvents`, events with `visibility='private'` belonging to a different employee MUST be returned as a redacted stub:

```go
if event.Visibility == VisibilityPrivate && event.OrganizerID != callerID {
    // Return redacted version
    return &rpcv1.CalendarEvent{
        ID:        event.ID,
        EventType: event.EventType,
        StartTime: event.StartTime,
        EndTime:   event.EndTime,
        AllDay:    event.AllDay,
        Title:     "Busy",         // No real title
        Visibility: VisibilityPrivate,
    }
}
```

---

## Testing Checklist

Before marking the feature done:

- [ ] `go test ./integration/... -timeout 300s` — all pass (zero failures, including existing tests)
- [ ] Resource double-booking: two concurrent POST requests for same room at same time → exactly one succeeds
- [ ] Recurring event exception: move one instance → series intact, exception stored correctly
- [ ] RSVP reset: update event time → all non-organizer attendees reset to `pending`
- [ ] Private event: caller sees `"Busy"` for another user's private event, not the real title
- [ ] Compliance audit: every change to a `shift` event creates an `audit_entry` row
- [ ] Booking link: two simultaneous claims → exactly one creates the event, the other gets `CodeAlreadyExists`
- [ ] `architecture/docs` updated after all tests pass
