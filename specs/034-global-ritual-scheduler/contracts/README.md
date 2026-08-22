# Contracts: Global Ritual Scheduler

**Feature**: `034-global-ritual-scheduler` | **Date**: 2026-08-22

## External contract: unchanged

**No `.proto` file changes. No generated RPC client changes. No frontend or mobile API
surface changes.**

Every ritual RPC keeps its current request and response shape:

| RPC | Request/Response | Behavior change visible to callers |
|---|---|---|
| `CreateRitualDefinition` | unchanged | None. Instances still exist immediately on return (FR-011) — produced by a direct in-transaction generation call instead of an enqueued immediate workflow run |
| `UpdateRitualDefinition` | unchanged | None on the response. A recurrence change is now picked up by the next sweep (≤1 min) instead of by a rewritten per-definition cron |
| `ArchiveRitualDefinition` | unchanged | None. Archived definitions stop generating because the sweep's query excludes them, rather than because a schedule was paused |
| `ChangeRitualDefinitionSchedule` | unchanged | None. `instances_removed`, `instances_detached`, and `instances_created` are still populated (FR-012) — they were always computed in the logic layer, independent of any schedule |
| `GetRitualDefinition`, `ListRitualDefinitions` | unchanged | None |

Nothing in the proto ever exposed schedule identifiers, cron expressions, or the
`ritual_scheduler` workflow. The deleted machinery was entirely internal, which is why a
breaking internal change carries no client-facing break.

**Enum note**: `rpcv1.RecurrenceType` is unchanged. The two constants deleted in this feature
(`every_minute`, `every_two_minutes`) are Go-side strings only — they have no enum value, and
`recurrenceTypeToString` could never emit them. See
[research.md, Decision 4](../research.md#decision-4-delete-every_minute-and-every_two_minutes).

---

## Internal contract: the global sweep job

This is the one new contract the feature introduces. It is a background job, not a network
interface — it has no callers outside the process.

### Registration and schedule

| Property | Value |
|---|---|
| Workflow name | `ritual_generation_sweep` |
| Schedule ID | `ritual_generation_sweep` |
| Cadence | Every 1 minute (FR-007) |
| Registered | `flows.Register(flowsRegistry, ritualGenerationWorkflow)` at startup |
| Scheduled | `flows.ScheduleTx(...)` at startup, in a transaction on `AdminPool` (FR-015) |
| Pool | `AdminPool` — system-scope operation, justified under Constitution Principle I |

`flows.ScheduleTx` upserts on schedule ID, so running the bootstrap on every instance and
every restart converges on exactly one row (SC-001). `flows` leases runs, so exactly one
instance executes any given cycle.

> The bootstrap step is not optional boilerplate. `CalendarReminderWorkflow` and
> `CalendarPresenceWorkflow` are registered but never scheduled, and consequently have never
> run. Registration alone does nothing. See
> [research.md, pre-existing defect](../research.md#pre-existing-defect-discovered-out-of-scope).

### Input

```go
type RitualGenerationInput struct{}
```

Empty by design. The sweep discovers its own work; carrying an organization or definition
identifier is what made the previous design redundant.

### Output

```go
type RitualGenerationOutput struct {
    OrganizationsProcessed int `json:"organizations_processed"`
    DefinitionsProcessed   int `json:"definitions_processed"`
    TotalGenerated         int `json:"total_generated"`
}
```

All three are required by FR-014 and are emitted on a per-run `slog.InfoContext` line.

### Behavioral guarantees

| Guarantee | Requirement |
|---|---|
| Each organization with at least one unarchived definition is processed exactly once per run | FR-004 |
| Generated dates are identical to the per-definition scheduler's output for the same definition, rule, timezone, and window | FR-005 |
| Re-running over the same window creates no duplicates and raises no error | FR-006 |
| A failure on one organization is logged with that organization identified; remaining organizations still process in the same run | FR-008 |
| A definition with an unparseable recurrence rule is skipped with a warning; siblings are unaffected | FR-009 |

The last two are inherited, not newly written: `GenerateRitualInstances` already skips
unparseable rules per definition. The sweep adds the equivalent isolation one level up, at
the organization boundary.

### Database contract

One new query, described in full in [data-model.md](../data-model.md#new-query):

```
ListOrganizationIDsWithActiveRitualDefinitions :many  →  []dbuuid.UUID
```

Deliberately unfiltered by `organization_id` — it is a discovery query whose purpose is to
find organizations. It returns organization IDs only, no tenant row data, and every query it
feeds downstream remains org-scoped. Precedent: `ListPendingRemindersGlobal`.

---

## Removed internal contract

The `ritual_scheduler` workflow and its schedule namespace are deleted:

| Removed | Was |
|---|---|
| Workflow name `ritual_scheduler` | Registered per process, invoked once per definition per cycle |
| Schedule IDs `ritual_def_<uuid>` | One row per ritual definition in `flows.schedules` |
| Input `{org_id, definition_id}` | `definition_id` filtered nothing; log-only |

Existing rows are removed by the migration in
[data-model.md](../data-model.md#migration) (FR-013). No compatibility path keeps the old
workflow name resolvable — per the project's early-development stance, this ships as one
coordinated change.
