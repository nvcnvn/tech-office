package integration

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

func TestVoiceCommunicationLifecycle(t *testing.T) {
	w := newTestWorld(t)
	owner := w.withOwner()
	members := w.withEmployees(3)
	alice := members[0]
	bob := members[1]
	charlie := members[2]

	t.Run("when employees start and join a voice call in a direct message", func(t *testing.T) {
		channelID := w.createOrGetDM(alice, bob.ID)

		call, credentials := w.startVoiceCall(alice, channelID)

		t.Run("the initiator receives scoped LiveKit join credentials", func(t *testing.T) {
			require.NotNil(t, call)
			require.NotNil(t, credentials)
			assert.NotEmpty(t, call.Id)
			assert.Equal(t, channelID, call.ChannelId)
			assert.Equal(t, alice.ID.String(), call.InitiatorEmployeeId)
			assert.Equal(t, rpcv1.VoiceCallState_VOICE_CALL_STATE_RINGING, call.State)
			assert.NotEmpty(t, credentials.LivekitUrl)
			assert.NotEmpty(t, credentials.LivekitToken)
			assert.NotEmpty(t, credentials.RoomName)
			assert.WithinDuration(t, time.Now().Add(5*time.Minute), credentials.ExpiresAt.AsTime(), time.Minute)
		})

		joinedCall, bobCredentials := w.joinVoiceCall(bob, call.Id)

		t.Run("the joining participant receives credentials for the same media room", func(t *testing.T) {
			require.NotNil(t, joinedCall)
			require.NotNil(t, bobCredentials)
			assert.Equal(t, call.Id, joinedCall.Id)
			assert.Equal(t, rpcv1.VoiceCallState_VOICE_CALL_STATE_ACTIVE, joinedCall.State)
			assert.Equal(t, credentials.RoomName, bobCredentials.RoomName)
			assert.NotEqual(t, credentials.LivekitToken, bobCredentials.LivekitToken)
			assert.Len(t, joinedCall.Participants, 2)
		})

		t.Run("the active call can be discovered from the room within the recovery window", func(t *testing.T) {
			require.Eventually(t, func() bool {
				activeCall, hasActiveCall := w.getActiveVoiceCall(bob, channelID)
				return hasActiveCall && activeCall != nil && activeCall.Id == call.Id
			}, 5*time.Second, 200*time.Millisecond)
		})

		t.Run("either participant hanging up ends the direct call for both sides", func(t *testing.T) {
			afterBobLeaves := w.leaveVoiceCall(bob, call.Id)
			assert.Equal(t, rpcv1.VoiceCallState_VOICE_CALL_STATE_ENDED, afterBobLeaves.State)
			assert.Equal(t, rpcv1.VoiceCallOutcome_VOICE_CALL_OUTCOME_COMPLETED, afterBobLeaves.Outcome)

			aliceActiveCall, aliceHasActiveCall := w.getActiveVoiceCall(alice, channelID)
			assert.False(t, aliceHasActiveCall)
			assert.Nil(t, aliceActiveCall)
			bobActiveCall, bobHasActiveCall := w.getActiveVoiceCall(bob, channelID)
			assert.False(t, bobHasActiveCall)
			assert.Nil(t, bobActiveCall)

			record := w.getCallRecord(alice, call.Id)
			require.NotNil(t, record.GetCall())
			assert.Equal(t, rpcv1.VoiceCallOutcome_VOICE_CALL_OUTCOME_COMPLETED, record.GetCall().GetOutcome())
		})
	})

	t.Run("when a direct message recipient declines before answering", func(t *testing.T) {
		channelID := w.createOrGetDM(alice, bob.ID)
		bobStream, _, cancelBobStream := w.openNotificationStream(bob, 5*time.Second)
		defer cancelBobStream()
		call, _ := w.startVoiceCall(alice, channelID)
		incomingSignal := w.waitForVoiceNotificationStreamEvent(bobStream, "voice_call_incoming", call.Id)
		incomingNotification := w.waitForVoiceIncomingNotificationForCall(bob, call.Id, 5*time.Second)
		invitationID := incomingNotification.GetActionData()["invitationId"]
		require.NotEmpty(t, invitationID)
		assert.Equal(t, invitationID, incomingSignal.GetActionData()["invitationId"])
		require.NotNil(t, incomingSignal.GetPayload())
		require.NotNil(t, incomingSignal.GetPayload().GetVoiceCall())
		assert.Equal(t, call.Id, incomingSignal.GetPayload().GetVoiceCall().GetCallId())
		assert.Equal(t, invitationID, incomingSignal.GetPayload().GetVoiceCall().GetInvitationId())

		aliceStream, _, cancelAliceStream := w.openNotificationStream(alice, 5*time.Second)
		defer cancelAliceStream()

		declined, credentials := w.respondToVoiceCallInvite(bob, invitationID, rpcv1.VoiceInviteResponse_VOICE_INVITE_RESPONSE_DECLINE)

		t.Run("the invite is declined and the unanswered direct call ends", func(t *testing.T) {
			assert.Equal(t, rpcv1.VoiceInvitationStatus_VOICE_INVITATION_STATUS_DECLINED, declined.GetStatus())
			assert.Nil(t, credentials)

			activeCall, hasActiveCall := w.getActiveVoiceCall(alice, channelID)
			assert.False(t, hasActiveCall)
			assert.Nil(t, activeCall)

			record := w.getCallRecord(alice, call.Id)
			require.NotNil(t, record.GetCall())
			assert.Equal(t, rpcv1.VoiceCallState_VOICE_CALL_STATE_ENDED, record.GetCall().GetState())
			assert.Equal(t, rpcv1.VoiceCallOutcome_VOICE_CALL_OUTCOME_DECLINED, record.GetCall().GetOutcome())
		})

		t.Run("the caller receives a participant-scoped call-ended SSE signal", func(t *testing.T) {
			endedSignal := w.waitForVoiceNotificationStreamEvent(aliceStream, "voice_call_ended", call.Id)
			assert.Equal(t, "ended", endedSignal.GetActionData()["action"])
			assert.Equal(t, "declined", endedSignal.GetActionData()["outcome"])
			assert.Equal(t, "VOICE_CALL_STATE_ENDED", endedSignal.GetActionData()["state"])
		})

		t.Run("the timeline and incoming alert reflect the terminal outcome", func(t *testing.T) {
			messages := w.listMessages(alice, channelID)
			assert.True(t, containsMessageText(messages, "Voice call declined"))
			acknowledged := w.waitForNotificationAcknowledgement(bob, incomingNotification.GetNotificationId())
			assert.Equal(t, "explicit_ack", acknowledged.GetAcknowledgementAction())
		})
	})

	t.Run("when a direct message caller cancels before the recipient answers", func(t *testing.T) {
		channelID := w.createOrGetDM(alice, bob.ID)
		call, _ := w.startVoiceCall(alice, channelID)
		incomingNotification := w.waitForVoiceIncomingNotificationForCall(bob, call.Id, 5*time.Second)

		cancelled := w.endVoiceCall(alice, call.Id)

		t.Run("the call is cancelled and no longer discoverable", func(t *testing.T) {
			assert.Equal(t, rpcv1.VoiceCallState_VOICE_CALL_STATE_ENDED, cancelled.GetState())
			assert.Equal(t, rpcv1.VoiceCallOutcome_VOICE_CALL_OUTCOME_CANCELLED, cancelled.GetOutcome())

			activeCall, hasActiveCall := w.getActiveVoiceCall(bob, channelID)
			assert.False(t, hasActiveCall)
			assert.Nil(t, activeCall)
		})

		t.Run("the pending incoming alert is acknowledged", func(t *testing.T) {
			acknowledged := w.waitForNotificationAcknowledgement(bob, incomingNotification.GetNotificationId())
			assert.Equal(t, "explicit_ack", acknowledged.GetAcknowledgementAction())
			messages := w.listMessages(alice, channelID)
			assert.True(t, containsMessageText(messages, "Voice call cancelled"))
		})
	})

	t.Run("when a direct message invite expires before the recipient answers", func(t *testing.T) {
		channelID := w.createOrGetDM(alice, bob.ID)
		call, _ := w.startVoiceCall(alice, channelID)
		incomingNotification := w.waitForVoiceIncomingNotificationForCall(bob, call.Id, 5*time.Second)
		invitationID := incomingNotification.GetActionData()["invitationId"]
		require.NotEmpty(t, invitationID)
		w.expireVoiceInvitation(invitationID)

		expired, credentials := w.respondToVoiceCallInvite(bob, invitationID, rpcv1.VoiceInviteResponse_VOICE_INVITE_RESPONSE_ACCEPT)

		t.Run("the invite reports expired and the unanswered direct call is missed", func(t *testing.T) {
			assert.Equal(t, rpcv1.VoiceInvitationStatus_VOICE_INVITATION_STATUS_EXPIRED, expired.GetStatus())
			assert.Nil(t, credentials)

			activeCall, hasActiveCall := w.getActiveVoiceCall(alice, channelID)
			assert.False(t, hasActiveCall)
			assert.Nil(t, activeCall)

			record := w.getCallRecord(alice, call.Id)
			require.NotNil(t, record.GetCall())
			assert.Equal(t, rpcv1.VoiceCallOutcome_VOICE_CALL_OUTCOME_MISSED, record.GetCall().GetOutcome())
		})

		t.Run("the stale incoming alert is acknowledged", func(t *testing.T) {
			acknowledged := w.waitForNotificationAcknowledgement(bob, incomingNotification.GetNotificationId())
			assert.Equal(t, "explicit_ack", acknowledged.GetAcknowledgementAction())
			messages := w.listMessages(alice, channelID)
			assert.True(t, containsMessageText(messages, "Voice call missed"))
		})
	})

	t.Run("when a channel already has an active voice call", func(t *testing.T) {
		channelID := w.createChannel(owner, "Voice Race Room", false)
		w.inviteToChannel(owner, channelID, alice.ID)
		call, _ := w.startVoiceCall(owner, channelID)

		t.Run("another start request is rejected by the one-active-call guard", func(t *testing.T) {
			err := w.startVoiceCallError(alice, channelID)
			require.Error(t, err)
			var connectErr *connect.Error
			require.True(t, errors.As(err, &connectErr))
			assert.Equal(t, connect.CodeAlreadyExists, connectErr.Code())
		})

		_ = w.endVoiceCall(owner, call.Id)
	})

	t.Run("when a non-member tries to join a private room call", func(t *testing.T) {
		channelID := w.createChannel(owner, "Voice Private Room", true)
		w.inviteToChannel(owner, channelID, alice.ID)
		call, _ := w.startVoiceCall(alice, channelID)

		t.Run("join credentials are denied and no token is exposed", func(t *testing.T) {
			err := w.joinVoiceCallError(bob, call.Id)
			require.Error(t, err)
			var connectErr *connect.Error
			require.True(t, errors.As(err, &connectErr))
			assert.Equal(t, connect.CodePermissionDenied, connectErr.Code())
		})

		_ = w.endVoiceCall(alice, call.Id)
	})

	t.Run("when an ongoing group call is surfaced in a channel", func(t *testing.T) {
		channelID := w.createChannel(owner, "Voice Group Room", true)
		w.inviteToChannel(owner, channelID, alice.ID)
		w.inviteToChannel(owner, channelID, bob.ID)
		w.inviteToChannel(owner, channelID, charlie.ID)

		call, _ := w.startVoiceCall(alice, channelID)

		t.Run("a server-authored start announcement appears in the timeline", func(t *testing.T) {
			messages := w.listMessages(alice, channelID)
			startedMessage := findMessageWithText(messages, "Voice call started")
			require.NotNil(t, startedMessage)
			assert.Equal(t, "system", startedMessage.GetMessageKind())
			assert.Equal(t, "voice_call_started", startedMessage.GetSystemEventType())

			var metadata struct {
				CallID           string `json:"callId"`
				State            string `json:"state"`
				ParticipantCount int64  `json:"participantCount"`
			}
			require.NoError(t, json.Unmarshal([]byte(startedMessage.GetMetadataJson()), &metadata))
			assert.Equal(t, call.Id, metadata.CallID)
			assert.Equal(t, "ringing", metadata.State)
			assert.Equal(t, int64(1), metadata.ParticipantCount)
		})

		t.Run("late members can discover and join the active call", func(t *testing.T) {
			activeCall, hasActiveCall := w.getActiveVoiceCall(bob, channelID)
			require.True(t, hasActiveCall)
			require.NotNil(t, activeCall)
			assert.Equal(t, call.Id, activeCall.Id)

			joinedCall, credentials := w.joinVoiceCall(bob, call.Id)
			require.NotNil(t, credentials)
			assert.Equal(t, rpcv1.VoiceCallState_VOICE_CALL_STATE_ACTIVE, joinedCall.State)
		})

		t.Run("participants can invite another eligible channel member", func(t *testing.T) {
			updatedCall, invitations := w.inviteToVoiceCall(alice, call.Id, charlie.ID.String())
			require.Len(t, invitations, 1)
			assert.Equal(t, call.Id, updatedCall.Id)
			assert.Equal(t, charlie.ID.String(), invitations[0].InviteeEmployeeId)
			assert.Equal(t, rpcv1.VoiceInvitationStatus_VOICE_INVITATION_STATUS_PENDING, invitations[0].Status)

			accepted, credentials := w.respondToVoiceCallInvite(charlie, invitations[0].Id, rpcv1.VoiceInviteResponse_VOICE_INVITE_RESPONSE_ACCEPT)
			assert.Equal(t, rpcv1.VoiceInvitationStatus_VOICE_INVITATION_STATUS_ACCEPTED, accepted.Status)
			require.NotNil(t, credentials)
			assert.NotEmpty(t, credentials.LivekitToken)
		})

		t.Run("ineligible employees are denied an invitation", func(t *testing.T) {
			outsider := w.withEmployee()
			privateChannelID := w.createChannel(owner, "Voice Denied Invite Room", true)
			w.inviteToChannel(owner, privateChannelID, alice.ID)
			privateCall, _ := w.startVoiceCall(alice, privateChannelID)
			inviteErr := w.inviteToVoiceCallError(alice, privateCall.Id, outsider.ID.String())
			require.Error(t, inviteErr)
			assert.Equal(t, connect.CodePermissionDenied, connect.CodeOf(inviteErr))
			_ = w.endVoiceCall(alice, privateCall.Id)
		})

		endedCall := w.endVoiceCall(alice, call.Id)
		t.Run("a server-authored ended announcement appears in the timeline", func(t *testing.T) {
			assert.Equal(t, rpcv1.VoiceCallState_VOICE_CALL_STATE_ENDED, endedCall.State)
			messages := w.listMessages(alice, channelID)
			endedMessage := findMessageWithText(messages, "Voice call ended")
			require.NotNil(t, endedMessage)
			assert.Nil(t, findMessageWithText(messages, "Voice call started"))
			assert.Equal(t, "system", endedMessage.GetMessageKind())
			assert.Equal(t, "voice_call_ended", endedMessage.GetSystemEventType())

			var metadata struct {
				CallID           string `json:"callId"`
				Outcome          string `json:"outcome"`
				State            string `json:"state"`
				StartedAt        string `json:"startedAt"`
				EndedAt          string `json:"endedAt"`
				DurationMs       int64  `json:"durationMs"`
				ParticipantCount int64  `json:"participantCount"`
			}
			require.NoError(t, json.Unmarshal([]byte(endedMessage.GetMetadataJson()), &metadata))
			assert.Equal(t, endedCall.Id, metadata.CallID)
			assert.Equal(t, "completed", metadata.Outcome)
			assert.Equal(t, "ended", metadata.State)
			assert.NotEmpty(t, metadata.StartedAt)
			assert.NotEmpty(t, metadata.EndedAt)
			assert.GreaterOrEqual(t, metadata.DurationMs, int64(0))
			assert.GreaterOrEqual(t, metadata.ParticipantCount, int64(1))
			assert.Len(t, findMessagesWithCallID(messages, endedCall.Id), 1)
		})

		t.Run("completed calls are available as follow-up records", func(t *testing.T) {
			records := w.listCallRecords(alice, channelID)
			require.NotEmpty(t, records)
			require.NotNil(t, records[0].GetCall())
			assert.Equal(t, endedCall.Id, records[0].GetCall().GetId())
			assert.Equal(t, rpcv1.VoiceCallOutcome_VOICE_CALL_OUTCOME_COMPLETED, records[0].GetCall().GetOutcome())

			record := w.getCallRecord(bob, endedCall.Id)
			require.NotNil(t, record.GetCall())
			assert.Equal(t, endedCall.Id, record.GetCall().GetId())
			assert.Equal(t, channelID, record.GetCall().GetChannelId())
			assert.NotNil(t, record.GetCall().GetEndedAt())
		})

		t.Run("recording and transcript artifacts expose post-call availability states", func(t *testing.T) {
			recordingFileID := w.upsertCallArtifactFixture(endedCall.Id, "recording", "ready", "audio/ogg", 60_000, 96_000, true)
			w.upsertCallArtifactFixture(endedCall.Id, "transcript", "unavailable", "text/vtt", 0, 0, false)

			record := w.getCallRecord(alice, endedCall.Id)
			recording := findCallArtifact(record, rpcv1.VoiceArtifactType_VOICE_ARTIFACT_TYPE_RECORDING)
			require.NotNil(t, recording)
			assert.Equal(t, rpcv1.VoiceArtifactStatus_VOICE_ARTIFACT_STATUS_READY, recording.GetStatus())
			assert.Equal(t, recordingFileID, recording.GetFileId())
			assert.Equal(t, "audio/ogg", recording.GetMimeType())
			assert.Equal(t, int64(60_000), recording.GetDurationMs())

			transcript := findCallArtifact(record, rpcv1.VoiceArtifactType_VOICE_ARTIFACT_TYPE_TRANSCRIPT)
			require.NotNil(t, transcript)
			assert.Equal(t, rpcv1.VoiceArtifactStatus_VOICE_ARTIFACT_STATUS_UNAVAILABLE, transcript.GetStatus())

			_, _, storageBytes := w.getCallArtifactPersistence(endedCall.Id, "recording")
			rawPcmBaselineBytes := int64(60_000 / 1000 * 48_000 * 2)
			assert.Positive(t, storageBytes)
			assert.Less(t, storageBytes, rawPcmBaselineBytes)
		})
	})

	t.Run("when a recipient is invited while already in another call", func(t *testing.T) {
		firstChannelID := w.createChannel(owner, "Voice Existing Call Room", false)
		w.inviteToChannel(owner, firstChannelID, alice.ID)
		w.inviteToChannel(owner, firstChannelID, bob.ID)
		firstCall, _ := w.startVoiceCall(alice, firstChannelID)
		w.joinVoiceCall(bob, firstCall.Id)

		secondChannelID := w.createChannel(owner, "Voice Incoming Alert Room", false)
		w.inviteToChannel(owner, secondChannelID, bob.ID)
		w.inviteToChannel(owner, secondChannelID, charlie.ID)
		secondCall, _ := w.startVoiceCall(charlie, secondChannelID)

		_, invitations := w.inviteToVoiceCall(charlie, secondCall.Id, bob.ID.String())
		require.Len(t, invitations, 1)
		incomingNotification := w.waitForVoiceIncomingNotification(bob, secondCall.Id, invitations[0].Id, 5*time.Second)

		t.Run("a high-priority incoming-call alert arrives with switch context", func(t *testing.T) {
			actionData := incomingNotification.GetActionData()
			assert.Equal(t, "voice_call_incoming", incomingNotification.GetNotificationType())
			assert.Equal(t, "chat_voice_call_incoming", incomingNotification.GetPolicyKey())
			assert.Contains(t, incomingNotification.GetTitle(), "Test Employee")
			assert.Contains(t, incomingNotification.GetTitle(), "calling")
			assert.Contains(t, incomingNotification.GetMessage(), "Voice Incoming Alert Room")
			assert.Equal(t, "true", actionData["alreadyInAnotherCall"])
			assert.Equal(t, secondCall.Id, actionData["callId"])
			assert.Equal(t, invitations[0].Id, actionData["invitationId"])
			assert.Equal(t, secondChannelID, actionData["channelId"])
			assert.Equal(t, "Voice Incoming Alert Room", actionData["channelName"])
			assert.Equal(t, "chat", actionData["channelType"])
			assert.Equal(t, charlie.ID.String(), actionData["senderEmployeeId"])
			assert.Equal(t, "Test Employee", actionData["senderName"])

			payload := incomingNotification.GetPayload()
			require.NotNil(t, payload)
			assert.Equal(t, int32(1), payload.GetSchemaVersion())
			assert.Equal(t, incomingNotification.GetNotificationId(), payload.GetNotificationId())
			assert.Equal(t, incomingNotification.GetNotificationRecipientId(), payload.GetNotificationRecipientId())
			assert.Equal(t, "chat_voice_call_incoming", payload.GetPolicyKey())
			assert.Equal(t, "persistent", payload.GetDeliveryClass())
			require.NotNil(t, payload.GetChat())
			assert.Equal(t, secondChannelID, payload.GetChat().GetChannelId())
			assert.Equal(t, "Voice Incoming Alert Room", payload.GetChat().GetChannelName())
			require.NotNil(t, payload.GetVoiceCall())
			assert.Equal(t, secondCall.Id, payload.GetVoiceCall().GetCallId())
			assert.Equal(t, invitations[0].Id, payload.GetVoiceCall().GetInvitationId())
			assert.Equal(t, secondChannelID, payload.GetVoiceCall().GetChannelId())
			assert.Equal(t, charlie.ID.String(), payload.GetVoiceCall().GetSenderEmployeeId())
			assert.Equal(t, "Test Employee", payload.GetVoiceCall().GetSenderName())
			assert.True(t, payload.GetVoiceCall().GetAlreadyInAnotherCall())

			navigationTarget := incomingNotification.GetNavigationTarget()
			require.NotNil(t, navigationTarget)
			assert.Equal(t, "chat", navigationTarget.GetDomain())
			assert.Equal(t, "channel", navigationTarget.GetResourceType())
			assert.Equal(t, secondChannelID, navigationTarget.GetResourceId())
			assert.Equal(t, invitations[0].Id, navigationTarget.GetSecondaryId())
			assert.Equal(t, "join_voice_call", navigationTarget.GetAction())
			assert.Equal(t, int32(0), w.getNotificationPriority(incomingNotification.GetNotificationId()))
		})

		t.Run("staying declines the incoming invite without leaving the current call", func(t *testing.T) {
			declined, credentials := w.respondToVoiceCallInvite(bob, invitations[0].Id, rpcv1.VoiceInviteResponse_VOICE_INVITE_RESPONSE_DECLINE)
			assert.Equal(t, rpcv1.VoiceInvitationStatus_VOICE_INVITATION_STATUS_DECLINED, declined.GetStatus())
			assert.Nil(t, credentials)

			activeCall, hasActiveCall := w.getActiveVoiceCall(bob, firstChannelID)
			require.True(t, hasActiveCall)
			assert.Equal(t, firstCall.Id, activeCall.GetId())
		})

		t.Run("switching accepts a fresh invite and returns credentials for the incoming call", func(t *testing.T) {
			_, nextInvitations := w.inviteToVoiceCall(charlie, secondCall.Id, bob.ID.String())
			require.Len(t, nextInvitations, 1)
			accepted, credentials := w.respondToVoiceCallInvite(bob, nextInvitations[0].Id, rpcv1.VoiceInviteResponse_VOICE_INVITE_RESPONSE_ACCEPT)
			assert.Equal(t, rpcv1.VoiceInvitationStatus_VOICE_INVITATION_STATUS_ACCEPTED, accepted.GetStatus())
			require.NotNil(t, credentials)
			assert.NotEmpty(t, credentials.GetLivekitToken())

			incomingActiveCall, hasIncomingActiveCall := w.getActiveVoiceCall(bob, secondChannelID)
			require.True(t, hasIncomingActiveCall)
			assert.Equal(t, secondCall.Id, incomingActiveCall.GetId())
		})

		_ = w.leaveVoiceCall(bob, secondCall.Id)
		_ = w.leaveVoiceCall(charlie, secondCall.Id)
		_ = w.leaveVoiceCall(bob, firstCall.Id)
		_ = w.leaveVoiceCall(alice, firstCall.Id)
	})
}

