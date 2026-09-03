# Phase 0 Research: Overdue and Missed Rituals

All spec-level unknowns were already resolved as `[ASSUMPTION: …]` entries in
[spec.md](./spec.md). This document resolves the remaining *implementation* choices the plan
depends on, each against the code as it stands on 2026-09-03.

---

## R1 — Where the state rules live, and how the two paths stay in agreement

**Decision**: Extend `determineRitualTaskStateCategory` and
`reconcileRitualTaskStateForTask` in `backend/internal/collaboration/ritual_task_state.go`.
The sweep calls `reconcileRitualTaskStateForTask` once per late instance. No second
derivation function is written.

**Rationale**: FR-007 requires the evidence-driven and sweep-driven paths to decide state
from the same rules. The cheapest way to guarantee that is for there to be only one rule
set with one caller-visible entry point. `reconcileRitualTaskStateForTask` is already the
only writer of ritual instance state, already guards `detached_from_ritual` (edge case:
detached instances are never reconciled), and already short-circuits on
`verified | missed | skipped` (FR-003, FR-004). All three requirements are met by code that
already exists.

**Alternatives considered**:

- *A bulk `UPDATE task SET state_id = … WHERE completion_deadline < now() AND …`.* Fastest by
  far, and rejected: deciding whether an instance is late requires the evidence snapshot
  (`AllRequiredApproved`, required-submitted count, rejected count), so the SQL would have to
  re-implement the evidence rules. That is precisely the divergence FR-007 forbids, and it is
  how the two paths would silently drift the first time an evidence rule changed.
- *A separate `sweepRitualTaskState` function sharing only a helper.* Two entry points, two
  places to forget a guard. Rejected on the same grounds.

**Consequence accepted**: the sweep performs a handful of reads per late instance
(project states, evidence requirements, evidence submissions, ritual definition) rather than
one set-based statement. The candidate query filters to instances that are *actually* past
their deadline and not yet in a terminal state, so a steady-state pass touches very few rows.
This is recorded as a `ponytail:` comment naming the upgrade path (cache the per-project state
list and per-definition requirement list for the duration of one pass).

---

## R2 — The new precedence order

**Decision**:

```
1. all required evidence approved          → verified
2. all required submitted, none rejected   → submitted
3. deadline + completion_window passed     → missed
4. deadline passed                         → overdue
5. any submission at all                   → in_progress
6. scheduled_date in the future            → scheduled
7. otherwise                               → todo
```

**Rationale**: FR-006 requires a passed deadline to outrank partial progress, which means
`overdue` must move above `in_progress` — today `in_progress` wins and an instance with one
of three photos submitted stays "in progress" forever. FR-006 equally requires *fully*
submitted evidence awaiting review to keep outranking `overdue`, because the outstanding
action is the reviewer's, so `submitted` stays above. A rejected submission does not satisfy
`submitted` (the existing `requiredRejectedCount == 0` term), so a rejected instance past its
deadline falls through to `overdue` — the spec's "a rejected submission must not shelter an
instance from the sweep" edge case is handled by the ordering, with no extra condition.

`missed` sits directly above `overdue` so a single evaluation of a long-stale instance lands
on `missed` in one step (Story 2, scenario 4) rather than requiring two passes.

**Alternatives considered**: keeping `in_progress` above `overdue` and letting the sweep
override it. Rejected — it makes the two paths disagree about the same instance, which is
FR-007.

---

## R3 — The grace period source

**Decision**: `missed_at = completion_deadline + ritual_definition.completion_window_hours`.
`reconcileRitualTaskStateForTask` loads the definition to obtain it.

**Rationale**: The spec assumes this and gives the reasoning (an urgent ritual with a short
window escalates fast; a monthly one does not). It costs no column, no request field and no
form control on two clients. The load is one indexed read on a table the reconcile path
already knows the primary key of (`task.ritual_definition_id`).

**Alternatives considered**:

- *Derive the window arithmetically from `completion_deadline − scheduled_date`.* Free, and
  rejected: `scheduled_date` is a `date` and the deadline was computed in the definition's
  IANA timezone, so the subtraction is wrong by the UTC offset for every non-UTC ritual.
- *A new `missed_after_hours` column.* A knob nobody asked for. It is the documented upgrade
  path if a customer ever needs the two decoupled.

**[ASSUMPTION: when the definition row cannot be loaded — it was hard-deleted out from under
a live instance — the instance is treated as having no grace period beyond its deadline and
can reach `overdue` but not `missed`, and the condition is logged. Rationale: refusing to
reconcile at all would leave the instance lying in `todo`, which is the bug this feature
fixes; jumping it straight to a terminal state on missing data would be worse.]**

---

## R4 — Discovery: which organizations, and which instances

**Decision**: two queries in `backend/database/scripts/collaboration.query.sql`.

