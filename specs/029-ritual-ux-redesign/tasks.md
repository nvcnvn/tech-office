# Tasks: Ritual UX Redesign

**Input**: Design documents from `/specs/029-ritual-ux-redesign/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: This feature requires behavioral validation across backend integration, web E2E, and mobile Maestro coverage because the specification and plan make scenario-driven verification part of the acceptance contract.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g. `[US1]`, `[US2]`)
- Every task includes an exact file path

## Phase 1: Setup (Shared Contracts and Validation Scaffolding)

**Purpose**: Lock the scenario contract and seed the required cross-platform validation assets before changing behavior.

- [X] T001 Finalize the approved scenario contract coverage in `backend/integration/collaboration_ritual_ux_redesign_test.go` and `frontend/apps/web/e2e/ritual-ux-redesign.spec.ts`
- [X] T002 [P] Create the mobile ritual UX redesign Maestro scaffold in `frontend/apps/mobile/.maestro/ritual-ux-redesign.yaml`
- [X] T003 [P] Update manual validation steps, rollout measurement notes, and fixture expectations in `specs/029-ritual-ux-redesign/quickstart.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build the shared routing, read-model, and deep-link infrastructure that all user stories depend on.

**⚠️ CRITICAL**: No user story work should start until this phase is complete.

- [X] T004 Create the mode-aware surface resolver and tab definitions in `frontend/apps/web/src/app/workspace/projects/[id]/project-surfaces.ts`
- [X] T005 [P] Expand shared collaboration view typing for overview, worklist, review, and health routing in `frontend/packages/apis/src/collaboration.ts`
- [X] T006 [P] Add mixed overview and ritual worklist wrapper helpers in `frontend/packages/apis/src/collaboration-ritual.ts`
- [X] T007 Add additive collaboration read-model aggregation for mixed overview summaries and ritual worklist data in `backend/internal/collaboration/view_logic.go`
- [X] T008 Expose the ritual UX read-model helpers through collaboration handlers in `backend/internal/collaboration/ritual_connect.go`
- [X] T009 [P] Preserve base ritual focus-intent constants (`view_instance`, mode-aware deep-link targets) for notification-driven web routing in `frontend/apps/web/src/app/workspace/notifications/utils/notificationNavigation.ts` *(scope: base intents only; exceptional-context and review-focus extensions are handled in T045)*
- [X] T010 [P] Preserve base ritual focus-intent constants (`view_instance`, mode-aware deep-link targets) for notification-driven mobile routing in `frontend/apps/mobile/src/lib/linking.ts` *(scope: base intents only; exceptional-context and review-focus extensions are handled in T045)*

**Checkpoint**: Shared routing and data contracts are ready; user-story work can proceed in parallel.

---

## Phase 3: User Story 1 - Find Today's Ritual Work Immediately (Priority: P1) 🎯 MVP

**Goal**: Workers entering a ritual-focused project land on a today-first surface, see urgency-first grouping, and always open the live ritual instance instead of template management.

**Independent Test**: Open a ritual-focused project without an explicit view and verify the worker lands on Today, sees overdue/today/resubmission grouping, and reaches the live ritual instance with the missing or rejected requirement highlighted.

### Tests for User Story 1

- [X] T011 [P] [US1] Add backend integration coverage for standard-mode planning entry, ritual-mode default entry, and live-instance targeting in `backend/integration/collaboration_ritual_ux_redesign_test.go`
- [X] T012 [P] [US1] Add Playwright coverage for standard-mode planning entry plus worker entry into ritual Today and live-instance focus behavior in `frontend/apps/web/e2e/ritual-ux-redesign.spec.ts`

### Implementation for User Story 1

- [X] T013 [US1] Apply mode-aware default landing selection for standard and ritual projects in `frontend/apps/web/src/app/workspace/projects/[id]/page.tsx`
- [X] T014 [US1] Rework ritual urgency grouping, empty states, and row destinations in `frontend/apps/web/src/app/workspace/projects/[id]/components/TodayView.tsx`
- [X] T015 [US1] Highlight the focused requirement, worker-first live-instance sections, dual-role separate proof and review sections (FR-019), and web exceptional-instance context in `frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/page.tsx`
- [X] T016 [US1] Keep ritual task list entries targeting live instances with `view_instance` intent in `frontend/apps/web/src/app/workspace/projects/[id]/components/ListView.tsx`

