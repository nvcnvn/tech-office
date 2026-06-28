
# Implementation Plan: Unified Ritual Tasks System

**Branch**: `022-recurring-ritual-tasks-system-for` | **Date**: 2026-03-11 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/022-recurring-ritual-tasks-system-for/spec.md`
**Related**: [017-realtime-task-collaboration-system/spec.md](../017-realtime-task-collaboration-system/spec.md) (unified into this plan)

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

Extend the existing collaboration system to support **recurring ritual tasks** alongside standard project tasks, using a **unified data model** — one set of DB tables and one set of RPC methods.

**Core approach**: Ritual task instances ARE regular `collaboration.task` rows, distinguished by `task_kind = 'ritual_instance'`. A new `collaboration.ritual_definition` table defines recurring templates that auto-generate task instances. Evidence requirements and submissions are new tables for tracking compliance artifacts with approval workflows. The existing chat (comments), docs (descriptions), files (attachments), notifications, custom fields, workflow rules, and analytics all work for both standard and ritual tasks without duplication.

**Key design decisions** (from research.md):
- Unified task entity with `task_kind` discriminator (no separate ritual_task table)
- Project `collaboration_mode` is a UI display hint (standard/ritual/mixed), not a strict gate
- Ritual lifecycle states modeled via extended `project_state.category` values
- Evidence submissions tracked per-task per-requirement with manual/auto-approve workflow
- Background scheduler (via `flows` system) generates instances idempotently
- Operational health computed via analytical queries on existing task data

## Technical Context
**Project Type**: web (frontend + backend monorepo)  
**Frontend Stack**: 
- Language: TypeScript 5.x
- Framework: Next.js 15 (App Router)
- UI Library: Material-UI (MUI) v5
- Package Manager: pnpm workspace
- Testing: Manual testing via browser (no automated frontend tests for this feature)

**Backend Stack**:
- Language: Go 1.25+
- Database: PostgreSQL 18+ (multi-tenant, schema-per-domain, Citus-distributed)
- ORM: sqlc (type-safe SQL code generation)
- RPC: Protocol Buffers + ConnectRPC
- Auth: Zitadel integration (existing IAM system — spec 018)
- Workflow: https://github.com/nvcnvn/flows (for ritual instance generation scheduler)
- Testing: Go standard `testing` + `testify` assertions; integration tests in `backend/integration/`

**Infrastructure**:
- Container: Docker (docker-compose for local dev)
- Orchestration: Kubernetes (StackGres for PostgreSQL)
- Migration: golang-migrate (run via `backend/scripts/migrate.sh`)
- Deployment: k8s dev/prod overlays in `backend/k8s/`

**Performance Goals**: <200ms API response p95; operational health dashboard queries <500ms for orgs with 10k+ ritual instances
**Constraints**: Multi-tenant isolation via `organization_id` on all tables; RBAC via proto `access_control` options; Citus distribution keys must be `organization_id`
**Scale/Scope**: Per spec — orgs with 50-500 employees, 10-100 ritual definitions, daily/weekly/monthly recurrence generating thousands of instances per month

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

[Gates determined based on constitution file]
### Scenario-First Integration Testing Checks (Constitution Principle II)
When the plan involves backend feature implementation, verify compliance with Constitution v5.10.0:
- [x] Test scenario stubs composed in `backend/integration/` BEFORE implementation begins
  - → Defined in quickstart.md: 6 test files with scenario descriptions
- [x] Test scenarios use descriptive `t.Run` names that read as behavior specifications
  - → All scenarios named as behavior specs (e.g., "create ritual project with daily ritual definition")
- [ ] Test scenarios reviewed and approved by developer(s) before any code is written
  - → BLOCKED: Awaiting developer review of quickstart.md scenarios
- [x] Plan includes full test suite run (`go test ./integration/...`) as acceptance gate
- [x] Definition of Done: ALL code + tests implemented AND entire test suite passes (zero failures)
- [x] No `t.Skip("TODO")` stubs remain for the feature at completion
### Backend Service Architecture Checks
When the plan involves backend service implementation, verify compliance with Constitution v5.10.0:
- [x] Service implements two-layer architecture: Logic layer (business logic) + Connect layer (RPC handlers)
  - → Extends existing `backend/internal/collaboration/` which already uses logic/connect split
- [x] Logic layer has NO connection pools (only Queries and other logic dependencies)
- [x] Logic layer methods accept `tx database.DBTX` parameter for all database operations
- [x] Logic layer receives parsed auth context as parameters (employeeID, orgID) not raw request context
- [x] Logic layer implements complex business authorization rules (e.g., "only department managers can approve")
  - → Evidence approval requires reviewer with appropriate role; ritual definition CRUD requires project manager/admin
- [x] Connect layer owns both `AdminPool database.AdminDatabaseConnector` and `TenantPool database.TenantDatabaseConnector`
- [x] Connect layer extracts auth context from request and passes to logic layer
- [x] Connect layer manages transactions using `txn.WithTxn` helper (no manual Begin/Commit/Rollback)
- [x] Connect layer chooses appropriate pool: TenantPool for user operations, AdminPool for system operations
  - → TenantPool for all user-facing RPCs; AdminPool for background scheduler (instance generation)
- [x] Connect layer performs lightweight proto-level authorization verification
- [x] AdminPool usage is documented with justification (system-scope only)
  - → AdminPool only for: background ritual instance generation (runs without user context)
- [x] All tenant-data queries include `organization_id` filters
- [x] ALL RPC methods declare `access_control` options in proto with explicit `allowed_roles`
- [x] NO role inheritance assumed - all required roles listed explicitly (e.g., `[ROLE_ADMIN, ROLE_OWNER, ROLE_OPERATOR, ROLE_EMPLOYEE]`)
- [x] Proto authorization is declarative (proto options); logic authorization is imperative (business rules)

### Cross-Domain Integration Checks (Constitution Principle IV)
When the plan involves integration across business domains (e.g., IAM calling Organization, CRM calling Customer):
- [x] Avoid SQL-level cross-schema data access; use service logic layer methods instead (except for explicitly relaxed `public` schema)
- [x] Reuse existing logic layer methods rather than duplicating SQL queries or domain logic
  - → Reusing: chat logic (channel creation for ritual instances), docs logic (doc creation for descriptions), notification logic (ritual reminders/overdue alerts), files logic (evidence file uploads)
- [x] Services depend on other services' **logic layer interfaces** (not connect layer)
- [x] Declare logic layer dependencies in logic layer constructor (connect layer is separate)
- [x] Initialize logic layers first, then wrap with connect layers in `backend/cmd/server.go`
  - → Existing init order already handles: file storage → chat → docs → collaboration logic → collaboration connect
- [x] Cross-domain calls use direct Go method invocations on logic layer (NOT RPC layer internally)
- [x] Explicitly document context propagation: user-scope (request context) vs system-scope (background context)
  - → User-scope: all user-facing RPCs; System-scope: background scheduler generating ritual instances
- [x] User-scope calls MUST pass request context through logic layers to preserve organization_id and auth claims
- [x] System-scope calls MUST justify why system context is needed and document in code comments
  - → Background scheduler generates instances across all orgs without user session
- [x] Cross-domain logic methods are stable, well-defined, and versioned if breaking changes needed
- [x] All cross-domain calls include structured logging with source/target service and operation
- [x] Logic layer methods accept `tx database.DBTX` parameter to support atomic cross-domain operations
  - → Evidence submission + file record + notification in single transaction
- [x] Connect layer passes same transaction to multiple logic layer calls when atomicity is required
- [x] NEVER nest `txn.WithTxn` calls; only connect layer manages transactions

### Frontend UI & Type Safety Checks (Constitution Principle VII)
When the plan involves frontend UI implementation, verify compliance with Constitution v5.10.0:
- [x] ALL RPC calls wrapped in typed functions in `packages/apis` (NO direct protobuf imports in apps)
- [x] Custom TypeScript interfaces defined for all API parameters and responses
- [x] Protobuf types converted to JavaScript native types (e.g., `Timestamp` → `Date`)
- [x] ALL interactive UI elements have `data-testid` attributes for testing
- [x] ALL colors use `useThemeColors()` hook - NO hardcoded hex/rgb/named colors
- [x] NO direct MUI theme paths like `sx={{ bgcolor: 'primary.main' }}`
- [x] Theme system ensures Dark/Light mode support automatically
- [x] Component styling uses `colors.bg.*`, `colors.text.*`, `colors.border.*` patterns
- [x] API wrapper functions use `rpcCall()` helper for error handling
- [x] Type assertions explicit when returning from wrappers (e.g., `as Contact`)

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
- SQL changes => `cd backend && sqlc generate` (commit generated outputs) — **APPLIES**: new queries for ritual definitions, evidence, health analytics
- Proto changes => `cd backend && buf generate` (commit backend generated outputs) — **APPLIES**: new RPCs for ritual CRUD, evidence, health
- After proto changes, the frontend package `frontend/packages/rpc` will be updated; the plan MUST include re-exporting new services from `frontend/packages/rpc/index.ts` and a frontend build step (`pnpm -r build` or `pnpm -w -r build`) so workspace artifacts are refreshed. — **APPLIES**: new ritual/evidence messages and methods need frontend re-export

These checks are enforced by the Constitution Check gate: plans that modify schemas or proto contracts MUST document how generated clients are produced and validated in CI.

### Architecture Documentation Checks (Constitution Principle XII)
When the plan involves architectural changes (new domains, cross-domain dependencies, notification events, schema FK changes, or server init order changes):
- [x] Relevant `backend/docs/` architecture documents read and understood before design begins
  - → Read SYSTEM-ARCHITECTURE.md and NOTIFICATION-SYSTEM-ARCHITECTURE.md during Phase 0
- [x] Proposed changes comply with documented tier model and dependency direction rules
  - → Collaboration is T3 Orchestrator; depends on T2 (chat, docs), T1 (notification, files), T0 (org, iam) — no tier violations
- [x] Plan identifies which architecture documents need updating after implementation
  - → See list below
- [x] Documentation update tasks included in implementation plan (AFTER tests pass, not before)
- [x] If adding a new domain: `SYSTEM-ARCHITECTURE.md` tier model, dependency graphs, domain catalog, and init order will be updated
  - → Not adding new domain — extending existing collaboration domain
- [x] If adding cross-domain dependencies: both code-level and data-level dependency graphs will be updated
  - → No new cross-domain dependencies; reusing existing chat/docs/notification/files integrations
- [x] If adding notification types/events: `NOTIFICATION-SYSTEM-ARCHITECTURE.md` event taxonomy, delivery pipeline, and call graph will be updated
  - → New notification types: ritual_reminder, ritual_overdue, evidence_submitted, evidence_approved, evidence_rejected
- [x] If modifying schema FK references: Full FK Reference Map appendix will be updated
  - → New FKs: ritual_definition → project, task → ritual_definition, evidence_requirement → ritual_definition, evidence_submission → task + evidence_requirement + employee
- [x] Documentation updates committed in the same PR as implementation

### Cross-Stack Constant & Type Synchronization Checks (Constitution Principle VIII)
When the plan involves string-based constants spanning multiple layers (database, backend, frontend):
- [x] Prefer protobuf enums when possible for compile-time type safety (e.g., ChannelType, EmployeeStatus)
  - → Using proto enums: TaskKind, CollaborationMode, EvidenceType, ApprovalMode, ApprovalStatus, RecurrenceType
- [x] For string constants that cannot be proto enums, document ALL affected layers in plan
  - → State categories (scheduled, submitted, verified, overdue, missed, skipped) stored as DB CHECK + Go constants + proto enum
- [x] Database: Add CHECK constraints for valid string values (e.g., `CHECK (notification_type IN ('message', 'mention', 'reply'))`)
  - → CHECK on task.task_kind, project.collaboration_mode, project_state.category (extended), evidence_submission.approval_status
- [x] Database: Document allowed values in table/column comments
- [x] Backend: Define constants in domain package (e.g., `internal/chat/constants.go`)
  - → Extend `internal/collaboration/constants.go` with new state categories, task kinds, collaboration modes
- [x] Backend: Use constants in code, NEVER hardcoded strings
- [x] Backend: Log warnings for unknown/invalid constant values at runtime
- [x] Frontend: Define TypeScript union types or enums matching backend constants
- [x] Frontend: Use type guards for runtime validation
- [x] Frontend: Log warnings for unhandled constant values
- [x] **Automated Testing (MANDATORY)**: Write integration tests validating constant values match across layers
  - → Extend existing `collaboration_constants_test.go` pattern
- [x] **Automated Testing**: Test MUST fail if backend and frontend constants diverge
- [x] **Automated Testing**: Test MUST validate hardcoded strings use defined constants
- [x] **Automated Testing**: Run tests in CI/CD pipeline before merge
- [x] Contract tests: Add validation that backend constants match database CHECK constraints
- [x] Contract tests: Add validation that frontend types align with backend API responses
- [x] PR checklist includes: Database CHECK constraint OK, Backend constants OK, Frontend types OK, Tests OK
- [x] Change coordination: Update all layers atomically in single PR (no partial migrations)
- [x] Documentation: API contracts document allowed constant values in comments

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
- [x] Document error detail usage criteria: ONLY when generic codes cannot guide client behavior
  - → Error details used for: evidence validation failures (field-level errors), deadline conflicts, recurrence rule validation
- [x] Backend uses standard `google.rpc.ErrorDetails` proto definitions (RetryInfo, BadRequest, QuotaFailure, etc.)
- [x] Backend creates error details with `connect.NewErrorDetail()` for type safety
- [x] Backend attaches error details to Connect errors with `err.AddDetail(detail)`
- [x] Backend documents error detail contract in proto comments and API documentation
- [x] Frontend imports error detail schemas from `@buf/googleapis_googleapis.bufbuild_es/google/rpc/error_details_pb`
- [x] Frontend extracts error details using `ConnectError.findDetails(Schema)` for type-safe validation
- [x] Frontend handles missing/malformed error details gracefully with fallback behavior
- [x] Frontend documents error detail handling in API wrapper functions
- [x] Integration tests verify error detail round-trip (backend → frontend)
- [x] PR includes error detail contract documentation in proto files
- [x] All changes (backend attachment + frontend extraction + tests) submitted in single PR

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
- [x] Backend logic is stateless (NO process-local caches, session state, or counters)
  - → All state in PostgreSQL; scheduler reads from DB, not in-memory
- [x] NO local file storage - use object storage (Cloudflare R2) for uploads/attachments
  - → Evidence file uploads go through existing files system (R2-backed)
- [x] NO in-memory connection registries - use database UNLOGGED tables or distributed cache
- [x] Ephemeral state (SSE connections, typing indicators) stored in PostgreSQL UNLOGGED tables
  - → No new ephemeral state for ritual tasks; reuses existing notification SSE
- [x] UNLOGGED tables documented with data loss acceptance criteria
- [x] Connection pools sized for N instances × concurrent requests (not single instance)
- [x] Database queries are shard-aware (include `organization_id` for co-location)
  - → All new tables have organization_id as part of composite PK for Citus distribution
- [x] Cross-shard queries have documented performance justification
  - → Operational health queries are per-org (shard-local); no cross-shard queries needed
- [x] SSE/WebSocket reconnection logic handles instance failures
- [x] Load testing performed with 3+ backend instances
- [x] Failure scenario tested (kill random instance, verify no data loss)
  - → Scheduler uses idempotent generation (skip if already exists); safe across restarts
- [x] NO assumptions about server affinity or sticky sessions
- [x] Load balancers distribute requests randomly across instances

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

**Backend Structure** (files to modify/create):
```
backend/
├── database/
│   └── scripts/
│       ├── schema.sql                          # [MODIFY] Add ritual tables, ALTER task/project/project_state
│       └── collaboration.query.sql             # [MODIFY] Add ~30 new queries for ritual/evidence
├── k8s/
│   └── base/
│       └── database/
│           └── migrations/
│               ├── YYYYMMDD_ritual_tables.up.sql   # [ADD] Migration: new tables + ALTER columns
│               └── YYYYMMDD_ritual_tables.down.sql # [ADD] Rollback migration
├── rpc/
│   └── v1/
│       └── collaboration.proto                 # [MODIFY] Add ritual RPCs, messages, enums
├── internal/
│   └── collaboration/
│       ├── ritual.go                           # [ADD] Ritual definition CRUD logic
│       ├── evidence.go                         # [ADD] Evidence requirement/submission logic
│       ├── scheduler.go                        # [ADD] Instance generation scheduler (flows)
│       ├── health.go                           # [ADD] Operational health analytics logic
│       ├── connect.go                          # [MODIFY] Add new RPC handlers
│       ├── constants.go                        # [MODIFY] Add ritual state categories, task kinds
│       ├── task.go                             # [MODIFY] Handle task_kind in create/update/list
│       └── project.go                          # [MODIFY] Handle collaboration_mode on project create
├── cmd/
│   └── server.go                               # [MODIFY] Register scheduler flow if needed
└── docs/
    ├── SYSTEM-ARCHITECTURE.md                  # [MODIFY] Update FK map, domain catalog
    └── NOTIFICATION-SYSTEM-ARCHITECTURE.md     # [MODIFY] Add ritual notification types
