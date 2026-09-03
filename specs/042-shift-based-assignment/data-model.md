# Phase 1 Data Model: Ritual Assignment Follows the Shift

All DDL below is written as it will appear in the new forward migration
`backend/database/migrations/20260904HHMMSS_ritual_on_shift_assignment.up.sql`.
`backend/database/scripts/schema.sql` is **regenerated** from the migrations by
`backend/scripts/regen-schema.sh` and is never hand-edited.

---

## 1. Changed: `collaboration.ritual_definition_department_pool`

One column's CHECK constraint gains a third value. Nothing else about the table changes.

```sql
ALTER TABLE collaboration.ritual_definition_department_pool
    DROP CONSTRAINT IF EXISTS ritual_definition_department_pool_assignment_strategy_check;

ALTER TABLE collaboration.ritual_definition_department_pool
    ADD CONSTRAINT ritual_definition_department_pool_assignment_strategy_check
        CHECK (assignment_strategy IN ('round_robin', 'least_assigned', 'on_shift'));
```

`last_assigned_employee_id` keeps serving `round_robin` only. Under `on_shift` it is neither
read nor written — the waterline has no meaning when the candidate set changes shape every
day, and advancing it would corrupt the round-robin cycle if the pool were switched back.

**Breaking-change note**: this widens an existing constraint, so no data migration is
needed and no existing row becomes invalid. Existing definitions are untouched; a manager
opts a pool in.

---

## 2. New: `collaboration.ritual_instance_pool_assignment`

One row per (ritual instance, department pool) governed by the `on_shift` strategy. This is
the record that makes late binding, exactly-once escalation and the "why is this
unassigned" explanation all answerable without re-deriving them from the calendar.

```sql
CREATE TABLE IF NOT EXISTS collaboration.ritual_instance_pool_assignment (
    id UUID NOT NULL DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id),

    -- The ritual instance whose pool slot this row governs.
    task_id UUID NOT NULL,
    -- The department pool that owns the slot. One instance can carry several.
    pool_id UUID NOT NULL,

    resolution_state TEXT NOT NULL DEFAULT 'awaiting_shift'
        CHECK (resolution_state IN ('resolved', 'awaiting_shift', 'closed_unresolved')),

    -- Why a closed row stopped being re-resolved. NULL unless closed.
    closed_reason TEXT NULL
        CHECK (closed_reason IN ('no_roster', 'manual_override')),

    -- The employee THIS feature put in the slot. NULL while awaiting or after withdrawal.
    -- Deliberately no FK, for the same reason last_assigned_employee_id has none: the
    -- employee may leave the department or the organization and the record must survive
    -- that, because it is what proves the slot was not changed by a person.
    assigned_employee_id UUID NULL,

    -- The instant the instance's scheduled date begins, in the ritual definition's own
    -- timezone. One column, two jobs:
    --   * resolution is attempted only while now() < resolve_by  (FR-010 "still future")
    --   * escalation fires once now() >= resolve_by              (FR-013 "date arrived")
    -- Storing the instant rather than the date keeps every sweep predicate free of
    -- timezone arithmetic in SQL.
    resolve_by TIMESTAMPTZ NOT NULL,

    resolved_at TIMESTAMPTZ NULL,
    escalated_at TIMESTAMPTZ NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_ripa PRIMARY KEY (organization_id, id),

    CONSTRAINT fk_ripa_task
        FOREIGN KEY (organization_id, task_id)
        REFERENCES collaboration.task(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_ripa_pool
        FOREIGN KEY (organization_id, pool_id)
        REFERENCES collaboration.ritual_definition_department_pool(organization_id, id)
        ON DELETE CASCADE,

    CONSTRAINT uq_ripa_instance_pool
        UNIQUE (organization_id, task_id, pool_id),

    -- A resolved row names its assignee; a closed row names its reason.
    CONSTRAINT chk_ripa_resolved_has_assignee
        CHECK (resolution_state <> 'resolved' OR assigned_employee_id IS NOT NULL),
    CONSTRAINT chk_ripa_closed_has_reason
        CHECK (resolution_state <> 'closed_unresolved' OR closed_reason IS NOT NULL)
);

-- The sweep's working set: rows still eligible to change. Partial, because a closed row is
-- never read again by the sweep and there will eventually be far more of those than of
-- live ones.
CREATE INDEX IF NOT EXISTS idx_ripa_open
    ON collaboration.ritual_instance_pool_assignment (organization_id, resolve_by, id)
    WHERE resolution_state IN ('awaiting_shift', 'resolved');

-- Reading the state back for a batch of tasks (FR-019).
CREATE INDEX IF NOT EXISTS idx_ripa_task
    ON collaboration.ritual_instance_pool_assignment (organization_id, task_id);
```

**Tenancy checklist** (Constitution I): `organization_id` present and `NOT NULL`; primary
key and unique key both lead with it; both foreign keys are composite and lead with it;
every query against the table pins it or carries a `-- lint:cross-tenant` marker.

`ON DELETE CASCADE` from the pool is deliberate: removing the pool from the definition
removes the slot, so the row that tracked it has nothing left to describe.

### Fields