**Checkpoint**: Workers can enter a ritual project, identify today's work immediately, and reach the live ritual instance without template-management detours.

---

## Phase 4: User Story 2 - Review Operational Health Separately From Daily Work (Priority: P1)

**Goal**: Owners and reviewers can distinguish daily execution, review backlog, health monitoring, and template management as separate ritual surfaces.

**Independent Test**: Open a ritual-focused project as an owner or reviewer and verify that Today, Review, Health, Worklist, and template management are visibly distinct and route to non-overlapping actions.

### Tests for User Story 2

- [X] T017 [P] [US2] Add backend integration coverage for ritual review, health, calendar visibility, board-secondary rules, and template-management separation in `backend/integration/collaboration_ritual_ux_redesign_test.go`
- [X] T018 [P] [US2] Add Playwright coverage for owner and reviewer ritual navigation separation, calendar access, and board-secondary behavior in `frontend/apps/web/e2e/ritual-ux-redesign.spec.ts`

### Implementation for User Story 2

- [X] T019 [US2] Add ritual-specific top-level surfaces and role-aware labels, including distinct Calendar and Worklist entry points, in `frontend/apps/web/src/app/workspace/projects/[id]/page.tsx`
- [X] T020 [P] [US2] Convert ritual browsing into a sortable operational worklist surface in `frontend/apps/web/src/app/workspace/projects/[id]/components/ListView.tsx` *(depends on T016; extends the live-instance routing T016 establishes — apply under a ritual-mode gate to avoid changing standard-mode list behavior)*
- [X] T021 [P] [US2] Refine pending-submission triage and instance routing in `frontend/apps/web/src/app/workspace/projects/[id]/components/RitualReviewBacklog.tsx`
- [X] T022 [P] [US2] Refine compliance, overdue, and exception summaries for owner workflows in `frontend/apps/web/src/app/workspace/projects/[id]/components/HealthDashboard.tsx`
- [X] T023 [US2] Keep ritual template management visually separate from live-run actions in `frontend/apps/web/src/app/workspace/projects/[id]/rituals/[definitionId]/page.tsx`
- [X] T024 [US2] Enforce board-secondary rules so the generic board is never the default or first ritual call to action in `frontend/apps/web/src/app/workspace/projects/[id]/components/BoardView.tsx`
- [X] T042 [P] [US2] Expose ritual-specific calendar visibility, filters, and exception routing in `frontend/apps/web/src/app/workspace/projects/[id]/components/CalendarView.tsx`

**Checkpoint**: Owners and reviewers can triage review work, inspect health, and manage templates without confusing those actions with live worker execution.

---

## Phase 5: User Story 3 - Separate Planned Work From Routine Operations in Mixed Projects (Priority: P2)

**Goal**: Mixed projects open into a cross-stream overview and keep standard-task planning and ritual operations structurally separated across overview, today, and navigation.

**Independent Test**: Open a mixed project with both standard tasks and ritual runs and verify the default view is Overview, the today surface splits both workstreams into labeled sections, and Planned Work and Routine Operations route to separate destinations.

### Tests for User Story 3

- [X] T025 [P] [US3] Add backend integration coverage for mixed overview summaries and workstream separation in `backend/integration/collaboration_ritual_ux_redesign_test.go`
- [X] T026 [P] [US3] Add Playwright coverage for mixed Overview, Today split sections, and workstream routing in `frontend/apps/web/e2e/ritual-ux-redesign.spec.ts`

### Implementation for User Story 3

- [X] T027 [US3] Create the mixed-project overview surface in `frontend/apps/web/src/app/workspace/projects/[id]/components/OverviewView.tsx`
- [X] T028 [US3] Export the mixed overview surface from `frontend/apps/web/src/app/workspace/projects/[id]/components/index.ts`
- [X] T029 [US3] Wire Overview, Planned Work, and Routine Operations routing in `frontend/apps/web/src/app/workspace/projects/[id]/page.tsx`
- [X] T030 [US3] Split mixed-mode Today into separate standard-task and ritual-run sections in `frontend/apps/web/src/app/workspace/projects/[id]/components/TodayView.tsx` *(depends on T014; extends ritual urgency grouping introduced there with mixed-mode section splitting)*
- [X] T031 [US3] Restrict planning-first standard-task views to the planned-work context in `frontend/apps/web/src/app/workspace/projects/[id]/components/GanttView.tsx`
- [X] T032 [US3] Expose ritual-only routine-operations shortcuts and empty states in `frontend/apps/web/src/app/workspace/projects/[id]/components/CalendarView.tsx` *(depends on T042; extends ritual-specific calendar visibility added there with mixed-mode routine-operations shortcuts)*