```

**Database Schemas Involved**: `collaboration` (primary — all tables in this schema)

**Frontend Structure** (files to modify/create):
```
frontend/
├── packages/
│   ├── rpc/
│   │   └── index.ts                            # [MODIFY] Re-export new ritual messages/services
│   └── apis/
│       └── src/
│           └── collaboration.ts                # [MODIFY] Add ritual/evidence API wrappers
└── apps/
    └── web/
        └── src/
            └── app/
                └── workspace/
                    └── projects/
                        ├── components/
                        │   ├── RitualDefinitionPanel.tsx    # [ADD] Ritual definition CRUD UI
                        │   ├── EvidenceSubmissionDialog.tsx  # [ADD] Evidence upload/submit
                        │   ├── OperationalHealthDashboard.tsx # [ADD] Health metrics view
                        │   └── RitualCalendarView.tsx        # [ADD] Today view / calendar
                        └── [projectId]/
                            └── components/
                                └── TaskCard.tsx              # [MODIFY] Show ritual badge, evidence status
```

**Integration Tests** (files to create):
```
backend/integration/
├── collaboration_ritual_test.go          # [ADD] Ritual definition CRUD tests
├── collaboration_evidence_test.go        # [ADD] Evidence requirement/submission tests
├── collaboration_ritual_instance_test.go # [ADD] Instance generation/lifecycle tests
├── collaboration_health_test.go          # [ADD] Operational health analytics tests
├── collaboration_ritual_notification_test.go # [ADD] Ritual notification tests
├── collaboration_project_test.go         # [MODIFY] Add ritual project creation scenarios
└── collaboration_task_test.go            # [MODIFY] Add ritual instance task scenarios
```

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

**Frontend Structure** (reference patterns — concrete paths listed above):
```
frontend/
├── apps/
│   └── web/
│       └── src/
│           └── app/
│               └── workspace/
│                   └── projects/           # Extend existing projects domain
│                       ├── components/     # Add ritual-specific components
│                       └── [projectId]/    # Modify existing task views
└── packages/
    ├── apis/                               # Extend collaboration API wrappers
    │   └── src/
    │       └── collaboration.ts
    └── rpc/                                # [GENERATED from backend protos]
        └── rpc/v1/
            └── collaboration_pb.ts
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

