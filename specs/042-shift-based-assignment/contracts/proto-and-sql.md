# Contract: proto, SQL and constant deltas

Everything a client or another layer can observe. Grouped by the layer it lives in, in the
order Constitution VIII requires a string constant to be changed: database CHECK → Go
constants → proto → TypeScript.

---

## 1. Database — migration `20260904HHMMSS_ritual_on_shift_assignment.up.sql`

Three statements plus the new table. Full DDL for the table and its indexes is in
[../data-model.md](../data-model.md); only the constraint changes are repeated here.

```sql
-- 1. The third strategy.
ALTER TABLE collaboration.ritual_definition_department_pool
    DROP CONSTRAINT IF EXISTS ritual_definition_department_pool_assignment_strategy_check;
ALTER TABLE collaboration.ritual_definition_department_pool
    ADD CONSTRAINT ritual_definition_department_pool_assignment_strategy_check
        CHECK (assignment_strategy IN ('round_robin', 'least_assigned', 'on_shift'));

-- 2. The late-binding record. See data-model.md §2.
CREATE TABLE IF NOT EXISTS collaboration.ritual_instance_pool_assignment ( ... );
CREATE INDEX IF NOT EXISTS idx_ripa_open ...;
CREATE INDEX IF NOT EXISTS idx_ripa_task ...;

-- 3. The new notification type.
ALTER TABLE notification.notification
    DROP CONSTRAINT IF EXISTS notification_notification_type_valid;
ALTER TABLE notification.notification
    ADD CONSTRAINT notification_notification_type_valid
        CHECK (notification_type IN (
            'message','mention','reply','typing','reaction',
            'voice_call_incoming','voice_call_started','voice_call_updated','voice_call_ended',
            'task_assigned','task_status_changed','task_commented','task_mentioned',
            'task_description_modified','task_updated',
            'doc_updated','doc_commented','doc_mentioned',
            'evidence_submitted','evidence_approved','evidence_rejected',
            'ritual_instances_scheduled','ritual_instance_overdue','ritual_instance_missed',
            'ritual_instance_unassigned',
            'calendar_event_invite','calendar_event_cancel','calendar_event_change',
            'calendar_event_reminder','calendar_check_in_missed','calendar_event_digest',
            'account_removal_requested'
        ));
```

Then `backend/scripts/regen-schema.sh` regenerates `backend/database/scripts/schema.sql`.
It is a generated snapshot and is never hand-edited.

---

## 2. New sqlc queries — `backend/database/scripts/collaboration.query.sql`

### 2.1 Pool assignment record CRUD

```sql
-- name: UpsertRitualPoolAssignment :one
-- Written by generation and by the resolution pass's adoption path. ON CONFLICT keeps
-- generation idempotent: a re-run over a date whose instance already exists must not
-- create a second slot record.
INSERT INTO collaboration.ritual_instance_pool_assignment (
    organization_id, task_id, pool_id, resolution_state,
    assigned_employee_id, resolve_by, resolved_at, updated_at
) VALUES (
    @organization_id, @task_id, @pool_id, @resolution_state,
    @assigned_employee_id, @resolve_by, @resolved_at, @updated_at
)
ON CONFLICT (organization_id, task_id, pool_id) DO NOTHING
RETURNING *;

-- name: ResolveRitualPoolAssignment :one
-- Compare-and-set: only a row still in the state the decision was made from is written.
-- Two overlapping passes therefore assign once (FR-014).
UPDATE collaboration.ritual_instance_pool_assignment
SET resolution_state = 'resolved',
    assigned_employee_id = @assigned_employee_id,
    resolved_at = @now,
    closed_reason = NULL,
    updated_at = @now
WHERE organization_id = @organization_id
  AND id = @id
  AND resolution_state = @expected_state
RETURNING *;

-- name: WithdrawRitualPoolAssignment :one
-- Back to awaiting: the assignee's covering shift disappeared and nobody else covers.
UPDATE collaboration.ritual_instance_pool_assignment
SET resolution_state = 'awaiting_shift',
    assigned_employee_id = NULL,
    resolved_at = NULL,
    updated_at = @now
WHERE organization_id = @organization_id
  AND id = @id
  AND resolution_state = 'resolved'
RETURNING *;

-- name: CloseRitualPoolAssignment :one
-- The once-only transition. The owner alert is published if and only if this returns a row.
UPDATE collaboration.ritual_instance_pool_assignment
SET resolution_state = 'closed_unresolved',
    closed_reason = @closed_reason,
    escalated_at = @escalated_at,
    updated_at = @now
WHERE organization_id = @organization_id
  AND id = @id
  AND resolution_state = @expected_state
RETURNING *;

-- name: DeleteRitualPoolAssignment :exec
-- The pool is no longer on-shift; the row has nothing left to describe.
DELETE FROM collaboration.ritual_instance_pool_assignment
WHERE organization_id = @organization_id AND id = @id;
```

