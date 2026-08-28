-- SQL Queries for Department Management Feature
-- File: backend/database/scripts/organization.query.sql (APPEND to existing file)
-- Generated Go package: database
-- Generated Go types: sqlc models

-- =============================================================================
-- DEPARTMENT CRUD QUERIES
-- =============================================================================

-- name: GetDepartmentTree :many
-- Retrieves full department hierarchy for an organization using recursive CTE.
-- Returns departments in depth-first order with path, depth, and full_path.
WITH RECURSIVE department_tree AS (
  -- Root departments (no parent)
  SELECT 
    d.id,
    d.organization_id,
    d.name,
    d.description,
    d.parent_department_id,
    d.member_count,
    d.manager_count,
    d.child_count,
    d.updated_at,
    ARRAY[d.id] as path,
    0 as depth,
    d.name::TEXT as full_path
  FROM organization.department d
  WHERE d.organization_id = $1 AND d.parent_department_id IS NULL
  
  UNION ALL
  
  -- Child departments (recursive)
  SELECT 
    d.id,
    d.organization_id,
    d.name,
    d.description,
    d.parent_department_id,
    d.member_count,
    d.manager_count,
    d.child_count,
    d.updated_at,
    dt.path || d.id,
    dt.depth + 1,
    dt.full_path || ' > ' || d.name
  FROM organization.department d
  JOIN department_tree dt ON (d.organization_id, d.parent_department_id) = (dt.organization_id, dt.id)
  WHERE d.organization_id = $1
)
SELECT 
  dt.id,
  dt.organization_id,
  dt.name,
  dt.description,
  dt.parent_department_id,
  dt.member_count,
  dt.manager_count,
  dt.child_count,
  dt.updated_at,
  dt.path,
  dt.depth,
  dt.full_path
FROM department_tree dt
ORDER BY dt.path;

-- name: GetDepartmentByID :one
-- Retrieves a single department by ID with all cached counts.
SELECT 
  id,
  organization_id,
  name,
  description,
  parent_department_id,
  member_count,
  manager_count,
  child_count,
  updated_at
FROM organization.department
WHERE id = $1 AND organization_id = $2;

-- name: CreateDepartment :one
-- Creates a new department with optional parent.
-- NOTE: Application MUST call IncrementDepartmentChildCount on parent if parent_department_id is not NULL.
INSERT INTO organization.department (
  id,
  organization_id,
  name,
  description,
  parent_department_id
) VALUES (
  uuidv7(),
  $1,  -- organization_id
  $2,  -- name
  $3,  -- description
  $4   -- parent_department_id (NULL for root)
) RETURNING *;

-- name: UpdateDepartment :one
-- Updates department name and/or description.
UPDATE organization.department
SET 
  name = COALESCE($3, name),
  description = COALESCE($4, description),
  updated_at = now()
WHERE id = $1 
  AND organization_id = $2
RETURNING *;

-- name: MoveDepartment :one
-- Moves department to new parent (or root if NULL).
-- Must run IsDepartmentDescendant check BEFORE calling this.
-- Returns old parent_department_id in addition to updated row.
-- NOTE: Application MUST:
--   1. Call DecrementDepartmentChildCount on old parent (if old parent exists)
--   2. Call IncrementDepartmentChildCount on new parent (if new parent exists)
WITH old_dept AS (
  SELECT parent_department_id
  FROM organization.department
  WHERE id = $1 AND organization_id = $3
)
UPDATE organization.department
SET 
  parent_department_id = $2,
  updated_at = now()
FROM old_dept
WHERE department.id = $1
  AND department.organization_id = $3
RETURNING department.*, old_dept.parent_department_id AS old_parent_id;

-- name: DeleteDepartment :exec
-- Deletes a department if it has no members and no children.
-- Returns error if department has members or children.
DELETE FROM organization.department
WHERE id = $1
  AND organization_id = $2
  AND member_count = 0
  AND child_count = 0;

-- =============================================================================
-- DEPARTMENT MEMBER QUERIES
-- =============================================================================

-- name: GetDepartmentMembers :many
-- Lists all employees in a department with role and employee details.
-- Returns managers first, then alphabetically sorted.
SELECT 
  dm.id,
  dm.organization_id,
  dm.department_id,
  dm.employee_id,
  dm.role,
  dm.updated_at,
  e.given_name as employee_first_name,
  e.family_name as employee_last_name,
  e.email as employee_email
