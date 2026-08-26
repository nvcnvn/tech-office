package integration

import (
	"fmt"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/organization"
)

// TestMobileOwnerOnboarding covers the backend half of feature 035 — the three user stories
// an SMB owner walks through on a phone: create a workspace (US2), set a PIN and add a
// teammate (US3), and sign back in with six digits (US1).
//
// Traceability: FR-006, FR-007, FR-008, FR-011, FR-014, FR-015.
func TestMobileOwnerOnboarding(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)

	// uniqueCompany keeps repeated local runs from colliding on the derived address.
	uniqueCompany := func(base string) string {
		return fmt.Sprintf("%s %s", base, strings.ReplaceAll(dbuuid.Must().String(), "-", "")[:10])
	}

	t.Run("when an owner registers a workspace from a derived address", func(t *testing.T) {
		companyName := uniqueCompany("Annas Cafe")
		derived := organization.Derive(companyName)
		require.NotEmpty(t, derived, "a usable company name must derive a usable address")

		t.Run("the address is free before anyone claims it", func(t *testing.T) {
			resp := w.checkSubdomainAvailable(derived)
			assert.True(t, resp.Available)
			assert.Empty(t, resp.Suggested)
		})

		org, ownerEmail := w.registerOrganization(companyName, derived)

		t.Run("the workspace is created at that address", func(t *testing.T) {
			assert.Equal(t, derived, org.Subdomain)
			assert.Equal(t, companyName, org.CompanyName)
		})

		t.Run("a second business with the same name is offered a numbered alternative", func(t *testing.T) {
			resp := w.checkSubdomainAvailable(derived)
			assert.False(t, resp.Available, "the address is now taken")
			assert.Equal(t, organization.NextVariant(derived, 2), resp.Suggested,
				"the client should be able to offer the alternative without a second round trip")

			second, _ := w.registerOrganization(companyName, resp.Suggested)
			assert.Equal(t, organization.NextVariant(derived, 2), second.Subdomain)
		})

		t.Run("registering the taken address names the field that must change", func(t *testing.T) {
			err := w.registerOrganizationError(companyName, derived)
			require.Error(t, err)
			assert.Equal(t, connect.CodeAlreadyExists, connect.CodeOf(err),
				"a taken address is a conflict, not a raw constraint violation")
			assert.Contains(t, fieldViolations(t, err), "subdomain",
				"a six-field signup form needs to know which input to correct")
		})

		// The owner is the actor for the rest of the story.
		orgID, err := dbuuid.Parse(org.Id)
		require.NoError(t, err)
		owner := w.ownerUserOf(orgID, ownerEmail)

		t.Run("when the owner sets their first PIN", func(t *testing.T) {
			_, setErr := w.setPIN(owner, "802214", "")
			require.NoError(t, setErr)

			t.Run("they can sign back in with their email and PIN", func(t *testing.T) {
				resp, loginErr := w.loginWithPIN(derived, ownerEmail, "802214")
				require.NoError(t, loginErr)
				assert.False(t, resp.PinChangeRequired)
				assert.NotEmpty(t, resp.AccessToken)
			})
		})

		t.Run("when the owner adds their first teammate", func(t *testing.T) {
			loginID := "TEAM-" + strings.ReplaceAll(dbuuid.Must().String(), "-", "")[:8]
			acct := w.createOrgAccount(owner, loginID, "First Teammate", "First", "Teammate")

			t.Run("a one-time PIN is issued for the teammate to use", func(t *testing.T) {
				assert.Len(t, acct.TemporaryPin, 6)
				assert.Equal(t, loginID, acct.LoginIdentifier)
			})

			t.Run("the teammate signs in with that code and must choose their own PIN", func(t *testing.T) {
				resp, loginErr := w.loginWithPIN(derived, loginID, acct.TemporaryPin)
				require.NoError(t, loginErr)
				assert.True(t, resp.PinChangeRequired)
				assert.NotEmpty(t, resp.PinChangeToken)
			})
		})
	})

	t.Run("when a malformed workspace address is submitted", func(t *testing.T) {
		malformed := map[string]string{
			"too short":       "ab",
			"leading hyphen":  "-acme",
			"trailing hyphen": "acme-",
			"double hyphen":   "ac--me",
			"underscore":      "ac_me",
			"reserved word":   "admin",
		}

		for name, candidate := range malformed {
			t.Run(name+" is rejected by the availability check", func(t *testing.T) {
				err := w.checkSubdomainAvailableError(candidate)
				require.Error(t, err)
				assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
				assert.Contains(t, fieldViolations(t, err), "subdomain")
			})

			t.Run(name+" is rejected at registration", func(t *testing.T) {
				err := w.registerOrganizationError(uniqueCompany("Malformed"), candidate)
				require.Error(t, err)
				assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
				assert.Contains(t, fieldViolations(t, err), "subdomain")
			})
		}
	})

	t.Run("when the availability check runs before an account exists", func(t *testing.T) {
		t.Run("it needs no authentication", func(t *testing.T) {
			// No Authorization header is set anywhere in checkSubdomainAvailable.
			resp := w.checkSubdomainAvailable("to" + strings.ReplaceAll(dbuuid.Must().String(), "-", "")[:20])
			assert.True(t, resp.Available)
		})
	})
}
