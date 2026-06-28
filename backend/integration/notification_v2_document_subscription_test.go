package integration

// TestNotificationV2DocumentSubscription validates V2 document parent-subscription bundle semantics.

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nvcnvn/tech-office/backend/internal/notification"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

func TestNotificationV2DocumentSubscription(t *testing.T) {

	t.Run("when a user follows a document", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		follower := w.withEmployee()
		editor := w.withEmployee()

		docID := w.createDocument(owner, "V2 Document Bundle", `{"type":"doc","content":[]}`)
		w.setDocumentAccess(owner, docID, follower.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)
		w.setDocumentAccess(owner, docID, editor.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_WRITE_UPDATE)
		w.followDocument(follower, docID)
		time.Sleep(200 * time.Millisecond)

		t.Run("when the document is updated", func(t *testing.T) {
			before := w.listNotifications(follower, false)

			w.updateDocument(editor, docID,
				`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"V2 bundle test update"}]}]}`)
			time.Sleep(300 * time.Millisecond)

			after := w.listNotifications(follower, false)

			t.Run("the follower receives doc_updated notification", func(t *testing.T) {
				notify := findNotificationByNavigationResource(after, "docs", notification.NotificationTypeDocUpdated, docID)
				assert.NotNil(t, notify, "document follower should receive doc_updated")
			})

			t.Run("the notification carries doc_updated type and document_update policy_key", func(t *testing.T) {
				n := findNotificationByNavigationResource(after, "docs", notification.NotificationTypeDocUpdated, docID)
				if n == nil && len(after) > len(before) {
					n = after[0]
				}
				if n != nil && n.NotificationType == notification.NotificationTypeDocUpdated {
					assert.Equal(t, notification.PolicyKeyDocumentUpdate, n.PolicyKey)
					assert.Equal(t, notification.SourceCategoryActivity, n.SourceCategory)
				}
			})
		})

		t.Run("when a comment is posted on the document", func(t *testing.T) {
			before := w.listNotifications(follower, false)

			w.addDocumentComment(editor, docID, "V2 subscription test comment")
			time.Sleep(300 * time.Millisecond)

			after := w.listNotifications(follower, false)

			t.Run("the follower receives doc_commented via parent subscription", func(t *testing.T) {
				notify := findNotificationByNavigationResource(after, "docs", notification.NotificationTypeDocCommented, docID)
				assert.NotNil(t, notify,
					"document follower should receive doc_commented notification through parent subscription")
			})

			t.Run("the notification carries doc_commented type and document_comment policy_key", func(t *testing.T) {
				var docCommentNotify *rpcv1.NotificationSummary
				for _, n := range after {
					if n.NotificationType == notification.NotificationTypeDocCommented {
						docCommentNotify = n
						break
					}
				}
				if docCommentNotify == nil {
					_ = before // suppress unused warning
					return
				}
				assert.Equal(t, notification.PolicyKeyDocumentComment, docCommentNotify.PolicyKey)
				assert.Equal(t, notification.SourceCategoryActivity, docCommentNotify.SourceCategory)
			})
		})
	})

	t.Run("when a user unfollows a document", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		follower := w.withEmployee()
		editor := w.withEmployee()
		commenter := w.withEmployee()

		docID := w.createDocument(owner, "V2 Document Unfollow", `{"type":"doc","content":[]}`)
		w.setDocumentAccess(owner, docID, follower.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)
		w.setDocumentAccess(owner, docID, editor.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_WRITE_UPDATE)
		w.setDocumentAccess(owner, docID, commenter.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)
		w.followDocument(follower, docID)
		time.Sleep(100 * time.Millisecond)
		w.unfollowDocument(follower, docID)
		time.Sleep(100 * time.Millisecond)

		t.Run("when the document is updated after unfollow", func(t *testing.T) {
			before := countMatchingNotificationsByResource(w.listNotifications(follower, false), "docs", notification.NotificationTypeDocUpdated, docID)

			w.updateDocument(editor, docID,
				`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Should not reach unfollowed user"}]}]}`)
			time.Sleep(300 * time.Millisecond)

			after := countMatchingNotificationsByResource(w.listNotifications(follower, false), "docs", notification.NotificationTypeDocUpdated, docID)

			t.Run("routine document updates stop", func(t *testing.T) {
				assert.Equal(t, before, after, "unfollowed user should not receive doc_updated notification")
			})
		})

		t.Run("when a document comment is posted after unfollow", func(t *testing.T) {
			before := countMatchingNotificationsByResource(w.listNotifications(follower, false), "docs", notification.NotificationTypeDocCommented, docID)

			w.addDocumentComment(commenter, docID, "Should not reach unfollowed user")
			time.Sleep(300 * time.Millisecond)

			after := countMatchingNotificationsByResource(w.listNotifications(follower, false), "docs", notification.NotificationTypeDocCommented, docID)

			t.Run("routine document comment notifications stop", func(t *testing.T) {
				assert.Equal(t, before, after,
					"unfollowed document user should not receive doc_commented notification")
			})
		})
	})

	t.Run("when a user comments on a document", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		commenter := w.withEmployee()

		docID := w.createDocument(owner, "V2 Comment Subscribe", `{"type":"doc","content":[]}`)
		w.setDocumentAccess(owner, docID, commenter.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)

		stateBefore, _, _ := w.queryResourceSubscription(commenter.ID, notification.ResourceDomainDocument, docID)
		assert.NotEqual(t, notification.ResourceSubscriptionStateActive, stateBefore,
			"commenter should not have an active subscription before commenting")

		w.addDocumentComment(commenter, docID, "Commenting to subscribe V2")
		time.Sleep(300 * time.Millisecond)

		state, _, found := w.queryResourceSubscription(commenter.ID, notification.ResourceDomainDocument, docID)
		reasons := w.queryResourceSubscriptionReasons(commenter.ID, notification.ResourceDomainDocument, docID)

		t.Run("the commenter becomes subscribed to the parent document", func(t *testing.T) {
			assert.True(t, found, "commenter should have a document subscription after commenting")
			assert.Equal(t, notification.ResourceSubscriptionStateActive, state,
				"subscription should be active after commenting")
		})

		t.Run("the subscription carries the commented reason", func(t *testing.T) {
			assert.Contains(t, reasons, notification.ResourceSubscriptionReasonCommented,
				"subscription reason should include commented")
		})

		t.Run("the subscription reason is not manual_follow", func(t *testing.T) {
			assert.NotContains(t, reasons, notification.ResourceSubscriptionReasonManualFollow,
				"comment-driven subscription should not be labeled as manual_follow")
		})
	})

	t.Run("when a document is created", func(t *testing.T) {
		w := newTestWorld(t)
		creator := w.withOwner()

		docID := w.createDocument(creator, "V2 Creator Auto-Subscribe", `{"type":"doc","content":[]}`)
		time.Sleep(100 * time.Millisecond)

		state, preference, found := w.queryResourceSubscription(creator.ID, notification.ResourceDomainDocument, docID)
		reasons := w.queryResourceSubscriptionReasons(creator.ID, notification.ResourceDomainDocument, docID)

		t.Run("the creator has an active document subscription", func(t *testing.T) {
			require.True(t, found, "creator should have a document subscription")
			assert.Equal(t, notification.ResourceSubscriptionStateActive, state)
			assert.Equal(t, notification.NotificationPreferenceAll, preference)
		})

		t.Run("the subscription carries the creator reason", func(t *testing.T) {
			assert.Contains(t, reasons, notification.ResourceSubscriptionReasonCreator)
		})

		t.Run("the creator does not receive a notification for their own creation", func(t *testing.T) {
			notifications := w.listNotifications(creator, false)
			for _, n := range notifications {
				if n.SourceDomain == "docs" && n.NotificationType == notification.NotificationTypeDocUpdated {
					assert.Fail(t, "creator should not receive doc_updated for own document creation",
						"got notification: type=%s domain=%s", n.NotificationType, n.SourceDomain)
				}
			}
		})
	})

	t.Run("when a document creates a resource surface for its comment thread", func(t *testing.T) {
		// V2: document creation registers a document_comments surface row.
		w := newTestWorld(t)
		owner := w.withOwner()

		docID := w.createDocument(owner, "V2 Doc Surface Linkage", `{"type":"doc","content":[]}`)
		time.Sleep(100 * time.Millisecond)

		surfaces := w.queryResourceSurfaces(notification.ResourceDomainDocument, docID)

		t.Run("a document_comments surface is registered for the document", func(t *testing.T) {
			surface := findSurfaceByType(surfaces, notification.ResourceSurfaceTypeDocumentComments)
			assert.NotNil(t, surface,
				"document should have a document_comments surface row in notification.resource_surface")
			if surface != nil {
				assert.Equal(t, notification.ResourceSurfaceDomainDocumentCommentThread, surface.SurfaceDomain)
				assert.True(t, surface.InheritsSubscription,
					"document_comments surface should inherit subscription from parent document")
			}
		})
	})
}
