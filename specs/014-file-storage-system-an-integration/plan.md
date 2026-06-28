
# Implementation Plan: File Storage System with Quota Management

**Branch**: `014-file-storage-system-an-integration` | **Date**: 2025-11-09 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/014-file-storage-system-an-integration/spec.md`

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
**Primary Requirement**: Implement a reusable file storage system with per-organization quota management, supporting multiple upload contexts (chat attachments, user avatars, documentation, project files). Files are stored in Cloudflare R2 with presigned URLs for direct client uploads/downloads, eliminating backend proxying. Owners and operators can manage files through a dedicated interface with sorting, batch deletion, and deletion reason tracking. Quota enforcement prevents uploads when limits are reached, notifying owners/operators. Deleted files preserve metadata to show historical warnings with deletion context.

**Technical Approach**: 
- **Storage**: Cloudflare R2 (S3-compatible) with presigned URLs for uploads/downloads
- **CDN**: Cloudflare R2 public bucket with custom domain for global distribution
- **Image Optimization**: Cloudflare Image Resizing on-the-fly during retrieval
- **Backend**: New `files` schema with tables: `file_metadata`, `file_quota`, `file_deletion_log`
- **Service Architecture**: Two-layer pattern with FileLogic (business rules) + FileServiceConnect (RPC handlers)
- **Multi-Tenancy**: All tables include `organization_id` for Citus sharding, enforced at connection pool layer
- **Integration**: Chat frontend embeds file links in messages; avatar upload updates user profile with file reference
- **Frontend**: API wrappers in `packages/apis/src/files.ts`, file management UI in workspace, upload widgets for chat/avatar

## Technical Context
**Project Type**: web (frontend + backend monorepo)  
**Frontend Stack**: 
- Language: TypeScript 5.x
- Framework: Next.js 15 (App Router)
- UI Library: Material-UI (MUI) v5
- Package Manager: pnpm workspace
- Testing: Manual testing and backend integration tests (no frontend unit tests per constitution)

**Backend Stack**:
- Language: Go 1.25+
- Database: PostgreSQL 18+ with Citus (multi-tenant, schema-per-domain, distributed tables)
- ORM: sqlc (type-safe SQL code generation)
- RPC: Protocol Buffers + ConnectRPC
- Auth: Zitadel integration (organization_id extraction via interceptors)
- Storage: Cloudflare R2 (S3-compatible object storage with CDN)
- Testing: Go testing with integration tests in `backend/integration/`

**Infrastructure**:
- Container: Docker
- Orchestration: Kubernetes
- Migration: golang-migrate (run via `backend/scripts/migrate.sh`)
- Object Storage: Cloudflare R2 with presigned URLs
- CDN: Cloudflare R2 public bucket with custom domain
- Image Optimization: Cloudflare Image Resizing (on-the-fly)
- Deployment: k8s overlays (dev/prod)

**User-Provided Context**:
- Must integrate with existing chat frontend for file attachments in messages
- Must integrate with user avatar upload frontend for profile pictures
- Files uploaded via chat should embed secure download links in chat messages
- Avatar uploads should update user profile with file reference
- All uploads must enforce organization quota limits and file size limits
- Frontend must use API wrapper pattern (no direct protobuf imports)

**Performance Goals**: 
- Presigned URL generation: <50ms p95
- File metadata queries: <100ms p95
- Quota check overhead: <10ms (in-memory cache acceptable)
- Support up to 10,000 files per organization efficiently
- CDN serves files with <200ms global latency

**Constraints**: 
- Multi-tenant isolation: All file operations scoped to organization_id
- No backend file proxying: Use presigned URLs for direct client-to-R2 upload/download
- Atomic quota enforcement: Prevent race conditions during concurrent uploads
- Subdomain routing: Use organization subdomain for download link generation
- RBAC: Owner/operator roles required for file management interface
- Citus sharding: All tables must include organization_id in primary keys and indexes

**Scale/Scope**: 
- Support 10k+ organizations
- 100k+ users
- Multiple upload contexts: chat attachments, avatars, documentation, projects
- Default 100MB max file size per upload (configurable per org)
- Default unlimited storage quota (configurable per org)

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

[Gates determined based on constitution file]

### Backend Service Architecture Checks
When the plan involves backend service implementation, verify compliance with Constitution v5.5.0:
- [ ] Service implements two-layer architecture: Logic layer (business logic) + Connect layer (RPC handlers)
- [ ] Logic layer has NO connection pools (only Queries and other logic dependencies)
- [ ] Logic layer methods accept `tx database.DBTX` parameter for all database operations
- [ ] Logic layer receives parsed auth context as parameters (employeeID, orgID) not raw request context
- [ ] Logic layer implements complex business authorization rules (e.g., "only department managers can approve")
- [ ] Connect layer owns both `AdminPool database.AdminDatabaseConnector` and `TenantPool database.TenantDatabaseConnector`
- [ ] Connect layer extracts auth context from request and passes to logic layer
- [ ] Connect layer manages transactions using `txn.WithTxn` helper (no manual Begin/Commit/Rollback)
- [ ] Connect layer chooses appropriate pool: TenantPool for user operations, AdminPool for system operations
- [ ] Connect layer performs lightweight proto-level authorization verification
- [ ] AdminPool usage is documented with justification (system-scope only)
- [ ] All tenant-data queries include `organization_id` filters
- [ ] ALL RPC methods declare `access_control` options in proto with explicit `allowed_roles`
- [ ] NO role inheritance assumed - all required roles listed explicitly (e.g., `[ROLE_ADMIN, ROLE_OWNER, ROLE_OPERATOR, ROLE_EMPLOYEE]`)
- [ ] Proto authorization is declarative (proto options); logic authorization is imperative (business rules)

### Cross-Domain Integration Checks (Constitution Principle IV)
When the plan involves integration across business domains (e.g., IAM calling Organization, CRM calling Customer):
- [ ] Avoid SQL-level cross-schema data access; use service logic layer methods instead (except for explicitly relaxed `public` schema)
- [ ] Reuse existing logic layer methods rather than duplicating SQL queries or domain logic
- [ ] Services depend on other services' **logic layer interfaces** (not connect layer)
- [ ] Declare logic layer dependencies in logic layer constructor (connect layer is separate)
- [ ] Initialize logic layers first, then wrap with connect layers in `backend/cmd/server.go`
- [ ] Cross-domain calls use direct Go method invocations on logic layer (NOT RPC layer internally)
- [ ] Explicitly document context propagation: user-scope (request context) vs system-scope (background context)
- [ ] User-scope calls MUST pass request context through logic layers to preserve organization_id and auth claims
- [ ] System-scope calls MUST justify why system context is needed and document in code comments
- [ ] Cross-domain logic methods are stable, well-defined, and versioned if breaking changes needed
- [ ] All cross-domain calls include structured logging with source/target service and operation
- [ ] Logic layer methods accept `tx database.DBTX` parameter to support atomic cross-domain operations
- [ ] Connect layer passes same transaction to multiple logic layer calls when atomicity is required
- [ ] NEVER nest `txn.WithTxn` calls; only connect layer manages transactions

### Frontend UI & Type Safety Checks (Constitution Principle VII)
When the plan involves frontend UI implementation, verify compliance with Constitution v5.5.0:
- [ ] ALL RPC calls wrapped in typed functions in `packages/apis` (NO direct protobuf imports in apps)
- [ ] Custom TypeScript interfaces defined for all API parameters and responses
- [ ] Protobuf types converted to JavaScript native types (e.g., `Timestamp` → `Date`)
- [ ] ALL interactive UI elements have `data-testid` attributes for testing
- [ ] ALL colors use `useThemeColors()` hook - NO hardcoded hex/rgb/named colors
- [ ] NO direct MUI theme paths like `sx={{ bgcolor: 'primary.main' }}`
- [ ] Theme system ensures Dark/Light mode support automatically
- [ ] Component styling uses `colors.bg.*`, `colors.text.*`, `colors.border.*` patterns
- [ ] API wrapper functions use `rpcCall()` helper for error handling
- [ ] Type assertions explicit when returning from wrappers (e.g., `as Contact`)

**Example Theme Usage Pattern**:
```typescript
import { useThemeColors } from '@/theme/useThemeColors';

