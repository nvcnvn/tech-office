// Package chat defines chat service constants.
// All channel type and notification preference values MUST align with:
// - Database CHECK constraints: chat.channel.channel_type, chat.channel_membership.notification_preference
// - Proto enums: rpc.v1.ChannelType, rpc.v1.NotificationPreference
// - Frontend TypeScript types: packages/apis/src/chat.ts
//
// When adding/removing values:
// 1. Update database CHECK constraint in backend/database/scripts/schema.sql
// 2. Update these Go constants
// 3. Update proto enums in backend/rpc/v1/chat.proto
// 4. Update frontend TypeScript types
// 5. Submit all changes in single PR with alignment verification
package chat

import (
	"errors"

	"github.com/nvcnvn/tech-office/backend/internal/notification"
)

// Re-export notification type constants for chat domain use.
// Chat service publishes these notification types.
const (
	NotificationTypeMessage  = notification.NotificationTypeMessage
	NotificationTypeMention  = notification.NotificationTypeMention
	NotificationTypeReply    = notification.NotificationTypeReply
	NotificationTypeTyping   = notification.NotificationTypeTyping
	NotificationTypeReaction = notification.NotificationTypeReaction

	NotificationTypeVoiceCallIncoming = notification.NotificationTypeVoiceCallIncoming
	NotificationTypeVoiceCallStarted  = notification.NotificationTypeVoiceCallStarted
	NotificationTypeVoiceCallUpdated  = notification.NotificationTypeVoiceCallUpdated
	NotificationTypeVoiceCallEnded    = notification.NotificationTypeVoiceCallEnded
)

// Re-export source domain constant for chat service.
const SourceDomain = notification.SourceDomainChat

// ChannelType defines allowed channel types.
// These MUST match the database CHECK constraint in chat.channel table.
const (
	ChannelTypeChat                = "chat"
	ChannelTypeDirectMessage       = "direct_message"
	ChannelTypeProjectTicketThread = "project_ticket_thread"
	ChannelTypeCRMDealNotes        = "crm_deal_notes"
	ChannelTypeSupportTicket       = "support_ticket"
)

// IsValidChannelType checks if a channel type string is valid.
func IsValidChannelType(channelType string) bool {
	switch channelType {
	case ChannelTypeChat,
		ChannelTypeDirectMessage,
		ChannelTypeProjectTicketThread,
		ChannelTypeCRMDealNotes,
		ChannelTypeSupportTicket:
		return true
	default:
		return false
	}
}

// NotificationPreference defines allowed per-channel notification preferences.
// These MUST match the database CHECK constraint in chat.channel_membership table.
const (
	NotificationPreferenceAll      = "all"      // Notify on all messages
	NotificationPreferenceMentions = "mentions" // Only @mentions
	NotificationPreferenceMuted    = "muted"    // No notifications
)

// IsValidNotificationPreference checks if a preference string is valid.
func IsValidNotificationPreference(pref string) bool {
	switch pref {
	case NotificationPreferenceAll,
		NotificationPreferenceMentions,
		NotificationPreferenceMuted:
		return true
	default:
		return false
	}
}

// MessageKind defines the supported chat.message kinds.
const (
	MessageKindText   = "text"
	MessageKindVoice  = "voice"
	MessageKindSystem = "system"
)

func IsValidMessageKind(kind string) bool {
	switch kind {
	case MessageKindText,
		MessageKindVoice,
		MessageKindSystem:
		return true
	default:
		return false
	}
}

// SystemEventType defines supported chat.message system event types.
const (
	SystemEventTypeVoiceCallStarted   = "voice_call_started"
	SystemEventTypeVoiceCallEnded     = "voice_call_ended"
	SystemEventTypeVoiceCallMissed    = "voice_call_missed"
	SystemEventTypeVoiceCallCancelled = "voice_call_cancelled"

	// SystemEventTypeTaskCreatedFromMessage marks the threaded, non-notifying reply left
	// on a message that was turned into a task (Feature 038). Chat writes the row and
	// knows nothing else about tasks: the identifier and title travel in the message
	// metadata, and the access-filtered task data behind the chip comes from
	// CollaborationService.ListTasksBySourceMessages, never from here.
	SystemEventTypeTaskCreatedFromMessage = "task_created_from_message"
)

func IsValidSystemEventType(eventType string) bool {
	switch eventType {
	case SystemEventTypeVoiceCallStarted,
		SystemEventTypeVoiceCallEnded,
		SystemEventTypeVoiceCallMissed,
		SystemEventTypeVoiceCallCancelled,
		SystemEventTypeTaskCreatedFromMessage:
		return true
	default:
		return false
	}
}

// ErrDirectContactBlocked is returned when a block refuses direct contact. Its
// text names neither party and does not say a block exists: the blocked person
// must never learn they were blocked (Feature 036, FR-022).
var ErrDirectContactBlocked = errors.New("this conversation is not available")
