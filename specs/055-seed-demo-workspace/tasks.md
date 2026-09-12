---

description: "Task list for 055 — A demo workspace a reviewer can finish"
---

# Tasks: A demo workspace a reviewer can finish

**Input**: Design documents from `/specs/055-seed-demo-workspace/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: **Included.** Constitution Principle II (Scenario-as-Contract) makes the `t.Run`
list in [contracts/test-scenarios.md](contracts/test-scenarios.md) a binding contract for this
feature, and the plan names the two test files it lands in. Playwright and Maestro are
excluded, with the justification written down in that same contract.

**Organization**: Tasks are grouped by user story so each can be implemented and verified
independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 (deletion demonstration), US2 (non-empty phone), US3 (re-run survives)

## Path Conventions

Backend-only change set. Two production files change, one test file is added:

- `backend/cmd/seed_demo.go` — the whole of the implementation
- `backend/integration/demo_seed_test.go` — extended
- `backend/integration/demo_seed_deletion_test.go` — new
- `docs/compliance/reviewer-notes.md` — rewritten credential section

**No migration.** `backend/database/scripts/schema.sql` is untouched, and no `.proto` changes,
so there is no client regeneration step anywhere in this list.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Get a database the seed can be run against and record the behaviour that exists
today, so every later assertion is measured against a known baseline.

- [ ] T001 Bring up the local stack with `make dev-up` and `make migrate` from the repo root, per [quickstart.md](quickstart.md) — Postgres, Redis and MinIO from `backend/docker-compose.yml`
- [ ] T002 Establish the baseline: run `cd backend && go test ./integration/... -run TestDemoSeed -v` and record that it passes today, so a later failure is attributable to this change set
- [ ] T003 [P] Run `cd backend && go run ./cmd seed-demo-org --subdomain demo` once against the local database and capture the current stdout block order, which the FR-021 assertion in T018 extends rather than replaces

**Checkpoint**: the command runs locally, the existing suite is green, and the current output is on record.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The plumbing every story writes through — one clock, one state lookup that fails
loudly, one membership helper, and the refresh that makes any repeated write safe.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete. In particular the
refresh (T008, T009) must exist before US2 writes any content, or the second run of the seed
doubles it.

- [ ] T004 Add `--spare-password` flag to `SeedDemoOrgCommand` in `backend/cmd/seed_demo.go`, defaulting to the value of `--owner-password` when unset, per [contracts/seed-demo-org-cli.md](contracts/seed-demo-org-cli.md)
- [ ] T005 Extend `demoSeedResult` in `backend/cmd/seed_demo.go` with `SpareEmail` and `SparePassword`, and add the `demoSpareGivenName = "Ben"` / `demoSpareFamilyName = "Keeler"` / `demoOpsProjectKey = "OPS"` constants beside the existing `demo*` block
- [ ] T006 Thread a single `seededAt time.Time` captured once at the top of `seedDemoOrg` through every helper in `backend/cmd/seed_demo.go`, so all seeded dates derive from one instant relative to the run (FR-020) rather than from repeated `time.Now()` calls that could straddle midnight
- [ ] T007 [P] Add `requireProjectState(ctx, pool, orgID, projectID dbuuid.UUID, projectKey, category, stateType string) (dbuuid.UUID, error)` to `backend/cmd/seed_demo.go`, looking up `collaboration.project_state` by `(organization_id, project_id, category, state_type)` and returning `fmt.Errorf("demo project %s has no %s state in category %q; reseed the project", ...)` on no rows (FR-018, research R10) — never by name or position, because `project_state` is unique on `(organization_id, project_id, position)` only
- [ ] T008 [P] Add `ensureProjectMembership(ctx, pool, orgID, projectID, employeeID dbuuid.UUID, role string) error` to `backend/cmd/seed_demo.go`, inserting into `collaboration.project_membership` with `ON CONFLICT (organization_id, project_id, employee_id) DO UPDATE SET role = EXCLUDED.role` and incrementing `collaboration.project.member_count` only when a row is actually added
- [ ] T009 Add `refreshDemoProjects(ctx, pool, orgID dbuuid.UUID, projectIDs []dbuuid.UUID) error` to `backend/cmd/seed_demo.go`: hard-`DELETE FROM collaboration.task WHERE organization_id = $1 AND project_id = ANY($2)` (children cascade — research R9), then reset `next_task_number = 1, task_count = 0` on those projects. Called before any task is written, tolerant of a project that does not exist yet

**Checkpoint**: the command compiles, still seeds the workspace it seeds today, and now owns one clock, a loud state lookup, a membership helper and a refresh.

---

## Phase 3: User Story 1 - A reviewer deletes an account and sees it work (Priority: P1) 🎯 MVP

**Goal**: The demo workspace holds two self-registered owners, so the sole-owner guard accepts
either deletion, and the reviewer notes nominate exactly one of them as the disposable account.

**Independent Test**: Seed a fresh workspace, request deletion as the spare owner through
`DeleteMyAccount`, and confirm it is accepted rather than refused with a sole-owner
precondition. Then sign in with the primary credential and confirm the workspace is intact.

**Delivers**: FR-001 – FR-008, FR-021, SC-001, SC-002, SC-007.

### Tests for User Story 1 ⚠️

> Write these first and confirm they fail before implementing T014–T019.

- [ ] T010 [P] [US1] Create `backend/integration/demo_seed_deletion_test.go` on the `testWorld` pattern with `TestDemoSeedAccountDeletion`, seeding the demo workspace by invoking the command and obtaining a Connect client for the spare owner — structure per [contracts/test-scenarios.md](contracts/test-scenarios.md)
- [ ] T011 [US1] In `backend/integration/demo_seed_deletion_test.go`, add `t.Run("when the nominated spare owner requests deletion of their own account")` with the three nested cases: the request is accepted rather than refused as sole owner (FR-004), the deletion preview names no blocking workspace (FR-004), and their sessions are invalidated
- [ ] T012 [US1] In `backend/integration/demo_seed_deletion_test.go`, add `t.Run("after the spare owner has been deleted")` with four nested cases: the primary owner credential still signs in, the worker PIN still signs in, the workspace still has at least one owner, and the conversation, work items and instances are all still there (FR-005) — plus `t.Run("when the admin-provisioned worker asks to end their account")` asserting the removal-request path is offered unchanged (FR-007), `t.Run("when the seed runs again after the deletion")` asserting the spare credential signs in once more and the deletion repeats (FR-006), and `t.Run("when the second owner then tries to delete too")` asserting the sole-owner guard still refuses (spec edge case 2)
- [ ] T013 [P] [US1] In `backend/integration/demo_seed_test.go`, extend the existing `t.Run("when the seed runs for the first time")` with: it creates two owner accounts (FR-001), both owner accounts are self-registered rather than admin-provisioned (FR-003, asserting `iam.user.is_org_managed = FALSE` for both), the admin-provisioned worker is still the only org-managed account, and it prints three credentials primary-first with the spare marked for deletion (FR-021)

### Implementation for User Story 1

- [ ] T014 [US1] Add `ensureDemoSpareOwner(ctx, pool, queries, orgID, seededAt, spareEmail, sparePassword) (dbuuid.UUID, error)` to `backend/cmd/seed_demo.go`, looking up `organization.employee WHERE organization_id = $1 AND email = $2 AND is_active = TRUE` first and refreshing only the password hash and owner role when found (FR-006, research R3) — an anonymised tombstone from a prior deletion is deliberately left in place
- [ ] T015 [US1] In the not-found branch of `ensureDemoSpareOwner` in `backend/cmd/seed_demo.go`, create the five rows of §1 of [data-model.md](data-model.md) inside one `txn.WithTxn`, mirroring steps 2–6 of `RegisterOrganizationWithAdmin` (research R2): `iam.identity`, `organization.employee`, `iam.user` with `is_org_managed` left at its `FALSE` default, terms acceptance at `iam.CurrentTermsVersion`, and `iam.password_credential` via `iam.HashPassword` — one fresh UUID used for all three of `iam.identity.id`, `organization.employee.id` and `iam.user.id`, which is the invariant the JWT `sub` claim depends on
- [ ] T016 [US1] In `ensureDemoSpareOwner` in `backend/cmd/seed_demo.go`, assign the organization's role with `source_default_role_id = 'owner'` to the spare employee, idempotently, erroring as `find demo owner role: …` / `create spare demo owner: …` per the CLI contract (FR-001)
- [ ] T017 [US1] Call `ensureDemoSpareOwner` from `seedDemoOrg` in `backend/cmd/seed_demo.go` between the worker step and the content step, and carry the spare's id and credentials into `demoSeedResult`
- [ ] T018 [US1] Rewrite `printDemoCredentials` in `backend/cmd/seed_demo.go` to emit three blocks in the order PRIMARY → `SPARE credential — this is the one to delete.` → SECOND, with the spare block carrying the one-line reason from the stdout contract and exactly one block containing the phrase `the one to delete` (FR-021)
- [ ] T019 [US1] Rewrite the credential section of `docs/compliance/reviewer-notes.md`: keep `### 1. Self-registered owner (use this one)` as primary and repoint its deletion paragraph at credential 2, insert `### 2. Spare owner — delete this one` with email, password and a plain statement that deleting it leaves the workspace and the primary credential usable, renumber the worker to `### 3` unchanged in substance, and update `### Account deletion` to name credential 2 explicitly and say the reviewer only needs to do it once (FR-002, FR-007, FR-008) — leaving `### Permissions` and `### Not requested` untouched

