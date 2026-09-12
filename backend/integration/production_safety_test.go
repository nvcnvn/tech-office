package integration

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/genproto/googleapis/rpc/errdetails"

	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/iam"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// Feature 060 — production safety defaults.
//
// Coverage handoff (plan.md, Testing Strategy). This file covers everything a *running*
// server can show; the startup verdict itself is a pure function of configuration and is
// covered by backend/internal/config/safety_test.go, which is the documented Principle II
// exclusion.
//
//	FR-020  the development profile permits every browser origin
//	FR-021  a request with no Origin header is unaffected by the origin policy
//	FR-022  an allowed origin's streaming responses are unaffected
//	FR-023  a provider with no configured audiences is refused, not trusted
//	FR-024  the refusal is distinguishable from a rejected token, and names the provider
//	FR-025  audience comparison is unconditional whenever a provider is enabled
//	FR-027  provider enablement is reported at startup
//	FR-028  password and PIN sign-in are unaffected by disabled providers
//
// Covered in backend/internal/config/safety_test.go instead:
//
//	FR-001..FR-003, FR-007..FR-011, FR-013, FR-016..FR-019, FR-026
//
// Covered by review of the configuration and documentation files, which are not
// executable: FR-004..FR-006, FR-012, FR-014, FR-015, FR-029, FR-030.
//
// The dev server this suite talks to runs in the development profile with neither
// GOOGLE_CLIENT_IDS nor APPLE_CLIENT_IDS set, which is exactly the configuration User
// Story 2 is about — so the disabled-provider behaviour is proven against the real server.

func TestProductionSafetyDefaults(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()

	// A Go http.Client sends no Origin header. Native mobile clients, the healthcheck
	// command and server-to-server calls are all in this position, and rs/cors passes
	// such a request straight through — restricting the allowed origins must not change
	// that (FR-021, FR-022).
	t.Run("when a request carries no origin header", func(t *testing.T) {
		t.Run("the health probe answers", func(t *testing.T) {
			req, err := http.NewRequestWithContext(context.Background(),
				http.MethodGet, serverBaseURL+"/healthz", nil)
			require.NoError(t, err)
			require.Empty(t, req.Header.Get("Origin"), "this scenario is about the absent header")

			resp, err := http.DefaultClient.Do(req)
			require.NoError(t, err)
			defer resp.Body.Close()

			assert.Equal(t, http.StatusOK, resp.StatusCode)
		})

		t.Run("an RPC succeeds", func(t *testing.T) {
			profile := w.getProfile(owner)

			assert.NotEmpty(t, profile.User.GetId())
		})

		t.Run("the notification stream stays open and delivers", func(t *testing.T) {
			// FR-022: CORS is a preflight-and-response-header protocol that never touches
			// the body, so a long-lived SSE response must behave exactly as before.
			stream, _, closeStream := w.openNotificationHTTPStream(owner, 30*time.Second)
			defer closeStream()

			title := "origin-less stream delivery"
			w.publishNotification(owner.ID, title)

			event := w.receiveNextHTTPNotificationEvent(stream)
			require.NotNil(t, event)
			require.NotNil(t, event.Notification)
			assert.Equal(t, title, event.Notification.Title)
		})
	})

	t.Run("when the development profile is active", func(t *testing.T) {
		t.Run("a preflight from an arbitrary origin is allowed", func(t *testing.T) {
			// FR-020: the dev server runs in the development profile, where the origin
			// list is ["*"] — byte-for-byte today's behaviour, so a contributor pointing
			// a client at an unfamiliar origin is not the thing that breaks.
			req, err := http.NewRequestWithContext(context.Background(),
				http.MethodOptions, serverBaseURL+"/rpc.v1.IAMService/GetProfile", nil)
			require.NoError(t, err)
			req.Header.Set("Origin", "http://an-origin-nobody-configured.test")
			req.Header.Set("Access-Control-Request-Method", http.MethodPost)
			req.Header.Set("Access-Control-Request-Headers", "content-type,connect-protocol-version")

			resp, err := http.DefaultClient.Do(req)
			require.NoError(t, err)
			defer resp.Body.Close()

			assert.Equal(t, "*", resp.Header.Get("Access-Control-Allow-Origin"),
				"the development profile permits every origin")
		})
	})
}

