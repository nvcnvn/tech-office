---
description: "Task list for feature 042 — Ritual Assignment Follows the Shift"
---

# Tasks: Ritual Assignment Follows the Shift

**Input**: Design documents from `/specs/042-shift-based-assignment/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Test tasks ARE included. Constitution principle II makes scenario-first
integration and E2E tests mandatory for this repository, and
[contracts/test-scenarios.md](./contracts/test-scenarios.md) is the approved behavioural
contract. No unit, snapshot or component tests are added.

**Organization**: Tasks are grouped by user story so each story is independently
implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Every task names the exact file path it touches

## Path Conventions

Multi-tenant SaaS monorepo. Go backend in `backend/`, Next.js web in `frontend/apps/web`,
Expo mobile in `frontend/apps/mobile`, shared typed API wrappers in
`frontend/packages/apis`. All paths below are repository-root relative.

## Assumptions resolved during task generation

- [ASSUMPTION: `plan.md` and `contracts/proto-and-sql.md` name
  `frontend/packages/apis/src/collaboration-task.ts` as the home of the `Task` type. That
  file does not exist — `Task` is declared at
  `frontend/packages/apis/src/collaboration.ts:104`. Tasks below target the real file rather
  than creating a new module, because splitting the `Task` type out would be an unrelated
  refactor.]
- [ASSUMPTION: the migration is named `20260904000001_ritual_on_shift_assignment.up.sql`,
  following the `YYYYMMDD00000N` sequence the last five migrations in
  `backend/database/migrations/` actually use, rather than the `YYYYMMDDHHMMSS` form written
  in the plan.]
- [ASSUMPTION: mobile has two ritual-instance detail screens —
  `src/app/(app)/(tasks)/[projectId]/task/[taskId].tsx` and
  `src/app/(shared)/resource/tasks/[projectId]/task/[taskId].tsx`. The plan names only the
  first. Both get the FR-019 banner, because a deep link from a notification lands on the
  shared route and would otherwise show an unexplained empty assignee.]
- [ASSUMPTION: the cross-stack constant-synchronization assertions land in the existing
  `backend/integration/collaboration_constants_test.go` rather than a new file, as
  `contracts/test-scenarios.md` directs, and are scheduled in the Foundational phase because
  every constant they assert on exists by the end of that phase.]
- [ASSUMPTION: the web ritual definition editor is
  `frontend/apps/web/src/app/workspace/projects/[id]/rituals/[definitionId]/page.tsx` — it is
  the only file under `frontend/apps/web/src` that references `assignmentStrategy`. The
  sibling route `workspace/tasks/[id]/rituals/[definitionId]/page.tsx` does not render the
  strategy selector and is left alone.]

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Get the schema change in place so every later task compiles against it.

- [X] T001 Create the forward migration `backend/database/migrations/20260904000001_ritual_on_shift_assignment.up.sql` containing all three statements from `contracts/proto-and-sql.md` §1: widen the `ritual_definition_department_pool_assignment_strategy_check` CHECK to include `'on_shift'`, create `collaboration.ritual_instance_pool_assignment` with the full DDL from `data-model.md` §2 (columns, `pk_ripa`, both composite FKs with `ON DELETE CASCADE`, `uq_ripa_instance_pool`, `chk_ripa_resolved_has_assignee`, `chk_ripa_closed_has_reason`, `idx_ripa_open`, `idx_ripa_task`), and widen `notification_notification_type_valid` to include `'ritual_instance_unassigned'`
- [X] T002 Apply the migration and regenerate the schema snapshot: `cd backend && ./scripts/migrate.sh && ./scripts/regen-schema.sh`, then confirm `backend/database/scripts/schema.sql` shows the new table and both widened CHECK constraints — the snapshot is generated and must never be hand-edited

**Checkpoint**: The database carries the new table and the two widened constraints.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Constants, contracts, generated code and the cross-domain interface declaration
that every user story below depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Constants (Constitution VIII — database CHECK → Go → proto → TypeScript)

- [X] T003 Add the strategy, resolution-state, closed-reason and cadence constants to `backend/internal/collaboration/constants.go`: `AssignmentStrategyRoundRobin`, `AssignmentStrategyLeastAssigned`, `AssignmentStrategyOnShift`, `PoolAssignmentStateResolved`, `PoolAssignmentStateAwaitingShift`, `PoolAssignmentStateClosedUnresolved`, `PoolAssignmentClosedReasonNoRoster`, `PoolAssignmentClosedReasonManualOverride`, `RitualShiftResolutionInterval = 2 * time.Minute`, `ritualShiftResolutionSlotLimit = 500`, `ritualShiftEscalationBackfillHorizon = 7 * 24 * time.Hour`, each carrying the doc comment naming the DB constraint it mirrors, exactly as `RitualReconciliationInterval` does in the same file
- [X] T004 Repay the Constitution VIII debt in `backend/internal/collaboration/scheduler_logic.go`: replace the bare literal `"round_robin"` at line ~89 and the `case "round_robin"` / `case "least_assigned"` at line ~218 with `AssignmentStrategyRoundRobin` and `AssignmentStrategyLeastAssigned` (depends on T003)
- [X] T005 [P] Add `NotificationTypeRitualInstanceUnassigned = "ritual_instance_unassigned"` to `backend/internal/notification/constants.go` alongside `NotificationTypeRitualInstanceMissed`, and register it in both `IsValidNotificationType`'s switch and `AllNotificationTypes()`

### Proto

- [X] T006 [P] Add the `RitualPoolAssignmentState` enum (`UNSPECIFIED=0`, `RESOLVED=1`, `AWAITING_SHIFT=2`, `CLOSED_UNRESOLVED=3`) and the `Task.pool_assignment_state = 30` field to `backend/rpc/v1/collaboration.proto`, with the doc comments from `contracts/proto-and-sql.md` §5; do not renumber any existing field and leave both `assignment_strategy` fields as `string`
- [X] T007 Regenerate the proto bindings with the repository's existing buf/protoc target and confirm `RitualPoolAssignmentState` and `Task.PoolAssignmentState` appear in the generated Go and TypeScript output (depends on T006)

### SQL queries

- [X] T008 [P] Add the pool-assignment CRUD queries to `backend/database/scripts/collaboration.query.sql` verbatim from `contracts/proto-and-sql.md` §2.1: `UpsertRitualPoolAssignment`, `ResolveRitualPoolAssignment`, `WithdrawRitualPoolAssignment`, `CloseRitualPoolAssignment`, `DeleteRitualPoolAssignment` — every mutation is a compare-and-set on `resolution_state` and every predicate pins `organization_id`
- [X] T009 Add the discovery queries to `backend/database/scripts/collaboration.query.sql` from `contracts/proto-and-sql.md` §2.2: `ListOrganizationIDsWithResolvableRitualPoolAssignments` (with its `-- lint:cross-tenant scheduler sweep` marker), `ListRitualPoolSlotsForResolution`, `ListRitualPoolAssignmentsDueEscalation`, `ListRitualPoolAssignmentStatesForTasks` (same file as T008, so not parallel)
- [X] T010 Add the candidate-selection queries `GetLeastAssignedEmployeeAmongCandidates` and `TaskAssigneeExists` to `backend/database/scripts/collaboration.query.sql` from `contracts/proto-and-sql.md` §2.3 (same file as T008/T009)
- [X] T011 [P] Add `ListShiftCoverageDirect`, `ListShiftCoverageSeries` and `ListRecurrenceExceptionsForSeries` to `backend/database/scripts/calendar.query.sql` from `contracts/proto-and-sql.md` §3, all pinning `organization_id` and filtering `event_type = 'shift'`, `cancelled_at IS NULL` and `rsvp_status <> 'declined'`
- [X] T012 Run `cd backend && sqlc generate` and confirm the new params/row structs exist in `backend/database/collaboration.query.sql.go` and `backend/database/calendar.query.sql.go` (depends on T008–T011)
- [X] T013 Run `make lint-tenancy` and fix any finding — a missing `organization_id` in a new join or an unmarked cross-tenant query is a build failure, not a review comment (depends on T002, T012)

### Cross-domain interface declaration (FR-022)

- [X] T014 Declare the `ShiftCoverageReader` interface in `backend/internal/collaboration/logic.go` with the doc comment from `contracts/shift-coverage-interface.md` §1, add `SetShiftCoverageReader(reader ShiftCoverageReader)` to the `Logic` interface, add the `shiftCoverage ShiftCoverageReader` field to `logicImpl`, and implement the setter — a nil reader is a supported state and callers must treat it exactly as they treat an error (depends on T003)

### TypeScript contracts

- [X] T015 [P] Widen `AssignmentStrategy` to `'round_robin' | 'least_assigned' | 'on_shift'` in `frontend/packages/apis/src/collaboration-ritual.ts` (line ~97)
- [X] T016 [P] Add the `RitualPoolAssignmentState` union type and the `poolAssignmentState` field to the `Task` interface in `frontend/packages/apis/src/collaboration.ts` (line ~104), mapping the proto enum to snake-case strings in the same style as the file's other enum mappings
- [X] T017 [P] Add `'ritual_instance_unassigned'` to the `NotificationType` union in `frontend/packages/apis/src/notification.ts` (after line ~64) and add its icon `'⚠️'` and label `'Ritual could not be assigned'` entries to `frontend/packages/notifications/src/utils.ts` alongside the existing `ritual_instance_overdue` / `ritual_instance_missed` entries

### Constant synchronization tests (Constitution VIII.4)

- [X] T018 Add the four constant-sync scenarios from `contracts/test-scenarios.md` to the existing `backend/integration/collaboration_constants_test.go`: the on-shift strategy constant matches the database CHECK constraint, every pool assignment state constant matches the database CHECK constraint, every pool assignment state constant maps to a `RitualPoolAssignmentState` enum value, and `ritual_instance_unassigned` is accepted by the notification type CHECK constraint (depends on T003, T005, T007, T013)

**Checkpoint**: Schema, constants, generated code and the interface declaration are in place —
user story implementation can begin.

---

## Phase 3: User Story 1 — The closing checklist goes to whoever is closing (Priority: P1) 🎯 MVP

**Goal**: A department pool set to `on_shift` assigns each generated instance to a department
member who has a non-cancelled, non-declined shift covering that instance's scheduled date in
the definition's own timezone, breaking ties by fewest ritual assignments in the trailing 90
days. Nobody who is off is ever assigned.

**Independent Test**: Create a ritual with an on-shift department pool, put two department
members on shifts covering alternate days, run one generation sweep, and assert every
instance's assignee has a shift covering that instance's scheduled date and that nobody who
is off appears as an assignee.

**Note**: the no-candidate outcome is written as an `awaiting_shift` row here because it is
the natural else-branch of the same resolver — but nothing re-resolves it until User Story 2
lands the sweep.

### Calendar side — implementing the reader

- [X] T019 [US1] Add the `── Shift Coverage ──` section and the `EmployeesOnShift(ctx, tx, orgID, candidateEmployeeIDs, dayStart, dayEnd)` method signature to the `Logic` interface in `backend/internal/calendar/logic.go`
- [X] T020 [US1] Implement `EmployeesOnShift` in a new `backend/internal/calendar/shift_coverage_logic.go` following the four-step algorithm in `contracts/shift-coverage-interface.md` §2: return early and query nothing on an empty candidate list; run `ListShiftCoverageDirect` for concrete events; run `ListShiftCoverageSeries` and expand each series head with the existing `expandInstances` + `applyExceptions` helpers in `backend/internal/calendar/recurrence.go` (widening the expansion window backwards by the series duration so an overnight occurrence starting before `dayStart` is not missed, and dropping `skipped`, `cancelled` and `modified` occurrences); keep occurrences whose `[occStart, occStart+duration)` overlaps `[dayStart, dayEnd)`; return the covered set deduplicated and sorted ascending so the caller's tiebreak is reproducible (depends on T012, T019)
- [X] T021 [US1] Wire the inversion of control in `backend/cmd/server.go`: call `collaborationLogic.SetShiftCoverageReader(calendarLogic)` immediately after `calendarLogic := calendar.NewLogic(...)` (~line 537), with the comment from `contracts/shift-coverage-interface.md` §3 explaining why it is a setter and not a constructor argument (depends on T014, T020)

### Tests for User Story 1

- [X] T022 [P] [US1] Create `backend/integration/calendar_shift_coverage_test.go` implementing every `t.Run` scenario in `contracts/test-scenarios.md` §A against the real database: day coverage, all-day, overnight Friday→Saturday, cancelled event, declined / no-response / accepted / tentative RSVP, recurring occurrence, occurrence cancelled by exception, moved occurrence, candidate-list narrowing, empty candidate list, read-only purity (FR-021), organiser-not-attendee, private shift, and non-shift event type (depends on T020)
- [X] T023 [P] [US1] Create `backend/integration/collaboration_ritual_shift_assignment_test.go` with the `TestRitualOnShiftAssignment` shell and the User Story 1 `t.Run` scenarios from `contracts/test-scenarios.md` §B: Mon/Wed/Fri and Tue/Thu assignment, nobody-off-is-assigned, exactly one of three covering members assigned, fewest-in-ninety-days chosen, resolving twice chooses the same member, declined shift not assigned, cancelled shift not assigned, named individual assignees still assigned, round-robin and least-assigned pools unchanged, left-the-department and deactivated members ineligible, and the `Asia/Tokyo` ritual vs UTC-stored shift timezone agreement — injecting the real `calendar.Logic` via `SetShiftCoverageReader`, not a stub (depends on T021, T025)

### Implementation for User Story 1

- [X] T024 [US1] Create `backend/internal/collaboration/ritual_shift_assignment_logic.go` holding the shared resolver used by both generation and the sweep: given an org, pool, department and a scheduled date plus the definition's timezone, compute the half-open `[dayStart, dayEnd)` UTC instant pair from the date in that timezone, list the department's active members, call `l.shiftCoverage.EmployeesOnShift` for the intersection, and pick the winner with `GetLeastAssignedEmployeeAmongCandidates` over the trailing 90 days; return "no candidate" for an empty result, for a nil reader and for any reader error, logging the reader error and never guessing (FR-002, FR-005, FR-006, FR-016) (depends on T014, T012)
- [X] T025 [US1] Add the `AssignmentStrategyOnShift` branch to the pool loop in `backend/internal/collaboration/scheduler_logic.go` (~line 218): call the T024 resolver, assign the winner with `assignTaskSilent` when there is one, and in both the winner and the no-candidate case write the per-instance-per-pool row with `UpsertRitualPoolAssignment` — `resolution_state = 'resolved'` with `assigned_employee_id` and `resolved_at` set, or `'awaiting_shift'` with neither — always setting `resolve_by` to the start of the scheduled date in the definition's timezone; never touch `last_assigned_employee_id` for an on-shift pool and never fall through to round-robin or least-assigned (FR-007, FR-008) (depends on T024)

**Checkpoint**: A ritual with an on-shift pool and a published rota assigns every instance to
someone who is rostered. User Story 1 is independently testable and demonstrable.

---

## Phase 4: User Story 2 — A checklist for a date with no published rota waits instead of guessing (Priority: P1)

**Goal**: An instance generated for a date with no rota records that its pool slot is awaiting
shift resolution, is bound as soon as a covering shift appears, and — if its scheduled date
arrives still unbound — stops awaiting and alerts the project's owners and admins exactly
once.

**Independent Test**: Generate a 30-day window with no shifts on the calendar and assert every
pool slot is `awaiting_shift` with nobody assigned and no fallback anywhere; then publish
shifts for one week, drive one `Sweep(ctx, now)`, and assert exactly those seven instances
become assigned and their assignees were notified.

### Tests for User Story 2

- [X] T026 [P] [US2] Add the User Story 2 `t.Run` scenarios from `contracts/test-scenarios.md` §B to `backend/integration/collaboration_ritual_shift_assignment_test.go`: instance created with slot unassigned, slot recorded as awaiting, no fallback applied, a calendar read failure still creates the instance and never guesses, a nil reader leaves the slot awaiting and logs, publishing a covering shift assigns within one pass, the new assignee is notified, a thirty-day window with no rota leaves every slot awaiting, publishing one week assigns exactly seven, an unresolved slot stops awaiting on its scheduled date, owners and admins are alerted, two passes produce exactly one alert, the alert is suppressed past the seven-day horizon while the state change still happens, plus the bounded/ordered/failure-tolerant scenarios (bounded batch ordered by scheduled date ascending, a failing organization does not stop the rest, a failing instance does not stop the organization's rest, a large backlog drains across passes) and the strategy-switch scenarios (switching from round-robin re-resolves future instances, past and started instances keep their assignee, switching away assigns waiting slots under the new strategy) (depends on T027–T031)

### Implementation for User Story 2

- [X] T027 [US2] Create `backend/internal/collaboration/ritual_shift_resolution_logic.go` with the per-organization resolution pass: read `ListRitualPoolSlotsForResolution` with `slot_limit = ritualShiftResolutionSlotLimit` and a `scheduled_date_floor` of one day before the escalation horizon, then for each slot apply the FR-010 gate in Go (`now < resolve_by`, `has_evidence` false) before doing anything; for an `awaiting_shift` or absent row on an `on_shift` pool, call the T024 resolver and on a hit assign the employee and `ResolveRitualPoolAssignment` with the expected state it read, adopting an absent row by upserting it first; continue past an error on any single slot after logging its task ID (FR-009, FR-011, FR-015) (depends on T024, T012)
- [X] T028 [US2] Add the escalation path to `backend/internal/collaboration/ritual_shift_resolution_logic.go`: read `ListRitualPoolAssignmentsDueEscalation` for `resolve_by <= now`, call `CloseRitualPoolAssignment` with `closed_reason = 'no_roster'`, `expected_state = 'awaiting_shift'` and `escalated_at = now`, and publish the owner alert if and only if that compare-and-set returns a row — suppressing the alert, but never the state change, when `resolve_by` is more than `ritualShiftEscalationBackfillHorizon` in the past (FR-013, FR-014) (depends on T027)
- [X] T029 [US2] Add the notification helpers to `backend/internal/collaboration/ritual_notification_logic.go`: a `task_assigned` notification to a newly bound assignee, and a `ritual_instance_unassigned` alert to the project's owners and admins naming the ritual and its scheduled date, reusing the recipient resolution the feature-040 `missed` transition already uses so the two alerts stay distinct notification types (FR-011, FR-013, FR-020) (depends on T005, T007)
- [X] T030 [US2] Create `backend/internal/collaboration/ritual_shift_resolution_workflow.go` with `RitualShiftResolutionInput`, `RitualShiftResolutionOutput` (the six counters from `contracts/proto-and-sql.md` §7), `RitualShiftResolutionWorkflow{Logic, Queries, AdminPool}`, `Name() == "ritual_shift_resolution_sweep"`, `Run` using `flows.Execute` with `RetryPolicy{MaxRetries: 2}`, and an exported `Sweep(ctx, now)` that discovers organizations with `ListOrganizationIDsWithResolvableRitualPoolAssignments` on `AdminPool`, processes each, continues past a failing organization after logging its ID, and emits one structured `ritual shift resolution sweep complete` line carrying every counter — modelled on `backend/internal/collaboration/ritual_reconciliation_workflow.go` (depends on T027, T028, T029)
- [X] T031 [US2] Handle the strategy-switch edges in `backend/internal/collaboration/ritual_shift_resolution_logic.go`: a slot row whose pool is no longer `on_shift` is first assigned under the pool's current strategy and then removed with `DeleteRitualPoolAssignment`, and a pool that has just switched *to* `on_shift` has its future, untouched instances adopted and resolved on the next pass while past and started instances keep their existing assignee (depends on T027)
- [X] T032 [US2] Register and schedule the sweep in `backend/cmd/server.go`: construct `RitualShiftResolutionWorkflow`, register it beside the generation and reconciliation workflows, and `flows.ScheduleTx(... flows.Every(collaboration.RitualShiftResolutionInterval))` — placed *after* the `SetShiftCoverageReader` call from T021 so a first pass can never run against a nil reader in a live server (depends on T021, T030)

**Checkpoint**: Instances for dates with no rota wait rather than guessing, bind as soon as a
rota is published, and escalate exactly once if the date arrives unbound. User Stories 1 and 2
both work.

---

## Phase 5: User Story 3 — A shift swap moves the checklist with it (Priority: P2)

**Goal**: A future, untouched, not-manually-assigned instance follows a shift swap within one
resolution cycle, notifying both the previous and the new assignee; and if nobody covers the
date after the swap, the assignment is withdrawn and the slot returns to awaiting.

**Independent Test**: Generate an assigned future instance, move the covering shift to a
different department member, drive one `Sweep(ctx, now)`, and assert the assignee changed and
both parties were notified.

### Tests for User Story 3

- [X] T033 [P] [US3] Add the User Story 3 `t.Run` scenarios from `contracts/test-scenarios.md` §B to `backend/integration/collaboration_ritual_shift_assignment_test.go`: moving the covering shift reassigns a future instance, the previous assignee is notified it is no longer theirs, the new assignee is notified it is now theirs, removing the only covering shift withdraws the assignment and returns it to awaiting, an instance whose scheduled date has arrived is not reassigned, an instance with submitted evidence is not reassigned, an instance a manager reassigned by hand is never re-resolved, two overlapping passes assign once and send no duplicate notification, a pass that changes nothing sends no notification, the two-pools-one-definition independence pair, emptying the pool's department leaves the slot awaiting and then escalates, the FR-020 pair (an on-shift instance still goes overdue and missed; an awaiting instance still escalates on the missed transition; the unassigned and missed alerts are distinct types), and resolution never creates, modifies or deletes a shift event (depends on T034–T036)

### Implementation for User Story 3

- [X] T034 [US3] Add rebinding to `backend/internal/collaboration/ritual_shift_resolution_logic.go`: for a `resolved` slot that still passes the FR-010 gate, re-run the T024 resolver for its date; when the recorded `assigned_employee_id` is no longer covered, withdraw the previous `task_assignee` row and either assign the new winner with `ResolveRitualPoolAssignment` (expected state `'resolved'`) or, when nobody covers the date, `WithdrawRitualPoolAssignment` back to `awaiting_shift`; make no write and send no notification when the resolver returns the same employee (FR-012, FR-014) (depends on T027)
- [X] T035 [US3] Add the manual-override freeze to `backend/internal/collaboration/ritual_shift_resolution_logic.go`: before rebinding a `resolved` slot, call `TaskAssigneeExists` for its recorded `assigned_employee_id`; when the row is gone a person changed the slot, so close it with `CloseRitualPoolAssignment` using `closed_reason = 'manual_override'`, no `escalated_at` and no notification — `closed_unresolved` is terminal, which is what stops the next pass undoing a manager's decision (FR-010) (depends on T034)
- [X] T036 [US3] Add the swap notifications to `backend/internal/collaboration/ritual_notification_logic.go`: notify the previous assignee that the instance is no longer theirs and the new assignee that it is now theirs, published only when the compare-and-set that performed the reassignment reported a changed row, so two overlapping passes notify once (FR-012, FR-014) (depends on T029, T034)

**Checkpoint**: Assignments track the rota over time, and the freeze rules protect started,
evidenced and manually-assigned instances. User Stories 1, 2 and 3 all work.

---

## Phase 6: User Story 4 — A manager can pick the strategy and see what it did (Priority: P2)

**Goal**: On-shift is selectable in the ritual definition editor with an explanation of what it
depends on, and an instance waiting for the rota says so on web and mobile instead of showing
an unexplained empty assignee.

**Independent Test**: Select on-shift in the ritual definition editor, save, reload and confirm
it persisted; then open an instance awaiting resolution and confirm the reason is stated on the
instance.

### Backend surface

- [X] T037 [US4] Populate `Task.pool_assignment_state` in `backend/internal/collaboration/task_logic.go` (and the ritual instance read path in `backend/internal/collaboration/ritual_connect.go`) using a single batched `ListRitualPoolAssignmentStatesForTasks` call per page of tasks — never one query per task — reporting the least-progressed state when an instance carries several pools so a waiting pool is not hidden by a resolved one, and `UNSPECIFIED` for every task that is not an on-shift ritual instance (FR-019) (depends on T007, T012)
- [X] T038 [P] [US4] Add the FR-019 API scenarios from `contracts/test-scenarios.md` §B to `backend/integration/collaboration_ritual_shift_assignment_test.go`: a waiting instance reports `awaiting_shift`, an assigned instance reports `resolved`, a task that is not an on-shift ritual instance reports unspecified, and an instance with one waiting and one resolved pool reports `awaiting_shift` (depends on T037)

### Web

- [X] T039 [P] [US4] Add the On-shift option to the assignment strategy selector in `frontend/apps/web/src/app/workspace/projects/[id]/rituals/[definitionId]/page.tsx` alongside round-robin and least-assigned, with helper text stating that assignment depends on shift events on the calendar for the chosen department (FR-017, FR-018) (depends on T015)
- [X] T040 [P] [US4] Add the waiting-for-rota banner to `frontend/apps/web/src/app/workspace/projects/[id]/components/TaskDetailSidePanel.tsx`, shown only when `poolAssignmentState === 'awaiting_shift'`, explaining that the instance is unassigned because nobody in the department is rostered for its date — and never shown for an instance that simply has no assignee configured (FR-019) (depends on T016)
- [X] T041 [US4] Create `frontend/apps/web/e2e/ritual-shift-assignment.spec.ts` implementing every scenario in `contracts/test-scenarios.md` §C using the existing helpers in `frontend/apps/web/e2e/helpers` and `test-ritual.ts`: on-shift appears in the selector, selecting and reloading persists it, the pool states its calendar dependency, a waiting instance explains that nobody is rostered, an instance with no assignee configured shows no such explanation, and switching an existing ritual from round-robin to on-shift keeps the definition intact (depends on T039, T040)

### Mobile (read-only, Constitution XIII)

- [X] T042 [P] [US4] Add the same waiting-for-rota banner to the ritual instance detail screen `frontend/apps/mobile/src/app/(app)/(tasks)/[projectId]/task/[taskId].tsx` (depends on T016)
- [X] T043 [P] [US4] Add the waiting-for-rota banner to the shared deep-link route `frontend/apps/mobile/src/app/(shared)/resource/tasks/[projectId]/task/[taskId].tsx`, which is where a notification tap lands (depends on T016)
- [X] T044 [US4] Verify the mobile banner renders correctly on **both** Android and iOS, not iOS alone — a narrow-Android or iOS-only-prop regression would not show on the habitual iPhone SE test device (depends on T042, T043)

**Checkpoint**: All four user stories are independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T045 [P] Update `docs/domain/rituals-tasks.md` with the third assignment strategy, the `ritual_instance_pool_assignment` record and its state machine, the third sweep and its 2-minute cadence, and the `ritual_instance_unassigned` notification — deleting any behaviour statement this change makes untrue
- [X] T046 [P] Update `docs/domain/calendar.md` with the shift-coverage read, its coverage rules, and the fact that RRULE expansion in `internal/calendar/recurrence.go` now has a live caller
- [X] T047 [P] Update `backend/docs/SYSTEM-ARCHITECTURE.md` with the inverted collaboration → calendar edge, why it is expressed as a consumer-declared interface, and why it is injected by a setter in `cmd/server.go`
- [X] T048 Run the full backend verification: `cd backend && go build ./... && go vet ./... && make lint-tenancy`, then the new and adjacent integration suites (`collaboration_ritual_shift_assignment_test.go`, `calendar_shift_coverage_test.go`, `collaboration_constants_test.go`, `collaboration_ritual_instance_test.go`, `collaboration_ritual_reconciliation_test.go`) and confirm the pre-existing ritual suites still pass unchanged (depends on all prior phases)
- [X] T049 [P] Run the frontend verification: typecheck and lint `frontend/packages/apis`, `frontend/packages/notifications`, `frontend/apps/web` and `frontend/apps/mobile`, then the new Playwright spec `frontend/apps/web/e2e/ritual-shift-assignment.spec.ts`
- [X] T050 Walk `quickstart.md` §§1–7 end to end against a local stack and confirm SC-001 through SC-005 and SC-007 hold, including the SC-006 operational check (200 definitions, 30-day window, one generation cycle inside its interval) which is a documented manual check rather than a wall-clock assertion in CI (depends on T048, T049)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — starts immediately
- **Foundational (Phase 2)**: depends on Phase 1 — **blocks every user story**
- **User Story 1 (Phase 3)**: depends on Phase 2
- **User Story 2 (Phase 4)**: depends on Phase 3 — it re-resolves the `awaiting_shift` rows US1 writes and reuses the US1 resolver
- **User Story 3 (Phase 5)**: depends on Phase 4 — rebinding, withdrawal and the freeze rules extend the resolution pass US2 creates
- **User Story 4 (Phase 6)**: depends on Phase 2 for the proto and TS contracts; its FR-019 surface is only *observable* once US2 produces `awaiting_shift` rows that survive a sweep, so demo it after Phase 4
- **Polish (Phase 7)**: depends on every story that is being shipped

### User Story Dependencies

- **US1 (P1)**: the only story with no dependency on another story. It is the MVP.
- **US2 (P1)**: builds directly on US1's resolver. Not independently implementable — the spec
  itself frames it as "the same mechanism, applied later".
- **US3 (P2)**: shares US2's resolution pass entirely; it is the rebind half of the same loop.
- **US4 (P2)**: independently implementable against Phase 2 alone. The web selector work
  (T039) can proceed in parallel with all backend story work.

### Within Each User Story

- Tests are written from `contracts/test-scenarios.md`, which is already approved — write them
  against the named implementation tasks and expect them to fail until those land
- Queries and constants before logic; logic before wiring; wiring before tests that need a
  running server
- Story complete and its checkpoint demonstrated before moving to the next priority

### Parallel Opportunities

- **Phase 2**: T005, T006, T008, T011, T015, T016, T017 are all different files and can run
  together. T009 and T010 share `collaboration.query.sql` with T008 and must serialize behind
  it.
- **Phase 3**: T022 (calendar test file) and T023 (collaboration test file) are different
  files and run in parallel once their implementation tasks land.
- **Phase 6**: T039, T040, T042, T043 touch four different files — one web selector, one web
  panel and two mobile screens — and run fully in parallel.
- **Phase 7**: T045, T046, T047 are three different documents; T049 is independent of T048.
- **Across stories**: US4's frontend tasks (T039–T043) depend only on Phase 2 and can be built
  in parallel with US1, US2 and US3 by a second person.

---

## Parallel Example: Phase 2 Foundational

```bash
# Different files, no shared state — launch together:
Task: "Add ritual_instance_unassigned to backend/internal/notification/constants.go"
Task: "Add RitualPoolAssignmentState enum and Task.pool_assignment_state to backend/rpc/v1/collaboration.proto"
Task: "Add pool-assignment CRUD queries to backend/database/scripts/collaboration.query.sql"
Task: "Add shift coverage queries to backend/database/scripts/calendar.query.sql"
Task: "Widen AssignmentStrategy in frontend/packages/apis/src/collaboration-ritual.ts"
Task: "Add poolAssignmentState to the Task interface in frontend/packages/apis/src/collaboration.ts"
Task: "Add ritual_instance_unassigned to the NotificationType union and notifications utils"
```

## Parallel Example: Phase 6 User Story 4

```bash
Task: "Add the On-shift option and helper text to the web ritual definition editor"
Task: "Add the waiting-for-rota banner to TaskDetailSidePanel.tsx"
Task: "Add the waiting-for-rota banner to the mobile task detail screen"
Task: "Add the waiting-for-rota banner to the mobile shared deep-link task route"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: Setup — migration and schema regeneration
2. Phase 2: Foundational — **blocks everything**
3. Phase 3: User Story 1
4. **STOP and VALIDATE**: create a ritual with an on-shift pool, publish one week of shifts,
   run one generation sweep, and confirm every instance went to someone rostered
