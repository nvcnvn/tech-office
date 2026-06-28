# Research: Employee Listing Page

**Feature**: Employee Listing Page  
**Date**: 2025-10-27  
**Status**: Complete

## Executive Summary

All technical unknowns were resolved during the clarification session documented in `spec.md`. This research phase validates that the existing Tech Office architecture fully supports the employee listing requirements without schema changes or new infrastructure.

**Key Findings**:
- ✅ Existing database schema (`organization.employee`, `iam.identity`) contains all required fields
- ✅ UUID v7 primary keys enable time-based secondary sorting
- ✅ Unique index on `(organization_id, email)` supports fast exact email search
- ✅ IAMService already has AdminPool/TenantPool structure for tenant isolation
- ✅ Frontend workspace pattern established with `organization/` as reference implementation

---

## Research Tasks & Decisions

### 1. Database Schema & Performance

**Research Question**: Can existing schema support list view with efficient sorting and pagination for 200 employees?

**Decision**: Use existing `organization.employee` and `iam.identity` tables without modifications.

**Rationale**:
- `organization.employee` contains all required fields: `id` (UUID v7), `organization_id`, `given_name`, `family_name`, `hire_date`, `date_of_birth`, `phone_number`, `home_address`, `is_active`
- UUID v7 primary keys are time-sortable, enabling deterministic secondary sorting for identical dates
- `iam.identity` provides email via `id` foreign key relationship
- Existing index `idx_iam_identity_org_email ON iam.identity (organization_id, email)` supports O(log n) exact email search
- Row-level security policies already enforce `organization_id` tenant isolation

**Existing Patterns to Follow**:
- Reference: `backend/database/scripts/schema.sql` lines 22-68
- Pattern: JOIN `organization.employee e` with `iam.identity i` ON `e.id = i.id` for email access
- Performance: With 200 employee maximum per org, full table scans acceptable (PostgreSQL planner will use index for email search)

**Alternatives Considered**:
- ❌ Denormalize email into organization.employee: Rejected due to data duplication and sync issues
- ❌ Create materialized view: Rejected as over-engineering for 200 row maximum
- ❌ Add composite indexes for sort columns: Rejected as PostgreSQL can efficiently sort 200 rows in memory

---

### 2. Multi-Tenant Isolation & Security

**Research Question**: How to enforce role-based field visibility (sensitive fields for ROLE_ADMIN/ROLE_OWNER only)?

**Decision**: Implement role-based filtering in service layer, not database.

**Rationale**:
- Database query returns all fields for ROLE_ADMIN/ROLE_OWNER
- Service method filters `date_of_birth` and `home_address` from response for ROLE_EMPLOYEE/ROLE_OPERATOR
- Simpler than database views or conditional column selection
- Role information available from Zitadel JWT claims in auth context

**Existing Patterns to Follow**:
- Reference: `backend/internal/iam/employee_import.go` for accessing auth context
- Reference: `backend/rpc/v1/rbac.proto` for role enum definitions (ROLE_ADMIN, ROLE_OWNER, ROLE_OPERATOR, ROLE_EMPLOYEE)
- Pattern: Use `TenantPool` for tenant-aware queries (enforces `organization_id` context)

**Alternatives Considered**:
- ❌ Database views per role: Over-engineering, hard to maintain
- ❌ GraphQL-style field selection: Not using GraphQL
- ❌ Separate RPC methods per role: Violates DRY principle

---

### 3. RPC Contract Design

**Research Question**: Extend existing IAMService or create new EmployeeService?

**Decision**: Add `ListEmployees` RPC method to existing `IAMService`.

**Rationale**:
- IAMService already handles employee import operations (`ParseEmployeeFile`, `PreviewEmployeeImport`, `ExecuteEmployeeImport`)
- Conceptually consistent: employee listing is part of identity/access management
- Avoids service proliferation
- IAMService struct already has required AdminPool/TenantPool infrastructure