func containsMessageText(messages []*rpcv1.Message, text string) bool {
	return findMessageWithText(messages, text) != nil
}

func findMessageWithText(messages []*rpcv1.Message, text string) *rpcv1.Message {
	for _, message := range messages {
		if message.GetMessageText() == text {
			return message
		}
	}
	return nil
}

func findMessagesWithCallID(messages []*rpcv1.Message, callID string) []*rpcv1.Message {
	var matches []*rpcv1.Message
	for _, message := range messages {
		var metadata struct {
			CallID string `json:"callId"`
		}
		if json.Unmarshal([]byte(message.GetMetadataJson()), &metadata) == nil && metadata.CallID == callID {
			matches = append(matches, message)
		}
	}
	return matches
}

func findCallArtifact(record *rpcv1.VoiceCallRecord, artifactType rpcv1.VoiceArtifactType) *rpcv1.VoiceCallArtifact {
	for _, artifact := range record.GetArtifacts() {
		if artifact.GetType() == artifactType {
			return artifact
		}
	}
	return nil
}

func findVoiceIncomingNotification(notifications []*rpcv1.NotificationSummary, callID, invitationID string) *rpcv1.NotificationSummary {
	for _, summary := range notifications {
		if summary.GetNotificationType() == "voice_call_incoming" && summary.GetActionData()["callId"] == callID && summary.GetActionData()["invitationId"] == invitationID {
			return summary
		}
	}
	return nil
}

