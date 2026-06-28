
# Implementation Plan: Notification Hub Backend

**Branch**: `007-notification-hub-backend` | **Date**: October 28, 2025 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/Users/nvcnvn/Codes/tech-office/specs/007-notification-hub-backend/spec.md`

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
**Primary Requirement**: Build a centralized notification hub that enables business domain services (chat, CRM, project management, HR, support) to publish notifications to employees. The hub must support real-time delivery via Server-Sent Events (SSE), flexible action data for deep linking, batch notifications, priority-based delivery (4 levels: 0=always, 1=when not offline, 2=when online, 4=silent), and horizontal scaling with multiple backend instances using instance-level PostgreSQL LISTEN/NOTIFY channels with connection registry.

**Technical Approach**: 
- **Schema**: New `notification` domain schema with tables for notifications, connection registry (UNLOGGED for performance), and delivery tracking
- **Scalability**: Instance-level channels (`instance_{id}_notifications`) with PostgreSQL connection registry tracking which users are connected to which backend instance; denormalized department membership (department_ids[] array with GIN index) for single-query department → users → instances resolution
- **Real-Time**: SSE with 60-second delivery SLA; fallback to push/email for failed delivery
- **Multi-Tenant**: Strict organization_id isolation; employees scoped to single organization
- **Deduplication**: LRU cache with action category grouping (e.g., react:like/unlike → 'react')
- **Backend Services**: Publishing services use simple API (`PublishNotification(recipients, content, priority, actionData)`); notification hub abstracts routing, instance topology, delivery mechanism
- **RPC**: New notification service proto with methods for publishing (backend-only), listing, marking read, and SSE connection establishment
- **Retention**: Indefinite storage with partitioning for performance at scale (100k notifications/day per org)

## Technical Context
**Project Type**: web (frontend + backend monorepo)  
**Frontend Stack**: 
- Language: TypeScript 5.x
- Framework: Next.js 15 (App Router)
- UI Library: Material-UI (MUI) v5
- State Management: React hooks, TanStack Query
- RPC Client: Connect-Web (protobuf)
- Package Manager: pnpm workspace
- Testing: Vitest, React Testing Library

**Backend Stack**:
- Language: Go 1.23+
- Database: PostgreSQL 18+ (multi-tenant, schema-per-domain)
- ORM: sqlc (type-safe SQL code generation)
- RPC: Protocol Buffers + ConnectRPC
- Real-Time: Server-Sent Events (SSE) with PostgreSQL LISTEN/NOTIFY
- Auth: Zitadel integration (OAuth2/OIDC)
- Workflow: https://github.com/nvcnvn/flows
- Testing: Go testing, testify

**Infrastructure**:
- Container: Docker
- Orchestration: Kubernetes (StackGres for PostgreSQL)
- Migration: Atlas
- Deployment: dev/prod overlays with k8s manifests

**Performance Goals**: 
- <60 seconds notification delivery SLA for online users
- Support 100,000 notifications per organization per day
- Registry query latency <5ms (with caching)
- Department query latency <10ms (GIN index)
- Support 10,000 concurrent SSE connections per backend instance
- Horizontal scaling with 3+ backend instances

**Constraints**: 
- Multi-tenant isolation: All notifications scoped to organization_id
- Backend-only publishing: End users cannot publish notifications directly
- Single organization per employee
- Instance-level routing: No broadcast to all instances
- UNLOGGED connection registry: 2-3x write performance, acceptable data loss on crash (users reconnect)
- Department membership denormalization: Cached per connection, updated on reconnect only
- Real-time delivery prioritization based on 4 levels (0-4)

**Scale/Scope**: 
- Support for 10k+ organizations
- 100k+ total users across platform
- 100k notifications per organization per day
- 15+ business domains publishing notifications (chat, CRM, projects, HR, support, finance, system, etc.)

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Schema-First & Multi-Tenant Design ✅
- [x] New `notification` schema will be created following schema-per-domain pattern
- [x] All notification tables will include `organization_id UUID NOT NULL` with FK to `public.organization(id)`
- [x] Primary keys will use UUID v7: `id UUID PRIMARY KEY DEFAULT uuidv7()`
- [x] DDL will use `IF NOT EXISTS` for idempotency
- [x] sqlc will generate Go types from schema
- [x] Multi-tenant isolation enforced at database level

### Post-Verification Testing ✅
- [x] Plan follows implementation-first approach: core functionality before tests
- [x] Tests will be added after human verification of behavior
- [x] Test types planned: unit tests (service methods), integration tests (with database), contract tests (RPC surface)

### SQL & Data Safety Standards ✅
- [x] PostgreSQL 18+ targeted
- [x] Singular table names planned (e.g., `notification`, not `notifications`)
- [x] snake_case naming convention
- [x] `updated_at TIMESTAMPTZ DEFAULT now()` included (no `created_at`)
- [x] Indexes planned for foreign keys, organization_id, and department_ids (GIN)
- [x] Tenant isolation: All queries will filter by organization_id
- [x] Connection registry uses UNLOGGED table for 2-3x write performance
- [x] Department membership denormalized as department_ids[] array with GIN index

### Backend Service Architecture Checks ✅
- [x] NotificationService struct will include both `AdminPool` and `TenantPool`
- [x] Publishing API (backend-only) will use `AdminPool` (system-scope, justified for cross-service publishing)
- [x] Employee-facing methods (list, mark read, SSE) will use `TenantPool` (tenant-aware)
- [x] All transactions will use `txn.WithTxn` helper
- [x] TenantPool methods will validate organization context from auth token
- [x] AdminPool usage documented: publishing service needs system scope to create notifications across tenants
- [x] All tenant-data queries will include `organization_id` filters
- [x] Complex handlers will decompose into private methods (validation, authorization, business logic)
- [x] Proto-level access control for simple authorization

### Codegen & Generated-Client Checks ✅
- [x] SQL changes planned → `cd backend && sqlc generate` step included
- [x] Proto changes planned → `cd backend && buf generate` step included
- [x] Frontend RPC package update planned → re-export from `frontend/packages/rpc/index.ts`
- [x] Frontend build step planned → `pnpm -r build` in frontend workspace
- [x] API wrapper planned → `frontend/packages/apis/src/notification.ts`
- [x] PR checklist will be followed for generated code validation

### Observability & Simplicity ✅
- [x] Structured logging planned for all service operations
- [x] Metrics planned: registry query latency, NOTIFY latency, connection count, delivery success rate
- [x] Complexity justified: Instance-level channels with connection registry chosen over simpler approaches due to scalability requirements (avoid 10k+ channels per instance, avoid broadcast to all instances)
- [x] Alternative approaches documented in spec (per-user channels, org-wide channels)

### Versioning & Breaking Changes N/A
- [x] New feature, no breaking changes to existing APIs
- [x] New schema domain, no modifications to existing schemas
- [x] Migration plan will be included for new schema creation

## Project Structure

### Documentation (this feature)
```
specs/007-notification-hub-backend/
├── plan.md              # This file (/plan command output)
├── research.md          # Phase 0 output (/plan command)
├── data-model.md        # Phase 1 output (/plan command)
├── quickstart.md        # Phase 1 output (/plan command)
├── contracts/           # Phase 1 output (/plan command)
│   ├── notification.proto          # RPC service definitions
│   ├── notification.query.sql      # sqlc queries
│   └── notification_test.go        # Contract test stubs
└── tasks.md             # Phase 2 output (/tasks command - NOT created by /plan)
```

### Source Code (Tech Office Monorepo)

**Backend Structure**:
```
backend/
├── database/
│   ├── scripts/
│   │   ├── schema.sql                    # [MODIFY - add notification schema]
│   │   └── notification.query.sql        # [ADD - sqlc queries for notification operations]
│   ├── models.go                         # [GENERATED by sqlc - notification types]
│   ├── notification.query.sql.go         # [GENERATED by sqlc - notification methods]
│   ├── pool.go                           # [MODIFY - may need SSE connection tracking]
│   └── txn/
│       └── txn.go                        # [USE - transaction helper]
├── internal/
│   └── notification/                     # [ADD - new service package]
│       ├── notification.go               # Service implementation with AdminPool/TenantPool
│       ├── notification_test.go          # Unit tests
│       ├── publisher.go                  # Publishing logic with registry query & NOTIFY
│       ├── sse.go                        # SSE connection management
│       ├── registry.go                   # Connection registry operations
│       ├── deduplication.go              # LRU cache for dedup
│       └── delivery.go                   # Delivery tracking and fallback
├── rpc/
│   └── v1/
│       ├── notification.proto            # [ADD - new RPC service definition]
│       ├── notification.pb.go            # [GENERATED from proto]
│       └── rpcv1connect/
│           └── notification.connect.go   # [GENERATED - Connect RPC stubs]
├── cmd/
│   └── server.go                         # [MODIFY - register NotificationService]
└── k8s/
    └── base/
        └── notification/                 # [ADD if deployment changes needed]
            └── deployment.yaml           # [ADD - instance_id env var, SSE config]

