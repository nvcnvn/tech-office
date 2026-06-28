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
    id,
    organization_id,
    name,
    description,
    parent_department_id,
    member_count,
    manager_count,
    child_count,
    updated_at,
    ARRAY[id] as path,
    0 as depth,
    name::TEXT as full_path
  FROM organization.department
  WHERE organization_id = $1 AND parent_department_id IS NULL
  
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
  JOIN department_tree dt ON d.parent_department_id = dt.id
  WHERE d.organization_id = $1
)
SELECT 
  id,
  organization_id,
  name,
  description,
  parent_department_id,
  member_count,
  manager_count,
  child_count,
  updated_at,
  path,
  depth,
  full_path
FROM department_tree 
ORDER BY path;

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
-- Trigger automatically updates parent's child_count.
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
-- Trigger automatically updates old/new parent child_counts.
UPDATE organization.department
SET 
  parent_department_id = $2,
  updated_at = now()
WHERE id = $1
  AND organization_id = $3
RETURNING *;

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
  e.first_name as employee_first_name,
  e.last_name as employee_last_name,
  e.email as employee_email
FROM organization.department_member dm
JOIN organization.employee e ON dm.employee_id = e.id
WHERE dm.department_id = $1 
  AND dm.organization_id = $2
ORDER BY 
  CASE WHEN dm.role = 'manager' THEN 0 ELSE 1 END,
  e.last_name, 
  e.first_name;

-- name: GetUnassignedEmployees :many
-- Lists employees not assigned to any department.
-- Used by managers to see available employees for assignment.
SELECT 
  e.id,
  e.first_name,
  e.last_name,
  e.email
FROM organization.employee e
WHERE e.organization_id = $1
  AND NOT EXISTS (
    SELECT 1 FROM organization.department_member dm
    WHERE dm.employee_id = e.id 
      AND dm.organization_id = $1
  )
ORDER BY e.last_name, e.first_name;

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
JOIN organization.department d ON dm.department_id = d.id
WHERE dm.employee_id = $1 
  AND dm.organization_id = $2;

-- name: AssignEmployeeToDepartment :one
-- Assigns employee to department with specified role.
-- Uses ON CONFLICT to handle employee already assigned (moves to new department).
-- Trigger automatically updates counts for old/new departments.
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
  updated_at = now()
RETURNING *;

-- name: RemoveEmployeeFromDepartment :exec
-- Removes employee from their current department.
-- Trigger automatically decrements department counts.
DELETE FROM organization.department_member
WHERE employee_id = $1
  AND organization_id = $2;

-- name: SetDepartmentManager :one
-- Updates employee role to 'manager' in their department.
-- Employee must already be a member of the department.
UPDATE organization.department_member
SET 
  role = 'manager',
  updated_at = now()
WHERE department_id = $1
  AND employee_id = $2
  AND organization_id = $3
RETURNING *;

-- name: ClearDepartmentManager :exec
-- Removes manager designation from all employees in department.
-- (Demotes managers to regular members)
UPDATE organization.department_member
SET 
  role = 'member',
  updated_at = now()
WHERE department_id = $1
  AND organization_id = $2
  AND role = 'manager';

-- =============================================================================
-- VALIDATION QUERIES
-- =============================================================================

-- name: IsDepartmentDescendant :one
-- Checks if target_parent is a descendant of department_to_move.
-- Returns TRUE if moving would create a circular reference (invalid).
-- Must be called BEFORE MoveDepartment to prevent circular references.
WITH RECURSIVE descendants AS (
  -- Start with department being moved
  SELECT id, parent_department_id
  FROM organization.department
  WHERE id = $1 AND organization_id = $2
  
  UNION ALL
  
  -- Recursively find all descendants
  SELECT d.id, d.parent_department_id
  FROM organization.department d
  JOIN descendants desc ON d.parent_department_id = desc.id
  WHERE d.organization_id = $2
)
SELECT EXISTS (
  SELECT 1 FROM descendants WHERE id = $3
) as is_descendant;

-- name: IsDepartmentManager :one
-- Checks if user is a manager of the specified department.
-- Used for custom authorization logic.
SELECT EXISTS (
  SELECT 1 FROM organization.department_member
  WHERE department_id = $1
    AND employee_id = $2
    AND organization_id = $3
    AND role = 'manager'
) as is_manager;

-- name: DepartmentHasMembers :one
-- Checks if department has any members (for delete validation).
SELECT EXISTS (
  SELECT 1 FROM organization.department_member
  WHERE department_id = $1
    AND organization_id = $2
) as has_members;

-- name: DepartmentHasChildren :one
-- Checks if department has child departments (for delete validation).
SELECT EXISTS (
  SELECT 1 FROM organization.department
  WHERE parent_department_id = $1
    AND organization_id = $2
) as has_children;

-- name: GetDepartmentChildIDs :many
-- Gets all immediate child department IDs for a parent.
-- Used for bulk operations or validation.
SELECT id
FROM organization.department
WHERE parent_department_id = $1
  AND organization_id = $2
ORDER BY name;

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

-- name: GetDepartmentStats :one
-- Gets aggregate statistics for a department (for dashboard).
SELECT 
  COUNT(DISTINCT dm.employee_id) as total_members,
  COUNT(DISTINCT CASE WHEN dm.role = 'manager' THEN dm.employee_id END) as total_managers,
  COUNT(DISTINCT child.id) as total_children
FROM organization.department dept
LEFT JOIN organization.department_member dm ON dept.id = dm.department_id
LEFT JOIN organization.department child ON dept.id = child.parent_department_id
WHERE dept.id = $1
  AND dept.organization_id = $2
GROUP BY dept.id;

-- =============================================================================
-- NOTES:
-- 1. All queries enforce organization_id for multi-tenant isolation
-- 2. Triggers automatically maintain cached counts (no manual updates needed)
-- 3. IsDepartmentDescendant MUST be called before MoveDepartment
-- 4. DeleteDepartment includes member_count/child_count checks in WHERE clause
-- 5. AssignEmployeeToDepartment uses ON CONFLICT for upsert behavior
-- 6. Path arrays in GetDepartmentTree enable breadcrumb generation in UI
-- =============================================================================
