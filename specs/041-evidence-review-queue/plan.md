# Implementation Plan: Evidence Review Queue

**Branch**: `041-evidence-review-queue` | **Date**: 2026-09-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/041-evidence-review-queue/spec.md`

## Summary

Add one cross-project "Needs your review" surface on web and mobile that lists every
`pending_review` evidence submission the caller is entitled to decide, and lets them approve
or reject inline. The queue is a **read-only projection** — no new table, no claim/lock, no
per-reviewer marker — served by two new RPCs on the existing `CollaborationService`:
`ListEvidenceReviewQueue` (cursor-paginated) and `GetEvidenceReviewQueueCount` (badge).

The same change closes an existing authorization gap: `ApproveEvidence` and `RejectEvidence`
today check only the org-wide `collab.reviewEvidence` permission and never scope to the
submission's project, so any holder can decide any submission in the organization by id.
Both are tightened in place to require non-`viewer` project membership, and both gain a
compare-and-set on `approval_status` so a second decider is refused rather than silently
overwriting the first.

No parallel decision path is introduced (FR-016): the queue's approve/reject are the *same*
`ApproveEvidence` / `RejectEvidence` RPCs the task detail view already calls, which already
route through `reconcileRitualTaskState` — the single writer of ritual instance state.

## Technical Context

**Language/Version**: Go 1.24 (backend), TypeScript 5.x / React 19 + Next.js 15 (web),
TypeScript + Expo SDK 54 / React Native (mobile)

**Primary Dependencies**: Connect RPC + protobuf (`backend/rpc/v1/collaboration.proto`),
`sqlc` (queries in `backend/database/scripts/collaboration.query.sql`), pgx v5, MUI v7 (web),
Expo Router + TanStack Query (mobile), `packages/apis` typed wrapper layer

**Storage**: PostgreSQL 18. Existing tables only — `collaboration.evidence_submission`,
`collaboration.evidence_requirement`, `collaboration.task`, `collaboration.project`,
`collaboration.project_membership`, `collaboration.project_state`,
`collaboration.ritual_definition`, `organization.employee`. **No new table and no new
column.** One migration adds a supporting index (see Phase 1).

**Testing**: Go integration tests in `backend/integration/` (`testWorld` pattern), Playwright
E2E in `frontend/apps/web/e2e/`, Maestro flows in `frontend/apps/mobile/.maestro/tasks/`

**Target Platform**: Linux server (Docker Swarm per `deploy/`); modern browsers; iOS 16+ /
Android 10+ portrait phones at 360–430 dp

**Project Type**: Web application + mobile app over a shared Connect RPC API

**Performance Goals**: First queue page (25 entries) < 2 s p95 for a reviewer with 500
pending submissions across 50 projects (SC-005); badge count returns independently of the
list and is bounded (`LIMIT 100` inside the count, rendered "99+" above 99).

**Constraints**: Every join carries `organization_id` (Principle I). Cursor pagination must
be stable across the page boundary while the sort key is partly derived (urgency). Decisions
must be atomic with ritual state re-derivation, i.e. one transaction owned by the Connect
layer. Mobile layout must be purpose-built, not a responsive copy of web (Principle XIII).

**Scale/Scope**: 2 new RPCs, 3 new SQL queries, 1 modified SQL query (CAS), 1 index
migration, ~1 new backend logic file, project scoping added to 2 existing logic methods,
1 new web route + 1 nav tab, 1 new mobile route + 1 tasks-tab entry point,
1 new `packages/apis` module.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against `.specify/memory/constitution.md` v5.17.0.

| Principle | Status | How this design satisfies it |
|---|---|---|
| **I. Data Governance & Multi-Tenancy** | ✅ PASS | Queue query pins `organization_id = @organization_id` and every join is composite `(organization_id, fk) = (organization_id, id)`. Runs on `TenantPool`; no `-- lint:cross-tenant` marker needed. No new table, so the composite-PK and org-leading-unique-index rules are not engaged. One new index leads with `organization_id`. See Complexity Tracking for the one cross-schema join. |
| **II. Scenario-First Integration & E2E Testing** | ✅ PASS | Behavioural contract composed as `t.Run` stubs in `backend/integration/collaboration_evidence_review_queue_test.go` and mirrored `test.describe` stubs in `frontend/apps/web/e2e/collaboration-evidence-review-queue.spec.ts`; every US and every user-observable FR mapped in [quickstart.md](./quickstart.md). Maestro flow added for the mobile happy path. |
| **III. Two-Layer Architecture & Proto-Level Authz** | ⚠️ PASS WITH NOTE | Logic layer (`evidence_review_queue_logic.go`) is pool-agnostic and takes `tx database.DBTX`; Connect layer owns the transaction and error translation. `ApproveEvidence`/`RejectEvidence` keep `required_permissions: ["collab.reviewEvidence"]` and gain the project-scope check in the logic layer (a data-dependent business rule, exactly where the principle puts it). The two **read** RPCs declare `access_control = {}` — see Complexity Tracking. Authorization is by permission id, never by role. |
| **IV. Cross-Domain Integration** | ⚠️ PASS WITH NOTE | No new cross-domain logic dependency is introduced. One cross-schema SQL join (`organization.employee` for the submitter's display name) reuses the existing precedent in the same query file — see Complexity Tracking. |
| **V. Observability, Simplicity & YAGNI** | ✅ PASS | No new stored state, no lock table, no claim model, no digest notification, no bulk actions. `slog` context lines on decision refusals (already-decided, out-of-scope) so the authorization tightening is observable in production. |
| **VI. Versioning & Breaking Changes** | ✅ PASS | Tightening `ApproveEvidence`/`RejectEvidence` scope is a deliberate breaking change to the authorization contract, shipped atomically across backend + web + mobile in one change set. No compatibility shim, no `v2` variant. |
| **VII. Frontend API Wrapper & Type Safety** | ✅ PASS | New `frontend/packages/apis/src/collaboration-review-queue.ts` exposes `ReviewQueueEntry` with native `Date`; apps import from `apis`, never from `rpc`. All web interactive elements carry `data-testid`; all colours come from `useThemeColors()`. |
| **VIII. Cross-Stack Constant Sync** | ✅ PASS | Reuses the existing `ApprovalStatus` and `EvidenceType` proto enums and the existing `state_category` strings. The one new string set (urgency bucket) is a proto enum, `ReviewUrgency`, not a string. |
| **IX. UUID v7 & Nullable Cursor Params** | ✅ PASS | Cursor is optional and uses `sqlc.narg('cursor_submission_id')::uuid` plus `dbuuid.NullUUID` in Go. The composite `(urgency_rank, server_timestamp, id)` tuple cursor is required because the sort key is not id alone; the `id` leg is still the UUID v7 tiebreak that makes the boundary total. |
| **X. Structured Error Details** | ✅ PASS | Two cases need more than a code. Already-decided → `CodeFailedPrecondition` + `google.rpc.PreconditionFailure` naming the prior decider and time (FR-015). Empty reject reason → `CodeInvalidArgument` + `google.rpc.BadRequest` field violation on `comment` (FR-014). Out-of-scope → plain `CodePermissionDenied`, no detail, so nothing about the project leaks (FR-007). |
| **XI. Distributed-First & Horizontal Scalability** | ✅ PASS | The queue is stateless: two read queries and a compare-and-set write. Nothing is held between requests, so any replica can serve any page and concurrent deciders converge on one winner without coordination. |
| **XII. Living Documentation** | ✅ PASS | `docs/domain/rituals-tasks.md` (queue + tightened decision scope) and `docs/domain/workspace-navigation.md` (new web tab, new mobile entry point) are updated in the same change set, per the `after_implement` docs hook. |
| **XIII. Mobile Design & Testing** | ✅ PASS | In scope: judging a shift's evidence is day-to-day operational work performed where the work happens, not IAM/config administration — the spec's own justification, and the user's stated blocker. Purpose-built full-screen list, no sidebars or grids, large tap targets, `testID` on every interactive element, Maestro flow for the happy path. |

**Result**: PASS. Two notes are recorded in Complexity Tracking with justification; neither is
an unjustified violation, so the gate does not ERROR.

### Post-design re-check (after Phase 1)

Re-evaluated against the finished [data-model.md](./data-model.md),
[contracts/](./contracts/collaboration-review-queue.proto) and
[quickstart.md](./quickstart.md). The design did not add a violation, and it removed one
risk the pre-design pass had flagged as open:

- **Principle I** — the final query pins `organization_id` once and every join is composite,
  including the `project_membership` join that carries reviewer scope. The new index leads
  with `organization_id`. The migration also **drops** the now-redundant
  `idx_evidence_sub_pending`, satisfying the index-reuse rule rather than leaving two
  overlapping partial indexes on the same leading key.
- **Principle IX** — the pre-design pass left open how a composite sort key would reconcile
  with the UUID-v7 cursor rule. Settled: the cursor is the full sort tuple with the UUID v7
  primary key as its final, total tiebreak leg, and `sqlc.narg` keeps the "first page" case
  distinguishable from a zero-value UUID.
- **Principle V** — the design ends up *net-deleting* client code: `listRitualReviewBacklog`
  and its per-project component go away, replaced by one server-side query. No new table, no
  lock, no claim model, no counter, no digest notification.
- **Principle II** — the behavioural contract is composed in
  [quickstart.md](./quickstart.md) with FR traceability, and the two untestable groups
  (FR-023 layout independence; SC-001/002/003/004/009 timing and usability measures) are
  documented as explicit exclusions with justification, as the principle requires.

No new entries were needed in Complexity Tracking. Gate still PASS.

## Project Structure

### Documentation (this feature)

```text
specs/041-evidence-review-queue/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── collaboration-review-queue.proto   # Phase 1 output — additions to collaboration.proto
├── checklists/
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
backend/
├── rpc/v1/collaboration.proto                       # + 2 RPCs, + queue messages, + ReviewUrgency enum
├── database/
│   ├── migrations/
│   │   └── 20260903000001_evidence_review_queue_index.up.sql   # supporting index
│   └── scripts/
│       ├── collaboration.query.sql                  # + ListEvidenceReviewQueue, + CountEvidenceReviewQueue,
│       │                                            #   + GetEvidenceSubmissionForReview,
│       │                                            #   ~ UpdateEvidenceSubmissionApproval (CAS)
│       └── schema.sql                               # regenerated, never hand-edited
└── internal/collaboration/
    ├── evidence_review_queue_logic.go               # NEW — queue projection + reviewer scope
    ├── evidence_logic.go                            # ~ ApproveEvidence / RejectEvidence: scope + CAS
    ├── ritual_notification_logic.go                 # ~ carry task title + rejection reason to submitter
    ├── logic.go                                     # + interface methods, + new sentinel errors
    └── connect.go                                   # + 2 handlers, + error translation

