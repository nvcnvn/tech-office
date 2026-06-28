
# Implementation Plan: Notification Hub Frontend

**Branch**: `008-notification-hub-frontend` | **Date**: October 28, 2025 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/008-notification-hub-frontend/spec.md`

## Execution Flow (/plan command scope)
```
1. Load feature spec from Input path
   → If not found: ERROR "No feature spec at {path}"
2. Fill Technical Context (scan for NEEDS CLARIFICATION)
   → Detect Project Type from file system structure or context (web=frontend+backend, mobile=app+api)
   → Set Structure Decision based on project type
3. Fill the Constitution Check section based on the content of the constitution document.
4. Evaluate Constitution Check section below
   → If violations exist: Document in Complexity Tracking
   → If no justification possible: ERROR "Simplify approach first"
   → Update Progress Tracking: Initial Constitution Check
5. Execute Phase 0 → research.md
   → If NEEDS CLARIFICATION remain: ERROR "Resolve unknowns"
6. Execute Phase 1 → contracts, data-model.md, quickstart.md, agent-specific template file (e.g., `CLAUDE.md` for Claude Code, `.github/copilot-instructions.md` for GitHub Copilot, `GEMINI.md` for Gemini CLI, `QWEN.md` for Qwen Code, or `AGENTS.md` for all other agents).
7. Re-evaluate Constitution Check section
   → If new violations: Refactor design, return to Phase 1
   → Update Progress Tracking: Post-Design Constitution Check
