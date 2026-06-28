# Tasks: Calendar System

**Feature**: `026-calendar-system`  
**Input**: Design documents from `/specs/026-calendar-system/`  
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

---

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no shared dependencies)
- **[Story]**: Which user story this task belongs to (US1–US8)

---

## Phase 1: Setup (Schema & Migrations)

**Purpose**: Database schema and migrations that everything else depends on.

- [X] T001 Update `backend/database/scripts/schema.sql` with all `calendar.*` tables (event, recurrence_exception, attendee, resource, resource_acl, resource_booking, working_hours, delegation, check_in, audit_entry, booking_link, event_reminder) from data-model.md
- [X] T002 [P] Create migration `backend/k8s/base/database/migrations/20260320000001_calendar_schema.up.sql` with all 12 `calendar.*` DDL statements
- [X] T003 [P] Create migration `backend/k8s/base/database/migrations/20260320000001_calendar_schema.down.sql` (drop all calendar.* tables in reverse dependency order)
- [X] T004 [P] Create migration `backend/k8s/base/database/migrations/20260320000002_notification_calendar_checks.up.sql` with 5 ALTER TABLE statements extending CHECK constraints on notification.notification (source_domain, notification_type, policy_key), notification.resource_subscription (resource_domain), and notification.active_connection (presence_status)
- [X] T005 [P] Create migration `backend/k8s/base/database/migrations/20260320000002_notification_calendar_checks.down.sql` (revert CHECK constraint extensions)
- [X] T006 Apply migrations: `cd backend && ./scripts/migrate.sh`

**Checkpoint**: All `calendar.*` tables exist in the local DB; `notification.*` constraints accept calendar values.

---

## Phase 2: Foundational (Code Generation & Constants)

**Purpose**: Generated code and constants that ALL user story implementations require.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T007 Create `backend/database/scripts/queries/calendar.sql` with all sqlc query definitions: InsertEvent, GetEvent, ListEventsForEmployee, ListEventsForOrg, CancelEvent, InsertAttendee, ListAttendees, UpdateAttendeeRSVP, ResetAttendeesRSVP, InsertRecurrenceException, ListRecurrenceExceptions, InsertResourceBooking, DetectResourceConflict, DeleteResourceBookingsForEvent, UpsertWorkingHours, ListWorkingHours, InsertCheckIn, UpdateCheckInEvidence, ListCheckIns, InsertAuditEntry, ListAuditEntries, InsertBookingLink, GetBookingLinkByToken, ClaimBookingLink, InsertDelegation, GetDelegation, DeleteDelegation, ListDelegationsByDelegate, InsertResource, GetResource, ListResources, UpdateResource, UpsertResourceACL, ListResourceACLEntries, InsertEventReminder, UpdateEventReminderStatus, ListPendingEventReminders
- [X] T008 Run `cd backend && sqlc generate` and commit generated `backend/database/calendar.query.sql.go` (and updated `backend/database/models.go`)
- [X] T009 Copy `specs/026-calendar-system/contracts/calendar.proto` to `backend/rpc/v1/calendar.proto`
- [X] T010 Run `cd backend && buf generate` and commit generated `backend/rpc/v1/calendar.pb.go` and `backend/rpc/v1/rpcv1connect/calendar.connect.go`
- [X] T011 Create `backend/internal/calendar/constants.go` with: EventType* constants (8 event types), Visibility* constants (4 types), RSVPStatus* constants (4 values), ResourceType* constants (5 types), ExceptionType* constants (3 values), ChangeScope* constants (3 values), AuditActionType* constants (8 types), PresenceStatusInMeeting, BookingLinkStatus* constants (3 values), SourceDomainCalendar, NotificationType* constants (6 calendar notification types), PolicyKey* constants (6 calendar policy keys)
- [X] T012 [P] Update `backend/internal/notification/constants.go` — add `PresenceStatusInMeeting = "in_meeting"` and all 6 calendar NotificationType and PolicyKey constants
- [X] T013 [P] Update `backend/internal/files/constants.go` — add `UploadContextCalendar = "calendar"` to the `ValidUploadContexts()` allowed list