function MyComponent() {
  const colors = useThemeColors();
  
  return (
    <div 
      style={colors.bg.paper.style} 
      className={colors.border.default.className}
      data-testid="my-component"
    >
      <h1 style={colors.text.primary.style}>Title</h1>
      <Button style={colors.bg.primary.style} data-testid="action-btn">
        Action
      </Button>
    </div>
  );
}
```

Rationale: Centralized theme system prevents hardcoded color drift and ensures consistent Dark/Light mode support. Type-safe API wrappers prevent protobuf type leakage into applications.

### Codegen & Generated-Client Checks
When the plan requires DB schema changes or new/updated RPC contracts, include explicit codegen steps in the plan and mark them as prerequisites for implementation:
- SQL changes => `cd backend && sqlc generate` (commit generated outputs)
- Proto changes => `cd backend && buf generate` (commit backend generated outputs)
- After proto changes, the frontend package `frontend/packages/rpc` will be updated; the plan MUST include re-exporting new services from `frontend/packages/rpc/index.ts` and a frontend build step (`pnpm -r build` or `pnpm -w -r build`) so workspace artifacts are refreshed.

These checks are enforced by the Constitution Check gate: plans that modify schemas or proto contracts MUST document how generated clients are produced and validated in CI.

### Cross-Stack Constant & Type Synchronization Checks (Constitution Principle VIII)
When the plan involves string-based constants spanning multiple layers (database, backend, frontend):
- [ ] Prefer protobuf enums when possible for compile-time type safety (e.g., ChannelType, EmployeeStatus)
- [ ] For string constants that cannot be proto enums, document ALL affected layers in plan
- [ ] Database: Add CHECK constraints for valid string values (e.g., `CHECK (notification_type IN ('message', 'mention', 'reply'))`)
- [ ] Database: Document allowed values in table/column comments
- [ ] Backend: Define constants in domain package (e.g., `internal/chat/constants.go`)
- [ ] Backend: Use constants in code, NEVER hardcoded strings
- [ ] Backend: Log warnings for unknown/invalid constant values at runtime
- [ ] Frontend: Define TypeScript union types or enums matching backend constants
- [ ] Frontend: Use type guards for runtime validation
- [ ] Frontend: Log warnings for unhandled constant values
- [ ] Contract tests: Add validation that backend constants match database CHECK constraints
- [ ] Contract tests: Add validation that frontend types align with backend API responses
- [ ] PR checklist includes: Database CHECK constraint ✅, Backend constants ✅, Frontend types ✅, Tests ✅
- [ ] Change coordination: Update all layers atomically in single PR (no partial migrations)
- [ ] Documentation: API contracts document allowed constant values in comments

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

### Structured Error Details Checks (Constitution Principle X)
When the plan involves API error handling where generic error codes are insufficient:
- [ ] Document error detail usage criteria: ONLY when generic codes cannot guide client behavior
- [ ] Backend uses standard `google.rpc.ErrorDetails` proto definitions (RetryInfo, BadRequest, QuotaFailure, etc.)
- [ ] Backend creates error details with `connect.NewErrorDetail()` for type safety
- [ ] Backend attaches error details to Connect errors with `err.AddDetail(detail)`
- [ ] Backend documents error detail contract in proto comments and API documentation
- [ ] Frontend imports error detail schemas from `@buf/googleapis_googleapis.bufbuild_es/google/rpc/error_details_pb`
- [ ] Frontend extracts error details using `ConnectError.findDetails(Schema)` for type-safe validation
- [ ] Frontend handles missing/malformed error details gracefully with fallback behavior
- [ ] Frontend documents error detail handling in API wrapper functions
- [ ] Integration tests verify error detail round-trip (backend → frontend)
- [ ] PR includes error detail contract documentation in proto files
- [ ] All changes (backend attachment + frontend extraction + tests) submitted in single PR

**Example Error Detail Pattern**:
```go
// Backend: Attach RetryInfo for transient errors
if isOverloaded {
    err := connect.NewError(
        connect.CodeUnavailable,
        errors.New("service overloaded: back off and retry"),
    )
    retryInfo := &errdetails.RetryInfo{
        RetryDelay: durationpb.New(10 * time.Second),
    }
    if detail, detailErr := connect.NewErrorDetail(retryInfo); detailErr == nil {
        err.AddDetail(detail)
    }
    return nil, err
}
```

```typescript
// Frontend: Extract RetryInfo for retry timing
import { RetryInfoSchema } from "@buf/googleapis_googleapis.bufbuild_es/google/rpc/error_details_pb";

