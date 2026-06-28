# Tasks: Unified Ritual Tasks System

**Input**: Design documents from `/specs/022-recurring-ritual-tasks-system-for/`
**Prerequisites**: plan.md ✓ | research.md ✓ | data-model.md ✓ | contracts/ ✓ | quickstart.md ✓
**Branch**: `022-recurring-ritual-tasks-system-for`

---

## Summary

Extend the collaboration system to support **recurring ritual tasks** alongside standard project tasks using a unified data model. Ritual instances ARE regular `collaboration.task` rows with `task_kind = 'ritual_instance'`. This adds: 8 DB migrations, new SQL queries (sqlc), proto contract additions (buf), logic layer extensions, connect layer handlers, a background scheduler (flows), and frontend components across project settings, task detail, today view, and health dashboard.

### UX Design Decisions (added 2026-03-12)

**Docs/Description model**: The ritual **definition** stores a rich-text description as a markdown field on its row (not linked to a full docs document). This serves as the SOP/instructions — what the ritual is and how to complete it. Each ritual **instance** auto-creates its own `task_description` document (as all tasks do), serving as the per-occurrence work log where workers add context for that specific run. The UI on the instance task detail page shows the definition description as a read-only "Instructions" panel above the instance's own work-note doc.

**Ritual definition create/edit UX**: The creation form is implemented as a **dedicated page** (not a dialog), because the form has 6+ fields plus a full CRUD section for evidence requirements — too complex for a modal. Route: `/workspace/projects/[id]/rituals/[definitionId]` for editing, `/workspace/projects/[id]/rituals/new` for creating. The settings Rituals tab becomes a list-only view with navigation links.

---

## Format: `[ID] [P?] Description`
- **[P]**: Can run in parallel with other [P] tasks in the same group (different files, no shared dependencies)
- All file paths relative to repo root unless stated

---

## Phase 3.1: Database Migrations

Migrations go to `backend/k8s/base/database/migrations/`. Use format `YYYYMMDDHHMMSS_<name>.{up,down}.sql`. Run `bash backend/scripts/migrate.sh` to apply.

- [x] **T001** [P] Migration: add `collaboration_mode` column to `collaboration.project`
  - File: `backend/k8s/base/database/migrations/20260312100000_ritual_project_collab_mode.up.sql` (and `.down.sql`)
  - `ALTER TABLE collaboration.project ADD COLUMN IF NOT EXISTS collaboration_mode TEXT NOT NULL DEFAULT 'standard' CHECK (collaboration_mode IN ('standard', 'ritual', 'mixed'));`
  - `CREATE INDEX IF NOT EXISTS idx_project_collab_mode ON collaboration.project(organization_id, collaboration_mode) WHERE is_archived = FALSE;`
  - Rollback: `DROP INDEX`, `ALTER TABLE ... DROP COLUMN`

- [x] **T002** [P] Migration: extend `project_state.category` CHECK constraint to include ritual categories
  - File: `backend/k8s/base/database/migrations/20260312100001_ritual_project_state_categories.up.sql` (and `.down.sql`)
  - `DROP CONSTRAINT project_state_category_check`, then `ADD CONSTRAINT` including `'scheduled', 'submitted', 'verified', 'overdue', 'missed', 'skipped'`
  - Rollback: restore original CHECK constraint (standard categories only)

- [x] **T003** [P] Migration: add ritual columns to `collaboration.task` (columns only, FK comes in T008)
  - File: `backend/k8s/base/database/migrations/20260312100002_ritual_task_columns.up.sql` (and `.down.sql`)
  - `ADD COLUMN IF NOT EXISTS task_kind TEXT NOT NULL DEFAULT 'standard' CHECK (task_kind IN ('standard', 'ritual_instance'))`
  - `ADD COLUMN IF NOT EXISTS ritual_definition_id UUID`
  - `ADD COLUMN IF NOT EXISTS scheduled_date DATE`
  - `ADD COLUMN IF NOT EXISTS completion_deadline TIMESTAMPTZ`
  - `ADD COLUMN IF NOT EXISTS skip_reason TEXT`
  - `CREATE INDEX idx_task_ritual_today ON collaboration.task(organization_id, task_kind, completion_deadline) WHERE task_kind = 'ritual_instance' AND is_deleted = FALSE;`
  - Rollback: drop indices + drop columns

- [x] **T004** Migration: create `collaboration.ritual_definition` table
  - File: `backend/k8s/base/database/migrations/20260312100003_ritual_definition.up.sql` (and `.down.sql`)
  - Full CREATE TABLE per data-model.md §4 + `SELECT create_distributed_table(...)` colocated with `public.organization`
  - Indices: `idx_ritual_def_project`, `idx_ritual_def_generation`
  - Rollback: `DROP TABLE collaboration.ritual_definition`
  - **Must complete before T005, T006, T008**

- [x] **T005** [P] Migration: create `collaboration.ritual_definition_assignee` table
  - File: `backend/k8s/base/database/migrations/20260312100004_ritual_definition_assignee.up.sql` (and `.down.sql`)
  - Full CREATE TABLE per data-model.md §5 + `create_distributed_table` + `idx_rda_definition`
  - Rollback: `DROP TABLE collaboration.ritual_definition_assignee`
  - **Depends on T004**