8. Plan Phase 2 → Describe task generation approach (DO NOT create tasks.md)
9. STOP - Ready for /tasks command
```

**IMPORTANT**: The /plan command STOPS at step 7. Phases 2-4 are executed by other commands:
- Phase 2: /tasks command creates tasks.md
- Phase 3-4: Implementation execution (manual or via tools)

## Summary
This feature implements a comprehensive frontend interface for the notification hub system built in #007-notification-hub-backend. The notification hub provides employees with a centralized location to view all notifications from different business domains (chat, CRM, projects, HR, support, finance), track read/unread status, and receive real-time updates via Server-Sent Events (SSE). The implementation includes:

1. **Notification Hub Page**: Full-page notification list with filtering, pagination, and bulk actions
2. **Right Sidebar Preview**: Quick notification preview in workspace layout sidebar showing 3-5 recent unread notifications
3. **Real-Time SSE Integration**: Unidirectional server-to-client streaming with automatic reconnection, missed event replay, and proactive 5-minute connection cycling
4. **State Management**: Client-side notification state, connection health tracking, and optimistic UI updates

**Technical Approach**: Frontend-only implementation leveraging existing backend APIs (NotificationService RPC) with Connect-Web client. Uses React hooks for state management, MUI components for UI, and follows workspace layout patterns. SSE is unidirectional (server → client): client makes initial `StreamNotifications` request, then server continuously pushes `NotificationEvent` messages. Backend SSE endpoint authentication already in place via AuthInterceptor; minor backend fix needed for streaming interceptor support.

## Technical Context
**Project Type**: web (frontend + backend monorepo)  

**Frontend Stack**: 
- Language: TypeScript 5.x
- Framework: Next.js 15 (App Router)
- UI Library: Material-UI (MUI) v5
- State Management: React hooks, TanStack Query (for server state)
- RPC Client: Connect-Web (protobuf)
- Package Manager: pnpm workspace
- Testing: React Testing Library, Vitest (post-verification)

**Backend Stack** (already implemented in #007):
- Language: Go 1.25+
- Database: PostgreSQL 18+ (notification schema already exists)
- ORM: sqlc (type-safe SQL code generation)
- RPC: Protocol Buffers + ConnectRPC
- Auth: Zitadel integration (JWT tokens via AuthInterceptor)
- SSE: Server-Sent Events with PostgreSQL LISTEN/NOTIFY
- Testing: Go testing, testify

**Infrastructure**:
- Container: Docker
- Orchestration: Kubernetes (StackGres for PostgreSQL)
- Deployment: dev/prod overlays in k8s/

**Performance Goals**: 
- Initial notification list load: <2 seconds
- Real-time notification render: <500ms after SSE event received
- SSE connection establishment: <1 second
- Pagination load: <1 second

**Constraints**: 
- Multi-tenant isolation enforced at backend (organization_id filters)
- RBAC: ROLE_OWNER, ROLE_OPERATOR, ROLE_EMPLOYEE can access notification endpoints
- SSE authentication via Authorization: Bearer <token> header
- Frontend uses same auth token from useRequireAuth hook
- Backend streaming interceptor support needs minor fix (WrapStreamingHandler method)

**Scale/Scope**: 
- Expected: 10k employees per organization
- Notification volume: 100k notifications per day per organization
- SSE connections: Up to 10k concurrent per backend instance
- Notification list pagination: 50 items per page
- Right sidebar preview: 3-5 most recent unread notifications

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Backend Service Architecture Checks
This feature is **FRONTEND-ONLY** implementation. Backend notification service already exists from #007-notification-hub-backend:
- [x] No new backend service required - NotificationService already implemented
- [x] Existing service follows Constitution patterns (AdminPool/TenantPool, txn.WithTxn)
- [x] Proto-level access control already defined in notification.proto
- [x] Tenant isolation enforced via TenantPool for all employee-facing methods
- [N/A] No database schema changes required

**Minor Backend Fix Required** (not blocking frontend development):
- ⚠️ AuthInterceptor needs streaming support: Add `WrapStreamingHandler` and `WrapStreamingClient` methods to implement full `connect.Interceptor` interface
- This is needed for SSE authentication to work properly with streaming RPCs
- Frontend can proceed with implementation; backend fix can be done in parallel

### Codegen & Generated-Client Checks
- [x] No SQL schema changes - using existing notification schema
- [x] No proto changes - using existing notification.proto from #007
- [x] Frontend API client already exists: `frontend/packages/apis/src/notification.ts`
- [x] RPC client already generated: `frontend/packages/rpc` includes notification service
- [N/A] No codegen steps required for this feature

### Frontend Workspace Architecture Checks (Constitution v3.5.0)
- [ ] Feature follows workspace layout pattern - notifications under `/workspace/notifications/`
- [ ] Shares workspace/layout.tsx (DO NOT create duplicate layout)
- [ ] Adds new "Notifications" tab to workspace navigation
- [ ] Right sidebar preview integrated into existing layout sidebar component
- [ ] Uses TabLink component for sub-navigation (All, Unread, By Source)
- [ ] Applies UI/UX density principles:
  - [ ] Top navigation max 56px, sub-nav max 48px
  - [ ] Vertical spacing: py-4 to py-6 for pages, gap-4 to gap-6 for sections
  - [ ] Horizontal space utilization: filters + actions in same row
  - [ ] Component density: h-10 table rows, text-sm body text
  - [ ] Isolated scroll containers with proper overflow handling

### Post-Verification Testing
- [ ] Core functionality implemented first (notification list, SSE connection, mark as read)
- [ ] Manual verification by human developer before writing tests
- [ ] Tests added after behavior confirmation:
  - [ ] Component tests for NotificationList, NotificationItem, SSE connection manager
  - [ ] Integration tests for SSE reconnection flow
  - [ ] E2E test for notification hub user journey (view, mark as read, filter)

### YAGNI & Simplicity Checks
- [x] No premature optimization - simple React state for notifications
- [x] Observable solution - SSE connection status visible in UI
- [x] Structured logging - console logs for SSE events in development mode
- [x] No unnecessary abstraction - direct use of Connect-Web streaming API
- [x] Complexity justified - SSE reconnection logic required for reliability

**GATE STATUS**: ✅ PASS - Frontend-only implementation with no constitutional violations. Minor backend fix for streaming interceptor noted but not blocking.

## Project Structure

### Documentation (this feature)
```
specs/008-notification-hub-frontend/
├── plan.md              # This file (/plan command output)
├── research.md          # Phase 0 output (/plan command)
├── data-model.md        # Phase 1 output (/plan command) - Frontend state models
├── quickstart.md        # Phase 1 output (/plan command)
├── contracts/           # Phase 1 output (/plan command) - TypeScript interfaces
│   └── types.ts         # Frontend notification types and SSE state
└── tasks.md             # Phase 2 output (/tasks command - NOT created by /plan)
```

### Source Code (Tech Office Monorepo)

**Backend Structure** (already exists from #007):
```
backend/
├── internal/
│   └── notification/
│       ├── notification.go      # [EXISTS] NotificationService implementation
│       ├── sse.go               # [EXISTS] SSE streaming logic
│       ├── registry.go          # [EXISTS] Connection registry
│       ├── publisher.go         # [EXISTS] Notification publisher
│       ├── listener.go          # [EXISTS] LISTEN/NOTIFY handler
│       ├── delivery.go          # [EXISTS] Notification delivery
│       └── deduplication.go     # [EXISTS] Deduplication logic
├── internal/interceptor/
│   └── auth.go                  # [MINOR FIX] Add WrapStreamingHandler method
├── rpc/v1/
│   ├── notification.proto       # [EXISTS] NotificationService RPC contract
│   └── notification.pb.go       # [EXISTS] Generated protobuf code
└── database/
    └── scripts/
        ├── schema.sql           # [EXISTS] notification schema
        └── notification.query.sql  # [EXISTS] sqlc queries

