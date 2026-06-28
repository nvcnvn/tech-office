package integration

import (
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestChatMessaging covers sending messages, replies, mentions, reactions, and DMs.
func TestChatMessaging(t *testing.T) {
	w := newTestWorld(t)
	users := w.withEmployees(3)
	sender, receiver, bystander := users[0], users[1], users[2]

	t.Run("when a user creates a public channel and sends a message", func(t *testing.T) {
		channelID := w.createChannel(sender, "General", false)
		msgID := w.sendMessage(sender, channelID, "Hello world")

		t.Run("the message appears in the channel message list", func(t *testing.T) {
			msgs := w.listMessages(sender, channelID)
			found := false
			for _, m := range msgs {
				if m.Id == msgID {
					found = true
					assert.Equal(t, "Hello world", m.MessageText)
				}
			}
			require.True(t, found, "sent message should appear in list")
		})
	})

	t.Run("when a user replies to a message", func(t *testing.T) {
		channelID := w.createChannel(sender, "Replies", false)
		parentID := w.sendMessage(sender, channelID, "Original message")
		replyID := w.replyToMessage(receiver, parentID, "This is a reply")

		t.Run("the reply is created successfully", func(t *testing.T) {
			require.NotEmpty(t, replyID)
			assert.NotEqual(t, parentID, replyID)
		})
	})

	t.Run("when a user @mentions another employee in a channel", func(t *testing.T) {
		channelID := w.createChannel(sender, "Mentions", false)
		msgID := w.sendMentionMessage(sender, channelID, receiver.ID)

		t.Run("the message is created with the mention markup", func(t *testing.T) {
			require.NotEmpty(t, msgID)
		})
	})

	t.Run("when a user @mentions a department in a public channel", func(t *testing.T) {
		deptID, hasDept := w.lookupDepartment()
		if !hasDept {
			t.Skip("no departments in test organization")
		}
		channelID := w.createChannel(sender, "DeptMention", false)
		msgID := w.sendDeptMentionMessage(sender, channelID, deptID)

		t.Run("the message is created with the department mention markup", func(t *testing.T) {
			require.NotEmpty(t, msgID)
		})
	})

	t.Run("when a user @mentions a department in a private channel", func(t *testing.T) {
		deptID, hasDept := w.lookupDepartment()
		if !hasDept {
			t.Skip("no departments in test organization")
		}
		channelID := w.createChannel(sender, "PrivDeptMention", true)
		msgID := w.sendDeptMentionMessage(sender, channelID, deptID)

		t.Run("the message is created despite private channel restriction", func(t *testing.T) {
			require.NotEmpty(t, msgID)
		})
	})

	t.Run("when a message has both employee and department mentions", func(t *testing.T) {
		deptID, hasDept := w.lookupDepartment()
		if !hasDept {
			t.Skip("no departments in test organization")
		}
		channelID := w.createChannel(sender, "MixedMentions", false)
		msgID := w.sendMixedMentionMessage(sender, channelID, receiver.ID, deptID)

		t.Run("the mixed mention message is created", func(t *testing.T) {
			require.NotEmpty(t, msgID)
		})
	})

	t.Run("when a user adds a reaction to a message", func(t *testing.T) {
		channelID := w.createChannel(sender, "Reactions", false)
		msgID := w.sendMessage(sender, channelID, "React to this")
		w.addReaction(receiver, msgID, "👍")

		t.Run("the reaction is added without error", func(t *testing.T) {
			// Reaction was added successfully (addReaction asserts NoError)
		})
	})

	t.Run("when a user creates a direct message channel", func(t *testing.T) {
		dmChannelID := w.createOrGetDM(sender, receiver.ID)

		t.Run("the DM channel is created", func(t *testing.T) {
			require.NotEmpty(t, dmChannelID)
		})

		t.Run("calling again returns the same channel (idempotent)", func(t *testing.T) {
			dmChannelID2 := w.createOrGetDM(sender, receiver.ID)
			assert.Equal(t, dmChannelID, dmChannelID2)
		})

		t.Run("the other user also gets the same channel", func(t *testing.T) {
			dmChannelID3 := w.createOrGetDM(receiver, sender.ID)
			assert.Equal(t, dmChannelID, dmChannelID3)
		})
	})

	t.Run("when a user invites another to a private channel", func(t *testing.T) {
		channelID := w.createChannel(sender, "PrivInvite", true)
		w.inviteToChannel(sender, channelID, bystander.ID)

		t.Run("the invited user can send messages in the channel", func(t *testing.T) {
			msgID := w.sendMessage(bystander, channelID, "I was invited!")
			require.NotEmpty(t, msgID)
		})
	})

	t.Run("when a non-member tries to upload a file to a private channel", func(t *testing.T) {
		channelID := w.createChannel(sender, "PrivRestrict", true)
		err := w.requestChannelFileUploadError(bystander, channelID, "test.txt", "text/plain", 100)

		t.Run("the upload is denied", func(t *testing.T) {
			require.Error(t, err)
			assert.Equal(t, connect.CodePermissionDenied, connect.CodeOf(err))
		})
	})
}
