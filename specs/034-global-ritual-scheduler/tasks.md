---
description: "Task list for Global Ritual Scheduler"
---

# Tasks: Global Ritual Scheduler

**Input**: Design documents from `/specs/034-global-ritual-scheduler/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md), [quickstart.md](./quickstart.md)

**Tests**: Included. Constitution Principle II mandates scenario-first backend integration
tests, and the behavioral contract in [plan.md](./plan.md#behavioral-contract-principle-ii--requires-approval-before-speckit-tasks)
was approved before this list was written. Web E2E and Maestro are excluded with the
justification recorded in plan.md; both suites still run unchanged as regression guards.

**Organization**: Tasks are grouped by user story. US1–US3 come from spec.md. **US4 is an
addition requested after planning** — it fixes the pre-existing calendar background-job
defect that plan.md flagged as out of scope.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

Backend-only change. All paths are repository-root relative, under `backend/`. No frontend,
mobile, or proto file is touched.

---

## Phase 1: Setup

**Purpose**: Rollout artifact that must exist before the code change lands, plus a verified
starting point.

- [X] T001 [P] Create the forward migration `backend/k8s/base/database/migrations/20260822000002_drop_per_definition_ritual_schedules.up.sql` containing `DELETE FROM flows.schedules WHERE schedule_id LIKE 'ritual_def_%';` with the header comment from [data-model.md](./data-model.md#migration) explaining that these rows point at the removed `ritual_scheduler` workflow (FR-013)
- [X] T002 Apply the migration locally and confirm a clean version with `cd backend && ./scripts/migrate.sh && ./scripts/migrate.sh status`, then confirm the current baseline is green with `make check-backend`

**Checkpoint**: Migration exists and applies; baseline build is green.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The organization-discovery query every user story depends on. Nothing else in
this feature can be written until the generated Go binding exists.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T003 Add `ListOrganizationIDsWithActiveRitualDefinitions :many` to `backend/database/scripts/collaboration.query.sql`, selecting `DISTINCT organization_id FROM collaboration.ritual_definition WHERE is_archived = FALSE ORDER BY organization_id`, carrying verbatim the two comment blocks from [data-model.md](./data-model.md#new-query): the Constitution Principle I justification for the deliberately org-unfiltered system-scope query, and the `ponytail:` comment naming the cross-shard `DISTINCT` scan ceiling and its upgrade path
- [X] T004 Regenerate sqlc so `backend/database/collaboration.query.sql.go` exposes `ListOrganizationIDsWithActiveRitualDefinitions` returning `[]dbuuid.UUID`, then confirm `cd backend && go build ./...` passes (depends on T003)

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - Rituals keep appearing on schedule with no per-ritual timer (Priority: P1) 🎯 MVP

**Goal**: One platform-wide sweep generates every organization's due ritual instances on the
same dates the per-definition timers produced, exactly once per organization per run.

**Independent Test**: Create ritual definitions covering daily, every-N-days, weekly on
selected weekdays, monthly on a day-of-month, and custom interval in more than one
organization, run the sweep, and confirm the generated instances and their scheduled dates
match what the per-definition scheduler produced for the same definitions.

### Tests for User Story 1 ⚠️

> Write these first and confirm they fail before implementing T007–T008.

- [X] T005 [P] [US1] Add a `func (w *testWorld) runRitualGenerationSweep() *collaboration.RitualGenerationOutput` helper to `backend/integration/helper_test.go` that invokes the sweep in-process against `globalDB`, mirroring the existing `generateRitualInstancesAt` helper at `backend/integration/helper_test.go:3432`
- [X] T006 [US1] Add `TestGlobalRitualScheduler` to `backend/integration/collaboration_schedule_generation_test.go` with `t.Parallel()` and the approved US1 scenario names from [plan.md](./plan.md#behavioral-contract-principle-ii--requires-approval-before-speckit-tasks): one sweep generating for every organization with active rituals, each organization regenerated exactly once regardless of definition count (FR-001, FR-004), the six recurrence-matrix equivalence cases including a non-UTC timezone and a `UTC+N` offset string (FR-005), the two idempotency cases over a repeated sweep (FR-006), and the zero-active-ritual organization edge case (depends on T005)

### Implementation for User Story 1

- [X] T007 [US1] Add `RitualGenerationInput` (empty), `RitualGenerationOutput` (`OrganizationsProcessed`, `DefinitionsProcessed`, `TotalGenerated`), and `RitualGenerationWorkflow{Logic, AdminPool}` with `Name() string { return "ritual_generation_sweep" }` to `backend/internal/collaboration/scheduler_workflow.go`, alongside the existing per-definition workflow for now. Its `Run` wraps a single `flows.Execute` step that calls `ListOrganizationIDsWithActiveRitualDefinitions` on `AdminPool` and, per organization, calls `Logic.GenerateRitualInstances(ctx, w.AdminPool, orgID, time.Now())` **unmodified** — this is what makes FR-005 true by construction (see [research.md, Decision 1](./research.md#decision-1-wrap-generateritualinstances-do-not-rewrite-it))
- [X] T008 [US1] In `backend/cmd/server.go`, construct and `flows.Register` the new `RitualGenerationWorkflow`, then bootstrap its schedule with `flows.ScheduleTx` inside a transaction on `adminPool` using schedule ID `ritual_generation_sweep` and `flows.Every(1 * time.Minute)` (FR-007, FR-015). Registration alone does not schedule anything — this bootstrap is the whole point, and its absence is the calendar defect fixed in US4 (depends on T007)
- [X] T009 [US1] Run `make test-backend-one T=TestGlobalRitualScheduler` and confirm the scenario names in the `go test -v` output match the approved contract, then verify the schedule registry with the query in [quickstart.md §2](./quickstart.md) — exactly one `ritual_generation_sweep` row, still one after a server restart and after starting a second instance against the same database (SC-001)

**Checkpoint**: The global sweep generates correct instances for every organization. The old
per-definition machinery still exists and still fires; US2 removes it.

---

## Phase 4: User Story 2 - Ritual lifecycle actions no longer manage timers (Priority: P1)

**Goal**: Create, update, archive, unarchive, and reschedule perform zero scheduling
operations. The definition's stored recurrence rule and `is_archived` flag are the only
inputs to generation, and all per-definition scheduling code is deleted rather than orphaned.

**Independent Test**: Run a definition through create, update, archive, unarchive, and
schedule-change, then confirm no `ritual_def_%` row is ever written, exactly one ritual
schedule row exists platform-wide, and generation still tracks each definition's stored rule.

**⚠️ Compile coupling**: T012–T018 remove symbols that reference each other across four
files. The tree does not build again until all of them land — land them as one change set,
per the project's early-development no-compatibility-shim stance.

### Tests for User Story 2 ⚠️

- [X] T010 [US2] In `backend/integration/collaboration_schedule_generation_test.go`, replace the `"when the flows schedule is created via RPC"` block at lines 185–204 — its `"a flows schedule row exists for this definition"` assertion is now inverted: assert zero rows match `schedule_id LIKE 'ritual_def_%'` and exactly one row has `workflow_name = 'ritual_generation_sweep'` (FR-002, FR-013, SC-001)
- [X] T011 [US2] Add the remaining approved US2 scenarios to `TestGlobalRitualScheduler` in `backend/integration/collaboration_schedule_generation_test.go`: the five lifecycle no-schedule-write cases, a newly created definition's instances existing immediately without a sweep (FR-011), a schedule change regenerating instances within the same operation while still returning non-zero `instances_removed` / `instances_detached` / `instances_created` (FR-012), and archive making the next sweep generate nothing with unarchive resuming it (FR-010)

### Implementation for User Story 2

- [X] T012 [US2] In `backend/internal/collaboration/ritual_connect.go`, delete the four scheduling blocks — create at lines 86–99, update at lines 161–175, archive/unarchive pause-resume at lines 208–218, and change-schedule at lines 552–567 — and in the create transaction replace the deleted `flows.ScheduleTx(..., flows.WithRunNow())` with a direct `s.Logic.GenerateRitualInstances(ctx, tx, organizationID, time.Now())` call so creation still produces immediately-due instances (FR-002, FR-011)
- [X] T013 [US2] Delete the now-unused `recurrenceRuleToJSON` helper at `backend/internal/collaboration/ritual_connect.go:674` and confirm `recurrenceRuleToMap` is **retained** — it still serves the definition CRUD persistence path (depends on T012)
- [X] T014 [US2] Remove the `RitualScheduler *RitualSchedulerWorkflow` field at `backend/internal/collaboration/connect.go:51`, the `ritualScheduler` constructor parameter at line 65, and its assignment at line 74 (FR-016)
- [X] T015 [US2] In `backend/cmd/server.go`, delete the `ritualScheduler` construction and `flows.Register` block at lines 417–423 and drop the trailing `ritualScheduler` argument from the `collaboration.NewCollaborationServiceConnect` call (depends on T014)
- [X] T016 [US2] In `backend/internal/collaboration/scheduler_workflow.go`, delete `RitualSchedulerInput`, `RitualSchedulerOutput`, `RitualSchedulerWorkflow`, `RitualScheduleID`, `RecurrenceRuleToSchedule`, `parseTimeOfDay`, `isoDayToCron`, and `RecurrenceRuleFromDefinition`, leaving only the global sweep added in T007 plus its now-narrower imports (FR-003, FR-016)
- [X] T017 [P] [US2] Delete `RecurrenceTypeEveryMinute` and `RecurrenceTypeEveryTwoMinutes` at `backend/internal/collaboration/constants.go:317-318` — verified unreachable from the proto enum in [research.md, Decision 4](./research.md#decision-4-delete-every_minute-and-every_two_minutes)
- [X] T018 [US2] Delete the now-dead short-interval branch at `backend/internal/collaboration/scheduler_logic.go:374` (`case RecurrenceTypeEveryMinute, RecurrenceTypeEveryTwoMinutes:`) (depends on T017)
- [X] T019 [US2] Run the structural verification from [quickstart.md §1](./quickstart.md): `cd backend && go build ./... && go vet ./...`, then confirm each deletion grep returns nothing (`RitualScheduleID|RecurrenceRuleToSchedule|RitualSchedulerInput`, `RecurrenceTypeEveryMinute|RecurrenceTypeEveryTwoMinutes`, `ritual_def_`, `isoDayToCron|parseTimeOfDay|recurrenceRuleToJSON`) and that `func recurrenceRuleToMap` returns exactly one hit (FR-016, SC-007)

**Checkpoint**: The per-definition timer machinery is gone. Ritual lifecycle actions perform
zero scheduling operations and generation is driven solely by the global sweep.

---

## Phase 5: User Story 3 - Operators can see and trust one scheduling surface (Priority: P2)

**Goal**: A single named recurring job reports per run how many organizations, definitions,
and instances it handled, and one organization's failure neither aborts the run nor hides the
organization responsible.

**Independent Test**: Run the sweep and confirm exactly one ritual generation job exists in
`flows.schedules`, that its run output reports organizations processed, definitions
processed, and instances created, and that a failure affecting one organization is
attributable from that output.

### Tests for User Story 3 ⚠️

- [X] T020 [US3] Add the approved US3 scenarios to `TestGlobalRitualScheduler` in `backend/integration/collaboration_schedule_generation_test.go`: the sweep reporting organizations, definitions, and instances processed (FR-014), a definition with an uninterpretable recurrence rule being skipped while its siblings still generate (FR-009), and generation failing for one organization while the remaining organizations still process in the same run (FR-008)

### Implementation for User Story 3

- [X] T021 [US3] In `backend/internal/collaboration/scheduler_workflow.go`, populate all three `RitualGenerationOutput` counters during the sweep — count organizations returned by the discovery query, definitions observed per organization, and instances created — and emit them on one per-run `slog.InfoContext(ctx, "ritual generation sweep complete", ...)` line matching the shape in [quickstart.md §3](./quickstart.md) (FR-014)
- [X] T022 [US3] In the same sweep loop, wrap the per-organization `GenerateRitualInstances` call so a failing organization is logged with `slog.ErrorContext` including its organization ID and the loop continues to the next organization rather than returning (FR-008). Per-definition rule-parse isolation is inherited unchanged from `GenerateRitualInstances` and must not be reimplemented (FR-009)
- [X] T023 [US3] Run `make test-backend-one T=TestGlobalRitualScheduler` and confirm the reporting line appears once per sweep with all three counters non-absent, following the diagnosis guidance in [quickstart.md §3](./quickstart.md)

**Checkpoint**: All three specified user stories are independently functional.

---

## Phase 6: User Story 4 - Calendar background jobs actually run (Priority: P2, added post-planning)

**Goal**: Fix the pre-existing defect recorded in [plan.md](./plan.md#pre-existing-defect-found-during-research-out-of-scope--flagged-not-fixed)
and [research.md](./research.md#pre-existing-defect-discovered-out-of-scope). Calendar event
reminders fire, and the presence workflow — which cannot work as written and now contradicts
the client-driven presence model — is deleted rather than left as scaffolding.

**Why this is not simply "schedule both jobs"**: `CalendarReminderWorkflow` is a genuine
working job that is merely unscheduled, so a bootstrap fixes it. `CalendarPresenceWorkflow`
is not: it queries `ListEventsForOrg` with a zero UUID organization ID at
`backend/internal/calendar/presence_workflow.go:59` and `:95`, so it always reads an empty
set, and its "set in_meeting" branch only calls `slog.Debug` — it never writes presence.
Since feature 033, `notification.active_connection.presence_status` is written **only** by
client pongs, so a server-side write would be clobbered on the next pong anyway. Scheduling
it would create a job that runs every minute and does nothing. It is deleted.

**Independent Test**: Start the server, confirm exactly one `calendar_reminder_poll` row
exists in `flows.schedules` and that a pending `calendar.event_reminder` row with
`fire_at <= now()` transitions to `sent` with a notification published, and confirm no
presence workflow symbol remains in the repository.

### Tests for User Story 4 ⚠️

- [X] T024 [US4] Add a scenario to `backend/integration/calendar_notification_test.go` asserting that exactly one `flows.schedules` row exists with `schedule_id = 'calendar_reminder_poll'`, and that running the reminder workflow over a reminder whose `fire_at` has passed publishes a notification and flips the reminder's status to `sent`

### Implementation for User Story 4

- [X] T025 [US4] In `backend/cmd/server.go`, after the existing `flows.Register(flowsRegistry, calendarReminderWorkflow)` at line 473, bootstrap the schedule with `flows.ScheduleTx` in a transaction on `adminPool` using `calendar.CalendarReminderScheduleID()` and `calendar.ReminderSchedule()` — the helpers that already exist and were never called. This is the fix: registration makes a workflow resolvable, scheduling is what makes it run
- [X] T026 [P] [US4] Delete `backend/internal/calendar/presence_workflow.go` entirely, including `CalendarPresenceInput`, `CalendarPresenceOutput`, `CalendarPresenceWorkflow`, `CalendarPresenceScheduleID`, and `PresenceSchedule`
- [X] T027 [US4] In `backend/cmd/server.go`, delete the `CalendarPresenceWorkflow` construction and registration block at lines 476–482 along with its comment (depends on T026)
- [X] T028 [P] [US4] Delete the now-orphaned `PresenceStatusInMeeting` constant at `backend/internal/calendar/constants.go:66` — the presence workflow was its only consumer. The unrelated `notification.PresenceStatusInMeeting` at `backend/internal/notification/constants.go:297` is live and must be left alone
- [X] T029 [US4] Verify with `cd backend && go build ./... && go vet ./...` and confirm `grep -rn "CalendarPresence\|PresenceSchedule" --include="*.go" backend/` returns nothing, while `grep -rn "CalendarReminderScheduleID" --include="*.go" backend/` now returns both the definition and its new call site

**Checkpoint**: Calendar reminders fire on a one-minute poll; the dead presence job is gone.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T030 [P] Update `backend/docs/SYSTEM-ARCHITECTURE.md` so the ritual scheduling section describes one platform-wide `ritual_generation_sweep` instead of per-definition schedules (Constitution Principle XII)
- [X] T031 [P] Add a background-jobs section to `backend/docs/PRODUCTION-RUNTIME-SERVICES.md` listing every `flows` schedule the server bootstraps at startup — `ritual_generation_sweep` and `calendar_reminder_poll` — with their cadence, and stating explicitly that `flows.Register` alone does not schedule a workflow, so any new recurring job needs a matching `flows.ScheduleTx` bootstrap. This note is what stops the US4 defect from recurring
- [X] T032 Run the full backend suite with `make test-backend` and confirm zero failures, paying particular attention to the pre-existing ritual suites that are the real FR-005 regression guard: `make test-backend-one T='TestRitual|TestCollaborationRitual|TestScheduleGeneration'`
- [X] T033 Run the web E2E suites `ritual-ux-redesign.spec.ts` and `ritual-submission-flow.spec.ts` unchanged and confirm they still pass — SC-004 requires that ritual owners observe no difference
- [X] T034 Walk [quickstart.md](./quickstart.md) end to end, including the §5 recurrence-matrix equivalence spot-check against `main` (SC-003), the §6 lifecycle zero-schedule-write check (SC-005), and the §7 redundancy check confirming one `GenerateRitualInstances starting` line per organization per cycle instead of one per definition (SC-002)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Foundational
- **US2 (Phase 4)**: Depends on US1 — the global sweep must exist and be scheduled before the per-definition machinery it replaces is deleted, otherwise no ritual generates between the two phases
- **US3 (Phase 5)**: Depends on US1 (extends the sweep written in T007). Independent of US2
- **US4 (Phase 6)**: Depends only on Foundational — different domain, no shared file except `backend/cmd/server.go`
- **Polish (Phase 7)**: Depends on all desired stories being complete

### User Story Dependencies

- **US1 (P1)**: The MVP. Standalone once Foundational lands
- **US2 (P1)**: Sequenced after US1 for correctness, not merely for convenience. Its own tasks T012–T018 are compile-coupled and land together
- **US3 (P2)**: Additive to US1's sweep. Can be worked in parallel with US2 by a second developer, with the caveat below
- **US4 (P2)**: Fully independent of the ritual stories. Can be worked in parallel with any of them by a second developer, coordinating only on `backend/cmd/server.go`

### File Contention (blocks naive parallelism)

- `backend/internal/collaboration/scheduler_workflow.go` — T007, T016, T021, T022
- `backend/cmd/server.go` — T008, T015, T025, T027
- `backend/integration/collaboration_schedule_generation_test.go` — T006, T010, T011, T020

Tasks touching the same file above are **not** marked `[P]` even where their stories are
otherwise independent.

### Parallel Opportunities

- T001 runs in parallel with nothing else needed at that point
- T005 (helper) is `[P]` — it is the only Phase 3 task in `helper_test.go`
- T017 and T018 are in different files from T012–T016, so T017 can start immediately within Phase 4
- T026 and T028 are `[P]` with each other and with all of US2's tasks
- US4 (Phase 6) can run start-to-finish alongside US2 and US3, given the `server.go` coordination noted above

---

## Parallel Example: Two developers after Foundational

```bash
# Developer A — ritual stories, sequential by necessity:
Task: "T005 add runRitualGenerationSweep helper in backend/integration/helper_test.go"
Task: "T006 add TestGlobalRitualScheduler US1 scenarios"
Task: "T007 add RitualGenerationWorkflow in backend/internal/collaboration/scheduler_workflow.go"

