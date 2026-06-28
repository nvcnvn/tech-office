# Data Model: Organization Departments Management

**Feature**: Organization Departments Management (spec-006)  
**Date**: October 27, 2025  
**Status**: Complete  
**Database**: PostgreSQL 18+

## Schema Overview

This feature extends the existing `organization.department` and `organization.department_member` tables to support hierarchical tree structures with parent-child relationships and cached member counts for performance optimization.

**Schema**: `organization`  
**Tables Modified**: `department`, `department_member`  
**New Tables**: None  
**Triggers Added**: `update_department_member_count`, `update_department_child_count`

## Table Modifications

### organization.department (EXISTING - MODIFICATIONS)

**Purpose**: Represents organizational departments with hierarchical tree structure support.

**Existing Schema** (backend/database/scripts/schema.sql lines 70-79):
```sql
CREATE TABLE IF NOT EXISTS organization.department (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    organization_id UUID REFERENCES public.organization(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE organization.department ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation_policy ON organization.department USING (organization_id = current_setting('user.organization_id')::UUID);
```

**New Columns to ADD**:
```sql
-- Add parent-child relationship for tree structure
ALTER TABLE organization.department 
ADD COLUMN IF NOT EXISTS parent_department_id UUID REFERENCES organization.department(id) ON DELETE RESTRICT;

-- Add cached counts for performance (avoid COUNT queries in tree views)
ALTER TABLE organization.department 
ADD COLUMN IF NOT EXISTS member_count INT NOT NULL DEFAULT 0;

ALTER TABLE organization.department 
ADD COLUMN IF NOT EXISTS manager_count INT NOT NULL DEFAULT 0;

ALTER TABLE organization.department 
ADD COLUMN IF NOT EXISTS child_count INT NOT NULL DEFAULT 0;

-- Prevent self-referencing (department cannot be its own parent)
ALTER TABLE organization.department 
ADD CONSTRAINT IF NOT EXISTS no_self_reference CHECK (parent_department_id IS NULL OR parent_department_id != id);

-- Index for efficient tree traversal queries
CREATE INDEX IF NOT EXISTS idx_department_parent ON organization.department(parent_department_id) WHERE parent_department_id IS NOT NULL;

-- Index for organization + parent lookups (common query pattern)
CREATE INDEX IF NOT EXISTS idx_department_org_parent ON organization.department(organization_id, parent_department_id);
```

**Complete Schema After Modifications**:
```sql
CREATE TABLE IF NOT EXISTS organization.department (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    parent_department_id UUID REFERENCES organization.department(id) ON DELETE RESTRICT,
    member_count INT NOT NULL DEFAULT 0,
    manager_count INT NOT NULL DEFAULT 0,
    child_count INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT no_self_reference CHECK (parent_department_id IS NULL OR parent_department_id != id)
);
```

**Field Descriptions**:
- `id`: Primary key (UUID v7)
- `organization_id`: Foreign key to organization (multi-tenant isolation)
- `name`: Department name (e.g., "Engineering", "Sales", "Engineering > Backend")
- `description`: Optional description of department purpose/responsibilities
- `parent_department_id`: Self-referencing FK for tree structure; NULL = root department
- `member_count`: Cached count of employees in this department (updated by trigger)
- `manager_count`: Cached count of managers (0 or 1 expected, but INT for flexibility)
- `child_count`: Cached count of child departments (updated by trigger)
- `updated_at`: Timestamp of last modification

**ON DELETE Behavior**:
- `organization_id`: CASCADE (delete departments when organization deleted)
- `parent_department_id`: RESTRICT (prevent deletion of parent if children exist - must restructure first)

**Rationale for RESTRICT on parent deletion**:
- Prevents accidental data loss (must explicitly move children before deleting parent)
- Forces intentional reorganization before deletion
- Aligns with spec requirement: "Block deletion if department has any members"

### organization.department_member (EXISTING - NO MODIFICATIONS)

**Purpose**: Represents employee membership in departments with role designation (member or manager).

**Existing Schema** (backend/database/scripts/schema.sql lines 81-92):
```sql
CREATE TABLE IF NOT EXISTS organization.department_member (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    organization_id UUID REFERENCES public.organization(id) ON DELETE CASCADE,
    department_id UUID REFERENCES organization.department(id) ON DELETE CASCADE,
    employee_id UUID REFERENCES organization.employee(id) ON DELETE CASCADE,
    role TEXT CHECK (role IN ('member', 'manager')) NOT NULL DEFAULT 'member',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (department_id, employee_id)
);

ALTER TABLE organization.department_member ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation_policy ON organization.department_member USING (organization_id = current_setting('user.organization_id')::UUID);
```