**Checkpoint**: Mixed projects clearly separate planned work from routine operations from the first entry surface onward.

---

## Phase 6: User Story 4 - Complete Ritual Proof From a Mobile-First Task Flow (Priority: P2)

**Goal**: Mobile workers stay in a task-first flow, see obvious next actions for proof, and reviewers can open directly into the relevant live ritual instance from alerts.

**Independent Test**: Open the mobile Tasks experience with ritual work in multiple proof states and verify workers see grouped sections, enter the live ritual instance, complete the next proof action, and reviewers can open the highlighted pending submission from an alert.

### Tests for User Story 4

- [X] T033 [P] [US4] Add Maestro coverage for grouped ritual work, alert-driven ritual review entry, and task-first live-instance targeting in `frontend/apps/mobile/.maestro/ritual-ux-redesign.yaml`
- [X] T043 [P] [US4] Add backend integration coverage for dual-role visibility and exceptional-instance context preservation in `backend/integration/collaboration_ritual_ux_redesign_test.go`
- [X] T044 [P] [US4] Add Playwright coverage for dual-role instance layout and exceptional-instance messaging in `frontend/apps/web/e2e/ritual-ux-redesign.spec.ts`

### Implementation for User Story 4

- [X] T034 [US4] Refine focus-mode grouping and task-first copy for ritual work in `frontend/apps/mobile/src/app/(app)/(tasks)/index.tsx`
- [X] T035 [US4] Keep project-level ritual grouping urgency-first and task-first in `frontend/apps/mobile/src/app/(app)/(tasks)/[projectId]/index.tsx`
- [X] T036 [US4] Highlight next proof actions, dual-role review sections, and exceptional-instance context in `frontend/apps/mobile/src/app/(app)/(tasks)/[projectId]/[taskId].tsx`
- [X] T037 [US4] Adjust tasks stack routing so mobile task detail remains the primary ritual destination in `frontend/apps/mobile/src/app/(app)/(tasks)/_layout.tsx`
- [X] T038 [US4] Reduce worker-facing action affordances inside ritual template detail in `frontend/apps/mobile/src/app/(app)/(tasks)/rituals/[definitionId].tsx`
- [X] T045 [US4] Extend notification routing with exceptional-context (skipped, detached) and review-focus (pending submission highlighted) in `frontend/apps/web/src/app/workspace/notifications/utils/notificationNavigation.ts` and `frontend/apps/mobile/src/lib/linking.ts` *(depends on T009 and T010; adds only exceptional and review-focus routing on top of the base intents those tasks establish)*

**Checkpoint**: Mobile employees can complete ritual proof from a grouped task flow, and alert-driven review entry opens the relevant live instance instead of a management surface.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Finish the shared validation and interaction details that span multiple stories.

- [X] T039 [P] Add stable `data-testid` hooks for new web navigation and overview controls in `frontend/apps/web/src/app/workspace/projects/[id]/page.tsx`
- [X] T040 [P] Update the cross-platform validation checklist and execution notes in `specs/029-ritual-ux-redesign/quickstart.md`
- [X] T041 Run the ritual UX redesign validation commands documented in `specs/029-ritual-ux-redesign/quickstart.md`
- [ ] T046 [P] Capture pre-rollout baseline of ritual navigation confusion reports, then define rollout confusion metric collection and release-readiness check for `SC-006` in `specs/029-ritual-ux-redesign/quickstart.md` *(baseline MUST be recorded before the feature ships so the 30% reduction target is measurable)*

### Iteration 2026-04-21 Impact Note

Completed routing tasks T004, T009, T013-T016, T019-T024, T027-T032, T039, and T045 established the task-first surface behavior but still require route-family follow-up to move the user-facing web URLs from `/workspace/projects` to `/workspace/tasks`.

---

## Phase 8: Iteration 2026-04-21 - Task-First Route Rename

**Purpose**: Finish the user-facing route rename so the web workspace URL model reinforces `Tasks` instead of `Projects` while preserving compatibility for existing links.

