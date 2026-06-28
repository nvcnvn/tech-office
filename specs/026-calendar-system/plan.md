# Implementation Plan: Calendar System

**Branch**: `026-calendar-system` | **Date**: 2026-03-20 | **Spec**: [spec.md](spec.md)  
**Input**: Feature specification from `/specs/026-calendar-system/spec.md`

## Summary

Build a full-featured calendar system (T4 — Aggregation Layer) for Tech Office covering: personal and team calendar views, event creation with recurrence (RFC 5545 RRULE via `teambition/rrule-go`), attendee/RSVP management, resource booking with conflict prevention, cross-domain overlays (tasks, rituals, docs), presence "in_meeting" status, operational check-in and compliance audit, scheduling assistant, booking links, and notification integration via the existing notification hub.

Calendar is the first T4 domain — it aggregates read-only overlays from T3 (Collaboration), T2 (Docs, Chat), and T1 (Notification, Files) via thin reader interfaces injected at `backend/cmd/server.go`.

**User question — should we refactor Ritual Task scheduling to share a Go package?**

**Decision: No.** The two systems use intentionally different recurrence formats:
- Rituals: Custom JSONB format (`{type, interval, days_of_week, ...}`) — keeps its existing implementation
- Calendar: RFC 5545 RRULE strings (`FREQ=WEEKLY;BYDAY=MO,WE`) — uses `teambition/rrule-go`

There is no meaningful recurrence logic to extract into a shared package — the parsers, expanders, and flows.Schedule converters are format-specific. The `flows.Workflow` interface (the only structural similarity) is already provided by the external `github.com/nvcnvn/flows` package. Refactoring the ritual scheduler mid-implementation introduces regression risk without measurable benefit (Constitution §V — YAGNI/Simplicity). Architecture rule: Calendar (T4) cannot be imported by Collaboration (T3), and a shared utility at T2 level for scheduling is unjustified cross-domain coupling.

## Technical Context

**Language/Version**: Go 1.23 (backend), TypeScript/React (frontend)  
**Primary Dependencies**: `github.com/teambition/rrule-go` (RFC 5545 recurrence), `github.com/nvcnvn/flows` (background workflow scheduling), ConnectRPC + Protobuf, sqlc, pgx/v5 (PostgreSQL)  
**Storage**: PostgreSQL with Citus sharding — new `calendar` schema; migrations under `backend/k8s/base/database/migrations/`  
**Testing**: `go test ./integration/...` — backend integration tests in `backend/integration/calendar_*.go`; manual frontend testing  
**Target Platform**: Web (desktop + mobile-first), Linux server  
**Project Type**: Full-stack web service feature (backend RPC service + frontend SPA module)  
**Performance Goals**: SC-001 event create < 10s; SC-002 scheduling assistant < 3s for 10 attendees; SC-003 calendar view load < 2s on mobile; SC-004 95% reminders delivered within 60s; SC-005 100% double-booking blocked  
**Constraints**: Citus single-shard transactions for booking conflict prevention (`SELECT … FOR UPDATE`); no cross-schema SQL joins; RRULE expansion in application logic, not SQL; `organization_id` in all distributed table PKs  
**Scale/Scope**: Org-wide (all employees); overlays from 3 source domains; 8 calendar event types; 5 resource types; recurring events with exceptions

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Notes |
|---|-----------|--------|-------|
| I | Data Governance & Multi-Tenancy | ✅ PASS | All `calendar.*` tables include `organization_id`; composite PKs `(organization_id, id)`; no cross-schema SQL joins; composite FK references; Citus-compliant indexes |
| II | Scenario-First Integration Testing | ✅ PASS | Test scenarios derived from all 8 User Stories and FR-001–FR-051; stubs required before implementation in `backend/integration/calendar_*_test.go` |
| III | Two-Layer Service Architecture | ✅ PASS | `CalendarLogic` interface (logic layer) + `CalendarServiceConnect` (connect layer); proto-level `access_control` on all RPCs |
| IV | Cross-Domain Integration | ✅ PASS | `CollaborationOverlayReader` and `DocsOverlayReader` thin interfaces defined in calendar package; injected at `server.go`; no cross-schema SQL joins |
| V | Observability, Simplicity & YAGNI | ✅ PASS | Brute-force scheduling assistant (justified by scale); no ritual refactor (YAGNI); `slog` structured logging |
| VI | Versioning, Breaking Changes | ✅ PASS | Schema changes via golang-migrate paired `.up.sql`/`.down.sql`; notification CHECK constraints updated atomically |
| VII | Frontend API Wrapper Pattern | ✅ PASS | All RPC calls via `packages/apis/src/calendar.ts` wrappers; `data-testid` on all interactive elements; `useThemeColors()` for all colors |
| VIII | Cross-Stack Constant Synchronization | ✅ PASS | Event types, visibility scopes, RSVP statuses, resource types defined as Go `const` + DB CHECK + TS union types; updated atomically |
| IX | UUID v7 & Nullable Parameters | ✅ PASS | All PKs use `uuidv7()`; cursor pagination uses `dbuuid.NullUUID` / `sqlc.narg()` |
| X | Structured Error Details | ✅ PASS | Booking conflict returns `PreconditionFailure` error detail; resource not found returns `ResourceInfo`; form validation returns `BadRequest` |
| XI | Distributed-First Architecture | ✅ PASS | `CalendarReminderWorkflow` and `CalendarPresenceWorkflow` use flows (stateless); SSE via existing notification hub; no in-process state |
| XII | Architecture Documentation | ✅ PASS | `SYSTEM-ARCHITECTURE.md` updated POST-implementation to add T4 tier; `NOTIFICATION-SYSTEM-ARCHITECTURE.md` updated for calendar notification types |