**Checkpoint**: `buf generate` and `sqlc generate` succeed; constants compile; no user story code yet.

---

## Phase 3: User Story 1 — Personal Calendar with Event Creation (Priority: P1) 🎯 MVP

**Goal**: An employee can create a meeting with attendees; attendees see and RSVP to the invitation; organizer sees RSVP statuses in real time.

**Independent Test**: A single user creates a meeting with two other users — both users see the invitation, both RSVP (one accept, one decline), and the creator sees updated RSVP statuses — no other calendar feature required.

- [X] T014 Create `backend/integration/calendar_event_test.go` with `TestCalendarPersonalEvent` and `TestCalendarRSVP` test containers; add `t.Skip("TODO")` stubs for all US1 acceptance scenarios from spec.md
- [X] T015 Create `backend/internal/calendar/logic.go` with `Logic` interface (full calendar API surface) and `logicImpl` struct; `NewLogic(queries, notificationLogic, presenceLogic, fileLogic, collaborationReader, docsReader)` constructor
- [X] T016 Create `backend/internal/calendar/event_logic.go` with: CreateEvent (insert event + organizer attendee row with role=organizer/rsvp_status=accepted), GetEvent (with visibility check), ListEvents (time range, cancelled_at IS NULL, include recurrence expansion for range), UpdateEvent (update event, reset attendee RSVPs to 'pending' when start_time/end_time/location changes), CancelEvent (set cancelled_at+cancelled_by_id)
- [X] T017 [P] [US1] Create `backend/internal/calendar/attendee_logic.go` with: AddAttendees (bulk insert required+optional attendees with rsvp_status=pending), RespondToInvite (update rsvp_status, response_time, response_note), ListAttendees (by org+event_id)
- [X] T018 [US1] Create `backend/internal/calendar/connect.go` with `CalendarServiceServer` struct and handlers for: CreateEvent, GetEvent, ListEvents, UpdateEvent, CancelEvent, RespondToInvite, ListEventAttendees (auth context extraction, txn.WithTxn, logic calls, proto mapping, error translation)
- [X] T019 [US1] Register `CalendarServiceServer` in `backend/cmd/server.go`: construct `calendarLogic` with all dependencies, call `mux.Handle(rpcv1connect.CalendarServiceHandler(calendarServer, connectOpts...))`
- [X] T020 [P] [US1] Create `frontend/packages/apis/src/calendar.ts` with TypeScript interfaces `CalendarEvent`, `EventAttendee` and wrapper functions: `createEvent`, `getEvent`, `listEvents`, `updateEvent`, `cancelEvent`, `respondToInvite`, `listEventAttendees`
- [X] T021 [US1] Create `frontend/apps/web/src/app/workspace/calendar/page.tsx` — main calendar page with day/week/month/agenda view switcher, `listEvents` query for visible time range, event grid rendering (mobile-first layout, `data-testid="calendar-page"`)
- [X] T022 [US1] Create `frontend/apps/web/src/app/workspace/calendar/components/EventCreateForm.tsx` — form fields: title, description, event_type, visibility, start/end datetime, all_day toggle, location_text, virtual_link; calls `createEvent` (`data-testid="event-create-form"`)
- [X] T023 [P] [US1] Create `frontend/apps/web/src/app/workspace/calendar/components/AttendeeSelector.tsx` — employee search typeahead with RSVP status chips (`data-testid="attendee-selector"`)
- [X] T024 [US1] Create `frontend/apps/web/src/app/workspace/calendar/components/EventDetailPanel.tsx` — displays event details, attendees with RSVP status, RSVP buttons, cancel for organizer (`data-testid="event-detail-panel"`)
- [X] T025 [US1] Update `backend/integration/calendar_event_test.go` — rewrote corrupted file with proper `testWorld` pattern (calCreateEvent, calRespondToInvite helpers; TestCalendarPersonalEvent: create/get/list/update/cancel; TestCalendarRSVP: add attendees, accept/decline, RSVP reset on time change)

