
# Implementation Plan: Direct SSO IAM Without Zitadel

**Branch**: `018-direct-sso-iam-without-zitadel` | **Date**: 2026-02-10 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/018-direct-sso-iam-without-zitadel/spec.md`

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

**Primary Requirement**: Replace Zitadel authentication with direct SSO integration (Google, Apple) and custom email/password authentication. Implement global user accounts with organization-specific role management, invitation flows, password reset, and profile management.

**Technical Approach**:
1. **Complete Zitadel Removal**: Replace all Zitadel authentication code - no backward compatibility needed (early development)
2. **SSO Token Exchange**: Client obtains SSO tokens (Apple/Google IDToken), exchanges with backend for internal JWT
3. **Internal JWT System**: Use `devjwt` package as foundation for internal token generation/verification
4. **Global User Accounts**: User accounts stored in new `iam.user` schema with `iam.sso_identity` for SSO links
5. **Organization Membership**: Dynamic role resolution via `iam.organization_membership` (many-to-many: user ↔ org)
6. **Password Authentication**: Store hashed passwords in `iam.password_credential`, support bcrypt
7. **Invitation System**: Track pending invitations in `iam.invitation`, auto-create accounts on first login
8. **Auth Middleware**: Replace `backend/internal/interceptor/auth.go` with new internal JWT verification and DB-based role queries
9. **Session Tracking**: Store session metadata in `iam.session` for last login, token issued time, expiration tracking
10. **Clean Migration**: Remove all existing Zitadel user data, fresh start with new IAM system

## Technical Context
**Project Type**: web (frontend + backend monorepo)  
**Frontend Stack**: 
- Language: TypeScript 5.x
- Framework: Next.js 15 (App Router)
- UI Library: Material-UI (MUI) v5
- Package Manager: pnpm workspace
- Testing: Vitest, React Testing Library

**Backend Stack**:
- Language: Go 1.25+
- Database: PostgreSQL 18+ (multi-tenant, schema-per-domain)
- ORM: sqlc (type-safe SQL code generation)
- RPC: Protocol Buffers + ConnectRPC
- Auth: **Replacing Zitadel** with direct SSO (Google/Apple) + custom email/password
- Internal JWT: **`backend/internal/devjwt`** (signer/verifier with RSA keys)
- Password Hashing: bcrypt (Go standard library)
- Workflow: https://github.com/nvcnvn/flows
- Testing: Go testing, testify

**Infrastructure**:
- Container: Docker
- Orchestration: Kubernetes (StackGres for PostgreSQL)
- Migration: golang-migrate (run via `backend/scripts/migrate.sh`)
- Deployment: Multi-instance (3+ backend pods for HA)

**User-Provided Technical Details**:
```
Exchange flow:
1. Client-side SSO flow: Get IDToken from Google/Apple
2. Client calls backend: ExchangeTokenRequest { sso_provider, id_token }
3. Backend verifies IDToken using provider JWKS
4. Backend issues internal JWT with claims: { user_id, email, last_token_issued }
5. Client stores internal JWT, uses for all subsequent requests

Internal JWT claims structure:
{
  "iss": "tech-office",
  "sub": "user-uuid",
  "email": "user@example.com",
  "exp": 1234567890,
  "iat": 1234567890,
  "last_token_issued": 1234567890  // Track for re-auth prompts
}

Role resolution (not in JWT):
- JWT contains user_id only
- Backend middleware queries DB for roles: 
  SELECT role FROM iam.organization_membership 
  WHERE user_id = $1 AND organization_id = $2

