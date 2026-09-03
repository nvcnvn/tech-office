# Feature Specification: Ritual Assignment Follows the Shift

**Feature Branch**: `042-shift-based-assignment`

**Created**: 2026-09-03

**Status**: Draft

**Input**: User description: "Ritual assignment follows the shift. Add an assignment strategy that picks whoever has a shift calendar event covering the scheduled date, alongside round-robin and least-assigned. The schedule and the checklist exist but are not connected; round-robin assigns the closing count to someone who is not in."

## Problem

A ritual definition can draw its assignee from a department pool using one of two
strategies: round-robin over the department's member list, or least-assigned over the
trailing 90 days. Neither strategy knows anything about who is actually working that day.

The organization already records who is working: a shift is a calendar event with
`event_type = 'shift'` and the working employees as its attendees. The rota and the
checklist are both in the product and are not connected to each other.

The consequence is the reported failure: the Friday closing count is generated, round-robin
hands it to the next name in the department list, that person is off that day, and the
checklist sits unassigned-in-practice until it goes overdue and then missed. The alert that
feature 040 added fires correctly and tells the wrong person. Managers respond by abandoning
pools and hand-naming assignees on every definition, which is the manual scheduling the
feature was supposed to remove.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The closing checklist goes to whoever is closing (Priority: P1)

A store manager keeps a "Closing count" ritual that recurs every day. The team's shifts are
already on the calendar as shift events. The manager sets the ritual's department pool to
the new **on-shift** strategy. From then on, each day's instance is assigned to a member of
that department who has a shift covering that day, and never to someone who is off.

**Why this priority**: This is the reported defect and the whole point of the feature.
Without it nothing else in this spec has value.

**Independent Test**: Create a ritual with an on-shift department pool, put two department
members on shifts covering alternate days, generate the window, and assert every instance's
assignee has a shift covering that instance's scheduled date.

**Acceptance Scenarios**:

1. **Given** a daily ritual with an on-shift department pool, and department members Ana
   (shifts Mon/Wed/Fri) and Ben (shifts Tue/Thu), **When** the instances for that week are
   generated, **Then** Monday, Wednesday and Friday are assigned to Ana and Tuesday and
   Thursday are assigned to Ben.
2. **Given** the same ritual, **When** three department members all have a shift covering
   the same date, **Then** exactly one of them is assigned, and the one chosen is the member
   with the fewest ritual instances assigned in the trailing 90 days.
3. **Given** a member whose shift covers the scheduled date but who has declined the shift
   invitation, **When** the instance is generated, **Then** that member is not treated as
   working and is not eligible for the assignment.
4. **Given** a member whose covering shift event has been cancelled, **When** the instance
   is generated, **Then** that member is not eligible for the assignment.
5. **Given** an on-shift pool, **When** an instance is generated, **Then** the definition's
   named individual assignees are still assigned exactly as they are today — the strategy
   governs the pool slot only.

---

### User Story 2 - A checklist for a date with no published rota waits instead of guessing (Priority: P1)

Instances are materialised up to 30 days ahead, but a rota is typically published one or two
weeks ahead. When an instance is generated for a date nobody has a shift for yet, the system
must not guess. It leaves the pool slot unfilled, records that it is waiting for the rota,
and fills it as soon as a covering shift appears.

**Why this priority**: Without this, the strategy silently fails for most of the generation
window — the majority of generated instances would be for dates with no rota, so they would
either be unassigned forever or fall back to a guess, which is the bug being fixed.

**Independent Test**: Generate a 30-day window with no shifts on the calendar, assert every
pool slot is recorded as awaiting shift resolution and nobody is assigned; then publish
shifts for one week and drive one resolution pass, and assert exactly those seven instances
become assigned.

**Acceptance Scenarios**:

1. **Given** an on-shift pool and no shift events covering a scheduled date, **When** the
   instance is generated, **Then** no employee is assigned from the pool, the instance
   records that its pool assignment is awaiting shift resolution, and no fallback strategy
   is applied.
2. **Given** an instance awaiting shift resolution for a future date, **When** a shift
   covering that date is created for an eligible department member, **Then** within one
   resolution cycle the instance is assigned to that member and stops awaiting resolution.
3. **Given** an instance awaiting shift resolution, **When** it is resolved and assigned,
   **Then** the new assignee is notified that the instance is now theirs.
