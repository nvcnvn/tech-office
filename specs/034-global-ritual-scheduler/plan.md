# Implementation Plan: Global Ritual Scheduler

**Branch**: `034-global-ritual-scheduler` | **Date**: 2026-08-22 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/034-global-ritual-scheduler/spec.md`

## Summary

Replace one recurring `flows` schedule per ritual definition with a single platform-wide
sweep that runs once per minute.

The change is possible without touching generation semantics because the per-definition
timer never influenced *what* was generated. `RitualSchedulerWorkflow.Run` calls
`Logic.GenerateRitualInstances(ctx, adminPool, orgID, now)`, which lists **every** active
definition in the organization and re-derives target dates from each definition's own
recurrence rule, timezone, `last_generated_date`, and `generation_window_days`. The
`DefinitionID` on the workflow input is only written to a log line. An organization with N
active rituals therefore runs N identical whole-org passes per cycle.

Technical approach: keep `GenerateRitualInstances` **byte-for-byte unchanged** and wrap it
in a cross-org loop driven by one new query that returns the distinct organizations holding
at least one unarchived ritual definition. Delete the recurrence→cron translation, the
per-definition schedule ID, the scheduler dependency threaded through the Connect handlers,
and the four scheduling blocks in the ritual CRUD handlers. Preserve immediate generation on
create by calling `GenerateRitualInstances` directly in the creation transaction, replacing
the `flows.WithRunNow()` that went away with the schedule.

Reusing the generation function unmodified is what makes FR-005 (identical output) true by
construction rather than by test-and-hope.

## Technical Context

**Language/Version**: Go 1.24 (backend), per `backend/go.mod`
**Primary Dependencies**: `github.com/nvcnvn/flows` v0.0.8 (durable workflow + schedule
engine), Connect RPC, `pgx/v5`, `sqlc`-generated queries
**Storage**: PostgreSQL with Citus. Relevant tables: `collaboration.ritual_definition`
(distributed on `organization_id`, colocated with `public.organization`),
`collaboration.task` (ritual instances), `flows.schedules` (schedule registry)
**Testing**: Go integration tests in `backend/integration/` using the `testWorld` pattern
**Target Platform**: Linux server, minimum 3 stateless instances behind a load balancer
**Project Type**: Backend-only change to an existing multi-tenant web service
**Performance Goals**: One regeneration pass per organization per sweep cycle, down from one
per definition. Sweep cadence fixed at 1 minute (FR-007)
**Constraints**: Generated instance dates must be identical to today's output for every
supported recurrence pattern and timezone (FR-005). Sweep must be safe to run concurrently
with itself and across instances (idempotent per definition + date)
**Scale/Scope**: Backend only. No proto changes, no frontend changes, no mobile changes. Net
code deletion

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design — see
[Post-Design Re-Check](#constitution-re-check-post-design).*

| Principle | Verdict | Notes |
|---|---|---|
| **I. Data Governance & Multi-Tenancy** | PASS with documented justification | The sweep is a system operation and uses `AdminPool`, matching the precedent set by `CalendarReminderWorkflow` / `ListPendingRemindersGlobal`. One new query (`ListOrganizationIDsWithActiveRitualDefinitions`) intentionally does **not** filter by `organization_id` — it exists to *discover* organizations. Justification recorded in [research.md](./research.md#decision-5) and as a SQL comment. Every query it feeds (`GenerateRitualInstances` and everything below it) remains org-filtered and unchanged. No schema change to any tenant table |
| **II. Scenario-First Integration & E2E Testing** | PASS | Backend integration scenarios in `backend/integration/collaboration_schedule_generation_test.go`, composed as stubs and approved before implementation. E2E exclusion documented below with justification |
| **III. Two-Layer Service Architecture** | PASS | Change removes orchestration from the Connect layer and leaves it in logic/workflow. Net movement is toward the mandated separation, not away |
| **IV. Cross-Domain Integration** | PASS | No new cross-domain calls. No cross-schema joins introduced |
| **V. Observability, Simplicity & YAGNI** | PASS | This feature *is* the YAGNI correction. Per-run `slog` reporting of orgs / definitions / instances satisfies FR-014. One documented `ponytail:` ceiling on the cross-shard org scan |
| **VI. Versioning & Breaking Changes** | PASS | Breaking to internal scheduling only; the RPC contract is untouched. Forward-only migration removes orphaned schedule rows. Rollback = compensating forward migration |
| **VII. Frontend API Wrapper Pattern** | N/A | No frontend change |
| **VIII. Cross-Stack Constant Sync** | PASS | Two dead recurrence-type constants are deleted. Both are unreachable from the proto enum (`recurrenceTypeToString` cannot emit them) and appear in no `.proto`, `.ts`, or `.tsx` file — verified. Nothing to re-sync |
| **IX. UUID v7 & Nullable Cursor Params** | N/A | No pagination change |
| **X. Structured Error Details** | PASS | No new user-facing errors. Sweep failures are logged, not returned to a client |
| **XI. Distributed-First & Horizontal Scalability** | PASS | The bootstrap upserts by `schedule_id`, so all instances converge on one row. `flows` leases runs, so only one instance executes a given cycle. No process-local state. Cross-shard scan justified below |
| **XII. Architecture Documentation** | PASS | `backend/docs/` scheduling notes updated in the tasks phase |
| **XIII. Mobile Design & Testing** | N/A | No mobile change |

### Testing Scope Exclusions (Principle II, documented per requirement)

- **Web E2E (Playwright)**: excluded. This feature changes no UI-visible behavior — the
  explicit success criterion (SC-004) is that ritual owners observe *no* difference. There
  is no new screen, control, or state for a browser test to assert. The existing
  `ritual-ux-redesign.spec.ts` and `ritual-submission-flow.spec.ts` suites must continue to
  pass unchanged, which is the regression guard that matters here.
- **Maestro (mobile)**: excluded, same reason — no mobile surface is touched.
- Both suites still run in full as regression guards per the Definition of Done.

### Pre-Existing Defect Found During Research (OUT OF SCOPE — flagged, not fixed)

`CalendarReminderWorkflow` and `CalendarPresenceWorkflow` are registered with
`flows.Register` in `backend/cmd/server.go:473` and `:481`, but their
`CalendarReminderScheduleID()` / `ReminderSchedule()` / `CalendarPresenceScheduleID()` /
`PresenceSchedule()` helpers are **never called anywhere in the repository**. Nothing writes
their `flows.schedules` rows, so neither job is scheduled and neither has ever run in
production. Calendar event reminders are therefore not firing.

This is a separate defect in a different domain and is deliberately **not** fixed here. It
is called out because it directly shapes FR-015: the obvious move — "copy the calendar
global-job pattern" — reproduces the bug. This plan's bootstrap step exists specifically to
avoid that. Recommend a follow-up spec for the calendar jobs.

## Project Structure

### Documentation (this feature)

```text
specs/034-global-ritual-scheduler/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── README.md        # Internal job contract; RPC surface explicitly unchanged
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
backend/
├── cmd/
│   └── server.go                                  # MODIFY: swap registration; add schedule bootstrap
├── database/
│   ├── scripts/
│   │   └── collaboration.query.sql                # MODIFY: add org-discovery query
│   └── collaboration.query.sql.go                 # REGENERATE via sqlc
├── internal/collaboration/
│   ├── scheduler_workflow.go                      # REWRITE: global sweep; delete cron translation
│   ├── scheduler_logic.go                         # MODIFY: drop dead short-interval branch
│   ├── constants.go                               # MODIFY: delete 2 dead recurrence constants
│   ├── connect.go                                 # MODIFY: drop RitualScheduler field + ctor param
│   └── ritual_connect.go                          # MODIFY: delete 4 scheduling blocks + dead helper
├── integration/
│   ├── collaboration_schedule_generation_test.go  # MODIFY: replace per-definition schedule assertions
│   └── helper_test.go                             # MODIFY: add global-sweep helper
└── k8s/base/database/migrations/
    └── 20260822000002_drop_per_definition_ritual_schedules.up.sql   # NEW
