# Implementation Plan: A demo workspace a reviewer can finish

**Branch**: `055-seed-demo-workspace` | **Date**: 2026-09-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/055-seed-demo-workspace/spec.md`

## Summary

The demo workspace handed to a store reviewer cannot demonstrate account deletion — the only
self-registered credential is the sole owner of a populated workspace, and the sole-owner
guard correctly refuses it — and reads empty on two of the four mobile tabs, because the seed
writes no tasks and no ritual instances.

Both are fixed inside `backend/cmd/seed_demo.go` and
`docs/compliance/reviewer-notes.md`. No product behaviour changes: no RPC, no proto, no
migration, no change to the deletion guard.

The seed additionally writes:

1. **A second self-registered owner**, created by mirroring steps 2–6 of
   `RegisterOrganizationWithAdmin` against the existing organization. Two owners means
   neither is sole, so the guard accepts either deletion, and the notes nominate the spare.
2. **Six ordinary work items** in the existing default `General` project, across its
   `todo` and `in_progress` states, with every credential holding at least one, at least one
   late and at least one due today.
3. **A ritual-mode project `Site operations`**, created through
   `CollaborationLogic.CreateProject`, holding one `Open-up checks` definition with two
   instances — one `overdue` and assigned to the worker, one scheduled for today with nobody
   holding it.

The two decisions that carry the design are a 720-hour `completion_window_hours`, which keeps
the late instance `overdue` instead of letting the 5-minute reconciliation sweep write it to
the closed `missed` state, and a monthly recurrence with a one-day generation window, which
leaves the definition live while producing no further instances for a month.

## Technical Context

**Language/Version**: Go 1.24 (backend); TypeScript / Expo SDK 54 (mobile, read-only here)

**Primary Dependencies**: `urfave/cli/v3` (the command), `jackc/pgx/v5`, `sqlc`-generated
`backend/database`, the existing `organization`, `iam` and `collaboration` logic packages

**Storage**: PostgreSQL. **No migration.** Every row the seed writes goes into a table that
exists today; `backend/database/scripts/schema.sql` is untouched.

**Testing**: `go test ./integration/...` — `demo_seed_test.go` extended, plus a new
`demo_seed_deletion_test.go` on the `testWorld` pattern. No Playwright and no Maestro; see
[contracts/test-scenarios.md](contracts/test-scenarios.md) for the justified exclusion.

**Target Platform**: the seeded workspace is consumed on iOS and Android (Expo) and on web;
the command itself runs on a developer machine or a deploy host against `DATABASE_URL`.

**Project Type**: developer CLI fixture plus a compliance document. Backend-only change set.

**Performance Goals**: the command completes in under a minute (SC-006), unchanged. It writes
on the order of thirty rows.

**Constraints**: idempotent — a second run refreshes rather than appends (FR-019); every date
relative to the run (FR-020); the three background ritual sweeps must leave the seeded shape
alone (FR-015, FR-017).

**Scale/Scope**: one organization, three accounts, two projects, eight tasks, one ritual
definition. Two files changed, one test file added.

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1. Both passes below.*

| Principle | Verdict | Note |
|---|---|---|
| I — Data governance & multi-tenancy | **PASS** | Every statement the seed issues is scoped by `organization_id`. It runs on `AdminPool` because it has no tenant context yet, which is the established pattern for this command and for the deletion survey. No cross-tenant query is added. |
| II — Scenario-first integration & E2E testing | **PASS** | Scenario stubs for every User Story and every user-observable FR are in [contracts/test-scenarios.md](contracts/test-scenarios.md), with the Playwright and Maestro exclusions written down and justified there as the principle requires. |
| III — Two-layer service architecture & proto-level authz | **N/A** | No RPC is added or changed. The command is a CLI entry point, not a service. |
| IV — Cross-domain integration | **PASS** | The seed touches `iam`, `organization`, `collaboration` and `chat`, but through each domain's own logic package or through explicit `organization_id`-scoped SQL — never a cross-schema join. |
| V — Observability, simplicity & YAGNI | **PASS** | One new flag, one new helper per new kind of row, no abstraction over them. `CollaborationLogic.CreateProject` is reused rather than re-implemented, which removes about forty lines of state and level inserts the fixture would otherwise own. |
| VI — Versioning & breaking changes | **PASS** | The stdout format changes and `docs/compliance/reviewer-notes.md` is rewritten. Both are developer- and reviewer-facing, released together with the change. |
| VII — Frontend API wrapper pattern | **N/A** | No frontend change. |
| VIII — Cross-stack constant & type synchronisation | **PASS** | No constant crosses the stack. The seed reads `iam.CurrentTermsVersion` and the `collaboration` state-category constants from their existing single definitions rather than restating the strings. |
| IX — UUID v7 & nullable cursor pagination | **PASS** | Ids come from `dbuuid.Must()` or the columns' `uuidv7()` defaults. No pagination. |
| X — Structured error details | **N/A** | CLI errors, not Connect errors. They are required to be specific and loud (FR-018) rather than structured. |
| XI — Distributed-first & horizontal scalability | **PASS** | The command is a one-shot process. It introduces no shared state, and deliberately does not fight the three global ritual sweeps — it configures the definition so they agree with the fixture (research R5, R6). |
| XII — Living documentation | **PASS with obligation** | No RPC, schema or job cadence changes, so no domain document is contradicted by this feature. `docs/domain/rituals-tasks.md` and `docs/domain/compliance-safety.md` were read first. If implementation discovers behaviour that differs from those snapshots, the difference is recorded in the drift register in `docs/domain/README.md` in the same change set. |
| XIII — Mobile design & testing (Expo + Maestro) | **PASS** | No mobile UI is added or changed, so the Maestro rule is not engaged. The feature is validated on the phone by the manual pass in [quickstart.md](quickstart.md), on Android as well as iOS. |

**Post-Phase-1 re-check**: unchanged. The Phase 1 design added no service, no dependency and
no abstraction. The one thing it added beyond the spec's assumptions — a second project — is
forced by Principle I-adjacent data shape rather than chosen: a ritual instance's lateness is
a `project_state` row, and a `standard` project has no state in the `overdue` category
(research R4).

**Complexity Tracking**: not required — no violations.

## Project Structure

### Documentation (this feature)

```text
specs/055-seed-demo-workspace/
├── plan.md                          # This file
├── spec.md                          # Input
├── research.md                      # Phase 0 — R1..R12
├── data-model.md                    # Phase 1 — every row the seed writes
├── quickstart.md                    # Phase 1 — runnable validation
├── contracts/
│   ├── seed-demo-org-cli.md         # Phase 1 — flags, exit codes, stdout, idempotency
│   └── test-scenarios.md            # Phase 1 — the Principle II behavioural contract
└── tasks.md                         # Phase 2 — NOT created by /speckit-plan
```

### Source code

```text
backend/
├── cmd/
│   └── seed_demo.go                 # CHANGED — the whole of the implementation
└── integration/
    ├── demo_seed_test.go            # CHANGED — scenarios for FR-001, 003, 009..021
    └── demo_seed_deletion_test.go   # NEW — scenarios for FR-004..007