- [x] **T006** [P] Migration: create `collaboration.evidence_requirement` table
  - File: `backend/k8s/base/database/migrations/20260312100005_evidence_requirement.up.sql` (and `.down.sql`)
  - Full CREATE TABLE per data-model.md §6 + `create_distributed_table` + `idx_evidence_req_definition`
  - Rollback: `DROP TABLE collaboration.evidence_requirement`
  - **Depends on T004**

- [x] **T007** Migration: create `collaboration.evidence_submission` table
  - File: `backend/k8s/base/database/migrations/20260312100006_evidence_submission.up.sql` (and `.down.sql`)
  - Full CREATE TABLE per data-model.md §7 + `create_distributed_table` + all 4 indices
  - Rollback: `DROP TABLE collaboration.evidence_submission`
  - **Depends on T004, T006**

- [x] **T008** Migration: add FK from `collaboration.task` to `collaboration.ritual_definition` + idempotency index + view_type extension
  - File: `backend/k8s/base/database/migrations/20260312100007_ritual_task_fk_and_index.up.sql` (and `.down.sql`)
  - `ADD CONSTRAINT fk_task_ritual_definition FOREIGN KEY (organization_id, ritual_definition_id) REFERENCES collaboration.ritual_definition(organization_id, id) ON DELETE RESTRICT`
  - `CREATE UNIQUE INDEX idx_task_ritual_instance_unique ON collaboration.task(organization_id, ritual_definition_id, scheduled_date) WHERE task_kind = 'ritual_instance' AND ritual_definition_id IS NOT NULL AND is_deleted = FALSE`
  - `CREATE INDEX idx_task_ritual_definition ON collaboration.task(...)`
  - `ALTER TABLE collaboration.saved_view DROP CONSTRAINT saved_view_view_type_check; ALTER TABLE collaboration.saved_view ADD CONSTRAINT saved_view_view_type_check CHECK (view_type IN ('board', 'list', 'gantt', 'calendar', 'today', 'health'));`
  - Rollback: drop FK, drop indices, restore original saved_view constraint
  - **Depends on T003, T004**

- [x] **T009** Apply all migrations
  - `bash backend/scripts/migrate.sh` (run from repo root)
  - Verify with `docker compose exec postgres psql -P pager -U postgres -d tech_office_db -c "\dt collaboration.*"`

---

## Phase 3.1.5: Test Scenario Stubs (Constitution Gate)

**GATE: These stubs MUST be composed and reviewed BEFORE Phase 3.2 implementation begins.**

All files in `backend/integration/`. Use `newTestWorld(t)` via the `backend-integration-testing` skill pattern. Each leaf `t.Run` contains `t.Skip("TODO: implement after scenario review")` until Phase 3.7.

- [x] **T010** Compose test stubs: `backend/integration/collaboration_ritual_test.go`
  - `TestRitualDefinitionCRUD` — scenarios: create with recurrence + evidence requirements, get, update (COALESCE partial), archive (stops generation, preserved history), list (archived filter)
  - `TestRitualDefinitionPermissions` — scenarios: viewer denied, member denied, admin succeeds, owner succeeds

- [x] **T011** [P] Compose test stubs: `backend/integration/collaboration_evidence_test.go`
  - `TestEvidenceRequirementCRUD` — scenarios: create with types/approval modes, sequential positions, update partial, delete (RESTRICT check), list ordered by position
  - `TestEvidenceSubmission` — scenarios: text evidence (pending_review), photo + GPS, auto-approve within geofence, auto-approve outside geofence (remains pending), unassigned worker submission, reviewer approve (notify submitter), reviewer reject with comment (notify + reset state), all required approved → verified transition
  - `TestEvidenceFileUpload` — scenarios: request presigned URL, confirm upload links file

- [x] **T012** [P] Compose test stubs: `backend/integration/collaboration_ritual_instance_test.go`
  - `TestRitualInstanceGeneration` — scenarios: daily recurrence generates 30-day window, correct scheduled_date + completion_deadline, task_kind=ritual_instance, auto-assigned, chat channel + doc created; idempotency (no duplicates); archived definition stops generation
  - `TestRitualInstanceLifecycle` — scenarios: scheduled → open → in_progress → submitted → verified; deadline passes → overdue (notify); grace expires → missed; admin skip with reason → skipped
  - `TestRitualInstanceTodayView` — scenarios: instances sorted (overdue first, then deadline asc, then upcoming); empty list; project filter

- [x] **T013** [P] Compose test stubs: `backend/integration/collaboration_health_test.go`
  - `TestOperationalHealth` — scenarios: summary counts (total, on_time, overdue, missed, pending_review), completion_rate + on_time_rate; per-ritual breakdown (health_score); per-employee compliance (on_time vs late vs missed); date range filter
  - `TestHealthDashboardCSVExport` — scenarios: CSV includes all fields (instance, status, employee, dates)

- [x] **T014** [P] Compose test stubs: `backend/integration/collaboration_ritual_notification_test.go`
  - `TestRitualNotifications` — scenarios: instance_assigned on generation, evidence_submitted (admin notified), evidence_approved (submitter notified), evidence_rejected (submitter + state reset), instance_overdue (assignee + manager), instance_missed (manager)

- [x] **T015** [P] Extend existing test stubs: `backend/integration/collaboration_project_test.go`
  - `TestProjectCollaborationMode` — add to existing file: ritual mode creates ritual states, mixed mode creates both, standard is backward-compatible, mode change adds ritual states without disrupting existing

