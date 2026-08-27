package integration

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/iam"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// TestTermsAcceptance covers the requirement that nobody uses the product without
// having agreed to its terms — including admin-provisioned workers, who never see
// a signup screen and so have to be gated at first use instead.
func TestTermsAcceptance(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)

	t.Run("when a person signs up without accepting the terms", func(t *testing.T) {
		t.Run("it is rejected", func(t *testing.T) { // FR-010
			suffix := strings.ReplaceAll(dbuuid.Must().String(), "-", "")
			_, err := w.org.RegisterOrganizationWithAdminPassword(context.Background(),
				connect.NewRequest(&rpcv1.RegisterOrganizationWithAdminPasswordRequest{
					CompanyName:     "No Terms Ltd",
					Subdomain:       fmt.Sprintf("nt%s", suffix[:20]),
					AdminEmail:      fmt.Sprintf("noterms+%s@test.invalid", suffix),
					AdminPassword:   "Test1234!",
					AdminGivenName:  "No",
					AdminFamilyName: "Terms",
					// AcceptedTermsVersion deliberately omitted.
				}))
			require.Error(t, err)
			assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
		})
	})

	t.Run("when a person signs up accepting the terms", func(t *testing.T) {
		owner := w.withOwner()

		t.Run("the accepted version and time are recorded", func(t *testing.T) { // FR-011
			status := w.getTermsStatus(owner)
			assert.Equal(t, iam.CurrentTermsVersion, status.CurrentVersion)
			assert.Equal(t, iam.CurrentTermsVersion, status.AcceptedVersion)
			assert.True(t, status.IsCurrent)
			assert.NotNil(t, status.AcceptedAt)
		})
	})

	t.Run("when a person accepts a version that is not current", func(t *testing.T) {
		owner := w.withOwner()

		t.Run("it is rejected", func(t *testing.T) { // FR-011
			// A stale client must not be able to record acceptance of terms nobody
			// is serving.
			_, err := w.acceptTermsResult(owner, "1999-01-01")
			require.Error(t, err)
			assert.Equal(t, connect.CodeFailedPrecondition, connect.CodeOf(err))
		})
	})

	t.Run("when an admin-provisioned worker first signs in", func(t *testing.T) {
		owner := w.withOwner()
		worker := w.withOrgManagedWorker(owner)

		t.Run("terms status reports they have not accepted", func(t *testing.T) { // FR-012
			// Nobody showed this person a signup screen, so gating first use on this
			// is the only way acceptance can hold for them.
			status := w.getTermsStatus(worker)
			assert.False(t, status.IsCurrent)
			assert.Empty(t, status.AcceptedVersion)
		})

		t.Run("after accepting, the version and time are recorded", func(t *testing.T) { // FR-012
			resp, err := w.acceptTermsResult(worker, iam.CurrentTermsVersion)
			require.NoError(t, err)
			assert.NotNil(t, resp.AcceptedAt)

			status := w.getTermsStatus(worker)
			assert.True(t, status.IsCurrent)
			assert.Equal(t, iam.CurrentTermsVersion, status.AcceptedVersion)
		})
	})

	t.Run("when the current terms version is bumped", func(t *testing.T) {
		owner := w.withOwner()

		t.Run("a previously accepting person reports as not current", func(t *testing.T) { // FR-011
			// Bumping the constant is the re-prompt trigger. The test simulates the
			// bump by writing an older version to the stored value, which is exactly
			// the state everyone would be in the moment the constant changes.
			_, err := globalDB.Exec(context.Background(),
				`UPDATE iam.user SET terms_version_accepted = '2020-01-01' WHERE id = $1`, owner.ID)
			require.NoError(t, err)

			status := w.getTermsStatus(owner)
			assert.False(t, status.IsCurrent)
			assert.Equal(t, "2020-01-01", status.AcceptedVersion)
			assert.Equal(t, iam.CurrentTermsVersion, status.CurrentVersion)
		})
	})
}