**Checkpoint**: a reviewer can complete the deletion end to end. This is the MVP — it is the only thing a 5.1.1(v) rejection turns on.

---

## Phase 4: User Story 2 - A reviewer opens the phone and sees a workspace in use (Priority: P2)

**Goal**: My Work and Today are populated for every credential, and an owner's Team block shows
a recurring job the team is late on and one nobody is holding.

**Independent Test**: Seed a workspace, sign in on mobile as each credential in turn, and
confirm neither My Work nor Today shows an empty state.

**Delivers**: FR-009 – FR-018, SC-003, SC-004.

### Tests for User Story 2 ⚠️

- [ ] T020 [P] [US2] In `backend/integration/demo_seed_test.go`, add to `t.Run("when the seed runs for the first time")`: it creates six work items across two open workflow states (FR-009), every sign-in credential has at least one work item assigned to it (FR-010), and at least one assigned item is past its due date and at least one is due today (FR-011)
- [ ] T021 [P] [US2] In `backend/integration/demo_seed_test.go`, add to the same block: it creates one recurring job with exactly two instances (FR-013), the late instance is in an `overdue` state and is assigned to the worker (FR-014), the unassigned instance is scheduled for today and has no `task_assignee` row (FR-013), and the unassigned instance is in a state that is neither `overdue` nor closed (FR-016)
- [ ] T022 [P] [US2] In `backend/integration/demo_seed_test.go`, add `t.Run("when a demo project is missing a workflow state the seed needs")` asserting the command fails naming the project and the missing category (FR-018), by deleting the `Overdue` state from the seeded `OPS` project inside the test and re-running the command
- [ ] T023 [P] [US2] In `backend/integration/demo_seed_test.go`, assert the observable outcome the mobile screens read, using the same predicates they use: `GetAssignedWorkSummary` returns at least one overdue and at least one due-today item for each of the three credentials (SC-003, SC-004), and `GetTeamAttentionSummary` returns at least one row for each owner (SC-004) — this is the assertion that stands in for the excluded Maestro coverage

