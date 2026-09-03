# Phase 0 Research: Ritual Assignment Follows the Shift

Every open question raised while filling the plan's Technical Context is resolved here.
This is an unattended run, so each unknown was decided the way a senior engineer following
the repository's existing conventions would decide it, and the decision is recorded as an
`[ASSUMPTION: ...]` so it can be reviewed later.

---

## R1 — How does "a shift" reach ritual assignment without collaboration importing calendar?

**Decision**: Collaboration declares a consumer-side interface, `ShiftCoverageReader`, in
`internal/collaboration/logic.go`. `calendar.Logic` implements it. `cmd/server.go` injects
it with a setter, `collaborationLogic.SetShiftCoverageReader(calendarLogic)`, placed
immediately after `calendarLogic` is constructed.

**Rationale**: The repository already does exactly this in the opposite direction —
`internal/calendar/logic.go` declares `CollaborationOverlayReader` and
`NotificationPublisher`, both implemented elsewhere and injected at construction. The only
new element is that construction order forbids a constructor argument: `cmd/server.go:460`
builds `collaborationLogic` and `cmd/server.go:537` builds `calendarLogic` from it, so
collaboration cannot take calendar as a constructor parameter without a cycle. A setter is
the established remedy — `organization.Logic` already exposes `SetCollaborationLogic` for
the same reason.

**Alternatives considered**:
- *Move shift events into collaboration.* Rejected: shifts are calendar events, authored on
  the calendar, and FR-021 forbids this feature writing them.
- *Publish shift changes onto an event bus that collaboration subscribes to.* Rejected as
  YAGNI (principle V): it adds a delivery guarantee problem to solve a read problem, and the
  resolution sweep already re-reads on a cadence, so a missed event would be invisible
  anyway.
- *Read `calendar.event` directly from a collaboration query.* Rejected: principle IV
  forbids cross-schema SQL joins and cross-domain SQL access outright.

`[ASSUMPTION: the reader is injected by setter rather than constructor because
cmd/server.go builds collaboration before calendar; the alternative — reordering
construction — would require collaboration's other dependencies (chat, docs, notification)
to move too, which is a larger and riskier edit than one setter.]`

---

## R2 — Where does timezone reasoning live?

**Decision**: In collaboration. The resolver converts an instance's `scheduled_date` into a
half-open UTC instant pair `[dayStart, dayEnd)` using the ritual definition's `timezone`,
via the existing `loadTimezone` helper in `scheduler_logic.go`. The calendar reader is
handed those two instants and answers a pure overlap question. It never sees a date and
never sees a timezone name.

**Rationale**: The definition's timezone column is collaboration's data, and `loadTimezone`
already handles both IANA names and the `UTC±N` offset strings this product also accepts.
Pushing the date into calendar would mean re-implementing that parsing in a second domain —
which is the divergence principle VIII exists to prevent. Making the interface take
instants also makes FR-003's "all-day and overnight shifts are covered by this rule without
special-casing" literally true: a 22:00→06:00 shift overlaps both days' intervals by
ordinary interval arithmetic.