**Additional Constraint to ADD**:
```sql
-- Enforce single department membership per employee across organization
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_department_per_employee 
ON organization.department_member(organization_id, employee_id);
```

**Field Descriptions**:
- `id`: Primary key (UUID v7)
- `organization_id`: Foreign key to organization (multi-tenant isolation)
- `department_id`: Foreign key to department (which department employee belongs to)
- `employee_id`: Foreign key to employee (which employee is a member)
- `role`: 'member' (standard employee) or 'manager' (department manager)
- `updated_at`: Timestamp of last modification

**Existing Constraints**:
- `UNIQUE (department_id, employee_id)`: Employee cannot be added to same department twice
- `CHECK (role IN ('member', 'manager'))`: Only valid roles allowed

**New Constraint**:
- `UNIQUE (organization_id, employee_id)`: Employee can only belong to ONE department in organization

**ON DELETE Behavior**:
- `organization_id`: CASCADE (delete memberships when organization deleted)
- `department_id`: CASCADE (delete memberships when department deleted)
- `employee_id`: CASCADE (delete memberships when employee deleted)

**Rationale for employee_id CASCADE**:
- When employee leaves organization, automatically remove from department
- Cached counts automatically updated by trigger
- Prevents orphaned department memberships

## Database Triggers

### Trigger 1: update_department_member_count

**Purpose**: Automatically update member_count and manager_count when employees added/removed/moved.

```sql
-- Trigger function to maintain member_count and manager_count
CREATE OR REPLACE FUNCTION organization.update_department_member_count()
RETURNS TRIGGER AS $$
BEGIN
  -- INSERT: Employee added to department
  IF TG_OP = 'INSERT' THEN
    UPDATE organization.department 
    SET member_count = member_count + 1,
        manager_count = manager_count + CASE WHEN NEW.role = 'manager' THEN 1 ELSE 0 END,
        updated_at = now()
    WHERE id = NEW.department_id;
    RETURN NEW;
  
  -- DELETE: Employee removed from department
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE organization.department 
    SET member_count = GREATEST(member_count - 1, 0),
        manager_count = GREATEST(manager_count - CASE WHEN OLD.role = 'manager' THEN 1 ELSE 0 END, 0),
        updated_at = now()
    WHERE id = OLD.department_id;
    RETURN OLD;
  
  -- UPDATE: Role changed (member <-> manager) or employee moved between departments
  ELSIF TG_OP = 'UPDATE' THEN
    -- If employee moved to different department
    IF OLD.department_id != NEW.department_id THEN
      -- Decrement counts in old department
      UPDATE organization.department 
      SET member_count = GREATEST(member_count - 1, 0),
          manager_count = GREATEST(manager_count - CASE WHEN OLD.role = 'manager' THEN 1 ELSE 0 END, 0),
          updated_at = now()
      WHERE id = OLD.department_id;
      
      -- Increment counts in new department
      UPDATE organization.department 
      SET member_count = member_count + 1,
          manager_count = manager_count + CASE WHEN NEW.role = 'manager' THEN 1 ELSE 0 END,
          updated_at = now()
      WHERE id = NEW.department_id;
    
    -- If only role changed (member <-> manager in same department)
    ELSIF OLD.role != NEW.role THEN
      UPDATE organization.department 
      SET manager_count = manager_count + CASE 
          WHEN NEW.role = 'manager' THEN 1  -- member promoted to manager
          ELSE -1  -- manager demoted to member
        END,
        updated_at = now()
      WHERE id = NEW.department_id;
    END IF;
    
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to department_member table
DROP TRIGGER IF EXISTS trigger_update_department_member_count ON organization.department_member;
CREATE TRIGGER trigger_update_department_member_count
AFTER INSERT OR UPDATE OR DELETE ON organization.department_member
FOR EACH ROW EXECUTE FUNCTION organization.update_department_member_count();
```

**Trigger Behavior**:
- **INSERT**: Increment member_count by 1, increment manager_count if role='manager'
- **DELETE**: Decrement member_count by 1, decrement manager_count if role='manager'
- **UPDATE (department change)**: Decrement old department counts, increment new department counts
- **UPDATE (role change)**: Update manager_count (+1 if promoted to manager, -1 if demoted)

