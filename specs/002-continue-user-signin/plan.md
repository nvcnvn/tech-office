
# Implementation Plan: Complete User Sign-In Flow with Zitadel Integration

**Branch**: `002-continue-user-signin` | **Date**: October 25, 2025 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/Users/nvcnvn/Codes/tech-office/specs/002-continue-user-signin/spec.md`

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
Complete the Zitadel OIDC authentication integration for the Tech Office platform sign-in flow. The feature implements OAuth 2.0 Authorization Code flow with PKCE, dynamic client ID configuration per organization, token management using localStorage, and a placeholder dashboard. The implementation builds on existing organization subdomain routing and integrates with the @zitadel/react library for authentication state management.

**Primary Requirements**:
- Implement OAuth 2.0 authorization code flow with PKCE
- Dynamic Zitadel client ID configuration based on organization's `application_id`
- OAuth callback handler at `/callback` for token exchange
- Secure token storage in browser localStorage with namespacing
- Automatic session check and redirect for authenticated users
- Inline error handling for organization lookup failures
- Placeholder dashboard page with user info and logout capability

**Technical Approach**:
- Frontend-only implementation using Next.js App Router and @zitadel/react
- No backend changes required (reuses existing `GetOrganizationBySubdomain` RPC)
- Token persistence via localStorage for cross-session continuity
- Immediate redirect pattern for authenticated users (no UI flash)

## Technical Context
**Project Type**: web (frontend + backend monorepo)  
**Frontend Stack**: 
- Language: TypeScript 5.x
- Framework: Next.js 15 (App Router)
- UI Library: Material-UI (MUI) v5
- Auth Library: @zitadel/react (OIDC client)
- Package Manager: pnpm workspace
- Testing: React Testing Library, Vitest

**Backend Stack**:
- Language: Go 1.23+
- Database: PostgreSQL 16+ (multi-tenant, schema-per-domain)
- ORM: sqlc (type-safe SQL code generation)
- RPC: Protocol Buffers + ConnectRPC
- Auth: Zitadel integration
- Workflow: https://github.com/nvcnvn/flows
- Testing: Go testing, testify

**Infrastructure**:
- Container: Docker
- Orchestration: Kubernetes (StackGres for PostgreSQL)
- Migration: Atlas
- Deployment: dev/prod k8s overlays

**Performance Goals**: 
- Token exchange complete within 3 seconds under normal network conditions
- Immediate redirect (<100ms) for already-authenticated users checking localStorage

**Constraints**: 
- Multi-tenant isolation via organization context
- Subdomain routing (e.g., `acme.tech-office.com`)
- Dynamic client ID per organization (no shared client across tenants)
- Frontend-only implementation (no new backend endpoints)
- Token storage limited to localStorage (XSS mitigation via CSP headers)

**Scale/Scope**: 
- Supports 10k+ organizations with unique application IDs
- Concurrent authentication flows across multiple browser tabs
- Frontend-focused scope: 3-4 new pages/components, no database changes

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### I. Schema-First & Multi-Tenant ✅ PASS (N/A)
- **Status**: Not applicable - this is a frontend-only feature
- **Rationale**: No database schema changes required. Feature reuses existing `GetOrganizationBySubdomain` RPC endpoint which already enforces multi-tenant isolation via `organization_id`.

### II. Post-Verification Testing ✅ PASS
- **Status**: Compliant - tests will be added after manual verification
- **Plan**: 
  1. Implement OAuth flow and token management
  2. Manual verification: Test auth flow in browser with real Zitadel instance
  3. Add component tests for sign-in page, callback handler, and dashboard
  4. Add integration tests for complete auth flow scenarios
- **Rationale**: Following constitution requirement that tests document verified-correct behavior

### III. SQL & Data Safety Standards ✅ PASS (N/A)
- **Status**: Not applicable - no SQL changes in this feature
- **Rationale**: Feature is frontend-only, uses existing backend RPC endpoints

### IV. Observability, Simplicity & YAGNI ✅ PASS
- **Status**: Compliant
- **Approach**:
  - Simple localStorage token storage (no over-engineered token refresh queues)
  - Clear error messages for user-facing failures
  - Console logging for auth state transitions (dev mode)
  - No premature optimization of token refresh timing
- **Complexity**: Minimal - using standard @zitadel/react patterns, no custom OAuth implementation

### V. Versioning, Breaking Changes & Review ✅ PASS (N/A)
- **Status**: Not applicable - no breaking changes to public APIs
- **Rationale**: This is a new feature implementation, doesn't modify existing API contracts or database schemas

### Codegen & Generated-Client Checks ✅ PASS (N/A)
- **Status**: Not applicable - no schema or proto changes
- **Rationale**: 
  - No database schema modifications → No `sqlc generate` needed
  - No Protocol Buffer changes → No `buf generate` needed
  - Reuses existing `GetOrganizationBySubdomain` RPC from `frontend/packages/apis`
- **Frontend Build**: Standard `pnpm -r build` in CI (no generated code to export)

## Project Structure

### Documentation (this feature)
```
specs/002-continue-user-signin/
├── plan.md              # This file (/plan command output)
├── research.md          # Phase 0 output (/plan command)
├── data-model.md        # Phase 1 output (/plan command) - N/A for frontend-only
├── quickstart.md        # Phase 1 output (/plan command)
├── contracts/           # Phase 1 output (/plan command)
└── tasks.md             # Phase 2 output (/tasks command - NOT created by /plan)
```

### Source Code (Tech Office Monorepo)

**Backend Structure**: ✅ No changes required
```
backend/
├── database/           # No schema changes
├── internal/
│   └── organization/   # Existing - already provides GetOrganizationBySubdomain
├── rpc/
│   └── v1/
│       └── organization.proto  # Existing - already includes application_id field
```

**Frontend Structure**: 🔨 Files to create/modify
```
frontend/
├── apps/
│   └── web/
│       └── src/
│           ├── app/
│           │   ├── callback/                    # [CREATE] OAuth callback handler
│           │   │   └── page.tsx                 # Handles auth code exchange
│           │   ├── dashboard/                   # [CREATE] Placeholder dashboard
│           │   │   └── page.tsx                 # Post-auth landing page
│           │   └── signin/                      # [MODIFY] Existing sign-in page
│           │       ├── page.tsx                 # Add auth flow integration
│           │       └── components/
│           │           └── LoginForm.tsx        # [MODIFY] Connect to Zitadel
│           └── lib/
│               └── auth/
│                   ├── zitadel.ts               # [MODIFY] Add dynamic client ID
│                   ├── auth-context.tsx         # [CREATE] Auth state management
│                   └── storage.ts               # [CREATE] Token localStorage utils
└── packages/
    └── apis/                                    # [NO CHANGE] Reuse existing
        └── src/
            └── organization.ts                  # Existing getOrganizationBySubdomain

