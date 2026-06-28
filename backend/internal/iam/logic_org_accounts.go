package iam

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbcrud"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
)

// LoginWithPINResult holds the result of a PIN-based login attempt.
type LoginWithPINResult struct {
	UserID            dbuuid.UUID
	AccessToken       string
	JTI               string
	ExpiresAt         int64
	PINChangeRequired bool
	PINChangeToken    string
}

// CreateOrgAccountParams holds parameters for creating an org-managed account.
type CreateOrgAccountParams struct {
	LoginIdentifier string
	DisplayName     string
	GivenName       string
	FamilyName      string
	DepartmentID    *string
	DateOfBirth     *string
	PhoneNumber     *string
}

// CreateOrgAccountResult holds the result of an org-managed account creation.
type CreateOrgAccountResult struct {
	ID              dbuuid.UUID
	LoginIdentifier string
	TemporaryPIN    string
}

// OrgAccountRow represents a row in the org accounts listing.
type OrgAccountRow struct {
	ID              dbuuid.UUID
	LoginIdentifier pgtype.Text
	DisplayName     pgtype.Text
	GivenName       string
	FamilyName      string
	UserStatus      string
	LastLoginAt     pgtype.Timestamptz
	CreatedAt       pgtype.Timestamptz
	AccountStatus   string
	PinConfigured   bool
}

// LoginWithPIN authenticates a worker using org-scoped login_identifier + PIN.
func (l *iamLogicImpl) LoginWithPIN(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, loginIdentifier, pin string) (*LoginWithPINResult, error) {
	// 1. Look up identity by (orgID, loginIdentifier)
	identity, err := l.queries.GetIdentityByOrgAndLoginIdentifier(ctx, tx, &database.GetIdentityByOrgAndLoginIdentifierParams{
		OrganizationID:  orgID,
		LoginIdentifier: loginIdentifier,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrInvalidCredentials
		}
		return nil, fmt.Errorf("failed to look up identity: %w", err)
	}

	// 2. Check user status
	user, err := l.queries.GetUserByID(ctx, tx, identity.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}
	if user.Status != UserStatusActive {
		return nil, ErrWorkerAccountSuspended
	}

	// 3. Check lockout
	lockout, err := l.queries.GetAccountLockout(ctx, tx, &database.GetAccountLockoutParams{
		OrganizationID: orgID,
		IdentityID:     identity.ID,
	})
	if err != nil && err != pgx.ErrNoRows {
		return nil, fmt.Errorf("failed to check lockout: %w", err)
	}
	if err == nil {
		if err := checkLockout(lockout); err != nil {
			return nil, err
		}
	}

	// 4. Fetch active PIN credential
	cred, err := l.queries.GetActiveCredential(ctx, tx, &database.GetActiveCredentialParams{
		OrganizationID: orgID,
		IdentityID:     identity.ID,
		CredentialType: CredentialTypePIN,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrInvalidCredentials
		}
		return nil, fmt.Errorf("failed to get credential: %w", err)
	}

	// 5. Check temporary credential expiry
	if cred.State == CredentialStateTemporary && cred.ExpiresAt.Valid && cred.ExpiresAt.Time.Before(time.Now()) {
		return nil, ErrTemporaryPINExpired
	}

	// 6. Compare PIN
	if err := ComparePINHash(cred.CredentialHash, pin); err != nil {
		// Wrong PIN — escalate lockout
		newLockout, lockoutErr := l.escalateLockout(ctx, tx, orgID, identity.ID, lockout)
		if lockoutErr != nil {
			slog.WarnContext(ctx, "failed to escalate lockout", "error", lockoutErr)
		}
		if newLockout != nil {
			return nil, newLockout
		}
		return nil, ErrInvalidCredentials
	}

	// 7. Successful login — reset lockout
	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}
	if lockout != nil {
		if err := l.queries.ResetAccountLockout(ctx, tx, &database.ResetAccountLockoutParams{
			UpdatedAt:      now,
			OrganizationID: orgID,
			IdentityID:     identity.ID,
		}); err != nil {
			slog.WarnContext(ctx, "failed to reset lockout", "error", err)
		}
	}

	// Update last login
	if err := l.queries.UpdateUserLastLogin(ctx, tx, user.ID); err != nil {
		slog.WarnContext(ctx, "failed to update last_login_at", "error", err)
	}

	// 8. If temporary, require PIN change
	if cred.State == CredentialStateTemporary {
		changeToken, err := l.generatePINChangeToken(user.ID, orgID)
		if err != nil {
			return nil, fmt.Errorf("failed to generate pin change token: %w", err)
		}
		return &LoginWithPINResult{
			PINChangeRequired: true,
			PINChangeToken:    changeToken,
		}, nil
	}

	// 9. Full login — issue JWT
	accessToken, jti, expiresAt, err := l.jwtSigner.GenerateTokenWithOrg(user.ID, user.Email.String, orgID)
	if err != nil {
		return nil, fmt.Errorf("failed to generate token: %w", err)
	}

	return &LoginWithPINResult{
		UserID:      user.ID,
		AccessToken: accessToken,
		JTI:         jti,
		ExpiresAt:   expiresAt,
	}, nil
}