**Safety Features**:
- `GREATEST(..., 0)` prevents negative counts from race conditions or data inconsistencies
- `updated_at = now()` updates department timestamp whenever membership changes
- AFTER trigger ensures department/employee exists before updating counts

### Trigger 2: update_department_child_count

**Purpose**: Automatically update child_count when departments created/moved/deleted.

```sql
-- Trigger function to maintain child_count
CREATE OR REPLACE FUNCTION organization.update_department_child_count()
RETURNS TRIGGER AS $$
BEGIN
  -- INSERT: New department with parent
  IF TG_OP = 'INSERT' AND NEW.parent_department_id IS NOT NULL THEN
    UPDATE organization.department 
    SET child_count = child_count + 1,
        updated_at = now()
    WHERE id = NEW.parent_department_id;
    RETURN NEW;
  
  -- DELETE: Department removed from parent
  ELSIF TG_OP = 'DELETE' AND OLD.parent_department_id IS NOT NULL THEN
    UPDATE organization.department 
    SET child_count = GREATEST(child_count - 1, 0),
        updated_at = now()
    WHERE id = OLD.parent_department_id;
    RETURN OLD;
  
  -- UPDATE: Department moved to different parent
  ELSIF TG_OP = 'UPDATE' AND OLD.parent_department_id IS DISTINCT FROM NEW.parent_department_id THEN
    -- Decrement old parent's child_count
    IF OLD.parent_department_id IS NOT NULL THEN
      UPDATE organization.department 
      SET child_count = GREATEST(child_count - 1, 0),
          updated_at = now()
      WHERE id = OLD.parent_department_id;
    END IF;
    
    -- Increment new parent's child_count
    IF NEW.parent_department_id IS NOT NULL THEN
      UPDATE organization.department 
      SET child_count = child_count + 1,
          updated_at = now()
      WHERE id = NEW.parent_department_id;
    END IF;
    
    RETURN NEW;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to department table
DROP TRIGGER IF EXISTS trigger_update_department_child_count ON organization.department;
CREATE TRIGGER trigger_update_department_child_count
AFTER INSERT OR UPDATE OR DELETE ON organization.department
FOR EACH ROW EXECUTE FUNCTION organization.update_department_child_count();
```

**Trigger Behavior**:
- **INSERT with parent**: Increment parent's child_count
- **DELETE with parent**: Decrement parent's child_count
- **UPDATE (parent change)**: Decrement old parent child_count, increment new parent child_count
- **UPDATE (other fields)**: No action if parent_department_id unchanged

**Safety Features**:
- `IS DISTINCT FROM` handles NULL correctly (different from `!=`)
- `GREATEST(..., 0)` prevents negative counts
- Separate IF blocks for old/new parent handle moving to/from root level

## Indexes

### Performance Indexes

```sql
-- Tree traversal (parent -> children queries)
CREATE INDEX IF NOT EXISTS idx_department_parent 
ON organization.department(parent_department_id) 
WHERE parent_department_id IS NOT NULL;

-- Organization + parent lookups (common in tenant queries)
CREATE INDEX IF NOT EXISTS idx_department_org_parent 
ON organization.department(organization_id, parent_department_id);

-- Employee department membership lookups
CREATE INDEX IF NOT EXISTS idx_department_member_employee 
ON organization.department_member(employee_id);

-- Department members list (fast member retrieval for tree display)
CREATE INDEX IF NOT EXISTS idx_department_member_dept 
ON organization.department_member(department_id, role);
```

**Index Rationale**:
- `idx_department_parent`: Supports "get children of department X" queries (tree expansion)
- `idx_department_org_parent`: Supports "get all departments in organization" with parent filtering
- `idx_department_member_employee`: Supports "which department does employee belong to?" queries
- `idx_department_member_dept`: Supports "list members/managers of department" queries with role filtering

### Constraint Indexes (automatically created)

```sql
-- Primary keys (automatic)
organization.department(id)
organization.department_member(id)

-- Unique constraints (automatic)
organization.department_member(department_id, employee_id)
organization.department_member(organization_id, employee_id)

-- Foreign keys (automatic by PostgreSQL)
organization.department(organization_id)
organization.department(parent_department_id)
organization.department_member(organization_id)
organization.department_member(department_id)
organization.department_member(employee_id)
```