**Alternatives considered**: passing `(date string, timezone string)` and letting calendar
resolve it. Rejected for the duplication above, and because it would put a collaboration
concept (the ritual's timezone) into the calendar's vocabulary.

---

## R3 — Do recurring shift events count, and how are they expanded?

**Decision**: Yes. The calendar reader expands recurring shift series in Go using the
existing `expandInstances` and `applyExceptions` helpers in
`internal/calendar/recurrence.go`, then applies stored `calendar.recurrence_exception` rows
so a cancelled or skipped occurrence does not count and a modified occurrence is picked up
from its own replacement event row.

**Rationale**: The spec's edge cases require occurrence-level accuracy. The two helpers
already exist, are already backed by `rrule-go`, and — verified during research — have **no
callers anywhere in the repository today**: `ListEventsForEmployee` and `ListEventsForOrg`
match only on the stored `start_time`/`end_time` of a row, so a weekly shift series
currently appears in a range query only when the series *head* overlaps the range. Using
these helpers is therefore reuse (ladder rung 2), not new machinery, and it fixes the
expansion gap for the one read that needs it without changing the behaviour of the calendar
surfaces that do not.

**Note for the drift register**: this research established that recurring calendar events
are not expanded by the calendar's own range listing. That is pre-existing behaviour, is
out of scope here, and should be recorded in `docs/domain/README.md`'s drift register when
`docs/domain/calendar.md` is updated.

**Alternatives considered**: materialising every occurrence as a row at creation time.
Rejected: it is a large change to the calendar's storage model, well outside this feature's
scope, and the calendar deliberately stores exceptions rather than occurrences.

---

## R4 — Which people on a shift event count as "working"?

**Decision**: The event's **attendees**, excluding any whose `rsvp_status` is `declined`.
The organiser does not count unless they are also an attendee.

**Rationale**: FR-004 fixes the declined rule and the "no response means working" rule. The
organiser question is not settled by the spec. On a shift event the organiser is the person
who published the rota — typically the manager — so counting them would make the manager
eligible for every ritual on every date the rota covers, which is precisely the "assigned to
someone who is not in" failure this feature exists to fix, with a different victim.

`[ASSUMPTION: a shift event's organiser is not treated as working unless they also appear
in calendar.attendee. The rota author is not automatically on the rota. A manager who does
work the shift is added as an attendee, which is already how the rota is authored.]`

---

## R5 — Does shift coverage respect event visibility?

**Decision**: No. The coverage read ignores `calendar.event.visibility` and returns coverage
for every non-cancelled shift event whose attendees include the queried employees.

**Rationale**: This is a system-scope read performed by a background sweep and by instance
generation, not a read on behalf of a signed-in user; there is no actor whose visibility to
respect. The result never leaves the backend as event data — only an employee ID list
crosses back — so no event title, location or attendee list is disclosed. Applying the
free/busy redaction rules from `ListEvents` here would mean a shift marked `private` silently
removed its owner from the rota, which reproduces the reported bug.

`[ASSUMPTION: shift coverage ignores event visibility because it is a system-scope read
whose only output is "is this employee working", a fact the employing organization already
owns.]`

---

## R6 — What cadence does the resolution cycle run at?

**Decision**: A dedicated workflow, `ritual_shift_resolution_sweep`, scheduled every
**2 minutes** via `flows.ScheduleTx` in `cmd/server.go`, with
`RetryPolicy{MaxRetries: 2}` matching the reconciliation sweep.

**Rationale**: The spec's assumptions require its own cadence in minutes, not hours, and
require it not be folded into the 1-minute generation sweep or the 5-minute reconciliation
sweep, both of which have narrow documented responsibilities. Two minutes is fast enough
that "publish the rota, see the checklists assigned" reads as immediate to a manager
(SC-002, SC-003) and slow enough that the pass is cheap: a rota changes on a human
timescale, so most passes will find nothing to do and cost one cross-org discovery query.

`[ASSUMPTION: 2 minutes. It sits between the existing 1-minute and 5-minute sweeps rather
than duplicating either number, so a log line's cadence identifies which sweep produced it,
and it is exposed as the named constant RitualShiftResolutionInterval so the number lives in
one place.]`

---

## R7 — How is "manually reassigned by a person" detected?

**Decision**: The pool-assignment row stores `assigned_employee_id` — the employee *this
feature* put in the slot. Before re-resolving a `resolved` row, the pass checks that a
`collaboration.task_assignee` row still exists for `(task, assigned_employee_id, role =
'assignee')`. If it does not, a person removed or replaced the assignee, and the row is
closed with `closed_reason = 'manual_override'` and never re-resolved.

**Rationale**: `task_assignee.assigned_by_employee_id` cannot distinguish the two cases:
generation assigns as the definition's creator, so a manual assignment by that same person
is indistinguishable from an automatic one. Recording what we assigned and detecting
divergence is both cheaper and exact. It also gives FR-012 the row it needs to withdraw
when a shift moves, and it makes the multi-pool case unambiguous — with two pools on one
instance, "which assignee belongs to which pool" is otherwise unanswerable.

**Alternatives considered**: a `manually_assigned` boolean on `task_assignee` written by the
assignment RPCs. Rejected: it changes a table every task in the product uses in order to
answer a question only ritual pools ask, and it would need backfilling.

---

## R8 — How is exactly-once escalation guaranteed under overlapping passes?

**Decision**: The escalation transition is a compare-and-set —
`UPDATE ... SET resolution_state = 'closed_unresolved' ... WHERE resolution_state =
'awaiting_shift'` returning the affected row — and the owner notification is published only
when that update reports a row. Every other state write in the pass uses the same shape.

**Rationale**: This is exactly the pattern `UpdateRitualTaskStateIfUnchanged` already uses
to stop two overlapping reconciliation passes double-notifying, documented in
`docs/domain/rituals-tasks.md`. Reusing it means one idempotency mechanism in the ritual
system rather than two, and it needs no advisory lock, no dedup table and no `processed_at`
marker (principle XI).

**Alternatives considered**: a PostgreSQL advisory lock per organization. Rejected: it makes
the sweep stateful across passes and serialises work that the CAS already makes safe.

---

## R9 — When several people are on shift, how is the tie broken deterministically?

**Decision**: Fewest ritual instances assigned in the trailing 90 days, ties broken by
lowest employee UUID. Implemented as a new query,
`GetLeastAssignedEmployeeAmongCandidates`, which takes the candidate employee IDs as a
`uuid[]` and orders by `COALESCE(count, 0) ASC, employee_id ASC`.

**Rationale**: FR-006 requires least-assigned semantics and a deterministic tiebreak. The
existing `GetLeastAssignedDepartmentEmployee` cannot be reused directly because its
candidate set is the whole department, not the rostered subset. The new variant takes an
array instead of a department ID, which as a side effect removes the
`collaboration` → `organization.department_member` cross-schema join the existing query
carries — so the new query is strictly cleaner than the one it sits beside.

`[ASSUMPTION: the deterministic tiebreak is lowest employee UUID, matching
ListActiveDepartmentMembers' existing "ORDER BY employee_id ASC for deterministic
round-robin" convention rather than introducing a second ordering rule.]`

---

## R10 — What happens to a definition switched *to* or *away from* on-shift?

**Decision**: The resolution pass's candidate query is a `LEFT JOIN` from on-shift pools to
pool-assignment rows, so a future untouched instance whose pool has just become `on_shift`
and has no row yet is **adopted** and resolved on the next pass. Conversely, a row whose
pool's current strategy is no longer `on_shift` is assigned under the pool's new strategy if
still unresolved, and its row is then deleted; a resolved row on a no-longer-on-shift pool
is simply deleted and the existing assignee is left alone.

**Rationale**: One query covers three of the spec's edge cases — newly generated instances,
adoption after a strategy switch, and rebinding after a shift swap — instead of three
discovery paths. Deleting the row when the pool stops being on-shift is correct because the
row exists only to track on-shift late binding; leaving it would make FR-019's explanation
appear on an instance whose pool no longer works that way.

---

## R11 — How does an instance surface "waiting for the rota" (FR-019)?

**Decision**: A new proto enum field on `Task`, `RitualPoolAssignmentState
pool_assignment_state`, populated from the pool-assignment rows for that task. When a task
has several pool rows, the field reports the least-progressed state
(`AWAITING_SHIFT` > `CLOSED_UNRESOLVED` > `RESOLVED`), so an instance with one bound pool
and one waiting pool still tells the reader something is outstanding.

Population is via one batched query, `ListRitualPoolAssignmentStatesForTasks(orgID,
task_ids[])`, called from the paths that return ritual instances. It is skipped entirely
when the result set contains no `ritual_instance` tasks, so an ordinary task board pays
nothing.

**Rationale**: A proto enum is principle VIII's preferred form. Batching keeps list views
from issuing one query per row — the N+1 that would otherwise make SC-006 hard to hold.

`[ASSUMPTION: the client copy names neither the department nor a person — "Waiting for the
rota: nobody in this ritual's department is rostered for <scheduled date>". FR-019 requires
the reason, not the department's name, and naming it would need a cross-domain read on a
hot path.]`

---

## R12 — Which notification types are needed?

**Decision**: One new type, `ritual_instance_unassigned`, added to the
`notification.notification_type` CHECK constraint and to the Go and TypeScript constant
sets. It carries the owner/admin escalation of FR-013.

Reassignment messages (FR-011, FR-012) reuse the existing `task_assigned` type: "this
instance is now yours" and "this instance is no longer yours" are ordinary assignment
changes and the notification system already routes, mutes and deep-links them correctly.

**Rationale**: Principle V — a new type earns its place only when an existing one would
misroute or misdescribe. `task_assigned` describes assignment changes exactly.
`ritual_instance_unassigned` has no existing equivalent: `ritual_instance_missed` means "the
assigned work is late", and the spec explicitly requires the two not be conflated.

The escalation publishes at **priority 2** with `PolicyKeyTaskStatus`, matching
`publishRitualLatenessNotification`, so do-not-disturb, domain mute and presence apply
without this feature knowing they exist.

`[ASSUMPTION: withdrawal and reassignment notifications reuse task_assigned rather than
introducing ritual_instance_reassigned, because the recipient's question — "what changed
about my work?" — is identical and a second type would need its own mute policy row.]`

---

## R13 — Does on-shift resolution at generation time threaten SC-006?

**Decision**: Acceptable as designed, with one cache inside a single generation call: the
department member list is read once per pool per definition (it already is), and the
shift-coverage read is issued once per *date*, not once per candidate.

**Rationale**: For a definition with a 30-day daily window this is 30 coverage reads, each
one indexed lookup over `calendar.event` plus its attendees. Across 200 definitions that is
bounded by the number of *new* dates a sweep generates, which after the first run is one
date per definition per day — not 30. The 30-read cost is paid once, when a definition is
created, inside the creation transaction where it is already doing more work than this.

`[ASSUMPTION: no cross-date caching of shift coverage inside one generation call. A single
combined read over the whole window would be faster but needs a second, differently-shaped
calendar query; the per-date read reuses one query for both generation and the sweep. If a
generation cycle is ever measured over its interval, the upgrade is a windowed variant of
the same reader — recorded as a `ponytail:` comment at the call site.]`