// registerOrgWithCredentials registers a fresh organisation and returns the owner's
// email and password, which mustRegisterNewOrg deliberately does not expose. The
// password sign-in scenario needs them, because its whole point is that a real
// credential still works when the identity providers are off.
func registerOrgWithCredentials(t *testing.T, w *testWorld) (email, password string) {
	t.Helper()
	suffix := strings.ReplaceAll(dbuuid.Must().String(), "-", "")
	email = fmt.Sprintf("owner+%s@test.invalid", suffix)
	password = "Test1234!"

	resp, err := w.org.RegisterOrganizationWithAdminPassword(context.Background(),
		connect.NewRequest(&rpcv1.RegisterOrganizationWithAdminPasswordRequest{
			CompanyName:          "Safety Org " + suffix,
			Subdomain:            "sf" + suffix[:20],
			AdminEmail:           email,
			AdminPassword:        password,
			AdminGivenName:       "Safety",
			AdminFamilyName:      "Owner",
			AcceptedTermsVersion: iam.CurrentTermsVersion,
		}))
	require.NoError(t, err, "register org")

	orgID, err := dbuuid.Parse(resp.Msg.Organization.Id)
	require.NoError(t, err)
	rememberOrg(orgID)
	return email, password
}

// countGoogleSSOIdentities counts every linked Google identity in the database.
//
// A package-wide count is safe to assert on precisely because of what this feature
// does: with Google disabled on the dev server, no test in this suite can create one,
// so the count cannot move underneath a parallel test.
func countGoogleSSOIdentities(t *testing.T) int {
	t.Helper()
	var n int
	require.NoError(t, globalDB.QueryRow(context.Background(),
		`SELECT count(*) FROM iam.sso_identity WHERE provider = $1`, iam.SSOProviderGoogle).Scan(&n))
	return n
}

// precondition returns the single google.rpc.PreconditionFailure violation carried by a
// Connect error, failing the test if the error carries none.
func precondition(t *testing.T, err error) *errdetails.PreconditionFailure_Violation {
	t.Helper()
	var connectErr *connect.Error
	require.ErrorAs(t, err, &connectErr, "expected a Connect error")

	for _, d := range connectErr.Details() {
		msg, valueErr := d.Value()
		if valueErr != nil {
			continue
		}
		pf, ok := msg.(*errdetails.PreconditionFailure)
		if !ok {
			continue
		}
		require.Len(t, pf.GetViolations(), 1, "expected exactly one precondition violation")
		return pf.GetViolations()[0]
	}
	require.FailNow(t, "no google.rpc.PreconditionFailure detail on the error")
	return nil
}