**Checkpoint**: Employee creates meeting, attendees see it, RSVP works, organizer sees statuses. US1 independently testable.

---

## Phase 4: User Story 2 — Recurring Events with Exceptions (Priority: P2)

**Goal**: Create recurring events (RFC 5545 RRULE), move one instance without affecting the series, skip instances, and edit this-and-following.

**Independent Test**: Create a weekly recurring event (5 occurrences), move the 3rd instance to a different time — verify the series displays correctly with the exception, and the 4th/5th instances are unaffected.

- [X] T026 Create `backend/integration/calendar_recurrence_test.go` with `TestRecurringEvents` stubs for all US2 acceptance scenarios (create recurring, edit single instance, cancel instance, edit this-and-following, audit for shift recurring)
- [X] T027 [P] [US2] Create `backend/internal/calendar/recurrence.go` with: `expandInstances(rule string, dtstart time.Time, from, to time.Time) ([]time.Time, error)` using `github.com/teambition/rrule-go`; `applyExceptions(instances []time.Time, exceptions []database.RecurrenceException) []time.Time` (filter skipped, replaced modified); `computeRecurrenceEnd(rule string, dtstart time.Time) *time.Time` (parses UNTIL/COUNT for DB column)
- [X] T028 [US2] Add `EditEventSeries(ctx, tx, orgID, actorID, eventID, instanceStart, scope, params)` to `backend/internal/calendar/event_logic.go`: scope=this_instance → insert recurrence_exception(modified) + create new exception event; scope=this_and_following → insert recurrence_exception for all following + fork new series head event; scope=all → update head event record; all branches write audit_entry for shift/maintenance_window types
- [X] T029 [US2] Add `EditEventSeries` handler to `backend/internal/calendar/connect.go`
- [X] T030 [P] [US2] Create `frontend/apps/web/src/features/calendar/RecurrenceSelector.tsx` — RRULE builder UI: frequency dropdown (daily/weekly/biweekly/monthly/annually), interval, days-of-week checkboxes, end condition (never/until date/count); outputs RFC 5545 RRULE string (`data-testid="recurrence-selector"`)
- [X] T031 [US2] Wire `RecurrenceSelector` into `EventCreateForm.tsx` (add recurrence section); add edit scope modal to `EventDetailPanel.tsx` ("Edit this / this and following / all") that calls `EditEventSeries`
- [X] T032 [US2] Update `backend/integration/calendar_recurrence_test.go` — implement all US2 test scenarios

**Checkpoint**: Recurring events expand correctly; exceptions display; series fork works. US2 independently testable.

---

## Phase 5: User Story 3 — Resource Booking with Conflict Prevention (Priority: P3)

**Goal**: Book meeting rooms/equipment with conflict detection; double-booking prevented via `SELECT FOR UPDATE`.

**Independent Test**: Two concurrent requests to book the same meeting room at the same time — exactly one succeeds, one returns a conflict error; resource availability query shows room as busy.

