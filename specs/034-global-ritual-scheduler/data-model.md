# Phase 1 Data Model: Global Ritual Scheduler

**Feature**: `034-global-ritual-scheduler` | **Date**: 2026-08-22

**No schema change to any tenant table.** No column is added, removed, or altered on
`collaboration.ritual_definition`, `collaboration.task`, or any other business table. The
only data change is a one-time deletion of rows from the `flows.schedules` registry.

---

## Entities

### Ritual Definition — `collaboration.ritual_definition` (unchanged)

Distributed on `organization_id`, colocated with `public.organization`. Primary key
`(organization_id, id)`.

After this change, these existing columns become the **sole** input to generation. Nothing
about a ritual's timing lives outside this row any more.

| Column | Role in generation |
|---|---|
| `recurrence_rule` (JSONB) | Which dates the definition produces. Previously also translated into a cron expression; that second consumer is deleted |
| `timezone` (TEXT) | Location used to resolve dates. IANA names and `UTC±N` offsets, via `loadTimezone` |
| `is_archived` (BOOLEAN) | Whether the definition produces anything at all. **Replaces** schedule pause/resume as the mechanism (FR-010) |
| `last_generated_date` (DATE) | Waterline the next generation window starts from. Nullable — null means start from yesterday |
| `generation_window_days` (INT, default 30) | How far ahead to generate |
| `schedule_version` (INT) | Unchanged. Belongs to the user-facing schedule-change flow, not to cron scheduling |

**State transitions (unchanged in effect, changed in mechanism)**:

| Transition | Before | After |
|---|---|---|
| Created | Row inserted + schedule row upserted with `WithRunNow` | Row inserted + `GenerateRitualInstances` called in the same transaction |
| Recurrence updated | Row updated + cron expression rewritten | Row updated only; next sweep observes the new rule |
| Archived | `is_archived = TRUE` + schedule paused | `is_archived = TRUE` only; sweep's query stops selecting it |
| Unarchived | `is_archived = FALSE` + schedule resumed | `is_archived = FALSE` only; sweep's query selects it again |
| Schedule changed | Instances regenerated in logic + cron rewritten | Instances regenerated in logic; nothing else |

### Ritual Instance — `collaboration.task` rows of kind ritual instance (unchanged)

Identified for idempotency by `(organization_id, ritual_definition_id, scheduled_date)` via
the existing `CheckRitualInstanceExists` query. This uniqueness is what makes repeated and
overlapping sweeps safe (FR-006), and it is unchanged.

### Recurring Schedule Record — `flows.schedules` (row count changes)

| | Before | After |
|---|---|---|
| Rows for ritual generation | One per ritual definition, id `ritual_def_<uuid>` | Exactly one platform-wide, id `ritual_generation_sweep` |
| Workflow name | `ritual_scheduler` | `ritual_generation_sweep` |
| Input payload | `{org_id, definition_id}` | `{}` |
| Cron expression | Derived per definition from its recurrence rule | Fixed 1-minute interval |
| Written by | Four Connect RPC handlers | One startup bootstrap |

Not a tenant table — it carries no `organization_id` and is owned by the `flows` library.

---

## New Query

One query is added to `backend/database/scripts/collaboration.query.sql`:

```sql
-- name: ListOrganizationIDsWithActiveRitualDefinitions :many
-- System-scope background query for the global ritual sweep. Intentionally NOT filtered by
-- organization_id: its purpose is to discover which organizations to sweep. Returns only
-- organization IDs, no tenant row data, and runs on AdminPool. See Constitution Principle I
-- ("Use AdminPool ONLY for system operations (requires documented justification)").
-- ponytail: cross-shard DISTINCT scan each sweep; cost scales with organization count, not
-- ritual count. If it becomes measurable, narrow to organizations with definitions actually
-- due (last_generated_date < target_date + generation_window_days) or cache between sweeps.
SELECT DISTINCT organization_id
FROM collaboration.ritual_definition
WHERE is_archived = FALSE
ORDER BY organization_id;
```

Returns `[]dbuuid.UUID` after `sqlc` generation. Organizations whose rituals were removed by
the existing `ON DELETE CASCADE` chain (project deletion, organization deletion) drop out
automatically — no liveness check needed.

**Existing queries are unchanged**, including `ListActiveRitualDefinitionsForGeneration`,
which remains org-scoped and continues to be called once per organization by
`GenerateRitualInstances`.

---

## Job Input / Output Types

Replacing the per-definition types in
`backend/internal/collaboration/scheduler_workflow.go`:

| | Before | After |
|---|---|---|
| Input | `RitualSchedulerInput{OrgID, DefinitionID}` | `RitualGenerationInput{}` (empty) |
| Output | `RitualSchedulerOutput{TotalGenerated}` | `RitualGenerationOutput{OrganizationsProcessed, DefinitionsProcessed, TotalGenerated}` |

The output fields satisfy FR-014 and are logged per run.

---

## Deleted Symbols (FR-003, FR-016)

| Symbol | File | Why it goes |
|---|---|---|
| `RitualScheduleID(defID)` | `scheduler_workflow.go` | No per-definition schedule to name |
| `RecurrenceRuleToSchedule(ruleJSON)` | `scheduler_workflow.go` | The recurrence→cron translation itself |
| `parseTimeOfDay(tod)` | `scheduler_workflow.go` | Only fed the cron expression. Generation reads `time_of_day` through `parseRecurrenceRule` |
| `isoDayToCron(iso)` | `scheduler_workflow.go` | Only fed the cron expression. Generation uses `isoToGoWeekday` |
| `RecurrenceRuleFromDefinition(raw)` | `scheduler_workflow.go` | Wrapper whose only caller was the translation |
| `RitualSchedulerInput.DefinitionID` | `scheduler_workflow.go` | Never filtered anything; log-only |
| `recurrenceRuleToJSON(r)` | `ritual_connect.go` | Existed only to feed `RecurrenceRuleToSchedule` |
| `CollaborationServiceConnect.RitualScheduler` | `connect.go` | Handlers no longer schedule; also drops the constructor parameter |
| `RecurrenceTypeEveryMinute` | `constants.go` | Unreachable from the proto enum; existed to make the deleted cron fire fast |
| `RecurrenceTypeEveryTwoMinutes` | `constants.go` | Same |
| Short-interval branch in `computeDatesInWindow` | `scheduler_logic.go` | Dead once the two constants above are gone |

Verify `recurrenceRuleToMap` is retained — it is still used by the definition CRUD paths for
persisting the rule, and only its `recurrenceRuleToJSON` wrapper is removed.

---

## Migration

`backend/k8s/base/database/migrations/20260822000002_drop_per_definition_ritual_schedules.up.sql`

```sql
-- Feature 034: per-definition ritual schedules are replaced by one global sweep.
-- These rows point at the removed 'ritual_scheduler' workflow; left in place they would
-- keep enqueueing runs for a workflow name no longer in the registry.
DELETE FROM flows.schedules WHERE schedule_id LIKE 'ritual_def_%';
```

Forward-only, per Principle I. Idempotent — safe to replay, which the `psql` runner does for
a dirty version. The `ritual_def_` prefix is unique to `RitualScheduleID` and matches no
other schedule.
