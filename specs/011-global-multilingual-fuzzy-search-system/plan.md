# Implementation Plan: Global Multilingual Fuzzy Search System

**Branch**: `011-global-multilingual-fuzzy-search-system` | **Date**: 2025-11-01 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/Users/nvcnvn/Codes/tech-office/specs/011-global-multilingual-fuzzy-search-system/spec.md`

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

**Primary Requirement**: Build a global multilingual search system that enables workspace users to search and autocomplete across all business domains (users, departments, chat channels, messages) from a unified search bar, with support for 9 languages (English, Mandarin Chinese, Spanish, Hindi, German, Japanese, French, Portuguese, Vietnamese).

**Technical Approach** (Updated based on early testing):
- **PostgreSQL Full-Text Search** (FTS) instead of pg_trgm for medium/long content (chat messages)
  - Early testing revealed pg_trgm gives poor results for longer content with high false-negative risk
  - FTS provides better relevance ranking and language-specific text processing
- **Multi-language Strategy**:
  - Store detected language per row (use lingua-go library)
  - Build separate FTS indexes per language for optimal matching
  - Search strategy: Detect input language → fast search on language-specific index → fallback to all indexes if needed
  - Single multi-language index if PostgreSQL supports it (research required)
- **Language-Specific Extensions**:
  - Non-Latin languages (Mandarin Chinese, Japanese, Hindi) require extensions like zhparser
  - Latin-based languages use built-in dictionaries with unaccent support
- **Highlight Matches**: Return highlighted snippets in search results
- **pg_trgm for Short Content**: Still viable for fuzzy matching on short fields (names, emails)

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

**Performance Goals**: 
- Search results within 2 seconds (p95)
- 1000 concurrent users without degradation
- <5% impact on overall system latency
- Deleted entities removed from index within 5 minutes

**Constraints**: 
- Multi-tenant isolation (organization_id filtering)
- Permission-aware search (private channels respect access control)
- No separate search infrastructure (use PostgreSQL native features)
- Support 9 languages: English, Mandarin Chinese, Spanish, Hindi, German, Japanese, French, Portuguese, Vietnamese

**Scale/Scope**: 
- 10,000 users per organization
- 1,000,000 messages per organization
- Multiple searchable domains: Users, Departments, Chat Channels, Chat Messages
- Future extension: Project tickets, documentation

**User-Provided Implementation Details**:
- **Critical Pivot**: Early testing shows pg_trgm performs poorly on medium/long content (chat messages). Longer content = worse matching. Low threshold = high false-negative risk.
- **New Approach**: Use PostgreSQL Full-Text Search (FTS) for chat messages with language-aware processing
- **Language Detection**: Use https://github.com/pemistahl/lingua-go to detect message language on insert, store in `language` column
- **Multi-Language Indexing Strategy**:
  - Build separate FTS indexes per language for best matching quality
  - Search flow: Detect input language → search language-specific index → fallback to all indexes
  - Alternative: Single multi-language index if PostgreSQL supports (requires research)
- **Language-Specific Extensions**:
  - Mandarin Chinese: Install zhparser extension
  - Japanese: Requires tokenization extension
  - Hindi: May require special extension (needs research)
  - Latin-based languages: Use built-in dictionaries + unaccent
- **Highlight Matches**: Search results must return highlighted text snippets
- **Short Content**: pg_trgm still viable for fuzzy matching on user names, emails, department names

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

[Gates determined based on constitution file]

### Backend Service Architecture Checks
When the plan involves backend service implementation, verify compliance with Constitution v5.0.0:
- [x] Service implements two-layer architecture: Logic layer (business logic) + Connect layer (RPC handlers)
  - SearchLogic: Pure search operations with language detection
  - SearchServiceConnect: RPC handlers with pool management
- [x] Logic layer has NO connection pools (only Queries and other logic dependencies)
  - SearchLogic dependencies: Queries, lingua-go detector
- [x] Logic layer methods accept `tx database.DBTX` parameter for all database operations
  - All search queries accept `tx database.DBTX`
- [x] Logic layer receives parsed auth context as parameters (employeeID, orgID) not raw request context
  - Methods receive `orgID dbuuid.UUID, employeeID dbuuid.UUID` from connect layer
- [x] Connect layer owns both `AdminPool database.AdminDatabaseConnector` and `TenantPool database.TenantDatabaseConnector`
  - SearchServiceConnect owns both pools
- [x] Connect layer extracts auth context from request and passes to logic layer
  - Extracts from interceptor-added context
- [x] Connect layer manages transactions using `txn.WithTxn` helper (no manual Begin/Commit/Rollback)
  - Uses TenantPool for all user searches (read-only can skip txn)
- [x] Connect layer chooses appropriate pool: TenantPool for user operations, AdminPool for system operations
  - TenantPool: All user search operations
  - AdminPool: Background indexing jobs (if async indexing implemented)
- [x] AdminPool usage is documented with justification (system-scope only)
  - Only for async background indexing (if implemented)
- [x] All tenant-data queries include `organization_id` filters
  - All search queries filter by organization_id
- [x] Simple authorization uses proto-level `access_control` options where appropriate
  - Search requires authenticated user

### Cross-Domain Integration Checks (Constitution Principle IV)
When the plan involves integration across business domains (e.g., IAM calling Organization, CRM calling Customer):
- [x] Avoid SQL-level cross-schema data access; use service logic layer methods instead (except for explicitly relaxed `public` schema)
  - Search queries will join across schemas: organization.employee, chat.message, chat.channel, organization.department
  - **JUSTIFICATION**: Search is read-only aggregation across domains; creating service method wrappers would add unnecessary complexity without benefit. All queries still enforce organization_id filtering.
  - **ALTERNATIVE CONSIDERED**: Federated search calling multiple service methods - rejected due to performance (multiple queries) and inability to rank results globally
- [x] Reuse existing logic layer methods rather than duplicating SQL queries or domain logic
  - Permission checks reuse chat.ChannelLogic.CheckAccess() for channel visibility
  - Employee data uses organization.EmployeeLogic for active employee filtering
- [x] Services depend on other services' **logic layer interfaces** (not connect layer)
  - SearchLogic depends on chat.ChannelLogic interface and organization.EmployeeLogic interface
- [x] Declare logic layer dependencies in logic layer constructor (connect layer is separate)
  - `NewSearchLogic(queries, channelLogic, employeeLogic, linguaDetector)`
- [x] Initialize logic layers first, then wrap with connect layers in `backend/cmd/server.go`
  - Standard initialization order followed
- [x] Cross-domain calls use direct Go method invocations on logic layer (NOT RPC layer internally)
  - Direct method calls to ChannelLogic.CheckAccess() and EmployeeLogic.GetActive()
- [x] Explicitly document context propagation: user-scope (request context) vs system-scope (background context)
  - All search operations: user-scope (request context)
  - Background indexing (if implemented): system-scope with documented justification
- [x] User-scope calls MUST pass request context through logic layers to preserve organization_id and auth claims
  - All search methods accept and forward ctx with auth context
- [x] System-scope calls MUST justify why system context is needed and document in code comments
  - N/A for initial implementation (all user-scope)
- [x] Cross-domain logic methods are stable, well-defined, and versioned if breaking changes needed
  - Depends only on stable interfaces (CheckAccess, GetActive)
- [x] All cross-domain calls include structured logging with source/target service and operation
  - slog.InfoContext with "source=search", "target=chat/organization", "operation=..."
- [x] Logic layer methods accept `tx database.DBTX` parameter to support atomic cross-domain operations
  - All methods accept tx parameter (read-only operations)
- [x] Connect layer passes same transaction to multiple logic layer calls when atomicity is required
  - N/A (read-only search operations don't require transactions)
- [x] NEVER nest `txn.WithTxn` calls; only connect layer manages transactions
  - Only connect layer uses txn.WithTxn

### Codegen & Generated-Client Checks
When the plan requires DB schema changes or new/updated RPC contracts, include explicit codegen steps in the plan and mark them as prerequisites for implementation:
- SQL changes => `cd backend && sqlc generate` (commit generated outputs)
- Proto changes => `cd backend && buf generate` (commit backend generated outputs)
- After proto changes, the frontend package `frontend/packages/rpc` will be updated; the plan MUST include re-exporting new services from `frontend/packages/rpc/index.ts` and a frontend build step (`pnpm -r build` or `pnpm -w -r build`) so workspace artifacts are refreshed.

These checks are enforced by the Constitution Check gate: plans that modify schemas or proto contracts MUST document how generated clients are produced and validated in CI.

### Cross-Stack Constant & Type Synchronization Checks (Constitution Principle VIII)
When the plan involves string-based constants spanning multiple layers (database, backend, frontend):
- [x] Prefer protobuf enums when possible for compile-time type safety (e.g., ChannelType, EmployeeStatus)
  - **SearchCategory enum**: USER, DEPARTMENT, CHANNEL, MESSAGE (protobuf)
  - **Language codes**: Use protobuf enum for 9 supported languages
- [x] For string constants that cannot be proto enums, document ALL affected layers in plan
  - Language codes stored as strings in DB but mapped to proto enum in API
  - FTS configuration names (english, spanish, etc.) are PostgreSQL-specific
- [x] Database: Add CHECK constraints for valid string values
  - `CHECK (language IN ('en', 'zh', 'es', 'hi', 'de', 'ja', 'fr', 'pt', 'vi', 'unknown'))`
  - `CHECK (entity_type IN ('user', 'department', 'channel', 'message'))`
- [x] Database: Document allowed values in table/column comments
  - COMMENT ON COLUMN with enum values and meanings
- [x] Backend: Define constants in domain package (e.g., `internal/search/constants.go`)
  - Language code constants, entity type constants, FTS config names
- [x] Backend: Use constants in code, NEVER hardcoded strings
  - All enum values referenced via constants
- [x] Backend: Log warnings for unknown/invalid constant values at runtime
  - lingua-go detection returns 'unknown' for undetectable languages
- [x] Frontend: Define TypeScript union types or enums matching backend constants
  - `type SearchCategory = 'USER' | 'DEPARTMENT' | 'CHANNEL' | 'MESSAGE'`
  - `type Language = 'EN' | 'ZH' | 'ES' | 'HI' | 'DE' | 'JA' | 'FR' | 'PT' | 'VI'`
- [x] Frontend: Use type guards for runtime validation
  - Type guards for SearchCategory and Language
- [x] Frontend: Log warnings for unhandled constant values
  - console.warn for unknown categories/languages
- [x] Contract tests: Add validation that backend constants match database CHECK constraints
  - Integration tests verify all enum values work end-to-end
- [x] Contract tests: Add validation that frontend types align with backend API responses
  - TypeScript types auto-generated from protobuf
- [x] PR checklist includes: Database CHECK constraint ✅, Backend constants ✅, Frontend types ✅, Tests ✅
  - Single atomic PR for all layers
- [x] Change coordination: Update all layers atomically in single PR (no partial migrations)
  - All language support added in single PR
- [x] Documentation: API contracts document allowed constant values in comments
  - Proto file comments document all enum values

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
│   ├── schema.sql              # [MODIFY if schema changes needed]
│   ├── scripts/
│   │   ├── schema.sql          # [Atlas will generate migration]
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
| Cross-schema SQL joins for search | Search requires aggregating data from organization.employee, chat.message, chat.channel, organization.department | Creating service methods for each domain would require multiple queries, preventing global relevance ranking and severely impacting performance. Search is read-only and still enforces organization_id filtering. |
| Multi-language support with extensions | 9 languages require: zhparser (Chinese), tokenizers (Japanese, Hindi) | Using pg_trgm alone produced poor results in early testing for longer content. PostgreSQL FTS is native, avoids external systems, and provides better language-aware matching. |


## Progress Tracking
*This checklist is updated during execution flow*

**Phase Status**:
- [x] Phase 0: Research complete (/plan command)
- [ ] Phase 1: Design complete (/plan command)
- [ ] Phase 2: Task planning complete (/plan command - describe approach only)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS
- [ ] Post-Design Constitution Check: PASS
- [x] All NEEDS CLARIFICATION resolved (using user-provided details)
- [x] Complexity deviations documented

---
*Based on Constitution v5.0.0 - See `.specify/memory/constitution.md`*
