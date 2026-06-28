
# Implementation Plan: User Status and Notification Popup

**Branch**: `012-user-status-and-notification-popup` | **Date**: November 4, 2025 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/Users/nvcnvn/Codes/tech-office/specs/012-user-status-and-notification-popup/spec.md`

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
This feature implements comprehensive presence tracking and notification routing for Tech Office employees, including:
- **Presence Status Tracking**: Track employee status (online, online_hidden, idle, offline) based on browser tab visibility, user interaction, and network connectivity
- **Active Channel Context**: Track which specific chat channel each employee is actively viewing to enable context-aware notification routing
- **Browser Push Notifications**: Integrate Firebase Cloud Messaging (FCM) for browser push notifications with deep links, supporting multiple devices per employee
- **Ephemeral Signal Routing**: Route typing indicators and reactions (priority=4) only to employees actively viewing the relevant channel without database writes
- **Smart Notification Routing**: Suppress in-app notifications when employee is viewing content, send push when tab hidden, and respect notification priorities

Technical approach:
- Extend existing `notification.active_connection` table with presence tracking fields
- Use Page Visibility API + Focus events + Heartbeat for browser state detection
- Implement FCM integration for browser push with token storage and validation
- Add SSE connection registry filtering by `active_channel_id` for ephemeral signals
- Create presence visibility controls with department-based filtering

## Technical Context
**Project Type**: web (frontend + backend monorepo)  
**Frontend Stack**: 
- Language: TypeScript 5.x
- Framework: Next.js 15 (App Router)
- UI Library: Material-UI (MUI) v5
- Package Manager: pnpm workspace
- Browser APIs: Page Visibility API, Push API, Service Worker API
- Push Service: Firebase Cloud Messaging (FCM) Web SDK
- Testing: Manual testing and E2E tests (per Constitution v5.2.0 - no unit/snapshot tests)

**Backend Stack**:
- Language: Go 1.25+
- Database: PostgreSQL 18+ with Citus sharding (multi-tenant, schema-per-domain)
- ORM: sqlc (type-safe SQL code generation)
- RPC: Protocol Buffers + ConnectRPC
- Auth: Zitadel integration with JWT validation
- Push Notifications: Firebase Cloud Messaging (FCM) SDK for Go
- Real-time: Server-Sent Events (SSE) via existing notification service
- Testing: Go testing with testify, integration tests in `backend/integration/`

**Infrastructure**:
- Container: Docker
- Orchestration: Kubernetes (StackGres for PostgreSQL)
- Migration: golang-migrate (run via `backend/scripts/migrate.sh`)
- Deployment: k8s overlays (dev/prod) in `backend/k8s/overlays/`

**Performance Goals**: 
- Presence heartbeat latency <100ms p95 (critical for real-time UX)
- SSE connection handling: 10k+ concurrent connections per backend instance
- Browser push delivery: <5s from event creation to FCM send
- Ephemeral signal routing: <50ms filtering by active_channel_id

**Constraints**: 
- Multi-tenant isolation: ALL queries include `organization_id` filter
- Citus sharding: Composite keys `(organization_id, id)` for all tenant tables
- No triggers: Implement presence state transitions in application code
- Browser limitations: Handle sleep mode, permission denial, quota exceeded
- Privacy: Respect visibility settings and department boundaries
- No DB spam: Priority=4 signals MUST NOT write to notification table

**Scale/Scope**: 
- 10k+ organizations with varying sizes (10-1000 employees each)
- 100k+ concurrent SSE connections across backend instances
- Multiple devices per employee (web, mobile preparation)
- 15+ business domains with presence indicators integrated

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

[Gates determined based on constitution file]

### Backend Service Architecture Checks
When the plan involves backend service implementation, verify compliance with Constitution v5.4.0:
- [x] Service implements two-layer architecture: Logic layer (business logic) + Connect layer (RPC handlers)
  * **Extends existing notification service** - presence logic in `internal/notification/presence.go`, push notification logic in `internal/notification/push.go`
- [x] Logic layer has NO connection pools (only Queries and other logic dependencies)
  * Presence/Push logic layers will only hold `Queries *database.Queries` and FCM client
- [x] Logic layer methods accept `tx database.DBTX` parameter for all database operations
  * All DB operations (update presence, store push tokens) will use DBTX parameter
- [x] Logic layer receives parsed auth context as parameters (employeeID, orgID) not raw request context
  * Methods signature: `UpdatePresenceStatus(ctx, tx, employeeID, orgID, status)`, `RegisterPushToken(ctx, tx, employeeID, orgID, token)`
- [x] Connect layer owns both `AdminPool database.AdminDatabaseConnector` and `TenantPool database.TenantDatabaseConnector`
  * Notification service already has both pools; will reuse for presence/push endpoints
- [x] Connect layer extracts auth context from request and passes to logic layer
  * Use existing `interceptor.OrgIDFromContext(ctx)` and `interceptor.EmployeeIDFromContext(ctx)`
- [x] Connect layer manages transactions using `txn.WithTxn` helper (no manual Begin/Commit/Rollback)
  * All RPC handlers will use `txn.WithTxn(ctx, s.TenantPool, func(ctx, tx) {...})`
- [x] Connect layer chooses appropriate pool: TenantPool for user operations, AdminPool for system operations
  * **TenantPool**: User-facing presence updates, push token registration, visibility settings
  * **AdminPool**: Background cleanup of stale connections (60s timeout), presence statistics dashboard
- [x] AdminPool usage is documented with justification (system-scope only)
  * Background cleanup: system job accessing all organizations' stale connections
  * Admin dashboard: cross-tenant presence statistics for monitoring
- [x] All tenant-data queries include `organization_id` filters
  * All presence, push token, visibility queries filter by organization_id
- [x] Simple authorization uses proto-level `access_control` options where appropriate
  * Presence endpoints: require authenticated employee role
  * Admin dashboard: require admin role via access_control annotation

### Cross-Domain Integration Checks (Constitution Principle IV)
When the plan involves integration across business domains (e.g., IAM calling Organization, CRM calling Customer):
- [x] Avoid SQL-level cross-schema data access; use service logic layer methods instead (except for explicitly relaxed `public` schema)
  * **No cross-schema SQL** - all presence/push data in `notification` schema, references to `organization.employee` via FK only
- [x] Reuse existing logic layer methods rather than duplicating SQL queries or domain logic
  * Will reuse existing notification.NotificationLogic for SSE connection management and event routing
- [x] Services depend on other services' **logic layer interfaces** (not connect layer)
  * **No new cross-domain dependencies** - presence/push are extensions of existing notification service
- [x] Declare logic layer dependencies in logic layer constructor (connect layer is separate)
  * N/A - extending existing notification service, not creating new service dependencies
- [x] Initialize logic layers first, then wrap with connect layers in `backend/cmd/server.go`
  * Will follow existing notification service initialization pattern
- [x] Cross-domain calls use direct Go method invocations on logic layer (NOT RPC layer internally)
  * N/A - no cross-domain calls; presence indicators displayed via SSE events from notification service
- [x] Explicitly document context propagation: user-scope (request context) vs system-scope (background context)
  * **User-scope**: All RPC handlers for presence updates, push registration, visibility settings
  * **System-scope**: Background cleanup goroutine with `context.Background()` - documented as system maintenance
- [x] User-scope calls MUST pass request context through logic layers to preserve organization_id and auth claims
  * All user-facing methods pass `ctx` from RPC handler to logic layer
- [x] System-scope calls MUST justify why system context is needed and document in code comments
  * Background cleanup: "System-scope required to scan all organizations' stale connections for timeout cleanup"
- [x] Cross-domain logic methods are stable, well-defined, and versioned if breaking changes needed
  * N/A - no new cross-domain interfaces exposed
- [x] All cross-domain calls include structured logging with source/target service and operation
  * N/A - no cross-domain calls
- [x] Logic layer methods accept `tx database.DBTX` parameter to support atomic cross-domain operations
  * All presence/push logic methods accept DBTX for transactional consistency
- [x] Connect layer passes same transaction to multiple logic layer calls when atomicity is required
  * Example: Register push token + update employee notification preferences in single transaction
- [x] NEVER nest `txn.WithTxn` calls; only connect layer manages transactions
  * Logic layer never calls WithTxn; only receives tx parameter

### Codegen & Generated-Client Checks
When the plan requires DB schema changes or new/updated RPC contracts, include explicit codegen steps in the plan and mark them as prerequisites for implementation:
- [x] SQL changes => `cd backend && sqlc generate` (commit generated outputs)
  * **Schema changes**: Extend `notification.active_connection` table with presence fields, add `notification.push_token` and `notification.presence_visibility` tables
  * **Query files**: Add queries in `backend/database/scripts/notification.query.sql` for presence updates, push token CRUD
  * **Codegen step**: `cd backend && sqlc generate` after schema + query changes
- [x] Proto changes => `cd backend && buf generate` (commit backend generated outputs)
  * **Proto changes**: Extend `notification.proto` with presence RPCs (UpdatePresenceStatus, RegisterPushToken, SetPresenceVisibility, GetPresenceSettings)
  * **Codegen step**: `cd backend && buf generate` after proto changes
  * **Generated files**: `backend/rpc/v1/notification.pb.go`, `backend/rpc/v1/notificationconnect/notification.connect.go`
- [x] After proto changes, the frontend package `frontend/packages/rpc` will be updated; the plan MUST include re-exporting new services from `frontend/packages/rpc/index.ts` and a frontend build step (`pnpm -r build` or `pnpm -w -r build`) so workspace artifacts are refreshed.
  * **Re-export**: Update `frontend/packages/rpc/index.ts` to export new presence-related types and enums
  * **Frontend build**: Run `cd frontend && pnpm -r build` to regenerate workspace artifacts
  * **API wrappers**: Add wrappers in `frontend/packages/apis/src/presence.ts` and `frontend/packages/apis/src/push-notifications.ts`

**Codegen Workflow**:
1. Update `backend/database/scripts/schema.sql` (canonical schema)
2. Author golang-migrate scripts: `backend/k8s/base/database/migrations/YYYYMMDDHHMMSS_presence_tracking.up.sql` and `.down.sql`
3. Apply migrations: `cd backend && ./scripts/migrate.sh` (resolve dirty states if needed)
4. Add sqlc queries in `backend/database/scripts/notification.query.sql`
5. Run `cd backend && sqlc generate`
6. Update `backend/rpc/v1/notification.proto` with new RPCs
7. Run `cd backend && buf generate`
8. Update `frontend/packages/rpc/index.ts` exports
9. Run `cd frontend && pnpm -r build`
10. Add API wrappers in `frontend/packages/apis/src/` with custom types

These checks are enforced by the Constitution Check gate: plans that modify schemas or proto contracts MUST document how generated clients are produced and validated in CI.

### Cross-Stack Constant & Type Synchronization Checks (Constitution Principle VIII)
When the plan involves string-based constants spanning multiple layers (database, backend, frontend):
- [x] Prefer protobuf enums when possible for compile-time type safety (e.g., ChannelType, EmployeeStatus)
  * **PresenceStatus**: Define as proto enum: `ONLINE`, `ONLINE_HIDDEN`, `IDLE`, `OFFLINE`
  * **PermissionState**: Define as proto enum: `GRANTED`, `DENIED`, `PROMPT`
  * **VisibilityMode**: Define as proto enum: `EVERYONE`, `DEPARTMENTS`, `OFFLINE`
- [x] For string constants that cannot be proto enums, document ALL affected layers in plan
  * **No string constants** - all status/state values use proto enums for type safety
- [x] Database: Add CHECK constraints for valid string values
  * `presence_status TEXT CHECK (presence_status IN ('online', 'online_hidden', 'idle', 'offline'))`
  * `permission_state TEXT CHECK (permission_state IN ('granted', 'denied', 'prompt'))`
  * `visibility_mode TEXT CHECK (visibility_mode IN ('everyone', 'departments', 'offline'))`
- [x] Database: Document allowed values in table/column comments
  * `COMMENT ON COLUMN active_connection.presence_status IS 'Employee presence: online, online_hidden, idle, offline'`
  * `COMMENT ON COLUMN push_token.permission_state IS 'Browser permission: granted, denied, prompt'`
- [x] Backend: Define constants in domain package (e.g., `internal/chat/constants.go`)
  * `internal/notification/presence_constants.go`: Map proto enums to DB string values
  * Example: `const PresenceStatusOnline = "online" // Maps to rpcv1.PresenceStatus_ONLINE`
