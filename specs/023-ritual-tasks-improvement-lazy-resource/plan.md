
# Implementation Plan: Ritual Tasks — Lazy Resource Creation & Schedule Change Handling

**Branch**: `023-ritual-tasks-improvement-lazy-resource` | **Date**: 2026-03-13 | **Spec**: [spec.md](spec.md)  
**Input**: Feature specification from `/specs/023-ritual-tasks-improvement-lazy-resource/spec.md`

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

Ritual task instances are currently generated with eager creation of chat channels and description documents — wasting resources for tasks that users may never open. The schedule change flow also leaves orphaned future instances when a recurrence pattern changes.

This plan implements:
1. **Lazy resource creation**: Ritual instances are generated without channel/doc. The first `GetTask` call for an instance triggers `EnsureTaskResources`, which atomically creates the channel and document.
2. **"Clean Slate Forward" schedule change**: Changing a recurrence pattern soft-deletes untouched future instances, detaches touched ones as standalone tasks, and regenerates instances on the new pattern — all atomically.
3. **Impact preview**: `GetScheduleChangeImpact` RPC returns counts before the change is applied, driving the confirmation dialog.
4. **Inline definition editing**: The ritual instance detail view allows authorized users to edit the definition's recurrence pattern in-place, triggering the same confirmation flow.

**Research**: [research.md](research.md)  
**Data Model**: [data-model.md](data-model.md)  
**Contracts**: [contracts/collaboration-schedule-change.md](contracts/collaboration-schedule-change.md)  
**Quickstart**: [quickstart.md](quickstart.md)  
**Integration Test Stubs**: `backend/integration/ritual_tasks_improvement_test.go`

## Technical Context
**Project Type**: web (frontend + backend monorepo)  
**Frontend Stack**: 
- Language: TypeScript 5.x
- Framework: Next.js 15 (App Router)
- UI Library: Material-UI (MUI) v5
- Package Manager: pnpm workspace
- Testing: React Testing Library (component tests inferred from existing frontend test patterns)

**Backend Stack**:
- Language: Go 1.25+
- Database: PostgreSQL 18+ (multi-tenant, schema-per-domain with Citus sharding)
- ORM: sqlc (type-safe SQL code generation)
- RPC: Protocol Buffers + ConnectRPC
- Auth: Internal JWT signer (IAM module, direct SSO without Zitadel per spec 018)
- Workflow: https://github.com/nvcnvn/flows (ritual scheduler registered as RitualSchedulerWorkflow)
- Testing: Go testing + testify, integration tests connect to live server

**Infrastructure**:
- Container: Docker (docker-compose for local, docker-compose.test.yml for CI)
- Orchestration: Kubernetes (StackGres for PostgreSQL)
- Migration: golang-migrate (run via `backend/scripts/migrate.sh`)
- Deployment: k8s/base + k8s/overlays pattern

**Performance Goals**: No new performance requirements; EnsureTaskResources adds 1 DB write per first-access (acceptable for task detail page load).  
**Constraints**: All new queries must include `organization_id` for Citus shard co-location. No triggers, no ON DELETE SET NULL (Citus constraint). EnsureTaskResources must be idempotent for concurrent callers.  
**Scale/Scope**: Same multi-tenant scale as existing collaboration domain (30-day generation window, up to 30 instances per daily ritual per generation cycle).

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

[Gates determined based on constitution file]
### Scenario-First Integration Testing Checks (Constitution Principle II)
When the plan involves backend feature implementation, verify compliance with Constitution v5.11.0:
- [x] Test scenario stubs composed in `backend/integration/ritual_tasks_improvement_test.go` BEFORE implementation begins
- [x] Test scenarios use descriptive `t.Run` names that read as behavior specifications
- [ ] Test scenarios reviewed and approved by developer(s) before any code is written — **PENDING DEVELOPER REVIEW**
- [x] Plan includes full test suite run (`go test ./integration/...`) as acceptance gate
- [x] Definition of Done: ALL code + tests implemented AND entire test suite passes (zero failures)
- [ ] No `t.Skip("TODO")` stubs remain for the feature at completion — stubs exist NOW, will be removed during implementation
### Backend Service Architecture Checks
When the plan involves backend service implementation, verify compliance with Constitution v5.10.0:
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