// SetPIN sets or changes a worker's PIN credential.
func (l *iamLogicImpl) SetPIN(ctx context.Context, tx database.DBTX, orgID, identityID dbuuid.UUID, newPIN string) error {
	// 1. Validate format
	if err := ValidatePINFormat(newPIN); err != nil {
		return err
	}

	// 2. Validate against personal data
	personalInfo, err := l.queries.GetEmployeePersonalInfo(ctx, tx, &database.GetEmployeePersonalInfoParams{
		OrganizationID: orgID,
		ID:             identityID,
	})
	if err != nil && err != pgx.ErrNoRows {
		return fmt.Errorf("failed to get employee personal info: %w", err)
	}
	if personalInfo != nil {
		var dob, phone string
		if personalInfo.DateOfBirth.Valid {
			dob = personalInfo.DateOfBirth.Time.Format("2006-01-02")
		}
		if personalInfo.PhoneNumber.Valid {
			phone = personalInfo.PhoneNumber.String
		}
		if err := ComparePINWithPersonalData(newPIN, dob, phone); err != nil {
			return err
		}
	}

	// 3. Hash the new PIN
	hash, err := HashPIN(newPIN)
	if err != nil {
		return fmt.Errorf("failed to hash PIN: %w", err)
	}

	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}

	// 4. Try to activate existing temporary credential with the new hash
	cred, credErr := l.queries.GetActiveCredential(ctx, tx, &database.GetActiveCredentialParams{
		OrganizationID: orgID,
		IdentityID:     identityID,
		CredentialType: CredentialTypePIN,
	})
	if credErr != nil && credErr != pgx.ErrNoRows {
		return fmt.Errorf("failed to get active credential: %w", credErr)
	}

	if cred != nil && cred.State == CredentialStateTemporary {
		// Activate the temporary credential with the user's chosen PIN hash
		return l.queries.ActivateTemporaryCredential(ctx, tx, &database.ActivateTemporaryCredentialParams{
			CredentialHash: hash,
			UpdatedAt:      now,
			OrganizationID: orgID,
			ID:             cred.ID,
		})
	}

	// For voluntary PIN change: revoke existing and create a new active one
	if cred != nil {
		if err := l.queries.RevokeCredentialsByIdentityAndType(ctx, tx, &database.RevokeCredentialsByIdentityAndTypeParams{
			UpdatedAt:      now,
			OrganizationID: orgID,
			IdentityID:     identityID,
			CredentialType: CredentialTypePIN,
		}); err != nil {
			return fmt.Errorf("failed to revoke existing credentials: %w", err)
		}
	}

	_, err = l.queries.CreateCredential(ctx, tx, &database.CreateCredentialParams{
		ID:             dbuuid.Must(),
		OrganizationID: orgID,
		IdentityID:     identityID,
		CredentialType: CredentialTypePIN,
		CredentialHash: hash,
		State:          CredentialStateActive,
	})
	return err
}