Database Schemas Involved:
- NEW: notification schema (notification, notification_recipient, active_connection, notification_batch, notification_delivery_log)
- REFERENCES: organization schema (organization, employee, department)
- REFERENCES: iam schema (employee - for cross-schema user data if needed)

**Backend Service Structure Requirements**:
NotificationService struct will include:
- `AdminPool database.AdminDatabaseConnector` - for publishing API (backend services only)
- `TenantPool database.TenantDatabaseConnector` - for employee-facing operations (list, mark read, SSE)
- `Queries *database.Queries` - sqlc-generated methods
- `InstanceID string` - unique instance identifier for channel naming
- `ListenerConn *pgx.Conn` - dedicated connection for LISTEN/NOTIFY
- `Connections map[string]*SSEConnection` - in-memory active connections
- `DedupeCache *lru.Cache` - LRU cache for deduplication
- `Mu sync.RWMutex` - concurrency control for connection map

Key methods:
- `PublishNotification(ctx, req)` - Uses AdminPool, backend-only, stores notification + queries registry + NOTIFY
- `ListNotifications(ctx, req)` - Uses TenantPool, filters by organization_id
- `MarkAsRead(ctx, req)` - Uses TenantPool, validates ownership
- `StreamNotifications(ctx, req)` - Uses TenantPool, establishes SSE connection, updates registry
- `handleInstanceNotifications()` - LISTEN on instance channel, routes to connected users
```

**Frontend Structure**:
```
frontend/
├── apps/
│   └── web/
│       └── src/
│           ├── app/
│           │   └── workspace/                      # [MANDATORY - shared layout]
│           │       ├── layout.tsx                  # [NO CHANGES - shared layout already exists]
│           │       └── notifications/              # [ADD - new notification hub page]
│           │           ├── page.tsx                # Notification hub with list and filters
│           │           ├── README.md               # Feature documentation
│           │           └── components/
│           │               ├── NotificationList.tsx       # List component
│           │               ├── NotificationItem.tsx       # Individual notification
│           │               ├── NotificationFilters.tsx    # Filter controls
│           │               └── NotificationBadge.tsx      # Unread count badge
│           ├── components/
│           │   └── notifications/                  # [ADD - reusable components]
│           │       ├── NotificationProvider.tsx    # SSE connection provider
│           │       └── useNotifications.tsx        # Custom hook for SSE
│           └── hooks/
│               └── useSSE.ts                       # [ADD - SSE connection hook]
└── packages/
    ├── apis/                                       # [ADD - API client utilities]
    │   └── src/
    │       └── notification.ts                     # Notification API wrappers
    └── rpc/                                        # [GENERATED from backend protos]
        └── rpc/v1/
            ├── notification_pb.ts                  # [GENERATED]
            └── notification_connect.ts             # [GENERATED]
