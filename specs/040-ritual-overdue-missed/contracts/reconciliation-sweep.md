# Contract: Ritual Reconciliation Sweep

**No RPC is added, removed or changed by this feature.** The interfaces below are the internal
contracts the feature does introduce: a scheduled `flows` workflow, one `Logic` method, and
two SQL queries.

---

## 1. Scheduled workflow

`backend/internal/collaboration/ritual_reconciliation_workflow.go`

```go
// RitualReconciliationInput is empty by design: the sweep discovers its own work.
type RitualReconciliationInput struct{}

// RitualReconciliationOutput reports what one pass covered (FR-012).
type RitualReconciliationOutput struct {
    OrganizationsProcessed int `json:"organizations_processed"`
    InstancesExamined      int `json:"instances_examined"`
    MarkedOverdue          int `json:"marked_overdue"`
    MarkedMissed           int `json:"marked_missed"`
}

type RitualReconciliationWorkflow struct {
    Logic     Logic
    Queries   *database.Queries
    AdminPool database.AdminDatabaseConnector
}

func (w *RitualReconciliationWorkflow) Name() string { return "ritual_reconciliation_sweep" }

func (w *RitualReconciliationWorkflow) Run(ctx context.Context, wf *flows.Context, in *RitualReconciliationInput) (*RitualReconciliationOutput, error)

// Sweep runs one reconciliation cycle across every organization holding late instances.
// Exported so integration tests can drive a cycle without standing up a flows worker,
// and so `now` can be injected instead of slept for.
func (w *RitualReconciliationWorkflow) Sweep(ctx context.Context, now time.Time) (*RitualReconciliationOutput, error)
```

**Behavioural contract**

| Guarantee | Requirement |
|---|---|
| Runs without any user or client action, across all organizations | FR-008 |
| Discovers organizations through late *instances*, never through active *definitions* | FR-009 |
| Two runs over unchanged data produce identical states and zero extra notifications | FR-010 |
| An error on one organization is logged with its ID; the loop continues | FR-011 |
| Returns the four counts above and logs them as one structured line | FR-012 |
| Loads at most `ritualReconciliationInstanceLimit` (500) instances per organization per pass | FR-013 |

**Registration** — `backend/cmd/server.go`, immediately after the generation sweep, following
the identical register-then-`ScheduleTx` shape:

```go
ritualReconciliationWorkflow := &collaboration.RitualReconciliationWorkflow{
    Logic: collaborationLogic, Queries: queries, AdminPool: adminPool,
}
flows.Register(flowsRegistry, ritualReconciliationWorkflow)
// ScheduleTx upserts by schedule ID, so every instance and every restart
// converges on exactly one schedule row.
flows.ScheduleTx(ctx, flowsClient, tx, ritualReconciliationWorkflow,
    &collaboration.RitualReconciliationInput{},
    ritualReconciliationWorkflow.Name(), flows.Every(5*time.Minute))
```

Registration alone does not schedule anything; `ScheduleTx` is what makes the job run.
Retry policy `flows.RetryPolicy{MaxRetries: 2}`, matching the generation sweep — a retried
pass is safe because the pass is idempotent.

---

## 2. Logic method

`backend/internal/collaboration/logic.go` — the `Logic` interface gains one method.

```go
// ReconcileOverdueRitualInstances applies the lateness rules to one organization's late
// ritual instances and returns what it changed. It is safe to call repeatedly.
ReconcileOverdueRitualInstances(
    ctx context.Context,
    tx database.DBTX,
    orgID dbuuid.UUID,
    now time.Time,
) (RitualReconciliationCounts, error)

type RitualReconciliationCounts struct {
    InstancesExamined int
    MarkedOverdue     int
    MarkedMissed      int
}
```

Implemented in `ritual_reconciliation_logic.go`. Per instance it calls the existing
`reconcileRitualTaskStateForTask` and classifies the returned outcome. A per-instance error is
logged with the task ID and the loop continues (FR-011, second sentence).

`reconcileRitualTaskStateForTask` changes signature to report what it did, so the caller can
count without re-reading:

```go
type ritualStateOutcome struct {
    Changed bool
    From    string // state category before
    To      string // state category after
}
```

Its existing callers (`SubmitEvidence`, `ApproveEvidence`, `RejectEvidence`) ignore the value.

---

## 3. SQL queries

`backend/database/scripts/collaboration.query.sql`

### `ListOrganizationIDsWithReconcilableRitualInstances :many`

System-scope, run on `AdminPool`, **intentionally not filtered by `organization_id`** — its
purpose is to discover which organizations to sweep. Returns organization IDs and nothing
else: no tenant row data crosses the boundary. Constitution Principle I justification is
documented in the query comment, matching its sibling
`ListOrganizationIDsWithActiveRitualDefinitions`.

```sql
SELECT DISTINCT t.organization_id
FROM collaboration.task t
JOIN collaboration.project_state ps
  ON ps.organization_id = t.organization_id AND ps.id = t.state_id
WHERE t.task_kind = 'ritual_instance'
  AND t.is_deleted = FALSE
  AND t.detached_from_ritual = FALSE
  AND t.completion_deadline IS NOT NULL
  AND t.completion_deadline < @now
  AND ps.category IN ('scheduled', 'todo', 'in_progress', 'overdue')
ORDER BY t.organization_id;
```

Note the absence of any `ritual_definition` join: an instance whose definition was archived
after generation must still be found (FR-009).

### `ListRitualInstancesForReconciliation :many`

Organization-scoped. Same predicate, plus the bound.

```sql
SELECT t.*
FROM collaboration.task t
JOIN collaboration.project_state ps
  ON ps.organization_id = t.organization_id AND ps.id = t.state_id
WHERE t.organization_id = @organization_id
  AND t.task_kind = 'ritual_instance'
  AND t.is_deleted = FALSE
  AND t.detached_from_ritual = FALSE
  AND t.completion_deadline IS NOT NULL
  AND t.completion_deadline < @now
  AND ps.category IN ('scheduled', 'todo', 'in_progress', 'overdue')
ORDER BY t.completion_deadline ASC, t.id ASC
LIMIT @instance_limit;
```

**Why each clause is there** — `detached_from_ritual = FALSE` and the category set encode
FR-003 and FR-004; `completion_deadline IS NOT NULL` encodes FR-005; `'submitted'` is absent
from the category set because fully submitted evidence awaiting review is the reviewer's
delay, not the worker's; `'overdue'` is present because that is how an instance reaches
`missed`. Ascending deadline order makes a partially drained backlog progress strictly.

### Modified: `GetAssignedWorkSummaryCounts`, `ListAssignedWorkSummaryItems`

The urgency expression becomes, in both:

```sql
CASE
  WHEN ps.category = 'overdue' OR t.due_date < sqlc.arg(as_of_date)::date THEN 'overdue'
  ELSE 'due_today'
END AS urgency_bucket
```

The `OR` preserves standard-task behaviour (standard projects have no `overdue` state) while
making ritual instances agree with their stored state (FR-022). Missed instances leave the
summary without a query change, because the seeded `Missed` state is `is_closed = true` and
both queries already filter `ps.is_closed = FALSE`.

---

## 4. What is deliberately *not* added

- **No `ReconcileRituals` RPC.** No manual "reconcile now" control was asked for, and one
  would only paper over a broken schedule (spec assumption).
- **No new proto field, message or enum value.** `overdue` and `missed` already exist in
  `StateCategory`.
- **No new configuration.** The grace period is the definition's existing
  `completion_window_hours`; the cadence, the per-pass bound and the backfill horizon are
  constants in `backend/internal/collaboration/constants.go`.