// CreateOrgAccount creates a single org-managed worker account.
func (l *iamLogicImpl) CreateOrgAccount(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, createdBy dbuuid.UUID, req CreateOrgAccountParams) (*CreateOrgAccountResult, error) {
	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}
	sharedID := dbuuid.Must()

	// 1. Create iam.user (org-managed, no email)
	user, err := l.queries.CreateOrgManagedUser(ctx, tx, &database.CreateOrgManagedUserParams{
		ID:          sharedID,
		DisplayName: req.DisplayName,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create org-managed user: %w", err)
	}

	// 2. Create iam.identity with login_identifier
	_, err = l.queries.CreateIdentityWithLoginIdentifier(ctx, tx, &database.CreateIdentityWithLoginIdentifierParams{
		ID:              sharedID,
		OrganizationID:  orgID,
		LoginIdentifier: req.LoginIdentifier,
	})
	if err != nil {
		// Check for unique constraint violation (duplicate login_identifier)
		if isDuplicateKeyError(err) {
			return nil, ErrDuplicateLoginIdentifier
		}
		return nil, fmt.Errorf("failed to create identity: %w", err)
	}

	// 3. Create organization.employee record
	employeeRecord := database.OrganizationEmployee{
		ID:             sharedID,
		OrganizationID: orgID,
		GivenName:      req.GivenName,
		FamilyName:     req.FamilyName,
		Email:          "", // Org-managed workers have no email
		IsActive:       true,
		UpdatedAt:      now,
	}
	if req.DateOfBirth != nil {
		dob, err := parseDateOfBirth(*req.DateOfBirth)
		if err == nil {
			employeeRecord.DateOfBirth = dob
		}
	}
	if req.PhoneNumber != nil {
		employeeRecord.PhoneNumber = pgtype.Text{String: *req.PhoneNumber, Valid: true}
	}

	if err := dbcrud.Create(ctx, tx, &employeeRecord); err != nil {
		return nil, fmt.Errorf("failed to create employee record: %w", err)
	}

	// 4. Generate temporary PIN and create credential
	tempPIN, err := GenerateTemporaryPIN()
	if err != nil {
		return nil, fmt.Errorf("failed to generate temporary PIN: %w", err)
	}

	pinHash, err := HashPIN(tempPIN)
	if err != nil {
		return nil, fmt.Errorf("failed to hash temporary PIN: %w", err)
	}

	_, err = l.queries.CreateCredential(ctx, tx, &database.CreateCredentialParams{
		ID:             dbuuid.Must(),
		OrganizationID: orgID,
		IdentityID:     sharedID,
		CredentialType: CredentialTypePIN,
		CredentialHash: pinHash,
		State:          CredentialStateTemporary,
		ExpiresAt:      pgtype.Timestamptz{Time: time.Now().Add(TemporaryPINExpiry), Valid: true},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create credential: %w", err)
	}

	// 5. Assign default employee role
	ownerRole, err := l.queries.GetOrgRoleBySourceDefault(ctx, tx, &database.GetOrgRoleBySourceDefaultParams{
		OrganizationID:      orgID,
		SourceDefaultRoleID: pgtype.Text{String: DefaultRoleEmployee, Valid: true},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to find employee role: %w", err)
	}

	if err := l.queries.AssignRoleToEmployee(ctx, tx, &database.AssignRoleToEmployeeParams{
		OrganizationID: orgID,
		EmployeeID:     sharedID,
		RoleID:         ownerRole.ID,
		AssignedBy:     createdBy,
	}); err != nil {
		return nil, fmt.Errorf("failed to assign employee role: %w", err)
	}

	_ = user // user created successfully

	return &CreateOrgAccountResult{
		ID:              sharedID,
		LoginIdentifier: req.LoginIdentifier,
		TemporaryPIN:    tempPIN,
	}, nil
}

// DeactivateOrgAccount deactivates an org-managed worker account.
func (l *iamLogicImpl) DeactivateOrgAccount(ctx context.Context, tx database.DBTX, orgID, identityID dbuuid.UUID) error {
	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}

	if err := l.queries.DeactivateUser(ctx, tx, &database.DeactivateUserParams{
		UpdatedAt: now,
		ID:        identityID,
	}); err != nil {
		return fmt.Errorf("failed to deactivate user: %w", err)
	}

	if err := l.queries.InvalidateAllUserSessionsForDeactivation(ctx, tx, &database.InvalidateAllUserSessionsForDeactivationParams{
		InvalidatedAt: now,
		UserID:        identityID,
	}); err != nil {
		slog.WarnContext(ctx, "failed to invalidate sessions on deactivation", "error", err)
	}

	return nil
}

// UnlockOrgAccount unlocks an org-managed account and optionally resets the PIN.
func (l *iamLogicImpl) UnlockOrgAccount(ctx context.Context, tx database.DBTX, orgID, identityID dbuuid.UUID, resetPIN bool) (*string, error) {
	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}

	// Delete lockout record entirely
	if err := l.queries.DeleteAccountLockout(ctx, tx, &database.DeleteAccountLockoutParams{
		OrganizationID: orgID,
		IdentityID:     identityID,
	}); err != nil && err != pgx.ErrNoRows {
		return nil, fmt.Errorf("failed to delete lockout: %w", err)
	}

	if !resetPIN {
		return nil, nil
	}

	// Revoke existing PIN credentials and issue a new temporary PIN
	if err := l.queries.RevokeCredentialsByIdentityAndType(ctx, tx, &database.RevokeCredentialsByIdentityAndTypeParams{
		UpdatedAt:      now,
		OrganizationID: orgID,
		IdentityID:     identityID,
		CredentialType: CredentialTypePIN,
	}); err != nil {
		return nil, fmt.Errorf("failed to revoke credentials: %w", err)
	}

	tempPIN, err := GenerateTemporaryPIN()
	if err != nil {
		return nil, fmt.Errorf("failed to generate temporary PIN: %w", err)
	}

	pinHash, err := HashPIN(tempPIN)
	if err != nil {
		return nil, fmt.Errorf("failed to hash temporary PIN: %w", err)
	}

	_, err = l.queries.CreateCredential(ctx, tx, &database.CreateCredentialParams{
		ID:             dbuuid.Must(),
		OrganizationID: orgID,
		IdentityID:     identityID,
		CredentialType: CredentialTypePIN,
		CredentialHash: pinHash,
		State:          CredentialStateTemporary,
		ExpiresAt:      pgtype.Timestamptz{Time: time.Now().Add(TemporaryPINExpiry), Valid: true},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create new credential: %w", err)
	}

	return &tempPIN, nil
}

// ResetOrgAccountCredential revokes existing credentials and issues a new temporary PIN.
func (l *iamLogicImpl) ResetOrgAccountCredential(ctx context.Context, tx database.DBTX, orgID, identityID dbuuid.UUID) (string, error) {
	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}

	// Revoke existing PIN credentials
	if err := l.queries.RevokeCredentialsByIdentityAndType(ctx, tx, &database.RevokeCredentialsByIdentityAndTypeParams{
		UpdatedAt:      now,
		OrganizationID: orgID,
		IdentityID:     identityID,
		CredentialType: CredentialTypePIN,
	}); err != nil {
		return "", fmt.Errorf("failed to revoke credentials: %w", err)
	}

	// Invalidate sessions
	if err := l.queries.InvalidateAllUserSessionsForDeactivation(ctx, tx, &database.InvalidateAllUserSessionsForDeactivationParams{
		InvalidatedAt: now,
		UserID:        identityID,
	}); err != nil {
		slog.WarnContext(ctx, "failed to invalidate sessions on credential reset", "error", err)
	}

	// Create new temporary credential
	tempPIN, err := GenerateTemporaryPIN()
	if err != nil {
		return "", fmt.Errorf("failed to generate temporary PIN: %w", err)
	}

	pinHash, err := HashPIN(tempPIN)
	if err != nil {
		return "", fmt.Errorf("failed to hash temporary PIN: %w", err)
	}

	_, err = l.queries.CreateCredential(ctx, tx, &database.CreateCredentialParams{
		ID:             dbuuid.Must(),
		OrganizationID: orgID,
		IdentityID:     identityID,
		CredentialType: CredentialTypePIN,
		CredentialHash: pinHash,
		State:          CredentialStateTemporary,
		ExpiresAt:      pgtype.Timestamptz{Time: time.Now().Add(TemporaryPINExpiry), Valid: true},
	})
	if err != nil {
		return "", fmt.Errorf("failed to create new credential: %w", err)
	}

	return tempPIN, nil
}

