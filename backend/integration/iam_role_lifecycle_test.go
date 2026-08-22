package integration

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// TestIAMPermissionDenied covers Scenario 2, 5, and 7:
// permission enforcement, OR semantics, and unauthenticated endpoints.
func TestIAMPermissionDenied(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()
	emp := w.withEmployee()

	// Scenario 2: Employee without dept.create gets PERMISSION_DENIED
	t.Run("when employee calls CreateDepartment without dept.create permission", func(t *testing.T) {
		req := connect.NewRequest(&rpcv1.CreateDepartmentRequest{
			Name: "Forbidden Dept",
		})
		req.Header().Set("Authorization", "Bearer "+emp.Token)
		_, err := w.dept.CreateDepartment(context.Background(), req)
		require.Error(t, err)

		t.Run("it returns PERMISSION_DENIED", func(t *testing.T) {
			assert.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err))
		})
	})

	// Scenario 5: OR semantics — employee with chat.createChannel can create channels
	t.Run("when employee calls CreateChannel with chat.createChannel permission", func(t *testing.T) {
		// Employee role includes chat.createChannel by default
		channelID := w.createChannel(emp, "emp-channel", false)

		t.Run("it succeeds", func(t *testing.T) {
			assert.NotEmpty(t, channelID)
		})
	})

	// Scenario 2 extension: Owner (who has all permissions) should succeed
	t.Run("when owner calls CreateDepartment", func(t *testing.T) {
		deptID := w.createDepartment(owner, "Allowed Dept", "")

		t.Run("it succeeds", func(t *testing.T) {
			assert.NotEmpty(t, deptID)
		})
	})

	// Scenario 7: Unauthenticated endpoints work without auth headers
	t.Run("when Login is called without auth header", func(t *testing.T) {
		req := connect.NewRequest(&rpcv1.LoginRequest{
			Email:    "nonexistent@test.invalid",
			Password: "doesnotmatter",
		})
		// Intentionally no Authorization header
		_, err := w.iamClient.Login(context.Background(), req)

		t.Run("it does not return UNAUTHENTICATED from the auth interceptor", func(t *testing.T) {
			// Login is allow_unauthenticated, so the auth interceptor should not block it.
			// The handler itself may return CodeUnauthenticated for invalid credentials
			// (via ErrInvalidCredentials → ToConnectError), which is correct behavior.
			// We verify the interceptor did NOT block the request by checking the error
			// message is from the handler, not the interceptor.
			require.Error(t, err, "Login should fail for nonexistent user")
			assert.NotContains(t, err.Error(), "authentication token required",
				"Login should not be blocked by auth interceptor")
		})
	})
}

// TestIAMPermissionUnion covers Scenario 3 and 4:
// union of permissions across roles and immediate effect on removal.
func TestIAMPermissionUnion(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()
	emp := w.withEmployee()

	// Scenario 3: Union of permissions across multiple roles
	t.Run("when employee has multiple roles their permissions are unioned", func(t *testing.T) {
		// Employee doesn't have dept.create by default — verify:
		req := connect.NewRequest(&rpcv1.CreateDepartmentRequest{Name: "Before Custom Role"})
		req.Header().Set("Authorization", "Bearer "+emp.Token)
		_, err := w.dept.CreateDepartment(context.Background(), req)
		require.Error(t, err, "employee should not have dept.create by default")
		assert.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err))

		// Create a custom role with dept.create
		customRole := w.createRole(owner, "Dept Creator", "Can create departments", []string{"dept.create"})

		// Assign custom role alongside Employee role
		w.assignRole(owner, emp.ID.String(), customRole.Id)

		// Verify: employee now has union of Employee + Dept Creator permissions
		// The permissions are looked up from DB on each request, so the existing token should work.
		perms := w.getEmployeePermissions(owner, emp.ID.String())
		assert.Contains(t, perms, "dept.create", "employee should now have dept.create from custom role")

		// The employee should now be able to create a department
		// Note: the auth interceptor looks up permissions from DB on each request,
		// so the existing JWT token should work.
		deptID := w.createDepartment(emp, "After Custom Role", "")

		t.Run("the employee can access the newly granted resource", func(t *testing.T) {
			assert.NotEmpty(t, deptID)
		})

		// Cleanup: revoke the custom role
		w.revokeRole(owner, emp.ID.String(), customRole.Id)
		w.deleteRole(owner, customRole.Id)
	})

	// Scenario 4: Permission removal takes immediate effect
	t.Run("when a permission is removed from a role the change is immediate", func(t *testing.T) {
		// Create custom role with dept.create and assign
		customRole := w.createRole(owner, "Temp Dept Creator", "Temporary", []string{"dept.create"})
		w.assignRole(owner, emp.ID.String(), customRole.Id)

		// Verify access works
		deptID := w.createDepartment(emp, "Temp Dept", "")
		require.NotEmpty(t, deptID, "should succeed with dept.create")

		// Remove dept.create from the custom role (update with empty permissions)
		w.updateRole(owner, customRole.Id, nil, nil, []string{})

		// Verify access is now denied
		req := connect.NewRequest(&rpcv1.CreateDepartmentRequest{Name: "Should Fail"})
		req.Header().Set("Authorization", "Bearer "+emp.Token)
		_, err := w.dept.CreateDepartment(context.Background(), req)

		t.Run("the employee can no longer access the resource", func(t *testing.T) {
			require.Error(t, err)
			assert.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err))
		})

		// Cleanup
		w.revokeRole(owner, emp.ID.String(), customRole.Id)
		w.deleteRole(owner, customRole.Id)
	})
}