- [x] Backend: Use constants in code, NEVER hardcoded strings
  * All DB queries use constants from presence_constants.go
  * All enum conversions use helper functions: `ProtoToDBPresenceStatus()`, `DBToProtoPresenceStatus()`
- [x] Backend: Log warnings for unknown/invalid constant values at runtime
  * Enum conversion functions log `slog.WarnContext` for invalid values before returning default
- [x] Frontend: Define TypeScript union types or enums matching backend constants
  * `type PresenceStatus = 'online' | 'online_hidden' | 'idle' | 'offline'`
  * Generated from proto enums via buf generate
- [x] Frontend: Use type guards for runtime validation
  * `isValidPresenceStatus(value: string): value is PresenceStatus`
- [x] Frontend: Log warnings for unhandled constant values
  * SSE event handlers log `console.warn('[Presence] Unknown status:', status)` for invalid values
- [x] Contract tests: Add validation that backend constants match database CHECK constraints
  * Integration test: Query CHECK constraint definition, verify all Go constants are in constraint
- [x] Contract tests: Add validation that frontend types align with backend API responses
  * API wrapper tests: Verify proto enum values match TypeScript union type values
- [x] PR checklist includes: Database CHECK constraint ✅, Backend constants ✅, Frontend types ✅, Tests ✅
  * Will be enforced in tasks.md PR checklist section
