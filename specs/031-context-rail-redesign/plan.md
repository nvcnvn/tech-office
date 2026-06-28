# Implementation Plan: Workspace Context Rail Redesign

**Branch**: `031-context-rail-redesign` | **Date**: 2026-04-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/031-context-rail-redesign/spec.md`

## Summary

Replace the mock left-side Quick Info panel with a real right-side workspace context rail that is available on every workspace route, preserves its open or closed session state across navigation, keeps chat's ChannelSidebar on the left, and supports route-contributed page blocks in addition to shared global blocks. The implementation should keep the workspace shell as the single owner of the rail, introduce a route-safe registration mechanism for page-specific content, reuse existing live calendar, presence, and unread-notification APIs where they already fit, and add focused read contracts only where the current APIs are too coarse for the rail, especially cross-project task summaries and chat pinned-message summaries.

## Technical Context

**Language/Version**: TypeScript 5.9.x for frontend implementation; Go 1.25.x for any supporting backend read contracts  
**Primary Dependencies**: Next.js 15.5.2, React 19.1, MUI 7.3.2, TanStack React Query 5.x, Connect RPC API packages, PostgreSQL/Citus, sqlc  
**Storage**: Existing PostgreSQL/Citus tenant data for calendar, chat, collaboration, IAM, and notification summaries; browser session persistence for rail open or closed state  
**Testing**: Playwright E2E in `frontend/apps/web/e2e/`; Go integration tests in `backend/integration/`; frontend lint via `pnpm --dir frontend exec eslint .`  
**Target Platform**: Next.js web workspace for desktop and narrow-width responsive layouts  
**Project Type**: Multi-project SaaS platform with Go backend and Next.js web frontend  
**Performance Goals**: Rail open or close interaction feels immediate without page reload; route changes do not flash stale page-specific blocks; global summaries render within normal query latency and degrade per block when a source fails  
**Constraints**: Preserve chat left navigation behavior; rail toggle must remain visible on every workspace route; no hardcoded mock strings remain in the rail; narrow screens auto-collapse instead of compressing content; each block must fail independently  
**Scale/Scope**: Workspace shell plus tasks, calendar, chat, organization, docs, and settings routes; first page-specific blocks for calendar and chat; extensible registration model for later routes

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I: Data Governance & Multi-Tenancy with Citus Sharding**: PASS. The feature is primarily a frontend shell redesign over existing tenant-scoped data. If focused backend read contracts are added for work-today or pinned-message summaries, they must remain organization-scoped through auth context and existing tenant tables without exposing `organization_id` in user-facing contracts.
- **Principle II: Scenario-First Integration & E2E Testing**: PASS. This plan includes a behavioral contract artifact covering backend integration scenarios for any new summary contracts and Playwright scenarios for route availability, layout behavior, persistence, and page-specific rendering.
- **No Unauthorized New Top-Level Surface**: PASS. The feature extends the existing workspace layout, API packages, and backend services rather than creating a parallel shell.
- **Gate Result Before Phase 0**: PASS.
- **Gate Result After Phase 1 Design**: PASS. Research, data model, quickstart, and contracts preserve the existing multi-tenant backend model and define required scenario coverage before tasks.

## Project Structure

### Documentation (this feature)

```text
specs/031-context-rail-redesign/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── behavioral-contract.md
│   └── context-rail-contract.md
└── tasks.md
```

### Source Code (repository root)

```text
backend/
├── database/
│   └── scripts/
├── integration/
├── internal/
│   ├── calendar/
│   ├── chat/
│   ├── collaboration/
│   └── notification/
└── rpc/
    └── v1/

frontend/
├── apps/
│   └── web/
│       ├── e2e/
│       └── src/
│           ├── app/workspace/
│           │   ├── calendar/
│           │   ├── chat/
│           │   └── providers/
│           └── lib/
└── packages/
    ├── apis/
    └── notifications/
```

**Structure Decision**: Use the existing Next.js workspace layout as the single owner of the new right-side rail, let individual workspace routes contribute page blocks through a shared provider or registry, and only extend backend and API-package contracts where the current client helpers are too project-scoped or history-heavy for a compact cross-route rail.

## Phase 0 Research Summary

- The current Quick Info panel is hardcoded in the shared workspace layout and is rendered on the left for every non-chat page, while chat already reserves the left slot for `ChannelSidebar`.
- The shared layout is already the controlling shell and therefore the correct owner for a right-side context rail and session-persisted open or closed state.
- Live data sources already exist for user identity, unread notification count, calendar event lists, invite responses, and channel members.
- Two important data gaps remain for the rail's compact summaries: the frontend task helper is project-scoped, so a cross-project “My Work Today” summary needs a focused backend read contract, and there is no dedicated pinned-message summary contract for chat rail rendering.
- Calendar already has RSVP actions in the event detail surface, but the page does not yet expose an explicit selected-day context to a shared shell, so the design needs a page-to-shell registration path.
- Narrow-width behavior should follow the existing collapse pattern: hide the rail automatically and keep a visible toggle rather than squeezing the main content.

## Phase 1 Design Summary

- Introduce a workspace context-rail provider that owns rail visibility state, route registration, and stale-registration cleanup when navigation changes.
- Render the rail on the right side of the workspace shell on every route, leaving the left side free for route-specific structural navigation such as chat's `ChannelSidebar`.
- Split rail content into always-available global blocks and optional route-contributed page blocks, with each block fetched and error-handled independently.
- Reuse existing APIs for user identity, presence, next event, unread count, calendar invite actions, and channel members; add focused backend summaries for cross-project work-today data and pinned message summaries if those cannot be composed efficiently from existing contracts.
- Default calendar rail content to today's day summary when no explicit day selection is registered, and update it from page state when the user changes selection.
- Keep page blocks out of routes that do not register them, so tasks, organization, docs, and settings show only global blocks until dedicated page content is added.

## Implementation Phases

### Phase 2 Execution Outline

1. Add the workspace rail provider, registration contract, and right-side shell slot in the shared workspace layout.
2. Replace all mock Quick Info content with global rail blocks backed by live data and meaningful empty states.
3. Add calendar page registration for selected-day summaries and pending-invite actions.
4. Add chat page registration for active-channel member and pinned-message summaries while preserving the existing left `ChannelSidebar`.
5. Add or extend focused backend and API-package read contracts for cross-project work-today summaries and pinned-message summaries if existing client helpers remain insufficient.
6. Add backend integration scenarios and Playwright scenarios, then validate responsive behavior and session persistence.

## Complexity Tracking

No constitution violations currently require justification.
