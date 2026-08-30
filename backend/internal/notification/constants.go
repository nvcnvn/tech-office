// Package notification defines notification service constants.
// All notification types and source domains MUST align with:
// - Database CHECK constraints: notification.notification.notification_type, notification.notification.source_domain
// - Frontend TypeScript types: NotificationType union type in packages/apis/src/notifications.ts
// - API contract: NotificationEvent.notification_type field
//
// When adding/removing values:
// 1. Update the database CHECK constraint with a migration in backend/database/migrations/
// 2. Update these Go constants
// 3. Update frontend TypeScript types in packages/apis/src/notifications.ts
// 4. Submit all changes in single PR with alignment verification
package notification

import (
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// NotificationType defines allowed notification types.
// These MUST match the database CHECK constraint in notification.notification table.
const (
	NotificationTypeMessage  = "message"
	NotificationTypeMention  = "mention"
	NotificationTypeReply    = "reply"
	NotificationTypeTyping   = "typing"
	NotificationTypeReaction = "reaction"

	NotificationTypeVoiceCallIncoming = "voice_call_incoming"
	NotificationTypeVoiceCallStarted  = "voice_call_started"
	NotificationTypeVoiceCallUpdated  = "voice_call_updated"
	NotificationTypeVoiceCallEnded    = "voice_call_ended"

	NotificationTypeTaskAssigned            = "task_assigned"
	NotificationTypeTaskStatusChanged       = "task_status_changed"
	NotificationTypeTaskCommented           = "task_commented"
	NotificationTypeTaskMentioned           = "task_mentioned"
	NotificationTypeTaskDescriptionModified = "task_description_modified"
	NotificationTypeTaskUpdated             = "task_updated"

	NotificationTypeDocUpdated   = "doc_updated"
	NotificationTypeDocCommented = "doc_commented"
	NotificationTypeDocMentioned = "doc_mentioned"

	NotificationTypeCalendarEventInvite   = "calendar_event_invite"
	NotificationTypeCalendarEventCancel   = "calendar_event_cancel"
	NotificationTypeCalendarEventChange   = "calendar_event_change"
	NotificationTypeCalendarEventReminder = "calendar_event_reminder"
	NotificationTypeCalendarCheckInMissed = "calendar_check_in_missed"
	NotificationTypeCalendarEventDigest   = "calendar_event_digest"

	// NotificationTypeRitualInstancesScheduled is sent once per assignee at the end of a
	// bulk generation run. It summarises all instances created in that run, replacing the
	// previous per-instance ritual_instance_assigned flood.
	NotificationTypeRitualInstancesScheduled = "ritual_instances_scheduled"

	// Evidence notifications are published by internal/collaboration when a ritual's
	// evidence requirement is submitted for review, approved or rejected. They live here
	// rather than in collaboration because this list is the contract the database CHECK
	// on notification.notification.notification_type is asserted against.
	NotificationTypeEvidenceSubmitted = "evidence_submitted"
	NotificationTypeEvidenceApproved  = "evidence_approved"
	NotificationTypeEvidenceRejected  = "evidence_rejected"

	// NotificationTypeAccountRemovalRequested reaches an organization's owners when
	// an admin-provisioned worker asks in-app to be removed (Feature 036, FR-007c).
	// The in-app request is what makes that path compliant rather than the
	// "contact your administrator" dead end both stores reject.
	NotificationTypeAccountRemovalRequested = "account_removal_requested"
)

// Resource subscription constants align with:
// - Database CHECK constraints on notification.resource_subscription*
// - Database CHECK constraints on notification.resource_surface*
const (
	ResourceDomainTask          = "task"
	ResourceDomainDocument      = "document"
	ResourceDomainChannel       = "channel"
	ResourceDomainCalendarEvent = "calendar_event"
)

var resourceDomains = map[string]struct{}{
	ResourceDomainTask:          {},
	ResourceDomainDocument:      {},
	ResourceDomainChannel:       {},
	ResourceDomainCalendarEvent: {},
}

// IsValidResourceDomain returns true when the provided V2 resource domain is supported.
func IsValidResourceDomain(domain string) bool {
	_, ok := resourceDomains[domain]
	return ok
}

const (
	ResourceSubscriptionStateActive     = "active"
	ResourceSubscriptionStateUnfollowed = "unfollowed"
)

var resourceSubscriptionStates = map[string]struct{}{
	ResourceSubscriptionStateActive:     {},
	ResourceSubscriptionStateUnfollowed: {},
}

// IsValidResourceSubscriptionState returns true when the subscription state matches schema constraints.
func IsValidResourceSubscriptionState(state string) bool {
	_, ok := resourceSubscriptionStates[state]
	return ok
}

const (
	ResourceSubscriptionReasonCreator      = "creator"
	ResourceSubscriptionReasonReporter     = "reporter"
	ResourceSubscriptionReasonAssignee     = "assignee"
	ResourceSubscriptionReasonManualFollow = "manual_follow"
	ResourceSubscriptionReasonCommented    = "commented"
	ResourceSubscriptionReasonMentioned    = "mentioned_auto"
	ResourceSubscriptionReasonSystem       = "system"
)

var resourceSubscriptionReasonTypes = map[string]struct{}{
	ResourceSubscriptionReasonCreator:      {},
	ResourceSubscriptionReasonReporter:     {},
	ResourceSubscriptionReasonAssignee:     {},
	ResourceSubscriptionReasonManualFollow: {},
	ResourceSubscriptionReasonCommented:    {},
	ResourceSubscriptionReasonMentioned:    {},
	ResourceSubscriptionReasonSystem:       {},
}

// IsValidResourceSubscriptionReasonType returns true when the reason type matches schema constraints.
func IsValidResourceSubscriptionReasonType(reasonType string) bool {
	_, ok := resourceSubscriptionReasonTypes[reasonType]
	return ok
}

const (
	ResourceSurfaceTypeTaskDiscussion   = "task_discussion"
	ResourceSurfaceTypeTaskDescription  = "task_description"
	ResourceSurfaceTypeDocumentComments = "document_comments"
)

var resourceSurfaceTypes = map[string]struct{}{
	ResourceSurfaceTypeTaskDiscussion:   {},
	ResourceSurfaceTypeTaskDescription:  {},
	ResourceSurfaceTypeDocumentComments: {},
}

// IsValidResourceSurfaceType returns true when the surface type matches schema constraints.
func IsValidResourceSurfaceType(surfaceType string) bool {
	_, ok := resourceSurfaceTypes[surfaceType]
	return ok
}

const (
	ResourceSurfaceDomainChatChannel           = "chat_channel"
	ResourceSurfaceDomainDocument              = "document"
	ResourceSurfaceDomainDocumentCommentThread = "document_comment_thread"
)

var resourceSurfaceDomains = map[string]struct{}{
	ResourceSurfaceDomainChatChannel:           {},
	ResourceSurfaceDomainDocument:              {},
	ResourceSurfaceDomainDocumentCommentThread: {},
}

// IsValidResourceSurfaceDomain returns true when the mapped surface domain matches schema constraints.
func IsValidResourceSurfaceDomain(surfaceDomain string) bool {
	_, ok := resourceSurfaceDomains[surfaceDomain]
	return ok
}

// IsValidNotificationType checks if a notification type string is valid.
// Used for runtime validation to catch alignment issues.
func IsValidNotificationType(notifType string) bool {
	switch notifType {
	case NotificationTypeMessage,
		NotificationTypeMention,
		NotificationTypeReply,
		NotificationTypeTyping,
		NotificationTypeReaction,
		NotificationTypeVoiceCallIncoming,
		NotificationTypeVoiceCallStarted,
		NotificationTypeVoiceCallUpdated,
		NotificationTypeVoiceCallEnded,
		NotificationTypeTaskAssigned,
		NotificationTypeTaskStatusChanged,
		NotificationTypeTaskCommented,
		NotificationTypeTaskMentioned,
		NotificationTypeTaskDescriptionModified,
		NotificationTypeTaskUpdated,
		NotificationTypeDocUpdated,
		NotificationTypeDocCommented,
		NotificationTypeDocMentioned,
		NotificationTypeCalendarEventInvite,
		NotificationTypeCalendarEventCancel,
		NotificationTypeCalendarEventChange,
		NotificationTypeCalendarEventReminder,
		NotificationTypeCalendarCheckInMissed,
		NotificationTypeCalendarEventDigest,
		NotificationTypeRitualInstancesScheduled,
		NotificationTypeEvidenceSubmitted,
		NotificationTypeEvidenceApproved,
		NotificationTypeEvidenceRejected,
		NotificationTypeAccountRemovalRequested:
		return true
	default:
		return false
	}
}

// AllNotificationTypes returns all valid notification types for validation and testing.
func AllNotificationTypes() []string {
	return []string{
		NotificationTypeMessage,
		NotificationTypeMention,
		NotificationTypeReply,
		NotificationTypeTyping,
		NotificationTypeReaction,
		NotificationTypeVoiceCallIncoming,
		NotificationTypeVoiceCallStarted,
		NotificationTypeVoiceCallUpdated,
		NotificationTypeVoiceCallEnded,
		NotificationTypeTaskAssigned,
		NotificationTypeTaskStatusChanged,
		NotificationTypeTaskCommented,
		NotificationTypeTaskMentioned,
		NotificationTypeTaskDescriptionModified,
		NotificationTypeTaskUpdated,
		NotificationTypeDocUpdated,
		NotificationTypeDocCommented,
		NotificationTypeDocMentioned,
		NotificationTypeCalendarEventInvite,
		NotificationTypeCalendarEventCancel,
		NotificationTypeCalendarEventChange,
		NotificationTypeCalendarEventReminder,
		NotificationTypeCalendarCheckInMissed,
		NotificationTypeCalendarEventDigest,
		NotificationTypeRitualInstancesScheduled,
		NotificationTypeEvidenceSubmitted,
		NotificationTypeEvidenceApproved,
		NotificationTypeEvidenceRejected,
		NotificationTypeAccountRemovalRequested,
	}
}

// SourceDomain defines allowed notification source domains.
// These MUST match the database CHECK constraint in notification.notification table.
const (
	SourceDomainChat     = "chat"
	SourceDomainCRM      = "crm"
	SourceDomainProjects = "projects"
	SourceDomainHR       = "hr"
	SourceDomainSupport  = "support"
	SourceDomainFinance  = "finance"
	SourceDomainDocs     = "docs"
	SourceDomainSystem   = "system"
	SourceDomainCalendar = "calendar"
)

// IsValidSourceDomain checks if a source domain string is valid.
// Used for runtime validation to catch alignment issues and prevent typos.
func IsValidSourceDomain(domain string) bool {
	switch domain {
	case SourceDomainChat,
		SourceDomainCRM,
		SourceDomainProjects,
		SourceDomainHR,
		SourceDomainSupport,
		SourceDomainFinance,
		SourceDomainDocs,
		SourceDomainSystem,
		SourceDomainCalendar:
		return true
	default:
		return false
	}
}

// AllSourceDomains returns all valid source domains for validation and testing.
func AllSourceDomains() []string {
	return []string{
		SourceDomainChat,
		SourceDomainCRM,
		SourceDomainProjects,
		SourceDomainHR,
		SourceDomainSupport,
		SourceDomainFinance,
		SourceDomainDocs,
		SourceDomainSystem,
		SourceDomainCalendar,
	}
}

// NotificationPriority defines allowed notification priority levels.
// These MUST match the database CHECK constraint in notification.notification table.
const (
	PriorityAlways  = 0 // Deliver always (even if offline)
	PriorityDefault = 1 // Deliver when not offline (default)
	PriorityOnline  = 2 // Deliver when online only
	PrioritySilent  = 4 // Silent (no delivery, log only)
)

// IsValidPriority checks if a priority value is valid.
func IsValidPriority(priority int) bool {
	switch priority {
	case PriorityAlways, PriorityDefault, PriorityOnline, PrioritySilent:
		return true
	default:
		return false
	}
}

// Presence status constants align with:
// - Database CHECK constraint: notification.active_connection.presence_status
// - Proto enum: rpc.v1.PresenceStatus
// - Frontend types: packages/apis/src/presence.ts
const (
	PresenceStatusOnline       = "online"
	PresenceStatusOnlineHidden = "online_hidden"
	PresenceStatusIdle         = "idle"
	PresenceStatusOffline      = "offline"
	PresenceStatusInMeeting    = "in_meeting"
)

// Presence ping-pong timing. These three numbers define the whole liveness state
// machine and MUST align with:
// - Proto comments: rpc/v1/notification.proto (PresencePong, NotificationEvent)
// - Frontend mirror: frontend/packages/apis/src/presence.ts
// - Frontend mirror: frontend/packages/notifications/src/types.ts (event type)
//
// This Go file is the source of truth (Constitution VIII). The windows are passed to
// SQL as integer seconds via make_interval(secs => $n) so the value has exactly one
// definition here while the comparison still runs on the database clock.
const (
	// PingIntervalSeconds is how often the server challenges each open stream.
	PingIntervalSeconds = 20
	// ResponsiveWindowSeconds is the maximum silence a connection may have and still
	// count as present and as a live-delivery target. Two missed pings plus slack:
	// a single dropped pong must never demote a healthy connection.
	ResponsiveWindowSeconds = 45
	// RemovalWindowSeconds is how long a silent connection's row survives before the
	// janitor deletes it. Deliberately well past the responsive window so a recovering
	// client finds its row intact and resumes without reconnecting.
	RemovalWindowSeconds = 90
)

// SSE event types carried on NotificationEvent.event_type.
const (
	// EventTypePing is a liveness challenge. The client MUST answer it with a
	// PresencePong echoing the event's event_id. It replaces the former "heartbeat"
	// event, which also refreshed the server's own liveness row — the defect the
	// ping-pong protocol exists to remove.
	EventTypePing = "ping"
	// EventTypeConnectionEstablished carries the connection_id to a new stream.
	EventTypeConnectionEstablished = "connection_established"
	// EventTypeNotification carries a NotificationSummary.
	EventTypeNotification = "notification"
)

// presenceStatusPriority orders statuses from most to least available for aggregation logic.
var presenceStatusPriority = map[string]int{
	PresenceStatusOnline:       4,
	PresenceStatusOnlineHidden: 3,
	PresenceStatusIdle:         2,
	PresenceStatusOffline:      1,
	PresenceStatusInMeeting:    3, // same weight as online_hidden — visible but unavailable
}

// IsValidPresenceStatus returns true when the provided string matches the allowed set.
func IsValidPresenceStatus(status string) bool {
	_, ok := presenceStatusPriority[status]
	return ok
}

// PresenceStatusRank returns the ranking weight used when aggregating multiple connections.
// Unknown statuses fall back to the lowest priority (offline).
func PresenceStatusRank(status string) int {
	if rank, ok := presenceStatusPriority[status]; ok {
		return rank
	}
	return presenceStatusPriority[PresenceStatusOffline]
}

// PresenceStatusFromProto converts proto enum to database-ready string value.
func PresenceStatusFromProto(status rpcv1.PresenceStatus) string {
	switch status {
	case rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE:
		return PresenceStatusOnline
	case rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE_HIDDEN:
		return PresenceStatusOnlineHidden
	case rpcv1.PresenceStatus_PRESENCE_STATUS_IDLE:
		return PresenceStatusIdle
	case rpcv1.PresenceStatus_PRESENCE_STATUS_OFFLINE:
		return PresenceStatusOffline
	case rpcv1.PresenceStatus_PRESENCE_STATUS_IN_MEETING:
		return PresenceStatusInMeeting
	default:
		return PresenceStatusOffline
	}
}

// PresenceStatusToProto converts database string values to proto enum.
func PresenceStatusToProto(status string) rpcv1.PresenceStatus {
	switch status {
	case PresenceStatusOnline:
		return rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE
	case PresenceStatusOnlineHidden:
		return rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE_HIDDEN
	case PresenceStatusIdle:
		return rpcv1.PresenceStatus_PRESENCE_STATUS_IDLE
	case PresenceStatusOffline:
		return rpcv1.PresenceStatus_PRESENCE_STATUS_OFFLINE
	case PresenceStatusInMeeting:
		return rpcv1.PresenceStatus_PRESENCE_STATUS_IN_MEETING
	default:
		return rpcv1.PresenceStatus_PRESENCE_STATUS_UNSPECIFIED
	}
}

// Permission state constants align with:
// - Database CHECK constraint: notification.push_token.permission_state
// - Proto enum: rpc.v1.PermissionState
// - Frontend types: packages/apis/src/push-tokens.ts
const (
	PermissionStatePrompt  = "prompt"
	PermissionStateGranted = "granted"
	PermissionStateDenied  = "denied"
)

var permissionStates = map[string]struct{}{
	PermissionStatePrompt:  {},
	PermissionStateGranted: {},
	PermissionStateDenied:  {},
}

// IsValidPermissionState returns true when the stored permission value matches allowed constants.
func IsValidPermissionState(state string) bool {
	_, ok := permissionStates[state]
	return ok
}

// PermissionStateFromProto converts proto enum to storage value.
func PermissionStateFromProto(state rpcv1.PermissionState) string {
	switch state {
	case rpcv1.PermissionState_PERMISSION_STATE_GRANTED:
		return PermissionStateGranted
	case rpcv1.PermissionState_PERMISSION_STATE_DENIED:
		return PermissionStateDenied
	case rpcv1.PermissionState_PERMISSION_STATE_PROMPT:
		return PermissionStatePrompt
	default:
		return PermissionStatePrompt
	}
}

// PermissionStateToProto converts stored string to proto enum.
func PermissionStateToProto(state string) rpcv1.PermissionState {
	switch state {
	case PermissionStateGranted:
		return rpcv1.PermissionState_PERMISSION_STATE_GRANTED
	case PermissionStateDenied:
		return rpcv1.PermissionState_PERMISSION_STATE_DENIED
	case PermissionStatePrompt:
		return rpcv1.PermissionState_PERMISSION_STATE_PROMPT
	default:
		return rpcv1.PermissionState_PERMISSION_STATE_UNSPECIFIED
	}
}

// Visibility mode constants align with:
// - Database CHECK constraint: notification.presence_visibility.visibility_mode
// - Proto enum: rpc.v1.VisibilityMode
// - Frontend types: packages/apis/src/visibility.ts
const (
	VisibilityModeEveryone    = "everyone"
	VisibilityModeDepartments = "departments"
	VisibilityModeOffline     = "offline"
)

var visibilityModes = map[string]struct{}{
	VisibilityModeEveryone:    {},
	VisibilityModeDepartments: {},
	VisibilityModeOffline:     {},
}

// IsValidVisibilityMode checks whether the supplied mode is supported by the platform.
func IsValidVisibilityMode(mode string) bool {
	_, ok := visibilityModes[mode]
	return ok
}

// NotificationPreference defines allowed notification preference values.
// These values are shared across domains (chat, collaboration) for filtering.
// Chat and collaboration packages re-export or define domain-specific supersets.
const (
	NotificationPreferenceAll      = "all"      // Notify on all messages
	NotificationPreferenceMentions = "mentions" // Only @mentions
	NotificationPreferenceMuted    = "muted"    // No notifications
)

// VisibilityModeFromProto converts proto enum to storage value.
func VisibilityModeFromProto(mode rpcv1.VisibilityMode) string {
	switch mode {
	case rpcv1.VisibilityMode_VISIBILITY_MODE_EVERYONE:
		return VisibilityModeEveryone
	case rpcv1.VisibilityMode_VISIBILITY_MODE_DEPARTMENTS:
		return VisibilityModeDepartments
	case rpcv1.VisibilityMode_VISIBILITY_MODE_OFFLINE:
		return VisibilityModeOffline
	default:
		return VisibilityModeEveryone
	}
}

// VisibilityModeToProto converts stored visibility to proto enum.
func VisibilityModeToProto(mode string) rpcv1.VisibilityMode {
	switch mode {
	case VisibilityModeEveryone:
		return rpcv1.VisibilityMode_VISIBILITY_MODE_EVERYONE
	case VisibilityModeDepartments:
		return rpcv1.VisibilityMode_VISIBILITY_MODE_DEPARTMENTS
	case VisibilityModeOffline:
		return rpcv1.VisibilityMode_VISIBILITY_MODE_OFFLINE
	default:
		return rpcv1.VisibilityMode_VISIBILITY_MODE_UNSPECIFIED
	}
}

// PolicyKey defines the routing policy applied to each notification.
// MUST align with database CHECK constraint on notification.notification.policy_key.
const (
	PolicyKeyChatMessage             = "chat_message"
	PolicyKeyChatMention             = "chat_mention"
	PolicyKeyChatReply               = "chat_reply"
	PolicyKeyChatTypingLive          = "chat_typing_live"
	PolicyKeyChatReactionLive        = "chat_reaction_live"
	PolicyKeyChatVoiceCallIncoming   = "chat_voice_call_incoming"
	PolicyKeyChatVoiceCallLive       = "chat_voice_call_live"
	PolicyKeyChatVoiceCallRecord     = "chat_voice_call_record"
	PolicyKeyTaskAssignment          = "task_assignment"
	PolicyKeyTaskComment             = "task_comment"
	PolicyKeyTaskMention             = "task_mention"
	PolicyKeyTaskStatus              = "task_status"
	PolicyKeyTaskDescriptionModified = "task_description_modified"
	PolicyKeyTaskUpdate              = "task_update"
	PolicyKeyDocumentUpdate          = "document_update"
	PolicyKeyDocumentComment         = "document_comment"
	PolicyKeyDocumentMention         = "document_mention"
	PolicyKeyPersistentDefault       = "persistent_default"

	PolicyKeyCalendarEventInvite   = "calendar_event_invite"
	PolicyKeyCalendarEventCancel   = "calendar_event_cancel"
	PolicyKeyCalendarEventChange   = "calendar_event_change"
	PolicyKeyCalendarEventReminder = "calendar_event_reminder"
	PolicyKeyCalendarCheckInMissed = "calendar_check_in_missed"
	PolicyKeyCalendarEventDigest   = "calendar_event_digest"
)

var policyKeys = map[string]struct{}{
	PolicyKeyChatMessage:             {},
	PolicyKeyChatMention:             {},
	PolicyKeyChatReply:               {},
	PolicyKeyChatTypingLive:          {},
	PolicyKeyChatReactionLive:        {},
	PolicyKeyChatVoiceCallIncoming:   {},
	PolicyKeyChatVoiceCallLive:       {},
	PolicyKeyChatVoiceCallRecord:     {},
	PolicyKeyTaskAssignment:          {},
	PolicyKeyTaskComment:             {},
	PolicyKeyTaskMention:             {},
	PolicyKeyTaskStatus:              {},
	PolicyKeyTaskDescriptionModified: {},
	PolicyKeyTaskUpdate:              {},
	PolicyKeyDocumentUpdate:          {},
	PolicyKeyDocumentComment:         {},
	PolicyKeyDocumentMention:         {},
	PolicyKeyPersistentDefault:       {},
	PolicyKeyCalendarEventInvite:     {},
	PolicyKeyCalendarEventCancel:     {},
	PolicyKeyCalendarEventChange:     {},
	PolicyKeyCalendarEventReminder:   {},
	PolicyKeyCalendarCheckInMissed:   {},
	PolicyKeyCalendarEventDigest:     {},
}

// IsValidPolicyKey returns true when the key matches an allowed policy.
func IsValidPolicyKey(key string) bool {
	_, ok := policyKeys[key]
	return ok
}

// DeliveryClass defines how a notification should be routed and persisted.
// MUST align with database CHECK constraint on notification.notification.delivery_class.
const (
	DeliveryClassPersistent = "persistent" // Store and deliver; show in inbox
	DeliveryClassLiveOnly   = "live_only"  // SSE only; do not store in inbox
)

var deliveryClasses = map[string]struct{}{
	DeliveryClassPersistent: {},
	DeliveryClassLiveOnly:   {},
}

// IsValidDeliveryClass returns true when the class matches an allowed value.
func IsValidDeliveryClass(class string) bool {
	_, ok := deliveryClasses[class]
	return ok
}

// SourceCategory classifies what prompted the notification.
// MUST align with database CHECK constraint on notification.notification.source_category.
const (
	SourceCategoryActivity = "activity" // General activity (comment, update)
	SourceCategoryMention  = "mention"  // Explicit @mention
	SourceCategorySystem   = "system"   // System-generated event
)

var sourceCategories = map[string]struct{}{
	SourceCategoryActivity: {},
	SourceCategoryMention:  {},
	SourceCategorySystem:   {},
}

// IsValidSourceCategory returns true when the category matches an allowed value.
func IsValidSourceCategory(category string) bool {
	_, ok := sourceCategories[category]
	return ok
}

// AcknowledgementAction records how the recipient acknowledged the notification.
// MUST align with database CHECK constraint on notification.notification_recipient.acknowledgement_action.
const (
	AckActionDestinationOpen = "destination_open" // User navigated to the notification's target
	AckActionExplicitAck     = "explicit_ack"     // User explicitly dismissed/read the notification
)

var acknowledgementActions = map[string]struct{}{
	AckActionDestinationOpen: {},
	AckActionExplicitAck:     {},
}

// IsValidAcknowledgementAction returns true when the action matches an allowed value.
func IsValidAcknowledgementAction(action string) bool {
	_, ok := acknowledgementActions[action]
	return ok
}

// FallbackStatus records the push/email fallback delivery outcome.
// MUST align with database CHECK constraint on notification.notification_recipient.fallback_status.
const (
	FallbackStatusNotApplicable = "not_applicable" // live_only policy; no fallback attempted
	FallbackStatusQueued        = "queued"         // Fallback delivery enqueued
	FallbackStatusSent          = "sent"           // Fallback delivery confirmed sent
	FallbackStatusSkipped       = "skipped"        // Skipped due to policy or preference
	FallbackStatusFailed        = "failed"         // Delivery attempt failed
)

var fallbackStatuses = map[string]struct{}{
	FallbackStatusNotApplicable: {},
	FallbackStatusQueued:        {},
	FallbackStatusSent:          {},
	FallbackStatusSkipped:       {},
	FallbackStatusFailed:        {},
}

// IsValidFallbackStatus returns true when the status matches an allowed value.
func IsValidFallbackStatus(status string) bool {
	_, ok := fallbackStatuses[status]
	return ok
}

// FallbackReason records why a push/email fallback was skipped or failed.
// MUST align with database CHECK constraint on notification.notification_recipient.fallback_reason.
const (
	FallbackReasonLiveOnlyPolicy         = "live_only_policy"         // Policy is live_only; fallback skipped by design
	FallbackReasonNoPushTarget           = "no_push_target"           // Recipient has no registered push token
	FallbackReasonRecipientIneligible    = "recipient_ineligible"     // Recipient excluded by audience rules
	FallbackReasonRecipientOnline        = "recipient_online"         // Recipient is online; fallback queued for rescue window
	FallbackReasonSuppressedByPreference = "suppressed_by_preference" // User preference mutes this type
	FallbackReasonSSEReceiptConfirmed    = "sse_receipt_confirmed"    // Foreground client receipt confirmed SSE delivery
	FallbackReasonAcknowledgedBeforePush = "acknowledged_before_fallback"
	// FallbackReasonConnectionUnresponsive records that the recipient's connections had
	// stopped answering presence pings, so live delivery could not reach them.
	FallbackReasonConnectionUnresponsive = "connection_unresponsive"
	FallbackReasonDeliveryError          = "delivery_error" // FCM/APNS/email returned an error

	// Call wake reasons (Feature 037). These appear on call_wake rows only.
	//
	// FallbackReasonNoCallWakeTarget records that the callee had no device that could
	// be woken at all. It is what turns a call into VOICE_CALLEE_UNREACHABLE instead
	// of ringing out for 45 seconds (FR-006, SC-006).
	FallbackReasonNoCallWakeTarget = "no_call_wake_target"
	// FallbackReasonNativeTierUnavailable records that a device exists but cannot run
	// the native call tier, so it was served the tier-B ring instead. The share of
	// these rows is the measurement behind the epic's ~80% target.
	FallbackReasonNativeTierUnavailable = "native_tier_unavailable"
	// FallbackReasonCallAlreadyEnded records a wake that was not sent because the call
	// was already over by the time the dispatcher reached the device.
	FallbackReasonCallAlreadyEnded = "call_already_ended"
	// FallbackReasonActingDeviceExcluded records a terminal wake deliberately withheld
	// from the handset that caused the ending. The iOS client module reports every call
	// wake to CallKit as a new incoming call before JavaScript runs, so sending one back
	// to the phone that just answered or declined would ring it again.
	FallbackReasonActingDeviceExcluded = "acting_device_excluded"
)

var fallbackReasons = map[string]struct{}{
	FallbackReasonLiveOnlyPolicy:         {},
	FallbackReasonNoPushTarget:           {},
	FallbackReasonRecipientIneligible:    {},
	FallbackReasonRecipientOnline:        {},
	FallbackReasonSuppressedByPreference: {},
	FallbackReasonSSEReceiptConfirmed:    {},
	FallbackReasonAcknowledgedBeforePush: {},
	FallbackReasonConnectionUnresponsive: {},
	FallbackReasonDeliveryError:          {},
	FallbackReasonNoCallWakeTarget:       {},
	FallbackReasonNativeTierUnavailable:  {},
	FallbackReasonCallAlreadyEnded:       {},
	FallbackReasonActingDeviceExcluded:   {},
}

// IsValidFallbackReason returns true when the reason matches an allowed value.
func IsValidFallbackReason(reason string) bool {
	_, ok := fallbackReasons[reason]
	return ok
}

// AcknowledgementStatus tracks whether a persistent notification has been acknowledged.
// MUST align with database CHECK constraint on notification.notification_recipient.acknowledgement_status.
const (
	AcknowledgementStatusPending      = "pending"      // Not yet seen/acknowledged
	AcknowledgementStatusAcknowledged = "acknowledged" // Recipient has acknowledged
)

var acknowledgementStatuses = map[string]struct{}{
	AcknowledgementStatusPending:      {},
	AcknowledgementStatusAcknowledged: {},
}

// IsValidAcknowledgementStatus returns true when the status matches an allowed value.
func IsValidAcknowledgementStatus(status string) bool {
	_, ok := acknowledgementStatuses[status]
	return ok
}

const (
	LiveReceiptPlatformWeb       = "web"
	LiveReceiptPlatformMobile    = "mobile"
	LiveReceiptAppForeground     = "foreground"
	LiveReceiptAppBackground     = "background"
	LiveReceiptVisibilityVisible = "visible"
	LiveReceiptVisibilityHidden  = "hidden"
)

var liveReceiptPlatforms = map[string]struct{}{
	LiveReceiptPlatformWeb:    {},
	LiveReceiptPlatformMobile: {},
}

var liveReceiptAppStates = map[string]struct{}{
	LiveReceiptAppForeground: {},
	LiveReceiptAppBackground: {},
}

var liveReceiptVisibilityStates = map[string]struct{}{
	LiveReceiptVisibilityVisible: {},
	LiveReceiptVisibilityHidden:  {},
}

func IsValidLiveReceiptPlatform(platform string) bool {
	_, ok := liveReceiptPlatforms[platform]
	return ok
}

func IsValidLiveReceiptAppState(appState string) bool {
	_, ok := liveReceiptAppStates[appState]
	return ok
}

func IsValidLiveReceiptVisibilityState(visibilityState string) bool {
	_, ok := liveReceiptVisibilityStates[visibilityState]
	return ok
}

// ActiveContextType categorizes what the user is currently viewing for live routing decisions.
// MUST align with database CHECK constraint on notification.active_context.context_type.
const (
	ContextTypeChannel  = "channel"  // User is viewing a chat channel
	ContextTypeDocument = "document" // User is viewing a document
	ContextTypeTask     = "task"     // User is viewing a task
)

var activeContextTypes = map[string]struct{}{
	ContextTypeChannel:  {},
	ContextTypeDocument: {},
	ContextTypeTask:     {},
}

// IsValidActiveContextType returns true when the type matches an allowed value.
func IsValidActiveContextType(ctxType string) bool {
	_, ok := activeContextTypes[ctxType]
	return ok
}

// PreferenceLevelFromProto converts proto enum to database-ready string value.
func PreferenceLevelFromProto(level rpcv1.SubscriptionPreferenceLevel) string {
	switch level {
	case rpcv1.SubscriptionPreferenceLevel_SUBSCRIPTION_PREFERENCE_LEVEL_ALL:
		return NotificationPreferenceAll
	case rpcv1.SubscriptionPreferenceLevel_SUBSCRIPTION_PREFERENCE_LEVEL_MENTIONS:
		return NotificationPreferenceMentions
	case rpcv1.SubscriptionPreferenceLevel_SUBSCRIPTION_PREFERENCE_LEVEL_MUTED:
		return NotificationPreferenceMuted
	default:
		return NotificationPreferenceAll
	}
}

// PreferenceLevelToProto converts database string value to proto enum.
func PreferenceLevelToProto(level string) rpcv1.SubscriptionPreferenceLevel {
	switch level {
	case NotificationPreferenceAll:
		return rpcv1.SubscriptionPreferenceLevel_SUBSCRIPTION_PREFERENCE_LEVEL_ALL
	case NotificationPreferenceMentions:
		return rpcv1.SubscriptionPreferenceLevel_SUBSCRIPTION_PREFERENCE_LEVEL_MENTIONS
	case NotificationPreferenceMuted:
		return rpcv1.SubscriptionPreferenceLevel_SUBSCRIPTION_PREFERENCE_LEVEL_MUTED
	default:
		return rpcv1.SubscriptionPreferenceLevel_SUBSCRIPTION_PREFERENCE_LEVEL_UNSPECIFIED
	}
}

// DeliveryChannel names the transport an attempt was made on.
// MUST align with database CHECK constraint on notification.delivery_attempt.channel.
const (
	DeliveryChannelSSE = "sse" // Realtime SSE stream
	// DeliveryChannelPush is the Firebase path used for every routine notification
	// and for the tier-B fallback ring.
	DeliveryChannelPush   = "push"
	DeliveryChannelReplay = "replay" // Replayed to a client on reconnect
	// DeliveryChannelCallWake is the privileged native call wake path (Feature 037).
	// One row per device per call event. It is exempt from receipt-based cancellation
	// and from do-not-disturb suppression, so it carries live call events and nothing
	// else — on iOS a VoIP push that does not result in a reported call terminates the
	// app, which makes that restriction a survival requirement rather than hygiene.
	DeliveryChannelCallWake = "call_wake"
)

var deliveryChannels = map[string]struct{}{
	DeliveryChannelSSE:      {},
	DeliveryChannelPush:     {},
	DeliveryChannelReplay:   {},
	DeliveryChannelCallWake: {},
}

// IsValidDeliveryChannel returns true when the channel matches an allowed value.
func IsValidDeliveryChannel(channel string) bool {
	_, ok := deliveryChannels[channel]
	return ok
}

// CallWakeEvent is the kind of call event a wake carries. Every wake carries exactly
// one, and each has a defined client action that ends in a call reported to the OS.
//
// MUST align with the CallWakeEvent union in frontend/packages/apis/src/push-tokens.ts
// and with the event kinds in specs/037-native-call-wakeup/contracts/call-wake-payloads.md.
const (
	// CallWakeEventIncoming asks the device to present the native incoming-call UI.
	CallWakeEventIncoming = "incoming"
	// CallWakeEventCancelled means the caller hung up before anyone answered.
	CallWakeEventCancelled = "cancelled"
	// CallWakeEventAnsweredElsewhere means the same person answered on another device.
	CallWakeEventAnsweredElsewhere = "answered_elsewhere"
	// CallWakeEventDeclinedElsewhere means the same person declined on another device.
	CallWakeEventDeclinedElsewhere = "declined_elsewhere"
	// CallWakeEventEnded covers every other terminal path: remote hang-up, ring
	// timeout, join failure.
	CallWakeEventEnded = "ended"
)

var callWakeEvents = map[string]struct{}{
	CallWakeEventIncoming:          {},
	CallWakeEventCancelled:         {},
	CallWakeEventAnsweredElsewhere: {},
	CallWakeEventDeclinedElsewhere: {},
	CallWakeEventEnded:             {},
}

// IsValidCallWakeEvent returns true when the kind matches an allowed value. The call
// wake dispatcher refuses anything else, which is what keeps the privileged transport
// carrying live call events only (FR-003).
func IsValidCallWakeEvent(event string) bool {
	_, ok := callWakeEvents[event]
	return ok
}

// IsTerminalCallWakeEvent returns true for every kind that ends the device's call.
// The client reports the call to the OS and then immediately ends it with the
// matching end reason, rather than dropping the wake (FR-013).
func IsTerminalCallWakeEvent(event string) bool {
	switch event {
	case CallWakeEventCancelled, CallWakeEventAnsweredElsewhere, CallWakeEventDeclinedElsewhere, CallWakeEventEnded:
		return true
	default:
		return false
	}
}

// PushTokenType names which provider token a push_token row carries.
// MUST align with the push_token_token_type_valid CHECK constraint on
// notification.push_token and the PushTokenType union in
// frontend/packages/apis/src/push-tokens.ts.
const (
	// PushTokenTypeFCM is a Firebase token. It serves routine notifications on every
	// platform and is also the Android call transport, which distinguishes itself by
	// payload shape (data-only, high priority) rather than by a separate token.
	PushTokenTypeFCM = "fcm"
	// PushTokenTypeAPNSVoIP is a PushKit VoIP token, reached over a direct APNs HTTP/2
	// connection because Firebase cannot carry apns-push-type: voip. Used for
	// call_wake traffic only.
	PushTokenTypeAPNSVoIP = "apns_voip"
	// PushTokenTypeWebPush is a browser Web Push subscription.
	PushTokenTypeWebPush = "web_push"
)

var pushTokenTypes = map[string]struct{}{
	PushTokenTypeFCM:      {},
	PushTokenTypeAPNSVoIP: {},
	PushTokenTypeWebPush:  {},
}

// IsValidPushTokenType returns true when the type matches an allowed value.
func IsValidPushTokenType(tokenType string) bool {
	_, ok := pushTokenTypes[tokenType]
	return ok
}