Database Schemas Involved: None (frontend-only feature)
```

**Key Files Summary**:
- **Create**: `/callback/page.tsx`, `/dashboard/page.tsx`, `lib/auth/auth-context.tsx`, `lib/auth/storage.ts`
- **Modify**: `/signin/page.tsx`, `/signin/components/LoginForm.tsx`, `lib/auth/zitadel.ts`
- **Reuse**: `packages/apis/src/organization.ts` (no changes)

**Structure Decision**: Frontend-only implementation following Next.js App Router patterns:
- Auth state managed via React Context (`auth-context.tsx`)
- Token storage utilities isolated in `storage.ts` module
- OAuth callback handling via dedicated `/callback` route
- Zitadel integration through existing `@zitadel/react` library
- No backend changes, no database migrations, no new RPC endpoints

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

3. **API Endpoint Design** (if REST needed):
   - For each user action → endpoint
   - Follow ConnectRPC patterns for RPC
   - Authentication: Bearer token from Zitadel
   - Authorization: Check organization context + RBAC

4. **sqlc Query Design**:
   - SQL queries in `backend/database/scripts/[domain].query.sql`
   - Name queries: `-- name: GetFeatureByID :one`
   - Always include `organization_id` in WHERE clauses for tenant isolation
   - Use prepared statements (`:param` syntax)

5. **Frontend Component Design**:
   - Page components (`page.tsx`) with App Router patterns
   - Reuse existing MUI theme and components
   - Auth context integration (`useAuth()`)
   - Tenant check hooks (`useTenantCheck()`)
   - API client utilities in `packages/apis/`

6. **Generate contract tests** from contracts:
   - Backend: Go unit tests for service methods
   - Backend: Integration tests with test database
   - Frontend: Component tests with React Testing Library
   - E2E: Quickstart test scenarios

7. **Extract test scenarios** from user stories:
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
- Frontend-only implementation (no backend/database tasks)

**Frontend Core Tasks**:
1. Create auth storage utility (`lib/auth/storage.ts`) [P]
2. Create auth error definitions (`lib/auth/errors.ts`) [P]
3. Update Zitadel config for dynamic client ID (`lib/auth/zitadel.ts`) [depends on 1]
4. Create auth context provider (`lib/auth/auth-context.tsx`) [depends on 3]
5. Create auth hooks (`lib/auth/hooks.ts`) [depends on 4]
6. Update root layout with AuthProvider (`app/layout.tsx`) [depends on 4]

**Sign-In Flow Tasks**:
7. Modify sign-in page for auth check (`app/signin/page.tsx`) [depends on 5]
8. Create/update LoginForm component (`app/signin/components/LoginForm.tsx`) [depends on 5]
9. Add organization lookup error handling (inline display) [depends on 7,8]

**Callback Handler Tasks**:
10. Create callback page (`app/callback/page.tsx`) [depends on 4,5]
11. Implement OAuth state validation [depends on 10]
12. Implement token exchange and error handling [depends on 10]

**Dashboard Tasks**:
13. Create placeholder dashboard page (`app/dashboard/page.tsx`) [depends on 5]
14. Implement route protection (redirect if not auth) [depends on 13]
15. Display user info and logout button [depends on 13]

**Testing Tasks** (after manual verification):
16. Component tests for LoginForm [depends on 8, manual verification]
17. Component tests for CallbackPage [depends on 10, manual verification]
18. Component tests for DashboardPage [depends on 13, manual verification]
19. Integration test: Full auth flow [depends on 16,17,18]
20. Integration test: Token refresh [depends on 19]
21. Integration test: Multi-tab sync [depends on 19]

**Documentation Tasks**:
22. Update README with auth setup instructions [P]
23. Document environment variables [P]
24. Add inline code comments for complex auth logic [depends on all implementation]

**Ordering Strategy**:
- Bottom-up: Utilities → Context → Pages → Tests
- Implementation-first: Core auth flow before tests (per constitution)
- Manual verification checkpoint before test creation (task 16 gate)
- Parallel where possible: Tasks marked [P] can run concurrently
- Sequential dependencies: Tests depend on implementation complete + manual verification

**Estimated Output**: 24 numbered, ordered tasks in tasks.md

**No Backend Tasks Required**:
- No database schema changes
- No sqlc generation needed
- No Protocol Buffer changes
- No buf generate needed
- Reuses existing `GetOrganizationBySubdomain` RPC

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
- [x] Phase 0: Research complete (/plan command) - research.md exists and comprehensive
- [x] Phase 1: Design complete (/plan command) - data-model.md, contracts/, quickstart.md created
- [x] Phase 2: Task planning complete (/plan command - approach described above)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS (frontend-only, no schema/proto changes)
- [x] Post-Design Constitution Check: PASS (design confirms frontend-only, no violations)
- [x] All NEEDS CLARIFICATION resolved (5 clarifications documented in spec.md)
- [x] Complexity deviations documented (None - straightforward frontend implementation)

**Artifacts Generated**:
- [x] research.md (Phase 0)
- [x] data-model.md (Phase 1) - Frontend data structures documented
- [x] contracts/typescript-interfaces.md (Phase 1)
- [x] contracts/components.md (Phase 1)
- [x] quickstart.md (Phase 1) - 10 test scenarios
- [x] plan.md (this file) - Complete implementation plan

**Ready for /tasks Command**: ✅ Yes - All prerequisites met

---
*Based on Constitution v3.0.0 - See `/memory/constitution.md`*
