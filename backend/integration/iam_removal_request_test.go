package integration

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nvcnvn/tech-office/backend/internal/notification"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// TestRemovalRequest covers the path an admin-provisioned worker gets instead of
// self-deletion.
//
// The in-app request is the whole point: telling such a worker to "contact your
// administrator" and stopping there reads as the off-app deletion path both stores
// reject. What makes this compliant is that the request is made in the app and
// reaches an owner who can act on it.
func TestRemovalRequest(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	owner := w.withOwner()
	worker := w.withOrgManagedWorker(owner)

	t.Run("when a provisioned worker opens their deletion path", func(t *testing.T) {
		path := w.getAccountRemovalPath(worker)

		t.Run("it reports the request-removal path, not self-delete", func(t *testing.T) { // FR-001a, FR-007b
			assert.Equal(t, rpcv1.AccountRemovalPath_ACCOUNT_REMOVAL_PATH_REQUEST_REMOVAL, path.Path)
		})

		t.Run("it names their managing organization", func(t *testing.T) { // FR-007b
			assert.NotEmpty(t, path.ManagingOrganizationName)
		})
	})

	t.Run("when a provisioned worker requests removal", func(t *testing.T) {
		resp := w.requestAccountRemoval(worker, "I have left the company.")

		t.Run("the request is recorded as outstanding", func(t *testing.T) { // FR-007c
			require.NotNil(t, resp.Request)
			assert.Equal(t, rpcv1.RemovalRequestStatus_REMOVAL_REQUEST_STATUS_OUTSTANDING, resp.Request.Status)
			assert.False(t, resp.AlreadyOutstanding)
		})

		t.Run("the workspace owners are notified", func(t *testing.T) { // FR-007c
			assert.Eventually(t, func() bool {
				return w.countNotificationsOfType(t, owner.ID, notification.NotificationTypeAccountRemovalRequested) > 0
			}, 5*time.Second, 100*time.Millisecond,
				"an owner must hear about the request, otherwise it is an off-app dead end")
		})

		t.Run("the worker can see their own request is outstanding", func(t *testing.T) { // FR-007d
			path := w.getAccountRemovalPath(worker)
			require.NotNil(t, path.LatestRequest)
			assert.Equal(t, rpcv1.RemovalRequestStatus_REMOVAL_REQUEST_STATUS_OUTSTANDING, path.LatestRequest.Status)
		})
	})

	t.Run("when the same worker requests removal again", func(t *testing.T) {
		t.Run("it returns the existing request rather than a duplicate", func(t *testing.T) { // FR-007c
			// A second tap on a small screen is a person checking, not asking twice.
			again := w.requestAccountRemoval(worker, "Still waiting.")
			assert.True(t, again.AlreadyOutstanding)

			list, err := w.listRemovalRequestsResult(owner, rpcv1.RemovalRequestStatus_REMOVAL_REQUEST_STATUS_OUTSTANDING)
			require.NoError(t, err)
			assert.Len(t, list.Requests, 1)
		})
	})

	t.Run("when a non-owner tries to list removal requests", func(t *testing.T) {
		employee := w.withEmployee()

		t.Run("it returns permission denied", func(t *testing.T) { // FR-007d
			_, err := w.listRemovalRequestsResult(employee, rpcv1.RemovalRequestStatus_REMOVAL_REQUEST_STATUS_UNSPECIFIED)
			require.Error(t, err)
			assert.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err))
		})
	})

	t.Run("when a self-registered person calls request removal", func(t *testing.T) {
		t.Run("it is refused", func(t *testing.T) { // FR-007a
			// They delete their own account; making that depend on somebody else
			// agreeing would be the wrong path entirely.
			_, err := w.requestAccountRemovalResult(owner, "")
			require.Error(t, err)
			assert.Equal(t, connect.CodeFailedPrecondition, connect.CodeOf(err))
		})
	})

	t.Run("when an owner declines a removal request", func(t *testing.T) {
		declineOwner := w.withOwner()
		declineWorker := w.withOrgManagedWorker(declineOwner)
		filed := w.requestAccountRemoval(declineWorker, "")

		decided, err := w.decideRemovalRequestResult(declineOwner, filed.Request.Id,
			rpcv1.RemovalRequestStatus_REMOVAL_REQUEST_STATUS_DECLINED)
		require.NoError(t, err)

		t.Run("the membership is unchanged", func(t *testing.T) { // FR-007d
			assert.False(t, decided.GlobalPurgeEnqueued)
			var active bool
			err := globalDB.QueryRow(context.Background(),
				`SELECT is_active FROM organization.employee WHERE organization_id = $1 AND id = $2`,
				declineWorker.OrgID, declineWorker.ID).Scan(&active)
			require.NoError(t, err)
			assert.True(t, active, "declining must not offboard anyone")
		})

		t.Run("the worker can see the decision", func(t *testing.T) { // FR-007d
			path := w.getAccountRemovalPath(declineWorker)
			require.NotNil(t, path.LatestRequest)
			assert.Equal(t, rpcv1.RemovalRequestStatus_REMOVAL_REQUEST_STATUS_DECLINED, path.LatestRequest.Status)
		})

		t.Run("deciding it again is rejected", func(t *testing.T) { // FR-007d
			_, err := w.decideRemovalRequestResult(declineOwner, filed.Request.Id,
				rpcv1.RemovalRequestStatus_REMOVAL_REQUEST_STATUS_GRANTED)
			require.Error(t, err)
			assert.Equal(t, connect.CodeFailedPrecondition, connect.CodeOf(err))
		})
	})

	t.Run("when an owner grants a removal request", func(t *testing.T) {
		grantOwner := w.withOwner()
		grantWorker := w.withOrgManagedWorker(grantOwner)
		filed := w.requestAccountRemoval(grantWorker, "")

		decided, err := w.decideRemovalRequestResult(grantOwner, filed.Request.Id,
			rpcv1.RemovalRequestStatus_REMOVAL_REQUEST_STATUS_GRANTED)
		require.NoError(t, err)
		assert.True(t, decided.GlobalPurgeEnqueued, "granting queues the erase")

		t.Run("their employee record is de-identified but retained", func(t *testing.T) { // FR-006, FR-007a
			// The row survives because the workspace's messages, tasks and files
			// still point at it. What goes is everything that identifies a person.
			assertEventuallyAnonymised(t, grantWorker.OrgID, grantWorker.ID)
		})

		t.Run("the worker's membership ends", func(t *testing.T) { // FR-007e
			assert.Eventually(t, func() bool {
				var count int
				if err := globalDB.QueryRow(context.Background(),
					`SELECT COUNT(*) FROM iam.identity WHERE organization_id = $1 AND id = $2`,
					grantWorker.OrgID, grantWorker.ID).Scan(&count); err != nil {
					return false
				}
				return count == 0
			}, eraseBudget, 250*time.Millisecond)
		})

		t.Run("that was their last membership, so their global identity data is deleted", func(t *testing.T) { // FR-007e
			assert.Eventually(t, func() bool {
				var count int
				if err := globalDB.QueryRow(context.Background(),
					`SELECT COUNT(*) FROM iam.user WHERE id = $1`, grantWorker.ID).Scan(&count); err != nil {
					return false
				}
				return count == 0
			}, eraseBudget, 250*time.Millisecond)
		})
	})

	t.Run("when an owner offboards a worker with a request outstanding", func(t *testing.T) {
		offOwner := w.withOwner()
		offWorker := w.withOrgManagedWorker(offOwner)
		w.requestAccountRemoval(offWorker, "")

		req := connect.NewRequest(&rpcv1.DeactivateOrgAccountRequest{Id: offWorker.ID.String()})
		req.Header().Set("Authorization", "Bearer "+offOwner.Token)
		_, err := w.iamClient.DeactivateOrgAccount(context.Background(), req)
		require.NoError(t, err)

		t.Run("the outstanding request does not linger", func(t *testing.T) { // edge case
			// Offboarding the ordinary way already did what the request asked for.
			// Leaving it open would put a permanent unactionable item in the queue.
			list, err := w.listRemovalRequestsResult(offOwner, rpcv1.RemovalRequestStatus_REMOVAL_REQUEST_STATUS_OUTSTANDING)
			require.NoError(t, err)
			assert.Empty(t, list.Requests)
		})
	})
}

// assertEventuallyAnonymised waits for the background erase to strip the employee
// row, then checks that nothing identifying survives.
func assertEventuallyAnonymised(t *testing.T, orgID, employeeID interface{ String() string }) {
	t.Helper()
	var givenName, familyName, email string
	var isActive bool
	var phone, address *string

	assert.Eventually(t, func() bool {
		err := globalDB.QueryRow(context.Background(),
			`SELECT given_name, family_name, email, is_active, phone_number, home_address
			 FROM organization.employee WHERE organization_id = $1 AND id = $2`,
			orgID, employeeID,
		).Scan(&givenName, &familyName, &email, &isActive, &phone, &address)
		return err == nil && !isActive && givenName == "Deleted"
	}, eraseBudget, 250*time.Millisecond, "the employee record should be anonymised")

	assert.Equal(t, "Deleted", givenName)
	assert.Equal(t, "user", familyName)
	assert.Empty(t, email)
	assert.False(t, isActive)
	assert.Nil(t, phone)
	assert.Nil(t, address)
}
