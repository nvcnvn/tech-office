# Implementation Plan: Employee Listing Page

**Branch**: `005-employee-listing-page` | **Date**: 2025-10-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/Users/nvcnvn/Codes/tech-office/specs/005-employee-listing-page/spec.md`

## Execution Flow (/plan command scope)
```
1. Load feature spec from Input path ✅
   → Spec loaded successfully
2. Fill Technical Context ✅
   → No NEEDS CLARIFICATION markers found (all resolved in clarification session)
   → Project Type: web (frontend + backend monorepo)
   → Structure Decision: Full-stack with existing workspace pattern
3. Fill the Constitution Check section ✅
4. Evaluate Constitution Check section
   → No constitutional violations detected
   → Update Progress Tracking: Initial Constitution Check ✅
5. Execute Phase 0 → research.md ✅
   → All unknowns resolved via clarification session
6. Execute Phase 1 → contracts, data-model.md, quickstart.md ✅
7. Re-evaluate Constitution Check section
   → No new violations introduced by design
   → Update Progress Tracking: Post-Design Constitution Check ✅
8. Plan Phase 2 → Describe task generation approach ✅
9. STOP - Ready for /tasks command ✅
```

**IMPORTANT**: The /plan command STOPS at step 9. Phases 2-4 are executed by other commands:
- Phase 2: /tasks command creates tasks.md
- Phase 3-4: Implementation execution (manual or via tools)

## Summary

This feature implements a comprehensive employee listing page for the Organization workspace, enabling all authenticated organization members to view, search, sort, and paginate through employees. The implementation leverages existing database schema (`organization.employee` and `iam.identity` tables), adds a new RPC method to the IAMService for fetching employee lists with role-based field filtering, and enhances the existing `EmployeesTab` component with full data grid functionality.

**Key Technical Approach**:
- **Backend**: Add `ListEmployees` RPC method to IAMService with support for pagination, sorting (hire_date, date_of_birth with UUID v7 secondary sort), exact email search, and role-based field filtering
- **Database**: No schema changes required; use existing tables with new sqlc queries optimized for list view
- **Frontend**: Transform current `EmployeesTab` placeholder into functional data grid using MUI Table components with inline filtering, sorting, and pagination controls
- **Security**: Role-based column visibility (date_of_birth and home_address hidden from ROLE_EMPLOYEE and ROLE_OPERATOR)

## Technical Context
## Technical Context

**Project Type**: web (frontend + backend monorepo)  

**Frontend Stack**: 
- Language: TypeScript 5.x
- Framework: Next.js 15 (App Router)
- UI Library: Material-UI (MUI) v5
- Package Manager: pnpm workspace
- Testing: Vitest + React Testing Library

**Backend Stack**:
- Language: Go 1.25+
- Database: PostgreSQL 18+ (multi-tenant, schema-per-domain)
- ORM: sqlc (type-safe SQL code generation)
- RPC: Protocol Buffers + ConnectRPC
- Auth: Zitadel integration
- Workflow: https://github.com/nvcnvn/flows (not needed for this feature)
- Testing: Go testing + testify

**Infrastructure**:
- Container: Docker
- Orchestration: Kubernetes (StackGres for PostgreSQL)
- Migration: Atlas (for schema changes - none needed here)
- Deployment: dev/prod overlays via k8s

**Performance Goals**: 
- API response time: <200ms p95 for list operations (up to 200 employees)
- Frontend render time: <100ms for table rendering and sorting
- Search latency: <50ms for exact email lookup (uses unique index)

**Constraints**: 
- Multi-tenant isolation: All queries MUST include `organization_id` filter
- Subdomain routing: Tenant context from subdomain (e.g., acme.tech-office.com)
- RBAC enforcement: Role-based column visibility (ROLE_ADMIN/ROLE_OWNER see all fields)
- Maximum organization size: 200 employees (per clarifications)
- UUID v7 secondary sorting: Ensures deterministic ordering for identical dates

**Scale/Scope**: 
- Organizations: ~10k organizations (multi-tenant SaaS)
- Users per org: Maximum 200 employees per organization
- Concurrent users: 100 concurrent users per organization (typical usage)
- Data volume: Lightweight (200 employee records × 10k orgs = 2M records total across all tenants)

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Schema-First & Multi-Tenant Check
- [x] **No schema changes needed** - Leverages existing `organization.employee` and `iam.identity` tables
- [x] **Tenant isolation enforced** - All queries include `organization_id` filter via TenantPool
- [x] **Existing indexes sufficient** - `idx_iam_identity_org_email` for email search
- [x] **UUID v7 primary keys** - Already in place for employee.id (time-sortable)

### Post-Verification Testing Check
- [x] **Implementation-first approach** - Tests added after human verification of core behavior
- [x] **Unit tests planned** - For service methods and React components
- [x] **Integration tests planned** - For end-to-end list, search, sort, paginate flows
- [x] **Contract tests planned** - For RPC ListEmployees endpoint

### Backend Service Architecture Checks
When the plan involves backend service implementation, verify compliance with Constitution v3.3.0:
- [x] Service struct (IAMService) already includes both `AdminPool` and `TenantPool`
- [x] New `ListEmployees` method will use `TenantPool` (tenant-aware operation)
- [x] Transaction handling uses `txn.WithTxn` (not needed for read-only list operation)
- [x] TenantPool method validates organization context from auth token
- [x] All tenant-data queries include `organization_id` filters
- [x] Simple authorization uses proto-level `access_control` (all authenticated users can view)
- [x] Role-based field filtering implemented in service layer (not database)

### Codegen & Generated-Client Checks
- [x] **SQL changes**: New sqlc queries in `iam.query.sql` → `sqlc generate` required
- [x] **Proto changes**: New `ListEmployees` RPC in `iam.proto` → `buf generate` required
- [x] **Frontend RPC package**: `frontend/packages/rpc` exports must be updated
- [x] **Frontend build**: `pnpm -r build` required to propagate types to apps
- [x] **CI validation**: Generated code must be committed in same PR

### Frontend Workspace Pattern Check (Constitution v3.4.0)
- [x] **Uses workspace layout** - Existing `workspace/organization/` structure
- [x] **No duplicate layouts** - Reuses `workspace/layout.tsx`
- [x] **Tab navigation** - Already implemented in `organization/page.tsx`
- [x] **Component structure** - Updates `EmployeesTab.tsx` component
- [x] **Follows reference pattern** - Matches existing `workspace/organization/` implementation

**Constitution Check Result**: ✅ **PASS** - No violations detected. All constitutional principles followed.

## Project Structure

### Documentation (this feature)
```
specs/005-employee-listing-page/
├── spec.md              # Feature specification (completed with clarifications)
├── plan.md              # This file (/plan command output)
├── research.md          # Phase 0 output (created during /plan)
├── data-model.md        # Phase 1 output (created during /plan)
├── quickstart.md        # Phase 1 output (created during /plan)
├── contracts/           # Phase 1 output (created during /plan)
│   ├── rpc-contract.md  # RPC API contract
│   └── list-employees.query.sql  # sqlc query definitions
└── tasks.md             # Phase 2 output (/tasks command - NOT created by /plan)
```

### Source Code (Tech Office Monorepo)

**Backend Structure**:
```
backend/
├── database/
│   ├── scripts/
│   │   ├── iam.query.sql           # [MODIFY] Add ListEmployees query
│   │   └── schema.sql              # [NO CHANGES] Existing schema sufficient
│   ├── iam.query.sql.go            # [GENERATED] sqlc generates from iam.query.sql
│   └── models.go                   # [NO CHANGES] Existing models sufficient
├── internal/
│   └── iam/
│       ├── iam.go                  # [MODIFY] Add ListEmployees RPC method
│       └── iam_test.go             # [ADD] Unit tests for ListEmployees
├── integration/
│   └── employee_listing_test.go    # [ADD] Integration tests for list/search/sort
├── rpc/
│   └── v1/
│       ├── iam.proto               # [MODIFY] Add ListEmployees RPC definition
│       ├── iam.pb.go               # [GENERATED] protoc generates from iam.proto
│       └── rpcv1connect/
│           └── iam.connect.go      # [GENERATED] ConnectRPC server stubs
└── cmd/
    └── server.go                   # [NO CHANGES] IAMService already registered

