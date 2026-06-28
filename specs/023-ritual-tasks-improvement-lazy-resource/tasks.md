# Tasks: Ritual Tasks — Lazy Resource Creation & Schedule Change Handling

**Input**: Design documents from `/specs/023-ritual-tasks-improvement-lazy-resource/`  
**Prerequisites**: plan.md ✓, research.md ✓, data-model.md ✓, contracts/collaboration-schedule-change.md ✓, quickstart.md ✓  
**Integration test stubs**: `backend/integration/ritual_tasks_improvement_test.go` ✓ (pre-existing)  
**Branch**: `023-ritual-tasks-improvement-lazy-resource`

---

## Execution Flow (summary)

```
T001  DB migration (schema)
T002  sqlc query additions
T003  sqlc generate
T004  Proto additions (RPCs + messages)
T005  buf generate + frontend RPC rebuild
  ↓
T006  [UNIT] GetScheduleChangeImpact impact calculation unit tests
T007  Scheduler logic: remove eager channel/doc creation
T008  EnsureTaskResources: logic interface + task_logic.go implementation
T009  GetScheduleChangeImpact: ritual_logic.go + ritual_connect.go handler
T010  ChangeRitualDefinitionSchedule: ritual_logic.go + ritual_connect.go handler
T011  GetTask: wire EnsureTaskResources call
T012  Proto mapping: new fields in task/definition converters
  ↓
T013  Integration tests (fill in all t.Skip stubs)
T014  Run full test suite
  ↓
T015  [P] Frontend API wrappers (collaboration.ts)
T016  [P] RitualDefinitionSection component
T017  [P] ScheduleChangeConfirmDialog component
T018  Task detail page: wire ritual section + EnsureTaskResources on load
T019  Frontend pnpm build verification
```

---

## Phase 3.1: Database Schema & Code Generation

### T001 — DB migration + schema.sql changes

**Files**:
- `backend/database/scripts/schema.sql`
- `backend/database/scripts/migrations/NNNN_lazy_ritual_resources.sql` _(replace NNNN with next sequential number)_

**Steps**:
1. Find the next migration number:
   ```bash
   ls backend/database/scripts/migrations/ | sort | tail -3
   ```
2. Create migration file with exactly the SQL from `data-model.md § Migration File`:
   ```sql
   ALTER TABLE collaboration.task
     ADD COLUMN IF NOT EXISTS detached_from_ritual BOOLEAN NOT NULL DEFAULT FALSE;

   ALTER TABLE collaboration.ritual_definition
     ADD COLUMN IF NOT EXISTS schedule_version INT NOT NULL DEFAULT 1;
   ```
3. In `schema.sql`, under `collaboration.task`: add `detached_from_ritual BOOLEAN NOT NULL DEFAULT FALSE` after the `skip_reason` column.
4. In `schema.sql`, under `collaboration.ritual_definition`: add `schedule_version INT NOT NULL DEFAULT 1` after `generation_window_days`.
5. Apply migration: `cd backend && ./scripts/migrate.sh up`
6. Verify:
   ```bash
   docker compose exec postgres psql -P pager -U postgres -d tech_office_db \
     -c "\d collaboration.task" | grep detached_from_ritual
   docker compose exec postgres psql -P pager -U postgres -d tech_office_db \
     -c "\d collaboration.ritual_definition" | grep schedule_version
   ```

---

### T002 — Add 6 new sqlc queries to collaboration.query.sql

**File**: `backend/database/scripts/collaboration.query.sql`

Add all 6 queries exactly as specified in `data-model.md § sqlc Query Changes`:

1. **`CountScheduleChangeImpact :one`** — read-only, returns `(untouched_count, touched_count)`.
   - Uses `@organization_id`, `@ritual_definition_id`, `@today_cutoff` named params.
   - Untouched = `channel_id IS NULL` AND `state_category = 'scheduled'` AND no evidence submissions.
   - Touched = everything else in the future set.

2. **`SoftDeleteUntouchedFutureInstances :execrows`** — UPDATE setting `deleted_at = NOW()` for the untouched set.

3. **`DetachTouchedFutureInstances :execrows`** — UPDATE setting `ritual_definition_id = NULL`, `task_kind = 'standard'`, `detached_from_ritual = TRUE` for remaining future instances.

