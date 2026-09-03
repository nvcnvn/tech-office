# Contract: `ShiftCoverageReader` — the cross-domain inversion of control

This is the contract that satisfies **FR-022**. `internal/collaboration` must learn who is
working without importing `internal/calendar`, because the tier ordering in
`backend/docs/SYSTEM-ARCHITECTURE.md` puts collaboration below calendar and the calendar
already depends on collaboration (`CollaborationOverlayReader`, used by `ListOverlayItems`).

The direction is inverted the same way the calendar already inverts its own dependencies:
**the consumer declares the interface, the provider implements it, `cmd/server.go` wires
them.**

---

## 1. Declared by the consumer — `internal/collaboration/logic.go`

```go
// ShiftCoverageReader answers "which of these employees is working during this interval",
// from shift events on the calendar. Declared here and implemented by calendar.Logic so
// that collaboration never imports calendar: the tier ordering in
// backend/docs/SYSTEM-ARCHITECTURE.md puts collaboration below calendar, and the calendar
// already depends on this package for overlay items.
//
// The interval is a half-open [dayStart, dayEnd) pair of UTC instants, already resolved
// from the ritual definition's own timezone by the caller. Keeping the timezone on this
// side is what lets a ritual in Asia/Tokyo and a shift stored in UTC agree without either
// domain learning the other's rules.
//
// A nil reader is a supported state, not a bug: seed and test harnesses construct
// collaboration logic without a calendar. Callers treat nil exactly as they treat an error
// — the slot is left awaiting shift resolution and nothing is guessed (FR-016).
type ShiftCoverageReader interface {
	EmployeesOnShift(
		ctx context.Context,
		tx database.DBTX,
		orgID dbuuid.UUID,
		candidateEmployeeIDs []dbuuid.UUID,
		dayStart, dayEnd time.Time,
	) ([]dbuuid.UUID, error)
}
```

Added to the `Logic` interface in the same file:

```go
	// SetShiftCoverageReader injects the calendar's shift coverage read. It is a setter
	// rather than a NewLogic parameter because cmd/server.go constructs collaboration
	// before calendar — calendar.NewLogic takes collaborationLogic — so a constructor
	// argument would be a cycle. organization.Logic.SetCollaborationLogic exists for the
	// same reason.
	SetShiftCoverageReader(reader ShiftCoverageReader)
```

### Behavioural contract

| Aspect | Guarantee |
|---|---|
| Input `candidateEmployeeIDs` | The pool department's currently active members. The reader does not widen it; department membership is the caller's rule (FR-002). |
| Input interval | Half-open `[dayStart, dayEnd)`, UTC instants. `dayEnd` is exclusive. |
| Empty `candidateEmployeeIDs` | Returns an empty slice and no error, without touching the database. |
| Output | A subset of `candidateEmployeeIDs`, deduplicated, in ascending UUID order. Ordering is guaranteed so that a caller's tiebreak is reproducible (FR-006). |
| Purity | Read-only. The reader never creates, modifies or deletes a calendar event (FR-021). |
| Transaction | Runs on the `tx` it is handed, so generation stays inside one transaction and never nests one (Constitution IV). |
| Errors | Returned, never swallowed. The caller's response to any error is identical to its response to "nobody is covered": leave the slot awaiting resolution, log, never guess (FR-016). |

---

## 2. Implemented by the provider — `internal/calendar/shift_coverage_logic.go`

Added to the `Logic` interface in `internal/calendar/logic.go` under a new
`── Shift Coverage ──` section, and implemented on `logicImpl`.

```go
func (l *logicImpl) EmployeesOnShift(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	candidateEmployeeIDs []dbuuid.UUID,
	dayStart, dayEnd time.Time,
) ([]dbuuid.UUID, error)
```

Algorithm:

1. Return early on an empty candidate list.
2. `ListShiftCoverageDirect` — non-recurring shift events (and materialised exception
   instances) that overlap `[dayStart, dayEnd)`, joined to their attendees, filtered to the
   candidate list, `event_type = 'shift'`, `cancelled_at IS NULL`,
   `rsvp_status <> 'declined'`. Mark every returned employee as covered.
3. `ListShiftCoverageSeries` — series heads with `recurrence_rule IS NOT NULL` whose
   `[start_time, COALESCE(recurrence_end, 'infinity'))` could reach the interval, with the
   same shift/cancelled/attendee/declined filters. For each series head:
   - `expandInstances(rule, head.StartTime, dayStart - seriesDuration, dayEnd)` — the window
     is widened backwards by the series' own duration so an occurrence that *starts* before
     `dayStart` but *ends* inside the interval (the overnight shift) is not missed;
   - `applyExceptions(...)` with the series' `calendar.recurrence_exception` rows, which
     drops `skipped` and `cancelled` occurrences and drops `modified` ones (their
     replacement event is a concrete row already returned by step 2);
   - keep the occurrence when `[occStart, occStart+duration)` overlaps `[dayStart, dayEnd)`;
     mark that series' non-declined candidate attendees as covered.
4. Return the covered set, sorted ascending.

`expandInstances` and `applyExceptions` already exist in `internal/calendar/recurrence.go`
and currently have no callers; this is their first use. No second recurrence expander is
written.

### Why the candidate list crosses as a `uuid[]`

`organization.department_member` lives in another schema. Passing the resolved member IDs as
an array keeps the coverage query inside the `calendar` schema (`event` ⋈ `attendee`) and
avoids the cross-schema join Constitution I and IV both forbid.

---

## 3. Wiring — `backend/cmd/server.go`

`collaborationLogic` is built at ~line 460; `calendarLogic` at ~line 537. The injection goes
immediately after the calendar logic exists and before any sweep that needs it is scheduled:

```go
	calendarLogic := calendar.NewLogic(queries, notificationService, collaborationLogic, docsLogic)

	// Feature 042: rituals read the rota. The edge points collaboration → calendar, which
	// inverts the tier ordering, so it is expressed as an interface collaboration declares
	// and calendar satisfies. It is a setter because calendar.NewLogic above already
	// consumes collaborationLogic; a constructor argument here would be a cycle.
	collaborationLogic.SetShiftCoverageReader(calendarLogic)
```

The `ritual_shift_resolution_sweep` bootstrap (see `proto-and-sql.md`) is registered after
this line so that the first pass can never run against a nil reader in a live server.

### Nil-reader call sites

| Call site | Reader | Consequence |
|---|---|---|
| `cmd/server.go` | `calendarLogic` | full behaviour |
| `cmd/seed_demo.go` | nil | on-shift pools resolve to `awaiting_shift`; seed data is unaffected because it uses no on-shift pool |
| `backend/integration/helper_test.go` existing helpers | nil | unchanged behaviour for all pre-existing tests |
| new integration tests | `calendar.NewLogic(globalQ, nil, nil, nil)` | exercises the real recurrence, RSVP and cancellation rules end to end |

---

## 4. Documentation obligation

Adding an inverted edge between two domains changes the architecture, so
`backend/docs/SYSTEM-ARCHITECTURE.md` gains this edge and the reason for its direction, and
`docs/domain/calendar.md` gains the shift-coverage read alongside the existing
`ListOverlayItems` note about the collaboration dependency. Constitution XII, enforced by
the `after_implement` `speckit.docs.snapshot` hook.
