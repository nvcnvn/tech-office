
# Implementation Plan: Organization SignUp on Web

**Branch**: `001-organization-signup-on` | **Date**: October 25, 2025 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-organization-signup-on/spec.md`

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
This feature implements a public organization signup flow that allows prospective customers to register their organization and create an admin account. The backend RPC endpoint (`RegisterOrganizationWithAdminPassword`) is already implemented and tested, creating organization records, identity records, organization owner relationships, and integrating with Zitadel for authentication. The primary focus of this implementation is building the frontend signup UI with real-time validation, proper error handling, and a post-registration success flow that redirects users to the signin page after a 3-second countdown.

## Technical Context
**Project Type**: web (frontend + backend monorepo)  
**Frontend Stack**: 
- Language: TypeScript 5.x
- Framework: Next.js 15 (App Router)
- UI Library: Material-UI (MUI) v5
- Package Manager: pnpm workspace
- Testing: Vitest + React Testing Library (following constitution: tests after verification)

**Backend Stack**:
- Language: Go 1.25+
- Database: PostgreSQL 16+ (multi-tenant, schema-per-domain)
- ORM: sqlc (type-safe SQL code generation)
- RPC: Protocol Buffers + ConnectRPC
- Auth: Zitadel integration (already implemented)
- Workflow: https://github.com/nvcnvn/flows
- Testing: Go testing + testify (following constitution: tests after verification)

**Infrastructure**:
- Container: Docker
- Orchestration: Kubernetes (StackGres for PostgreSQL)
- Migration: Atlas (migrations already applied)
- Deployment: dev/prod overlays in k8s/

**Performance Goals**: 
- Signup form submission < 2s (includes DB + Zitadel calls)
- Real-time subdomain validation < 300ms
- Page load < 1s

**Constraints**: 
- Multi-tenant isolation enforced (organization_id in all tenant tables)
- Backend atomic transactions for organization + identity creation
- Zitadel integration required for OIDC authentication
- Password: minimum 16 characters, alphanumeric required
- Subdomain: DNS-compliant, maximum 32 characters, unique
- Email: unique within organization (duplicates allowed across orgs)

**Scale/Scope**: 
- Target: 10k organizations
- Single signup page with 6 input fields
- Backend API already exists and tested
- Frontend-only implementation required

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Schema-First & Multi-Tenant Compliance
- ✅ **Database schema already exists**: `public.organization`, `iam.identity`, `iam.identity_role` tables present
- ✅ **Multi-tenant isolation**: Identity table includes `organization_id` with FK to `public.organization(id)`
- ✅ **UUID v7 primary keys**: Used in identity and identity_role tables (`DEFAULT uuidv7()`)
- ✅ **No schema changes needed**: Backend implementation already complete
- ✅ **sqlc queries exist**: `backend/database/scripts/public.query.sql` and `iam.query.sql` have required queries
- ⚠️ **Note**: This is frontend-only implementation; no database or sqlc changes required

### Post-Verification Testing
- ✅ **Backend already tested**: `RegisterOrganizationWithAdminPassword` integration test exists
- ✅ **Manual verification first**: Frontend components will be manually tested before adding tests
- ⚠️ **Tests added after verification**: Component tests added post-manual confirmation (per constitution v3.1.0)

### SQL & Data Safety
- ✅ **PostgreSQL 18+ compatible**: Existing schema uses compatible types
- ✅ **No new migrations needed**: All database entities already exist
- ✅ **No ad-hoc SQL**: All queries through sqlc-generated code

### Observability & Simplicity
- ✅ **Simple frontend-only feature**: Single signup page with form validation
- ✅ **Backend logging exists**: Structured logging in `RegisterOrganizationWithAdminPassword`
- ✅ **No premature optimization**: Direct form submission to RPC endpoint
- ✅ **Frontend error handling**: User-friendly error messages for all failure cases

### Versioning & Breaking Changes
- ✅ **No API changes**: Using existing `RegisterOrganizationWithAdminPassword` RPC
- ✅ **No proto changes**: Frontend uses existing generated clients
- ✅ **No breaking changes**: Additive frontend route only

### Codegen & Generated-Client Checks
- ✅ **No SQL changes**: No `sqlc generate` needed
- ✅ **No proto changes**: No `buf generate` needed
- ✅ **Existing generated clients**: `frontend/packages/rpc/rpc/v1/organization_pb.ts` already has required types
- ✅ **API wrapper pattern**: Will follow existing pattern in `frontend/packages/apis/src/organization.ts`
- ⚠️ **Frontend build required**: Must run `pnpm -r build` after adding new API wrapper

**GATE STATUS**: ✅ **PASS** - Frontend-only implementation with no schema/contract changes

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

**Backend Structure** (No changes - already implemented):
```
backend/
├── database/
│   ├── scripts/
│   │   ├── schema.sql                    # ✅ EXISTS - organization, identity tables
│   │   ├── public.query.sql              # ✅ EXISTS - organization queries
│   │   └── iam.query.sql                 # ✅ EXISTS - identity queries
│   ├── models.go                         # ✅ GENERATED by sqlc
│   ├── public.query.sql.go               # ✅ GENERATED by sqlc
│   └── iam.query.sql.go                  # ✅ GENERATED by sqlc
├── internal/
│   ├── organization/
│   │   ├── organization.go               # ✅ EXISTS - RegisterOrganizationWithAdminPassword
│   │   └── organization_test.go          # ✅ EXISTS - Integration test
│   └── zitadelcli/
│       └── zitadel.go                    # ✅ EXISTS - Zitadel integration
├── rpc/
│   └── v1/
│       ├── organization.proto            # ✅ EXISTS - RegisterOrganizationWithAdminPassword RPC
│       └── organization.pb.go            # ✅ GENERATED from proto

