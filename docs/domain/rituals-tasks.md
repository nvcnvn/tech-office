# Tasks & Rituals

Projects, tasks, workflow automation, and the recurring-operational-task ("ritual") system
with evidence capture and compliance reporting. Owned by `internal/collaboration`;
contract in `rpc/v1/collaboration.proto` (`CollaborationService`, 73 RPCs — the largest
surface in the system).

**Status date: 2026-09-02.** Supersedes specs 017, 022, 023, 028, 029, 034, 038 (034 and
038 are in development on this branch; their backend changes are described here as shipped
because the code and migrations are both present).

## Projects

`collaboration.project` — `name`, `key` (`^[A-Z][A-Z0-9_]{0,9}$`, unique per org, used as
the task identifier prefix), `visibility` (`public | private`), `next_task_number`,
denormalised `member_count` / `task_count`.

Both counters are maintained by the writes that change them, and `CreateProject` returns
the row *after* adding the creator as owner — the web project list renders the new card
straight from that response, so a pre-increment copy showed a project with an owner as
`0 members`.

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
- **Origin** — `source_channel_id` and `source_message_id`, set together or not at all
  (a CHECK enforces it), recording the chat message a task was created from
- **Ritual fields** — `task_kind IN ('standard','ritual_instance')`,
  `ritual_definition_id`, `scheduled_date`, `completion_deadline`, `skip_reason`,
  `detached_from_ritual`

