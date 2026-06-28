# Research Notes: Ritual Tasks — Lazy Resource Creation & Schedule Change Handling

**Feature**: 023-ritual-tasks-improvement-lazy-resource  
**Branch**: `023-ritual-tasks-improvement-lazy-resource`  
**Date**: 2026-03-13

---

## 1. Problem Statement (Confirmed)

**File**: `backend/internal/collaboration/scheduler_logic.go` (lines 130–190)

The `GenerateRitualInstances` background job creates a **chat channel** AND **description document** for **every** ritual instance at generation time. With a 30-day window, a single daily ritual definition → 30 channels + 30 documents = **60 resources created before any human opens a task**. Most are never used.

```go
// Current eager pattern in scheduler_logic.go — THE PROBLEM:
channel, chErr := l.ChatLogic.CreateChannel(ctx, tx, orgID, def.CreatedByEmployeeID, ...)
// ...
doc, docErr := l.DocsLogic.CreateDocument(ctx, tx, orgID, def.CreatedByEmployeeID, ...)
```

**File**: `backend/internal/collaboration/task_logic.go` (lines 120–170)

Standard tasks (`task_kind = 'standard'`) ALSO create channel + doc eagerly. This behavior is **correct and must remain unchanged** (FR-006). Only the scheduler path needs to stop.

---

## 2. Instance Generation Mechanics

The scheduler (`GenerateRitualInstances`) follows this flow per definition:

1. Query `ListActiveRitualDefinitionsForGeneration` (definitions where waterline < target + window)
2. Parse recurrence rule from JSONB (`parseRecurrenceRule`)
3. Load timezone via `loadTimezone(def.Timezone)` (supports IANA + UTC±N formats)
4. Compute dates via `computeDatesInWindow(rule, lastGenerated, windowDays, loc, now)`
5. For each date: `CheckRitualInstanceExists` → idempotency guard
6. `IncrementProjectTaskNumber` → task identifier (e.g., `PROJ-42`)
7. **Create channel** (REMOVE IN FIX)
8. **Create document** (REMOVE IN FIX)
9. `l.Queries.CreateTask(...)` with `task_kind = 'ritual_instance'`, NULL channel/doc IDs after fix
10. `AssignTask` for each default assignee
11. `UpdateRitualDefinitionLastGenerated` to advance waterline

**The fix in Phase 3**: delete steps 7 and 8 from the scheduler loop. Task is created with `channel_id = NULL`, `description_document_id = NULL`.

---

## 3. Lazy Resource Creation — Hook Points

Resources must be created the first time a user interacts with an instance. Two trigger points:

| Trigger | Current Handler | Action Needed |
|---------|----------------|---------------|
| Task detail view opened | `GetTask` RPC → `ritual_connect.go` | Call `EnsureTaskResources` before returning |
| First comment posted | `SendMessage` in chat domain | Not direct — chat domain doesn't know about tasks |

**Recommended approach**: Add `EnsureTaskResources(ctx, tx, orgID, taskID)` to the collaboration `Logic` interface. Call it from `GetTask` logic when `task.task_kind = 'ritual_instance'` AND `task.channel_id IS NULL`. This covers:
- Direct task detail view open
- Any caller that fetches task detail (breadcrumb navigation from notifications, etc.)

For comments specifically, the comment flow goes through the **chat** domain which doesn't hold a task reference. However, the frontend will always call `GetTask` before showing the comment box, so the channel will be provisioned before any comment attempt.

**Idempotency pattern** (safe for concurrent callers):

```sql
-- Update is atomic: only one concurrent caller wins the UPDATE
UPDATE collaboration.task
SET channel_id = $channel_id, description_document_id = $doc_id
WHERE organization_id = $org_id AND id = $task_id
  AND channel_id IS NULL
RETURNING *
```

If the UPDATE affects 0 rows, the resource already existed (or was set by concurrent caller) — read the current channel_id and return. No duplicate resources.

**`registerTaskResourceSurfaces`** (in `task_logic.go`) must also be called after resource creation to enable V2 subscription inheritance:
- Registers `(domain=task, surface=task_discussion)` → channel
- Registers `(domain=task, surface=task_description)` → doc

---

## 4. Schedule Change — Current vs. Required Behavior

