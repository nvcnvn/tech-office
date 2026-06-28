# Implementation Plan: Ritual UX Redesign

**Branch**: `029-ritual-ux-redesign` | **Date**: 2026-04-20 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/029-ritual-ux-redesign/spec.md`

## Summary

This feature reorients ritual and mixed collaboration modes around operations-first task navigation instead of a generic board-first planning model. The implementation will primarily reorganize existing web and mobile collaboration surfaces so default landing behavior, navigation labels, mixed-mode separation, and ritual instance entry points match the mental models defined in the redesign proposal.

The planned outcome is:
1. Mode-aware default project landing: `Board` for standard, `Today` for ritual, and `Overview` for mixed.
2. Ritual-first navigation that treats live work, review backlog, health, and template management as distinct surfaces.
3. Mixed-mode surfaces that separate `Planned Work` from `Routine Operations` structurally rather than with badges alone.
4. A mobile flow that stays task-first for workers and task-targeted for urgent manager review.
5. The web workspace route model uses `/workspace/tasks` as the user-facing day-to-day entry, with compatibility redirects from legacy `/workspace/projects` links.
6. Contract-driven validation across backend integration, web E2E, and mobile manual/Maestro verification before implementation is considered done.

**Research**: [research.md](./research.md)  
**Data Model**: [data-model.md](./data-model.md)  
**Contracts**: [contracts/navigation-contract.md](./contracts/navigation-contract.md), [contracts/ui-surface-contract.md](./contracts/ui-surface-contract.md)  
**Quickstart**: [quickstart.md](./quickstart.md)  
**Scenario Contracts**: `backend/integration/collaboration_ritual_ux_redesign_test.go`, `frontend/apps/web/e2e/ritual-ux-redesign.spec.ts`

## Technical Context

**Language/Version**: TypeScript 5.x, React 19, Next.js 15.5.2, Expo 55 / React Native 0.83.4, Go 1.25.0  
**Primary Dependencies**: MUI 7, TanStack React Query 5, Expo Router, ConnectRPC, sqlc, Playwright, Maestro  
**Storage**: PostgreSQL 18 + Citus, existing collaboration/ritual/evidence tables, existing notification routing state  
**Testing**: Go integration tests in `backend/integration/`, Playwright in `frontend/apps/web/e2e/`, Maestro in `frontend/apps/mobile/.maestro/`  
**Target Platform**: Desktop/tablet web workspace and mobile iOS/Android app  
**Project Type**: Multi-app monorepo with backend API, web client, mobile client, and shared frontend API wrappers  
**Performance Goals**: Preserve current task and project-view responsiveness while reducing navigation hops for ritual workers and mixed-mode users  
**Constraints**: Reuse typed wrappers in `frontend/packages/apis`; keep ritual instance versus template separation explicit; avoid schema/proto changes unless current projections cannot support mixed overview or ritual review surfaces; preserve notification deep-link focus semantics; keep mobile employee flows simpler than web management flows; preserve backward-compatible redirects from `/workspace/projects` while callers migrate to `/workspace/tasks`  
**Scale/Scope**: Cross-platform ritual UX redesign affecting project landing behavior, project navigation, today/list/overview surfaces, ritual detail entry routing, review/health access, and supporting verification artifacts

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Phase 0 Gate Review

#### I. Data Governance & Multi-Tenancy with Citus Sharding
- [x] The planned redesign is frontend-first and can likely reuse the existing collaboration, ritual, evidence, and notification schema.
- [x] If additive read APIs become necessary, they will stay organization-scoped and use existing collaboration domain tables with explicit tenant filtering.
- [x] No cross-schema SQL joins or user-supplied `organization_id` are planned.

#### II. Scenario-First Integration & E2E Testing
- [x] Backend integration scenario stubs are composed in `backend/integration/collaboration_ritual_ux_redesign_test.go`.
- [x] Web E2E scenario stubs are composed in `frontend/apps/web/e2e/ritual-ux-redesign.spec.ts`.
- [ ] Scenario stubs still require developer review before implementation begins.
- [ ] Mobile Maestro happy-path coverage still needs to be added during implementation for the employee ritual flow.
- [x] This plan defines the required test surfaces and validation targets for backend, web, and mobile.

#### IV. Cross-Domain Integration
- [x] The redesign primarily reuses existing collaboration, notification, and ritual flows instead of introducing new service-to-service coupling.
- [x] Any new overview or review projection should be exposed through collaboration logic or existing typed wrapper composition, not ad hoc cross-domain SQL.
- [x] Notification deep links remain within current collaboration and notification ownership boundaries.

#### VII. Frontend API Wrapper Pattern & Type Safety
- [x] All frontend data access remains behind `frontend/packages/apis` wrappers.
- [x] New interactive controls on web must expose stable `data-testid` hooks for Playwright coverage.
- [x] Styling changes must stay within the existing theme system and shared UI conventions.

#### VIII. Cross-Stack Constant & Type Synchronization
- [x] Existing collaboration-mode, task-kind, and ritual focus-intent constants remain the system of record.
- [x] No new cross-stack constants are required unless implementation introduces an additive route/view identifier or API-visible overview state.
- [x] Any new constant added during implementation must be coordinated across proto, backend, wrappers, and clients in one change.

#### XII. Architecture Documentation Maintenance
- [x] Consulted `backend/docs/SYSTEM-ARCHITECTURE.md` and `backend/docs/NOTIFICATION-SYSTEM-ARCHITECTURE.md` during planning.
- [x] Planned changes stay within the current tier model: collaboration owns task/ritual orchestration and notification owns alert routing.
- [x] Backend architecture docs only need updates if implementation introduces new collaboration read APIs or notification payload contracts.

#### XIII. Mobile Application Design & Testing
- [x] Mobile scope remains employee-first and notification-targeted, not admin-first.
- [x] Review backlog management stays web-first while mobile supports focused task-level action.
- [x] Plan preserves a distinct mobile interaction model rather than mirroring the web IA one-to-one.

### Post-Design Gate Review

- [x] Research resolved the planning questions without leaving `NEEDS CLARIFICATION` markers.
- [x] Design artifacts preserve task-first language and keep template management visibly separate from live ritual execution.
- [x] Mixed-mode contracts explicitly separate planned work from routine operations.
- [x] No unjustified constitution violations remain; the only pending items are scenario review and later executable Maestro coverage during implementation.

## Project Structure

### Documentation (this feature)

```text
specs/029-ritual-ux-redesign/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── navigation-contract.md
│   └── ui-surface-contract.md
└── tasks.md
```

### Source Code (repository root)

```text
backend/
├── docs/
├── integration/
│   └── collaboration_ritual_ux_redesign_test.go
└── internal/collaboration/