docs/
└── compliance/
    └── reviewer-notes.md            # CHANGED — three credentials, one nominated
```

**Structure Decision**: this is a backend-only change to an existing developer command plus
one compliance document. No new package, no new directory. `seed_demo.go` grows from 344
lines to roughly 700; it stays one file because everything in it is one command's fixture and
splitting it would scatter a linear script across imports.

Untouched and explicitly out of scope: `backend/internal/iam/logic_account_deletion.go` and
every other production path. The sole-owner guard is correct and stays exactly as it is.

## Phase 0 — Research

Complete. See [research.md](research.md): R1 the refusal and what clears it; R2 creating a
second self-registered owner without a second organization; R3 what a deletion leaves behind
and how a re-run restores it; R4 which project the work goes into and why a second one is
required; R5 keeping the late instance late against the reconciliation sweep; R6 stopping the
generation sweep without archiving the definition; R7 what fills the Team block; R8 what
fills Running late and Due today; R9 refreshing rather than appending; R10 failing loudly on
a missing workflow state; R11 where to use the logic layer and where to write rows; R12 what
stays exactly as it is.

Four `[ASSUMPTION:` markers are recorded across research.md and data-model.md, covering the
tombstone-plus-fresh-row restore, the second project, the spare owner's name and address, the
seeded evidence requirement, and the scope of the refresh delete.

## Phase 1 — Design & Contracts

Complete.

- [data-model.md](data-model.md) — the spare owner's five rows and the id invariant, the
  membership matrix, the six work items with their states, assignees and due dates, the
  `Site operations` project, the ritual definition's window settings, the two instances, the
  refresh order, and the reviewer-notes and stdout changes.
- [contracts/seed-demo-org-cli.md](contracts/seed-demo-org-cli.md) — flags including the new
  `--spare-password`, exit codes, the errors that must be loud rather than tolerated, the
  stdout block order, and the exact idempotency counts.
- [contracts/test-scenarios.md](contracts/test-scenarios.md) — the `t.Run` behavioural
  contract, with the Playwright and Maestro exclusions justified in writing.
- [quickstart.md](quickstart.md) — seed, re-seed, wait out the sweeps, perform the deletion,
  check all four tabs on both platforms, and the FR-018 failure injection.

## Risks

| Risk | Mitigation |
|---|---|
| A reviewer deletes the primary credential instead of the spare. | Both are owners, so either deletion is accepted and the workspace survives with one owner and all content. The notes mark the spare unmistakably, but nothing depends on the reviewer reading carefully. |
| The reviewer's device date differs from the server's, so the unheld instance falls outside the Team block's `scheduled_date = as_of_date` equality. | The late instance has no date bound and keeps the block populated regardless. Re-seeding close to submission narrows the window. Accepted in the spec. |
| `completion_window_hours = 720` reads oddly on the definition screen. | It is a demo fixture, and the alternative — a `NULL` completion deadline — produces an overdue instance the product could not otherwise create. Documented in research R5. |
| The monthly recurrence's `day_of_month` lands on 29–31 and skips short months. | Clamped to 28 at seed time. |
| `make check-store-manifest` regresses on the reviewer-notes rewrite. | It is run in the quickstart and must exit `0`; the edit adds a credential and an instruction, never a capability claim outside `### Not requested`. |
| The refresh delete removes work a reviewer created. | Intended. "Refresh the demo workspace" is what the command means, and the existing message seed already behaves this way. Recorded as an assumption in research R9. |