Database Schemas Involved: notification (already exists)

No backend changes required for core functionality. Optional streaming interceptor fix.
```

**Frontend Structure** (NEW):
```
frontend/
├── apps/
│   └── web/
│       └── src/
│           └── app/
│               └── workspace/
│                   ├── layout.tsx               # [MODIFY] Add notifications tab + sidebar preview
│                   ├── notifications/           # [NEW] Notification hub domain
│                   │   ├── page.tsx             # [NEW] Main notification hub page
│                   │   ├── README.md            # [NEW] Feature documentation
│                   │   └── components/          # [NEW] Notification-specific components
│                   │       ├── NotificationList.tsx      # List container with pagination
│                   │       ├── NotificationItem.tsx      # Individual notification row
│                   │       ├── NotificationFilters.tsx   # Filter controls (All/Unread, By Source)
│                   │       ├── NotificationEmpty.tsx     # Empty state component
│                   │       ├── SSEConnectionStatus.tsx   # Connection health indicator
│                   │       └── NotificationDetail.tsx    # Expanded notification view
│                   └── components/              # [MODIFY] Workspace shared components
│                       └── NotificationSidebar.tsx   # [NEW] Right sidebar preview
├── packages/
│   ├── apis/
│   │   └── src/
│   │       └── notification.ts     # [EXISTS] API client already implemented
│   ├── rpc/
│   │   └── rpc/v1/
│   │       └── notification_pb.ts  # [EXISTS] Generated from backend proto
│   └── notifications/              # [NEW] Shared notification utilities package
│       ├── package.json
│       ├── src/
│       │   ├── index.ts            # Public exports
│       │   ├── useSSEConnection.ts # SSE connection hook with reconnection
│       │   ├── useNotifications.ts # Notification state management hook
│       │   ├── types.ts            # Frontend notification types
│       │   └── utils.ts            # Helper functions (time formatting, etc.)
│       └── README.md
```

**Frontend Workspace Pattern (Constitution v3.5.0)**:
- ✅ Implemented under `workspace/notifications/` following canonical pattern
- ✅ Shares workspace/layout.tsx for authentication and navigation
- ✅ Adds "Notifications" tab with 🔔 emoji to workspace tabs array
- ✅ Uses TabLink component for sub-navigation (All Notifications, Unread Only)
- ✅ Right sidebar preview integrated into workspace layout sidebar component
- ✅ Applies UI/UX density principles throughout:
  * Compact 56px top nav + 48px sub-nav = 104px total chrome
  * Horizontal distribution: filters + actions + status in single row
  * Table rows at h-10 (40px) for content density
  * Isolated scroll containers for notification list
  * text-sm body text, py-4 page padding

**Testing Structure** (post-verification):
```
frontend/apps/web/src/app/workspace/
└── notifications/
    └── components/
        ├── NotificationList.test.tsx
        ├── NotificationItem.test.tsx
        └── NotificationFilters.test.tsx

frontend/packages/notifications/src/
├── useSSEConnection.test.ts
└── useNotifications.test.ts
```
│       └── src/
│           └── app/
│               └── workspace/            # [MANDATORY for business features]
│                   ├── layout.tsx        # [DO NOT DUPLICATE - shared layout]
│                   ├── [feature-domain]/ # [ADD new business domain]
│                   │   ├── page.tsx      # Domain page with sub-navigation
│                   │   ├── README.md     # Feature documentation
│                   │   ├── components/   # Domain-specific components
│                   │   │   ├── [Feature]Tab.tsx   # Tab content components
│                   │   │   └── [Feature]Dialog.tsx
│                   │   └── [sub-feature]/ # [ADD for complex workflows]
│                   │       └── page.tsx   # Dedicated workflow page
│                   └── components/       # Cross-domain workspace components
└── packages/
    ├── apis/                            # [ADD API client utilities]
    │   └── src/
    │       └── [feature].ts
    └── rpc/                             # [GENERATED from backend protos]
        └── rpc/v1/
            └── [feature]_pb.ts
```