4. **Given** an instance awaiting shift resolution whose scheduled date has arrived with
   still no covering shift, **When** the resolution cycle runs, **Then** the instance stops
   awaiting resolution and the project's owners and admins are alerted once that a ritual
   instance could not be assigned because nobody was rostered.

---

### User Story 3 - A shift swap moves the checklist with it (Priority: P2)

Ana and Ben swap next Tuesday. The swap is made on the calendar, as it already is today.
The Tuesday instance follows the swap without anyone touching the ritual.

**Why this priority**: Shift swaps are routine in the environments that use shift rituals,
and an assignment that is correct only at generation time drifts back into the reported bug
within a week. It is the same resolution mechanism as Story 2, so the cost is small; it is
P2 only because Stories 1 and 2 are usable without it.

**Independent Test**: Generate an assigned future instance, move the covering shift to a
different member, drive one resolution pass, and assert the assignee changed and both
parties were notified.

**Acceptance Scenarios**:

1. **Given** a future instance assigned by the on-shift strategy, **When** the assignee's
   covering shift is removed and another eligible member gains a covering shift, **Then**
   within one resolution cycle the instance is reassigned to the new member, the previous
   assignee is notified that it is no longer theirs, and the new assignee is notified that
   it is now theirs.
2. **Given** a future instance assigned by the on-shift strategy whose assignee's covering
   shift is removed with nobody else covering the date, **When** the resolution cycle runs,
   **Then** the assignment is withdrawn and the instance returns to awaiting shift
   resolution.
3. **Given** an instance whose scheduled date has arrived or passed, **When** the covering
   shifts change, **Then** the assignment is not changed — reassignment applies only to
   instances still in the future.
4. **Given** an instance for which any evidence has already been submitted, **When** the
   covering shifts change, **Then** the assignment is not changed, even if the scheduled
   date is still in the future.

---

### User Story 4 - A manager can pick the strategy and see what it did (Priority: P2)

The manager configuring a ritual sees on-shift as a third option next to round-robin and
least-assigned, with enough explanation to know it depends on the shift calendar. When an
instance is unassigned, the manager can tell from the instance that it is waiting for the
rota rather than assuming the feature is broken.

**Why this priority**: The strategy is unusable if it cannot be selected, and an unexplained
unassigned instance is indistinguishable from a bug — which is what drives managers back to
hand-naming assignees.

**Independent Test**: Select on-shift in the ritual definition editor, save, reload, and
confirm it persisted; then open an instance awaiting resolution and confirm the reason is
stated on the instance.

**Acceptance Scenarios**:

1. **Given** the ritual definition editor with a department pool, **When** the manager opens
   the strategy selector, **Then** on-shift appears alongside round-robin and least-assigned
   and can be saved and re-read.
2. **Given** a ritual definition whose pool uses on-shift, **When** the manager views the
   definition, **Then** the definition states that assignment depends on shift events on the
   calendar for the chosen department.
3. **Given** an instance awaiting shift resolution, **When** anyone with access opens it,
   **Then** it shows that it is unassigned because nobody in the pool's department is
   rostered for that date, rather than showing an empty assignee with no explanation.

---

### Edge Cases

- **A member has a shift on the calendar but has since left the department.** Department
  membership is evaluated at resolution time. A shift alone does not make someone eligible;
  they must be a current member of the pool's department.
- **A member has a shift but is deactivated or removed from the organization.** Not
  eligible, on the same rule as above.
- **A shift spans midnight** (22:00 Friday to 06:00 Saturday). It covers both dates. An
  instance scheduled for either date treats that member as working.
- **An all-day shift event.** Covers every date in its span.
- **A shift in a different timezone from the ritual.** Coverage is decided by comparing the
  shift's stored instants against the ritual's scheduled date interpreted in the ritual
  definition's own timezone, so a ritual in `Asia/Tokyo` and a shift stored in UTC agree.
- **A recurring shift series.** Occurrences generated from a recurring shift event count,
  including a moved or modified occurrence, and an occurrence cancelled by a recurrence
  exception does not.
- **Multiple pools on one definition, mixing strategies.** Each pool resolves under its own
  strategy independently; one pool awaiting shift resolution does not block another pool's
  assignment on the same instance.
