package iam

import (
	"context"

	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
)

// PermissionLookupAdapter implements interceptor.PermissionLookup using IAM database queries.
type PermissionLookupAdapter struct {
	queries *database.Queries
	pool    database.AdminDatabaseConnector
}

// NewPermissionLookup creates a PermissionLookup that queries user permissions from the database.
func NewPermissionLookup(queries *database.Queries, pool database.AdminDatabaseConnector) *PermissionLookupAdapter {
	return &PermissionLookupAdapter{queries: queries, pool: pool}
}

// GetPermissionsForUserInOrg returns the permission strings a user has in a specific organization.
// Resolves all assigned roles and returns the union of their permissions.
func (p *PermissionLookupAdapter) GetPermissionsForUserInOrg(ctx context.Context, userID, orgID string) ([]string, error) {
	uid, err := dbuuid.Parse(userID)
	if err != nil {
		return nil, err
	}
	oid, err := dbuuid.Parse(orgID)
	if err != nil {
		return nil, err
	}
	return p.queries.GetUserPermissionsInOrg(ctx, p.pool, &database.GetUserPermissionsInOrgParams{
		UserID:         uid,
		OrganizationID: oid,
	})
}