func findVoiceIncomingNotificationForCall(notifications []*rpcv1.NotificationSummary, callID string) *rpcv1.NotificationSummary {
	for _, summary := range notifications {
		if summary.GetNotificationType() == "voice_call_incoming" && summary.GetActionData()["callId"] == callID {
			return summary
		}
	}
	return nil
}

func TestVoiceMessageUploadLifecycle(t *testing.T) {
	w := newTestWorld(t)
	owner := w.withOwner()
	members := w.withEmployees(2)
	alice := members[0]
	bob := members[1]

	t.Run("when an employee sends a voice message in a direct message", func(t *testing.T) {
		channelID := w.createOrGetDM(alice, bob.ID)
		content := []byte("voice-message-audio-bytes")
		dedupKey := fmt.Sprintf("voice-message-%d", time.Now().UnixNano())

		upload := w.requestVoiceMessageUpload(alice, channelID, dedupKey, "daily-update.webm", "audio/webm", int64(len(content)), 4200)

		t.Run("the upload request returns a stable voice message and file target", func(t *testing.T) {
			require.NotEmpty(t, upload.GetVoiceMessageId())
			require.NotEmpty(t, upload.GetFileId())
			require.NotEmpty(t, upload.GetUploadUrl())
			require.NotNil(t, upload.GetExpiresAt())
			assert.True(t, upload.GetExpiresAt().AsTime().After(time.Now()))
		})

		retryUpload := w.requestVoiceMessageUpload(alice, channelID, dedupKey, "daily-update.webm", "audio/webm", int64(len(content)), 4200)
		t.Run("retrying the upload request keeps the same voice message without duplicating it", func(t *testing.T) {
			assert.Equal(t, upload.GetVoiceMessageId(), retryUpload.GetVoiceMessageId())
			require.NotEmpty(t, retryUpload.GetFileId())
			require.NotEmpty(t, retryUpload.GetUploadUrl())
		})

		w.putUploadObject(retryUpload.GetUploadUrl(), "audio/webm", content)
		confirmed := w.confirmVoiceMessageUpload(alice, retryUpload.GetVoiceMessageId(), retryUpload.GetFileId(), dedupKey, 4200, []float32{0.1, 0.4, 0.3, 0.7})

		t.Run("confirmation stores playback metadata and sender identity", func(t *testing.T) {
			require.NotNil(t, confirmed)
			assert.Equal(t, retryUpload.GetVoiceMessageId(), confirmed.GetId())
			assert.Equal(t, channelID, confirmed.GetChannelId())
			assert.Equal(t, retryUpload.GetFileId(), confirmed.GetFileId())
			assert.Equal(t, alice.ID.String(), confirmed.GetSenderEmployeeId())
			assert.Equal(t, rpcv1.VoiceMessageStatus_VOICE_MESSAGE_STATUS_POSTED, confirmed.GetStatus())
			assert.Equal(t, int64(4200), confirmed.GetDurationMs())
			assert.Equal(t, "audio/webm", confirmed.GetMimeType())
			assert.Len(t, confirmed.GetWaveformPeaks(), 4)
		})

		t.Run("retrying confirmation returns the already posted voice message", func(t *testing.T) {
			retriedConfirm := w.confirmVoiceMessageUpload(alice, retryUpload.GetVoiceMessageId(), retryUpload.GetFileId(), dedupKey, 4200, []float32{0.1, 0.4})
			assert.Equal(t, confirmed.GetId(), retriedConfirm.GetId())
			assert.Equal(t, confirmed.GetMessageId(), retriedConfirm.GetMessageId())
			assert.Equal(t, rpcv1.VoiceMessageStatus_VOICE_MESSAGE_STATUS_POSTED, retriedConfirm.GetStatus())
		})

		t.Run("another participant can see a playable timeline item within ten seconds", func(t *testing.T) {
			var timelineMessage *rpcv1.Message
			require.Eventually(t, func() bool {
				messages := w.listMessages(bob, channelID)
				timelineMessage = findMessageWithFile(messages, retryUpload.GetFileId())
				return timelineMessage != nil && timelineMessage.GetMessageText() == "Voice message"
			}, 10*time.Second, 250*time.Millisecond)
			assert.Equal(t, confirmed.GetMessageId(), timelineMessage.GetId())
			assert.Equal(t, alice.ID.String(), timelineMessage.GetAuthorEmployeeId())
			assert.Equal(t, "voice", timelineMessage.GetMessageKind())
			assert.Empty(t, timelineMessage.GetSystemEventType())

			var metadata struct {
				VoiceMessageID string    `json:"voiceMessageId"`
				DurationMs     int64     `json:"durationMs"`
				MimeType       string    `json:"mimeType"`
				WaveformPeaks  []float64 `json:"waveformPeaks"`
				SizeBytes      int64     `json:"sizeBytes"`
				Status         string    `json:"status"`
			}
			require.NoError(t, json.Unmarshal([]byte(timelineMessage.GetMetadataJson()), &metadata))
			assert.Equal(t, confirmed.GetId(), metadata.VoiceMessageID)
			assert.Equal(t, int64(4200), metadata.DurationMs)
			assert.Equal(t, "audio/webm", metadata.MimeType)
			assert.Equal(t, int64(len(content)), metadata.SizeBytes)
			assert.Equal(t, "posted", metadata.Status)
			require.Len(t, metadata.WaveformPeaks, 4)
			assert.InDelta(t, 0.1, metadata.WaveformPeaks[0], 0.001)
			assert.InDelta(t, 0.7, metadata.WaveformPeaks[3], 0.001)
		})

		t.Run("the persisted row keeps storage-size metadata", func(t *testing.T) {
			status, messageID, fileID, durationMs, sizeBytes := w.getVoiceMessagePersistence(confirmed.GetId())
			assert.Equal(t, "posted", status)
			assert.Equal(t, confirmed.GetMessageId(), messageID)
			assert.Equal(t, retryUpload.GetFileId(), fileID)
			assert.Equal(t, int64(4200), durationMs)
			assert.Equal(t, int64(len(content)), sizeBytes)
		})
	})

	t.Run("when a voice message is cancelled before send", func(t *testing.T) {
		channelID := w.createChannel(owner, "Voice Message Cancel Room", true)
		w.inviteToChannel(owner, channelID, alice.ID)
		dedupKey := fmt.Sprintf("voice-cancel-%d", time.Now().UnixNano())
		upload := w.requestVoiceMessageUpload(alice, channelID, dedupKey, "cancelled.ogg", "audio/ogg", 18, 1800)

		cancelled := w.cancelVoiceMessage(alice, upload.GetVoiceMessageId())
		t.Run("the upload is marked cancelled", func(t *testing.T) {
			assert.Equal(t, rpcv1.VoiceMessageStatus_VOICE_MESSAGE_STATUS_CANCELLED, cancelled.GetStatus())
			status, messageID, _, _, _ := w.getVoiceMessagePersistence(upload.GetVoiceMessageId())
			assert.Equal(t, "cancelled", status)
			assert.Empty(t, messageID)
		})

		t.Run("no partial voice message is posted to the room", func(t *testing.T) {
			messages := w.listMessages(alice, channelID)
			assert.Nil(t, findMessageWithFile(messages, upload.GetFileId()))
		})

		t.Run("a cancelled upload cannot be confirmed later", func(t *testing.T) {
			err := w.confirmVoiceMessageUploadError(alice, upload.GetVoiceMessageId(), upload.GetFileId(), dedupKey, 1800, []float32{0.2})
			require.Error(t, err)
			assert.Equal(t, connect.CodeFailedPrecondition, connect.CodeOf(err))
		})
	})

	t.Run("when upload metadata is invalid or conflicts with a retry key", func(t *testing.T) {
		channelID := w.createChannel(owner, "Voice Message Guard Room", false)
		badMIMEErr := w.requestVoiceMessageUploadError(owner, channelID, "bad-mime", "note.txt", "text/plain", 10, 1000)
		require.Error(t, badMIMEErr)
		assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(badMIMEErr))

		dedupKey := fmt.Sprintf("voice-conflict-%d", time.Now().UnixNano())
		first := w.requestVoiceMessageUpload(owner, channelID, dedupKey, "first.mp4", "audio/mp4", 20, 2000)
		require.NotEmpty(t, first.GetVoiceMessageId())
		conflictErr := w.requestVoiceMessageUploadError(owner, channelID, dedupKey, "different.mp4", "audio/mp4", 21, 2000)
		require.Error(t, conflictErr)
		assert.Equal(t, connect.CodeAlreadyExists, connect.CodeOf(conflictErr))
	})
}

