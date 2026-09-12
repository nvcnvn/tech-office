---
description: "Task list for feature 061 — Green and Enforced Test Gates"
---

# Tasks: Green and Enforced Test Gates

**Input**: Design documents from `/specs/061-green-test-gates/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: No new automated test tasks are generated. Constitution II's scenario-as-contract
requirement is **excluded for this feature under its own escape clause**, documented in
[plan.md](./plan.md) § "Principle II — the scenario-as-contract requirement, and why it is
excluded here": this feature's deliverable *is* the testing apparatus, and its acceptance
evidence is a suite run rather than a new `t.Run`. The verification tasks in each phase (T016-T019,
T034-T037, T039-T041, T048) are that evidence and are not optional.

**Organization**: Tasks are grouped by user story. US2 and US3 have **no dependency on the
Phase 2 baseline** and may be worked in parallel with US1 from the start of the feature.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Exact file paths are given in every task

## Path Conventions

Multi-surface repository. Paths are repo-relative from `/Volumes/T5/Codes/tech-office`:

- Backend Go: `backend/cmd/`, `backend/internal/`
- Web E2E: `frontend/apps/web/e2e/`
- Mobile: `frontend/apps/mobile/.maestro/`
- CI: `.github/workflows/`
- Docs: `docs/domain/`
- Build: root `Makefile`

[ASSUMPTION: The FR-001 baseline is recorded as a tracked artifact at
`specs/061-green-test-gates/baseline.md` rather than left in `/tmp`. FR-001 calls the measurement
a recorded deliverable and FR-002 makes later work depend on it, so it must survive the session
that produced it and be reviewable alongside the drift-row corrections it justifies.]

---

## Phase 1: Setup (Shared Prerequisites)

**Purpose**: Bring up the environment every later phase measures against. No code changes.

- [ ] T001 [P] Bring up the local stack with the repository's supported tooling and confirm it: run `make check-postgres check-backend` from the repository root; if either is down, start Postgres via `backend/docker-compose.yml` and the backend via its documented target rather than improvising a local setup
- [ ] T002 [P] Install frontend workspace dependencies: `cd frontend && pnpm install`, confirming `frontend/pnpm-lock.yaml` is unchanged afterwards
- [ ] T003 [P] Record the mobile static-gate baseline required by FR-027: run `cd frontend && pnpm run typecheck:mobile`, capture exit code and output, and write the result into `specs/061-green-test-gates/baseline.md` under a "Mobile typecheck" heading (expected: exit 0, per research R10)

**Checkpoint**: Postgres, backend and frontend dependencies are up; the mobile gate's green baseline is recorded.

---

## Phase 2: Foundational (Blocking Prerequisite for US1 and for US4's clearing decisions)

**Purpose**: Measure the real failure set before any fix is written, and correct every drift row whose stated cause the measurement contradicts. FR-001 and FR-002 exist because three rows this feature is meant to clear state causes the code does not support (research R4, R7, R8).

**⚠️ CRITICAL**: No US1 fix may be written before T005 completes. US2 (Phase 4) and US3 (Phase 5) do **not** depend on this phase and may start immediately.

- [ ] T004 Capture the web E2E baseline on a clean tree, bypassing the broken `check-frontend` guard: from `frontend/`, run `pnpm --filter web exec playwright test --config=e2e/playwright.config.ts 2>&1 | tee /tmp/e2e-baseline.txt`, then write **file, test title and observed error** for every failure into `specs/061-green-test-gates/baseline.md` under a "Web E2E baseline (pre-fix)" heading (FR-001)
- [ ] T005 Reconcile the T004 baseline against rows D41, D42, D45, D54 and D71 in `docs/domain/README.md` and correct — in the register, now, before any fix is written — every row whose recorded cause the run contradicts: D41's `legal-surface` attribution (research R4), D42's line number (R7), D45's stated time-of-day window (R6), and D41's "fails only under full-suite load" for `ritual-ux-redesign.spec.ts:375` given `workers: 1` (R8) (FR-002)

**Checkpoint**: The real failure set is recorded and the register describes causes the code supports. US1 fixes may now be written against measured causes.

---

## Phase 3: User Story 1 - The web E2E suite passes on a clean tree (Priority: P1) 🎯 MVP

**Goal**: `make test-frontend` exits 0 on a checkout with no working-tree changes, on two consecutive runs without a database reset, and on a machine whose local calendar date differs from UTC's.

**Independent Test**: Check out the branch with no other change, run `make test-frontend` twice in a row and confirm both exit 0; then run it once more under `TZ=Pacific/Kiritimati` (or `TZ=Pacific/Midway`) and confirm it still exits 0.

### Harness fixes (one cause behind several failures — do these first)

- [ ] T006 [US1] Delete the `check-frontend` prerequisite from the five targets that declare it in the root `Makefile` — `test-frontend`, `test-frontend-one`, `test-frontend-headed`, `test-frontend-ui`, `test-frontend-screenshots` — leaving `check-backend` in place; the suite starts its own web server and has not used the port-13000 dev server since the config grew a `webServer` block (FR-003, research R1, clears D71)
- [ ] T007 [US1] Change the `webServer` block in `frontend/apps/web/e2e/playwright.config.ts` from `pnpm exec next dev` to `pnpm exec next build && pnpm exec next start --hostname 127.0.0.1 --port 3100`, raising `webServer.timeout` to accommodate the build; `next start` under `output: "standalone"` warns and proceeds, which research R2 measured (FR-003, addresses D54's mechanism)
- [ ] T008 [US1] Re-run the full suite under the T006/T007 harness and append the result to `specs/061-green-test-gates/baseline.md` under a "Web E2E after harness fix" heading; the delta between this and T004 is the measure of how much of D41 and D54 was a dev-server artifact and it decides whether T014 is needed at all. If `next build` fails, record the build failure verbatim and fall back to the route-warming `globalSetup` of research R2 — **not** to `retries`

### Fixture and assertion fixes (write each against the T004/T008 measured cause)

- [ ] T009 [P] [US1] In `frontend/apps/web/e2e/user-guide-screenshots.spec.ts`, make `registerOwner()`'s `RegisterOrganizationWithAdminPassword` body send `acceptedTermsVersion: TERMS_VERSION`, importing `TERMS_VERSION` from `apis` the way `frontend/apps/web/e2e/helpers/auth.ts` already does rather than hard-coding a date (FR-006, research R3, Constitution VIII)
- [ ] T010 [P] [US1] In `frontend/apps/web/e2e/context-rail.spec.ts`, anchor the calendar-route live-global-blocks fixture to fixed hours of the **browser's local** day instead of `Date.now()` offsets, and derive its due dates from local-calendar arithmetic instead of `new Date(...).toISOString().slice(0, 10)`; where an anchor would already be past relative to the "next up" assertion, anchor to the next whole hour within the local day (FR-004, FR-008, research R5)
- [ ] T011 [P] [US1] In `frontend/apps/web/e2e/helpers/api.ts`, change `setStandardTaskDueToday` to compute the target instant in the **test process's** local timezone and pass it as a bound value, instead of `UPDATE collaboration.task SET due_date = CURRENT_DATE + interval '6 hour'` which reads the Postgres container's UTC clock; the writer must share a clock with the reader (FR-008, research R6, clears D45)
- [ ] T012 [P] [US1] In `frontend/apps/web/e2e/ritual-ux-redesign.spec.ts`, replace the negative route assertion at line 671 — `new RegExp('/workspace/tasks/.+\?view=review')`, whose `\?` collapses to a laziness modifier — with the regex literal `/\/workspace\/tasks\/.+\?view=review/`; leave line 433's genuinely dynamic `new RegExp` with its `projectId` interpolation alone (FR-009, research R7, clears D42)
- [ ] T013 [US1] Fix `frontend/apps/web/e2e/ritual-ux-redesign.spec.ts`'s "Today Review Health Calendar and Worklist are exposed as distinct ritual surfaces" failure (assertion at line 375, `beforeAll` at lines 316-360) against the cause T004/T008 measured — the leading hypothesis is that the `waitForRitualTaskState` poll for `pendingReviewCount > 0` exceeds its budget late in a long serial run, in which case widen or re-target the poll to wait for the state the assertion needs. Do **not** fix it by running the spec in isolation and do **not** add retries (FR-007, research R8)
- [ ] T014 [US1] Only if `frontend/apps/web/e2e/legal-surface.spec.ts` is still red in T008: fix it against the failure T008 recorded, not against D41's superseded terms-version account which research R4 disproved for a signed-out test at line 59 (FR-005)
- [ ] T015 [US1] Audit the working tree for FR-011 compliance: `git diff --stat` must show no change under `frontend/apps/web/src/`, `frontend/apps/mobile/src/` or any backend service package. If a baseline failure turned out to be a genuine product bug, fix it and state the correction explicitly in `specs/061-green-test-gates/baseline.md`, or record it in `docs/domain/README.md` with the spec left failing and say so plainly — never weaken an assertion to turn red green (FR-011, research R19)

### Verification for User Story 1

- [ ] T016 [US1] Run `make test-frontend` from the repository root and confirm it exits 0 with zero failed specs; record the run in `specs/061-green-test-gates/baseline.md` under "Web E2E after fix" (FR-003, SC-001)
- [ ] T017 [US1] Run `make test-frontend && make test-frontend` with nothing in between and no database reset; confirm both exit 0, paying particular attention to `user-guide-screenshots.spec.ts`, the one spec on a fixed workspace address (FR-010, research R9)
- [ ] T018 [US1] Run `TZ=Pacific/Kiritimati make test-frontend` in the afternoon (or `TZ=Pacific/Midway` in the morning) so the local and UTC calendar dates differ at the moment of the run; confirm exit 0 and record which offset was used (FR-008, SC-001, quickstart §1b)
- [ ] T019 [US1] Prove the corrected assertion compiles to the pattern it reads as: `node -e "console.log(/\/workspace\/tasks\/.+\?view=review/.source)"`, and record the before/after patterns in `specs/061-green-test-gates/baseline.md` (FR-009, quickstart §1c)

**Checkpoint**: `make test-frontend` is green on a clean tree, twice in a row, and under a shifted timezone. The number of specs a person must know to ignore is zero (SC-002).

---

## Phase 4: User Story 2 - The Maestro suite can be started from a clean machine (Priority: P1)

**Goal**: One documented command takes a freshly migrated empty database to a Maestro suite that authenticates and runs, with no manual API calls and no hand-pasted ids.

**Independent Test**: On a freshly migrated empty database, run `go run ./cmd seed-maestro-fixture > ../frontend/apps/mobile/.maestro/.env` from `backend/`, then `make test-mobile`, and confirm the suite authenticates and proceeds past its bootstrap into the flows.

**Platform**: Android device or emulator. D37 (Maestro cannot enumerate a physical iPhone) and D18 (iOS AutoFill blocks `onboarding/owner-signup.yaml`, the suite's *second* flow) make an iOS verification stop at flow two for reasons unrelated to this feature.

**No dependency on Phase 2** — may start immediately.

### Register the row before clearing it

- [ ] T020 [US2] Restore the D40 row to the drift-register table in `docs/domain/README.md` verbatim from the text deleted in commit `d4fefd1` (recover it with `git show d4fefd1 -- docs/domain/README.md`); D51 and `docs/domain/workspace-navigation.md` still point at it, and it is cleared honestly in T043 only once the fixture has been observed to work (FR-028, research R18)

### The seeding command — `backend/cmd/seed_maestro.go`

Tasks T021-T030 all edit the same new file and are therefore sequential. Model every step on `backend/cmd/seed_demo.go`; see [contracts/seed-maestro-fixture.md](./contracts/seed-maestro-fixture.md) for the full flag, output and exit-code contract and [data-model.md](./data-model.md) for what the fixture contains and why.

- [ ] T021 [US2] Create `backend/cmd/seed_maestro.go` with `SeedMaestroFixtureCommand` as a `urfave/cli/v3` command carrying the seven flags from the contract (`--subdomain` default `maestro`, `--owner-password`, `--owner-pin`, `--worker-password`, `--worker-pin`, `--signup-password`, `--signup-pin`), connecting through `database.NewAdminPool` with `config.Get()`, rejecting `--subdomain demo` with an error naming FR-019, and fixing a single `seededAt` clock for every date the run derives (FR-012, FR-019, research R12, R16)
- [ ] T022 [US2] In `backend/cmd/seed_maestro.go`, implement the organization create-or-reuse: `GetOrganizationBySubdomain` → reuse on `nil`, `RegisterOrganizationWithAdmin` with `AcceptedTermsVersion: iam.CurrentTermsVersion` only on `pgx.ErrNoRows`, mirroring `backend/cmd/seed_demo.go:137-165` (FR-013, SC-004)
- [ ] T023 [US2] In `backend/cmd/seed_maestro.go`, ensure the primary account — self-registered owner (`is_org_managed = FALSE`, holds `iam.inviteUser`), email `owner@<subdomain>.maestro.invalid`, **both** a password credential and a PIN credential promoted to permanent with `ActivateTemporaryCredential` as `seed_demo.go:231-322` does, and terms accepted at `iam.CurrentTermsVersion`; preserve the invariant that `iam.identity.id`, `organization.employee.id` and `iam."user".id` are the same UUID (data-model §2.1)
- [ ] T024 [US2] In `backend/cmd/seed_maestro.go`, ensure the worker account — `DefaultRoleEmployee`, which `backend/internal/iam/logic_org_accounts.go:354` assigns and which does **not** carry `iam.inviteUser` — with email `worker@<subdomain>.maestro.invalid` plus a password credential (the email+password path is what `auth/signin.yaml` drives, so a PIN-only account cannot serve `feature-tour/worker-tour.yaml`) and login identifier `maestro-worker` with a permanent PIN. If the password login path rejects an org-managed account, hand-build it as a self-registered account on the employee default role the way `ensureDemoSpareOwner` (`seed_demo.go:325-425`) does (FR-014, research R14, data-model §2.2)
- [ ] T025 [US2] In `backend/cmd/seed_maestro.go`, seed the department `Store Floor` and the two directory colleagues: `Mai Tran` **with** a recorded phone number and `Sam Okafor` **without** one, both members of the department. On a re-seed the absent phone must be positively cleared, not merely left unset — the presence/absence distinction is the whole point of `people/directory-call.yaml` (FR-015, data-model §2.3, §2.4, §3)
- [ ] T026 [US2] In `backend/cmd/seed_maestro.go`, seed a `COLLABORATION_MODE_RITUAL` project owned or administered by the primary account (the team block only renders for an owner or administrator), a ritual definition with a **720-hour** completion window copied from `demoRitualCompletionWindowHours` (`seed_demo.go:76-81`, without which the reconciliation sweep writes late instances off as `missed` and empties Today within minutes), and two instances derived from the single `seededAt` clock: one **overdue and assigned to Mai Tran** whose task id becomes `MAESTRO_TEAM_TASK_ID`, one **due today with no assignee** so `screens/today.yaml`'s `Nobody assigned` assertion holds (FR-015, data-model §4.1, §4.2)
- [ ] T027 [US2] In `backend/cmd/seed_maestro.go`, seed the federated-search set — a document titled `Zarquon Closing Procedure`, a work item, a calendar event and a file named `zarquon-closing-procedure.pdf`, all carrying the word `zarquon` so `federated-search.yaml`'s four `search-result-*` kinds all match. [ASSUMPTION: the file result matches on **filename**, not extracted content, because content indexing is feature 059's post-processing and a fixture depending on it would seed a race; if T035's run shows `search-result-file` does not match on name, additionally write the indexed content row and record the dependency in `docs/domain/README.md`] (FR-015, data-model §4.3)
- [ ] T028 [US2] In `backend/cmd/seed_maestro.go`, seed at least one chat channel with messages the primary account can see, for `compliance/report-message.yaml`, `compliance/report-thread-message.yaml` and `screens/chat.yaml`; those flows post what they act on using `MAESTRO_RUN_ID`, so the fixture needs the channel rather than particular messages (FR-015, data-model §4.4)
- [ ] T029 [US2] In `backend/cmd/seed_maestro.go`, implement the re-seed reset that makes the second run land in the same state as the first: refresh both accounts' credentials to the flag values, reactivate any account a flow deactivated, clear blocks between fixture accounts left by `compliance/block-person.yaml` and `block-from-profile.yaml`, restore the notification and dark-mode preferences `settings/*.yaml` toggle, and recreate the two ritual instances relative to `seededAt`. Wrap each account and content group in `txn.WithTxn` so a partial seed cannot exit 0 (FR-013, SC-004, data-model §6)
- [ ] T030 [US2] In `backend/cmd/seed_maestro.go`, emit the output contract: **stdout carries only** the `.env` body — comment header, then the thirteen standing-suite values plus `MAESTRO_WORKER_LOGIN`/`MAESTRO_WORKER_PIN`, unquoted, in the grouping shown in the contract — while **every progress and diagnostic line goes to stderr** so a redirect still shows the operator what happened. `MAESTRO_RUN_ID` is **not** emitted: `onboarding/owner-signup.yaml` derives a new workspace address from it and a pinned value makes the second run collide. Fail rather than emit a value containing a single quote, a newline or a `=` (FR-016, contracts/seed-maestro-fixture.md)
- [ ] T031 [US2] Register `SeedMaestroFixtureCommand` in `backend/cmd/main.go` alongside `SeedDemoOrgCommand` (`cmd/main.go:26`)

### The environment surface

- [ ] T032 [P] [US2] In the root `Makefile`, extend `check-maestro-env` with the required-variable loop that `check-maestro-canonical-env` and `check-maestro-link-preview-env` already use, asserting the **thirteen** standing-suite variables from [contracts/maestro-env.md](./contracts/maestro-env.md) are present **and non-empty** (`grep -q "^VAR=."`, not `"^VAR="`, because the runner silently skips empty values), printing the missing names *and* the producing command `cd backend && go run ./cmd seed-maestro-fixture > ../frontend/apps/mobile/.maestro/.env`; replace the existing "Copy from .env.example and fill in credentials" not-found message with the same instruction, and tighten the two existing checks' `grep` to require a non-empty value in passing (FR-018, research R15)
- [ ] T033 [P] [US2] Rewrite `frontend/apps/mobile/.maestro/.env.example` to name every variable any flow in the repository reads, grouped under headings that say which flows read each group and whether the standing suite needs it — the thirteen seeded values, the worker override pair for `feature-tour/worker-tour.yaml`, the per-run `MAESTRO_RUN_ID`/`MAESTRO_DEV_CLIENT_URL`, and the nineteen `MAESTRO_CANONICAL_*`/`MAESTRO_NAV_*`/`MAESTRO_LINK_PREVIEW_*` values marked as belonging to individually-run flows — stating at the top that the standing-suite values come from `go run ./cmd seed-maestro-fixture` and how to redirect it, and carrying no real credential (FR-017, contracts/maestro-env.md)

### Verification for User Story 2

- [ ] T034 [US2] Against a freshly migrated empty database (`cd backend && ./scripts/migrate.sh`), run `go run ./cmd seed-maestro-fixture > ../frontend/apps/mobile/.maestro/.env` and confirm stdout is a complete `.env` body and nothing else; then verify idempotency — run it twice into `/tmp/seed-1.env` and `/tmp/seed-2.env`, `diff` them (only the timestamp comment and `MAESTRO_TEAM_TASK_ID` may differ), and confirm `SELECT count(*) FROM public.organization WHERE subdomain = 'maestro'` returns 1 (FR-012, FR-013, SC-003, SC-004, quickstart §2a-2b)
- [ ] T035 [US2] Verify non-collision and fail-fast: re-run `go run ./cmd seed-demo-org` then the fixture seeder and confirm the fixture is unaffected; confirm `--subdomain demo` fails naming FR-019; then remove `MAESTRO_TEAM_TASK_ID` from `.maestro/.env` and confirm `make test-mobile` exits non-zero **before launching a flow**, naming the variable and the seeding command — and repeat with the key present but empty (FR-018, FR-019, quickstart §2c, §2e)
- [ ] T036 [US2] Run `make test-mobile 2>&1 | tee /tmp/maestro-run.txt` against the seeded fixture on Android and confirm `auth/signin-known-device.yaml` authenticates and the runner proceeds past its bootstrap into the flows (FR-020, quickstart §2d)
- [ ] T037 [US2] Record all 27 flow results from T036 (`grep -E '^\[(pass|fail)\]' /tmp/maestro-run.txt`) into `specs/061-green-test-gates/baseline.md` under a "Maestro standing suite" heading, and write **a drift row with its observed failure** into `docs/domain/README.md` for every flow that fails for a reason outside this feature's scope — not silence, and not a prematurely cleared D40 (FR-021, research R17)
- [ ] T038 [US2] Confirm both feature-tour account shapes exist and their credentials are emitted: run `make test-mobile-one F=feature-tour/owner-tour` as seeded, and `make test-mobile-one F=feature-tour/worker-tour` with `MAESTRO_ENV_FLAGS` overriding `MAESTRO_TEST_EMAIL`/`MAESTRO_TEST_PASSWORD` with the emitted worker pair. Neither tour is in the standing suite, so their pass/fail is recorded under T037's rule rather than gating this feature (FR-014, quickstart §2g)

**Checkpoint**: An empty database reaches an authenticating Maestro suite in one documented command (SC-003), and a second seed leaves exactly one fixture workspace (SC-004).

---

## Phase 5: User Story 3 - The mobile static gate runs without being asked (Priority: P1)

**Goal**: A pull request introducing a mobile type error is failed by CI before a reviewer looks at the diff.

**Independent Test**: Push a branch containing a deliberate mobile type error, confirm the CI run fails and names the file, line and error; revert it and confirm the run passes.

**No dependency on Phase 2 or Phase 4** — may start immediately, and is the cheapest of the three gates.

- [ ] T039 [US3] Create `.github/workflows/checks.yml` with job `typecheck-mobile` per [contracts/ci-typecheck-mobile.md](./contracts/ci-typecheck-mobile.md): triggers `pull_request` on `[main]` and `push` on `[main]`, `permissions: contents: read`, concurrency cancelling superseded runs on the same ref, `runs-on: ubuntu-latest`, steps `actions/checkout` → `pnpm/action-setup` (no `version` input — `frontend/package.json`'s `packageManager` field resolves it) → `actions/setup-node` with `node-version: 22`, `cache: pnpm`, `cache-dependency-path: frontend/pnpm-lock.yaml` → `pnpm install --frozen-lockfile` in `frontend/` → `pnpm run typecheck:mobile` in `frontend/`. **No `paths`/`paths-ignore` filter** — a required check skipped by a path filter reports pending, not passing, and blocks the merge it was meant to wave through (FR-022, FR-025, FR-026)
- [ ] T040 [US3] Push the branch and confirm the `typecheck-mobile` job passes on the tree as it stands, with no source change needed to make it pass — the workflow is merged against the green baseline T003 recorded, not against red (FR-024, FR-027)
- [ ] T041 [US3] Verify the failing direction: push a commit introducing a deliberate type error in a `frontend/apps/mobile/src/**` file (e.g. `const n: number = 'not a number'`), confirm the run **fails** and its log contains `path(LINE,COL): error TSxxxx: …`, then revert the commit and confirm the run passes again. Both directions are required — a gate verified only in the passing direction is not verified (FR-023, US3 Independent Test, quickstart §3b-3c)
- [ ] T042 [US3] Confirm the job's wall-clock time on a change that touches no TypeScript (a backend-only or deploy-only commit) is comfortably under five minutes from push, and record the measured duration in `specs/061-green-test-gates/baseline.md` (SC-005, US3 Acceptance Scenario 4)

**Checkpoint**: The cheapest gate is enforced by automation and verified in both directions.

---

## Phase 6: User Story 4 - The drift register describes the repository that exists (Priority: P2)

**Goal**: Every `D<number>` reference in `docs/domain/` resolves, every cleared row has an observed passing run behind it, and every surviving row says plainly that it remains open and why.

**Independent Test**: Run the §4a reference check from [quickstart.md](./quickstart.md) and confirm it prints nothing.

**Depends on**: US1 (T016-T019), US2 (T034-T038) and US3 (T040-T041). A row is cleared only against a run that was *observed* to pass — clearing on the strength of a plan is exactly the failure this feature exists to end.

- [ ] T043 [US4] In `docs/domain/README.md`, remove the rows whose commands have now been observed to pass: **D34** (T040/T041 ran the CI job), **D41** (T016 exited 0), **D42** (T019 shows the corrected pattern and T016 is green), **D45** (T018 passed under a shifted `TZ`), **D54** (its four named specs passed in T016's full run — or, if any survived, narrow the row to what remains with its measured failure), **D71** (T016 started without the guard aborting it) (FR-028, quickstart §4b)
- [ ] T044 [US4] In `docs/domain/README.md`, remove the **D40** row restored in T020, now that T034-T036 have been observed: the fixture is reproducible from one command (FR-028, quickstart §4b)
- [ ] T045 [US4] In `docs/domain/README.md`, restate **D18**, **D37**, **D47**, **D51**, **D67** and **D77** so each says plainly that it remains open and why — D77 most carefully, because it records that `auth/signin.yaml` intermittently loses the text it types into `subdomain-input` on the iOS simulator, which makes the mobile suite's pass/fail unreliable rather than merely failing, and is what still stands between a startable suite and a trustworthy one. None may be quietly softened to look cleared (FR-031, research R17)
- [ ] T046 [US4] Add **D57** to the register's "Fixed on …" list in `docs/domain/README.md` for the date feature 055 closed it; its row was correctly removed when fixed but never listed, so `docs/domain/workspace-navigation.md:750`'s past-tense reference dangles (FR-029, research R18)
- [ ] T047 [US4] Fix the D47/D51 mislabelling a grep cannot catch: `docs/domain/workspace-navigation.md:723` heads its prose section "D47 — three older mobile flows still wait on a screen title that no longer exists" while the register calls that problem **D51** and gives D47 to the deep-link cold start. Correct whichever of the two is wrong so a reader following either reference lands on the right problem (FR-029, research R17)
- [ ] T048 [US4] Rewrite `docs/domain/platform.md`'s Testing and Known-drift sections (currently lines 391-429) to describe the restored state: which commands constitute the gates, which of them CI enforces, and how the Maestro fixture is created. Three current statements are falsified by this work and must go — that `make test-frontend` runs "two static assertion checks" (it runs **three**: contrast, theme resolution and SSO availability), that both frontend targets gate on `check-frontend`, and that `make test-frontend` "is not reliably green on a clean tree" (FR-030)
- [ ] T049 [US4] Run the quickstart §4a reference check from the repository root — build `/tmp/rows.txt` from open rows, `/tmp/fixed.txt` from the "Fixed on" paragraphs, `/tmp/refs.txt` from every `D<number>` in `docs/domain/`, and confirm `comm -23 /tmp/refs.txt /tmp/resolvable.txt` prints **nothing** (FR-029, SC-006)

**Checkpoint**: Every drift reference resolves, and no row was cleared without a run behind it.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: The project's standing regression gates, run because this feature touches the Makefile, a backend command and the CI surface.

- [ ] T050 [P] Run `gofmt -l backend/` (expect no output), `go vet ./...` and `go build ./...` from `backend/` to confirm the new command compiles clean
- [ ] T051 [P] Run `make lint-tenancy` from the repository root — expected green, since no `*.query.sql` is added and no new SQL surface is introduced
- [ ] T052 Run `make test-backend`. If it fails on D52's latency assertion or D70's search-threshold leak, that is the pre-existing load-dependence those rows describe: re-run the named test in isolation, record the result in `specs/061-green-test-gates/baseline.md`, and leave both rows open — neither is in scope and neither may be cleared here
- [ ] T053 Run `make test-frontend` one final time on the completed change set and confirm exit 0; **if any gate in T050-T053 is red, say so with its output** — a feature about making suites able to fail honestly cannot be completed on a caveat (SC-007)
- [ ] T054 Complete `specs/061-green-test-gates/baseline.md` as the feature's evidence record: the pre-fix baseline, the post-harness delta, the post-fix runs (including the `TZ` offset used), the 27 Maestro flow results, the CI run in both directions and its duration, and every correction made under FR-002 and FR-011

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately.
- **Phase 2 (Foundational)**: Depends on Phase 1. **Blocks US1 only.** FR-002 forbids writing a fix against a cause the measurement does not support, which is why T004/T005 gate every US1 edit.
- **Phase 3 (US1)**: Depends on Phase 2.
- **Phase 4 (US2)**: Depends on Phase 1 only. Independent of US1 and US3.
- **Phase 5 (US3)**: Depends on Phase 1 only. Independent of US1 and US2, and needs no database, backend, device or browser.
- **Phase 6 (US4)**: Depends on the *verification* tasks of US1, US2 and US3 — T016-T019, T034-T038, T040-T041 — because a row is cleared only against an observed pass.
- **Phase 7 (Polish)**: Depends on all of the above.

### User Story Dependencies

- **US1 (P1)**: Needs the Phase 2 baseline. No dependency on US2, US3 or US4.
- **US2 (P1)**: Fully independent. Its one register edit (T020) is deliberately made *before* its implementation so the register's history is honest.
- **US3 (P1)**: Fully independent and by far the cheapest; it can be delivered and merged on its own.
- **US4 (P2)**: Depends on all three gates having been *run*, not merely written.

### Within User Story 1

T006 and T007 are harness changes and must precede T008, whose re-run decides how much of the remaining work exists. T009-T012 are independent files and parallelisable. T013 and T014 must be written against T008's measured output, so they follow it. T015-T019 are verification and come last.

### Within User Story 2

T020 first (restore before clear). T021-T030 all edit `backend/cmd/seed_maestro.go` and are strictly sequential. T031 follows T021. T032 and T033 touch different files and are parallelisable with the seeder work. T034-T038 are verification and require the seeder and the env check to be complete.

### Parallel Opportunities

- **Across stories**: US2 and US3 can both start while US1 waits on its baseline. With three people: one measures and fixes the web suite, one writes the seeder, one writes the workflow.
- **Phase 1**: T001, T002, T003 all parallel.
- **US1**: T009, T010, T011, T012 — four different files, no shared state.
- **US2**: T032 (Makefile) and T033 (`.env.example`) run alongside T021-T031.
- **Phase 7**: T050 and T051 parallel.

---

## Parallel Example: User Story 1 fixture fixes

```bash
# After T008 has measured what the harness fix left red, launch the four
# independent file edits together:
Task: "T009 acceptedTermsVersion in frontend/apps/web/e2e/user-guide-screenshots.spec.ts"
Task: "T010 local-clock fixture in frontend/apps/web/e2e/context-rail.spec.ts"
Task: "T011 setStandardTaskDueToday clock in frontend/apps/web/e2e/helpers/api.ts"
Task: "T012 regex literal in frontend/apps/web/e2e/ritual-ux-redesign.spec.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 Setup → Phase 2 Foundational (the baseline is the deliverable, not a warm-up)
2. Phase 3 US1
3. **STOP and VALIDATE**: `make test-frontend` exits 0 twice consecutively and under a shifted `TZ`
4. That alone ends the "pre-existing failure" caveat on every feature that follows (SC-007)

### Incremental Delivery

US3 is the smallest independently shippable increment in the feature — one file, no
infrastructure, verifiable in both directions in a single push cycle. If the feature has to be
cut short, ship US3 and US1; US2's seeder is the largest piece and US4 is bookkeeping that
depends on the other three having been run.

1. Setup + Foundational → the real failure set is known
2. US1 → the web gate can say no (MVP)
3. US3 → the static gate is enforced
4. US2 → the mobile gate can be started
5. US4 → the register describes the repository that exists

### Parallel Team Strategy

1. Everyone: Phase 1
2. Developer A: Phase 2 → US1 (the longest path — measurement, then five fixes, then three verification runs)
3. Developer B: US2 (the seeder is the largest single piece of new code)
4. Developer C: US3, then help with US2's verification (it needs a device)
5. Whoever finishes first: US4, once the other two have observed their runs

---

## Notes

- `[P]` tasks touch different files and share no state.
- **No row in `docs/domain/README.md` is cleared without an observed passing run behind it.** That rule is the feature, not an afterthought — see quickstart §4b for the row-by-row table.
- **No spec is made to pass by weakening what it asserts** (FR-011). Where an assertion is genuinely wrong about the product, the correction is stated explicitly in the change.
- All Maestro verification runs on **Android**; D37 and D18 make iOS unusable for this purpose and both remain open.
- Commit after each task or logical group. The `after_tasks` and `after_implement` hooks handle the register and `docs/domain/` snapshot updates that Constitution XII requires.
