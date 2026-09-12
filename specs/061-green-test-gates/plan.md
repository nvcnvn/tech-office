# Implementation Plan: Green and Enforced Test Gates

**Branch**: `061-green-test-gates` | **Date**: 2026-09-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/061-green-test-gates/spec.md`

## Summary

Restore the three suites Constitution II and XIII name as the correctness gate to a state where
they can honestly fail, and put the cheapest of them somewhere a person cannot forget to run it.

Four strands, in dependency order:

1. **Measure first.** Run the web E2E suite on a clean tree and record every failure — file,
   test title, observed error — before writing a single fix. Three of the drift rows this
   feature is meant to clear state causes that the code contradicts (research R4, R7, R8), and
   fixing against a stale description is how the register got this way.
2. **Make `make test-frontend` green.** Two root causes cover most of it: a `check-frontend`
   guard that probes a server the suite does not use and aborts the target before Playwright
   runs (D71), and a `next dev` harness whose on-demand compilation hands cold-route navigations
   a 404 placeholder (D54, and probably D41's `legal-surface` and `user-guide-screenshots`
   entries). Both are fixed by harness changes, not by touching specs. What remains is three
   genuine fixture bugs: an omitted `acceptedTermsVersion`, two wall-clock-dependent fixtures,
   and a regex whose escape was eaten by its string literal.
3. **Make `make test-mobile` startable.** A new `seed-maestro-fixture` backend command, built on
   the proven `seed-demo-org` pattern, creates the workspace, accounts and content the 27-flow
   standing suite signs into, and prints every `MAESTRO_*` value to stdout in `.env` form. The
   Makefile's existing env-check pattern is extended to name a missing value before the first
   flow launches.
4. **Enforce the mobile static gate.** The repository's first quality-check workflow runs
   `pnpm run typecheck:mobile` on every pull request. The gate already passes (verified: exit 0,
   170 of 175 mobile sources checked), so it is wired in against a green baseline.

The drift register is then corrected and reduced to rows that are true.

## Technical Context

**Language/Version**: Go 1.x (backend seeding command), TypeScript 5.x (Playwright specs,
Maestro fixtures, mobile typecheck), YAML (GitHub Actions, Maestro flows), GNU Make

**Primary Dependencies**: `urfave/cli/v3` and `pgx/v5` (seed command, matching
`backend/cmd/seed_demo.go`); Playwright 1.58 and Next.js 15.5.2 (web E2E harness); Maestro 2.3.0;
pnpm 10.15.1 workspaces; GitHub Actions (`actions/checkout`, `pnpm/action-setup`,
`actions/setup-node`)

**Storage**: PostgreSQL — the seeding command writes through `database.NewAdminPool` against
`DATABASE_URL`, the same path `seed-demo-org` uses. No schema change, no migration.

**Testing**: This feature *is* the testing surface. Verification is the suites themselves:
`make test-frontend` exits 0 twice consecutively and under a shifted `TZ`;
`make test-mobile` authenticates and runs its flows from a freshly seeded fixture;
`pnpm run typecheck:mobile` passes in CI and fails a deliberately broken branch.

**Target Platform**: developer macOS/Linux workstations (E2E and Maestro), `ubuntu-latest`
GitHub-hosted runner (CI), Android device or iOS simulator (Maestro — D37 stands)

**Project Type**: Multi-surface repository — Go backend, Next.js web app, Expo mobile app.
This feature touches test harnesses, one backend CLI command, CI configuration and documentation.

**Performance Goals**: SC-005 — a mobile type error is failed by CI in under five minutes from
push. Measured budget: ~3 s of `tsc` plus a pnpm install warmed by `actions/setup-node`'s cache.
The web E2E suite gains a one-time `next build` (~1–3 min) in exchange for determinism.

**Constraints**: No product behaviour change (FR-011 — see research R19). No new infrastructure:
CI needs no database, backend, device or browser (FR-025). The fixture must not claim the `demo`
workspace address (FR-019) and must be idempotent (FR-013). No spec is made to pass by weakening
what it asserts.

**Scale/Scope**: 27 Maestro flows in the standing suite reading 13 `MAESTRO_*` values; ~30
Playwright spec files of which 4 files are edited; 1 new Go CLI command; 1 new CI workflow;
5 Makefile targets amended; ~14 drift rows corrected, cleared, restored or restated.

No `NEEDS CLARIFICATION` markers remain. Every ambiguity the spec left open is resolved in
[research.md](./research.md), each recorded as an `[ASSUMPTION: …]` at the point of decision.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applies? | Status |
|---|---|---|
| **I. Data Governance & Multi-Tenancy** | Yes — the seeding command writes tenant rows | **PASS.** No schema change and no migration: the command writes through existing logic (`RegisterOrganizationWithAdmin`, `CreateOrgAccount`) and through direct SQL that mirrors `seed_demo.go`'s, every statement carrying `organization_id`. It runs on `AdminPool`, which is the documented and correct pool for a system seeding operation — the same justification `seed-demo-org` already carries. No `*.query.sql` is added, so `make lint-tenancy` is unaffected; it is still run as a gate. |
| **II. Scenario-First Integration & E2E Testing** | Special case — see below | **PASS with a documented exclusion.** |
| **III. Two-Layer Service Architecture** | No | No RPC service is added or changed. The seeder is a CLI command calling existing logic-layer functions, exactly as `seed_demo.go` does. |
| **IV. Cross-Domain Integration** | No | The seeder calls `iam`, `organization` and `collaboration` logic through their public entry points. No cross-schema SQL join is introduced. |
| **V. Observability, Simplicity & YAGNI** | Yes | **PASS.** The largest simplification in this plan is a deletion (`check-frontend` from five targets). The CI workflow is one job. The seeder covers the standing suite only, not all 42 flows — the spec's own scoping. Shared helpers are *not* extracted from `seed_demo.go` (research R12): two callers with different content is not yet a shared abstraction. |
| **VI. Versioning & Breaking Changes** | Yes, mildly | **PASS.** `.env.example` gains variables and the Makefile's env check gains required names, so an existing `.env` will now fail fast rather than fail obscurely. That is the intent of FR-018. Per the project's standing position, no compatibility path is kept for an old `.env`; the seeder produces a correct one in one command. |
| **VII. Frontend API Wrapper Pattern & Type Safety** | No | No frontend source file is touched. `user-guide-screenshots.spec.ts` imports `TERMS_VERSION` from `apis`, which is the pattern this principle prescribes. |
| **VIII. Cross-Stack Constant Synchronization** | Yes | **PASS, and strengthened.** The `acceptedTermsVersion` fix imports `TERMS_VERSION` from `apis` rather than hard-coding `'2026-08-27'`, so the fixture cannot drift from `iam.CurrentTermsVersion` the way it just did. The seeder uses `iam.CurrentTermsVersion` directly. |
| **IX. UUID v7 & Nullable Cursor Parameters** | No | No new table, no new pagination. |
| **X. Structured Error Details** | No | No RPC error surface is added. The seeder's failures are operator-facing CLI errors. |
| **XI. Distributed-First Architecture** | No | A seeding command is a single-shot operator tool. |
| **XII. Living Documentation** | Yes | **PASS.** `docs/domain/platform.md`'s Testing and Known-drift sections and the register in `docs/domain/README.md` are updated in this change set (FR-028 to FR-031), which is what the principle requires. `backend/docs/` needs no change: no architecture moves. |
| **XIII. Mobile Design & Testing — Expo + Maestro** | Yes, centrally | **PASS.** This feature makes the principle's mandated suite runnable again. No mobile UI is added, so the feature-scope carve-out and the `testID` rules are not engaged. D37 and D18 still stand and are restated rather than quietly ignored. |

### Principle II — the scenario-as-contract requirement, and why it is excluded here

Constitution II requires every User Story and user-observable FR to be covered by a backend
integration `t.Run` scenario, approved during planning as the behavioural contract.

**That requirement is excluded for this feature, with justification**, as II's own escape clause
permits ("If a User Story or FR is intentionally excluded from testing scope, that exclusion MUST
be documented with justification in the plan"):

- The feature's four User Stories are about *the test suites themselves*. US1 is "the web E2E
  suite passes", US2 is "the Maestro suite can be started", US3 is "CI runs the mobile
  typecheck", US4 is "the drift register is accurate". A Go integration test asserting that
  Playwright exits 0 would be a test of a test, and would need a browser, a Next build and a
  device inside `backend/integration/` — which is the opposite of what II is for.
- The acceptance evidence for every one of those stories is a **suite run**, and the spec already
  specifies it as such: each story's Independent Test is a command and an exit code. Those runs
  are the contract, and they are enumerated as verification tasks in
  [quickstart.md](./quickstart.md).
- The one piece of genuinely new product-side code — the `seed-maestro-fixture` command — is a
  developer tool, not a user-facing surface. It has no RPC, no authorization decision and no
  tenant-facing behaviour. Its correctness criterion is "the 27 flows authenticate and run",
  which is exactly what FR-020 and FR-021 already require and what T-series verification tasks
  measure. A `backend/integration/` scenario asserting that the seeder creates rows would assert
  less than running the suite does.

The exclusion is narrow: it covers this feature only, because this feature's deliverable *is* the
testing apparatus. `make test-backend` is still run as a regression gate before completion.

### Post-Design Re-check

Re-evaluated after Phase 1. No gate moved. The design adds no schema, no RPC, no proto field and
no new dependency: the seeder reuses `urfave/cli/v3` and `pgx/v5` already in
`backend/cmd/seed_demo.go`, and the CI workflow uses only first-party GitHub Actions. The
Complexity Tracking table below is empty because there is nothing to justify.

## Project Structure

### Documentation (this feature)

```text
specs/061-green-test-gates/
├── plan.md              # This file
├── research.md          # Phase 0 — 19 findings, every unknown resolved
├── data-model.md        # Phase 1 — the Maestro fixture's entities and emitted values
├── quickstart.md        # Phase 1 — how each gate is run and what proves it restored
├── contracts/
│   ├── seed-maestro-fixture.md   # CLI contract: flags, stdout/stderr, idempotency
│   ├── maestro-env.md            # The MAESTRO_* variable contract and its fail-fast check
│   └── ci-typecheck-mobile.md    # Workflow triggers, job contract, failure output
├── checklists/
│   └── requirements.md  # Pre-existing, from /speckit-specify
└── tasks.md             # Phase 2 — NOT created by /speckit-plan
```

### Source Code (repository root)

```text
.github/workflows/
└── checks.yml                         # NEW — job: typecheck-mobile (FR-022 … FR-026)

