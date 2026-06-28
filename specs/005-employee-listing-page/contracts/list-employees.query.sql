-- ===============================================
-- Employee Listing Queries
-- Contract for sqlc code generation
-- ===============================================

-- name: ListEmployees :many
-- Retrieve paginated, sorted, optionally filtered employee list
-- Joins organization.employee with iam.identity for email access
-- Supports:
-- - Exact email search (uses idx_iam_identity_org_email index)
-- - Sorting by hire_date or date_of_birth (ASC/DESC)
-- - UUID v7 secondary sort for deterministic ordering
-- - NULL date handling (sorts NULLs to end)
--
-- Performance:
-- - Email search: O(log n) via unique index
-- - Full list: O(n) sequential scan (acceptable for n ≤ 200)
-- - Sorting: O(n log n) in-memory (PostgreSQL efficient for 200 rows)
--
-- Parameters:
-- - $1 organization_id (UUID, required): Tenant isolation
-- - $2 email (text, optional via sqlc.narg): Exact email match filter
-- - $3 sort_by (text, optional via sqlc.narg): "hire_date" or "date_of_birth"
-- - $4 sort_direction (text, optional via sqlc.narg): "ASC" or "DESC"
-- - $5 page_size (int, required via sqlc.arg): Number of results (20, 50, 100, 200)
-- - $6 offset (int, required via sqlc.arg): Pagination offset
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
WHERE e.organization_id = $1
  -- Optional email filter: only apply if parameter provided
  AND (sqlc.narg('email')::text IS NULL OR LOWER(i.email) = LOWER(sqlc.narg('email')))
ORDER BY 
    -- Primary sort by hire_date (if specified)
    -- COALESCE replaces NULL with sentinel date to sort NULLs last
    CASE WHEN sqlc.narg('sort_by')::text = 'hire_date' AND sqlc.narg('sort_direction')::text = 'ASC' 
         THEN COALESCE(e.hire_date, '9999-12-31'::date) END ASC,
    CASE WHEN sqlc.narg('sort_by')::text = 'hire_date' AND sqlc.narg('sort_direction')::text = 'DESC' 
         THEN COALESCE(e.hire_date, '1000-01-01'::date) END DESC,
    
    -- Primary sort by date_of_birth (if specified)
    CASE WHEN sqlc.narg('sort_by')::text = 'date_of_birth' AND sqlc.narg('sort_direction')::text = 'ASC' 
         THEN COALESCE(e.date_of_birth, '9999-12-31'::date) END ASC,
    CASE WHEN sqlc.narg('sort_by')::text = 'date_of_birth' AND sqlc.narg('sort_direction')::text = 'DESC' 
         THEN COALESCE(e.date_of_birth, '1000-01-01'::date) END DESC,
    
    -- Secondary sort by UUID v7 (time-sortable) for deterministic ordering
    -- Ensures consistent results when primary sort values are identical
    e.id ASC
LIMIT sqlc.arg('page_size')::int
OFFSET sqlc.arg('offset')::int;

-- name: CountEmployees :one
-- Count total employees for pagination metadata
-- Supports same filtering as ListEmployees (email search)
--
-- Performance:
-- - Count with email filter: O(log n) via index
-- - Count all: O(n) sequential scan (acceptable for n ≤ 200)
--
-- Parameters:
-- - $1 organization_id (UUID, required): Tenant isolation
-- - $2 email (text, optional via sqlc.narg): Exact email match filter
SELECT COUNT(*) 
FROM organization.employee e
INNER JOIN iam.identity i ON e.id = i.id
WHERE e.organization_id = $1
  -- Optional email filter: only apply if parameter provided
  AND (sqlc.narg('email')::text IS NULL OR LOWER(i.email) = LOWER(sqlc.narg('email')));

-- ===============================================
-- Query Usage Examples
-- ===============================================

-- Example 1: List all employees, default sort (hire_date ASC), first page
-- SELECT * FROM ListEmployees(
--   organization_id = '550e8400-e29b-41d4-a716-446655440000',
--   email = NULL,
--   sort_by = 'hire_date',
--   sort_direction = 'ASC',
--   page_size = 50,
--   offset = 0
-- );

