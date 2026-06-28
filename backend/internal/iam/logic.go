package iam

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"log/slog"
	"net/netip"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbcrud"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
)

// IAMLogic defines the business logic interface for IAM operations.
// This layer is pool-agnostic — receives tx from the Connect layer.
type IAMLogic interface {
	// SSO authentication
	FindOrCreateSSOUser(ctx context.Context, tx database.DBTX, claims *SSOClaims, provider string) (*database.IamUser, *database.IamSsoIdentity, bool, error)

	// Password authentication
	LoginWithPassword(ctx context.Context, tx database.DBTX, email, password string) (*database.IamUser, error)
	ChangePasswordForUser(ctx context.Context, tx database.DBTX, userID dbuuid.UUID, currentPassword, newPassword string) error

	// Password reset
	RequestPasswordResetForEmail(ctx context.Context, tx database.DBTX, email string) (string, error)
	ResetPasswordWithToken(ctx context.Context, tx database.DBTX, token, newPassword string) (dbuuid.UUID, error)

	// Profile
	GetUserProfile(ctx context.Context, tx database.DBTX, userID dbuuid.UUID) (*database.IamUser, error)
	UpdateUserProfile(ctx context.Context, tx database.DBTX, userID dbuuid.UUID, displayName, profilePictureURL *string) (*database.IamUser, error)

	// SSO identity management
	LinkSSOToUser(ctx context.Context, tx database.DBTX, userID dbuuid.UUID, claims *SSOClaims, provider string) (*database.IamSsoIdentity, error)
	UnlinkSSOFromUser(ctx context.Context, tx database.DBTX, userID, ssoIdentityID dbuuid.UUID) error

	// Organization membership
	GetUserOrganizationMemberships(ctx context.Context, tx database.DBTX, userID dbuuid.UUID) ([]*database.GetUserOrganizationsRow, error)
	ValidateUserOrgMembership(ctx context.Context, tx database.DBTX, userID, orgID dbuuid.UUID) error
	GetUserRoleNamesInOrg(ctx context.Context, tx database.DBTX, userID, orgID dbuuid.UUID) ([]string, error)

	// Invitations
	CreateInvitationForOrg(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, email string, roleID, invitedBy dbuuid.UUID) (*database.IamInvitation, error)
	AcceptInvitationWithToken(ctx context.Context, tx database.DBTX, token string, claims *SSOClaims, provider *string, password *string, displayName *string) (*database.IamUser, dbuuid.UUID, error)
	// AutoAcceptPendingInvitation accepts a pending invitation for the given user email+org if one exists,
	// creating the necessary identity/employee records and assigning the invitation role.
	// Returns the invitation if found and accepted, or (nil, nil) if no pending invitation exists.
	AutoAcceptPendingInvitation(ctx context.Context, tx database.DBTX, user *database.IamUser, orgID dbuuid.UUID) (*database.IamInvitation, error)
	CancelInvitationInOrg(ctx context.Context, tx database.DBTX, invitationID, orgID dbuuid.UUID) error
	ListInvitationsForOrg(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, status *string) ([]*database.IamInvitation, error)

	// Role management
	ListAllPermissions(ctx context.Context, tx database.DBTX, domain *string) ([]*database.Permission, error)
	CreateRole(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, name, description string, permissionIDs []string) (*database.IamRole, error)
	UpdateRole(ctx context.Context, tx database.DBTX, orgID, roleID dbuuid.UUID, name *string, description *string, permissionIDs []string, updatePermissions bool) (*database.IamRole, error)
	DeleteRole(ctx context.Context, tx database.DBTX, orgID, roleID dbuuid.UUID) error
	ListRoles(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID) ([]*database.IamRole, error)
	GetRole(ctx context.Context, tx database.DBTX, orgID, roleID dbuuid.UUID) (*database.IamRole, []string, int64, error)
	AssignRoleToEmployee(ctx context.Context, tx database.DBTX, orgID, employeeID, roleID, assignedBy dbuuid.UUID) error
	RevokeRoleFromEmployee(ctx context.Context, tx database.DBTX, orgID, employeeID, roleID dbuuid.UUID) error
	ListEmployeeRoles(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID) ([]*database.IamRole, error)
	GetEmployeePermissions(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID) ([]string, error)

	// Session management
	CreateSessionForUser(ctx context.Context, tx database.DBTX, userID dbuuid.UUID, tokenJTI string, issuedAt time.Time, expiresAt time.Time, ipAddress, userAgent string) (*database.IamSession, error)
	InvalidateSession(ctx context.Context, tx database.DBTX, sessionID dbuuid.UUID) error
	InvalidateAllUserSessions(ctx context.Context, tx database.DBTX, userID dbuuid.UUID) error
	GetActiveSessionsForUser(ctx context.Context, tx database.DBTX, userID dbuuid.UUID) ([]*database.IamSession, error)

	// Org-managed accounts (PIN-based workers)
	LoginWithPIN(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, loginIdentifier, pin string) (*LoginWithPINResult, error)
	SetPIN(ctx context.Context, tx database.DBTX, orgID, identityID dbuuid.UUID, newPIN string) error
	CreateOrgAccount(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, createdBy dbuuid.UUID, req CreateOrgAccountParams) (*CreateOrgAccountResult, error)
	DeactivateOrgAccount(ctx context.Context, tx database.DBTX, orgID, identityID dbuuid.UUID) error
	UnlockOrgAccount(ctx context.Context, tx database.DBTX, orgID, identityID dbuuid.UUID, resetPIN bool) (*string, error)
	ResetOrgAccountCredential(ctx context.Context, tx database.DBTX, orgID, identityID dbuuid.UUID) (string, error)
	ListOrgAccounts(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, cursor *dbuuid.UUID, limit int, statusFilter *string) ([]*OrgAccountRow, int32, error)
}

