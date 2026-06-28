// Package department defines department service constants.
// All department member role values MUST align with:
// - Database CHECK constraint: organization.department_member.role
// - Frontend TypeScript types: packages/apis/src/department.ts
//
// When adding/removing values:
// 1. Update database CHECK constraint in backend/database/scripts/schema.sql
// 2. Update these Go constants
// 3. Update frontend TypeScript types
// 4. Submit all changes in single PR with alignment verification
package department

// DepartmentMemberRole defines allowed department membership roles.
// These MUST match the database CHECK constraint in organization.department_member table.
const (
	DepartmentRoleMember  = "member"  // Regular department member (default)
	DepartmentRoleManager = "manager" // Department manager with elevated privileges
)

// IsValidDepartmentRole checks if a role string is valid.
// Used for runtime validation to catch alignment issues.
func IsValidDepartmentRole(role string) bool {
	switch role {
	case DepartmentRoleMember,
		DepartmentRoleManager:
		return true
	default:
		return false
	}
}

// AllDepartmentRoles returns all valid department roles for validation and testing.
func AllDepartmentRoles() []string {
	return []string{
		DepartmentRoleMember,
		DepartmentRoleManager,
	}
}
