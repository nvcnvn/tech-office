# Tasks: Team block on mobile Today

**Input**: Design documents from `/specs/047-owner-today-team-block/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/collaboration-team-attention.proto](contracts/collaboration-team-attention.proto),
[quickstart.md](quickstart.md)

**Tests**: Test tasks ARE included. Constitution II makes the integration suite the
behavioural contract for this feature, and [quickstart.md](quickstart.md#the-behavioural-contract-constitution-ii)
already enumerates the scenarios as `t.Run` stubs to be written before implementation.

**Organization**: Tasks are grouped by user story so each story can be implemented and
verified independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Every task names the exact file it touches

## Path Conventions

Monorepo: Go API service in `backend/`, mobile client in `frontend/apps/mobile/`, shared API
wrapper in `frontend/packages/apis/`, generated RPC clients in `frontend/packages/rpc/`.

## Resolved ambiguities

The plan left three details to implementation. Each is resolved here so no task blocks:

- **[ASSUMPTION: the integration test file is `backend/integration/collaboration_team_attention_test.go`,
  not `backend/integration/team_attention_test.go` as plan.md names it.]** Every existing
  collaboration integration suite in that directory is prefixed `collaboration_`
  (`collaboration_evidence_review_queue_test.go`, `collaboration_ritual_instance_test.go`,
  `context_rail_test.go` being the one exception). Matching the dominant convention keeps the
  suite next to its siblings in a directory listing.
- **[ASSUMPTION: `EmployeeNameLookup` is injected into `logicImpl` through a new
  `SetEmployeeNameLookup(EmployeeNameLookup)` setter, wired in `backend/cmd/server.go` with
  `orgLogic`, and the logic tolerates a nil lookup by falling back to empty display names.]**
  `EmployeeNameLookup` exists today (`preview_logic.go:18`) but is only passed to
  `NewTaskPreviewProvider`; `logicImpl` has no field for it. Widening `NewLogic`'s signature
  would touch ~10 call sites in `helper_test.go` and the shift-assignment tests for no
  behavioural gain, whereas a setter is exactly the pattern `SetShiftCoverageReader` already
  established for a dependency wired after construction. Nil tolerance is required because
  those same test constructors legitimately pass no organization logic, and because a row must
  never be dropped for want of a resolvable name (spec edge case, research Decision 5).
- **[ASSUMPTION: `supervised_project_count` and the `LIMIT @count_cap` bound are written into
  `CountTeamAttention` in User Story 1 rather than deferred to their nominal stories (US3,
  US4).]** `can_supervise` is defined as "holds the permission AND supervises ≥ 1 project"
  (data-model.md), so US1 cannot render or hide the block without the project count; and the
  count cap is a single `LIMIT` inside the counted subquery, so writing the query twice would
  cost more than writing it once. US3 and US4 therefore own the *client-visible* behaviour
  (the all-clear message, the capped flags, the expand control) rather than re-editing SQL.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the generate/lint/test toolchain is working before touching the contract

- [X] T001 Verify the local toolchain and a clean baseline: `make check-postgres`, then `cd backend && buf generate && sqlc generate && git diff --exit-code` (generated output must already match the tree), then `make lint-tenancy` green. No file is changed by this task; a dirty diff here means a pre-existing generation drift that must be resolved before the contract change lands on top of it.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The contract, its generated clients, and the empty end-to-end path — everything
every user story needs before any of them can list a single row

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 Add the `TeamAttentionCategory` enum, the `GetTeamAttentionSummaryRequest`, `TeamAttentionItem` and `GetTeamAttentionSummaryResponse` messages, and the `GetTeamAttentionSummary` RPC with `option (rpc.v1.access_control) = {};` to `backend/rpc/v1/collaboration.proto`, copying the declarations verbatim from `specs/047-owner-today-team-block/contracts/collaboration-team-attention.proto`. Place the RPC immediately after `GetEvidenceReviewQueueCount` (proto line ~533) and the messages beside `GetEvidenceReviewQueueCountResponse` (line ~2262). Keep the contract file's comments — the empty `access_control` block is deliberate and must carry its justification in the source.
- [X] T003 Regenerate the wire clients: `cd backend && buf generate`, producing the Go stubs under `backend/rpc/v1/` and the TypeScript client under `frontend/packages/rpc/`. Commit the generated output; do not hand-edit it.
- [X] T004 Add an `employeeNames EmployeeNameLookup` field and a `SetEmployeeNameLookup(EmployeeNameLookup)` setter to `logicImpl` in `backend/internal/collaboration/logic.go`, documented like `SetShiftCoverageReader` (injected after construction, legitimately nil in seeders and tests), and declare `SetEmployeeNameLookup` on the `Logic` interface.
- [X] T005 Wire the lookup in `backend/cmd/server.go`: call `collaborationLogic.SetEmployeeNameLookup(orgLogic)` beside the existing `collaborationLogic.SetShiftCoverageReader(calendarLogic)` (line ~546). `orgLogic` (line 153) already satisfies the interface — it is the same value passed to `collaboration.NewTaskPreviewProvider` at line 521.
- [X] T006 Add `GetTeamAttentionSummary(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.GetTeamAttentionSummaryRequest) (*rpcv1.GetTeamAttentionSummaryResponse, error)` to the `Logic` interface in `backend/internal/collaboration/logic.go`, beside the two evidence-review-queue entries (line ~266).
- [X] T007 Create `backend/internal/collaboration/team_attention_logic.go` with the bounds constants (`defaultTeamAttentionLimit = 5`, `maxTeamAttentionLimit = 20`, `teamAttentionCountCap = 100`, each carrying the research Decision 7 rationale), a `clampTeamAttentionLimit` helper, a `parseAsOfDate` helper that returns the server's current date for an absent or empty value and `InvalidArgument` with a `google.rpc.BadRequest` field violation on `as_of_date` for an unparseable one (Constitution X), and a `GetTeamAttentionSummary` method that currently returns `&rpcv1.GetTeamAttentionSummaryResponse{}`.
- [X] T008 Add the `GetTeamAttentionSummary` handler to `backend/internal/collaboration/ritual_connect.go`, immediately after `GetEvidenceReviewQueueCount` (line ~491), following that handler exactly: extract auth → read `collab.reviewEvidence` from `interceptor.UserPermissionsFromContext` and return an empty `GetTeamAttentionSummaryResponse{}` (never `PERMISSION_DENIED`) when it is absent (FR-002) → `txn.WithTxn` → delegate to `s.Logic.GetTeamAttentionSummary`.
- [X] T009 Add the two test-world helpers to `backend/integration/helper_test.go`: `createRitualInstance(...)` building a `task_kind = 'ritual_instance'` task with a `scheduled_date` and `completion_deadline`, and `getTeamAttentionSummary(actor, asOfDate, limit)` calling the new RPC through the connect handler. Model both on the existing `createTask` / review-queue helpers in the same file.
- [X] T010 Create `backend/integration/collaboration_team_attention_test.go` containing `TestTeamAttentionSummary` with every `t.Run` scenario from [quickstart.md](quickstart.md#the-behavioural-contract-constitution-ii) written as a named, empty (or `t.Skip`ped) stub in the listed order. This file is the reviewable behavioural contract and MUST exist before any query is written; `make test-backend-one T=TestTeamAttentionSummary` must run and report the stubs.
- [X] T011 Add the `getTeamAttentionSummary` wrapper and its native types (`TeamAttentionSummary`, `TeamAttentionItem`, and the category union) to `frontend/packages/apis/src/collaboration.ts`, mapping proto → native (proto enum → `"overdue" | "unassigned"`, `optional string as_of_date` / `optional string due_date` → `string | undefined`) and routing errors through `rpcWrapper` as its neighbours do. Export it from `frontend/packages/apis/src/index.ts` if the file is not already re-exported there.

**Checkpoint**: The RPC exists end to end, returns an empty summary, and the mobile app can
call it. No row is listed yet, and nothing renders.

---

## Phase 3: User Story 1 - The owner sees what the team is late on (Priority: P1) 🎯 MVP

**Goal**: A supervisor opening Today sees a Team block listing every overdue, still-open
ritual instance across the projects they own or administer, with its title, project and
assignee, and can tap through to the instance. Everyone else sees the screen exactly as it is
today.

**Independent Test**: Sign in as a project owner with a ritual instance recorded as overdue in
a supervised project but assigned to somebody else, open Today, confirm the Team block lists
it with the assignee's name and that tapping it opens the instance. Sign in as an account that
supervises nothing and confirm no Team block, heading, placeholder or empty row is rendered.

### Tests for User Story 1 ⚠️

> Fill in these stubs before writing the query; each must fail before T016 lands.

- [X] T012 [US1] Implement the overdue and scope scenarios in `backend/integration/collaboration_team_attention_test.go`: lists the overdue instance with title, project and assignee name (US1-1, FR-006, FR-011); returns the project *name*, not an identifier fragment (FR-011); orders the longest-late instance first (FR-012); `can_supervise = false` with no items and no error when the caller supervises nothing (US1-3, FR-001, FR-002); empty summary rather than `PERMISSION_DENIED` when the caller lacks `collab.reviewEvidence` (FR-002).
- [X] T013 [US1] Implement the exclusion scenarios in `backend/integration/collaboration_team_attention_test.go`: a viewer's project is omitted from items *and* counts (FR-004); another organization's instance is never returned (FR-005); an instance assigned to the caller is excluded (US1-4, FR-009); a closed-state instance is excluded from both categories and both counts (US1-5, FR-008); soft-deleted, detached and archived-project instances are excluded (edge cases).
- [X] T014 [P] [US1] Implement the assignee-resolution scenarios in `backend/integration/collaboration_team_attention_test.go`: an archived or departed assignee still yields the row rather than dropping it (edge case); an instance with several assignees names one and reports `additional_assignee_count` for the rest (edge case).

### Implementation for User Story 1

- [X] T015 [US1] Add `CountTeamAttention :one` to `backend/database/scripts/collaboration.query.sql` per [data-model.md](data-model.md#query-contracts): `overdue_count` as `COUNT(*)` over a `LIMIT @count_cap` subquery carrying the shared base predicate plus `ps.category = 'overdue'`, a placeholder `unassigned_count` of `0` (US2 adds its leg), and `supervised_project_count` as the number of distinct non-archived projects where the caller is `owner`/`admin`. Every join composite and organization-pinned (`(a.organization_id, a.fk) = (b.organization_id, b.id)`) per Constitution I.
- [X] T016 [US1] Add `ListTeamAttentionItems :many` to `backend/database/scripts/collaboration.query.sql` with the overdue leg only: base predicate + `ps.category = 'overdue'`, `attention_rank` literal `0`, `sort_date` from `t.completion_deadline::date`, `primary_assignee_id` from a `LEFT JOIN LATERAL … ORDER BY ta.assigned_at, ta.id LIMIT 1` COALESCEd to the nil UUID, `assignee_count` from a correlated sub-select (both copied from `ListTaskPreviews`), `LIMIT @item_limit`, ordered `attention_rank ASC, sort_date ASC NULLS LAST, task_id ASC`.
- [X] T017 [US1] Run `cd backend && sqlc generate` and commit the regenerated `backend/database/collaboration.query.sql.go`. Do not hand-edit it (`backend/database/scripts/schema.sql` is untouched — this feature adds no migration).
- [X] T018 [US1] Implement `GetTeamAttentionSummary` in `backend/internal/collaboration/team_attention_logic.go`: call `CountTeamAttention`, set `can_supervise = permissionHeld && supervised_project_count > 0` (the handler passes the permission result through), return early with `can_supervise = false` and no items when scope is empty, otherwise call `ListTeamAttentionItems` with the clamped limit.
- [X] T019 [US1] Resolve display names in `backend/internal/collaboration/team_attention_logic.go`: collect every non-nil `primary_assignee_id` from the returned rows, make **one** batched `l.employeeNames.ListEmployeeNames` call for the whole response (never a per-row lookup, never a cross-schema SQL join — Constitution IV, research Decision 5), and map rows to `TeamAttentionItem`s. An unresolved id leaves `assignee_display_name` absent and **keeps the row**; a nil `employeeNames` behaves the same way. `additional_assignee_count = max(assignee_count - 1, 0)`.
- [X] T020 [US1] Run `make lint-tenancy` and `make test-backend-one T=TestTeamAttentionSummary`; both must be green before any client work starts.
- [X] T021 [US1] Add the `TeamSection`, `TeamRow` and section-header components to `frontend/apps/mobile/src/app/(app)/(today)/index.tsx`, styled with `@tech-office/theme-tokens` to match the existing `Section` / `WorkRow`: row shows the instance title, then `projectName · assignee` as the meta line, with `mobileLayout.listRowHeight` tap targets, `testID` `today-section-team` on the header and `today-team-row-<taskId>` on each row, and an `accessibilityLabel` per row reading the title, project and responsibility (FR-021).
- [X] T022 [US1] Add the third `useQuery` (`queryKey: ["today-team", dayKey]`, `queryFn: () => getTeamAttentionSummary({ asOfDate: dayKey, limit: 5 })`) to `TodayScreen` in `frontend/apps/mobile/src/app/(app)/(today)/index.tsx`, declared in the **same render** as the existing work and events queries so the three round trips are concurrent (FR-015, research Decision 8). Render `TeamSection` between the "Running late" section and "Today's schedule", and render **nothing at all** — no heading, no card, no skeleton, no placeholder — when `canSupervise` is false (FR-001, SC-008).
- [X] T023 [US1] Keep the team query out of the screen's whole-screen failure path in `frontend/apps/mobile/src/app/(app)/(today)/index.tsx`: the existing `if (workError || eventsError)` and `if (isWorkLoading || isEventsLoading)` conditions MUST NOT gain the team query. Instead render an inline retry inside the block on `teamError` (`testID` `today-team-retry`) and a `SkeletonList` sized to the block on its own loading state, so a supervisory extra can never blank out the screen a worker depends on (FR-018, FR-022, SC-006).
- [X] T024 [US1] Wire the block into the screen's existing refresh paths in `frontend/apps/mobile/src/app/(app)/(today)/index.tsx` by adding `refetchTeam()` to the `refetchAll` callback that already feeds `useManualRefresh` and `useStreamRecoveryRefresh` — no separate gesture and no separate polling timer (FR-017).
- [X] T025 [US1] Route the row tap in `frontend/apps/mobile/src/app/(app)/(today)/index.tsx` through `todayNavigation('/(app)/(tasks)/${projectId}/task/${taskId}')`, exactly as `WorkRow` does, so the ritual instance opens and back returns to Today with scroll position preserved (FR-019). Tapping an instance whose state has since changed must open normally rather than being blocked (edge case).
- [X] T026 [US1] Extend `frontend/apps/mobile/.maestro/screens/today.yaml` after the existing overview screenshot: assert `today-section-team` visible, screenshot the block, tap the first team row, assert the ritual instance screen, return via `top-level-back-button`. Record in `frontend/apps/mobile/.maestro/.env.example` that the signed-in account must own or administer at least one project holding a seeded overdue instance.

**Checkpoint**: MVP. A supervisor's Today answers "is the store OK" for late work; a worker's
Today is unchanged. `make test-backend-one T=TestTeamAttentionSummary` and
`make test-mobile-one F=screens/today` green.

---

## Phase 4: User Story 2 - The owner sees what nobody is on today (Priority: P1)

**Goal**: The same block also lists ritual instances scheduled for the caller's local date with
nobody holding the assignee role, labelled "Unassigned" rather than shown with a blank name.

**Independent Test**: Create a ritual instance scheduled for today in a supervised project with
no assignee, open Today as the supervisor, confirm it is listed under the Team block labelled
Unassigned. Give it an assignee, pull to refresh, confirm it leaves the block.

### Tests for User Story 2 ⚠️

- [X] T027 [US2] Implement the unassigned scenarios in `backend/integration/collaboration_team_attention_test.go`: an instance scheduled for `as_of_date` with no assignee is listed in the unassigned category (US2-1, FR-006); it carries no assignee name so the client can label it Unassigned (US2-2, FR-011); it leaves the category once assigned (US2-3); an instance scheduled for a future date is not listed (US2-4).
- [X] T028 [P] [US2] Implement the disjointness and date scenarios in `backend/integration/collaboration_team_attention_test.go`: an instance that is both overdue and unassigned appears **once**, under overdue, and is counted once (FR-010); a supplied `as_of_date` scopes the unassigned category to that date and leaves overdue unbounded (edge case); a malformed `as_of_date` returns `InvalidArgument` with a field violation on `as_of_date` (Constitution X).

### Implementation for User Story 2

- [X] T029 [US2] Add the unassigned leg to `CountTeamAttention` in `backend/database/scripts/collaboration.query.sql`, replacing the US1 placeholder: `COUNT(*)` over a `LIMIT @count_cap` subquery with the base predicate plus `ps.category <> 'overdue'`, `t.scheduled_date = @as_of_date` (equality, not `<=`, so next Tuesday stays out), and `NOT EXISTS (task_assignee WHERE role = 'assignee')`. The two legs are mutually exclusive by construction, so neither query needs `DISTINCT` (research Decision 4).
- [X] T030 [US2] Turn `ListTeamAttentionItems` in `backend/database/scripts/collaboration.query.sql` into `(overdue leg LIMIT @item_limit) UNION ALL (unassigned leg LIMIT @item_limit)` with `attention_rank` literal `1` and `sort_date` from `t.scheduled_date` on the unassigned leg, then apply the shared `ORDER BY attention_rank, sort_date NULLS LAST, task_id` to the union. Both legs MUST carry identical base predicates to the count query — FR-004 depends on the two queries differing in nothing but projection and bound.
- [X] T031 [US2] Run `cd backend && sqlc generate`, commit the regenerated `backend/database/collaboration.query.sql.go`, and pass the parsed `as_of_date` and `teamAttentionCountCap` through both query calls in `backend/internal/collaboration/team_attention_logic.go`, mapping `attention_rank` 0 → `TEAM_ATTENTION_CATEGORY_OVERDUE` and 1 → `TEAM_ATTENTION_CATEGORY_UNASSIGNED`. Unassigned rows carry no assignee name and `additional_assignee_count = 0`.
- [X] T032 [US2] Render unassigned rows in `frontend/apps/mobile/src/app/(app)/(today)/index.tsx`: the literal "Unassigned" derived from the row's category — never an empty name and never an id fragment (FR-011) — with a visually distinct meta treatment from a named assignee, and the same treatment in the row's `accessibilityLabel`. `assignee_display_name` absent *with* `additional_assignee_count > 0` is a departed assignee, not an unassigned row, and must not be labelled Unassigned.
- [X] T033 [US2] Confirm the device's local date already flows to the RPC in `frontend/apps/mobile/src/app/(app)/(today)/index.tsx`: the `dayKey` the screen computes with `format(new Date(), "yyyy-MM-dd")` for its query keys is the same value sent as `asOfDate`, so the Team block and the caller's own "Due today" section can never disagree about what "today" means (spec day-boundary assumption).
- [X] T034 [US2] Extend `frontend/apps/mobile/.maestro/screens/today.yaml` to assert an "Unassigned" row is visible in the team block for the seeded supervisor account.

**Checkpoint**: Both P1 stories complete. The block answers both halves of "is the store OK".

---

## Phase 5: User Story 3 - The owner gets an explicit all-clear (Priority: P2)

**Goal**: A supervisor with nothing overdue and nothing unassigned sees the block render an
explicit all-clear naming how many projects it covered, instead of silently vanishing.

**Independent Test**: Sign in as a supervisor of a project whose rituals are all current and
assigned, open Today, confirm the block renders an all-clear naming the project count. Confirm
a non-supervisor still sees nothing at all.

### Tests for User Story 3 ⚠️

- [X] T035 [US3] Implement the all-clear scenario in `backend/integration/collaboration_team_attention_test.go`: a caller who supervises projects with nothing overdue or unassigned gets `can_supervise = true`, `supervised_project_count > 0` and zero counts — distinguishable from the non-supervisor's `can_supervise = false, supervised_project_count = 0` (US3-1, FR-016).

### Implementation for User Story 3

- [X] T036 [US3] Render the all-clear state in `frontend/apps/mobile/src/app/(app)/(today)/index.tsx`: when `canSupervise` is true and both counts are zero, the block renders with its heading and an explicit message naming `supervisedProjectCount` (e.g. "All clear across 3 projects"), pluralised correctly, with an `accessibilityLabel` conveying the same. When `canSupervise` is false, still nothing renders (FR-016, US3-2).
- [X] T037 [US3] Verify in `frontend/apps/mobile/src/app/(app)/(today)/index.tsx` that the existing `isEmpty` / "Nothing due today" `EmptyState` is still computed from the caller's own three feeds only, so it cannot be read as asserting the team is clear, and that it can coexist on screen with a Team block that is showing problems (FR-020, US3-3). No copy change to the existing empty state.

**Checkpoint**: The block is honest on quiet mornings — a healthy team and no supervisory scope
now look different.

---

## Phase 6: User Story 4 - The list stays readable when the backlog is large (Priority: P3)

**Goal**: True totals beside each category, a short default list, in-place expansion to a fixed
ceiling, and a capped figure rather than a false exact one when the backlog exceeds the cap.

**Independent Test**: Seed more overdue instances than the default limit in a supervised
project, open Today, confirm the count reflects the true total, the list shows five, and
expanding shows up to twenty without a noticeable slowdown. Seed past the cap and confirm the
count renders as a capped figure.

### Tests for User Story 4 ⚠️

- [X] T038 [US4] Implement the bounds scenarios in `backend/integration/collaboration_team_attention_test.go`: more matches than the requested limit returns the true count alongside the shortened list (US4-1, FR-013); a requested limit above the ceiling is clamped to 20 rather than rejected (US4-2, FR-013).
- [X] T039 [P] [US4] Implement the cap scenarios in `backend/integration/collaboration_team_attention_test.go`: past the cap the count reports the capped figure and sets the corresponding `*_count_capped` flag, with the two flags independent (100+ overdue and 3 unassigned must not report 3 as capped) (US4-3, FR-014); and a large backlog costs the same as a small one — assert the bound holds by seeding well past the cap and asserting the response is still bounded (SC-005).
- [X] T040 [US4] Add the FR-015 concurrency check to `frontend/apps/mobile/src/app/(app)/(today)/index.tsx` review notes and confirm by reading the render path that all three `useQuery` calls are unconditional and declared before any early return, so none is chained behind another. Quickstart records this as not integration-testable; the check is a code review of the finished screen.

### Implementation for User Story 4

- [X] T041 [US4] Derive `overdue_count_capped` and `unassigned_count_capped` in `backend/internal/collaboration/team_attention_logic.go` as `count >= teamAttentionCountCap`, independently per category, exactly as `GetEvidenceReviewQueueCount` derives `is_capped`.
- [X] T042 [US4] Show the true totals in the block header in `frontend/apps/mobile/src/app/(app)/(today)/index.tsx`, rendering the capped figure as "99+" rather than an exact number when the corresponding flag is set (FR-014), with counts that do not truncate at 360 dp.
- [X] T043 [US4] Add the in-place expand control to `frontend/apps/mobile/src/app/(app)/(today)/index.tsx` (`testID` `today-team-expand`, `mobileLayout.compactRowHeight` tap target, `accessibilityLabel`): expansion refetches the same query with `limit: 20` rather than paging, the total stays visible, and no more than 20 rows per category ever render (FR-013, research Decision 7 — no cursor). Collapse returns to five.

**Checkpoint**: All four stories complete and independently verifiable.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T044 [P] Add a "Team attention summary" subsection under Compliance and health in `docs/domain/rituals-tasks.md` describing the new RPC, its supervisory scope predicate, the two categories, the bounds and the fact that lateness is read from the stored state category rather than computed (Constitution XII).
- [ ] T045 [P] Document the mobile Today team block in `docs/domain/workspace-navigation.md`: who sees it, where it sits between "Running late" and "Today's schedule", what it does not do (no assignment, no bulk action), and that it fails independently of the rest of the screen.
- [ ] T046 [P] Record in the drift register in `docs/domain/README.md` that `ListEvidenceReviewQueue` joins `organization.employee` directly in violation of Constitution IV, that this is pre-existing drift, and that feature 047 deliberately used the `EmployeeNameLookup` interface instead of copying it.
- [ ] T047 Work through the mobile design checklist in [quickstart.md](quickstart.md#mobile-design-checklist) against the built screen: tap-target sizes, plain labels, `testID` on every interactive element, `accessibilityLabel` on every row and control, skeleton parity with the rest of Today, and portrait layout at 360–430 dp verified on **a narrow Android device as well as an iPhone SE** — the responsibility label and the counts must not truncate on either (FR-021, FR-022).
- [ ] T048 Run the definition of done from [quickstart.md](quickstart.md#definition-of-done): `make test-backend-one T=TestTeamAttentionSummary`, then `make test-backend`, `make lint-tenancy`, and `make test-mobile`, all green.
- [ ] T049 Walk the four manual validations in [quickstart.md](quickstart.md#manual-validation) on a device: the owner sees the team's late work and can tap through; the worker sees a screen with no team artefact of any kind; the all-clear renders for a healthy supervisor; and forcing the team query to fail leaves the caller's own day fully rendered with a retry confined to the block.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001)**: no dependencies
- **Foundational (T002–T011)**: needs T001. **Blocks every user story.** Within it: T003 needs T002; T005 needs T004; T007 needs T003 and T006; T008 needs T007; T010 needs T009; T011 needs T003.
- **US1 (T012–T026)**: needs Foundational complete. Delivers the MVP.
- **US2 (T027–T034)**: needs US1's SQL to exist (T015–T017) — it extends the same two queries and the same mobile block. Not independent of US1 in *code*, but independently testable in *behaviour*: the unassigned category can be verified with no overdue instance present.
- **US3 (T035–T037)**: needs US1 (`supervised_project_count` and the block's render path). Independent of US2.
- **US4 (T038–T043)**: needs US1; T039's independent-flags scenario needs US2's unassigned leg.
- **Polish (T044–T049)**: needs every story that is being shipped.

### Within Each User Story

- Test stubs (Phase 2, T010) exist before any query is written — Constitution II
- Scenario implementations before the code that satisfies them
- SQL → `sqlc generate` → Go logic → API wrapper → mobile UI → Maestro
- Backend green (`make test-backend-one`) before client work starts

### Parallel Opportunities

- **T014** runs alongside T012/T013 only if the three authors coordinate on the single test file; otherwise treat the three as sequential edits to `collaboration_team_attention_test.go`.
- **T028** likewise pairs with T027, and **T039** with T038.
- **T044, T045, T046** are three different documentation files and are genuinely parallel.
- **Across stories**: US3 (T035–T037) and US4 (T038–T043) touch mostly disjoint code once US1
  and US2 have landed — the all-clear branch and the counts/expand controls — and can be taken
  by two people in parallel.
- **Not parallel**: everything touching `backend/database/scripts/collaboration.query.sql`
  (T015, T016, T029, T030), `team_attention_logic.go` (T007, T018, T019, T031, T041) or the
  Today screen (T021–T025, T032, T033, T036, T037, T042, T043). One file, sequential edits.

---

## Parallel Example: Polish

```bash
# Three documentation files, no shared lines:
Task: "Add Team attention summary to docs/domain/rituals-tasks.md"
Task: "Document the mobile Today team block in docs/domain/workspace-navigation.md"
Task: "Record the ListEvidenceReviewQueue join in the drift register in docs/domain/README.md"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. T001 (Setup) → T002–T011 (Foundational)
2. T012–T026 (US1)
3. **STOP and VALIDATE**: run quickstart manual validations 1 and 2 — the owner sees the
   team's late work, the worker's screen is unchanged
