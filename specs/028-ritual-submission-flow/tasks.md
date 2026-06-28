# Tasks: Ritual Submission Flow

**Input**: Design documents from `/specs/028-ritual-submission-flow/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Backend integration scenarios, web Playwright coverage, and a mobile Maestro happy path are required for this feature.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated independently.

## Phase 1: Setup (Shared Contracts and Test Scaffolding)

**Purpose**: Lock the scenario contract and seed the required cross-platform test artifacts before implementation starts.

- [X] T001 Finalize the approved scenario contract coverage in /Volumes/T5/Codes/tech-office/backend/integration/ritual_submission_flow_test.go and /Volumes/T5/Codes/tech-office/frontend/apps/web/e2e/ritual-submission-flow.spec.ts
- [X] T002 [P] Create the mobile happy-path Maestro flow in /Volumes/T5/Codes/tech-office/frontend/apps/mobile/.maestro/ritual-submission-flow.yaml
- [X] T003 [P] Update manual validation steps and fixture expectations in /Volumes/T5/Codes/tech-office/specs/028-ritual-submission-flow/quickstart.md

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Add shared routing and data-loading primitives that every ritual submission and review surface depends on.

**⚠️ CRITICAL**: No user story work should begin until this phase is complete.

- [X] T004 Add ritual instance focus-intent parsing and section targeting in /Volumes/T5/Codes/tech-office/frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/page.tsx
- [X] T005 [P] Add mobile ritual deep-link resolution for task-instance entry in /Volumes/T5/Codes/tech-office/frontend/apps/mobile/src/lib/linking.ts and /Volumes/T5/Codes/tech-office/frontend/apps/mobile/src/providers/notification-stream-provider.tsx
- [X] T006 [P] Extend typed ritual/task data hydration for instance-first submission and review flows in /Volumes/T5/Codes/tech-office/frontend/packages/apis/src/collaboration.ts and /Volumes/T5/Codes/tech-office/frontend/packages/apis/src/collaboration-ritual.ts

**Checkpoint**: Shared routing and data access are ready for story implementation.

---

## Phase 3: User Story 1 - Submit Ritual Evidence From an Active Task (Priority: P1) 🎯 MVP

**Goal**: Let an assigned employee open a live ritual instance, understand missing proof, and submit or resubmit evidence without leaving task context.

**Independent Test**: Assign a ritual instance to an employee on web and mobile, open the task, submit evidence for a missing requirement, and confirm the checklist refreshes on the same instance.

### Tests for User Story 1

- [X] T007 [P] [US1] Implement worker submission scenarios in /Volumes/T5/Codes/tech-office/backend/integration/ritual_submission_flow_test.go
- [X] T008 [P] [US1] Implement worker submission browser coverage in /Volumes/T5/Codes/tech-office/frontend/apps/web/e2e/ritual-submission-flow.spec.ts
- [X] T009 [P] [US1] Implement the mobile worker submission happy path in /Volumes/T5/Codes/tech-office/frontend/apps/mobile/.maestro/ritual-submission-flow.yaml

### Implementation for User Story 1

- [X] T010 [US1] Refine requirement checklist status rendering and per-item submit or resubmit actions in /Volumes/T5/Codes/tech-office/frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/components/EvidenceChecklist.tsx
- [X] T011 [P] [US1] Update requirement-focused submission completion and return-to-task behavior in /Volumes/T5/Codes/tech-office/frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/components/EvidenceSubmitForm.tsx
- [X] T012 [US1] Compose the worker ritual instance experience and keep definition guidance read-only in /Volumes/T5/Codes/tech-office/frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/page.tsx and /Volumes/T5/Codes/tech-office/frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/components/RitualDefinitionSection.tsx
- [X] T013 [US1] Update the mobile ritual task detail to launch requirement-focused capture and refresh the same instance on completion in /Volumes/T5/Codes/tech-office/frontend/apps/mobile/src/app/(app)/(tasks)/[projectId]/[taskId].tsx

**Checkpoint**: Workers can submit ritual evidence from the live task on web and mobile without using the ritual definition editor.

---

## Phase 4: User Story 2 - Review Submitted Evidence as a Project Owner or Reviewer (Priority: P2)

**Goal**: Give reviewers task-level review controls plus a web-first backlog surface that highlights pending ritual submissions across a project.

**Independent Test**: Submit ritual evidence on multiple instances, open the reviewer backlog on web, approve or reject an item, and confirm the originating task reflects the updated review state.

### Tests for User Story 2

- [X] T014 [P] [US2] Implement reviewer backlog and approval or rejection scenarios in /Volumes/T5/Codes/tech-office/backend/integration/ritual_submission_flow_test.go
- [X] T015 [P] [US2] Implement reviewer backlog and rejection browser coverage in /Volumes/T5/Codes/tech-office/frontend/apps/web/e2e/ritual-submission-flow.spec.ts

### Implementation for User Story 2

- [X] T016 [P] [US2] Add reviewer backlog data loading built from existing ritual and task wrappers in /Volumes/T5/Codes/tech-office/frontend/packages/apis/src/collaboration.ts and /Volumes/T5/Codes/tech-office/frontend/packages/apis/src/collaboration-ritual.ts
- [X] T017 [US2] Create the reviewer backlog surface in /Volumes/T5/Codes/tech-office/frontend/apps/web/src/app/workspace/projects/[id]/components/RitualReviewBacklog.tsx
- [X] T018 [US2] Integrate the reviewer backlog surface into the project workspace in /Volumes/T5/Codes/tech-office/frontend/apps/web/src/app/workspace/projects/[id]/page.tsx
- [X] T019 [US2] Expand task-level review actions, pending-review context, and rejection feedback in /Volumes/T5/Codes/tech-office/frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/components/EvidenceReviewPanel.tsx and /Volumes/T5/Codes/tech-office/frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/page.tsx
- [X] T020 [US2] Add urgent task-level review visibility for managers on mobile in /Volumes/T5/Codes/tech-office/frontend/apps/mobile/src/app/(app)/(tasks)/[projectId]/[taskId].tsx

**Checkpoint**: Reviewers can triage pending ritual evidence from a project-level backlog and act from task detail without losing review context.

---

## Phase 5: User Story 3 - Distinguish Template Management From Instance Work (Priority: P3)

**Goal**: Keep ritual definition management clearly separate from live instance submission and review while preserving dual-role access.

**Independent Test**: Edit a ritual definition, then open a live ritual instance as a worker or dual-role owner and confirm template controls stay separate from live evidence actions.

### Tests for User Story 3

- [X] T021 [P] [US3] Implement dual-role and exceptional-instance scenarios in /Volumes/T5/Codes/tech-office/backend/integration/ritual_submission_flow_test.go
- [X] T022 [P] [US3] Implement template-versus-instance browser coverage in /Volumes/T5/Codes/tech-office/frontend/apps/web/e2e/ritual-submission-flow.spec.ts

### Implementation for User Story 3

- [X] T023 [US3] Separate template-management copy, controls, and live evidence messaging in /Volumes/T5/Codes/tech-office/frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/components/RitualDefinitionSection.tsx and /Volumes/T5/Codes/tech-office/frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/page.tsx
- [X] T024 [US3] Preserve dual-role worker and reviewer visibility in /Volumes/T5/Codes/tech-office/frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/components/EvidenceChecklist.tsx and /Volumes/T5/Codes/tech-office/frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/components/EvidenceReviewPanel.tsx
- [X] T025 [US3] Surface skipped and detached instance context without implying template mutability in /Volumes/T5/Codes/tech-office/frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/page.tsx and /Volumes/T5/Codes/tech-office/frontend/apps/mobile/src/app/(app)/(tasks)/[projectId]/[taskId].tsx

**Checkpoint**: Users can clearly distinguish definition editing from instance work, and dual-role users keep access to both relevant action sets.

---

## Phase 6: User Story 4 - Reach the Right Ritual Surface From Daily Worklists and Notifications (Priority: P3)

**Goal**: Route workers and reviewers from today views, list views, and notifications directly to the correct ritual instance or review target.

**Independent Test**: Open a ritual from web today and list views plus web and mobile notifications, and confirm each path lands on the ritual instance or reviewer surface with the expected focus.

### Tests for User Story 4

- [X] T026 [P] [US4] Implement summary-surface and notification-entry scenarios in /Volumes/T5/Codes/tech-office/backend/integration/ritual_submission_flow_test.go
- [X] T027 [P] [US4] Implement today, list, and notification routing browser coverage in /Volumes/T5/Codes/tech-office/frontend/apps/web/e2e/ritual-submission-flow.spec.ts
- [X] T028 [P] [US4] Extend the mobile Maestro flow for notification entry into the ritual instance in /Volumes/T5/Codes/tech-office/frontend/apps/mobile/.maestro/ritual-submission-flow.yaml

### Implementation for User Story 4

- [X] T029 [US4] Route ritual rows from today and list surfaces to task instances with summary-only status cues in /Volumes/T5/Codes/tech-office/frontend/apps/web/src/app/workspace/projects/[id]/components/TodayView.tsx and /Volumes/T5/Codes/tech-office/frontend/apps/web/src/app/workspace/projects/[id]/components/ListView.tsx
- [X] T030 [US4] Route web notification opens to ritual task instances or reviewer focus targets in /Volumes/T5/Codes/tech-office/frontend/apps/web/src/app/workspace/notifications/components/NotificationItem.tsx and /Volumes/T5/Codes/tech-office/frontend/apps/web/src/app/workspace/notifications/page.tsx
- [X] T031 [US4] Route mobile notifications and live-banner opens to ritual task instances in /Volumes/T5/Codes/tech-office/frontend/apps/mobile/src/app/(app)/(notifications)/index.tsx, /Volumes/T5/Codes/tech-office/frontend/apps/mobile/src/app/(app)/_layout.tsx, and /Volumes/T5/Codes/tech-office/frontend/apps/mobile/src/lib/linking.ts

**Checkpoint**: All primary entry surfaces land users in the correct ritual work context instead of a template-management screen.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Finish observability, validation, and final documentation across stories.

- [X] T032 [P] Add data-testid coverage for new ritual review and routing controls in /Volumes/T5/Codes/tech-office/frontend/apps/web/src/app/workspace/projects/[id]/page.tsx and /Volumes/T5/Codes/tech-office/frontend/apps/web/src/app/workspace/projects/[id]/components/RitualReviewBacklog.tsx
- [X] T033 Update feature validation notes and release-readiness checks in /Volumes/T5/Codes/tech-office/specs/028-ritual-submission-flow/quickstart.md and /Volumes/T5/Codes/tech-office/specs/028-ritual-submission-flow/research.md
- [X] T034 Run the full ritual submission validation suite from /Volumes/T5/Codes/tech-office/backend/integration/ritual_submission_flow_test.go, /Volumes/T5/Codes/tech-office/frontend/apps/web/e2e/ritual-submission-flow.spec.ts, and /Volumes/T5/Codes/tech-office/frontend/apps/mobile/.maestro/ritual-submission-flow.yaml

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1: Setup** has no dependencies and should start immediately.
- **Phase 2: Foundational** depends on Phase 1 and blocks all story work.
- **Phase 3: US1** depends on Phase 2 and defines the MVP submission path.
- **Phase 4: US2** depends on Phase 2 and can run after or alongside US1 once shared routing and data hydration are stable.
- **Phase 5: US3** depends on Phase 2 and can run alongside US1 or US2.
- **Phase 6: US4** depends on Phase 2 and can run alongside the other stories once entry-point helpers are in place.
- **Phase 7: Polish** depends on the completion of the selected user stories.

### User Story Dependencies

- **US1** is the MVP and should land first.
- **US2** reuses the task-instance submission surfaces from US1 but remains independently testable with seeded pending-review data.
- **US3** reuses the same ritual instance page structure as US1 but remains independently testable with dual-role and detached-instance fixtures.
- **US4** reuses the routing primitives from Phase 2 and remains independently testable from today, list, and notification entry surfaces.

### Parallel Opportunities

- **Setup**: T002 and T003 can run in parallel after T001 starts the scenario review.
- **Foundational**: T005 and T006 can run in parallel after T004 defines the route-focus contract.
- **US1**: T007, T008, and T009 can run in parallel; T011 can run in parallel with T010 before T012 composes the page.
- **US2**: T014 and T015 can run in parallel; T016 and T017 can run in parallel before T018 and T019.
- **US3**: T021 and T022 can run in parallel; T024 can run in parallel with T023 before T025 finalizes exceptional-state visibility.
- **US4**: T026, T027, and T028 can run in parallel; T029 and T030 can run in parallel before T031 completes mobile notification routing.

---

## Parallel Example: User Story 1

```bash
# Parallel test implementation
Task: "Implement worker submission scenarios in backend/integration/ritual_submission_flow_test.go"
Task: "Implement worker submission browser coverage in frontend/apps/web/e2e/ritual-submission-flow.spec.ts"
Task: "Implement the mobile worker submission happy path in frontend/apps/mobile/.maestro/ritual-submission-flow.yaml"