- [x] **T016** [P] Extend existing test stubs: `backend/integration/collaboration_task_test.go`
  - `TestTaskKindFiltering` — add to existing file: no filter returns both, kind=standard returns only standard, kind=ritual_instance returns only ritual

- [x] **T017** Developer review of all test scenarios (T010–T016)
  - Verify completeness: happy path, error cases, authorization, multi-tenancy, idempotency
  - Approve before proceeding to Phase 3.2

---

## Phase 3.2: SQL Queries

Add all queries to `backend/database/scripts/collaboration.query.sql`. These are ADDITIONS to the existing file; do not modify existing queries. After all queries are added, run codegen once.

- [x] **T018** [P] Add ritual definition queries (from `contracts/ritual-queries.sql`)
  - `CreateRitualDefinition :one`
  - `GetRitualDefinition :one`
  - `UpdateRitualDefinition :one` (COALESCE partial update)
  - `ArchiveRitualDefinition :one`
  - `ListRitualDefinitions :many`
  - `ListActiveRitualDefinitionsForGeneration :many` (for scheduler)
  - `UpdateRitualDefinitionLastGenerated :exec`

- [x] **T019** [P] Add ritual definition assignee queries
  - `CreateRitualDefinitionAssignee :one` (with ON CONFLICT DO NOTHING)
  - `DeleteRitualDefinitionAssignee :exec`
  - `DeleteAllRitualDefinitionAssignees :exec`
  - `ListRitualDefinitionAssignees :many`

- [x] **T020** [P] Add evidence requirement queries
  - `CreateEvidenceRequirement :one`
  - `GetEvidenceRequirement :one`
  - `UpdateEvidenceRequirement :one` (COALESCE partial update)
  - `DeleteEvidenceRequirement :exec`
  - `ListEvidenceRequirements :many` (ordered by position ASC)
  - `GetNextEvidenceRequirementPosition :one`

- [x] **T021** [P] Add evidence submission queries
  - `CreateEvidenceSubmission :one`
  - `GetEvidenceSubmission :one`
  - `UpdateEvidenceSubmissionApproval :one`
  - `ListEvidenceSubmissions :many` (by task_id)
  - `ListEvidenceSubmissionsByRequirement :many`
  - `GetTaskEvidenceProgress :one` (multi-subquery for counts per task — see contracts/ritual-queries.sql)

- [x] **T022** [P] Extend existing task queries for ritual columns
  - `ListTasks`: add `AND (sqlc.narg('task_kind')::text IS NULL OR task_kind = sqlc.narg('task_kind'))` filter
  - `UpdateTask`: add `skip_reason = COALESCE(sqlc.narg('skip_reason'), skip_reason)` to COALESCE set
  - `CreateTask`: add optional `task_kind`, `ritual_definition_id`, `scheduled_date`, `completion_deadline` params
  - Add `ListRitualInstancesByDefinition :many` query (filter by organization_id + ritual_definition_id, ordered by scheduled_date DESC)
  - Add `GetTodayRitualInstances :many` query (filter by organization_id + employee_id + completion_deadline within today, ordered by overdue first then deadline ASC)

- [x] **T023** Run SQL codegen
  - `cd backend && sqlc generate`
  - Verify generated files in `backend/database/` compile: `cd backend && go build ./...`

---

## Phase 3.3: Proto Contract

Additions to `backend/rpc/v1/collaboration.proto`. After proto edits, run buf generate. Then update frontend.

- [x] **T024** Add new enums to `backend/rpc/v1/collaboration.proto`
  - `TaskKind { TASK_KIND_UNSPECIFIED=0; TASK_KIND_STANDARD=1; TASK_KIND_RITUAL_INSTANCE=2; }`
  - `CollaborationMode { COLLABORATION_MODE_UNSPECIFIED=0; COLLABORATION_MODE_STANDARD=1; COLLABORATION_MODE_RITUAL=2; COLLABORATION_MODE_MIXED=3; }`
  - `EvidenceType { ... 7 values per contracts/ritual-additions.proto }`
  - `ApprovalMode { ... 2 values }`
  - `ApprovalStatus { ... 3 values }`
  - `RecurrenceType { ... 4 values }`
  - Also extend `Project` message: add `CollaborationMode collaboration_mode`
  - Also extend `Task` message: add `TaskKind task_kind`, `string ritual_definition_id`, `google.protobuf.Timestamp scheduled_date` (or `string scheduled_date`), `google.protobuf.Timestamp completion_deadline`, `string skip_reason`, `TaskEvidenceProgress evidence_progress` (nullable)

- [x] **T025** Add new messages to `backend/rpc/v1/collaboration.proto`
  - `RecurrenceRule`, `NthWeekday`, `RitualDefinition`, `EvidenceRequirement`, `AutoApproveConfig`, `GpsTarget`
  - `EvidenceSubmission`, `GpsCoordinates`
  - `OperationalHealthSummary`, `RitualHealthDetail`, `EmployeeComplianceSummary`
  - All request/response message pairs per `contracts/ritual-additions.proto`:
    - Ritual definition: Create/Get/Update/Archive/List (5 pairs × 2 = 10 messages)
    - Evidence requirement: Create/Update/Delete/List (4 pairs × 2 = 8 messages)
    - Evidence submission: Submit/Approve/Reject/List/RequestFileUpload/ConfirmFileUpload (6 pairs × 2 = 12 messages)
    - Ritual instance: Skip (1 pair)
    - Health: GetOperationalHealth/GetRitualComplianceSummary/ExportRitualComplianceCSV (3 pairs × 2 = 6 messages)
    - `TaskEvidenceProgress`, `TaskEvidenceRequirementStatus`
  - **Depends on T024**

