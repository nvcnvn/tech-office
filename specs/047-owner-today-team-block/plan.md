# Implementation Plan: Team block on mobile Today

**Branch**: `047-owner-today-team-block` | **Date**: 2026-09-05 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/047-owner-today-team-block/spec.md`

## Summary

Add one read-only **Team** block to the mobile Today tab for callers who both hold
`collab.reviewEvidence` and are `owner`/`admin` on at least one project. The block lists
ritual instances that are **overdue** (stored `project_state.category = 'overdue'`) or
**unassigned today** (`scheduled_date = as_of_date`, no `role = 'assignee'` row) across
every supervised project, with true-but-capped counts.

Technically this is **one new read RPC and one new mobile section** — no schema change, no
new permission, no new index, no write path:

- `CollaborationService.GetTeamAttentionSummary` with `option (rpc.v1.access_control) = {}`,
  the permission read in the handler and turned into an empty result, exactly as
  `ListEvidenceReviewQueue` / `GetEvidenceReviewQueueCount` already do.
- Two sqlc queries (`CountTeamAttention`, `ListTeamAttentionItems`) whose supervisory-scope
  predicate is an `EXISTS` on `collaboration.project_membership` with `role IN ('owner','admin')`
  — the same shape as the review queue's `role <> 'viewer'` predicate, tightened one notch.
- Assignee display names resolved through the existing `collaboration.EmployeeNameLookup`
  interface (one batched call per request), **not** a cross-schema join — Constitution IV.
- A `TeamSection` rendered on `frontend/apps/mobile/src/app/(app)/(today)/index.tsx` between
  "Running late" and "Today's schedule", fed by a third `useQuery` started in the same render
  as the existing two, with its own error boundary so it can never blank the screen.

The one thing that carries risk is **not** the query — it is the ordering guarantee that the
Team block and the caller's own "Running late" section never disagree. That is bought by
reading lateness from the stored state category (FR-007) rather than comparing dates, which
is what `GetAssignedWorkSummaryCounts` already does for ritual instances.

## Technical Context

**Language/Version**: Go 1.24 (backend), TypeScript 5.x / React Native 0.81 + Expo SDK 54
(mobile), PostgreSQL 17

**Primary Dependencies**: ConnectRPC + protobuf (`backend/rpc/v1/collaboration.proto`), sqlc
(`backend/database/scripts/collaboration.query.sql`), pgx v5, TanStack Query v5, expo-router,
`@tech-office/theme-tokens`

**Storage**: PostgreSQL — existing tables only: `collaboration.task`,
`collaboration.task_assignee`, `collaboration.project`, `collaboration.project_state`,
`collaboration.project_membership`, `organization.employee` (via interface, never joined).
**No migration.**

**Testing**: Go integration tests in `backend/integration/` driven by `newTestWorld(t)`;
Maestro blackbox flow in `frontend/apps/mobile/.maestro/screens/today.yaml`. No web E2E —
the feature is mobile-only (see Constitution Check).

**Target Platform**: iOS 16+ and Android 8+ via Expo; backend on Linux/Docker.

**Project Type**: Mobile client + Go API service in a monorepo (`backend/`, `frontend/apps/mobile/`,
`frontend/packages/apis/`).

**Performance Goals**: Both queries bounded server-side — counts capped at 100 per category,
items capped at 20 per category. One additional round trip on Today, issued concurrently with
the two existing ones, so first meaningful render is bounded by the slowest single feed and
not by their sum (FR-015, SC-004, SC-005).

**Constraints**: No new index — the predicate rides
`idx_membership_employee (organization_id, employee_id)` for scope and
`idx_task_project_state (organization_id, project_id, state_id, updated_at DESC) WHERE is_deleted = false`
for instance selection. Every row must survive a departed or archived assignee (spec edge
case) — the name lookup is a `LEFT`-style resolution, never a filter.

**Scale/Scope**: 1 new RPC, 2 new SQL queries, 1 new logic file, ~1 new mobile component in
the existing Today screen, 1 API wrapper function, 1 integration test file, 1 extended Maestro
flow. Zero migrations, zero permission changes, zero write paths.

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1. Result: **PASS**, with one
justified scope note under Principle XIII.*

| Principle | Verdict | How this feature satisfies it |
|---|---|---|
| **I. Data Governance & Multi-Tenancy** | PASS | Read-only, no DDL. Every new query pins `organization_id = @organization_id` and carries it in every join condition (`(pm.organization_id, pm.project_id) = (t.organization_id, t.project_id)`). No cross-tenant marker needed — this is a tenant-scoped read. `make lint-tenancy` must be green. |
| **II. Scenario-First Testing** | PASS | `backend/integration/team_attention_test.go` is written as `t.Run` stubs first and reviewed as the behavioural contract; every FR maps to a scenario in [quickstart.md](quickstart.md#scenario-to-requirement-map). Mobile is covered by an extended Maestro flow, not by web E2E (feature has no web surface). |
| **III. Two-Layer Service & Proto Authorization** | PASS with documented exception | The RPC declares `option (rpc.v1.access_control) = {}` **deliberately**, matching the two evidence-review-queue RPCs: FR-002 requires an empty result rather than `PERMISSION_DENIED`, and the interceptor rejects before the handler runs, so a declared permission would make the empty-result path unreachable. The permission is read in the handler via `interceptor.UserPermissionsFromContext`. Handler stays thin: extract auth → permission gate → `txn.WithTxn` → `Logic.GetTeamAttentionSummary`. |
| **IV. Cross-Domain Integration** | PASS | Employee display names cross the `collaboration → organization` boundary through the existing `EmployeeNameLookup` interface, resolved once per request for the whole page. No cross-schema SQL join is added. (Note: `ListEvidenceReviewQueue` does join `organization.employee` directly; that is pre-existing drift and is **not** copied here — see [research.md](research.md#decision-5).) |
| **V. Observability, Simplicity & YAGNI** | PASS | No new table, no new permission, no new sweep, no cache, no cursor pagination. Expansion is a refetch with a larger `limit`, not a page token — the ceiling is 20 rows, which does not need a cursor. |
| **VI. Versioning & Breaking Changes** | PASS | Purely additive to the proto. Backend, `@tech-office/apis` and mobile ship in one change set. |
| **VII. Frontend API Wrapper & Type Safety** | PASS | The screen never touches `collaborationClient` directly; it calls `getTeamAttentionSummary` in `frontend/packages/apis/src/collaboration.ts`, which maps proto → native types. All interactive elements carry `testID`. |
| **VIII. Cross-Stack Constant Synchronization** | PASS | The category is a **proto enum** (`TeamAttentionCategory`), not a string, so the two clients cannot drift. Limits and caps live server-side only; the client sends `limit` and reads `*_count_capped` rather than knowing the cap. |
| **IX. UUID v7 & Nullable Cursor Params** | PASS | No cursor. `sqlc.narg` is used for the optional `as_of_date`. |
| **X. Structured Error Details** | PASS | The RPC has exactly one client-fixable failure: a malformed `as_of_date`, returned as `InvalidArgument` with a `google.rpc.BadRequest` field violation on `as_of_date`. Everything else is either an empty result or an internal error. |
| **XI. Distributed-First & Horizontal Scalability** | PASS | Stateless read. Both queries are bounded, so cost is independent of backlog size (SC-005). No in-process state, no ordering assumption across requests. |
| **XII. Living Documentation** | PASS — required at DoD | `docs/domain/rituals-tasks.md` (new "Team attention summary" subsection under Compliance and health) and `docs/domain/workspace-navigation.md` (mobile Today section) MUST be updated in the same change set. `backend/docs/SYSTEM-ARCHITECTURE.md` needs no change: no new tier edge is introduced, the `EmployeeNameLookup` edge already exists. |
| **XIII. Mobile Design & Testing** | PASS with justification | See below. |

### Principle XIII scope justification

Principle XIII scopes mobile to "employees performing day-to-day tasks" and reserves
administrative/configuration surfaces for web. This block is **not** an administrative
surface and does not need the workspace-shaping carve-out:

- It is **read-only**. It offers no assignment, no reassignment, no bulk action, no
  configuration (spec assumption: *no assignment or bulk action is offered from the block*).
  Tapping a row lands on the existing ritual instance detail screen, which already exists on
  mobile and already carries whatever controls the caller is entitled to.
- Checking whether this morning's opening ritual has anybody on it **is** a day-to-day task
  for the person who runs a shift. It is the supervisory half of "what do I need to do right
  now", not plan or quota management.
- It surfaces exactly the class of problem the system already pages project owners about by
  notification (`ritual_instance_unassigned`, and the `closed_unresolved` owner alert). The
  block is a quieter, pull-based view of an escalation mobile already receives push-first.

No amendment is required. The design checklist is carried into
[quickstart.md](quickstart.md#mobile-design-checklist).

## Project Structure

### Documentation (this feature)

```text
specs/047-owner-today-team-block/
├── plan.md              # This file
├── research.md          # Phase 0 output — the seven decisions this design rests on
├── data-model.md        # Phase 1 output — read model, predicates, ordering, bounds
├── quickstart.md        # Phase 1 output — how to run and prove the feature
├── contracts/
│   └── collaboration-team-attention.proto   # The exact proto delta
├── spec.md              # Input
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
backend/
├── rpc/v1/collaboration.proto                       # + GetTeamAttentionSummary, 4 messages, 1 enum
├── database/scripts/collaboration.query.sql         # + CountTeamAttention, ListTeamAttentionItems
├── database/collaboration.query.sql.go              # regenerated by sqlc
├── internal/collaboration/
│   ├── team_attention_logic.go                      # NEW — bounds, name resolution, proto mapping
│   ├── logic.go                                     # + GetTeamAttentionSummary on the Logic interface
│   └── ritual_connect.go                            # + handler beside the review-queue handlers
└── integration/
    └── team_attention_test.go                       # NEW — the behavioural contract

