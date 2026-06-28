package integration

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// TestNotificationDocumentCoverage validates that document-driven notifications
// carry the correct policy_key, source_category, and navigation_target fields
// and respect follower eligibility.
func TestNotificationDocumentCoverage(t *testing.T) {

	t.Run("when a document is updated by a non-follower", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		emps := w.withEmployees(3)
		alice, bob, charlie := emps[0], emps[1], emps[2]

		docID := w.createDocument(owner, "Coverage Doc Update", `{"type":"doc","content":[]}`)
		w.setDocumentAccess(owner, docID, alice.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)
		w.setDocumentAccess(owner, docID, bob.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)
		w.setDocumentAccess(owner, docID, charlie.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_WRITE_UPDATE)

		w.followDocument(alice, docID)
		w.followDocument(bob, docID)
		time.Sleep(200 * time.Millisecond)

		beforeAlice := w.listNotifications(alice, false)
		beforeBob := w.listNotifications(bob, false)
		beforeCharlie := w.listNotifications(charlie, false)

		w.updateDocument(charlie, docID, `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Coverage test"}]}]}`)
		time.Sleep(300 * time.Millisecond)

		afterAlice := w.listNotifications(alice, false)
		afterBob := w.listNotifications(bob, false)
		afterCharlie := w.listNotifications(charlie, false)

		t.Run("follower alice receives doc_updated notification", func(t *testing.T) {
			assert.Greater(t, len(afterAlice), len(beforeAlice), "alice should receive notification")
		})

		t.Run("follower bob receives doc_updated notification", func(t *testing.T) {
			assert.Greater(t, len(afterBob), len(beforeBob), "bob should receive notification")
		})

		t.Run("actor charlie does NOT receive own notification", func(t *testing.T) {
			assert.Equal(t, len(beforeCharlie), len(afterCharlie), "charlie should not get own notification")
		})

		t.Run("alice notification carries policy_key=document_update", func(t *testing.T) {
			all := w.listNotifications(alice, false)
			if len(all) > len(beforeAlice) {
				newest := all[0]
				assert.Equal(t, "document_update", newest.PolicyKey,
					"doc update notification must use document_update policy key")
			}
		})

		t.Run("alice notification carries source_category=activity", func(t *testing.T) {
			all := w.listNotifications(alice, false)
			if len(all) > len(beforeAlice) {
				newest := all[0]
				assert.Equal(t, "activity", newest.SourceCategory)
			}
		})

		t.Run("alice notification carries navigation_target with domain=docs", func(t *testing.T) {
			all := w.listNotifications(alice, false)
			if len(all) > len(beforeAlice) {
				newest := all[0]
				require.NotNil(t, newest.NavigationTarget, "notification must carry navigation_target")
				assert.Equal(t, "docs", newest.NavigationTarget.Domain)
				assert.Equal(t, "document", newest.NavigationTarget.ResourceType)
				assert.Equal(t, docID, newest.NavigationTarget.ResourceId)
			}
		})

		_ = owner
	})

	t.Run("when a document comment is added", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		emps := w.withEmployees(3)
		alice, bob, charlie := emps[0], emps[1], emps[2]

		docID := w.createDocument(owner, "Coverage Doc Comment", `{"type":"doc","content":[]}`)
		w.setDocumentAccess(owner, docID, alice.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)
		w.setDocumentAccess(owner, docID, bob.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)
		w.setDocumentAccess(owner, docID, charlie.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)

		w.followDocument(alice, docID)
		w.followDocument(bob, docID)
		time.Sleep(200 * time.Millisecond)

		beforeAlice := w.listNotifications(alice, false)

		w.addDocumentComment(charlie, docID, "Coverage test comment")
		time.Sleep(300 * time.Millisecond)

		afterAlice := w.listNotifications(alice, false)

		t.Run("follower alice receives doc_commented notification", func(t *testing.T) {
			assert.Greater(t, len(afterAlice), len(beforeAlice), "alice should receive doc_commented notification")
		})

		t.Run("the notification carries policy_key=document_comment", func(t *testing.T) {
			all := w.listNotifications(alice, false)
			if len(all) > len(beforeAlice) {
				newest := all[0]
				assert.Equal(t, "document_comment", newest.PolicyKey)
				assert.Equal(t, "activity", newest.SourceCategory)
			}
		})

		t.Run("the notification carries navigation_target pointing to the document", func(t *testing.T) {
			all := w.listNotifications(alice, false)
			if len(all) > len(beforeAlice) {
				newest := all[0]
				require.NotNil(t, newest.NavigationTarget)
				assert.Equal(t, "docs", newest.NavigationTarget.Domain)
				assert.Equal(t, docID, newest.NavigationTarget.ResourceId)
			}
		})

		_ = bob
		_ = owner
	})

	t.Run("when a follower unfollows a document", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		emps := w.withEmployees(2)
		alice, charlie := emps[0], emps[1]

		docID := w.createDocument(owner, "Coverage Doc Unfollow", `{"type":"doc","content":[]}`)
		w.setDocumentAccess(owner, docID, alice.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)
		w.setDocumentAccess(owner, docID, charlie.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_WRITE_UPDATE)

		w.followDocument(alice, docID)
		time.Sleep(100 * time.Millisecond)

		w.unfollowDocument(alice, docID)
		time.Sleep(100 * time.Millisecond)

		beforeAlice := w.listNotifications(alice, false)

		w.updateDocument(charlie, docID, `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"After unfollow"}]}]}`)
		time.Sleep(300 * time.Millisecond)

		afterAlice := w.listNotifications(alice, false)

		t.Run("alice no longer receives notifications after unfollowing", func(t *testing.T) {
			assert.Equal(t, len(beforeAlice), len(afterAlice), "unfollowed alice should not receive notification")
		})

		_ = owner
	})
}