- [x] **T026** Add new RPCs to `CollaborationService` in `backend/rpc/v1/collaboration.proto`
  - 5 ritual definition RPCs with `access_control` options (admin/owner/operator for mutations; +employee for reads)
  - 4 evidence requirement RPCs
  - 6 evidence submission RPCs (all roles can submit/list; admin/owner/operator for approve/reject)
  - 1 SkipRitualInstance RPC (admin/owner/operator)
  - 3 health RPCs (all roles)
  - Per `contracts/ritual-additions.proto` commented service additions
  - **Depends on T025**

- [x] **T027** Run proto codegen
  - `cd backend && buf generate`
  - Verify: `cd backend && go build ./...`

- [x] **T028** Re-export new ritual/evidence services from `frontend/packages/rpc/index.ts`
  - Export new generated ritual, evidence, and health message types and service clients
  - Run `pnpm -r build` in `frontend/` to refresh workspace artifacts
  - **Depends on T027**

---

## Phase 3.4: Backend Logic Layer

All files in `backend/internal/collaboration/`. Logic layer methods accept `tx database.DBTX` and parsed auth params (`employeeID`, `orgID dbuuid.UUID`). No connection pools in logic structs.

- [x] **T029** Create `backend/internal/collaboration/ritual_logic.go`
  - `CreateRitualDefinition(ctx, tx, orgID, employeeID, req)` — atomically: create ritual_definition row, upsert assignees (delete old + insert new), create evidence requirements in order; return assembled `RitualDefinition` proto
  - `GetRitualDefinition(ctx, tx, orgID, id)` — fetch definition + list assignees + list evidence requirements
  - `UpdateRitualDefinition(ctx, tx, orgID, employeeID, req)` — COALESCE update + sync assignees (delete all + re-insert)
  - `ArchiveRitualDefinition(ctx, tx, orgID, id, archive bool)` — update is_archived
  - `ListRitualDefinitions(ctx, tx, orgID, projectID, includeArchived bool)` — list with assignees + requirements assembled
  - Helper: `assemblRitualDefinition(def, assignees, requirements)` → `*rpcv1.RitualDefinition`

- [x] **T030** [P] Create `backend/internal/collaboration/evidence_logic.go`
  - `CreateEvidenceRequirement(ctx, tx, orgID, ritualDefID, req)` — get next position, insert
  - `UpdateEvidenceRequirement(ctx, tx, orgID, id, req)` — COALESCE partial update
  - `DeleteEvidenceRequirement(ctx, tx, orgID, id)` — delete (DB enforces RESTRICT on existing submissions but handle FK error gracefully)
  - `ListEvidenceRequirements(ctx, tx, orgID, ritualDefID)` — ordered by position
  - `SubmitEvidence(ctx, tx, orgID, employeeID, req)` — create submission with `pending_review` status; trigger auto-approval check if `approval_mode = 'auto_approve'`; send `evidence_submitted` notification to project admin
  - `checkAutoApprove(req, config)` — GPS geofence check; if inside → approve immediately, else keep pending
  - `ApproveEvidence(ctx, tx, orgID, reviewerID, submissionID, comment)` — update status + reviewer fields; send `evidence_approved` notification
  - `RejectEvidence(ctx, tx, orgID, reviewerID, submissionID, comment)` — update status; transition ritual instance state back to `in_progress`; send `evidence_rejected` notification
  - `ListEvidenceSubmissions(ctx, tx, orgID, taskID)` — list all submissions for a task

- [x] **T031** [P] Create `backend/internal/collaboration/scheduler_logic.go`
  - `GenerateRitualInstances(ctx, tx, orgID, now time.Time)` — list active definitions needing generation; for each: compute dates based on recurrence_rule JSONB; for each date: CreateTask with task_kind=ritual_instance, ritual_definition_id, scheduled_date, completion_deadline using unique constraint for idempotency (ON CONFLICT skip); auto-assign from definition assignees; update last_generated_date
  - `ParseRecurrenceRule(rule jsonb)` → structured recurrence logic (daily/weekly/monthly/custom_interval with days_of_week, day_of_month, nth_weekday)
  - `ComputeDatesInWindow(rule, lastGenerated, windowDays int, tz *time.Location)` → `[]time.Time`
  - Uses AdminPool (cross-org) — must be called from connect layer with proper pool choice

- [x] **T032** [P] Create `backend/internal/collaboration/health_logic.go`
  - `GetOperationalHealth(ctx, tx, orgID, projectID, start, end time.Time)` → `OperationalHealthSummary` + `[]RitualHealthDetail`
  - `GetRitualComplianceSummary(ctx, tx, orgID, projectID, ritualDefID, start, end time.Time)` → `[]EmployeeComplianceSummary`
  - `ExportRitualComplianceCSV(ctx, tx, orgID, projectID, start, end time.Time)` → `[]byte` CSV