type iamLogicImpl struct {
	queries   *database.Queries
	jwtSigner *InternalJWTSigner
}

// NewIAMLogic creates a new IAM logic implementation.
func NewIAMLogic(queries *database.Queries, jwtSigner *InternalJWTSigner) IAMLogic {
	return &iamLogicImpl{queries: queries, jwtSigner: jwtSigner}
}

// FindOrCreateSSOUser finds an existing user by SSO identity or creates a new one.
// Returns the user, SSO identity, and whether the user is new.
func (l *iamLogicImpl) FindOrCreateSSOUser(ctx context.Context, tx database.DBTX, claims *SSOClaims, provider string) (*database.IamUser, *database.IamSsoIdentity, bool, error) {
	// 1. Try to find existing SSO identity
	existingSSO, err := l.queries.GetSSOIdentity(ctx, tx, &database.GetSSOIdentityParams{
		Provider:       provider,
		ProviderUserID: claims.Subject,
	})
	if err == nil {
		// SSO identity exists — get the user
		user, err := l.queries.GetUserByID(ctx, tx, existingSSO.UserID)
		if err != nil {
			return nil, nil, false, fmt.Errorf("failed to get user for SSO identity: %w", err)
		}
		if user.Status != UserStatusActive {
			return nil, nil, false, ErrUserSuspended
		}
		// Update last used
		if err := l.queries.UpdateSSOIdentityLastUsed(ctx, tx, existingSSO.ID); err != nil {
			slog.WarnContext(ctx, "failed to update SSO identity last_used_at", "error", err)
		}
		if err := l.queries.UpdateUserLastLogin(ctx, tx, user.ID); err != nil {
			slog.WarnContext(ctx, "failed to update user last_login_at", "error", err)
		}
		return user, existingSSO, false, nil
	}
	if err != pgx.ErrNoRows {
		return nil, nil, false, fmt.Errorf("failed to check SSO identity: %w", err)
	}

	// 2. SSO identity not found — check if user exists by email
	isNewUser := false
	user, err := l.queries.GetUserByEmail(ctx, tx, pgtype.Text{String: claims.Email, Valid: claims.Email != ""})
	if err != nil {
		if err != pgx.ErrNoRows {
			return nil, nil, false, fmt.Errorf("failed to check user by email: %w", err)
		}
		// 3. User doesn't exist — create new user
		user, err = l.queries.CreateIAMUser(ctx, tx, &database.CreateIAMUserParams{
			ID:                dbuuid.Must(),
			Email:             pgtype.Text{String: claims.Email, Valid: claims.Email != ""},
			DisplayName:       pgtype.Text{String: claims.Name, Valid: claims.Name != ""},
			ProfilePictureUrl: pgtype.Text{String: claims.ProfilePicture, Valid: claims.ProfilePicture != ""},
			Status:            UserStatusActive,
		})
		if err != nil {
			return nil, nil, false, fmt.Errorf("failed to create user: %w", err)
		}
		isNewUser = true
	}

	if user.Status != UserStatusActive {
		return nil, nil, false, ErrUserSuspended
	}

	// 4. Link SSO identity to user
	ssoIdentity, err := l.queries.CreateSSOIdentity(ctx, tx, &database.CreateSSOIdentityParams{
		ID:             dbuuid.Must(),
		UserID:         user.ID,
		Provider:       provider,
		ProviderUserID: claims.Subject,
		Email:          claims.Email,
	})
	if err != nil {
		return nil, nil, false, fmt.Errorf("failed to create SSO identity: %w", err)
	}

	if err := l.queries.UpdateUserLastLogin(ctx, tx, user.ID); err != nil {
		slog.WarnContext(ctx, "failed to update user last_login_at", "error", err)
	}

	return user, ssoIdentity, isNewUser, nil
}