Task descriptions are real documents and task comments are real chat channels. The
description document is created with `document_type = 'task_description'` and is filtered
out of the workspace docs list. Neither is created when the task is — see
[Lazy resource creation](#lazy-resource-creation) below.

`level_id` is optional on `CreateTaskRequest`. When it is absent the project's shallowest
level is used, which is where an ordinary top-level task belongs. This resolution runs
before anything parses the field, because the parse panics on an empty string.

Search indexes on `title`: PGroonga (multilingual full text) **and** trigram (fuzzy).

`collaboration.task_assignee` supports roles `assignee | reviewer | approver`.

RPC groups: tasks (`CreateTask`…`GetTaskByIdentifier`), tasks from chat messages
(`CreateTaskFromMessage`, `ListTasksBySourceMessages`, `GetTaskOrigin`,
`GetChannelTaskDestination`, `SetChannelTaskDestination`), assignment (`AssignTask`,
`UnassignTask`, `WatchTask`, `UnwatchTask`), custom fields, workflow rules, membership,
saved views, analytics (`GetTaskAnalytics`, `ExportTasksCSV`), file upload
(`RequestTaskFileUpload`, `ConfirmTaskFileUpload`).

### Tasks created from chat messages

A message in any chat channel can be turned into an ordinary standard task.
`CreateTaskFromMessage` takes four inputs — project, title, optional assignee, optional due
date — and nothing else. There is no level, state, ritual or custom-field parameter, so
this path is **structurally incapable** of producing a ritual; the constraint is enforced by
the message shape rather than by validation.

It does not reimplement task creation. It validates what is specific to this path and then
delegates to `CreateTask`, so workflow rules, notifications, search indexing and analytics
all apply exactly as they do for a task created through the full form.

What it refuses, before writing anything:

| Condition | Code |
|---|---|
| Title empty after trimming | `InvalidArgument` + a `BadRequest` naming the `title` field |
| Destination archived, or not writable by the caller | `FailedPrecondition` + a `PreconditionFailure` naming the project |
| Caller is a `viewer`, or not a member of a private destination project | `PermissionDenied` |
| Source message soft-deleted, `system` kind, or in a channel the caller cannot read | `FailedPrecondition` |
| Destination project in another organization | `NotFound` |

Reading the source message goes through `ChatLogic.GetMessage`, which is also the channel
access check: a caller who cannot read the channel cannot read the message, so a private
channel they do not belong to is refused there rather than by a separate lookup.

The whole conversion is **one transaction**: the task row, its origin columns and the
threaded announcement on the source message commit together or not at all. A task existing
with no trace in the conversation it came from would be worse than a refusal the user can
retry.

The announcement itself is written by `ChatLogic.AnnounceTaskCreatedFromMessage` and
notifies nobody — see [chat.md](chat.md#the-task-conversion-announcement). An assignee named
at creation still receives the ordinary task-assignment notification, because that comes
from `CreateTask` unchanged.

Direction of dependency: collaboration owns this feature end to end and calls chat through
the `ChatLogic` interface. `internal/chat` gains one logic-layer method and no knowledge of
tasks; no RPC here is served by `ChatService`.

#### The link back, in both directions

A converted message carries a chip naming the task it became, and the task carries a block
naming the conversation it came from.

`ListTasksBySourceMessages` takes a list of message ids — at most 200, one call per
rendered page of messages — and returns a `MessageTaskLink` for each converted one: task
id, identifier, title, project, and the task's **live** state name and category, so a chip
shows where the work actually stands rather than where it started. The repeated request
field is the contract-level guarantee against an N+1; both clients call it once per page
from the message list, never per message.

Access filtering happens in SQL. A link to a task in a project the caller cannot see is
**omitted from the response entirely**, never returned with a flag — a flagged entry would
still leak the identifier and title of work the reader may not know exists. A message with
no links is therefore indistinguishable from one that was never converted. A deleted task
produces no link either.

`GetTaskOrigin` resolves the human-readable side: channel display name, message author, and
the message excerpt as chat stored it. It is a separate call from `GetTask` so the ordinary
task read stays a single-domain query; clients make it only when the task carries a
`source_message_id`. Both chat reads run as the caller, so someone who can see the task but
not the private channel it came from gets the identifiers and nothing else.

A **soft-deleted source message does not remove the origin.** The row and its foreign keys
survive, so the task still names the conversation; only `source_message_available` goes
false and the excerpt is withheld — showing chat's deletion placeholder as an excerpt would
misrepresent it as what was said.

#### The channel's remembered destination

`collaboration.channel_task_destination` (`organization_id`, `channel_id`, `project_id`,
`set_by_employee_id`, `updated_at`, PK `(organization_id, channel_id)`) remembers which
project a channel's tasks go to, so the second conversion in a channel costs a title and a
confirmation rather than a project hunt.

- **The first conversion in a channel writes it**, with `INSERT … ON CONFLICT DO NOTHING`.
  That single statement is what makes a later conversion which overrides the project for
  itself leave the channel's default untouched — an exception must not silently redirect
  everything that follows.
- **`GetChannelTaskDestination` resolves it against what the caller can use right now.** An
  archived project, a project the caller is a `viewer` on or cannot access, or a project
  that has gone, all come back `is_set = false` with a `ChannelDestinationUnsetReason`
  (`NEVER_SET`, `PROJECT_ARCHIVED`, `PROJECT_DELETED`, `NO_ACCESS`). The reason is a proto
  enum, so the one-line explanation each client shows is a client-side lookup with no
  cross-stack string to keep in sync.
- **The row is never deleted for those reasons.** Unarchiving the project restores the
  setting rather than losing it. `PROJECT_DELETED` is defensive: the project foreign key is
  `ON DELETE CASCADE`, so a hard-deleted project takes the destination row with it and the
  channel reads as `NEVER_SET` — and the product exposes no project deletion at all,
  archiving being the supported operation.
- **`SetChannelTaskDestination` requires the caller to administer the channel**, checked in
  the logic layer above the interceptor's `collab.createTask` permission — the same shape as
  ritual definition management. An absent `project_id` clears it. Per constitution principle
  XIII this administrative surface is **web-only**: mobile reads the destination and can
  override it for a single conversion, but does not configure it.
- Every channel remembers independently, direct messages included.

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

1. `ListOrganizationIDsWithActiveRitualDefinitions` (via `AdminPool` — cross-org). It is
   deliberately unfiltered by `organization_id`: its whole purpose is to *discover* which
   organizations to sweep. It returns organization IDs plus each organization's active
   definition count, so `DefinitionsProcessed` costs no second query per org.
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

### The lifecycle performs no scheduling work

This is the other half of 034 and the part most likely to surprise someone reading the
CRUD handlers in `ritual_connect.go` expecting to find scheduling there:

| Action | What it does about timing |
|---|---|
| Create | Calls `Logic.GenerateRitualInstances` **inside the creation transaction**, so the definition and its first window commit atomically and the instances exist on return. This replaces the old `flows.WithRunNow()` that rode along with the per-definition schedule. |
| Update recurrence | Writes the new rule and stops. The next sweep (≤1 min) reads it. |
| Archive / unarchive | Flips `is_archived` and stops. Nothing is paused or resumed — the discovery query simply stops or starts selecting the definition. |
| Change schedule | Regenerates in the logic layer as it always did. `instances_removed` / `instances_detached` / `instances_created` were never computed from a schedule, so they are unaffected. |

The practical consequence for tests: calling a generation helper right after creating a
definition now returns **0**, because creation already covered the window. Several
pre-existing suites asserted `> 0` there and were corrected in 034.

Deleted with the per-definition machinery: `RitualScheduleID`, `RecurrenceRuleToSchedule`
and its `parseTimeOfDay` / `isoDayToCron` helpers, `RecurrenceRuleFromDefinition`,
`RitualSchedulerWorkflow` and its input/output types, the `RitualScheduler` field threaded
through `CollaborationServiceConnect`, and the unreachable `every_minute` /
`every_two_minutes` recurrence types that existed only to make the deleted cron fire fast
in testing.

### Lazy resource creation

`CreateTask` does **not** create a task's chat channel or description document; both
columns stay NULL. `EnsureTaskResources` creates them on first user interaction with the
task detail view, and is idempotent, so concurrent openers do not produce duplicates.

This applies to **every** task, standard and ritual instance alike. A 30-day ritual window
across many definitions would otherwise create thousands of channels and documents nobody
opens, and the same argument holds for an ordinary task nobody gets round to.

Both resources are created as the task's **reporter**, not as whoever opened it. Because
provisioning is lazy the opener is arbitrary, and making them the channel admin would hand
control of the discussion to a passer-by and let ownership race on who looked first.

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

Auto-approve is one rule for both types that offer it: the submission's GPS coordinates
against the requirement's geofence (`evaluateAutoApprove`). It applies to `photo` as well
as `gps_checkin` because a photo submission carries the phone's location alongside the
image — the mobile client requests it before uploading — so "the proof was taken on site"
is decidable for both.

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
- `GetRitualComplianceSummary` — per-employee compliance over a date range. The query
  joins `organization.employee` for the name: every reader of this data is a person
  deciding who needs following up, and the Health tab used to print a UUID fragment.
- `ExportRitualComplianceCSV` — the same data as CSV, name column first.
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
  `/workspace/tasks/[id]`. Turning a message into a task is reached from the chat message
  action menu — `workspace/chat/components/CreateTaskFromMessageDialog.tsx`.
- Mobile: `app/(app)/(tasks)/` — project list, `[projectId]/index`,
  `[projectId]/[taskId]`, `[projectId]/create`, `[projectId]/settings`,
  `rituals/[definitionId]`; plus `app/(shared)/resource/tasks/` for deep links. Evidence
  capture uses `src/lib/evidence-media.ts`. Turning a message into a task is a
  purpose-built bottom sheet reached from the chat long-press action sheet —
  `src/components/chat/create-task-sheet.tsx`.
- Clients: `packages/apis/src/collaboration.ts`, `collaboration-ritual.ts`.

## Tests

`collaboration_project_test.go`, `collaboration_task_test.go`,
`collaboration_ritual_test.go`, `collaboration_ritual_instance_test.go`,
`collaboration_schedule_generation_test.go`, `collaboration_evidence_test.go`,
`collaboration_health_test.go`, `collaboration_analytics_test.go`,
`collaboration_customfield_test.go`, `collaboration_membership_test.go`,
`collaboration_ritual_notification_test.go`, `collaboration_ritual_ux_redesign_test.go`,
`ritual_submission_flow_test.go`, `ritual_tasks_improvement_test.go`,
`workflow_task_lifecycle_test.go`, `workflow_project_team_test.go`,
`chat_task_capture_test.go`, plus the unit tests `evidence_logic_test.go`,
`ritual_schedule_change_test.go` and `task_from_message_logic_test.go`.

## Known drift

**Nothing ever marks a ritual overdue or missed.** `overdue` is only *derived*, and only
when an evidence write triggers `reconcileRitualTaskState`. An instance whose deadline
passes with **no** evidence activity is never reconciled: it stays in `todo`, nobody is
notified, and it shows as overdue only where a query computes urgency at read time
(`GetAssignedWorkSummary`, health reports). `missed` is a valid `state_category` and a
`StateCategory` enum value, but no transition anywhere writes it.

The notification types that would have announced those transitions —
`ritual_instance_overdue`, `ritual_instance_missed`, and the per-instance
`ritual_instance_assigned` that `ritual_instances_scheduled` replaced — used to sit in the
code and the DB CHECK with no caller. `20260830000001_drift_register_fixes.up.sql` removed
all three so the CHECK describes what the product can actually produce. If overdue and
missed are ever made real states, they need a sweep of their own plus their notification
types put back in both places; the 034 sweep only generates, it does not reconcile.

**Tasks from chat messages are only partly built.** Creating one works end to end, and the
origin columns are written; the two RPCs that read them back (`ListTasksBySourceMessages`,
`GetTaskOrigin`) and the per-channel destination memory are declared in the proto and the
schema with nothing behind them. See D31 and D32 in the drift register.

**Spec reading order.** Rituals accumulated across five specs; if you must read them, the
useful order is 022 (model) → 023 (lazy resources + schedule change) → 028 (submission
flow) → 029 (UX) → 034 (scheduler). Everything in 022 about per-definition scheduling is
obsolete.
