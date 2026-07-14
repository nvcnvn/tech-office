package notification

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

const notificationPayloadSchemaVersion = 1

func buildNotificationPayload(
	notificationID string,
	recipientID string,
	sourceDomain string,
	notificationType string,
	policyKey string,
	sourceCategory string,
	deliveryClass string,
	actionData map[string]string,
	navigationTarget *rpcv1.NavigationTarget,
) *rpcv1.NotificationPayload {
	payload := &rpcv1.NotificationPayload{
		SchemaVersion:           notificationPayloadSchemaVersion,
		NotificationId:          notificationID,
		NotificationRecipientId: recipientID,
		SourceDomain:            sourceDomain,
		NotificationType:        notificationType,
		PolicyKey:               policyKey,
		SourceCategory:          sourceCategory,
		DeliveryClass:           deliveryClass,
		NavigationTarget:        navigationTarget,
		ActionData:              cloneStringMap(actionData),
	}

	if chatPayload := chatPayloadFromActionData(actionData); chatPayload != nil {
		payload.Chat = chatPayload
	}
	if isVoiceCallNotificationType(notificationType) {
		payload.VoiceCall = voiceCallPayloadFromActionData(actionData)
	}
	if taskPayload := taskPayloadFromActionData(actionData, navigationTarget); taskPayload != nil {
		payload.Task = taskPayload
	}
	if sourceDomain == SourceDomainDocs {
		payload.Document = documentPayloadFromActionData(actionData, navigationTarget)
	}
	if sourceDomain == SourceDomainCalendar {
		payload.Calendar = calendarPayloadFromActionData(actionData, navigationTarget)
	}

	return payload
}

func cloneStringMap(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}
	cloned := make(map[string]string, len(values))
	for key, value := range values {
		cloned[key] = value
	}
	return cloned
}

func chatPayloadFromActionData(actionData map[string]string) *rpcv1.ChatNotificationPayload {
	if len(actionData) == 0 {
		return nil
	}
	chat := &rpcv1.ChatNotificationPayload{
		ChannelId:        actionData["channelId"],
		ChannelType:      actionData["channelType"],
		ChannelName:      actionData["channelName"],
		MessageId:        actionData["messageId"],
		ParentMessageId:  actionData["parentMessageId"],
		SenderEmployeeId: actionData["senderEmployeeId"],
		SenderName:       actionData["senderName"],
		Action:           actionData["action"],
		EmployeeId:       actionData["employeeId"],
		EmojiCode:        firstNonEmpty(actionData["emojiCode"], actionData["reactionEmoji"], actionData["emoji"]),
	}
	if chat.ChannelId == "" && chat.MessageId == "" && chat.ParentMessageId == "" && chat.Action == "" && chat.EmployeeId == "" && chat.EmojiCode == "" {
		return nil
	}
	return chat
}

func voiceCallPayloadFromActionData(actionData map[string]string) *rpcv1.VoiceCallNotificationPayload {
	if len(actionData) == 0 {
		return nil
	}
	participantCount, _ := strconv.Atoi(strings.TrimSpace(actionData["participantCount"]))
	return &rpcv1.VoiceCallNotificationPayload{
		ChannelId:            actionData["channelId"],
		ChannelType:          actionData["channelType"],
		ChannelName:          actionData["channelName"],
		CallId:               actionData["callId"],
		InvitationId:         actionData["invitationId"],
		SenderEmployeeId:     actionData["senderEmployeeId"],
		SenderName:           actionData["senderName"],
		InitiatorEmployeeId:  actionData["initiatorEmployeeId"],
		State:                actionData["state"],
		ParticipantCount:     int32(participantCount),
		AlreadyInAnotherCall: strings.EqualFold(actionData["alreadyInAnotherCall"], "true"),
		Action:               actionData["action"],
		Outcome:              actionData["outcome"],
	}
}

func taskPayloadFromActionData(actionData map[string]string, navigationTarget *rpcv1.NavigationTarget) *rpcv1.TaskNotificationPayload {
	if len(actionData) == 0 && navigationTarget == nil {
		return nil
	}
	taskID := actionData["taskId"]
	if taskID == "" && navigationTarget != nil && navigationTarget.GetResourceType() == "task" {
		taskID = navigationTarget.GetResourceId()
	}
	projectID := actionData["projectId"]
	if taskID == "" && projectID == "" {
		return nil
	}
	return &rpcv1.TaskNotificationPayload{
		ProjectId:     projectID,
		TaskId:        taskID,
		TaskTitle:     actionData["taskTitle"],
		RequirementId: firstNonEmpty(actionData["requirementId"], actionData["evidenceRequirementId"], actionData["pendingRequirementId"], actionData["focusRequirementId"], actionData["latestPendingRequirementId"]),
		FocusIntent:   firstNonEmpty(actionData["focusIntent"], actionData["ritualFocusIntent"]),
		EntryContext:  firstNonEmpty(actionData["entryContext"], actionData["taskContext"], actionData["ritualContext"]),
		DeepLink:      actionData["deepLink"],
	}
}