// LoginWithPassword authenticates a user with email and password.
func (l *iamLogicImpl) LoginWithPassword(ctx context.Context, tx database.DBTX, email, password string) (*database.IamUser, error) {
	user, err := l.queries.GetUserByEmail(ctx, tx, pgtype.Text{String: email, Valid: email != ""})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrInvalidCredentials
		}
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	if user.Status != UserStatusActive {
		return nil, ErrInvalidCredentials // Don't reveal account status
	}

	cred, err := l.queries.GetPasswordCredential(ctx, tx, user.ID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrInvalidCredentials // User has no password
		}
		return nil, fmt.Errorf("failed to get password credential: %w", err)
	}

	if err := VerifyPassword(password, cred.PasswordHash); err != nil {
		return nil, ErrInvalidCredentials
	}

	if err := l.queries.UpdateUserLastLogin(ctx, tx, user.ID); err != nil {
		slog.WarnContext(ctx, "failed to update user last_login_at", "error", err)
	}

	return user, nil
}

// ChangePasswordForUser changes a user's password after verifying the current one.
func (l *iamLogicImpl) ChangePasswordForUser(ctx context.Context, tx database.DBTX, userID dbuuid.UUID, currentPassword, newPassword string) error {
	cred, err := l.queries.GetPasswordCredential(ctx, tx, userID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return ErrInvalidCredentials
		}
		return fmt.Errorf("failed to get password credential: %w", err)
	}

	if err := VerifyPassword(currentPassword, cred.PasswordHash); err != nil {
		return ErrInvalidCredentials
	}

	if err := ValidatePassword(newPassword); err != nil {
		return err
	}

	hash, err := HashPassword(newPassword)
	if err != nil {
		return err
	}

	return l.queries.UpdatePasswordCredential(ctx, tx, &database.UpdatePasswordCredentialParams{
		UserID:       userID,
		PasswordHash: hash,
	})
}

// RequestPasswordResetForEmail generates a reset token. Returns token string.
// Returns empty string (not error) if email doesn't exist — prevents enumeration.
func (l *iamLogicImpl) RequestPasswordResetForEmail(ctx context.Context, tx database.DBTX, email string) (string, error) {
	user, err := l.queries.GetUserByEmail(ctx, tx, pgtype.Text{String: email, Valid: email != ""})
	if err != nil {
		if err == pgx.ErrNoRows {
			return "", nil // Don't reveal email existence
		}
		return "", fmt.Errorf("failed to get user: %w", err)
	}

	// Check user has a password credential
	_, err = l.queries.GetPasswordCredential(ctx, tx, user.ID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return "", nil // User is SSO-only, no password to reset
		}
		return "", fmt.Errorf("failed to check password credential: %w", err)
	}

	token, err := generateSecureToken()
	if err != nil {
		return "", fmt.Errorf("failed to generate reset token: %w", err)
	}

	_, err = l.queries.CreatePasswordResetToken(ctx, tx, &database.CreatePasswordResetTokenParams{
		ID:        dbuuid.Must(),
		UserID:    user.ID,
		Token:     token,
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(ResetTokenExpiry), Valid: true},
	})
	if err != nil {
		return "", fmt.Errorf("failed to create reset token: %w", err)
	}

	return token, nil
}

// ResetPasswordWithToken resets a user's password using a reset token.
func (l *iamLogicImpl) ResetPasswordWithToken(ctx context.Context, tx database.DBTX, token, newPassword string) (dbuuid.UUID, error) {
	resetToken, err := l.queries.GetPasswordResetToken(ctx, tx, token)
	if err != nil {
		if err == pgx.ErrNoRows {
			return dbuuid.UUID{}, ErrInvalidResetToken
		}
		return dbuuid.UUID{}, fmt.Errorf("failed to get reset token: %w", err)
	}

	if resetToken.ExpiresAt.Time.Before(time.Now()) {
		return dbuuid.UUID{}, ErrResetTokenExpired
	}

	if err := ValidatePassword(newPassword); err != nil {
		return dbuuid.UUID{}, err
	}

	hash, err := HashPassword(newPassword)
	if err != nil {
		return dbuuid.UUID{}, err
	}

	// Upsert password credential
	_, err = l.queries.GetPasswordCredential(ctx, tx, resetToken.UserID)
	if err != nil {
		if err == pgx.ErrNoRows {
			// Create new password credential
			_, err = l.queries.CreatePasswordCredential(ctx, tx, &database.CreatePasswordCredentialParams{
				ID:           dbuuid.Must(),
				UserID:       resetToken.UserID,
				PasswordHash: hash,
			})
			if err != nil {
				return dbuuid.UUID{}, fmt.Errorf("failed to create password credential: %w", err)
			}
		} else {
			return dbuuid.UUID{}, fmt.Errorf("failed to get password credential: %w", err)
		}
	} else {
		if err := l.queries.UpdatePasswordCredential(ctx, tx, &database.UpdatePasswordCredentialParams{
			UserID:       resetToken.UserID,
			PasswordHash: hash,
		}); err != nil {
			return dbuuid.UUID{}, fmt.Errorf("failed to update password: %w", err)
		}
	}

	if err := l.queries.MarkPasswordResetTokenUsed(ctx, tx, resetToken.ID); err != nil {
		return dbuuid.UUID{}, fmt.Errorf("failed to mark reset token used: %w", err)
	}

	return resetToken.UserID, nil
}