**Frontend Workspace Pattern (Constitution v3.5.0)**:
All business features MUST be implemented under `workspace/[feature-domain]/` and share the workspace layout:
- **Top-level domain tabs**: Add to `workspace/layout.tsx` tabs array for major domains (e.g., Organization, Projects, CRM)
- **Domain page**: Create `workspace/[feature-domain]/page.tsx` with sub-navigation using `TabLink` components
- **Sub-navigation**: Use query params (`?tab=overview`) for feature sections within domain
- **Deep features**: Use nested pages `workspace/[feature-domain]/[sub-feature]/page.tsx` for complex workflows
- **Layout sharing**: DO NOT create duplicate layouts; workspace/layout.tsx provides auth, navigation, sidebar
- **UI/UX principles**: Apply content density and horizontal space utilization (avoid excessive vertical stacking, distribute controls horizontally)
- **Reference**: See `workspace/organization/` for canonical implementation pattern

**Testing Structure**:
```
backend/
└── internal/[feature]/
    ├── [feature]_test.go          # Unit tests
    └── [feature]_integration_test.go  # Integration tests

frontend/apps/web/src/app/workspace/
└── [feature-domain]/
    └── components/
        └── [Component].test.tsx   # Component tests
```

**Structure Decision**: Full-stack web application following Tech Office's existing patterns:
- Multi-tenant PostgreSQL with schema-per-domain
- Go backend services with sqlc for type-safe queries
- Protocol Buffers for RPC contracts
- Next.js frontend with App Router and MUI components
- pnpm workspace for shared frontend packages

## Phase 0: Outline & Research ✅ COMPLETE

**Status**: All unknowns resolved, no NEEDS CLARIFICATION markers

### Research Summary

1. **SSE Connection Management**: Custom React hook `useSSEConnection` with Connect-Web streaming API
   - Decision: Use Connect-Web native streaming support
   - Rationale: Existing API client already has async generator pattern
   - Reference: `frontend/packages/apis/src/notification.ts`

2. **Notification State Management**: Simple React state + optimistic updates
   - Decision: No complex state library (Redux/Zustand)
   - Rationale: Straightforward CRUD operations, SSE provides real-time updates
   - Pattern: `useNotifications` hook for encapsulated state logic

3. **Workspace Layout Integration**: Extend existing `workspace/layout.tsx`
   - Decision: Add notifications tab to existing tabs array + sidebar component
   - Rationale: Constitution mandates shared workspace layout pattern
   - Reference: `frontend/apps/web/src/app/workspace/layout.tsx`

4. **UI/UX Density**: Apply Constitution v3.5.0 principles
   - Decision: 56px top nav + 48px sub-nav = 104px chrome max
   - Rationale: Optimized for 13-inch laptops with limited vertical space
   - Pattern: Horizontal distribution of controls, h-10 table rows, text-sm body

5. **SSE Reconnection**: Exponential backoff + 5-minute proactive disconnect
   - Decision: Automatic reconnection with last_event_id replay
   - Rationale: Spec requirement for reliability and proxy timeout prevention
   - Implementation: React useEffect with cleanup pattern

6. **Authentication**: Reuse existing JWT token from useRequireAuth
   - Decision: Authorization: Bearer header for SSE connection
   - Rationale: Backend AuthInterceptor already validates JWT tokens
   - Status: ✅ Backend auth in place; ⚠️ Minor fix needed for streaming interceptor

**Output**: `research.md` - Comprehensive research findings documented

---

## Phase 1: Design & Contracts ✅ COMPLETE

**Status**: All design artifacts generated, ready for implementation

### 1. Frontend State Models (data-model.md)

**No Database Changes**: This is FRONTEND-ONLY implementation. Backend notification schema exists from #007.