func findMessageWithFile(messages []*rpcv1.Message, fileID string) *rpcv1.Message {
	for _, message := range messages {
		for _, messageFileID := range message.GetFileIds() {
			if messageFileID == fileID {
				return message
			}
		}
	}
	return nil
}

func (w *testWorld) waitForVoiceIncomingNotification(actor testUser, callID, invitationID string, timeout time.Duration) *rpcv1.NotificationSummary {
	w.t.Helper()
	var notificationSummary *rpcv1.NotificationSummary
	require.Eventually(w.t, func() bool {
		notificationSummary = findVoiceIncomingNotification(w.listNotifications(actor, false), callID, invitationID)
		return notificationSummary != nil
	}, timeout, 200*time.Millisecond)
	return notificationSummary
}

func (w *testWorld) waitForVoiceIncomingNotificationForCall(actor testUser, callID string, timeout time.Duration) *rpcv1.NotificationSummary {
	w.t.Helper()
	var notificationSummary *rpcv1.NotificationSummary
	require.Eventually(w.t, func() bool {
		notificationSummary = findVoiceIncomingNotificationForCall(w.listNotifications(actor, false), callID)
		return notificationSummary != nil
	}, timeout, 200*time.Millisecond)
	return notificationSummary
}

func (w *testWorld) waitForVoiceNotificationStreamEvent(stream *connect.ServerStreamForClient[rpcv1.NotificationEvent], notificationType, callID string) *rpcv1.NotificationSummary {
	w.t.Helper()
	for {
		event := w.receiveNextNotificationEvent(stream)
		notificationSummary := event.GetNotification()
		if notificationSummary.GetNotificationType() == notificationType && notificationSummary.GetActionData()["callId"] == callID {
			return notificationSummary
		}
	}
}