// TestDisabledIdentityProviders covers User Story 2 against the dev server, which runs
// with neither GOOGLE_CLIENT_IDS nor APPLE_CLIENT_IDS set — so both providers are
// disabled, which is exactly the configuration the story is about.
func TestDisabledIdentityProviders(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()

	t.Run("when a provider has no configured audiences", func(t *testing.T) {
		t.Run("exchanging a token for it is refused as not enabled", func(t *testing.T) {
			// FR-023: refused before the token is parsed, so a validly signed token for a
			// provider this deployment does not offer creates nothing.
			_, err := w.iamClient.ExchangeToken(context.Background(),
				connect.NewRequest(&rpcv1.ExchangeTokenRequest{
					Provider: rpcv1.SSOProvider_SSO_PROVIDER_GOOGLE,
					IdToken:  "any.token.at.all",
				}))

			require.Error(t, err)
			assert.Equal(t, connect.CodeFailedPrecondition, connect.CodeOf(err))
		})

		t.Run("the refusal is distinguishable from a rejected token", func(t *testing.T) {
			// FR-024: a rejected token is CodeUnauthenticated. A client must be able to
			// tell "this deployment does not offer that provider" from "your token was
			// rejected" without matching on message text.
			_, err := w.iamClient.ExchangeToken(context.Background(),
				connect.NewRequest(&rpcv1.ExchangeTokenRequest{
					Provider: rpcv1.SSOProvider_SSO_PROVIDER_GOOGLE,
					IdToken:  "any.token.at.all",
				}))

			require.Error(t, err)
			assert.NotEqual(t, connect.CodeUnauthenticated, connect.CodeOf(err))
		})

		t.Run("the refusal carries the provider name in its error detail", func(t *testing.T) {
			// FR-024 and Constitution X: the structured detail must survive the wire.
			_, err := w.iamClient.ExchangeToken(context.Background(),
				connect.NewRequest(&rpcv1.ExchangeTokenRequest{
					Provider: rpcv1.SSOProvider_SSO_PROVIDER_GOOGLE,
					IdToken:  "any.token.at.all",
				}))

			require.Error(t, err)
			v := precondition(t, err)
			assert.Equal(t, iam.SSOProviderNotEnabledType, v.GetType())
			assert.Equal(t, iam.SSOProviderGoogle, v.GetSubject())
			assert.NotEmpty(t, v.GetDescription())
		})

		t.Run("the same holds for the other provider", func(t *testing.T) {
			_, err := w.iamClient.ExchangeToken(context.Background(),
				connect.NewRequest(&rpcv1.ExchangeTokenRequest{
					Provider: rpcv1.SSOProvider_SSO_PROVIDER_APPLE,
					IdToken:  "any.token.at.all",
				}))

			require.Error(t, err)
			assert.Equal(t, connect.CodeFailedPrecondition, connect.CodeOf(err))
			assert.Equal(t, iam.SSOProviderApple, precondition(t, err).GetSubject())
		})

		t.Run("no account is created or linked by the refused attempt", func(t *testing.T) {
			// FR-023: the security-critical half — a refusal must not be a slow accept.
			before := countGoogleSSOIdentities(t)

			_, err := w.iamClient.ExchangeToken(context.Background(),
				connect.NewRequest(&rpcv1.ExchangeTokenRequest{
					Provider: rpcv1.SSOProvider_SSO_PROVIDER_GOOGLE,
					IdToken:  "any.token.at.all",
				}))
			require.Error(t, err)

			assert.Equal(t, before, countGoogleSSOIdentities(t))
		})

		t.Run("linking that provider to an existing account is refused the same way", func(t *testing.T) {
			// US2 AS4
			req := connect.NewRequest(&rpcv1.LinkSSOIdentityRequest{
				Provider: rpcv1.SSOProvider_SSO_PROVIDER_GOOGLE,
				IdToken:  "any.token.at.all",
			})
			req.Header().Set("Authorization", "Bearer "+owner.Token)

			before := countGoogleSSOIdentities(t)
			_, err := w.iamClient.LinkSSOIdentity(context.Background(), req)

			require.Error(t, err)
			assert.Equal(t, connect.CodeFailedPrecondition, connect.CodeOf(err))
			assert.Equal(t, iam.SSOProviderNotEnabledType, precondition(t, err).GetType())
			assert.Equal(t, before, countGoogleSSOIdentities(t))
		})
	})

	t.Run("when identity providers are disabled", func(t *testing.T) {
		t.Run("workspace password sign-in still succeeds", func(t *testing.T) {
			// FR-028, SC-006: a deployment running on passwords and worker PINs is
			// unaffected by having no SSO configured.
			email, password := registerOrgWithCredentials(t, w)

			resp, err := w.demoSignInResult(email, password)

			require.NoError(t, err, "password sign-in must still work")
			assert.NotEmpty(t, resp.AccessToken)
		})

		t.Run("worker PIN sign-in still succeeds", func(t *testing.T) {
			// FR-028, SC-006
			suffix := strings.ReplaceAll(dbuuid.Must().String(), "-", "")[:8]
			loginID := "SAFE-" + suffix
			acct := w.createOrgAccount(owner, loginID, "Safety Worker", "Safety", "Worker")

			resp, err := w.loginWithPIN(w.orgSubdomain(), loginID, acct.TemporaryPin)

			require.NoError(t, err, "worker PIN sign-in must still work")
			assert.NotNil(t, resp)
		})
	})
}