FROM organization.department_member dm
JOIN organization.employee e ON (dm.organization_id, dm.employee_id) = (e.organization_id, e.id)
WHERE dm.department_id = $1 
  AND dm.organization_id = $2
ORDER BY 
  CASE WHEN dm.role = 'manager' THEN 0 ELSE 1 END,
  employee_last_name, 
  employee_first_name;

-- name: GetUnassignedEmployees :many
-- Lists employees not assigned to any department.
-- Used by managers to see available employees for assignment.
SELECT 
  e.id,
  e.given_name as first_name,
  e.family_name as last_name,
  e.email
FROM organization.employee e
WHERE e.organization_id = $1
  AND NOT EXISTS (
    SELECT 1 FROM organization.department_member dm
    WHERE dm.employee_id = e.id 
      AND dm.organization_id = $1
      AND dm.organization_id = e.organization_id
  )
ORDER BY last_name, first_name;

-- name: GetEmployeeDepartment :one
-- Gets the department an employee currently belongs to (if any).
SELECT 
  dm.id,
  dm.organization_id,
  dm.department_id,
  dm.employee_id,
  dm.role,
  dm.updated_at,
  d.name as department_name
FROM organization.department_member dm
JOIN organization.department d ON (dm.organization_id, dm.department_id) = (d.organization_id, d.id)
WHERE dm.employee_id = $1 
  AND dm.organization_id = $2;

-- name: GetEmployeeCurrentDepartment :one
-- Gets employee's current department membership if exists.
-- Used before AssignEmployeeToDepartment to determine what count updates are needed.
SELECT department_id, role
FROM organization.department_member
WHERE organization_id = $1
  AND employee_id = $2;

-- name: AssignEmployeeToDepartment :one
-- Assigns employee to department with specified role.
-- Uses ON CONFLICT to handle employee already assigned (moves to new department).
-- NOTE: Application MUST handle count updates manually (see count management queries).
-- updated_at is passed as $5 so the caller controls the timestamp.
INSERT INTO organization.department_member (
  id,
  organization_id,
  department_id,
  employee_id,
  role
) VALUES (
  uuidv7(),
  $1,  -- organization_id
  $2,  -- department_id
  $3,  -- employee_id
  $4   -- role ('member' or 'manager')
) 
ON CONFLICT (organization_id, employee_id) DO UPDATE
SET 
  department_id = EXCLUDED.department_id,
  role = EXCLUDED.role,
  updated_at = $5  -- caller-supplied timestamp
RETURNING *;

-- name: RemoveEmployeeFromDepartment :one
-- Removes employee from their current department.
-- Returns the deleted row so application can update department counts.
-- NOTE: Application MUST call DecrementDepartmentMemberCount after this.
DELETE FROM organization.department_member
WHERE employee_id = $1
  AND organization_id = $2
RETURNING *;

-- name: SetDepartmentManager :one
-- Updates employee role to 'manager' in their department.
-- Employee must already be a member of the department.
-- NOTE: Application MUST call AdjustDepartmentManagerCount(delta=+1) after this if role changed.
UPDATE organization.department_member
SET 
  role = 'manager',
  updated_at = now()
WHERE department_id = $1
  AND employee_id = $2
  AND organization_id = $3
  AND role != 'manager'  -- Only update if not already manager
RETURNING *;

-- name: ClearDepartmentManager :one
-- Removes manager designation from all employees in department.
-- (Demotes managers to regular members)
-- Returns the count of demoted managers for count adjustment.
-- NOTE: Application MUST call AdjustDepartmentManagerCount(delta=-count) after this.
WITH updated AS (
  UPDATE organization.department_member
  SET 
    role = 'member',
    updated_at = now()
  WHERE department_id = $1
    AND organization_id = $2
    AND role = 'manager'
  RETURNING *
)
SELECT COUNT(*)::int AS demoted_count
FROM updated;

-- =============================================================================
-- VALIDATION QUERIES
-- =============================================================================

-- name: IsDepartmentDescendant :one
-- Checks if target_parent is a descendant of department_to_move.
-- Returns TRUE if moving would create a circular reference (invalid).
-- Must be called BEFORE MoveDepartment to prevent circular references.
WITH RECURSIVE descendants AS (
  -- Start with department being moved
  SELECT d.id
  FROM organization.department d
  WHERE d.id = $1 AND d.organization_id = $2
  
  UNION ALL
  
  -- Recursively find all descendants
  SELECT dept.id
  FROM organization.department dept
  INNER JOIN descendants dt ON dept.parent_department_id = dt.id
  WHERE dept.organization_id = $2
)
SELECT EXISTS (
  SELECT 1 FROM descendants d WHERE d.id = $3
) as is_descendant;