func (w *testWorld) waitForNotificationAcknowledgement(actor testUser, notificationID string) *rpcv1.NotificationSummary {
	w.t.Helper()
	var notificationSummary *rpcv1.NotificationSummary
	require.Eventually(w.t, func() bool {
		notificationSummary = findNotification(w.listNotifications(actor, false), notificationID)
		return notificationSummary != nil && notificationSummary.GetAcknowledgementStatus() == "acknowledged"
	}, 5*time.Second, 200*time.Millisecond)
	return notificationSummary
}

func (w *testWorld) expireVoiceInvitation(invitationID string) {
	w.t.Helper()
	parsedID, err := dbuuid.Parse(invitationID)
	require.NoError(w.t, err)
	_, err = globalDB.Exec(context.Background(), `
UPDATE voice.call_invitation
SET expires_at = now() - interval '1 second'
WHERE organization_id = $1 AND id = $2`, w.OrgID, parsedID)
	require.NoError(w.t, err)
}

func (w *testWorld) getNotificationPriority(notificationID string) int32 {
	w.t.Helper()
	parsedID, err := dbuuid.Parse(notificationID)
	require.NoError(w.t, err)
	var priority int32
	err = globalDB.QueryRow(context.Background(), `
SELECT priority
FROM notification.notification
WHERE organization_id = $1 AND id = $2`, w.OrgID, parsedID).Scan(&priority)
	require.NoError(w.t, err)
	return priority
}