```

**Structure Decision**: Backend-only change within the existing
`backend/internal/collaboration` domain package. No new package is introduced — the global
sweep replaces the contents of the existing `scheduler_workflow.go` rather than adding a
file beside it, so the change is a net deletion in the same location a reader already looks
for ritual scheduling. Frontend and mobile trees are untouched.

## Phase 0: Research

Complete. See [research.md](./research.md). All Technical Context items resolved; no
`NEEDS CLARIFICATION` markers remain.

Decisions carried into design:

1. Wrap `GenerateRitualInstances` in a cross-org loop; do not modify it.
2. Discover organizations via `SELECT DISTINCT organization_id FROM
   collaboration.ritual_definition WHERE is_archived = FALSE`.
3. Bootstrap the single schedule at startup with `flows.ScheduleTx`, which upserts by
   `schedule_id` and is therefore safe across restarts and concurrent instances.
4. Preserve immediate-on-create generation by calling `GenerateRitualInstances` directly in
   the creation transaction.
5. Delete `every_minute` / `every_two_minutes` — verified unreachable from the API.
6. Remove orphaned `ritual_def_%` schedule rows with a forward migration.

## Phase 1: Design & Contracts

Complete. Artifacts:

- [data-model.md](./data-model.md) — entities, the one new query, the fields that become the
  sole input to generation, and what is deleted.
- [contracts/README.md](./contracts/README.md) — the internal job contract, plus an explicit
  statement that the Connect RPC surface and proto definitions do not change.
- [quickstart.md](./quickstart.md) — runnable validation: equivalence check across the
  recurrence matrix, schedule-row count assertion, and lifecycle no-write assertion.

### Behavioral Contract (Principle II — requires approval before `/speckit-tasks`)

Scenario stubs to be composed in
`backend/integration/collaboration_schedule_generation_test.go`. These constitute the
behavioral contract and must be reviewed before tasks are created.

```go
func TestGlobalRitualScheduler(t *testing.T) {
    w := newTestWorld(t)

    // FR-001, FR-004: US1 — one sweep covers every organization
    t.Run("when the global sweep runs once", func(t *testing.T) {
        t.Run("it generates due instances for every organization that has active rituals", ...)
        t.Run("it regenerates each organization exactly once regardless of definition count", ...)
        t.Run("it reports organizations, definitions, and instances processed", ...) // FR-014
    })

    // FR-005: US1 — output equivalence across the recurrence matrix
    t.Run("for each supported recurrence pattern", func(t *testing.T) {
        t.Run("daily generates the same dates as the per-definition scheduler did", ...)
        t.Run("every-N-days generates the same dates", ...)
        t.Run("weekly on selected weekdays generates only those weekdays", ...)
        t.Run("monthly on a day-of-month generates the same dates", ...)
        t.Run("custom interval generates the same dates", ...)
        t.Run("a non-UTC timezone generates the same dates as before", ...)
    })

    // FR-006: US1 — idempotency
    t.Run("when the sweep runs twice over the same window", func(t *testing.T) {
        t.Run("no duplicate instances are created", ...)
        t.Run("no error is raised", ...)
    })

    // FR-002, FR-013: US2 — no per-definition schedule is ever written
    t.Run("across the full ritual definition lifecycle", func(t *testing.T) {
        t.Run("creating a definition writes no ritual-specific schedule row", ...)
        t.Run("updating the recurrence rule writes no schedule row", ...)
        t.Run("archiving writes no schedule row and pauses nothing", ...)
        t.Run("unarchiving writes no schedule row and resumes nothing", ...)
        t.Run("changing the schedule writes no schedule row", ...)
        t.Run("exactly one ritual schedule row exists platform-wide", ...) // FR-001, SC-001
    })

    // FR-011: US2 — creation still generates immediately
    t.Run("when a ritual definition is created", func(t *testing.T) {
        t.Run("its due instances exist immediately without waiting for a sweep", ...)
    })

    // FR-012: US2 — reschedule still reports its counts
    t.Run("when a definition's schedule is changed", func(t *testing.T) {
        t.Run("instances are regenerated within the same operation", ...)
        t.Run("the removed, detached, and created counts are still returned", ...)
    })

    // FR-010: US2 — archived definitions are inert
    t.Run("when a definition is archived", func(t *testing.T) {
        t.Run("the next sweep generates nothing for it", ...)
        t.Run("unarchiving makes the next sweep generate for it again", ...)
    })

    // FR-008, FR-009: US3 — isolation of failures
    t.Run("when one definition has an uninterpretable recurrence rule", func(t *testing.T) {
        t.Run("that definition is skipped", ...)
        t.Run("every other definition in the organization is still generated", ...)
    })
    t.Run("when generation fails for one organization", func(t *testing.T) {
        t.Run("the remaining organizations are still processed in the same run", ...)
    })

    // Edge case: organization with no active rituals
    t.Run("when an organization has no active ritual definitions", func(t *testing.T) {
        t.Run("the sweep completes without error and creates nothing", ...)
    })
}
```

**Traceability**: FR-001, FR-002, FR-004, FR-005, FR-006, FR-008, FR-009, FR-010, FR-011,
FR-012, FR-013, FR-014 are covered above. FR-003, FR-007, FR-015, and FR-016 are structural
(code absent, cadence value, bootstrap present, dead code deleted) and are verified by the
build plus the checks in [quickstart.md](./quickstart.md) rather than by runtime scenarios —
a test cannot meaningfully assert the absence of deleted symbols that would fail to compile.

### Constitution Re-Check (Post-Design)

Re-evaluated after Phase 1. No verdict changed; no new violations introduced.

The one item worth restating: the design adds a query that deliberately omits an
`organization_id` filter. This is permitted for system-scope background operations under
Principle I and follows the existing `ListPendingRemindersGlobal` precedent. It is a
discovery query returning only organization IDs — it exposes no tenant row data, and every
downstream query it feeds remains org-scoped. It runs on `AdminPool`, which the constitution
reserves for exactly this case.

## Complexity Tracking

No constitution violations require justification. The single deliberate simplification is
recorded here rather than as a violation:

| Simplification | Ceiling | Upgrade path |
|---|---|---|
| Cross-shard `SELECT DISTINCT organization_id` every minute | Citus fans the scan out to all shards. Cheap at current organization counts; cost grows with total organizations, not with rituals | Narrow to organizations with definitions actually due (`last_generated_date < now + generation_window_days`), or cache the org list between sweeps. Marked in code with a `ponytail:` comment naming this ceiling |