- [x] **T033** [P] Extend `backend/internal/collaboration/project_logic.go`
  - `CreateProject`: accept `collaboration_mode` from request and set on row; after creating the project, call `createDefaultRitualStates(ctx, tx, orgID, projectID, mode)` when mode is `ritual` or `mixed`
  - `createDefaultRitualStates(ctx, tx, orgID, projectID, mode)` — insert the 8 ritual states (Scheduled/scheduled, Open/todo, In Progress/in_progress, Submitted/submitted, Verified/verified, Overdue/overdue, Missed/missed, Skipped/skipped) per data-model.md table; for `mixed` also call existing standard states creation
  - Keep changes minimal — only add mode handling and state bootstrapping

- [x] **T034** [P] Extend `backend/internal/collaboration/task_logic.go`
  - `CreateTask`: accept optional `task_kind`, `ritual_definition_id`, `scheduled_date`, `completion_deadline` new params
  - `ListTasks`: accept optional `task_kind` filter via `sqlc.narg`
  - `UpdateTask`: accept optional `skip_reason` new param
  - `GetTask`: if `task_kind == 'ritual_instance'`, call `GetTaskEvidenceProgress` and embed in response
  - Add `SkipRitualInstance(ctx, tx, orgID, employeeID, taskID, reason string)` — validate task is ritual_instance, update state to `skipped` + set skip_reason, send notification

- [x] **T035** [P] Extend `backend/internal/collaboration/analytics_logic.go` (or create notification helper)
  - Add ritual notification helpers: `notifyRitualInstanceAssigned`, `notifyEvidenceSubmitted`, `notifyEvidenceApproved`, `notifyEvidenceRejected`, `notifyRitualOverdue`, `notifyRitualMissed`
  - Each calls the existing notification logic layer with appropriate event type and payload
  - Follow existing notification patterns in the codebase (see backend/docs/NOTIFICATION-SYSTEM-ARCHITECTURE.md)

---

## Phase 3.5: Connect Layer

Add all RPC handlers to `backend/internal/collaboration/connect.go`. Connect layer: extracts auth context, chooses pool, wraps in `txn.WithTxn`, calls logic layer. Never nest `txn.WithTxn`.

- [x] **T036** Add ritual definition RPC handlers in `backend/internal/collaboration/connect.go`
  - `CreateRitualDefinition`: auth → TenantPool → `txn.WithTxn` → `ritualLogic.CreateRitualDefinition`
  - `GetRitualDefinition`: auth → TenantPool → `ritualLogic.GetRitualDefinition`
  - `UpdateRitualDefinition`: auth → TenantPool → `txn.WithTxn` → `ritualLogic.UpdateRitualDefinition`
  - `ArchiveRitualDefinition`: auth → TenantPool → `txn.WithTxn` → `ritualLogic.ArchiveRitualDefinition`
  - `ListRitualDefinitions`: auth → TenantPool → `ritualLogic.ListRitualDefinitions`

- [x] **T037** [P] Add evidence RPC handlers in `backend/internal/collaboration/connect.go`
  - `CreateEvidenceRequirement`, `UpdateEvidenceRequirement`, `DeleteEvidenceRequirement`, `ListEvidenceRequirements`
  - `SubmitEvidence`, `ApproveEvidence`, `RejectEvidence`, `ListEvidenceSubmissions` — use `txn.WithTxn` for mutations (evidence submission + notification in one tx)
  - `RequestEvidenceFileUpload`, `ConfirmEvidenceFileUpload` — delegate to file upload logic (existing pattern from `file_upload.go`)

- [x] **T038** [P] Add remaining ritual RPC handlers in `backend/internal/collaboration/connect.go`
  - `SkipRitualInstance`: auth → TenantPool → `txn.WithTxn` → task logic
  - `GetOperationalHealth`, `GetRitualComplianceSummary`, `ExportRitualComplianceCSV`: auth → TenantPool → health logic

- [x] **T039** Wire new logic structs in `backend/cmd/server.go`
  - Instantiate any new logic structs (if separate from existing `Collaboration` struct vs methods added to it)
  - Ensure init order: file storage → chat → docs → collaboration logic (extended) → collaboration connect (extended)
  - Register flows scheduler job: create a `flows.Job` that calls `scheduler_logic.GenerateRitualInstances` using AdminPool, configure run interval (e.g., hourly)
  - **Depends on T029–T038**

---

## Phase 3.6: Frontend Implementation

All components follow: `useThemeColors()` for colors, `data-testid` on interactive elements, `rpcCall()` for API calls, typed wrappers in `packages/apis`.

- [x] **T040** Create `frontend/packages/apis/src/collaboration-ritual.ts`
  - Typed wrapper functions for all ritual/evidence/health RPCs
  - Converts proto `Timestamp` → `Date`, `CollaborationMode` enum → string union type, etc.
  - Export from `frontend/packages/apis/src/index.ts`

- [x] **T041** [P] Extend project creation UI for collaboration mode
  - `frontend/apps/web/src/app/workspace/projects/components/CreateProjectDialog.tsx` (or equivalent project creation form)
  - Add `CollaborationMode` radio group: Standard / Ritual / Mixed
  - Default: `COLLABORATION_MODE_STANDARD`
  - Use `useThemeColors()`, add `data-testid="collab-mode-selector"`