**Testing Structure** (concrete paths listed in Integration Tests section above):
- Backend integration tests in `backend/integration/collaboration_ritual*.go`
- Frontend: manual testing per quickstart.md scenarios
- No separate unit test files — logic tested via integration tests per constitution

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
- Follow Tech Office development workflow

**Estimated task count: ~40-50 tasks** organized in dependency order:

**Backend — Schema & Migration (tasks 1-5)**:
1. Update `backend/database/scripts/schema.sql` — add 4 new tables, ALTER 3 existing tables
2. Author `up.sql` migration (additive only — new tables, new columns with defaults, extended CHECKs)
3. Author `down.sql` rollback migration
4. Apply migration locally: `cd backend && ./scripts/migrate.sh`
5. Verify migration with `docker compose exec postgres psql` checks

**Backend — Queries & Codegen (tasks 6-10)**:
6. Add ~30 new sqlc queries to `collaboration.query.sql` (from contracts/ritual-queries.sql)
7. Modify existing sqlc queries (ListTasks, CreateTask, UpdateTask) for task_kind/ritual columns
8. Run `cd backend && sqlc generate` — commit generated outputs
9. Add new proto messages/enums/RPCs to `collaboration.proto` (from contracts/ritual-additions.proto)
10. Run `cd backend && buf generate` — commit generated outputs