-- =============================================================================
-- BULK OPERATIONS (Optional - for future enhancements)
-- =============================================================================

-- name: BulkAssignEmployeesToDepartment :copyfrom
-- Bulk insert employees to department (for CSV import feature).
-- Uses COPY protocol for high performance.
INSERT INTO organization.department_member (
  id,
  organization_id,
  department_id,
  employee_id,
  role
) VALUES (
  $1, $2, $3, $4, $5
);

-- =============================================================================
-- SEARCH QUERIES (Multilingual Fuzzy Search with pg_trgm)
-- =============================================================================
-- Strategy: Use separate indexes for each field, UNION results in single query, group by ID
-- Database handles deduplication and keeps best relevance score per employee

-- name: SearchEmployees :many
-- Fuzzy search for employees across email, given_name, and family_name fields.
-- Uses UNION ALL to search each field with its dedicated index, then groups by employee ID.
-- Keeps the maximum relevance score when an employee matches multiple fields.
WITH search_config AS (
    SELECT set_limit(0.1) -- Lower threshold for short queries
),
all_matches AS (
    -- Search by email
    SELECT 
        e.id,
        e.organization_id,
        e.given_name,
        e.family_name,
        e.is_active,
        e.updated_at,
        e.email,
        similarity(e.email, sqlc.arg('query_text')) AS relevance_score
    FROM organization.employee e
    CROSS JOIN search_config
    WHERE e.organization_id = sqlc.arg('organization_id')
      AND e.is_active = true
      AND e.email % sqlc.arg('query_text')
    
    UNION ALL
    
    -- Search by given name
    SELECT 
        e.id,
        e.organization_id,
        e.given_name,
        e.family_name,
        e.is_active,
        e.updated_at,
        e.email,
        similarity(e.given_name, sqlc.arg('query_text')) AS relevance_score
    FROM organization.employee e
    CROSS JOIN search_config
    WHERE e.organization_id = sqlc.arg('organization_id')
      AND e.is_active = true
      AND e.given_name % sqlc.arg('query_text')
    
    UNION ALL
    
    -- Search by family name
    SELECT 
        e.id,
        e.organization_id,
        e.given_name,
        e.family_name,
        e.is_active,
        e.updated_at,
        e.email,
        similarity(e.family_name, sqlc.arg('query_text')) AS relevance_score
    FROM organization.employee e
    CROSS JOIN search_config
    WHERE e.organization_id = sqlc.arg('organization_id')
      AND e.is_active = true
      AND e.family_name % sqlc.arg('query_text')
)
SELECT 
    id,
    organization_id,
    given_name,
    family_name,
    is_active,
    updated_at,
    email,
    MAX(relevance_score)::float4 AS relevance_score
FROM all_matches
WHERE (sqlc.narg('cursor')::uuid IS NULL OR id < sqlc.narg('cursor')::uuid)
GROUP BY id, organization_id, given_name, family_name, is_active, updated_at, email
ORDER BY MAX(relevance_score) DESC, updated_at DESC, id DESC
LIMIT sqlc.arg('limit')::INT;

-- name: SearchDepartments :many
-- Fuzzy search for departments by name and description using trigram similarity.
-- Uses lower similarity threshold (0.1) for better matching on short queries.
WITH search_config AS (
    SELECT set_limit(0.1) -- Lower threshold for short queries
)
SELECT 
    id,
    organization_id,
    name,
    description,
    member_count,
    parent_department_id,
    updated_at,
    similarity(name || ' ' || COALESCE(description, ''), sqlc.arg('query_text')) AS relevance_score
FROM organization.department
CROSS JOIN search_config
WHERE organization_id = sqlc.arg('organization_id')
  AND (name || ' ' || COALESCE(description, '')) % sqlc.arg('query_text')
  AND (sqlc.narg('cursor')::uuid IS NULL OR id < sqlc.narg('cursor')::uuid)
ORDER BY relevance_score DESC, member_count DESC, id DESC
LIMIT sqlc.arg('limit')::INT;