## Query Patterns

### Query 1: Get Department Tree for Organization

**Use Case**: Display full department hierarchy in tree view.

**sqlc Query** (backend/database/scripts/organization.query.sql):
```sql
-- name: GetDepartmentTree :many
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
SELECT * FROM department_tree 
ORDER BY path;
```

**Returns**: Flattened tree with path, depth, and full_path for each department.

### Query 2: Check Circular Reference (Descendant Check)

**Use Case**: Validate department move doesn't create circular reference.

**sqlc Query**:
```sql
-- name: IsDepartmentDescendant :one
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
```

**Parameters**: 
- $1: department_to_move_id
- $2: organization_id
- $3: target_parent_id

**Returns**: TRUE if target_parent is a descendant of department_to_move (invalid move).

### Query 3: Get Department Members

**Use Case**: List all employees in a department with role.

**sqlc Query**:
```sql
-- name: GetDepartmentMembers :many
SELECT 
  dm.id,
  dm.employee_id,
  dm.role,
  e.first_name,
  e.last_name,
  e.email
FROM organization.department_member dm
JOIN organization.employee e ON dm.employee_id = e.id
WHERE dm.department_id = $1 
  AND dm.organization_id = $2
ORDER BY 
  CASE WHEN dm.role = 'manager' THEN 0 ELSE 1 END,  -- Managers first
  e.last_name, e.first_name;
```

**Returns**: Members with manager at top, sorted alphabetically.

### Query 4: Get Unassigned Employees

**Use Case**: Show employees available for department assignment (manager can add).

**sqlc Query**:
```sql
-- name: GetUnassignedEmployees :many
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
```

**Returns**: Employees not assigned to any department.

### Query 5: Check If User Is Department Manager

**Use Case**: Validate if user has manager permissions for a department.

**sqlc Query**:
```sql
-- name: IsDepartmentManager :one
SELECT EXISTS (
  SELECT 1 FROM organization.department_member
  WHERE department_id = $1
    AND employee_id = $2
    AND organization_id = $3
    AND role = 'manager'
) as is_manager;
```

**Parameters**:
- $1: department_id
- $2: employee_id (user making request)
- $3: organization_id

**Returns**: TRUE if user is manager of the department.

### Query 6: Create Department

**Use Case**: Create new department with optional parent.

**sqlc Query**:
```sql
-- name: CreateDepartment :one
INSERT INTO organization.department (
  id,
  organization_id,
  name,
  description,
  parent_department_id
) VALUES (
  uuidv7(),
  $1,
  $2,
  $3,
  $4
) RETURNING *;
```

**Note**: Trigger automatically updates parent's child_count if parent_department_id provided.

### Query 7: Move Department to New Parent

**Use Case**: Restructure department hierarchy.

**sqlc Query**:
```sql
-- name: MoveDepartment :exec
UPDATE organization.department
SET parent_department_id = $2,
    updated_at = now()
WHERE id = $1
  AND organization_id = $3;
```

**Note**: 
- Must run circular reference check before executing this query
- Trigger automatically updates old/new parent child_counts

### Query 8: Delete Department (with validation)

**Use Case**: Remove empty department from organization.

**sqlc Query**:
```sql
-- name: DeleteDepartment :exec
DELETE FROM organization.department
WHERE id = $1
  AND organization_id = $2
  AND member_count = 0  -- Enforce no members
  AND child_count = 0;  -- Enforce no children (or remove for cascade)
```

**Note**: 
- Query fails (0 rows affected) if department has members or children
- Application should check member_count/child_count before attempting delete
- Trigger automatically updates parent's child_count on successful delete

### Query 9: Assign Employee to Department

**Use Case**: Add employee to department as member or manager.

**sqlc Query**:
```sql
-- name: AssignEmployeeToDepartment :one
INSERT INTO organization.department_member (
  id,
  organization_id,
  department_id,
  employee_id,
  role
) VALUES (
  uuidv7(),
  $1,
  $2,
  $3,
  $4
) 
ON CONFLICT (organization_id, employee_id) DO UPDATE
SET department_id = EXCLUDED.department_id,
    role = EXCLUDED.role,
    updated_at = now()
RETURNING *;
```

**Note**: 
- ON CONFLICT handles case where employee already assigned (moves to new department)
- Trigger updates counts for both old/new departments
- Unique constraint ensures single department membership

### Query 10: Remove Employee from Department