### Current `UpdateRitualDefinition` (ritual_logic.go ~line 167)

Does a COALESCE partial update. If `req.RecurrenceRule != nil`, it updates the JSONB. **No instance cleanup**. The update completes silently, leaving orphaned future instances on the old pattern.

### Required Behavior (spec FR-007 to FR-012)

A recurrence pattern change must execute atomically:

1. **Classify future instances** (after today in definition's timezone):
   - **Untouched**: `state_category = 'scheduled'`, `channel_id IS NULL`, zero evidence submissions → **soft-delete**
   - **Touched**: any other future instance → **detach** (clear ritual link, set `task_kind = 'standard'`, set `detached_from_ritual = TRUE`)
   - **Historical** (scheduled_date ≤ today-in-timezone): **never touch**

2. **Update recurrence rule** on the definition + increment `schedule_version`

3. **Advance `last_generated_date`** to yesterday (so generation restarts from today+1)

4. **Regenerate instances** using new pattern (reuse existing `GenerateRitualInstances` or inline the logic)

### Design Decision: Two New RPCs (Not Modifying Existing UpdateRitualDefinition)

The existing `UpdateRitualDefinition` handles metadata changes (name, description, timezone, assignees) that **do not require impact preview or cleanup**. Merging schedule change logic into it would:
- Make the API ambiguous (should the client always show a confirm dialog?)
- Complicate the logic layer's transaction scope

**Decision**: Keep existing `UpdateRitualDefinition` for metadata-only changes. Add:
- `GetScheduleChangeImpact` — read-only, returns impact counts
- `ChangeRitualDefinitionSchedule` — applies cleanup + regeneration atomically

The inline definition editing UX (FR-020–023) will call `GetScheduleChangeImpact` then `ChangeRitualDefinitionSchedule` — same flow as schedule change from the definition management screen.

---

## 5. Existing SQL Query Reuse

| Existing Query | Location | Reused As |
|---|---|---|
| `SoftDeletePendingRitualInstances` | `collaboration.query.sql:789` | Reference pattern — the schedule change needs a more restrictive version |
| `CheckRitualInstanceExists` | `collaboration.query.sql:1019` | Reused by regeneration after cleanup |
| `UpdateRitualDefinitionLastGenerated` | `collaboration.query.sql:817` | Reused after regeneration |
| `ListActiveRitualDefinitionsForGeneration` | `collaboration.query.sql:810` | Reused for regeneration after schedule change |

**New queries needed** (schema described in data-model.md):
- `CountScheduleChangeImpact` — returns `(untouched_count, touched_count)` for preview
- `SoftDeleteUntouchedFutureInstances` — soft-deletes the untouched set
- `DetachTouchedFutureInstances` — updates the touched set to detached state
- `UpdateRitualDefinitionSchedule` — updates recurrence_rule + increments schedule_version + resets waterline
- `EnsureTaskChannel` — atomic UPDATE ... WHERE channel_id IS NULL RETURNING *
- `EnsureTaskDocument` — atomic UPDATE ... WHERE description_document_id IS NULL RETURNING *

---

## 6. Schema Gap Analysis

### `collaboration.task` — Missing Columns

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `detached_from_ritual` | `BOOLEAN NOT NULL` | `DEFAULT FALSE` | FR-017: UI can show "was part of ritual X" label |

### `collaboration.ritual_definition` — Missing Columns

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `schedule_version` | `INT NOT NULL` | `DEFAULT 1` | FR-015: monotonic counter incremented on recurrence change |

### Columns Confirmed Present (No Change Needed)

- `collaboration.task.deleted_at` — soft-delete mechanism already exists
- `collaboration.task.task_kind` — CHECK constraint `IN ('standard', 'ritual_instance')` exists
- `collaboration.task.ritual_definition_id`, `scheduled_date`, `completion_deadline`, `skip_reason`

### Unique Index for Idempotency

The existing `CheckRitualInstanceExists` query uses a WHERE clause. No existing unique index on `(ritual_definition_id, scheduled_date)` was found. The new `SoftDeleteUntouchedFutureInstances` query will use `DELETE ... WHERE deleted_at IS NULL` to avoid conflicts.

---

## 7. Proto Message Changes Needed

### `Task` message (add new fields)

```proto
bool detached_from_ritual = XX; // true if task was detached from its ritual definition
```

### `RitualDefinition` message (add new field)

```proto
int32 schedule_version = 13; // monotonic counter incremented on every recurrence pattern change
```

### New RPCs (to be added to service)

```proto
rpc GetScheduleChangeImpact(GetScheduleChangeImpactRequest) returns (GetScheduleChangeImpactResponse);
rpc ChangeRitualDefinitionSchedule(ChangeRitualDefinitionScheduleRequest) returns (ChangeRitualDefinitionScheduleResponse);
```

---

## 8. Frontend Impact

**File**: `frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/page.tsx`

Already imports `getRitualDefinition` and declares a `RitualDefinition` state variable. The ritual section is partially present but the detail is unclear without reading the full component. The new `RitualDefinitionSection` component needs to:

- Show definition name and recurrence pattern (always visible for ritual instances)
- Show inline edit controls if `canEditDefinition` (`isCreator || isProjectAdmin`)
- Trigger `GetScheduleChangeImpact` → confirmation dialog → `ChangeRitualDefinitionSchedule` on save

**API wrappers to add** in `frontend/packages/apis/src/collaboration.ts`:
- `getScheduleChangeImpact(params)` → typed wrapper
- `changeRitualDefinitionSchedule(params)` → typed wrapper

---

## 9. Architecture Documentation Status

| Document | Change Needed? | Reason |
|----------|---------------|--------|
| `backend/docs/SYSTEM-ARCHITECTURE.md` | **No** | No new cross-domain dependencies added; chat + docs already integrated with collaboration |
| `backend/docs/NOTIFICATION-SYSTEM-ARCHITECTURE.md` | **No** | No new notification types or events introduced |

The lazy resource creation and schedule change logic are purely internal to the `collaboration` domain. Cross-domain calls (to `chat` and `docs`) already exist and are not modified architecturally — only the timing of those calls changes.

---

## 10. Files to Be Modified / Created

### Backend

| File | Change |
|------|--------|
| `backend/database/scripts/schema.sql` | ADD: `detached_from_ritual` on task; `schedule_version` on ritual_definition |
| `backend/database/scripts/migrations/XXXX_lazy_ritual_resources.sql` | NEW: migration |
| `backend/database/scripts/collaboration.query.sql` | ADD: 6 new queries (see §5 above) |
| `backend/database/collaboration.query.sql.go` | REGENERATE (`sqlc generate`) |
| `backend/rpc/v1/collaboration.proto` | ADD: 2 RPCs + 2 messages; extend Task + RitualDefinition |
| `backend/rpc/v1/*.pb.go` + `*_grpc.pb.go` | REGENERATE (`buf generate`) |
| `backend/internal/collaboration/logic.go` | ADD: `EnsureTaskResources`, `GetScheduleChangeImpact`, `ChangeRitualDefinitionSchedule` to `Logic` interface |
| `backend/internal/collaboration/scheduler_logic.go` | MODIFY: Remove channel/doc creation from generation loop |
| `backend/internal/collaboration/task_logic.go` | ADD: `EnsureTaskResources` implementation |
| `backend/internal/collaboration/ritual_logic.go` | ADD: `GetScheduleChangeImpact` + `ChangeRitualDefinitionSchedule` implementation |
| `backend/internal/collaboration/ritual_connect.go` | ADD: RPC handler stubs for 2 new endpoints |
| `backend/integration/ritual_tasks_improvement_test.go` | NEW: integration test stubs |

### Frontend

| File | Change |
|------|--------|
| `frontend/packages/rpc/index.ts` | Re-export new collaboration methods after `buf generate` |
| `frontend/packages/apis/src/collaboration.ts` | ADD: `getScheduleChangeImpact`, `changeRitualDefinitionSchedule` wrappers |
| `frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/page.tsx` | MODIFY: Add ritual definition section; trigger EnsureTaskResources on load |
| `frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/components/RitualDefinitionSection.tsx` | NEW: Read-only + inline edit component |
| `frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/components/ScheduleChangeConfirmDialog.tsx` | NEW: Impact preview + confirmation dialog |