| Field | Type | Notes |
|---|---|---|
| `id` | UUID v7 | `DEFAULT uuidv7()` |
| `organization_id` | UUID | tenant key, leading column everywhere |
| `task_id` | UUID | the ritual instance; composite FK, `ON DELETE CASCADE` |
| `pool_id` | UUID | the department pool; composite FK, `ON DELETE CASCADE` |
| `resolution_state` | TEXT | `resolved` \| `awaiting_shift` \| `closed_unresolved` |
| `closed_reason` | TEXT NULL | `no_roster` \| `manual_override`; required iff closed |
| `assigned_employee_id` | UUID NULL | who this feature assigned; no FK by design |
| `resolve_by` | TIMESTAMPTZ | start of the scheduled date in the definition's timezone |
| `resolved_at` | TIMESTAMPTZ NULL | when the current assignment was made |
| `escalated_at` | TIMESTAMPTZ NULL | when the owner alert was published |
| `updated_at` | TIMESTAMPTZ | maintained by the writes, as elsewhere in this schema |

### State machine

```text
                     ┌──────────────────────────────────────────┐
                     │                                          │
 (generation, no     ▼                                          │ covering shift found
  candidate)   ┌───────────────┐    covering shift found   ┌──────────────┐
 ────────────► │ awaiting_shift│ ────────────────────────► │   resolved   │
               └───────────────┘                           └──────────────┘
                     │    ▲                                     │      │
                     │    │ assignee's shift removed,           │      │
                     │    │ nobody else covers (withdraw)       │      │
                     │    └─────────────────────────────────────┘      │
                     │                                                 │
   now >= resolve_by │                        assignee row missing     │
   (escalate once)   │                        → a person changed it    │
                     ▼                                                 ▼
              ┌──────────────────────────┐              ┌──────────────────────────┐
              │ closed_unresolved        │              │ closed_unresolved        │
              │ closed_reason=no_roster  │              │ reason=manual_override   │
              └──────────────────────────┘              └──────────────────────────┘
```

Additional transitions that are not state changes:

- **resolved → resolved (different assignee)**: a shift swap. The previous assignee's
  `task_assignee` row is withdrawn, the new one is written, `assigned_employee_id` and
  `resolved_at` are updated, and both people are notified (FR-012).
- **any → row deleted**: the pool's strategy is no longer `on_shift`, or the pool itself was
  removed. An unresolved row is first assigned under the pool's new strategy (the edge case
  "switched away from on-shift"), then deleted.

`closed_unresolved` is terminal. Nothing in the resolution pass leaves it, which is what
makes the owner alert fire exactly once (FR-013) and what stops a manual override being
undone by the next pass (FR-010).

### Invariants

1. At most one row per `(organization_id, task_id, pool_id)` — enforced by `uq_ripa_instance_pool`.
2. `resolution_state = 'resolved'` implies `assigned_employee_id IS NOT NULL` — enforced by CHECK.
3. `resolution_state = 'closed_unresolved'` implies `closed_reason IS NOT NULL` — enforced by CHECK.
4. `escalated_at IS NOT NULL` implies `closed_reason = 'no_roster'` — enforced in the logic
   layer, not by a constraint, because a manual override closes without an alert.
5. A row exists only for a pool whose strategy is (or was) `on_shift`. Rows for pools that
   have moved to another strategy are removed by the next resolution pass.

---

## 3. Derived, not stored: shift coverage

Shift coverage is a **query**, never a table. Given an organization, a candidate employee
list and a half-open UTC instant interval, it answers "which of these employees has a
non-cancelled shift event overlapping this interval, and has not declined it". The calendar
remains the single source of truth for the rota; nothing in `collaboration` mirrors it.

Coverage rules (FR-003, FR-004), all evaluated in `internal/calendar`:

| Situation | Covered? |
|---|---|
| Non-recurring shift, `[start, end)` overlaps the interval | yes |
| All-day shift spanning the date | yes — the stored `start_time`/`end_time` already span it |
| Overnight shift 22:00 Fri → 06:00 Sat | yes, for **both** Friday and Saturday intervals |
| Occurrence of a recurring shift series | yes — expanded from the RRULE |
| Occurrence with a `cancelled` or `skipped` recurrence exception | no |
| Occurrence with a `modified` exception | the replacement event decides, not the original |
| Event with `cancelled_at IS NOT NULL` | no |
| Attendee with `rsvp_status = 'declined'` | no |
| Attendee with `pending`, `accepted` or `tentative` | yes |
| Event organiser who is not also an attendee | no (see research R4) |
| Event of any `event_type` other than `shift` | no |

---

## 4. Entity relationships

```text
collaboration.ritual_definition
        │ 1
        │
        │ n
collaboration.ritual_definition_department_pool ──── organization.department
        │ 1                    (assignment_strategy: round_robin | least_assigned | on_shift)
        │
        │ n
collaboration.ritual_instance_pool_assignment
        │ n
        │
        │ 1
collaboration.task  (task_kind = 'ritual_instance')
        │ 1
        │ n
collaboration.task_assignee  (role = 'assignee')

                    ── read across the domain boundary, never joined ──
calendar.event (event_type = 'shift')  ──1:n──  calendar.attendee
        │
        └── calendar.recurrence_exception (series_id, original_start_time)
```

The dashed boundary is the whole point of FR-022: `collaboration` reaches the calendar's
rota only through the `ShiftCoverageReader` interface it declares itself, never through SQL.