This keeps JWT small and allows real-time role updates without token refresh.
```

**Performance Goals**: 
- Login (SSO token exchange): <500ms p95
- Login (email/password): <200ms p95  
- JWT verification: <50ms p95
- JWKS cache refresh: every 1 hour (Google/Apple public keys)
- Session lookup: <100ms p95

**Constraints**: 
- Multi-tenant isolation: NO `organization_id` on `iam.user` (global accounts)
- Role enforcement: Query `iam.organization_membership` for user's roles per org
- Password security: Bcrypt hashing (cost factor 12), min 8 chars, complexity rules
- Token expiration: 30 days inactivity, re-auth required for sensitive operations
- Clean slate: No Zitadel data preservation - fresh start for early development phase
- SSO provider availability: Graceful degradation when Apple/Google JWKS unreachable

**Scale/Scope**: 
- 10,000+ concurrent authenticated sessions
- 100,000+ global user accounts
- Multiple organizations per user (many-to-many)
- 3+ SSO providers (Google, Apple, future: Microsoft)
- Database schemas: `iam` (new), `organization` (extend), `public` (reference)

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Backend Service Architecture Checks
- [x] Service implements two-layer architecture: AuthLogic (business) + AuthServiceConnect (RPC)
- [x] Logic layer has NO connection pools (only Queries)
- [x] Logic layer methods accept `tx database.DBTX` parameter for all database operations
- [x] Logic layer receives parsed auth context as parameters (userID, orgID) not raw request context
- [x] Logic layer implements complex business authorization rules (e.g., "password reset only for email/password accounts")
- [x] Connect layer owns both `AdminPool` and `TenantPool` (TenantPool for user ops, AdminPool for global user lookups)
- [x] Connect layer extracts auth context from request and passes to logic layer
- [x] Connect layer manages transactions using `txn.WithTxn` helper
- [x] Connect layer chooses appropriate pool: TenantPool for org-scoped operations (invitations), AdminPool for global user operations (login, token exchange)
- [x] Connect layer performs lightweight proto-level authorization verification
- [x] AdminPool usage documented: Global user account operations (login, profile, SSO exchange) operate on `iam.user` without `organization_id` context
- [x] All tenant-data queries include `organization_id` filters (e.g., `iam.organization_membership`, `iam.invitation`)
- [x] ALL RPC methods declare `access_control` options in proto with explicit `allowed_roles`
- [x] NO role inheritance assumed - all required roles listed explicitly
- [x] Proto authorization is declarative; logic authorization is imperative (e.g., "user can only reset own password")

### Cross-Domain Integration Checks
- [x] Avoid SQL-level cross-schema access; use service logic layer methods instead
- [ ] **Justification for cross-schema**: `iam.organization_membership` references `public.organization(id)` - foreign key required for data integrity
- [x] Reuse existing logic layer methods: Organization service for membership validation
- [x] Services depend on other services' **logic layer interfaces**
- [x] Declare logic layer dependencies in logic layer constructor
- [x] Initialize logic layers first, then wrap with connect layers in `backend/cmd/server.go`
- [x] Cross-domain calls use direct Go method invocations on logic layer
- [x] Explicitly document context propagation: user-scope (logged-in user profile) vs system-scope (invitation acceptance before login)
- [x] User-scope calls MUST pass request context
- [x] System-scope calls justified: Invitation acceptance happens before authentication (no user context)
- [x] Cross-domain logic methods are stable and well-defined
- [x] All cross-domain calls include structured logging
- [x] Logic layer methods accept `tx database.DBTX` parameter
- [x] Connect layer passes same transaction to multiple logic layer calls when atomicity required (e.g., accept invitation + log session)
- [x] NEVER nest `txn.WithTxn` calls

### Frontend UI & Type Safety Checks
- [x] ALL RPC calls wrapped in typed functions in `packages/apis` (NO direct protobuf imports)
- [x] Custom TypeScript interfaces defined for all API parameters and responses
- [x] Protobuf types converted to JavaScript native types
- [x] ALL interactive UI elements have `data-testid` attributes
- [x] ALL colors use `useThemeColors()` hook - NO hardcoded colors
- [x] NO direct MUI theme paths
- [x] Theme system ensures Dark/Light mode support
- [x] Component styling uses `colors.bg.*`, `colors.text.*`, `colors.border.*` patterns
- [x] API wrapper functions use `rpcCall()` helper for error handling
- [x] Type assertions explicit when returning from wrappers

### Codegen & Generated-Client Checks
- [x] SQL changes => `cd backend && sqlc generate` (commit generated outputs)
- [x] Proto changes => `cd backend && buf generate` (commit backend generated outputs)
- [x] Frontend package `frontend/packages/rpc` updated; plan includes re-exporting new services from `frontend/packages/rpc/index.ts`
- [x] Frontend build step (`pnpm -r build`) included after proto changes

### Cross-Stack Constant & Type Synchronization Checks
- [x] Prefer protobuf enums for SSO provider types: `enum SSOProvider { GOOGLE = 0; APPLE = 1; }`
- [x] For status constants: document ALL affected layers (database CHECK constraints, backend constants, frontend types)
- [x] Database: CHECK constraints for valid string values (e.g., `user_status IN ('active', 'suspended', 'deleted')`)
- [x] Backend: Define constants in domain package (`internal/iam/constants.go`)
- [x] Frontend: Define TypeScript union types matching backend constants
- [x] **Automated Testing (MANDATORY)**: Integration tests validating constant values match across layers
- [x] Contract tests: Validate backend constants match database CHECK constraints
- [x] PR checklist includes: Database CHECK constraint ✅, Backend constants ✅, Frontend types ✅, Tests ✅

### Structured Error Details Checks
- [x] Document error detail usage: BadRequest for validation errors (password requirements, email format)
- [x] Backend uses standard `google.rpc.ErrorDetails` (BadRequest, ResourceInfo)
- [x] Backend creates error details with `connect.NewErrorDetail()` 
- [x] Frontend imports error detail schemas from `@buf/googleapis_googleapis.bufbuild_es/google/rpc/error_details_pb`
- [x] Frontend extracts error details using `ConnectError.findDetails(Schema)`
- [x] Frontend handles missing/malformed error details gracefully
- [x] Integration tests verify error detail round-trip

### Distributed-First Architecture Checks
- [x] Backend logic is stateless (NO process-local caches)
- [x] NO local file storage - use Cloudflare R2 for profile pictures
- [x] NO in-memory connection registries - session tracking in `iam.session` table
- [x] Ephemeral state: Active sessions stored in regular table (not UNLOGGED - sessions must persist across restarts)
- [x] Connection pools sized for N instances × concurrent requests
- [x] Database queries include `organization_id` for org-scoped data (`iam.organization_membership`, `iam.invitation`)
- [x] SSE/WebSocket reconnection logic handles instance failures (N/A - no real-time connections in auth)
- [x] Load testing with 3+ backend instances
- [x] Failure scenario tested: Kill random instance, verify no data loss
- [x] NO assumptions about server affinity or sticky sessions

## Complexity Tracking
*No complexity violations - clean implementation without backward compatibility*

**Simplification Decisions**:
1. **No Zitadel Migration**: Early development phase allows complete replacement without dual-auth support
2. **Clean Auth Middleware**: Rewrite `auth.go` from scratch instead of extending for two systems
3. **Fresh User Data**: No user ID preservation - users will re-register (acceptable for early stage)
4. **Single Token Format**: Only internal JWT, no compatibility layer needed

Rationale: Keeping the codebase clean and maintainable from the start. Avoiding technical debt from supporting legacy systems during early development.

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
│   │   ├── schema.sql                    # [MODIFY] Add iam schema
│   │   └── iam.query.sql                 # [CREATE] sqlc queries for auth
│   ├── models.go                         # [GENERATED by sqlc]
│   └── iam.query.sql.go                   # [GENERATED by sqlc]
├── internal/
│   ├── iam/                               # [CREATE] New auth service package
│   │   ├── logic.go                       # [CREATE] Auth business logic
│   │   ├── connect.go                     # [CREATE] RPC handlers
│   │   ├── constants.go                   # [CREATE] Status/provider constants
│   │   ├── password.go                    # [CREATE] Password hashing utilities
│   │   ├── jwks.go                        # [CREATE] Google/Apple JWKS verifiers
│   │   └── logic_test.go                  # [CREATE] Unit tests
│   ├── devjwt/                            # [MODIFY] Extend for internal JWT
│   │   ├── signer.go                      # [EXISTS] Use for internal token issuance
│   │   └── verifier.go                    # [EXISTS] Use for internal token verification
│   └── interceptor/
│       └── auth.go                        # [REPLACE] Rewrite with internal JWT verification + DB role queries (remove all Zitadel code)
├── rpc/
│   └── v1/
│       ├── iam.proto                      # [CREATE] Auth service RPC definitions
│       └── iam.pb.go                      # [GENERATED from proto]
├── k8s/
│   └── base/
│       ├── database/
│       │   └── migrations/                # [CREATE] golang-migrate scripts
│       │       ├── YYYYMMDDHHMMSS_create_iam_schema.up.sql
│       │       ├── YYYYMMDDHHMMSS_create_iam_schema.down.sql
│       │       ├── YYYYMMDDHHMMSS_create_user_tables.up.sql
│       │       └── YYYYMMDDHHMMSS_create_user_tables.down.sql
│       └── config/
│           └── jwt-keys-secret.yaml        # [CREATE] RSA key pair for internal JWT
└── cmd/
    └── server.go                           # [MODIFY] Initialize auth service, update middleware

Database Schemas Involved: 
- **iam** (NEW): Core authentication/authorization tables
- **organization** (EXTEND): Reference existing org table for memberships
- **public** (REFERENCE): Organization table for foreign keys

```