# Parallel UI work
Task: "Refine requirement checklist status rendering and per-item submit or resubmit actions in frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/components/EvidenceChecklist.tsx"
Task: "Update requirement-focused submission completion and return-to-task behavior in frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/components/EvidenceSubmitForm.tsx"
```

## Parallel Example: User Story 2

```bash
# Parallel data and UI preparation
Task: "Add reviewer backlog data loading built from existing ritual and task wrappers in frontend/packages/apis/src/collaboration.ts and frontend/packages/apis/src/collaboration-ritual.ts"
Task: "Create the reviewer backlog surface in frontend/apps/web/src/app/workspace/projects/[id]/components/RitualReviewBacklog.tsx"
```

## Parallel Example: User Story 3

```bash
# Parallel separation and role-visibility work
Task: "Separate template-management copy, controls, and live evidence messaging in frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/components/RitualDefinitionSection.tsx and frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/page.tsx"
Task: "Preserve dual-role worker and reviewer visibility in frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/components/EvidenceChecklist.tsx and frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/components/EvidenceReviewPanel.tsx"
```

## Parallel Example: User Story 4

```bash
# Parallel entry-point routing work
Task: "Route ritual rows from today and list surfaces to task instances with summary-only status cues in frontend/apps/web/src/app/workspace/projects/[id]/components/TodayView.tsx and frontend/apps/web/src/app/workspace/projects/[id]/components/ListView.tsx"
Task: "Route web notification opens to ritual task instances or reviewer focus targets in frontend/apps/web/src/app/workspace/notifications/components/NotificationItem.tsx and frontend/apps/web/src/app/workspace/notifications/page.tsx"
```

---

## Implementation Strategy

### MVP First

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 for User Story 1.
3. Validate the worker submission path on backend, web, and mobile before adding backlog or routing refinements.

### Incremental Delivery

1. Land US1 to establish the task-instance-first submission flow.
2. Add US2 to give reviewers backlog visibility and task-level actions.
3. Add US3 to harden role clarity and exceptional-instance messaging.
4. Add US4 to make all upstream entry points land in the right ritual context.
5. Finish with Phase 7 validation and documentation.

### Suggested MVP Scope

- Phase 1: Setup
- Phase 2: Foundational
- Phase 3: User Story 1