**Post-Phase 1 re-check**: All gates confirmed ✅. Interface contracts and data model comply with all principles.

## Project Structure

### Documentation (this feature)

```text
specs/026-calendar-system/
├── plan.md              ← this file
├── research.md          ← Phase 0 (complete — all unknowns resolved)
├── data-model.md        ← Phase 1 (this run)
├── quickstart.md        ← Phase 1 (this run)
├── contracts/           ← Phase 1 (this run)
│   └── calendar.proto
└── tasks.md             ← Phase 2 (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
backend/
├── internal/
│   └── calendar/
│       ├── constants.go             # Event types, visibility, RSVP, resource types, presence
│       ├── logic.go                 # CalendarLogic interface + logicImpl
│       ├── scheduler_workflow.go    # CalendarReminderWorkflow, CalendarPresenceWorkflow
│       ├── overlay.go               # CollaborationOverlayReader / DocsOverlayReader interfaces
│       ├── booking_logic.go         # Booking link generation + conflict detection
│       ├── scheduling_assistant.go  # Free/busy computation for scheduling assistant
│       └── connect.go               # CalendarServiceConnect (RPC handler layer)
├── database/
│   ├── calendar.query.sql.go        # sqlc-generated (from scripts/queries/calendar.sql)
│   └── scripts/
│       ├── schema.sql               # Updated with calendar.* tables + notification CHECK changes
│       └── queries/
│           └── calendar.sql         # sqlc query definitions
├── k8s/base/database/migrations/
│   ├── 20260320000001_calendar_schema.up.sql
│   ├── 20260320000001_calendar_schema.down.sql
│   ├── 20260320000002_notification_calendar_checks.up.sql
│   └── 20260320000002_notification_calendar_checks.down.sql
├── rpc/
│   └── v1/
│       └── calendar.proto           # CalendarService proto definition
└── integration/
    ├── calendar_event_test.go       # User Stories 1–2 (event CRUD, recurrence)
    ├── calendar_resource_test.go    # User Story 3 (resource booking)
    ├── calendar_team_test.go        # User Story 4 (team/org visibility)
    ├── calendar_overlay_test.go     # User Story 5 (cross-domain overlays)
    ├── calendar_booking_test.go     # User Story 6 (scheduling assistant, booking links)
    ├── calendar_checkin_test.go     # User Story 7 (operational check-in, evidence)
    └── calendar_notification_test.go # User Story 8 (reminders, change notifications)

frontend/
├── apps/web/src/
│   └── features/
│       └── calendar/
│           ├── CalendarPage.tsx
│           ├── EventDetailPanel.tsx
│           ├── EventCreateForm.tsx
│           ├── RecurrenceSelector.tsx
│           ├── AttendeeSelector.tsx
│           ├── SchedulingAssistant.tsx
│           ├── ResourceBookingPanel.tsx
│           ├── OverlayToggleBar.tsx
│           └── BookingLinkModal.tsx
└── packages/
    └── apis/src/
        └── calendar.ts              # API wrapper functions + TypeScript interfaces
```