**Existing Patterns to Follow**:
- Reference: `backend/rpc/v1/iam.proto` lines 11-40 for service definition structure
- Reference: `backend/internal/iam/iam.go` for IAMService implementation
- Pattern: Use `access_control` annotation for RBAC: `allowed_roles: [ROLE_ADMIN, ROLE_OWNER, ROLE_OPERATOR, ROLE_EMPLOYEE]`

**Alternatives Considered**:
- ❌ Create new EmployeeService: Premature service separation
- ❌ Add to OrganizationService: Employee management belongs in IAM domain

---

### 4. Pagination & Sorting Strategy

**Research Question**: Client-side vs server-side pagination? SQL OFFSET/LIMIT vs cursor-based?

**Decision**: Server-side pagination with SQL OFFSET/LIMIT.

**Rationale**:
- Organization maximum 200 employees: OFFSET/LIMIT performance acceptable (PostgreSQL scans ≤200 rows)
- Simpler implementation than cursor-based pagination
- Deterministic ordering via UUID v7 secondary sort prevents pagination drift
- Client receives only requested page (reduces bandwidth)

**SQL Pattern**:
```sql
SELECT e.*, i.email
FROM organization.employee e
INNER JOIN iam.identity i ON e.id = i.id
WHERE e.organization_id = $1
  AND ($2 = '' OR i.email = $2)  -- Optional email filter
ORDER BY 
  CASE WHEN $3 = 'hire_date' AND $4 = 'ASC' THEN e.hire_date END ASC,
  CASE WHEN $3 = 'hire_date' AND $4 = 'DESC' THEN e.hire_date END DESC,
  CASE WHEN $3 = 'date_of_birth' AND $4 = 'ASC' THEN e.date_of_birth END ASC,
  CASE WHEN $3 = 'date_of_birth' AND $4 = 'DESC' THEN e.date_of_birth END DESC,
  e.id ASC  -- UUID v7 secondary sort
LIMIT $5 OFFSET $6;
```

**Existing Patterns to Follow**:
- Reference: `backend/database/scripts/iam.query.sql` for sqlc query syntax
- Pattern: Use `-- name: ListEmployees :many` annotation for sqlc code generation
- Pattern: NULL date handling: `ORDER BY COALESCE(date_field, 'infinity'::date)` to sort NULLs last

**Alternatives Considered**:
- ❌ Client-side pagination: Requires fetching all 200 employees (inefficient)
- ❌ Cursor-based pagination: Over-engineering for small datasets
- ❌ GraphQL connections: Not using GraphQL

---

### 5. Frontend Component Architecture

**Research Question**: Create new page or enhance existing EmployeesTab?

**Decision**: Transform existing `EmployeesTab.tsx` placeholder into functional data grid.

**Rationale**:
- `workspace/organization/components/EmployeesTab.tsx` already exists as placeholder
- Organization page already has tab navigation infrastructure
- Maintains consistency with workspace architecture patterns
- No new routes needed

**Component Structure**:
```tsx
EmployeesTab/
├── index.tsx                    // Main container with data fetching
├── EmployeeTable.tsx            // MUI Table with sorting/pagination
├── EmployeeTableRow.tsx         // Row component with role-based column visibility
├── SearchBar.tsx                // Exact email search input
└── PaginationControls.tsx       // Page size selector + navigation
```

**Existing Patterns to Follow**:
- Reference: `frontend/apps/web/src/app/workspace/organization/components/EmployeesTab.tsx` (current placeholder)
- Reference: `frontend/apps/web/src/app/workspace/organization/page.tsx` for tab navigation
- Pattern: Use MUI `Table`, `TableHead`, `TableBody`, `TableRow`, `TableCell` components
- Pattern: Use `useRequireAuth()` hook for auth context and role checking
- Pattern: Use `packages/apis` for RPC client wrappers

