# Quickstart: Organization Departments Management

**Feature**: Organization Departments Management (spec-006)  
**Date**: October 27, 2025  
**Purpose**: Integration test scenarios and end-to-end validation

## Prerequisites

### Environment Setup
```bash
# Start backend services
cd backend
docker-compose up -d postgres zitadel

# Run database migrations
atlas migrate apply --env dev

# Generate sqlc models
sqlc generate

# Generate protobuf code
buf generate

# Start backend server
go run cmd/main.go
```

### Test Data Setup
```bash
# Create test organization
curl -X POST http://localhost:18080/rpc.v1.OrganizationService/RegisterOrganizationWithAdminPassword \
  -H "Content-Type: application/json" \
  -d '{
    "organization_name": "Test Corp",
    "organization_slug": "test-corp",
    "admin_email": "admin@testcorp.com",
    "admin_password": "SecurePass123!",
    "admin_first_name": "Admin",
    "admin_last_name": "User"
  }'

# Create test employees (via employee import or individual creation)
# - alice@testcorp.com (Engineering employee)
# - bob@testcorp.com (Sales employee)
# - charlie@testcorp.com (Unassigned employee)
# - diana@testcorp.com (Engineering manager candidate)
```

## Test Scenarios

### Scenario 1: Create Department Hierarchy

**User Story**: As ROLE_OWNER, I want to create a nested department structure that mirrors my organization chart.

**Test Steps**:

1. **Create root department (Engineering)**
   ```bash
   POST /rpc.v1.DepartmentService/CreateDepartment
   {
     "name": "Engineering",
     "description": "Product development and technology"
   }
   ```
   
   **Expected**:
   - Response: 200 OK
   - Department created with id, parent_department_id = NULL
   - member_count = 0, manager_count = 0, child_count = 0

2. **Create child department (Backend)**
   ```bash
   POST /rpc.v1.DepartmentService/CreateDepartment
   {
     "name": "Backend",
     "description": "Server-side development",
     "parent_department_id": "<engineering_dept_id>"
   }
   ```
   
   **Expected**:
   - Response: 200 OK
   - Backend department created with parent_department_id = Engineering id
   - Engineering department child_count = 1 (updated by trigger)

3. **Create another child department (Frontend)**
   ```bash
   POST /rpc.v1.DepartmentService/CreateDepartment
   {
     "name": "Frontend",
     "description": "Client-side development",
     "parent_department_id": "<engineering_dept_id>"
   }
   ```
   
   **Expected**:
   - Response: 200 OK
   - Frontend department created with parent_department_id = Engineering id
   - Engineering department child_count = 2

4. **Get full department tree**
   ```bash
   GET /rpc.v1.DepartmentService/GetDepartmentTree
   ```
   
   **Expected**:
   - Response: 200 OK
   - Departments in depth-first order:
     ```json
     {
       "departments": [
         {
           "id": "<eng_id>",
           "name": "Engineering",
           "depth": 0,
           "full_path": "Engineering",
           "child_count": 2
         },
         {
           "id": "<backend_id>",
           "name": "Backend",
           "depth": 1,
           "full_path": "Engineering > Backend",
           "parent_department_id": "<eng_id>"
         },
         {
           "id": "<frontend_id>",
           "name": "Frontend",
           "depth": 1,
           "full_path": "Engineering > Frontend",
           "parent_department_id": "<eng_id>"
         }
       ]
     }
     ```

**Validation**:
- ✅ Departments created successfully
- ✅ Parent-child relationships established
- ✅ child_count updated automatically by trigger
- ✅ Tree query returns departments in depth-first order
- ✅ full_path computed correctly

---

### Scenario 2: Assign Employees to Departments

**User Story**: As ROLE_OWNER, I want to assign employees to departments and designate managers.

**Test Steps**:

1. **Assign employee to department (as member)**
   ```bash
   POST /rpc.v1.DepartmentService/AssignEmployeeToDepartment
   {
     "department_id": "<backend_dept_id>",
     "employee_id": "<alice_id>",
     "role": "member"
   }
   ```
   
   **Expected**:
   - Response: 200 OK
   - Department_member record created
   - Backend department member_count = 1 (updated by trigger)

