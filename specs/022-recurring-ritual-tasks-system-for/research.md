# Research — Ritual Tasks Unification

**Phase 0 Output** | **Branch**: `022-recurring-ritual-tasks-system-for`

---

## Decision 1: Unified vs Separate Entity Model

**Decision**: Unified model — ritual task instances ARE regular tasks with additional ritual-specific metadata. One `collaboration.task` table, one RPC service, one set of queries.

**Rationale**:
- The user explicitly requested "1 set of db tables and rpc methods to keep system clean instead of having 2 separated standard vs ritual entity"
- Ritual instances share 90% of task properties: title, assignees, states, comments (chat), descriptions (docs), files, custom fields, workflow rules, notifications
- All existing views (kanban, list, gantt, calendar, analytics) should work for both task kinds without duplication
- Avoids the combinatorial explosion of maintaining parallel CRUD, assignment, notification, search, and analytics code

**Alternatives considered**:
- **Separate `ritual_task_instance` table**: Rejected — would require duplicating 50+ RPC methods, 80+ queries, and all cross-domain integrations (chat, docs, files, notifications)
- **Inheritance via shared base table**: Rejected — PostgreSQL table inheritance is not Citus-compatible and adds complexity

**Existing patterns to follow**: The current `collaboration.task` already supports flexible metadata via `custom_field_value` (JSONB) and flexible states via `project_state`. We extend this pattern rather than creating parallel structures.

---

## Decision 2: Task Kind Discriminator

**Decision**: Add `task_kind TEXT NOT NULL DEFAULT 'standard'` column to `collaboration.task` with CHECK constraint `('standard', 'ritual_instance')`.

**Rationale**:
- Clean discriminator for queries: `WHERE task_kind = 'ritual_instance'` for ritual-specific views
- Default `'standard'` ensures backward compatibility — all existing tasks are standard
- Existing queries that don't filter by `task_kind` continue to return all tasks (board/list views show both)
- Proto enum `TaskKind { TASK_KIND_STANDARD = 1; TASK_KIND_RITUAL_INSTANCE = 2; }` for API layer

**Alternatives considered**:
- **Boolean `is_ritual`**: Rejected — less extensible if we add more kinds later
- **JSONB metadata flag**: Rejected — not queryable efficiently, can't enforce at DB level

---

## Decision 3: Project Collaboration Mode

**Decision**: Add `collaboration_mode TEXT NOT NULL DEFAULT 'standard'` column to `collaboration.project` with CHECK constraint `('standard', 'ritual', 'mixed')`.

**Rationale**:
- Per spec FR-001: three modes (standard, ritual, mixed)
- Per spec FR-002: mode is a UI display hint, NOT a strict enforcement gate — users can create either task type regardless of mode
- Per spec FR-006: changeable by project owners/admins at any time, no data migration needed
- Simple column addition, no schema restructuring required

---

## Decision 4: Ritual Definition as New Table

**Decision**: Create `collaboration.ritual_definition` – a template entity that describes recurring work and generates ritual task instances.

**Rationale**:
- Ritual definitions are a distinct concept from tasks — they are templates, not work items
- One ritual definition → many task instances over time (1:N relationship)
- Contains: name, description, recurrence schedule (JSONB), completion window, timezone, default assignees, evidence requirements
- Archivable (stops generating new instances) without deleting historical data
- Cannot be modeled as a task itself — tasks are concrete work items, definitions are templates

**Existing patterns to follow**:
- `collaboration.custom_field_definition` → `collaboration.custom_field_value` pattern (definition → per-task values)
- `collaboration.workflow_rule` pattern (project-level configuration entity)

---

## Decision 5: Evidence Requirements & Submissions

**Decision**: Two new tables — `collaboration.evidence_requirement` (on ritual definitions) and `collaboration.evidence_submission` (on tasks).

**Rationale**:
- Evidence requirements are defined on the ritual definition (inherited by each instance as a checklist)
- Evidence submissions are per-task, per-requirement — concrete file/text/GPS data with approval workflow
- Evidence files reuse existing `files.file_metadata` system (domain-owned upload pattern, same as task file attachments)
- Approval status tracked per submission (pending → approved/rejected) with reviewer info
- Auto-approval for GPS geofence + time window validation (v1 scope)

