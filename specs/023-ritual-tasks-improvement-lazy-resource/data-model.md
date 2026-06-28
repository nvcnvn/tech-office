# Data Model: Ritual Tasks — Lazy Resource Creation & Schedule Change Handling

**Feature**: 023-ritual-tasks-improvement-lazy-resource  
**Branch**: `023-ritual-tasks-improvement-lazy-resource`

---

## Schema Changes

### Migration File

**Path**: `backend/database/scripts/migrations/NNNN_lazy_ritual_resources.sql`  
_(Replace NNNN with next sequential migration number)_

```sql
-- Migration: Lazy ritual resources + schedule versioning
-- Feature: 023-ritual-tasks-improvement-lazy-resource

-- 1. Add detached_from_ritual flag to collaboration.task
--    Tracks tasks that were once ritual instances but detached
--    when the schedule changed (advisory-only after detachment).
ALTER TABLE collaboration.task
  ADD COLUMN IF NOT EXISTS detached_from_ritual BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Add schedule_version counter to collaboration.ritual_definition
--    Monotonically incremented on every recurrence pattern change.
--    Enables audit and distinguishes "missed due to schedule change" from
--    "missed because nobody did the work."
ALTER TABLE collaboration.ritual_definition
  ADD COLUMN IF NOT EXISTS schedule_version INT NOT NULL DEFAULT 1;
```

### `schema.sql` Changes

**`collaboration.task`** — add after existing ritual columns:

```sql
-- Existing ritual columns (for reference):
task_kind TEXT NOT NULL DEFAULT 'standard' CHECK (task_kind IN ('standard', 'ritual_instance')),
ritual_definition_id UUID,
scheduled_date DATE,
completion_deadline TIMESTAMPTZ,
skip_reason TEXT,

-- NEW:
detached_from_ritual BOOLEAN NOT NULL DEFAULT FALSE,
```

**`collaboration.ritual_definition`** — add after `generation_window_days`:

```sql
-- Existing columns (for reference):
generation_window_days INT NOT NULL DEFAULT 30,

-- NEW:
schedule_version INT NOT NULL DEFAULT 1,
```

---

## sqlc Query Changes

**File**: `backend/database/scripts/collaboration.query.sql`

### New Query: `CountScheduleChangeImpact`

Returns impact counts for the confirmation dialog (FR-013). Read-only.

```sql
-- name: CountScheduleChangeImpact :one
-- Returns counts of future instances that would be soft-deleted (untouched)
-- vs. detached (touched) for a given ritual definition schedule change.
-- The caller computes $today by evaluating time.Now() in the definition's timezone.
SELECT
  COUNT(*) FILTER (
    WHERE channel_id IS NULL
      AND state_id IN (
        SELECT id FROM collaboration.project_state
        WHERE organization_id = @organization_id
          AND state_category = 'scheduled'
      )
      AND NOT EXISTS (
        SELECT 1 FROM collaboration.evidence_submission es
        WHERE es.organization_id = @organization_id
          AND es.task_id = t.id
      )
  ) AS untouched_count,
  COUNT(*) FILTER (
    WHERE NOT (
      channel_id IS NULL
      AND state_id IN (
        SELECT id FROM collaboration.project_state
        WHERE organization_id = @organization_id
          AND state_category = 'scheduled'
      )
      AND NOT EXISTS (
        SELECT 1 FROM collaboration.evidence_submission es
        WHERE es.organization_id = @organization_id
          AND es.task_id = t.id
      )
    )
  ) AS touched_count
FROM collaboration.task t
WHERE t.organization_id = @organization_id
  AND t.ritual_definition_id = @ritual_definition_id
  AND t.task_kind = 'ritual_instance'
  AND t.deleted_at IS NULL
  AND t.scheduled_date > @today_cutoff;
```

### New Query: `SoftDeleteUntouchedFutureInstances`

Soft-deletes future ritual instances that have not been interacted with.

```sql
-- name: SoftDeleteUntouchedFutureInstances :execrows
-- Soft-deletes future ritual instances that are still in "scheduled" state
-- with no channel and no evidence submissions.
-- Called as part of ChangeRitualDefinitionSchedule (within the same transaction).
UPDATE collaboration.task t
SET deleted_at = NOW()
WHERE t.organization_id = @organization_id
  AND t.ritual_definition_id = @ritual_definition_id
  AND t.task_kind = 'ritual_instance'
  AND t.deleted_at IS NULL
  AND t.scheduled_date > @today_cutoff
  AND t.channel_id IS NULL
  AND t.state_id IN (
    SELECT id FROM collaboration.project_state
    WHERE organization_id = @organization_id
      AND state_category = 'scheduled'
  )
  AND NOT EXISTS (
    SELECT 1 FROM collaboration.evidence_submission es
    WHERE es.organization_id = @organization_id
      AND es.task_id = t.id
  );
```

### New Query: `DetachTouchedFutureInstances`

Converts touched future instances to standalone standard tasks.