2. **Assign another employee to same department**
   ```bash
   POST /rpc.v1.DepartmentService/AssignEmployeeToDepartment
   {
     "department_id": "<backend_dept_id>",
     "employee_id": "<diana_id>",
     "role": "member"
   }
   ```
   
   **Expected**:
   - Response: 200 OK
   - Backend department member_count = 2

3. **Designate manager**
   ```bash
   POST /rpc.v1.DepartmentService/SetDepartmentManager
   {
     "department_id": "<backend_dept_id>",
     "employee_id": "<diana_id>"
   }
   ```
   
   **Expected**:
   - Response: 200 OK
   - Diana's role updated to 'manager'
   - Backend department manager_count = 1 (updated by trigger)
   - member_count remains 2 (manager is also a member)

4. **Get department members**
   ```bash
   GET /rpc.v1.DepartmentService/GetDepartmentMembers?department_id=<backend_dept_id>
   ```
   
   **Expected**:
   - Response: 200 OK
   - Members list with Diana (manager) first, then Alice (member)

5. **Verify unassigned employees list**
   ```bash
   GET /rpc.v1.DepartmentService/GetUnassignedEmployees
   ```
   
   **Expected**:
   - Response: 200 OK
   - Charlie (unassigned) in list
   - Alice and Diana NOT in list (already assigned)

**Validation**:
- ✅ Employees assigned successfully
- ✅ member_count updated by trigger
- ✅ Manager designation works correctly
- ✅ manager_count updated by trigger
- ✅ Unassigned employees query excludes assigned employees

---

### Scenario 3: Manager Permissions (Department Manager adds employee)

**User Story**: As a department manager, I want to add unassigned employees to my department.

**Test Steps**:

1. **Login as Diana (Backend department manager)**
   ```bash
   # Authenticate as diana@testcorp.com
   # Extract auth token
   ```

2. **Try to add unassigned employee to own department**
   ```bash
   POST /rpc.v1.DepartmentService/AssignEmployeeToDepartment
   Authorization: Bearer <diana_token>
   {
     "department_id": "<backend_dept_id>",
     "employee_id": "<charlie_id>",
     "role": "member"
   }
   ```
   
   **Expected**:
   - Response: 200 OK
   - Charlie assigned to Backend department
   - Backend department member_count = 3

3. **Try to add employee from another department (should fail)**
   ```bash
   POST /rpc.v1.DepartmentService/AssignEmployeeToDepartment
   Authorization: Bearer <diana_token>
   {
     "department_id": "<backend_dept_id>",
     "employee_id": "<bob_id>",  // Bob is in Sales department
     "role": "member"
   }
   ```
   
   **Expected**:
   - Response: 403 Forbidden (PERMISSION_DENIED)
   - Error: "Department managers can only add unassigned employees"

4. **Try to move employee to another department (should fail)**
   ```bash
   POST /rpc.v1.DepartmentService/RemoveEmployeeFromDepartment
   Authorization: Bearer <diana_token>
   {
     "employee_id": "<alice_id>"
   }
   ```
   
   **Expected**:
   - Response: 403 Forbidden (PERMISSION_DENIED)
   - Error: "Only ROLE_OWNER and ROLE_OPERATOR can remove employees"

5. **Try to delete department (should fail)**
   ```bash
   DELETE /rpc.v1.DepartmentService/DeleteDepartment
   Authorization: Bearer <diana_token>
   {
     "department_id": "<backend_dept_id>"
   }
   ```
   
   **Expected**:
   - Response: 403 Forbidden (PERMISSION_DENIED)
   - Error: Proto-level access control rejects (not ROLE_OWNER/OPERATOR)

**Validation**:
- ✅ Managers can add unassigned employees to their own department
- ✅ Managers cannot move employees from other departments
- ✅ Managers cannot remove employees from their department
- ✅ Managers cannot delete or rename departments
- ✅ Proto-level access control enforced correctly

---

### Scenario 4: Move Employee Between Departments

**User Story**: As ROLE_OWNER, I want to reorganize employees by moving them between departments.

**Test Steps**:

