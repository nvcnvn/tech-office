package iam

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/database/txn"
)

// BlockingOrganization is one workspace that stands in the way of deletion because
// the person leaving is its only owner and other people are still in it.
type BlockingOrganization struct {
	OrganizationID   dbuuid.UUID
	OrganizationName string
	MemberCount      int32
}

// AffectedOrganization is one workspace a deletion touches, whether or not it
// blocks.
type AffectedOrganization struct {
	OrganizationID   dbuuid.UUID
	OrganizationName string
	MemberCount      int32
	BlocksDeletion   bool
}

// ErrSoleOwnerBlocksDeletion is returned when at least one workspace would be left
// ownerless. It carries the workspaces so the client can offer transfer-or-close
// for each rather than printing a sentence (FR-005, Constitution Principle X).
type ErrSoleOwnerBlocksDeletion struct {
	Organizations []BlockingOrganization
}

func (e *ErrSoleOwnerBlocksDeletion) Error() string {
	return fmt.Sprintf("you are the only owner of %d workspace(s) that still have members", len(e.Organizations))
}

var (
	// ErrOrgManagedCannotSelfDelete is returned to an admin-provisioned worker. Their
	// path is ComplianceService.RequestAccountRemoval, not deletion.
	ErrOrgManagedCannotSelfDelete = errors.New("this account was created by your workspace administrator; request removal instead")

	// ErrConfirmationPhraseMismatch guards against an accidental irreversible tap.
	ErrConfirmationPhraseMismatch = errors.New("the confirmation phrase does not match")
)

// DeletionConfirmationPhrase is what a person must type to confirm. It is defined
// once on the server so mobile and web cannot ask for different things.
const DeletionConfirmationPhrase = "delete my account"

// AccountDeleter carries the deletion and erase operations. It is a separate type
// from IAMLogic because the erase steps run on AdminPool from a background worker,
// with no request context and no tenant to derive.
type AccountDeleter struct {
	Queries   *database.Queries
	AdminPool database.AdminDatabaseConnector
}

func NewAccountDeleter(queries *database.Queries, adminPool database.AdminDatabaseConnector) *AccountDeleter {
	return &AccountDeleter{Queries: queries, AdminPool: adminPool}
}

// ListMemberships returns every organization the person belongs to.
//
// The underlying query has no organization_id predicate and therefore fans out
// across shards, so it runs on AdminPool. See research.md R5 and the justification
// comment on ListIdentityOrganizations in iam.query.sql.
func (d *AccountDeleter) ListMemberships(ctx context.Context, userID dbuuid.UUID) ([]dbuuid.UUID, error) {
	var orgIDs []dbuuid.UUID
	err := txn.WithTxn(ctx, d.AdminPool, func(ctx context.Context, tx database.DBTX) error {
		var qErr error
		orgIDs, qErr = d.Queries.ListIdentityOrganizations(ctx, tx, userID)
		return qErr
	})
	if err != nil {
		return nil, fmt.Errorf("list memberships: %w", err)
	}
	return orgIDs, nil
}