- **A definition switched from round-robin to on-shift.** Already-generated future instances
  are re-resolved under the new strategy on the next resolution cycle, subject to the same
  future-and-untouched rule as a shift swap. Past and started instances keep their existing
  assignee.
- **A definition switched away from on-shift to round-robin or least-assigned.** Instances
  awaiting shift resolution stop awaiting it and are assigned under the newly chosen
  strategy on the next resolution cycle.
- **The pool's department is emptied or deleted.** No eligible members, so the instance
  awaits resolution and then escalates on its scheduled date, exactly as the no-rota case.
- **The shift calendar is unreadable during a generation run.** The instance is created and
  the pool slot is left awaiting shift resolution. A missing rota read never blocks the
  instance from existing and never causes a guess.
- **Two resolution passes overlap.** An instance is assigned once; the second pass makes no
  further change and sends no duplicate notification.
- **A very large number of instances awaiting resolution** after a first deployment or a
  bulk rota publication. Resolution drains a bounded batch per pass, oldest scheduled date
  first, so a backlog produces more passes rather than one failed pass.
- **An instance was manually reassigned by a manager.** Manual assignment is a deliberate
  human decision and outranks the rota: an instance whose assignee was changed by a person
  is no longer re-resolved.
- **The escalation would fire for a long backlog of historical dates** on first deployment.
  The escalation is suppressed for instances whose scheduled date is more than 7 days in the
  past, matching the existing backfill horizon for overdue and missed alerts, so switching a
  definition to on-shift does not alert an owner about every past instance at once.

## Requirements *(mandatory)*

### Functional Requirements

**The strategy**

- **FR-001**: A ritual definition's department pool MUST accept a third assignment strategy,
  **on-shift**, alongside round-robin and least-assigned. The three are mutually exclusive
  per pool.
- **FR-002**: Under on-shift, the eligible candidates for a scheduled date MUST be the
  employees who are all of: a current member of the pool's department; covered for that date
  by a shift event; and not excluded by FR-004.
- **FR-003**: A shift event MUST be treated as covering a scheduled date when the event's
  type is shift, the event is not cancelled, and the event's time span overlaps any part of
  that scheduled date as that date is understood in the ritual definition's timezone. All-day
  and overnight shifts are covered by this rule without special-casing.
- **FR-004**: An employee whose only covering shift is one they have declined MUST NOT be
  treated as working. Employees on a covering shift with any other response state —
  including no response yet — MUST be treated as working.
- **FR-005**: When exactly one candidate is eligible, the system MUST assign that candidate.
- **FR-006**: When more than one candidate is eligible, the system MUST assign the candidate
  with the fewest ritual instances assigned in the trailing 90 days, with ties broken
  deterministically so that repeating the resolution on unchanged data yields the same
  answer.
- **FR-007**: The on-shift strategy MUST govern only the pool slot. A definition's named
  individual assignees MUST continue to be assigned unchanged, and pools using round-robin
  or least-assigned MUST behave exactly as they do today.

**Late binding**

- **FR-008**: When no candidate is eligible for a scheduled date, the system MUST create the
  instance, leave the pool slot unassigned, and record that the slot is awaiting shift
  resolution. It MUST NOT fall back to round-robin, least-assigned, or any other guess.
- **FR-009**: The system MUST re-attempt resolution for instances awaiting shift resolution
  on a recurring cycle, without any manual trigger.
- **FR-010**: Resolution MUST be attempted for an instance only while its scheduled date is
  in the future, no evidence has been submitted against it, and its assignment has not been
  changed by a person. Once any of those stops holding, the instance's pool assignment is
  frozen.
- **FR-011**: When a resolution pass finds an eligible candidate for an instance awaiting
  resolution, it MUST assign that candidate, clear the awaiting-resolution record, and
  notify the assignee.
- **FR-012**: When a resolution pass finds that the current on-shift assignee of a future,
  untouched, not-manually-assigned instance is no longer covered for its scheduled date, it
  MUST withdraw that assignment and then apply FR-005 through FR-008 afresh. Where the
  outcome is a different assignee, both the previous and the new assignee MUST be notified.