1. **Create Sales department**
   ```bash
   POST /rpc.v1.DepartmentService/CreateDepartment
   {
     "name": "Sales",
     "description": "Revenue generation"
   }
   ```

2. **Move employee from Backend to Sales**
   ```bash
   POST /rpc.v1.DepartmentService/AssignEmployeeToDepartment
   {
     "department_id": "<sales_dept_id>",
     "employee_id": "<charlie_id>",
     "role": "member"
   }
   ```
   
   **Expected**:
   - Response: 200 OK
   - Charlie moved from Backend to Sales
   - Backend department member_count decremented to 2 (by trigger)
   - Sales department member_count incremented to 1 (by trigger)

3. **Verify counts updated correctly**
   ```bash
   GET /rpc.v1.DepartmentService/GetDepartment?department_id=<backend_dept_id>
   GET /rpc.v1.DepartmentService/GetDepartment?department_id=<sales_dept_id>
   ```
   
   **Expected**:
   - Backend: member_count = 2 (Alice, Diana)
   - Sales: member_count = 1 (Charlie)

**Validation**:
- ✅ Employee moved between departments successfully
- ✅ Counts updated automatically by triggers
- ✅ Unique constraint ensures single department membership

---

### Scenario 5: Prevent Circular References

**User Story**: As ROLE_OWNER, the system should prevent me from creating circular references when moving departments.

**Test Steps**:

1. **Create department hierarchy: Engineering > Backend > Services**
   ```bash
   POST /rpc.v1.DepartmentService/CreateDepartment
   {
     "name": "Services",
     "description": "Microservices team",
     "parent_department_id": "<backend_dept_id>"
   }
   ```
   
   **Expected**:
   - Services department created under Backend
   - Backend child_count = 1

2. **Try to move Engineering under Services (create circular reference)**
   ```bash
   POST /rpc.v1.DepartmentService/MoveDepartment
   {
     "department_id": "<engineering_dept_id>",
     "new_parent_id": "<services_dept_id>"
   }
   ```
   
   **Expected**:
   - Response: 400 Bad Request (INVALID_ARGUMENT)
   - Error: "Cannot move department to its own descendant"
   - No database changes made

3. **Try to move Backend under Services (also circular)**
   ```bash
   POST /rpc.v1.DepartmentService/MoveDepartment
   {
     "department_id": "<backend_dept_id>",
     "new_parent_id": "<services_dept_id>"
   }
   ```
   
   **Expected**:
   - Response: 400 Bad Request (INVALID_ARGUMENT)
   - Error: "Cannot move department to its own descendant"

4. **Valid move: Move Services to root level**
   ```bash
   POST /rpc.v1.DepartmentService/MoveDepartment
   {
     "department_id": "<services_dept_id>",
     "new_parent_id": null
   }
   ```
   
   **Expected**:
   - Response: 200 OK
   - Services moved to root level (parent_department_id = NULL)
   - Backend child_count decremented to 0

**Validation**:
- ✅ Circular reference validation works correctly
- ✅ Descriptive error messages returned
- ✅ Valid moves succeed
- ✅ child_count updated correctly after move

---

### Scenario 6: Delete Department with Validation

**User Story**: As ROLE_OWNER, I want to delete empty departments, but the system should prevent deletion if members or children exist.

**Test Steps**:

1. **Try to delete department with members (should fail)**
   ```bash
   DELETE /rpc.v1.DepartmentService/DeleteDepartment
   {
     "department_id": "<backend_dept_id>"
   }
   ```
   
   **Expected**:
   - Response: 400 Bad Request (FAILED_PRECONDITION)
   - Error: "Cannot delete department with members. Migrate members out first."
   - Backend department still exists

2. **Remove all members from department**
   ```bash
   POST /rpc.v1.DepartmentService/RemoveEmployeeFromDepartment
   {"employee_id": "<alice_id>"}
   
   POST /rpc.v1.DepartmentService/RemoveEmployeeFromDepartment
   {"employee_id": "<diana_id>"}
   ```
   
   **Expected**:
   - Backend department member_count = 0, manager_count = 0