**Backend Service Structure (per Constitution)**:

**Two-Layer Architecture**:
- **Logic Layer** (`internal/iam/logic.go`):
  * Pure business logic for authentication/authorization
  * NO connection pools (pool-agnostic)
  * Methods accept `tx database.DBTX` parameter
  * Receives parsed auth data (userID, email, orgID) as parameters
  * Returns domain errors (ErrInvalidCredentials, ErrUserNotFound, etc.)
  * Implements `IAMLogic` interface for cross-domain dependencies
  
- **Connect Layer** (`internal/iam/connect.go`):
  * Owns `AdminPool` (global user operations: login, profile, SSO exchange)
  * Owns `TenantPool` (org-scoped operations: invitations, memberships)
  * Depends on `IAMLogic` interface (not concrete implementation)
  * Extracts auth context from request (for authenticated endpoints)
  * Manages transactions with `txn.WithTxn`
  * Translates domain errors to connect.Error with proper codes

**Transaction Management**:
- Connect layer uses `txn.WithTxn` for all write operations
- AdminPool for: Login, SSO token exchange, profile updates, password resets
- TenantPool for: Sending invitations, accepting invitations (org-scoped)
- Read-only operations pass pool directly as DBTX (no transaction overhead)

**Cross-Domain Integration**:
- Depends on Organization service logic layer for validation
- Inject OrganizationLogic at IAMLogic initialization
- Direct Go method calls (NOT RPC internally)
- Share transaction when accepting invitation requires org validation