### 2.2 Discovery

```sql
-- lint:cross-tenant scheduler sweep — the organization list is the result, not the input
-- name: ListOrganizationIDsWithResolvableRitualPoolAssignments :many
SELECT DISTINCT organization_id
FROM collaboration.ritual_instance_pool_assignment
WHERE resolution_state IN ('awaiting_shift', 'resolved')
ORDER BY organization_id;

-- name: ListRitualPoolSlotsForResolution :many
-- One query serves three of the spec's cases, which is why it is a LEFT JOIN:
--   * a row generation already created            → a.id IS NOT NULL, state awaiting/resolved
--   * a pool just switched TO on_shift            → a.id IS NULL, adopt it
--   * a resolved row whose rota moved             → a.id IS NOT NULL, state resolved
-- The scheduled_date floor is a coarse prefilter only: no timezone on earth moves a date
-- by more than a day, so a genuinely-future instance can never be excluded by it. The
-- exact "still in the future" test is now < resolve_by, applied in Go.
SELECT
    p.id                AS pool_id,
    p.department_id,
    p.assignment_strategy,
    t.id                AS task_id,
    t.project_id,
    t.scheduled_date,
    d.id                AS ritual_definition_id,
    d.name              AS ritual_name,
    d.timezone,
    d.created_by_employee_id,
    a.id                AS assignment_id,
    a.resolution_state,
    a.assigned_employee_id,
    a.resolve_by,
    EXISTS (
        SELECT 1 FROM collaboration.evidence_submission es
        WHERE es.organization_id = t.organization_id AND es.task_id = t.id
    ) AS has_evidence
FROM collaboration.ritual_definition_department_pool p
JOIN collaboration.ritual_definition d
    ON (d.organization_id, d.id) = (p.organization_id, p.ritual_definition_id)
JOIN collaboration.task t
    ON (t.organization_id, t.ritual_definition_id) = (d.organization_id, d.id)
LEFT JOIN collaboration.ritual_instance_pool_assignment a
    ON (a.organization_id, a.task_id, a.pool_id) = (t.organization_id, t.id, p.id)
WHERE p.organization_id = @organization_id
  AND t.task_kind = 'ritual_instance'
  AND t.is_deleted = FALSE
  AND t.detached_from_ritual = FALSE
  AND t.scheduled_date >= @scheduled_date_floor
  AND (
        (p.assignment_strategy = 'on_shift'
             AND (a.id IS NULL OR a.resolution_state IN ('awaiting_shift', 'resolved')))
     OR (p.assignment_strategy <> 'on_shift' AND a.id IS NOT NULL)
      )
ORDER BY t.scheduled_date ASC, t.id ASC, p.id ASC
LIMIT @slot_limit;

-- name: ListRitualPoolAssignmentsDueEscalation :many
-- An awaiting slot whose scheduled date has arrived. resolve_by is stored as an instant in
-- the definition's timezone, so this predicate needs no timezone arithmetic.
SELECT a.*, t.project_id, d.name AS ritual_name
FROM collaboration.ritual_instance_pool_assignment a
JOIN collaboration.task t
    ON (t.organization_id, t.id) = (a.organization_id, a.task_id)
LEFT JOIN collaboration.ritual_definition d
    ON (d.organization_id, d.id) = (t.organization_id, t.ritual_definition_id)
WHERE a.organization_id = @organization_id
  AND a.resolution_state = 'awaiting_shift'
  AND a.resolve_by <= @now
ORDER BY a.resolve_by ASC, a.id ASC
LIMIT @slot_limit;

-- name: ListRitualPoolAssignmentStatesForTasks :many
-- Batched read for FR-019. One query per page of tasks, not one per task.
SELECT task_id, resolution_state
FROM collaboration.ritual_instance_pool_assignment
WHERE organization_id = @organization_id
  AND task_id = ANY(@task_ids::uuid[]);
```

