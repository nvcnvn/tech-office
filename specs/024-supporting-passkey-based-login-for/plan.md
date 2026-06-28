
# Implementation Plan: Org-Managed User Accounts with Passkey-Based Login

**Branch**: `024-supporting-passkey-based-login-for` | **Date**: 2026-03-18 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/024-supporting-passkey-based-login-for/spec.md`

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
6.5. Execute Phase 1.5 → Compose test scenario stubs in `backend/integration/`
   → Write `t.Run` scenario descriptions capturing expected behavior
   → Developer review of test scenarios before implementation proceeds
   → Mark scenarios as reviewed in Constitution Check
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
Extend the IAM system to support org-managed worker accounts that authenticate with 6-digit numeric PINs instead of email/password. The design preserves the existing shared-ID architecture (`iam.user.id` = `iam.identity.id` = `organization.employee.id`) by making `iam.user.email` nullable and adding `login_identifier` to `iam.identity`. New org-scoped tables (`iam.credential`, `iam.account_lockout`) support PIN credential management and escalating lockout security. Admin operations (create, batch import, unlock, deactivate, reset) are gated by a new `iam.manageOrgAccounts` permission. All sessions use one JWT format—existing email-based auth is unaffected.

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
- Database: PostgreSQL 18+ (multi-tenant, schema-per-domain)
- ORM: sqlc (type-safe SQL code generation)
- RPC: Protocol Buffers + ConnectRPC
- Auth: Zitadel integration
- Workflow: https://github.com/nvcnvn/flows
- Testing: [e.g., Go testing, testify or NEEDS CLARIFICATION]

**Infrastructure**:
- Container: Docker
- Orchestration: Kubernetes (StackGres for PostgreSQL)
- Migration: golang-migrate (run via `backend/scripts/migrate.sh`)
- Deployment: [e.g., dev/prod overlays or NEEDS CLARIFICATION]

**Performance Goals**: PIN login latency equivalent to password login (<200ms p95). Lockout state query adds <5ms overhead.
**Constraints**: Multi-tenant isolation (organization_id on all new tables), Citus sharding compliance, backward compatibility with existing email/SSO auth flows, shared-ID architecture preservation.
**Scale/Scope**: Organizations with up to several thousand PIN-based workers. Lockout state consistent across distributed instances.

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

[Gates determined based on constitution file]
### Scenario-First Integration Testing Checks (Constitution Principle II)
When the plan involves backend feature implementation, verify compliance with Constitution v5.10.0:
- [x] Test scenario stubs composed in `backend/integration/` BEFORE implementation begins — see `contracts/org_managed_accounts_test.go` (36 scenarios)
- [x] Test scenarios use descriptive `t.Run` names that read as behavior specifications
- [ ] Test scenarios reviewed and approved by developer(s) before any code is written
- [ ] Plan includes full test suite run (`go test ./integration/...`) as acceptance gate
- [ ] Definition of Done: ALL code + tests implemented AND entire test suite passes (zero failures)
- [ ] No `t.Skip("TODO")` stubs remain for the feature at completion
### Backend Service Architecture Checks
When the plan involves backend service implementation, verify compliance with Constitution v5.10.0:
- [x] Service implements two-layer architecture: Logic layer (business logic) + Connect layer (RPC handlers) — extends existing IAMLogic interface + IAMServiceConnect
- [x] Logic layer has NO connection pools (only Queries and other logic dependencies) — existing pattern in iamLogicImpl
- [x] Logic layer methods accept `tx database.DBTX` parameter for all database operations
- [x] Logic layer receives parsed auth context as parameters (employeeID, orgID) not raw request context
- [x] Logic layer implements complex business authorization rules (e.g., PIN validation, lockout tier escalation)
- [x] Connect layer owns both `AdminPool database.AdminDatabaseConnector` and `TenantPool database.TenantDatabaseConnector`
- [x] Connect layer extracts auth context from request and passes to logic layer
- [x] Connect layer manages transactions using `txn.WithTxn` helper (no manual Begin/Commit/Rollback)
- [x] Connect layer chooses appropriate pool: TenantPool for PIN login/credential ops, AdminPool for org resolution and cross-tenant queries
- [x] Connect layer performs lightweight proto-level authorization verification
- [x] AdminPool usage documented: org resolution (subdomain→org_id) in LoginWithPIN requires cross-tenant query
- [x] All tenant-data queries include `organization_id` filters
- [x] ALL RPC methods declare `access_control` options in proto with explicit permissions — see contracts/iam_org_accounts.proto
- [x] NO role inheritance assumed
- [x] Proto authorization is declarative (proto options); logic authorization is imperative (business rules)

### Cross-Domain Integration Checks (Constitution Principle IV)
When the plan involves integration across business domains (e.g., IAM calling Organization, CRM calling Customer):
- [x] Avoid SQL-level cross-schema data access; use service logic layer methods instead — PIN login resolves org via public.organization query (allowed per constitution for public schema), employee data via organization.employee (same shared ID, no cross-schema JOIN needed)
- [x] Reuse existing logic layer methods rather than duplicating SQL queries or domain logic
- [x] Services depend on other services' **logic layer interfaces** (not connect layer)
- [x] Declare logic layer dependencies in logic layer constructor (connect layer is separate)
- [x] Initialize logic layers first, then wrap with connect layers in `backend/cmd/server.go`
- [x] Cross-domain calls use direct Go method invocations on logic layer (NOT RPC layer internally)
- [x] Explicitly document context propagation: LoginWithPIN uses AdminPool for org resolution (system-scope), TenantPool for credential check (user-scope after org resolved)
- [x] User-scope calls MUST pass request context through logic layers to preserve organization_id and auth claims
- [x] System-scope calls MUST justify why system context is needed: org subdomain resolution requires cross-tenant query
- [x] Cross-domain logic methods are stable, well-defined, and versioned if breaking changes needed
- [x] All cross-domain calls include structured logging with source/target service and operation
- [x] Logic layer methods accept `tx database.DBTX` parameter to support atomic cross-domain operations
- [x] Connect layer passes same transaction to multiple logic layer calls when atomicity is required — CreateOrgAccount atomically creates user+identity+employee+credential+role
- [x] NEVER nest `txn.WithTxn` calls; only connect layer manages transactions

### Frontend UI & Type Safety Checks (Constitution Principle VII)
When the plan involves frontend UI implementation, verify compliance with Constitution v5.10.0:
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

Note: Frontend is Phase 2 scope (admin UI for account management + PIN login page). Will be verified during implementation.

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
- [x] SQL changes => `cd backend && sqlc generate` — new iam.credential, iam.account_lockout tables + new queries
- [x] Proto changes => `cd backend && buf generate` — new RPC methods on IAMService
- [x] After proto changes, the frontend package `frontend/packages/rpc` will be updated; the plan MUST include re-exporting new services from `frontend/packages/rpc/index.ts` and a frontend build step (`pnpm -r build` or `pnpm -w -r build`)
- [x] Migration scripts: `backend/k8s/base/database/migrations/` paired up/down files

### Architecture Documentation Checks (Constitution Principle XII)
When the plan involves architectural changes (new domains, cross-domain dependencies, notification events, schema FK changes, or server init order changes):
- [x] Relevant `backend/docs/` architecture documents read and understood before design begins
- [x] Proposed changes comply with documented tier model and dependency direction rules — IAM is an existing Tier 1 service; no new cross-domain dependencies
- [x] Plan identifies which architecture documents need updating after implementation: `SYSTEM-ARCHITECTURE.md` (IAM domain catalog update for new credential/lockout tables)
- [ ] Documentation update tasks included in implementation plan (AFTER tests pass, not before)
- [ ] If adding a new domain: N/A — extending existing `iam` domain
- [ ] If adding cross-domain dependencies: N/A — no new cross-domain deps
- [ ] If adding notification types/events: N/A — no new notification events
- [x] If modifying schema FK references: Full FK Reference Map appendix will be updated (new FKs on iam.credential, iam.account_lockout)
- [ ] Documentation updates committed in the same PR as implementation

### Cross-Stack Constant & Type Synchronization Checks (Constitution Principle VIII)
When the plan involves string-based constants spanning multiple layers (database, backend, frontend):
- [x] Prefer protobuf enums when possible — credential_type and state are CHECK-constrained strings, will add proto enums for OrgAccountStatus
- [x] For string constants that cannot be proto enums, document ALL affected layers:
  - `credential_type`: DB CHECK ('pin', 'biometric'), backend constants, frontend types
  - `credential_state`: DB CHECK ('active', 'temporary', 'revoked'), backend constants, frontend types
  - `lockout_tier`: DB CHECK (0-4), backend constants (tier→duration map)
  - `account_status`: derived ('active', 'deactivated', 'locked'), backend constants, frontend types
- [x] Database: CHECK constraints defined in data-model.md
- [ ] Backend: Define constants in `internal/iam/constants.go`
- [ ] Frontend: Define TypeScript union types matching backend constants
- [ ] Automated testing: Integration tests validate constant alignment
- [ ] Change coordination: All layers updated atomically in single PR

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

// Integration test validating constant synchronization (backend/integration/notification_constants_test.go)
func TestNotificationTypeConstants(t *testing.T) {
    validTypes := []string{
        notification.NotificationTypeMessage,
        notification.NotificationTypeMention,
        notification.NotificationTypeReply,
    }
    
    // Verify constants match expected database values
    assert.Equal(t, "message", notification.NotificationTypeMessage)
    assert.Equal(t, "mention", notification.NotificationTypeMention)
    assert.Equal(t, "reply", notification.NotificationTypeReply)
    
    // Test API returns expected constants
    notif := getNotificationFromAPI(t)
    assert.Contains(t, validTypes, notif.NotificationType,
        "API returned unexpected notification_type: %s", notif.NotificationType)
}
```

