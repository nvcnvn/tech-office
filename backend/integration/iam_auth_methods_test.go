package integration

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/database/txn"
	backendiam "github.com/nvcnvn/tech-office/backend/internal/iam"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

func TestIAMAuthMethods(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()
	logic := backendiam.NewIAMLogic(database.New(), globalSigner)

	t.Run("when an invited user sets a password and later signs in with SSO using the same email", func(t *testing.T) {
		invitedEmail := uniqueTestEmail("auth-methods")
		invitationToken := inviteUserAndGetToken(t, w, owner, invitedEmail)
		password := "Test1234!"
		displayName := "Invited Password User"

		var invitedUserID dbuuid.UUID
		err := txn.WithTxn(context.Background(), globalDB, func(ctx context.Context, tx database.DBTX) error {
			user, _, err := logic.AcceptInvitationWithToken(ctx, tx, invitationToken, nil, nil, &password, &displayName)
			if err != nil {
				return err
			}
			invitedUserID = user.ID
			return nil
		})
		require.NoError(t, err)

		claims := &backendiam.SSOClaims{
			Subject: "google-auth-methods-subject-" + dbuuid.Must().String(),
			Email:   invitedEmail,
			Name:    displayName,
		}

		var linkedUserID dbuuid.UUID
		var isNewUser bool
		err = txn.WithTxn(context.Background(), globalDB, func(ctx context.Context, tx database.DBTX) error {
			user, _, created, err := logic.FindOrCreateSSOUser(ctx, tx, claims, backendiam.SSOProviderGoogle)
			if err != nil {
				return err
			}
			linkedUserID = user.ID
			isNewUser = created
			return nil
		})
		require.NoError(t, err)

		t.Run("it reuses the same user account instead of creating a duplicate", func(t *testing.T) {
			assert.Equal(t, invitedUserID, linkedUserID)
			assert.False(t, isNewUser)
		})

		t.Run("it keeps both password and SSO as valid auth methods", func(t *testing.T) {
			cred, err := globalQ.GetPasswordCredential(context.Background(), globalDB, invitedUserID)
			require.NoError(t, err)
			assert.NotEmpty(t, cred.PasswordHash)

			identities, err := globalQ.GetUserSSOIdentities(context.Background(), globalDB, invitedUserID)
			require.NoError(t, err)
			require.Len(t, identities, 1)
			assert.Equal(t, backendiam.SSOProviderGoogle, identities[0].Provider)
			assert.Equal(t, invitedEmail, identities[0].Email)
		})
	})

	t.Run("when an invited user tries to accept with SSO from a different email", func(t *testing.T) {
		invitedEmail := uniqueTestEmail("invite-match")
		invitationToken := inviteUserAndGetToken(t, w, owner, invitedEmail)
		provider := backendiam.SSOProviderGoogle
		claims := &backendiam.SSOClaims{
			Subject: "google-mismatch-subject-" + dbuuid.Must().String(),
			Email:   uniqueTestEmail("other-google"),
			Name:    "Other Google Account",
		}

		err := txn.WithTxn(context.Background(), globalDB, func(ctx context.Context, tx database.DBTX) error {
			_, _, err := logic.AcceptInvitationWithToken(ctx, tx, invitationToken, claims, &provider, nil, nil)
			return err
		})

		t.Run("it rejects the acceptance with a clear domain error", func(t *testing.T) {
			require.Error(t, err)
			assert.ErrorIs(t, err, backendiam.ErrInvitationSSOEmailMismatch)
		})

		t.Run("the invitation remains pending", func(t *testing.T) {
			invitation, queryErr := globalQ.GetInvitationByToken(context.Background(), globalDB, invitationToken)
			require.NoError(t, queryErr)
			assert.Equal(t, backendiam.InvitationStatusPending, invitation.Status)
		})
	})
}

func inviteUserAndGetToken(t *testing.T, w *testWorld, owner testUser, email string) string {
	t.Helper()
	ctx := context.Background()

	var employeeRoleID string
	err := globalDB.QueryRow(ctx,
		`SELECT id FROM iam.role
		 WHERE organization_id = $1 AND source_default_role_id = 'employee'
		 LIMIT 1`, owner.OrgID,
	).Scan(&employeeRoleID)
	require.NoError(t, err, "find employee role ID")

	req := connect.NewRequest(&rpcv1.InviteUserRequest{
		OrganizationId: owner.OrgID.String(),
		Email:          email,
		RoleId:         employeeRoleID,
	})
	req.Header().Set("Authorization", "Bearer "+owner.Token)
	_, err = w.iamClient.InviteUser(ctx, req)
	require.NoError(t, err, "invite user")

	var token string
	err = globalDB.QueryRow(ctx,
		`SELECT token FROM iam.invitation
		 WHERE organization_id = $1 AND email = $2 AND status = 'pending'
		 LIMIT 1`, owner.OrgID, email,
	).Scan(&token)
	require.NoError(t, err, "find invitation token")

	return token
}

func uniqueTestEmail(prefix string) string {
	suffix := strings.ReplaceAll(dbuuid.Must().String(), "-", "")
	return fmt.Sprintf("%s+%s@test.invalid", prefix, suffix)
}