export async function sendMessage(params: SendMessageParams): Promise<SendMessageResponse> {
    try {
        return await rpcCall(async () => {
            const resp = await chatClient.sendMessage({
                channelId: params.channelId,
                messageText: params.messageText,
            });
            return resp as SendMessageResponse;
        });
    } catch (error) {
        if (error instanceof ConnectError && error.code === Code.Unavailable) {
            // Extract structured retry guidance
            const retryDetails = error.findDetails(RetryInfoSchema);
            if (retryDetails.length > 0) {
                const retryDelay = retryDetails[0].retryDelay?.seconds || 10;
                console.warn(`Service overloaded, retry in ${retryDelay}s`);
                // Schedule automatic retry or show user-friendly message
            }
        }
        throw error;
    }
}
```

Rationale: Error details enable client code to make informed decisions (retry timing, field-level validation, quota management) without relying solely on error messages. Type-safe proto-based error details provide compile-time validation across stack boundaries.

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
│   ├── schema.sql              # [MODIFY if schema changes needed]
│   ├── scripts/
│   │   ├── schema.sql          # Canonical schema (must stay in sync with migrations)
│   │   └── [domain].query.sql  # [ADD sqlc queries if needed]
│   ├── models.go               # [GENERATED by sqlc]
│   └── [domain].query.sql.go   # [GENERATED by sqlc]
├── internal/
│   └── [feature]/              # [ADD new service package]
│       ├── [feature].go        # Service implementation with AdminPool/TenantPool
│       └── [feature]_test.go   # Unit tests
├── rpc/
│   └── v1/
│       ├── [feature].proto     # [ADD if new RPC needed]
│       └── [feature].pb.go     # [GENERATED from proto]
└── k8s/                        # [MODIFY if deployment changes needed]
    └── base/
        └── [feature]/

Database Schemas Involved: [e.g., organization, crm, finance, iam, etc.]

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

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |


## Progress Tracking
*This checklist is updated during execution flow*

**Phase Status**:
- [x] Phase 0: Research complete (/plan command) - ✅ `research.md` created
- [x] Phase 1: Design complete (/plan command) - ✅ `data-model.md`, `contracts/`, `quickstart.md` created
- [x] Phase 2: Task planning complete (/plan command - describe approach only) - ✅ Task strategy documented above
- [ ] Phase 3: Tasks generated (/tasks command) - **Next step: Run /tasks**
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS - All checklist items reviewed and compliant
- [x] Post-Design Constitution Check: PASS - Design follows all constitutional principles
- [x] All NEEDS CLARIFICATION resolved - No unknowns remaining
- [x] Complexity deviations documented - No deviations; standard two-layer architecture

**Artifacts Generated**:
- ✅ `research.md` - Cloudflare R2 research, presigned URLs, CDN, quota enforcement patterns
- ✅ `data-model.md` - Database schema for files, file_quota, file_deletion_log tables
- ✅ `contracts/files.proto` - RPC service definition with 9 methods
- ✅ `contracts/files.query.sql` - sqlc queries for file operations
- ✅ `quickstart.md` - Setup guide with 6 test scenarios

**Constitution Compliance Summary**:
- Two-layer architecture: FileLogic (business rules) + FileServiceConnect (RPC handlers)
- Multi-tenant isolation: All tables distributed on `organization_id`, TenantPool enforcement
- Cross-domain integration: Chat/avatar integration via FileLogic interface (no SQL joins)
- Frontend API wrappers: Custom TypeScript types in `packages/apis/src/files.ts`
- Error details: QuotaFailure structured error for quota exceeded scenarios
- Constant synchronization: `upload_context` aligned across database CHECK, Go constants, TypeScript types
- Presigned URLs: No backend file proxying, direct client-to-R2 operations
- Proto authorization: All RPC methods declare explicit `allowed_roles`

---
*Based on Constitution v5.6.0 - See `.specify/memory/constitution.md`*