```typescript
// Frontend types (packages/apis/src/types.ts)
type NotificationType = 'message' | 'mention' | 'reply';
```

Rationale: String constant mismatches cause silent runtime failures (e.g., December 2025 bug: backend returned `changeType: "remove"` but frontend expected `"removed"`, causing empty diff viewer). Coordinated validation across layers + automated tests prevent drift.

### Structured Error Details Checks (Constitution Principle X)
When the plan involves API error handling where generic error codes are insufficient:
- [x] Document error detail usage criteria — PIN lockout errors MUST include lockout duration so frontend can show countdown
- [x] Backend uses standard `google.rpc.ErrorDetails` proto definitions — `RetryInfo` for lockout retry delay, `BadRequest` for PIN complexity violations
- [x] Backend creates error details with `connect.NewErrorDetail()` for type safety
- [x] Backend attaches error details to Connect errors with `err.AddDetail(detail)`
- [x] Backend documents error detail contract in proto comments — LoginWithPIN response errors documented
- [ ] Frontend imports error detail schemas — Phase 2 scope (frontend implementation)
- [ ] Frontend extracts error details using `ConnectError.findDetails(Schema)` — Phase 2 scope
- [ ] Frontend handles missing/malformed error details gracefully — Phase 2 scope
- [ ] Frontend documents error detail handling — Phase 2 scope
- [x] Integration tests verify error detail round-trip — test stubs include lockout error scenarios
- [x] PR includes error detail contract documentation in proto files
- [ ] All changes submitted in single PR — Phase 2 scope (implementation)

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