# Developer B — US4 in parallel, different domain:
Task: "T024 add calendar reminder schedule + firing scenario in backend/integration/calendar_notification_test.go"
Task: "T026 delete backend/internal/calendar/presence_workflow.go"
Task: "T028 delete PresenceStatusInMeeting in backend/internal/calendar/constants.go"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational — blocks everything
3. Complete Phase 3: US1
4. **STOP and VALIDATE**: `make test-backend-one T=TestGlobalRitualScheduler`, then confirm exactly one `ritual_generation_sweep` row survives a restart

At this point rituals generate from the global sweep. The old per-definition schedules still
exist and still fire redundantly — correct output, unreduced work. Shippable but not the goal.

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. US1 → global sweep generating correctly (MVP)
3. US2 → per-definition machinery deleted; this is where SC-001, SC-002, SC-005, and SC-007 are actually met
4. US3 → per-run reporting and organization-level failure isolation
5. US4 → calendar reminders start firing; dead presence job removed
6. Polish → docs, full suites, quickstart validation

### Deployment Ordering

The migration (T001) deletes `ritual_def_%` rows. Apply it **with or after** the code change,
never before: run against the old code it would silently disable ritual generation until the
new binary is live. The sweep does not depend on those rows being gone in order to be
correct, so a brief overlap where both designs run is safe and idempotent.

---

## Notes

- `GenerateRitualInstances` and `computeDatesInWindow` stay byte-for-byte unchanged apart from T018's dead branch. Any observed date difference in the T034 equivalence check means something below the sweep was modified and should not have been
- The success criterion for this feature is net deletion (SC-007). A task that adds a helper "for symmetry" with something being removed is working against the spec
- Commit after each task or logical group, except T012–T018, which land together because the tree does not compile between them
- No `.proto`, frontend, or mobile file is touched. If a task seems to require one, the plan has been misread