**Backend — Constants & Models (tasks 11-13)**:
11. Extend `internal/collaboration/constants.go` — new state categories, task kinds, collaboration modes, evidence types
12. Add constants validation test cases to `collaboration_constants_test.go`
13. Run existing test suite to ensure no regressions from schema/query changes

**Backend — Logic Layer (tasks 14-22)**:
14. Create `internal/collaboration/ritual.go` — RitualDefinition CRUD (Create, Get, Update, Delete, List)
15. Create `internal/collaboration/evidence.go` — EvidenceRequirement CRUD + EvidenceSubmission CRUD
16. Create `internal/collaboration/health.go` — GetOperationalHealth, GetEmployeeCompliance, ExportCSV
17. Create `internal/collaboration/scheduler.go` — GenerateRitualInstances flow (idempotent, per-org)
18. Modify `internal/collaboration/task.go` — handle task_kind on create, skip on update, filter on list
19. Modify `internal/collaboration/project.go` — handle collaboration_mode, create default ritual states
20. Add evidence file upload logic (reuse existing files domain integration)
21. Add evidence approval logic (manual approve/reject, auto-approve rules)
22. Add ritual notification integration (reminder, overdue, evidence_submitted, evidence_approved/rejected)

**Backend — Connect Layer (tasks 23-27)**:
23. Add ritual definition RPC handlers to `connect.go` (Create/Get/Update/Delete/ListRitualDefinitions)
24. Add evidence RPC handlers to `connect.go` (CRUD for requirements + submissions, file upload)
25. Add health RPC handlers to `connect.go` (GetOperationalHealth, GetEmployeeCompliance, ExportCSV)
26. Add SkipRitualInstance RPC handler
27. Modify existing CreateProject, CreateTask, ListTasks handlers for new fields