### Distributed-First Architecture Checks (Constitution Principle XI)
When the plan involves backend services or state management:
- [x] Backend logic is stateless (NO process-local caches, session state, or counters) — lockout state in database
- [x] NO local file storage
- [x] NO in-memory connection registries
- [x] Lockout state stored in regular (logged) table — must survive crashes for security
- [x] Connection pools sized for N instances × concurrent requests
- [x] Database queries are shard-aware (include `organization_id` for co-location)
- [x] Lockout state consistent across all server instances (database-backed)
- [x] No assumptions about server affinity or sticky sessions

**Example Distributed State Pattern**:
```go
// ✅ CORRECT: Stateless backend using UNLOGGED table
func (s *NotificationServer) RegisterConnection(ctx context.Context, employeeID dbuuid.UUID) error {
    // Store SSE connection in UNLOGGED table (shared across instances)
    return s.queries.UpsertActiveConnection(ctx, database.UpsertActiveConnectionParams{
        EmployeeID:     employeeID,
        InstanceID:     s.instanceID, // Backend instance identifier
        ConnectionID:   uuid.New(),
        LastHeartbeat:  time.Now(),
    })
}

// ✅ CORRECT: Query all instances to find active connections
func (s *NotificationServer) RouteNotification(ctx context.Context, employeeID dbuuid.UUID) error {
    conns, err := s.queries.GetActiveConnections(ctx, employeeID)
    if err != nil {
        return err
    }
    
    for _, conn := range conns {
        if conn.InstanceID == s.instanceID {
            s.deliverToLocalConnection(conn.ConnectionID, notification)
        } else {
            s.routeToInstance(conn.InstanceID, conn.ConnectionID, notification)
        }
    }
    return nil
}
```