```

**Frontend Workspace Pattern (Constitution v3.5.0)**:
- **Top-level tab**: Add "Notifications" to `workspace/layout.tsx` tabs array (optional - may use bell icon instead)
- **Domain page**: `workspace/notifications/page.tsx` with notification list
- **No sub-navigation**: Single page with filters (read/unread, source domain, priority)
- **Layout sharing**: Uses existing workspace/layout.tsx for auth, navigation
- **UI/UX principles**: 
  - Vertical optimization: Compact list items (h-10 to h-12), minimal padding
  - Horizontal distribution: Filters and actions in same row, not stacked
  - Scrolling: Container scroll within workspace layout, not page-level
  - Density: text-sm for body text, compact spacing between items

**Testing Structure**:
```
backend/
├── internal/notification/
│   ├── notification_test.go                # Unit tests
│   ├── publisher_test.go                   # Publishing logic tests
│   ├── registry_test.go                    # Connection registry tests
│   └── sse_test.go                         # SSE connection tests
└── integration/
    └── notification_integration_test.go    # End-to-end notification flow

frontend/apps/web/src/app/workspace/
└── notifications/
    └── components/
        ├── NotificationList.test.tsx       # Component tests
        └── NotificationItem.test.tsx       # Item rendering tests
```

**Structure Decision**: Full-stack web application following Tech Office's existing patterns:
- New `notification` domain schema in PostgreSQL with multi-tenant isolation
- Go backend notification service with AdminPool (publishing) and TenantPool (employee operations)
- Protocol Buffers for RPC contracts (NotificationService)
- SSE with PostgreSQL LISTEN/NOTIFY for real-time delivery
- Instance-level channels with connection registry for horizontal scaling
- Next.js frontend under workspace pattern with MUI components
- pnpm workspace for shared frontend packages

## Phase 0: Outline & Research
1. **Extract unknowns from Technical Context** above:
   - For each NEEDS CLARIFICATION → research task
   - For each dependency → best practices task
   - For each integration → patterns task

2. **Tech Office Specific Research**:
   - **Database Schema Design**: Which domain schema(s) to use? New entities or extend existing?
   - **Multi-Tenant Isolation**: How to enforce `organization_id` constraints?
   - **Cross-Schema References**: Which central entities (`organization.employee`, `organization.customer`) to reference?
   - **RPC Contract Design**: New proto definitions or extend existing services?
   - **Zitadel Integration**: New roles/permissions needed? Project resource mappings?
   - **Frontend Patterns**: Reuse existing MUI theme? Auth context patterns?
   - **Subdomain Routing**: Impact on tenant-specific features?

3. **Generate and dispatch research agents**:
   ```
   For each unknown in Technical Context:
     Task: "Research {unknown} for {feature context}"
   For existing patterns:
     Task: "Review Tech Office patterns for {area} in {domain}"
   For schema design:
     Task: "Analyze existing {domain} schema for extension points"
   ```

4. **Consolidate findings** in `research.md` using format:
   - Decision: [what was chosen]
   - Rationale: [why chosen - reference existing Tech Office patterns]
   - Alternatives considered: [what else evaluated]
   - Existing patterns to follow: [reference specific files/implementations]

**Output**: research.md with all NEEDS CLARIFICATION resolved

## Phase 1: Design & Contracts
*Prerequisites: research.md complete*

1. **Database Schema Design** → `data-model.md`:
   - **Schema Selection**: Which domain schema(s) (iam, organization, finance, crm, support, etc.)?
   - **Entity Design**: 
     - Table name (plural, snake_case)
     - Primary key (UUID v7)
     - Foreign keys (organization_id REQUIRED for multi-tenant isolation)
     - Timestamps (created_at, updated_at, deleted_at for soft deletes)
     - JSONB fields for flexible metadata
   - **Relationships**:
     - References to central entities (organization.employee, organization.customer)
     - Cross-schema foreign keys
     - One-to-many, many-to-many relationships
   - **Indexes**: Performance-critical queries
   - **Constraints**: CHECK constraints, NOT NULL, UNIQUE
   - **Migration Strategy**: Atlas migration from schema.sql changes

2. **RPC Contract Design** → `/contracts/`:
   - **Protocol Buffer Definitions** (`.proto` files):
     - Service definitions with methods
     - Request/Response message types
     - Validation rules (buf validate)
     - RBAC annotations for access control
   - **Generated Code Locations**:
     - Backend: `backend/rpc/v1/[feature].pb.go`
     - Frontend: `frontend/packages/rpc/rpc/v1/[feature]_pb.ts`

3. **Backend Service Architecture**:
   - **Service Struct Design**:
     - Include `AdminPool database.AdminDatabaseConnector` for system-scope operations
     - Include `TenantPool database.TenantDatabaseConnector` for tenant-aware operations
     - Include `Queries *database.Queries` for sqlc-generated methods
     - Include external clients as needed (e.g., `ZClient *zitadelcli.Client`)
   - **Method Implementation**:
     - Document which pool each method uses (AdminPool vs TenantPool)
     - Use `TenantPool` for user-facing operations (default for most methods)
     - Use `AdminPool` for system operations (onboarding, background jobs, cross-tenant)
     - Always use `txn.WithTxn(ctx, pool, func(ctx context.Context, tx database.DBTX) error {...})` for transactions
     - Never manually call `Begin()`, `Commit()`, or `Rollback()`
   - **Tenant Isolation**:
     - TenantPool methods MUST validate organization context from auth token
     - AdminPool methods MUST document why system scope is required
     - All queries MUST include `organization_id` filters for tenant data

4. **API Endpoint Design** (if REST needed):
   - For each user action → endpoint
   - Follow ConnectRPC patterns for RPC
   - Authentication: Bearer token from Zitadel
   - Authorization: Check organization context + RBAC

5. **sqlc Query Design**:
   - SQL queries in `backend/database/scripts/[domain].query.sql`
   - Name queries: `-- name: GetFeatureByID :one`
   - Always include `organization_id` in WHERE clauses for tenant isolation
   - Use prepared statements (`:param` syntax)

6. **Frontend Component Design**:
   - Page components (`page.tsx`) with App Router patterns
   - Reuse existing MUI theme and components
   - Auth context integration (`useAuth()`)
   - Tenant check hooks (`useTenantCheck()`)
   - API client utilities in `packages/apis/`

7. **Generate contract tests** from contracts:
   - Backend: Go unit tests for service methods
   - Backend: Integration tests with test database
   - Frontend: Component tests with React Testing Library
   - E2E: Quickstart test scenarios

8. **Extract test scenarios** from user stories:
   - Each story → integration test scenario
   - Multi-tenant isolation verification
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
- Follow Tech Office development workflow with proper codegen ordering

**Backend Tasks** (Estimated 25-30 tasks):

**Database & Schema (P = Parallel)**:
1. Create `notification` schema in `backend/database/scripts/schema.sql` [P]
2. Add `notification.notification` table with indexes [depends on 1]
3. Add `notification.notification_recipient` table with indexes [depends on 1]
4. Add `notification.active_connection` UNLOGGED table with GIN index [depends on 1]
5. Add `notification.notification_batch` table [depends on 1]
6. Add `notification.notification_delivery_log` table [depends on 1]
7. Export env variables in root `.env` files
8. Run Atlas migration create: `cd backend && ./scripts/atlas/01_migration_create.sh add_notification_schema` [depends on 2-6]
9. Run Atlas migration apply: `cd backend && ./scripts/atlas/02_migrate_apply.sh` [depends on 8]
10. Add sqlc queries in `backend/database/scripts/notification.query.sql` [P]
11. Run sqlc generation: `cd backend && sqlc generate` [depends on 8]

**RPC Contracts**:
10. Create `backend/rpc/v1/notification.proto` with service definitions [P]
11. Run protobuf generation: `cd backend && buf generate` [depends on 10]
12. Verify generated Go code in `backend/rpc/v1/notification.pb.go` [depends on 11]

**Backend Service Implementation**:
13. Create `backend/internal/notification/notification.go` service struct with AdminPool/TenantPool [depends on 9, 12]
14. Implement `PublishNotification` method (AdminPool, backend-only) [depends on 13]
15. Implement `PublishBatchNotification` method (AdminPool) [depends on 13]
16. Implement connection registry operations in `backend/internal/notification/registry.go` [depends on 9]
17. Implement SSE connection handling in `backend/internal/notification/sse.go` [depends on 13, 16]
18. Implement PostgreSQL LISTEN/NOTIFY in `backend/internal/notification/publisher.go` [depends on 13, 16]
19. Implement deduplication logic with LRU cache in `backend/internal/notification/deduplication.go` [depends on 13]
20. Implement `ListNotifications` method (TenantPool) [depends on 13]
21. Implement `MarkAsRead` and `MarkAllBeforeTimestampAsRead` methods (TenantPool) [depends on 13]
22. Implement `DeleteNotification` method (TenantPool) [depends on 13]
23. Implement `StreamNotifications` SSE handler (TenantPool) [depends on 17]
24. Implement `GetUnreadCount` method (TenantPool) [depends on 13]
25. Implement delivery tracking and fallback logic in `backend/internal/notification/delivery.go` [depends on 13]
26. Register NotificationService in `backend/cmd/server.go` [depends on 13-25]

**Backend Testing**:
27. Unit tests for publishing logic [depends on 14-15]
28. Unit tests for connection registry [depends on 16]
29. Unit tests for SSE connection management [depends on 17]
30. Unit tests for deduplication [depends on 19]
31. Integration test: end-to-end notification flow with database [depends on 26]
32. Integration test: department-based targeting with GIN index [depends on 26]
33. Integration test: multi-instance routing simulation [depends on 26]

**Frontend Tasks** (Estimated 10-15 tasks):

**RPC Client Updates**:
34. Run frontend build to propagate proto changes: `cd frontend && pnpm -r build` [depends on 11]
35. Update `frontend/packages/rpc/index.ts` to export NotificationService types [depends on 34]
36. Create API wrappers in `frontend/packages/apis/src/notification.ts` [depends on 35]

**Frontend Components**:
37. Create SSE connection hook: `frontend/apps/web/src/hooks/useSSE.ts` [P]
38. Create NotificationProvider context: `frontend/apps/web/src/components/notifications/NotificationProvider.tsx` [depends on 37]
39. Create notification list page: `frontend/apps/web/src/app/workspace/notifications/page.tsx` [P]
40. Create NotificationList component [depends on 39]
41. Create NotificationItem component [depends on 39]
42. Create NotificationFilters component (read/unread, source domain) [depends on 39]
43. Create NotificationBadge component for unread count [P]
44. Integrate NotificationProvider in workspace layout [depends on 38]
45. Add notifications icon/tab to workspace navigation (optional) [depends on 44]

**Frontend Testing**:
46. Component tests for NotificationList [depends on 40]
47. Component tests for NotificationItem [depends on 41]
48. Integration test: SSE connection establishment [depends on 38]

**Infrastructure & Deployment** (If needed):
49. Add `instance_id` environment variable to k8s deployment [P]
50. Update service monitoring for SSE connection metrics [P]

**Ordering Rationale**:
- Database schema → sqlc generation → Go types available
- Proto definitions → buf generation → RPC stubs available
- Service struct with pools → individual method implementations
- Backend complete → frontend RPC build → API wrappers → UI components
- Tests added after human verification of core functionality (constitution principle)

**Estimated Timeline**:
- Database & schema: 1 day
- RPC contracts: 0.5 day
- Backend service: 3-4 days (core logic + SSE + registry + LISTEN/NOTIFY)
- Backend testing: 1-2 days
- Frontend RPC setup: 0.5 day
- Frontend components: 2-3 days
- Frontend testing: 1 day
- **Total**: 9-12 days for full implementation

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan

## Phase 3+: Future Implementation
*These phases are beyond the scope of the /plan command*

**Phase 3**: Task execution (/tasks command creates tasks.md)  
**Phase 4**: Implementation (execute tasks.md following constitutional principles)  
**Phase 5**: Validation (run tests, execute quickstart.md, performance validation)

## Complexity Tracking
*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |


## Progress Tracking
*This checklist is updated during execution flow*

**Phase Status**:
- [x] Phase 0: Research complete (/plan command) - October 28, 2025
- [x] Phase 1: Design complete (/plan command) - October 28, 2025
- [x] Phase 2: Task planning complete (/plan command - describe approach only) - October 28, 2025
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS - All constitutional requirements verified
- [x] Post-Design Constitution Check: PASS - Design follows all patterns
- [x] All NEEDS CLARIFICATION resolved - Spec had comprehensive clarifications from 2025-10-27 session
- [x] Complexity deviations documented - Instance-level channels justified in research.md

---
*Based on Constitution v3.3.0 - See `/memory/constitution.md`*
