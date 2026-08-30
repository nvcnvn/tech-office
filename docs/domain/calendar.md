# Calendar

Events, recurrence, RSVP, room/equipment resources, free-busy and slot suggestion, external
booking links, delegation, and attendance check-in with evidence. Owned by
`internal/calendar`; contract in `rpc/v1/calendar.proto` (`CalendarService`, 26 RPCs).

**Status date: 2026-08-22.** Supersedes spec 026.

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

### Recurrence

`recurrence_rule` (text), `recurrence_end`, `series_id`. Exceptions are stored, not
computed: `calendar.recurrence_exception` keyed by `(series_id, original_start_time)` with
an `exception_type` and an optional `new_event_id` for a moved/modified occurrence.

`EventEditScope` decides the blast radius of an edit — this instance, this and following, or
the whole series. `EditEventSeries` applies it; every change is recorded in
`calendar.audit_entry` with its `change_scope`, so "who moved my recurring meeting" is
answerable.

### Attendees

`calendar.attendee` — `role IN ('required','optional','organizer')`, `rsvp_status` with
`response_time` and `response_note`. `RespondToInvite` / `ListEventAttendees`.

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

## Overlay

`ListOverlayItems` merges calendar events with items owned by other domains: it calls
`collaboration.GetTasksDueInRange` and `GetRitualInstancesInRange` so due tasks and ritual
instances render on the calendar grid. The dependency points calendar → collaboration; the
collaboration domain knows nothing about the calendar.

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
`calendar_overlay_test.go`, `calendar_notification_test.go`.

## Known drift

**Calendar cannot be domain-muted.** `notification.personal_preference.muted_domains` omits
`calendar` from its CHECK — see
[notifications-presence.md](notifications-presence.md#known-drift).