func documentPayloadFromActionData(actionData map[string]string, navigationTarget *rpcv1.NavigationTarget) *rpcv1.DocumentNotificationPayload {
	documentID := firstNonEmpty(actionData["documentId"], actionData["docId"])
	if documentID == "" && navigationTarget != nil && navigationTarget.GetResourceType() == "document" {
		documentID = navigationTarget.GetResourceId()
	}
	if documentID == "" && actionData["commentId"] == "" && actionData["replyId"] == "" {
		return nil
	}
	return &rpcv1.DocumentNotificationPayload{
		DocumentId: documentID,
		CommentId:  actionData["commentId"],
		ReplyId:    actionData["replyId"],
		Slug:       firstNonEmpty(actionData["slug"], actionData["documentSlug"]),
		DeepLink:   actionData["deepLink"],
	}
}

func calendarPayloadFromActionData(actionData map[string]string, navigationTarget *rpcv1.NavigationTarget) *rpcv1.CalendarNotificationPayload {
	eventID := actionData["eventId"]
	if eventID == "" && navigationTarget != nil && navigationTarget.GetResourceType() == "calendar_event" {
		eventID = navigationTarget.GetResourceId()
	}
	if eventID == "" && actionData["eventTitle"] == "" {
		return nil
	}
	return &rpcv1.CalendarNotificationPayload{
		EventId:    eventID,
		EventTitle: actionData["eventTitle"],
		DeepLink:   actionData["deepLink"],
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func isVoiceCallNotificationType(notificationType string) bool {
	switch notificationType {
	case NotificationTypeVoiceCallIncoming, NotificationTypeVoiceCallStarted, NotificationTypeVoiceCallUpdated, NotificationTypeVoiceCallEnded:
		return true
	default:
		return false
	}
}

func validateVoiceCallIncomingPayload(req *rpcv1.PublishNotificationRequest) error {
	if req.NotificationType != NotificationTypeVoiceCallIncoming {
		return nil
	}
	if req.SourceDomain != SourceDomainChat {
		return fmt.Errorf("voice_call_incoming source_domain must be chat")
	}
	if req.Priority != int32(PriorityAlways) {
		return fmt.Errorf("voice_call_incoming priority must be 0")
	}
	if req.DeliveryClass != "" && req.DeliveryClass != DeliveryClassPersistent {
		return fmt.Errorf("voice_call_incoming delivery_class must be persistent")
	}

	for _, key := range []string{"channelId", "channelName", "channelType", "callId", "invitationId", "senderEmployeeId", "senderName", "alreadyInAnotherCall"} {
		if strings.TrimSpace(req.ActionData[key]) == "" {
			return fmt.Errorf("voice_call_incoming action_data.%s is required", key)
		}
	}
	for _, key := range []string{"channelId", "callId", "invitationId", "senderEmployeeId"} {
		if _, err := dbuuid.Parse(req.ActionData[key]); err != nil {
			return fmt.Errorf("voice_call_incoming action_data.%s must be a UUID: %w", key, err)
		}
	}
	if value := req.ActionData["initiatorEmployeeId"]; strings.TrimSpace(value) != "" {
		if _, err := dbuuid.Parse(value); err != nil {
			return fmt.Errorf("voice_call_incoming action_data.initiatorEmployeeId must be a UUID: %w", err)
		}
	}
	if value := req.ActionData["alreadyInAnotherCall"]; value != "true" && value != "false" {
		return fmt.Errorf("voice_call_incoming action_data.alreadyInAnotherCall must be true or false")
	}
	if req.NavigationTarget == nil {
		return fmt.Errorf("voice_call_incoming navigation_target is required")
	}
	if req.NavigationTarget.GetDomain() != SourceDomainChat || req.NavigationTarget.GetResourceType() != "channel" || req.NavigationTarget.GetAction() != "join_voice_call" {
		return fmt.Errorf("voice_call_incoming navigation_target must route to chat channel join_voice_call")
	}
	if req.NavigationTarget.GetResourceId() != req.ActionData["channelId"] {
		return fmt.Errorf("voice_call_incoming navigation_target.resource_id must match action_data.channelId")
	}
	if req.NavigationTarget.GetSecondaryId() != req.ActionData["invitationId"] {
		return fmt.Errorf("voice_call_incoming navigation_target.secondary_id must match action_data.invitationId")
	}
	return nil
}