**Frontend State Models Defined**:
- `Notification`: Client-side notification object mapped from backend protobuf
- `SSEConnectionState`: Connection status, metrics, reconnection state
- `NotificationFilters`: User-selected filters (read status, source domains)
- `PaginationState`: Pagination tokens, page metadata, loading state
- `UnreadCount`: Total and per-domain unread counts
- `SidebarPreviewData`: Subset for right sidebar (3-5 recent unread)

**Component State Architecture**:
- NotificationsPage: Main state container
- NotificationSidebar: Derived state from main notifications
- Custom hooks: `useSSEConnection`, `useNotifications`

**Output**: `data-model.md` - Complete frontend state model documentation

### 2. TypeScript Contracts (contracts/types.ts)

**Frontend Type Definitions**:
```typescript
// Core types
export interface Notification { ... }
export type SourceDomain = 'chat' | 'crm' | 'projects' | 'hr' | 'support' | 'finance' | 'system';
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

// State management types
export interface SSEConnectionState { ... }
export interface NotificationFilters { ... }
export interface PaginationState { ... }
export interface UnreadCount { ... }

// Hook return types
export interface UseSSEConnectionReturn { ... }
export interface UseNotificationsReturn { ... }

// Component props
export interface NotificationListProps { ... }
export interface NotificationItemProps { ... }
export interface NotificationFiltersProps { ... }
export interface SSEConnectionStatusProps { ... }
export interface NotificationSidebarProps { ... }
```

**Output**: `contracts/types.ts` - Complete TypeScript interface definitions

### 3. Component Architecture

**Page Structure**:
```
workspace/notifications/
├── page.tsx                    # Main notification hub page
├── README.md                   # Feature documentation
└── components/
    ├── NotificationList.tsx    # List container with pagination
    ├── NotificationItem.tsx    # Individual notification row
    ├── NotificationFilters.tsx # Filter controls (All/Unread, By Source)
    ├── NotificationEmpty.tsx   # Empty state component
    ├── SSEConnectionStatus.tsx # Connection health indicator
    └── NotificationDetail.tsx  # Expanded notification view
```

**Shared Components**:
```
workspace/components/
└── NotificationSidebar.tsx     # Right sidebar preview (NEW)
```

**Shared Hooks Package**:
```
packages/notifications/
└── src/
    ├── useSSEConnection.ts     # SSE connection hook with reconnection
    ├── useNotifications.ts     # Notification state management hook
    ├── types.ts                # Shared types (re-export from contracts)
    └── utils.ts                # Helper functions (time formatting, etc.)
```

### 4. Test Scenarios (quickstart.md)

**15 Comprehensive Test Scenarios**:
1. Initial page load & authentication
2. Notification list display
3. Mark notification as read (optimistic update)
4. Filter notifications by read status
5. Filter notifications by source domain
6. SSE real-time notifications
7. SSE connection failure & reconnection
8. Proactive 5-minute disconnect/reconnect
9. Right sidebar notification preview
10. Pagination & load more
11. Bulk mark all as read
12. Delete notification
13. Empty state display
14. Connection status indicator
15. Responsive layout & density

**Performance Validation**:
- Initial page load: < 2 seconds
- Real-time notification render: < 500ms
- SSE connection establishment: < 1 second
- Pagination load: < 1 second
- Mark as read response: < 50ms (optimistic)

**Output**: `quickstart.md` - Complete test scenario documentation

### 5. No Backend Changes Required

