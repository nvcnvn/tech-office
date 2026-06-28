
# Implementation Plan: Organization Departments Management

**Branch**: `006-organization-departments-ver` | **Date**: October 27, 2025 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/006-organization-departments-ver/spec.md`

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
Implement hierarchical department management with tree structure for Tech Office platform. Users with ROLE_OWNER or ROLE_OPERATOR can create nested departments (unlimited depth), assign managers, and organize employees. Department managers can add unassigned employees to their own departments, but only administrators can move employees between departments or restructure the hierarchy. The system enforces single-department membership per employee, provides warning indicators for empty departments (no manager/employees), and blocks department deletion until all members are migrated out. The feature extends existing `organization.department` and `organization.department_member` tables with parent-child relationships and cached counts for performance.

**Technical Approach**: Enhance existing database schema with parent-child relationships (`parent_department_id`) and cached member counts. Create new RPC service for department CRUD operations and employee assignment. Implement frontend tree view component in workspace organization tab with drag-and-drop for restructuring. Use TenantPool for all user operations, enforce organization_id isolation, and leverage existing Zitadel RBAC for permission checks.

## Technical Context
**Project Type**: web (frontend + backend monorepo)  
**Frontend Stack**: 
- Language: TypeScript 5.x
- Framework: Next.js 15 (App Router)
- UI Library: Material-UI (MUI) v5
- Package Manager: pnpm workspace
- Testing: React Testing Library (component tests)

**Backend Stack**:
- Language: Go 1.25+
- Database: PostgreSQL 18+ (multi-tenant, schema-per-domain)
- ORM: sqlc (type-safe SQL code generation)
- RPC: Protocol Buffers + ConnectRPC
- Auth: Zitadel integration
- Workflow: https://github.com/nvcnvn/flows
- Testing: Go testing with testify

**Infrastructure**:
- Container: Docker
- Orchestration: Kubernetes (StackGres for PostgreSQL)
- Migration: Atlas
- Deployment: dev/prod overlays

**Performance Goals**: 
- Tree structure rendering <100ms for up to 500 departments
- Department CRUD operations <200ms API response p95
- Support 10k+ employees across 500+ departments per organization

**Constraints**: 
- Multi-tenant isolation via organization_id enforcement
- Single department membership per employee (enforced via unique constraint)
- No depth limit on department hierarchy (client-side performance monitoring needed)
- Manager must be member of department they manage
- Only ROLE_OWNER/ROLE_OPERATOR can delete, rename, or move departments
- Department managers can only add unassigned employees to their own department

**Scale/Scope**: 
- Target: 10k organizations, 100k users total
- Per-tenant scale: Up to 1k employees, 100 departments (typical), 500 departments (maximum monitored)
- No artificial depth limit but monitor UI performance for deep hierarchies (>10 levels)

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Backend Service Architecture Checks
✅ **Service struct includes both connection pools**: DepartmentService will have AdminPool (for system operations like clearing orphaned managers) and TenantPool (for all user-facing department CRUD)
✅ **Pool usage documented**: All methods will document pool choice - TenantPool default for user operations, AdminPool only for background cleanup jobs
✅ **Transaction handling with txn.WithTxn**: Moving departments, assigning managers, and bulk employee migrations will use txn.WithTxn helper
✅ **TenantPool validates organization context**: All department operations will extract organization_id from auth token via interceptor
✅ **AdminPool justification**: Only used for system maintenance (e.g., cascade cleanup when employees deleted)
✅ **organization_id filters**: All department queries will include `WHERE organization_id = $1` parameter
✅ **Method decomposition**: Complex operations (move department subtree, bulk employee migration) will be decomposed into validation, authorization, and business logic methods
✅ **Proto-level access_control**: Simple RBAC checks (ROLE_OWNER, ROLE_OPERATOR) will use proto annotations; manager-specific authorization will be custom logic

### Codegen & Generated-Client Checks
✅ **SQL changes**: Schema modifications to add `parent_department_id`, `member_count`, `manager_count`, `child_count` columns
  - Step: `cd backend && sqlc generate` after schema.sql changes
  - Commit: Generated Go models in `backend/database/models.go` and query implementations

✅ **Proto changes**: New `DepartmentService` with methods for CRUD, employee assignment, tree operations
  - Step: `cd backend && buf generate` after rpc/v1/department.proto creation
  - Commit: Generated `backend/rpc/v1/department.pb.go` and `backend/rpc/v1/rpcv1connect/department.connect.go`

✅ **Frontend package updates**: After proto generation
  - Step: Export new DepartmentService from `frontend/packages/rpc/index.ts`
  - Step: Run `cd frontend && pnpm -r build` to refresh workspace artifacts
  - Step: Create API wrapper in `frontend/packages/apis/src/department.ts` for client usage
  - Apps import from `apis`, NOT from `@tech-office/rpc`

**Initial Gate Status**: ✅ PASS - All constitutional requirements will be followed

### Schema-First & Multi-Tenant Checks
✅ **Schema-first design**: Extending existing `organization.department` and `organization.department_member` tables (already exist in schema.sql lines 70-96)
✅ **organization_id enforcement**: Both tables already have organization_id foreign key to public.organization(id) with ON DELETE CASCADE
✅ **Row-level security**: Both tables already have RLS enabled with org_isolation_policy
✅ **UUID v7 primary keys**: Both tables already use `id UUID PRIMARY KEY DEFAULT uuidv7()`
✅ **Multi-tenant isolation**: All new queries will filter by organization_id parameter

### Post-Verification Testing Checks
✅ **Implementation first**: Core department CRUD and tree operations implemented before tests
✅ **Human verification**: Manual testing of department creation, nesting, employee assignment, manager designation
✅ **Test after verification**: Unit tests for service methods, integration tests for multi-department workflows, contract tests for RPC API
✅ **Test coverage**: Tests will document verified-correct behavior including edge cases (circular reference prevention, empty departments, manager lifecycle)

**No constitutional violations detected** - Proceeding to Phase 0 research.

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

**Backend Structure**:
```
backend/
├── database/
│   ├── scripts/
│   │   ├── schema.sql                    # [MODIFY] Add parent_department_id, cached counts to organization.department
│   │   └── organization.query.sql        # [ADD] sqlc queries for department operations
│   ├── models.go                         # [GENERATED] by sqlc after schema changes
│   └── organization.query.sql.go         # [GENERATED] by sqlc from organization.query.sql
├── internal/
│   └── department/                       # [ADD] New service package
│       ├── department.go                 # Service with AdminPool/TenantPool, CRUD methods
│       └── department_test.go            # Unit tests for service methods
├── rpc/
│   └── v1/
│       ├── department.proto              # [ADD] New RPC service definition
│       ├── department.pb.go              # [GENERATED] from proto
│       └── rpcv1connect/
│           └── department.connect.go     # [GENERATED] ConnectRPC handlers
└── cmd/
    └── server.go                         # [MODIFY] Register DepartmentService with server