### Implementation for User Story 2 — work items

- [ ] T024 [US2] In `backend/cmd/seed_demo.go`, resolve the existing default `General` / `GEN` project for the organization and its `depth = 0` task level, and grant `admin` membership to the spare owner and `member` membership to the worker via `ensureProjectMembership` (research R8 — `General` is private, so a credential with no membership never sees the work in My Work's per-project fan-out)
- [ ] T025 [US2] In `backend/cmd/seed_demo.go`, resolve the two `GEN` states through `requireProjectState`: `category = 'todo'` and `category = 'in_progress'`, both `state_type = 'standard'` (FR-009, FR-018)
- [ ] T026 [US2] Add `seedDemoWorkItems(ctx, pool, orgID, genProjectID, levelID, ownerID, spareID, workerID dbuuid.UUID, todoStateID, inProgressStateID dbuuid.UUID, seededAt time.Time) error` to `backend/cmd/seed_demo.go`, writing the six `collaboration.task` rows of §3 of [data-model.md](data-model.md) with `task_kind = 'standard'`, `identifier` `GEN-1`…`GEN-6`, `depth = 0`, `path = '{}'`, `reporter_employee_id` = primary owner, and the exact title / state / assignee / `due_date` distribution given there (FR-009 – FR-012)
- [ ] T027 [US2] In `seedDemoWorkItems` in `backend/cmd/seed_demo.go`, write one `collaboration.task_assignee` row per item with `role = 'assignee'` and `assigned_by_employee_id` = primary owner, then set `collaboration.project.task_count = 6` and `next_task_number = 7` on `GEN` (FR-010, research R9)

### Implementation for User Story 2 — the recurring job

- [ ] T028 [US2] In `backend/cmd/seed_demo.go`, create the `Site operations` / `OPS` ritual project through `CollaborationLogic.CreateProject` with `collaboration_mode = 'ritual'`, `visibility = 'private'` and the primary owner as creator, looked up by `(organization_id, key = 'OPS')` first and created only when absent (research R4, R11) — this is what brings the eight ritual states including `Overdue / overdue` into existence
- [ ] T029 [US2] In `backend/cmd/seed_demo.go`, grant `admin` membership on `OPS` to the spare owner and `member` to the worker via `ensureProjectMembership`; both owners must hold `owner`/`admin` or their Today Team block is empty, since the supervisory scope is exactly those two roles (FR-014, research R7)
- [ ] T030 [US2] Add `seedDemoRitualDefinition(...)` to `backend/cmd/seed_demo.go` writing the `collaboration.ritual_definition` row of §5 of [data-model.md](data-model.md): `completion_window_hours = 720`, `generation_window_days = 1`, `last_generated_date = CURRENT_DATE`, `is_archived = FALSE`, and a `monthly` recurrence with `day_of_month = min(seededAt.Day(), 28)` — looked up by `(organization_id, project_id, name)` and updated in place so its id is stable across runs (FR-013, FR-015, FR-017, research R5, R6)
- [ ] T031 [US2] In `seedDemoRitualDefinition` in `backend/cmd/seed_demo.go`, write the single `collaboration.evidence_requirement` row: `evidence_types = {photo}`, `is_required`, `position = 0`, `approval_mode = 'manual'`, `deadline_offset_hours = 0`, deleted and rewritten on each run alongside the task refresh
- [ ] T032 [US2] Add `seedDemoRitualInstances(...)` to `backend/cmd/seed_demo.go` writing the late instance `OPS-1` of §6a: `scheduled_date` / `start_date` / `due_date` = `seededAt - 2d`, `completion_deadline = seededAt - 48h`, `state_id` from `requireProjectState(..., "overdue", "ritual")`, and one `task_assignee` for the **worker** — never an owner, because the Team block excludes instances assigned to the caller (FR-014, FR-015)
- [ ] T033 [US2] In `seedDemoRitualInstances` in `backend/cmd/seed_demo.go`, write the unheld instance `OPS-2` of §6b: `scheduled_date` / `start_date` / `due_date` = `seededAt` (equality is what the unassigned leg matches), `completion_deadline = seededAt + 690h`, `state_id` from `requireProjectState(..., "todo", "ritual")`, and **no** `task_assignee` row at all; then set `OPS.task_count = 2` and `next_task_number = 3` (FR-013, FR-016)

**Checkpoint**: all four mobile tabs are populated for every credential. US1 and US2 both work independently.

---

## Phase 5: User Story 3 - The seeded workspace survives a re-run and the passage of time (Priority: P3)

**Goal**: A second run refreshes rather than appends, every date moves forward with the run,
and the three background ritual sweeps leave the seeded shape alone.

**Independent Test**: Run the seed twice against the same workspace address and compare row
counts and dates between the runs; leave the backend up for six minutes and re-check.

**Delivers**: FR-019 – FR-021, SC-005, SC-006.

### Tests for User Story 3 ⚠️

- [ ] T034 [P] [US3] In `backend/integration/demo_seed_test.go`, extend the existing `t.Run("when the seed runs again")` with: it leaves exactly one copy of each work item and each instance (FR-019), it leaves exactly two owner accounts rather than a third (FR-001, FR-006), the unassigned instance is dated for the current day (FR-020), and the late instance is still dated so that it reads as late (FR-020)
- [ ] T035 [P] [US3] In `backend/integration/demo_seed_test.go`, add `t.Run("when the background sweeps run against the seeded workspace")` with: the late instance is still `overdue` rather than written off as `missed` (FR-015), and the generation sweep creates no further instances (FR-017) — driving the reconciliation and generation logic directly rather than waiting on the scheduler

### Implementation for User Story 3

- [ ] T036 [US3] Wire `refreshDemoProjects` (T009) into `seedDemoOrg` in `backend/cmd/seed_demo.go` so it runs against both `GEN` and `OPS` before any task or evidence requirement is written on every run, and confirm the counter resets leave `identifier` generation starting from 1 (FR-019, research R9)
- [ ] T037 [US3] Audit every date written by `backend/cmd/seed_demo.go` and confirm each derives from the `seededAt` instant of T006 rather than from `now()` in SQL or a hardcoded date, so a re-run before a resubmission produces content that reads as current (FR-020)
- [ ] T038 [US3] Verify the idempotency counts of [contracts/seed-demo-org-cli.md](contracts/seed-demo-org-cli.md) hold by running the command twice against a local database — 1 organization, 3 active employees, 2 owners, 6 messages, 2 projects, 6 standard tasks, 2 ritual instances, 1 ritual definition — and that the second run prints `Reusing existing demo workspace` (SC-005)
- [ ] T039 [US3] Run quickstart step 3 for real: leave the backend up six minutes with the seeded workspace present and confirm the late instance is still `overdue | f` and the instance count is still `2`, which is the only end-to-end proof that the 720-hour window and the monthly recurrence actually hold against the live 5-minute and 1-minute sweeps (FR-015, FR-017)

**Checkpoint**: all three user stories are independently functional and the seed is safe to run the morning of a resubmission.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T040 Run `cd backend && go test ./integration/...` — the whole suite must pass, not just `TestDemoSeed`
- [ ] T041 [P] Run `make check-store-manifest` and confirm it exits `0` after the `docs/compliance/reviewer-notes.md` rewrite; the edit adds a credential and an instruction and must not introduce a capability claim outside `### Not requested` (research R12)
- [ ] T042 [P] Perform the FR-018 failure injection from [quickstart.md](quickstart.md) on a scratch edit that is never committed: delete the `Overdue` state from the demo `OPS` project, re-run the seed, and confirm it exits non-zero naming the project and the missing category
- [ ] T043 Perform the manual mobile pass of [quickstart.md](quickstart.md) step 5 on **both** an Android emulator and an iOS simulator, signing in as each of the three credentials and confirming zero of the four tabs shows a whole-screen empty state (SC-003, SC-004) — Android is not optional here, since the habitual test device is an iPhone SE and a narrow-Android regression would otherwise go unnoticed
- [ ] T044 Perform the manual deletion pass of [quickstart.md](quickstart.md) step 4 on a device: delete the spare account, confirm you are signed out and cannot sign in again, then confirm the primary credential still signs in to an intact workspace (SC-001, SC-002)
- [ ] T045 [P] Read `docs/domain/rituals-tasks.md` and `docs/domain/compliance-safety.md` against what was actually implemented. No RPC, schema or job cadence changed, so no domain document should need an edit — but if implementation discovered behaviour that differs from those snapshots, record the difference in the drift register in `docs/domain/README.md` in this change set (Constitution XII, and the obligation the plan's Constitution Check accepted)
- [ ] T046 [P] Review `docs/compliance/reviewer-notes.md` as a reader who has never seen this codebase: three credentials in one place, primary first, exactly one unmistakably named as the account to delete (FR-002, FR-008) — this is a human judgement no automated check can make, which is why it is a task rather than an assertion
- [ ] T047 Re-read `backend/cmd/seed_demo.go` end to end as one linear script and delete any helper that is now called once and reads worse than its body inline; the file is expected to land near 700 lines and stays one file on purpose (Constitution V)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately
- **Foundational (Phase 2)**: depends on Setup — **BLOCKS all user stories**
- **US1 (Phase 3)**: depends on Foundational. No dependency on US2 or US3
- **US2 (Phase 4)**: depends on Foundational, and on T017 for the spare owner id it assigns work to
- **US3 (Phase 5)**: depends on Foundational; its verification tasks depend on US2 having written content to verify
- **Polish (Phase 6)**: depends on all three stories

### Critical path

T006 (one clock) → T009 (refresh) → T014–T017 (spare owner) → T024–T033 (content) → T036 (wire the refresh) → T039 (sweep proof)

### Within each user story

- Tests are written first and must fail before the implementation tasks in the same phase
- Helpers before callers; `requireProjectState` before any task write
- `CreateProject` for `OPS` (T028) before any ritual state lookup, since the states do not exist until the project does
- The refresh (T036) before content in run order, even though it is authored last

### Parallel Opportunities

- T007 and T008 are independent helpers in the same file — parallel only if edited as separate functions with no shared region
- T010 lands a new file; T013, T020, T021, T022 all extend `demo_seed_test.go` and must be serialised against each other
- US1's documentation task (T019) is fully independent of all backend work and can run alongside any of it
- T041, T042, T045, T046 in Polish are mutually independent

**Note on `[P]` in this feature**: almost all implementation lands in one file,
`backend/cmd/seed_demo.go`, so implementation tasks are largely *not* parallelisable. The `[P]`
markers are honest about that rather than optimistic.

---

## Parallel Example: User Story 1

```bash
# The new test file and the documentation rewrite touch nothing else:
Task: "T010 Create backend/integration/demo_seed_deletion_test.go with TestDemoSeedAccountDeletion"
Task: "T019 Rewrite the credential section of docs/compliance/reviewer-notes.md"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup
2. Phase 2 Foundational
3. Phase 3 US1
4. **STOP and VALIDATE**: perform the deletion on a device (T044). At this point the feature's
   whole reason for existing is satisfied — a 5.1.1(v) check can be completed. Everything after
   this is presentation.

### Incremental Delivery

1. Setup + Foundational → the seed owns one clock, a loud state lookup and a refresh
2. US1 → the deletion demonstration works → shippable
3. US2 → the phone is not empty → shippable
4. US3 → the seed is safe to re-run the morning of a resubmission → shippable

### Notes

- Commit after each task or logical group
- The sole-owner guard in `backend/internal/iam/logic_account_deletion.go` is **correct** and is
  not touched by any task in this list. If a task seems to require changing it, the task is wrong
- Nothing this feature adds may be a tolerated failure: the existing calendar-entry `note:
  skipped …` stays tolerated, but a half-shaped workspace reaching a reviewer is the exact
  failure this feature exists to prevent