5. This is demonstrable value on its own: the reported defect — the closing count landing on
   someone who is not in — no longer happens for dates with a published rota

### Incremental Delivery

1. Setup + Foundational → the schema and contracts exist
2. Add US1 → generation assigns rostered people → **MVP**
3. Add US2 → the 23 days of the window with no rota stop being dead slots; late binding and
   the owner alert land → this is what makes the feature usable in practice, since most of a
   30-day window has no rota when it is generated
4. Add US3 → assignments track swaps rather than drifting back into the bug within a week
5. Add US4 → managers can select the strategy and read why an instance is waiting
6. Polish → living documentation, full verification, quickstart walkthrough

US1 and US2 are both P1 and both required before this ships to a real store: US1 alone would
leave most of the generation window permanently unassigned.

### Parallel Team Strategy

1. Everyone completes Setup + Foundational together
2. Then:
   - Developer A: US1 → US2 → US3 (the backend spine; these are genuinely sequential)
   - Developer B: US4 frontend (T039–T044) against the Phase 2 contracts, plus the Phase 7
     documentation tasks
3. Developer B integrates against real `awaiting_shift` data once Developer A finishes US2

---

## Notes

- `[P]` means different files with no dependency on incomplete work
- Every task names the file it touches, so it can be executed without re-reading the design
  documents — though `contracts/proto-and-sql.md` holds verbatim SQL and proto for the tasks
  that say "verbatim"
