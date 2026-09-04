# Tasks & Rituals

Projects, tasks, workflow automation, and the recurring-operational-task ("ritual") system
with evidence capture and compliance reporting. Owned by `internal/collaboration`;
contract in `rpc/v1/collaboration.proto` (`CollaborationService`, 73 RPCs — the largest
surface in the system).

**Status date: 2026-09-04.** Supersedes specs 017, 022, 023, 028, 029, 034, 038, 040, 041, 042 (034 and
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
from the message list, never per message. A conversion does not change the set of message
ids on the page, so the client that performed it re-runs the lookup on success — otherwise
the chip on the message just converted would not appear until the page changed.

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
| `procedure_document_id` | nullable FK to a workspace document — the ritual's written procedure (feature 043) |

### The procedure document (feature 043)

A definition may point at **one** workspace document as its written procedure. The foreign
key is composite and organization-leading — `(organization_id, procedure_document_id)`
references `docs.document(organization_id, id)` — with `ON DELETE RESTRICT`, and it carries
no index and no unique key: one document may be the procedure of any number of definitions
across any number of projects, and a definition never carries two.

Nothing is snapshotted. The title, status and content are resolved on every read, so
correcting the document corrects every open instance at once and there is no version of the
procedure to reconcile.

**Writing it.** `CreateRitualDefinition` and `UpdateRitualDefinition` both take
`procedure_document_id`. On update the field is three-valued and the three values differ:
omitted leaves the column alone, an empty string detaches, an id attaches or replaces.

The candidate must be a `workspace_doc` **and** must pass `DocsLogic.CheckAccess` for the
caller: a manager may only attach a document they could already open themselves, because
attaching hands sight of it to everyone who can see the ritual. A `task_description` or
`project_brief`, a document in another organization, one the caller has no grant on, a
soft-deleted one and a nonexistent one are all refused the same way — an `InvalidArgument`
with a `google.rpc.BadRequest` field violation on `procedure_document_id`. Those cases are
deliberately indistinguishable, so the refusal never reports whether a document the caller
cannot see exists. Any `status` is accepted, `archived` included.

Note the asymmetry, which is the heart of the design: the **write** path checks the caller's
own `docs.document_access`, the **read** path deliberately does not. `DocsLogic` exposes both
`GetDocument` (no access check, used for reading) and `CheckAccess` (used for writing), and
mixing them up in either direction breaks the feature — one way a worker cannot read the
procedure, the other way a manager can hand out a document they were never allowed to see.

Attaching, replacing or detaching creates, deletes and detaches **no instances**, bumps no
`schedule_version`, notifies nobody, and never modifies the document itself. Detaching
leaves the document in the workspace untouched.

**Reading it.** `RitualDefinition.procedure` carries the resolved
`{document_id, title, slug, status, is_available}`, and `GetRitualProcedure` returns the
same plus the document's current `content_json`. Anyone who can see the definition's project
may call it — `CheckProjectAccess` with no required role, the same bar as seeing the
instance — and anyone outside the project gets a bare `PermissionDenied` with no detail.

That read is **implicit**: it does not consult `docs.document_access` and grants nothing
else. The reader does not get the document in their tree, their search results, their
followed documents, its comments, reactions, versions or child pages, and cannot edit it.
The grant ends the moment the attachment is removed or the definition is deleted. See
[docs-knowledge.md](docs-knowledge.md#implicit-reads-through-a-ritual-procedure).

**Absent and unavailable are different states.** A null column resolves to no `procedure` at
all and every client renders nothing — no entry point, no placeholder, no layout shift. A
set column whose document no longer resolves returns `{document_id, is_available: false}`
with an empty title and unspecified status, and clients render an explicit unavailable
state. Collapsing the two would tell a worker there was never a procedure for a ritual that
has one. A docs failure degrades that one entry point and is never returned as an error:
`GetRitualDefinition` still succeeds, and evidence can still be submitted, approved,
rejected and the instance still reaches `verified`.

**Authorization.** `UpdateRitualDefinition` now performs a project owner/admin resource
check via `GetProjectMemberRole`, matching what `CreateRitualDefinition` already enforced.
A plain project `member` editing a definition previously succeeded; it is now refused with a
bare `PermissionDenied`. This is a behaviour change beyond the procedure field — it applies
to every field on the RPC.

### Assignment

Two mechanisms:

- `ritual_definition_assignee` — named individuals, resolved at generation time.
- `ritual_definition_department_pool` — a department plus a strategy:
  - `round_robin`, using `last_assigned_employee_id` as a waterline into the sorted member
    list. There is deliberately **no FK** on that column: the employee may have left the
    department mid-cycle and the waterline must survive that.
  - `least_assigned`.
  - `on_shift` (feature 042) — the assignee is whoever has a shift on the calendar covering
    the instance's scheduled date. Unlike the other two this is **late-bound**: see below.

#### On-shift assignment (feature 042)

Instances are materialised 30 days ahead while rotas are published a week or two ahead, so
at generation time most on-shift slots have nobody rostered yet. The strategy is therefore
resolved by a background sweep rather than once at generation:

`collaboration.ritual_instance_pool_assignment` holds one row per (ritual instance,
department pool) governed by `on_shift`:

| Column | Meaning |
|---|---|
| `resolution_state` | `awaiting_shift` \| `resolved` \| `closed_unresolved` |
| `closed_reason` | `no_roster` \| `manual_override`; required iff closed |
| `assigned_employee_id` | who *this feature* put in the slot. No FK, for the same reason `last_assigned_employee_id` has none, and it is what proves the slot was not changed by a person |
| `resolve_by` | the instant the scheduled date begins in the definition's own timezone. Resolution is attempted only while `now < resolve_by`; escalation fires once `now >= resolve_by` |
| `resolved_at`, `escalated_at` | when the current assignment was made, and when an owner was alerted |

State machine: `awaiting_shift → resolved` when somebody rostered appears;
`resolved → awaiting_shift` when the holder's cover disappears and nobody else covers;
`awaiting_shift → closed_unresolved (no_roster)` when the scheduled date arrives with nobody
rostered; `resolved → closed_unresolved (manual_override)` when a person changed the
assignee. `closed_unresolved` is terminal, which is what makes the owner alert fire exactly
once and what stops the next pass undoing a manager's decision.

**There is no fallback.** A pool set to `on_shift` never falls through to round-robin or
least-assigned, and never advances `last_assigned_employee_id`. Falling back is the defect
the strategy exists to remove: it is what put the closing checklist on somebody who was not
in. A calendar the sweep cannot read, a nil shift-coverage reader and "nobody is rostered"
all produce the same outcome — the slot waits.

**Choosing among several rostered people**: fewest ritual assignments in the trailing 90
days, ties broken by lowest employee UUID
(`GetLeastAssignedEmployeeAmongCandidates`). This runs only when filling an *empty* slot. A
slot whose holder is still rostered keeps them — re-picking on every pass would move the
checklist to whoever is currently least loaded every two minutes.

**Reading the rota** goes through `collaboration.ShiftCoverageReader`, an interface
collaboration declares and `calendar.Logic` implements
(`internal/calendar/shift_coverage_logic.go`), injected by
`collaborationLogic.SetShiftCoverageReader(calendarLogic)` in `cmd/server.go`. Collaboration
never imports calendar. See `docs/domain/calendar.md` for the coverage rules and
`backend/docs/SYSTEM-ARCHITECTURE.md` for why the edge is inverted.

`Task.pool_assignment_state` (proto enum `RitualPoolAssignmentState`) carries the state to
clients so an instance can explain that it is waiting for the rota rather than showing an
unexplained empty assignee. It is filled in with one batched query per page of tasks
(`ListRitualPoolAssignmentStatesForTasks`) on `GetTask`, `ListTasks` and the ritual
worklist, and is `UNSPECIFIED` for every task that is not an on-shift ritual instance. An
instance carrying several pools reports the **least-progressed** state, so a waiting pool is
not hidden behind one that resolved.

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
evidence snapshot, the completion deadline and a grace window, in this precedence order:

1. all required evidence approved → `verified`
2. all required submitted, none rejected → `submitted`
3. `now > completion_deadline + graceWindow` → `missed`
4. `now > completion_deadline` → `overdue`
5. any submission → `in_progress`
6. `scheduled_date` in the future → `scheduled`
7. otherwise → `todo`

`graceWindow` is the definition's `completion_window_hours`. Rows 3 and 4 sit **above**
`in_progress` deliberately: partial progress must not hide lateness. A zero grace window —
which is what an unloadable definition yields — makes row 3 unreachable while leaving row 4
live, so a missing definition can flag an instance late but never silently write it into a
terminal state. A `NULL` `completion_deadline` makes both unreachable: no deadline means
never late.

`SkipRitualInstance` records a `skip_reason` and moves the instance to `skipped`.

**Terminal categories.** `verified`, `missed` and `skipped` are terminal: no automatic
transition leaves them, which is also what stops a missed instance being re-notified.

**One writer, two callers.** `reconcileRitualTaskStateForTask` is the only thing that writes
ritual instance state. It is called from `SubmitEvidence`, `ApproveEvidence` and
`RejectEvidence` on the evidence path, and per instance by the reconciliation sweep below.
Because both paths call the same derivation function and the same writer, an instance's
state never depends on which path last touched it. The overdue/missed notification is
published *inside* that writer, on the transition it performs, for the same reason.

The write is a compare-and-set (`UpdateRitualTaskStateIfUnchanged`) against the state the
decision was made from. Two overlapping passes can both read a row before either writes; the
predicate makes the loser match zero rows, so it neither rewrites the state nor publishes a
duplicate notification.

If the project holds no state row in the target category — a project whose ritual states were
never seeded or were deleted — the instance is left where it is and the condition is logged at
WARN with the project ID and the category.

### Reconciliation — the second global sweep (feature 040)

`ritual_reconciliation_sweep` (`internal/collaboration/ritual_reconciliation_workflow.go`) is
scheduled every **5 minutes** by `flows.ScheduleTx` at server start, alongside the generation
sweep, with `RetryPolicy{MaxRetries: 2}`. A retried pass is safe because the pass is
idempotent.

Each pass:

1. `ListOrganizationIDsWithReconcilableRitualInstances` (via `AdminPool` — cross-org),
   unfiltered by `organization_id` because its purpose is to *discover* which organizations to
   sweep. It returns organization IDs and nothing else. It deliberately does **not** join
   `ritual_definition`: an instance outlives its definition's archival and must still be
   reconciled.
2. For each org, `Logic.ReconcileOverdueRitualInstances(ctx, adminPool, orgID, now)` lists at
   most **500** candidate instances ordered by `completion_deadline ASC, id ASC` and calls the
   shared writer per instance. Oldest-first ordering makes a partially drained backlog
   progress strictly; a large backlog produces more passes rather than one failed pass.
3. An error on one organization is logged with its ID and the loop continues; an error on one
   instance is logged with its task ID and the organization's remaining instances are still
   reconciled.
4. Report `{OrganizationsProcessed, InstancesExamined, MarkedOverdue, MarkedMissed}` as one
   structured log line, `ritual reconciliation sweep complete`.

The candidate predicate is `task_kind = 'ritual_instance'`, not deleted, not
`detached_from_ritual`, `completion_deadline IS NOT NULL AND < now`, and state category in
(`scheduled`, `todo`, `in_progress`, `overdue`). `submitted` is absent because fully submitted
evidence awaiting review is the reviewer's delay, not the worker's; `overdue` is present
because that is how an instance reaches `missed`.

The pass holds no state between runs — its cursor is the state column of the instances
themselves. No advisory lock, no `processed_at` marker, no dedup table. `Sweep(ctx, now)` is
exported so integration tests can drive a cycle with an injected clock instead of sleeping.

**Backfill horizon.** When `now - completion_deadline` exceeds **7 days** the state transition
still happens and **no notification is published**, so a first deployment does not alert every
worker about every historical instance at once. The check is against the stored deadline, never
against elapsed time since the state change, so a repeated pass cannot change the answer. The
suppression is logged.

### Shift resolution — the third global sweep (feature 042)

`ritual_shift_resolution_sweep` (`internal/collaboration/ritual_shift_resolution_workflow.go`)
is scheduled every **2 minutes** by `flows.ScheduleTx`, with `RetryPolicy{MaxRetries: 2}`.
The cadence sits between the 1-minute generation sweep and the 5-minute reconciliation sweep,
so a cadence alone identifies the sweep in a log. It is registered **after**
`SetShiftCoverageReader` in `cmd/server.go`, so a first pass can never run against a nil
reader in a live server.

Each pass:

1. `ListOrganizationIDsWithResolvableRitualPoolAssignments` (via `AdminPool` — cross-org,
   carries the `-- lint:cross-tenant` marker). It selects organizations holding a row in
   `awaiting_shift` or `resolved` and nothing else.
2. For each org, `Logic.ResolveRitualShiftAssignments(ctx, adminPool, orgID, now)` reads at
   most **500** slots ordered by `scheduled_date ASC, task_id ASC, pool_id ASC` and, per
   slot: skips it when its date has arrived or it already carries evidence (the freeze
   rules); adopts an instance whose pool has just switched *to* `on_shift`; binds an
   `awaiting_shift` slot whose date is now covered; re-checks a `resolved` slot and swaps,
   withdraws or freezes it; and hands a slot over under the pool's current strategy and
   deletes the row when the pool has switched *away* from `on_shift`.
3. The same call then closes every `awaiting_shift` slot whose `resolve_by` has passed
   (`ListRitualPoolAssignmentsDueEscalation`) and alerts the project's owners and admins.
4. An error on one organization is logged with its ID and the loop continues; an error on
   one slot is logged with its task ID and the organization's remaining slots are still
   processed.
5. Report `{OrganizationsProcessed, SlotsExamined, SlotsAssigned, SlotsReassigned,
   SlotsWithdrawn, SlotsEscalated}` as one structured log line,
   `ritual shift resolution sweep complete`.

Every state write is a **compare-and-set** on `resolution_state`
(`UPDATE ... WHERE resolution_state = @expected_state`), and every notification is published
only when its compare-and-set reported a changed row. Two overlapping passes therefore
assign once and notify once. The pass holds no state between runs; its cursor is the
`resolution_state` column itself. `Sweep(ctx, now)` is exported for the same reason the other
two sweeps export theirs.

**Backfill horizon.** When `now - resolve_by` exceeds **7 days** — the same horizon
reconciliation uses — the slot still closes as `no_roster` but the owner alert is suppressed
and `escalated_at` is left NULL, because `escalated_at` records when an owner was told.

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
`RequestEvidenceFileUpload`, `ConfirmEvidenceFileUpload`, `ListEvidenceReviewQueue`,
`GetEvidenceReviewQueueCount`. Submitting needs `collab.submitEvidence`; approving needs
`collab.reviewEvidence`.

### Deciding a submission

`ApproveEvidence` and `RejectEvidence` are the only decision path. Both check three things
before writing, in this order:

1. **Permission** — `collab.reviewEvidence`, declared on the RPC.
2. **Project scope** — `CheckProjectAccess` against the submission's project, requiring
   non-`viewer` membership. An org-wide permission holder who is not a member of the
   submission's project, or is only a `viewer` on it, is refused with a bare
   `PermissionDenied` and **no** error detail: naming the project or the task would
   disclose the existence of work the caller cannot see. Project `visibility = 'public'`
   grants reading, never deciding — it is equivalent to `viewer` here.
3. **Not already decided** — the submission is read first, and the `UPDATE` itself carries
   `AND approval_status = 'pending_review'`. Two reviewers deciding the same submission
   converge on exactly one winner; the loser gets `FailedPrecondition` with a
   `google.rpc.PreconditionFailure` detail of type `EVIDENCE_ALREADY_DECIDED` naming who
   decided and when, rather than silently overwriting the first decision.

A rejection requires a reason. An empty or whitespace-only `comment` is refused with
`InvalidArgument` and a `google.rpc.BadRequest` field violation on `comment`; the reason is
appended to the rejection notification body so it reaches the submitter, who is included in
the recipient set alongside the task's assignee, reviewer and approver.

Every decision routes through `reconcileRitualTaskState`, so a decision made from the queue
and one made from the task detail view produce the same instance state and the same
notification.

### Review queue

`ListEvidenceReviewQueue` is a **read-only projection** — no queue table, no claim, no
per-reviewer marker. It returns every `pending_review` submission the caller may decide,
across all their projects, joined to the context needed to decide it without a second
request: ritual name, task identifier and title, project, submitter's display name, the
requirement's position and required flag, the evidence content itself, the ritual
instance's state category and completion deadline, and `procedure_document_id`.

`procedure_document_id` is sourced from the `ritual_definition` join the projection already
performs for `ritual_name`, so it costs no additional query per page. It is the id only,
never a resolved procedure: a reviewer who opens the procedure fetches its title and content
with `GetRitualProcedure` at that moment, so listing a page of 25 entries reads no
documents. It is empty for an entry whose definition could not be resolved, and such an
entry stays listed and stays decidable.

Ordering is `(urgency_rank, server_timestamp, id)`: `urgency_rank` is `0` when the
instance's `project_state.category` is `overdue` or `missed` and `1` otherwise, so late work
sorts first, then oldest-first within each bucket, with the UUID v7 primary key as the total
tiebreak. The cursor is an opaque base64 encoding of that whole tuple, which is what keeps
the page boundary total across the bucket transition. Page size defaults to 25 and is
clamped to 100.

Scope comes from an inner join on `project_membership` where `role <> 'viewer'` — the same
rule `CheckProjectAccess` applies to the decision, so nothing is listed that would be
refused and nothing is accepted that is hidden. A caller without `collab.reviewEvidence`
gets an empty page and a zero count, not an authorization failure; having nothing to review
is not an error, and the clients hide the entry point on the same signal.

Entries survive degraded data rather than disappearing: a submission whose requirement or
definition no longer resolves is still listed with `requirement_unresolved` set, and a
submission whose file cannot be retrieved is still listed and still decidable. Dropping
either would let a broken upload silently clear the queue.

`GetEvidenceReviewQueueCount` backs the badge. It runs the identical predicate inside a
bounded subquery (`LIMIT 100`), so an unbounded backlog costs the same as a small one, and
returns `is_capped` for the client to render "99+". It also returns `can_review`, which is
what lets a client tell "not a reviewer" from "a reviewer who is up to date" — a count of
zero alone cannot.

Both RPCs declare `option (rpc.v1.access_control) = {}` deliberately: the permission is read
from the caller's effective permissions in the handler and turned into an empty result
rather than a refusal.

Clients: the web **Reviews** tab at `/workspace/reviews` (with `?projectId=` narrowing from
a project page), and a full-screen queue in the mobile tasks area reached from an entry-point
card on the tasks tab. See
[workspace-navigation.md](workspace-navigation.md#review-queue-entry-points).

## Compliance and health

- `GetOperationalHealth` — project-level summary plus a per-definition breakdown.
- `GetRitualComplianceSummary` — per-employee compliance over a date range. The query
  joins `organization.employee` for the name: every reader of this data is a person
  deciding who needs following up, and the Health tab used to print a UUID fragment.
- `ExportRitualComplianceCSV` — the same data as CSV, name column first.
- `GetAssignedWorkSummary` — "what's on my plate": due-today and overdue counts plus up to
  20 items bucketed by urgency. Backs the context rail; see
  [workspace-navigation.md](workspace-navigation.md#context-rail). The urgency bucket is
  `ps.category = 'overdue' OR t.due_date < as_of_date`: the `OR` keeps standard tasks
  bucketing on the date while making ritual instances agree with their stored state. A
  `missed` instance drops out of the summary with no query change, because the seeded
  `Missed` state is `is_closed = true` and both queries already filter `is_closed = FALSE`.

## Calendar overlay

`GetTasksDueInRange` and `GetRitualInstancesInRange` are read-only providers the calendar
service calls to render tasks and rituals as overlay items on the calendar grid. The
dependency points calendar → collaboration, never the reverse.

## Notifications produced

Task: `task_assigned`, `task_status_changed`, `task_commented`, `task_mentioned`,
`task_description_modified`, `task_updated`. Ritual/evidence: `evidence_submitted`,
`evidence_approved`, `evidence_rejected`, `ritual_instances_scheduled`,
`ritual_instance_overdue`, `ritual_instance_missed`, `ritual_instance_unassigned`. Source
domain `projects`.

`ritual_instances_scheduled` is a **post-loop summary**: one notification per assignee at
the end of a generation run, listing every instance created for them. It replaced a
per-instance flood — generating 30 days of a daily ritual used to mean 30 notifications.

`evidence_approved` and `evidence_rejected` go to the task's watchers **plus the submitter,
named explicitly** — they are the person waiting on the answer, and whether they happen to
hold a subscription on the task is beside the point. Actor exclusion still applies, so a
reviewer deciding their own submission notifies nobody while the decision is still recorded
against them. Both bodies carry the real task title, and the reviewer's comment is appended
to it: a rejection reason that stops at the database tells the submitter nothing about what
to fix, which is the whole reason one is required.

`ritual_instance_overdue` and `ritual_instance_missed` are published by the reconciliation
sweep, from inside the shared state writer, only on a transition it performed:

| | Recipients | Focus intent |
|---|---|---|
| `ritual_instance_overdue` | task `assignee`, `reviewer`, `approver`, deduplicated by employee ID | `submit_requirement` — the work is still recoverable |
| `ritual_instance_missed` | the same, **plus** the project's `owner` and `admin` members when the task has no reviewer and no approver | `view_instance` — the state is terminal |

Project owners are deliberately *not* added on the overdue path: escalating every late
checklist to them is how an alert becomes noise, and noise is how the alert gets muted. An
instance with no assignee, reviewer or approver produces no overdue notification at all —
there is nobody to tell — but its `missed` transition still escalates, which is what closes
the "unassigned ritual fails silently" hole.

`ritual_instance_unassigned` is published by the **shift resolution** sweep when an
on-shift slot's scheduled date arrives with nobody in the department rostered. It goes to
the project's `owner` and `admin` members with focus intent `view_instance`, and is
published only when the compare-and-set that closed the slot reported a changed row — so
two overlapping passes alert once. It is deliberately a distinct type from
`ritual_instance_missed`: missed means somebody was asked to do the work and did not, and
this means nobody was ever asked. Collapsing the two would tell an owner to chase a person
who does not exist.

The same sweep sends the ordinary `task_assigned` to a newly bound assignee and
`task_updated` to a previous assignee whose instance a rota change moved off them. Neither
is a new type: from the recipient's seat nothing distinguishes "a manager assigned this to
you" from "the rota did".

All of these carry `priority = 2` (ordinary), `policy_key = task_status`,
`delivery_class = persistent`, `source_category = activity`, an `action_data` payload of
`taskId` / `projectId` / `deepLink` / `focusIntent`, and a `projects`/`task` navigation
target. Because nothing about them is special-cased, do-not-disturb, domain mute and
presence apply through the ordinary pipeline. They deliberately do **not** use the
always-deliver priority reserved for mentions and incoming calls.

## Client surfaces

- Web: `/workspace/projects`, `/workspace/projects/[id]`, `/workspace/tasks`,
  `/workspace/tasks/[id]`. Turning a message into a task is reached from the chat message
  action menu — `workspace/chat/components/CreateTaskFromMessageDialog.tsx`.
- Mobile: `app/(app)/(tasks)/` — project list, `[projectId]/index`,
  `[projectId]/[taskId]`, `[projectId]/create`, `[projectId]/settings`,
  `rituals/[definitionId]`, `review/index` (the evidence review queue, reached from an
  entry-point card on the tasks tab); plus `app/(shared)/resource/tasks/` for deep links.
  Evidence
  capture uses `src/lib/evidence-media.ts`. Turning a message into a task is a
  purpose-built bottom sheet reached from the chat long-press action sheet —
  `src/components/chat/create-task-sheet.tsx`. The sheet does not take focus on open: the
  title arrives pre-filled from the message, and raising the keyboard left a small phone
  with no room for the project list or the confirm button. It lifts clear of the keyboard
  when the title is edited.
- Clients: `packages/apis/src/collaboration.ts`, `collaboration-ritual.ts`.

The on-shift strategy is selectable **web-only**, in the ritual definition editor
(`workspace/projects/[id]/rituals/[definitionId]/page.tsx`, re-exported at
`workspace/tasks/[id]/rituals/[definitionId]/page.tsx`), alongside round-robin and
least-assigned, with helper text stating that it depends on shift events published for that
department. Mobile has no ritual pool configuration at all, so nothing was removed from it.

The "waiting for the rota" explanation is read-only and appears on every surface that shows
an instance, keyed on `Task.pool_assignment_state === 'awaiting_shift'`:
`TaskDetailSidePanel.tsx` (standard and mixed projects),
`workspace/projects/[id]/tasks/[taskId]/page.tsx` (ritual-mode projects, which never render
the side panel), and the mobile ritual instance screen
`app/(app)/(tasks)/[projectId]/task/[taskId].tsx` — which the shared deep-link route
re-exports, so a notification tap lands on the same banner. It is deliberately **not** shown
for an instance that simply has no assignee configured: claiming a rota is missing when no
pool exists would be false.

The procedure entry point (feature 043) appears on every surface that shows a ritual
instance, and only when `RitualDefinition.procedure` is present: the web instance page
`workspace/projects/[id]/tasks/[taskId]/page.tsx`, `TaskDetailSidePanel.tsx`, the evidence
capture form `EvidenceSubmitForm.tsx`, the web review queue row
`workspace/reviews/components/ReviewQueueRow.tsx`, the mobile instance screen
`app/(app)/(tasks)/[projectId]/task/[taskId].tsx` (which the shared deep-link route
re-exports), and the mobile review card `src/components/review/review-queue-card.tsx`. It is
labelled with the document's *current* title.

It opens an **overlay**, never a route: `workspace/components/ProcedureDialog.tsx` on web
and `src/components/rituals/procedure-sheet.tsx` on mobile. That is load-bearing rather than
cosmetic — the surfaces underneath hold an attached file, a typed note, a typed rejection
reason and a position in the queue, and because they are never unmounted none of it can be
lost. Converting an entry point to a route reintroduces exactly that loss.

Attaching, replacing and removing is **web-only**, in the ritual definition editor, behind a
client-side confirmation stating that everyone who can see an instance of this ritual will
be able to read the chosen document. No acknowledgement of the warning is persisted. The
chooser is backed by `searchDocuments`, which is organization-scoped rather than
access-scoped (drift D49), so it may offer a document the manager cannot open — the server
refuses that attachment, which is where the rule is actually enforced. Mobile reads the
procedure and never configures it.

## Tests

`collaboration_project_test.go`, `collaboration_task_test.go`,
`collaboration_ritual_test.go`, `collaboration_ritual_instance_test.go`,
`collaboration_schedule_generation_test.go`, `collaboration_evidence_test.go`,
`collaboration_health_test.go`, `collaboration_analytics_test.go`,
`collaboration_customfield_test.go`, `collaboration_membership_test.go`,
`collaboration_ritual_notification_test.go`, `collaboration_ritual_ux_redesign_test.go`,
`ritual_submission_flow_test.go`, `ritual_tasks_improvement_test.go`,
`workflow_task_lifecycle_test.go`, `workflow_project_team_test.go`,
`chat_task_capture_test.go`, `collaboration_ritual_procedure_test.go`, plus the unit tests
`evidence_logic_test.go`,
`ritual_schedule_change_test.go` and `task_from_message_logic_test.go`.

## Known drift

**Tasks from chat messages are only partly built.** Creating one works end to end, and the
origin columns are written; the two RPCs that read them back (`ListTasksBySourceMessages`,
`GetTaskOrigin`) and the per-channel destination memory are declared in the proto and the
schema with nothing behind them. See D31 and D32 in the drift register.

**Spec reading order.** Rituals accumulated across five specs; if you must read them, the
useful order is 022 (model) → 023 (lazy resources + schedule change) → 028 (submission
flow) → 029 (UX) → 034 (scheduler). Everything in 022 about per-definition scheduling is
obsolete.
