---
description: "Task list for feature 039 — Feature Tour"
---

# Tasks: Feature Tour

**Input**: Design documents from `/specs/039-feature-tour/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/)

**Tests**: **Mandatory, not optional.** Constitution II is non-negotiable in this repository:
every User Story and every user-observable FR needs a backend integration scenario, every
UI-visible behaviour needs a web E2E scenario, and Constitution XIII requires a Maestro flow
for every mobile surface. The scenario stubs in
[contracts/test-scenarios.md](contracts/test-scenarios.md) are the approved behavioural
contract; T014 writes them as failing stubs before any implementation begins.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 (administrator tour), US2 (worker tour), US3 (on-demand replay)

## Path Conventions

Three surfaces, per [plan.md](plan.md#project-structure): Go backend under `backend/`, shared
client wrapper in `frontend/packages/apis/`, and separate purpose-built UI in
`frontend/apps/web/` and `frontend/apps/mobile/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The contract and the schema — everything downstream is generated from or depends on these.

- [ ] T001 Create `backend/rpc/v1/tour.proto` with `TourService` (`GetTour`, `UpdateTourProgress`), the `TourPlatform`, `TourAudience`, `TourStatus` and `TourTarget` enums, and the `TourStop` / request / response messages exactly as specified in [contracts/tour-service.md](contracts/tour-service.md), including the `access_control` options declaring `tour.view` and `tour.update`
- [ ] T002 Create migration `backend/database/migrations/20260902000001_feature_tour.up.sql` creating `iam.tour_progress` per [data-model.md](data-model.md#iamtour_progress) — composite PK `(organization_id, id)`, unique `(organization_id, employee_id, tour_id)`, composite FK to `iam.employee (organization_id, id)` with `ON DELETE CASCADE`, and the three CHECK constraints — plus `INSERT`s adding `tour.view` and `tour.update` to `public.permission` and granting both to the `owner`, `operator` and `employee` templates in `public.default_role_permission`
- [ ] T003 Create `backend/database/scripts/tour.query.sql` with `GetTourProgress :one`, `UpsertTourProgress :one` and `DeleteTourProgressForOrganization :exec`, every query pinning `organization_id` to a parameter
- [ ] T004 Apply and regenerate: `cd backend && ./scripts/migrate.sh && ./scripts/regen-schema.sh && sqlc generate` — `backend/database/scripts/schema.sql` is a generated snapshot and must never be hand-edited (depends on T002, T003)
- [ ] T005 Run `cd backend && buf generate` to produce `backend/rpc/v1/tour.pb.go`, the `rpcv1connect` handler, and `frontend/packages/rpc/rpc/v1/tour_pb.ts` (depends on T001)
- [ ] T006 Export the generated module by adding `tour` to the imports and the export list in `frontend/packages/rpc/index.ts` (depends on T005)
- [ ] T007 Run `make lint-tenancy` and confirm it is green for the new table and query file (depends on T004)

**Checkpoint**: Contract and schema exist; both stacks can compile against them.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The server-driven core. **Every user story is a client rendering of what this phase returns**, so nothing in Phase 3+ can start until it is done.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T008 Create `backend/internal/tour/content.go` defining the `Tour` and `Stop` structs per [data-model.md](data-model.md#tour-definitions--internaltourcontentgo), the `contentVersion` constant `"2026-09-02.1"`, and both tours with the exact copy, targets, required permissions and `WebOnly`/`MobileNote` values from [contracts/tour-content.md](contracts/tour-content.md)
- [ ] T009 Create `backend/internal/tour/logic.go` implementing the pure logic layer (accepts `tx database.DBTX`, pool-agnostic, per Constitution III): audience selection on `iam.inviteUser`, permission filtering, mobile adaptation of web-only stops, re-indexing of the filtered list, **clamping the stored position to the filtered list on read without writing the clamped value back** (FR-015a, see [contracts/tour-service.md](contracts/tour-service.md)), and progress read/upsert with `slog.DebugContext` at selection and write and `slog.InfoContext` on completion (depends on T004, T008)
- [ ] T010 Create `backend/internal/tour/service.go` implementing the Connect handlers — extract org and employee from the auth context, read the permission set via `interceptor.UserPermissionsFromContext`, own the `TenantPool`, and translate errors to the Connect codes in [contracts/tour-service.md](contracts/tour-service.md#errors) (depends on T005, T009)
- [ ] T011 Register the service in `backend/cmd/server.go` alongside the existing preference registration at lines 266–270 (depends on T010)
- [ ] T012 Add `DeleteTourProgressForOrganization` to the organization teardown in `backend/internal/iam/logic_account_deletion.go`, next to the existing `DeleteUserPreferencesForOrganization` call at line 215 (depends on T004)
- [ ] T013 [P] Create `frontend/packages/apis/src/tour.ts` exposing `getTour(platform)` and `updateTourProgress(status, currentStop)` with proto enums converted to string unions in the style of `preference.ts`, add `tourClient` to `frontend/packages/apis/src/rpc.ts`, and export the module from `frontend/packages/apis/src/index.ts` (depends on T006)
- [ ] T014 Create `backend/integration/feature_tour_test.go` containing every `t.Run` scenario from [contracts/test-scenarios.md](contracts/test-scenarios.md#backend--backendintegrationfeature_tour_testgo) as stubs with their `// FR-XXX` traceability comments, using the `testWorld` pattern with `withOwner()` and `withEmployee()`. **Confirm they fail before writing any handler behaviour** (depends on T005)
- [ ] T015 [P] Create `TestTourPermissionIdsExist` in `backend/integration/feature_tour_test.go` asserting that every permission id referenced by `content.go` exists in `public.permission` and that `iam.inviteUser` is absent from the employee role template. This is the only guard against a later permission rename silently flipping the audience or hiding a stop — the ids are bare strings with no compile-time check (depends on T008, T014)
- [ ] T016 Fill in the backend scenario implementations until `make test-backend-one T=TestFeatureTour` passes, covering audience selection, permission filtering, platform adaptation, the offer rule, progress persistence and idempotency, cross-platform non-re-offer, restart, malformed-request rejection, cross-tenant isolation and organization teardown (depends on T010, T011, T012, T014)

**Checkpoint**: The whole feature works over RPC and is proven by the behavioural contract — including audience selection, the permission-change clamp and the permission-id guard. The clients are now presentation only.

---

## Phase 3: User Story 1 — Administrator tour (Priority: P1) 🎯 MVP

**Goal**: An owner is offered, can walk, can leave, can resume and can finish the six-stop administrator tour — on web and on mobile, with the web-only stop adapted on the phone.

**Independent Test**: Register a new organization, sign in as the owner on web and on mobile. The tour is offered on both; each stop opens a real surface; the "Get your team in" stop on mobile says the work is done on the web and offers no action; leaving and returning resumes at the same stop; finishing it stops the automatic offer on both platforms.

### Tests for User Story 1

- [ ] T017 [P] [US1] Create `frontend/apps/web/e2e/feature-tour.spec.ts` with the US1 and accessibility scenarios from [contracts/test-scenarios.md](contracts/test-scenarios.md#web-e2e--frontendappswebe2efeature-tourspects) as failing specs
- [ ] T018 [P] [US1] Create `frontend/apps/mobile/.maestro/feature-tour/owner-tour.yaml` with the four owner-tour flows from [contracts/test-scenarios.md](contracts/test-scenarios.md#mobile--frontendappsmobilemaestrofeature-tour)

### Implementation for User Story 1

- [ ] T019 [P] [US1] Create `frontend/apps/web/src/lib/tour-routes.ts` mapping every `TourTarget` value to a web path, with a colocated exhaustiveness test that fails when a new enum value has no route (Constitution VIII drift guard, see [research.md](research.md#target-routing)). Per FR-013a, the project, ritual and docs routes must land with the create action visible rather than on an empty list, and the ritual route must fall back to project creation when the workspace has no project yet
- [ ] T020 [P] [US1] Create `frontend/apps/mobile/src/lib/tour-routes.ts` mapping every `TourTarget` value to an Expo route, with the same exhaustiveness check and the same FR-013a landing rules
- [ ] T021 [P] [US1] Create `frontend/apps/web/src/components/tour/useFeatureTour.ts` — fetch the tour, decide whether to show the offer, advance/retreat/dismiss/complete, and write progress on each transition through `packages/apis/src/tour.ts`. Acting on a stop closes the tour and navigates; returning to the workspace reopens it at the stored stop with no prompt and no extra progress write (FR-012) (depends on T013)
- [ ] T022 [P] [US1] Create `frontend/apps/mobile/src/hooks/use-feature-tour.ts` with the same responsibilities for mobile, including the same close-on-action and reopen-on-return behaviour (FR-012) (depends on T013)
- [ ] T023 [US1] Create `frontend/apps/web/src/components/tour/FeatureTour.tsx` — a dialog-based card sequence with next, previous, a visible "stop N of M" indicator and a dismiss control on every card, no anchoring or highlighting of any live element (FR-018), full keyboard operation with a working Escape and no focus trap, ARIA announcement of the stop position, and `data-testid` on every interactive element (depends on T019, T021)
- [ ] T024 [US1] Create `frontend/apps/mobile/src/components/feature-tour.tsx` — a purpose-built portrait card sheet sharing no code with the web component (FR-025), large tap targets, readable and dismissible at 360 dp, screen-reader announcement of stop position, and `testID` on every interactive element (depends on T020, T022)
- [ ] T025 [US1] Mount the tour in `frontend/apps/web/src/app/workspace/layout.tsx` so it renders only after authentication and the terms gate, never while a pending deep-link redirect is being followed, and never before the workspace itself has painted (FR-008, FR-013) (depends on T023)
- [ ] T026 [US1] Mount the tour in `frontend/apps/mobile/src/app/(app)/_layout.tsx` inside `TermsGate` and after the onboarding redirect, with the same deep-link rule (FR-008, FR-013) (depends on T024)
- [ ] T027 [US1] Make the web E2E and Maestro owner flows pass: `npx playwright test --config=e2e/playwright.config.ts feature-tour` from `frontend/apps/web` (note: the `make test-frontend-one` target is broken — drift register D36), and `maestro test .maestro/feature-tour/owner-tour.yaml` from `frontend/apps/mobile` (depends on T017, T018, T025, T026)

**Checkpoint**: US1 is fully functional on both platforms and independently demonstrable. **This is the MVP** — US2 is the same components serving a different tour, which the server already returns.

---

## Phase 4: User Story 2 — Worker tour (Priority: P1)

**Goal**: A worker signing in for the first time is offered the four-stop worker tour, in plain language, mentioning nothing they cannot do.

**Independent Test**: Create an org-managed PIN account, sign in as that worker on mobile and on web. The worker tour is offered on both — not the administrator tour — its stops cover Today, evidence, chat and alerts, dismissing it stops the automatic offer, and no stop references a capability that worker lacks.

**Note on cost**: the server already selects and filters this tour (T009) and the clients already render whatever they are given (T023, T024). This phase is verification plus the differences that only show up with a worker account.

### Tests for User Story 2

- [ ] T028 [P] [US2] Create `frontend/apps/mobile/.maestro/feature-tour/worker-tour.yaml` with the five worker-tour flows from [contracts/test-scenarios.md](contracts/test-scenarios.md#mobile--frontendappsmobilemaestrofeature-tour), including the PIN-gate scenario that proves the tour waits for a mandatory gate
- [ ] T029 [P] [US2] Add the US2 worker scenario to `frontend/apps/web/e2e/feature-tour.spec.ts` (depends on T017)

### Implementation for User Story 2

- [ ] T030 [US2] Verify the worker path end to end on both clients and fix what only a permission-limited account reveals — stops omitted by filtering must leave no gap in the "stop N of M" indicator, and no administrator copy may leak into the worker sequence (depends on T027)
- [ ] T031 [US2] Make the worker flows pass: `maestro test .maestro/feature-tour/worker-tour.yaml` and the web worker spec (depends on T028, T029, T030)

**Checkpoint**: Both tours work on both platforms, each serving the correct audience.

---

## Phase 5: User Story 3 — On-demand replay (Priority: P2)

**Goal**: Anyone can start the tour for their current role from Help, whether or not they previously dismissed or completed it.

**Independent Test**: As a person who has dismissed the tour, open the help entry point on each platform and start the tour; it runs from the first stop. Change that person's role and run it again; they get the sequence matching their current permissions.

### Tests for User Story 3

- [ ] T032 [P] [US3] Add the US3 replay scenarios to `frontend/apps/web/e2e/feature-tour.spec.ts` (depends on T017)
- [ ] T033 [P] [US3] Add the More → Take the tour flow to `frontend/apps/mobile/.maestro/feature-tour/worker-tour.yaml` (depends on T028)

### Implementation for User Story 3

- [ ] T034 [P] [US3] Add a "Take the tour" entry to `frontend/apps/web/src/components/UserMenu.tsx` that restarts the tour by writing `IN_PROGRESS` at stop 0 and opening it (depends on T023)
- [ ] T035 [P] [US3] Add a "Take the tour" row to the App group in `frontend/apps/mobile/src/app/(app)/(more)/index.tsx`, beside the existing Help row, doing the same (depends on T024)
- [ ] T036 [US3] Make the replay scenarios pass on both platforms (depends on T032, T033, T034, T035)

**Checkpoint**: All three user stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T037 [P] Add a "Feature tour" section to `docs/domain/workspace-navigation.md` covering both tours, server-driven selection and filtering, the web-only stop adaptation, and where progress is stored — and delete nothing that is still true (Constitution XII, and `docs/domain/` is the record of behaviour)
- [ ] T038 [P] Update the index table in `docs/domain/README.md`, and add a drift-register row for anything that shipped differently from [plan.md](plan.md)
- [ ] T039 Run the accessibility checks in [quickstart.md](quickstart.md#accessibility-check-fr-019-sc-006) by hand on both platforms — keyboard-only on web, VoiceOver or TalkBack on mobile. SC-006 is not satisfied by the automated specs alone
- [ ] T040 Verify the whole tour renders without clipping at 360 dp portrait on a mid-range Android device, per Constitution XIII and SC-008
- [ ] T041 Run the full suites — `make test-backend` and `make test-frontend`, not just the new specs — plus `make lint-tenancy`. The Definition of Done is zero failures across the entire suite
- [ ] T042 **Capture the pre-tour production baseline before release** — the share of workspaces with at least one ritual definition within seven days of registration (SC-003) and the share of first-week workers submitting at least one piece of evidence (SC-004), recorded with the date and the query used. This is the only item in this feature that cannot be done afterwards: once the tour ships there is no un-toured population left to compare against. Not a code change; assign it to whoever owns the release
- [ ] T043 Walk [quickstart.md](quickstart.md) end to end on a clean database to confirm the documented path actually works for someone who was not here

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies. T001–T003 are independent of each other; T004–T007 consume them.
- **Foundational (Phase 2)**: depends on Setup. **Blocks every user story.** This is where the feature actually lives.
- **US1 (Phase 3)**: depends on Foundational. The MVP.
- **US2 (Phase 4)**: depends on US1 — it reuses US1's components rather than adding its own. Both are P1; US1 is sequenced first because it builds the shared UI.
- **US3 (Phase 5)**: depends on US1's components existing. Independent of US2.
- **Polish (Phase 6)**: depends on the stories you intend to ship.

### Within Each User Story

Route maps and hooks before components; components before mounting; mounting before the E2E and Maestro flows can pass. Test files are written first and must fail.

### Parallel Opportunities

- **Phase 1**: T001, T002 and T003 in parallel — three different files, no shared state.
- **Phase 2**: T013 (client wrapper) runs alongside T008–T012 once T006 lands; it touches no Go file.
- **Phase 3**: T019/T020 (route maps) and T021/T022 (hooks) are four independent files; T017/T018 (test files) are independent of all of them.
- **Phase 5**: T034 and T035 are different apps entirely.
- **Across stories**: US2 and US3 can proceed in parallel once US1 completes, by different people.

The honest limit: web and mobile UI are the only genuinely parallel work here, because the backend is a single small package that one person finishes faster than two coordinate over.

---

## Parallel Example: Phase 3 (User Story 1)

```bash
# The four independent client files, once T013 has landed:
Task: "Create frontend/apps/web/src/lib/tour-routes.ts with exhaustiveness test"
Task: "Create frontend/apps/mobile/src/lib/tour-routes.ts with exhaustiveness test"
Task: "Create frontend/apps/web/src/components/tour/useFeatureTour.ts"
Task: "Create frontend/apps/mobile/src/hooks/use-feature-tour.ts"

# The two test files, written first and expected to fail:
Task: "Create frontend/apps/web/e2e/feature-tour.spec.ts"
Task: "Create frontend/apps/mobile/.maestro/feature-tour/owner-tour.yaml"
```

---

## Implementation Strategy

### MVP scope

**Phases 1 + 2 + 3 — through T027.** That delivers the administrator tour on both platforms,
which is the story with the highest leverage: an owner who never defines a ritual has a
workspace that does nothing, and the rest of the product's value is downstream of that one
person understanding it.

Phase 2 is unusually large relative to the story phases, and that is the design working as
intended — the server does the selection, filtering and adaptation once, so US2 costs two
verification tasks instead of a second implementation.

### Incremental delivery

1. Phases 1 + 2 → the feature exists over RPC and is proven by `TestFeatureTour`
2. Phase 3 → administrator tour on web and mobile → **ship the MVP**
3. Phase 4 → worker tour → ship
4. Phase 5 → replay from Help → ship
5. Phase 6 → docs, accessibility, full suites

### Before release, not implementation work

**T042 is the one task with a hard deadline and no second chance.** SC-003 and SC-004 are
increases against a pre-tour baseline, and once the tour ships there is no un-toured
population left to measure. It is not a code change, so it is easy to skip; skipping it makes
two of the eight success criteria permanently unevaluable.

---

## Notes

- Tests are mandatory here, not the template's optional extra — Constitution II is
  non-negotiable and Constitution XIII requires a Maestro flow per mobile surface.
- The tour copy in [contracts/tour-content.md](contracts/tour-content.md) is the real
  user-visible deliverable. If it changes during implementation, change it there first — it
  is the reviewed artifact, and T008 transcribes it.
- `backend/database/scripts/schema.sql` is generated. Regenerate it; never edit it.
- Commit after each task or logical group. Stop at any checkpoint to validate a story on its own.