Database Schemas Used: public (organization), iam (identity, identity_role)
```

**Frontend Structure** (NEW implementation):
```
frontend/
├── apps/
│   └── web/
│       └── src/
│           └── app/
│               ├── signup/                       # 🆕 ADD - New signup route
│               │   ├── page.tsx                  # 🆕 ADD - Main signup page
│               │   └── components/               # 🆕 ADD - Signup components
│               │       ├── SignupForm.tsx        # 🆕 ADD - Main form component
│               │       ├── SignupForm.test.tsx   # 🆕 ADD - Component tests (after verification)
│               │       ├── SuccessMessage.tsx    # 🆕 ADD - Success + countdown component
│               │       └── SuccessMessage.test.tsx # 🆕 ADD - Component tests
│               └── signin/
│                   └── page.tsx                  # ✅ EXISTS - Target for redirect
└── packages/
    ├── apis/                                     # 🔧 MODIFY - Add signup API wrapper
    │   └── src/
    │       └── organization.ts                   # 🔧 MODIFY - Add registerOrganization function
    └── rpc/                                      # ✅ EXISTS - Generated proto clients
        └── rpc/v1/
            └── organization_pb.ts                # ✅ EXISTS - RegisterOrganizationWithAdminPasswordRequest/Response
```

**Testing Structure** (Added after manual verification):
```
frontend/apps/web/src/app/signup/
└── components/
    ├── SignupForm.test.tsx           # Unit tests for form validation, error handling
    └── SuccessMessage.test.tsx       # Unit tests for countdown and redirect