// GetUserProfile retrieves a user's profile.
func (l *iamLogicImpl) GetUserProfile(ctx context.Context, tx database.DBTX, userID dbuuid.UUID) (*database.IamUser, error) {
	user, err := l.queries.GetUserByID(ctx, tx, userID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("failed to get user: %w", err)
	}
	return user, nil
}

// UpdateUserProfile updates a user's display name and/or profile picture URL.
func (l *iamLogicImpl) UpdateUserProfile(ctx context.Context, tx database.DBTX, userID dbuuid.UUID, displayName, profilePictureURL *string) (*database.IamUser, error) {
	// Get current profile first
	current, err := l.queries.GetUserByID(ctx, tx, userID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	dn := current.DisplayName
	if displayName != nil {
		dn = pgtype.Text{String: *displayName, Valid: true}
	}

	pp := current.ProfilePictureUrl
	if profilePictureURL != nil {
		pp = pgtype.Text{String: *profilePictureURL, Valid: true}
	}

	user, err := l.queries.UpdateUserProfile(ctx, tx, &database.UpdateUserProfileParams{
		ID:                userID,
		DisplayName:       dn,
		ProfilePictureUrl: pp,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to update user profile: %w", err)
	}
	return user, nil
}

// LinkSSOToUser links an SSO identity to an existing user.
func (l *iamLogicImpl) LinkSSOToUser(ctx context.Context, tx database.DBTX, userID dbuuid.UUID, claims *SSOClaims, provider string) (*database.IamSsoIdentity, error) {
	ssoIdentity, err := l.queries.CreateSSOIdentity(ctx, tx, &database.CreateSSOIdentityParams{
		ID:             dbuuid.Must(),
		UserID:         userID,
		Provider:       provider,
		ProviderUserID: claims.Subject,
		Email:          claims.Email,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to link SSO identity: %w", err)
	}
	return ssoIdentity, nil
}

// UnlinkSSOFromUser removes an SSO identity from a user.
// Ensures the user has another auth method (password or another SSO).
func (l *iamLogicImpl) UnlinkSSOFromUser(ctx context.Context, tx database.DBTX, userID, ssoIdentityID dbuuid.UUID) error {
	// Check how many SSO identities the user has
	ssoCount, err := l.queries.CountUserSSOIdentities(ctx, tx, userID)
	if err != nil {
		return fmt.Errorf("failed to count SSO identities: %w", err)
	}

	// Check if user has a password credential
	_, passwordErr := l.queries.GetPasswordCredential(ctx, tx, userID)
	hasPassword := passwordErr == nil

	// Must have at least one other auth method after unlinking
	if ssoCount <= 1 && !hasPassword {
		return ErrCannotUnlinkLastAuth
	}

	err = l.queries.DeleteSSOIdentity(ctx, tx, &database.DeleteSSOIdentityParams{
		ID:     ssoIdentityID,
		UserID: userID,
	})
	if err != nil {
		return fmt.Errorf("failed to unlink SSO identity: %w", err)
	}
	return nil
}

// GetUserOrganizationMemberships returns all organizations a user belongs to.
func (l *iamLogicImpl) GetUserOrganizationMemberships(ctx context.Context, tx database.DBTX, userID dbuuid.UUID) ([]*database.GetUserOrganizationsRow, error) {
	memberships, err := l.queries.GetUserOrganizations(ctx, tx, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get user organizations: %w", err)
	}
	return memberships, nil
}

// ValidateUserOrgMembership checks if a user is a member of an organization.
// ValidateUserOrgMembership checks that the user has at least one role in the organization.
// Returns ErrNotOrgMember if the user has no roles assigned.
func (l *iamLogicImpl) ValidateUserOrgMembership(ctx context.Context, tx database.DBTX, userID, orgID dbuuid.UUID) error {
	roles, err := l.queries.GetUserRoleNamesInOrg(ctx, tx, &database.GetUserRoleNamesInOrgParams{
		UserID:         userID,
		OrganizationID: orgID,
	})
	if err != nil {
		return fmt.Errorf("failed to get user roles: %w", err)
	}
	if len(roles) == 0 {
		return ErrNotOrgMember
	}
	return nil
}

// GetUserRoleNamesInOrg returns role display names for a user in an organization.
func (l *iamLogicImpl) GetUserRoleNamesInOrg(ctx context.Context, tx database.DBTX, userID, orgID dbuuid.UUID) ([]string, error) {
	return l.queries.GetUserRoleNamesInOrg(ctx, tx, &database.GetUserRoleNamesInOrgParams{
		UserID:         userID,
		OrganizationID: orgID,
	})
}

// CreateInvitationForOrg creates an invitation to join an organization.
func (l *iamLogicImpl) CreateInvitationForOrg(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, email string, roleID, invitedBy dbuuid.UUID) (*database.IamInvitation, error) {
	token, err := generateSecureToken()
	if err != nil {
		return nil, fmt.Errorf("failed to generate invitation token: %w", err)
	}

	invitation, err := l.queries.CreateInvitation(ctx, tx, &database.CreateInvitationParams{
		ID:             dbuuid.Must(),
		OrganizationID: orgID,
		Email:          email,
		RoleID:         roleID,
		Token:          token,
		InvitedBy:      invitedBy,
		ExpiresAt:      pgtype.Timestamptz{Time: time.Now().Add(InvitationExpiry), Valid: true},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create invitation: %w", err)
	}
	return invitation, nil
}

// AcceptInvitationWithToken accepts an invitation, creates user/employee, and assigns the invitation's role.
// Returns the user and the organization ID.
func (l *iamLogicImpl) AcceptInvitationWithToken(ctx context.Context, tx database.DBTX, token string, claims *SSOClaims, provider *string, password *string, displayName *string) (*database.IamUser, dbuuid.UUID, error) {
	invitation, err := l.queries.GetInvitationByToken(ctx, tx, token)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, dbuuid.UUID{}, ErrInvalidInvitation
		}
		return nil, dbuuid.UUID{}, fmt.Errorf("failed to get invitation: %w", err)
	}

	if invitation.ExpiresAt.Time.Before(time.Now()) {
		return nil, dbuuid.UUID{}, ErrInvitationExpired
	}

	if claims != nil {
		invitedEmail := strings.TrimSpace(strings.ToLower(invitation.Email))
		providerEmail := strings.TrimSpace(strings.ToLower(claims.Email))
		if invitedEmail == "" || providerEmail == "" || invitedEmail != providerEmail {
			return nil, dbuuid.UUID{}, ErrInvitationSSOEmailMismatch
		}
	}

	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}

	// Find or create user
	isNewUser := false
	var preCreatedEmployee *database.GetEmployeeByOrgEmailRow
	user, err := l.queries.GetUserByEmail(ctx, tx, pgtype.Text{String: invitation.Email, Valid: invitation.Email != ""})
	if err != nil {
		if err != pgx.ErrNoRows {
			return nil, dbuuid.UUID{}, fmt.Errorf("failed to check user: %w", err)
		}
		preCreatedEmployeeResult, preCreatedErr := l.queries.GetEmployeeByOrgEmail(ctx, tx, &database.GetEmployeeByOrgEmailParams{
			OrganizationID: invitation.OrganizationID,
			Lower:          invitation.Email,
		})
		if preCreatedErr == nil {
			preCreatedEmployee = preCreatedEmployeeResult
		} else if preCreatedErr != pgx.ErrNoRows {
			return nil, dbuuid.UUID{}, fmt.Errorf("failed to check pre-created employee: %w", preCreatedErr)
		}
		var sharedID dbuuid.UUID
		if preCreatedEmployee != nil {
			sharedID = preCreatedEmployee.ID
		} else {
			sharedID = dbuuid.Must()
		}

		dn := pgtype.Text{}
		if displayName != nil {
			dn = pgtype.Text{String: *displayName, Valid: true}
		}
		if claims != nil && claims.Name != "" {
			dn = pgtype.Text{String: claims.Name, Valid: true}
		}

		pp := pgtype.Text{}
		if claims != nil && claims.ProfilePicture != "" {
			pp = pgtype.Text{String: claims.ProfilePicture, Valid: true}
		}

		user, err = l.queries.CreateIAMUser(ctx, tx, &database.CreateIAMUserParams{
			ID:                sharedID,
			Email:             pgtype.Text{String: invitation.Email, Valid: invitation.Email != ""},
			DisplayName:       dn,
			ProfilePictureUrl: pp,
			Status:            UserStatusActive,
		})
		if err != nil {
			return nil, dbuuid.UUID{}, fmt.Errorf("failed to create user: %w", err)
		}

		// Set up auth method for new user
		if claims != nil && provider != nil {
			_, err = l.queries.CreateSSOIdentity(ctx, tx, &database.CreateSSOIdentityParams{
				ID:             dbuuid.Must(),
				UserID:         user.ID,
				Provider:       *provider,
				ProviderUserID: claims.Subject,
				Email:          claims.Email,
			})
			if err != nil {
				return nil, dbuuid.UUID{}, fmt.Errorf("failed to create SSO identity: %w", err)
			}
		}

		if password != nil {
			if err := ValidatePassword(*password); err != nil {
				return nil, dbuuid.UUID{}, err
			}
			hash, err := HashPassword(*password)
			if err != nil {
				return nil, dbuuid.UUID{}, err
			}
			_, err = l.queries.CreatePasswordCredential(ctx, tx, &database.CreatePasswordCredentialParams{
				ID:           dbuuid.Must(),
				UserID:       user.ID,
				PasswordHash: hash,
			})
			if err != nil {
				return nil, dbuuid.UUID{}, fmt.Errorf("failed to create password credential: %w", err)
			}
		}

		isNewUser = true
	}

	// Ensure iam.identity and organization.employee records exist for this org.
	identityRecord := database.IamIdentity{
		ID:             user.ID,
		OrganizationID: invitation.OrganizationID,
		Email:          pgtype.Text{String: invitation.Email, Valid: invitation.Email != ""},
		IdentityType:   database.IdentityTypeHuman,
		UpdatedAt:      now,
	}
	if createErr := dbcrud.Create(ctx, tx, &identityRecord); createErr != nil {
		slog.WarnContext(ctx, "iam.identity may already exist for user in org", "error", createErr,
			"user_id", user.ID, "org_id", invitation.OrganizationID)
	}

	// Derive given_name / family_name from display_name, SSO claims, or email prefix.
	givenName, familyName := splitDisplayName(user)

	employeeRecord := database.OrganizationEmployee{
		ID:             user.ID,
		OrganizationID: invitation.OrganizationID,
		GivenName:      givenName,
		FamilyName:     familyName,
		Email:          invitation.Email,
		IsActive:       true,
		UpdatedAt:      now,
	}
	if isNewUser && preCreatedEmployee == nil {
		if createErr := dbcrud.Create(ctx, tx, &employeeRecord); createErr != nil {
			return nil, dbuuid.UUID{}, fmt.Errorf("failed to create employee record: %w", createErr)
		}
	}

	// Assign the invitation's role to the employee
	if err := l.queries.AssignRoleToEmployee(ctx, tx, &database.AssignRoleToEmployeeParams{
		OrganizationID: invitation.OrganizationID,
		EmployeeID:     user.ID,
		RoleID:         invitation.RoleID,
		AssignedBy:     invitation.InvitedBy,
	}); err != nil {
		return nil, dbuuid.UUID{}, fmt.Errorf("failed to assign role to employee: %w", err)
	}

	// Mark invitation as accepted
	if err := l.queries.UpdateInvitationStatus(ctx, tx, &database.UpdateInvitationStatusParams{
		ID:         invitation.ID,
		Status:     InvitationStatusAccepted,
		AcceptedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
	}); err != nil {
		return nil, dbuuid.UUID{}, fmt.Errorf("failed to update invitation status: %w", err)
	}

	return user, invitation.OrganizationID, nil
}

// AutoAcceptPendingInvitation looks up a pending invitation for the user's email in the given org
// and, if found, creates the required identity/employee records and assigns the invitation role.
// Returns the accepted invitation, or (nil, nil) if no matching pending invitation exists.
func (l *iamLogicImpl) AutoAcceptPendingInvitation(ctx context.Context, tx database.DBTX, user *database.IamUser, orgID dbuuid.UUID) (*database.IamInvitation, error) {
	invitation, err := l.queries.GetPendingInvitationByEmailAndOrg(ctx, tx, &database.GetPendingInvitationByEmailAndOrgParams{
		Email:          user.Email.String,
		OrganizationID: orgID,
	})
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to look up pending invitation: %w", err)
	}

	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}

	// Ensure iam.identity exists for this user+org.
	identityRecord := database.IamIdentity{
		ID:             user.ID,
		OrganizationID: orgID,
		Email:          pgtype.Text{String: invitation.Email, Valid: invitation.Email != ""},
		IdentityType:   database.IdentityTypeHuman,
		UpdatedAt:      now,
	}
	if createErr := dbcrud.Create(ctx, tx, &identityRecord); createErr != nil {
		slog.WarnContext(ctx, "iam.identity may already exist for user in org (auto-accept)", "error", createErr,
			"user_id", user.ID, "org_id", orgID)
	}

	// Ensure organization.employee exists.
	givenName, familyName := splitDisplayName(user)
	employeeRecord := database.OrganizationEmployee{
		ID:             user.ID,
		OrganizationID: orgID,
		GivenName:      givenName,
		FamilyName:     familyName,
		Email:          invitation.Email,
		IsActive:       true,
		UpdatedAt:      now,
	}
	if createErr := dbcrud.Create(ctx, tx, &employeeRecord); createErr != nil {
		slog.WarnContext(ctx, "organization.employee may already exist (auto-accept)", "error", createErr,
			"user_id", user.ID, "org_id", orgID)
	}

	// Assign the invitation's role.
	if err := l.queries.AssignRoleToEmployee(ctx, tx, &database.AssignRoleToEmployeeParams{
		OrganizationID: orgID,
		EmployeeID:     user.ID,
		RoleID:         invitation.RoleID,
		AssignedBy:     invitation.InvitedBy,
	}); err != nil {
		return nil, fmt.Errorf("failed to assign role via auto-accept: %w", err)
	}

	// Mark invitation accepted.
	if err := l.queries.UpdateInvitationStatus(ctx, tx, &database.UpdateInvitationStatusParams{
		ID:         invitation.ID,
		Status:     InvitationStatusAccepted,
		AcceptedAt: now,
	}); err != nil {
		return nil, fmt.Errorf("failed to mark invitation accepted: %w", err)
	}

	return invitation, nil
}

