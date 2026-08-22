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

// TestNotificationBaseline captures and locks the CURRENT working behavior
// BEFORE any code changes. These tests document the existing contract and
// will catch regressions during refactoring.
func TestNotificationBaseline(t *testing.T) {
	t.Parallel()
	// BL-01: Chat Notification Preference Filtering
	t.Run("BL-01 chat notification preference filtering", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		emps := w.withEmployees(3)
		alice, bob, charlie := emps[0], emps[1], emps[2]

		channelID := w.createChannel(owner, "pref-test", false)
		w.inviteToChannel(owner, channelID, alice.ID)
		w.inviteToChannel(owner, channelID, bob.ID)
		w.inviteToChannel(owner, channelID, charlie.ID)

		// Set preferences: alice=all, bob=mentions, charlie=muted
		w.updateChannelNotificationPreference(alice, channelID, rpcv1.NotificationPreference_NOTIFICATION_PREFERENCE_ALL)
		w.updateChannelNotificationPreference(bob, channelID, rpcv1.NotificationPreference_NOTIFICATION_PREFERENCE_MENTIONS)
		w.updateChannelNotificationPreference(charlie, channelID, rpcv1.NotificationPreference_NOTIFICATION_PREFERENCE_MUTED)

		time.Sleep(200 * time.Millisecond)

		t.Run("when a regular message is sent (no mentions)", func(t *testing.T) {
			beforeAlice := w.listNotifications(alice, false)
			beforeBob := w.listNotifications(bob, false)
			beforeCharlie := w.listNotifications(charlie, false)

			w.sendMessage(owner, channelID, "Regular message for pref test")
			time.Sleep(300 * time.Millisecond)

			afterAlice := w.listNotifications(alice, false)
			afterBob := w.listNotifications(bob, false)
			afterCharlie := w.listNotifications(charlie, false)

			t.Run("alice (preference=all) does NOT receive inbox notification (V2: chat messages are live-only)", func(t *testing.T) {
				assert.Equal(t, len(beforeAlice), len(afterAlice),
					"regular chat messages are live-only under V2 and should not appear in inbox")
			})

			t.Run("bob (preference=mentions) does NOT receive the notification", func(t *testing.T) {
				assert.Equal(t, len(beforeBob), len(afterBob),
					"bob with preference=mentions should not receive regular message notification")
			})

			t.Run("charlie (preference=muted) does NOT receive the notification", func(t *testing.T) {
				assert.Equal(t, len(beforeCharlie), len(afterCharlie),
					"charlie with preference=muted should not receive notification")
			})
		})

		t.Run("when a mention message is sent mentioning bob", func(t *testing.T) {
			beforeBob := w.listNotifications(bob, false)
			beforeCharlie := w.listNotifications(charlie, false)

			w.sendMentionMessage(owner, channelID, bob.ID)
			time.Sleep(300 * time.Millisecond)

			afterBob := w.listNotifications(bob, false)
			afterCharlie := w.listNotifications(charlie, false)

			t.Run("bob (preference=mentions) receives the mention notification", func(t *testing.T) {
				assert.Greater(t, len(afterBob), len(beforeBob),
					"bob with preference=mentions should receive mention notification")
			})

			t.Run("charlie (preference=muted) still does NOT receive", func(t *testing.T) {
				assert.Equal(t, len(beforeCharlie), len(afterCharlie),
					"charlie with preference=muted should not receive even mention notifications")
			})
		})
	})

	// BL-02: Task Watcher Notification Delivery
	t.Run("BL-02 task watcher notification delivery", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		emps := w.withEmployees(3)
		alice, bob, charlie := emps[0], emps[1], emps[2]

		proj := w.createProject(owner, "Watcher Test", uniqueProjectKey("WT"))
		level0 := levelByDepth(proj.Levels, 0)
		require.NotNil(t, level0)

		task := w.createTask(owner, proj.ID, "Watch me", level0.Id)
		w.watchTask(alice, task.Id)
		w.watchTask(bob, task.Id)
		// charlie is NOT watching

		t.Run("V2 subscription state is active for watchers", func(t *testing.T) {
			subAlice := w.getResourceSubscription(alice, "task", task.Id)
			assert.True(t, subAlice.Subscribed, "alice should have active subscription")
			assert.Equal(t, rpcv1.SubscriptionPreferenceLevel_SUBSCRIPTION_PREFERENCE_LEVEL_ALL, subAlice.PreferenceLevel)

			subCharlie := w.getResourceSubscription(charlie, "task", task.Id)
			assert.False(t, subCharlie.Subscribed, "charlie should not have subscription")
		})

		beforeAlice := w.listNotifications(alice, false)
		beforeBob := w.listNotifications(bob, false)
		beforeCharlie := w.listNotifications(charlie, false)

		// Move task (triggers notification to watchers)
		inProgressState := stateByCategory(proj.States, rpcv1.StateCategory_STATE_CATEGORY_IN_PROGRESS)
		require.NotNil(t, inProgressState)
		w.moveTask(owner, task.Id, inProgressState.Id)
		time.Sleep(300 * time.Millisecond)

		afterAlice := w.listNotifications(alice, false)
		afterBob := w.listNotifications(bob, false)
		afterCharlie := w.listNotifications(charlie, false)

		t.Run("alice (watcher) receives notification", func(t *testing.T) {
			assert.Greater(t, len(afterAlice), len(beforeAlice),
				"alice watching the task should receive notification")
			if len(afterAlice) > len(beforeAlice) {
				latest := afterAlice[0]
				assert.Equal(t, "task_status_changed", latest.NotificationType)
				assert.Equal(t, "task_status", latest.PolicyKey)
				assert.Equal(t, "activity", latest.SourceCategory)
				if latest.NavigationTarget != nil {
					assert.Equal(t, "task", latest.NavigationTarget.ResourceType)
					assert.Equal(t, task.Id, latest.NavigationTarget.ResourceId)
				}
			}
		})

		t.Run("bob (watcher) receives notification", func(t *testing.T) {
			assert.Greater(t, len(afterBob), len(beforeBob),
				"bob watching the task should receive notification")
		})

		t.Run("charlie (not watching) does NOT receive notification", func(t *testing.T) {
			assert.Equal(t, len(beforeCharlie), len(afterCharlie),
				"charlie not watching should not receive notification")
		})
	})

	// BL-03: Task Watch/Unwatch Lifecycle
	t.Run("BL-03 task watch/unwatch lifecycle", func(t *testing.T) {
		w := newTestWorld(t)
		owner := w.withOwner()
		alice := w.withEmployee()

		proj := w.createProject(owner, "Watch Lifecycle", uniqueProjectKey("WL"))
		level0 := levelByDepth(proj.Levels, 0)
		require.NotNil(t, level0)

		task := w.createTask(owner, proj.ID, "Lifecycle task", level0.Id)

		t.Run("when alice watches the task", func(t *testing.T) {
			w.watchTask(alice, task.Id)

			t.Run("V2 subscription is active with manual_follow reason", func(t *testing.T) {
				sub := w.getResourceSubscription(alice, "task", task.Id)
				assert.True(t, sub.Subscribed)
				assert.Contains(t, sub.Reasons, "manual_follow")
			})

			t.Run("alice receives notifications for task events", func(t *testing.T) {
				before := w.listNotifications(alice, false)
				inProgressState := stateByCategory(proj.States, rpcv1.StateCategory_STATE_CATEGORY_IN_PROGRESS)
				require.NotNil(t, inProgressState)
				w.moveTask(owner, task.Id, inProgressState.Id)
				time.Sleep(300 * time.Millisecond)
				after := w.listNotifications(alice, false)
				assert.Greater(t, len(after), len(before), "watcher should receive notification")
			})
		})

		t.Run("when alice unwatches the task", func(t *testing.T) {
			w.unwatchTask(alice, task.Id)

			t.Run("V2 subscription is unfollowed", func(t *testing.T) {
				sub := w.getResourceSubscription(alice, "task", task.Id)
				assert.False(t, sub.Subscribed)
			})

			t.Run("alice no longer receives notifications for task events", func(t *testing.T) {
				before := w.listNotifications(alice, false)
				doneState := stateByCategory(proj.States, rpcv1.StateCategory_STATE_CATEGORY_DONE)
				require.NotNil(t, doneState)
				w.moveTask(owner, task.Id, doneState.Id)
				time.Sleep(300 * time.Millisecond)
				after := w.listNotifications(alice, false)
				assert.Equal(t, len(before), len(after), "unwatched user should not receive notification")
			})
		})

		t.Run("when alice re-watches a new task", func(t *testing.T) {
			task2 := w.createTask(owner, proj.ID, "Re-watch task", level0.Id)
			w.watchTask(alice, task2.Id)

			t.Run("alice receives notifications again", func(t *testing.T) {
				before := w.listNotifications(alice, false)
				inProgressState := stateByCategory(proj.States, rpcv1.StateCategory_STATE_CATEGORY_IN_PROGRESS)
				require.NotNil(t, inProgressState)
				w.moveTask(owner, task2.Id, inProgressState.Id)
				time.Sleep(300 * time.Millisecond)
				after := w.listNotifications(alice, false)
				assert.Greater(t, len(after), len(before), "re-watched user should receive notification")
			})
		})
	})

	// BL-04: Document Follow/Unfollow Lifecycle
	t.Run("BL-04 document follow/unfollow lifecycle", func(t *testing.T) {
		w := newTestWorld(t)
		_ = w.withOwner()
		alice := w.withEmployee()

		docID := w.createDocument(alice, "Follow Test", `{"type":"doc","content":[]}`)

		t.Run("when alice follows the document", func(t *testing.T) {
			w.followDocument(alice, docID)

			t.Run("V2 subscription is active with manual_follow reason", func(t *testing.T) {
				sub := w.getResourceSubscription(alice, "document", docID)
				assert.True(t, sub.Subscribed)
				assert.Contains(t, sub.Reasons, "manual_follow")
			})

			t.Run("alice appears in followed documents list", func(t *testing.T) {
				followed := w.listFollowedDocuments(alice)
				found := findDocument(followed, docID)
				assert.NotNil(t, found, "followed document should appear in list")
			})

			t.Run("isFollowing returns true via GetDocument", func(t *testing.T) {
				resp := w.getDocument(alice, docID)
				assert.True(t, resp.IsFollowing)
			})
		})

		t.Run("when alice unfollows the document", func(t *testing.T) {
			w.unfollowDocument(alice, docID)

			t.Run("V2 subscription is unfollowed", func(t *testing.T) {
				sub := w.getResourceSubscription(alice, "document", docID)
				assert.False(t, sub.Subscribed)
			})

			t.Run("alice no longer appears in followed documents list", func(t *testing.T) {
				followed := w.listFollowedDocuments(alice)
				found := findDocument(followed, docID)
				assert.Nil(t, found, "unfollowed document should not appear in list")
			})

			t.Run("isFollowing returns false via GetDocument", func(t *testing.T) {
				resp := w.getDocument(alice, docID)
				assert.False(t, resp.IsFollowing)
			})
		})

		t.Run("when alice re-follows the document", func(t *testing.T) {
			w.followDocument(alice, docID)

			t.Run("alice appears in followed documents list again", func(t *testing.T) {
				followed := w.listFollowedDocuments(alice)
				found := findDocument(followed, docID)
				assert.NotNil(t, found, "re-followed document should appear in list")
			})
		})
	})

	// BL-05: Notification Routing with Presence
	t.Run("BL-05 notification routing with presence", func(t *testing.T) {
		w := newTestWorld(t)
		_ = w.withOwner()
		alice := w.withEmployee()

		t.Run("when alice is online", func(t *testing.T) {
			w.updatePresence(alice, rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE)
			t.Run("presence status is correctly stored", func(t *testing.T) {
				p := w.getPresence(alice, alice.ID)
				assert.Equal(t, rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE, p.Status)
			})
		})

		t.Run("when alice is offline", func(t *testing.T) {
			w.updatePresence(alice, rpcv1.PresenceStatus_PRESENCE_STATUS_OFFLINE)
			t.Run("presence status is correctly stored", func(t *testing.T) {
				p := w.getPresence(alice, alice.ID)
				assert.Equal(t, rpcv1.PresenceStatus_PRESENCE_STATUS_OFFLINE, p.Status)
			})
		})

		t.Run("when alice is online_hidden", func(t *testing.T) {
			w.updatePresence(alice, rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE_HIDDEN)
			t.Run("presence status is correctly stored", func(t *testing.T) {
				p := w.getPresence(alice, alice.ID)
				assert.Equal(t, rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE_HIDDEN, p.Status)
			})
		})

		t.Run("when alice is idle", func(t *testing.T) {
			w.updatePresence(alice, rpcv1.PresenceStatus_PRESENCE_STATUS_IDLE)
			t.Run("presence status is correctly stored", func(t *testing.T) {
				p := w.getPresence(alice, alice.ID)
				assert.Equal(t, rpcv1.PresenceStatus_PRESENCE_STATUS_IDLE, p.Status)
			})
		})

		t.Run("when alice is actively viewing a channel", func(t *testing.T) {
			channelID := w.createChannel(alice, "presence-context", false)
			w.updatePresenceWithChannel(alice, rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE, channelID)
			t.Run("active_channel_id is tracked for context-aware suppression", func(t *testing.T) {
				p := w.getPresence(alice, alice.ID)
				assert.Equal(t, channelID, p.ActiveChannelId)
			})
		})
	})

	// BL-06: Notification Lifecycle
	t.Run("BL-06 notification lifecycle (publish, list, mark-read, delete)", func(t *testing.T) {
		w := newTestWorld(t)
		_ = w.withOwner()
		alice := w.withEmployee()

		t.Run("when a notification is published to alice", func(t *testing.T) {
			initialCount := w.getUnreadCount(alice)
			notifID := w.publishNotification(alice.ID, "baseline-lifecycle")

			t.Run("alice can list it as unread", func(t *testing.T) {
				all := w.listNotifications(alice, false)
				n := findNotification(all, notifID)
				require.NotNil(t, n)
				assert.False(t, n.ReadStatus)
			})

			t.Run("unread count increments", func(t *testing.T) {
				newCount := w.getUnreadCount(alice)
				assert.GreaterOrEqual(t, newCount, initialCount+1)
			})

			t.Run("when alice marks it as read", func(t *testing.T) {
				all := w.listNotifications(alice, false)
				n := findNotification(all, notifID)
				require.NotNil(t, n)
				w.markAsRead(alice, n.NotificationRecipientId)

				t.Run("read status is true", func(t *testing.T) {
					all2 := w.listNotifications(alice, false)
					n2 := findNotification(all2, notifID)
					require.NotNil(t, n2)
					assert.True(t, n2.ReadStatus)
				})

				t.Run("it disappears from unread-only list", func(t *testing.T) {
					unread := w.listNotifications(alice, true)
					assert.Nil(t, findNotification(unread, notifID))
				})
			})

			t.Run("when alice deletes the notification", func(t *testing.T) {
				all := w.listNotifications(alice, false)
				n := findNotification(all, notifID)
				require.NotNil(t, n)
				w.deleteNotification(alice, n.NotificationRecipientId)

				t.Run("it disappears from all lists", func(t *testing.T) {
					final := w.listNotifications(alice, false)
					assert.Nil(t, findNotification(final, notifID))
				})
			})
		})
	})

	// BL-07: Multi-Tenant Notification Isolation
	t.Run("BL-07 multi-tenant notification isolation", func(t *testing.T) {
		w := newTestWorld(t)
		userA, userB := w.withUsersFromDifferentOrgs()

		sysTokenA := generateSystemTokenForOrg(userA.OrgID)
		notifReq := connect.NewRequest(&rpcv1.PublishNotificationRequest{
			OrganizationId: userA.OrgID.String(),
			Recipients: &rpcv1.NotificationRecipients{
				EmployeeIds: []string{userA.ID.String()},
			},
			SourceDomain:        "chat",
			NotificationType:    "message",
			Title:               "Org A Only",
			Message:             "This should not leak",
			ActionCategory:      "integration",
			Priority:            1,
			PublishingServiceId: "integration-tests",
		})
		notifReq.Header().Set("Authorization", "Bearer "+sysTokenA)
		resp, err := w.notif.PublishNotification(context.Background(), notifReq)
		require.NoError(t, err)
		notifID := resp.Msg.NotificationId

		t.Run("user in org_A can see the notification", func(t *testing.T) {
			list := w.listNotifications(userA, false)
			n := findNotification(list, notifID)
			assert.NotNil(t, n)
		})

		t.Run("user in org_B cannot see the notification", func(t *testing.T) {
			list := w.listNotifications(userB, false)
			n := findNotification(list, notifID)
			assert.Nil(t, n, "notification from org_A should not be visible to org_B user")
		})
	})

	// BL-08: Document Notifications — verify doc_updated reaches followers
	t.Run("BL-08 documents currently produce NO notifications", func(t *testing.T) {
		w := newTestWorld(t)
		_ = w.withOwner()
		emps := w.withEmployees(2)
		alice, bob := emps[0], emps[1]

		docID := w.createDocument(alice, "Doc Notif Test", `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hello"}]}]}`)

		// Grant access so bob can follow the private document
		w.setDocumentAccess(alice, docID, bob.ID.String(), rpcv1.AccessLevel_ACCESS_LEVEL_READ_COMMENT)

		w.followDocument(bob, docID)

		beforeBob := w.listNotifications(bob, false)

		t.Run("when a document version is saved", func(t *testing.T) {
			w.updateDocument(alice, docID, `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Updated content"}]}]}`)
			time.Sleep(300 * time.Millisecond)

			t.Run("follower receives doc_updated notification with V2 metadata", func(t *testing.T) {
				afterBob := w.listNotifications(bob, false)
				assert.Greater(t, len(afterBob), len(beforeBob),
					"document follower should receive doc_updated notification")

				if len(afterBob) > len(beforeBob) {
					latest := afterBob[0]
					assert.Equal(t, "doc_updated", latest.NotificationType)
					assert.Equal(t, "document_update", latest.PolicyKey)
					assert.Equal(t, "activity", latest.SourceCategory)
					if latest.NavigationTarget != nil {
						assert.Equal(t, "document", latest.NavigationTarget.ResourceType)
						assert.Equal(t, docID, latest.NavigationTarget.ResourceId)
					}
				}
			})
		})
	})
}