- [X] T033 Create `backend/integration/calendar_resource_test.go` with `TestResourceBooking` stubs for all US3 acceptance scenarios (conflict prevention, auto-release on cancel, ACL enforcement)
- [X] T034 [P] [US3] Create `backend/internal/calendar/resource_logic.go` with: ListResources (filter by type, capacity, availability window via booking query), CreateResource, UpdateResource, SetResourceACL (replace all ACL entries for resource), CheckResourceACL (returns true if employee or their department has can_book=true, or no ACL rows exist), CreateResourceBooking (SELECT FOR UPDATE on resource_booking rows in time range → conflict → CodeAlreadyExists; else INSERT), DeleteBookingsForEvent (called by CancelEvent)
- [X] T035 [US3] Add resource handlers to `backend/internal/calendar/connect.go`: ListResources, CreateResource (ROLE_ADMIN/OWNER/OPERATOR only), UpdateResource, SetResourceACL (ROLE_ADMIN/OWNER only), CheckResourceAvailability
- [X] T036 [US3] Update CreateEvent in `backend/internal/calendar/event_logic.go` — after inserting event, call `CreateResourceBooking` for each requested resource_id; on conflict error, roll back the whole transaction and return `CodeAlreadyExists` with `PreconditionFailure` detail; update CancelEvent to call `DeleteBookingsForEvent`
- [X] T037 [P] [US3] Create `frontend/apps/web/src/features/calendar/ResourceBookingPanel.tsx` — resource browser with filter controls (type, capacity, date range), available/busy indicator per resource, add/remove from event (`data-testid="resource-booking-panel"`)
- [X] T038 [US3] Add resource section to `EventCreateForm.tsx` — wire `ResourceBookingPanel`, display conflict error from API; add `frontend/packages/apis/src/calendar.ts` wrapper functions: `listResources`, `createResource`, `updateResource`, `setResourceACL`, `checkResourceAvailability`
- [X] T039 [US3] Update `backend/integration/calendar_resource_test.go` — implement all US3 test scenarios

**Checkpoint**: Rooms can be booked; double-booking blocked; cancellation releases resources. US3 independently testable.

---

## Phase 6: User Story 4 — Team and Org-Wide Calendar Overlays (Priority: P4)

**Goal**: Department calendar showing team coverage; private events visible as "Busy" only; delegation for acting on behalf.

**Independent Test**: A department head views team calendar — team member's private event shows as "Busy" with no title/attendees visible; org-wide events appear without individual acceptance; delegated event shows correct attribution.

- [X] T040 Create `backend/integration/calendar_team_test.go` with `TestTeamCalendarVisibility` and `TestDelegation` stubs for all US4 acceptance scenarios
- [X] T041 [P] [US4] Add private-event redaction to ListEvents in `backend/internal/calendar/event_logic.go`: `visibility='private'` and `organizer_id != callerID` → return redacted stub (`Title="Busy"`, zero-out description/location/attendees); `visibility='personal_shared'` and caller is not organizer → return free/busy stub (time only)
- [X] T042 [P] [US4] Create `backend/internal/calendar/delegation_logic.go` with: GrantDelegation (insert calendar.delegation, validate no self-delegation), ListDelegations (by delegate_id + owner_id), RevokeDelegation (delete), VerifyDelegation (check active + not expired)
- [X] T043 [US4] Add delegation handlers to `backend/internal/calendar/connect.go`: GrantDelegation, ListDelegations, RevokeDelegation; update CreateEvent/UpdateEvent/CancelEvent handlers to accept `organizer_override_id` — call `VerifyDelegation` then write audit_entry with `delegate_id`
- [X] T044 [P] [US4] Add `listDelegations`, `grantDelegation`, `revokeDelegation` to `frontend/packages/apis/src/calendar.ts`
- [X] T045 [US4] Create `frontend/apps/web/src/features/calendar/TeamCalendarView.tsx` — department overlay grid showing all employees' events (privacy-respecting), overlay toggles for department vs org-wide; delegation badge ("Acting as [Name]") on events created via delegation (`data-testid="team-calendar-view"`)
- [X] T046 [US4] Update `backend/integration/calendar_team_test.go` — implement all US4 test scenarios

**Checkpoint**: Privacy scoping correct; delegation attribution in events; team calendar displays. US4 independently testable.

---

## Phase 7: User Story 5 — Cross-Domain Overlays: Tasks, Rituals, Docs (Priority: P5)

**Goal**: Calendar week view shows task due dates, ritual instances, and doc deadlines layered over regular events.

**Independent Test**: User with one upcoming task due date, one ritual instance, and one meeting with an attached doc can open their calendar and see all three appear distinctly, each linking to its source record.