// Falls back to email prefix when display name is not set.
func splitDisplayName(user *database.IamUser) (givenName, familyName string) {
	name := user.DisplayName.String
	if !user.DisplayName.Valid || name == "" {
		// Use email prefix as given_name, empty family_name
		parts := strings.SplitN(user.Email.String, "@", 2)
		return parts[0], ""
	}
	parts := strings.SplitN(name, " ", 2)
	if len(parts) == 2 {
		return parts[0], parts[1]
	}
	return name, ""
}
func (l *iamLogicImpl) CancelInvitationInOrg(ctx context.Context, tx database.DBTX, invitationID, orgID dbuuid.UUID) error {
	return l.queries.CancelInvitation(ctx, tx, &database.CancelInvitationParams{
		ID:             invitationID,
		OrganizationID: orgID,
	})
}

// ListInvitationsForOrg lists invitations for an organization, optionally filtered by status.
func (l *iamLogicImpl) ListInvitationsForOrg(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, status *string) ([]*database.IamInvitation, error) {
	filterStatus := InvitationStatusPending
	if status != nil {
		filterStatus = *status
	}
	return l.queries.GetOrgInvitations(ctx, tx, &database.GetOrgInvitationsParams{
		OrganizationID: orgID,
		Status:         filterStatus,
	})
}

