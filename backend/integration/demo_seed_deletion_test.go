package integration

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/iam"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// TestDemoSeedAccountDeletion is the whole reason feature 055 exists: a store
// reviewer is told to delete an account, and must be able to finish.
//
// Before the spare owner existed, the demo workspace held exactly one
// self-registered account, it was the sole owner of a populated workspace, and
// the sole-owner guard refused the deletion — correctly. The guard is untouched
// here. What changed is the fixture: two owners means neither is sole, so either
// deletion is accepted and the workspace survives it.
func TestDemoSeedAccountDeletion(t *testing.T) {
	if testing.Short() {
		t.Skip("seeding builds a whole workspace; skipped in short mode")
	}
	t.Parallel()

	subdomain := "seeddel" + strings.ReplaceAll(dbuuid.Must().String(), "-", "")[:20]
	backendDir := findBackendDir(t)
	const password = "ReviewDemo1!"

	seed := func() {
		t.Helper()
		cmd := exec.Command("go", "run", "./cmd", "seed-demo-org", "--subdomain", subdomain)
		cmd.Dir = backendDir
		cmd.Env = os.Environ()
		out, err := cmd.CombinedOutput()
		require.NoError(t, err, "seed-demo-org failed: %s", out)
	}
	seed()

	w := newTestWorld(t)
	orgID := demoOrgID(t, subdomain)
	rememberOrg(orgID)
	spareEmail := fmt.Sprintf("spare@%s.demo.invalid", subdomain)
	ownerEmail := fmt.Sprintf("owner@%s.demo.invalid", subdomain)

	// A real sign-in rather than a minted token, because the credential working at
	// all is half of what a reviewer is checking, and because it is what puts a
	// session row in the database for the invalidation assertion below.
	spare := w.demoSignIn(t, orgID, spareEmail, password)

	t.Run("when the nominated spare owner requests deletion of their own account", func(t *testing.T) {
		preview := w.getAccountDeletionPreview(spare)

		t.Run("the deletion preview names no blocking workspace", func(t *testing.T) { // FR-004
			assert.False(t, preview.Blocked)
			require.Len(t, preview.Organizations, 1)
			assert.False(t, preview.Organizations[0].BlocksDeletion,
				"a reviewer who is refused at the preview never reaches the confirmation screen")
		})

		resp, err := w.deleteMyAccountResult(spare, iam.DeletionConfirmationPhrase)

		t.Run("the request is accepted rather than refused as sole owner", func(t *testing.T) { // FR-004
			require.NoError(t, err)
			assert.NotEmpty(t, resp.DeletionId)
		})

		t.Run("their sessions are invalidated", func(t *testing.T) {
			assert.Eventually(t, func() bool {
				return countRows(t, `SELECT COUNT(*) FROM iam.session WHERE user_id = $1`, spare.ID) == 0
			}, eraseBudget, 250*time.Millisecond, "the signed-in device must not keep working")
		})
	})

	t.Run("after the spare owner has been deleted", func(t *testing.T) {
		t.Run("the primary owner credential still signs in", func(t *testing.T) { // FR-005
			_, err := w.demoSignInResult(ownerEmail, password)
			assert.NoError(t, err, "the credential a reviewer is told to keep must survive the deletion")
		})

		t.Run("the worker PIN still signs in", func(t *testing.T) { // FR-005
			resp, err := w.loginWithPIN(subdomain, "demo-worker", "473829")
			require.NoError(t, err)
			assert.NotEmpty(t, resp.AccessToken)
		})

		t.Run("the workspace still has at least one owner", func(t *testing.T) { // FR-005
			assert.Positive(t, countRows(t,
				`SELECT COUNT(*)
				 FROM iam.employee_role er
				 JOIN iam.role r ON (r.organization_id, r.id) = (er.organization_id, er.role_id)
				 JOIN organization.employee e ON (e.organization_id, e.id) = (er.organization_id, er.employee_id)
				 WHERE er.organization_id = $1 AND r.source_default_role_id = 'owner' AND e.is_active`, orgID))
		})

		t.Run("the conversation, the work items and the instances are all still there", func(t *testing.T) { // FR-005
			// Workplace content belongs to the organization, not to the person who
			// left, so a deletion de-identifies rather than erases it.
			assert.Equal(t, 6, countRows(t,
				`SELECT COUNT(*) FROM chat.message WHERE organization_id = $1`, orgID))
			assert.Equal(t, 6, countRows(t, countDemoStandardTasks, subdomain))
			assert.Equal(t, 2, countRows(t, countDemoRitualInstances, subdomain))
		})
	})

	t.Run("when the admin-provisioned worker asks to end their account", func(t *testing.T) { // FR-007
		var workerID dbuuid.UUID
		require.NoError(t, globalDB.QueryRow(context.Background(),
			`SELECT id FROM iam.identity WHERE organization_id = $1 AND login_identifier = 'demo-worker'`, orgID,
		).Scan(&workerID))
		worker := testUser{ID: workerID, OrgID: orgID, Token: demoToken(t, workerID, orgID)}

		t.Run("they are offered the removal-request path rather than deletion", func(t *testing.T) {
			// Unchanged by this feature, and asserted here so the demo keeps
			// showing both account-ending paths rather than only one.
			path := w.getAccountRemovalPath(worker)
			assert.Equal(t, rpcv1.AccountRemovalPath_ACCOUNT_REMOVAL_PATH_REQUEST_REMOVAL, path.Path)
		})
	})

	t.Run("when the seed runs again after the deletion", func(t *testing.T) { // FR-006
		// The erase is a background job; the spare's iam.user has to be gone
		// before a fresh account can take the same email, or the seed would find
		// a half-erased one.
		require.Eventually(t, func() bool {
			return countRows(t, `SELECT COUNT(*) FROM iam.identity WHERE id = $1`, spare.ID) == 0
		}, eraseBudget, 250*time.Millisecond, "the erase must finish before a re-seed is meaningful")
		seed()

		var reseeded testUser
		t.Run("the spare owner credential signs in once more", func(t *testing.T) {
			reseeded = w.demoSignIn(t, orgID, spareEmail, password)
			assert.NotEqual(t, spare.ID, reseeded.ID,
				"the anonymised tombstone stays de-identified; the seed creates a fresh account")
		})

		t.Run("the deletion can be performed a second time", func(t *testing.T) {
			// A demonstration that works once is a demonstration nobody can
			// rehearse before submitting.
			_, err := w.deleteMyAccountResult(reseeded, iam.DeletionConfirmationPhrase)
			assert.NoError(t, err)
		})
	})

	t.Run("when the second owner then tries to delete too", func(t *testing.T) {
		// The spec's edge case: having demonstrated the deletion, a curious
		// reviewer tries the other account. The guard is correct and refuses, and
		// this feature does not weaken it.
		primary := w.demoSignIn(t, orgID, ownerEmail, password)

		t.Run("the sole-owner guard refuses, unchanged by this feature", func(t *testing.T) {
			require.Eventually(t, func() bool {
				return countRows(t,
					`SELECT COUNT(*)
					 FROM iam.employee_role er
					 JOIN iam.role r ON (r.organization_id, r.id) = (er.organization_id, er.role_id)
					 JOIN organization.employee e ON (e.organization_id, e.id) = (er.organization_id, er.employee_id)
					 WHERE er.organization_id = $1 AND r.source_default_role_id = 'owner' AND e.is_active`,
					orgID) == 1
			}, eraseBudget, 250*time.Millisecond, "the second deletion must finish before the last owner is alone")

			_, err := w.deleteMyAccountResult(primary, iam.DeletionConfirmationPhrase)
			require.Error(t, err)
			assert.Equal(t, connect.CodeFailedPrecondition, connect.CodeOf(err))
		})
	})

}

// demoSignInResult signs in with an email and password the way the app does.
func (w *testWorld) demoSignInResult(email, password string) (*rpcv1.LoginResponse, error) {
	w.t.Helper()
	resp, err := w.iamClient.Login(context.Background(), connect.NewRequest(&rpcv1.LoginRequest{
		Email:    email,
		Password: password,
	}))
	if err != nil {
		return nil, err
	}
	return resp.Msg, nil
}

func (w *testWorld) demoSignIn(t *testing.T, orgID dbuuid.UUID, email, password string) testUser {
	t.Helper()
	resp, err := w.demoSignInResult(email, password)
	require.NoError(t, err, "sign in as %s", email)
	id, err := dbuuid.Parse(resp.User.Id)
	require.NoError(t, err)
	return testUser{ID: id, OrgID: orgID, Token: resp.AccessToken}
}