**Structure Decision**: Web application (backend + frontend). Calendar backend is a new `internal/calendar` package, T4 tier. Frontend is a new `features/calendar` module in the web app. Integration tests in `backend/integration/calendar_*_test.go` following `testWorld` pattern.

## Complexity Tracking

> **No constitution violations — complexity tracking not required.**

Calendar T4 placement is justified in research (U6): Calendar is the first aggregation-layer domain and depends on T3/T2/T1 for overlays. The dependency direction (T4 → T3/T2/T1) is constitutional. Documented in this plan as first T4 domain; SYSTEM-ARCHITECTURE.md updated post-implementation.

## Test Scenarios (Behavioral Contract)

*Required by Constitution §II — presented here for contract review before tasks are created.*

All scenarios as `t.Run` stubs in `backend/integration/calendar_*_test.go`. `t.Skip("TODO")` on all until implementation is approved.

### `calendar_event_test.go`

```go
func TestCalendarPersonalEvent(t *testing.T) {
    // User Story 1 — Personal Calendar with Event Creation
    t.Run("when an employee creates a meeting with attendees", func(t *testing.T) {
        // FR-001, FR-005, FR-006, FR-008
        t.Run("the event appears on all attendees' calendars", func(t *testing.T) { t.Skip("TODO") })
        t.Run("the organizer sees pending RSVP for each attendee", func(t *testing.T) { t.Skip("TODO") })
    })
    t.Run("when an attendee RSVPs to an event", func(t *testing.T) {
        // FR-009, FR-010
        t.Run("accepted status is immediately visible to the organizer", func(t *testing.T) { t.Skip("TODO") })
        t.Run("declined status is immediately visible to the organizer", func(t *testing.T) { t.Skip("TODO") })
        t.Run("tentative status is immediately visible to the organizer", func(t *testing.T) { t.Skip("TODO") })
    })
    t.Run("when creating an event that conflicts with an attendee's existing event", func(t *testing.T) {
        // FR-019
        t.Run("the conflict is indicated without blocking submission", func(t *testing.T) { t.Skip("TODO") })
    })
    t.Run("when an event is cancelled by the organizer", func(t *testing.T) {
        // FR-013, FR-041
        t.Run("all reserved resources are released", func(t *testing.T) { t.Skip("TODO") })
        t.Run("all attendees receive a cancellation notification", func(t *testing.T) { t.Skip("TODO") })
    })
    t.Run("when an event's time is changed", func(t *testing.T) {
        // FR-042
        t.Run("all attendees receive a changed-event notification", func(t *testing.T) { t.Skip("TODO") })
        t.Run("all attendee RSVP statuses are reset to pending", func(t *testing.T) { t.Skip("TODO") })
    })
    t.Run("when an event is marked private", func(t *testing.T) {
        // FR-027, FR-035
        t.Run("other employees see it only as Busy with no details", func(t *testing.T) { t.Skip("TODO") })
    })
}

func TestCalendarRecurringEvent(t *testing.T) {
    // User Story 2 — Recurring Events with Exceptions
    t.Run("when a weekly recurring event is created", func(t *testing.T) {
        // FR-014, FR-017
        t.Run("all instances within the recurrence pattern are queryable", func(t *testing.T) { t.Skip("TODO") })
    })
    t.Run("when a single instance of a recurring series is edited", func(t *testing.T) {
        // FR-015, FR-016
        t.Run("only that instance changes and an exception is recorded", func(t *testing.T) { t.Skip("TODO") })
        t.Run("surrounding instances remain unchanged", func(t *testing.T) { t.Skip("TODO") })
    })
    t.Run("when a single instance is cancelled from a recurring series", func(t *testing.T) {
        // FR-016
        t.Run("that date appears as skipped and future instances remain", func(t *testing.T) { t.Skip("TODO") })
    })
    t.Run("when this-and-following is edited from a mid-series point", func(t *testing.T) {
        // FR-015
        t.Run("a new series fork is created from that point", func(t *testing.T) { t.Skip("TODO") })
        t.Run("earlier instances remain intact", func(t *testing.T) { t.Skip("TODO") })
    })
    t.Run("when a compliance-flagged recurring event (shift) is modified", func(t *testing.T) {
        // FR-018, FR-048
        t.Run("an audit record is created with actor and diff", func(t *testing.T) { t.Skip("TODO") })
    })
}
```