### Architecture Documentation Checks (Constitution Principle XII)
When the plan involves architectural changes (new domains, cross-domain dependencies, notification events, schema FK changes, or server init order changes):
- [ ] Relevant `backend/docs/` architecture documents read and understood before design begins
- [ ] Proposed changes comply with documented tier model and dependency direction rules
- [ ] Plan identifies which architecture documents need updating after implementation
- [ ] Documentation update tasks included in implementation plan (AFTER tests pass, not before)
- [ ] If adding a new domain: `SYSTEM-ARCHITECTURE.md` tier model, dependency graphs, domain catalog, and init order will be updated
- [ ] If adding cross-domain dependencies: both code-level and data-level dependency graphs will be updated
- [ ] If adding notification types/events: `NOTIFICATION-SYSTEM-ARCHITECTURE.md` event taxonomy, delivery pipeline, and call graph will be updated
- [ ] If modifying schema FK references: Full FK Reference Map appendix will be updated
- [ ] Documentation updates committed in the same PR as implementation

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
- [ ] **Automated Testing (MANDATORY)**: Write integration tests validating constant values match across layers
- [ ] **Automated Testing**: Test MUST fail if backend and frontend constants diverge
- [ ] **Automated Testing**: Test MUST validate hardcoded strings use defined constants
- [ ] **Automated Testing**: Run tests in CI/CD pipeline before merge
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
- [ ] Backend logic is stateless (NO process-local caches, session state, or counters)
- [ ] NO local file storage - use object storage (Cloudflare R2) for uploads/attachments
- [ ] NO in-memory connection registries - use database UNLOGGED tables or distributed cache
- [ ] Ephemeral state (SSE connections, typing indicators) stored in PostgreSQL UNLOGGED tables
- [ ] UNLOGGED tables documented with data loss acceptance criteria
- [ ] Connection pools sized for N instances × concurrent requests (not single instance)
- [ ] Database queries are shard-aware (include `organization_id` for co-location)
- [ ] Cross-shard queries have documented performance justification
- [ ] SSE/WebSocket reconnection logic handles instance failures
- [ ] Load testing performed with 3+ backend instances
- [ ] Failure scenario tested (kill random instance, verify no data loss)
- [ ] NO assumptions about server affinity or sticky sessions
- [ ] Load balancers distribute requests randomly across instances

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

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| Two new RPCs (`GetScheduleChangeImpact` + `ChangeRitualDefinitionSchedule`) instead of modifying existing `UpdateRitualDefinition` | Schedule change requires impact preview + confirmation step + atomic cleanup; merging into existing RPC would make it ambiguous and force all callers to show a dialog | Splitting ensures clear semantics: metadata changes (name/description) remain simple, schedule changes go through the dedicated guarded path |

## Project Structure

### Documentation (this feature)
```
specs/023-ritual-tasks-improvement-lazy-resource/
├── plan.md              ✅ This file (/plan command output)
├── research.md          ✅ Phase 0 output
├── data-model.md        ✅ Phase 1 output
├── quickstart.md        ✅ Phase 1 output
├── contracts/
│   └── collaboration-schedule-change.md  ✅ Phase 1 output
└── tasks.md             ❌ Phase 2 output (/tasks command — NOT created by /plan)
```

### Source Code Changes (Tech Office Monorepo)

_Schema domain_: `collaboration` (no new domain; changes are internal to existing domain)_
_Architecture doc impact_: None — no new cross-domain dependencies introduced_

