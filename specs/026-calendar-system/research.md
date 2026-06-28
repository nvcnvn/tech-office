# Research: Calendar System — Resolved Unknowns

**Phase**: 0 — Research  
**Spec**: `specs/026-calendar-system/spec.md`  
**Date**: 2026-03-20  
**Status**: All NEEDS CLARIFICATION resolved

---

## 1. Recurrence Engine

**Decision**: Adopt `github.com/teambition/rrule-go` (RFC 5545 iCal RRULE) and store recurrence rules as RRULE strings in a `TEXT` column.

**Rationale**: The spec explicitly defers external calendar sync (Google Calendar, Microsoft 365) to a future version — it is a known planned requirement, not pure YAGNI. Migrating from a custom JSON format to RRULE later would require a multi-step data migration of every event record. At pre-implementation, the switching cost is zero. `teambition/rrule-go` handles DST-aware expansion, leap-year edge cases, and all RFC 5545 patterns (BYDAY, BYMONTHDAY, BYSETPOS, COUNT, UNTIL) that a hand-rolled engine would have to re-solve. Storing rules as standard RRULE strings also allows direct ingestion from an eventual Google/Outlook sync layer without a parsing step.

**Protocol**: Store the RRULE string in `calendar.event.recurrence_rule TEXT` (e.g., `FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR;UNTIL=20261231T000000Z`). Parse/expand using `teambition/rrule-go` in the logic layer. The collaboration ritual system keeps its existing custom JSON approach — there is no external sync requirement for rituals.

**Alternatives considered**:
- Custom JSON recurrence struct (existing collaboration pattern): Rejected — forward-incompatible with the anticipated future calendar sync requirement; non-standard format forces a schema migration and translation layer when sync is added.
- Store RRULE as JSONB: Rejected — RRULE is a flat string; forcing it into JSONB adds parsing complexity with no query benefit.

---

## 2. Background Job / Reminder Scheduling

**Decision**: Use the existing `github.com/nvcnvn/flows` workflow engine. Register a `CalendarReminderWorkflow` at server startup, and a `CalendarPresenceWorkflow` for in-meeting presence signals.

**Rationale**: `flows` is already used for `collaboration.RitualSchedulerWorkflow`. The `flows.Workflow` interface (`Name() string`, `Run(ctx, tx) error`) and `flows.Schedule` primitives handle per-definition polling. For reminders, each event's reminder will be a flows schedule keyed off `(organization_id, event_id)` with `fire_at = event_start_time - reminder_offset`. The worker polls `notification_type = 'event_reminder'` rows from a `calendar.event_reminder` staging table and fires notifications via the notification hub.

**Alternatives considered**:
- Per-instance cron entries in DB: Simpler but no existing infra.
- `flows` with a global "check upcoming events" scan: Chosen — single workflow polls a staging table, cheaper than per-event flows schedules given high event volumes.

---

## 3. Presence "In Meeting" Status

**Decision**: Add `PresenceStatusInMeeting = "in_meeting"` constant to notification constants and extend the DB `CHECK` constraint. Calendar logic calls `PresenceLogic.UpdatePresenceStatus()` at event start and end.

**Rationale**: `PresenceLogic.UpdatePresenceStatus()` is the existing interface for status changes (`online`, `online_hidden`, `idle`, `offline`). No "in_meeting" status exists. The calendar system will add it. Re-entry to prior status on meeting end requires storing a `prior_presence_status` field in `notification.active_connection` (or the calendar service can signal `online` as the default revert if no other meeting is active).

