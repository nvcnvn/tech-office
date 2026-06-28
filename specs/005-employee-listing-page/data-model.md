# Data Model: Employee Listing Page

**Feature**: Employee Listing Page  
**Date**: 2025-10-27  
**Status**: Complete

## Overview

This feature leverages **existing database schema** without modifications. The employee listing query joins `organization.employee` with `iam.identity` to access email addresses while maintaining multi-tenant isolation.

**Key Design Decisions**:
- ✅ No schema changes required
- ✅ Use existing UUID v7 primary keys for deterministic secondary sorting
- ✅ Leverage existing unique index `idx_iam_identity_org_email` for fast email search
- ✅ Role-based field filtering implemented in service layer (not database)

---

## Existing Schema (No Modifications)

### iam.identity (Core Identity Table)

**Purpose**: Master identity table for all users across the platform.

```sql
CREATE TABLE IF NOT EXISTS iam.identity (
    id UUID PRIMARY KEY DEFAULT uuidv7(),           -- Time-sortable UUID for consistent ordering
    organization_id UUID REFERENCES public.organization(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,                    -- Unique per organization
    identity_type TEXT CHECK (identity_type IN ('human', 'service')) NOT NULL DEFAULT 'human',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Existing index for fast email lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_iam_identity_org_email 
ON iam.identity (organization_id, email);

-- Row-level security for tenant isolation
ALTER TABLE iam.identity ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation_policy ON iam.identity 
USING (organization_id = current_setting('user.organization_id')::UUID);
```

**Relevant Fields for Listing**:
- `id`: Primary key, foreign key to organization.employee
- `organization_id`: Tenant isolation
- `email`: Search filter (exact match)

---

### organization.employee (Employee Details)

**Purpose**: Extended employee information linked to identity.

```sql
CREATE TABLE IF NOT EXISTS organization.employee (
    id UUID PRIMARY KEY REFERENCES iam.identity(id),  -- One-to-one with identity
    organization_id UUID REFERENCES public.organization(id) ON DELETE CASCADE,
    given_name TEXT NOT NULL,                         -- Display in list
    family_name TEXT NOT NULL,                        -- Display in list
    hire_date DATE,                                   -- Sortable, nullable
    date_of_birth DATE,                               -- Sortable, nullable, sensitive (ROLE_ADMIN/ROLE_OWNER only)
    phone_number TEXT,                                -- Optional
    home_address TEXT,                                -- Sensitive (ROLE_ADMIN/ROLE_OWNER only)
    additional_info JSONB,                            -- Flexible metadata (not used in listing)
    is_active BOOLEAN NOT NULL DEFAULT TRUE,          -- Status indicator (gray out if false)
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Row-level security for tenant isolation
ALTER TABLE organization.employee ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation_policy ON organization.employee 
USING (organization_id = current_setting('user.organization_id')::UUID);
```

**Relevant Fields for Listing**:
- `id`: Primary key (UUID v7 for secondary sorting)
- `organization_id`: Tenant isolation filter
- `given_name`, `family_name`: Display name
- `hire_date`: Primary sort field (with NULL handling)
- `date_of_birth`: Primary sort field (sensitive, with NULL handling)
- `is_active`: Visual indicator (gray out inactive rows)
- `phone_number`, `home_address`: Display fields (home_address is sensitive)

---

### iam.identity_role (Not Used in Query)

This table maps users to roles but is NOT joined in the listing query. Role information comes from Zitadel JWT claims in the auth context, not the database.

---

## Query Design

### ListEmployees Query (sqlc)

**File**: `backend/database/scripts/iam.query.sql`