3. **Try to delete department with children (should fail if RESTRICT)**
   ```bash
   DELETE /rpc.v1.DepartmentService/DeleteDepartment
   {
     "department_id": "<engineering_dept_id>"
   }
   ```
   
   **Expected**:
   - Response: 400 Bad Request (FAILED_PRECONDITION)
   - Error: "Cannot delete department with child departments"
   - Engineering department still exists

4. **Delete leaf department successfully**
   ```bash
   DELETE /rpc.v1.DepartmentService/DeleteDepartment
   {
     "department_id": "<backend_dept_id>"
   }
   ```
   
   **Expected**:
   - Response: 200 OK
   - Backend department deleted
   - Engineering child_count decremented to 1 (Frontend remains)

**Validation**:
- ✅ Deletion blocked when department has members
- ✅ Deletion blocked when department has children
- ✅ Empty departments can be deleted
- ✅ parent child_count updated after deletion

---

### Scenario 7: Multi-Tenant Isolation

**User Story**: As a platform operator, I want to ensure departments from different organizations never leak across tenants.

**Test Steps**:

1. **Create second organization (Acme Corp)**
   ```bash
   POST /rpc.v1.OrganizationService/RegisterOrganizationWithAdminPassword
   {
     "organization_name": "Acme Corp",
     "organization_slug": "acme-corp",
     "admin_email": "admin@acmecorp.com",
     "admin_password": "SecurePass456!",
     "admin_first_name": "Acme",
     "admin_last_name": "Admin"
   }
   ```

2. **Create department in Acme Corp**
   ```bash
   Authorization: Bearer <acme_admin_token>
   POST /rpc.v1.DepartmentService/CreateDepartment
   {
     "name": "Marketing",
     "description": "Acme marketing team"
   }
   ```

3. **Try to access Test Corp departments as Acme Corp user**
   ```bash
   Authorization: Bearer <acme_admin_token>
   GET /rpc.v1.DepartmentService/GetDepartment?department_id=<testcorp_engineering_id>
   ```
   
   **Expected**:
   - Response: 404 Not Found (or empty result)
   - Test Corp departments not visible to Acme Corp users

