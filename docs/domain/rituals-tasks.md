# Tasks & Rituals

Projects, tasks, workflow automation, and the recurring-operational-task ("ritual") system
with evidence capture and compliance reporting. Owned by `internal/collaboration`;
contract in `rpc/v1/collaboration.proto` (`CollaborationService`, 63 RPCs — the largest
surface in the system).

**Status date: 2026-08-22.** Supersedes specs 017, 022, 023, 028, 029, 034 (034 is in
development on this branch; its backend change is described here as shipped because the
code and migration are both present).

## Projects

`collaboration.project` — `name`, `key` (`^[A-Z][A-Z0-9_]{0,9}$`, unique per org, used as
the task identifier prefix), `visibility` (`public | private`), `next_task_number`,
denormalised `member_count` / `task_count`.

`collaboration_mode IN ('standard','ritual','mixed')` is a **UI display hint**, not an
enforcement — it tells the client whether to lead with the board or with today's rituals.

Every new organization gets a default project created inside the registration transaction
(see [organization-people.md](organization-people.md#registration)).

`collaboration.project_membership` roles: `owner | admin | member | viewer`. Ritual
definition management requires `admin` or `owner` on the project — that is a *resource*
check inside the logic layer, on top of the `collab.manageRitualDefinition` permission
checked by the interceptor.

### States and levels

`collaboration.project_state` is a per-project workflow column, ordered, with a
`state_category` and a `state_type`:

- categories: `todo`, `in_progress`, `done`, `cancelled` (standard) plus `scheduled`,
  `submitted`, `verified`, `overdue`, `missed`, `skipped` (ritual)
- `state_type IN ('standard','ritual')` partitions which states apply to which task kind

`collaboration.task_level` is the per-project priority/severity ladder.

## Tasks

`collaboration.task`:

- **Identity** — `identifier` (`{project_key}-{n}`, unique per project), `title`
- **Hierarchy** — `parent_task_id`, `depth` ≤ 5, `path uuid[]` materialised ancestor path
  with a GIN index for subtree queries
- **Workflow** — `state_id`, `level_id`
- **Scheduling** — `start_date`, `due_date`, `estimated_hours`
- **Cross-domain** — `channel_id` → `chat.channel` (comments),
  `description_document_id` → `docs.document` (rich description), `file_ids uuid[]` →
  `files.file_metadata`
- **Ritual fields** — `task_kind IN ('standard','ritual_instance')`,
  `ritual_definition_id`, `scheduled_date`, `completion_deadline`, `skip_reason`,
  `detached_from_ritual`

Task descriptions are real documents and task comments are real chat channels. The
description document is created with `document_type = 'task_description'` and is filtered
out of the workspace docs list.

Search indexes on `title`: PGroonga (multilingual full text) **and** trigram (fuzzy).

`collaboration.task_assignee` supports roles `assignee | reviewer | approver`.

RPC groups: tasks (`CreateTask`…`GetTaskByIdentifier`), assignment (`AssignTask`,
`UnassignTask`, `WatchTask`, `UnwatchTask`), custom fields, workflow rules, membership,
saved views, analytics (`GetTaskAnalytics`, `ExportTasksCSV`), file upload
(`RequestTaskFileUpload`, `ConfirmTaskFileUpload`).

### Custom fields, workflow rules, saved views

- `custom_field_definition` / `custom_field_value` — types `text`, `number`,
  `single_select`, `multi_select`, `date`, `user`, `checkbox`.
- `workflow_rule` / `workflow_rule_execution` — triggers `state_entered`, `state_exited`,
  `field_changed`, `task_created`; actions `set_state`, `set_field`, `assign_user`,
  `notify`, `close_task`. Executions are logged, so a surprising state change is traceable.
- `saved_view` — view types `board`, `list`, `gantt`, `calendar`, `today`, `health`.

## Rituals

A ritual is a recurring operational task with mandatory evidence — a shift checklist, a
safety inspection, a closing procedure.

### Definition

`collaboration.ritual_definition`:

| Column | Meaning |
|---|---|
| `recurrence_rule` | JSONB. Types: `daily`, `weekly`, `monthly`, `custom_interval` |
| `completion_window_hours` | default 24 — how long after the scheduled date the instance stays completable |
| `timezone` | IANA name (`Asia/Tokyo`) **or** a whole-hour offset string (`UTC+8`, `UTC-5`); falls back to UTC |
| `generation_window_days` | default 30 — how far ahead instances are materialised |
| `last_generated_date` | generation waterline |
| `schedule_version` | monotonic, incremented on every recurrence change |
| `is_archived` | archived definitions stop generating |

### Assignment

Two mechanisms, both resolved at generation time:

- `ritual_definition_assignee` — named individuals.
- `ritual_definition_department_pool` — a department plus a strategy:
  - `round_robin`, using `last_assigned_employee_id` as a waterline into the sorted member
    list. There is deliberately **no FK** on that column: the employee may have left the
    department mid-cycle and the waterline must survive that.
  - `least_assigned`.

### Generation — the global sweep (feature 034)

Before 034, each definition owned a `flows` schedule row (`ritual_def_<id>`). That is gone.
Migration `20260822000002_drop_per_definition_ritual_schedules.up.sql` deletes those rows,
because they pointed at a workflow name no longer in the registry and would keep enqueueing
runs forever.

Today there is exactly one job, `ritual_generation_sweep`
(`internal/collaboration/scheduler_workflow.go`), scheduled every **1 minute** by
`flows.ScheduleTx` at server start. `ScheduleTx` upserts by schedule ID, so every instance
and every restart converges on one row.

Each sweep:

1. `ListOrganizationIDsWithActiveRitualDefinitions` (via `AdminPool` — cross-org).
2. For each org, call `Logic.GenerateRitualInstances(ctx, adminPool, orgID, now)`.
3. On error, log the organization and **continue** — one org must not abort the run
   (FR-008). Per-definition isolation is inherited from `GenerateRitualInstances`, not
   reimplemented.
4. Report `{OrganizationsProcessed, DefinitionsProcessed, TotalGenerated}`.

The sweep is a thin wrapper on purpose. Which dates a definition produces is a pure
function of its stored recurrence rule, timezone, `last_generated_date` and
`generation_window_days` — never of when a timer fired. Reusing the generation function
unmodified is what makes the sweep's output identical to the old per-definition
scheduler's by construction. `Sweep` is exported so integration tests can drive a cycle
without standing up a flows worker.

Generation is **idempotent**: `CheckRitualInstanceExists` plus a partial unique index
`(organization_id, ritual_definition_id, scheduled_date) WHERE task_kind='ritual_instance'`
means a double run creates nothing extra.

### Lazy resource creation (feature 023)

Generating an instance does **not** create its chat channel or description document. A
30-day window across many definitions would otherwise create thousands of channels and
documents nobody opens. `EnsureTaskResources` creates them on first user interaction with
the task detail view.

This has a second use: "did anyone touch this instance?" becomes cheap to answer.

### Schedule changes

Changing a recurrence rule has to decide what happens to already-generated future
instances. `GetScheduleChangeImpact` previews; `ChangeRitualDefinitionSchedule` executes.

`classifyScheduleChangeImpact` (`ritual_schedule_classification.go`) is a pure function —
no DB access, fully unit-testable — partitioning future instances by `isUntouched`:

> still on the initial workflow state **and** zero comments **and** no evidence submitted
> **and** no chat channel created

- **Untouched** → soft-deleted; they were never real to anyone.
- **Touched** → `detached_from_ritual = true`, surviving as standalone tasks. Someone did
  work against them; that work is not deleted.

### Instance state

`determineRitualTaskStateCategory` (`ritual_task_state.go`) derives a category from the
evidence snapshot, in this precedence order:

1. all required evidence approved → `verified`
2. all required submitted, none rejected → `submitted`
3. any submission → `in_progress`
4. `completion_deadline` passed → `overdue`
5. `scheduled_date` in the future → `scheduled`
6. otherwise → `todo`

`SkipRitualInstance` records a `skip_reason` and moves the instance to `skipped`.

**Reconciliation is evidence-driven only.** `reconcileRitualTaskState` is called from
`SubmitEvidence`, `ApproveEvidence` and `RejectEvidence` — nowhere else. See
[Known drift](#known-drift).

## Evidence

`collaboration.evidence_requirement` — per definition, ordered by `position`:
`evidence_types text[]` drawn from `photo | voice_memo | pdf | file | link | text_note |
gps_checkin`, `is_required`, `approval_mode IN ('manual','auto_approve')` with
`auto_approve_config` JSONB, and an optional `deadline_offset_hours`.

`collaboration.evidence_submission` — per task instance: the chosen `evidence_type`, plus
`file_id` / `text_content` / `link_url` depending on type, `device_timestamp` **and**
`server_timestamp` (both, so client clock skew is visible), GPS latitude/longitude/accuracy
for `gps_checkin`, and `approval_status IN ('pending_review','approved','rejected')` with
reviewer, timestamp and comment.

RPCs: `SubmitEvidence`, `ApproveEvidence`, `RejectEvidence`, `ListEvidenceSubmissions`,
`RequestEvidenceFileUpload`, `ConfirmEvidenceFileUpload`. Submitting needs
`collab.submitEvidence`; approving needs `collab.reviewEvidence`.

## Compliance and health

- `GetOperationalHealth` — project-level summary plus a per-definition breakdown.
- `GetRitualComplianceSummary` — per-employee compliance over a date range.
- `ExportRitualComplianceCSV` — the same data as CSV.
- `GetAssignedWorkSummary` — "what's on my plate": due-today and overdue counts plus up to
  20 items bucketed by urgency. Backs the context rail; see
  [workspace-navigation.md](workspace-navigation.md#context-rail).

## Calendar overlay

`GetTasksDueInRange` and `GetRitualInstancesInRange` are read-only providers the calendar
service calls to render tasks and rituals as overlay items on the calendar grid. The
dependency points calendar → collaboration, never the reverse.

## Notifications produced

Task: `task_assigned`, `task_status_changed`, `task_commented`, `task_mentioned`,
`task_description_modified`, `task_updated`. Ritual/evidence: `evidence_submitted`,
`evidence_approved`, `evidence_rejected`, `ritual_instances_scheduled`. Source domain
`projects`.

`ritual_instances_scheduled` is a **post-loop summary**: one notification per assignee at
the end of a generation run, listing every instance created for them. It replaced a
per-instance flood — generating 30 days of a daily ritual used to mean 30 notifications.

## Client surfaces

- Web: `/workspace/projects`, `/workspace/projects/[id]`, `/workspace/tasks`,
  `/workspace/tasks/[id]`.
- Mobile: `app/(app)/(tasks)/` — project list, `[projectId]/index`,
  `[projectId]/[taskId]`, `[projectId]/create`, `[projectId]/settings`,
  `rituals/[definitionId]`; plus `app/(shared)/resource/tasks/` for deep links. Evidence
  capture uses `src/lib/evidence-media.ts`.
- Clients: `packages/apis/src/collaboration.ts`, `collaboration-ritual.ts`.

## Tests

`collaboration_project_test.go`, `collaboration_task_test.go`,
`collaboration_ritual_test.go`, `collaboration_ritual_instance_test.go`,
`collaboration_schedule_generation_test.go`, `collaboration_evidence_test.go`,
`collaboration_health_test.go`, `collaboration_analytics_test.go`,
`collaboration_customfield_test.go`, `collaboration_membership_test.go`,
`collaboration_ritual_notification_test.go`, `collaboration_ritual_ux_redesign_test.go`,
`ritual_submission_flow_test.go`, `ritual_tasks_improvement_test.go`,
`workflow_task_lifecycle_test.go`, `workflow_project_team_test.go`, plus the unit tests
`evidence_logic_test.go` and `ritual_schedule_change_test.go`.

## Known drift

**D3 — nothing ever marks a ritual overdue or missed.**

- `notifyRitualInstanceOverdue` (`ritual_notification_logic.go:216`) has **no callers**.
- `notifyRitualInstanceAssigned` (`ritual_notification_logic.go:23`) also has no callers —
  correct, since `ritual_instances_scheduled` replaced it, but the function was left behind.
- `NotificationTypeRitualInstanceMissed` is declared and never published. There is no
  `missed` transition anywhere in the code, though `missed` is a valid `state_category`,
  a valid notification type in the DB CHECK, and a `StateCategory` enum value.
- `overdue` is only *derived*, and only when an evidence write triggers
  `reconcileRitualTaskState`. An instance whose deadline passes with **no** evidence
  activity is never reconciled: it stays in `todo`, nobody is notified, and it shows as
  overdue only where a query computes urgency at read time
  (`GetAssignedWorkSummary`, health reports).

If overdue/missed are meant to be real states with notifications, they need a sweep of
their own. The 034 sweep only generates; it does not reconcile. Fixing this is the natural
companion change to 034 and would reuse the same one-job-for-the-platform shape.

**D2 (from the notification side) lands here too.** The ritual notification type constants
are duplicated in `internal/collaboration/constants.go:319-330` rather than living in the
notification package, which is how they came to be missing from
`IsValidNotificationType`. See
[notifications-presence.md](notifications-presence.md#known-drift).

**Spec reading order.** Rituals accumulated across five specs; if you must read them, the
useful order is 022 (model) → 023 (lazy resources + schedule change) → 028 (submission
flow) → 029 (UX) → 034 (scheduler). Everything in 022 about per-definition scheduling is
obsolete.