// TestIAMRoleLifecycle covers Scenario 8, 9, and 10:
// cascade deletion, system role protection, and lockout prevention.
func TestIAMRoleLifecycle(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()
	employees := w.withEmployees(3)

	// Scenario 8: Role deletion cascades to employee assignments
	t.Run("when a role with assigned employees is deleted", func(t *testing.T) {
		role := w.createRole(owner, "Cascade Test", "Will be deleted", []string{"dept.create"})
		for _, emp := range employees {
			w.assignRole(owner, emp.ID.String(), role.Id)
		}

		// Verify all 3 have the role
		detail := w.getRole(owner, role.Id)
		require.Equal(t, int32(3), detail.EmployeeCount)

		// Delete the role
		w.deleteRole(owner, role.Id)

		t.Run("the role no longer appears in the org roles", func(t *testing.T) {
			roles := w.listRoles(owner)
			found := findRoleByName(roles, "Cascade Test")
			assert.Nil(t, found)
		})

		t.Run("the employees no longer have the deleted role", func(t *testing.T) {
			for _, emp := range employees {
				empRoles := w.listEmployeeRoles(owner, emp.ID.String())
				for _, r := range empRoles {
					assert.NotEqual(t, role.Id, r.Id, "deleted role should be removed from employee")
				}
			}
		})

		t.Run("the employees no longer have the deleted role permissions", func(t *testing.T) {
			for _, emp := range employees {
				perms := w.getEmployeePermissions(owner, emp.ID.String())
				// dept.create was only on the deleted role (Employee role doesn't have it)
				assert.NotContains(t, perms, "dept.create",
					"dept.create from deleted role should be gone")
			}
		})
	})

	// Scenario 9: System roles cannot be deleted
	t.Run("when attempting to delete a system role", func(t *testing.T) {
		roles := w.listRoles(owner)
		ownerRole := findRoleByName(roles, "Owner")
		require.NotNil(t, ownerRole)

		req := connect.NewRequest(&rpcv1.DeleteRoleRequest{RoleId: ownerRole.Id})
		req.Header().Set("Authorization", "Bearer "+owner.Token)
		_, err := w.iamClient.DeleteRole(context.Background(), req)

		t.Run("it returns an error", func(t *testing.T) {
			require.Error(t, err, "deleting a system role should fail")
		})

		t.Run("the role still exists", func(t *testing.T) {
			roles := w.listRoles(owner)
			found := findRoleByName(roles, "Owner")
			assert.NotNil(t, found, "Owner role should still exist")
		})
	})

	// Scenario 10: Lockout prevention — cannot remove iam.manageRoles from Owner
	t.Run("when attempting to remove iam.manageRoles from Owner role", func(t *testing.T) {
		roles := w.listRoles(owner)
		ownerRole := findRoleByName(roles, "Owner")
		require.NotNil(t, ownerRole)

		// Get current permissions for Owner role
		detail := w.getRole(owner, ownerRole.Id)

		// Build a permission list without iam.manageRoles
		var reducedPerms []string
		for _, p := range detail.PermissionIds {
			if p != "iam.manageRoles" {
				reducedPerms = append(reducedPerms, p)
			}
		}
		require.Less(t, len(reducedPerms), len(detail.PermissionIds),
			"Owner should have iam.manageRoles to begin with")

		// Attempt to update
		req := connect.NewRequest(&rpcv1.UpdateRoleRequest{
			RoleId:            ownerRole.Id,
			PermissionIds:     reducedPerms,
			UpdatePermissions: true,
		})
		req.Header().Set("Authorization", "Bearer "+owner.Token)
		_, err := w.iamClient.UpdateRole(context.Background(), req)

		t.Run("it returns an error", func(t *testing.T) {
			require.Error(t, err, "removing iam.manageRoles from Owner should fail")
		})

		t.Run("the Owner role still has iam.manageRoles", func(t *testing.T) {
			current := w.getRole(owner, ownerRole.Id)
			assert.Contains(t, current.PermissionIds, "iam.manageRoles")
		})
	})
}
