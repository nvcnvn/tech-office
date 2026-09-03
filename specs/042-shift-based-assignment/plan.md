# Implementation Plan: Ritual Assignment Follows the Shift

**Branch**: `042-shift-based-assignment` | **Date**: 2026-09-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/042-shift-based-assignment/spec.md`

## Summary

Add a third department-pool assignment strategy, `on_shift`, that resolves a ritual
instance's pool slot to a department member who has a non-cancelled `shift` calendar event
overlapping the instance's scheduled date in the ritual definition's own timezone, breaking
ties by fewest ritual assignments in the trailing 90 days.

Because instances are materialised 30 days ahead and rotas are published one or two weeks
ahead, resolution is **late-bound**: generation records a per-instance-per-pool row in a new
`collaboration.ritual_instance_pool_assignment` table whose `resolution_state` is
`awaiting_shift` when nobody is rostered, and a third platform-wide sweep
(`ritual_shift_resolution_sweep`, every 2 minutes) binds, rebinds and finally escalates
those rows. No fallback to round-robin ever happens — that fallback *is* the reported bug.

The tier-ordering constraint (FR-022) is satisfied with the same inversion of control the
calendar already uses in the opposite direction: collaboration declares a
`ShiftCoverageReader` interface, `calendar.Logic` implements it, and `cmd/server.go` injects
it with a setter after the calendar logic is constructed. Collaboration never imports
calendar.

## Technical Context

**Language/Version**: Go 1.24 (backend), TypeScript 5.x / Next.js 15 (web), TypeScript /
Expo Router (mobile)

**Primary Dependencies**: `pgx/v5`, `sqlc`, ConnectRPC, `github.com/nvcnvn/flows` (scheduled
workflows), `github.com/teambition/rrule-go` (RRULE expansion, already vendored and used by
`internal/calendar/recurrence.go`), MUI v7 (web), React Query

**Storage**: PostgreSQL, single node. Schema-per-domain: `collaboration`, `calendar`,
`organization`, `notification`

**Testing**: `backend/integration/*_test.go` (testWorld pattern, real database),
`frontend/apps/web/e2e/*.spec.ts` (Playwright)

**Target Platform**: Linux server (Docker Swarm), web browsers, iOS/Android via Expo

**Project Type**: Multi-tenant SaaS — Go backend + Next.js web + Expo mobile in one repo,
released together

**Performance Goals**: SC-006 — a generation cycle for an organization with 200 definitions
and a 30-day window must finish inside its 1-minute interval. On-shift resolution at
generation time costs, per definition, one department-member read and one shift-coverage
read per *date* in the window. A resolution pass is bounded at 500 rows per organization.

**Constraints**: Collaboration MUST NOT import calendar (tier ordering,
`backend/docs/SYSTEM-ARCHITECTURE.md`). No fallback assignment. Resolution must be
idempotent under overlapping passes. The 7-day backfill horizon for escalation matches the
existing overdue/missed horizon.

**Scale/Scope**: One new table, one new migration, one new sweep workflow, one new
cross-domain interface, one new calendar query pair, one new notification type, one new
proto enum + one new `Task` field, one new web select option, one new instance banner on
web and mobile.

## Constitution Check

*GATE: evaluated before Phase 0 research and re-evaluated after Phase 1 design.*

| Principle | Verdict | How this design satisfies it |
|---|---|---|
| **I. Data Governance & Multi-Tenancy** | PASS | The new table carries `organization_id UUID NOT NULL`, primary key `(organization_id, id)`, unique key `(organization_id, task_id, pool_id)` leading with `organization_id`, and composite FKs to `collaboration.task(organization_id, id)` and `ritual_definition_department_pool(organization_id, id)`. Every join in the new queries carries `organization_id`. The one cross-org discovery query (`ListOrganizationIDsWithResolvableRitualPoolAssignments`) runs on `AdminPool` and carries a `-- lint:cross-tenant` marker. Migration is a new timestamped `.up.sql`; `schema.sql` is regenerated, never hand-edited. |
| **II. Scenario-First Integration & E2E Testing** | PASS | `contracts/test-scenarios.md` holds the `t.Run` scenario stubs for `backend/integration/collaboration_ritual_shift_assignment_test.go` and `backend/integration/calendar_shift_coverage_test.go`, plus the Playwright scenarios for `frontend/apps/web/e2e/ritual-shift-assignment.spec.ts`, each traced to a User Story and to FR numbers. This is the behavioural contract to approve before `/speckit-tasks`. |
| **III. Two-Layer Service Architecture & Proto-Level Authorization** | PASS | All new behaviour lives in the logic layer (`internal/collaboration`, `internal/calendar`). The only Connect-layer change is populating a new `Task` field. Selecting `on_shift` reuses the existing `collab.manageRitualDefinition` permission plus the existing project admin/owner resource check — no new permission (FR-017). |
| **IV. Cross-Domain Integration** | PASS | `ShiftCoverageReader` is a logic-layer interface declared by the *consumer* (collaboration) and implemented by `calendar.Logic`. It takes `tx database.DBTX` so generation stays inside one transaction. No cross-schema SQL join between `collaboration` and `calendar`; the department member list crosses as a `[]dbuuid.UUID` parameter. No nested transactions. |
| **V. Observability, Simplicity & YAGNI** | PASS | One table, one sweep, one interface. The sweep reports a structured summary line like the two existing sweeps. Rejected: a materialised shift-coverage cache, a `rota` concept, a generic "assignment plugin" registry — see `research.md`. `expandInstances`/`applyExceptions` already exist in `internal/calendar/recurrence.go` and are currently unreferenced; this feature is their first caller rather than a second recurrence expander. |
| **VI. Versioning & Breaking Changes** | PASS | The `assignment_strategy` CHECK constraint, the Go constants, the TS union and the web selector change together in one coordinated change set. No dual-write, no legacy path, no compatibility shim. |
| **VII. Frontend API Wrapper Pattern & Type Safety** | PASS | All client access goes through `frontend/packages/apis/src/collaboration-ritual.ts` and `collaboration-task.ts`; the new `AssignmentStrategy` member and the new pool-assignment state are typed there and consumed by web and mobile. |
| **VIII. Cross-Stack Constant Synchronization** | PASS — and repays existing debt | `scheduler_logic.go` currently compares `p.AssignmentStrategy` against the literals `"round_robin"` and `"least_assigned"`, which principle VIII forbids. This change introduces `AssignmentStrategyRoundRobin`, `AssignmentStrategyLeastAssigned` and `AssignmentStrategyOnShift` in `internal/collaboration/constants.go` and replaces those literals. The instance-level state is a **proto enum** (`RitualPoolAssignmentState`) per the enum-preference rule, mapped to the DB `TEXT` column by named Go constants in the same style as `TaskKind`. A constant-sync assertion is part of the integration scenarios. |
| **IX. UUID v7 & Nullable Cursor Params** | PASS | `id UUID NOT NULL DEFAULT uuidv7()`. The new list queries are bounded batches ordered by `resolve_by ASC, id ASC`, not cursor-paginated client surfaces, so no nullable cursor parameter is introduced. |
| **X. Structured Error Details** | PASS | No new user-facing error path. The strategy value is validated by the DB CHECK and by the existing ritual definition validator, which already returns structured details for an invalid strategy. |
| **XI. Distributed-First Architecture** | PASS | The sweep holds no state between runs; its cursor is the `resolution_state` column of the rows themselves. Every mutation is a compare-and-set against the state it read (`UPDATE ... WHERE resolution_state = @expected`), which is what makes two overlapping passes produce one assignment and one notification (FR-014), exactly the pattern `UpdateRitualTaskStateIfUnchanged` already uses. |
| **XII. Living Documentation** | PASS | `docs/domain/rituals-tasks.md` (assignment, sweeps, notifications) and `docs/domain/calendar.md` (the new shift-coverage read and the first real use of recurrence expansion) are updated in the same change set, plus `backend/docs/SYSTEM-ARCHITECTURE.md` for the new inverted dependency edge. The `after_implement` `speckit.docs.snapshot` hook enforces this. |
| **XIII. Mobile Application Design & Testing** | PASS | Mobile gains **read-only** surface only: the "waiting for the rota" explanation on the ritual instance detail screen (FR-019). Strategy configuration stays web-only, consistent with the existing absence of ritual pool configuration on mobile. |

**Result: no violations. Complexity Tracking is empty.**

## Project Structure

### Documentation (this feature)

```text
specs/042-shift-based-assignment/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── shift-coverage-interface.md   # The cross-domain IoC contract (FR-022)
│   ├── proto-and-sql.md              # Proto deltas, SQL schema deltas, query contracts
│   └── test-scenarios.md             # Behavioural contract (Constitution II)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
backend/
├── database/
│   ├── migrations/
│   │   └── 20260904HHMMSS_ritual_on_shift_assignment.up.sql   # NEW
│   ├── scripts/
│   │   ├── collaboration.query.sql     # + pool-assignment CRUD, discovery, counts
│   │   ├── calendar.query.sql          # + shift coverage reads
│   │   └── schema.sql                  # REGENERATED (never hand-edited)
│   └── *.query.sql.go                  # REGENERATED by sqlc
├── internal/
│   ├── collaboration/
│   │   ├── constants.go                        # + strategy + state + cadence constants
│   │   ├── logic.go                            # + ShiftCoverageReader, SetShiftCoverageReader
│   │   ├── scheduler_logic.go                  # + on_shift branch, pool-assignment record
│   │   ├── ritual_shift_assignment_logic.go    # NEW — the shared resolver
│   │   ├── ritual_shift_resolution_logic.go    # NEW — one org's resolution + escalation pass
│   │   ├── ritual_shift_resolution_workflow.go # NEW — the sweep
│   │   ├── ritual_notification_logic.go        # + reassign / withdraw / unassigned alerts
│   │   └── ritual_connect.go / task_logic.go   # + populate Task.pool_assignment_state
│   └── calendar/
│       ├── logic.go                    # + EmployeesOnShift on the Logic interface
│       └── shift_coverage_logic.go     # NEW — implements the reader
├── cmd/server.go                       # + SetShiftCoverageReader, + sweep registration
├── rpc/v1/collaboration.proto          # + RitualPoolAssignmentState, + Task field
├── docs/SYSTEM-ARCHITECTURE.md         # + inverted calendar→collaboration edge
└── integration/
    ├── collaboration_ritual_shift_assignment_test.go   # NEW
    └── calendar_shift_coverage_test.go                 # NEW

frontend/
├── packages/apis/src/
│   ├── collaboration-ritual.ts         # AssignmentStrategy += 'on_shift'
│   └── collaboration-task.ts           # + poolAssignmentState on the Task type
└── apps/
    ├── web/
    │   ├── src/app/workspace/projects/[id]/rituals/[definitionId]/page.tsx  # + On-shift option + helper text
    │   ├── src/app/workspace/projects/[id]/components/TaskDetailSidePanel.tsx  # + waiting-for-rota banner
    │   └── e2e/ritual-shift-assignment.spec.ts                             # NEW
    └── mobile/
        └── src/app/(app)/(tasks)/[projectId]/task/[taskId].tsx             # + waiting-for-rota banner

docs/domain/
├── rituals-tasks.md                    # assignment, third sweep, new notification
└── calendar.md                         # shift coverage read, recurrence expansion now live
```

**Structure Decision**: The repository is an existing multi-tenant SaaS monorepo with a Go
backend (`backend/`), a Next.js web app (`frontend/apps/web`) and an Expo mobile app
(`frontend/apps/mobile`) sharing a typed API wrapper package
(`frontend/packages/apis`). This feature adds files inside the existing
`internal/collaboration` and `internal/calendar` domain packages and touches the existing
ritual definition and task-detail surfaces; it introduces no new top-level directory.

## Phase 0 — Research

See [research.md](./research.md). Every `NEEDS CLARIFICATION` raised while filling Technical
Context was resolved there and recorded as an `[ASSUMPTION: ...]`, per the unattended-run
rule. Summary of the decisions that shape the design:

1. **Shift coverage is a query, never a cache.** The calendar stays the single source of
   truth for the rota.
2. **Timezone lives on the collaboration side.** Collaboration converts the ritual's
   scheduled date into a `[dayStart, dayEnd)` UTC instant pair using the definition's
   timezone, and the calendar reader answers a pure overlap question. This is what makes an
   `Asia/Tokyo` ritual and a UTC-stored shift agree without either domain knowing the
   other's rules.
3. **Recurring shifts are expanded in Go with the existing, currently-unused
   `expandInstances` + `applyExceptions` helpers.** Range queries in the calendar do not
   expand recurrence today; this feature is their first caller.
4. **Attendees only, not the organiser.** A shift's organiser is the manager publishing the
   rota, so counting them would roster a manager onto every shift.
5. **The resolution cycle is its own sweep at 2 minutes.**

## Phase 1 — Design & Contracts

- [data-model.md](./data-model.md) — the new table, its state machine, the changed CHECK
  constraint, the indexes and the reasoning behind `resolve_by`.
- [contracts/shift-coverage-interface.md](./contracts/shift-coverage-interface.md) — the
  `ShiftCoverageReader` Go interface, its coverage rules, its failure semantics and how it
  is wired in `cmd/server.go`.
- [contracts/proto-and-sql.md](./contracts/proto-and-sql.md) — proto deltas, the migration
  DDL, and every new sqlc query with its tenancy markers.
- [contracts/test-scenarios.md](./contracts/test-scenarios.md) — the behavioural contract:
  backend integration `t.Run` stubs and Playwright scenarios, traced to User Stories and FRs.
- [quickstart.md](./quickstart.md) — how to run the feature end to end and prove each
  success criterion locally.

### Post-design Constitution re-check

Re-evaluated after the artifacts above were written. Still no violations. Two points were
checked specifically because the design moved after the first gate:

- **Principle I, cross-schema joins.** The shift-coverage query joins `calendar.event` to
  `calendar.attendee` only — same schema. The department member list arrives as a
  `uuid[]` parameter from collaboration, so no `collaboration` ↔ `calendar` join exists at
  the SQL layer. (`GetLeastAssignedDepartmentEmployee` already joins
  `collaboration.task_assignee` to `organization.department_member`; the new
  candidate-scoped variant deliberately drops that join by taking the candidate list as an
  array, so it is strictly cleaner than the query it sits next to.)
- **Principle XI, idempotency.** Every state write in the resolution pass is a
  compare-and-set on `resolution_state`, and the escalation notification is published only
  when the CAS reports one changed row. Two overlapping passes therefore assign once and
  notify once (FR-014).

## Complexity Tracking

No Constitution violations. This section is intentionally empty.
