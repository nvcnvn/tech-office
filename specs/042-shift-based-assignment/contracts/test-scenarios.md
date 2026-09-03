# Behavioural Contract: test scenarios

Constitution principle II makes these scenarios a **planning artifact**, not test code.
They are the behavioural contract for the feature and must be reviewed and approved before
`/speckit-tasks` runs and before any implementation begins.

Every User Story has at least one scenario. Every user-observable FR is traceable to at
least one scenario; the FR numbers appear as comments so `go test -v` output reads back as
a behaviour specification.

Backend integration tests live in `backend/integration/`. Web E2E tests live in
`frontend/apps/web/e2e/`. No unit, snapshot or component tests are added, per principle II
— the two existing pure-function exceptions in this area (`ritual_task_state_test.go`,
`ritual_schedule_classification.go`) are not extended by this feature.

---

## A. `backend/integration/calendar_shift_coverage_test.go` (NEW)

Covers the calendar half of the contract: the coverage rules of FR-003 and FR-004, driven
against the real database so recurrence, RSVP and cancellation behave as they do in
production.

```go
func TestCalendarShiftCoverage(t *testing.T) {
	// FR-003: a shift event covers a scheduled date when its span overlaps that date.
	t.Run("an employee on a shift that covers the day is reported as working", ...)
	t.Run("an employee whose shift is on a different day is not reported as working", ...)

	// FR-003: all-day and overnight shifts need no special-casing.
	t.Run("an all-day shift covers every date in its span", ...)
	t.Run("an overnight shift from Friday evening to Saturday morning covers both dates", ...)

	// FR-003: cancellation is a soft state and must be honoured.
	t.Run("a cancelled shift event covers nobody", ...)

	// FR-004: a declined shift is not work.
	t.Run("an employee who declined the shift invitation is not reported as working", ...)
	t.Run("an employee who has not responded to the shift is reported as working", ...)
	t.Run("an employee who accepted or is tentative is reported as working", ...)

	// FR-003: recurring series occurrences and their exceptions.
	t.Run("an occurrence generated from a recurring shift series is reported as working", ...)
	t.Run("an occurrence cancelled by a recurrence exception is not reported as working", ...)
	t.Run("a moved occurrence is reported on its new date and not on its original date", ...)

	// FR-002 boundary: the reader narrows the candidate list, it never widens it.
	t.Run("an employee on shift who is not in the candidate list is not returned", ...)
	t.Run("an empty candidate list returns nobody without querying", ...)

	// FR-021: rituals read the rota, they never write it.
	t.Run("reading coverage does not create modify or delete any calendar event", ...)

	// Research R4 / R5.
	t.Run("the organiser of a shift is not reported as working unless also an attendee", ...)
	t.Run("a shift marked private still reports its attendees as working", ...)
	t.Run("an event that is not of type shift never contributes coverage", ...)
}
```

---

## B. `backend/integration/collaboration_ritual_shift_assignment_test.go` (NEW)

Covers the collaboration half. The `ShiftCoverageReader` is the **real** `calendar.Logic`,
injected with `SetShiftCoverageReader`, so these scenarios exercise the whole path rather
than a stub of it.