// ListOrgAccounts lists org-managed worker accounts.
// Uses two queries to avoid Citus distributed/local join restrictions:
// 1. Distributed query for identity + employee + lockout data
// 2. Local query against iam.user for display_name, status, etc.
func (l *iamLogicImpl) ListOrgAccounts(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, cursor *dbuuid.UUID, limit int, statusFilter *string) ([]*OrgAccountRow, int32, error) {
	var cursorID dbuuid.NullUUID
	if cursor != nil {
		cursorID = dbuuid.UUIDToNullUUID(*cursor)
	}

	rows, err := l.queries.ListOrgManagedAccounts(ctx, tx, &database.ListOrgManagedAccountsParams{
		OrganizationID: orgID,
		CursorID:       cursorID,
		ResultLimit:    int32(limit),
	})
	if err != nil {
		return nil, 0, fmt.Errorf("failed to list org accounts: %w", err)
	}

	count, err := l.queries.GetOrgManagedAccountCount(ctx, tx, orgID)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to get org account count: %w", err)
	}

	if len(rows) == 0 {
		return nil, count, nil
	}

	// Collect IDs for enrichment queries.
	ids := make([]dbuuid.UUID, len(rows))
	for i, r := range rows {
		ids[i] = r.ID
	}

	// Fetch user status data from the local iam.user table.
	userRows, err := l.queries.GetUserStatusBatch(ctx, tx, ids)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to get user statuses: %w", err)
	}
	userMap := make(map[dbuuid.UUID]*database.GetUserStatusBatchRow, len(userRows))
	for _, u := range userRows {
		userMap[u.ID] = u
	}

	// Fetch active PIN credential status (separate query for Citus compat).
	pinIDs, err := l.queries.CheckActivePINCredentialBatch(ctx, tx, &database.CheckActivePINCredentialBatchParams{
		OrganizationID: orgID,
		IdentityIds:    ids,
	})
	if err != nil {
		return nil, 0, fmt.Errorf("failed to check pin credentials: %w", err)
	}
	pinSet := make(map[dbuuid.UUID]bool, len(pinIDs))
	for _, id := range pinIDs {
		pinSet[id] = true
	}

	// Merge distributed + local data.
	result := make([]*OrgAccountRow, 0, len(rows))
	for _, r := range rows {
		userStatus := "active"
		var lastLoginAt, createdAt pgtype.Timestamptz

		if u, ok := userMap[r.ID]; ok {
			userStatus = u.Status
			lastLoginAt = u.LastLoginAt
			createdAt = u.CreatedAt
		}

		displayName := pgtype.Text{String: r.GivenName + " " + r.FamilyName, Valid: true}

		accountStatus := "active"
		if r.LockoutTier >= int32(LockoutTierFullLock) {
			accountStatus = "locked"
		} else if userStatus == "suspended" {
			accountStatus = "deactivated"
		}

		// Apply status filter in Go since we can't filter in SQL with Citus restrictions.
		if statusFilter != nil && *statusFilter != "" && accountStatus != *statusFilter {
			continue
		}

		result = append(result, &OrgAccountRow{
			ID:              r.ID,
			LoginIdentifier: r.LoginIdentifier,
			DisplayName:     displayName,
			GivenName:       r.GivenName,
			FamilyName:      r.FamilyName,
			UserStatus:      userStatus,
			LastLoginAt:     lastLoginAt,
			CreatedAt:       createdAt,
			AccountStatus:   accountStatus,
			PinConfigured:   pinSet[r.ID],
		})
	}

	return result, count, nil
}

