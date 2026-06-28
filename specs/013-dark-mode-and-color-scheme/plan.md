
# Implementation Plan: Unified Color Scheme System with Light/Dark Mode

**Branch**: `013-dark-mode-and-color-scheme` | **Date**: 2025-11-09 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/Users/nvcnvn/Codes/tech-office/specs/013-dark-mode-and-color-scheme/spec.md`

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
Implement a unified color scheme system with user-switchable light/dark themes that work consistently across all Tech Office applications. Users can toggle themes via header control or settings page (accessible from avatar menu), with preferences stored server-side for cross-device synchronization. The system will respect OS preference (prefers-color-scheme) only on first visit, then maintain manual user selection. All colors will meet WCAG 2.1 Level AA compliance with smooth 700ms transitions. Theme preference will be stored in `iam.identity` extended attributes (JSONB) for simplicity, avoiding new table creation.

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
- Migration: golang-migrate (run via `backend/scripts/migrate.sh`)
- Deployment: [e.g., dev/prod overlays or NEEDS CLARIFICATION]

**Performance Goals**: 
- Theme toggle perceived as instantaneous (<100ms)
- Theme preference load must not block initial page render
- 700ms smooth CSS transition for color changes

**Constraints**: 
- Multi-tenant isolation (theme preference scoped to organization_id + identity_id)
- WCAG 2.1 Level AA compliance (4.5:1 contrast for normal text, 3:1 for large text)
- Two themes only (light and dark)
- Server-side preference is authoritative for cross-device sync
- Browser storage for immediate availability on reload

**Scale/Scope**: 
- Affects all frontend applications (currently web app, future mobile apps)
- Settings page must be integrated with existing user profile/avatar menu
- Theme preference stored as JSONB extension in existing iam.identity table
- No additional database tables needed

**User Input Context**:
Users should already have some notification settings. The settings page will be accessible by clicking the user avatar (top right) and will provide a centralized interface for all user preferences including theme selection, notification preferences, and other profile settings.

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

[Gates determined based on constitution file]

### Backend Service Architecture Checks
When the plan involves backend service implementation, verify compliance with Constitution v5.0.0:
- [x] Service implements two-layer architecture: Logic layer (business logic) + Connect layer (RPC handlers)
- [x] Logic layer has NO connection pools (only Queries and other logic dependencies)
- [x] Logic layer methods accept `tx database.DBTX` parameter for all database operations
- [x] Logic layer receives parsed auth context as parameters (employeeID, orgID) not raw request context
- [x] Connect layer owns both `AdminPool database.AdminDatabaseConnector` and `TenantPool database.TenantDatabaseConnector`
- [x] Connect layer extracts auth context from request and passes to logic layer
- [x] Connect layer manages transactions using `txn.WithTxn` helper (no manual Begin/Commit/Rollback)
- [x] Connect layer chooses appropriate pool: TenantPool for user operations, AdminPool for system operations
- [x] AdminPool usage is documented with justification (system-scope only)
- [x] All tenant-data queries include `organization_id` filters
- [x] Simple authorization uses proto-level `access_control` options where appropriate

**Note**: New PreferenceService will handle theme preferences. TenantPool for all user operations (no AdminPool needed).

### Cross-Domain Integration Checks (Constitution Principle IV)
When the plan involves integration across business domains (e.g., IAM calling Organization, CRM calling Customer):
- [x] Avoid SQL-level cross-schema data access; use service logic layer methods instead (except for explicitly relaxed `public` schema)
- [x] Reuse existing logic layer methods rather than duplicating SQL queries or domain logic
- [x] Services depend on other services' **logic layer interfaces** (not connect layer)
- [x] Declare logic layer dependencies in logic layer constructor (connect layer is separate)
- [x] Initialize logic layers first, then wrap with connect layers in `backend/cmd/server.go`
- [x] Cross-domain calls use direct Go method invocations on logic layer (NOT RPC layer internally)
- [x] Explicitly document context propagation: user-scope (request context) vs system-scope (background context)
- [x] User-scope calls MUST pass request context through logic layers to preserve organization_id and auth claims
- [x] System-scope calls MUST justify why system context is needed and document in code comments
- [x] Cross-domain logic methods are stable, well-defined, and versioned if breaking changes needed
- [x] All cross-domain calls include structured logging with source/target service and operation
- [x] Logic layer methods accept `tx database.DBTX` parameter to support atomic cross-domain operations
- [x] Connect layer passes same transaction to multiple logic layer calls when atomicity is required
- [x] NEVER nest `txn.WithTxn` calls; only connect layer manages transactions

**Note**: Preference service operates in `iam` schema only. No cross-domain integration needed for theme preferences.

### Codegen & Generated-Client Checks
When the plan requires DB schema changes or new/updated RPC contracts, include explicit codegen steps in the plan and mark them as prerequisites for implementation:
- [x] SQL changes => `cd backend && sqlc generate` (commit generated outputs) - Task 5
- [x] Proto changes => `cd backend && buf generate` (commit backend generated outputs) - Task 7
- [x] After proto changes, frontend package updated; plan includes re-export from `frontend/packages/rpc/index.ts` - Task 16
- [x] Frontend build step (`pnpm -r build`) documented to refresh workspace artifacts - Task 17

**Codegen Tasks Documented**:
- Task 5: sqlc generate (produces Go types from iam.query.sql)
- Task 7: buf generate (produces Go and TypeScript from preference.proto)
- Task 17: pnpm build (updates frontend workspace packages)

### Codegen & Generated-Client Checks
When the plan requires DB schema changes or new/updated RPC contracts, include explicit codegen steps in the plan and mark them as prerequisites for implementation:
- SQL changes => `cd backend && sqlc generate` (commit generated outputs)
- Proto changes => `cd backend && buf generate` (commit backend generated outputs)
- After proto changes, the frontend package `frontend/packages/rpc` will be updated; the plan MUST include re-exporting new services from `frontend/packages/rpc/index.ts` and a frontend build step (`pnpm -r build` or `pnpm -w -r build`) so workspace artifacts are refreshed.

These checks are enforced by the Constitution Check gate: plans that modify schemas or proto contracts MUST document how generated clients are produced and validated in CI.

### Cross-Stack Constant & Type Synchronization Checks (Constitution Principle VIII)
When the plan involves string-based constants spanning multiple layers (database, backend, frontend):
- [x] Prefer protobuf enums when possible for compile-time type safety (e.g., ChannelType, EmployeeStatus)
- [x] For string constants that cannot be proto enums, document ALL affected layers in plan
- [x] Database: Add CHECK constraints for valid string values (e.g., `CHECK (notification_type IN ('message', 'mention', 'reply'))`)
- [x] Database: Document allowed values in table/column comments
- [x] Backend: Define constants in domain package (e.g., `internal/chat/constants.go`)
- [x] Backend: Use constants in code, NEVER hardcoded strings
- [x] Backend: Log warnings for unknown/invalid constant values at runtime
- [x] Frontend: Define TypeScript union types or enums matching backend constants
- [x] Frontend: Use type guards for runtime validation
- [x] Frontend: Log warnings for unhandled constant values
- [x] Contract tests: Add validation that backend constants match database CHECK constraints
- [x] Contract tests: Add validation that frontend types align with backend API responses
- [x] PR checklist includes: Database CHECK constraint ✅, Backend constants ✅, Frontend types ✅, Tests ✅
- [x] Change coordination: Update all layers atomically in single PR (no partial migrations)
- [x] Documentation: API contracts document allowed constant values in comments

**Theme Mode Constants Alignment**:

**Database** (`iam.user_preference`):
```sql
theme_mode TEXT NOT NULL CHECK (theme_mode IN ('light', 'dark'))
preference_source TEXT NOT NULL CHECK (preference_source IN ('manual', 'os_default'))
```

**Backend** (`internal/preference/constants.go`):
```go
const (
    ThemeModeLight = "light"
    ThemeModeDark = "dark"
    
    PreferenceSourceManual = "manual"
    PreferenceSourceOSDefault = "os_default"
)
```

**Proto** (`rpc/v1/preference.proto`):
```proto
enum ThemeMode {
    THEME_MODE_UNSPECIFIED = 0;
    THEME_MODE_LIGHT = 1;
    THEME_MODE_DARK = 2;
}

