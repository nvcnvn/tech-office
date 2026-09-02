# Implementation Plan: Feature Tour

**Branch**: `039-feature-tour` | **Date**: 2026-09-02 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/039-feature-tour/spec.md`

## Summary

Two short, card-based orientation tours — one for administrators, one for workers — offered
once per person per organization on first arrival in the workspace, replayable from Help,
and available on both web and mobile.

**The architectural decision that shapes everything else: the tour is server-driven.** A
single `TourService.GetTour` call returns the tour this person should see, already selected
by their permissions, already filtered to the stops they can use, already adapted to the
platform that asked, together with their progress. `TourService.UpdateTourProgress` records
where they got to. The clients render cards and map a target enum to their own route.

This is what makes "two tours × two platforms" cost roughly one tour's worth of work. The
alternative — a shared TypeScript content package plus client-side permission evaluation —
would duplicate the selection and filtering rules in two apps, and would need a way for
clients to read their own permissions that does not exist today (`GetEmployeePermissions`
takes an employee ID the clients do not hold). The auth interceptor already puts the caller's
permission set in context (`interceptor.UserPermissionsFromContext`), so doing this on the
server is close to free.

Tour **content lives in Go constants**, not in the database. The spec puts a tour authoring
interface out of scope, so a content table would be a table with two rows nobody can edit.

## Technical Context

**Language/Version**: Go 1.27 (backend); TypeScript 5.x with Next.js 15 App Router (web); Expo Router / React Native (mobile)

**Primary Dependencies**: Connect-RPC + protobuf (`backend/rpc/v1`), sqlc-generated queries, PostgreSQL 18, MUI v7 (web), Expo Router (mobile), TanStack Query (both clients via `packages/apis`)

**Storage**: One new tenant table, `iam.tour_progress`. No content tables — tour definitions are Go values.

**Testing**: `backend/integration/feature_tour_test.go` (testWorld pattern); `frontend/apps/web/e2e/feature-tour.spec.ts` (Playwright); `frontend/apps/mobile/.maestro/feature-tour/*.yaml` (Maestro)

**Target Platform**: Web application (`frontend/apps/web`) and mobile application (`frontend/apps/mobile`), both against the existing Go backend

**Project Type**: Web + mobile clients over a shared Connect-RPC backend — the repository's established three-surface shape

**Performance Goals**: `GetTour` is a single indexed point read plus in-memory filtering; it must not add a blocking round trip to workspace entry. Target under 100 ms server-side, and the clients must render the workspace first and the tour offer after.

**Constraints**: Every stop readable and dismissible at 360 dp portrait; fully keyboard- and screen-reader-operable; the tour must never intercept a deep-link navigation; no new background jobs and no new analytics pipeline.

**Scale/Scope**: 2 tours, at most 6 stops each, 1 new table, 1 new proto file, 1 new Go domain package (~300 lines across logic and service), 1 new client API module, 2 new client UI surfaces. 43 tasks.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Applies how | Status |
|---|---|---|
| **I. Data Governance & Multi-Tenancy** | `iam.tour_progress` carries `organization_id UUID NOT NULL`, composite PK `(organization_id, id)`, unique `(organization_id, employee_id, tour_id)` with `organization_id` leading, composite FK `(organization_id, employee_id)` → `iam.employee`. Every query pins `organization_id`. No cross-tenant reads. `make lint-tenancy` must be green. | PASS by design |
| **II. Scenario-First Integration & E2E Testing** | Backend `t.Run` scenario stubs derived from US1–US3 and FR-001 – FR-025 are written and approved **before** `/speckit-tasks`. Web E2E covers the same contract from the browser; Maestro covers it on device. See [contracts/test-scenarios.md](contracts/test-scenarios.md). | PASS — stubs are a Phase-1 artifact of this plan, awaiting approval |
| **III. Two-Layer Service Architecture & Proto-Level Authorization** | `internal/tour/logic.go` (pure, takes `tx database.DBTX`) and `internal/tour/service.go` (Connect handler, owns `TenantPool`, extracts auth). Both RPCs declare `access_control` with `required_permissions`. **Note**: planning this feature surfaced that the constitution's text still specified an `allowed_roles` option that does not exist in `rbac.proto` and is used by no proto in the repository — a service written to its letter would not compile. Corrected in constitution **v5.19.0**; this plan follows the corrected text. | PASS |
| **IV. Cross-Domain Integration** | The tour reads permissions from the auth context, not from the IAM service. It does not call another domain's database. Account deletion must sweep `tour_progress`, added to `iam/logic_account_deletion.go` alongside the existing `DeleteUserPreferencesForOrganization` call — a service-method-free, same-schema delete. | PASS by design |
| **V. Observability, Simplicity & YAGNI** | Tour content is Go values, not a table. No authoring UI, no content versioning table, no analytics pipeline. `slog.DebugContext` at tour selection and progress write, `slog.InfoContext` on completion. | PASS |
| **VI. Versioning & Breaking Changes** | Purely additive: a new service, a new table, two new permission ids. Nothing existing changes shape. | PASS |
| **VII. Frontend API Wrapper & Type Safety** | All RPC access goes through `packages/apis/src/tour.ts`; no client calls the generated stub directly. Every interactive element gets `data-testid` (web) / `testID` (mobile). | PASS by design |
| **VIII. Cross-Stack Constant Synchronisation** | `TourTarget` is a proto enum; each client maps it to a route. That map is the one place drift can occur, so each client carries a check that every `TourTarget` value has a route — see [research.md](research.md#target-routing). | PASS with a named guard |
| **IX. UUID v7 & Nullable Cursor Params** | `id UUID DEFAULT uuidv7()`. No pagination — the table is read one row at a time by natural key. | PASS |
| **X. Structured Error Details** | The two RPCs have no domain error conditions beyond auth and invalid arguments; standard Connect codes suffice. No new error-detail proto. | PASS |
| **XI. Distributed-First** | Stateless handlers, no in-memory session state, no new background jobs, no scheduler participation. | PASS |
| **XII. Living Documentation** | `docs/domain/workspace-navigation.md` gains a "Feature tour" section and the README index is updated, in the same change set. | PASS — required at Definition of Done |
| **XIII. Mobile Design & Testing** | Mobile presentation is purpose-built portrait cards, not a rendering of the web component. Both tours get a Maestro flow. **The administrator tour on mobile needs an explicit justification — see Complexity Tracking.** | PASS with justification |

**No unjustified violations. One item recorded in Complexity Tracking.**

## Project Structure

### Documentation (this feature)

```text
specs/039-feature-tour/
├── plan.md                        # This file
├── research.md                    # Phase 0 — decisions and rejected alternatives
├── data-model.md                  # Phase 1 — iam.tour_progress and the Go tour values
├── quickstart.md                  # Phase 1 — how to run and validate the feature
├── contracts/
│   ├── tour-service.md            # RPC surface, request/response shapes, authorization
│   ├── tour-content.md            # The two tours, stop by stop, with copy and gating
│   └── test-scenarios.md          # Constitution II behavioural contract (approve before /tasks)
├── checklists/
│   └── requirements.md            # Specification quality checklist (complete)
└── tasks.md                       # Phase 2 — created by /speckit-tasks, not here
```

### Source Code (repository root)

```text
backend/
├── rpc/v1/
│   └── tour.proto                          # NEW — TourService, 2 RPCs, TourTarget enum
├── internal/tour/
│   ├── content.go                          # NEW — the two tours as Go values
│   ├── logic.go                            # NEW — selection, filtering, platform adaptation, progress
│   └── service.go                          # NEW — Connect handlers
├── internal/iam/
│   └── logic_account_deletion.go           # EDIT — sweep tour_progress on org/account deletion
├── database/
│   ├── migrations/
│   │   └── 20260902000001_feature_tour.up.sql   # NEW — table + 2 permissions + role grants
│   └── scripts/
│       ├── tour.query.sql                  # NEW — get, upsert, delete-for-org
│       └── schema.sql                      # REGENERATED — never hand-edited
├── cmd/server.go                           # EDIT — register TourService
└── integration/
    └── feature_tour_test.go                # NEW — behavioural contract

frontend/
├── packages/apis/src/
│   ├── tour.ts                             # NEW — typed wrapper over TourService
│   └── index.ts                            # EDIT — export it
├── apps/web/src/
│   ├── components/tour/
│   │   ├── FeatureTour.tsx                 # NEW — the card sequence, dialog-based
│   │   └── useFeatureTour.ts               # NEW — fetch, offer decision, progress writes
│   ├── app/workspace/layout.tsx            # EDIT — mount the tour after auth and gates
│   ├── components/UserMenu.tsx             # EDIT — "Take the tour" entry point
│   └── lib/tour-routes.ts                  # NEW — TourTarget → web path
└── apps/mobile/src/
    ├── components/feature-tour.tsx         # NEW — portrait card sheet
    ├── hooks/use-feature-tour.ts           # NEW — same decision logic, mobile presentation
    ├── app/(app)/_layout.tsx               # EDIT — mount after TermsGate
    ├── app/(app)/(more)/index.tsx          # EDIT — "Take the tour" row in the App group
    ├── lib/tour-routes.ts                  # NEW — TourTarget → Expo route
    └── .maestro/feature-tour/
        ├── owner-tour.yaml                 # NEW
        └── worker-tour.yaml                # NEW

docs/domain/
├── workspace-navigation.md                 # EDIT — Feature tour section
└── README.md                               # EDIT — index row
```

**Structure Decision**: The repository's established three-surface layout — a Go domain
package under `backend/internal/`, a proto contract under `backend/rpc/v1/`, a typed wrapper
in `frontend/packages/apis/src/`, and separate purpose-built UI in `apps/web` and
`apps/mobile`. `internal/tour` is a new sibling of `internal/preference`, which it closely
resembles in size and shape and is the model to copy.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| **Constitution XIII: an owner-facing surface on mobile.** Principle XIII says the mobile app targets employees and that owners and operators must use the web app for configuration and administration. This feature puts the administrator tour on the phone. | The repository owner decided this explicitly during specification: owners of small businesses operate from the floor, not a desk, and mobile is progressively gaining the product's most important features. The rule's intent is preserved because the tour is not an administrative capability — it is orientation. FR-023 requires every stop covering true administration (bulk import, role editing, department management, storage quota) to say it is done on the web and to offer no action on mobile, so the carve-out adds no administrative surface to the phone. | Owner-tour-on-web-only was offered as an option and rejected. It would leave an owner who lives in the mobile app with no in-product orientation at all, which is precisely the person the feature exists for. The distinction that actually holds is administration versus day-to-day operation, not owner versus worker. |
| **A new `internal/tour` domain rather than two RPCs bolted onto `PreferenceService`.** | `PreferenceService` is "what the user chose"; tour progress is "what the user has seen", and the tour also serves content, which is not a preference at all. Adding it there would make one service two unrelated things and put a second domain's table behind the preference queries. | Extending `PreferenceService` saves roughly two files. It was rejected because the resulting surface would be the kind of accumulated-patch shape that is expensive to unpick later, and because the new domain is genuinely small — one query file, one migration, ~300 lines of Go. |

## Phase Status

- [x] Phase 0 — research complete → [research.md](research.md)
- [x] Phase 1 — design complete → [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)
- [x] Constitution re-checked after design — no new violations
- [ ] **Behavioural contract approval** — [contracts/test-scenarios.md](contracts/test-scenarios.md) must be reviewed and approved before `/speckit-tasks` (Constitution II)
- [x] Phase 2 — `/speckit-tasks` → [tasks.md](tasks.md), 43 tasks
- [x] `/speckit-analyze` — 13 findings, all addressed; constitution amended to v5.19.0 for the one CRITICAL
- [ ] Phase 3 — `/speckit-implement`