// CreateSessionForUser creates a new session record.
func (l *iamLogicImpl) CreateSessionForUser(ctx context.Context, tx database.DBTX, userID dbuuid.UUID, tokenJTI string, issuedAt, expiresAt time.Time, ipAddress, userAgent string) (*database.IamSession, error) {
	var ip *netip.Addr
	if parsed, err := netip.ParseAddr(ipAddress); err == nil {
		ip = &parsed
	}

	session, err := l.queries.CreateSession(ctx, tx, &database.CreateSessionParams{
		ID:        dbuuid.Must(),
		UserID:    userID,
		TokenJti:  tokenJTI,
		IssuedAt:  pgtype.Timestamptz{Time: issuedAt, Valid: true},
		ExpiresAt: pgtype.Timestamptz{Time: expiresAt, Valid: true},
		IpAddress: ip,
		UserAgent: pgtype.Text{String: userAgent, Valid: userAgent != ""},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create session: %w", err)
	}
	return session, nil
}

// InvalidateSession marks a session as invalidated.
func (l *iamLogicImpl) InvalidateSession(ctx context.Context, tx database.DBTX, sessionID dbuuid.UUID) error {
	return l.queries.InvalidateSession(ctx, tx, sessionID)
}

// InvalidateAllUserSessions invalidates all active sessions for a user.
func (l *iamLogicImpl) InvalidateAllUserSessions(ctx context.Context, tx database.DBTX, userID dbuuid.UUID) error {
	return l.queries.InvalidateUserSessions(ctx, tx, userID)
}

// GetActiveSessionsForUser returns all active sessions for a user.
func (l *iamLogicImpl) GetActiveSessionsForUser(ctx context.Context, tx database.DBTX, userID dbuuid.UUID) ([]*database.IamSession, error) {
	return l.queries.GetActiveSessions(ctx, tx, userID)
}

// generateSecureToken generates a 32-byte cryptographically secure random token.
func generateSecureToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(b), nil
}

