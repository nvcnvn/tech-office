package integration

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// createOrgAccount creates a single org-managed worker via the admin RPC.
func (w *testWorld) createOrgAccount(actor testUser, loginID, displayName, given, family string) *rpcv1.CreateOrgAccountResponse {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.CreateOrgAccountRequest{
		LoginIdentifier: loginID,
		DisplayName:     displayName,
		GivenName:       given,
		FamilyName:      family,
	})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.iamClient.CreateOrgAccount(context.Background(), req)
	require.NoError(w.t, err, "createOrgAccount")
	return resp.Msg
}

// loginWithPIN calls the LoginWithPIN RPC (unauthenticated).
func (w *testWorld) loginWithPIN(subdomain, loginID, pin string) (*rpcv1.LoginWithPINResponse, error) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.LoginWithPINRequest{
		OrganizationSubdomain: subdomain,
		LoginIdentifier:       loginID,
		Pin:                   pin,
	})
	resp, err := w.iamClient.LoginWithPIN(context.Background(), req)
	if err != nil {
		return nil, err
	}
	return resp.Msg, nil
}

// setPINWithToken calls SetPIN using a pin_change_token (no auth header).
func (w *testWorld) setPINWithToken(pinChangeToken, newPIN string) (*rpcv1.SetPINResponse, error) {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.SetPINRequest{
		NewPin:         newPIN,
		PinChangeToken: &pinChangeToken,
	})
	resp, err := w.iamClient.SetPIN(context.Background(), req)
	if err != nil {
		return nil, err
	}
	return resp.Msg, nil
}

// listOrgManagedAccounts lists org-managed accounts using the admin RPC.
func (w *testWorld) listOrgManagedAccounts(actor testUser) *rpcv1.ListOrgAccountsResponse {
	w.t.Helper()
	req := connect.NewRequest(&rpcv1.ListOrgAccountsRequest{Limit: 100})
	req.Header().Set("Authorization", "Bearer "+actor.Token)
	resp, err := w.iamClient.ListOrgAccounts(context.Background(), req)
	require.NoError(w.t, err, "listOrgAccounts")
	return resp.Msg
}

// orgSubdomain returns the subdomain for the test world org (queried from DB).
func (w *testWorld) orgSubdomain() string {
	w.t.Helper()
	var subdomain string
	err := globalDB.QueryRow(context.Background(),
		`SELECT subdomain FROM public.organization WHERE id = $1`, w.OrgID,
	).Scan(&subdomain)
	require.NoError(w.t, err, "query org subdomain")
	return subdomain
}