### `calendar_resource_test.go`

```go
func TestCalendarResourceBooking(t *testing.T) {
    // User Story 3 — Resource Booking with Conflict Prevention
    t.Run("when a resource is booked for an event", func(t *testing.T) {
        // FR-011
        t.Run("the resource shows as unavailable for that time window", func(t *testing.T) { t.Skip("TODO") })
    })
    t.Run("when two concurrent requests attempt to book the same resource at the same time", func(t *testing.T) {
        // FR-012, SC-005
        t.Run("exactly one booking succeeds and the other is rejected with a conflict", func(t *testing.T) { t.Skip("TODO") })
    })
    t.Run("when an event with resources is cancelled", func(t *testing.T) {
        // FR-013
        t.Run("all booked resources are automatically released", func(t *testing.T) { t.Skip("TODO") })
    })
    t.Run("when an employee without resource booking permission attempts to book a restricted resource", func(t *testing.T) {
        // FR-038
        t.Run("the booking is rejected with a permission error", func(t *testing.T) { t.Skip("TODO") })
    })
}
```

### `calendar_team_test.go`

```go
func TestCalendarTeamAndOrgVisibility(t *testing.T) {
    // User Story 4 — Team and Org-Wide Calendar Overlays
    t.Run("when a department head views the department calendar", func(t *testing.T) {
        // FR-023, FR-027
        t.Run("private events from team members show only as Busy", func(t *testing.T) { t.Skip("TODO") })
        t.Run("non-private events show full details", func(t *testing.T) { t.Skip("TODO") })
    })
    t.Run("when an org-wide company event is created", func(t *testing.T) {
        // FR-025
        t.Run("every employee can see it without individually accepting", func(t *testing.T) { t.Skip("TODO") })
    })
    t.Run("when a delegated calendar manager creates an event on behalf of another user", func(t *testing.T) {
        // FR-036, FR-037
        t.Run("the event is attributed to the delegating user", func(t *testing.T) { t.Skip("TODO") })
        t.Run("the delegate identity is recorded in the audit trail", func(t *testing.T) { t.Skip("TODO") })
    })
}
```

### `calendar_overlay_test.go`

