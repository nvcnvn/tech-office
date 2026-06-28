# Tasks: Organization Departments Management

**Input**: Design documents from `/specs/006-organization-departments-ver/`
**Prerequisites**: plan.md (✅), research.md (✅), data-model.md (✅), contracts/ (✅)

## Execution Flow (main)
```
1. Load plan.md from feature directory ✅
   → Feature: Hierarchical department management with tree structure
   → Tech stack: Go backend, PostgreSQL, sqlc, protobuf, Next.js frontend, MUI
   
2. Load design documents ✅
   → data-model.md: organization.department (parent_department_id, cached counts)
   → contracts/department.proto: DepartmentService with 11 RPC methods
   → contracts/organization.query.sql: 20+ sqlc queries for tree operations
   → quickstart.md: 8 integration test scenarios
   
3. Task generation strategy:
   → Setup: Schema changes, migrations, codegen
   → Core Backend: Service implementation, queries, transaction handling
   → Core Frontend: Workspace components, tree view, dialogs
   → Integration: Service registration, API wrappers
   → Verification: Manual testing of all scenarios (REQUIRED gate)
   → Tests: Unit, integration, contract tests (after verification)
   → Polish: Performance, documentation
   
4. Task rules applied:
   → Different files = mark [P] for parallel
   → Same file = sequential (no [P])
   → Schema/codegen before implementation
   → Implementation before verification before tests
   
5. Tasks numbered T001-T046 sequentially
6. Dependencies documented below
7. Parallel execution examples included
8. All contracts covered ✅
9. All entities modeled ✅
10. All endpoints implemented ✅
11. Manual verification gates present ✅
12. Tests after verification ✅
```

## Format: `[ID] [P?] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- All paths are absolute from repository root

---

## Phase 3.1: Setup & Schema

### Database Schema & Migration
- [X] **T001** [P] Modify database schema in `backend/database/scripts/schema.sql`:
  - Add `parent_department_id UUID REFERENCES organization.department(id) ON DELETE RESTRICT` to organization.department
  - Add `member_count INT NOT NULL DEFAULT 0` to organization.department
  - Add `manager_count INT NOT NULL DEFAULT 0` to organization.department
  - Add `child_count INT NOT NULL DEFAULT 0` to organization.department
  - Add `CONSTRAINT no_self_reference CHECK (parent_department_id IS NULL OR parent_department_id != id)`
  - Add unique constraint `UNIQUE (organization_id, employee_id)` to organization.department_member
  - Add indexes: `idx_department_parent`, `idx_department_org_parent`
  - Add triggers: `update_department_member_count`, `update_department_child_count`, `update_department_parent_count`

- [ ] **T002** Generate Atlas migration (depends on T001):
  Manual work

- [X] **T003** [P] Add sqlc queries in `backend/database/scripts/organization.query.sql`:
  - Append contents from `/specs/006-organization-departments-ver/contracts/organization.query.sql`
  - Includes: GetDepartmentTree, GetDepartmentByID, CreateDepartment, UpdateDepartment, MoveDepartment, DeleteDepartment
  - Includes: GetDepartmentMembers, GetUnassignedEmployees, AssignEmployeeToDepartment, RemoveEmployeeFromDepartment
  - Includes: SetDepartmentManager, ClearDepartmentManager, IsDepartmentDescendant, IsDepartmentManager
  - Includes: DepartmentHasMembers, DepartmentHasChildren, GetDepartmentChildIDs

- [X] **T004** Generate sqlc models (depends on T001, T003):
  ```bash
  cd backend && sqlc generate
  ```
  - Generates: `backend/database/models.go` (updated Department model)
  - Generates: `backend/database/organization.query.sql.go` (department query methods)
  - Commit all generated files

###Protocol Buffer Definitions
- [X] **T005** [P] Create RPC service definition in `backend/rpc/v1/department.proto`:
  - Copy from `/specs/006-organization-departments-ver/contracts/department.proto`
  - Includes: DepartmentService with 11 RPC methods
  - Includes: Department, DepartmentMember messages with path/depth fields
  - Includes: RBAC access_control annotations (ROLE_OWNER, ROLE_OPERATOR, ROLE_EMPLOYEE)