**Frontend Structure**:
```
frontend/
├── apps/
│   └── web/
│       └── src/
│           ├── app/
│           │   ├── (auth)/                     # [CREATE] Auth group layout (no workspace chrome)
│           │   │   ├── layout.tsx              # [CREATE] Minimal layout for auth pages
│           │   │   ├── login/
│           │   │   │   └── page.tsx            # [CREATE] Login page (SSO + password)
│           │   │   ├── signup/
│           │   │   │   └── page.tsx            # [CREATE] Signup page
│           │   │   ├── forgot-password/
│           │   │   │   └── page.tsx            # [CREATE] Password reset request
│           │   │   ├── reset-password/
│           │   │   │   └── page.tsx            # [CREATE] Password reset completion
│           │   │   └── accept-invitation/
│           │   │       └── page.tsx            # [CREATE] Invitation acceptance
│           │   └── workspace/                  # [MODIFY] Extend workspace features
│           │       ├── layout.tsx              # [MODIFY] Add auth check, org context
│           │       ├── profile/                # [CREATE] User profile management
│           │       │   ├── page.tsx            # Profile overview + tabs
│           │       │   ├── components/
│           │       │   │   ├── ProfileTab.tsx          # [CREATE] Basic info
│           │       │   │   ├── SecurityTab.tsx         # [CREATE] Password, SSO
│           │       │   │   ├── SessionsTab.tsx         # [CREATE] Active sessions
│           │       │   │   ├── OrganizationsTab.tsx    # [CREATE] Org memberships
│           │       │   │   └── ChangePasswordDialog.tsx # [CREATE]
│           │       │   └── README.md
│           │       └── organization/           # [MODIFY] Add invitation management
│           │           ├── page.tsx            # [MODIFY] Add "Members" tab
│           │           └── components/
│           │               ├── MembersTab.tsx          # [CREATE] Org members list
│           │               ├── InvitationsTab.tsx      # [CREATE] Pending invitations
│           │               └── InviteUserDialog.tsx    # [CREATE] Send invitation
│           ├── contexts/
│           │   └── AuthContext.tsx             # [CREATE] Auth state, login/logout
│           └── components/
│               ├── OrganizationSwitcher.tsx    # [CREATE] Multi-org dropdown
│               └── ProtectedRoute.tsx          # [CREATE] Auth guard component
└── packages/
    ├── apis/                                    # [CREATE] API client wrappers
    │   └── src/
    │       └── iam.ts                           # [CREATE] Type-safe IAM API calls
    └── rpc/                                     # [GENERATED from backend protos]
        ├── rpc/v1/
        │   ├── iam_pb.ts                        # [GENERATED] IAM protobuf types
        │   └── iam_connect.ts                   # [GENERATED] IAM ConnectRPC client
        └── index.ts                             # [MODIFY] Re-export IAMService
```