### 2.3 Candidate selection

```sql
-- name: GetLeastAssignedEmployeeAmongCandidates :one
-- FR-006: fewest ritual instances in the trailing window, ties broken by lowest employee
-- UUID so a repeated resolution on unchanged data returns the same answer.
--
-- Unlike GetLeastAssignedDepartmentEmployee this takes the candidate set as an array, so it
-- needs no join into organization.department_member — the caller has already applied both
-- department membership and shift coverage.
SELECT c.employee_id
FROM UNNEST(@candidate_ids::uuid[]) AS c(employee_id)
LEFT JOIN (
    SELECT ta.employee_id, COUNT(*) AS cnt
    FROM collaboration.task_assignee ta
    JOIN collaboration.task t
        ON (t.organization_id, t.id) = (ta.organization_id, ta.task_id)
    WHERE ta.organization_id = @organization_id
      AND t.task_kind = 'ritual_instance'
      AND ta.assigned_at >= @since
    GROUP BY ta.employee_id
) recent ON recent.employee_id = c.employee_id
ORDER BY COALESCE(recent.cnt, 0) ASC, c.employee_id ASC
LIMIT 1;

-- name: TaskAssigneeExists :one
-- FR-010's manual-override test: is the employee this feature assigned still in the slot?
SELECT EXISTS (
    SELECT 1 FROM collaboration.task_assignee
    WHERE organization_id = @organization_id
      AND task_id = @task_id
      AND employee_id = @employee_id
      AND role = 'assignee'
);
```

---

## 3. New sqlc queries — `backend/database/scripts/calendar.query.sql`

```sql
-- name: ListShiftCoverageDirect :many
-- Concrete shift events overlapping the interval, with the candidate attendees who have
-- not declined. Bounds are named for the RANGE, matching ListEventsForEmployee's convention.
SELECT DISTINCT at.employee_id
FROM calendar.event e
JOIN calendar.attendee at
    ON (at.organization_id, at.event_id) = (e.organization_id, e.id)
WHERE e.organization_id = @organization_id
  AND e.event_type = 'shift'
  AND e.cancelled_at IS NULL
  AND e.recurrence_rule IS NULL
  AND e.start_time < @range_end
  AND e.end_time > @range_start
  AND at.employee_id = ANY(@candidate_ids::uuid[])
  AND at.rsvp_status <> 'declined';

-- name: ListShiftCoverageSeries :many
-- Recurring shift series that could reach the interval, with their non-declined candidate
-- attendees. Occurrence-level filtering happens in Go: expandInstances + applyExceptions in
-- internal/calendar/recurrence.go already implement RRULE expansion and the stored
-- exception rules, and this is their first caller.
SELECT e.id, e.series_id, e.start_time, e.end_time, e.all_day,
       e.recurrence_rule, e.recurrence_end, at.employee_id
FROM calendar.event e
JOIN calendar.attendee at
    ON (at.organization_id, at.event_id) = (e.organization_id, e.id)
WHERE e.organization_id = @organization_id
  AND e.event_type = 'shift'
  AND e.cancelled_at IS NULL
  AND e.recurrence_rule IS NOT NULL
  AND e.start_time < @range_end
  AND (e.recurrence_end IS NULL OR e.recurrence_end > @range_start)
  AND at.employee_id = ANY(@candidate_ids::uuid[])
  AND at.rsvp_status <> 'declined'
ORDER BY e.id;

-- name: ListRecurrenceExceptionsForSeries :many
SELECT series_id, original_start_time, exception_type, new_event_id
FROM calendar.recurrence_exception
WHERE organization_id = @organization_id
  AND series_id = ANY(@series_ids::uuid[]);
```