- [X] **T006** Generate protobuf code (depends on T005):
  ```bash
  cd backend && buf generate
  ```
  - Generates: `backend/rpc/v1/department.pb.go` (message types)
  - Generates: `backend/rpc/v1/rpcv1connect/department.connect.go` (service handlers)
  - Commit all generated files

---

## Phase 3.2: Core Backend Implementation

### Service Structure Setup
- [X] **T007** Create service struct in `backend/internal/department/department.go` (depends on T004, T006):
  ```go
  type DepartmentService struct {
      rpcv1connect.UnimplementedDepartmentServiceHandler
      AdminPool  database.AdminDatabaseConnector  // System operations
      TenantPool database.TenantDatabaseConnector // User operations
      Queries    *database.Queries
  }
  ```
  - Document pool usage: TenantPool for all user-facing operations, AdminPool for background cleanup
  - Include constructor function NewDepartmentService

### Read Operations (All Roles)
- [X] **T008** [P] Implement GetDepartmentTree method in `backend/internal/department/department.go` (depends on T007):
  - Use TenantPool (read-only, tenant-isolated)
  - Call Queries.GetDepartmentTree with organization_id from auth context
  - Map database results to proto Department messages with path/depth/full_path
  - Handle empty tree case (no departments yet)

- [X] **T009** [P] Implement GetDepartment method in `backend/internal/department/department.go` (depends on T007):
  - Use TenantPool (read-only, tenant-isolated)
  - Call Queries.GetDepartmentByID
  - Validate department belongs to user's organization

- [X] **T010** [P] Implement GetDepartmentMembers method in `backend/internal/department/department.go` (depends on T007):
  - Use TenantPool (read-only, tenant-isolated)
  - Call Queries.GetDepartmentMembers
  - Return managers first, then alphabetically sorted members

- [X] **T011** [P] Implement GetUnassignedEmployees method in `backend/internal/department/department.go` (depends on T007):
  - Use TenantPool (read-only, tenant-isolated)
  - Call Queries.GetUnassignedEmployees
  - Filter to show only employees without department membership

### Department CRUD (OWNER/OPERATOR Only)
- [X] **T012** Implement CreateDepartment method in `backend/internal/department/department.go` (depends on T007):
  - Use TenantPool (tenant-isolated write operation)
  - Validate parent_department_id exists and belongs to same organization
  - Call Queries.CreateDepartment
  - Trigger automatically updates parent's child_count

- [X] **T013** Implement UpdateDepartment method in `backend/internal/department/department.go` (depends on T007):
  - Use TenantPool (tenant-isolated write operation)
  - Validate department exists and belongs to organization
  - Call Queries.UpdateDepartment (name and/or description)

- [X] **T014** Implement MoveDepartment method in `backend/internal/department/department.go` (depends on T007):
  - Decompose into private methods:
    * `validateMoveDepartmentRequest()` - check department exists
    * `checkCircularReference()` - call Queries.IsDepartmentDescendant
    * `moveDepartmentToNewParent()` - use txn.WithTxn with TenantPool
  - Within transaction: validate target parent exists, update parent_department_id
  - Trigger automatically updates old/new parent child_counts

- [X] **T015** Implement DeleteDepartment method in `backend/internal/department/department.go` (depends on T007):
  - Decompose into private methods:
    * `validateDepartmentDeletion()` - check member_count=0, child_count=0
    * `executeDepartmentDeletion()` - call Queries.DeleteDepartment
  - Use TenantPool (tenant-isolated write operation)
  - Return error if department has members or children (enforced by query WHERE clause)

### Employee Assignment Operations
- [X] **T016** Implement AssignEmployeeToDepartment method in `backend/internal/department/department.go` (depends on T007):
  - Decompose into private methods:
    * `validateAssignmentRequest()` - check employee/department exist
    * `checkAssignmentPermission()` - custom logic for manager vs admin permissions
    * `executeAssignment()` - use txn.WithTxn with TenantPool
  - Permission logic:
    * OWNER/OPERATOR: Can assign any employee to any department
    * Department managers: Can only assign unassigned employees to their own department
  - Use ON CONFLICT in query to handle moves (upsert behavior)
  - Trigger automatically updates old/new department counts