func (w *testWorld) upsertCallArtifactFixture(callID, artifactType, status, mimeType string, durationMs, storageBytes int64, withFile bool) string {
	w.t.Helper()
	callUUID, err := dbuuid.Parse(callID)
	require.NoError(w.t, err)
	var fileArg any
	fileID := ""
	if withFile {
		parsedFileID := dbuuid.Must()
		var uploaderEmployeeID dbuuid.UUID
		err = globalDB.QueryRow(context.Background(), `
SELECT initiator_employee_id
FROM voice.call_session
WHERE organization_id = $1 AND id = $2`, w.OrgID, callUUID).Scan(&uploaderEmployeeID)
		require.NoError(w.t, err)

		fileSizeBytes := storageBytes
		if fileSizeBytes <= 0 {
			fileSizeBytes = 1
		}
		_, err = globalDB.Exec(context.Background(), `
INSERT INTO files.file_metadata (
    organization_id, id, original_filename, storage_key, size_bytes, mime_type,
    upload_context, uploaded_by_employee_id, validation_status
) VALUES ($1, $2, $3, $4, $5, $6, 'chat', $7, 'verified')`,
			w.OrgID,
			parsedFileID,
			fmt.Sprintf("voice-call-artifact-%s.ogg", parsedFileID.String()),
			fmt.Sprintf("org-%s/voice-artifacts/%s", w.OrgID.String(), parsedFileID.String()),
			fileSizeBytes,
			mimeType,
			uploaderEmployeeID,
		)
		require.NoError(w.t, err)
		fileArg = parsedFileID
		fileID = parsedFileID.String()
	}
	_, err = globalDB.Exec(context.Background(), `
INSERT INTO voice.call_artifact (
    organization_id, id, call_session_id, artifact_type, status, file_id, mime_type,
    duration_ms, storage_bytes, provider, provider_job_id, updated_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, NULLIF($8, 0), NULLIF($9, 0), $10, $11, now())
ON CONFLICT (organization_id, call_session_id, artifact_type)
DO UPDATE SET
    status = EXCLUDED.status,
    file_id = EXCLUDED.file_id,
    mime_type = EXCLUDED.mime_type,
    duration_ms = EXCLUDED.duration_ms,
    storage_bytes = EXCLUDED.storage_bytes,
    provider = EXCLUDED.provider,
    provider_job_id = EXCLUDED.provider_job_id,
	updated_at = EXCLUDED.updated_at`, w.OrgID, dbuuid.Must(), callUUID, artifactType, status, fileArg, mimeType, durationMs, storageBytes, artifactProviderForFixture(artifactType), "fixture")
	require.NoError(w.t, err)
	rollupColumn := "recording_status"
	if artifactType == "transcript" {
		rollupColumn = "transcript_status"
	}
	_, err = globalDB.Exec(context.Background(), fmt.Sprintf(`
UPDATE voice.call_session
SET %s = $1, updated_at = now()
WHERE organization_id = $2 AND id = $3`, rollupColumn), status, w.OrgID, callUUID)
	require.NoError(w.t, err)
	return fileID
}

func (w *testWorld) getCallArtifactPersistence(callID, artifactType string) (status, mimeType string, storageBytes int64) {
	w.t.Helper()
	callUUID, err := dbuuid.Parse(callID)
	require.NoError(w.t, err)
	err = globalDB.QueryRow(context.Background(), `
SELECT status, COALESCE(mime_type, ''), COALESCE(storage_bytes, 0)
FROM voice.call_artifact
WHERE organization_id = $1 AND call_session_id = $2 AND artifact_type = $3`, w.OrgID, callUUID, artifactType).Scan(&status, &mimeType, &storageBytes)
	require.NoError(w.t, err)
	return status, mimeType, storageBytes
}

func artifactProviderForFixture(artifactType string) string {
	if artifactType == "transcript" {
		return "transcription_worker"
	}
	return "livekit_egress"
}