// === Role Management ===

func (l *iamLogicImpl) ListAllPermissions(ctx context.Context, tx database.DBTX, domain *string) ([]*database.Permission, error) {
	if domain != nil && *domain != "" {
		return l.queries.ListPermissionsByDomain(ctx, tx, *domain)
	}
	return l.queries.ListPermissions(ctx, tx)
}

func (l *iamLogicImpl) CreateRole(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, name, description string, permissionIDs []string) (*database.IamRole, error) {
	role, err := l.queries.CreateIAMRole(ctx, tx, &database.CreateIAMRoleParams{
		OrganizationID: orgID,
		Name:           name,
		Description:    pgtype.Text{String: description, Valid: description != ""},
		IsSystem:       false,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create role: %w", err)
	}

	if len(permissionIDs) > 0 {
		if err := l.queries.SetRolePermissions(ctx, tx, &database.SetRolePermissionsParams{
			OrganizationID: orgID,
			RoleID:         role.ID,
			PermissionIds:  permissionIDs,
		}); err != nil {
			return nil, fmt.Errorf("failed to set role permissions: %w", err)
		}
	}

	return role, nil
}

// lockoutPermissions are permissions that must not be removed from the Owner system role.
var lockoutPermissions = []string{"iam.manageRoles", "iam.viewRoles"}

func (l *iamLogicImpl) UpdateRole(ctx context.Context, tx database.DBTX, orgID, roleID dbuuid.UUID, name *string, description *string, permissionIDs []string, updatePermissions bool) (*database.IamRole, error) {
	existing, err := l.queries.GetIAMRole(ctx, tx, &database.GetIAMRoleParams{
		OrganizationID: orgID,
		ID:             roleID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get role: %w", err)
	}

	// Lockout prevention: Owner system role must always retain iam.manageRoles and iam.viewRoles
	if existing.SourceDefaultRoleID.Valid && existing.SourceDefaultRoleID.String == DefaultRoleOwner && updatePermissions {
		permSet := make(map[string]struct{}, len(permissionIDs))
		for _, p := range permissionIDs {
			permSet[p] = struct{}{}
		}
		for _, required := range lockoutPermissions {
			if _, ok := permSet[required]; !ok {
				return nil, fmt.Errorf("cannot remove %q from Owner system role: lockout prevention", required)
			}
		}
	}

	updateName := existing.Name
	if name != nil {
		updateName = *name
	}
	updateDesc := existing.Description
	if description != nil {
		updateDesc = pgtype.Text{String: *description, Valid: *description != ""}
	}

	role, err := l.queries.UpdateIAMRole(ctx, tx, &database.UpdateIAMRoleParams{
		OrganizationID: orgID,
		ID:             roleID,
		Name:           updateName,
		Description:    updateDesc,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to update role: %w", err)
	}

	if updatePermissions {
		if err := l.queries.ClearRolePermissions(ctx, tx, &database.ClearRolePermissionsParams{
			OrganizationID: orgID,
			RoleID:         roleID,
		}); err != nil {
			return nil, fmt.Errorf("failed to clear role permissions: %w", err)
		}
		if len(permissionIDs) > 0 {
			if err := l.queries.SetRolePermissions(ctx, tx, &database.SetRolePermissionsParams{
				OrganizationID: orgID,
				RoleID:         roleID,
				PermissionIds:  permissionIDs,
			}); err != nil {
				return nil, fmt.Errorf("failed to set role permissions: %w", err)
			}
		}
	}

	return role, nil
}

func (l *iamLogicImpl) DeleteRole(ctx context.Context, tx database.DBTX, orgID, roleID dbuuid.UUID) error {
	// Check if the role is a system role before attempting deletion
	existing, err := l.queries.GetIAMRole(ctx, tx, &database.GetIAMRoleParams{
		OrganizationID: orgID,
		ID:             roleID,
	})
	if err != nil {
		return fmt.Errorf("failed to get role: %w", err)
	}
	if existing.IsSystem {
		return fmt.Errorf("cannot delete system role %q", existing.Name)
	}
	return l.queries.DeleteIAMRole(ctx, tx, &database.DeleteIAMRoleParams{
		OrganizationID: orgID,
		ID:             roleID,
	})
}

func (l *iamLogicImpl) ListRoles(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID) ([]*database.IamRole, error) {
	return l.queries.ListIAMRoles(ctx, tx, orgID)
}

func (l *iamLogicImpl) GetRole(ctx context.Context, tx database.DBTX, orgID, roleID dbuuid.UUID) (*database.IamRole, []string, int64, error) {
	role, err := l.queries.GetIAMRole(ctx, tx, &database.GetIAMRoleParams{
		OrganizationID: orgID,
		ID:             roleID,
	})
	if err != nil {
		return nil, nil, 0, fmt.Errorf("failed to get role: %w", err)
	}
	perms, err := l.queries.GetRolePermissions(ctx, tx, &database.GetRolePermissionsParams{
		OrganizationID: orgID,
		RoleID:         roleID,
	})
	if err != nil {
		return nil, nil, 0, fmt.Errorf("failed to get role permissions: %w", err)
	}
	count, err := l.queries.CountRoleEmployees(ctx, tx, &database.CountRoleEmployeesParams{
		OrganizationID: orgID,
		RoleID:         roleID,
	})
	if err != nil {
		return nil, nil, 0, fmt.Errorf("failed to count role employees: %w", err)
	}
	return role, perms, count, nil
}

func (l *iamLogicImpl) AssignRoleToEmployee(ctx context.Context, tx database.DBTX, orgID, employeeID, roleID, assignedBy dbuuid.UUID) error {
	return l.queries.AssignRoleToEmployee(ctx, tx, &database.AssignRoleToEmployeeParams{
		OrganizationID: orgID,
		EmployeeID:     employeeID,
		RoleID:         roleID,
		AssignedBy:     assignedBy,
	})
}

func (l *iamLogicImpl) RevokeRoleFromEmployee(ctx context.Context, tx database.DBTX, orgID, employeeID, roleID dbuuid.UUID) error {
	return l.queries.RevokeRoleFromEmployee(ctx, tx, &database.RevokeRoleFromEmployeeParams{
		OrganizationID: orgID,
		EmployeeID:     employeeID,
		RoleID:         roleID,
	})
}

func (l *iamLogicImpl) ListEmployeeRoles(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID) ([]*database.IamRole, error) {
	return l.queries.ListEmployeeRoles(ctx, tx, &database.ListEmployeeRolesParams{
		OrganizationID: orgID,
		EmployeeID:     employeeID,
	})
}

func (l *iamLogicImpl) GetEmployeePermissions(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID) ([]string, error) {
	return l.queries.GetEmployeePermissions(ctx, tx, &database.GetEmployeePermissionsParams{
		OrganizationID: orgID,
		EmployeeID:     employeeID,
	})
}
