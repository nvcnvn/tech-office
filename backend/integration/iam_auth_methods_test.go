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

// TestIAMPINIdentifierResolution covers FR-004 and FR-014: PIN authentication resolves an
// identity by login identifier OR email, so an owner registered by email can hold a PIN and
// staff and owners share one "who are you" field.
func TestIAMPINIdentifierResolution(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()
	subdomain := w.orgSubdomain()

	var ownerEmail string
	err := globalDB.QueryRow(context.Background(),
		`SELECT email FROM organization.employee WHERE organization_id = $1 AND id = $2`,
		owner.OrgID, owner.ID,
	).Scan(&ownerEmail)
	require.NoError(t, err, "read owner email")
	require.NotEmpty(t, ownerEmail)

	t.Run("when an email-registered owner sets a PIN", func(t *testing.T) {
		// The owner holds no PIN credential, so this is a first-time set and needs no
		// current PIN.
		_, setErr := w.setPIN(owner, "314159", "")
		require.NoError(t, setErr, "owner should be able to set a first PIN")

		t.Run("they can sign in with their email address and that PIN", func(t *testing.T) {
			resp, loginErr := w.loginWithPIN(subdomain, ownerEmail, "314159")
			require.NoError(t, loginErr, "owner PIN login by email must work — this is the load-bearing change")
			assert.False(t, resp.PinChangeRequired)
			assert.NotEmpty(t, resp.AccessToken)
		})

		t.Run("the email match is case-insensitive", func(t *testing.T) {
			resp, loginErr := w.loginWithPIN(subdomain, strings.ToUpper(ownerEmail), "314159")
			require.NoError(t, loginErr)
			assert.NotEmpty(t, resp.AccessToken)
		})

		t.Run("a wrong PIN is still rejected", func(t *testing.T) {
			_, loginErr := w.loginWithPIN(subdomain, ownerEmail, "271828")
			require.Error(t, loginErr)
		})
	})

	t.Run("when a worker holds a login identifier", func(t *testing.T) {
		loginID := "IDR-" + strings.ReplaceAll(dbuuid.Must().String(), "-", "")[:8]
		acct := w.createOrgAccount(owner, loginID, "Identifier Worker", "Iden", "Tifier")
		tempLogin, loginErr := w.loginWithPIN(subdomain, loginID, acct.TemporaryPin)
		require.NoError(t, loginErr)
		_, setErr := w.setPINWithToken(tempLogin.PinChangeToken, "606060")
		require.NoError(t, setErr)

		t.Run("their login identifier still resolves", func(t *testing.T) {
			resp, err := w.loginWithPIN(subdomain, loginID, "606060")
			require.NoError(t, err)
			assert.NotEmpty(t, resp.AccessToken)
		})

		t.Run("a login identifier containing an at sign is rejected at creation", func(t *testing.T) {
			req := connect.NewRequest(&rpcv1.CreateOrgAccountRequest{
				LoginIdentifier: "someone@example.com",
				DisplayName:     "Email Shaped",
				GivenName:       "Email",
				FamilyName:      "Shaped",
			})
			req.Header().Set("Authorization", "Bearer "+owner.Token)
			_, err := w.iamClient.CreateOrgAccount(context.Background(), req)
			require.Error(t, err)
			assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
			assert.Contains(t, fieldViolations(t, err), "login_identifier",
				"the error should name the field the caller must correct")
		})

		t.Run("when a legacy login identifier collides with another member's email", func(t *testing.T) {
			// Creation now rejects '@', so a collision can only survive from before that
			// rule. Force one directly to prove the ORDER BY keeps resolution deterministic.
			_, updateErr := globalDB.Exec(context.Background(),
				`UPDATE iam.identity SET login_identifier = $1
				 WHERE organization_id = $2 AND login_identifier = $3`,
				ownerEmail, owner.OrgID, loginID)
			require.NoError(t, updateErr, "force a colliding login identifier")

			t.Run("the login identifier match wins over the email match", func(t *testing.T) {
				resp, err := w.loginWithPIN(subdomain, ownerEmail, "606060")
				require.NoError(t, err, "the worker's PIN should authenticate the colliding identifier")
				assert.NotEmpty(t, resp.AccessToken)
			})

			t.Run("the owner's own PIN no longer resolves through the shadowed email", func(t *testing.T) {
				_, err := w.loginWithPIN(subdomain, ownerEmail, "314159")
				require.Error(t, err, "resolution is deterministic, not arbitrary")
			})

			// Restore so later subtests are not affected by the forced collision.
			_, restoreErr := globalDB.Exec(context.Background(),
				`UPDATE iam.identity SET login_identifier = $1
				 WHERE organization_id = $2 AND login_identifier = $3`,
				loginID, owner.OrgID, ownerEmail)
			require.NoError(t, restoreErr)
		})
	})
}

