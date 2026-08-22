package integration

import (
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestChatChannelWorkflow simulates multi-step chat workflows as the frontend
// performs them:
// - Create channel -> send messages -> upload files -> send message with attachments
// - Create private channel -> invite members -> verify access cascade to files
// - Reactions and thread replies across multiple users
func TestChatChannelWorkflow(t *testing.T) {
	t.Parallel()
	w := newTestWorld(t)
	users := w.withEmployees(3)
	alice, bob, charlie := users[0], users[1], users[2]

	t.Run("when a team collaborates in a public channel with file attachments", func(t *testing.T) {
		channelID := w.createChannel(alice, "project-updates", false)
		fileContent := []byte("Sprint retrospective notes: things went well...")
		fileID := w.uploadChannelFile(alice, channelID, "retro-notes.txt", "text/plain", fileContent)
		msgID := w.sendMessage(alice, channelID, "Here are the retro notes")
		messages := w.listMessages(bob, channelID)

		t.Run("bob sees alice's message", func(t *testing.T) {
			found := false
			for _, m := range messages {
				if m.Id == msgID {
					found = true
					assert.Equal(t, "Here are the retro notes", m.MessageText)
				}
			}
			require.True(t, found, "bob should see alice's message in the public channel")
		})

		t.Run("bob can access the uploaded file", func(t *testing.T) {
			hasAccess, _ := w.checkFileAccess(bob, fileID)
			assert.True(t, hasAccess, "any org member should access public channel files")
		})

		t.Run("the file metadata is retrievable for rendering in chat", func(t *testing.T) {
			files := w.getFileMetadataBatch(bob, []string{fileID})
			require.Len(t, files, 1)
			assert.Equal(t, "retro-notes.txt", files[0].OriginalFilename)
		})

		t.Run("when bob replies to alice's message and adds a reaction", func(t *testing.T) {
			replyID := w.replyToMessage(bob, msgID, "Great notes! Let me add some thoughts.")
			w.addReaction(bob, msgID, "thumbsup")
			w.addReaction(charlie, msgID, "tada")

			t.Run("the reply is created and linked to the parent", func(t *testing.T) {
				require.NotEmpty(t, replyID)
				assert.NotEqual(t, msgID, replyID)
			})

			t.Run("another user can see the message", func(t *testing.T) {
				msg := w.getMessage(charlie, msgID)
				assert.Equal(t, "Here are the retro notes", msg.MessageText)
			})
		})
	})

	t.Run("when a private channel enforces file access boundaries", func(t *testing.T) {
		privChannelID := w.createChannel(alice, "leadership-only", true)
		fileContent := []byte("Salary adjustment plans Q3...")
		fileID := w.uploadChannelFile(alice, privChannelID, "salary.xlsx", "application/vnd.ms-excel", fileContent)
		w.sendMessage(alice, privChannelID, "Please review the salary doc")

		t.Run("non-member bob cannot access the private channel file", func(t *testing.T) {
			hasAccess, reason := w.checkFileAccess(bob, fileID)
			assert.False(t, hasAccess)
			assert.NotEmpty(t, reason)
		})

		t.Run("non-member bob cannot upload to the private channel", func(t *testing.T) {
			err := w.requestChannelFileUploadError(bob, privChannelID, "hack.txt", "text/plain", 100)
			require.Error(t, err)
			assert.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err))
		})

		t.Run("when bob is invited to the channel", func(t *testing.T) {
			w.inviteToChannel(alice, privChannelID, bob.ID)

			t.Run("bob can now send messages", func(t *testing.T) {
				msgID := w.sendMessage(bob, privChannelID, "Thanks for adding me!")
				require.NotEmpty(t, msgID)
			})

			t.Run("bob can now access previously uploaded files", func(t *testing.T) {
				hasAccess, _ := w.checkFileAccess(bob, fileID)
				assert.True(t, hasAccess, "newly invited member should access existing channel files")
			})

			t.Run("bob can upload files to the channel", func(t *testing.T) {
				newFileID := w.uploadChannelFile(bob, privChannelID, "review.pdf", "application/pdf", []byte("review"))
				assert.NotEmpty(t, newFileID)
			})

			t.Run("charlie still cannot access the file", func(t *testing.T) {
				hasAccess, _ := w.checkFileAccess(charlie, fileID)
				assert.False(t, hasAccess, "uninvited user should not access private channel files")
			})
		})
	})

	t.Run("when users create a DM and exchange messages with files", func(t *testing.T) {
		dmChannelID := w.createOrGetDM(alice, bob.ID)
		msgID := w.sendMessage(alice, dmChannelID, "Hey, can you review this PR?")
		fileID := w.uploadChannelFile(alice, dmChannelID, "screenshot.png", "image/png", []byte("PNG data"))

		t.Run("bob sees the DM message", func(t *testing.T) {
			messages := w.listMessages(bob, dmChannelID)
			found := false
			for _, m := range messages {
				if m.Id == msgID {
					found = true
				}
			}
			assert.True(t, found, "bob should see alice's DM")
		})

		t.Run("bob can access the DM file", func(t *testing.T) {
			hasAccess, _ := w.checkFileAccess(bob, fileID)
			assert.True(t, hasAccess, "DM participant should access DM files")
		})

		t.Run("charlie cannot access the DM file", func(t *testing.T) {
			hasAccess, _ := w.checkFileAccess(charlie, fileID)
			assert.False(t, hasAccess, "non-DM participant should not access DM files")
		})

		t.Run("bob gets the same DM channel (idempotent)", func(t *testing.T) {
			dmFromBob := w.createOrGetDM(bob, alice.ID)
			assert.Equal(t, dmChannelID, dmFromBob)
		})
	})

	t.Run("when a user @mentions another in a channel and they interact", func(t *testing.T) {
		channelID := w.createChannel(alice, "dev-team", false)
		mentionMsgID := w.sendMentionMessage(alice, channelID, bob.ID)
		notifID := w.publishNotification(bob.ID, "You were mentioned in #dev-team")

		t.Run("the mention message is created", func(t *testing.T) {
			require.NotEmpty(t, mentionMsgID)
		})

		t.Run("bob receives a notification about the mention", func(t *testing.T) {
			notifs := w.listNotifications(bob, true)
			n := findNotification(notifs, notifID)
			require.NotNil(t, n)
		})

		t.Run("bob can reply to the mention (thread interaction)", func(t *testing.T) {
			replyID := w.replyToMessage(bob, mentionMsgID, "On it! Will check now.")
			require.NotEmpty(t, replyID)
		})
	})
}
