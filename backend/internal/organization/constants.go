// Package organization defines organization service constants.
// All organization status values MUST align with:
// - Database CHECK constraint: public.organization.status
// - Frontend TypeScript types: packages/apis/src/organization.ts
//
// When adding/removing values:
// 1. Update database CHECK constraint in backend/database/scripts/schema.sql
// 2. Update these Go constants
// 3. Update frontend TypeScript types
// 4. Submit all changes in single PR with alignment verification
package organization

// OrganizationStatus defines allowed organization lifecycle states.
// These MUST match the database CHECK constraint in public.organization table.
const (
	OrganizationStatusActive    = "active"    // Organization is active and operational (default)
	OrganizationStatusSuspended = "suspended" // Organization is temporarily suspended
	OrganizationStatusDeleted   = "deleted"   // Organization is soft-deleted
)

// IsValidOrganizationStatus checks if a status string is valid.
// Used for runtime validation to catch alignment issues.
func IsValidOrganizationStatus(status string) bool {
	switch status {
	case OrganizationStatusActive,
		OrganizationStatusSuspended,
		OrganizationStatusDeleted:
		return true
	default:
		return false
	}
}

// AllOrganizationStatuses returns all valid organization statuses for validation and testing.
func AllOrganizationStatuses() []string {
	return []string{
		OrganizationStatusActive,
		OrganizationStatusSuspended,
		OrganizationStatusDeleted,
	}
}