```

**Structure Decision**: Frontend-only implementation leveraging existing backend infrastructure. The signup page will be a new Next.js App Router route (`/signup`) with MUI components following existing patterns from `/signin`. No backend, database, or RPC contract changes required.

## Phase 0: Outline & Research
*Status: ✅ COMPLETE*

### Research Completed

All research has been documented in `research.md`. Key findings:

1. **Backend Verification**: 
   - ✅ `RegisterOrganizationWithAdminPassword` RPC fully implemented and tested
   - ✅ Database schema complete (no changes needed)
   - ✅ Zitadel integration operational
   - ✅ Atomic transaction handling in place

2. **Frontend Patterns**:
   - ✅ Next.js App Router patterns identified (ref: `/signin` page)
   - ✅ MUI component usage documented
   - ✅ Real-time validation pattern from `OrgSelector` component
   - ✅ API wrapper pattern in `packages/apis/src/organization.ts`

3. **Validation Strategy**:
   - ✅ Client-side + backend validation approach defined
   - ✅ Subdomain regex: `/^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/` (max 32 chars)
   - ✅ Password regex: `/^(?=.*[A-Za-z])(?=.*\d).{16,}$/` (≥16 chars, alphanumeric)
   - ✅ Real-time subdomain availability check (debounced 500ms)

4. **Post-Registration Flow**:
   - ✅ Success message with countdown component
   - ✅ 3-second auto-redirect to `/signin`
   - ✅ Manual "sign in now" link to skip countdown

5. **Testing Strategy**:
   - ✅ Manual verification first (Constitution Principle II)
   - ✅ Component tests after verification: `SignupForm.test.tsx`, `SuccessMessage.test.tsx`
   - ✅ Test coverage target: >80%

6. **Performance & Security**:
   - ✅ Performance targets defined (page load <1s, validation <300ms, submission <2s)
   - ✅ No password storage in frontend
   - ✅ HTTPS enforced, CSRF protection via ConnectRPC

**Output**: ✅ `research.md` complete with all decisions documented

**No NEEDS CLARIFICATION items remaining** - Ready for Phase 1

## Phase 1: Design & Contracts
*Status: ✅ COMPLETE*

### Artifacts Generated

All design artifacts have been created in the feature directory:

#### 1. Data Model (`data-model.md`)
✅ **Complete** - Documents existing database schema
- **Entities**: `public.organization`, `iam.identity`, `iam.identity_role`
- **Relationships**: Organization → Identity (via identity_role with 'owner' role)
- **Constraints**: Email unique per org, subdomain globally unique, UUID v7 PKs
- **Transaction Flow**: 3-step atomic transaction with Zitadel integration
- **No Schema Changes**: All entities exist and are production-ready

#### 2. RPC Contracts (`contracts/rpc-contract.md`)
✅ **Complete** - Documents existing RPC endpoints for frontend integration
- **Primary Endpoint**: `RegisterOrganizationWithAdminPassword`
  - Request: 6 fields (company_name, subdomain, admin_email, admin_password, admin_given_name, admin_family_name)
  - Response: Organization object with ID
  - Access: Unauthenticated (public signup)
- **Validation Endpoint**: `CheckOrganizationSubdomainAvailable`
  - Request: subdomain string
  - Response: boolean available flag
  - Access: Unauthenticated (public validation)
- **Generated Clients**: `frontend/packages/rpc/rpc/v1/organization_pb.ts` (already exists)

#### 3. Validation Schemas (`contracts/validation-schemas.md`)
✅ **Complete** - Client-side and backend validation rules
- **Client-Side Rules**: Regex patterns for subdomain/password, field length limits
- **Backend Rules**: Database constraints, uniqueness checks, Zitadel validation
- **Error Mapping**: Field-specific error codes and user-friendly messages
- **Real-Time Validation**: Debounced subdomain availability (500ms)

#### 4. Quickstart Test Scenarios (`quickstart.md`)
✅ **Complete** - Manual test scenarios for verification
- **Happy Path**: Complete signup → success → redirect
- **Validation Errors**: Subdomain taken, invalid email, weak password
- **Edge Cases**: Zitadel unavailable, network errors, duplicate submission
- **Success Flow**: Countdown timer → auto-redirect to signin
- **Manual Testing Checklist**: 15+ test scenarios

### Frontend Component Design

**Page Structure**:
```
/signup
├── page.tsx                    # Main page container
└── components/
    ├── SignupForm.tsx          # Form with validation logic
    ├── SignupForm.test.tsx     # Component tests (post-verification)
    ├── SuccessMessage.tsx      # Success state with countdown
    └── SuccessMessage.test.tsx # Component tests (post-verification)