```sql
-- name: ListEmployees :many
-- Retrieve paginated, sorted, optionally filtered employee list
-- Joins organization.employee with iam.identity for email access
-- Supports:
-- - Exact email search (uses idx_iam_identity_org_email index)
-- - Sorting by hire_date or date_of_birth (ASC/DESC)
-- - UUID v7 secondary sort for deterministic ordering
-- - NULL date handling (sorts NULLs to end)
SELECT 
    e.id,
    e.organization_id,
    e.given_name,
    e.family_name,
    e.hire_date,
    e.date_of_birth,
    e.phone_number,
    e.home_address,
    e.is_active,
    e.updated_at,
    i.email
FROM organization.employee e
INNER JOIN iam.identity i ON e.id = i.id
WHERE e.organization_id = $1                           -- Tenant isolation (required)
  AND (sqlc.narg('email')::text IS NULL OR i.email = sqlc.narg('email'))  -- Optional exact email filter
ORDER BY 
    -- Primary sort by hire_date (if specified)
    CASE WHEN sqlc.narg('sort_by')::text = 'hire_date' AND sqlc.narg('sort_direction')::text = 'ASC' 
         THEN COALESCE(e.hire_date, '9999-12-31'::date) END ASC,
    CASE WHEN sqlc.narg('sort_by')::text = 'hire_date' AND sqlc.narg('sort_direction')::text = 'DESC' 
         THEN COALESCE(e.hire_date, '1000-01-01'::date) END DESC,
    
    -- Primary sort by date_of_birth (if specified)
    CASE WHEN sqlc.narg('sort_by')::text = 'date_of_birth' AND sqlc.narg('sort_direction')::text = 'ASC' 
         THEN COALESCE(e.date_of_birth, '9999-12-31'::date) END ASC,
    CASE WHEN sqlc.narg('sort_by')::text = 'date_of_birth' AND sqlc.narg('sort_direction')::text = 'DESC' 
         THEN COALESCE(e.date_of_birth, '1000-01-01'::date) END DESC,
    
    -- Secondary sort by UUID v7 (time-sortable, ensures deterministic ordering)
    e.id ASC
LIMIT sqlc.arg('page_size')::int
OFFSET sqlc.arg('offset')::int;

-- name: CountEmployees :one
-- Count total employees for pagination metadata
-- Supports same filtering as ListEmployees
SELECT COUNT(*) 
FROM organization.employee e
INNER JOIN iam.identity i ON e.id = i.id
WHERE e.organization_id = $1
  AND (sqlc.narg('email')::text IS NULL OR i.email = sqlc.narg('email'));
```

**Query Parameters**:
- `organization_id` (required): Tenant isolation
- `email` (optional): Exact email match for search
- `sort_by` (optional): "hire_date" or "date_of_birth"
- `sort_direction` (optional): "ASC" or "DESC"
- `page_size` (required): Number of results (20, 50, 100, 200)
- `offset` (required): Pagination offset (page_number - 1) * page_size

**Performance Characteristics**:
- **Email search**: O(log n) via `idx_iam_identity_org_email` index
- **Full list**: O(n) sequential scan (acceptable for n ≤ 200)
- **Sorting**: O(n log n) in-memory sort (PostgreSQL sorts 200 rows efficiently)
- **JOIN**: Hash join (PostgreSQL optimizer prefers hash join for small datasets)

---

## NULL Handling Strategy

### Problem
Employees may have NULL `hire_date` or `date_of_birth`. Spec requires these to sort to the end of the list.

### Solution
Use `COALESCE` to replace NULL with sentinel values:
- **ASC sort**: `COALESCE(date_field, '9999-12-31'::date)` → NULLs sort last
- **DESC sort**: `COALESCE(date_field, '1000-01-01'::date)` → NULLs sort last

**Example**:
```
hire_date values: [2020-01-15, NULL, 2021-06-20, 2019-12-01]

ASC sort result:  [2019-12-01, 2020-01-15, 2021-06-20, NULL]
DESC sort result: [2021-06-20, 2020-01-15, 2019-12-01, NULL]
```

---

## UUID v7 Secondary Sorting

### Why UUID v7?
UUID v7 embeds Unix timestamp in the first 48 bits, making it time-sortable. When multiple employees have identical `hire_date` or `date_of_birth`, sorting by `id` provides:
1. **Determinism**: Same query always returns same order
2. **Chronological tie-breaking**: Employees created earlier appear first
3. **Stability across pagination**: No row shuffling when navigating pages