- **FR-013**: When an instance awaiting shift resolution reaches its scheduled date still
  unresolved, the system MUST stop awaiting resolution for it and alert the project's owners
  and admins exactly once that the instance could not be assigned because nobody was
  rostered. The alert MUST be suppressed, while the state change still happens, for
  instances whose scheduled date is more than 7 days in the past.
- **FR-014**: Resolution MUST be idempotent and safe to re-run: an interrupted, retried or
  concurrently running pass MUST NOT produce a duplicate assignment or a duplicate
  notification.
- **FR-015**: A resolution pass MUST process a bounded number of instances, ordered by
  scheduled date ascending, and MUST continue past a failure on one organization or one
  instance so that one bad row cannot stop the rest.
- **FR-016**: A failure to read the shift calendar MUST NOT prevent an instance from being
  created and MUST NOT cause a fallback assignment; the slot is left awaiting resolution and
  the condition is logged.

**Configuration and visibility**

- **FR-017**: A manager who can edit a ritual definition MUST be able to select on-shift for
  a department pool, save it, and read it back, using the same permission that governs
  editing the definition's assignment today.
- **FR-018**: The ritual definition surface MUST state, for a pool set to on-shift, that
  assignment depends on shift events on the calendar for that department.
- **FR-019**: A ritual instance whose pool slot is awaiting shift resolution MUST show that
  it is unassigned because nobody in the department is rostered for its date, distinguishing
  it from an instance that simply has no assignee configured.
- **FR-020**: The existing overdue and missed alerting MUST continue to work unchanged for
  instances assigned by the on-shift strategy, and an instance still awaiting resolution
  MUST continue to escalate to project owners on the missed transition as it does today.

**Boundaries**

- **FR-021**: The feature MUST NOT create, modify, or delete shift events. Rituals read the
  rota; they never write it.
- **FR-022**: The feature MUST NOT require the collaboration domain to depend on the
  calendar domain in a way that inverts the established tier ordering; shift coverage MUST
  be supplied to ritual assignment through an inversion of control that keeps the existing
  dependency direction intact.

### Key Entities

- **Ritual definition department pool**: gains a third permitted strategy value. The
  existing round-robin waterline column continues to serve round-robin and is not used by
  on-shift.
- **Ritual instance pool assignment state**: a new per-instance-per-pool record of whether
  the pool slot is resolved, awaiting shift resolution, or closed unresolved after
  escalation. This is what makes late binding, the once-only escalation, and the
  "why is this unassigned" explanation all answerable without re-deriving them.
- **Shift coverage**: a read-only view of "which employees of this department are working on
  this date", derived from shift-type calendar events and their attendees. It is a query, not
  stored state; the calendar remains the single source of truth for the rota.
- **Shift resolution cycle**: the recurring pass that binds and rebinds pool slots. It holds
  no state between runs beyond the per-instance records above.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a ritual using the on-shift strategy on dates with a published rota, 100%
  of assigned instances go to someone who is rostered for that date, and 0% go to someone
  who is not.
- **SC-002**: When a rota is published for dates whose instances already exist, those
  instances become assigned within one resolution cycle, and no manual step is needed to
  make that happen.
- **SC-003**: When a shift is swapped, a future untouched instance follows the swap within
  one resolution cycle, and both people involved know about the change without being told by
  a colleague.
- **SC-004**: A checklist that cannot be assigned because nobody is rostered is surfaced to a
  project owner on its scheduled date, so no ritual reaches its deadline with nobody aware
  it had no owner.
- **SC-005**: A manager can switch an existing ritual from round-robin to on-shift, and see
  its already-generated future instances reassigned to the rostered people, without deleting
  or recreating the definition.
- **SC-006**: Enabling on-shift on a definition does not slow instance generation to the
  point that a generation cycle fails to complete within its interval, for an organization
  with 200 definitions and a 30-day window.
- **SC-007**: Zero instances are lost or left permanently invisible by the new unassigned
  path: every instance awaiting resolution either becomes assigned or produces exactly one
  owner alert.

## Assumptions