// SurveyOrganizations describes every workspace a deletion would touch and which
// of them block it.
//
// A workspace blocks when the person is its only owner AND somebody else is still
// in it. Being the sole owner of an empty workspace does not block: there is
// nobody to strand.
func (d *AccountDeleter) SurveyOrganizations(ctx context.Context, userID dbuuid.UUID) ([]AffectedOrganization, error) {
	orgIDs, err := d.ListMemberships(ctx, userID)
	if err != nil {
		return nil, err
	}

	affected := make([]AffectedOrganization, 0, len(orgIDs))
	err = txn.WithTxn(ctx, d.AdminPool, func(ctx context.Context, tx database.DBTX) error {
		for _, orgID := range orgIDs {
			org, oErr := d.Queries.GetOrganizationByID(ctx, tx, orgID)
			if oErr != nil {
				return oErr
			}
			memberCount, mErr := d.Queries.CountActiveOrganizationMembers(ctx, tx, &database.CountActiveOrganizationMembersParams{
				OrganizationID: orgID,
				ID:             userID,
			})
			if mErr != nil {
				return mErr
			}
			isOwner, ownErr := d.Queries.IsEmployeeOrganizationOwner(ctx, tx, &database.IsEmployeeOrganizationOwnerParams{
				OrganizationID: orgID,
				EmployeeID:     userID,
			})
			if ownErr != nil {
				return ownErr
			}
			ownerCount, ocErr := d.Queries.CountOrganizationOwners(ctx, tx, orgID)
			if ocErr != nil {
				return ocErr
			}

			affected = append(affected, AffectedOrganization{
				OrganizationID:   orgID,
				OrganizationName: org.CompanyName,
				MemberCount:      memberCount,
				BlocksDeletion:   isOwner && ownerCount <= 1 && memberCount > 0,
			})
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("survey organizations: %w", err)
	}
	return affected, nil
}

// IsSoleOwnerOfPopulatedOrg returns the workspaces that block deletion, or an empty
// slice when none do (FR-005).
func (d *AccountDeleter) IsSoleOwnerOfPopulatedOrg(ctx context.Context, userID dbuuid.UUID) ([]BlockingOrganization, error) {
	affected, err := d.SurveyOrganizations(ctx, userID)
	if err != nil {
		return nil, err
	}
	var blocking []BlockingOrganization
	for _, org := range affected {
		if org.BlocksDeletion {
			blocking = append(blocking, BlockingOrganization{
				OrganizationID:   org.OrganizationID,
				OrganizationName: org.OrganizationName,
				MemberCount:      org.MemberCount,
			})
		}
	}
	return blocking, nil
}

// IsOrgManaged reports whether the account was created by an administrator.
func (d *AccountDeleter) IsOrgManaged(ctx context.Context, tx database.DBTX, userID dbuuid.UUID) (bool, error) {
	managed, err := d.Queries.IsUserOrgManaged(ctx, tx, userID)
	if err != nil {
		return false, fmt.Errorf("read is_org_managed: %w", err)
	}
	return managed, nil
}

// InvalidateAllSessions signs the person out everywhere. It is called
// synchronously in the deletion request, before anything is queued, so FR-003
// holds even when the background queue is backed up.
func (d *AccountDeleter) InvalidateAllSessions(ctx context.Context, tx database.DBTX, userID dbuuid.UUID) error {
	if err := d.Queries.DeleteSessionsForUser(ctx, tx, userID); err != nil {
		return fmt.Errorf("delete sessions: %w", err)
	}
	return nil
}

// AnonymiseEmployee strips personal data from the tenant record and deactivates it
// (FR-004, FR-006). Idempotent, so the worker may retry it.
func (d *AccountDeleter) AnonymiseEmployee(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID) error {
	if err := d.Queries.AnonymiseEmployee(ctx, tx, &database.AnonymiseEmployeeParams{
		OrganizationID: orgID,
		ID:             employeeID,
		UpdatedAt:      pgtype.Timestamptz{Time: time.Now(), Valid: true},
	}); err != nil {
		return fmt.Errorf("anonymise employee: %w", err)
	}
	return nil
}

// PurgeOrgIdentity deletes the person's per-organization identity rows. Deleting
// iam.identity cascades to iam.credential and iam.account_lockout, but the deletes
// are issued explicitly first so the step does not depend on cascade ordering and
// stays idempotent on a retry.
func (d *AccountDeleter) PurgeOrgIdentity(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID) error {
	if err := d.Queries.DeleteAccountLockoutsForOrganization(ctx, tx, &database.DeleteAccountLockoutsForOrganizationParams{
		OrganizationID: orgID,
		IdentityID:     employeeID,
	}); err != nil {
		return fmt.Errorf("delete account lockouts: %w", err)
	}
	if err := d.Queries.DeleteCredentialsForOrganization(ctx, tx, &database.DeleteCredentialsForOrganizationParams{
		OrganizationID: orgID,
		IdentityID:     employeeID,
	}); err != nil {
		return fmt.Errorf("delete credentials: %w", err)
	}
	if err := d.Queries.DeleteEmployeeRolesForOrganization(ctx, tx, &database.DeleteEmployeeRolesForOrganizationParams{
		OrganizationID: orgID,
		EmployeeID:     employeeID,
	}); err != nil {
		return fmt.Errorf("delete employee roles: %w", err)
	}
	if err := d.Queries.DeleteUserPreferencesForOrganization(ctx, tx, &database.DeleteUserPreferencesForOrganizationParams{
		OrganizationID: orgID,
		EmployeeID:     employeeID,
	}); err != nil {
		return fmt.Errorf("delete user preferences: %w", err)
	}
	if err := d.Queries.DeleteIdentityForOrganization(ctx, tx, &database.DeleteIdentityForOrganizationParams{
		OrganizationID: orgID,
		ID:             employeeID,
	}); err != nil {
		return fmt.Errorf("delete identity: %w", err)
	}
	return nil
}

// PurgeGlobalUserIfLastMembership destroys iam.user once no organization
// membership remains anywhere for this person, which cascades to sso_identity,
// password_credential, password_reset_token and session (FR-007e).
//
// The "am I last?" question is answered by counting remaining identities rather
// than by a marker column: two workers finishing at once both find zero and both
// issue a DELETE, and the second deletes nothing.
func (d *AccountDeleter) PurgeGlobalUserIfLastMembership(ctx context.Context, userID dbuuid.UUID) (bool, error) {
	var purged bool
	err := txn.WithTxn(ctx, d.AdminPool, func(ctx context.Context, tx database.DBTX) error {
		remaining, cErr := d.Queries.CountRemainingIdentities(ctx, tx, userID)
		if cErr != nil {
			return cErr
		}
		if remaining > 0 {
			return nil
		}
		if dErr := d.Queries.DeleteUser(ctx, tx, userID); dErr != nil {
			return dErr
		}
		purged = true
		return nil
	})
	if err != nil {
		return false, fmt.Errorf("purge global user: %w", err)
	}
	if purged {
		slog.InfoContext(ctx, "global identity record destroyed", "user_id", userID.String())
	}
	return purged, nil
}

// ownerLookup answers "who owns this workspace" for the compliance domain's
// removal-request notifications, without that domain reaching into iam's tables.
type ownerLookup struct{ queries *database.Queries }

// NewOwnerLookup returns the owner lookup used to address removal-request
// notifications (Feature 036, FR-007c).
func NewOwnerLookup(queries *database.Queries) *ownerLookup { return &ownerLookup{queries: queries} }

func (o *ownerLookup) ListOwnerEmployeeIDs(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID) ([]dbuuid.UUID, error) {
	ids, err := o.queries.ListOrganizationOwnerIDs(ctx, tx, orgID)
	if err != nil {
		return nil, fmt.Errorf("list organization owners: %w", err)
	}
	return ids, nil
}
