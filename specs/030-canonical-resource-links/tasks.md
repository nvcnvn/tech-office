# Tasks: Canonical Cross-Platform Resource Links

**Input**: Design documents from `/specs/030-canonical-resource-links/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Required by the constitution for this feature. Backend integration scenarios, web E2E scenarios, and a mobile Maestro happy path must be created and completed.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated independently after the shared foundation is complete.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel when touching different files with no blocking dependency
- **[Story]**: `US1`, `US2`, `US3`, or `Shared`
- Every task includes concrete repository paths

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the shared contract and test scaffolding that all stories rely on.

- [X] T001 Create backend canonical-link package scaffolding in backend/internal/linking/types.go
- [X] T002 [P] Add backend integration scenario stubs for canonical link generation, resolution, legacy normalization, and preview behavior in backend/integration/canonical_links_test.go
- [X] T003 [P] Add web E2E scenario stubs for canonical resource link flows in frontend/apps/web/e2e/canonical-resource-links.spec.ts
- [X] T004 [P] Add mobile Maestro scenario scaffolding for canonical task-link handling in frontend/apps/mobile/.maestro/canonical-resource-links.yaml

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish the backend-owned canonical contract and cross-platform routing foundations.

**⚠️ CRITICAL**: No user story implementation should start until this phase is complete.

- [X] T005 Add canonical link target types, resource enums, and validation helpers in backend/internal/linking/types.go
- [X] T006 [P] Implement the canonical URL generator with tenant-path construction and stable query allowlist handling in backend/internal/linking/generator.go
- [X] T007 [P] Implement legacy-link normalization from tenant subdomain routes to the canonical tenant-path shape and malformed-link validation in backend/internal/linking/normalize.go
- [X] T008 Add the resolver service and Connect RPC / gRPC platform route-translation contract, including tenant-hint to organization resolution and tenant-resource validation, in backend/internal/linking/service.go, backend/internal/linking/connect.go, and backend/cmd/server.go
- [X] T009 [P] Add preview metadata aggregation in backend/internal/linking/preview.go, backend/internal/collaboration/task_logic.go, and backend/internal/docs/logic.go
- [X] T010 [P] Add a shared canonical-link frontend utility package in frontend/packages/links/src/index.ts
- [X] T011 Define the canonical web path namespace and resolver entrypoint for `/o/[tenantKey]/r/[...slug]` in frontend/apps/web/src/app/o/[tenantKey]/r/[...slug]/page.tsx
- [X] T012 Add mobile inbound canonical-link translation support in frontend/apps/mobile/src/app/+native-intent.tsx
- [X] T013 [P] Configure iOS associated domains and Android intent filters for the main global host in frontend/apps/mobile/app.json
- [X] T014 [P] Add main-host association files in frontend/apps/web/public/.well-known/apple-app-site-association and frontend/apps/web/public/.well-known/assetlinks.json

**Checkpoint**: The backend canonical contract exists, the web host has a resolver surface, and mobile/web can both accept canonical links.

---

## Phase 3: User Story 1 - Share And Open One Stable Resource Link (Priority: P1) 🎯 MVP

**Goal**: A user can copy a canonical HTTPS resource link and open it on web or mobile to reach the correct destination.

**Independent Test**: Copy a task link on one platform, open it on the other platform, and confirm the correct resource opens with the expected platform-local route.

### Tests for User Story 1

- [X] T015 [P] [US1] Implement backend integration scenarios for canonical generation across all supported resource types in backend/integration/canonical_links_test.go
- [X] T016 [P] [US1] Implement Playwright scenarios for opening canonical task links on desktop in frontend/apps/web/e2e/canonical-resource-links.spec.ts
- [X] T017 [P] [US1] Implement Maestro happy-path coverage for opening a canonical task link on mobile in frontend/apps/mobile/.maestro/canonical-resource-links.yaml

### Implementation for User Story 1

- [X] T018 [P] [US1] Add backend link-generation entry points for supported resources in backend/internal/collaboration/connect.go, backend/internal/docs/connect.go, and backend/internal/linking/generator.go
- [X] T019 [US1] Implement canonical resolver translation from `/o/[tenantKey]/r/[...slug]` to web task, project, doc, chat, and calendar destinations in frontend/apps/web/src/app/o/[tenantKey]/r/[...slug]/page.tsx, frontend/apps/web/src/app/workspace/tasks/[id]/page.tsx, and frontend/apps/web/src/app/workspace/tasks/[id]/tasks/[taskId]/page.tsx
- [X] T020 [US1] Implement canonical resolver translation to Expo task, project, doc, chat, and calendar destinations in frontend/apps/mobile/src/app/+native-intent.tsx and frontend/apps/mobile/src/app/(app)/(tasks)/[projectId]/[taskId].tsx
- [X] T021 [US1] Add copy-link actions that emit canonical HTTPS URLs in frontend/apps/web/src/app/workspace/tasks/[id]/tasks/[taskId]/page.tsx and frontend/apps/mobile/src/app/(app)/(tasks)/[projectId]/[taskId].tsx
- [X] T022 [US1] Add partial-context fallback handling so the correct parent resource still opens in frontend/apps/web/src/app/o/[tenantKey]/r/[...slug]/page.tsx and frontend/apps/mobile/src/app/+native-intent.tsx

**Checkpoint**: Canonical links can be copied and opened across web and mobile for supported resources.

---

## Phase 4: User Story 2 - Reach The Intended Destination After Resolution Checks (Priority: P1)

**Goal**: Signed-out, unauthorized, and missing-resource link opens produce explicit and recoverable outcomes.

**Independent Test**: Open the same canonical resource link while signed out, without permission, and after deletion; verify sign-in continuation, access denied, and not-found outcomes.

### Tests for User Story 2

- [X] T023 [P] [US2] Implement backend integration scenarios for auth-required, access-denied, not-found, and fallback outcomes in backend/integration/canonical_links_test.go
- [X] T024 [P] [US2] Implement Playwright scenarios for sign-in continuation and explicit failure states in frontend/apps/web/e2e/canonical-resource-links.spec.ts
- [X] T025 [P] [US2] Extend Maestro flow coverage for mobile auth continuation and explicit failure-state handling in frontend/apps/mobile/.maestro/canonical-resource-links.yaml

### Implementation for User Story 2

- [X] T026 [US2] Implement auth-aware resolution outcomes, destination continuation state, and access/not-found mapping in the backend Connect RPC resolver contract in backend/internal/linking/service.go, backend/internal/linking/connect.go, and backend/cmd/server.go
- [X] T027 [US2] Add web sign-in continuation and explicit access-denied, not-found, and fallback screens in frontend/apps/web/src/app/signin/page.tsx and frontend/apps/web/src/app/o/[tenantKey]/r/[...slug]/page.tsx
- [X] T028 [US2] Add mobile sign-in continuation and explicit access-denied, not-found, and fallback handling in frontend/apps/mobile/src/app/(auth)/signin.tsx and frontend/apps/mobile/src/app/+native-intent.tsx
- [X] T029 [US2] Implement legacy product-link normalization from tenant subdomain routes and recoverable fallback handling in backend/internal/linking/normalize.go, frontend/apps/web/src/app/o/[tenantKey]/r/[...slug]/page.tsx, and frontend/apps/mobile/src/app/+native-intent.tsx

**Checkpoint**: Link opens remain recoverable across sign-in, permission, missing-resource, and legacy-link cases.

---

## Phase 5: User Story 3 - Recognize And Reuse Internal Links In Product Content (Priority: P2)

**Goal**: Internal canonical links pasted into product content render preview cards when metadata is available, remain clickable on failure, and navigate internally on mobile.

**Independent Test**: Paste a canonical link into a supported input, confirm preview rendering or raw-link fallback, and tap the preview inside the mobile app for in-app navigation.

### Tests for User Story 3

- [X] T030 [P] [US3] Implement backend integration scenarios for preview metadata success and graceful failure in backend/integration/canonical_links_test.go
- [X] T031 [P] [US3] Implement Playwright scenarios for preview rendering and raw-link fallback in frontend/apps/web/e2e/canonical-resource-links.spec.ts
- [X] T032 [P] [US3] Implement Maestro flow coverage for tapping an internal canonical-link preview inside the app in frontend/apps/mobile/.maestro/canonical-resource-links.yaml

### Implementation for User Story 3

- [X] T033 [US3] Add a preview metadata RPC method or resolver expansion for internal canonical links in backend/internal/linking/preview.go and backend/internal/linking/connect.go
- [X] T034 [US3] Add canonical-link paste detection and preview-card rendering to web content surfaces in frontend/apps/web/src/app/components and frontend/packages/links/src/index.ts
- [X] T035 [US3] Add canonical-link paste detection and preview rendering to mobile content surfaces in frontend/apps/mobile/src/app/(app) and frontend/packages/links/src/index.ts
- [X] T036 [US3] Add in-app mobile navigation from internal canonical-link previews without browser handoff in frontend/apps/mobile/src/app/+native-intent.tsx and frontend/apps/mobile/src/app/(app)/(tasks)/[projectId]/[taskId].tsx

**Checkpoint**: Internal canonical links support previews, graceful degradation, and in-app navigation.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Finalize platform verification, rollout safety, and full-suite validation across stories.

- [X] T037 [P] Add deployment-safe `.well-known` hosting and main-host canonical-route documentation updates in frontend/apps/web/public/.well-known/apple-app-site-association, frontend/apps/web/public/.well-known/assetlinks.json, and frontend/apps/web/README.md
- [X] T038 [P] Add rollout and troubleshooting notes for AASA caching, Android verification delay, tenant-path canonical links, and main-host debugging in specs/030-canonical-resource-links/quickstart.md
- [X] T039 Validate mobile link changes affecting frontend/apps/mobile/app.json with pnpm --dir frontend exec tsc -p apps/mobile/tsconfig.json --noEmit
- [X] T040 Validate backend canonical-link changes in backend/integration/canonical_links_test.go with cd backend && go test ./integration/...
- [X] T041 Validate web canonical-link flows in frontend/apps/web/e2e/canonical-resource-links.spec.ts with pnpm --dir frontend --filter web exec playwright test --config=e2e/playwright.config.ts
- [X] T042 Validate mobile canonical-link flows in frontend/apps/mobile/.maestro/canonical-resource-links.yaml with make test-mobile

---

## Phase 7: Gap Remediation — Full Resource Coverage

**Purpose**: Close identified gaps so every supported resource type satisfies all three requirements: copy canonical link, preview rendering, and correct platform routing.

### P0 — Copy-Link Correctness Bugs

- [X] T043 Fix document copy-link on web: replace `window.location.href` with `buildCanonicalResourceLink` in frontend/apps/web/src/app/workspace/docs/components/DocumentView.tsx
- [X] T044 Fix document share on mobile: include canonical URL in `Share.share` call in frontend/apps/mobile/src/app/(app)/(more)/docs/[slug].tsx

### P1 — Missing Copy-Link Actions

- [X] T045 [P] Add copy canonical link action to web ThreadView (prop already accepts channelId; implement the button) in frontend/apps/web/src/app/workspace/chat/components/ThreadView.tsx
- [X] T046 [P] Add copy canonical link action to web chat channel view in frontend/apps/web/src/app/workspace/chat/
- [X] T047 [P] Add copy canonical link action to web project view in frontend/apps/web/src/app/workspace/projects/[id]/
- [X] T048 [P] Add copy canonical link action to web calendar event view in frontend/apps/web/src/app/workspace/calendar/
- [X] T049 [P] Fix booking copy-link on web: replace booking token URL with canonical resource link in the BookingLinkModal component
- [X] T050 [P] Add copy canonical link action to mobile chat channel screen
- [X] T051 [P] Add copy canonical link action to mobile chat thread screen
- [X] T052 [P] Add copy canonical link action to mobile calendar event screen
- [X] T053 [P] Add copy canonical link action to mobile project screen
- [X] T054 [P] Add copy canonical link action to mobile booking item screen (or fallback "open in browser" sheet if no mobile route exists)

### P1 — Mobile Routing: Fallback Sheet for Unsupported Resources

- [X] T055 Add backend `mobileRoute` for `thread` type in backend/internal/linking/service.go, or confirm fallback and ensure the "view in web browser" sheet renders the correct explanation and browser-open link in frontend/apps/mobile/src/app/+native-intent.tsx
- [X] T056 Add backend `mobileRoute` for `message` type in backend/internal/linking/service.go, or confirm fallback and fix the semantically incorrect client-side mapping (message ID ≠ thread parent ID) in frontend/packages/links/src/index.ts and frontend/apps/mobile/src/app/+native-intent.tsx
- [X] T057 Resolve `booking` mobile route mismatch: `/booking/{id}` path in links package does not exist in the Expo Router file tree; either create the screen at `frontend/apps/mobile/src/app/(app)/(calendar)/booking/[id].tsx` or correct the route and wire the "view in web" fallback sheet in frontend/apps/mobile/src/app/+native-intent.tsx

### P2 — Rich Preview Providers for Remaining Resource Types

- [X] T058 [P] Add `ChatChannelPreviewProvider` in backend/internal/linking/preview.go returning channel name and member count
- [X] T059 [P] Add `ChatThreadPreviewProvider` in backend/internal/linking/preview.go returning thread subject or first-message excerpt
- [X] T060 [P] Add `CalendarEventPreviewProvider` in backend/internal/linking/preview.go returning event title, date/time, and organizer
- [X] T061 [P] Add `ProjectPreviewProvider` in backend/internal/linking/preview.go returning project name and status
- [X] T062 [P] Add `BookingPreviewProvider` in backend/internal/linking/preview.go returning booking title and scheduled time
- [X] T063 Register new preview providers in backend/cmd/server.go

### P2 — Preview Rendering in Docs Editor Surface

- [X] T064 Wire canonical-link paste detection and preview-card rendering into the web docs editor surface in frontend/apps/web/src/app/workspace/docs/
- [X] T065 Wire canonical-link preview rendering into the mobile docs viewer in frontend/apps/mobile/src/app/(app)/(more)/docs/[slug].tsx

### P2 — Backend Resource Existence Validation

- [X] T066 Extend `resolveResourceStatus` in backend/internal/linking/service.go to verify existence for all supported resource types (not just `task`), returning `ResolutionStatusNotFound` when the resource does not exist

---

## Phase 8: Gap Remediation — Mobile Deep-Link Runtime Gaps

**Purpose**: Close runtime navigation gaps found after shared-resource and canonical-link wiring landed.

- [X] T067 Fix shared chat route parameter compatibility so `/(shared)/resource/chat/[id]` opens the reused chat channel screen instead of losing the channel identifier in frontend/apps/mobile/src/app/(app)/(chat)/[channelId].tsx and frontend/apps/mobile/src/app/(shared)/resource/chat/[id].tsx
- [X] T068 Add shared project route coverage for project canonical links converted from `/(app)/(tasks)/[projectId]` in frontend/apps/mobile/src/app/(shared)/resource/tasks/[projectId]/index.tsx
- [X] T069 Add mobile link-status browser fallback handling for unsupported canonical destinations in frontend/apps/mobile/src/lib/canonical-links.ts and frontend/apps/mobile/src/app/link-status.tsx
- [X] T070 Preserve recognized canonical notification links by falling back to the mobile fallback path when no exact mobile route exists in frontend/apps/mobile/src/lib/linking.ts
- [X] T071 Update the mobile navigation summary with the remediated shared-chat, project, and fallback behaviors in docs/mobile-navigation-summary.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Starts immediately.
- **Foundational (Phase 2)**: Depends on Setup completion and blocks user-story work.
- **User Story 1 (Phase 3)**: Starts after Foundational completion.
- **User Story 2 (Phase 4)**: Starts after Foundational completion and can proceed in parallel with US1 if capacity allows, but is easier after T008, T011, and T012 are complete.
- **User Story 3 (Phase 5)**: Starts after Foundational completion and depends on preview-capable backend resolution from T009 and T033.
- **Polish (Phase 6)**: Starts after desired user stories are complete.

### User Story Dependencies

- **US1**: No dependency on other stories after foundation.
- **US2**: Uses the same resolver and route-translation infrastructure as US1 but remains independently testable.
- **US3**: Uses canonical generation and resolution from US1 plus preview metadata support, but remains independently testable.

### Within Each User Story

- Test tasks must be created before implementation is considered complete.
- Backend contract work precedes client-specific route wiring.
- Web and mobile translation tasks can proceed in parallel once backend resolution is stable.
- Full-suite validation happens only after scenario implementation is done.

## Parallel Opportunities

- T002, T003, and T004 can run in parallel.
- T006, T007, T009, T010, T013, and T014 can run in parallel after T005 starts the shared contract surface.
- Within US1, T015, T016, and T017 can run in parallel, and T019 plus T020 can run in parallel after backend translation contracts are stable.
- Within US2, T023, T024, and T025 can run in parallel.
- Within US3, T030, T031, and T032 can run in parallel, and T034 plus T035 can run in parallel after T033 exists.

## Implementation Strategy

### MVP First

1. Finish Phase 1 and Phase 2.
2. Deliver US1 end to end.
3. Validate canonical cross-platform open behavior before expanding scope.

### Incremental Delivery

1. Add US1 for stable cross-platform open behavior.
2. Add US2 for auth, access, and fallback correctness.
3. Add US3 for internal preview and in-app navigation quality.

### Team Strategy

1. One engineer can own backend contract and normalization.
2. One engineer can own web resolver routes and `.well-known` hosting.
3. One engineer can own mobile verified-link config and Expo Router translation.
4. Test implementation can proceed in parallel once scenario stubs are in place.

## Notes

- The current web middleware in frontend/apps/web/src/middleware.ts is disabled for static export, so canonical resolution should not depend on middleware execution in production.
- Use a dedicated canonical path namespace such as `/o/[tenantKey]/r/...` on the main global host to avoid overly broad App Link capture, especially on Android 14 and lower, while keeping tenant-scoped lookups shard-safe.
- If backend persistence is later introduced for aliases or analytics, it must follow constitution multi-tenancy rules.