- [X] **T017** Implement RemoveEmployeeFromDepartment method in `backend/internal/department/department.go` (depends on T007):
  - Use TenantPool (tenant-isolated write operation)
  - Call Queries.RemoveEmployeeFromDepartment
  - Trigger automatically decrements department counts

### Manager Operations (OWNER/OPERATOR Only)
- [X] **T018** [P] Implement SetDepartmentManager method in `backend/internal/department/department.go` (depends on T007):
  - Decompose into private methods:
    * `validateManagerDesignation()` - check employee is member of department
    * `setManagerRole()` - call Queries.SetDepartmentManager
  - Use TenantPool (tenant-isolated write operation)
  - Ensure employee is already a member before setting manager role
  - Trigger automatically updates manager_count

- [X] **T019** [P] Implement ClearDepartmentManager method in `backend/internal/department/department.go` (depends on T007):
  - Use TenantPool (tenant-isolated write operation)
  - Call Queries.ClearDepartmentManager
  - Updates all managers in department to 'member' role
  - Trigger automatically updates manager_count

### Service Registration
- [X] **T020** Register DepartmentService in `backend/cmd/server.go` (depends on T008-T019):
  - Import department package
  - Create DepartmentService instance with AdminPool, TenantPool, Queries
  - Register with ConnectRPC router
  - Add to service list in startup logs

---

## Phase 3.3: Core Frontend Implementation

### Frontend Package Updates
- [X] **T021** Export DepartmentService client in `frontend/packages/rpc/index.ts` (depends on T006):
  - Add: `export * from './rpc/v1/department_pb';`
  - Add: `export { DepartmentService } from './rpc/v1/department_connect';`

- [X] **T022** Build frontend packages (depends on T021):
  ```bash
  cd frontend && pnpm -r build
  ```
  - Updates: `frontend/packages/rpc/dst/` with new proto types
  - Commit build artifacts

- [X] **T023** Create API wrapper in `frontend/packages/apis/src/department.ts` (depends on T022):
  - Import DepartmentService client from @tech-office/rpc
  - Create typed wrapper methods for all 11 RPC methods
  - Add error handling and organization context extraction
  - Export as `departmentApi` for use in apps

### Workspace Organization Page Updates
- [X] **T024** [P] Add "Departments" tab to `frontend/apps/web/src/app/workspace/organization/page.tsx` (depends on T023):
  - Add new TabLink: `<TabLink href="/workspace/organization?tab=departments">Departments</TabLink>`
  - Add tab routing: `{activeTab === 'departments' && <DepartmentsTab />}`
  - Maintain existing tabs (Overview, Employees)

### Department Tree View Components
- [X] **T025** Create DepartmentsTab in `frontend/apps/web/src/app/workspace/organization/components/DepartmentsTab.tsx` (depends on T023, T024):
  - Use TanStack Query to fetch department tree: `useQuery({ queryKey: ['departmentTree'], queryFn: () => departmentApi.getDepartmentTree() })`
  - State management for dialogs (create, edit, move, assign)
  - Action buttons: "Create Root Department", "Expand All", "Collapse All"
  - Render DepartmentTreeView component
  - Apply compact vertical spacing (py-4, gap-4)
  - Distribute controls horizontally (action buttons inline with search)

- [X] **T026** Create DepartmentTreeView in `.../components/DepartmentTreeView.tsx` (depends on T025):
  - Use MUI TreeView component for collapsible tree structure
  - Map department tree data (with path/depth) to TreeItem hierarchy
  - Render DepartmentNode for each department
  - Handle expand/collapse state
  - Support keyboard navigation

- [X] **T027** Create DepartmentNode in `.../components/DepartmentNode.tsx` (depends on T026):
  - Display department name, description, counts (members, managers, children)
  - Warning indicators: empty department (member_count=0), no manager (manager_count=0)
  - Inline actions: Edit, Move, Add Employee, Set Manager, Delete
  - Apply compact spacing: h-10 for node height, px-3 py-2 for padding
  - Horizontal layout for actions (inline buttons, not stacked)

### Department Management Dialogs
- [X] **T028** [P] Create CreateDepartmentDialog in `.../components/CreateDepartmentDialog.tsx` (depends on T023):
  - Form fields: name (required), description (optional), parent_department_id (optional, select from tree)
  - Call departmentApi.createDepartment
  - Invalidate departmentTree query on success
  - Compact modal: max-w-2xl, py-4 padding

