// Package voice defines voice communication service constants.
// Values in this package must stay aligned with schema CHECK constraints,
// rpc/v1/voice.proto enums, and frontend TypeScript API unions.
package voice

import "time"

const DefaultMaxParticipants = 25

const (
	MaxVoiceMessageSizeBytes  = 25 * 1024 * 1024
	MaxVoiceMessageDurationMs = 10 * 60 * 1000
)
const DefaultInvitationTTL = 2 * time.Minute

// RingTimeout bounds how long an unanswered call rings.
//
// Before Feature 037 nothing bounded it: a ringing call ended only when LiveKit
// reported the room finished, and with no participant ever joining, that never came.
// The spec requires a bounded ring but names no value; 45 seconds is the conventional
// VoIP ring length — long enough to reach a phone in a pocket, short enough that a
// caller is not left listening to a ring nobody will answer.
//
// Defined once and used in three places that must agree: the ring_deadline_at written
// on the transition into 'ringing', the sweep that ends calls past that deadline, and
// the ringExpiresAt carried to devices in the call wake payload.
const RingTimeout = 45 * time.Second

const (
	CallStateRinging = "ringing"
	CallStateActive  = "active"
	CallStateEnding  = "ending"
	CallStateEnded   = "ended"
)

var callStates = map[string]struct{}{
	CallStateRinging: {},
	CallStateActive:  {},
	CallStateEnding:  {},
	CallStateEnded:   {},
}

func IsValidCallState(state string) bool {
	_, ok := callStates[state]
	return ok
}

func IsActiveCallState(state string) bool {
	switch state {
	case CallStateRinging, CallStateActive, CallStateEnding:
		return true
	default:
		return false
	}
}

const (
	CallOutcomeAnswered  = "answered"
	CallOutcomeMissed    = "missed"
	CallOutcomeDeclined  = "declined"
	CallOutcomeCancelled = "cancelled"
	CallOutcomeCompleted = "completed"
)

var callOutcomes = map[string]struct{}{
	CallOutcomeAnswered:  {},
	CallOutcomeMissed:    {},
	CallOutcomeDeclined:  {},
	CallOutcomeCancelled: {},
	CallOutcomeCompleted: {},
}

func IsValidCallOutcome(outcome string) bool {
	_, ok := callOutcomes[outcome]
	return ok
}

const (
	ParticipantStateInvited      = "invited"
	ParticipantStateRinging      = "ringing"
	ParticipantStateJoining      = "joining"
	ParticipantStateJoined       = "joined"
	ParticipantStateDisconnected = "disconnected"
	ParticipantStateLeft         = "left"
	ParticipantStateDeclined     = "declined"
	ParticipantStateRemoved      = "removed"
)

var participantStates = map[string]struct{}{
	ParticipantStateInvited:      {},
	ParticipantStateRinging:      {},
	ParticipantStateJoining:      {},
	ParticipantStateJoined:       {},
	ParticipantStateDisconnected: {},
	ParticipantStateLeft:         {},
	ParticipantStateDeclined:     {},
	ParticipantStateRemoved:      {},
}

func IsValidParticipantState(state string) bool {
	_, ok := participantStates[state]
	return ok
}

func IsTerminalParticipantState(state string) bool {
	switch state {
	case ParticipantStateLeft, ParticipantStateDeclined, ParticipantStateRemoved:
		return true
	default:
		return false
	}
}

const (
	InvitationStatusPending  = "pending"
	InvitationStatusAccepted = "accepted"
	InvitationStatusDeclined = "declined"
	InvitationStatusExpired  = "expired"
	InvitationStatusRevoked  = "revoked"
)

var invitationStatuses = map[string]struct{}{
	InvitationStatusPending:  {},
	InvitationStatusAccepted: {},
	InvitationStatusDeclined: {},
	InvitationStatusExpired:  {},
	InvitationStatusRevoked:  {},
}

func IsValidInvitationStatus(status string) bool {
	_, ok := invitationStatuses[status]
	return ok
}

const (
	ArtifactTypeRecording  = "recording"
	ArtifactTypeTranscript = "transcript"
)

var artifactTypes = map[string]struct{}{
	ArtifactTypeRecording:  {},
	ArtifactTypeTranscript: {},
}

func IsValidArtifactType(artifactType string) bool {
	_, ok := artifactTypes[artifactType]
	return ok
}

const (
	ArtifactStatusPending     = "pending"
	ArtifactStatusProcessing  = "processing"
	ArtifactStatusReady       = "ready"
	ArtifactStatusUnavailable = "unavailable"
	ArtifactStatusFailed      = "failed"
)

var artifactStatuses = map[string]struct{}{
	ArtifactStatusPending:     {},
	ArtifactStatusProcessing:  {},
	ArtifactStatusReady:       {},
	ArtifactStatusUnavailable: {},
	ArtifactStatusFailed:      {},
}

func IsValidArtifactStatus(status string) bool {
	_, ok := artifactStatuses[status]
	return ok
}

const (
	ArtifactProviderLiveKitEgress       = "livekit_egress"
	ArtifactProviderTranscriptionWorker = "transcription_worker"
)

const (
	VoiceMessageStatusRequested = "requested"
	VoiceMessageStatusUploading = "uploading"
	VoiceMessageStatusPosted    = "posted"
	VoiceMessageStatusFailed    = "failed"
	VoiceMessageStatusCancelled = "cancelled"
)

var voiceMessageStatuses = map[string]struct{}{
	VoiceMessageStatusRequested: {},
	VoiceMessageStatusUploading: {},
	VoiceMessageStatusPosted:    {},
	VoiceMessageStatusFailed:    {},
	VoiceMessageStatusCancelled: {},
}

func IsValidVoiceMessageStatus(status string) bool {
	_, ok := voiceMessageStatuses[status]
	return ok
}

const (
	AudioCodecOpus = "opus"
	AudioCodecAAC  = "aac"
)

const (
	MIMETypeAudioWebM = "audio/webm"
	MIMETypeAudioOgg  = "audio/ogg"
	MIMETypeAudioMP4  = "audio/mp4"
	MIMETypeAudioMPEG = "audio/mpeg"
	MIMETypeAudioWAV  = "audio/wav"
)

var voiceMessageMIMETypes = map[string]struct{}{
	MIMETypeAudioWebM: {},
	MIMETypeAudioOgg:  {},
	MIMETypeAudioMP4:  {},
	MIMETypeAudioMPEG: {},
	MIMETypeAudioWAV:  {},
}

func IsAllowedVoiceMessageMIMEType(mimeType string) bool {
	_, ok := voiceMessageMIMETypes[mimeType]
	return ok
}