- `backend/database/scripts/schema.sql` is a generated snapshot regenerated by
  `backend/scripts/regen-schema.sh`; it is never hand-edited
- The project takes breaking changes rather than compatibility layers: the CHECK constraint,
  the Go constants, the proto and the TypeScript union change together in one change set, with
  no dual-write path and no legacy strategy branch
- No fallback assignment is ever introduced. A fallback to round-robin *is* the defect this
  feature exists to fix
- Commit after each task or logical group; stop at any checkpoint to validate a story
  independently

## Corrections found during implementation

Three of the assumptions above turned out to be wrong about the codebase. Recording them
here rather than silently editing the assumption list, so the difference between what was
planned and what shipped stays visible.

- **The two mobile ritual-instance screens are one screen.**
  `src/app/(shared)/resource/tasks/[projectId]/task/[taskId].tsx` is a one-line re-export of
  `src/app/(app)/(tasks)/[projectId]/task/[taskId].tsx`. T042 therefore satisfies T043 by
  construction; no second banner was written.
- **The sibling web ritual editor route is also a re-export.**
  `workspace/tasks/[id]/rituals/[definitionId]/page.tsx` re-exports
  `workspace/projects/[id]/rituals/[definitionId]/page.tsx`, so T039 changed both routes,
  not one. The E2E spec drives the `workspace/tasks/...` form, which is the route the app's
  own navigation uses.
- **The web waiting-for-rota banner needed a second home.** T040 put it in
  `TaskDetailSidePanel.tsx`, which is the standard/mixed-project surface. A **ritual-mode**
  project opens an instance as a full page,
  `workspace/projects/[id]/tasks/[taskId]/page.tsx`, and never renders the side panel — so
  an on-shift ritual in the mode it is most likely to be used in would have shown nothing.
  The same banner was added there.

Two behavioural decisions were also taken that the design documents did not settle:

- **The shift's organiser does not count as rostered.** `CreateEvent` writes the acting user
  as an attendee with `role = 'organizer'`, and that actor is the manager publishing the
  rota, so counting the row would roster a manager onto every shift they publish. Research
  R4 called for attendees only; the coverage queries implement it as
  `at.role <> 'organizer'`. The cost is that a manager who genuinely works a shift they
  organised is not seen as covering it — the schema offers no way to tell the two apart.
- **A resolved slot is rebound only when its holder stops being covered**, not whenever the
  resolver would now pick somebody else. Re-picking on every pass hands the checklist to
  whoever is currently least loaded, which moves it every two minutes and fires a swap
  notification each time. `contracts/test-scenarios.md`'s "resolving twice over unchanged
  data chooses the same member both times" is what caught it.