Database Schemas Involved: 
- iam (iam.identity, iam.identity_role)
- organization (organization.employee)

**Backend Service Structure**:
The IAMService already follows constitutional patterns with AdminPool and TenantPool.
New ListEmployees method will:
- Use TenantPool for tenant-aware queries (default for user-facing operations)
- Validate organization_id from auth context
- No transactions needed (read-only operation)
- Simple authorization via proto access_control (all authenticated users)
- Implement role-based field filtering in service layer (remove sensitive fields for ROLE_EMPLOYEE/ROLE_OPERATOR)
```

**Frontend Structure**:
```
frontend/
├── apps/
│   └── web/
│       └── src/
│           └── app/
│               └── workspace/
│                   ├── layout.tsx                    # [NO CHANGES] Shared layout
│                   └── organization/
│                       ├── page.tsx                  # [NO CHANGES] Already has Employees tab
│                       └── components/
│                           └── EmployeesTab.tsx      # [MODIFY] Transform from placeholder to functional data grid
└── packages/
    ├── apis/                                         # [MODIFY] Add employee API utilities
    │   └── src/
    │       └── employee.ts                          # [ADD] Client wrapper for ListEmployees RPC
    └── rpc/                                         # [GENERATED] From backend protos
        ├── index.ts                                 # [MODIFY] Export ListEmployees types
        └── rpc/v1/
            └── iam_pb.ts                            # [GENERATED] From iam.proto