**Existing patterns to follow**:
- File integration follows same domain-owned upload pattern as `RequestTaskFileUpload` / `ConfirmTaskFileUpload`
- Notification integration follows existing `NotificationPublisher` interface

---

## Decision 6: Ritual Instance State Lifecycle

**Decision**: Ritual instance lifecycle states are modeled using the EXISTING `collaboration.project_state` system, extended with new state categories.

**Rationale**:
- Current state categories: `todo`, `in_progress`, `done`, `cancelled`
- New categories for ritual instances: `submitted`, `verified`, `overdue`, `missed`, `skipped`
- Spec says "These will be defined as a separate state model for ritual instances — not mixed into existing project_state enum"
- However, the user wants ONE set of tables. The cleanest approach: extend `project_state.category` CHECK to include the new values. Projects in `ritual` or `mixed` mode can have states with these ritual-specific categories.
- When a project is created with mode `ritual` or `mixed`, auto-create default ritual states alongside standard states
- Standard tasks only use states with standard categories; ritual instances can use states with ritual categories
- This maps cleanly: kanban board columns show all states, but ritual-specific views can filter by category

**Alternative considered**:
- **Separate `ritual_instance_status` column on task**: Rejected — would create dual state tracking confusion. One source of truth (the state_id → project_state) is cleaner.
- **Hardcoded lifecycle enum on task**: Rejected — loses project-level customizability that the existing state system provides.

---

## Decision 7: Recurrence Schedule Storage

**Decision**: Store recurrence schedule as structured JSONB on `collaboration.ritual_definition` with a `recurrence_rule` column.

**Schema**:
```json
{
  "type": "daily" | "weekly" | "monthly" | "custom_interval",
  "interval": 1,
  "days_of_week": [1, 3, 5],          // for weekly: Mon=1, Wed=3, Fri=5
  "day_of_month": 5,                   // for monthly: 5th day
  "nth_weekday": { "week": 2, "day": 1 }, // for monthly: 2nd Monday
  "time_of_day": "09:00",
  "completion_window_hours": 24,
  "timezone": "Asia/Ho_Chi_Minh"
}
```

**Rationale**:
- JSONB provides flexibility for complex recurrence patterns without schema bloat
- Structured enough for application-level validation (Go struct with JSON tags)
- Sufficient for v1 (no cron expressions per spec)
- The `time_of_day` + `completion_window_hours` define the instance's active window

---

## Decision 8: Instance Generation Strategy

**Decision**: Background scheduler using the existing `flows` workflow system for idempotent instance generation.

**Rationale**:
- Per spec: "ritual instance generation (the scheduler) must be idempotent"
- Use rolling window proportional to recurrence interval (daily→30d, weekly→8w, monthly→3mo)
- Each generated instance is a regular `collaboration.task` with `task_kind = 'ritual_instance'` and `ritual_definition_id` FK
- Idempotency key: `(ritual_definition_id, scheduled_date)` — UNIQUE constraint prevents duplicates
- Scheduler runs periodically (e.g., every hour) and generates instances for all active definitions within their generation window

**Existing patterns to follow**:
- `flows.Client` is already used for async file processing workflows in collaboration service
- Background processing pattern is established in the codebase

---

## Decision 9: Reuse of Chat & Docs for Ritual Instances

**Decision**: Ritual task instances get auto-created chat channels and description documents, exactly like standard tasks.

**Rationale**:
- User explicitly requested: "ritual kind of task still reuse docs system for content/description and chat system"
- Existing `CreateTask` logic already auto-creates channel (`project_ticket_thread`) and document (`task_description`)
- No changes needed to the chat or docs integration — ritual instances flow through the same code path
- Evidence submissions are separate from the description document (evidence = structured artifacts, description = free-form rich text)

---

## Decision 10: Operational Health Dashboard Data

**Decision**: Health metrics computed via analytical queries on the existing task + evidence data, NOT via pre-aggregated snapshots.

**Rationale**:
- The existing analytics infrastructure (`GetTaskCountsByState`, `GetTaskCountsByAssignee`) already supports GROUP BY queries on tasks
- Extending with ritual-specific filters (task_kind, ritual_definition_id, evidence approval status) is straightforward
- Pre-aggregated snapshots add complexity and staleness risk
- For v1, real-time query performance is sufficient (indexes on `organization_id, project_id, task_kind, state_id`)
- If performance becomes an issue, materialized views can be added later (YAGNI)

