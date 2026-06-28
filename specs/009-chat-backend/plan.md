
# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]
**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

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

**Feature**: Chat Backend System - Slack-like channel-based messaging with threaded replies (1 level), emoji reactions, and member management. Reusable for project ticket comments, CRM deal notes, and support threads.

**Technical Approach** (Constitution v3.6.0 Compliant):
- **Two-Layer Service Architecture**: Chat logic layer (pure business logic) + connect layer (RPC handlers)
- **New `chat` Schema**: 5 tables (channel, message, channel_membership, reaction, typing_indicator)
- **Cross-Domain Integration**: Chat logic depends on `notification.NotificationLogic` interface (NOT RPC internally)
- **Transaction Sharing**: Message creation + notification publishing in single atomic transaction
- **Context Propagation**: User-scope context flows through logic layers for security and audit
- **Multi-Tenant Isolation**: `organization_id` on all tables, TenantPool for all user operations
- **Performance**: Batched notification inserts (<100ms for 1000+ members), cursor-based message pagination
- **Real-Time**: SSE via notification hub for message delivery, typing indicators (in-memory ephemeral state)
- **Reusability**: `channel_type` enum enables reuse for project comments, CRM notes, support tickets

## Technical Context
**Project Type**: web (frontend + backend monorepo)  
**Frontend Stack**: 
- Language: TypeScript 5.x
- Framework: Next.js 15 (App Router)
- UI Library: Material-UI (MUI) v5
- Package Manager: pnpm workspace
- Testing: [e.g., Vitest, React Testing Library or NEEDS CLARIFICATION]

**Backend Stack**:
- Language: Go 1.25+
- Database: PostgreSQL 16+ (multi-tenant, schema-per-domain)
- ORM: sqlc (type-safe SQL code generation)
- RPC: Protocol Buffers + ConnectRPC
- Auth: Zitadel integration
- Workflow: https://github.com/nvcnvn/flows
- Testing: [e.g., Go testing, testify or NEEDS CLARIFICATION]

**Infrastructure**:
- Container: Docker
- Orchestration: Kubernetes (StackGres for PostgreSQL)
- Migration: Atlas
- Deployment: [e.g., dev/prod overlays or NEEDS CLARIFICATION]

**Performance Goals**: [e.g., <200ms API response p95, 1000 concurrent users or NEEDS CLARIFICATION]  
**Constraints**: [e.g., multi-tenant isolation, subdomain routing, RBAC enforcement or NEEDS CLARIFICATION]  
**Scale/Scope**: [e.g., 10k organizations, 100k users, 15+ business domains or NEEDS CLARIFICATION]

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

[Gates determined based on constitution file]

### Backend Service Architecture Checks
When the plan involves backend service implementation, verify compliance with Constitution v3.6.0:
- [x] Service implements two-layer architecture: Logic layer (business logic) + Connect layer (RPC handlers)
- [x] Logic layer has NO connection pools (only Queries and other logic dependencies)
- [x] Logic layer methods accept `tx database.DBTX` parameter for all database operations
- [x] Logic layer receives parsed auth context as parameters (employeeID, orgID) not raw request context
- [x] Connect layer owns both `AdminPool database.AdminDatabaseConnector` and `TenantPool database.TenantDatabaseConnector`
- [x] Connect layer extracts auth context from request and passes to logic layer
- [x] Connect layer manages transactions using `txn.WithTxn` helper (no manual Begin/Commit/Rollback)
- [x] Connect layer chooses appropriate pool: TenantPool for user operations, AdminPool for system operations
- [x] AdminPool usage is documented with justification (system-scope only, N/A for chat - all user operations)
- [x] All tenant-data queries include `organization_id` filters
- [x] Simple authorization uses proto-level `access_control` options where appropriate

### Cross-Domain Integration Checks (NEW in v3.6.0)
When the plan involves integration across business domains (e.g., IAM calling Organization, CRM calling Customer):
- [x] Avoid SQL-level cross-schema data access; use service logic layer methods instead (except for explicitly relaxed `public` schema)
- [x] Reuse existing logic layer methods rather than duplicating SQL queries or domain logic (notification.PublishBatchNotification)
- [x] Services depend on other services' **logic layer interfaces** (not connect layer)
- [x] Declare logic layer dependencies in logic layer constructor (connect layer is separate)
- [x] Initialize logic layers first, then wrap with connect layers in `backend/cmd/server.go`
- [x] Cross-domain calls use direct Go method invocations on logic layer (NOT RPC layer internally)
- [x] Explicitly document context propagation: user-scope (request context) vs system-scope (background context)
- [x] User-scope calls MUST pass request context through logic layers to preserve organization_id and auth claims
- [x] System-scope calls MUST justify why system context is needed and document in code comments (N/A for chat)
- [x] Cross-domain logic methods are stable, well-defined, and versioned if breaking changes needed
- [x] All cross-domain calls include structured logging with source/target service and operation
- [x] Logic layer methods accept `tx database.DBTX` parameter to support atomic cross-domain operations
- [x] Connect layer passes same transaction to multiple logic layer calls when atomicity is required
- [x] NEVER nest `txn.WithTxn` calls; only connect layer manages transactions