**Use Case**: Unassign employee from their current department.

**sqlc Query**:
```sql
-- name: RemoveEmployeeFromDepartment :exec
DELETE FROM organization.department_member
WHERE employee_id = $1
  AND organization_id = $2;
```

**Note**: Trigger automatically decrements department counts.

## Migration Strategy

### Atlas Migration

Schema changes will be managed by Atlas migration system (existing pattern in Tech Office).

**Steps**:
1. Update `backend/database/scripts/schema.sql` with all table modifications, trigger functions, and indexes
2. Run `atlas migrate diff add_department_hierarchy --env dev` to generate migration
3. Review generated migration files for correctness
4. Apply migration: `atlas migrate apply --env dev`
5. Run `sqlc generate` to regenerate Go models and query methods
6. Commit schema.sql, migration files, and generated Go code together

### Backward Compatibility

**Existing Data**:
- Current department and department_member records remain valid
- New columns have sensible defaults (NULL for parent, 0 for counts)
- RLS policies already in place (no changes needed)

**Count Initialization**:
After adding cached count columns, run one-time update to set correct values:
```sql
-- Initialize member_count and manager_count
UPDATE organization.department d
SET member_count = (
  SELECT COUNT(*) FROM organization.department_member dm 
  WHERE dm.department_id = d.id
),
manager_count = (
  SELECT COUNT(*) FROM organization.department_member dm 
  WHERE dm.department_id = d.id AND dm.role = 'manager'
),
child_count = (
  SELECT COUNT(*) FROM organization.department child
  WHERE child.parent_department_id = d.id
);
```

**Rollback Plan**:
If migration must be rolled back:
1. Remove triggers: `DROP TRIGGER IF EXISTS ...`
2. Remove trigger functions: `DROP FUNCTION IF EXISTS ...`
3. Remove indexes: `DROP INDEX IF EXISTS ...`
4. Remove constraints: `ALTER TABLE ... DROP CONSTRAINT ...`
5. Remove columns: `ALTER TABLE ... DROP COLUMN ...`

Existing data (id, organization_id, name, description) remains intact.

## Testing Strategy

### Unit Tests (Go)
- Test trigger behavior with INSERT/UPDATE/DELETE scenarios
- Test circular reference detection query
- Test tree traversal query with nested departments
- Test count accuracy after complex operations

### Integration Tests (Go)
- Multi-tenant isolation: Departments from different orgs don't leak
- Cascade deletes: Organization deletion removes all departments
- Unique constraint: Employee cannot join multiple departments
- RESTRICT constraint: Cannot delete parent with children

### Performance Tests
- Tree query performance with 500 departments (10 levels deep)
- Bulk employee assignment (100 employees to departments)
- Concurrent department moves (race condition testing)

## Security Considerations

### Row-Level Security (RLS)
- Already enabled on both tables
- Policies enforce organization_id isolation
- All queries use TenantPool with organization context

### Injection Prevention
- All queries use parameterized sqlc queries (no string concatenation)
- CHECK constraints prevent invalid role values
- Foreign key constraints ensure referential integrity

### Authorization
- ROLE_OWNER/ROLE_OPERATOR: Full department CRUD via proto-level access control
- Department managers: Limited to adding unassigned employees to their own department
- Regular employees: Read-only access to department tree

## Summary

**Schema Changes**:
- Add 4 columns to organization.department: parent_department_id, member_count, manager_count, child_count
- Add 1 unique constraint to department_member: (organization_id, employee_id)
- Add 2 triggers: update_department_member_count, update_department_child_count
- Add 4 indexes for query performance

**Key Design Decisions**:
- Self-referencing foreign key for tree structure (industry standard pattern)
- Cached counts maintained by triggers (avoid expensive COUNT queries)
- Recursive CTEs for tree traversal (PostgreSQL native optimization)
- Circular reference prevention via application-level validation (clear error messages)
- Single department membership enforced by unique constraint (data integrity)

**Performance Profile**:
- Tree query: O(n) where n = number of departments (single CTE query)
- Count updates: O(1) via triggers (only affected rows updated)
- Circular check: O(d) where d = depth of department subtree
- Index lookups: O(log n) for parent/employee/department queries

**Next Steps**:
- Create RPC contracts (department.proto)
- Implement sqlc queries in organization.query.sql
- Generate Go models and query methods
- Implement DepartmentService with AdminPool/TenantPool