**Backend Structure** (files to MODIFY or CREATE):
```
backend/
├── database/
│   ├── scripts/
│   │   ├── schema.sql                         MODIFY: +2 columns (detached_from_ritual, schedule_version)
│   │   ├── migrations/NNNN_lazy_ritual.sql    CREATE: migration adding those columns
│   │   └── collaboration.query.sql            MODIFY: +6 new queries (see data-model.md)
│   ├── models.go                              REGENERATE: sqlc generate
│   └── collaboration.query.sql.go             REGENERATE: sqlc generate
├── rpc/
│   └── v1/
│       └── collaboration.proto                MODIFY: +2 RPCs, +2 messages, +fields in Task + RitualDefinition
│       (generated .pb.go files)               REGENERATE: buf generate
└── internal/
    └── collaboration/
        ├── logic.go                           MODIFY: add 3 interface methods
        ├── task_logic.go                      MODIFY: add EnsureTaskResources; rename GetTask hook
        ├── scheduler_logic.go                 MODIFY: remove channel/doc creation from loop
        ├── ritual_logic.go                    MODIFY: add GetScheduleChangeImpact + ChangeRitualDefinitionSchedule
        └── ritual_connect.go                  MODIFY: add RPC handler stubs for 2 new endpoints

backend/integration/
└── ritual_tasks_improvement_test.go           CREATE: ✅ done (stubs, pending review)

Database Schemas Involved: collaboration (collaboration.task + collaboration.ritual_definition)

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

**Frontend Structure** (files to MODIFY or CREATE):
```
frontend/
├── packages/
│   ├── rpc/index.ts                           MODIFY: re-export new collaboration methods after buf generate
│   └── apis/src/collaboration.ts              MODIFY: +2 typed wrappers (getScheduleChangeImpact, changeRitualDefinitionSchedule)
└── apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/
    ├── page.tsx                               MODIFY: add ritual definition section; trigger EnsureTaskResources on load
    └── components/
        ├── RitualDefinitionSection.tsx        CREATE: read-only + inline edit for ritual definition fields
        └── ScheduleChangeConfirmDialog.tsx    CREATE: impact preview + confirm/cancel dialog