**Example**:
```
Three employees with hire_date = 2023-01-15:

Alice:   id = 018d1234-5678-7abc-def0-123456789012 (created 2023-01-15 09:00)
Bob:     id = 018d1234-5678-7abc-def0-abcdefabcdef (created 2023-01-15 10:00)
Charlie: id = 018d1234-5678-7abc-def0-fedcbafedcba (created 2023-01-15 11:00)

Sort order: Alice, Bob, Charlie (chronological by ID)
```

---

## Role-Based Field Filtering (Service Layer)

**Implementation**: Backend service removes sensitive fields from response before sending to frontend.

**Logic**:
```go
func filterSensitiveFields(employee *Employee, userRole string) *Employee {
    if userRole == "ROLE_EMPLOYEE" || userRole == "ROLE_OPERATOR" {
        // Remove sensitive fields
        employee.DateOfBirth = nil
        employee.HomeAddress = nil
    }
    return employee
}
```

**Rationale**:
- Simpler than database views or conditional SQL
- Role information from JWT claims (no extra database query)
- Centralized filtering logic in one place
- Frontend never receives sensitive data for unauthorized roles

---

## Index Analysis

### Existing Indexes (Sufficient)

1. **Primary Key Index on `organization.employee.id`**:
   - Type: B-tree (automatic for PRIMARY KEY)
   - Usage: JOIN with iam.identity, secondary sorting
   - Performance: O(log n) lookups

2. **Primary Key Index on `iam.identity.id`**:
   - Type: B-tree (automatic for PRIMARY KEY)
   - Usage: JOIN with organization.employee
   - Performance: O(log n) lookups

3. **Unique Index `idx_iam_identity_org_email`**:
   - Columns: `(organization_id, email)`
   - Type: B-tree unique
   - Usage: Exact email search
   - Performance: O(log n) for WHERE email = ?

### No New Indexes Needed

**Why not index hire_date or date_of_birth?**
- Dataset size: 200 employees per organization
- PostgreSQL can sort 200 rows in-memory (<1ms)
- Index maintenance overhead outweighs benefits for small tables
- Query planner prefers sequential scan + in-memory sort for n < 1000

---

## Multi-Tenant Isolation Guarantees

### Database Level (Row-Level Security)
- `iam.identity`: RLS policy filters by `current_setting('user.organization_id')::UUID`
- `organization.employee`: RLS policy filters by `current_setting('user.organization_id')::UUID`

### Application Level (TenantPool)
- All queries executed via `TenantPool` (sets organization context)
- WHERE clause explicitly includes `organization_id = $1` (defense in depth)
- Auth interceptor validates JWT organization claim matches query parameter

### Testing Strategy
- Integration test: Create employees in two organizations, verify queries return only own org's employees
- Security test: Attempt to query with mismatched `organization_id`, verify RLS blocks access

---

## Sample Query Results

### Scenario 1: List All Employees (No Filter, Default Sort)

**Request**:
```
organization_id: "550e8400-e29b-41d4-a716-446655440000"
email: NULL
sort_by: NULL (defaults to hire_date ASC)
sort_direction: NULL
page_size: 50
offset: 0
```

**Response**:
```json
[
  {
    "id": "018d1234-5678-7abc-def0-111111111111",
    "organization_id": "550e8400-e29b-41d4-a716-446655440000",
    "given_name": "Alice",
    "family_name": "Anderson",
    "hire_date": "2020-01-15",
    "date_of_birth": "1990-06-20",  // Visible only to ROLE_ADMIN/ROLE_OWNER
    "phone_number": "+1-555-100-1001",
    "home_address": "123 Main St",  // Visible only to ROLE_ADMIN/ROLE_OWNER
    "is_active": true,
    "email": "alice@example.com"
  },
  {
    "id": "018d1234-5678-7abc-def0-222222222222",
    "organization_id": "550e8400-e29b-41d4-a716-446655440000",
    "given_name": "Bob",
    "family_name": "Brown",
    "hire_date": "2021-03-20",
    "date_of_birth": "1985-12-10",
    "phone_number": "+1-555-200-2002",
    "home_address": "456 Oak Ave",
    "is_active": false,  // Frontend grays out this row
    "email": "bob@example.com"
  }
  // ... up to 50 employees
]
```