```

**Component Responsibilities**:

**SignupForm.tsx**:
- 6 input fields with Material-UI TextFields
- Real-time client-side validation
- Debounced subdomain availability check
- Form submission to RPC endpoint via API wrapper
- Error display (field-specific + general)
- Loading state management
- Duplicate submission prevention

**SuccessMessage.tsx**:
- Success confirmation message
- 3-second countdown display
- Auto-redirect to `/signin` via Next.js router
- Manual "sign in now" link
- Organization details display (company name, subdomain)

**page.tsx**:
- Container layout with MUI components
- State management (form/success view toggle)
- Handles successful registration callback
- Responsive design (mobile-first)

### API Wrapper Design

**Location**: `frontend/packages/apis/src/organization.ts`

**New Function** (to be added):
```typescript
export async function registerOrganization(data: {
  companyName: string;
  subdomain: string;
  adminEmail: string;
  adminPassword: string;
  adminGivenName: string;
  adminFamilyName: string;
}): Promise<Organization> {
  return rpcCall(async () => {
    const resp = await organizationClient.registerOrganizationWithAdminPassword({
      companyName: data.companyName,
      subdomain: data.subdomain,
      adminEmail: data.adminEmail,
      adminPassword: data.adminPassword,
      adminGivenName: data.adminGivenName,
      adminFamilyName: data.adminFamilyName,
    });
    
    if (!resp.organization) {
      throw new OrganizationError(
        'REGISTRATION_FAILED',
        'Failed to register organization',
        'general',
        500
      );
    }
    
    return mapOrganization(resp.organization);
  });
}