- [x] Change coordination: Update all layers atomically in single PR (no partial migrations)
  * Schema, proto, constants, types all updated in same PR
- [x] Documentation: API contracts document allowed constant values in comments
  * Proto enum values documented with comments in notification.proto

**Example Constant Alignment Pattern**:
```sql
-- Database CHECK constraint
ALTER TABLE notification.notification 
ADD CONSTRAINT notification_type_valid 
CHECK (notification_type IN ('message', 'mention', 'reply'));
```

```go
// Backend constants (internal/notification/constants.go)
const (
    NotificationTypeMessage = "message"
    NotificationTypeMention = "mention"
    NotificationTypeReply   = "reply"
)
```

```typescript
// Frontend types (packages/apis/src/types.ts)
type NotificationType = 'message' | 'mention' | 'reply';
```

Rationale: String constant mismatches cause silent runtime failures (e.g., unhandled notification types, ignored events). Coordinated validation across layers prevents drift.

## Project Structure

### Documentation (this feature)
```
specs/[###-feature]/
├── plan.md              # This file (/plan command output)
├── research.md          # Phase 0 output (/plan command)
├── data-model.md        # Phase 1 output (/plan command)
├── quickstart.md        # Phase 1 output (/plan command)
├── contracts/           # Phase 1 output (/plan command)
└── tasks.md             # Phase 2 output (/tasks command - NOT created by /plan)
```

