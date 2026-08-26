package organization

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbcrud"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/iam"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// CollaborationLogic interface to avoid import cycle
// Full interface is defined in backend/internal/collaboration/logic.go
type CollaborationLogic interface {
	CreateProject(ctx context.Context, tx database.DBTX, orgID, creatorID dbuuid.UUID, req *rpcv1.CreateProjectRequest) (*rpcv1.Project, []*rpcv1.ProjectState, []*rpcv1.TaskLevel, error)
}

// OrganizationLogic defines the business logic interface for organization operations.
// This layer is pool-agnostic and receives transactions from the Connect layer.
type OrganizationLogic interface {
	GetOrganizationBySubdomain(ctx context.Context, tx database.DBTX, subdomain string) (*database.Organization, error)
	RegisterOrganizationWithAdmin(ctx context.Context, tx database.DBTX, req *RegisterOrgParams) (*database.Organization, error)

	// CheckSubdomainAvailable reports whether a workspace address is free. A malformed
	// address returns ErrSubdomainInvalid. A taken one returns available=false plus the
	// next free variant, so the caller can offer an alternative without a second call.
	CheckSubdomainAvailable(ctx context.Context, tx database.DBTX, subdomain string) (available bool, suggested string, err error)

	// Search methods (multilingual fuzzy search)
	SearchEmployees(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, queryText string, limit int32, cursor *dbuuid.UUID) ([]*database.SearchEmployeesRow, error)
	SearchDepartments(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, queryText string, limit int32, cursor *dbuuid.UUID) ([]*database.SearchDepartmentsRow, error)
	AutocompleteEmployees(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, prefix string, limit int32) ([]*database.AutocompleteEmployeesRow, error)
	AutocompleteDepartments(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, prefix string, limit int32) ([]*database.AutocompleteDepartmentsRow, error)

	// SetCollaborationLogic injects collaboration logic for default project creation
	SetCollaborationLogic(collaborationLogic CollaborationLogic)
}

// RegisterOrgParams holds the parameters for organization registration
type RegisterOrgParams struct {
	CompanyName     string
	Subdomain       string
	AdminEmail      string
	AdminPassword   string
	AdminGivenName  string
	AdminFamilyName string
}

type organizationLogicImpl struct {
	Queries            *database.Queries
	WebappURL          string
	CollaborationLogic CollaborationLogic // Optional: for default project creation
}

// NewOrganizationLogic creates a new organization logic layer implementation
func NewOrganizationLogic(queries *database.Queries, webappURL string) OrganizationLogic {
	return &organizationLogicImpl{
		Queries:   queries,
		WebappURL: webappURL,
	}
}

// SetCollaborationLogic injects collaboration logic for default project creation
// Must be called after both organization and collaboration logic are initialized
func (s *organizationLogicImpl) SetCollaborationLogic(collaborationLogic CollaborationLogic) {
	s.CollaborationLogic = collaborationLogic
}

func (s *organizationLogicImpl) GetOrganizationBySubdomain(
	ctx context.Context,
	tx database.DBTX,
	subdomain string,
) (*database.Organization, error) {
	slog.InfoContext(ctx, "organization lookup by subdomain",
		"service", "organization",
		"operation", "get_by_subdomain",
		"subdomain", subdomain,
	)

	// Step 1: Validate subdomain is not empty
	if subdomain == "" {
		slog.WarnContext(ctx, "empty subdomain provided",
			"service", "organization",
			"operation", "get_by_subdomain",
			"error", "subdomain_empty",
		)
		return nil, fmt.Errorf("subdomain cannot be empty")
	}

	// Step 2: Query organization by subdomain (uses UNIQUE index for fast lookup)
	org, err := s.Queries.GetOrganizationBySubdomain(ctx, tx, subdomain)
	if err != nil {
		// Organization not found
		slog.WarnContext(ctx, "organization not found for subdomain",
			"service", "organization",
			"operation", "get_by_subdomain",
			"subdomain", subdomain,
			"error", err.Error(),
		)
		return nil, fmt.Errorf("organization not found for subdomain: %s", subdomain)
	}

	// Step 3: Log successful lookup
	slog.InfoContext(ctx, "organization found",
		"service", "organization",
		"operation", "get_by_subdomain",
		"subdomain", subdomain,
		"org_id", org.ID.String(),
		"success", true,
	)

	return org, nil
}