### Codegen & Generated-Client Checks
When the plan requires DB schema changes or new/updated RPC contracts, include explicit codegen steps in the plan and mark them as prerequisites for implementation:
- SQL changes => `cd backend && sqlc generate` (commit generated outputs)
- Proto changes => `cd backend && buf generate` (commit backend generated outputs)
- After proto changes, the frontend package `frontend/packages/rpc` will be updated; the plan MUST include re-exporting new services from `frontend/packages/rpc/index.ts` and a frontend build step (`pnpm -r build` or `pnpm -w -r build`) so workspace artifacts are refreshed.

These checks are enforced by the Constitution Check gate: plans that modify schemas or proto contracts MUST document how generated clients are produced and validated in CI.

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
│   │   ├── schema.sql          # [MODIFY] Add chat schema and tables
│   │   └── chat.query.sql      # [ADD] sqlc queries for chat operations
│   ├── models.go               # [GENERATED by sqlc]
│   └── chat.query.sql.go       # [GENERATED by sqlc]
├── internal/
│   └── chat/                   # [ADD new service package]
│       ├── logic.go            # [ADD] Logic layer (pure business logic, pool-agnostic)
│       ├── connect.go          # [ADD] Connect layer (RPC handlers, owns pools)
│       ├── logic_test.go       # [ADD] Logic layer unit tests
│       └── connect_test.go     # [ADD] Connect layer tests
├── rpc/
│   └── v1/
│       ├── chat.proto          # [ADD] Chat service RPC definitions
│       └── chat.pb.go          # [GENERATED from proto]
└── cmd/
    └── server.go               # [MODIFY] Register chat service (logic first, then connect)

Database Schemas Involved: chat (new), organization (references employee), public (organization reference)

**Backend Service Structure Requirements**:
All backend services MUST follow these patterns (per Constitution v3.6.0):

**Two-Layer Architecture**:
- **Logic Layer** (`internal/chat/logic.go`):
  * Pure business logic implementation
  * NO connection pools (pool-agnostic)
  * Accepts `tx database.DBTX` parameter for all operations
  * Receives parsed auth context (employeeID, orgID) as parameters
  * Returns domain errors (not connect.Error)
  * Implements `ChatLogic` interface for testability and cross-domain dependencies
  * Example signature:
    ```go
    type ChatLogic interface {
        CreateChannel(ctx context.Context, tx database.DBTX, orgID, creatorID dbuuid.UUID, req *proto.CreateChannelRequest) (*proto.CreateChannelResponse, error)
        SendMessage(ctx context.Context, tx database.DBTX, orgID, authorID dbuuid.UUID, req *proto.SendMessageRequest) (*proto.SendMessageResponse, error)
    }
    
    type chatLogicImpl struct {
        Queries           *database.Queries
        NotificationLogic notification.NotificationLogic // Cross-domain dependency
    }
    ```
  
- **Connect Layer** (`internal/chat/connect.go`):
  * Owns `AdminPool database.AdminDatabaseConnector` (if system operations needed)
  * Owns `TenantPool database.TenantDatabaseConnector` (user-facing operations)
  * Depends on `ChatLogic` interface (not concrete implementation)
  * Extracts auth context from request (employeeID, orgID from JWT)
  * Manages transactions with `txn.WithTxn` (chooses appropriate pool)
  * Translates domain errors to connect.Error
  * Example signature:
    ```go
    type ChatServiceConnect struct {
        rpcv1connect.UnimplementedChatServiceHandler
        Logic      ChatLogic
        TenantPool database.TenantDatabaseConnector
    }
    
    func (s *ChatServiceConnect) CreateChannel(ctx context.Context, req *connect.Request[proto.CreateChannelRequest]) (*connect.Response[proto.CreateChannelResponse], error) {
        // 1. Extract auth
        employeeID, orgID, err := extractAuthContext(ctx)
        if err != nil {
            return nil, err
        }
        
        // 2. Manage transaction
        var resp *proto.CreateChannelResponse
        err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
            var txErr error
            resp, txErr = s.Logic.CreateChannel(ctx, tx, orgID, employeeID, req.Msg)
            return txErr
        })
        
        // 3. Translate to connect response
        if err != nil {
            return nil, connect.NewError(connect.CodeInternal, err)
        }
        return connect.NewResponse(resp), nil
    }
    ```

**Cross-Domain Integration** (Notification Hub):
- Chat logic layer depends on `notification.NotificationLogic` interface
- Inject notification logic dependency at initialization
- Call notification logic methods directly (NOT via RPC internally):
  ```go
  // In chat logic layer
  _, err = s.NotificationLogic.PublishBatchNotification(ctx, tx, orgID, notificationReqs)
  ```
- Pass same transaction for atomic operations (message creation + notification publishing)
- Use user-scope context (request context) to preserve organization_id and auth claims