frontend/
├── packages/apis/src/collaboration.ts               # + getTeamAttentionSummary wrapper + native types
└── apps/mobile/
    ├── src/app/(app)/(today)/index.tsx              # + TeamSection, third useQuery, own error boundary
    └── .maestro/screens/today.yaml                  # + team block assertions

docs/domain/
├── rituals-tasks.md                                 # + Team attention summary
└── workspace-navigation.md                          # + mobile Today team block
```

**Structure Decision**: Mobile client + Go API service in the existing monorepo. No new
package, no new service, no new directory — every file above is either an existing file
gaining a section or a new file placed beside its closest sibling
(`team_attention_logic.go` next to `context_rail_logic.go` and
`evidence_review_queue_logic.go`, which it is deliberately modelled on).

## Complexity Tracking

**Post-Phase-1 re-evaluation: still PASS.** The Phase 1 design added no table, no migration,
no index, no permission, no background job and no cross-schema join, so no gate moved. The two
things the design *could* have broken — Constitution IV (Decision 5 chose the interface over
the join its nearest neighbour uses) and Constitution I (every new join is composite and
organization-pinned) — are the two the design deliberately spent its complexity budget on.

No Constitution violations require justification. The single documented exception — an empty
`access_control` block on the new RPC — is not a violation but the pattern Principle III's
own precedent (`ListEvidenceReviewQueue`) established for "no permission means an empty
result, not an error", and it is required by FR-002.

| Deviation from spec | Why | Recorded where |
|---|---|---|
| `as_of_date` is an explicit optional proto field rather than a device header or a server-only clock | The spec's day-boundary assumption requires the device's local date; the repository's standing preference is an explicit proto field over an ambient header. Absent → server date, so a caller that omits it still gets a sane answer. | [research.md](research.md#decision-6) |
| `GetAssignedWorkSummary` is **not** changed to accept `as_of_date` | Out of scope, and no disagreement can arise: a ritual instance's lateness in both surfaces comes from the stored state category, never from a date. Only the new *unassigned* category is date-scoped, and it has no counterpart in the personal sections. | [research.md](research.md#decision-6) |