```sql
-- ✅ CORRECT: UNLOGGED table for ephemeral connection state
CREATE UNLOGGED TABLE IF NOT EXISTS notification.active_connection(
    employee_id uuid NOT NULL,
    instance_id text NOT NULL, -- Backend instance hostname/ID
    connection_id uuid NOT NULL,
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    last_heartbeat timestamptz DEFAULT now(),
    PRIMARY KEY (organization_id, employee_id, connection_id)
);

COMMENT ON TABLE notification.active_connection IS 
'UNLOGGED table tracking active SSE connections across backend instances. 
Data lost on crash is acceptable (users reconnect). 2-3x faster writes than regular table.';
```

Rationale: Multi-instance deployment prevents single point of failure. UNLOGGED tables provide 2-3x write performance for ephemeral state without external cache infrastructure. Stateless backends scale linearly by adding instances.

## Complexity Tracking
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

**Backend Structure** (this feature extends existing IAM service — no new service package):
```
backend/
├── database/
│   └── scripts/
│       ├── schema.sql              # [MODIFY] Add iam.credential, iam.account_lockout tables;
│       │                           #          ALTER iam.user (email nullable, add is_org_managed);
│       │                           #          ALTER iam.identity (email nullable, add login_identifier)
│       └── iam.query.sql           # [MODIFY] Add 18 new sqlc queries (see contracts/)
├── internal/
│   └── iam/                        # [MODIFY] Extend existing IAM service
│       ├── logic.go                # [MODIFY] Add PIN auth, lockout, org-account management methods
│       ├── connect_auth.go         # [MODIFY] Add LoginWithPIN, SetPIN, CreateOrgAccount, etc.
│       ├── password.go             # [REFERENCE] Existing bcrypt patterns reused for PIN hashing
│       ├── jwt.go                  # [REFERENCE] GenerateTokenWithOrg — unchanged, email="" for workers
│       └── permission_lookup.go    # [REFERENCE] GetPermissionsForUserInOrg — unchanged
├── rpc/
│   └── v1/
│       └── iam.proto               # [MODIFY] Add new RPC methods and messages (see contracts/)
└── k8s/
    └── base/
        └── database/
            └── migrations/         # [ADD] Up/down migration files for schema changes
                ├── YYYYMMDDHHMMSS_add_org_managed_accounts.up.sql
                └── YYYYMMDDHHMMSS_add_org_managed_accounts.down.sql
```

Database Schemas Involved: `iam` (primary — credential, lockout, user, identity), `organization` (employee import), `public` (permission seeding)

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
- [x] Phase 0: Research complete (/plan command) → [research.md](./research.md)
- [x] Phase 1: Design complete (/plan command) → [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)
- [x] Phase 1.5: Test stubs composed → [contracts/org_managed_accounts_test.go](./contracts/org_managed_accounts_test.go) (36 scenarios)
- [x] Phase 2: Task planning approach described (/plan command - describe approach only)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS — all applicable checks verified
- [x] Post-Design Constitution Check: PASS — no violations found
- [x] All NEEDS CLARIFICATION resolved — 4 items resolved in spec.md
- [x] Complexity deviations documented — none (no violations)

---
*Based on Constitution v5.11.0 - See `.specify/memory/constitution.md`*