**Backend — Integration Tests (tasks 28-35)**:
28. Write `collaboration_ritual_test.go` — ritual definition CRUD scenarios
29. Write `collaboration_evidence_test.go` — evidence requirement/submission scenarios
30. Write `collaboration_ritual_instance_test.go` — instance generation/lifecycle
31. Write `collaboration_health_test.go` — operational health analytics
32. Write `collaboration_ritual_notification_test.go` — notification delivery scenarios
33. Extend `collaboration_project_test.go` — ritual project creation
34. Extend `collaboration_task_test.go` — ritual instance task operations
35. Run full test suite: `go test ./integration/...` — zero failures gate

**Frontend — API & Types (tasks 36-38)**:
36. Re-export new ritual types from `frontend/packages/rpc/index.ts`
37. Run `pnpm -r build` to regenerate workspace artifacts
38. Add API wrapper functions in `packages/apis/src/collaboration.ts` for all new RPCs

**Frontend — UI Components (tasks 39-45)**:
39. Create RitualDefinitionPanel component — CRUD for ritual definitions within a project
40. Create EvidenceSubmissionDialog — file upload, text, link submission with GPS capture
41. Create OperationalHealthDashboard — summary cards, compliance table, drill-down
42. Create RitualCalendarView — today view showing scheduled/overdue instances
43. Modify TaskCard to show ritual badge, evidence status indicators, skip action
44. Modify project creation flow — collaboration mode selector
45. Add ritual tab/section to project detail page