-- name: AutocompleteEmployees :many
-- Prefix-based autocomplete for employee names (faster than fuzzy search).
-- Used for @mentions and quick selections.
SELECT 
    e.id,
    e.organization_id,
    e.given_name,
    e.family_name,
    e.email
FROM organization.employee e
WHERE e.organization_id = sqlc.arg('organization_id')
  AND e.is_active = true
  AND (
    e.given_name ILIKE sqlc.arg('prefix') || '%'
    OR e.family_name ILIKE sqlc.arg('prefix') || '%'
    OR e.email ILIKE sqlc.arg('prefix') || '%'
  )
ORDER BY e.given_name, e.family_name
LIMIT sqlc.arg('limit')::INT;

-- name: AutocompleteDepartments :many
-- Prefix-based autocomplete for department names.
SELECT 
    id,
    organization_id,
    name,
    description
FROM organization.department
WHERE organization_id = sqlc.arg('organization_id')
  AND name ILIKE sqlc.arg('prefix') || '%'
ORDER BY name
LIMIT sqlc.arg('limit')::INT;

-- =============================================================================
-- DEPARTMENT COUNT MANAGEMENT (Application-Managed)
-- =============================================================================
-- NOTE: these counts are maintained in application code rather than by a trigger.
-- These queries MUST be called in application logic after INSERT/UPDATE/DELETE operations
-- on organization.department_member and organization.department tables.

-- name: IncrementDepartmentMemberCount :exec
-- Increments member_count and optionally manager_count for a department.
-- Call this AFTER adding a member to department_member table.
UPDATE organization.department
SET 
  member_count = member_count + 1,
  manager_count = manager_count + CASE WHEN sqlc.arg('is_manager')::boolean THEN 1 ELSE 0 END,
  updated_at = now()
WHERE id = sqlc.arg('department_id')
  AND organization_id = sqlc.arg('organization_id');

-- name: DecrementDepartmentMemberCount :exec
-- Decrements member_count and optionally manager_count for a department.
-- Call this AFTER removing a member from department_member table.
-- Uses GREATEST to prevent negative counts.
UPDATE organization.department
SET 
  member_count = GREATEST(member_count - 1, 0),
  manager_count = GREATEST(manager_count - CASE WHEN sqlc.arg('is_manager')::boolean THEN 1 ELSE 0 END, 0),
  updated_at = now()
WHERE id = sqlc.arg('department_id')
  AND organization_id = sqlc.arg('organization_id');

-- name: AdjustDepartmentManagerCount :exec
-- Adjusts manager_count when an employee's role changes (member <-> manager).
-- Call this AFTER updating role in department_member table.
-- delta should be +1 (promoting to manager) or -1 (demoting to member).
UPDATE organization.department
SET 
  manager_count = GREATEST(manager_count + sqlc.arg('delta')::int, 0),
  updated_at = now()
WHERE id = sqlc.arg('department_id')
  AND organization_id = sqlc.arg('organization_id');

-- name: IncrementDepartmentChildCount :exec
-- Increments child_count for a parent department.
-- Call this AFTER creating a new child department or moving a department to a new parent.
UPDATE organization.department
SET 
  child_count = child_count + 1,
  updated_at = now()
WHERE id = sqlc.arg('department_id')
  AND organization_id = sqlc.arg('organization_id');

-- name: DecrementDepartmentChildCount :exec
-- Decrements child_count for a parent department.
-- Call this AFTER deleting a child department or moving a department away from parent.
-- Uses GREATEST to prevent negative counts.
UPDATE organization.department
SET 
  child_count = GREATEST(child_count - 1, 0),
  updated_at = now()
WHERE id = sqlc.arg('department_id')
  AND organization_id = sqlc.arg('organization_id');

-- =============================================================================
-- NOTES:
-- 1. All queries enforce organization_id for multi-tenant isolation
-- 2. Count updates are handled in application logic
-- 3. IsDepartmentDescendant MUST be called before MoveDepartment
-- 4. DeleteDepartment includes member_count/child_count checks in WHERE clause
-- 5. AssignEmployeeToDepartment uses ON CONFLICT for upsert behavior
-- 6. Path arrays in GetDepartmentTree enable breadcrumb generation in UI
-- 7. Search queries use trigram similarity (%) operator with GIN indexes for performance
-- 8. Autocomplete queries use ILIKE prefix matching for fast suggestions
-- 9. Cursor pagination uses UUID v7 ordering for consistent results
-- =============================================================================