- [X] T047 Rename the top-level workspace module route and shell navigation from `/workspace/projects` to `/workspace/tasks` in `frontend/apps/web/src/app/workspace/layout.tsx` and `frontend/apps/web/src/app/workspace/projects/page.tsx`
- [X] T048 Update project detail, review, calendar, worklist, ritual settings, and live task router pushes and links to the `/workspace/tasks` route family in `frontend/apps/web/src/app/workspace/projects/[id]/page.tsx`, `frontend/apps/web/src/app/workspace/projects/[id]/components/CalendarView.tsx`, `frontend/apps/web/src/app/workspace/projects/[id]/components/HealthDashboard.tsx`, `frontend/apps/web/src/app/workspace/projects/[id]/components/ListView.tsx`, `frontend/apps/web/src/app/workspace/projects/[id]/components/OverviewView.tsx`, `frontend/apps/web/src/app/workspace/projects/[id]/components/RitualReviewBacklog.tsx`, `frontend/apps/web/src/app/workspace/projects/[id]/components/TaskDetailSidePanel.tsx`, `frontend/apps/web/src/app/workspace/projects/[id]/components/TodayView.tsx`, `frontend/apps/web/src/app/workspace/projects/[id]/rituals/[definitionId]/page.tsx`, and `frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/page.tsx`
- [X] T049 Update notification deep links, chat-linked resource links, and compatibility redirects so legacy `/workspace/projects` URLs preserve query state and ritual focus intents while resolving to `/workspace/tasks` in `frontend/apps/web/src/app/workspace/notifications/utils/notificationNavigation.ts`, `frontend/apps/web/src/app/workspace/chat/components/ChannelSidebar.tsx`, and the web workspace route files that own redirect behavior
- [X] T050 Update Playwright coverage and URL assertions for the renamed task-first route family and legacy redirect compatibility in `frontend/apps/web/e2e/ritual-ux-redesign.spec.ts`, `frontend/apps/web/e2e/ritual-submission-flow.spec.ts`, and `frontend/apps/web/e2e/task-lifecycle.spec.ts`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1: Setup** has no dependencies and should start immediately.
- **Phase 2: Foundational** depends on Phase 1 and blocks all story work.
- **Phase 3: US1** depends on Phase 2 and delivers the MVP worker entry flow.
- **Phase 4: US2** depends on Phase 2 and can proceed in parallel with US1 once the foundation is ready.
- **Phase 5: US3** depends on Phase 2 and can proceed after the shared routing model exists.
- **Phase 6: US4** depends on Phase 2 and can proceed in parallel with US3.
- **Phase 7: Polish** depends on the completion of the desired user stories.
- **Phase 8: Iteration 2026-04-21** depends on the prior routing behavior work and reopens the web route layer for the task-first URL rename.

### User Story Dependencies

- **US1 (P1)**: No dependency on other user stories once foundational routing and read models are in place.
- **US2 (P1)**: No dependency on US1, but it reuses the same ritual navigation foundation and live-instance focus contract.
- **US3 (P2)**: Reuses the foundational surface resolver and read-model aggregation but remains independently testable.
- **US4 (P2)**: Reuses the foundational focus-intent and live-instance rules but remains independently testable on mobile.

### Suggested Delivery Order

1. Complete Setup and Foundational work.
2. Deliver **US1** as the MVP ritual-worker flow.
3. Deliver **US2** to complete the ritual owner/reviewer IA.
4. Deliver **US3** to fix mixed-project structural separation.
5. Deliver **US4** to complete the mobile-first ritual execution flow.
6. Finish Polish and run the full validation checklist.
7. Apply the route-family rename iteration and rerun affected web validation.

---

## Parallel Opportunities

- **Setup**: T002 can run in parallel after T001 finalizes the scenario contract.
- **Foundational**: T005, T006, T009, and T010 can run in parallel once T004 defines the shared surface model.
- **US1**: T011 and T012 can run in parallel; T014 and T016 can run in parallel after T013 sets the routing contract.
- **US2**: T017 and T018 can run in parallel; T021, T022, and T042 can run in parallel after T019 locks the tab structure; T020 must follow T016 (same file, mode-gate extension).
- **US3**: T025 and T026 can run in parallel; T027 can run in parallel with T030, but T030 must follow T014 and T032 must follow T042 (same-file ordering).
- **US4**: T033, T043, and T044 can run in parallel; T034 and T035 can run in parallel; T037, T038, and T045 can run in parallel after T036 confirms the live-instance behavior.
- **Polish**: T039, T040, and T046 can run in parallel before T041 executes the full validation pass.
- **Iteration 2026-04-21**: T047 can run in parallel with T050 after the route shape is agreed; T048 and T049 can then proceed in parallel once the top-level route ownership is in place.

