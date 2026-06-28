# Implementation Plan: Ritual Submission Flow

**Branch**: `028-ritual-submission-flow` | **Date**: 2026-04-20 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/028-ritual-submission-flow/spec.md`

## Summary

This feature aligns the ritual evidence experience around one core rule: live submission and review happen on ritual instances, while ritual definitions remain template-management surfaces. The implementation is primarily a frontend orchestration and navigation change across web and mobile, with selective backend additions only if the current ritual/task APIs cannot support a project-level pending-review surface.

The planned outcome is:
1. A task-instance-first submission flow on both platforms.
2. A web-first reviewer backlog surface plus task-level review context.
3. Mobile capture-optimized submission and task-level urgent review handling.
4. Consistent entry-point routing from today views, task lists, and notifications.
5. Scenario-contract coverage for backend integration, web E2E, and a documented mobile happy path.

**Research**: [research.md](./research.md)  
**Data Model**: [data-model.md](./data-model.md)  
**Contracts**: [contracts/ui-surface-contract.md](./contracts/ui-surface-contract.md), [contracts/navigation-contract.md](./contracts/navigation-contract.md)  
**Quickstart**: [quickstart.md](./quickstart.md)  
**Scenario Contracts**: `backend/integration/ritual_submission_flow_test.go`, `frontend/apps/web/e2e/ritual-submission-flow.spec.ts`

## Technical Context

**Language/Version**: TypeScript 5.x, React 19, Next.js 15.5, Expo 55 / React Native 0.83, Go 1.25.0  
**Primary Dependencies**: MUI 7, TanStack React Query 5, Expo Router, ConnectRPC, sqlc, Playwright, Maestro  
**Storage**: PostgreSQL 18 + Citus, existing files storage/upload pipeline for evidence attachments  
**Testing**: Go integration tests in `backend/integration/`, Playwright in `frontend/apps/web/e2e/`, Maestro flows in `frontend/apps/mobile/.maestro/`  
**Target Platform**: Desktop/tablet web workspace and mobile iOS/Android app  
**Project Type**: Multi-app monorepo with backend API, web client, and mobile client  
**Performance Goals**: Preserve current task-detail responsiveness while adding no extra navigation hops for primary submission and review paths  
**Constraints**: Maintain task-instance versus template separation; reuse typed API wrappers in `frontend/packages/apis`; use `useThemeColors` and existing theme tokens; avoid schema/proto changes unless current APIs prove insufficient for the review backlog surface; keep notification entry points task-first  
**Scale/Scope**: One cross-platform ritual UX feature affecting task detail, task lists/today views, notification entry points, reviewer surfaces, and associated tests without changing ritual generation or task lifecycle rules

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Phase 0 Gate Review

#### I. Data Governance & Multi-Tenancy with Citus Sharding
- [x] No schema change is required for the planned MVP flow.
- [x] Existing ritual/evidence entities already carry `organization_id` and stay within current domain boundaries.
- [x] If a new reviewer backlog endpoint is added, it will use existing collaboration/evidence tables and explicit organization-scoped queries.

#### II. Scenario-First Integration & E2E Testing
- [x] Backend scenario stubs composed in `backend/integration/ritual_submission_flow_test.go`.
- [x] Web E2E scenario stubs composed in `frontend/apps/web/e2e/ritual-submission-flow.spec.ts`.
- [ ] Scenario stubs still require developer review before implementation begins.
- [ ] Mobile Maestro happy-path flow is documented in quickstart and remains to be added as an executable flow during implementation.
- [x] Plan includes full-suite validation expectations for backend integration, Playwright, and mobile happy-path coverage.

#### IV. Cross-Domain Integration
- [x] Plan reuses collaboration ritual APIs and existing notification/task navigation patterns before introducing new interfaces.
- [x] Any new reviewer backlog surface will prefer existing task/evidence APIs and only add an additive collaboration read API if current data is insufficient.
- [x] No direct cross-schema SQL joins are planned from frontend concerns; backend changes remain in collaboration/notification service boundaries.

#### VII. Frontend UI & Type Safety
- [x] All frontend interactions remain behind typed wrappers in `frontend/packages/apis`.
- [x] Plan preserves separate web and mobile interaction patterns while keeping user intent consistent.
- [x] Plan requires `data-testid` coverage for new interactive web controls and themed styling on all changed web surfaces.

#### VIII. Cross-Stack Constant & Type Synchronization
- [x] Existing ritual task kinds, state categories, and approval statuses remain the system of record.
- [x] No new cross-stack constants are required for MVP beyond additive UI-only labels and route intents.
- [x] If a new notification deep-link hint or review mode flag becomes API-visible, it must be introduced atomically across backend, wrappers, and clients.

#### XII. Architecture Documentation
- [x] Relevant architecture docs read: `backend/docs/SYSTEM-ARCHITECTURE.md`, `backend/docs/NOTIFICATION-SYSTEM-ARCHITECTURE.md`.
- [x] Planned changes fit the existing tier model: collaboration orchestrates ritual/task views and notification continues to own routing state.
- [x] No architecture-document update is required unless implementation adds a new notification payload contract or collaboration read API.

### Post-Design Gate Review

- [x] Research resolved all planning unknowns without leaving `NEEDS CLARIFICATION` markers.
- [x] Design artifacts preserve the task-instance-first rule across web and mobile.
- [x] Contracts document separate submission, review, and template-management surfaces.
- [x] No unjustified constitution violations remain; pending items are limited to the required scenario review and future Maestro implementation during feature execution.

## Project Structure

### Documentation (this feature)

```text
specs/028-ritual-submission-flow/
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
├── integration/
│   └── ritual_submission_flow_test.go
└── internal/
   └── collaboration/