- [X] **T029** [P] Create EditDepartmentDialog in `.../components/EditDepartmentDialog.tsx` (depends on T023):
  - Form fields: name, description (pre-filled with current values)
  - Call departmentApi.updateDepartment
  - Invalidate departmentTree query on success

- [X] **T030** [P] Create MoveDepartmentDialog in `.../components/MoveDepartmentDialog.tsx` (depends on T023):
  - Select new parent department (exclude current department and descendants)
  - Call departmentApi.moveDepartment
  - Handle circular reference error gracefully
  - Invalidate departmentTree query on success

- [X] **T031** [P] Create AssignManagerDialog in `.../components/AssignManagerDialog.tsx` (depends on T023):
  - List department members (employees only, exclude current manager)
  - Call departmentApi.setDepartmentManager
  - Show "Clear Manager" option if manager exists
  - Invalidate departmentTree and departmentMembers queries on success

- [X] **T032** [P] Create AddEmployeeDialog in `.../components/AddEmployeeDialog.tsx` (depends on T023):
  - Fetch unassigned employees: `useQuery({ queryKey: ['unassignedEmployees'], queryFn: departmentApi.getUnassignedEmployees })`
  - Multi-select for bulk assignment (optional enhancement)
  - Call departmentApi.assignEmployeeToDepartment with role='member'
  - Invalidate departmentTree and unassignedEmployees queries on success
  - Compact list: h-10 items, text-sm

---

## Phase 3.4: Integration

### API Client Verification
- [X] **T033** Verify API imports in apps use `apis` NOT `@tech-office/rpc` (depends on T023, T025-T032):
  - Check all department components import from `apis`
  - Ensure no direct imports of proto types in components
  - Update imports if needed

### Cross-Feature Integration
- [ ] **T034** [P] Update Employee Listing page to display department membership (depends on T023):
  - Add "Department" column to employee table in `frontend/apps/web/src/app/workspace/organization/components/EmployeesTab.tsx`
  - Fetch employee department via departmentApi.getEmployeeDepartment
  - Display department name with link to departments tab

---

## Phase 3.5: Manual Verification ⚠️ REQUIRED BEFORE TESTS

**Human developer MUST verify behavior is correct before adding tests**

### Backend Manual Testing
- [ ] **T035** Manual test department creation flow:
  - Create root department (Engineering)
  - Create child department (Backend with Engineering as parent)
  - Create nested child (Platform with Backend as parent)
  - Verify parent_department_id relationships
  - Verify child_count increments on parents

- [ ] **T036** Manual test department tree query:
  - Call GetDepartmentTree API
  - Verify depth-first ordering
  - Verify path arrays (root to leaf)
  - Verify full_path strings (e.g., "Engineering > Backend > Platform")

- [ ] **T037** Manual test circular reference prevention:
  - Create tree: A → B → C
  - Attempt to move A under C (should fail)
  - Verify IsDepartmentDescendant validation works
  - Verify error message is clear

- [ ] **T038** Manual test employee assignment:
  - Assign employee to department as member
  - Verify member_count increments
  - Move employee to different department
  - Verify old department member_count decrements, new increments
  - Verify single department membership constraint

- [ ] **T039** Manual test manager operations:
  - Assign member as manager
  - Verify manager_count increments to 1
  - Clear manager designation
  - Verify manager_count decrements to 0
  - Verify manager remains as member

- [ ] **T040** Manual test deletion constraints:
  - Attempt to delete department with members (should fail)
  - Attempt to delete department with children (should fail)
  - Remove all members and children
  - Successfully delete department
  - Verify parent child_count decrements

- [ ] **T041** Manual test multi-tenant isolation:
  - Create departments in organization A
  - Switch to organization B context
  - Verify GetDepartmentTree returns empty for org B
  - Verify cannot access org A department IDs
  - Verify all queries filter by organization_id

- [ ] **T042** Manual test manager permission logic:
  - As OWNER: Assign any employee to any department ✅
  - As OPERATOR: Assign any employee to any department ✅
  - As department manager: Assign only unassigned employees to own department ✅
  - As department manager: Cannot assign to other departments ❌
  - As department manager: Cannot move employees between departments ❌