// --- Internal helpers ---

// checkLockout returns an error if the account is currently locked.
func checkLockout(lockout *database.IamAccountLockout) error {
	if lockout.LockoutTier == LockoutTierNone {
		return nil
	}

	if lockout.LockoutTier >= LockoutTierFullLock {
		return &ErrAccountLocked{
			Tier:          int(lockout.LockoutTier),
			AdminRequired: true,
		}
	}

	// Timed lockout — check if it's still active
	if lockout.LockoutUntil.Valid && lockout.LockoutUntil.Time.After(time.Now()) {
		return &ErrAccountLocked{
			Tier:         int(lockout.LockoutTier),
			LockoutUntil: lockout.LockoutUntil.Time,
		}
	}

	return nil
}

// escalateLockout increases the lockout tier based on the failure count.
func (l *iamLogicImpl) escalateLockout(ctx context.Context, tx database.DBTX, orgID, identityID dbuuid.UUID, current *database.IamAccountLockout) (*ErrAccountLocked, error) {
	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}

	var failedAttempts int32
	if current != nil {
		failedAttempts = current.FailedAttempts
	}
	failedAttempts++

	tier := LockoutTierNone
	for threshold, t := range LockoutThresholds {
		if int(failedAttempts) >= threshold && t > tier {
			tier = t
		}
	}

	var lockoutUntil pgtype.Timestamptz
	if d, ok := LockoutDurations[tier]; ok {
		lockoutUntil = pgtype.Timestamptz{Time: time.Now().Add(d), Valid: true}
	}

	if err := l.queries.UpsertAccountLockout(ctx, tx, &database.UpsertAccountLockoutParams{
		OrganizationID: orgID,
		IdentityID:     identityID,
		FailedAttempts: failedAttempts,
		LockoutTier:    int32(tier),
		LockoutUntil:   lockoutUntil,
		LastFailedAt:   now,
		UpdatedAt:      now,
	}); err != nil {
		return nil, err
	}

	// If a lockout was triggered, return the lockout error
	if tier >= LockoutTierFullLock {
		return &ErrAccountLocked{
			Tier:          tier,
			AdminRequired: true,
		}, nil
	}
	if tier > LockoutTierNone && lockoutUntil.Valid {
		return &ErrAccountLocked{
			Tier:         tier,
			LockoutUntil: lockoutUntil.Time,
		}, nil
	}
	return nil, nil
}

