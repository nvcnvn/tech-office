package integration

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/nvcnvn/tech-office/backend/internal/chat"
	"github.com/nvcnvn/tech-office/backend/internal/notification"
	"github.com/nvcnvn/tech-office/backend/internal/voice"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestVoiceConstantSync(t *testing.T) {
	t.Parallel()
	schemaSQL := readProjectFile(t, "backend/database/scripts/schema.sql")
	voiceAPI := readProjectFile(t, "frontend/packages/apis/src/voice.ts")
	chatAPI := readProjectFile(t, "frontend/packages/apis/src/chat.ts")
	notificationAPI := readProjectFile(t, "frontend/packages/apis/src/notification.ts")

	t.Run("when checking voice call states", func(t *testing.T) {
		values := []string{"ringing", "active", "ending", "ended"}
		assert.ElementsMatch(t, values, []string{
			voice.CallStateRinging,
			voice.CallStateActive,
			voice.CallStateEnding,
			voice.CallStateEnded,
		})
		assert.Equal(t, len(values)+1, len(rpcv1.VoiceCallState_name))
		assertContainsAll(t, schemaSQL, values)
		assertContainsAll(t, voiceAPI, values)
	})

	t.Run("when checking voice call outcomes", func(t *testing.T) {
		values := []string{"answered", "missed", "declined", "cancelled", "completed"}
		assert.ElementsMatch(t, values, []string{
			voice.CallOutcomeAnswered,
			voice.CallOutcomeMissed,
			voice.CallOutcomeDeclined,
			voice.CallOutcomeCancelled,
			voice.CallOutcomeCompleted,
		})
		assert.Equal(t, len(values)+1, len(rpcv1.VoiceCallOutcome_name))
		assertContainsAll(t, schemaSQL, values)
		assertContainsAll(t, voiceAPI, values)
	})

	t.Run("when checking voice participant states", func(t *testing.T) {
		values := []string{"invited", "ringing", "joining", "joined", "disconnected", "left", "declined", "removed"}
		assert.ElementsMatch(t, values, []string{
			voice.ParticipantStateInvited,
			voice.ParticipantStateRinging,
			voice.ParticipantStateJoining,
			voice.ParticipantStateJoined,
			voice.ParticipantStateDisconnected,
			voice.ParticipantStateLeft,
			voice.ParticipantStateDeclined,
			voice.ParticipantStateRemoved,
		})
		assert.Equal(t, len(values)+1, len(rpcv1.VoiceCallParticipantState_name))
		assertContainsAll(t, schemaSQL, values)
		assertContainsAll(t, voiceAPI, values)
	})

	t.Run("when checking voice invitation statuses", func(t *testing.T) {
		values := []string{"pending", "accepted", "declined", "expired", "revoked"}
		assert.ElementsMatch(t, values, []string{
			voice.InvitationStatusPending,
			voice.InvitationStatusAccepted,
			voice.InvitationStatusDeclined,
			voice.InvitationStatusExpired,
			voice.InvitationStatusRevoked,
		})
		assert.Equal(t, len(values)+1, len(rpcv1.VoiceInvitationStatus_name))
		assertContainsAll(t, schemaSQL, values)
		assertContainsAll(t, voiceAPI, values)
	})

	t.Run("when checking voice artifact values", func(t *testing.T) {
		artifactTypes := []string{"recording", "transcript"}
		artifactStatuses := []string{"pending", "processing", "ready", "unavailable", "failed"}
		assert.ElementsMatch(t, artifactTypes, []string{voice.ArtifactTypeRecording, voice.ArtifactTypeTranscript})
		assert.ElementsMatch(t, artifactStatuses, []string{
			voice.ArtifactStatusPending,
			voice.ArtifactStatusProcessing,
			voice.ArtifactStatusReady,
			voice.ArtifactStatusUnavailable,
			voice.ArtifactStatusFailed,
		})
		assert.Equal(t, len(artifactTypes)+1, len(rpcv1.VoiceArtifactType_name))
		assert.Equal(t, len(artifactStatuses)+1, len(rpcv1.VoiceArtifactStatus_name))
		assertContainsAll(t, schemaSQL, artifactTypes)
		assertContainsAll(t, schemaSQL, artifactStatuses)
		assertContainsAll(t, voiceAPI, artifactTypes)
		assertContainsAll(t, voiceAPI, artifactStatuses)
	})

	t.Run("when checking voice message statuses", func(t *testing.T) {
		values := []string{"requested", "uploading", "posted", "failed", "cancelled"}
		assert.ElementsMatch(t, values, []string{
			voice.VoiceMessageStatusRequested,
			voice.VoiceMessageStatusUploading,
			voice.VoiceMessageStatusPosted,
			voice.VoiceMessageStatusFailed,
			voice.VoiceMessageStatusCancelled,
		})
		assert.Equal(t, len(values)+1, len(rpcv1.VoiceMessageStatus_name))
		assertContainsAll(t, schemaSQL, values)
		assertContainsAll(t, voiceAPI, values)
	})

	t.Run("when checking voice notification constants", func(t *testing.T) {
		values := []string{"voice_call_incoming", "voice_call_started", "voice_call_updated", "voice_call_ended"}
		assert.ElementsMatch(t, values, []string{
			notification.NotificationTypeVoiceCallIncoming,
			notification.NotificationTypeVoiceCallStarted,
			notification.NotificationTypeVoiceCallUpdated,
			notification.NotificationTypeVoiceCallEnded,
		})
		assertContainsAll(t, schemaSQL, values)
		assertContainsAll(t, notificationAPI, values)
	})

	t.Run("when checking voice notification policy keys", func(t *testing.T) {
		values := []string{"chat_voice_call_incoming", "chat_voice_call_live", "chat_voice_call_record"}
		for _, value := range values {
			assert.True(t, notification.IsValidPolicyKey(value), "policy key should be valid: %s", value)
		}
		assertContainsAll(t, schemaSQL, values)
		assertContainsAll(t, notificationAPI, values)
	})

	t.Run("when checking chat voice message metadata constants", func(t *testing.T) {
		messageKinds := []string{"text", "voice", "system"}
		systemEventTypes := []string{"voice_call_started", "voice_call_ended", "voice_call_missed", "voice_call_cancelled"}
		assert.ElementsMatch(t, messageKinds, []string{chat.MessageKindText, chat.MessageKindVoice, chat.MessageKindSystem})
		assert.ElementsMatch(t, systemEventTypes, []string{
			chat.SystemEventTypeVoiceCallStarted,
			chat.SystemEventTypeVoiceCallEnded,
			chat.SystemEventTypeVoiceCallMissed,
			chat.SystemEventTypeVoiceCallCancelled,
		})
		assertContainsAll(t, schemaSQL, messageKinds)
		assertContainsAll(t, schemaSQL, systemEventTypes)
		assertContainsAll(t, chatAPI, messageKinds)
		assertContainsAll(t, chatAPI, systemEventTypes)
	})
}

func readProjectFile(t *testing.T, relativePath string) string {
	t.Helper()
	_, currentFile, _, ok := runtime.Caller(0)
	require.True(t, ok)
	projectRoot := filepath.Clean(filepath.Join(filepath.Dir(currentFile), "..", ".."))
	data, err := os.ReadFile(filepath.Join(projectRoot, relativePath))
	require.NoError(t, err)
	return string(data)
}

func assertContainsAll(t *testing.T, content string, values []string) {
	t.Helper()
	for _, value := range values {
		assert.Contains(t, content, value)
	}
}