// TestIAMPINLockoutRetryInfo covers the Principle X round-trip contract: a timed lockout
// carries google.rpc.RetryInfo so the client can render a live countdown, and a full lock
// carries none because no delay resolves it.
func TestIAMPINLockoutRetryInfo(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()
	subdomain := w.orgSubdomain()

	loginID := "RTRY-" + strings.ReplaceAll(dbuuid.Must().String(), "-", "")[:8]
	acct := w.createOrgAccount(owner, loginID, "Retry Worker", "Retry", "Worker")
	tempLogin, err := w.loginWithPIN(subdomain, loginID, acct.TemporaryPin)
	require.NoError(t, err)
	_, err = w.setPINWithToken(tempLogin.PinChangeToken, "135790")
	require.NoError(t, err)

	workerID := w.identityIDByLoginIdentifier(owner.OrgID, loginID)
	const wrongPIN = "999999"

	t.Run("when three wrong PINs trip the first lockout tier", func(t *testing.T) {
		for i := range 3 {
			_, attemptErr := w.loginWithPIN(subdomain, loginID, wrongPIN)
			require.Error(t, attemptErr, "attempt %d should fail", i+1)
			if i == 2 {
				require.Equal(t, connect.CodeResourceExhausted, connect.CodeOf(attemptErr))

				t.Run("the error carries a retry delay matching the tier duration", func(t *testing.T) {
					delay, ok := retryDelayFromError(t, attemptErr)
					require.True(t, ok, "a timed lockout must carry RetryInfo")
					assert.InDelta(t, backendiam.LockoutDurations[backendiam.LockoutTier1].Seconds(),
						delay.Seconds(), 1.0)
				})
			}
		}
	})

	// Escalation past tier 1 requires the previous lockout to expire first — checkLockout
	// short-circuits while one is live — so the higher tiers are driven directly. What is
	// under test here is the error contract, not the escalation schedule, which
	// TestOrgManagedAccounts already covers.
	timedTiers := []struct {
		name string
		tier int
	}{
		{"tier 2", backendiam.LockoutTier2},
		{"tier 3", backendiam.LockoutTier3},
	}

	for _, tc := range timedTiers {
		t.Run("when the account sits in "+tc.name, func(t *testing.T) {
			duration := backendiam.LockoutDurations[tc.tier]
			w.forceLockout(owner.OrgID, workerID, tc.tier, duration)

			_, lockErr := w.loginWithPIN(subdomain, loginID, "135790")
			require.Error(t, lockErr, "a correct PIN is still refused while locked")
			require.Equal(t, connect.CodeResourceExhausted, connect.CodeOf(lockErr))

			t.Run("the retry delay matches the remaining lockout", func(t *testing.T) {
				delay, ok := retryDelayFromError(t, lockErr)
				require.True(t, ok, "a timed lockout must carry RetryInfo")
				assert.InDelta(t, duration.Seconds(), delay.Seconds(), 1.0,
					"the delay should be within one second of the time actually remaining")
			})
		})
	}

	t.Run("when the account is fully locked", func(t *testing.T) {
		w.forceLockout(owner.OrgID, workerID, backendiam.LockoutTierFullLock, 0)

		_, lockErr := w.loginWithPIN(subdomain, loginID, "135790")
		require.Error(t, lockErr)
		require.Equal(t, connect.CodeResourceExhausted, connect.CodeOf(lockErr))

		t.Run("the error carries no retry delay because no delay resolves it", func(t *testing.T) {
			_, ok := retryDelayFromError(t, lockErr)
			assert.False(t, ok, "a full lock must not promise a retry time")
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