- [X] T047 Create `backend/integration/calendar_overlay_test.go` with `TestCrossDomainOverlays` stubs for all US5 acceptance scenarios
- [X] T048 [P] [US5] Create `backend/internal/calendar/overlay.go` with: `CollaborationOverlayReader` interface (`GetTasksDueInRange`, `GetRitualInstancesInRange`), `DocsOverlayReader` interface (`GetDocDeadlinesInRange`), `OverlayItem` struct, `ListOverlayItems(ctx, tx, orgID, actorID, from, to, opts)` — calls both readers, merges results, sorts by due_at
- [X] T049 [P] [US5] Implement `CollaborationOverlayReader` on `collaboration.Logic` in `backend/internal/collaboration/overlay_reader.go` (`GetTasksDueInRange` queries collaboration.task where due_date between from/to; `GetRitualInstancesInRange` queries ritual instances)
- [X] T050 [P] [US5] Implement `DocsOverlayReader` on `docs.Logic` in `backend/internal/docs/overlay_reader.go` (`GetDocDeadlinesInRange` queries docs with deadline between from/to)
- [X] T051 [US5] Inject `CollaborationOverlayReader` and `DocsOverlayReader` into `CalendarLogic` at `backend/cmd/server.go` (pass `collaborationLogic` and `docsLogic` — they implement the interfaces)
- [X] T052 [US5] Add `ListOverlayItems` handler to `backend/internal/calendar/connect.go`; add `listOverlayItems` to `frontend/packages/apis/src/calendar.ts`
- [X] T053 [US5] Create `frontend/apps/web/src/features/calendar/OverlayToggleBar.tsx` — toggle controls for Tasks, Rituals, Doc deadlines, Project milestones overlays; persists toggle state in local storage (`data-testid="overlay-toggle-bar"`)
- [X] T054 [US5] Wire overlay items into `CalendarPage.tsx` — when overlay toggles are enabled, call `listOverlayItems` and render as visually distinct items on the grid (different color/icon per source_domain; clicking navigates to `url_path`)
- [X] T055 [US5] Update `backend/integration/calendar_overlay_test.go` — implement all US5 test scenarios

**Checkpoint**: Task due dates, ritual instances, doc deadlines visible on calendar; links to source records work. US5 independently testable.

---

## Phase 8: User Story 6 — Availability Scheduling and Booking Links (Priority: P6)

**Goal**: Find conflict-free slots for a group of attendees based on working hours; generate booking links for self-service scheduling.

**Independent Test**: Select three internal users and use the scheduling assistant to find the next available 30-minute window within all their working hours with no conflicts — the suggested slot is genuinely conflict-free for all parties.