**Prior status revert logic**: When a meeting ends, the calendar reminder workflow calls `UpdatePresenceStatus` with `"online"` (or `"online_hidden"` depending on the user's last manual setting stored in `iam.user_preference`). Checking the user's manual preference takes precedence over defaulting to online.

**Alternatives considered**:
- Piggyback on `online_hidden` with a meeting-context flag: Rejected — loses semantic meaning; clients would need to distinguish two different states from the same enum value.
- Client-driven presence signaling from the browser: Rejected — requires client refresh loop; server-driven is more reliable.

---

## 4. File Attachments on Calendar Events

**Decision**: Use the existing `files` domain with `ContextTypeCalendarEvent = "calendar_event"` (already declared in `backend/internal/files/constants.go` line 58). Add `UploadContextCalendar = "calendar"` to `ValidUploadContexts()` in the same file.

**Rationale**: The schema `CHECK` on `files.file_metadata.context_type` already lists `calendar_event` (schema.sql line 1921). The backend constants mirror this. Only the upload context permitting calendar uploads needs to be added to `ValidUploadContexts()`. The `files.FileLogic` interface will be injected into the calendar logic layer as a dependency.

**Alternatives considered**:
- A calendar-owned file storage: Rejected — violating constitution (files is T1 support kernel, not per-domain).

---

## 5. Booking Link Security

**Decision**: Duplicate the `generateSecureToken()` (32-byte cryptographically secure base64url) pattern from `backend/internal/iam/logic.go`. Store the token in `calendar.booking_link` with `expires_at`, `status`, and claimed slot. Booking links serve **authenticated internal users** only (per spec assumptions), so the recipient must be logged in — the token merely identifies *which* organizer's availability to show and which slot to claim.

**Rationale**: The iam package's `generateSecureToken()` is package-private. The pattern (32-byte `rand.Read` → `base64.URLEncoding.EncodeToString`) is trivial to replicate. The `iam` invitation system (same pattern) validates tokens with expiry and single-use semantics — calendar will use the same approach.

**Alternatives considered**:
- JWT tokens for booking links: Rejected — stateless links cannot be invalidated when a slot is claimed.
- Sharing iam's token generator: Rejected — iam is T0, calendar is T4; calendar cannot import iam's unexported functions without violating architecture.

---

## 6. Domain Tier Placement

**Decision**: Calendar is **T4 — Aggregation Layer**. It is the first T4 domain. Calendar depends on T3 (Collaboration) for ritual and task overlays, T2 (Docs) for document deadline overlays, T2 (Chat) for linking discussion channels on events, and T1 (Notification, Files) for reminders and file attachments.

**Interface injection approach**: Calendar defines thin **reader interfaces** that other domains implement — following the Interface Segregation principle (SYSTEM-ARCHITECTURE.md §7):
```go
// Defined in calendar package
type CollaborationOverlayReader interface {
    GetTasksDueInRange(ctx, tx, orgID, from, to) ([]*OverlayItem, error)
    GetRitualInstancesInRange(ctx, tx, orgID, from, to) ([]*OverlayItem, error)
}

type DocsOverlayReader interface {
    GetDocDeadlinesInRange(ctx, tx, orgID, from, to) ([]*OverlayItem, error)
}
```
Collaboration and Docs implement these interfaces. Injection happens in `backend/cmd/server.go` (same as all other dependency injection).

**Architecture documentation update**: SYSTEM-ARCHITECTURE.md will be updated (Post-Implementation, after all tests pass) to document T4 tier.

**Alternatives considered**:
- Calendar at T3 (peer of collaboration) reading collaboration DB directly: Rejected — violates constitution §IV "cross-schema SQL joins are FORBIDDEN".
- Calendar at T3 with no overlay functionality (pure events): Rejected — overlays are a core spec requirement (FR-028 to FR-031).

---

## 7. Cross-Domain Overlay Real-Time Updates (FR-031, SC-007)

**Decision**: Use the existing SSE/notification hub infrastructure. When a task is completed or ritual closed in collaboration, the existing `PublishNotification()` call already fires. The calendar frontend subscribes to these notifications via the existing SSE stream and refreshes overlay items client-side on receipt. No new SSE infrastructure needed.

**Rationale**: SC-007 requires overlay status updates within 30 seconds. The existing notification SSE delivers within 1-2 seconds. The calendar frontend's overlay layer will listen for `source_domain='calendar'` and `source_domain='projects'` events and refresh affected date ranges.

**Schema migration required**: 
- `notification.notification.source_domain` CHECK → add `'calendar'`
- `notification.notification_recipient.policy_key` CHECK → add `calendar_event_*` keys
- `notification.resource_subscription.resource_domain` CHECK → add `'calendar_event'`

---

## 8. Resource Conflict Prevention (FR-012, SC-005)

**Decision**: Use PostgreSQL `SELECT ... FOR UPDATE SKIP LOCKED` with an explicit conflict query in the same transaction. No advisory locks needed.

**Rationale**: When a booking is submitted, the Connect layer opens a transaction, queries `calendar.resource_booking` for overlapping intervals using `FOR UPDATE` on the resource rows, and only inserts if no conflicts exist. Citus shard co-location on `organization_id` ensures all booking rows for the same org are on the same shard, making this a single-shard transaction.

**Conflict query pattern**:
```sql
SELECT COUNT(*) FROM calendar.resource_booking
WHERE organization_id = $1 AND resource_id = $2
  AND tstzrange(start_time, end_time, '[)') && tstzrange($3, $4, '[)')
FOR UPDATE;
```
If count > 0 → conflict → reject. Atomicity guaranteed by Citus single-shard transaction.

**Alternatives considered**:
- Application-level optimistic locking with version: Rejected — two concurrent writes at exactly the same time would both succeed before the other's conflict check runs.
- Advisory locks: Rejected — not supported on Citus distributed tables.

---

## 9. Scheduling Assistant Algorithm (FR-020, SC-002)

**Decision**: Brute-force free/busy computation with indexed event queries. For up to 10 attendees over 5 days with 30-minute slot granularity: ~240 candidate slots per day × 5 days = 1,200 slots; each attendee needs 1 DB query (10 queries total → well within 3s target).

**Algorithm**:
1. Fetch each attendee's events in the requested date range (one query per attendee with index on `organization_id, attendee_id, start_time`).
2. Fetch each attendee's working hours (flat lookup from `calendar.working_hours`).
3. Build per-attendee busy intervals list in memory.
4. Iterate candidate slots in 30-min increments, filtering out slots outside any attendee's working hours or overlapping any busy interval.
5. Return first N available slots.

**Alternatives considered**:
-Interval tree: Overkill for ≤10 attendees; adds complexity without measurable benefit at this scale.
- Single `INTERSECT` SQL query: Joins across 10 attendees in one query are harder to optimize and debug; per-attendee queries with composite index are simpler and predictable.

---

## Summary of Resolved Unknowns

| ID | Unknown | Resolution |
|----|---------|-----------|
| U1 | Recurrence library | `github.com/teambition/rrule-go` — RFC 5545 RRULE strings in TEXT column; forward-compatible with future calendar sync |
| U2 | Reminder scheduling | `flows` framework — `CalendarReminderWorkflow` registers flows schedules |
| U3 | Presence "In Meeting" | New `in_meeting` constant + `PresenceLogic.UpdatePresenceStatus()` call |
| U4 | File attachments | Existing `calendar_event` context type; add to `ValidUploadContexts()` |
| U5 | Booking link security | 32-byte cryptographically secure token, stored in `calendar.booking_link` |
| U6 | Tier placement | **T4 — Aggregation Layer** with thin `CollaborationOverlayReader` / `DocsOverlayReader` interfaces |
| U7 | Overlay real-time updates | Existing SSE notification hub (extend CHECK constraints for `'calendar'` domain) |
| U8 | Resource conflict prevention | `SELECT FOR UPDATE` in single-shard transaction |
| U9 | Scheduling assistant | Per-attendee event queries + working hours, brute-force slot scan in memory |