// generatePINChangeToken creates a short-lived JWT token for PIN change.
func (l *iamLogicImpl) generatePINChangeToken(userID, orgID dbuuid.UUID) (string, error) {
	token, _, _, err := l.jwtSigner.GenerateTokenWithOrg(userID, "", orgID)
	if err != nil {
		return "", err
	}
	return token, nil
}

// isDuplicateKeyError checks if the error is a PostgreSQL unique constraint violation.
func isDuplicateKeyError(err error) bool {
	return err != nil && (containsPGCode(err, "23505"))
}

// containsPGCode checks if the error chain contains a PG error with the given code.
func containsPGCode(err error, code string) bool {
	var pgErr interface{ SQLState() string }
	if ok := errorAs(err, &pgErr); ok {
		return pgErr.SQLState() == code
	}
	return false
}

// errorAs is a generic errors.As helper.
func errorAs[T any](err error, target *T) bool {
	for err != nil {
		if t, ok := err.(T); ok {
			*target = t
			return true
		}
		if u, ok := err.(interface{ Unwrap() error }); ok {
			err = u.Unwrap()
		} else {
			return false
		}
	}
	return false
}

// parseDateOfBirth parses a date of birth string into a pgtype.Date.
func parseDateOfBirth(dob string) (pgtype.Date, error) {
	t, err := time.Parse("2006-01-02", dob)
	if err != nil {
		return pgtype.Date{}, err
	}
	return pgtype.Date{Time: t, Valid: true}, nil
}