### Source Code (Tech Office Monorepo)
<!--
  ACTION REQUIRED: Expand the structure below with concrete paths for this feature.
  Mark which directories/files will be created or modified. Include relevant domain
  schemas if database changes are needed.
-->

**Backend Structure**:
```
backend/
├── database/
│   ├── scripts/
│   │   ├── schema.sql                      # [MODIFY] Add presence_status, active_channel_id to active_connection;
│   │   │                                   #          Add push_token, presence_visibility tables
│   │   └── notification.query.sql          # [MODIFY] Add presence update, push token CRUD, visibility queries
│   ├── models.go                           # [GENERATED] New types: PushToken, PresenceVisibility
│   ├── notification.query.sql.go           # [GENERATED] Updated with new presence/push queries
│   └── enum.go                             # [MODIFY] Add presence status, permission state enums
├── internal/
│   └── notification/
│       ├── connect.go                      # [MODIFY] Add presence/push RPC handlers
│       ├── logic.go                        # [MODIFY] Extend notification logic interface
│       ├── presence.go                     # [ADD] Presence tracking logic layer
│       ├── push.go                         # [ADD] Push notification logic layer (FCM integration)
│       ├── presence_constants.go           # [ADD] Presence status constants and enum converters
│       ├── sse.go                          # [MODIFY] Filter ephemeral signals by active_channel_id
│       ├── presence_test.go                # [ADD] Presence logic unit tests
│       └── push_test.go                    # [ADD] Push notification logic unit tests
├── integration/
│   └── presence_integration_test.go        # [ADD] Integration tests for presence + push flow
├── rpc/
│   └── v1/
│       ├── notification.proto              # [MODIFY] Add presence RPCs, enums (PresenceStatus, PermissionState, VisibilityMode)
│       ├── notification.pb.go              # [GENERATED] Updated proto definitions
│       └── notificationconnect/
│           └── notification.connect.go     # [GENERATED] Updated ConnectRPC interfaces
├── k8s/
│   └── base/
│       ├── database/
│       │   └── migrations/
│       │       ├── YYYYMMDDHHMMSS_presence_tracking.up.sql   # [ADD] Migration to add presence fields
│       │       ├── YYYYMMDDHHMMSS_presence_tracking.down.sql # [ADD] Rollback migration
│       │       ├── YYYYMMDDHHMMSS_push_tokens.up.sql         # [ADD] Migration for push_token table
│       │       └── YYYYMMDDHHMMSS_push_tokens.down.sql       # [ADD] Rollback migration
│       └── notification/
│           └── deployment.yaml             # [MODIFY] Add FCM credentials env vars
└── cmd/
    └── server.go                           # [MODIFY] Initialize FCM client, pass to notification service

Database Schemas Involved: notification (primary - all tables in notification schema)
- notification.active_connection (extended with presence fields)
- notification.push_token (new table)
- notification.presence_visibility (new table)
- organization.employee (FK reference only, no modifications)

**Backend Service Structure Requirements**:
All backend services MUST follow these patterns (per Constitution v3.6.0):

**Two-Layer Architecture**:
- **Logic Layer** (business logic):
  * Pure business logic implementation
  * NO connection pools (pool-agnostic)
  * Accepts `tx database.DBTX` parameter for all operations
  * Receives parsed auth context (employeeID, orgID) as parameters
  * Returns domain errors (not connect.Error)
  * Implements interface for cross-domain dependencies
  * Location: `internal/[feature]/logic.go`
  
- **Connect Layer** (RPC handlers):
  * Owns `AdminPool database.AdminDatabaseConnector` (system-scope operations)
  * Owns `TenantPool database.TenantDatabaseConnector` (tenant-aware operations)
  * Depends on logic layer interface (not concrete implementation)
  * Extracts auth context from request
  * Manages transactions with `txn.WithTxn` (chooses appropriate pool)
  * Translates domain errors to connect.Error
  * Location: `internal/[feature]/connect.go`

**Transaction Management**:
- Connect layer MUST use `txn.WithTxn` helper (not manual Begin/Commit/Rollback)
- Connect layer chooses pool: TenantPool (user operations) vs AdminPool (system operations)
- Logic layer methods receive `tx database.DBTX` parameter
- Read-only operations MAY skip transaction (pass pool directly as DBTX)

**Cross-Domain Integration**:
- Services depend on other services' logic layer interfaces (not connect layer)
- Inject logic layer dependencies at initialization (see `backend/cmd/server.go`)
- Cross-domain calls use direct Go method invocations (NOT RPC internally)
- Pass proper context (user-scope vs system-scope) and share transaction when atomic
- Avoid SQL-level cross-schema access

**Initialization Pattern**:
```go
// cmd/server.go
// 1. Create logic layers (no pools in constructors)
notifLogic := notification.NewNotificationLogic(queries, instanceID)
iamLogic := iam.NewIAMLogic(queries, notifLogic) // Inject logic dependencies