func TestOrgManagedAccounts(t *testing.T) {
	w := newTestWorld(t)
	owner := w.withOwner()
	subdomain := w.orgSubdomain()

	// === Account Creation ===
	t.Run("when admin creates a single org-managed account", func(t *testing.T) {
		suffix := strings.ReplaceAll(dbuuid.Must().String(), "-", "")[:8]
		loginID := "WRK-" + suffix

		resp := w.createOrgAccount(owner, loginID, "Worker One", "Worker", "One")

		t.Run("it returns the account ID login identifier and a temporary PIN", func(t *testing.T) {
			assert.NotEmpty(t, resp.Id, "should have an account ID")
			assert.Equal(t, loginID, resp.LoginIdentifier)
			assert.Len(t, resp.TemporaryPin, 6, "temporary PIN should be 6 digits")
		})

		t.Run("the worker appears in the org-managed accounts list", func(t *testing.T) {
			list := w.listOrgManagedAccounts(owner)
			found := false
			for _, a := range list.Accounts {
				if a.LoginIdentifier == loginID {
					found = true
				}
			}
			assert.True(t, found, "worker should appear in list")
		})

		t.Run("creating a duplicate login identifier is rejected", func(t *testing.T) {
			dupReq := connect.NewRequest(&rpcv1.CreateOrgAccountRequest{
				LoginIdentifier: loginID,
				DisplayName:     "Duplicate",
				GivenName:       "Dup",
				FamilyName:      "User",
			})
			dupReq.Header().Set("Authorization", "Bearer "+owner.Token)
			_, err := w.iamClient.CreateOrgAccount(context.Background(), dupReq)
			require.Error(t, err)
			assert.Equal(t, connect.CodeAlreadyExists, connect.CodeOf(err))
		})
	})

	// === Full PIN Lifecycle ===
	t.Run("full PIN lifecycle temp login then set PIN then personal login", func(t *testing.T) {
		suffix := strings.ReplaceAll(dbuuid.Must().String(), "-", "")[:8]
		loginID := "LIFE-" + suffix

		acct := w.createOrgAccount(owner, loginID, "Lifecycle Worker", "Life", "Cycle")
		tempPIN := acct.TemporaryPin

		var pinChangeToken string
		t.Run("login with temporary PIN returns pin_change_required true", func(t *testing.T) {
			resp, err := w.loginWithPIN(subdomain, loginID, tempPIN)
			require.NoError(t, err)
			assert.True(t, resp.PinChangeRequired, "should require PIN change")
			assert.NotEmpty(t, resp.PinChangeToken, "should have pin_change_token")
			assert.Empty(t, resp.AccessToken, "should NOT issue a full token yet")
			pinChangeToken = resp.PinChangeToken
		})

		var fullToken string
		t.Run("setting a personal PIN issues a full JWT", func(t *testing.T) {
			resp, err := w.setPINWithToken(pinChangeToken, "482917")
			require.NoError(t, err)
			assert.NotEmpty(t, resp.AccessToken, "should have a full JWT")
			assert.Greater(t, resp.ExpiresAt, int64(0))
			fullToken = resp.AccessToken
		})

		t.Run("login with personal PIN returns a valid session", func(t *testing.T) {
			resp, err := w.loginWithPIN(subdomain, loginID, "482917")
			require.NoError(t, err)
			assert.False(t, resp.PinChangeRequired)
			assert.NotEmpty(t, resp.AccessToken)
		})

		t.Run("the JWT can call authorized endpoints", func(t *testing.T) {
			require.NotEmpty(t, fullToken)
			profileReq := connect.NewRequest(&rpcv1.GetProfileRequest{})
			profileReq.Header().Set("Authorization", "Bearer "+fullToken)
			_, err := w.iamClient.GetProfile(context.Background(), profileReq)
			require.NoError(t, err, "worker should be able to get their profile")
		})
	})

	// === Lockout Tiers ===
	t.Run("when a worker enters incorrect PINs", func(t *testing.T) {
		suffix := strings.ReplaceAll(dbuuid.Must().String(), "-", "")[:8]
		loginID := "LOCK-" + suffix

		acct := w.createOrgAccount(owner, loginID, "Lockout Worker", "Lock", "Out")
		loginResp, err := w.loginWithPIN(subdomain, loginID, acct.TemporaryPin)
		require.NoError(t, err)
		_, err = w.setPINWithToken(loginResp.PinChangeToken, "111222")
		require.NoError(t, err)

		wrongPIN := "999999"

		t.Run("after 3 failures it returns a lockout error", func(t *testing.T) {
			for i := 0; i < 2; i++ {
				_, err := w.loginWithPIN(subdomain, loginID, wrongPIN)
				require.Error(t, err, "attempt %d should fail", i+1)
			}
			_, err := w.loginWithPIN(subdomain, loginID, wrongPIN)
			require.Error(t, err)
			assert.Equal(t, connect.CodeResourceExhausted, connect.CodeOf(err),
				"3rd failure should trigger lockout")
		})

		t.Run("further failures escalate lockout tiers", func(t *testing.T) {
			_, err := w.loginWithPIN(subdomain, loginID, wrongPIN)
			require.Error(t, err)
			assert.Equal(t, connect.CodeResourceExhausted, connect.CodeOf(err))

			_, err = w.loginWithPIN(subdomain, loginID, wrongPIN)
			require.Error(t, err)
			assert.Equal(t, connect.CodeResourceExhausted, connect.CodeOf(err))

			_, err = w.loginWithPIN(subdomain, loginID, wrongPIN)
			require.Error(t, err)
			assert.Equal(t, connect.CodeResourceExhausted, connect.CodeOf(err))
		})

		t.Run("a fully locked account rejects even correct PINs", func(t *testing.T) {
			_, err := w.loginWithPIN(subdomain, loginID, "111222")
			require.Error(t, err)
			assert.Equal(t, connect.CodeResourceExhausted, connect.CodeOf(err))
		})
	})

	// === Admin Unlock ===
	t.Run("when admin unlocks a locked account", func(t *testing.T) {
		suffix := strings.ReplaceAll(dbuuid.Must().String(), "-", "")[:8]
		loginID := "UNLK-" + suffix

		acct := w.createOrgAccount(owner, loginID, "Unlock Worker", "Un", "Lock")
		loginResp, err := w.loginWithPIN(subdomain, loginID, acct.TemporaryPin)
		require.NoError(t, err)
		_, err = w.setPINWithToken(loginResp.PinChangeToken, "333444")
		require.NoError(t, err)

		for i := 0; i < 6; i++ {
			w.loginWithPIN(subdomain, loginID, "000000")
		}
		_, err = w.loginWithPIN(subdomain, loginID, "333444")
		require.Error(t, err)
		assert.Equal(t, connect.CodeResourceExhausted, connect.CodeOf(err))

		t.Run("the lockout is cleared and the worker can log in again", func(t *testing.T) {
			unlockReq := connect.NewRequest(&rpcv1.UnlockOrgAccountRequest{
				Id:       acct.Id,
				ResetPin: false,
			})
			unlockReq.Header().Set("Authorization", "Bearer "+owner.Token)
			_, err := w.iamClient.UnlockOrgAccount(context.Background(), unlockReq)
			require.NoError(t, err)

			resp, err := w.loginWithPIN(subdomain, loginID, "333444")
			require.NoError(t, err)
			assert.NotEmpty(t, resp.AccessToken)
		})

		t.Run("with reset_pin true it generates a new temporary PIN", func(t *testing.T) {
			unlockReq := connect.NewRequest(&rpcv1.UnlockOrgAccountRequest{
				Id:       acct.Id,
				ResetPin: true,
			})
			unlockReq.Header().Set("Authorization", "Bearer "+owner.Token)
			resp, err := w.iamClient.UnlockOrgAccount(context.Background(), unlockReq)
			require.NoError(t, err)
			require.NotNil(t, resp.Msg.TemporaryPin)
			assert.Len(t, *resp.Msg.TemporaryPin, 6)
		})
	})

	// === Deactivation ===
	t.Run("when admin deactivates an org-managed account", func(t *testing.T) {
		suffix := strings.ReplaceAll(dbuuid.Must().String(), "-", "")[:8]
		loginID := "DEAC-" + suffix

		acct := w.createOrgAccount(owner, loginID, "Deactivate Worker", "De", "Activate")
		loginResp, err := w.loginWithPIN(subdomain, loginID, acct.TemporaryPin)
		require.NoError(t, err)
		_, err = w.setPINWithToken(loginResp.PinChangeToken, "556677")
		require.NoError(t, err)

		deactReq := connect.NewRequest(&rpcv1.DeactivateOrgAccountRequest{Id: acct.Id})
		deactReq.Header().Set("Authorization", "Bearer "+owner.Token)
		_, err = w.iamClient.DeactivateOrgAccount(context.Background(), deactReq)
		require.NoError(t, err)

		t.Run("the worker cannot log in after deactivation", func(t *testing.T) {
			_, err := w.loginWithPIN(subdomain, loginID, "556677")
			require.Error(t, err)
		})

		t.Run("the account status shows as deactivated in the list", func(t *testing.T) {
			list := w.listOrgManagedAccounts(owner)
			for _, a := range list.Accounts {
				if a.LoginIdentifier == loginID {
					assert.Equal(t, "deactivated", a.Status)
				}
			}
		})
	})

	// === Credential Reset ===
	t.Run("when admin resets credentials for an org-managed account", func(t *testing.T) {
		suffix := strings.ReplaceAll(dbuuid.Must().String(), "-", "")[:8]
		loginID := "RSET-" + suffix

		acct := w.createOrgAccount(owner, loginID, "Reset Worker", "Re", "Set")
		loginResp, err := w.loginWithPIN(subdomain, loginID, acct.TemporaryPin)
		require.NoError(t, err)
		_, err = w.setPINWithToken(loginResp.PinChangeToken, "778899")
		require.NoError(t, err)

		resetReq := connect.NewRequest(&rpcv1.ResetOrgAccountCredentialRequest{Id: acct.Id})
		resetReq.Header().Set("Authorization", "Bearer "+owner.Token)
		resetResp, err := w.iamClient.ResetOrgAccountCredential(context.Background(), resetReq)
		require.NoError(t, err)
		newTempPIN := resetResp.Msg.TemporaryPin

		t.Run("the old PIN is revoked and a new temporary PIN is generated", func(t *testing.T) {
			assert.Len(t, newTempPIN, 6)
			_, err := w.loginWithPIN(subdomain, loginID, "778899")
			require.Error(t, err)
		})

		t.Run("the worker must go through PIN change flow again", func(t *testing.T) {
			resp, err := w.loginWithPIN(subdomain, loginID, newTempPIN)
			require.NoError(t, err)
			assert.True(t, resp.PinChangeRequired)
			assert.NotEmpty(t, resp.PinChangeToken)
		})
	})

	// === Batch Create ===
	t.Run("when batch creating org-managed accounts", func(t *testing.T) {
		suffix := strings.ReplaceAll(dbuuid.Must().String(), "-", "")[:8]
		accounts := []*rpcv1.CreateOrgAccountRequest{
			{LoginIdentifier: "BAT1-" + suffix, DisplayName: "Batch 1", GivenName: "B", FamilyName: "One"},
			{LoginIdentifier: "BAT2-" + suffix, DisplayName: "Batch 2", GivenName: "B", FamilyName: "Two"},
			{LoginIdentifier: "BAT3-" + suffix, DisplayName: "Batch 3", GivenName: "B", FamilyName: "Three"},
		}

		batchReq := connect.NewRequest(&rpcv1.BatchCreateOrgAccountsRequest{Accounts: accounts})
		batchReq.Header().Set("Authorization", "Bearer "+owner.Token)
		resp, err := w.iamClient.BatchCreateOrgAccounts(context.Background(), batchReq)
		require.NoError(t, err)

		t.Run("all accounts are created with temporary PINs", func(t *testing.T) {
			assert.Equal(t, int32(3), resp.Msg.SuccessCount)
			assert.Equal(t, int32(0), resp.Msg.FailureCount)
			for _, r := range resp.Msg.Results {
				assert.True(t, r.Success)
				assert.Len(t, r.TemporaryPin, 6)
				assert.NotEmpty(t, r.Id)
			}
		})

		t.Run("each worker can log in independently with their temporary PIN", func(t *testing.T) {
			for _, r := range resp.Msg.Results {
				loginResp, err := w.loginWithPIN(subdomain, r.LoginIdentifier, r.TemporaryPin)
				require.NoError(t, err, "worker %s should be able to log in", r.LoginIdentifier)
				assert.True(t, loginResp.PinChangeRequired)
			}
		})

		t.Run("duplicate login identifiers in a second batch report failures", func(t *testing.T) {
			batchReq2 := connect.NewRequest(&rpcv1.BatchCreateOrgAccountsRequest{Accounts: accounts})
			batchReq2.Header().Set("Authorization", "Bearer "+owner.Token)
			resp2, err := w.iamClient.BatchCreateOrgAccounts(context.Background(), batchReq2)
			require.NoError(t, err, "batch RPC itself should not fail")
			assert.Equal(t, int32(3), resp2.Msg.FailureCount)
			for _, r := range resp2.Msg.Results {
				assert.False(t, r.Success)
				assert.NotEmpty(t, r.Error)
			}
		})
	})

	// === PIN Validation ===
	t.Run("when validating PIN complexity rules", func(t *testing.T) {
		suffix := strings.ReplaceAll(dbuuid.Must().String(), "-", "")[:8]
		loginID := "PINV-" + suffix

		acct := w.createOrgAccount(owner, loginID, "PIN Validation Worker", "Pin", "Valid")
		loginResp, err := w.loginWithPIN(subdomain, loginID, acct.TemporaryPin)
		require.NoError(t, err)
		pinChangeToken := loginResp.PinChangeToken

		t.Run("a PIN shorter than 6 digits is rejected", func(t *testing.T) {
			_, err := w.setPINWithToken(pinChangeToken, "12345")
			require.Error(t, err)
			assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
		})

		t.Run("a PIN longer than 6 digits is rejected", func(t *testing.T) {
			_, err := w.setPINWithToken(pinChangeToken, "1234567")
			require.Error(t, err)
			assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
		})

		t.Run("a non-numeric PIN is rejected", func(t *testing.T) {
			_, err := w.setPINWithToken(pinChangeToken, "abcdef")
			require.Error(t, err)
			assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
		})
	})

	// === Permission Checks ===
	t.Run("when checking permissions for org account management", func(t *testing.T) {
		emp := w.withEmployee()

		t.Run("an employee without manageOrgAccounts is denied", func(t *testing.T) {
			permReq := connect.NewRequest(&rpcv1.CreateOrgAccountRequest{
				LoginIdentifier: "PERM-denied",
				DisplayName:     "Denied",
				GivenName:       "No",
				FamilyName:      "Perm",
			})
			permReq.Header().Set("Authorization", "Bearer "+emp.Token)
			_, err := w.iamClient.CreateOrgAccount(context.Background(), permReq)
			require.Error(t, err)
			assert.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err))
		})

		t.Run("an owner with manageOrgAccounts succeeds", func(t *testing.T) {
			suffix := strings.ReplaceAll(dbuuid.Must().String(), "-", "")[:8]
			resp := w.createOrgAccount(owner, "PERM-"+suffix, "Perm Check", "Perm", "Check")
			assert.NotEmpty(t, resp.Id)
		})
	})

	// === Coexistence ===
	t.Run("when email-based users coexist with PIN-based workers", func(t *testing.T) {
		emp := w.withEmployee()

		t.Run("email user can still call authorized endpoints", func(t *testing.T) {
			profile := w.getProfile(emp)
			assert.NotNil(t, profile.User)
		})

		t.Run("both user types can call the same endpoints", func(t *testing.T) {
			suffix := strings.ReplaceAll(dbuuid.Must().String(), "-", "")[:8]
			loginID := "COEX-" + suffix
			acct := w.createOrgAccount(owner, loginID, "Coexist Worker", "Co", "Exist")

			loginResp, err := w.loginWithPIN(subdomain, loginID, acct.TemporaryPin)
			require.NoError(t, err)
			setPINResp, err := w.setPINWithToken(loginResp.PinChangeToken, "654321")
			require.NoError(t, err)

			workerReq := connect.NewRequest(&rpcv1.GetProfileRequest{})
			workerReq.Header().Set("Authorization", "Bearer "+setPINResp.AccessToken)
			_, err = w.iamClient.GetProfile(context.Background(), workerReq)
			require.NoError(t, err, "PIN-based worker should be able to call GetProfile")

			profile := w.getProfile(emp)
			assert.NotNil(t, profile.User, "email-based user should still be able to call GetProfile")
		})
	})
}