4. **Get department tree as Acme Corp user**
   ```bash
   Authorization: Bearer <acme_admin_token>
   GET /rpc.v1.DepartmentService/GetDepartmentTree
   ```
   
   **Expected**:
   - Response: 200 OK
   - Only Marketing department returned (Acme Corp's department)
   - Test Corp departments NOT included

5. **Try to assign Test Corp employee to Acme Corp department (should fail)**
   ```bash
   Authorization: Bearer <acme_admin_token>
   POST /rpc.v1.DepartmentService/AssignEmployeeToDepartment
   {
     "department_id": "<acme_marketing_id>",
     "employee_id": "<testcorp_alice_id>",
     "role": "member"
   }
   ```
   
   **Expected**:
   - Response: 400 Bad Request (INVALID_ARGUMENT)
   - Error: "Employee not found" or "Cross-organization assignment not allowed"
   - Foreign key constraint violation prevented

**Validation**:
- ✅ organization_id filters enforced on all queries
- ✅ Row-level security policies prevent cross-tenant access
- ✅ Foreign key constraints prevent cross-org employee assignment
- ✅ TenantPool connection enforces organization context

---

### Scenario 8: Warning Indicators for Empty Departments

**User Story**: As ROLE_OWNER viewing the department tree, I want to see warnings for departments with no manager or no members.

**Test Steps**:

1. **Create empty department**
   ```bash
   POST /rpc.v1.DepartmentService/CreateDepartment
   {
     "name": "Research",
     "description": "Future R&D team"
   }
   ```
   
   **Expected**:
   - Department created with member_count = 0, manager_count = 0

2. **Get department tree**
   ```bash
   GET /rpc.v1.DepartmentService/GetDepartmentTree
   ```
   
   **Expected**:
   - Response includes Research department with:
     ```json
     {
       "id": "<research_id>",
       "name": "Research",
       "member_count": 0,
       "manager_count": 0
     }
     ```

3. **Frontend renders warning indicator**
   - UI displays yellow/amber warning icon next to "Research"
   - Tooltip: "No manager assigned • No members assigned"

4. **Add employee without manager**
   ```bash
   POST /rpc.v1.DepartmentService/AssignEmployeeToDepartment
   {
     "department_id": "<research_id>",
     "employee_id": "<charlie_id>",
     "role": "member"
   }
   ```
   
   **Expected**:
   - Research member_count = 1, manager_count = 0
   - Warning changes to "No manager assigned" only

**Validation**:
- ✅ Empty departments allowed (not blocked)
- ✅ Cached counts enable efficient warning detection
- ✅ Frontend displays appropriate warnings based on counts

---

## Performance Validation

### Tree Query Performance

**Test**: Query department tree with 500 departments (10 levels deep)

```bash
# Create 500 departments in hierarchical structure
# Measure query time
time curl http://localhost:18080/rpc.v1.DepartmentService/GetDepartmentTree \
  -H "Authorization: Bearer <token>"
```

**Expected**: 
- Query completes in <100ms (target: <200ms p95)
- Single recursive CTE query (no N+1 issues)

### Count Maintenance Performance

**Test**: Assign 100 employees to departments and measure count update latency

```bash
# Bulk assign 100 employees
for i in {1..100}; do
  curl -X POST http://localhost:18080/rpc.v1.DepartmentService/AssignEmployeeToDepartment \
    -d "{\"department_id\": \"<dept_id>\", \"employee_id\": \"<emp_${i}_id>\", \"role\": \"member\"}"
done
```

**Expected**:
- Each assignment completes in <50ms
- member_count updates instantly (trigger-maintained)
- No count drift or inconsistencies

---

## Integration Test Suite

### Go Integration Tests

File: `backend/integration/department_test.go`

```go
func TestDepartmentHierarchy(t *testing.T) {
    // Test Scenario 1: Create department hierarchy
    // Test Scenario 2: Assign employees
    // Test Scenario 3: Manager permissions
    // Test Scenario 4: Move employees
    // Test Scenario 5: Circular reference prevention
    // Test Scenario 6: Delete validation
    // Test Scenario 7: Multi-tenant isolation
}

func TestDepartmentCounts(t *testing.T) {
    // Verify trigger-maintained counts are accurate
    // Test INSERT, UPDATE, DELETE on department_member
    // Test department moves (parent_department_id changes)
}

func TestDepartmentPermissions(t *testing.T) {
    // Verify RBAC enforcement
    // Test proto-level access control
    // Test custom manager authorization logic
}
```

### Frontend Component Tests

File: `frontend/apps/web/src/app/workspace/organization/components/DepartmentsTab.test.tsx`

```typescript
describe('DepartmentsTab', () => {
  it('renders department tree with expand/collapse', () => {})
  it('displays warning indicators for empty departments', () => {})
  it('allows OWNER to create/edit/delete departments', () => {})
  it('restricts manager actions appropriately', () => {})
  it('handles drag-and-drop for department moves', () => {})
})
```

---

## Success Criteria

All scenarios must pass with:
- ✅ Correct business logic behavior
- ✅ Multi-tenant isolation enforced
- ✅ RBAC permissions working as specified
- ✅ Cached counts accurate (no drift)
- ✅ Circular references prevented
- ✅ Warning indicators displayed correctly
- ✅ Performance targets met (<100ms tree query, <200ms p95 CRUD)

---

## Troubleshooting

### Common Issues

**Issue**: Counts not updating after employee assignment  
**Solution**: Check trigger is installed: `SELECT * FROM pg_trigger WHERE tgname LIKE 'trigger_update_department%';`

**Issue**: Circular reference validation not working  
**Solution**: Verify IsDepartmentDescendant query called before MoveDepartment in service layer

**Issue**: Cross-tenant data leak  
**Solution**: Verify all queries include `WHERE organization_id = $1` filter, check RLS policies enabled

**Issue**: Manager cannot add employees  
**Solution**: Verify IsDepartmentManager custom authorization logic in AssignEmployeeToDepartment method

---

## Next Steps

After quickstart validation passes:
1. Run full integration test suite
2. Perform load testing with 1000+ departments
3. Test frontend tree view with deep hierarchies
4. Validate warning indicators in UI
5. Test drag-and-drop department moves
6. Review error messages for clarity
7. Update documentation with any edge cases discovered