- `ListOrganizationIDsWithReconcilableRitualInstances` — cross-organization, run on
  `AdminPool`, returning organization IDs only. Documented in place with the same Principle I
  justification as its sibling `ListOrganizationIDsWithActiveRitualDefinitions`.
- `ListRitualInstancesForReconciliation` — `organization_id`-scoped, joined to
  `project_state`, returning at most `@instance_limit` rows ordered by `completion_deadline`
  ascending.

Candidate predicate (identical in both):

```
task_kind = 'ritual_instance'
AND is_deleted = FALSE
AND detached_from_ritual = FALSE
AND completion_deadline IS NOT NULL
AND completion_deadline < @now
AND project_state.category IN ('scheduled', 'todo', 'in_progress', 'overdue')
```

**Rationale**: every clause maps to a requirement or an edge case. `detached_from_ritual`
excludes detached instances (FR-004). `completion_deadline IS NOT NULL` means an instance with
no deadline is never judged late (FR-005). The category set excludes `verified`, `missed` and
`skipped` (FR-003, FR-004) and excludes `submitted`, which is the "worker did their part, the
delay is the reviewer's" edge case. `overdue` is *included* because that is how an instance
progresses to `missed`. The query joins `task`, not `ritual_definition`, so an instance whose
definition was archived after generation is still found (FR-009).

**Alternatives considered**:

- *Reuse `ListOrganizationIDsWithActiveRitualDefinitions`.* Rejected outright: it filters
  `is_archived = FALSE`, so an organization whose only ritual was archived yesterday would
  never have its already-generated instances reconciled. FR-009 exists for this.
- *One cross-organization query returning instances directly.* Fewer round trips, and
  rejected: FR-011 requires per-organization failure isolation and FR-012 requires
  per-organization reporting, both of which need the organization loop.

---

## R5 — A separate job, or a second step inside the generation sweep

**Decision**: a separate `ritual_reconciliation_sweep` flows workflow on a 5-minute cadence,
registered and `ScheduleTx`-bootstrapped in `backend/cmd/server.go` alongside the existing
generation sweep.

**Rationale**: the spec assumes it, and the code confirms the reasoning. The two jobs discover
their work through genuinely different queries (active definitions vs. late instances). They
also have different failure profiles: generation is idempotent and read-mostly, reconciliation
writes state and sends notifications people cannot un-receive. Sharing a job would mean a
generation failure suppresses reconciliation and one output struct reports two unrelated
things. Five minutes is chosen because the thresholds are measured in hours, so the generation
sweep's one-minute cadence buys nothing, and it satisfies SC-002 (notified within 10 minutes)
with roughly a factor of two in hand.

`flows.ScheduleTx` upserts by schedule ID, so every server instance and every restart
converges on exactly one schedule row — the property the generation sweep already relies on.

**Alternatives considered**: a `pg_cron` job or an external scheduler. Rejected — `flows` is
the repository's one scheduling mechanism, already carries the retry policy and the durable
schedule row, and adding a second mechanism for one job is the infrastructure this project
deliberately avoids.

---

## R6 — Bounding the pass

**Decision**: `instance_limit = 500` per organization per pass, ordered by
`completion_deadline ASC`.

**Rationale**: FR-013 requires a bound and leaves the figure to the plan. 500 instances at
roughly four reads each is a bounded unit of work well inside a 5-minute window, and the
ascending order means the oldest backlog drains first and deterministically — a partially
drained organization makes strict progress every pass instead of re-examining the same head
of the list. At 5-minute cadence a backlogged organization drains 6,000 instances per hour.

**Alternatives considered**: a global cap across all organizations. Rejected — a single large
organization could then starve every other one, which is the opposite of FR-011's isolation
intent.

---

## R7 — Backfill horizon

**Decision**: instances whose `completion_deadline` is more than 7 days before `now`
transition normally but publish no notification.

**Rationale**: FR-021 and the spec's first-run edge case. On first deployment every historical
unreconciled instance is eligible at once; a week is long enough that anything older is
history rather than actionable. The transition still happens because the compliance figures
must be right (FR-022, Story 3 scenario 3) — it is only the alert that is suppressed.

The check is on the deadline, not on wall-clock elapsed time since the state change, so it is
deterministic and re-running a pass cannot change the outcome (FR-010).

---

## R8 — Notification recipients, policy and priority

**Decision**:

| Transition | Recipients |
|---|---|
| → `overdue` | task assignees (`role = 'assignee'`) + reviewers (`role IN ('reviewer','approver')`) |
| → `missed` | the same set; if it contains no reviewer or approver, the project's `owner` and `admin` members are added |

Published with `Priority: 2`, `PolicyKey: task_status`, `DeliveryClass: persistent`,
`SourceCategory: activity`, `SourceDomain: projects`, deduplicated by employee ID with the
existing `appendUniqueRecipient` helper.