-- Example 2: Search by exact email
-- SELECT * FROM ListEmployees(
--   organization_id = '550e8400-e29b-41d4-a716-446655440000',
--   email = 'alice@example.com',
--   sort_by = NULL,
--   sort_direction = NULL,
--   page_size = 50,
--   offset = 0
-- );

-- Example 3: Sort by date_of_birth DESC, page 2 (20 items per page)
-- SELECT * FROM ListEmployees(
--   organization_id = '550e8400-e29b-41d4-a716-446655440000',
--   email = NULL,
--   sort_by = 'date_of_birth',
--   sort_direction = 'DESC',
--   page_size = 20,
--   offset = 20
-- );

-- Example 4: Count all employees
-- SELECT * FROM CountEmployees(
--   organization_id = '550e8400-e29b-41d4-a716-446655440000',
--   email = NULL
-- );

-- ===============================================
-- Index Usage Verification (Run via EXPLAIN ANALYZE)
-- ===============================================

-- Verify email search uses index:
-- EXPLAIN ANALYZE
-- SELECT e.*, i.email
-- FROM organization.employee e
-- INNER JOIN iam.identity i ON e.id = i.id
-- WHERE e.organization_id = '550e8400-e29b-41d4-a716-446655440000'
--   AND LOWER(i.email) = 'alice@example.com';
-- Expected: Index Scan using idx_iam_identity_org_email

-- Verify full list query plan:
-- EXPLAIN ANALYZE
-- SELECT e.*, i.email
-- FROM organization.employee e
-- INNER JOIN iam.identity i ON e.id = i.id
-- WHERE e.organization_id = '550e8400-e29b-41d4-a716-446655440000'
-- ORDER BY COALESCE(e.hire_date, '9999-12-31'::date) ASC, e.id ASC
-- LIMIT 50;
-- Expected: Seq Scan or Index Scan (depends on dataset size), Sort

-- ===============================================
-- Generated Go Code Preview (by sqlc)
-- ===============================================

-- type ListEmployeesParams struct {
--     OrganizationID pgtype.UUID
--     Email          pgtype.Text    // NULL if not filtering
--     SortBy         pgtype.Text    // NULL or "hire_date" or "date_of_birth"
--     SortDirection  pgtype.Text    // NULL or "ASC" or "DESC"
--     PageSize       int32
--     Offset         int32
-- }

-- type ListEmployeesRow struct {
--     ID             pgtype.UUID
--     OrganizationID pgtype.UUID
--     GivenName      string
--     FamilyName     string
--     HireDate       pgtype.Date
--     DateOfBirth    pgtype.Date
--     PhoneNumber    pgtype.Text
--     HomeAddress    pgtype.Text
--     IsActive       bool
--     UpdatedAt      pgtype.Timestamptz
--     Email          string
-- }

-- func (q *Queries) ListEmployees(ctx context.Context, db DBTX, arg ListEmployeesParams) ([]ListEmployeesRow, error)
-- func (q *Queries) CountEmployees(ctx context.Context, db DBTX, arg CountEmployeesParams) (int64, error)

-- ===============================================
-- Testing Scenarios
-- ===============================================

-- Test 1: Empty organization (0 employees)
-- Expected: Empty array, total_count = 0

-- Test 2: Organization with 1 employee
-- Expected: Array with 1 item, total_count = 1

-- Test 3: Organization with 200 employees (maximum)
-- Expected: Page 1 returns 50 items (default page_size), total_count = 200

-- Test 4: Email search returns no results
-- Expected: Empty array, total_count = 0

-- Test 5: Email search returns 1 result
-- Expected: Array with 1 item matching email

-- Test 6: Sort by hire_date with NULL values
-- Expected: NULLs appear at end of list (last page)

-- Test 7: Sort by hire_date with identical dates
-- Expected: Tie-breaking by id (UUID v7 chronological order)

-- Test 8: Pagination boundary (last page has fewer items)
-- Expected: Last page returns remaining items (< page_size)

-- Test 9: Page number exceeds total pages
-- Expected: Empty array, pagination metadata still valid

-- Test 10: Multi-tenant isolation
-- Expected: Only employees from requested organization_id returned