// maxSubdomainVariants bounds the search for a free alternative. Collisions are rare and a
// caller staring at "annas-cafe-50" is better served by typing their own address.
const maxSubdomainVariants = 50

// subdomainTaken reports whether an address is already registered.
func (s *organizationLogicImpl) subdomainTaken(ctx context.Context, tx database.DBTX, subdomain string) (bool, error) {
	_, err := s.Queries.GetOrganizationBySubdomain(ctx, tx, subdomain)
	if err == nil {
		return true, nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return false, fmt.Errorf("failed to check workspace address: %w", err)
}

// CheckSubdomainAvailable validates the format and then the availability of an address.
func (s *organizationLogicImpl) CheckSubdomainAvailable(
	ctx context.Context,
	tx database.DBTX,
	subdomain string,
) (bool, string, error) {
	normalized := Normalize(subdomain)
	if err := Validate(normalized); err != nil {
		return false, "", err
	}

	taken, err := s.subdomainTaken(ctx, tx, normalized)
	if err != nil {
		return false, "", err
	}
	if !taken {
		return true, "", nil
	}

	for n := 2; n <= maxSubdomainVariants; n++ {
		variant := NextVariant(normalized, n)
		variantTaken, err := s.subdomainTaken(ctx, tx, variant)
		if err != nil {
			return false, "", err
		}
		if !variantTaken {
			return false, variant, nil
		}
	}

	// Every variant within the bound is taken; report unavailable with no suggestion
	// rather than inventing one the caller cannot use.
	return false, "", nil
}

// RegisterOrganizationWithAdmin handles the registration of a new organization along with an admin user.
// This method performs all operations within the provided transaction.
// TODO: implement idempotency to prevent duplicate orgs on retries
func (s *organizationLogicImpl) RegisterOrganizationWithAdmin(
	ctx context.Context,
	tx database.DBTX,
	req *RegisterOrgParams,
) (*database.Organization, error) {
	slog.InfoContext(ctx, "registering new organization",
		"companyName", req.CompanyName,
		"subdomain", req.Subdomain,
		"adminEmail", req.AdminEmail,
	)

	// Step 0: Validate the workspace address before anything is written. Without this a
	// duplicate reaches the UNIQUE index and surfaces to the caller as a raw pg error.
	subdomain := Normalize(req.Subdomain)
	if err := Validate(subdomain); err != nil {
		slog.WarnContext(ctx, "rejected malformed workspace address", "subdomain", req.Subdomain, "error", err)
		return nil, err
	}
	taken, err := s.subdomainTaken(ctx, tx, subdomain)
	if err != nil {
		return nil, err
	}
	if taken {
		slog.WarnContext(ctx, "rejected taken workspace address", "subdomain", subdomain)
		return nil, fmt.Errorf("%w: %q", ErrSubdomainTaken, subdomain)
	}

	now := pgtype.Timestamptz{
		Time:  time.Now(),
		Valid: true,
	}
	organizationProjectUUID := dbuuid.Must()
	appID := dbuuid.Must()

	// Step 1: Create organization record
	organizationRecord := database.Organization{
		ID:          dbuuid.Must(),
		CompanyName: req.CompanyName,
		ProjectID:   organizationProjectUUID,
		AppID:       appID,
		Status:      OrganizationStatusActive,
		Subdomain:   subdomain,
		UpdatedAt:   now,
	}
	slog.InfoContext(ctx, "creating organization record",
		"orgID", organizationRecord.ID,
		"companyName", organizationRecord.CompanyName,
		"subdomain", organizationRecord.Subdomain,
	)

	err = dbcrud.Create(ctx, tx, &organizationRecord)
	if err != nil {
		slog.ErrorContext(ctx, "failed to create organization record",
			"error", err,
		)
		return nil, fmt.Errorf("failed to create organization: %w", err)
	}
	slog.InfoContext(ctx, "created organization record", "orgID", organizationRecord.ID)

	// Step 2: Create iam.identity record for admin.
	// NOTE: iam.identity is kept for backward compatibility (FK constraint on organization.employee).
	// The email is now stored directly on organization.employee; queries no longer JOIN iam.identity for email.
	identityRecord := database.IamIdentity{
		ID:             dbuuid.Must(),
		OrganizationID: organizationRecord.ID,
		Email:          pgtype.Text{String: req.AdminEmail, Valid: req.AdminEmail != ""},
		IdentityType:   database.IdentityTypeHuman,
		UpdatedAt:      now,
	}
	slog.DebugContext(ctx, "creating identityRecord",
		"identityID", identityRecord.ID,
		"orgID", identityRecord.OrganizationID,
		"email", identityRecord.Email,
	)

	err = dbcrud.Create(ctx, tx, &identityRecord)
	if err != nil {
		slog.ErrorContext(ctx, "failed to create identity record",
			"error", err,
		)
		return nil, fmt.Errorf("failed to create identity: %w", err)
	}

	// Step 3: Create employee record (uses identityRecord.ID so the FK is satisfied)
	employeeRecord := database.OrganizationEmployee{
		ID:             identityRecord.ID,
		OrganizationID: organizationRecord.ID,
		GivenName:      req.AdminGivenName,
		FamilyName:     req.AdminFamilyName,
		Email:          req.AdminEmail,
		IsActive:       true,
		UpdatedAt:      now,
	}
	slog.DebugContext(ctx, "creating employeeRecord",
		"employeeID", employeeRecord.ID,
		"orgID", employeeRecord.OrganizationID,
	)

	err = dbcrud.Create(ctx, tx, &employeeRecord)
	if err != nil {
		slog.ErrorContext(ctx, "failed to create employee record",
			"error", err,
		)
		return nil, fmt.Errorf("failed to create employee: %w", err)
	}

	// Step 4: Create global iam.user (Feature 018 — used by IAMService/Login).
	// IMPORTANT: Use identityRecord.ID so that iam.user.id == organization.employee.id.
	// The JWT 'sub' claim carries iam.user.id, which all downstream services (notification,
	// preference, collaboration, chat, etc.) treat as employee_id when querying org-scoped tables.
	displayName := pgtype.Text{String: req.AdminGivenName + " " + req.AdminFamilyName, Valid: true}
	iamUser, err := s.Queries.CreateIAMUser(ctx, tx, &database.CreateIAMUserParams{
		ID:                identityRecord.ID,
		Email:             pgtype.Text{String: req.AdminEmail, Valid: req.AdminEmail != ""},
		DisplayName:       displayName,
		ProfilePictureUrl: pgtype.Text{},
		Status:            iam.UserStatusActive,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create iam.user record",
			"error", err,
		)
		return nil, fmt.Errorf("failed to create iam user: %w", err)
	}
	slog.DebugContext(ctx, "created iam.user", "userID", iamUser.ID)

	// Step 5: Hash password and create iam.password_credential.
	passwordHash, err := iam.HashPassword(req.AdminPassword)
	if err != nil {
		slog.ErrorContext(ctx, "failed to hash admin password", "error", err)
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	_, err = s.Queries.CreatePasswordCredential(ctx, tx, &database.CreatePasswordCredentialParams{
		ID:           dbuuid.Must(),
		UserID:       iamUser.ID,
		PasswordHash: passwordHash,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create password credential", "error", err)
		return nil, fmt.Errorf("failed to create password credential: %w", err)
	}
	slog.DebugContext(ctx, "created iam.password_credential", "userID", iamUser.ID)

	// Step 6: Seed default roles from reference tables and assign owner role.
	err = s.Queries.SeedOrgRolesFromDefaults(ctx, tx, organizationRecord.ID)
	if err != nil {
		slog.ErrorContext(ctx, "failed to seed org roles", "error", err)
		return nil, fmt.Errorf("failed to seed org roles: %w", err)
	}
	slog.DebugContext(ctx, "seeded iam.role from defaults", "orgID", organizationRecord.ID)

	err = s.Queries.SeedOrgRolePermissionsFromDefaults(ctx, tx, organizationRecord.ID)
	if err != nil {
		slog.ErrorContext(ctx, "failed to seed org role permissions", "error", err)
		return nil, fmt.Errorf("failed to seed org role permissions: %w", err)
	}
	slog.DebugContext(ctx, "seeded iam.role_permission from defaults", "orgID", organizationRecord.ID)

	// Assign the registering user the "owner" role
	ownerRole, err := s.Queries.GetOrgRoleBySourceDefault(ctx, tx, &database.GetOrgRoleBySourceDefaultParams{
		OrganizationID:      organizationRecord.ID,
		SourceDefaultRoleID: pgtype.Text{String: iam.DefaultRoleOwner, Valid: true},
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to find owner role", "error", err)
		return nil, fmt.Errorf("failed to find owner role: %w", err)
	}

	err = s.Queries.AssignRoleToEmployee(ctx, tx, &database.AssignRoleToEmployeeParams{
		OrganizationID: organizationRecord.ID,
		EmployeeID:     iamUser.ID,
		RoleID:         ownerRole.ID,
		AssignedBy:     iamUser.ID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to assign owner role", "error", err)
		return nil, fmt.Errorf("failed to assign owner role: %w", err)
	}
	slog.DebugContext(ctx, "assigned owner role to user", "userID", iamUser.ID, "orgID", organizationRecord.ID)

	// Step 7: Create default collaboration project (if collaboration logic is injected)
	if s.CollaborationLogic != nil {
		slog.InfoContext(ctx, "creating default project for new organization",
			"orgID", organizationRecord.ID,
		)

		_, _, _, err = s.CollaborationLogic.CreateProject(ctx, tx, organizationRecord.ID, identityRecord.ID, &rpcv1.CreateProjectRequest{
			Name:        "General",
			Key:         "GEN",
			Description: "Default project for your organization",
			Visibility:  rpcv1.ProjectVisibility_PROJECT_VISIBILITY_PRIVATE,
		})
		if err != nil {
			slog.ErrorContext(ctx, "failed to create default project",
				"error", err,
				"orgID", organizationRecord.ID,
			)
			// Don't fail registration if default project creation fails
			// Admin can create projects manually
			slog.WarnContext(ctx, "continuing registration without default project")
		} else {
			slog.InfoContext(ctx, "default project created successfully",
				"orgID", organizationRecord.ID,
			)
		}
	}

	slog.InfoContext(ctx, "organization registered successfully",
		"orgID", organizationRecord.ID,
	)

	return &organizationRecord, nil
}

// SearchEmployees performs fuzzy search on employee names and emails using trigram similarity.
// Returns employees with relevance scores, ordered by similarity.
func (s *organizationLogicImpl) SearchEmployees(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	queryText string,
	limit int32,
	cursor *dbuuid.UUID,
) ([]*database.SearchEmployeesRow, error) {
	slog.DebugContext(ctx, "SearchEmployees called",
		"org_id", orgID.String(),
		"query_text", queryText,
		"limit", limit,
	)

	// Validate inputs
	if queryText == "" {
		return nil, fmt.Errorf("query_text cannot be empty")
	}
	if limit <= 0 {
		limit = 50 // default
	}
	if limit > 100 {
		limit = 100 // cap at 100
	}

	// Convert cursor pointer to NullUUID
	var cursorParam dbuuid.NullUUID
	if cursor != nil {
		cursorParam = dbuuid.UUIDToNullUUID(*cursor)
	}

	// Single UNION query searches all three fields (email, given_name, family_name)
	// Database handles deduplication via GROUP BY and keeps MAX relevance score
	results, err := s.Queries.SearchEmployees(ctx, tx, &database.SearchEmployeesParams{
		OrganizationID: orgID,
		QueryText:      queryText,
		Limit:          limit,
		Cursor:         cursorParam,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to search employees",
			"org_id", orgID.String(),
			"query_text", queryText,
			"error", err,
		)
		return nil, fmt.Errorf("failed to search employees: %w", err)
	}

	slog.DebugContext(ctx, "employee search completed",
		"org_id", orgID.String(),
		"result_count", len(results),
	)

	return results, nil
}

// SearchDepartments performs fuzzy search on department names and descriptions.
func (s *organizationLogicImpl) SearchDepartments(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	queryText string,
	limit int32,
	cursor *dbuuid.UUID,
) ([]*database.SearchDepartmentsRow, error) {
	slog.DebugContext(ctx, "SearchDepartments called",
		"org_id", orgID.String(),
		"query_text", queryText,
		"limit", limit,
	)

	// Validate inputs
	if queryText == "" {
		return nil, fmt.Errorf("query_text cannot be empty")
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}

	// Convert cursor pointer to NullUUID
	var cursorParam dbuuid.NullUUID
	if cursor != nil {
		cursorParam = dbuuid.UUIDToNullUUID(*cursor)
	}

	results, err := s.Queries.SearchDepartments(ctx, tx, &database.SearchDepartmentsParams{
		OrganizationID: orgID,
		QueryText:      queryText,
		Limit:          limit,
		Cursor:         cursorParam,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to search departments",
			"org_id", orgID.String(),
			"query_text", queryText,
			"error", err,
		)
		return nil, fmt.Errorf("failed to search departments: %w", err)
	}

	slog.DebugContext(ctx, "department search completed",
		"org_id", orgID.String(),
		"result_count", len(results),
	)

	return results, nil
}

// AutocompleteEmployees provides prefix-based employee suggestions for quick selection.
func (s *organizationLogicImpl) AutocompleteEmployees(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	prefix string,
	limit int32,
) ([]*database.AutocompleteEmployeesRow, error) {
	slog.DebugContext(ctx, "AutocompleteEmployees called",
		"org_id", orgID.String(),
		"prefix", prefix,
		"limit", limit,
	)

	// Validate inputs
	if prefix == "" {
		return nil, fmt.Errorf("prefix cannot be empty")
	}
	if limit <= 0 {
		limit = 10
	}
	if limit > 20 {
		limit = 20
	}

	results, err := s.Queries.AutocompleteEmployees(ctx, tx, &database.AutocompleteEmployeesParams{
		OrganizationID: orgID,
		Prefix:         pgtype.Text{String: prefix, Valid: true},
		Limit:          limit,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to autocomplete employees",
			"org_id", orgID.String(),
			"prefix", prefix,
			"error", err,
		)
		return nil, fmt.Errorf("failed to autocomplete employees: %w", err)
	}

	slog.DebugContext(ctx, "employee autocomplete completed",
		"org_id", orgID.String(),
		"result_count", len(results),
	)

	return results, nil
}

// AutocompleteDepartments provides prefix-based department suggestions.
func (s *organizationLogicImpl) AutocompleteDepartments(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	prefix string,
	limit int32,
) ([]*database.AutocompleteDepartmentsRow, error) {
	slog.DebugContext(ctx, "AutocompleteDepartments called",
		"org_id", orgID.String(),
		"prefix", prefix,
		"limit", limit,
	)

	// Validate inputs
	if prefix == "" {
		return nil, fmt.Errorf("prefix cannot be empty")
	}
	if limit <= 0 {
		limit = 10
	}
	if limit > 20 {
		limit = 20
	}

	results, err := s.Queries.AutocompleteDepartments(ctx, tx, &database.AutocompleteDepartmentsParams{
		OrganizationID: orgID,
		Prefix:         pgtype.Text{String: prefix, Valid: true},
		Limit:          limit,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to autocomplete departments",
			"org_id", orgID.String(),
			"prefix", prefix,
			"error", err,
		)
		return nil, fmt.Errorf("failed to autocomplete departments: %w", err)
	}

	slog.DebugContext(ctx, "department autocomplete completed",
		"org_id", orgID.String(),
		"result_count", len(results),
	)

	return results, nil
}