**Rationale**: FR-014/FR-015 name assignees *and* reviewers for both transitions; FR-016 adds
project owners and admins only for `missed` with no reviewer, so the escalation always reaches
someone with authority. FR-018 requires ordinary priority and the ordinary do-not-disturb,
domain-mute and presence rules — which is exactly what publishing through
`NotificationPublisher.PublishNotification` with `Priority: 2` gets, with no special case
written anywhere. The always-deliver path reserved for mentions and incoming calls is not
touched.

`task_status` is chosen as the policy key because these *are* workflow state transitions,
matching `task_status_changed`; it is already in the `notification_policy_key_valid` CHECK, so
no policy migration is needed.

**[ASSUMPTION: an instance with no assignee and no reviewer produces no overdue notification
at all — there is nobody to tell — but still transitions. Its `missed` transition escalates to
project owners and admins under FR-016, which is what closes the spec's "unassigned ritual
failing silently" hole.]**

**Alternatives considered**: notifying project owners on `overdue` as well. Rejected — the
spec is explicit that escalation belongs to `missed`, and an owner receiving an alert every
time any worker is an hour late is how this feature would get muted.

---

## R9 — Restoring the two notification types

**Decision**: one migration, `20260903000001_ritual_overdue_missed_notification_types.up.sql`,
adds `ritual_instance_overdue` and `ritual_instance_missed` back to
`notification_notification_type_valid`; `backend/internal/notification/constants.go` gains the
two constants in the const block, `IsValidNotificationType` and `AllNotificationTypes`;
`backend/internal/collaboration/constants.go` gains the two aliases beside
`NotificationTypeRitualInstancesScheduled`.

**Rationale**: FR-019 requires the Go list and the DB CHECK to move together, which
`TestNotificationTypeCheckMatchesGoConstants` (added when drift D2 was fixed) already enforces
— the test fails if only one side is edited, so the requirement needs no new machinery.

`ritual_instance_assigned` is **not** restored. It was replaced by the
`ritual_instances_scheduled` summary and has no caller; it is removed from the TypeScript
union and the icon/label maps in the same change set. The project carries no backward
compatibility obligation, so a dead union member is deleted rather than kept.

`schema.sql` is regenerated with `backend/scripts/regen-schema.sh` after the migration, and
`sqlc generate` is re-run after the query file changes.

---

## R10 — Making the clients read the stored state

**Decision**: `classifyRitualTaskBucket` in
`frontend/packages/apis/src/collaboration-ritual.ts` takes the project's `ProjectState[]` and
resolves the task's category from `task.stateId`. `overdue` and the new `missed` bucket come
from that category; only `today` / `upcoming` continue to use `scheduledDate`.
`RitualWorklistBuckets` gains a `missed` member. `TodayView.tsx` pulls `states` from
`useProjectContext()` — the project page already loads them — and renders a `Missed` section.

**Rationale**: FR-022 and SC-005 require zero screens computing their own lateness.
`classifyRitualTaskBucket` is the last place that does: it compares `completionDeadline` and
`scheduledDate` against `new Date()` in the browser, which means a client with a skewed clock
disagrees with the server about the same instance.

**Alternatives considered**:

- *Add `state_category` to the `Task` proto message.* Architecturally the tidier answer, and
  rejected as disproportionate: `taskToProto` has eleven call sites, none of which currently
  hold the project's state rows, so it would mean threading a state map through the whole task
  logic layer to serve one screen. Both clients already fetch `ListProjectStates` for the
  project they are rendering — mobile already colours and tones ritual cards from
  `state.category`, including `overdue` and `missed` — so the data is present client-side
  today. Recorded as the upgrade path if a third surface ever needs the category without the
  state list.

**Also decided**: `GetAssignedWorkSummaryCounts` and `ListAssignedWorkSummaryItems` bucket an
item as `overdue` when `project_state.category = 'overdue'` **or** `due_date < as_of_date`.
The `OR` retains correct behaviour for standard tasks, which have no `overdue` state, while
making ritual instances agree with the stored state — the case it fixes is a same-day ritual
whose window closed at 23:00 and which the old expression called "due today" at 23:30.
`missed` instances leave the summary automatically because the seeded `Missed` state is
`is_closed = true` and the query already filters `ps.is_closed = FALSE`.

---

## R11 — Testing approach

**Decision**: a new integration suite `collaboration_ritual_reconciliation_test.go` using the
`testWorld` helper, plus a `runRitualReconciliationSweep()` helper in `helper_test.go`
mirroring the existing `runRitualGenerationSweep()`, plus unit tests for the pure
`determineRitualTaskStateCategory` precedence table.

**Rationale**: `RitualGenerationWorkflow.Sweep` is exported specifically so integration tests
can drive a cycle without standing up a flows worker; the new workflow follows that pattern
exactly. Time is injected as the `now` parameter of `Sweep`, so "the deadline passed three
days ago" is expressed by passing a time, never by sleeping. The precedence table is a pure
function and belongs in a unit test.

See [quickstart.md](./quickstart.md) for the runnable scenarios.