---

### Scenario 2: Search by Exact Email

**Request**:
```
organization_id: "550e8400-e29b-41d4-a716-446655440000"
email: "alice@example.com"
sort_by: NULL
sort_direction: NULL
page_size: 50
offset: 0
```

**Response**:
```json
[
  {
    "id": "018d1234-5678-7abc-def0-111111111111",
    "given_name": "Alice",
    "family_name": "Anderson",
    "email": "alice@example.com",
    // ... other fields
  }
]
```

---

### Scenario 3: Sort by Date of Birth (DESC), Page 2

**Request**:
```
organization_id: "550e8400-e29b-41d4-a716-446655440000"
email: NULL
sort_by: "date_of_birth"
sort_direction: "DESC"
page_size: 20
offset: 20  // (page 2 - 1) * 20
```

**Response**:
```json
[
  // Employees 21-40, sorted by date_of_birth DESC, then id ASC
  // NULLs appear at the end (last pages)
]
```

---

## Pagination Metadata

### Total Count Query
Separate `CountEmployees` query returns total matching employees for pagination controls.

**Frontend Calculation**:
```typescript
const totalPages = Math.ceil(totalCount / pageSize);
const hasNextPage = currentPage < totalPages;
const hasPreviousPage = currentPage > 1;
```

---

## Data Validation (Service Layer)

### Request Validation
- `organization_id`: Must be valid UUID, must match auth context organization
- `email`: If provided, must be valid email format (RFC 5322)
- `sort_by`: Must be NULL, "hire_date", or "date_of_birth"
- `sort_direction`: Must be NULL, "ASC", or "DESC"
- `page_size`: Must be 20, 50, 100, or 200
- `offset`: Must be non-negative integer

### Response Validation
- All returned employees must have `organization_id` matching request
- Field filtering applied based on user role
- `is_active` boolean correctly mapped

---

## Migration Strategy

### No Database Migrations Required
This feature requires **zero schema changes**. Implementation steps:
1. Add new sqlc queries to `backend/database/scripts/iam.query.sql`
2. Run `sqlc generate` to create Go methods
3. Implement service method using generated queries
4. No downtime, no rollback complexity

### Rollback Safety
- ✅ Additive changes only (no ALTER TABLE, no DROP)
- ✅ Existing queries unaffected
- ✅ Can revert backend code without database operations

---

## Performance Benchmarks (Expected)

### Query Execution Time (PostgreSQL)
- **List all (50 employees)**: <5ms
- **List all (200 employees)**: <10ms
- **Email search**: <2ms (index scan)
- **Sort by date + pagination**: <8ms (in-memory sort)

### Network Transfer
- **Payload size (50 employees)**: ~8KB JSON
- **Payload size (200 employees)**: ~30KB JSON
- **Gzip compression**: ~60% reduction

### Frontend Rendering
- **Initial table render**: <50ms
- **Re-sort operation**: <20ms (client-side state update)
- **Pagination navigation**: <30ms (fetch + render)

---

## Related Schemas (For Context)

### public.organization (Referenced but Not Joined)
```sql
CREATE TABLE IF NOT EXISTS public.organization (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,  -- Subdomain routing
    -- ... other fields
);
```

**Usage**: Foreign key target for tenant isolation, not joined in queries.

---

## Next Steps

Data model design complete. Proceed to:
1. Create RPC contract (`contracts/rpc-contract.md`)
2. Create sqlc query file (`contracts/list-employees.query.sql`)
3. Design frontend component architecture
4. Generate quickstart test scenarios