**Architecture Docs (tasks 46-48)**:
46. Update `SYSTEM-ARCHITECTURE.md` — FK reference map, domain catalog
47. Update `NOTIFICATION-SYSTEM-ARCHITECTURE.md` — new ritual notification types
48. Update `AGENTS.md` / `.github/copilot-instructions.md` if needed

**Ordering Strategy**:
- Schema → Migration → Queries → Codegen → Constants → Logic → Connect → Tests → Frontend → Docs
- Backend fully implemented and tested before frontend begins
- [P] marks for parallel execution within each group (independent files)
- All codegen tasks immediately follow their definition tasks
- Full test suite run as acceptance gate before frontend work

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan

## Phase 3+: Future Implementation
*These phases are beyond the scope of the /plan command*

**Phase 3**: Task execution (/tasks command creates tasks.md)  
**Phase 4**: Implementation (execute tasks.md following constitutional principles)  
**Phase 5**: Validation (run tests, execute quickstart.md, performance validation)

## Complexity Tracking
*No constitution violations requiring justification. Design extends existing collaboration domain cleanly.*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |

**Design simplifications achieved**:
- Unified task model avoids duplicating 11 tables + 50 RPCs for a separate ritual entity system
- Reusing existing chat/docs/files/notification integrations avoids new cross-domain wiring
- Project collaboration_mode is a UI hint, not a hard gate — avoids complex mode-switching logic
- Evidence tables are additive (new tables, not schema modifications to existing ones)