**Alternatives Considered**:
- ❌ Create new `/workspace/employees` page: Violates workspace pattern
- ❌ Use MUI DataGrid Pro: Overkill for 200 rows, requires license
- ❌ Third-party table library: Prefer built-in MUI components

---

### 6. Visual Design for Inactive Employees

**Research Question**: How to visually distinguish inactive employees without compromising accessibility?

**Decision**: Use gray text color and subtle opacity reduction.

**Rationale**:
- Maintains readability (WCAG AA contrast ratio)
- Non-intrusive visual indicator
- Consistent with common UI patterns

**CSS Implementation**:
```tsx
<TableRow className={employee.is_active ? '' : 'opacity-50 text-gray-500'}>
  {/* Row cells */}
</TableRow>
```

**Existing Patterns to Follow**:
- Reference: Tailwind CSS utility classes already available
- Pattern: Use `opacity-50` for subtle graying
- Pattern: Use `text-gray-500` for inactive state

**Alternatives Considered**:
- ❌ Strikethrough text: Reduces readability
- ❌ Red background: Too aggressive, implies error
- ❌ Hide inactive employees: Spec requires showing all

---

### 7. Search Performance Optimization

**Research Question**: Full-text search vs exact match? How to leverage indexes?

**Decision**: Exact email match using unique index.

**Rationale**:
- Spec explicitly requires "exact email" search (not substring or fuzzy)
- Existing index `idx_iam_identity_org_email` provides O(log n) lookup
- PostgreSQL query planner uses index for `WHERE email = $1` (verified via EXPLAIN)

**Existing Patterns to Follow**:
- Reference: `backend/database/scripts/schema.sql` line 30 for index definition
- Pattern: Case-insensitive match via `LOWER(email) = LOWER($1)` (index supports this)

**Alternatives Considered**:
- ❌ LIKE/ILIKE patterns: Slower, not required by spec
- ❌ Full-text search (tsvector): Over-engineering for exact match
- ❌ Elasticsearch: Massive over-engineering for 200 employees

---

### 8. Empty State & Error Handling

**Research Question**: What edge cases need explicit UI handling?

**Decision**: Handle four states: loading, empty, error, success.

**UI States**:
1. **Loading**: Skeleton table with shimmer effect (MUI Skeleton component)
2. **Empty**: "No employees found" message with import action button
3. **Error**: Error alert with retry button (MUI Alert component)
4. **Success**: Functional data grid with all features

**Existing Patterns to Follow**:
- Reference: `frontend/apps/web/src/app/workspace/organization/components/EmployeesTab.tsx` lines 37-45 for empty state
- Pattern: Use MUI `CircularProgress` for loading spinner
- Pattern: Use MUI `Alert` for error messages

**Alternatives Considered**:
- ❌ Toast notifications: Less prominent than inline alerts
- ❌ Modal error dialogs: Too disruptive

---

## Technology Stack Validation

### Backend Dependencies (Already Available)
- ✅ Go 1.25+ - Installed
- ✅ PostgreSQL 18+ - Available via Docker Compose
- ✅ sqlc v1.20+ - Installed for query generation
- ✅ buf v1.28+ - Installed for protobuf generation
- ✅ ConnectRPC - Already integrated in IAMService

### Frontend Dependencies (Already Available)
- ✅ Next.js 15 - Installed
- ✅ React 18 - Installed
- ✅ MUI v5 - Installed
- ✅ Tailwind CSS - Configured
- ✅ TypeScript 5.x - Installed
- ✅ pnpm workspace - Configured

### No New Dependencies Required
This feature requires zero new package installations. All required libraries and patterns already exist in the codebase.

---

## Performance Validation

### Database Query Performance
- **Dataset**: 200 employees per organization
- **Query**: JOIN + WHERE + ORDER BY + LIMIT/OFFSET
- **Expected**: <10ms query execution (PostgreSQL planner)
- **Validation Method**: EXPLAIN ANALYZE in production-like environment