- [x] **T042** [P] Create Ritual Definitions settings view
  - `frontend/apps/web/src/app/workspace/projects/[id]/components/RitualDefinitionsSettings.tsx`
  - List ritual definitions (name, recurrence summary, assignees, evidence count, archived badge)
  - Create/Edit ritual definition dialog with RecurrenceRuleForm + EvidenceRequirementList editor
  - Archive/restore toggle per definition
  - Add "Rituals" tab to project settings when `collaboration_mode` is `ritual` or `mixed`
  - Use `useThemeColors()`, all interactive elements have `data-testid`

- [x] **T043** [P] Create Today View component
  - `frontend/apps/web/src/app/workspace/projects/[id]/components/TodayView.tsx`
  - For workers: lists their ritual instances due today, sorted by urgency (overdue first, then deadline ASC)
  - Each card shows: ritual name, deadline, state badge (overdue/open/in_progress), evidence progress bar (`TaskEvidenceProgress`)
  - Click → opens task detail
  - Add "Today" view type to project view switcher when mode includes ritual
  - Use `useThemeColors()`, `data-testid="today-view-list"`, `data-testid="ritual-instance-card-{id}"`

- [x] **T044** [P] Create Evidence Checklist in task detail
  - `frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/components/EvidenceChecklist.tsx`
  - Shows per-requirement status (pending/approved/rejected icon), evidence type icon, deadline if set
  - "Submit" button per requirement → opens `EvidenceSubmitForm`
  - `frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/components/EvidenceSubmitForm.tsx`
  - Form switches based on evidence type: file upload (photo/pdf/file), text area (text_note), URL input (link), GPS capture (gps_checkin), audio recorder (voice_memo)
  - Only rendered for tasks with `task_kind === 'TASK_KIND_RITUAL_INSTANCE'`
  - Use `useThemeColors()`, all form fields have `data-testid`

- [x] **T045** [P] Create Evidence Review Panel
  - `frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/components/EvidenceReviewPanel.tsx`
  - For reviewers (admin/operator): shows submitted evidence with Approve/Reject buttons
  - Shows file preview (image/pdf), text content, GPS map link, device metadata (timestamp, GPS accuracy)
  - Reject requires comment input
  - Only visible to users with appropriate role
  - Use `useThemeColors()`, `data-testid="approve-btn"`, `data-testid="reject-btn"`, `data-testid="reject-comment"`

- [x] **T046** [P] Create Health Dashboard view
  - `frontend/apps/web/src/app/workspace/projects/[id]/components/HealthDashboard.tsx`
  - Date range picker (default: past 30 days)
  - Summary cards: completion rate, on-time rate, pending reviews count
  - Per-ritual breakdown table: ritual name, health score bar, verified/overdue/missed counts
  - Per-employee compliance table: employee name, on_time/late/missed counts, compliance rate
  - "Export CSV" button → downloads compliance CSV
  - Add "Health" view type to project view switcher when mode includes ritual
  - Use `useThemeColors()`, `data-testid="health-dashboard"`, `data-testid="export-csv-btn"`

---

## Phase 3.7: Integration Tests

Fill in test stubs from Phase 3.1.5 with real implementations. Follow the `backend-integration-testing` skill: `newTestWorld(t)`, dev tokens, RPC clients, arrange/act/assert pattern.

- [x] **T047** Implement `TestRitualDefinitionCRUD` and `TestRitualDefinitionPermissions` in `backend/integration/collaboration_ritual_test.go`
  - Use admin dev token to create ritual project + ritual definition with recurrence + evidence requirements
  - Assert definition returned with all requirements and assignees
  - Assert partial update only changes specified fields
  - Assert archive removes from default list, appears with `include_archived=true`
  - Assert viewer/member tokens get permission denied on create

- [x] **T048** [P] Implement evidence tests in `backend/integration/collaboration_evidence_test.go`
  - Create ritual instance task, submit text/photo/GPS evidence
  - Assert auto-approve logic (inside geofence → approved, outside → pending)
  - Approve and reject flows with reviewer comments
  - Assert notifications sent (check notification table) after approve/reject
  - Assert state transitions (rejected → task goes back to in_progress)
  - File upload: request presigned URL → confirm → assert file linked

- [x] **T049** [P] Implement instance tests in `backend/integration/collaboration_ritual_instance_test.go`
  - Create ritual definition, trigger `GenerateRitualInstances`, assert instances created with correct dates
  - Assert idempotency (run generation twice, no duplicates)
  - Full lifecycle: scheduled → open → in_progress → submitted → verified
  - Assert overdue transition when deadline passes
  - Assert skip with reason
  - Today view: assert sorted order with multiple instances across states

- [x] **T050** [P] Implement health tests in `backend/integration/collaboration_health_test.go`
  - Set up project with instances in multiple states (verified/overdue/missed/pending)
  - Assert health summary counts match
  - Assert per-ritual and per-employee breakdowns
  - Assert date range filter excludes out-of-range instances
  - Assert CSV export contains expected rows

- [x] **T051** [P] Implement notification tests in `backend/integration/collaboration_ritual_notification_test.go`
  - Generate instance → assert `ritual.instance_assigned` notification in DB
  - Submit evidence → assert `ritual.evidence_submitted` to admin
  - Approve → assert `ritual.evidence_approved` to submitter
  - Reject → assert `ritual.evidence_rejected` to submitter
  - Overdue + missed scenarios → assert correct recipients