frontend/
├── apps/
│   ├── web/
│   │   ├── e2e/
│   │   │   └── ritual-submission-flow.spec.ts
│   │   └── src/app/workspace/projects/[id]/
│   │       ├── components/
│   │       └── tasks/[taskId]/components/
│   └── mobile/
│       ├── .maestro/
│       └── src/app/(app)/(tasks)/
└── packages/
   └── apis/src/
```

**Structure Decision**: This feature spans the existing collaboration backend plus both frontend clients. The implementation will center on task-detail and entry-point surfaces in the web and mobile apps, with API wrapper updates in `frontend/packages/apis` only if the current ritual collaboration wrappers are insufficient.

## Phase 0 — Research Outcomes

Research resolved the key planning questions:
- Use ritual instance tasks, not ritual definitions, as the canonical submission surface.
- Keep platform-specific interaction differences where they improve usability: inline submission/review context on web and capture-focused flows on mobile.
- Add a reviewer-oriented backlog surface on web using existing task/evidence data where possible.
- Route today/list/notification entry points to ritual instances, optionally focused on a specific requirement or review intent.
- Avoid backend contract changes unless the pending-review backlog cannot be built from existing task/evidence projections.

## Phase 1 — Design Outcomes

Phase 1 produces:
- `data-model.md` defining the interaction entities and role visibility model.
- UI contracts covering surface ownership, action visibility, and navigation entry points.
- `quickstart.md` documenting manual validation flows for worker, reviewer, and notification entry.
- Scenario contracts for backend integration and web E2E, with mobile coverage documented for later Maestro implementation.

## Phase 2 — Implementation Preview

Planned implementation work naturally groups into five streams:

1. **Web task-instance experience**
  - Refine `EvidenceChecklist`, `EvidenceSubmitForm`, and task-page composition so managers who are also assignees can still submit.
  - Preserve clear separation between `RitualDefinitionSection` and live evidence actions.

2. **Web reviewer backlog**
  - Add a reviewer-oriented surface within the project/task workspace for pending ritual submissions.
  - Reuse `Task.evidenceProgress` and `listEvidenceSubmissions()` first; add an additive read endpoint only if necessary.

3. **Mobile task and capture flow**
  - Keep submission launched from ritual task detail with requirement-focused routing.
  - Add lightweight manager review actions on task detail if needed for urgent mobile review; backlog management stays web-first.

4. **Entry-point routing and notification focus**
  - Ensure today/list/notification flows resolve to the correct task instance.
  - Support focused entry to a specific requirement or review state when the source surface provides enough context.

5. **Test completion and regression protection**
  - Fill in backend integration scenarios.
  - Implement Playwright coverage for submit/review flows.
  - Add the mobile Maestro happy path before feature completion.

## Complexity Tracking

No constitutional complexity exceptions are currently required.