frontend/
├── apps/
│   ├── web/
│   │   ├── e2e/
│   │   │   └── ritual-ux-redesign.spec.ts
│   │   └── src/app/workspace/
│   │       ├── projects/
│   │       │   ├── page.tsx
│   │       │   └── [id]/
│   │       │       ├── components/
│   │       │       ├── rituals/[definitionId]/page.tsx
│   │       │       └── tasks/[taskId]/
│   │       ├── tasks/
│   │       │   ├── page.tsx
│   │       │   └── [id]/
│   │       │       ├── components/
│   │       │       ├── rituals/[definitionId]/page.tsx
│   │       │       └── tasks/[taskId]/
│   │       └── ...redirect compatibility wiring between `projects` and `tasks`
│   └── mobile/
│       ├── .maestro/
│       └── src/app/(app)/(tasks)/
└── packages/apis/src/
```

**Structure Decision**: This feature spans the existing collaboration backend plus both clients, but the main implementation work is in the web and mobile task/navigation surfaces that already branch on `collaborationMode`. During the route-family rename, the current web source still lives under `workspace/projects` while new user-facing route ownership moves to `workspace/tasks`, so the implementation must cover both the transition source tree and the compatibility redirects. Backend changes should remain additive and limited to collaboration read-model support only if the current task, evidence, compliance, and notification projections prove insufficient for mixed overview, ritual review, or worklist presentation.

## Phase 0 — Research Outcomes

Research resolved the key planning questions:
- Use collaboration mode to choose the default landing view instead of always teaching a board-first model.
- Keep `Tasks` as the primary everyday language while treating the project container as secondary management context.
- Make the web route model match that language by renaming the main workspace entry to `/workspace/tasks` and redirecting legacy `/workspace/projects` URLs.
- Introduce a mixed `Overview` surface and explicit `Planned Work` versus `Routine Operations` navigation rather than blending task types.
- Make ritual `Today`, `Worklist`, `Review`, and `Health` the primary ritual surfaces, with any board-like view remaining secondary.
- Preserve the live ritual instance as the destination for work and review actions while keeping ritual definitions as template-management surfaces.
- Reuse existing web and mobile ritual/detail abstractions before adding new backend contracts.

## Phase 1 — Design Outcomes

Phase 1 produces:
- `data-model.md` defining the derived interaction entities and role/surface relationships for the redesign.
- `contracts/navigation-contract.md` covering default landing, route ownership, and entry-surface behavior.
- `contracts/ui-surface-contract.md` covering role visibility and allowed actions across ritual and mixed surfaces.
- Scenario contracts in `backend/integration/collaboration_ritual_ux_redesign_test.go` and `frontend/apps/web/e2e/ritual-ux-redesign.spec.ts`.
- `quickstart.md` documenting validation flows for standard, ritual, and mixed behavior on web and mobile.

## Phase 2 — Implementation Preview

Planned implementation work groups into six streams:

1. **Mode-aware project entry**
  - Update project detail routing so unpinned entry defaults to the correct surface for standard, ritual, and mixed collaboration modes.
  - Rename the day-to-day workspace route family from `/workspace/projects` to `/workspace/tasks`, with redirect compatibility for legacy entry points.

2. **Web navigation and information architecture**
  - Replace flat view affordances with mode-appropriate top-level surfaces, including mixed `Overview`, `Planned Work`, and `Routine Operations`.
  - Update workspace shell navigation, shared links, and copied URLs so user-facing route naming stays aligned with `Tasks`.

3. **Ritual-first list and detail orchestration**
  - Refine `TodayView`, `ListView`, `BoardView`, `AnalyticsView`, `RitualReviewBacklog`, and the ritual task detail composition so live work, review, health, and template guidance are clearly separated.
  - Migrate nested review, calendar, worklist, ritual settings, and task detail links to the `/workspace/tasks` route family without losing focus intent semantics.

4. **Mobile task-first flow refinement**
  - Keep the employee flow centered on Tasks focus mode and ritual instance detail, with capture-oriented actions and notification-targeted review entry.

5. **Additive API and projection support if required**
  - Reuse current wrappers first; only add collaboration read endpoints or wrapper-level aggregations if current data cannot support the mixed overview, ritual worklist, or review backlog surfaces efficiently.

6. **Behavioral verification**
  - Use the composed backend integration and web E2E scenario contracts as the behavioral contract before implementation begins.
  - Implement mobile Maestro coverage for the worker happy path during execution.
  - Add URL-level assertions and redirect compatibility coverage for the renamed web routes.
  - Validate full backend integration and Playwright suites before completion.

## Test Scenarios (Behavioral Contract)

*Required by Constitution §II — composed before implementation and ready for review.*

**Backend integration contract**: `backend/integration/collaboration_ritual_ux_redesign_test.go`  
**Web E2E contract**: `frontend/apps/web/e2e/ritual-ux-redesign.spec.ts`

Scenario groups covered by both contract files:

- **Mode-aware entry**: standard projects open on a planning-first surface, ritual projects open on `Today`, and mixed projects open on `Overview`.
- **Ritual worker execution**: urgency-first grouping, live-instance routing, focused missing or rejected requirement, and task-first copy.
- **Ritual owner and reviewer separation**: distinct `Today`, `Review`, `Health`, `Calendar`, and `Worklist` surfaces; board-secondary behavior; template-management separation.
- **Mixed-project separation**: overview summarization, split `Today` sections, and non-overlapping `Planned Work` versus `Routine Operations` routing.
- **Route ownership and compatibility**: user-facing workspace, project, and task links use `/workspace/tasks`, while legacy `/workspace/projects` links redirect without losing query state or ritual focus intents.
- **Mobile and edge-context behavior**: alert-driven review focus, dual-role instance layout, and exceptional skipped or detached instance context.

## Complexity Tracking

No constitutional complexity exceptions are currently required.