```

**Frontend Workspace Pattern**:
This feature enhances existing `workspace/organization/` structure:
- ✅ Uses shared `workspace/layout.tsx` (no duplication)
- ✅ Employees tab already exists in `organization/page.tsx`
- ✅ Updates `EmployeesTab.tsx` component from placeholder to functional implementation
- ✅ Follows existing tab navigation pattern with `TabLink` components
- ✅ No new routes needed (operates within existing `/workspace/organization?tab=employees` URL)

**Testing Structure**:
```
backend/
└── internal/iam/
    ├── iam_test.go                          # [ADD] Unit tests for ListEmployees method
    └── integration/
        └── employee_listing_test.go         # [ADD] Integration tests

frontend/apps/web/src/app/workspace/organization/
└── components/
    ├── EmployeesTab.test.tsx                # [ADD] Component tests
    └── __tests__/
        └── EmployeeTable.test.tsx           # [ADD] Table component tests
```

**Structure Decision**: Enhance existing workspace feature rather than create new routes. This leverages the organization/page.tsx infrastructure and maintains consistent UX within the Organization workspace tab navigation.
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

**Frontend Workspace Pattern (Constitution v3.4.0)**:
All business features MUST be implemented under `workspace/[feature-domain]/` and share the workspace layout:
- **Top-level domain tabs**: Add to `workspace/layout.tsx` tabs array for major domains (e.g., Organization, Projects, CRM)
- **Domain page**: Create `workspace/[feature-domain]/page.tsx` with sub-navigation using `TabLink` components
- **Sub-navigation**: Use query params (`?tab=overview`) for feature sections within domain
- **Deep features**: Use nested pages `workspace/[feature-domain]/[sub-feature]/page.tsx` for complex workflows
- **Layout sharing**: DO NOT create duplicate layouts; workspace/layout.tsx provides auth, navigation, sidebar
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

**Status**: ✅ Complete

All technical unknowns were resolved during the clarification session documented in `spec.md`. No additional research required beyond validating existing architecture patterns.

**Key Findings** (documented in `research.md`):
1. ✅ Existing database schema sufficient (no modifications needed)
2. ✅ UUID v7 primary keys enable time-sortable secondary sorting
3. ✅ Unique index on `(organization_id, email)` supports fast exact email search
4. ✅ IAMService structure already has AdminPool/TenantPool for tenant isolation
5. ✅ Frontend workspace pattern established with `organization/` as reference
6. ✅ MUI Table components available for data grid implementation
7. ✅ Role-based filtering implemented in service layer (not database views)
8. ✅ Server-side pagination with OFFSET/LIMIT sufficient for 200 employee maximum

**Decisions Made**:
- Use existing IAMService (no new service needed)
- Add `ListEmployees` RPC method to complement employee import operations
- Transform existing `EmployeesTab.tsx` placeholder into functional component
- Implement role-based field filtering in Go service layer
- Use COALESCE in SQL for NULL date handling (sort NULLs last)

**Output**: `research.md` with comprehensive analysis and existing pattern references

---

## Phase 1: Design & Contracts

**Status**: ✅ Complete

### 1. Database Schema Design → `data-model.md`

**Decision**: No schema changes required. Use existing tables:
- `organization.employee`: Contains all employee fields (hire_date, date_of_birth, is_active, etc.)
- `iam.identity`: Provides email address via foreign key relationship
- Existing indexes sufficient for performance at 200 employee scale

**Key Designs**:
- JOIN strategy: `organization.employee e INNER JOIN iam.identity i ON e.id = i.id`
- NULL handling: `COALESCE(date_field, 'sentinel_date')` to sort NULLs last
- UUID v7 secondary sort: `ORDER BY primary_field, e.id ASC` for deterministic ordering
- Multi-tenant isolation: `WHERE e.organization_id = $1` + RLS policies

**Output**: `data-model.md` with query design and performance analysis

---

### 2. RPC Contract Design → `/contracts/rpc-contract.md`

**Protocol Buffer Definition**:
- Service: `IAMService` (extends existing service)
- Method: `ListEmployees(ListEmployeesRequest) returns (ListEmployeesResponse)`
- Access Control: All authenticated roles (ROLE_ADMIN, ROLE_OWNER, ROLE_OPERATOR, ROLE_EMPLOYEE)
- Messages:
  - `ListEmployeesRequest`: organization_id, email_filter, sort, pagination
  - `ListEmployeesResponse`: employees array, pagination metadata
  - `EmployeeListItem`: Employee record with optional sensitive fields
  - `SortOptions`: sort_by (hire_date | date_of_birth), direction (ASC | DESC)
  - `PaginationOptions`: page_number, page_size (20 | 50 | 100 | 200)

**Role-Based Filtering**:
- ROLE_ADMIN/ROLE_OWNER: Receive all fields including date_of_birth and home_address
- ROLE_EMPLOYEE/ROLE_OPERATOR: Sensitive fields filtered out in service layer

**Output**: `contracts/rpc-contract.md` with complete protobuf definitions and examples

---

### 3. sqlc Query Design → `/contracts/list-employees.query.sql`

**Queries**:
1. `ListEmployees` (`:many`): Paginated, sorted, filtered employee list
2. `CountEmployees` (`:one`): Total count for pagination metadata

**Query Features**:
- Exact email search using `idx_iam_identity_org_email` index
- Dynamic sorting by hire_date or date_of_birth (ASC/DESC)
- UUID v7 secondary sort for tie-breaking
- NULL handling via COALESCE (NULLs sorted to end)
- Multi-tenant isolation via `organization_id` filter

**Generated Go Types** (by sqlc):
- `ListEmployeesParams`: Input parameters
- `ListEmployeesRow`: Query result row
- `Queries.ListEmployees(ctx, db, params) ([]ListEmployeesRow, error)`

**Output**: `contracts/list-employees.query.sql` with complete SQL queries and usage examples

---

### 4. Backend Service Architecture

**Service Implementation** (`backend/internal/iam/iam.go`):
```go
func (s *IAMService) ListEmployees(
    ctx context.Context,
    req *connect.Request[v1.ListEmployeesRequest],
) (*connect.Response[v1.ListEmployeesResponse], error) {
    // 1. Validate request parameters
    // 2. Extract user role from JWT claims
    // 3. Query database using TenantPool (tenant-aware)
    // 4. Filter sensitive fields based on role
    // 5. Build response with pagination metadata
}
```

**Key Patterns**:
- Uses `TenantPool` for tenant-aware database queries
- Transaction not needed (read-only operation)
- Role-based filtering in Go (not SQL)
- Simple authorization via proto `access_control` annotation
- No complex handler decomposition needed (straightforward read operation)

---

### 5. Frontend Component Design

**Component Structure**:
```
workspace/organization/components/
├── EmployeesTab.tsx              # Main container (transform from placeholder)
│   ├── EmployeeTable.tsx         # MUI Table with sorting/pagination
│   ├── EmployeeTableRow.tsx      # Individual row with role-based columns
│   ├── SearchBar.tsx             # Exact email search input
│   └── PaginationControls.tsx    # Page size selector + navigation
```

**State Management**:
- React hooks for local state (page number, page size, sort, search)
- TanStack Query for data fetching and caching
- URL query params for shareable state (e.g., `?tab=employees&page=2`)

**Role-Based Rendering**:
```typescript
const userRole = useAuth().user.role;
const showSensitiveFields = ['ROLE_ADMIN', 'ROLE_OWNER'].includes(userRole);