4. Shippable: Today has become a supervisory screen for late work

### Incremental Delivery

1. Setup + Foundational → the RPC answers, nothing renders
2. + US1 → overdue work visible to supervisors (**MVP**)
3. + US2 → unassigned work visible; both halves of "is the store OK" answered
4. + US3 → the block is trustworthy on quiet mornings
5. + US4 → the block stays readable during a bad week

Each increment leaves the worker's Today untouched, which is the invariant to re-check at
every checkpoint (SC-008).

### Parallel Team Strategy

Foundational is one person's work — it is a contract change and its generated output, and
splitting it creates merge conflicts in generated files. After US1 and US2 land, US3 and US4
can be taken in parallel, and the three Polish documentation tasks by a third.

---

## Notes

- No migration, no new index, no new permission, no new background job, no write path. If a
  task appears to need one, the design has been misread — re-read
  [data-model.md](data-model.md) before adding it.
- Generated files (`backend/database/collaboration.query.sql.go`, `backend/rpc/v1/*.pb.go`,
  `frontend/packages/rpc/`) are committed but never hand-edited; regenerate instead.
- Commit after each task or logical group; stop at any checkpoint to validate a story on its
  own.

---

## Implementation notes

Resolutions made while executing this plan, recorded for review:

- **[ASSUMPTION: the unassigned row's label is "Nobody assigned", not the literal
  "Unassigned" T032 names.]** T032 and the proto comments say "Unassigned"; the mobile design
  checklist in [quickstart.md](quickstart.md#mobile-design-checklist) lists the plain labels as
  *"Team", "Running late in your projects", "Nobody assigned", "All clear"*. The two disagree,
  and the checklist is the one that governs the rendered copy, so "Nobody assigned" wins. The
  proto enum is still the source of the distinction — the label is a client-side lookup either
  way (Constitution VIII), so no cross-stack literal moved. The Maestro assertion in
  `.maestro/screens/today.yaml` asserts the same string.
- **[ASSUMPTION: an unresolvable assignee renders "Assignee unavailable", a third label
  distinct from both a name and "Nobody assigned".]** T032 requires that an absent name with
  `additional_assignee_count > 0` not be labelled Unassigned, but a departed *sole* assignee
  has `additional_assignee_count = 0` and an absent name, which is indistinguishable from an
  unassigned row on those two fields alone. The row's `category` is what actually separates
  them, so the client branches on category and never on the name's absence.
- **[ASSUMPTION: the Team block hides itself during loading and error whenever a previous
  successful response already reported `can_supervise = false`.]** T023 asks for a skeleton and
  an inline retry, and FR-001/SC-008 require that a non-supervisor see no artefact at all. On
  the very first load neither is knowable, so the skeleton renders; once the server has said
  the caller supervises nothing, `TeamSection` returns null for every later loading or error
  state rather than flashing a Team heading at a worker.