- [x] **T052** [P] Extend `backend/integration/collaboration_project_test.go`
  - Add `TestProjectCollaborationMode` scenarios
  - Create ritual-mode project → assert ritual states bootstrapped
  - Create mixed-mode → assert both standard + ritual states
  - Create standard → no ritual states (backward compatible)

- [x] **T053** [P] Extend `backend/integration/collaboration_task_test.go`
  - Add `TestTaskKindFiltering` scenarios
  - Create both standard and ritual_instance tasks → list without filter returns both
  - List with `task_kind=standard` returns only standard
  - List with `task_kind=ritual_instance` returns only ritual instances

- [x] **T054** Run full integration test suite
  - `cd backend && go test ./integration/... -v 2>&1 | tail -50`
  - ALL tests must pass (zero failures)
  - Fix any regressions before proceeding to polish
  - No remaining `t.Skip("TODO")` stubs for this feature

---

## Phase 3.8: Polish

Only after T054 passes with zero failures.

- [ ] **T055** [P] Verify all interactive frontend elements have `data-testid` attributes across all new components (T041–T046)

- [ ] **T056** [P] Verify Dark/Light mode in all new frontend components
  - No hardcoded hex colors
  - All colors via `useThemeColors()` hook
  - All `sx={{ bgcolor: ... }}` replaced with `colors.*` patterns

- [ ] **T057** [P] Update `backend/docs/NOTIFICATION-SYSTEM-ARCHITECTURE.md`
  - Add new notification event types: `ritual.instance_assigned`, `ritual.evidence_submitted`, `ritual.evidence_approved`, `ritual.evidence_rejected`, `ritual.instance_overdue`, `ritual.instance_missed`
  - Update event taxonomy table, delivery pipeline, and any call graph diagrams
  - Update document version and date header

- [ ] **T058** [P] Update `backend/docs/SYSTEM-ARCHITECTURE.md`
  - Update FK Reference Map appendix: new FKs (ritual_definition → project, task → ritual_definition, evidence_requirement → ritual_definition, evidence_submission → task + evidence_requirement + employee)
  - Note: No new domains or tier changes — collaboration domain extended only
  - Update document version and date header

- [ ] **T059** Final smoke test
  - Manual: create ritual project, create ritual definition, trigger generation, submit evidence, approve, verify health dashboard shows metrics
  - Run `cd backend && go test ./integration/...` one final time to confirm clean state

---

## Phase 3.9: Mixed Project UX Improvements

State-type aware views for projects using `collaboration_mode = 'mixed'`. States now carry a `state_type` discriminator (`standard` | `ritual`) enabling dual swim-lane layouts and kind-specific analytics.

- [x] **T060** [P] DB migration: add `state_type` column to `collaboration.project_state`
  - 4 migration files: add column, add CHECK constraint, backfill ritual categories, add composite index
  - Files: `20260312100009` – `20260312100012`

- [x] **T061** [P] SQL queries: update `CreateProjectState` (+ $10 state_type) and `UpdateProjectState` (+ COALESCE state_type)

- [x] **T062** [P] Proto: add `StateType` enum, `state_type` field to `ProjectState`, `CreateProjectStateRequest`, `UpdateProjectStateRequest`

- [x] **T063** Codegen: `sqlc generate` + `buf generate` + verify `go build ./...`

- [x] **T064** Backend logic: constants.go (`DefaultMixedProjectStates`), project_logic.go (switch on mode, state_type converters), state_logic.go (pass state_type)

- [x] **T065** Frontend types: `StateType` type, `stateType` field in `ProjectState` interface, proto converters, API params

- [x] **T066** [P] BoardView: dual swim lane layout for mixed projects (ritual above, standard below), cross-lane DnD blocked

- [x] **T067** [P] ListView: conditional "Kind" column with RepeatIcon chip for ritual tasks, state dropdown filtered by lane

- [x] **T068** [P] GanttView: tasks grouped by kind (ritual first), RepeatIcon indicator on ritual task rows, fixed typo

- [x] **T069** [P] CalendarView: RepeatIcon on ritual task chips in mixed projects

- [x] **T070** [P] TodayView: merge ritual + standard tasks due today for mixed projects, TaskCard with kind badge

- [x] **T071** [P] AnalyticsView: kind breakdown section (ritual vs standard completion rates) for mixed projects

---

## Phase 3.10: UX Improvements

Fixes for discoverability, consistency, and clarity across project views.

- [x] **T072** [P] CalendarView: clicking task chips opens side panel (quick view), not navigates away
  - File: `frontend/apps/web/src/app/workspace/projects/[id]/components/CalendarView.tsx`
  - Chip `onClick` → call `onTaskClick?.(task)` to open `TaskDetailSidePanel`
  - Only identifier text within chip should navigate to full page (keep existing `onTaskIdentifierClick`)
  - Consistent with BoardView behavior where card click → side panel, identifier click → navigate

