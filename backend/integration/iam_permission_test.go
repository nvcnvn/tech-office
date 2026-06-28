package integration

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// TestIAMPermissions covers the permission-based authorization system:
// default role seeding, role CRUD lifecycle, and permission assignment.
func TestIAMPermissions(t *testing.T) {
	w := newTestWorld(t)
	owner := w.withOwner()

	// -----------------------------------------------------------------------
	// Scenario 1: Default roles exist for new organizations
	// -----------------------------------------------------------------------
	t.Run("when a new organization is registered", func(t *testing.T) {
		roles := w.listRoles(owner)

		t.Run("it has exactly 3 system roles", func(t *testing.T) {
			require.Len(t, roles, 3, "expected 3 default system roles (Owner, Operator, Employee)")
			for _, r := range roles {
				assert.True(t, r.IsSystem, "default role %q should be a system role", r.Name)
			}
		})

		t.Run("the Owner role has all permissions", func(t *testing.T) {
			allPerms := w.listPermissions(owner, nil)
			var totalPermCount int
			for _, g := range allPerms {
				totalPermCount += len(g.Permissions)
			}

			ownerRole := findRoleByName(roles, "Owner")
			require.NotNil(t, ownerRole, "Owner role must exist")
			detail := w.getRole(owner, ownerRole.Id)
			assert.Len(t, detail.PermissionIds, totalPermCount,
				"Owner role should have every permission")
			assert.Equal(t, int32(1), detail.EmployeeCount, "Owner role should have 1 member (the registering user)")
		})

		t.Run("the owner profile membership includes the Owner role name", func(t *testing.T) {
			profile := w.getProfile(owner)
			require.Len(t, profile.Organizations, 1, "new owner should belong to exactly one organization")
			assert.Contains(t, profile.Organizations[0].RoleNames, "Owner")
		})

		t.Run("the Employee role has basic permissions", func(t *testing.T) {
			empRole := findRoleByName(roles, "Employee")
			require.NotNil(t, empRole, "Employee role must exist")
			detail := w.getRole(owner, empRole.Id)
			assert.Greater(t, len(detail.PermissionIds), 0, "Employee role should have some permissions")
			// Employee should NOT have admin-level permissions
			permSet := toStringSet(detail.PermissionIds)
			assert.Contains(t, permSet, "iam.viewRoles", "Employee should be able to read their own effective permissions")
			assert.NotContains(t, permSet, "iam.manageRoles", "Employee should not have iam.manageRoles")
			assert.NotContains(t, permSet, "iam.managePermissions", "Employee should not have iam.managePermissions")
		})

		t.Run("the Operator role is between Owner and Employee", func(t *testing.T) {
			opRole := findRoleByName(roles, "Operator")
			require.NotNil(t, opRole, "Operator role must exist")
			empRole := findRoleByName(roles, "Employee")
			require.NotNil(t, empRole, "Employee role must exist")
			opDetail := w.getRole(owner, opRole.Id)
			empDetail := w.getRole(owner, empRole.Id)
			assert.Greater(t, len(opDetail.PermissionIds), len(empDetail.PermissionIds),
				"Operator should have more permissions than Employee")
		})
	})

	t.Run("default employee can read their own effective permissions", func(t *testing.T) {
		emp := w.withEmployee()
		perms := w.getEmployeePermissions(emp, emp.ID.String())
		assert.Contains(t, perms, "iam.viewRoles")
	})

	// -----------------------------------------------------------------------
	// Scenario 11: Custom role CRUD lifecycle
	// -----------------------------------------------------------------------
	t.Run("custom role CRUD lifecycle", func(t *testing.T) {
		// Step 1: ListPermissions → pick some permission IDs
		allPerms := w.listPermissions(owner, nil)
		require.Greater(t, len(allPerms), 0, "should have permission groups")
		var chatPerms []string
		for _, g := range allPerms {
			if g.Domain == "chat" {
				for _, p := range g.Permissions {
					chatPerms = append(chatPerms, p.Id)
				}
				break
			}
		}
		require.Greater(t, len(chatPerms), 0, "should have chat permissions")

		// Step 2: CreateRole with chat permissions
		var createdRoleID string
		t.Run("when creating a custom role", func(t *testing.T) {
			role := w.createRole(owner, "Chat Manager", "Manages chat channels", chatPerms)
			createdRoleID = role.Id
			assert.Equal(t, "Chat Manager", role.Name)
			assert.Equal(t, "Manages chat channels", role.Description)
			assert.False(t, role.IsSystem, "custom role should not be a system role")
			assert.ElementsMatch(t, chatPerms, role.PermissionIds)
		})

		// Step 3: ListRoles → should include the new custom role
		t.Run("when listing roles after creation", func(t *testing.T) {
			roles := w.listRoles(owner)
			found := findRoleByName(roles, "Chat Manager")
			require.NotNil(t, found, "custom role should appear in list")
			assert.Equal(t, createdRoleID, found.Id)
		})

		// Step 4: UpdateRole → change name and permissions
		t.Run("when updating the custom role", func(t *testing.T) {
			newName := "Chat Lead"
			// Use only the first chat permission
			updated := w.updateRole(owner, createdRoleID, &newName, nil, chatPerms[:1])
			assert.Equal(t, "Chat Lead", updated.Name)
			assert.Equal(t, chatPerms[:1], updated.PermissionIds)
		})

		// Step 5: GetRole → verify update persisted
		t.Run("when getting the updated role", func(t *testing.T) {
			role := w.getRole(owner, createdRoleID)
			assert.Equal(t, "Chat Lead", role.Name)
			assert.Len(t, role.PermissionIds, 1)
		})

		// Step 6: Create an employee and assign the custom role
		emp := w.withEmployee()
		t.Run("when assigning the custom role to an employee", func(t *testing.T) {
			w.assignRole(owner, emp.ID.String(), createdRoleID)

			t.Run("the employee has the custom role in their role list", func(t *testing.T) {
				empRoles := w.listEmployeeRoles(owner, emp.ID.String())
				var names []string
				for _, r := range empRoles {
					names = append(names, r.Name)
				}
				assert.Contains(t, names, "Chat Lead", "employee should have the custom role")
				assert.Contains(t, names, "Employee", "employee should also have the default Employee role")
			})

			t.Run("the employee has the effective permissions from all roles", func(t *testing.T) {
				perms := w.getEmployeePermissions(owner, emp.ID.String())
				assert.Contains(t, perms, chatPerms[0],
					"employee should have the custom role's permission")
			})
		})

		// Step 7: GetRole → verify employee count increased
		t.Run("assigned role shows correct employee count", func(t *testing.T) {
			role := w.getRole(owner, createdRoleID)
			assert.Equal(t, int32(1), role.EmployeeCount)
		})

		// Step 8: RevokeRole → remove custom role from employee
		t.Run("when revoking the custom role from the employee", func(t *testing.T) {
			w.revokeRole(owner, emp.ID.String(), createdRoleID)
			empRoles := w.listEmployeeRoles(owner, emp.ID.String())
			var names []string
			for _, r := range empRoles {
				names = append(names, r.Name)
			}
			assert.NotContains(t, names, "Chat Lead", "custom role should be removed")
			assert.Contains(t, names, "Employee", "default Employee role should remain")
		})

		// Step 9: DeleteRole → remove the custom role
		t.Run("when deleting the custom role", func(t *testing.T) {
			w.deleteRole(owner, createdRoleID)
			roles := w.listRoles(owner)
			found := findRoleByName(roles, "Chat Lead")
			assert.Nil(t, found, "deleted role should not appear in list")
		})
	})
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func findRoleByName(roles []*rpcv1.OrgRole, name string) *rpcv1.OrgRole {
	for _, r := range roles {
		if r.Name == name {
			return r
		}
	}
	return nil
}

func toStringSet(ss []string) map[string]struct{} {
	m := make(map[string]struct{}, len(ss))
	for _, s := range ss {
		m[s] = struct{}{}
	}
	return m
}
