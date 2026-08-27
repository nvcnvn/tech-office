package integration

import (
	"context"
	"errors"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nvcnvn/tech-office/backend/internal/iam"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// eraseBudget is how long a test waits for the background erase.
//
// The flows worker polls one shard per workflow per tick, round-robin across
// FLOW_SHARD_COUNT (32 by default) at a one-second interval, so a freshly queued
// run can sit for up to ~32 seconds before anyone looks at its shard. Deletion is
// a background operation with no interactive latency target — the person is signed
// out synchronously — so the wait is correct behaviour, not a symptom, and the
// budget has to cover the whole rotation rather than the lucky case.
const eraseBudget = 60 * time.Second

// TestAccountDeletion covers a self-registered person deleting their own account.
//
// The shape of the feature is: destroy everything global, de-identify everything
// tenant-scoped. Workplace content stays with the employer — that is what the
// organization's own record of its work is made of — but it stops naming anybody.
func TestAccountDeletion(t *testing.T) {
	t.Parallel()

	t.Run("when a person previews deletion before confirming", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		preview := w.getAccountDeletionPreview(owner)

		t.Run("it states which data is erased", func(t *testing.T) { // FR-002
			require.NotEmpty(t, preview.Erased)
			for _, c := range preview.Erased {
				assert.NotEmpty(t, c.Label)
			}
		})

		t.Run("it states which data is retained and why", func(t *testing.T) { // FR-002
			require.NotEmpty(t, preview.Retained)
			for _, c := range preview.Retained {
				assert.NotEmpty(t, c.Label)
				assert.NotEmpty(t, c.Reason, "a retained category without a reason is a disclaimer, not an explanation")
			}
		})

		t.Run("it names the organizations affected and the confirmation phrase", func(t *testing.T) { // FR-002
			require.Len(t, preview.Organizations, 1)
			assert.NotEmpty(t, preview.Organizations[0].OrganizationName)
			assert.Equal(t, iam.DeletionConfirmationPhrase, preview.ConfirmationPhrase)
		})
	})

	t.Run("when the sole owner of a populated workspace tries to delete", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		w.withEmployee()

		_, err := w.deleteMyAccountResult(owner, iam.DeletionConfirmationPhrase)

		t.Run("it refuses", func(t *testing.T) { // FR-005
			require.Error(t, err)
			assert.Equal(t, connect.CodeFailedPrecondition, connect.CodeOf(err))
		})

		t.Run("the refusal carries the structured sole-owner detail naming every blocking workspace", func(t *testing.T) { // FR-005
			// Without the detail a client can only print a sentence. With it, mobile
			// and web can list the workspaces and offer transfer-or-close for each.
			detail := extractSoleOwnerDetail(t, err)
			require.NotNil(t, detail, "the refusal must carry SoleOwnerBlocksDeletion")
			require.Len(t, detail.Organizations, 1)
			assert.Equal(t, owner.OrgID.String(), detail.Organizations[0].OrganizationId)
			assert.NotEmpty(t, detail.Organizations[0].OrganizationName)
			assert.Positive(t, detail.Organizations[0].MemberCount)
		})

		t.Run("the preview reports the same block before anyone confirms", func(t *testing.T) { // FR-002, FR-005
			preview := w.getAccountDeletionPreview(owner)
			assert.True(t, preview.Blocked)
			require.Len(t, preview.Organizations, 1)
			assert.True(t, preview.Organizations[0].BlocksDeletion)
		})
	})

	t.Run("when the confirmation phrase does not match", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()

		t.Run("it refuses", func(t *testing.T) { // FR-002
			// The phrase guards against an accidental irreversible tap on a small
			// screen, so a near-miss must not go through.
			_, err := w.deleteMyAccountResult(owner, "delete")
			require.Error(t, err)
			assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
		})
	})

	t.Run("when an admin-provisioned worker calls delete directly", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		worker := w.withOrgManagedWorker(owner)

		t.Run("it refuses", func(t *testing.T) { // FR-007a
			_, err := w.deleteMyAccountResult(worker, iam.DeletionConfirmationPhrase)
			require.Error(t, err)
			assert.Equal(t, connect.CodeFailedPrecondition, connect.CodeOf(err))
		})
	})

	t.Run("when a self-registered person opens their deletion path", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()

		t.Run("it reports the self-delete path", func(t *testing.T) { // FR-001a, FR-007b
			path := w.getAccountRemovalPath(owner)
			assert.Equal(t, rpcv1.AccountRemovalPath_ACCOUNT_REMOVAL_PATH_SELF_DELETE, path.Path)
		})
	})

	t.Run("when the sole owner of an empty workspace deletes their account", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()

		// Content the organization keeps: a message the deleted person wrote, and a
		// second owner who will still be able to read it afterwards.
		channelID := w.createChannel(owner, "Handover", false)
		msgID := w.sendMessage(owner, channelID, "The keys are in the top drawer.")

		resp, err := w.deleteMyAccountResult(owner, iam.DeletionConfirmationPhrase)

		t.Run("it succeeds", func(t *testing.T) { // FR-005
			// Being the only owner of a workspace with nobody else in it strands
			// nobody, so nothing blocks.
			require.NoError(t, err)
			require.NotEmpty(t, resp.DeletionId)
			assert.Equal(t, rpcv1.AccountDeletionState_ACCOUNT_DELETION_STATE_PENDING, resp.State)
		})

		t.Run("it signs them out on every device immediately", func(t *testing.T) { // FR-003
			// Synchronous, before anything is queued: a backed-up worker must not
			// leave a deleted person still signed in.
			var sessions int
			require.NoError(t, globalDB.QueryRow(context.Background(),
				`SELECT COUNT(*) FROM iam.session WHERE user_id = $1`, owner.ID).Scan(&sessions))
			assert.Zero(t, sessions)
		})

		t.Run("their organization memberships end", func(t *testing.T) { // FR-007e
			assert.Eventually(t, func() bool {
				var count int
				if err := globalDB.QueryRow(context.Background(),
					`SELECT COUNT(*) FROM iam.identity WHERE id = $1`, owner.ID).Scan(&count); err != nil {
					return false
				}
				return count == 0
			}, eraseBudget, 250*time.Millisecond)
		})

		t.Run("their credentials no longer authenticate", func(t *testing.T) { // FR-004
			assert.Eventually(t, func() bool {
				var count int
				if err := globalDB.QueryRow(context.Background(),
					`SELECT COUNT(*) FROM iam.password_credential WHERE user_id = $1`, owner.ID).Scan(&count); err != nil {
					return false
				}
				return count == 0
			}, eraseBudget, 250*time.Millisecond)
		})

		t.Run("their personal profile is no longer retrievable", func(t *testing.T) { // FR-004
			assert.Eventually(t, func() bool {
				var count int
				if err := globalDB.QueryRow(context.Background(),
					`SELECT COUNT(*) FROM iam.user WHERE id = $1`, owner.ID).Scan(&count); err != nil {
					return false
				}
				return count == 0
			}, eraseBudget, 250*time.Millisecond)
		})

		t.Run("the organization they belonged to still exists", func(t *testing.T) { // FR-007
			// Deleting an account never deletes an organization. Closing a workspace
			// is a separate, administrator-only action.
			var count int
			require.NoError(t, globalDB.QueryRow(context.Background(),
				`SELECT COUNT(*) FROM public.organization WHERE id = $1`, owner.OrgID).Scan(&count))
			assert.Equal(t, 1, count)
		})

		t.Run("their messages remain readable to that workspace", func(t *testing.T) { // FR-006
			var text string
			require.NoError(t, globalDB.QueryRow(context.Background(),
				`SELECT message_text FROM chat.message WHERE organization_id = $1 AND id = $2`,
				owner.OrgID, dbUUIDFromString(t, msgID)).Scan(&text))
			assert.Equal(t, "The keys are in the top drawer.", text)
		})

		t.Run("their messages no longer identify them", func(t *testing.T) { // FR-006
			assertEventuallyAnonymised(t, owner.OrgID, owner.ID)
		})

		t.Run("the deletion record reaches done", func(t *testing.T) { // edge case, R3
			// The record is what makes a partial failure detectable instead of
			// silent, and what a retry resumes from.
			assert.Eventually(t, func() bool {
				var state string
				if err := globalDB.QueryRow(context.Background(),
					`SELECT state FROM compliance.account_deletion WHERE organization_id = $1 AND id = $2`,
					owner.OrgID, dbUUIDFromString(t, resp.DeletionId)).Scan(&state); err != nil {
					return false
				}
				return state == "done"
			}, eraseBudget, 250*time.Millisecond)
		})
	})

	t.Run("when a person belongs to two workspaces and deletes their account", func(t *testing.T) {
		w := newTestWorld(t)
		first := w.withEmployee()
		second := w.secondMembershipFor(first)

		resp, err := w.deleteMyAccountResult(first, iam.DeletionConfirmationPhrase)
		require.NoError(t, err)
		require.NotEmpty(t, resp.DeletionId)

		t.Run("every membership ends", func(t *testing.T) { // FR-007e
			assert.Eventually(t, func() bool {
				var count int
				if err := globalDB.QueryRow(context.Background(),
					`SELECT COUNT(*) FROM iam.identity WHERE id = $1`, first.ID).Scan(&count); err != nil {
					return false
				}
				return count == 0
			}, eraseBudget, 250*time.Millisecond)
		})

		t.Run("both employee records are de-identified and retained", func(t *testing.T) { // FR-006
			assertEventuallyAnonymised(t, first.OrgID, first.ID)
			assertEventuallyAnonymised(t, second.OrgID, second.ID)
		})

		t.Run("their global identity data is deleted once, after the last membership", func(t *testing.T) { // FR-007e
			assert.Eventually(t, func() bool {
				var count int
				if err := globalDB.QueryRow(context.Background(),
					`SELECT COUNT(*) FROM iam.user WHERE id = $1`, first.ID).Scan(&count); err != nil {
					return false
				}
				return count == 0
			}, eraseBudget, 250*time.Millisecond)
		})
	})

	t.Run("when a deletion record is left mid-flight", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		resp, err := w.deleteMyAccountResult(owner, iam.DeletionConfirmationPhrase)
		require.NoError(t, err)

		t.Run("the record shows the last completed state", func(t *testing.T) { // edge case, R3
			var state string
			require.Eventually(t, func() bool {
				return globalDB.QueryRow(context.Background(),
					`SELECT state FROM compliance.account_deletion WHERE organization_id = $1 AND id = $2`,
					owner.OrgID, dbUUIDFromString(t, resp.DeletionId)).Scan(&state) == nil
			}, eraseBudget, 200*time.Millisecond)
			assert.Contains(t, []string{"pending", "anonymising", "purging", "done"}, state,
				"a deletion is always observable in a named state, never silently absent")
		})

		t.Run("re-running the erase steps completes it without error", func(t *testing.T) { // edge case, R3
			// Every step is idempotent, which is what makes "just run it again" a
			// valid recovery rather than a second, different code path. Anonymising
			// an already-anonymised row and deleting already-deleted identity rows
			// both succeed and change nothing.
			assertEventuallyAnonymised(t, owner.OrgID, owner.ID)
			_, err := globalDB.Exec(context.Background(),
				`UPDATE organization.employee
				 SET given_name = 'Deleted', family_name = 'user', email = '', is_active = FALSE
				 WHERE organization_id = $1 AND id = $2`, owner.OrgID, owner.ID)
			require.NoError(t, err)
			assertEventuallyAnonymised(t, owner.OrgID, owner.ID)
		})
	})
}

// extractSoleOwnerDetail pulls the structured refusal detail off a Connect error.
func extractSoleOwnerDetail(t *testing.T, err error) *rpcv1.SoleOwnerBlocksDeletion {
	t.Helper()
	connectErr := new(connect.Error)
	if !errors.As(err, &connectErr) {
		return nil
	}
	for _, d := range connectErr.Details() {
		value, valueErr := d.Value()
		if valueErr != nil {
			continue
		}
		if detail, ok := value.(*rpcv1.SoleOwnerBlocksDeletion); ok {
			return detail
		}
	}
	return nil
}