Makefile                               # test-frontend* lose check-frontend (FR-003, clears D71)
                                       # check-maestro-env asserts the 13 standing vars (FR-018)

backend/
├── cmd/
│   ├── main.go                        # register SeedMaestroFixtureCommand
│   └── seed_maestro.go                # NEW — the fixture seeder (FR-012 … FR-016, FR-019)
└── integration/                       # unchanged (see Principle II exclusion above)

frontend/
├── apps/web/e2e/
│   ├── playwright.config.ts           # webServer: next build && next start (FR-003, R2)
│   ├── context-rail.spec.ts           # local-clock fixture dates (FR-004, FR-008)
│   ├── legal-surface.spec.ts          # re-diagnosed; edited only if R2 does not clear it (FR-005)
│   ├── user-guide-screenshots.spec.ts # registerOwner sends acceptedTermsVersion (FR-006)
│   ├── ritual-ux-redesign.spec.ts     # regex literal for the negative route match (FR-009)
│   └── helpers/api.ts                 # setStandardTaskDueToday uses the test process's clock (FR-008)
└── apps/mobile/
    ├── .maestro/.env.example          # every standing-suite variable, and how to produce it (FR-017)
    └── .maestro/.env                  # gitignored — regenerated by the seeder, not committed

docs/domain/
├── README.md                          # drift register: D40 restored then cleared; D34, D41,
│                                      # D42, D45, D54, D71 cleared; D57 listed as fixed;
│                                      # D18/D37/D47/D51/D67/D77 restated as still open
├── platform.md                        # Testing + Known drift rewritten (FR-030)
└── workspace-navigation.md            # D47/D51 mislabelling fixed (FR-029)
```

**Structure Decision**: No new project or package. The work lands in the repository's existing
surfaces — one new file in `backend/cmd/` beside the seeder it is modelled on, one new file in
`.github/workflows/`, and edits to the Playwright harness, the Makefile and the domain docs. The
mobile `.env` is a generated artifact and stays gitignored; only its example is tracked.

## Implementation Phases

Ordered by dependency. Phase 1 gates everything in Phase 2 because FR-001 and FR-002 require the
baseline before the fix.

### Phase A — Baseline (FR-001, FR-002)

Run `pnpm --filter web exec playwright test --config=e2e/playwright.config.ts` from `frontend/`
against a live backend — bypassing the broken `check-frontend` guard, which is the only way to
get a baseline at all today. Record every failure: file, test title, observed error. Reconcile
against D41, D42, D45 and D54; correct any row whose stated cause the run contradicts, *before*
writing its fix. Confirm `pnpm run typecheck:mobile` (already measured green — research R10).

### Phase B — The web E2E harness (FR-003, clears D71 and D54's mechanism)

Delete `check-frontend` from the five `test-frontend*` targets. Switch the Playwright `webServer`
to a production build. Re-run the baseline; the difference between A and B is the measure of how
much of D41 and D54 was harness artifact. If `next build` fails, fall back to route warming per
research R2 and record why.

### Phase C — The remaining spec fixes (FR-004 … FR-011)

In whatever the Phase B run still shows red: the `acceptedTermsVersion` omission (R3), the
two wall-clock fixtures (R5, R6), the eaten regex escape (R7), and the Phase-A-measured cause of
`ritual-ux-redesign.spec.ts:375` (R8). Then the acceptance runs: twice consecutively without a
database reset, and once under a `TZ` whose calendar date differs from UTC's.

### Phase D — The Maestro fixture (FR-012 … FR-021, clears D40)

Restore D40 to the register first, from the text recovered at `d4fefd1`. Write
`backend/cmd/seed_maestro.go`; extend `check-maestro-env`; rewrite `.env.example`. Seed a fresh
database, run `make test-mobile`, record every flow's result, and write the failures that are
not this feature's to fix into the register with their observed error.

### Phase E — CI (FR-022 … FR-027)

Add `.github/workflows/checks.yml`. Verify both directions: a branch with a deliberate mobile
type error fails and names the file, line and error; the same branch reverted passes.

### Phase F — Documentation (FR-028 … FR-031)

Clear the rows whose commands have been *observed* to pass — not one row earlier. Restate
D18, D37, D47, D51, D67 and D77 to say they remain open and why — D77 (the shared sign-in
bootstrap losing typed text on the iOS simulator) is added to that list by this plan, because it
is what still limits what a restored mobile suite proves. Add D57 to a "Fixed on" list so the
past-tense reference to it in `workspace-navigation.md` resolves. Fix the D47/D51 mislabelling between
the register and `workspace-navigation.md`. Rewrite `platform.md`'s Testing section to say which
commands are the gates, which of them CI enforces, and how the Maestro fixture is created. Then
grep every `D<number>` in `docs/domain/` and confirm each resolves (FR-029, SC-006).

## Complexity Tracking

> Fill ONLY if Constitution Check has violations that must be justified.

No violations. The Principle II scenario exclusion is documented in the Constitution Check above
under its own escape clause, and is a scoping decision rather than a complexity cost.