Database Schemas Involved: organization (department, department_member tables)
```

**Frontend Structure**:
```
frontend/
├── packages/
│   ├── rpc/
│   │   ├── index.ts                      # [MODIFY] Export DepartmentService client
│   │   └── rpc/v1/                       # [GENERATED] TypeScript proto clients
│   │       └── department_pb.ts
│   └── apis/
│       └── src/
│           └── department.ts             # [ADD] Typed API wrapper for DepartmentService
└── apps/
    └── web/
        └── src/
            └── app/
                └── workspace/
                    └── organization/     # [MODIFY] Existing organization feature
                        ├── page.tsx      # [MODIFY] Add "Departments" tab
                        └── components/   # [ADD] Department-specific components
                            ├── DepartmentsTab.tsx       # Main departments tree view
                            ├── DepartmentTreeView.tsx   # Recursive tree component
                            ├── DepartmentNode.tsx       # Single department with actions
                            ├── CreateDepartmentDialog.tsx
                            ├── EditDepartmentDialog.tsx
                            ├── AssignManagerDialog.tsx
                            ├── AddEmployeeDialog.tsx
                            └── MoveDepartmentDialog.tsx
```

**Key Integration Points**:
- Employee listing (spec 005): Display department membership column, filter by department
- Organization page: Add "Departments" tab to existing sub-navigation
- Auth interceptor: Extracts organization_id from Zitadel token for TenantPool context
- Service struct MUST include two database connection pools:
  * `AdminPool database.AdminDatabaseConnector` - for system-scope operations
  * `TenantPool database.TenantDatabaseConnector` - for tenant-aware operations
- Transaction handling MUST use `txn.WithTxn` helper (not manual Begin/Commit/Rollback)
- Service methods MUST document which pool is used and why
- Complex handlers SHOULD decompose logic into smaller private methods:
  * Simple authorization: use proto-level `access_control` options
  * Complex authorization/validation: break into `validateRequest()`, `checkPermission()`, etc.
  * Business logic: extract into focused private methods with clear names
- See `backend/internal/organization/organization.go` for reference implementation
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
- Follow Tech Office development workflow:

**Backend Tasks** (Department Management):
1. Database schema changes in `backend/database/scripts/schema.sql` [P]
   - Add parent_department_id, member_count, manager_count, child_count columns
   - Add triggers for count maintenance
   - Add indexes for tree traversal
   - Add unique constraint for single department membership
2. Atlas migration generation: `atlas migrate diff add_department_hierarchy` [depends on 1]
3. sqlc query definitions in `backend/database/scripts/organization.query.sql` [P]
   - Append 20+ department management queries
   - Recursive CTE for tree traversal
   - Validation queries (circular reference, manager check)
4. sqlc code generation: `sqlc generate` [depends on 1,3]
5. Protocol Buffer definitions in `backend/rpc/v1/department.proto` [P]
   - DepartmentService with 11 RPC methods
   - Department, DepartmentMember messages
   - RBAC annotations for OWNER/OPERATOR restrictions
6. Protobuf code generation: `buf generate` [depends on 5]
7. Service struct creation in `backend/internal/department/department.go` [depends on 4,6]
   - DepartmentService with AdminPool and TenantPool
   - Queries reference, no external clients needed
8. Implement DepartmentService methods [depends on 7]
   - GetDepartmentTree (read-only, all roles)
   - CreateDepartment (OWNER/OPERATOR only)
   - MoveDepartment with circular reference validation (OWNER/OPERATOR)
   - AssignEmployeeToDepartment with manager permission logic
   - Delete with member/child validation
9. Register DepartmentService in `backend/cmd/server.go` [depends on 8]
10. Unit tests in `backend/internal/department/department_test.go` [depends on 8]
11. Integration tests in `backend/integration/department_test.go` [depends on 8]

**Frontend Tasks** (Department UI):
1. Export DepartmentService from `frontend/packages/rpc/index.ts` [P - after buf generate]
2. Frontend build: `cd frontend && pnpm -r build` [depends on 1]
3. API client wrapper in `frontend/packages/apis/src/department.ts` [depends on 2]
   - Typed wrappers for all DepartmentService methods
   - Error handling and organization context
4. Update Organization page `frontend/apps/web/src/app/workspace/organization/page.tsx` [P]
   - Add "Departments" tab to existing sub-navigation
5. DepartmentsTab component `...organization/components/DepartmentsTab.tsx` [depends on 3,4]
   - Main container, TanStack Query for data fetching
   - Dialog state management
6. DepartmentTreeView component `...components/DepartmentTreeView.tsx` [depends on 5]
   - MUI TreeView wrapper with expand/collapse
7. DepartmentNode component `...components/DepartmentNode.tsx` [depends on 6]
   - Custom tree item with warning indicators, inline actions
8. Dialog components [depends on 5]
   - CreateDepartmentDialog.tsx
   - EditDepartmentDialog.tsx  
   - AssignManagerDialog.tsx
   - AddEmployeeDialog.tsx (manager vs admin variants)
   - MoveDepartmentDialog.tsx (drag-and-drop integration)
9. Component tests for department UI [depends on 5-8]
10. Integration with @dnd-kit for drag-and-drop moves [depends on 6,7]

**Ordering Strategy**:
- Schema and queries MUST be done first (codegen dependencies)
- Backend service implementation before frontend (RPC contract must exist)
- Frontend packages/rpc MUST be updated and built before apps/web
- Component tests added after human verification of tree view behavior
- Mark [P] for parallel execution where no dependencies exist

**Estimated Output**: 35-40 numbered, ordered tasks in tasks.md

## Phase 3+: Future Implementation
*These phases are beyond the scope of the /plan command*

**Phase 3**: Task execution (/tasks command creates tasks.md)  
**Phase 4**: Implementation (execute tasks.md following constitutional principles)  
**Phase 5**: Validation (run tests, execute quickstart.md, performance validation)

## Complexity Tracking
*No constitutional violations detected - section left empty*

No deviations from constitutional principles. All design decisions align with:
- Schema-first multi-tenant architecture
- Post-verification testing approach
- Backend service architecture (AdminPool/TenantPool pattern)
- Codegen workflow (sqlc, buf generate)
- Frontend workspace layout pattern

## Progress Tracking

**Phase Status**:
- [x] Phase 0: Research complete (/plan command) - research.md generated
- [x] Phase 1: Design complete (/plan command) - data-model.md, contracts/, quickstart.md generated
- [x] Phase 2: Task planning complete (/plan command - approach described above)
- [ ] Phase 3: Tasks generated (/tasks command - NOT executed by /plan)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS (no violations)
- [x] Post-Design Constitution Check: PASS (no new violations after Phase 1)
- [x] All NEEDS CLARIFICATION resolved (technical context complete)
- [x] Complexity deviations documented (none - no violations)

**Artifacts Generated**:
- [x] `/specs/006-organization-departments-ver/plan.md` (this file)
- [x] `/specs/006-organization-departments-ver/research.md` (Phase 0)
- [x] `/specs/006-organization-departments-ver/data-model.md` (Phase 1)
- [x] `/specs/006-organization-departments-ver/contracts/department.proto` (Phase 1)
- [x] `/specs/006-organization-departments-ver/contracts/organization.query.sql` (Phase 1)
- [x] `/specs/006-organization-departments-ver/quickstart.md` (Phase 1)
- [x] `.github/copilot-instructions.md` updated (Phase 1)
- [ ] `/specs/006-organization-departments-ver/tasks.md` (Phase 2 - created by /tasks command)

---
*Based on Constitution v3.5.0 - See `.specify/memory/constitution.md`*

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
- [ ] Phase 0: Research complete (/plan command)
- [ ] Phase 1: Design complete (/plan command)
- [ ] Phase 2: Task planning complete (/plan command - describe approach only)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [ ] Initial Constitution Check: PASS
- [ ] Post-Design Constitution Check: PASS
- [ ] All NEEDS CLARIFICATION resolved
- [ ] Complexity deviations documented

---
*Based on Constitution v3.3.0 - See `/memory/constitution.md`*