```sql
-- name: DetachTouchedFutureInstances :execrows
-- Detaches future touched ritual instances: clears the ritual link and marks
-- them as standard tasks with detached_from_ritual = TRUE.
-- Called as part of ChangeRitualDefinitionSchedule (within the same transaction).
UPDATE collaboration.task t
SET
  ritual_definition_id = NULL,
  task_kind = 'standard',
  detached_from_ritual = TRUE
WHERE t.organization_id = @organization_id
  AND t.ritual_definition_id = @ritual_definition_id
  AND t.task_kind = 'ritual_instance'
  AND t.deleted_at IS NULL
  AND t.scheduled_date > @today_cutoff;
  -- Remaining rows (not soft-deleted) are the touched set
```

### New Query: `UpdateRitualDefinitionSchedule`

Atomically updates the recurrence rule, increments schedule_version, and resets the generation waterline.

```sql
-- name: UpdateRitualDefinitionSchedule :one
-- Updates the recurrence_rule, increments schedule_version, and resets
-- last_generated_date so regeneration restarts from the next day.
-- Called as part of ChangeRitualDefinitionSchedule (within the same transaction).
UPDATE collaboration.ritual_definition
SET
  recurrence_rule = @recurrence_rule,
  schedule_version = schedule_version + 1,
  last_generated_date = @waterline_reset_date,
  updated_at = NOW()
WHERE organization_id = @organization_id
  AND id = @id
RETURNING *;
```

### New Query: `EnsureTaskChannel`

Atomically sets the channel_id on a ritual instance only if it is still NULL.

```sql
-- name: EnsureTaskChannel :one
-- Atomically sets channel_id on a ritual instance task.
-- Returns the row ONLY if the UPDATE succeeded (i.e., channel_id was NULL).
-- If 0 rows returned, channel was already set by a concurrent call — caller
-- must re-fetch the task to get the current channel_id.
UPDATE collaboration.task
SET channel_id = @channel_id
WHERE organization_id = @organization_id
  AND id = @id
  AND channel_id IS NULL
RETURNING *;
```

### New Query: `EnsureTaskDocument`

Atomically sets the description_document_id on a ritual instance only if NULL.

```sql
-- name: EnsureTaskDocument :one
-- Atomically sets description_document_id on a ritual instance task.
-- Returns the row ONLY if the UPDATE succeeded.
-- If 0 rows returned, doc was already set — caller must re-fetch.
UPDATE collaboration.task
SET description_document_id = @description_document_id
WHERE organization_id = @organization_id
  AND id = @id
  AND description_document_id IS NULL
RETURNING *;
```

---

## Entity Relationships

```
collaboration.ritual_definition
  id, organization_id, project_id, name, recurrence_rule JSONB,
  timezone, completion_window_hours, is_archived,
  last_generated_date, generation_window_days,
  [NEW] schedule_version INT DEFAULT 1,
  created_by_employee_id, updated_at
  PK: (organization_id, id)
  
    ↓ 1:N  (ritual_definition_id reference)

collaboration.task  [ritual instance variant]
  id, organization_id, project_id, identifier, title,
  task_kind = 'ritual_instance',
  ritual_definition_id UUID,  ← linked to definition (or NULL after detach)
  scheduled_date DATE,
  completion_deadline TIMESTAMPTZ,  ← advisory-only after detach
  channel_id UUID,                  ← NULL until first user interaction
  description_document_id UUID,     ← NULL until first user interaction
  deleted_at TIMESTAMPTZ,           ← set on soft-delete during schedule change
  [NEW] detached_from_ritual BOOLEAN DEFAULT FALSE,  ← set TRUE on detach
  state_id → collaboration.project_state
```

### Lifecycle State Diagram (Ritual Instance)

```
Generated (untouched)                   Schedule changes:
  task_kind = ritual_instance      ─────────────────────────────────────→ SOFT-DELETED
  channel_id = NULL                      (no channel, scheduled state)     deleted_at = NOW()
  state_category = scheduled
        │
        │ User opens detail view
        ↓
Materialized (touched)              Schedule changes:
  task_kind = ritual_instance      ─────────────────────────────────────→ DETACHED
  channel_id = <uuid>                    (has channel OR state changed)    task_kind = standard
  description_doc_id = <uuid>                                              ritual_definition_id = NULL
  state_category = in_progress/...                                         detached_from_ritual = TRUE
        │
        │ Work completed
        ↓
   Historical (terminal)
  state_category = verified/missed/skipped
  Protected from schedule changes (scheduled_date ≤ today)
```

---

## sqlc `models.go` Impact

After `sqlc generate`, `CollaborationTask` struct gains:

```go
type CollaborationTask struct {
    // ... existing fields ...
    TaskKind             string          `db:"task_kind"`
    RitualDefinitionID   pgtype.UUID     `db:"ritual_definition_id"`
    ScheduledDate        pgtype.Date     `db:"scheduled_date"`
    CompletionDeadline   pgtype.Timestamptz `db:"completion_deadline"`
    SkipReason           pgtype.Text     `db:"skip_reason"`
    DetachedFromRitual   bool            `db:"detached_from_ritual"` // NEW
}

type CollaborationRitualDefinition struct {
    // ... existing fields ...
    ScheduleVersion int32 `db:"schedule_version"` // NEW
}
```

The `CountScheduleChangeImpact` query returns a new struct:

```go
type CountScheduleChangeImpactRow struct {
    UntouchedCount int64 `db:"untouched_count"`
    TouchedCount   int64 `db:"touched_count"`
}
```
