
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
[Extract from feature spec: primary requirement + technical approach from research]

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
When the plan involves backend service implementation, verify compliance with Constitution v3.3.0:
- [ ] Service struct includes both `AdminPool database.AdminDatabaseConnector` and `TenantPool database.TenantDatabaseConnector`
- [ ] Each service method documents which pool it uses (AdminPool for system-scope, TenantPool for tenant-aware)
- [ ] All transaction handling uses `txn.WithTxn` helper (no manual Begin/Commit/Rollback)
- [ ] TenantPool methods validate organization context from auth token
- [ ] AdminPool methods document why system scope is required
- [ ] All tenant-data queries include `organization_id` filters
- [ ] Complex handlers decompose logic into smaller private methods (validation, authorization, business logic separated)
- [ ] Simple authorization uses proto-level `access_control` options where appropriate

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
All backend services MUST follow these patterns (per Constitution v3.3.0):
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
│               ├── [feature]/           # [ADD new route/page]
│               │   ├── page.tsx         # Main page component
│               │   ├── layout.tsx       # Feature layout (if needed)
│               │   └── components/      # Feature-specific components
│               │       ├── [Component].tsx
│               │       └── [Component].test.tsx
│               └── components/          # [ADD shared components if needed]
└── packages/
    ├── apis/                            # [ADD API client utilities]
    │   └── src/
    │       └── [feature].ts
    └── rpc/                             # [GENERATED from backend protos]
        └── rpc/v1/
            └── [feature]_pb.ts
```

**Testing Structure**:
```
backend/
└── internal/[feature]/
    ├── [feature]_test.go          # Unit tests
    └── [feature]_integration_test.go  # Integration tests

frontend/apps/web/src/app/
└── [feature]/
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

**Backend Tasks**:
1. Database schema changes in `backend/database/schema.sql` [P]
2. Atlas migration generation: `atlas migrate diff <name>` [depends on 1]
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
