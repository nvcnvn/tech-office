# Quickstart: Permission-Based Authorization System

**Feature Branch**: `020-authz-redo-with-permission-in`  
**Date**: 2026-03-02

---

## Test Scenarios

These scenarios validate the feature against the spec's acceptance criteria. Each is designed to be an integration test in `backend/integration/`.

### Scenario 1: Default Roles Exist for New Organizations

**Given**: A freshly registered organization  
**When**: ListRoles is called  
**Then**: Three system roles exist: Owner, Operator, Employee  
**And**: Each role has the correct permissions as defined in FR-007  
**And**: All three roles have `is_system = true`

```
1. Register a new organization (RegisterOrganizationWithAdminPassword)
2. Authenticate as the owner
3. Call ListRoles
4. Assert: 3 roles returned
5. Call GetRole for each → verify permission sets match spec:
   - Owner: all ~80 permissions
   - Operator: all except iam.importEmployees, files.updateQuota, iam.manageRoles
   - Employee: all except administrative permissions (per FR-007)
```

### Scenario 2: Permission Denied for Missing Permission

**Given**: An employee with only the default "Employee" role  
**When**: The employee calls CreateDepartment (requires `dept.create`)  
**Then**: Request is denied with `PERMISSION_DENIED`

```
1. Get test identity with employee role
2. Call CreateDepartment
3. Assert: error code = PERMISSION_DENIED
```

### Scenario 3: Union of Permissions Across Multiple Roles

**Given**: A user has "Employee" role + custom "Project Lead" role  
**Where**: "Project Lead" has `collab.archiveProject` permission  
**When**: The user calls ArchiveProject  
**Then**: Request succeeds (union of permissions)

```
1. Authenticate as owner
2. CreateRole "Project Lead" with permissions: ["collab.archiveProject"]
3. AssignRole "Project Lead" to a test employee
4. Authenticate as the employee (who already has "Employee" role)
5. Call ArchiveProject on a test project
6. Assert: success (employee role alone doesn't have archiveProject, 
   but the union with "Project Lead" does)
```

### Scenario 4: Permission Removed from Role Takes Effect Immediately

**Given**: An owner updates a custom role to remove `chat.sendMessage`  
**When**: A user with that role next calls SendMessage  
**Then**: The request is denied

```
1. Authenticate as owner
2. CreateRole "Chatter" with permissions: ["chat.sendMessage", "chat.viewMessages"]
3. AssignRole "Chatter" to a test employee (remove default Employee role)
4. Authenticate as employee → call SendMessage → assert success
5. Authenticate as owner → UpdateRole "Chatter" removing "chat.sendMessage"
6. Authenticate as employee → call SendMessage → assert PERMISSION_DENIED
```

### Scenario 5: OR Semantics for Multiple Permissions on RPC

**Given**: An RPC declares `required_permissions: ["chat.createChannel"]`  
**When**: A user has the `chat.createChannel` permission  
**Then**: Request succeeds

```
1. Get test identity with employee role (which includes chat.createChannel)
2. Call CreateChannel
3. Assert: success
```

### Scenario 6: Authenticated-Only Endpoint (No Specific Permission)

**Given**: An RPC has empty `required_permissions` and `allow_unauthenticated: false`  
**When**: Any authenticated user calls it  
**Then**: Request succeeds regardless of permissions

```
Note: Most endpoints require specific permissions. This scenario applies to 
endpoints that only need authentication (e.g., ChangePassword maps to 
iam.changePassword which all roles have, but the pattern is tested).
```

### Scenario 7: Unauthenticated Endpoints Still Work

**Given**: An RPC has `allow_unauthenticated: true` (Login, ExchangeToken, etc.)  
**When**: Called without any auth token  
**Then**: Request succeeds

```
1. Call Login with valid credentials and no auth header
2. Assert: success, access_token returned
3. Call ExchangeToken with valid SSO token and no auth header
4. Assert: success
```

### Scenario 8: Role Deletion Cascades to Employee Permissions

**Given**: A custom role "Auditor" assigned to 3 employees  
**When**: The role is deleted  
**Then**: All 3 employees lose those permissions immediately

```
1. Authenticate as owner
2. CreateRole "Auditor" with permissions: ["notif.view", "collab.viewProject"]
3. Assign "Auditor" to employee A, B, C
4. Verify: GetEmployeePermissions for A includes "notif.view"
5. DeleteRole "Auditor"
6. Verify: GetEmployeePermissions for A no longer includes "notif.view"
   (employee still has their default Employee role permissions)
```

### Scenario 9: System Roles Cannot Be Deleted

**Given**: The "Owner" system role  
**When**: DeleteRole is called with the Owner role ID  
**Then**: Request fails with appropriate error

```
1. Authenticate as owner
2. ListRoles → find the Owner system role ID
3. Call DeleteRole with Owner role ID
4. Assert: error (system roles cannot be deleted)
```

### Scenario 10: Lockout Prevention on Owner Role

**Given**: The "Owner" system role  
**When**: UpdateRole attempts to remove `iam.manageRoles` permission  
**Then**: Request fails to prevent lockout

```
1. Authenticate as owner
2. GetRole for Owner → get current permissions
3. UpdateRole removing "iam.manageRoles" from the permission list
4. Assert: error indicating lockout-prevention permissions cannot be removed
```

### Scenario 11: Custom Role CRUD Lifecycle

```
1. Authenticate as owner
2. ListPermissions → verify all ~80 permissions returned grouped by domain
3. CreateRole "HR Manager" with permissions:
   ["iam.listEmployees", "iam.inviteUser", "dept.view", "dept.assignEmployee"]
4. Assert: role created with correct permissions
5. ListRoles → verify "HR Manager" appears alongside system roles
6. UpdateRole "HR Manager" adding "dept.removeEmployee"
7. GetRole → verify updated permissions
8. AssignRole "HR Manager" to test employee
9. ListEmployeeRoles for that employee → verify "HR Manager" in list
10. GetEmployeePermissions → verify union includes HR Manager permissions
11. RevokeRole "HR Manager" from employee
12. GetEmployeePermissions → verify HR Manager permissions no longer present
13. DeleteRole "HR Manager"
14. ListRoles → verify "HR Manager" removed
```

### Scenario 12: Permission Resolution Performance

**Given**: A user with 3 roles totaling ~80 permissions  
**When**: The user makes an API call  
**Then**: Permission resolution adds < 5ms latency

```
Note: This is measured via instrumentation, not a functional test.
Add slog timing around the permission lookup query in the interceptor.
```

---

## Manual Verification Steps

1. **Start backend**: `cd backend && go run ./cmd server`
2. **Register org**: Call RegisterOrganizationWithAdminPassword via grpcurl/curl
3. **Login as owner**: Call Login → get JWT
4. **List roles**: Call ListRoles → verify 3 system roles
5. **Create custom role**: Call CreateRole with selected permissions
6. **Assign to employee**: Call AssignRole
7. **Test as employee**: Login as employee → call an endpoint their new role grants
8. **Verify permission denied**: Call an endpoint the employee doesn't have permission for
9. **Revoke and re-test**: RevokeRole → verify the endpoint now returns PERMISSION_DENIED

---

## Codegen Steps (Post-Implementation)

```bash
# After schema.sql changes
cd backend && sqlc generate

# After proto changes
cd backend && buf generate

# Frontend proto package update
cd frontend && pnpm -r build
```