// 2. Wrap with connect layers (pools here)
notifConnect := notification.NewNotificationServiceConnect(notifLogic, adminPool, tenantPool)
iamConnect := iam.NewIAMServiceConnect(iamLogic, adminPool, tenantPool)

// 3. Register connect layers
mux.Handle(rpcv1connect.NewNotificationServiceHandler(notifConnect, interceptors))
```

**Reference Implementation**:
- See `backend/internal/organization/` for service structure patterns
- Connect layer: Manages pools, transactions, auth extraction
- Logic layer: Pure business logic, transaction-aware via DBTX parameter
```

**Frontend Structure**:
```
frontend/
├── apps/
│   └── web/
│       ├── public/
│       │   └── firebase-messaging-sw.js     # [ADD] Service Worker for FCM background messages
│       └── src/
│           ├── app/
│           │   └── workspace/
│           │       ├── layout.tsx           # [MODIFY] Add notification badge, user status indicator in header
│           │       ├── chat/
│           │       │   └── components/
│           │       │       ├── ChannelMemberList.tsx      # [MODIFY] Show presence indicators
│           │       │       └── TypingIndicator.tsx        # [MODIFY] Filter by active viewers
│           │       └── components/
│           │           ├── PresenceIndicator.tsx          # [ADD] Reusable presence dot component
│           │           ├── NotificationBadge.tsx          # [ADD] Unread count badge
│           │           └── NotificationList.tsx           # [MODIFY] Show push notification permission status
│           ├── hooks/
│           │   ├── usePresenceTracking.ts    # [ADD] Track tab visibility, user interaction, send heartbeat
│           │   ├── useActiveChannel.ts       # [ADD] Track current channel, update on navigation
│           │   ├── usePushNotifications.ts   # [ADD] Request permission, register FCM token
│           │   ├── usePresenceVisibility.ts  # [ADD] Manage visibility settings
│           │   └── useNotificationRouting.ts # [ADD] Decide in-app vs push based on tab state
│           └── lib/
│               ├── firebase.ts               # [ADD] FCM initialization, token management
│               ├── presence.ts               # [ADD] Page Visibility API, idle detection helpers
│               └── push-notifications.ts     # [ADD] Push permission helpers, deep link handling
└── packages/
    ├── apis/
    │   └── src/
    │       ├── presence.ts                   # [ADD] Presence status API wrappers
    │       ├── push-notifications.ts         # [ADD] Push token registration wrappers
    │       └── proto-utils.ts                # [MODIFY] Add enum converters for PresenceStatus
    ├── notifications/
    │   └── src/
    │       ├── sse-client.ts                 # [MODIFY] Handle presence update events, ephemeral signals
    │       └── types.ts                      # [MODIFY] Add PresenceUpdateEvent, PushTokenEvent types
    └── rpc/
        ├── index.ts                          # [MODIFY] Export new presence-related types
        └── rpc/v1/
            └── notification_pb.ts            # [GENERATED] Updated with presence RPCs and enums
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

## Phase 0: Outline & Research
1. **Extract unknowns from Technical Context** above:
   - For each NEEDS CLARIFICATION → research task
   - For each dependency → best practices task
   - For each integration → patterns task

2. **Tech Office Specific Research**:
   - **Database Schema Design**: Which domain schema(s) to use? New entities or extend existing?
   - **Multi-Tenant Isolation**: How to enforce `organization_id` constraints?
   - **Cross-Schema References**: Which central entities (`organization.employee`, `organization.customer`) to reference?
   - **Cross-Domain Integration**: Which existing service methods to reuse? New service dependencies needed?
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
   - **Migration Strategy**: Update `schema.sql`, author golang-migrate scripts, apply via `./scripts/migrate.sh`

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

**Output**: 
- `data-model.md` with complete schema design
- `/contracts/*.proto` for RPC definitions
- `/contracts/*.sql` for sqlc queries
- `quickstart.md` with test scenarios
- Failing test stubs (Go and TypeScript)

## Phase 2: Task Planning Approach
*This section describes what the /tasks command will do - DO NOT execute during /plan*

**Task Generation Strategy**:
- Load `.specify/templates/tasks-template.md` as base
- Generate tasks from Phase 1 design docs (contracts, data model, quickstart)
- Follow Tech Office development workflow:

**Backend Tasks**:
1. Database schema changes in `backend/database/scripts/schema.sql` [P]
2. Author golang-migrate scripts in `backend/k8s/base/database/migrations/` (`<timestamp>_<name>.up.sql` and `.down.sql`) [depends on 1]
3. Apply migrations locally: `cd backend && ./scripts/migrate.sh` (resolve dirty states with `migrate force` if needed) [depends on 2]
4. sqlc query definitions in `backend/database/scripts/[domain].query.sql` [P]
5. sqlc code generation: `cd backend && sqlc generate` [depends on 4]
6. Protocol Buffer definitions in `backend/rpc/v1/[feature].proto` [P]
7. Protobuf code generation: `cd backend && buf generate` [depends on 6]
8. Service struct creation with AdminPool and TenantPool in `internal/[feature]/[feature].go` [depends on 5,7]
9. Service method implementation with proper pool usage and txn.WithTxn [depends on 8]
10. Unit tests for service [depends on 9]
11. Integration tests with test database [depends on 9]

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

No constitutional violations. This feature follows all established patterns:
- Extends existing notification service (no new service layer)
- Uses TenantPool for user operations, AdminPool for system cleanup
- All tables include organization_id for multi-tenancy
- Presence tracking uses existing SSE infrastructure
- FCM integration follows standard external client pattern


## Progress Tracking
*This checklist is updated during execution flow*

**Phase Status**:
- [x] Phase 0: Research complete (/plan command) - research.md generated
- [x] Phase 1: Design complete (/plan command) - data-model.md, contracts/, quickstart.md generated
- [x] Phase 2: Task planning complete (/plan command - describe approach only)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS - All checks validated, no violations
- [x] Post-Design Constitution Check: PASS - No new violations after design
- [x] All NEEDS CLARIFICATION resolved - FCM provider clarified as Firebase
- [x] Complexity deviations documented - No deviations, follows existing patterns

---
*Based on Constitution v3.3.0 - See `/memory/constitution.md`*
