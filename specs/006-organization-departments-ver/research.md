# Research: Organization Departments Management

**Feature**: Organization Departments Management (spec-006)  
**Date**: October 27, 2025  
**Status**: Complete

## Research Questions

### 1. Database Schema Extension Strategy

**Question**: How should we extend the existing `organization.department` and `organization.department_member` tables to support hierarchical tree structure and cached counts?

**Decision**: Add columns to existing tables via ALTER TABLE statements:
- `organization.department`: Add `parent_department_id UUID REFERENCES organization.department(id)`, `member_count INT DEFAULT 0`, `manager_count INT DEFAULT 0`, `child_count INT DEFAULT 0`
- Keep existing `organization.department_member` structure (already has role field for 'member'/'manager')
- Add CHECK constraint to prevent self-referencing: `CHECK (parent_department_id IS NULL OR parent_department_id != id)`
- Add index on `parent_department_id` for tree traversal queries
- Add unique constraint: `UNIQUE (organization_id, employee_id)` to enforce single department membership

**Rationale**: 
- Tables already exist in schema.sql (lines 70-96) with proper multi-tenant isolation
- Parent-child relationship via self-referencing foreign key is standard pattern for tree structures
- Cached counts avoid expensive COUNT queries when displaying tree view with warning indicators
- Existing role field ('member'/'manager') already handles manager designation

**Alternatives Considered**:
- Materialized path pattern: Rejected due to complexity of updates when moving subtrees
- Closure table pattern: Rejected as overkill for unlimited depth with good index support
- Separate department_hierarchy table: Rejected to avoid denormalization

**Existing Patterns to Follow**:
- Reference: `backend/database/scripts/schema.sql` lines 70-96 for existing department tables
- Multi-tenant isolation: Already enforced via organization_id FK and RLS policies
- UUID v7 primary keys: Already in place
- Timestamp: updated_at already present

### 2. Tree Traversal Query Strategy

**Question**: What is the most efficient way to query department hierarchies in PostgreSQL for tree views?

**Decision**: Use PostgreSQL recursive CTEs (Common Table Expressions) for tree queries:
```sql
-- Get full department tree for organization
WITH RECURSIVE department_tree AS (
  -- Root departments (no parent)
  SELECT id, name, description, parent_department_id, member_count, manager_count, child_count, 
         ARRAY[id] as path, 0 as depth
  FROM organization.department
  WHERE organization_id = $1 AND parent_department_id IS NULL
  
  UNION ALL
  
  -- Child departments
  SELECT d.id, d.name, d.description, d.parent_department_id, d.member_count, d.manager_count, d.child_count,
         dt.path || d.id, dt.depth + 1
  FROM organization.department d
  JOIN department_tree dt ON d.parent_department_id = dt.id
  WHERE d.organization_id = $1
)
SELECT * FROM department_tree ORDER BY path;
```

**Rationale**:
- Recursive CTEs are native PostgreSQL feature optimized for hierarchical queries
- Single query retrieves entire tree (efficient for <500 departments)
- Path array enables cycle detection and breadcrumb generation
- Depth tracking enables UI indentation rendering
- ORDER BY path provides depth-first ordering suitable for tree display

**Alternatives Considered**:
- Multiple queries with parent_id iteration: Too many round trips for deep trees
- Adjacency list with client-side recursion: Inefficient for large trees
- Nested sets model: Complex updates when moving departments

**Existing Patterns to Follow**:
- sqlc query annotations: Use `-- name: GetDepartmentTree :many` in organization.query.sql
- Always include organization_id in WHERE clause for tenant isolation
- Return flattened results with path/depth metadata for client-side tree building

### 3. Cached Count Maintenance Strategy

**Question**: How should we maintain member_count, manager_count, and child_count columns to avoid stale data?