**Existing Backend APIs** (from #007-notification-hub-backend):
- ✅ `ListNotifications` - Paginated notification list
- ✅ `MarkAsRead` - Mark one or more as read
- ✅ `MarkAllBeforeTimestampAsRead` - Bulk mark as read
- ✅ `DeleteNotification` - Soft delete notification
- ✅ `StreamNotifications` - SSE streaming endpoint
- ✅ `GetUnreadCount` - Unread count total and per-domain

**Frontend API Client** (already exists):
- ✅ `frontend/packages/apis/src/notification.ts` - Complete implementation
- ✅ Type assertions already applied for RPC responses
- ✅ Error handling via rpcWrapper

**Minor Backend Fix** (non-blocking):
- ⚠️ Add `WrapStreamingHandler` method to AuthInterceptor for full streaming support
- This enables SSE authentication to work properly
- Frontend development can proceed; backend fix in parallel

### 6. No Database Schema Changes

**Backend Schema** (already exists from #007):
- ✅ `notification.notification` table
- ✅ `notification.notification_recipient` table
- ✅ `notification.active_connection` table (UNLOGGED)
- ✅ All indexes and constraints in place

**No Migration Required**: Frontend-only feature

---

## Phase 2: Task Planning Approach

**This section describes what the /tasks command will do - DO NOT execute during /plan**

### Task Generation Strategy

**Frontend-Only Implementation**: No backend tasks required (backend from #007 complete)

**Task Categories**:
1. **Shared Notification Package** (foundation)
2. **Workspace Layout Integration** (navigation + sidebar)
3. **Notification Hub Page** (main feature page)
4. **Component Implementation** (individual UI components)
5. **Testing** (post-verification)
6. **Documentation** (README, inline docs)

### Task Ordering Strategy

**Implementation-First Order**: Core functionality before tests

**Dependency Order**:
1. **Phase A**: Shared utilities and hooks (foundation)
   - Create `packages/notifications` package
   - Implement TypeScript types
   - Implement helper functions (time formatting, domain icons)
   - Implement `useSSEConnection` hook
   - Implement `useNotifications` hook

2. **Phase B**: Workspace integration (navigation + sidebar)
   - Modify `workspace/layout.tsx` to add notifications tab
   - Create `NotificationSidebar` component
   - Integrate sidebar into layout

3. **Phase C**: Notification hub page (main UI)
   - Create `workspace/notifications/page.tsx`
   - Implement `NotificationList` component
   - Implement `NotificationItem` component
   - Implement `NotificationFilters` component
   - Implement `SSEConnectionStatus` component
   - Implement `NotificationEmpty` component
   - Implement `NotificationDetail` component

4. **Phase D**: State integration (wire everything together)
   - Connect SSE hook to notification list
   - Implement mark as read with optimistic updates
   - Implement delete notification
   - Implement bulk mark all as read
   - Implement filter logic
   - Implement pagination (load more)

5. **Phase E**: Testing (post-verification)
   - Manual testing via quickstart.md scenarios
   - Human verification of behavior
   - Component unit tests (React Testing Library)
   - Hook tests (useSSEConnection, useNotifications)
   - Integration tests (SSE reconnection flow)
   - E2E test (notification hub user journey)

6. **Phase F**: Documentation
   - Create `workspace/notifications/README.md`
   - Add inline JSDoc comments to components
   - Update workspace README with notifications feature

### Parallel Execution Markers

**[P] = Can execute in parallel**:
- Phase A tasks (hooks and utils) can be parallel
- Phase C tasks (components) can be parallel after Phase B
- Documentation tasks can be parallel with testing

**Sequential Dependencies**:
- Phase B depends on Phase A (needs hooks)
- Phase C depends on Phase B (needs workspace integration)
- Phase D depends on Phase C (needs components)
- Phase E depends on Phase D (needs complete implementation)

### Estimated Task Count

**Total: ~25-30 numbered tasks**

**Breakdown**:
- Phase A (Shared Package): 6-8 tasks
- Phase B (Workspace Integration): 3-4 tasks
- Phase C (Component Implementation): 7-9 tasks
- Phase D (State Integration): 5-6 tasks
- Phase E (Testing): 6-8 tasks (post-verification)
- Phase F (Documentation): 2-3 tasks

**Development Time Estimate**: 3-5 days for experienced developer

### Generated Code vs Manual Implementation

**No Code Generation Required**:
- ✅ No SQL schema changes → No sqlc generate
- ✅ No proto changes → No buf generate
- ✅ Frontend API client already exists
- ✅ All RPC types already generated in `frontend/packages/rpc`

**Manual Implementation**:
- All frontend components (TypeScript/React)
- Custom hooks (useSSEConnection, useNotifications)
- State management logic
- UI/UX styling (Tailwind CSS + MUI)

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan

---
   - RBAC permission checks
   - Quickstart test = story validation steps

8. **Update agent file incrementally** (O(1) operation):
   - Run `.specify/scripts/bash/update-agent-context.sh copilot`
     **IMPORTANT**: Execute it exactly as specified above. Do not add or remove any arguments.
   - If exists: Add only NEW tech from current plan
   - Preserve manual additions between markers
   - Update recent changes (keep last 3)
   - Keep under 150 lines for token efficiency
   - Output to `.github/copilot-instructions.md`

**Output**: 
- `data-model.md` with complete schema design
- `/contracts/*.proto` for RPC definitions
- `/contracts/*.sql` for sqlc queries
- `quickstart.md` with test scenarios
- `.github/copilot-instructions.md` updated
- Failing test stubs (Go and TypeScript)

## Phase 2: Task Planning Approach
*This section describes what the /tasks command will do - DO NOT execute during /plan*

**Task Generation Strategy**:
- Load `.specify/templates/tasks-template.md` as base
- Generate tasks from Phase 1 design docs (contracts, data model, quickstart)
- Follow Tech Office development workflow:

**Backend Tasks**:
1. Database schema changes in `backend/database/schema.sql` [P]
2. Run Atlas migration create: `source .env && cd backend && ./scripts/atlas/01_migration_create.sh <migration_description> && ./scripts/atlas/02_migrate_apply.sh` [depends on 1]
3. sqlc query definitions in `scripts/[domain].query.sql` [P]
4. sqlc code generation: `sqlc generate` [depends on 3]
5. Protocol Buffer definitions in `rpc/v1/[feature].proto` [P]
6. Protobuf code generation: `buf generate` [depends on 5]
7. Service struct creation with AdminPool and TenantPool in `internal/[feature]/[feature].go` [depends on 4,6]
8. Service method implementation with proper pool usage and txn.WithTxn [depends on 7]
9. Unit tests for service [depends on 8]
10. Integration tests with test database [depends on 8]

**Frontend Tasks**:
1. API client utilities in `packages/apis/src/[feature].ts` [P]
2. Page components in `apps/web/src/app/[feature]/page.tsx` [P]
3. Feature-specific components [depends on 2]
4. Component tests [depends on 3]
5. Integration with auth context [depends on 2,3]

**Infrastructure Tasks** (if needed):
1. Kubernetes manifests updates [P]
2. Environment variables configuration [P]

**Ordering Strategy**:
- Implementation-first order: Core functionality before tests
- Dependency order: Schema → Models → Services → Tests → UI
- Backend before Frontend (RPC contracts must exist)
- Mark [P] for parallel execution (independent files)
- Generated code tasks always follow definition tasks
- Tests added after human verification of core behavior

**Estimated Output**: 30-40 numbered, ordered tasks in tasks.md

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan

## Phase 3+: Future Implementation
*These phases are beyond the scope of the /plan command*

**Phase 3**: Task execution (/tasks command creates tasks.md)  
**Phase 4**: Implementation (execute tasks.md following constitutional principles)  
**Phase 5**: Validation (run tests, execute quickstart.md, performance validation)

## Complexity Tracking
*Fill ONLY if Constitution Check has violations that must be justified*

**No Violations**: This feature is frontend-only implementation with no constitutional violations.

- ✅ No new backend service (uses existing NotificationService from #007)
- ✅ No database schema changes
- ✅ No proto changes (uses existing notification.proto)
- ✅ Follows workspace layout pattern (Constitution v3.5.0)
- ✅ Applies UI/UX density principles (Constitution v3.5.0)
- ✅ Post-verification testing approach
- ✅ YAGNI principles (simple state management, no premature optimization)

**No Complexity Tracking Required**: All constitutional requirements met.

---

## Progress Tracking
*This checklist is updated during execution flow*

**Phase Status**:
- [x] Phase 0: Research complete (/plan command) ✅
- [x] Phase 1: Design complete (/plan command) ✅
- [x] Phase 2: Task planning approach described (/plan command) ✅
- [ ] Phase 3: Tasks generated (/tasks command) - NEXT STEP
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS ✅
- [x] Post-Design Constitution Check: PASS ✅
- [x] All NEEDS CLARIFICATION resolved (none existed) ✅
- [x] Complexity deviations documented (none exist) ✅

**Artifacts Generated**:
- [x] `plan.md` - This file (complete) ✅
- [x] `research.md` - Research findings (complete) ✅
- [x] `data-model.md` - Frontend state models (complete) ✅
- [x] `contracts/types.ts` - TypeScript interfaces (complete) ✅
- [x] `quickstart.md` - Test scenarios (complete) ✅
- [ ] `tasks.md` - Task list (to be generated by /tasks command)

**Ready for Next Step**: ✅ `/tasks` command to generate implementation task list

---

*Based on Constitution v3.5.0 - See `.specify/memory/constitution.md`*
*Plan template: `.specify/templates/plan-template.md`*
*Feature Spec: `specs/008-notification-hub-frontend/spec.md`*