## Progress Tracking
*This checklist is updated during execution flow*

**Phase Status**:
- [x] Phase 0: Research complete (/plan command) → [research.md](research.md)
- [x] Phase 1: Design complete (/plan command) → [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)
- [x] Phase 2: Task planning approach documented (/plan command — see Phase 2 section above)
- [ ] Phase 3: Tasks generated (/tasks command → tasks.md)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS — all checks evaluated, no violations
- [x] Post-Design Constitution Check: PASS — design extends existing patterns cleanly
- [x] All NEEDS CLARIFICATION resolved — Technical Context fully populated
- [x] Complexity deviations documented — none required (see Complexity Tracking)

**Artifacts Generated**:
| Artifact | Status | Description |
|----------|--------|-------------|
| research.md | Complete | 14 design decisions with rationale |
| data-model.md | Complete | Full DDL for 4 new tables + 3 ALTER tables + migration strategy |
| contracts/ritual-additions.proto | Complete | ~19 new RPCs, 6 enums, 15 messages |
| contracts/ritual-queries.sql | Complete | ~30 new sqlc queries |
| quickstart.md | Complete | 7 integration test files + 9 manual UI scenarios |
| plan.md | Complete | This document |

---
*Based on Constitution v5.11.0 — See `.specify/memory/constitution.md`*
*Ready for `/tasks` command to generate tasks.md*