- [x] **T073** [P] Board inline "add task" enhanced with task kind selector + assignee quick-pick
  - File: `frontend/apps/web/src/app/workspace/projects/[id]/components/BoardView.tsx`
  - For `mixed` or `ritual` projects: show a task kind toggle (Standard / Ritual Instance) in the inline add form
  - Add an assignee quick-select (Autocomplete using project members from context)
  - Pass `taskKind` and `assigneeIds` to `createTask()` API call
  - Standard projects: no kind toggle visible (default = standard)

- [x] **T074** [P] TaskDetailSidePanel: clear "open in new tab" vs "redirect" behavior
  - File: `frontend/apps/web/src/app/workspace/projects/[id]/components/TaskDetailSidePanel.tsx`
  - Top icon button (`OpenInNewIcon`): opens task page **in new browser tab** via `window.open(..., '_blank')`
  - Bottom button: changes text to **"View Full Details"** and **redirects in current tab** (existing `router.push`)
  - Tooltip on icon button: "Open in new tab"
  - Both buttons already exist — just change behavior and labels for clarity

- [x] **T075** [P] CalendarView: "New Ritual" FAB for ritual/mixed projects
  - File: `frontend/apps/web/src/app/workspace/projects/[id]/components/CalendarView.tsx`
  - For ritual/mixed projects: add a floating "New Ritual" button that navigates to `/workspace/projects/{id}/rituals/new`
  - Teaching UX: helps users discover ritual creation from the calendar view where it feels natural
  - Standard projects: button not visible

---

## Dependencies

```
T001, T002, T003 (independent, parallel)
    ↓
T004 (ritual_definition table)
    ↓
T005, T006 (parallel, both depend on T004)
    ↓
T007 (depends on T004, T006)
    ↓
T008 (depends on T003, T004)
    ↓
T009 (apply all migrations — depends on T001–T008)
    ↓
T010–T017 (test stubs — depend on T009; T010–T016 in parallel)
    ↓
T018–T022 (SQL queries — depend on T009; T018–T022 in parallel)
    ↓
T023 (sqlc generate — depends on T018–T022)
    ↓
T024–T026 (proto additions — depend on T023; sequential within proto)
    ↓
T027 (buf generate)
    ↓
T028 (frontend rpc re-export)
    ↓
T029–T035 (logic layer — depend on T023; T029–T035 in parallel)
    ↓
T036–T038 (connect layer — depend on T029–T035; T036–T038 in parallel)
    ↓
T039 (server.go wiring — depends on T036–T038, T028)
    ↓
T040–T046 (frontend — depend on T028, T039; T040–T046 in parallel)
    ↓
T047–T053 (integration tests — depend on T039; T047–T053 in parallel except T047 is anchor)
    ↓
T054 (full test suite run — depends on T047–T053)
    ↓
T055–T059 (polish — depend on T054)
```

---

## Parallel Execution Examples

```sh
# Group A: DB migrations (run together, each a separate file)
Task: "T001 — migration: ritual_project_collab_mode"
Task: "T002 — migration: ritual_project_state_categories"
Task: "T003 — migration: ritual_task_columns"

# Group B: ritual_definition + dependent tables (sequential within group)
Task: "T004 — migration: ritual_definition table"
# then in parallel:
Task: "T005 — migration: ritual_definition_assignee"
Task: "T006 — migration: evidence_requirement"
# then:
Task: "T007 — migration: evidence_submission"
Task: "T008 — migration: FK + idempotency index + saved_view"

# Group C: test stubs (all in parallel after migrations apply)
Task: "T010 — test stubs: collaboration_ritual_test.go"
Task: "T011 — test stubs: collaboration_evidence_test.go"
Task: "T012 — test stubs: collaboration_ritual_instance_test.go"
Task: "T013 — test stubs: collaboration_health_test.go"
Task: "T014 — test stubs: collaboration_ritual_notification_test.go"
Task: "T015 — extend: collaboration_project_test.go"
Task: "T016 — extend: collaboration_task_test.go"

# Group D: SQL queries (all in parallel)
Task: "T018 — ritual definition queries"
Task: "T019 — ritual definition assignee queries"
Task: "T020 — evidence requirement queries"
Task: "T021 — evidence submission queries"
Task: "T022 — extend existing task queries"

# Group E: logic layer (all in parallel after sqlc generate)
Task: "T029 — ritual_logic.go"
Task: "T030 — evidence_logic.go"
Task: "T031 — scheduler_logic.go"
Task: "T032 — health_logic.go"
Task: "T033 — extend project_logic.go"
Task: "T034 — extend task_logic.go"
Task: "T035 — notification helpers"

# Group F: connect layer (all in parallel after logic layer)
Task: "T036 — ritual definition RPC handlers"
Task: "T037 — evidence RPC handlers"
Task: "T038 — skip + health RPC handlers"

# Group G: frontend (all in parallel after rpc re-export + server wiring)
Task: "T040 — collaboration-ritual.ts API wrappers"
Task: "T041 — project creation mode selector"
Task: "T042 — ritual definitions settings view"
Task: "T043 — today view"
Task: "T044 — evidence checklist + submit form"
Task: "T045 — evidence review panel"
Task: "T046 — health dashboard"

# Group H: integration tests (all in parallel)
Task: "T047 — ritual definition CRUD tests"
Task: "T048 — evidence tests"
Task: "T049 — instance lifecycle tests"
Task: "T050 — health tests"
Task: "T051 — notification tests"
Task: "T052 — project mode tests"
Task: "T053 — task kind filter tests"
```