backend/integration/
└── collaboration_evidence_review_queue_test.go      # NEW — behavioural contract

frontend/packages/apis/src/
├── collaboration-review-queue.ts                    # NEW — typed wrapper + ReviewQueueEntry
└── index.ts                                         # + re-export

frontend/apps/web/src/app/workspace/
├── layout.tsx                                       # + "Reviews" tab, permission-gated, badge count
└── reviews/
    ├── page.tsx                                     # NEW — queue surface
    └── components/
        ├── ReviewQueueList.tsx                      # NEW
        ├── ReviewQueueRow.tsx                       # NEW — evidence rendering + inline actions
        └── RejectReasonDialog.tsx                   # NEW

frontend/apps/web/e2e/
└── collaboration-evidence-review-queue.spec.ts      # NEW

frontend/apps/mobile/src/
├── app/(app)/(tasks)/
│   ├── _layout.tsx                                  # + "review" screen registration
│   ├── index.tsx                                    # + entry point card with pending count
│   └── review/index.tsx                             # NEW — full-screen queue
└── components/review/
    ├── review-queue-card.tsx                        # NEW
    └── reject-reason-sheet.tsx                      # NEW

frontend/apps/mobile/.maestro/tasks/
└── evidence-review-approve.yaml                     # NEW

docs/domain/
├── rituals-tasks.md                                 # ~ queue + tightened decision scope
└── workspace-navigation.md                          # ~ new web tab + mobile entry point
```

**Structure Decision**: Web application + mobile app over a shared Connect RPC API. The
feature adds no new backend service — it extends `CollaborationService`, because the queue
reads and writes only collaboration-domain rows and must share the single ritual-state
writer that already lives there. Splitting it into a separate service would either duplicate
that writer or force a cross-service call inside the decision transaction.

## Complexity Tracking

> Two deviations from the strictest reading of the constitution, both deliberate.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| The two read RPCs declare `option (rpc.v1.access_control) = {}` (any authenticated user) instead of `required_permissions: ["collab.reviewEvidence"]` | FR-012 requires a caller without the permission to receive an **empty queue**, not `PERMISSION_DENIED`. The interceptor rejects before the handler runs, so a declared permission makes the required behaviour unreachable. The handler reads `interceptor.UserPermissionsFromContext` and returns an empty page and a zero count when the permission is absent — the check still happens, it just shapes the result instead of the status code. Precedent for the empty declaration exists at `backend/rpc/v1/iam.proto:387` and `backend/rpc/v1/compliance.proto:85`. | Declaring the permission and letting clients hide the entry point was rejected: it leaves the RPC returning an error to a legitimately authenticated caller who merely has nothing to review, which FR-012 explicitly forbids and which makes the web tab's "hide when empty" behaviour indistinguishable from a real failure. |
| One cross-schema SQL join, `collaboration.evidence_submission` → `organization.employee`, for the submitter's display name | Principle I's own worked example shows exactly this join as CORRECT, and `backend/database/scripts/collaboration.query.sql:1040` already joins `organization.employee` for task-assignee names in this same file. Reusing the established pattern keeps one query where the alternative is a second round trip per page. The join carries `organization_id` on both sides. | Introducing an `OrganizationLogic` dependency on `logicImpl` purely to batch-resolve ≤25 display names per page was rejected: it adds a cross-domain interface, a constructor parameter in `backend/cmd/server.go`, and a second query, to avoid a join the neighbouring lines in the same file already perform. Principle IV says "AVOID", not "FORBIDDEN", and Principle I contradicts the absolute reading. |