### Frontend Manual Testing
- [ ] **T043** Manual test workspace layout and navigation:
  - Navigate to Organization page
  - Click "Departments" tab
  - Verify tab switches without page reload
  - Verify query param in URL (?tab=departments)
  - Verify workspace layout sharing (no duplicate navigation)

- [ ] **T044** Manual test department tree view:
  - Expand/collapse departments
  - Verify indentation reflects hierarchy depth
  - Verify warning indicators for empty departments
  - Verify warning indicators for departments without managers
  - Click inline actions (Edit, Move, Delete)

- [ ] **T045** Manual test dialog workflows:
  - Open CreateDepartmentDialog, create root department
  - Open CreateDepartmentDialog, create child with parent selection
  - Open EditDepartmentDialog, update name and description
  - Open MoveDepartmentDialog, move department to new parent
  - Open AssignManagerDialog, set employee as manager
  - Open AddEmployeeDialog, assign unassigned employee

- [ ] **T046** Manual test responsive layout and density:
  - Verify compact vertical spacing (headers ≤56px, section gaps ≤24px)
  - Verify horizontal space utilization (actions inline with tabs)
  - Verify table/list density (row height h-10, text-sm)
  - Test on 13-inch laptop resolution (1440x900)
  - Verify scroll behavior (tree scrolls, not entire page)

- [ ] **T047** Run all quickstart.md scenarios:
  - Execute all 8 test scenarios from `/specs/006-organization-departments-ver/quickstart.md`
  - Verify expected responses match actual behavior
  - Document any deviations or edge cases discovered

- [ ] **T048** Document verified behavior for test writing:
  - List all verified correct behaviors from T035-T047
  - Note edge cases and error handling
  - Create test plan checklist for Phase 3.6

---

## Phase 3.6: Tests (After Verification)

**Add tests ONLY after T035-T048 confirm correct behavior**

### Backend Unit Tests
- [ ] **T049** [P] Unit tests for department CRUD in `backend/internal/department/department_test.go`:
  - Test CreateDepartment (root and child)
  - Test UpdateDepartment
  - Test DeleteDepartment (success and constraint failures)
  - Mock TenantPool and Queries

- [ ] **T050** [P] Unit tests for tree operations in `backend/internal/department/department_test.go`:
  - Test GetDepartmentTree with multi-level hierarchy
  - Test MoveDepartment with circular reference detection
  - Test IsDepartmentDescendant validation

- [ ] **T051** [P] Unit tests for employee assignment in `backend/internal/department/department_test.go`:
  - Test AssignEmployeeToDepartment (new assignment and move)
  - Test RemoveEmployeeFromDepartment
  - Test manager permission logic (owner vs manager)

- [ ] **T052** [P] Unit tests for manager operations in `backend/internal/department/department_test.go`:
  - Test SetDepartmentManager
  - Test ClearDepartmentManager
  - Test manager must be member constraint

### Backend Integration Tests
- [ ] **T053** [P] Integration test department hierarchy in `backend/integration/department_test.go`:
  - Create 3-level department tree
  - Verify tree query returns correct path/depth
  - Move departments and verify counts update
  - Test with real database (transaction rollback)

- [ ] **T054** [P] Integration test employee lifecycle in `backend/integration/department_test.go`:
  - Assign employee to department
  - Promote to manager
  - Move to different department
  - Remove from department
  - Verify triggers update counts correctly

- [ ] **T055** [P] Integration test multi-tenant isolation in `backend/integration/department_test.go`:
  - Create departments in two organizations
  - Verify queries filter by organization_id
  - Verify cannot access other org's departments
  - Test with real database and TenantPool

### Frontend Component Tests
- [ ] **T056** [P] Component test for DepartmentsTab in `frontend/apps/web/src/app/workspace/organization/components/DepartmentsTab.test.tsx`:
  - Mock departmentApi.getDepartmentTree
  - Render with sample tree data
  - Test action button clicks open dialogs
  - Verify loading and error states

- [ ] **T057** [P] Component test for DepartmentTreeView in `.../components/DepartmentTreeView.test.tsx`:
  - Render tree with nested departments
  - Test expand/collapse interactions
  - Verify keyboard navigation
  - Test empty state

