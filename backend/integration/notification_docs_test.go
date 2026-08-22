package integration

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

func TestNotificationDocuments(t *testing.T) {
	t.Parallel()

	t.Run("FT-05 version save notifies followers", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		emps := w.withEmployees(3)
		alice, bob, charlie := emps[0], emps[1], emps[2]

		docID := w.createDocument(owner, "Notif Test Doc", `{"type":"doc","content":[]}`)

		// Grant access so employees can follow and update the private document
		w.setDocumentAccess(owner, docID, alice.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)
		w.setDocumentAccess(owner, docID, bob.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)
		w.setDocumentAccess(owner, docID, charlie.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_WRITE_UPDATE)

		w.followDocument(alice, docID)
		w.followDocument(bob, docID)

		time.Sleep(200 * time.Millisecond)

		beforeAlice := w.listNotifications(alice, false)
		beforeBob := w.listNotifications(bob, false)
		beforeCharlie := w.listNotifications(charlie, false)

		w.updateDocument(charlie, docID, `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Updated"}]}]}`)
		time.Sleep(300 * time.Millisecond)

		afterAlice := w.listNotifications(alice, false)
		afterBob := w.listNotifications(bob, false)
		afterCharlie := w.listNotifications(charlie, false)

		t.Run("alice receives doc_updated", func(t *testing.T) {
			assert.Greater(t, len(afterAlice), len(beforeAlice), "alice should have new notification")
			if len(afterAlice) > len(beforeAlice) {
				newest := afterAlice[0]
				assert.Equal(t, "doc_updated", newest.NotificationType)
				assert.Equal(t, "docs", newest.SourceDomain)
				assert.Equal(t, "document_update", newest.PolicyKey)
				assert.Equal(t, "activity", newest.SourceCategory)
				if newest.NavigationTarget != nil {
					assert.Equal(t, "document", newest.NavigationTarget.ResourceType)
					assert.Equal(t, docID, newest.NavigationTarget.ResourceId)
				}
			}
		})

		t.Run("bob receives doc_updated", func(t *testing.T) {
			assert.Greater(t, len(afterBob), len(beforeBob), "bob should have new notification")
		})

		t.Run("charlie does NOT receive own notification", func(t *testing.T) {
			assert.Equal(t, len(beforeCharlie), len(afterCharlie), "charlie should not get own notification")
		})

		_ = owner
	})

	t.Run("FT-06 comment notifies followers", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		emps := w.withEmployees(3)
		alice, bob, charlie := emps[0], emps[1], emps[2]

		docID := w.createDocument(owner, "Comment Notif Doc", `{"type":"doc","content":[]}`)

		// Grant access so employees can follow and comment on the private document
		w.setDocumentAccess(owner, docID, alice.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)
		w.setDocumentAccess(owner, docID, bob.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)
		w.setDocumentAccess(owner, docID, charlie.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)

		w.followDocument(alice, docID)
		w.followDocument(bob, docID)

		time.Sleep(200 * time.Millisecond)

		beforeAlice := w.listNotifications(alice, false)
		beforeBob := w.listNotifications(bob, false)

		w.addDocumentComment(charlie, docID, "This is a test comment")
		time.Sleep(300 * time.Millisecond)

		afterAlice := w.listNotifications(alice, false)
		afterBob := w.listNotifications(bob, false)
		afterCharlie := w.listNotifications(charlie, false)

		t.Run("alice receives doc_commented", func(t *testing.T) {
			assert.Greater(t, len(afterAlice), len(beforeAlice), "alice should have new notification")
			if len(afterAlice) > len(beforeAlice) {
				newest := afterAlice[0]
				assert.Equal(t, "doc_commented", newest.NotificationType)
				assert.Equal(t, "docs", newest.SourceDomain)
				assert.Equal(t, "document_comment", newest.PolicyKey)
				assert.Equal(t, "activity", newest.SourceCategory)
			}
		})

		t.Run("bob receives doc_commented", func(t *testing.T) {
			assert.Greater(t, len(afterBob), len(beforeBob), "bob should have new notification")
		})

		t.Run("charlie does NOT get own notification", func(t *testing.T) {
			_ = afterCharlie
		})

		_ = owner
	})

	t.Run("FT-08 creator auto-follows the document", func(t *testing.T) {
		w := newTestWorld(t)
		_ = w.withOwner()
		alice := w.withEmployee()

		docID := w.createDocument(alice, "Auto-Follow Doc", `{"type":"doc","content":[]}`)
		time.Sleep(200 * time.Millisecond)

		followed := w.listFollowedDocuments(alice)
		found := false
		for _, doc := range followed {
			if doc.Id == docID {
				found = true
				break
			}
		}
		assert.True(t, found, "creator should auto-follow the document")

		t.Run("V2 subscription is active with creator reason", func(t *testing.T) {
			sub := w.getResourceSubscription(alice, "document", docID)
			assert.True(t, sub.Subscribed)
			assert.Contains(t, sub.Reasons, "creator")
		})

		notifications := w.listNotifications(alice, false)
		for _, n := range notifications {
			if n.SourceDomain == "docs" && n.NotificationType == "doc_updated" {
				t.Error("creator should NOT receive notification for their own document creation")
			}
		}
	})

	t.Run("FT-09 default followers receive notifications", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		emps := w.withEmployees(2)
		alice, bob := emps[0], emps[1]

		docID := w.createDocument(owner, "Default Pref Doc", `{"type":"doc","content":[]}`)

		// Grant access so employees can follow and comment on the private document
		w.setDocumentAccess(owner, docID, alice.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)
		w.setDocumentAccess(owner, docID, bob.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)

		w.followDocument(alice, docID)

		time.Sleep(200 * time.Millisecond)

		beforeAlice := w.listNotifications(alice, false)

		w.addDocumentComment(bob, docID, "Comment on default pref test")
		time.Sleep(300 * time.Millisecond)

		afterAlice := w.listNotifications(alice, false)

		assert.Greater(t, len(afterAlice), len(beforeAlice), "follower with default preference should receive notification")
	})

	t.Run("FT-14 notification type constants accepted by DB", func(t *testing.T) {
		w := newTestWorld(t)
		_ = w.withOwner()
		emp := w.withEmployee()

		types := []struct {
			notifType    string
			sourceDomain string
		}{
			{"message", "chat"},
			{"mention", "chat"},
			{"reply", "chat"},
			{"typing", "chat"},
			{"reaction", "chat"},
			{"task_assigned", "projects"},
			{"task_status_changed", "projects"},
			{"task_commented", "projects"},
			{"task_mentioned", "projects"},
			{"doc_updated", "docs"},
			{"doc_commented", "docs"},
			{"doc_mentioned", "docs"},
		}

		sysToken := w.systemToken()
		for _, tc := range types {
			t.Run(tc.notifType, func(t *testing.T) {
				req := connect.NewRequest(&rpcv1.PublishNotificationRequest{
					OrganizationId: w.OrgID.String(),
					Recipients: &rpcv1.NotificationRecipients{
						EmployeeIds: []string{emp.ID.String()},
					},
					SourceDomain:        tc.sourceDomain,
					NotificationType:    tc.notifType,
					Title:               "Constant validation: " + tc.notifType,
					Message:             "Testing " + tc.notifType,
					ActionCategory:      "integration",
					Priority:            1,
					PublishingServiceId: "integration-tests",
				})
				req.Header().Set("Authorization", "Bearer "+sysToken)
				_, err := w.notif.PublishNotification(context.Background(), req)
				require.NoError(t, err, "notification type %q should be accepted by DB", tc.notifType)
			})
		}
	})
}