- [X] T056 Create `backend/integration/calendar_booking_test.go` with `TestSchedulingAssistant` and `TestBookingLinks` stubs for all US6 acceptance scenarios
- [X] T057 [P] [US6] Create `backend/internal/calendar/working_hours_logic.go` with: GetWorkingHours (query calendar.working_hours by org+employee_id), SetWorkingHours (upsert 7 rows by day_of_week — one per ISO day — via UpsertWorkingHours query)
- [X] T058 [P] [US6] Create `backend/internal/calendar/scheduling_assistant.go` with: GetFreeBusy (for each employee_id, query calendar.attendee JOIN calendar.event for accepted events in time range, return busy slots); SuggestSlots (brute-force scan: iterate 15-minute windows across search_from→search_until within all attendees' working hours and timezone offsets, skip windows with any attendee conflict, return first `max_suggestions` free windows)
- [X] T059 [P] [US6] Create `backend/internal/calendar/booking_link_logic.go` with: CreateBookingLink (generate `crypto/rand` 32-byte base64url token, insert calendar.booking_link); GetBookingLinkByToken (lookup by token, expand available slots by computing free windows within available_windows config minus existing bookings); ClaimBookingLink (SELECT FOR UPDATE on booking_link row, check status=active, create meeting event, set status=claimed + claimed_event_id + claimed_by_id + claimed_at)
- [X] T060 [US6] Add GetWorkingHours, SetWorkingHours, GetFreeBusy, SuggestSlots, CreateBookingLink, GetBookingLinkByToken, ClaimBookingSlot handlers to `backend/internal/calendar/connect.go`; add corresponding wrapper functions to `frontend/packages/apis/src/calendar.ts`
- [X] T061 [US6] Create `frontend/apps/web/src/features/calendar/SchedulingAssistant.tsx` — attendee selector (reuse AttendeeSelector), free/busy grid view showing merged availability, suggest slots button, slot list with confirm action (`data-testid="scheduling-assistant"`)
- [X] T062 [US6] Create `frontend/apps/web/src/features/calendar/BookingLinkModal.tsx` — configure available windows (day+time), duration, date range; generate link; copy-to-clipboard; show claimed status (`data-testid="booking-link-modal"`)
- [X] T063 [US6] Create `frontend/apps/web/src/app/workspace/calendar/booking/[token]/page.tsx` — booking link recipient page: show available slots for the token, allow picking a slot, call `claimBookingSlot`, show confirmation
- [X] T064 [US6] Update `backend/integration/calendar_booking_test.go` — implement all US6 test scenarios

**Checkpoint**: Free/busy visible for all attendees; slot suggestions are genuinely conflict-free; booking link can be created and claimed (race condition handled). US6 independently testable.

---

## Phase 9: User Story 7 — Operational Event Check-In and Evidence (Priority: P7)

**Goal**: Field technicians check in to compliance events on mobile; attach evidence; supervisors see full audit trail.

**Independent Test**: Technician checks in to a shift event on mobile, attaches a file — supervisor account sees the check-in timestamp, evidence file, and full audit trail for that event.

- [X] T065 Create `backend/integration/calendar_checkin_test.go` with `TestOperationalCheckIn` stubs for all US7 acceptance scenarios (check-in at start time, evidence attach, late check-in flag, missed check-in notification, supervisor audit view)
- [X] T066 [P] [US7] Create `backend/internal/calendar/compliance_logic.go` with: CheckInToEvent (validate event.start_time has passed; insert calendar.check_in with is_late flag based on event.end_time; call WriteAuditEntry with action=checked_in); SubmitCheckInEvidence (update check_in.evidence_file_ids UUID array, update submitted_at; call WriteAuditEntry with action=evidence_submitted); ListAuditEntries (cursor-paginated query on calendar.audit_entry by org+event_id, ordered by occurred_at DESC); WriteAuditEntry (INSERT only — never UPDATE/DELETE — captures diff_snapshot JSONB)
- [X] T067 [US7] Add CheckInToEvent, SubmitCheckInEvidence, ListAuditEntries handlers to `backend/internal/calendar/connect.go`; add `checkInToEvent`, `submitCheckInEvidence`, `listAuditEntries` to `frontend/packages/apis/src/calendar.ts`
- [X] T068 [US7] Create `frontend/apps/web/src/features/calendar/CheckInPanel.tsx` — mobile-first: large prominent "Check In" CTA button, file attachment for evidence (camera/file picker), audit history list (for supervisor role); shows for events with `requires_check_in=true` (`data-testid="check-in-panel"`)
- [X] T069 [US7] Wire `CheckInPanel` into `EventDetailPanel.tsx` — display for shift/maintenance_window event types; show audit trail section to ROLE_ADMIN/ROLE_OWNER/ROLE_OPERATOR
- [X] T070 [US7] Update `backend/integration/calendar_checkin_test.go` — implement all US7 test scenarios

**Checkpoint**: Technicians check in and attach evidence; audit trail is immutable and visible to supervisors. US7 independently testable.

---

## Phase 10: User Story 8 — Notification and Reminders (Priority: P8)

**Goal**: Attendees receive reminder notifications before meetings; change and cancellation notifications sent; in_meeting presence set at event boundaries.

**Independent Test**: Create meeting with 10-minute reminder setting — reminder notification arrives near the threshold; modify event time — invited attendee receives change notification with new time.

- [X] T071 Create `backend/integration/calendar_notification_test.go` with `TestCalendarNotifications` stubs for all US8 acceptance scenarios (reminder delivery, cancellation notification, change notification + RSVP reset, in_meeting presence)
- [X] T072 [P] [US8] Create `backend/internal/calendar/reminder_workflow.go` — `CalendarReminderWorkflow` implementing `flows.Workflow`: `Name()` returns `"CalendarReminderWorkflow"`; `Run()` queries `calendar.event_reminder` rows where `status='pending' AND fire_at <= now()` (batch up to 100), for each row publishes reminder notification via `NotificationLogic.PublishNotification`, marks row `status='sent'`; no in-process state; safe to re-run on crash
- [X] T073 [P] [US8] Create `backend/internal/calendar/presence_workflow.go` — `CalendarPresenceWorkflow` implementing `flows.Workflow`: `Name()` returns `"CalendarPresenceWorkflow"`; `Run()` (a) queries events starting in next 1-minute window, sets presence=in_meeting for all accepted attendees; (b) queries events ended in last 1-minute window, reverts presence to 'online' for attendees not in another active meeting within next 0 minutes
- [X] T074 [US8] Add reminder scheduling to `backend/internal/calendar/event_logic.go`: after successful CreateEvent (for each attendee), insert `calendar.event_reminder` rows (fire_at = start_time - 15 minutes default); on CancelEvent, update reminder status='cancelled' for all attendees of that event; on UpdateEvent with time change, delete+reinsert event_reminder rows with new fire_at
- [X] T075 [US8] Add notification publishing to `backend/internal/calendar/event_logic.go`: on CreateEvent → publish `calendar_event_invite` notification to each attendee via NotificationLogic; on CancelEvent → publish `calendar_event_cancel` to all attendees; on UpdateEvent with time/location change → publish `calendar_event_change` to all non-organizer attendees
- [X] T076 [US8] Register `CalendarReminderWorkflow` and `CalendarPresenceWorkflow` in `backend/cmd/server.go` (call `flows.Register(flowsRegistry, &calendar.CalendarReminderWorkflow{...})` and `flows.Register(flowsRegistry, &calendar.CalendarPresenceWorkflow{...})`)
- [X] T077 [US8] Update `backend/integration/calendar_notification_test.go` — implement all US8 test scenarios

**Checkpoint**: Reminders fire at configured threshold; cancellation/change notifications delivered; presence status set in_meeting during meetings. US8 independently testable.

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: Search, architecture documentation, final validation.

- [X] T078 [P] Add `SearchEvents(ctx, tx, orgID, actorID, query string, filters, cursor, limit)` to `backend/internal/calendar/event_logic.go` — full-text search on `title || ' ' || coalesce(description, '')` using `to_tsvector` / `websearch_to_tsquery`; apply filters (event_type, resource_id, attendee_id, date range); cursor-paginated
- [X] T079 [P] Add `SearchEvents` handler to `backend/internal/calendar/connect.go`; add `searchEvents` to `frontend/packages/apis/src/calendar.ts`
- [X] T080 [P] Update `backend/docs/SYSTEM-ARCHITECTURE.md` — add Calendar as T4 Aggregation Layer domain; describe `CollaborationOverlayReader` and `DocsOverlayReader` interfaces; note this is first T4 domain in the system
- [X] T081 [P] Update `backend/docs/NOTIFICATION-SYSTEM-ARCHITECTURE.md` — document calendar notification types (6 types), reminder workflow polling pattern, `CalendarPresenceWorkflow` in_meeting signals

---

## Dependencies (Story Completion Order)

```
Phase 1 (Schema) → Phase 2 (Code Gen) → Phase 3 (US1) → Phase 4 (US2)
                                       → Phase 5 (US3)
                                       → Phase 6 (US4) [US1 required for event model]
                                       → Phase 7 (US5) [US1 required for event display]
                                       → Phase 8 (US6) [US1 required for event creation from slots]
                                       → Phase 9 (US7) [US1 required for event records]
                                       → Phase 10 (US8) [US1 required for event + attendee data]
Phase 3 (US1) required before: US2, US4, US5, US6, US7, US8
US4 (delegation): requires US1 event model; no other story dependency
US5 (overlays): requires US1 for CalendarPage; independent from US2–US4
US6 (scheduling): requires US1 for event creation from confirmed slots
Phases 4–10 [US2–US8] can begin in parallel once Phase 3 is complete
Phase 11 (Polish): can begin as soon as Phase 3+ connect layer is stable
```

---

## Parallel Execution Examples

**After Phase 2 (once buf/sqlc generated + constants done)**:
- T014 (US1 test stubs), T015 (logic.go interface) — in parallel

**Within Phase 3 (US1)**:
- T017 (attendee_logic.go) + T020 (api wrapper) + T023 (AttendeeSelector) — in parallel

**After Phase 3 complete**:
- Phase 4 (US2), Phase 5 (US3), Phase 6 (US4), Phase 7 (US5), Phase 8 (US6), Phase 9 (US7), Phase 10 (US8) — **all can run in parallel** (different files, no inter-story dependencies)

**Within Phase 10 (US8)**:
- T072 (reminder_workflow.go) + T073 (presence_workflow.go) — in parallel (different files)

**Phase 11**:
- T078 (SearchEvents logic) + T079 (handler) + T080 (SYSTEM-ARCHITECTURE.md) + T081 (NOTIFICATION docs) — all in parallel

---

## Implementation Strategy

**MVP Scope** (Phase 1–3, US1 only): A working personal calendar where an employee can create a meeting, invite attendees, and attendees can RSVP. This is independently deployable and covers the core event lifecycle. Estimated: 14 tasks.

**Increment 2** (add US2): Recurring events — high business value, required for standups and shifts. 6 tasks.

**Increment 3** (add US3): Resource booking — operational differentiation. 7 tasks.

**Increment 4** (US4–US5): Team visibility and cross-domain overlays — the unique value of this platform calendar. 14 tasks.

**Increment 5** (US6–US8): Scheduling assistant, compliance check-in, notifications — production readiness. 22 tasks.

---

## Summary

| Phase | User Story | Tasks | Parallelizable |
|-------|-----------|-------|----------------|
| 1 — Setup | Schema/migrations | T001–T006 (6) | T002–T005 in parallel |
| 2 — Foundation | Code gen + constants | T007–T013 (7) | T009–T010 sequential; T012–T013 parallel |
| 3 — US1 (P1) 🎯 | Personal calendar & RSVP | T014–T025 (12) | T017, T020, T023 parallel |
| 4 — US2 (P2) | Recurring events | T026–T032 (7) | T027, T030 parallel |
| 5 — US3 (P3) | Resource booking | T033–T039 (7) | T034, T037 parallel |
| 6 — US4 (P4) | Team overlays & delegation | T040–T046 (7) | T041, T042, T044 parallel |
| 7 — US5 (P5) | Cross-domain overlays | T047–T055 (9) | T048, T049, T050, T053 parallel |
| 8 — US6 (P6) | Scheduling & booking links | T056–T064 (9) | T057, T058, T059 parallel |
| 9 — US7 (P7) | Check-in & compliance | T065–T070 (6) | T066 parallel |
| 10 — US8 (P8) | Notifications & reminders | T071–T077 (7) | T072, T073 parallel |
| 11 — Polish | Search & docs | T078–T081 (4) | all parallel |
| **Total** | | **81 tasks** | **~25 parallelizable** |