enum PreferenceSource {
    PREFERENCE_SOURCE_UNSPECIFIED = 0;
    PREFERENCE_SOURCE_MANUAL = 1;
    PREFERENCE_SOURCE_OS_DEFAULT = 2;
}
```

**Frontend** (`packages/apis/src/types.ts`):
```typescript
export type ThemeMode = 'light' | 'dark';
export type PreferenceSource = 'manual' | 'os_default';
```

**Integration Test Coverage**:
- Task 12-14: Backend integration tests validate constants
- Task 34-38: Frontend integration tests verify type alignment
- All tests use proto enums (compile-time safety) and validate string mappings

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
specs/013-dark-mode-and-color-scheme/
├── plan.md                         # This file (/plan command output)
├── research.md                     # Phase 0 output (/plan command)
├── data-model.md                   # Phase 1 output (/plan command)
├── quickstart.md                   # Phase 1 output (/plan command)
├── contracts/                      # Phase 1 output (/plan command)
├── tasks.md                        # Phase 2 output (/tasks command - NOT created by /plan)
├── mobile-theming-guidelines.md    # Mobile implementation guide (already exists)
└── component-migration-guide.md    # [CREATE in Task 43] Phase B component updates
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
│   │   ├── schema.sql          # [MODIFY] Add iam.user_preference table definition
│   │   └── iam.query.sql       # [MODIFY] Add preference queries
│   ├── models.go               # [GENERATED] Will include UserPreference model
│   ├── iam.query.sql.go        # [GENERATED] Preference query methods
│   └── preference.query.sql.go # [GENERATED] If separate file created
├── internal/
│   └── preference/             # [CREATE] New preference service package
│       ├── logic.go            # Logic layer: business logic only
│       ├── connect.go          # Connect layer: RPC handlers with pools
│       ├── constants.go        # Theme mode constants
│       └── preference_test.go  # Unit tests
├── rpc/
│   └── v1/
│       ├── preference.proto    # [EXISTS] Proto contract already created
│       └── preference_pb.go    # [GENERATED from proto]
├── cmd/
│   └── server.go               # [MODIFY] Register PreferenceService
└── k8s/
    └── base/
        └── database/
            └── migrations/
                ├── 20251109120000_add_user_preference_table.up.sql   # [CREATE]
                └── 20251109120000_add_user_preference_table.down.sql # [CREATE]

Database Schemas Involved: iam (new user_preference table)

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
│       ├── tailwind.config.js           # [MODIFY] Add dark mode configuration
│       └── src/
│           ├── app/
│           │   └── workspace/
│           │       ├── layout.tsx            # [MODIFY] Add avatar menu, theme provider, dark mode classes
│           │       └── settings/
│           │           ├── layout.tsx        # [CREATE] Settings sub-navigation
│           │           ├── page.tsx          # [CREATE] Settings overview/redirect
│           │           ├── theme/
│           │           │   └── page.tsx      # [CREATE] Theme settings page
│           │           ├── notifications/    # [EXISTS] Push token settings
│           │           │   └── page.tsx
│           │           └── presence/         # [EXISTS] Presence visibility settings
│           │               └── page.tsx
│           ├── components/
│           │   ├── ThemeToggle.tsx           # [CREATE] Header theme toggle button
│           │   ├── AvatarMenu.tsx            # [CREATE] Avatar dropdown menu
│           │   └── TabLink.tsx               # [MODIFY] Add dark mode variants (Phase A)
│           ├── contexts/
│           │   └── ThemeContext.tsx          # [CREATE] Theme state management
│           └── hooks/
│               └── useTheme.ts               # [CREATE] Theme preference hook
└── packages/
    ├── apis/
    │   └── src/
    │       ├── preference.ts                 # [CREATE] Preference API wrapper
    │       └── index.ts                      # [MODIFY] Export preference functions
    └── rpc/
        └── rpc/v1/
            ├── preference_pb.ts              # [GENERATED from proto]
            └── index.ts                      # [MODIFY] Export preference client
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

**Output**: ✅ research.md completed (8 decisions documented)

## Phase 1: Design & Contracts
*Prerequisites: research.md complete* ✅

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

**Output**: ✅ Phase 1 Complete
- ✅ `data-model.md` - iam.user_preference table with CHECK constraints
- ✅ `/contracts/preference.proto` - PreferenceService RPC contract
- ✅ `quickstart.md` - Test scenarios for theme switching
- ✅ sqlc queries documented in data-model.md

## Phase 2: Task Planning Approach
*This section describes what the /tasks command will do - DO NOT execute during /plan*

**Task Generation Strategy**:
- Load `.specify/templates/tasks-template.md` as base
- Generate tasks from Phase 1 design docs (contracts, data model, quickstart)
- Follow Tech Office development workflow with focus on Constitution compliance

**Backend Task Sequence** (estimated 20 tasks):

**Group 1: Database Foundation** [P = parallel]
1. Update `backend/database/scripts/schema.sql` with `iam.user_preference` table [P]
2. Create golang-migrate up/down scripts in `k8s/base/database/migrations/` [depends on 1]
3. Add sqlc queries to `backend/database/scripts/iam.query.sql` (GetUserPreference, UpsertUserPreference) [P]
4. Apply migration locally: `cd backend && ./scripts/migrate.sh` [depends on 2]
5. Run sqlc codegen: `cd backend && sqlc generate` [depends on 3, 4]

**Group 2: RPC Contract** [P = parallel with Group 1 after task 1]
6. Copy `preference.proto` to `backend/rpc/v1/preference.proto` [P]
7. Run protobuf codegen: `cd backend && buf generate` [depends on 6]

**Group 3: Backend Service Implementation**
8. Create `backend/internal/preference/constants.go` - ThemeMode constants [depends on 5]
9. Create `backend/internal/preference/logic.go` - Logic layer (GetPreference, UpdatePreference methods) [depends on 5, 8]
10. Create `backend/internal/preference/connect.go` - Connect layer with TenantPool [depends on 7, 9]
11. Register PreferenceService in `backend/cmd/server.go` [depends on 10]

**Group 4: Backend Testing**
12. Write integration test for GetPreference in `backend/integration/preference_test.go` [depends on 11]
13. Write integration test for UpdatePreference (theme toggle) [depends on 11]
14. Write integration test for OS default → manual transition [depends on 11]

**Frontend Task Sequence** (estimated 25 tasks):

**Group 5: API Client Layer**
15. Create `frontend/packages/apis/src/preference.ts` - TypeScript API wrappers [depends on 7]
16. Export preference functions from `frontend/packages/apis/src/index.ts` [depends on 15]
17. Rebuild APIs package: `cd frontend && pnpm -r build` [depends on 16]

**Group 6: Theme System Foundation**
18. Create `frontend/apps/web/src/contexts/ThemeContext.tsx` - Global theme state [depends on 17]
19. Create `frontend/apps/web/src/hooks/useTheme.ts` - Theme preference hook [depends on 18]
20. Define theme constants in `frontend/apps/web/src/lib/theme/constants.ts` [P]
21. Create light/dark theme objects in `frontend/apps/web/src/lib/theme/themes.ts` [depends on 20]

**Group 7: Settings Page Infrastructure**
22. Create `frontend/apps/web/src/app/workspace/settings/layout.tsx` - Settings navigation [P]
23. Create `frontend/apps/web/src/app/workspace/settings/page.tsx` - Settings overview [depends on 22]
24. Create `frontend/apps/web/src/app/workspace/settings/theme/page.tsx` - Theme settings [depends on 22, 19]

**Group 8: Header Integration**
25. Create `frontend/apps/web/src/components/AvatarMenu.tsx` - Avatar dropdown [depends on 22]
26. Create `frontend/apps/web/src/components/ThemeToggle.tsx` - Quick theme toggle [depends on 19]
27. Update `workspace/layout.tsx` - Add ThemeContext provider wrapper [depends on 18]
28. Update `workspace/layout.tsx` - Add AvatarMenu to header [depends on 25]
29. Update `workspace/layout.tsx` - Add ThemeToggle to header [depends on 26]

**Group 9: Theme Application**
30. Wrap app with MUI ThemeProvider in layout [depends on 21, 27]
31. Configure Tailwind dark mode in `tailwind.config.js` [P]
32. Add CSS transition rules for smooth theme changes [depends on 30]
33. Implement flash prevention (load theme before render) [depends on 19]
34. Add OS preference detection on first visit [depends on 19]

**Group 10: Critical Component Migration (Phase A)**
35. Update `workspace/layout.tsx` - Add dark mode classes to header, sidebar, tabs [depends on 31, 30]
36. Update `TabLink.tsx` - Add dark mode variants (`dark:bg-gray-700`, `dark:text-gray-100`) [depends on 31]
37. Test dark mode in workspace navigation [depends on 35, 36]

**Group 11: Integration & Polish**
38. Test theme toggle from header → settings sync [depends on 29, 24, 35]
39. Test cross-tab sync (localStorage + server) [depends on 33]
40. Test WCAG contrast ratios with Lighthouse [depends on 32, 35]
41. Verify 700ms transition duration [depends on 32]
42. Test OS preference → manual override flow [depends on 34]
43. Create `component-migration-guide.md` for Phase B components [depends on 36]
44. Update workspace README with theme feature docs [depends on 38]
45. Manual QA: Full theme switching workflow [depends on 42]

**Critical Path**:
```
Schema (1) → Migration (2) → Apply (4) → Codegen (5) → Logic (9) → Connect (10) → 
Register (11) → API Client (15-17) → Theme Context (18-19) → UI Components (24-29) → 
Theme Provider (30) → Tailwind Config (31) → Component Migration (35-36) → Testing (38-45)
```

**Parallel Opportunities**:
- Tasks 1, 3, 6 can run in parallel (different files)
- Tasks 8, 20, 22, 31 can run in parallel (different concerns)
- Frontend tasks 24-26 can be implemented in parallel after prerequisites met
- Tasks 35-36 can be implemented in parallel (different components)

**Component Migration Scope**:
- **Phase A (Feature 013 - Tasks 35-37)**: Critical path components only
  * workspace/layout.tsx - Header, sidebar, tabs with dark mode classes
  * TabLink.tsx - Shared navigation component with dark variants
  * Tailwind dark mode configuration
- **Phase B (Post-Feature 013)**: Progressive enhancement
  * 8 workspace pages (chat, notifications, organization, search, settings)
  * 100+ domain-specific components (chat messages, notification items, org tree)
  * Package utilities (notification color badges)
  * Reference: `component-migration-guide.md` (Task 43)

**Ordering Strategy**:
- Implementation-first: Core functionality before tests
- Constitution compliance: Two-layer service, TenantPool only, transaction patterns
- Backend before Frontend: RPC contracts must exist for TypeScript codegen
- Generated code validation: Run integration tests after codegen to verify contracts
- Settings page follows existing pattern (notifications, presence)
- Component migration: Critical path first (layout + navigation), then progressive enhancement

**Estimated Output**: 45 numbered, ordered tasks in tasks.md (5 additional tasks for component migration)

**Estimated Output**: 30-40 numbered, ordered tasks in tasks.md

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan

## Phase 3+: Future Implementation
*These phases are beyond the scope of the /plan command*

**Phase 3**: Task execution (/tasks command creates tasks.md)  
**Phase 4**: Implementation (execute tasks.md following constitutional principles)  
**Phase 5**: Validation (run tests, execute quickstart.md, performance validation)

## Complexity Tracking
*Fill ONLY if Constitution Check has violations that must be justified*

**No Constitutional Violations**: This feature follows all constitutional principles:
- ✅ Schema-first design with multi-tenant isolation (Principle I)
- ✅ Two-layer service architecture (Principle III)
- ✅ TenantPool only, no AdminPool needed (Principle III)
- ✅ Frontend API wrapper pattern (Principle VII)
- ✅ Cross-stack constant alignment with CHECK constraints (Principle VIII)
- ✅ YAGNI: Simple JSONB extensibility for future preferences (Principle V)

## Progress Tracking
*This checklist is updated during execution flow*

**Phase Status**:
- [x] Phase 0: Research complete (/plan command) - ✅ research.md with 8 decisions
- [x] Phase 1: Design complete (/plan command) - ✅ data-model.md, contracts/preference.proto, quickstart.md
- [x] Phase 2: Task planning complete (/plan command - describe approach only) - ✅ 40 tasks outlined
- [ ] Phase 3: Tasks generated (/tasks command) - **READY FOR EXECUTION**
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS - All backend architecture checks passed
- [x] Post-Design Constitution Check: PASS - No violations, all patterns aligned
- [x] All NEEDS CLARIFICATION resolved - Spec has 8 clarifications documented
- [x] Complexity deviations documented - None required

**Execution Summary**:
1. ✅ Loaded feature spec from `/Users/nvcnvn/Codes/tech-office/specs/013-dark-mode-and-color-scheme/spec.md`
2. ✅ Verified clarifications exist (8 clarifications in spec)
3. ✅ Filled Technical Context with user input about settings page integration
4. ✅ Evaluated Constitution Check - All checks passed
5. ✅ Confirmed Phase 0 research.md exists and complete
6. ✅ Confirmed Phase 1 artifacts exist (data-model.md, contracts/, quickstart.md)
7. ✅ Re-evaluated Constitution Check post-design - No violations
8. ✅ Described Phase 2 task generation approach (40 tasks outlined)
9. ✅ **READY FOR /tasks COMMAND**

---
*Based on Constitution v5.4.1 - See `.specify/memory/constitution.md`*