- [ ] **T058** [P] Component test for DepartmentNode in `.../components/DepartmentNode.test.tsx`:
  - Render with sample department data
  - Verify warning indicators display correctly
  - Test inline action button clicks
  - Verify counts display

- [ ] **T059** [P] Component tests for dialogs in `.../components/*.test.tsx`:
  - Test CreateDepartmentDialog form submission
  - Test EditDepartmentDialog pre-filled values
  - Test MoveDepartmentDialog validation
  - Test AssignManagerDialog member list
  - Test AddEmployeeDialog unassigned list

### Contract Tests
- [ ] **T060** [P] Contract test for GetDepartmentTree endpoint:
  - Verify response schema matches proto definition
  - Test with empty tree (no departments)
  - Test with multi-level hierarchy
  - Verify depth/path fields calculated correctly

- [ ] **T061** [P] Contract test for CreateDepartment endpoint:
  - Verify request/response schema
  - Test with and without parent_department_id
  - Verify validation errors for invalid input

- [ ] **T062** [P] Contract test for employee assignment endpoints:
  - Test AssignEmployeeToDepartment schema
  - Test RemoveEmployeeFromDepartment schema
  - Test SetDepartmentManager schema

---

## Phase 3.7: Polish

- [ ] **T063** [P] Performance optimization:
  - Verify department tree query <100ms for 500 departments
  - Add database query logging for slow queries
  - Consider materialized view if tree queries slow

- [ ] **T064** [P] Documentation updates:
  - Update `backend/database/README.md` with department schema
  - Document trigger behavior and count maintenance
  - Add department API examples to README

- [ ] **T065** [P] Code cleanup:
  - Remove debug logging
  - Ensure consistent error messages
  - Run golangci-lint and fix issues
  - Run eslint on frontend and fix issues

- [ ] **T066** Final smoke test:
  - Run full quickstart.md workflow end-to-end
  - Verify all 8 scenarios pass
  - Check performance metrics
  - Verify no console errors in browser

---

## Dependencies

### Critical Path (Must Execute in Order)
```
T001 (schema changes) → T002 (migration) → T004 (sqlc generate)
T003 (query SQL) → T004 (sqlc generate)
T005 (proto) → T006 (buf generate)
T004, T006 → T007 (service struct) → T008-T019 (service methods) → T020 (registration)
T006 → T021 (rpc export) → T022 (pnpm build) → T023 (API wrapper)
T023, T024 → T025-T032 (frontend components)
T008-T019 → T035-T042 (backend verification)
T025-T032 → T043-T046 (frontend verification)
T035-T048 (all verification) → T049-T062 (tests)
T049-T062 → T063-T066 (polish)
```

### Parallel Execution Groups
```
GROUP 1 (Schema & Contracts - can run simultaneously):
- T001 (schema.sql modifications)
- T003 (query.sql additions)
- T005 (department.proto creation)

GROUP 2 (Codegen - must wait for GROUP 1):
- T002 (atlas migration - depends on T001)
- T004 (sqlc generate - depends on T001, T003)
- T006 (buf generate - depends on T005)

GROUP 3 (Backend Read Methods - can run simultaneously after T007):
- T008 (GetDepartmentTree)
- T009 (GetDepartment)
- T010 (GetDepartmentMembers)
- T011 (GetUnassignedEmployees)

GROUP 4 (Backend Manager Operations - can run simultaneously after T007):
- T018 (SetDepartmentManager)
- T019 (ClearDepartmentManager)

GROUP 5 (Frontend Dialogs - can run simultaneously after T023):
- T028 (CreateDepartmentDialog)
- T029 (EditDepartmentDialog)
- T030 (MoveDepartmentDialog)
- T031 (AssignManagerDialog)
- T032 (AddEmployeeDialog)

GROUP 6 (Backend Unit Tests - can run simultaneously after verification):
- T049 (CRUD tests)
- T050 (tree operation tests)
- T051 (employee assignment tests)
- T052 (manager operation tests)

GROUP 7 (Backend Integration Tests - can run simultaneously after verification):
- T053 (hierarchy test)
- T054 (employee lifecycle test)
- T055 (multi-tenant isolation test)

GROUP 8 (Frontend Component Tests - can run simultaneously after verification):
- T056 (DepartmentsTab test)
- T057 (DepartmentTreeView test)
- T058 (DepartmentNode test)
- T059 (dialog tests)

GROUP 9 (Contract Tests - can run simultaneously after verification):
- T060 (GetDepartmentTree contract)
- T061 (CreateDepartment contract)
- T062 (assignment contracts)

GROUP 10 (Polish - can run simultaneously after tests):
- T063 (performance optimization)
- T064 (documentation updates)
- T065 (code cleanup)
```

