# Calendar

Events, recurrence, RSVP, room/equipment resources, free-busy and slot suggestion, external
booking links, delegation, and attendance check-in with evidence. Owned by
`internal/calendar`; contract in `rpc/v1/calendar.proto` (`CalendarService`, 26 RPCs).

**Status date: 2026-09-12.** Supersedes specs 026, 045 and 046; shift coverage added by spec 042.

## Events

`calendar.event` — all times stored **UTC**.

- `event_type IN ('meeting','shift','deadline','reminder','out_of_office','company_event','training','maintenance_window')`
- `visibility IN ('private','personal_shared','team','org_wide')`, default `personal_shared`
- `start_time`/`end_time` with `CHECK (end_time > start_time OR all_day)`
- `location_text`, `virtual_link`
- cross-domain: `description_document_id` → `docs.document`,
  `discussion_channel_id` → `chat.channel`
- operational flags: `requires_check_in`, `requires_evidence`
- cancellation is a soft state: `cancelled_at` + `cancelled_by_id`, never a delete

**Link previews honour that visibility.** `ListEventPreviews` — the query behind an event
card in chat, see [workspace-navigation.md](workspace-navigation.md#previews) — uses the
same predicate as `SearchEvents`: organiser, attendee, or `visibility IN ('team',
'org_wide')`. `personal_shared` is deliberately outside the third arm, because it means
organiser-and-attendees-only. A cancelled event has nothing to preview and is excluded.
This replaces an earlier existence-only check on the preview path, which would have
disclosed the title of any event whose id somebody happened to hold.

The card carries `start_time` as an RFC3339 **instant** and an `all_day` flag; the client
formats it in the reader's own zone, because a server-rendered wall clock would be wrong
for anyone travelling.

### Recurrence

`recurrence_rule` (text), `recurrence_end`, `series_id`. Exceptions are stored, not
computed: `calendar.recurrence_exception` keyed by `(series_id, original_start_time)` with
an `exception_type` and an optional `new_event_id` for a moved/modified occurrence.

`EventEditScope` decides the blast radius of an edit — this instance, this and following, or
the whole series. `EditEventSeries` applies it; every change is recorded in
`calendar.audit_entry` with its `change_scope`, so "who moved my recurring meeting" is
answerable.

The RRULE expansion helpers in `internal/calendar/recurrence.go` (`expandInstances`,
`applyExceptions`) had no caller until feature 042. Range queries such as `ListEvents` still
do **not** expand recurrence — they return series heads. Shift coverage below is the one read
that expands occurrences in Go.

### Attendees

`calendar.attendee` — `role IN ('required','optional','organizer')`, `rsvp_status` with
`response_time` and `response_note`. `RespondToInvite` / `ListEventAttendees`.

### Search

`SearchEvents` (`CalendarService.SearchEvents`, and the `EVENT` source of
`SearchService.Search`) matches `title` and `description` with PGroonga `&@~`, backed by
`idx_event_pgroonga`, ordered by `pgroonga_score` then `updated_at` then `id`.

It is **visibility-scoped**, using byte-for-byte the rule `ListEventsForEmployee` and
`ListEventsForOrg` already ship between them, so the `visibility` column has one
interpretation rather than two:

```
organizer_id = @employee_id
OR EXISTS (attendee row for @employee_id on this event)
OR visibility IN ('team', 'org_wide')
```

`personal_shared` is deliberately outside the third arm: it means organiser-and-attendees
only. Cancelled events are excluded by `cancelled_at IS NULL`. The employee id comes from
the auth context, never from the request.

## Scheduling helpers

- `calendar.working_hours` — per employee, backing `GetWorkingHours` / `SetWorkingHours`.
- `GetFreeBusy` — availability across a set of employees.
- `SuggestSlots` — candidate meeting times honouring working hours and existing bookings.

## Resources

`calendar.resource` (rooms, equipment) with:

- `calendar.resource_acl` — per employee **or** per department (a CHECK enforces exactly
  one target), with `can_book`.
- `calendar.resource_booking` — the actual reservation tied to an event.

Managing resources requires `calendar.manageResources`; it is the calendar domain's only
dedicated permission — every other calendar RPC runs on "any authenticated user".

## Booking links

`calendar.booking_link` is a Calendly-style external link: a `token` (unique per org),
`duration_minutes`, `available_windows` JSONB, a validity range, and
`status IN ('active','expired','claimed')` with `claimed_event_id` / `claimed_by_id`.

`GetBookingLinkByToken` and `ClaimBookingSlot` are the endpoints an outside party hits.
Web entry at `/workspace/calendar/booking`, mobile at `app/booking/[token].tsx`.

## Delegation

`calendar.delegation` — an owner grants a delegate `can_create` / `can_modify` /
`can_cancel` with an optional `expires_at`. `GrantDelegation`, `ListDelegations`,
`RevokeDelegation`. This is an assistant managing an executive's calendar, not a role.

## Check-in and evidence

For `event_type = 'shift'` and anything with `requires_check_in`:

`calendar.check_in` records `checked_in_at`, `is_late`, and `evidence_file_ids uuid[]`.
`CheckInToEvent` and `SubmitCheckInEvidence`. This parallels the ritual evidence model but
is a separate table — calendar check-in evidence is not
`collaboration.evidence_submission`.

## Shift coverage

`EmployeesOnShift(ctx, tx, orgID, candidateEmployeeIDs, dayStart, dayEnd)`
(`internal/calendar/shift_coverage_logic.go`) answers "which of these employees is working
during this interval". It is read-only and is the **only** calendar surface
`internal/collaboration` reaches, through the `ShiftCoverageReader` interface collaboration
declares and this method satisfies. See
[rituals-tasks.md](rituals-tasks.md#on-shift-assignment-feature-042) for the consumer and
`backend/docs/SYSTEM-ARCHITECTURE.md` for why the edge is inverted.

The interval is a half-open `[dayStart, dayEnd)` pair of UTC instants the **caller** has
already resolved from its own timezone, which is what lets a ritual in `Asia/Tokyo` and a
shift stored in UTC agree without either domain learning the other's rules.

Coverage rules:

| Situation | Covered? |
|---|---|
| Non-recurring shift whose `[start, end)` overlaps the interval | yes |
| All-day shift spanning the date | yes — the stored times already span it |
| Overnight shift 22:00 Fri → 06:00 Sat | yes, for **both** Friday and Saturday |
| Occurrence of a recurring shift series | yes — expanded from the RRULE |
| Occurrence with a `skipped` or `cancelled` recurrence exception | no |
| Occurrence with a `modified` exception | the replacement event decides, not the original |
| Event with `cancelled_at IS NOT NULL` | no |
| Attendee with `rsvp_status = 'declined'` | no |
| Attendee with `pending`, `accepted` or `tentative` | yes |
| Attendee with `role = 'organizer'` | **no** — `CreateEvent` writes the actor as the organiser attendee, and the actor is the manager publishing the rota |
| Event of any `event_type` other than `shift` | no |
| Private shift | yes — visibility does not change who is working |

Two queries feed it: `ListShiftCoverageDirect` for concrete events (which also covers a
series' materialised `modified` exception instances, stored as rows with
`recurrence_rule IS NULL`), and `ListShiftCoverageSeries` for series heads, whose
occurrences are expanded with `expandInstances` + `applyExceptions`. The expansion window is
widened backwards by the series' own duration so an overnight occurrence starting before
`dayStart` is not missed, and the series prefilter is widened by a documented
`maxShiftDuration` of 24h because `recurrence_end` stores the last occurrence's *start*.
Exactness is restored by the overlap test in Go, so the widening can only cost an extra row.

The candidate list crosses the boundary as a `uuid[]` parameter, which keeps the join inside
the `calendar` schema — no cross-schema join into `organization.department_member`. An empty
candidate list returns empty without touching the database. The result is deduplicated and
sorted ascending so the caller's tiebreak is reproducible.

## Overlay

`ListOverlayItems` merges calendar events with items owned by other domains: it calls
`collaboration.GetTasksDueInRange` and `GetRitualInstancesInRange` so due tasks and ritual
instances render on the calendar grid. The dependency points calendar → collaboration.

That is no longer the only edge between the two. Feature 042 added the opposite direction —
collaboration reading shift coverage — expressed as an interface collaboration declares and
calendar implements, so the *import* graph still points only calendar → collaboration.

## Reminders

`calendar.event_reminder` — one row per (event, attendee) with `reminder_offset_minutes`
(default 15), a computed `fire_at`, and `status IN ('pending','sent','cancelled')`.

`CalendarReminderWorkflow` polls every minute for `status='pending' AND fire_at <= now()`,
in batches of 100, publishes a notification per row and marks it `sent`. It is safe to
re-run after a crash. `FirePendingReminders` is exported so integration tests can drive one
poll without a flows worker.

The reminder publishes at **priority 0** — deliver always, including to an absent user.
That is the whole point of a reminder, and any higher number is a policy that suppresses
it for exactly the person it is for. `ListPendingRemindersGlobal` joins `calendar.event`
so the body names the event (`"<title> starts in N minutes"`): on a lock screen the body
is all the user sees, and the `navigation_target` that lands them on the right event only
helps after they have decided to tap.

Like the ritual sweep, registration alone does nothing — `flows.ScheduleTx` in
`cmd/server.go` under schedule ID `calendar_reminder_poll` is what makes it run. That
bootstrap was missing from the original implementation, so reminders had never fired in
production; feature 034 added it.

There is **no** calendar presence job. `CalendarPresenceWorkflow` used to exist, registered
but never scheduled, and could not have worked if it had been: it queried `ListEventsForOrg`
with a zero-UUID organization ID, so it always read an empty set, and its "set in_meeting"
branch only called `slog.Debug`. Since the presence ping-pong protocol,
`notification.active_connection.presence_status` is written only by client pongs, so a
server-side write would be clobbered on the next pong anyway. Feature 034 deleted it rather
than scheduling a job that would run every minute and do nothing. `in_meeting` remains a
valid presence value — clients report it.

## Notifications produced

`calendar_event_invite`, `calendar_event_cancel`, `calendar_event_change`,
`calendar_event_reminder`, `calendar_check_in_missed`, `calendar_event_digest`. Source
domain `calendar`.

## Client surfaces

- Web: `/workspace/calendar`, `/workspace/calendar/booking`.
- Mobile: `app/(app)/(calendar)/` — index, `[eventId]`, `create`; plus
  `app/(shared)/resource/calendar/[eventId].tsx` and `app/booking/[token].tsx`.
- Client: `packages/apis/src/calendar.ts`.

## Tests

`calendar_event_test.go`, `calendar_recurrence_test.go`, `calendar_team_test.go`,
`calendar_resource_test.go`, `calendar_booking_test.go`, `calendar_checkin_test.go`,
`calendar_overlay_test.go`, `calendar_notification_test.go`,
`calendar_shift_coverage_test.go`.

## Known drift

**The mobile check-in path asks for location and throws the answer away.**
`frontend/apps/mobile/src/app/(app)/(calendar)/[eventId].tsx:69-75` calls
`Location.requestForegroundPermissionsAsync()`, refuses to check in if the person
declines, then calls `Location.getCurrentPositionAsync()` and **discards the result**,
calling `checkInToEvent(eventId)` with no coordinate. Its own comment says the reading is
"used for client-side context; server validates geofence", but nothing client-side
consumes it and no geofence is evaluated on this path. `calendar.check_in` has no
coordinate columns at all — only `checked_in_at`, `is_late` and `evidence_file_ids` — so
there is nowhere for a coordinate to go even if one were sent.

The user-visible consequence is a permission prompt, and a hard failure on refusal, for
data the app does not keep. That is the same shape of problem feature 053 removed one
layer up, where the app *declared* permissions it did not use.

Found while answering the age-rating questionnaire's location question for feature 054,
which is scoped to documents and one build check and changes no app behaviour. Recorded
rather than fixed there because deleting the call moves the first location prompt from
check-in to the first task-evidence submission, which is a user-visible behaviour change.
Closing it means either dropping both calls from the check-in path, or storing the
coordinate and disclosing it — and the second is a schema change, a privacy-disclosure
change and an age-rating answer change together.