- [ASSUMPTION: "A shift" means a calendar event with type `shift` and the working employees
  as its attendees. That event type and the attendee model already exist and shifts are the
  only place the product records who is working, so no new rota concept is introduced. This
  is the only reading that makes the user's "the schedule and the checklist exist but are not
  connected" true.]
- [ASSUMPTION: The candidate set stays scoped to the pool's department rather than the whole
  organization. On-shift is added as a strategy on the existing department pool, so "whoever
  is on shift" means "whoever in this department is on shift". A store's closing count should
  not fall to a rostered engineer.]
- [ASSUMPTION: When several people are on shift, least-assigned over the trailing 90 days
  breaks the tie. It reuses the fairness rule the product already states, and the alternative
  — advancing the round-robin waterline over a candidate set that changes shape every day —
  is neither fair nor explainable.]
- [ASSUMPTION: A declined shift means not working; a shift with no response means working.
  Requiring an explicit acceptance would leave most instances unassigned in organizations
  that publish rotas without expecting RSVPs, which is the common case for shifts.]
- [ASSUMPTION: The no-candidate outcome is "wait, then escalate", not "fall back to
  round-robin". A fallback would re-introduce exactly the defect being fixed — the closing
  count landing on someone who is not in — and would do so invisibly.]
- [ASSUMPTION: Re-resolution is bounded to instances that are still in the future, have no
  submitted evidence, and have not been manually reassigned. Reassigning an instance whose
  day has begun would move work away from someone already doing it, and overriding a
  manager's deliberate assignment would make the manual override useless.]
- [ASSUMPTION: The escalation goes to the project's owners and admins, matching the
  recipient set feature 040 already uses for the `missed` transition on an unassigned
  instance. There is no separate "rota manager" role to route it to.]
- [ASSUMPTION: The 7-day backfill horizon for suppressing the escalation is copied from the
  existing overdue/missed backfill horizon rather than introducing a second number, for the
  same reason: a first deployment must not alert an owner about every historical instance.]
- [ASSUMPTION: The resolution cycle runs on its own cadence rather than being folded into
  the 1-minute generation sweep or the 5-minute reconciliation sweep. A rota changes on a
  human timescale, and the existing sweeps have narrow, stated responsibilities that a third
  concern would blur. The exact interval is a planning decision; a cadence in minutes rather
  than hours is required for SC-002 and SC-003 to be true in practice.]
- [ASSUMPTION: Configuring the strategy is a web surface. The mobile app has no ritual
  department pool configuration today, so on-shift is added to the existing web selector.
  Mobile still needs the instance-level explanation from FR-019, because that is read by the
  worker and the on-call manager, who are on mobile.]
- [ASSUMPTION: Because the project takes breaking changes rather than compatibility layers,
  the strategy value is added to the existing constraint and contract in one coordinated
  change across backend, web and mobile; no dual-write or legacy strategy path is created.]
- [ASSUMPTION: Existing definitions are untouched by this change. Nothing is migrated to
  on-shift automatically — a manager opts a definition in, because only they know whether
  their rota is complete enough to drive assignment.]

## Dependencies

- **Shift events on the calendar.** The strategy is only as good as the rota. An
  organization that does not put shifts on the calendar gains nothing from it, and the
  awaiting-resolution and escalation paths are what make that failure visible rather than
  silent.
- **Existing department pool assignment.** This feature extends the pool mechanism resolved
  at generation time; it does not replace it.
- **Existing ritual generation and reconciliation sweeps.** The new resolution cycle sits
  alongside them and must not change their stated behaviour or their reported counters.
- **Existing overdue/missed alerting from feature 040.** The new owner alert must complement
  it, not duplicate it: one is "nobody could be assigned", the other is "the assigned work is
  late".
- **The tier ordering in `backend/docs/SYSTEM-ARCHITECTURE.md`.** Collaboration sits below
  calendar, so shift coverage has to reach ritual assignment without collaboration importing
  calendar. FR-022 states the constraint; the mechanism is a planning decision.

## Out of Scope

- Creating or editing shifts, publishing rotas, or any shift-management UI. Shifts are
  authored on the calendar as they are today.
- Shift swap requests, approvals, or coverage marketplaces.
- Assigning the reviewer or approver role from the rota. On-shift resolves the assignee slot
  only.
- Splitting one instance across several people on the same date, or assigning per shift
  rather than per date. A date resolves to one pool assignee, as it does today.
- Using working hours (`calendar.working_hours`) as a substitute for a shift. Working hours
  describe a normal week, not who is in on a given day, and treating them as a rota would
  reproduce the reported bug with an extra step.
- Retroactively correcting the assignee of past instances.