---

## Parallel Example: User Story 1

```bash
Task: "Add backend integration coverage for standard-mode planning entry, ritual-mode default entry, and live-instance targeting in backend/integration/collaboration_ritual_ux_redesign_test.go"
Task: "Add Playwright coverage for standard-mode planning entry plus worker entry into ritual Today and live-instance focus behavior in frontend/apps/web/e2e/ritual-ux-redesign.spec.ts"

Task: "Rework ritual urgency grouping, empty states, and row destinations in frontend/apps/web/src/app/workspace/projects/[id]/components/TodayView.tsx"
Task: "Keep ritual task list entries targeting live instances with view_instance intent in frontend/apps/web/src/app/workspace/projects/[id]/components/ListView.tsx"
```

## Parallel Example: User Story 2

```bash
Task: "Add backend integration coverage for ritual review, health, calendar visibility, board-secondary rules, and template-management separation in backend/integration/collaboration_ritual_ux_redesign_test.go"
Task: "Add Playwright coverage for owner and reviewer ritual navigation separation, calendar access, and board-secondary behavior in frontend/apps/web/e2e/ritual-ux-redesign.spec.ts"

Task: "Convert ritual browsing into a sortable operational worklist surface in frontend/apps/web/src/app/workspace/projects/[id]/components/ListView.tsx"
Task: "Refine pending-submission triage and instance routing in frontend/apps/web/src/app/workspace/projects/[id]/components/RitualReviewBacklog.tsx"
Task: "Refine compliance, overdue, and exception summaries for owner workflows in frontend/apps/web/src/app/workspace/projects/[id]/components/HealthDashboard.tsx"
```

## Parallel Example: User Story 3

```bash
Task: "Add backend integration coverage for mixed overview summaries and workstream separation in backend/integration/collaboration_ritual_ux_redesign_test.go"
Task: "Add Playwright coverage for mixed Overview, Today split sections, and workstream routing in frontend/apps/web/e2e/ritual-ux-redesign.spec.ts"

Task: "Create the mixed-project overview surface in frontend/apps/web/src/app/workspace/projects/[id]/components/OverviewView.tsx"
Task: "Split mixed-mode Today into separate standard-task and ritual-run sections in frontend/apps/web/src/app/workspace/projects/[id]/components/TodayView.tsx"
```

## Parallel Example: User Story 4

```bash
Task: "Refine focus-mode grouping and task-first copy for ritual work in frontend/apps/mobile/src/app/(app)/(tasks)/index.tsx"
Task: "Keep project-level ritual grouping urgency-first and task-first in frontend/apps/mobile/src/app/(app)/(tasks)/[projectId]/index.tsx"

Task: "Adjust tasks stack routing so mobile task detail remains the primary ritual destination in frontend/apps/mobile/src/app/(app)/(tasks)/_layout.tsx"
Task: "Reduce worker-facing action affordances inside ritual template detail in frontend/apps/mobile/src/app/(app)/(tasks)/rituals/[definitionId].tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational.
3. Complete Phase 3: User Story 1.
4. Validate the ritual worker entry flow independently on web.
5. Demo or ship the worker-first ritual entry improvement before broadening scope.

### Incremental Delivery

1. Finish Setup and Foundational work.
2. Deliver US1 and validate ritual worker entry.
3. Deliver US2 and validate owner/reviewer separation.
4. Deliver US3 and validate mixed-mode separation.
5. Deliver US4 and validate the mobile task-first flow.
6. Run the cross-platform polish and release-readiness checks.
7. Apply the `/workspace/tasks` route rename and rerun web route validation plus redirect checks.

### Suggested MVP Scope

- **MVP**: User Story 1 only.
- **Next slice**: User Story 2 to complete ritual-only web IA.
- **Later slices**: User Story 3 and User Story 4 once the shared routing model is stable.

---

## Notes

- All tasks follow the required checklist format: checkbox, sequential task ID, optional `[P]`, required story label for story phases, and an exact file path.
- Scenario contract tasks are front-loaded because this feature must keep backend and web behavior traceable to spec requirements before implementation proceeds.
- Backend integration, Playwright, and Maestro validation are included because the feature specification and implementation plan explicitly require behavioral verification.
- The task list assumes additive collaboration read models stay within existing collaboration ownership and typed frontend wrappers.