Every query above pins `organization_id`, and every join carries it, so `make lint-tenancy`
passes without an exemption. The only cross-tenant query is the sweep's organization
discovery, which carries the required marker.

---

## 4. Go constants

### `backend/internal/collaboration/constants.go`

```go
// Department pool assignment strategies. These MUST match the CHECK constraint on
// collaboration.ritual_definition_department_pool.assignment_strategy and the
// AssignmentStrategy union in frontend/packages/apis/src/collaboration-ritual.ts.
const (
	AssignmentStrategyRoundRobin    = "round_robin"
	AssignmentStrategyLeastAssigned = "least_assigned"
	// AssignmentStrategyOnShift draws the assignee from whoever has a shift covering the
	// scheduled date. It is late-bound: see ritual_shift_resolution_logic.go.
	AssignmentStrategyOnShift = "on_shift"
)

// Pool assignment resolution states. These MUST match the CHECK constraint on
// collaboration.ritual_instance_pool_assignment.resolution_state and the
// RitualPoolAssignmentState proto enum.
const (
	PoolAssignmentStateResolved         = "resolved"
	PoolAssignmentStateAwaitingShift    = "awaiting_shift"
	PoolAssignmentStateClosedUnresolved = "closed_unresolved"
)

const (
	PoolAssignmentClosedReasonNoRoster       = "no_roster"
	PoolAssignmentClosedReasonManualOverride = "manual_override"
)

const (
	// RitualShiftResolutionInterval is the resolution sweep cadence. Minutes, not hours:
	// SC-002 and SC-003 both say "within one resolution cycle" about something a manager
	// is watching for. It sits between the 1-minute generation sweep and the 5-minute
	// reconciliation sweep so a cadence identifies the sweep in a log.
	RitualShiftResolutionInterval = 2 * time.Minute

	// ritualShiftResolutionSlotLimit bounds one organization's work in one pass, matching
	// ritualReconciliationInstanceLimit. Oldest scheduled date first, so a partially
	// drained backlog progresses strictly.
	ritualShiftResolutionSlotLimit = 500

	// ritualShiftEscalationBackfillHorizon suppresses the owner alert — but not the state
	// change — for slots whose scheduled date is further in the past than this. Copied
	// from the overdue/missed backfill horizon rather than introducing a second number.
	ritualShiftEscalationBackfillHorizon = 7 * 24 * time.Hour
)

const NotificationTypeRitualInstanceUnassigned = notification.NotificationTypeRitualInstanceUnassigned
```

**Debt repaid in the same change**: `scheduler_logic.go` currently switches on the literals
`"round_robin"` and `"least_assigned"`. Both are replaced by the constants above, as
Constitution VIII requires.

### `backend/internal/notification/constants.go`

`NotificationTypeRitualInstanceUnassigned = "ritual_instance_unassigned"`, added to
`IsValidNotificationType`'s switch and to `AllNotificationTypes()`.

---

## 5. Proto — `backend/rpc/v1/collaboration.proto`