```go
func TestRitualOnShiftAssignment(t *testing.T) {

	// ── User Story 1: the closing checklist goes to whoever is closing ──────────
	// FR-001, FR-002, FR-005
	t.Run("a daily ritual assigns Monday Wednesday Friday to the member rostered those days", ...)
	t.Run("the same ritual assigns Tuesday and Thursday to the member rostered those days", ...)
	t.Run("nobody who is off on a date is ever assigned that date's instance", ...)

	// FR-006: several people rostered, deterministic least-assigned tiebreak.
	t.Run("when three members cover the same date exactly one is assigned", ...)
	t.Run("the member with the fewest ritual assignments in the last ninety days is chosen", ...)
	t.Run("resolving twice over unchanged data chooses the same member both times", ...)

	// FR-004 at the assignment level.
	t.Run("a member who declined their covering shift is not assigned the instance", ...)
	// FR-003 at the assignment level.
	t.Run("a member whose covering shift was cancelled is not assigned the instance", ...)

	// FR-007: the strategy governs the pool slot only.
	t.Run("named individual assignees are still assigned alongside the pool slot", ...)
	t.Run("a round robin pool on another definition behaves exactly as before", ...)
	t.Run("a least assigned pool on another definition behaves exactly as before", ...)

	// FR-002 edge cases from the spec.
	t.Run("a rostered employee who has left the pool department is not eligible", ...)
	t.Run("a rostered employee who is deactivated is not eligible", ...)

	// FR-003 timezone edge case.
	t.Run("a ritual in Asia Tokyo and a shift stored in UTC agree on which date is covered", ...)

	// ── User Story 2: no published rota means wait, never guess ─────────────────
	// FR-008, FR-016
	t.Run("an instance for a date with no rota is created with its pool slot unassigned", ...)
	t.Run("that instance records that its pool slot is awaiting shift resolution", ...)
	t.Run("no fallback to round robin or least assigned is applied when nobody is rostered", ...)
	t.Run("a failure to read the shift calendar still creates the instance and never guesses", ...)
	t.Run("a nil shift coverage reader leaves the slot awaiting resolution and logs", ...)

	// FR-009, FR-011: the resolution cycle binds late.
	t.Run("publishing a covering shift assigns the waiting instance within one resolution pass", ...)
	t.Run("the newly assigned employee is notified that the instance is now theirs", ...)
	t.Run("a thirty day window with no rota leaves every pool slot awaiting and nobody assigned", ...)
	t.Run("publishing one week of shifts assigns exactly those seven instances", ...)

	// FR-013: escalation on the scheduled date, exactly once.
	t.Run("an instance still unresolved on its scheduled date stops awaiting resolution", ...)
	t.Run("the project owners and admins are alerted that it could not be assigned", ...)
	t.Run("running the resolution pass twice produces exactly one owner alert", ...)
	t.Run("the alert is suppressed for a scheduled date more than seven days in the past", ...)
	t.Run("the state change still happens for a suppressed alert", ...)

	// ── User Story 3: a shift swap moves the checklist with it ──────────────────
	// FR-012
	t.Run("moving the covering shift to another member reassigns a future instance", ...)
	t.Run("the previous assignee is notified that the instance is no longer theirs", ...)
	t.Run("the new assignee is notified that the instance is now theirs", ...)
	t.Run("removing the only covering shift withdraws the assignment and returns it to awaiting", ...)

	// FR-010: the freeze rules.
	t.Run("an instance whose scheduled date has arrived is not reassigned when shifts change", ...)
	t.Run("an instance with submitted evidence is not reassigned even when still in the future", ...)
	t.Run("an instance whose assignee a manager changed by hand is never re-resolved", ...)

	// FR-014: idempotency under overlap.
	t.Run("two overlapping resolution passes assign the instance once", ...)
	t.Run("two overlapping resolution passes send no duplicate notification", ...)
	t.Run("a resolution pass that changes nothing sends no notification", ...)

	// FR-015: bounded, ordered, failure-tolerant.
	t.Run("a resolution pass processes a bounded batch ordered by scheduled date ascending", ...)
	t.Run("a failing organization does not stop the remaining organizations", ...)
	t.Run("a failing instance does not stop the organization's remaining instances", ...)
	t.Run("a large backlog drains across several passes rather than failing one", ...)

	// Spec edge cases: strategy switching and multiple pools.
	t.Run("switching a definition from round robin to on shift re-resolves its future instances", ...)
	t.Run("switching to on shift leaves past and started instances with their existing assignee", ...)
	t.Run("switching away from on shift assigns waiting slots under the newly chosen strategy", ...)
	t.Run("two pools with different strategies on one definition resolve independently", ...)
	t.Run("one pool awaiting resolution does not block the other pool's assignment", ...)
	t.Run("emptying the pool's department leaves the slot awaiting and then escalates", ...)

	// FR-020: the existing lateness machinery is untouched.
	t.Run("an on shift assigned instance still goes overdue and missed as before", ...)
	t.Run("an instance still awaiting resolution still escalates to owners on the missed transition", ...)
	t.Run("the unassigned alert and the missed alert are distinct notification types", ...)

	// FR-019 at the API level.
	t.Run("a waiting instance reports its pool assignment state as awaiting shift", ...)
	t.Run("an assigned instance reports its pool assignment state as resolved", ...)
	t.Run("a task that is not an on shift ritual instance reports unspecified", ...)
	t.Run("an instance with one waiting pool and one resolved pool reports awaiting shift", ...)

	// FR-021 boundary.
	t.Run("resolution never creates modifies or deletes a shift event", ...)
}
```

### Constant synchronization (Constitution VIII.4)

Added to the existing cross-stack constant test rather than a new file:

```go
	t.Run("the on shift strategy constant matches the database check constraint", ...)
	t.Run("every pool assignment state constant matches the database check constraint", ...)
	t.Run("every pool assignment state constant maps to a RitualPoolAssignmentState enum value", ...)
	t.Run("ritual_instance_unassigned is accepted by the notification type check constraint", ...)
```

### Deliberately excluded from testing scope

- **SC-006 (200 definitions, 30-day window, inside one interval).** Not asserted as a test.
  A wall-clock assertion in the integration suite is flaky on shared CI and would be the
  first test disabled. It is instead a documented operational check in
  [../quickstart.md](../quickstart.md) §7, run against a seeded database, and the sweep's
  structured log line carries the counters that make a regression visible in production.
- **The 2-minute sweep cadence itself.** Tests drive `Sweep(ctx, now)` directly with an
  injected clock, exactly as the generation and reconciliation suites do; asserting that
  `flows` fires a timer is testing the scheduler, not this feature.

---

## C. `frontend/apps/web/e2e/ritual-shift-assignment.spec.ts` (NEW)

Covers User Story 4 from the browser. Uses the existing helpers in
`frontend/apps/web/e2e/helpers` and `test-ritual.ts`.

```ts
test.describe('Ritual assignment follows the shift', () => {
	// FR-017, User Story 4 AC1
	test('on-shift appears in the strategy selector alongside round-robin and least-assigned', ...);
	test('selecting on-shift, saving and reloading keeps the strategy on the pool', ...);

	// FR-018, User Story 4 AC2
	test('a pool set to on-shift states that assignment depends on shift events for that department', ...);

	// FR-019, User Story 4 AC3
	test('an instance awaiting shift resolution explains that nobody is rostered for its date', ...);
	test('an instance with no assignee configured does not show the waiting-for-rota explanation', ...);

	// SC-005 from the manager's seat.
	test('switching an existing ritual from round-robin to on-shift keeps the definition intact', ...);
});
```

### Mobile

Mobile gains the FR-019 banner on the ritual instance detail screen only; strategy
configuration stays web-only (Constitution XIII). It is covered by the API-level scenarios
in section B (`a waiting instance reports its pool assignment state as awaiting shift`) plus
manual verification on **both** Android and iOS, since a narrow-Android regression would not
show on the habitual iPhone SE test device.