### Frontend Rendering Performance
- **Component**: MUI Table with 200 rows (worst case: page size = 200)
- **Expected**: <100ms initial render (React 18 concurrent rendering)
- **Validation Method**: Chrome DevTools Performance profiler

### Network Performance
- **Payload Size**: ~30KB for 200 employees (JSON)
- **Expected**: <50ms over typical broadband connection
- **Validation Method**: Network tab inspection

---

## Security Considerations

### Tenant Isolation
- ✅ All queries filter by `organization_id` via TenantPool
- ✅ Row-level security policies enforce isolation at database level
- ✅ Auth interceptor validates JWT claims before RPC execution

### Role-Based Access Control
- ✅ Proto-level `access_control` annotation permits all authenticated users
- ✅ Service layer filters sensitive fields based on role claims
- ✅ Frontend conditionally renders columns based on user role

### Data Privacy
- ✅ Date of birth and home address hidden from ROLE_EMPLOYEE/ROLE_OPERATOR
- ✅ Email search limited to exact match (no substring leakage)
- ✅ No audit log required (read-only operation, no PII modifications)

---

## Compliance & Observability

### Logging Strategy
- Log list requests with: user_id, organization_id, page_number, page_size, sort_field
- Log search requests with: user_id, organization_id, search_email (hashed)
- Do NOT log full employee records (PII concern)

### Metrics
- RPC latency histogram: `iam_list_employees_duration_seconds`
- Request counter: `iam_list_employees_requests_total` (labels: organization_id, status)
- Result count histogram: `iam_list_employees_result_count`

### No Audit Trail Required
- Rationale: Read-only operation, no data modifications
- Exception: If future compliance requires read access logs, add to iam.audit_log table

---

## Migration & Rollback Strategy

### Deployment Plan
1. Deploy backend with new ListEmployees RPC (backward compatible - no clients yet)
2. Deploy frontend with new EmployeesTab (graceful degradation if RPC unavailable)
3. Monitor error rates and latency for 24 hours
4. Rollback: Revert frontend to placeholder EmployeesTab if issues detected

### Rollback Safety
- ✅ No database migrations required (zero schema changes)
- ✅ Backend change additive only (no breaking changes)
- ✅ Frontend change isolated to EmployeesTab component
- ✅ No data loss risk (read-only feature)

---

## Unknowns Resolved via Clarification

All ambiguities documented in spec.md were resolved:

1. **Permission Model**: All authenticated users (ROLE_ADMIN, ROLE_OWNER, ROLE_OPERATOR, ROLE_EMPLOYEE) can view list
2. **Data Visibility**: Show all employees (active and inactive); inactive grayed out
3. **Sensitive Fields**: Date of birth and home address visible only to ROLE_ADMIN/ROLE_OWNER
4. **Organization Size**: Maximum ~200 employees per organization (no hard limit, but expected scale)
5. **Sort Tie-Breaking**: Use UUID v7 employee ID as secondary sort key

---

## References

### Existing Implementations
- Employee Import: `specs/003-feature-import-employees/` - Similar patterns for employee data handling
- Organization Page: `frontend/apps/web/src/app/workspace/organization/` - Reference for tab navigation
- IAM Service: `backend/internal/iam/iam.go` - Service structure with AdminPool/TenantPool

### Documentation
- Constitution: `.specify/memory/constitution.md` v3.4.0 - Architectural principles
- SQL Standards: `.github/instructions/sql.instructions.md` - Database coding standards
- Frontend Guidelines: `.github/copilot-instructions.md` - Workspace pattern documentation

---

## Next Steps

Research complete. Proceed to Phase 1 (Design & Contracts):
1. Design RPC contract for ListEmployees
2. Design sqlc queries for employee listing
3. Design frontend component architecture
4. Generate contract test scenarios
5. Create quickstart.md with validation steps