```proto
// How a ritual instance's department-pool slot stands. Present only for ritual instances
// whose definition carries a department pool using the on-shift strategy; an instance with
// several pools reports the least-progressed state, so one waiting pool is not hidden by
// another that resolved.
enum RitualPoolAssignmentState {
  RITUAL_POOL_ASSIGNMENT_STATE_UNSPECIFIED = 0;
  // A rostered employee holds the slot.
  RITUAL_POOL_ASSIGNMENT_STATE_RESOLVED = 1;
  // Nobody in the department is rostered for this date yet. The slot is unassigned on
  // purpose and will be filled as soon as a covering shift appears.
  RITUAL_POOL_ASSIGNMENT_STATE_AWAITING_SHIFT = 2;
  // The scheduled date arrived with nobody rostered, or a person took over the slot.
  // Nothing further will change it automatically.
  RITUAL_POOL_ASSIGNMENT_STATE_CLOSED_UNRESOLVED = 3;
}

message Task {
  // ... fields 1..29 unchanged ...

  // Feature 042. UNSPECIFIED for every task that is not an on-shift ritual instance.
  RitualPoolAssignmentState pool_assignment_state = 30;
}
```

`RitualDepartmentPool.assignment_strategy` and `RitualDepartmentPoolInput.assignment_strategy`
stay `string`; only the set of accepted values widens. No field is renumbered, added to or
removed from either message.

Regenerate with the repository's existing buf/protoc target.

---

## 6. TypeScript — `frontend/packages/apis/src`

```ts
// collaboration-ritual.ts
export type AssignmentStrategy = 'round_robin' | 'least_assigned' | 'on_shift';

// collaboration-task.ts
export type RitualPoolAssignmentState =
	| 'unspecified'
	| 'resolved'
	| 'awaiting_shift'
	| 'closed_unresolved';

export interface Task {
	// ...
	/** Feature 042: only meaningful for ritual instances with an on-shift department pool. */
	poolAssignmentState: RitualPoolAssignmentState;
}

// notification.ts — add to the NotificationType union
	| 'ritual_instance_unassigned'
```

`frontend/packages/notifications/src/utils.ts` gains the icon and label entries for
`ritual_instance_unassigned` alongside the existing ritual entries (`'⚠️'`, `'Ritual could
not be assigned'`).

---

## 7. New background workflow

```go
// internal/collaboration/ritual_shift_resolution_workflow.go
type RitualShiftResolutionInput struct{}

type RitualShiftResolutionOutput struct {
	OrganizationsProcessed int `json:"organizations_processed"`
	SlotsExamined          int `json:"slots_examined"`
	SlotsAssigned          int `json:"slots_assigned"`
	SlotsReassigned        int `json:"slots_reassigned"`
	SlotsWithdrawn         int `json:"slots_withdrawn"`
	SlotsEscalated         int `json:"slots_escalated"`
}

type RitualShiftResolutionWorkflow struct {
	Logic     Logic
	Queries   *database.Queries
	AdminPool database.AdminDatabaseConnector
}

func (w *RitualShiftResolutionWorkflow) Name() string { return "ritual_shift_resolution_sweep" }
func (w *RitualShiftResolutionWorkflow) Run(...)      // flows.Execute, RetryPolicy{MaxRetries: 2}
func (w *RitualShiftResolutionWorkflow) Sweep(ctx context.Context, now time.Time) (*RitualShiftResolutionOutput, error)
```

`Sweep` is exported for the same reason the other two sweeps export theirs: integration
tests drive a cycle with an injected clock instead of standing up a flows worker and
sleeping. Bootstrapped in `cmd/server.go` with `flows.ScheduleTx(... flows.Every(
collaboration.RitualShiftResolutionInterval))`, after `SetShiftCoverageReader`.

One structured log line per pass, `ritual shift resolution sweep complete`, carrying every
counter above. An error on one organization logs its ID and continues; an error on one slot
logs its task ID and the organization's remaining slots are still processed (FR-015).