**Initialization Pattern** (in `backend/cmd/server.go`):
```go
// 1. Create logic layers first (no pools in constructors)
notifLogic := notification.NewNotificationLogic(queries, instanceID)
chatLogic := chat.NewChatLogic(queries, notifLogic) // Inject notification logic

// 2. Wrap with connect layers (pools here)
chatConnect := chat.NewChatServiceConnect(chatLogic, tenantPool)

// 3. Register connect layers
mux.Handle(rpcv1connect.NewChatServiceHandler(chatConnect, interceptors))
```

**Transaction Management**:
- Connect layer MUST use `txn.WithTxn` helper (not manual Begin/Commit/Rollback)
- Connect layer chooses pool: TenantPool (all chat operations are user-facing)
- Logic layer methods receive `tx database.DBTX` parameter
- Cross-domain calls share same transaction when atomicity required

**Reference Implementation**:
- See `backend/internal/notification/` for two-layer service structure
- Logic layer: Pure business logic, pool-agnostic, transaction-aware
- Connect layer: RPC handlers, auth extraction, transaction management
```

**Frontend Structure**:
```
frontend/
├── apps/
│   └── web/
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

## Phase 0: Outline & Research
1. **Extract unknowns from Technical Context** above:
   - For each NEEDS CLARIFICATION → research task
   - For each dependency → best practices task
   - For each integration → patterns task

2. **Tech Office Specific Research**:
   - **Database Schema Design**: ✅ New `chat` schema with 5 tables (research.md complete)
   - **Multi-Tenant Isolation**: ✅ `organization_id` on all tables (research.md complete)
   - **Cross-Schema References**: ✅ Reference `organization.employee` for users (research.md complete)
   - **Cross-Domain Integration**: ✅ Chat logic layer depends on `notification.NotificationLogic` interface (Constitution v3.6.0 pattern)
   - **Two-Layer Service Architecture**: ✅ Logic layer (pool-agnostic) + Connect layer (owns pools) (research.md complete)
   - **Transaction Management**: ✅ Share transaction between chat and notification logic for atomicity (research.md complete)
   - **Context Propagation**: ✅ User-scope context flows through logic layers (research.md complete)
   - **RPC Contract Design**: ✅ New `chat.proto` with ChatService (research.md complete)
   - **Zitadel Integration**: ✅ Use existing ROLE_EMPLOYEE for all chat operations (research.md complete)
   - **Frontend Patterns**: ✅ Workspace integration + SSE for real-time (research.md complete)
   - **Performance Optimization**: ✅ Batched notification inserts, indexed queries, cursor-based pagination (research.md complete)

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

3. **Backend Service Architecture** (Updated for Constitution v3.6.0):
   - **Logic Layer** (`internal/chat/logic.go`):
     - Define `ChatLogic` interface for testability and cross-domain dependencies
     - Implement business logic methods (CreateChannel, SendMessage, AddReaction, etc.)
     - NO connection pools (pool-agnostic)
     - Accept `tx database.DBTX` parameter for all database operations
     - Receive parsed auth context (employeeID, orgID) as parameters
     - Depend on `notification.NotificationLogic` interface for cross-domain notifications
     - Return domain errors (not connect.Error)
   - **Connect Layer** (`internal/chat/connect.go`):
     - Implement `ChatServiceHandler` interface from generated protobuf
     - Own `TenantPool database.TenantDatabaseConnector` (all chat operations are user-facing)
     - Extract auth context from request (employeeID, orgID from JWT)
     - Manage transactions using `txn.WithTxn` helper
     - Choose appropriate pool (TenantPool for all chat methods)
     - Translate domain errors to connect.Error
   - **Cross-Domain Integration**:
     - Chat logic depends on `notification.NotificationLogic` interface
     - Call `PublishBatchNotification` method directly (NOT via RPC internally)
     - Share same transaction (`tx database.DBTX`) for atomicity
     - Pass user-scope context through logic layers
     - Log all cross-domain calls with structured logging

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

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |


## Progress Tracking
*This checklist is updated during execution flow*

**Phase Status**:
- [x] Phase 0: Research complete (/plan command) - ✅ All research completed, Constitution v3.6.0 patterns documented
- [x] Phase 1: Design complete (/plan command) - ✅ Data model, contracts documented with two-layer architecture
- [ ] Phase 2: Task planning complete (/plan command - describe approach only)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS - All v3.6.0 requirements met (two-layer architecture, cross-domain integration)
- [x] Post-Design Constitution Check: PASS - Design follows logic/connect separation, transaction sharing
- [x] All NEEDS CLARIFICATION resolved - ✅ Research phase complete
- [x] Complexity deviations documented - None required, standard patterns used

**Constitution v3.6.0 Compliance Summary**:
- ✅ Two-layer service architecture (logic + connect)
- ✅ Logic layer pool-agnostic with DBTX parameter
- ✅ Connect layer owns pools and manages transactions
- ✅ Cross-domain via logic layer interfaces (not RPC)
- ✅ Transaction sharing for atomic operations
- ✅ User-scope context propagation
- ✅ Structured logging for observability
- ✅ Multi-tenant isolation with organization_id

---
*Based on Constitution v3.6.0 - See `.specify/memory/constitution.md`*