**Frontend Workspace Pattern (Constitution v3.5.0)**:
Authentication pages live OUTSIDE workspace (no shared chrome), while authenticated features extend workspace:
- **Auth pages**: Separate route group `(auth)/` with minimal layout (centered forms, no sidebar/header)
- **Profile management**: New workspace domain `workspace/profile/` with sub-tabs
- **Organization extensions**: Add "Members" and "Invitations" tabs to existing `workspace/organization/`
- **Global components**: `OrganizationSwitcher` in workspace header, `AuthContext` for app-wide state
- **Protected routes**: `ProtectedRoute` wrapper ensures authentication before rendering workspace
- **SSO integration**: Use `@react-oauth/google` and `react-apple-signin-auth` packages
- **Theme compliance**: Use `useThemeColors()` for all auth UI elements (login buttons, forms)
- **UI/UX principles**: Horizontal button groups for SSO providers, data-dense session table

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
| N/A | Clean implementation | Early development phase - no backward compatibility constraints |

**Design Philosophy**:
- **Global user accounts**: Correct pattern for multi-tenant SaaS (not a violation)
- **DB-based role resolution**: Enables real-time permission updates
- **Clean slate migration**: No legacy auth system to support
- **Type-safe contracts**: Proto-based error details provide compile-time validation


## Progress Tracking
*This checklist is updated during execution flow*

**Phase Status**:
- [x] Phase 0: Research complete (/plan command) - [research.md](./research.md)
- [x] Phase 1: Design complete (/plan command) - [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)
- [x] Phase 2: Task planning complete (/plan command - approach documented in plan.md)
- [ ] Phase 3: Tasks generated (/tasks command) - NEXT STEP: Run `/tasks` command
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Deliverables Status**:
- [x] `spec.md` - Feature specification with 47 functional requirements
- [x] `plan.md` - Implementation plan (this document)
- [x] `research.md` - Architectural research with 12 major decisions
- [x] `data-model.md` - Database schema design with 7 tables
- [x] `contracts/iam.proto` - RPC contract with 22 endpoints
- [x] `contracts/README.md` - Contract documentation
- [x] `quickstart.md` - Test scenarios with 6 user stories

**Gate Status**:
- [x] Initial Constitution Check: PASS - All 6 principle categories verified
- [x] Post-Design Constitution Check: PASS - No new violations introduced
- [x] All NEEDS CLARIFICATION resolved - research.md complete
- [x] Complexity deviations documented - Global user accounts justified

**Ready for Next Phase**: Execute `/tasks` command to generate tasks.md from Phase 1 design

---
*Based on Constitution v3.3.0 - See `/memory/constitution.md`*