---

## Decision 11: Evidence Auto-Approval Architecture

**Decision**: Auto-approval rules are evaluated in the collaboration logic layer when evidence is submitted.

**Rationale**:
- For v1: GPS geofence + time window only (per spec FR-036)
- When `ConfirmEvidenceSubmission` is called, logic layer checks the evidence requirement's approval mode:
  - `manual` → status = `pending_review`
  - `auto_approve` → evaluate GPS distance from target + time check → status = `approved` or `pending_review` (if check fails)
- GPS coordinates and timestamps are stored on the evidence submission record
- Future external automation (workflow system) can call an internal method to approve/reject

---

## Decision 12: Notification Types for Ritual Events

**Decision**: New notification types added to the existing notification system via `NotificationPublisher`.

**New notification types**:
- `ritual.instance_assigned` — instance generated and assigned to worker
- `ritual.evidence_submitted` — evidence submitted for review
- `ritual.evidence_approved` — evidence approved by reviewer
- `ritual.evidence_rejected` — evidence rejected, re-submission needed
- `ritual.instance_overdue` — completion window passed
- `ritual.instance_missed` — grace period expired
- `ritual.deadline_reminder` — approaching deadline (80% of window)
- `ritual.pattern_alert` — repeated misses detected (3+ times)

**Rationale**:
- Follows existing pattern: `task.assigned`, `task.status_changed`, etc.
- Resource subscription system already handles project-level subscriptions
- Ritual instances automatically get subscriptions via the same task creation flow

---

## Decision 13: Today View & Quick Info

**Decision**: "Today" view is a frontend feature powered by existing task listing queries with ritual-specific filters.

**Backend support**:
- `ListTasks` query extended with: `task_kind = 'ritual_instance'`, `due_date = today`, `assigned_to = current_employee`
- Sort by: overdue first, then closest deadline, then upcoming (per spec FR-056)
- Returns evidence completion status per instance

**Rationale**:
- No new backend infrastructure needed — existing list/filter/sort capabilities cover this
- Frontend-specific view optimization (UI hint based on `collaboration_mode`)

---

## Decision 14: Extending Existing Proto Service vs New Service

**Decision**: Extend existing `CollaborationService` with new RPC methods for ritual-specific operations.

**New methods (added to existing service)**:
- `CreateRitualDefinition`, `UpdateRitualDefinition`, `ArchiveRitualDefinition`, `ListRitualDefinitions`, `GetRitualDefinition`
- `CreateEvidenceRequirement`, `UpdateEvidenceRequirement`, `DeleteEvidenceRequirement`, `ListEvidenceRequirements`
- `SubmitEvidence`, `ApproveEvidence`, `RejectEvidence`, `ListEvidenceSubmissions`
- `GetOperationalHealth`, `GetRitualComplianceSummary`, `ExportRitualComplianceCSV`
- `SkipRitualInstance` (with documented reason)
- `RequestEvidenceFileUpload`, `ConfirmEvidenceFileUpload` (domain-owned upload)

**Rationale**:
- User wants ONE set of RPC methods — adding to existing service keeps it unified
- Ritual operations are within the collaboration domain (same schema, same project context)
- Proto can organize by comment groups (existing pattern: "// === Project States ===" sections)

---

## Summary of Schema Changes

| Change Type | Entity | Description |
|-------------|--------|-------------|
| **ALTER** | `collaboration.project` | Add `collaboration_mode` column |
| **ALTER** | `collaboration.project_state` | Extend `category` CHECK to include ritual categories |
| **ALTER** | `collaboration.task` | Add `task_kind`, `ritual_definition_id`, `scheduled_date`, `completion_deadline` columns |
| **NEW** | `collaboration.ritual_definition` | Recurring task template with schedule, window, timezone |
| **NEW** | `collaboration.ritual_definition_assignee` | Default assignees for generated instances |
| **NEW** | `collaboration.evidence_requirement` | Checklist items per ritual definition |
| **NEW** | `collaboration.evidence_submission` | Submitted evidence per task per requirement |
| **NEW** | `collaboration.evidence_file` | Links evidence submissions to file_metadata |