export async function checkSubdomainAvailability(subdomain: string): Promise<boolean> {
  return rpcCall(async () => {
    const resp = await organizationClient.checkOrganizationSubdomainAvailable({
      subdomain
    });
    return resp.available;
  });
}
```

**Error Handling**:
- Use existing `OrganizationError` class from `packages/apis/src/errors.ts`
- Map RPC errors to field-specific error codes
- Provide user-friendly error messages

### Re-Constitution Check

**Post-Design Review**:
- ✅ No new database schema changes
- ✅ No new RPC contracts (using existing)
- ✅ No breaking changes to existing APIs
- ✅ Frontend-only implementation as planned
- ✅ Follows existing patterns from `/signin` page
- ✅ Tests planned after manual verification (Constitution compliant)

**Gate Status**: ✅ **PASS** - Design maintains constitutional compliance

### Next Steps

Phase 1 complete. Ready to proceed to Phase 2 (Task Planning).

**Outputs**:
- ✅ `data-model.md` - Complete database schema documentation
- ✅ `contracts/rpc-contract.md` - RPC endpoint specifications
- ✅ `contracts/validation-schemas.md` - Validation rules
- ✅ `quickstart.md` - Manual test scenarios
- ⚠️ `.github/copilot-instructions.md` - Update required (see below)

### Agent Context Update

**Action Required**: Update `.github/copilot-instructions.md` with new feature context

Run the following command (as specified in constitution):
```bash
.specify/scripts/bash/update-agent-context.sh copilot
```

This will add the signup feature to the agent's context while preserving manual additions and keeping token usage under 150 lines.
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
- Follow Tech Office development workflow with Constitution v3.1.0 principles

### Frontend-Only Implementation Tasks

Since the backend is complete, tasks focus on frontend implementation:

**API Wrapper Tasks** (in `frontend/packages/apis/`):
1. Add `registerOrganization()` function to `src/organization.ts` [P]
2. Add `checkSubdomainAvailability()` function to `src/organization.ts` [P]
3. Export new functions from `index.ts` [depends on 1,2]
4. Run `pnpm -r build` to update `dst/` artifacts [depends on 3]

**Frontend Component Tasks** (in `frontend/apps/web/src/app/signup/`):
1. Create `page.tsx` - Main signup page container [P]
2. Create `components/SignupForm.tsx` - Form with validation [P]
3. Create `components/SuccessMessage.tsx` - Success + countdown [P]
4. Integrate API wrapper calls in SignupForm [depends on API tasks]
5. Add client-side validation (regex, field rules) [depends on 2]
6. Implement debounced subdomain check [depends on API tasks, 2]
7. Add error handling and display [depends on 2]
8. Implement success flow and redirect [depends on 3]
9. Add loading states and duplicate submission prevention [depends on 2]

**Manual Verification** (Constitution Principle II):
1. Test complete signup flow with valid data
2. Test all validation scenarios (subdomain taken, invalid email, weak password)
3. Test error scenarios (Zitadel unavailable, network errors)
4. Test success flow (countdown, redirect)
5. Test edge cases (duplicate submission, form abandonment)
6. Test accessibility (keyboard navigation, screen reader)
7. Test responsive design (mobile, tablet, desktop)

**Testing Tasks** (AFTER manual verification):
1. Create `components/SignupForm.test.tsx` [depends on manual verification]
2. Create `components/SuccessMessage.test.tsx` [depends on manual verification]
3. Write tests for validation rules [depends on 1]
4. Write tests for subdomain availability check [depends on 1]
5. Write tests for error handling [depends on 1]
6. Write tests for success flow and countdown [depends on 2]
7. Run tests and verify >80% coverage [depends on 1-6]

**Integration Tasks**:
1. Add link to signup page from `/signin` footer [P]
2. Update navigation/routing if needed [P]
3. Test end-to-end flow: signup → redirect → signin [depends on all frontend tasks]

**Ordering Strategy**:
- API wrappers first (required by components)
- Components in parallel (independent)
- Manual verification before tests (Constitution requirement)
- Tests after verified behavior
- Integration last

**Estimated Output**: 25-30 numbered, ordered tasks in tasks.md

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan

## Phase 3+: Future Implementation
*These phases are beyond the scope of the /plan command*

**Phase 3**: Task execution (/tasks command creates tasks.md)  
**Phase 4**: Implementation (execute tasks.md following constitutional principles)  
**Phase 5**: Validation (run tests, execute quickstart.md, performance validation)

## Complexity Tracking

**No Complexity Deviations**: This feature is a straightforward frontend-only implementation with no constitutional violations.

- ✅ No additional projects/microservices
- ✅ No architectural patterns beyond existing
- ✅ No database schema changes
- ✅ No new external dependencies
- ✅ Follows existing patterns from `/signin` page

---

## Progress Tracking

**Phase Status**:
- ✅ **Phase 0: Research complete** (/plan command)
  - All research documented in `research.md`
  - All NEEDS CLARIFICATION items resolved
  - Existing patterns identified and documented
  
- ✅ **Phase 1: Design complete** (/plan command)
  - `data-model.md` - Database schema documented (no changes)
  - `contracts/rpc-contract.md` - RPC endpoints documented
  - `contracts/validation-schemas.md` - Validation rules defined
  - `quickstart.md` - Manual test scenarios defined
  - Component architecture designed
  - API wrapper functions specified
  
- ✅ **Phase 2: Task planning complete** (/plan command - describe approach only)
  - Task generation strategy documented
  - Frontend-only task breakdown defined
  - Ordering and dependencies specified
  - Estimated 25-30 tasks
  
- ⏳ **Phase 3: Tasks generated** (/tasks command - NEXT STEP)
  - `tasks.md` will be created by `/tasks` command
  
- ⏳ **Phase 4: Implementation** (manual execution)
  - Execute tasks from `tasks.md`
  - Follow constitution principles
  - Manual verification before tests
  
- ⏳ **Phase 5: Validation** (manual execution)
  - Run manual tests from `quickstart.md`
  - Execute automated tests
  - Verify acceptance criteria from `spec.md`

**Gate Status**:
- ✅ **Initial Constitution Check: PASS** (no violations)
- ✅ **Post-Design Constitution Check: PASS** (no violations)
- ✅ **All NEEDS CLARIFICATION resolved** (via `/clarify` session)
- ✅ **Complexity deviations documented** (none exist)

---

## Next Steps

**🎯 Current Status**: Phase 2 Complete - Ready for `/tasks` command

**📋 Next Command**: `/tasks` 
- Will generate `tasks.md` from Phase 1 design docs
- Will create 25-30 ordered, numbered tasks
- Will include dependencies and parallel execution markers
- Will follow Constitution v3.1.0 principles

**After `/tasks`**: Begin Phase 4 implementation following `tasks.md`

---
*Based on Constitution v3.1.0 - See `.specify/memory/constitution.md`*