4. **`UpdateRitualDefinitionSchedule :one`** — UPDATE setting `recurrence_rule`, `schedule_version = schedule_version + 1`, `last_generated_date = @waterline_reset_date`, `updated_at = NOW()`. Returns full row.

5. **`EnsureTaskChannel :one`** — atomic UPDATE setting `channel_id = @channel_id` WHERE `channel_id IS NULL`. Returns row only if UPDATE succeeded (0 rows = already set).

6. **`EnsureTaskDocument :one`** — atomic UPDATE setting `description_document_id = @description_document_id` WHERE `description_document_id IS NULL`. Returns row only if UPDATE succeeded.

All queries must include `organization_id` filter (Citus shard key constraint).

---

### T003 — Run sqlc generate

```bash
cd backend && sqlc generate
```

Commit the generated files:
- `backend/database/collaboration.query.sql.go`
- `backend/database/models.go` (struct gains `DetachedFromRitual bool` and `ScheduleVersion int32`)

Verify `CountScheduleChangeImpactRow` struct exists in the generated output.

---

### T004 — Proto additions to collaboration.proto

**File**: `backend/rpc/v1/collaboration.proto`

**Changes** (all from `contracts/collaboration-schedule-change.md`):

1. **`RitualDefinition` message**: add field `int32 schedule_version = 13;` after `google.protobuf.Timestamp updated_at = 12;`.

2. **`Task` message**: find the existing ritual fields (`ritual_definition_id`, `scheduled_date`, `completion_deadline`, `skip_reason`) and add after them:
   ```proto
   bool detached_from_ritual = XX; // use next available field number
   ```

3. **Two new request/response message groups** (insert after `SkipRitualInstanceResponse`):
   - `GetScheduleChangeImpactRequest` / `GetScheduleChangeImpactResponse`
   - `ChangeRitualDefinitionScheduleRequest` / `ChangeRitualDefinitionScheduleResponse`
   
   _(Exact message definitions in contracts/collaboration-schedule-change.md § New Messages)_

4. **Two new RPCs** in `CollaborationService` (after `SkipRitualInstance`):
   ```proto
   rpc GetScheduleChangeImpact(GetScheduleChangeImpactRequest) returns (GetScheduleChangeImpactResponse) {
     option (rpc.v1.access_control) = {
       required_permissions: ["collab.manageRitualDefinition"]
     };
   }
   rpc ChangeRitualDefinitionSchedule(ChangeRitualDefinitionScheduleRequest) returns (ChangeRitualDefinitionScheduleResponse) {
     option (rpc.v1.access_control) = {
       required_permissions: ["collab.manageRitualDefinition"]
     };
   }
   ```

---

### T005 — buf generate + frontend RPC rebuild

```bash
cd backend && buf generate
```

Commit generated:
- `backend/rpc/v1/collaboration.pb.go`
- `backend/rpc/v1/collaborationv1connect/collaboration.connect.go`

Then rebuild frontend RPC package:
```bash
cd frontend && pnpm -w -r build
```

Verify the new TypeScript types are available in `frontend/packages/rpc`.

---

## Phase 3.1.5: Unit Tests (BEFORE Implementation)

### [X] T006 — Write unit tests for GetScheduleChangeImpact impact classification logic

**File**: `backend/internal/collaboration/ritual_schedule_change_test.go` _(new file)_

The `GetScheduleChangeImpact` logic's core classification of future instances into "untouched" vs. "touched" buckets is a pure decision function that can be exercised without a live database. This logic will live in a helper (e.g., `classifyRitualInstance`) called by the query layer. Write table-driven tests that demonstrate all relevant states:

```go
package collaboration

import (
    "testing"
    "github.com/stretchr/testify/assert"
)
```

**Test: `TestClassifyRitualInstance`** — table-driven, covering:

| Scenario | channel_id | state_category | has_evidence | expected bucket |
|----------|------------|----------------|--------------|-----------------|
| fresh generated, never opened | NULL | scheduled | no | untouched (→ soft-delete) |
| user opened detail view (channel created) | set | scheduled | no | touched (→ detach) |
| evidence submitted, still scheduled | NULL | scheduled | yes | touched (→ detach) |
| state moved to in_progress, no channel | NULL | in_progress | no | touched (→ detach) |
| state moved to in_progress, with channel | set | in_progress | no | touched (→ detach) |
| completed instance (verified) | set | verified | yes | touched (→ detach — but shouldn't be future, guard via date) |
| skipped instance | NULL | skipped | no | touched (→ detach) |

**Test: `TestComputeScheduleChangeImpactCounts`** — verifies that given a list of instances with mixed states, the aggregate counts match expected totals:

- All untouched → `untouched_count = N`, `touched_count = 0`
- Mix of untouched + touched → counts split correctly
- All touched → `untouched_count = 0`, `touched_count = M`
- Empty list → both counts = 0

**Test: `TestEstimateNewInstanceCount`** — verifies the `instances_to_create` estimate:
- Daily rule, 30-day window, fresh definition (no previous instances) → approx 30
- Weekly rule (Mon only), 30-day window → approx 4–5
- Weekly rule (Mon + Wed + Fri), 30-day window → approx 12–13
- Monthly rule (15th of month), 30-day window → 0 or 1 depending on window position

These tests validate the impact preview calculation that drives the `GetScheduleChangeImpactResponse` before any DB interaction occurs.

**Note**: If `classifyRitualInstance` and `estimateNewInstanceCount` helpers are currently unexported (package-internal), tests in the _same package_ (`package collaboration`) have full access. No mocking framework needed — these are pure functions.

**Implementation hint for the test file**: The classification predicate mirrors the SQL WHERE clause in `CountScheduleChangeImpact`. Extracting it as a Go function enables both unit testing and reuse in `GetScheduleChangeImpact` for the `instances_to_create` estimate (which must be computed in Go, not SQL).

---

## Phase 3.2: Core Backend Implementation

### T007 — Scheduler: remove eager channel/doc creation from ritual instance generation

**File**: `backend/internal/collaboration/scheduler_logic.go`

In `GenerateRitualInstances`, delete the blocks that:
1. Call `l.ChatLogic.CreateChannel(...)` and enroll project members.
2. Call `l.DocsLogic.CreateDocument(...)`.

Replace the `channelID` and `descriptionDocID` variables with zero-value `dbuuid.NullUUID{}` (NULL).

Pass `ChannelID: dbuuid.NullUUID{}` and `DescriptionDocumentID: dbuuid.NullUUID{}` to `CreateTask`.

Verify: after this change, `l.ChatLogic` and `l.DocsLogic` are still referenced in `task_logic.go` (for standard task creation — do NOT remove those call sites).

---

### T008 — Implement EnsureTaskResources in task_logic.go

**Files**:
- `backend/internal/collaboration/logic.go` — add to `Logic` interface
- `backend/internal/collaboration/task_logic.go` — implement

**Interface addition** (in `Logic`):
```go
EnsureTaskResources(ctx context.Context, tx database.DBTX, orgID, employeeID, taskID dbuuid.UUID) (*rpcv1.Task, error)
```

**Implementation** (`task_logic.go`):

```
func (l *logicImpl) EnsureTaskResources(ctx, tx, orgID, employeeID, taskID) (*rpcv1.Task, error):
  1. Fetch task by (orgID, taskID).
  2. If task.TaskKind != TaskKindRitualInstance: return task proto unchanged.
  3. If task.ChannelID.Valid AND task.DescriptionDocumentID.Valid: return task proto unchanged (idempotent fast path).
  4. Create channel via l.ChatLogic.CreateChannel(...) — same params as scheduler did before.
  5. Enroll project members via EnrollProjectMembersInChannel.
  6. EnsureTaskChannel atomic UPDATE (db query from T002) — if 0 rows returned, channel was set concurrently; fetch current value.
  7. Create doc via l.DocsLogic.CreateDocument(...).
  8. EnsureTaskDocument atomic UPDATE — if 0 rows returned, doc was set concurrently; fetch current value.
  9. Call registerTaskResourceSurfaces to wire V2 notification surfaces.
  10. Re-fetch task and return mapped proto.
```

Error contract: no error returned if concurrent caller already set resources (idempotent). Log warnings for failed resource creation (don't fail the GetTask call for the user).

---

### T009 — Implement GetScheduleChangeImpact

**Files**:
- `backend/internal/collaboration/logic.go` — add to `Logic` interface
- `backend/internal/collaboration/ritual_logic.go` — implement
- `backend/internal/collaboration/ritual_connect.go` — add RPC handler

**Interface**:
```go
GetScheduleChangeImpact(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.GetScheduleChangeImpactRequest) (*rpcv1.GetScheduleChangeImpactResponse, error)
```

**Logic** (`ritual_logic.go`):
1. Parse `req.RitualDefinitionId` → `defID`.
2. Load definition; verify caller is creator or project admin (reuse `GetProjectMemberRole`).
3. Parse `req.NewRecurrenceRule` into internal `recurrenceRule` struct (validate rule fields).
4. Compute `todayCutoff` in the definition's timezone using `loadTimezone(def.Timezone)`.
5. Call `l.Queries.CountScheduleChangeImpact(ctx, tx, params)` → `(untouched_count, touched_count)`.
6. Estimate `instances_to_create`: call `computeDatesInWindow` with `lastGenerated = yesterday`, window = `def.GenerationWindowDays`, using the **new** rule. `len(dates)` = estimate.
7. Map to `GetScheduleChangeImpactResponse{InstancesToRemove: untouched, InstancesToDetach: touched, InstancesToCreate: estimate}`.

**Connect handler** (`ritual_connect.go`):
- Use `TenantPool` (user-facing read operation).
- Extract `orgID` + `employeeID` from auth context.
- Call `l.Logic.GetScheduleChangeImpact(ctx, tx, orgID, employeeID, req)`.
- No `txn.WithTxn` needed (read-only).

---

### T010 — Implement ChangeRitualDefinitionSchedule

**Files**:
- `backend/internal/collaboration/logic.go` — add to `Logic` interface
- `backend/internal/collaboration/ritual_logic.go` — implement
- `backend/internal/collaboration/ritual_connect.go` — add RPC handler

**Interface**:
```go
ChangeRitualDefinitionSchedule(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.ChangeRitualDefinitionScheduleRequest) (*rpcv1.ChangeRitualDefinitionScheduleResponse, error)
```

**Logic** (`ritual_logic.go`) — all within a single transaction passed from the Connect layer:
1. Validate `req.Confirmed == true`; if not, return `codes.FailedPrecondition`.
2. Load definition; verify creator or project admin.
3. Parse new recurrence rule (validate).
4. Compute `todayCutoff` in definition's timezone.
5. `SoftDeleteUntouchedFutureInstances(orgID, defID, todayCutoff)` → `removedRows`.
6. `DetachTouchedFutureInstances(orgID, defID, todayCutoff)` → `detachedRows`.
7. Marshal new recurrence rule to JSONB.
8. `UpdateRitualDefinitionSchedule(orgID, defID, newRuleJSON, yesterdayDate)` → updated def row.
9. Call `GenerateRitualInstances(ctx, tx, orgID, now)` — reuses existing scheduler logic to populate fresh instances on the new pattern.
   - Count new instances from the return value.
10. Map updated definition → `RitualDefinition` proto.
11. Return `ChangeRitualDefinitionScheduleResponse{RitualDefinition: proto, InstancesRemoved: removedRows, InstancesDetached: detachedRows, InstancesCreated: created}`.

**Connect handler** (`ritual_connect.go`):
- Use `TenantPool` with `txn.WithTxn` wrapping the entire operation.
- Extract auth context; pass `orgID`, `employeeID` to logic.

---

### T011 — Wire EnsureTaskResources in GetTask handler

**File**: `backend/internal/collaboration/task_logic.go` (or the GetTask handler in `connect.go`)

In the `GetTask` logic method, after fetching the task:

```go
if task.TaskKind == TaskKindRitualInstance {
    return l.EnsureTaskResources(ctx, tx, orgID, employeeID, taskID)
}
```

This is the single hook point where lazy provisioning is triggered. Standard tasks are unaffected.

---

### T012 — Proto mapping: new fields in task and ritual definition converters

**File**: wherever `taskToProto`, `ritualDefinitionToProto` (or equivalent mapper functions) are defined — likely `task_logic.go` and `ritual_logic.go`.

1. **`taskToProto`**: populate `DetachedFromRitual` from `task.DetachedFromRitual` (the new bool column from T001/T003).
2. **`ritualDefinitionToProto`**: populate `ScheduleVersion` from `def.ScheduleVersion` (the new int32 column).

These are simple field assignments; ensure they compile after T003 (sqlc generate) and T005 (buf generate).

---

## Phase 3.3: Integration Tests

### T013 — Fill in integration test implementations (replace t.Skip stubs)

**File**: `backend/integration/ritual_tasks_improvement_test.go`

The test file already contains full `t.Run` scenario trees. Implement any missing testWorld helpers referenced by those tests. Based on the existing file, the following helper methods must be added to `testWorld` (likely in a new support file or the existing helpers file):

| Helper | Signature | Notes |
|--------|-----------|-------|
| `getScheduleChangeImpact` | `(user, defID, rule) → *rpcv1.GetScheduleChangeImpactResponse` | calls GetScheduleChangeImpact RPC |
| `changeRitualDefinitionSchedule` | `(user, defID, rule) → *rpcv1.ChangeRitualDefinitionScheduleResponse` | calls with `confirmed=true` |
| `changeRitualDefinitionScheduleWithConfirmation` | `(user, defID, rule, confirmed bool) → error` | for testing rejected unconfirmed request |
| `getRitualDefinition` | `(user, defID) → *rpcv1.RitualDefinition` | calls GetRitualDefinition RPC |
| `injectPastRitualInstance` | `(user, proj, def) → string (taskID)` | direct DB insert with `scheduled_date = today - 2` |
| `createProjectWithMode` | `(user, name, key, mode) → *rpcv1.Project` | creates project in ritual mode |
| `dailyRecurrenceRule` | `() → *rpcv1.RecurrenceRule` | returns daily recurrence rule proto |
| `weeklyRecurrenceRule` | `() → *rpcv1.RecurrenceRule` | returns weekly (Monday-only) recurrence rule |

Check `backend/integration/` for existing helper files and add new helpers there, following naming conventions from existing tests (`collaboration_*.go` helper files).

---

### T014 — Run full integration test suite

```bash
cd backend && go test ./integration/... -v -count=1
```

All tests must pass — zero failures. Fix any regressions before proceeding. No `t.Skip("TODO")` stubs for this feature may remain.

Feature-specific run (faster iteration):
```bash
cd backend && go test ./integration/... -run TestRitualTasksImprovement -v -count=1
```

---

## Phase 3.4: Frontend Implementation

> [P] = can run in parallel with other [P] tasks

### T015 [P] — Frontend API wrappers

**File**: `frontend/packages/apis/src/collaboration.ts`

Add the two typed wrapper functions exactly as specified in `contracts/collaboration-schedule-change.md § Frontend API Wrapper Contracts`:

1. `getScheduleChangeImpact(params: GetScheduleChangeImpactParams): Promise<ScheduleChangeImpact>`
2. `changeRitualDefinitionSchedule(params: ChangeRitualDefinitionScheduleParams): Promise<ScheduleChangeResult>`

Add the four TypeScript interface definitions:
- `GetScheduleChangeImpactParams`
- `ScheduleChangeImpact`
- `ChangeRitualDefinitionScheduleParams`
- `ScheduleChangeResult`

Use `rpcCall()` helper (consistent with other wrappers in the file). Convert `Timestamp` fields to `Date` where applicable.

Export new interfaces and functions from the package index.

---

### [X] T016 [P] — RitualDefinitionSection component

**File**: `frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/components/RitualDefinitionSection.tsx` _(new file)_

Component responsibilities:
- Display ritual definition name and recurrence pattern (always visible for `task_kind = ritual_instance`).
- Show inline edit controls if `canEditDefinition` (caller is creator or project admin).
- On save: call `getScheduleChangeImpact` → pass impact to `ScheduleChangeConfirmDialog` → on confirm, call `changeRitualDefinitionSchedule`.
- Show updated recurrence and `schedule_version` after successful change.

**Styling rules** (Constitution - Principle VII):
- All colors via `useThemeColors()` hook — no hardcoded hex/rgb.
- All interactive elements must have `data-testid` attributes.
- Use MUI components with `sx` prop only for layout (no `bgcolor: 'primary.main'` pattern).

---

### T017 [P] — ScheduleChangeConfirmDialog component

**File**: `frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/components/ScheduleChangeConfirmDialog.tsx` _(new file)_

Component responsibilities:
- Receives `impact: ScheduleChangeImpact` as prop.
- Displays counts: instances to remove, instances to detach (become standalone tasks), instances to create.
- Requires explicit user confirmation (confirm button sets `confirmed = true`).
- Cancel button closes dialog with no change.
- `data-testid` attributes on dialog, remove/detach/create counts, cancel and confirm buttons.
- Colors via `useThemeColors()`.

---

### [X] T018 — Task detail page: wire ritual section

**File**: `frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/page.tsx`

1. Import `RitualDefinitionSection` from `./components/RitualDefinitionSection`.
2. When `task.taskKind === 'ritual_instance'`, render `<RitualDefinitionSection>` in the task sidebar/detail area.
3. The page's `getTask` fetch already triggers `EnsureTaskResources` server-side (T011), so no additional client-side resource creation step is needed.
4. Ensure `task.detachedFromRitual` is forwarded to the section component so it can show the "was part of ritual X" advisory label if true.

---

### T019 — Frontend build verification

```bash
cd frontend && pnpm -w -r build
```

Fix any TypeScript type errors introduced by the new proto types or API wrappers. No new `any` casts allowed.

---

## Dependencies

```
T001 (schema) → T002 (queries) → T003 (sqlc gen)
T004 (proto)  → T005 (buf gen)
T003 + T005 → T006 (unit tests — can be written after codegen artifacts exist)
T003 + T005 → T007 (scheduler fix)
T003 + T005 → T008 (EnsureTaskResources)
T003 + T005 → T009 (GetScheduleChangeImpact)
T003 + T005 → T010 (ChangeRitualDefinitionSchedule)
T008 → T011 (wire GetTask)
T003 + T005 → T012 (proto mappers)
T007 + T008 + T009 + T010 + T011 + T012 → T013 (integration tests)
T013 → T014 (full test suite)
T005 → T015 [P], T016 [P], T017 [P]
T015 + T016 + T017 → T018
T018 → T019
```

---

## Parallel Execution Groups

**Group A** (after T005, independent):
```
T006, T007, T008, T009, T010, T012 can all start simultaneously
T011 depends on T008 completing first
```

**Group B** (frontend, after T005):
```
T015, T016, T017 can run in parallel
T018 requires T015 + T016 + T017
```

**Example Task agent commands for Group A**:
```bash
# In separate terminals after T005 completes:
# Agent 1 — unit tests + scheduler fix (T006, T007)
# Agent 2 — EnsureTaskResources (T008) then wire GetTask (T011)
# Agent 3 — GetScheduleChangeImpact (T009)
# Agent 4 — ChangeRitualDefinitionSchedule (T010)
# Agent 5 — proto mappers (T012)
```

---

## Definition of Done

- [ ] Migration applied; columns verified in DB
- [ ] `sqlc generate` and `buf generate` committed (no hand-edits)
- [ ] Unit tests in `ritual_schedule_change_test.go` pass (`go test ./internal/collaboration/...`)
- [ ] Scheduler no longer creates channels or docs for ritual instances
- [ ] `GetTask` on a ritual instance with `channel_id IS NULL` provisions resources atomically
- [ ] `GetScheduleChangeImpact` returns correct counts for all instance states
- [ ] `ChangeRitualDefinitionSchedule` (confirmed=true) applies all changes atomically
- [ ] `ChangeRitualDefinitionSchedule` (confirmed=false) is rejected with FailedPrecondition
- [ ] Integration tests: `go test ./integration/... -run TestRitualTasksImprovement` — ALL PASS
- [ ] Full suite: `go test ./integration/...` — ZERO FAILURES
- [ ] Frontend builds without TypeScript errors: `pnpm -w -r build`
- [ ] No `t.Skip("TODO")` stubs remain for this feature