**Decision**: Use PostgreSQL triggers to automatically update cached counts on department_member and department changes:
```sql
-- Trigger function to update member_count when department_member changes
CREATE OR REPLACE FUNCTION update_department_member_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE organization.department 
    SET member_count = member_count + 1,
        manager_count = manager_count + CASE WHEN NEW.role = 'manager' THEN 1 ELSE 0 END
    WHERE id = NEW.department_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE organization.department 
    SET member_count = member_count - 1,
        manager_count = manager_count - CASE WHEN OLD.role = 'manager' THEN 1 ELSE 0 END
    WHERE id = OLD.department_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.department_id != NEW.department_id THEN
    -- Employee moved between departments
    UPDATE organization.department 
    SET member_count = member_count - 1,
        manager_count = manager_count - CASE WHEN OLD.role = 'manager' THEN 1 ELSE 0 END
    WHERE id = OLD.department_id;
    UPDATE organization.department 
    SET member_count = member_count + 1,
        manager_count = manager_count + CASE WHEN NEW.role = 'manager' THEN 1 ELSE 0 END
    WHERE id = NEW.department_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger function to update child_count when parent_department_id changes
CREATE OR REPLACE FUNCTION update_department_child_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.parent_department_id IS NOT NULL THEN
    UPDATE organization.department 
    SET child_count = child_count + 1
    WHERE id = NEW.parent_department_id;
  ELSIF TG_OP = 'DELETE' AND OLD.parent_department_id IS NOT NULL THEN
    UPDATE organization.department 
    SET child_count = child_count - 1
    WHERE id = OLD.parent_department_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.parent_department_id IS DISTINCT FROM NEW.parent_department_id THEN
    -- Department moved to different parent
    IF OLD.parent_department_id IS NOT NULL THEN
      UPDATE organization.department SET child_count = child_count - 1 WHERE id = OLD.parent_department_id;
    END IF;
    IF NEW.parent_department_id IS NOT NULL THEN
      UPDATE organization.department SET child_count = child_count + 1 WHERE id = NEW.parent_department_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

**Rationale**:
- Triggers ensure counts always synchronized with actual data (no stale cache)
- Database-level enforcement prevents count drift from application bugs
- Eliminates need for COUNT queries when displaying tree view with warnings
- Performance: Updates are atomic and only affect changed rows

**Alternatives Considered**:
- Application-level count updates: Risk of drift due to bugs or race conditions
- Periodic background recalculation: Stale data between runs, complex scheduling
- Real-time COUNT queries: Too expensive for tree views with many departments

**Existing Patterns to Follow**:
- Add trigger creation to schema.sql after table definitions
- Use IF NOT EXISTS for idempotent migrations
- Test trigger behavior in integration tests with multi-tenant data

### 4. Circular Reference Prevention

**Question**: How do we prevent circular references when moving departments (e.g., making a parent a child of its descendant)?

**Decision**: Implement validation in application layer using recursive CTE query before department move:
```sql
-- Check if target_parent is a descendant of department_to_move
WITH RECURSIVE descendants AS (
  SELECT id, parent_department_id
  FROM organization.department
  WHERE id = $1 AND organization_id = $2  -- department_to_move
  
  UNION ALL
  
  SELECT d.id, d.parent_department_id
  FROM organization.department d
  JOIN descendants desc ON d.parent_department_id = desc.id
  WHERE d.organization_id = $2
)
SELECT EXISTS (SELECT 1 FROM descendants WHERE id = $3);  -- target_parent
```

If query returns true, reject the move operation with error "Cannot move department to its own descendant".

**Rationale**:
- Database CHECK constraints cannot prevent circular references in hierarchical data (require recursive logic)
- Application-level validation provides clear error messages to users
- Recursive CTE efficiently checks entire descendant chain
- Validation happens before transaction commit, preventing invalid state

**Alternatives Considered**:
- Database trigger-based validation: Complex to implement correctly, harder to maintain
- Client-side validation only: Unsafe, allows circumvention via direct API calls
- Path array column with CHECK constraint: Adds storage overhead and complex updates

**Existing Patterns to Follow**:
- Add validation query to organization.query.sql: `-- name: IsDepartmentDescendant :one`
- Call validation in service method before executing move operation
- Use txn.WithTxn to ensure validation and move are atomic
- Return descriptive gRPC error: `connect.NewError(connect.CodeInvalidArgument, errors.New("cannot move to descendant"))`

### 5. Manager Permission Enforcement

**Question**: How should we differentiate between ROLE_OWNER/ROLE_OPERATOR permissions and department manager permissions?

**Decision**: Two-layer authorization approach:
1. **Proto-level RBAC** for OWNER/OPERATOR operations (delete, rename, move departments, move employees):
```protobuf
rpc DeleteDepartment(DeleteDepartmentRequest) returns (DeleteDepartmentResponse) {
  option (rpc.v1.access_control) = {
    allowed_roles: [ROLE_OWNER, ROLE_OPERATOR]
    allow_unauthenticated: false
  };
}
```

2. **Custom application logic** for manager-specific permissions (add unassigned employees to own department):
```go
func (s *DepartmentService) AddEmployeeToDepartment(ctx context.Context, req *connect.Request[v1.AddEmployeeToDepartmentRequest]) (*connect.Response[v1.AddEmployeeToDepartmentResponse], error) {
    // Extract user identity from auth token
    userID := getUserIDFromContext(ctx)
    orgID := getOrgIDFromContext(ctx)
    
    // Check if user is department manager
    isManager, err := s.Queries.IsDepartmentManager(ctx, s.TenantPool, database.IsDepartmentManagerParams{
        OrganizationID: orgID,
        DepartmentID: req.Msg.DepartmentId,
        EmployeeID: userID,
    })
    if err != nil {
        return nil, err
    }
    
    // If not manager, require OWNER/OPERATOR role
    if !isManager {
        if !hasRole(ctx, ROLE_OWNER) && !hasRole(ctx, ROLE_OPERATOR) {
            return nil, connect.NewError(connect.CodePermissionDenied, errors.New("insufficient permissions"))
        }
    }
    
    // Validate employee is unassigned
    // Execute add operation
}
```

**Rationale**:
- Proto-level access control handles simple role checks declaratively
- Custom logic needed for context-dependent permissions (manager of THIS department)
- Separation of concerns: RBAC system handles roles, application handles resource-specific permissions
- Clear error messages differentiate between role-based and resource-based denials

**Alternatives Considered**:
- Make "department manager" a system role in Zitadel: Inflexible, creates role explosion with many departments
- Permission inheritance through tree: Explicitly rejected in spec (FR-017)
- Resource-level permissions in Zitadel: Adds complexity, department manager is organizational concept not auth concept

**Existing Patterns to Follow**:
- Reference: `backend/internal/organization/organization.go` for RBAC patterns with Zitadel
- Use auth interceptor to extract user identity and organization context from token
- Add sqlc query `-- name: IsDepartmentManager :one` to check manager status
- Decompose handler into `validateManagerPermission(ctx, departmentID)` private method

### 6. Frontend Tree View Component Strategy

**Question**: What is the best approach for rendering and interacting with the department tree in the frontend?

**Decision**: Use Material-UI TreeView component with custom department node rendering:
- **Component Structure**:
  - `DepartmentsTab.tsx`: Main container, fetches department tree data, manages dialogs
  - `DepartmentTreeView.tsx`: MUI TreeView wrapper, handles expand/collapse state
  - `DepartmentNode.tsx`: Custom tree item renderer with inline actions and warning indicators
  - Dialog components: Create, Edit, AssignManager, AddEmployee, Move (each in separate file)

- **State Management**:
  - Use TanStack Query for department tree data fetching and caching
  - Local state for tree expansion (controlled expand/collapse)
  - Dialog state managed in DepartmentsTab via useState

- **Drag-and-Drop** (for moving departments):
  - Use `@dnd-kit` library (lightweight, accessible, TypeScript-first)
  - Enable drag only for ROLE_OWNER/ROLE_OPERATOR (check user role)
  - Visual feedback during drag (highlight valid drop targets, prevent invalid drops)
  - Confirm dialog before executing move operation

- **Warning Indicators**:
  - Show warning icon next to department name if `member_count === 0` or `manager_count === 0`
  - Tooltip explains warning: "No members assigned" or "No manager assigned"
  - Use yellow/amber color for warnings (not error red)

**Rationale**:
- MUI TreeView provides accessible, keyboard-navigable tree out of the box
- TanStack Query handles caching, refetching, and optimistic updates naturally
- Separation of concerns: Tree structure logic separate from node rendering
- @dnd-kit is lighter than react-beautiful-dnd and has better TypeScript support
- Warning indicators provide clear visual feedback without blocking operations

**Alternatives Considered**:
- Custom tree implementation from scratch: Reinventing the wheel, accessibility challenges
- react-beautiful-dnd for drag-and-drop: Heavier, less TypeScript-friendly
- Nested accordion components: Poor UX for deep hierarchies, no visual tree structure
- Full drag-and-drop for all users: Violates permission model, too easy to accidentally move

**Existing Patterns to Follow**:
- Reference: `frontend/apps/web/src/app/workspace/organization/page.tsx` for tab navigation pattern
- Use `useRequireAuth()` hook for authentication guard
- Import API client from `apis`, not `@tech-office/rpc`
- Follow workspace layout density standards: compact spacing, horizontal utilization
- Use TabLink component for sub-navigation (add "Departments" tab)

### 7. Employee Assignment UX Flow

**Question**: How should the "add employee to department" flow work for managers vs. administrators?

**Decision**: Different dialog behaviors based on user role:

**For Department Managers** (AddEmployeeDialog opened from their own department):
- Dialog shows only unassigned employees (employees with no department_id)
- Filter dropdown: "Unassigned only" (disabled, always on)
- Search bar to find employees by name/email
- Single-select mode (add one employee at a time)
- Button: "Add to Department"

**For ROLE_OWNER/ROLE_OPERATOR** (can add from any department or move between departments):
- Dialog shows all employees in organization
- Filter dropdown: "All employees", "Unassigned only", "Department: [name]"
- Search bar to find employees by name/email
- Multi-select mode (bulk operations enabled)
- Button: "Add to Department" (if unassigned) or "Move to Department" (if already assigned)
- Confirmation dialog if moving from another department

**Rationale**:
- Managers have limited scope (only their department, only unassigned employees)
- Administrators have full control for organizational restructuring
- Clear visual distinction prevents confusion about capabilities
- Confirmation dialog for moves prevents accidental cross-department transfers
- Multi-select enables bulk operations for administrators (efficient reorganization)

**Alternatives Considered**:
- Same dialog for all users with dynamic filtering: Confusing, unclear what's allowed
- Separate "Move Employee" dialog for administrators: Redundant, adds UI complexity
- Inline employee assignment in tree view: Poor UX for bulk operations, hard to search

**Existing Patterns to Follow**:
- Use MUI Dialog component with responsive sizing (`max-w-2xl`)
- Use MUI Autocomplete for employee search with server-side filtering
- Use MUI Checkbox with list for multi-select (administrators)
- Follow form validation patterns: disable submit until valid selection
- Show loading state during API calls, error messages on failure

## Summary of Technical Decisions

### Database Layer
1. **Schema Extension**: ALTER TABLE to add parent_department_id, cached counts (member_count, manager_count, child_count)
2. **Tree Queries**: PostgreSQL recursive CTEs with path arrays and depth tracking
3. **Count Maintenance**: Database triggers for automatic cache updates
4. **Circular Prevention**: Application-level validation using recursive CTE before moves
5. **Unique Constraints**: (organization_id, employee_id) ensures single department membership

### Backend Service Layer
1. **Service Architecture**: DepartmentService with AdminPool (system ops) and TenantPool (user ops)
2. **Authorization**: Proto-level RBAC for OWNER/OPERATOR, custom logic for manager permissions
3. **Transaction Handling**: txn.WithTxn for all multi-step operations (move, bulk assign)
4. **Method Decomposition**: Separate validation, authorization, and business logic methods
5. **Error Handling**: Descriptive gRPC errors with specific codes (InvalidArgument, PermissionDenied)

### Frontend Layer
1. **Component Strategy**: MUI TreeView with custom department nodes, separate dialog components
2. **State Management**: TanStack Query for server state, local state for UI interactions
3. **Drag-and-Drop**: @dnd-kit for department moves (OWNER/OPERATOR only)
4. **Warning Indicators**: Visual feedback for empty departments (no members/manager)
5. **Permission-Aware UX**: Different dialog behaviors for managers vs. administrators

### Performance Considerations
1. **Query Optimization**: Index on parent_department_id, path-based tree traversal
2. **Caching Strategy**: TanStack Query with stale-while-revalidate for tree data
3. **Lazy Loading**: Load department details on demand (not all in initial tree query)
4. **Optimistic Updates**: Immediate UI updates with background sync for better UX
5. **Monitoring**: Track tree rendering time, alert if >100ms for <500 departments

## Next Steps
Proceed to Phase 1: Design & Contracts
- Generate data-model.md with complete SQL schema changes
- Create department.proto with RPC service definition
- Design sqlc queries for all department operations
- Create quickstart.md with integration test scenarios
- Update .github/copilot-instructions.md with feature context
