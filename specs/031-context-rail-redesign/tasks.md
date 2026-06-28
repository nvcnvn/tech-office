# Tasks: Workspace Context Rail Redesign

**Input**: Design documents from `/specs/031-context-rail-redesign/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Required by the constitution for this feature. Web Playwright coverage is required for the route and layout behavior, and backend integration coverage is required for any new or extended summary contracts that support the rail.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated independently after the shared foundation is complete.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel when touching different files with no blocking dependency
- **[Story]**: `Shared`, `US1`, `US2`, `US3`, or `US4`
- Every task includes concrete repository paths

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the task-specific test scaffolding and shell files that all stories rely on.

- [x] T001 [Shared] Add backend integration scenario stubs for context-rail summaries and route-specific rail data in `backend/integration/context_rail_test.go`
- [x] T002 [P] [Shared] Add Playwright scenario stubs for context-rail availability, persistence, responsive collapse, calendar context, and chat context in `frontend/apps/web/e2e/context-rail.spec.ts`
- [x] T003 [P] [Shared] Create context-rail component scaffolding in `frontend/apps/web/src/app/workspace/components/context-rail/ContextRail.tsx`, `frontend/apps/web/src/app/workspace/components/context-rail/ContextRailSection.tsx`, and `frontend/apps/web/src/app/workspace/components/context-rail/ContextRailEmptyState.tsx`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish the shell ownership, registration model, and responsive behavior that all user stories depend on.

**⚠️ CRITICAL**: No user-story implementation should begin until this phase is complete.

- [x] T004 [Shared] Implement the rail provider, route-registration lifecycle, session-persistence helpers (using `sessionStorage` key `contextRail.preference`), and stale-registration cleanup (discard page blocks whose `registrationToken` no longer matches the mounted route on navigation) in `frontend/apps/web/src/app/workspace/providers/ContextRailProvider.tsx` and `frontend/apps/web/src/app/workspace/providers/useContextRail.ts`
- [x] T005 [Shared] Refactor the shared workspace shell to add a right-side context rail DOM slot (structural placeholder only — no Quick Info removal, no rail logic) and preserve chat's left `ChannelSidebar` behavior in `frontend/apps/web/src/app/workspace/layout.tsx`; Quick Info removal and provider wiring happen in T010
- [x] T006 [P] [Shared] Implement rail shell layout primitives, open or close toggle behavior, and responsive auto-collapse support in `frontend/apps/web/src/app/workspace/components/context-rail/ContextRail.tsx` and `frontend/apps/web/src/app/workspace/components/context-rail/ContextRailSection.tsx`
- [x] T007 [P] [Shared] Wire the shared provider into the existing workspace provider stack in `frontend/apps/web/src/app/workspace/layout.tsx` and `frontend/apps/web/src/app/workspace/providers/NotificationStreamProvider.tsx`

**Checkpoint**: The workspace shell owns a reusable right-side rail with session-persisted state and route registration, and chat still controls the left sidebar independently.

---

## Phase 3: User Story 1 - Context rail is available and consistent on every workspace page (Priority: P1) 🎯 MVP

**Goal**: Every workspace route exposes the same right-side context rail affordance, the rail state survives navigation, and the main content reflows correctly when the rail is collapsed.

**Independent Test**: Open tasks, calendar, chat, organization, docs, and settings. Confirm the toggle is visible on every route, the rail stays open across navigation, chat still shows `ChannelSidebar` on the left, and collapsing the rail expands the main content.

### Tests for User Story 1

- [x] T008 [P] [US1] Implement Playwright coverage for rail toggle visibility across workspace routes in `frontend/apps/web/e2e/context-rail.spec.ts`
- [x] T009 [P] [US1] Implement Playwright coverage for session-persisted open or closed state and main-content reflow in `frontend/apps/web/e2e/context-rail.spec.ts`

### Implementation for User Story 1

- [x] T010 [US1] Remove the hardcoded left-side Quick Info rendering and wire the `ContextRailProvider`-driven rail into the T005 slot in `frontend/apps/web/src/app/workspace/layout.tsx` — assumes T005 has already landed; do not re-add the structural slot
- [x] T011 [US1] Keep a globally visible context-rail toggle in both open and collapsed states and anchor it consistently in `frontend/apps/web/src/app/workspace/layout.tsx` and `frontend/apps/web/src/app/workspace/components/context-rail/ContextRail.tsx`
- [x] T012 [US1] Implement width-based auto-collapse and non-overlay main-content reflow in `frontend/apps/web/src/app/workspace/layout.tsx` and `frontend/apps/web/src/app/workspace/components/context-rail/ContextRail.tsx`
- [x] T013 [US1] Ensure routes without registered page blocks render only the shared rail shell without placeholder sections in `frontend/apps/web/src/app/workspace/providers/ContextRailProvider.tsx` and `frontend/apps/web/src/app/workspace/components/context-rail/ContextRail.tsx`

**Checkpoint**: The context rail is structurally correct and independently testable on every workspace route.

---

## Phase 4: User Story 2 - Global context blocks show real user data (Priority: P2)

**Goal**: The rail shows live identity, next event, assigned work today, and unread message data instead of mock text or zero counters.

**Independent Test**: Seed a user with an upcoming event, assigned tasks due today or overdue, and unread messages. Open the rail on any workspace route and confirm each block shows live data or a meaningful empty state.

### Tests for User Story 2

- [x] T014 [P] [US2] Implement backend integration coverage for `CollaborationService.GetAssignedWorkSummary`, including cross-project due-today and overdue summaries, empty states, and tenant isolation, in `backend/integration/context_rail_test.go`
- [x] T015 [P] [US2] Implement Playwright coverage for live global blocks and mock-content removal in `frontend/apps/web/e2e/context-rail.spec.ts`

### Implementation for User Story 2

- [x] T016 [US2] Add cross-project work-today summary queries in `backend/database/scripts/collaboration.query.sql` and regenerate usage in `backend/database/collaboration.query.sql.go`
- [x] T017 [US2] Add `CollaborationService.GetAssignedWorkSummary` and its request or response messages in `backend/rpc/v1/collaboration.proto`, `backend/internal/collaboration/task_logic.go`, `backend/internal/collaboration/connect.go`, and `frontend/packages/apis/src/collaboration.ts`
- [x] T018 [P] [US2] Add global rail data hooks for identity, presence, next event (with `remainingTodayCount` derived client-side from the same calendar query), work today, and unread count; also derive `hasBadgeAlert` boolean (`overdueCount > 0 || unreadCount > 0`) for the collapsed-toggle indicator (FR-017) in `frontend/apps/web/src/app/workspace/components/context-rail/useGlobalContextRailData.ts`, `frontend/packages/apis/src/presence.ts`, `frontend/packages/apis/src/calendar.ts`, and `frontend/packages/notifications/src/useNotifications.ts`
- [x] T019 [US2] Render live global rail blocks with per-block loading, empty, and error states; render the "+ N more today" count in the "Next Up" block; make each "My Work Today" task item a navigable link to its detail page; and show the `hasBadgeAlert` indicator on the collapsed toggle (FR-017) in `frontend/apps/web/src/app/workspace/components/context-rail/GlobalContextBlocks.tsx` and `frontend/apps/web/src/app/workspace/components/context-rail/ContextRail.tsx`
- [x] T020 [US2] Remove hardcoded Quick Info mock strings and zero-counter cards from `frontend/apps/web/src/app/workspace/layout.tsx` and the new context-rail components

**Checkpoint**: Global rail content is live, block failures are isolated, and mock content is removed.

---

## Phase 5: User Story 3 - Calendar page shows day-specific context, not generic info (Priority: P3)

**Goal**: The calendar route registers selected-day context into the rail and surfaces pending invites with working RSVP actions.

**Independent Test**: Open the calendar page, select a day with events and pending invites, and confirm the rail shows that day's event summary plus functioning Accept and Decline actions. With no explicit day selected, confirm the rail defaults to today's summary.

### Tests for User Story 3

- [x] T021 [P] [US3] Implement backend integration coverage for calendar invite response behavior used by the rail in `backend/integration/context_rail_test.go`
- [x] T022 [P] [US3] Implement Playwright coverage for calendar-specific rail content and RSVP actions in `frontend/apps/web/e2e/context-rail.spec.ts`

### Implementation for User Story 3

- [x] T023 [US3] Add calendar selected-day registration and default-to-today behavior in `frontend/apps/web/src/app/workspace/calendar/page.tsx` and `frontend/apps/web/src/app/workspace/providers/ContextRailProvider.tsx`
- [x] T024 [P] [US3] Build the calendar rail section UI for selected-day events and pending invites in `frontend/apps/web/src/app/workspace/calendar/components/CalendarContextRailSection.tsx`
- [x] T025 [US3] Wire RSVP mutations and calendar-query refresh behavior from the rail using `frontend/apps/web/src/app/workspace/calendar/components/EventDetailPanel.tsx`, `frontend/apps/web/src/app/workspace/calendar/components/CalendarContextRailSection.tsx`, and `frontend/packages/apis/src/calendar.ts`

**Checkpoint**: Calendar contributes its own meaningful rail content without falling back to the generic global stack.

---

## Phase 6: User Story 4 - Chat page context rail shows channel-specific details (Priority: P4)

**Goal**: The chat route keeps the existing left navigation and adds a right-side rail with channel members, pinned messages, and DM-specific counterpart context.

**Independent Test**: Open a chat channel with members and pinned messages, then open a direct message. Confirm the right rail updates with channel or DM context while the left `ChannelSidebar` remains intact.

### Tests for User Story 4

- [x] T026 [P] [US4] Implement backend integration coverage for `ChatService.GetChannelContextSummary`, including member summaries, pinned-message summaries, DM counterpart context, and access control, in `backend/integration/context_rail_test.go`
- [x] T027 [P] [US4] Implement Playwright coverage for chat rail rendering beside the left `ChannelSidebar` in `frontend/apps/web/e2e/context-rail.spec.ts`

### Implementation for User Story 4

- [x] T028 [US4] Add `ChatService.GetChannelContextSummary` and its pinned-message summary messages in `backend/rpc/v1/chat.proto`, `backend/internal/chat/logic.go`, `backend/internal/chat/connect.go`, and `frontend/packages/apis/src/chat.ts`
- [x] T029 [P] [US4] Build the chat rail section for members, pinned messages, and DM counterpart context in `frontend/apps/web/src/app/workspace/chat/components/ChatContextRailSection.tsx`
- [x] T030 [US4] Register active-channel chat context from the route query state in `frontend/apps/web/src/app/workspace/chat/page.tsx`, `frontend/apps/web/src/app/workspace/layout.tsx`, and `frontend/apps/web/src/app/workspace/providers/ContextRailProvider.tsx`

**Checkpoint**: Chat has its own right-side context rail content without disturbing the left-side navigation model.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, cleanup, and guardrails across all stories.

- [x] T031 [P] [Shared] Run `rg "No upcoming events|No active tasks|0 active" frontend/apps/web/src/` as an assertion (exit non-zero on match) to confirm legacy mock strings are gone; add this as a `beforeAll` comment block in `frontend/apps/web/e2e/context-rail.spec.ts` and fail the T034 suite if it exits non-zero
- [x] T032 [P] [Shared] Validate frontend changes with `pnpm --dir frontend exec eslint .`
- [x] T033 [P] [Shared] Validate backend integration coverage with `cd backend && go test ./integration/...`
- [x] T034 [Shared] Validate the web context-rail journeys with `pnpm --dir frontend --filter web exec playwright test --config=e2e/playwright.config.ts`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Starts immediately.
- **Foundational (Phase 2)**: Depends on Setup completion and blocks all user-story work.
- **US1 (Phase 3)**: Starts after Foundational completion and delivers the MVP shell.
- **US2 (Phase 4)**: Starts after Foundational completion and can proceed after US1 shell work stabilizes.
- **US3 (Phase 5)**: Starts after Foundational completion and depends on the provider and shell from US1.
- **US4 (Phase 6)**: Starts after Foundational completion and depends on the provider and shell from US1.
- **Polish (Phase 7)**: Starts after the desired stories are complete.

### User Story Dependencies

- **US1**: No dependency on other user stories after foundation.
- **US2**: Depends on the US1 shell but is otherwise independently testable.
- **US3**: Depends on the US1 shell and registration model.
- **US4**: Depends on the US1 shell and registration model.

### Within Each User Story

- Test tasks should be completed before the story is considered done.
- Provider and shell changes precede route-specific registration work.
- Backend summary-contract work should land before the corresponding frontend data hooks consume it.
- Route section components should land before the final registration wiring.

## Parallel Opportunities

- T002 and T003 can run in parallel.
- T006 and T007 can run in parallel after T004 starts the provider contract.
- In US2, T014 and T015 can run in parallel, and T018 can run in parallel with T017 once the summary contract shape is clear.
- In US3, T021 and T022 can run in parallel once the registration API is stable.
- In US4, T026 and T027 can run in parallel, and T029 can run in parallel with T028 after the summary contract is defined.

## Implementation Strategy

### MVP First

1. Complete Phase 1 and Phase 2.
2. Deliver US1 and validate the shell behavior across all workspace routes.
3. Add US2 once the rail surface is stable so the shell stops showing mock content.

### Incremental Delivery

1. Deliver US1 for consistent rail placement and persistence.
2. Deliver US2 for live global summaries.
3. Deliver US3 for calendar-specific context.
4. Deliver US4 for chat-specific context.

### Team Strategy

1. One engineer can own the shared provider and layout refactor.
2. One engineer can own backend and frontend summary contracts for global blocks.
3. One engineer can own calendar rail integration.
4. One engineer can own chat rail integration.

## Notes

- This feature is web-scoped; no mobile implementation tasks are included.
- The current plan intentionally keeps shared files out of the chat rail scope because the formal requirement set only locks in members and pinned messages.
- `SC-005` should be validated both by UI assertions and by targeted code search before the feature is considered complete.