<TableCell>{showSensitiveFields ? employee.dateOfBirth : null}</TableCell>
```

**MUI Components Used**:
- `Table`, `TableHead`, `TableBody`, `TableRow`, `TableCell`
- `TableSortLabel` for sortable column headers
- `TextField` for search input
- `Select` for page size selector
- `Pagination` for page navigation
- `CircularProgress` for loading state
- `Alert` for error messages

---

### 6. API Client Wrapper

**Package**: `frontend/packages/apis/src/employee.ts`

```typescript
export async function listEmployees(params: {
  organizationId: string;
  emailFilter?: string;
  sortBy?: 'SORT_FIELD_HIRE_DATE' | 'SORT_FIELD_DATE_OF_BIRTH';
  sortDirection?: 'SORT_DIRECTION_ASC' | 'SORT_DIRECTION_DESC';
  pageNumber: number;
  pageSize: 20 | 50 | 100 | 200;
}) {
  return client.listEmployees({
    organizationId: params.organizationId,
    emailFilter: params.emailFilter,
    sort: params.sortBy ? {
      sortBy: params.sortBy,
      direction: params.sortDirection || 'SORT_DIRECTION_ASC',
    } : undefined,
    pagination: {
      pageNumber: params.pageNumber,
      pageSize: params.pageSize,
    },
  });
}
```

**Usage in Component**:
```typescript
const { data, isLoading, error } = useQuery({
  queryKey: ['employees', organizationId, emailFilter, sortBy, pageNumber],
  queryFn: () => listEmployees({ organizationId, pageNumber, pageSize }),
});
```

---

### 7. Quickstart Test Scenarios → `quickstart.md`

**20 Test Scenarios** covering:
- Functional Requirements (FR-001 through FR-013)
- Non-Functional Requirements (NFR-001 through NFR-004)
- Role-Based Access Control (RBAC)
- Edge Cases (NULL handling, pagination boundaries, multi-tenant isolation)
- Performance Validation (200 employee load test)

**Test Data Setup**:
- 15 sample employees with varied hire dates and birth dates
- One inactive employee (Bob Brown) for visual distinction testing
- Two employees with identical hire_date for UUID v7 tie-breaking test
- Employees with NULL dates for NULL handling test

**Automated Tests**:
- Backend integration tests (Go + testify)
- Frontend component tests (TypeScript + React Testing Library)

**Output**: `quickstart.md` with complete test scenarios and automation scripts

---

### 8. Agent Context Update

**Action**: Will be performed by `/tasks` command execution  
**File**: `.github/copilot-instructions.md`  
**Changes**:
- Add ListEmployees RPC method documentation
- Add employee.ts API client patterns
- Add EmployeesTab component architecture
- Update recent changes log

---

## Phase 2: Task Planning Approach
*This section describes what the /tasks command will do - DO NOT execute during /plan*

**Task Generation Strategy**:
The `/tasks` command will load `.specify/templates/tasks-template.md` and generate ordered, dependency-aware implementation tasks from Phase 1 design documents.

### Backend Tasks (Implementation Order)

**Group 1: Code Generation Prerequisites** [Parallel - No Dependencies]
1. **Add sqlc queries to `backend/database/scripts/iam.query.sql`**
   - Add `ListEmployees :many` query with JOIN, sorting, filtering, pagination
   - Add `CountEmployees :one` query for pagination metadata
   - Include NULL handling via COALESCE
   - Include UUID v7 secondary sort

2. **Add protobuf definitions to `backend/rpc/v1/iam.proto`**
   - Add `ListEmployees` RPC method to IAMService
   - Add request/response messages (ListEmployeesRequest, ListEmployeesResponse)
   - Add supporting types (SortOptions, PaginationOptions, EmployeeListItem, PaginationMetadata)
   - Add enums (SortField, SortDirection)
   - Add access_control annotation (all authenticated roles)

**Group 2: Code Generation** [Sequential - Depends on Group 1]
3. **Run `sqlc generate` to generate Go query methods**
   - Generates `backend/database/iam.query.sql.go`
   - Generates `ListEmployeesParams` and `ListEmployeesRow` types
   - Generates `Queries.ListEmployees()` and `Queries.CountEmployees()` methods
   - **Prerequisite**: Task 1 complete

4. **Run `buf generate` to generate protobuf code**
   - Generates `backend/rpc/v1/iam.pb.go` (Go types)
   - Generates `backend/rpc/v1/rpcv1connect/iam.connect.go` (ConnectRPC stubs)
   - Generates `frontend/packages/rpc/rpc/v1/iam_pb.ts` (TypeScript types)
   - **Prerequisite**: Task 2 complete

**Group 3: Backend Service Implementation** [Sequential - Depends on Group 2]
5. **Implement `ListEmployees` method in `backend/internal/iam/iam.go`**
   - Validate request parameters (page_size, page_number, email format)
   - Extract user role from JWT claims
   - Build sqlc query parameters (sort, filter, pagination)
   - Execute `ListEmployees` and `CountEmployees` queries using TenantPool
   - Apply role-based field filtering (remove date_of_birth, home_address for ROLE_EMPLOYEE/ROLE_OPERATOR)
   - Build pagination metadata (total_pages, has_next_page, etc.)
   - Return ListEmployeesResponse
   - **Prerequisite**: Tasks 3, 4 complete
   - **Complexity**: Medium (role-based filtering logic)

**Group 4: Backend Testing** [Parallel - Depends on Group 3]
6. **Write unit tests for `ListEmployees` method**
   - Test role-based field filtering (ROLE_ADMIN sees all, ROLE_EMPLOYEE sees filtered)
   - Test pagination edge cases (empty results, last page, page overflow)
   - Test sorting logic (ASC/DESC, NULL handling)
   - Test email search (exact match, case-insensitive, no results)
   - Test validation errors (invalid page_size, invalid sort_by)
   - **File**: `backend/internal/iam/iam_test.go`
   - **Prerequisite**: Task 5 complete

7. **Write integration tests for employee listing**
   - Test multi-tenant isolation (create 2 orgs, verify no cross-tenant data)
   - Test sort determinism (UUID v7 secondary sort consistency)
   - Test index usage (EXPLAIN ANALYZE confirms index scans)
   - Test end-to-end list/search/sort/paginate flows
   - **File**: `backend/integration/employee_listing_test.go`
   - **Prerequisite**: Task 5 complete

### Frontend Tasks (Implementation Order)

**Group 5: Frontend Package Updates** [Sequential - Depends on Group 2 (buf generate)]
8. **Update `frontend/packages/rpc/index.ts` to export new types**
   - Export `ListEmployeesRequest`, `ListEmployeesResponse`, `EmployeeListItem`
   - Export `SortField`, `SortDirection`, `PaginationOptions`, `PaginationMetadata`
   - **Prerequisite**: Task 4 complete (buf generate creates TypeScript types)

9. **Run `pnpm -r build` in frontend workspace**
   - Builds `frontend/packages/rpc` with new types
   - Propagates types to dependent packages (apis, web)
   - **Prerequisite**: Task 8 complete

10. **Create API client wrapper in `frontend/packages/apis/src/employee.ts`**
    - Implement `listEmployees()` function wrapping IAMService.listEmployees RPC
    - Type-safe parameters with TypeScript interfaces
    - Error handling and retry logic
    - **Prerequisite**: Task 9 complete

**Group 6: Frontend Component Implementation** [Sequential - Depends on Group 5]
11. **Transform `EmployeesTab.tsx` from placeholder to functional component**
    - Replace empty state with data fetching logic
    - Use TanStack Query (`useQuery`) for employee list data
    - Implement state management (page, pageSize, sort, search)
    - Integrate auth context for user role checking
    - Orchestrate child components (table, search, pagination)
    - **File**: `frontend/apps/web/src/app/workspace/organization/components/EmployeesTab.tsx`
    - **Prerequisite**: Task 10 complete
    - **Complexity**: Medium (state orchestration)

12. **Create `EmployeeTable.tsx` MUI table component**
    - Render MUI Table with sortable headers (TableSortLabel)
    - Implement role-based column visibility (conditionally render date_of_birth, home_address)
    - Handle sort direction toggle (ASC → DESC → ASC)
    - Display loading skeleton during data fetch
    - Display empty state when no results
    - Apply grayed-out styling for inactive employees (opacity-50)
    - **File**: `frontend/apps/web/src/app/workspace/organization/components/EmployeeTable.tsx`
    - **Prerequisite**: Task 11 complete

13. **Create `SearchBar.tsx` component for exact email search**
    - MUI TextField with email input validation
    - Debounced search trigger (avoid excessive API calls)
    - Clear search button
    - Display search query in input
    - **File**: `frontend/apps/web/src/app/workspace/organization/components/SearchBar.tsx`
    - **Prerequisite**: Task 11 complete

14. **Create `PaginationControls.tsx` component**
    - MUI Pagination component for page navigation
    - MUI Select for page size selector (20, 50, 100, 200)
    - Display current page info ("Page 1 of 3, Total: 125 employees")
    - Disable next/previous buttons at boundaries
    - **File**: `frontend/apps/web/src/app/workspace/organization/components/PaginationControls.tsx`
    - **Prerequisite**: Task 11 complete

**Group 7: Frontend Testing** [Parallel - Depends on Group 6]
15. **Write component tests for `EmployeesTab`**
    - Test data loading and display
    - Test role-based column visibility (ROLE_EMPLOYEE vs ROLE_ADMIN)
    - Test search functionality
    - Test sorting (column header clicks)
    - Test pagination (page navigation, page size changes)
    - Mock API responses with MSW or similar
    - **File**: `frontend/apps/web/src/app/workspace/organization/components/EmployeesTab.test.tsx`
    - **Prerequisite**: Tasks 11-14 complete

16. **Write component tests for `EmployeeTable`**
    - Test inactive employee styling (grayed out)
    - Test sort direction toggle
    - Test empty state display
    - Test loading skeleton
    - **File**: `frontend/apps/web/src/app/workspace/organization/components/EmployeeTable.test.tsx`
    - **Prerequisite**: Task 12 complete

### Infrastructure & Documentation Tasks

**Group 8: Final Integration** [Sequential - Depends on All Previous]
17. **Manual verification of quickstart scenarios**
    - Execute 20 test scenarios from quickstart.md
    - Validate functional requirements (FR-001 through FR-013)
    - Validate non-functional requirements (NFR-001 through NFR-004)
    - Verify multi-tenant isolation
    - Test with 4 different roles (ADMIN, OWNER, OPERATOR, EMPLOYEE)
    - **Prerequisite**: Tasks 1-16 complete

18. **Performance validation**
    - Load test with 200 employees per organization
    - Measure API response time (target: <200ms p95)
    - Measure frontend render time (target: <100ms)
    - Verify pagination performance across all page sizes
    - **Prerequisite**: Task 17 complete

19. **Update `.github/copilot-instructions.md`**
    - Add ListEmployees RPC documentation
    - Add employee.ts API client patterns
    - Add EmployeesTab component architecture
    - Update recent changes log
    - **Prerequisite**: All implementation complete

20. **Commit all generated code and implementation**
    - Stage generated files (sqlc outputs, buf outputs)
    - Stage implementation files (service, components)
    - Stage test files
    - Write descriptive commit message following conventional commits format
    - **Prerequisite**: Tasks 1-19 complete

---

### Task Ordering Strategy

**Dependency Graph**:
```
[Group 1] → [Group 2] → [Group 3] → [Group 4]
                ↓
         [Group 5] → [Group 6] → [Group 7]
                ↓
         [Group 8]
```

**Parallelization Opportunities**:
- Tasks 1 and 2 can run in parallel (independent file modifications)
- Tasks 6 and 7 can run in parallel (both depend on task 5)
- Tasks 12, 13, 14 can run in parallel (all depend on task 11)
- Tasks 15 and 16 can run in parallel (testing independent components)

**Critical Path** (longest dependency chain):
```
Task 2 (proto) → Task 4 (buf gen) → Task 8 (rpc exports) → Task 9 (pnpm build) 
→ Task 10 (API client) → Task 11 (EmployeesTab) → Task 12 (EmployeeTable) 
→ Task 15 (tests) → Task 17 (quickstart) → Task 20 (commit)
```

**Estimated Total Tasks**: 20 numbered, ordered tasks

---

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
- [x] Phase 0: Research complete (/plan command) ✅
- [x] Phase 1: Design complete (/plan command) ✅
- [x] Phase 2: Task planning complete (/plan command - approach described) ✅
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS ✅
- [x] Post-Design Constitution Check: PASS ✅
- [x] All NEEDS CLARIFICATION resolved ✅
- [x] Complexity deviations documented: NONE ✅

---
*Based on Constitution v3.4.0 - See `.specify/memory/constitution.md`*