```go
func TestCalendarCrossDomainOverlays(t *testing.T) {
    // User Story 5 — Cross-Domain Overlays
    t.Run("when a task with a due date is queried in the calendar range", func(t *testing.T) {
        // FR-028
        t.Run("it appears as a read-only overlay item on the correct day", func(t *testing.T) { t.Skip("TODO") })
    })
    t.Run("when a ritual instance is scheduled for the week", func(t *testing.T) {
        // FR-029
        t.Run("it appears as an overlay item distinct from calendar events", func(t *testing.T) { t.Skip("TODO") })
    })
    t.Run("when a document review deadline is queried in the calendar range", func(t *testing.T) {
        // FR-030
        t.Run("it appears as a read-only overlay item", func(t *testing.T) { t.Skip("TODO") })
    })
}
```

### `calendar_booking_test.go`

```go
func TestCalendarSchedulingAssistant(t *testing.T) {
    // User Story 6 — Availability Scheduling
    t.Run("when the scheduling assistant is called for four attendees", func(t *testing.T) {
        // FR-020, SC-002
        t.Run("it returns a merged free/busy view and available slot list", func(t *testing.T) { t.Skip("TODO") })
        t.Run("suggested slots fall within all attendees' working hours", func(t *testing.T) { t.Skip("TODO") })
        t.Run("no suggested slot overlaps an existing event for any attendee", func(t *testing.T) { t.Skip("TODO") })
    })
    t.Run("when a booking link is generated", func(t *testing.T) {
        // FR-021
        t.Run("it shows only the organizer's free slots to the recipient", func(t *testing.T) { t.Skip("TODO") })
    })
    t.Run("when two recipients simultaneously claim the same booking link slot", func(t *testing.T) {
        // FR-022, SC-005
        t.Run("exactly one claim succeeds and the other is notified the slot is taken", func(t *testing.T) { t.Skip("TODO") })
    })
}
```

### `calendar_checkin_test.go`

```go
func TestCalendarOperationalCheckIn(t *testing.T) {
    // User Story 7 — Operational Event Check-In and Evidence
    t.Run("when an attendee checks in to an operational event at or after start time", func(t *testing.T) {
        // FR-045
        t.Run("a check-in record is created with timestamp and identity", func(t *testing.T) { t.Skip("TODO") })
    })
    t.Run("when evidence is attached to a checked-in event", func(t *testing.T) {
        // FR-046
        t.Run("the file is linked to the event and visible to supervisors", func(t *testing.T) { t.Skip("TODO") })
    })
    t.Run("when an operational event end time passes without check-in", func(t *testing.T) {
        // FR-047
        t.Run("the event is flagged as unacknowledged", func(t *testing.T) { t.Skip("TODO") })
    })
    t.Run("when a compliance supervisor views an operational event", func(t *testing.T) {
        // FR-048, SC-006
        t.Run("the full audit trail is returned with actor and timestamp for each action", func(t *testing.T) { t.Skip("TODO") })
    })
    t.Run("when a check-in is submitted after the event end time", func(t *testing.T) {
        // FR-045, edge case
        t.Run("it is accepted as a late check-in and flagged in the audit record", func(t *testing.T) { t.Skip("TODO") })
    })
}
```

### `calendar_notification_test.go`

```go
func TestCalendarNotificationsAndReminders(t *testing.T) {
    // User Story 8 — Notification and Reminders
    t.Run("when a reminder threshold is reached before an event", func(t *testing.T) {
        // FR-039, SC-004
        t.Run("the attendee receives a reminder notification via the notification hub", func(t *testing.T) { t.Skip("TODO") })
    })
    t.Run("when an event with in_meeting presence status begins", func(t *testing.T) {
        // FR-032
        t.Run("the attendee presence status changes to in_meeting", func(t *testing.T) { t.Skip("TODO") })
    })
    t.Run("when the in_meeting event ends", func(t *testing.T) {
        // FR-033, FR-034
        t.Run("presence reverts to the prior manual status", func(t *testing.T) { t.Skip("TODO") })
    })
    t.Run("when calendar event notifications are enabled in digest mode", func(t *testing.T) {
        // FR-043
        t.Run("multiple low-priority changes produce a single batched notification", func(t *testing.T) { t.Skip("TODO") })
    })
}
```

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