---

## Parallel Execution Examples

### Example 1: Initial Setup (after design docs ready)
```bash
# Launch schema and contract definitions in parallel
Task T001: "Modify database schema in backend/database/scripts/schema.sql"
Task T003: "Add sqlc queries in backend/database/scripts/organization.query.sql"
Task T005: "Create RPC service definition in backend/rpc/v1/department.proto"
```

### Example 2: Codegen (after schema/contracts complete)
```bash
# Run codegen tasks sequentially (dependencies on T001, T003, T005)
Task T002: "Generate Atlas migration"
Task T004: "Run sqlc generate to create Go models"
Task T006: "Run buf generate to create proto code"
```

### Example 3: Backend Read Operations (after service struct created)
```bash
# Launch read-only methods in parallel
Task T008: "Implement GetDepartmentTree in backend/internal/department/department.go"
Task T009: "Implement GetDepartment in backend/internal/department/department.go"
Task T010: "Implement GetDepartmentMembers in backend/internal/department/department.go"
Task T011: "Implement GetUnassignedEmployees in backend/internal/department/department.go"
```

### Example 4: Frontend Dialogs (after API wrapper ready)
```bash
# Launch dialog components in parallel (different files)
Task T028: "Create CreateDepartmentDialog in .../components/CreateDepartmentDialog.tsx"
Task T029: "Create EditDepartmentDialog in .../components/EditDepartmentDialog.tsx"
Task T030: "Create MoveDepartmentDialog in .../components/MoveDepartmentDialog.tsx"
Task T031: "Create AssignManagerDialog in .../components/AssignManagerDialog.tsx"
Task T032: "Create AddEmployeeDialog in .../components/AddEmployeeDialog.tsx"
```

### Example 5: Tests (after manual verification complete)
```bash
# Launch all test categories in parallel
Task T049: "Unit tests for department CRUD"
Task T050: "Unit tests for tree operations"
Task T053: "Integration test department hierarchy"
Task T054: "Integration test employee lifecycle"
Task T056: "Component test for DepartmentsTab"
Task T057: "Component test for DepartmentTreeView"
Task T060: "Contract test for GetDepartmentTree"
```

---

## Notes

- **[P] tasks**: Different files, no dependencies - safe for parallel execution
- **Sequential tasks**: Same file or logical dependencies - must run in order
- **Codegen gates**: T004 (sqlc) and T006 (buf) are hard prerequisites for implementation
- **Verification gate**: T035-T048 MUST complete before T049-T062 (tests)
- **Constitution compliance**: All backend methods document pool usage, use txn.WithTxn for transactions
- **Multi-tenant isolation**: All queries include organization_id filters, tested in T041 and T055
- **Frontend workspace pattern**: Uses shared layout, tab-based sub-navigation, compact UI/UX

## Task Execution Workflow

1. **Setup Phase** (T001-T006): Run in 2 waves (contracts parallel, then codegen sequential)
2. **Backend Core** (T007-T020): Service struct first, then methods (some parallel), register last
3. **Frontend Core** (T021-T034): Package updates sequential, components parallel
4. **Verification** (T035-T048): Sequential execution, human must validate each scenario
5. **Tests** (T049-T062): All parallel after verification gate passes
6. **Polish** (T063-T066): Parallel optimization, docs, cleanup, then final smoke test

## Estimated Timeline
- Setup & Codegen: 2-3 hours
- Backend Implementation: 6-8 hours
- Frontend Implementation: 6-8 hours
- Integration: 1-2 hours
- Manual Verification: 3-4 hours (CRITICAL - do not skip)
- Tests: 4-6 hours
- Polish: 2-3 hours

**Total**: 24-34 hours (3-4 working days)

---

**Generated**: October 27, 2025  
**Based on**: Constitution v3.5.0, plan.md, data-model.md, contracts/, quickstart.md  
**Ready for Execution**: ✅ All prerequisites met