```

## Phase 0: Outline & Research ✅ COMPLETE

**Output**: [research.md](research.md)

Key findings (see research.md for full details):
- Problem confirmed in `scheduler_logic.go` lines 130–190 — eager channel + doc creation in generation loop
- Lazy resource pattern: `EnsureTaskResources` method on `Logic` interface, called from `GetTask` when `channel_id IS NULL`
- Idempotency: atomic `UPDATE ... WHERE channel_id IS NULL RETURNING *` — concurrent callers safe
- `registerTaskResourceSurfaces` must be called after resource creation to enable V2 subscription inheritance
- Schedule change design: two new RPCs (`GetScheduleChangeImpact` + `ChangeRitualDefinitionSchedule`) separate from existing `UpdateRitualDefinition`
- Schema gaps: `detached_from_ritual BOOLEAN` on task; `schedule_version INT` on ritual_definition
- Architecture docs do NOT need updating (no new cross-domain dependencies)

## Phase 1: Design & Contracts ✅ COMPLETE

**Outputs produced**:

| Artifact | Path | Status |
|----------|------|--------|
| Data model | [data-model.md](data-model.md) | ✅ Done |
| Proto contracts | [contracts/collaboration-schedule-change.md](contracts/collaboration-schedule-change.md) | ✅ Done |
| Developer quickstart | [quickstart.md](quickstart.md) | ✅ Done |

**Key design decisions**:
- Migration: `ADD COLUMN IF NOT EXISTS detached_from_ritual BOOLEAN NOT NULL DEFAULT FALSE` + `schedule_version INT NOT NULL DEFAULT 1`
- 6 new sqlc queries: `CountScheduleChangeImpact`, `SoftDeleteUntouchedFutureInstances`, `DetachTouchedFutureInstances`, `UpdateRitualDefinitionSchedule`, `EnsureTaskChannel`, `EnsureTaskDocument`
- 2 new RPCs: `GetScheduleChangeImpact` (read-only preview) + `ChangeRitualDefinitionSchedule` (atomic apply) with `collab.manageRitualDefinition` permission
- Business authorization in logic layer: must be creator OR project admin (imperative check)
- `confirmed=true` required on `ChangeRitualDefinitionSchedule` → server rejects with `FailedPrecondition` if false

## Phase 1.5: Integration Test Stubs ✅ COMPLETE (PENDING DEVELOPER REVIEW)

**Output**: `backend/integration/ritual_tasks_improvement_test.go`

**Test Functions Written** (7 top-level test functions, 30+ `t.Run` behavior specs):

| Test Function | Spec Scenarios Covered |
|---------------|------------------------|
| `TestRitualTasksImprovementLazyResources` | Scenarios 1–4 (lazy creation, first-access trigger, standard task unchanged) |
| `TestRitualTasksImprovementConcurrentAccess` | Edge case: concurrent EnsureTaskResources is idempotent |
| `TestRitualTasksImprovementScheduleChangeImpact` | Scenario 10 (impact preview counts) |
| `TestRitualTasksImprovementScheduleChangeUntouched` | Scenario 5 (soft-delete untouched, regenerate, version++) |
| `TestRitualTasksImprovementScheduleChangeTouched` | Scenarios 7–8 (detach touched, detached_from_ritual flag) |
| `TestRitualTasksImprovementScheduleChangeHistorical` | Scenario 9 (historical instances never modified) |
| `TestRitualTasksImprovementScheduleChangeAtomicity` | FR-012 observable verification |
| `TestRitualTasksImprovementConfirmationRequired` | Scenario 11 (cancel / confirmed=false rejected) |
| `TestRitualTasksImprovementAccessControl` | FR-018 (only creator or admin) |
| `TestRitualTasksImprovementRapidScheduleChanges` | Edge case: rapid daily→weekly→bi-weekly changes |

**⚠️ DEVELOPER REVIEW REQUIRED BEFORE IMPLEMENTATION BEGINS**

Please review `backend/integration/ritual_tasks_improvement_test.go` and confirm:
- [ ] All spec scenarios covered (check against spec.md §User Scenarios)
- [ ] Test helper method stubs are acceptable (or suggest alternatives)
- [ ] `injectPastRitualInstance` helper approach is correct for historical data setup
- [ ] Concurrent access test approach is valid for the integration test framework
- [ ] No missing edge cases from spec §Edge Cases

---

## Phase 2: Task Planning Approach
*This section describes what the /tasks command will do — DO NOT execute during /plan*

**Task Generation Strategy**: `/tasks` command will generate `tasks.md` with numbered, ordered tasks.

**Backend Tasks**:
1. [SCHEMA] Add `detached_from_ritual` column to `collaboration.task` in `schema.sql` [P]
2. [SCHEMA] Add `schedule_version` column to `collaboration.ritual_definition` in `schema.sql` [P]
3. [MIGRATION] Write migration file `NNNN_lazy_ritual_resources.sql` (up + down) [depends on 1, 2]
4. [MIGRATION] Apply migration: `cd backend && ./scripts/migrate.sh up` [depends on 3]
5. [SQL] Add 6 new queries to `collaboration.query.sql` (see data-model.md) [depends on 4] [P with 6]
6. [PROTO] Add 2 new RPCs + messages to `collaboration.proto`; add fields to Task + RitualDefinition [P with 5]
7. [CODEGEN] `cd backend && sqlc generate` [depends on 5]
8. [CODEGEN] `cd backend && buf generate` [depends on 6]
9. [LOGIC] Add `EnsureTaskResources`, `GetScheduleChangeImpact`, `ChangeRitualDefinitionSchedule` to `Logic` interface in `logic.go` [depends on 7, 8]
10. [LOGIC] Modify `scheduler_logic.go`: remove eager channel/doc creation from `GenerateRitualInstances` loop [depends on 9]
11. [LOGIC] Implement `EnsureTaskResources` in `task_logic.go`: atomic UPDATE pattern, registerTaskResourceSurfaces [depends on 9]
12. [LOGIC] Call `EnsureTaskResources` from `GetTask` when `task_kind = 'ritual_instance'` AND `channel_id IS NULL` [depends on 11]
13. [LOGIC] Implement `GetScheduleChangeImpact` in `ritual_logic.go`: authz check, `CountScheduleChangeImpact` query [depends on 9]
14. [LOGIC] Implement `ChangeRitualDefinitionSchedule` in `ritual_logic.go`: authz, `confirmed` check, atomic 4-step flow in txn [depends on 13]
15. [CONNECT] Add RPC handlers for `GetScheduleChangeImpact` + `ChangeRitualDefinitionSchedule` in `ritual_connect.go` [depends on 13, 14]
16. [TESTS] Remove `t.Skip` from integration test stubs; implement `getScheduleChangeImpact`, `changeRitualDefinitionSchedule`, `injectPastRitualInstance` helpers [depends on 8, 15]
17. [TEST-RUN] `go test ./integration/... -run TestRitualTasksImprovement -v -count=1` [depends on 16]
18. [TEST-RUN] Full suite: `go test ./integration/... -v -count=1` [depends on 17]

**Frontend Tasks**:
19. [CODEGEN] `cd frontend && pnpm -w -r build` (picks up new proto types) [depends on 8]
20. [API] Add `getScheduleChangeImpact` + `changeRitualDefinitionSchedule` wrappers to `packages/apis/src/collaboration.ts` [depends on 19]
21. [COMPONENT] Create `RitualDefinitionSection.tsx` — read-only + inline edit for authorized users [depends on 20]
22. [COMPONENT] Create `ScheduleChangeConfirmDialog.tsx` — impact preview + confirm/cancel [depends on 20]
23. [PAGE] Modify task detail `page.tsx`: render `RitualDefinitionSection` for ritual instances; trigger `getTask` (which calls EnsureTaskResources) on load [depends on 21, 22]

**Estimated Output**: ~23 numbered tasks in `tasks.md`

**IMPORTANT**: This phase is executed by the `/tasks` command, NOT by `/plan`

## Phase 3+: Future Implementation
*These phases are beyond the scope of the /plan command*

**Phase 3**: Task execution (/tasks command creates tasks.md)  
**Phase 4**: Implementation (execute tasks.md following constitutional principles)  
**Phase 5**: Validation (run tests, execute quickstart.md, performance validation)

## Complexity Tracking
*Justified deviations from Constitution defaults*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Two new RPCs instead of extending `UpdateRitualDefinition` | `GetScheduleChangeImpact` is a read-only preview; mixing with the write operation would force clients to always compute impact even when not needed | Cannot be a single RPC — idempotent GET vs. destructive POST are fundamentally different operations |
| `EnsureTaskResources` called on read path (`GetTask`) | Resources must exist before any user interaction; lazy creation on first access is the spec requirement | Cannot defer to explicit client call — first viewer of task must always see a channel/doc immediately |

## Progress Tracking
*This checklist is updated during execution flow*

**Phase Status**:
- [x] Phase 0: Research complete → research.md
- [x] Phase 1: Design complete → data-model.md, contracts/, quickstart.md
- [x] Phase 1.5: Integration test stubs written → backend/integration/ritual_tasks_improvement_test.go
- [ ] Phase 1.5: Developer review of test stubs — AWAITING REVIEW
- [ ] Phase 2: Tasks generated (/tasks command)
- [ ] Phase 3: Implementation complete
- [ ] Phase 4: Validation passed (go test ./integration/... zero failures)

**Gate Status**:
- [x] Initial Constitution Check: PASS
- [x] Complexity deviations documented (two new RPCs rationale, lazy read-path creation)
- [x] All NEEDS CLARIFICATION resolved (5 questions in spec.md §Clarifications)
- [ ] Post-Design Constitution Check: PENDING developer review of test stubs

---
*Based on Constitution v5.11.0 — See `.specify/memory/constitution.md`*
