package notification

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type routingLogicStub struct {
	decisions map[dbuuid.UUID]FallbackDecision
}

func TestPushDataFromPublishRequestIncludesRoutingData(t *testing.T) {
	notificationID := dbuuid.Must()
	req := &rpcv1.PublishNotificationRequest{
		SourceDomain:     SourceDomainChat,
		NotificationType: NotificationTypeVoiceCallIncoming,
		PolicyKey:        PolicyKeyChatVoiceCallIncoming,
		ActionData: map[string]string{
			"channelId":    "channel-123",
			"messageId":    "message-456",
			"invitationId": "invite-789",
		},
		NavigationTarget: &rpcv1.NavigationTarget{
			Domain:       SourceDomainChat,
			ResourceType: "channel",
			ResourceId:   "channel-123",
			SecondaryId:  "invite-789",
			Action:       "join_voice_call",
		},
	}

	data := pushDataFromPublishRequest(req, notificationID)

	assert.Equal(t, notificationID.String(), data["notificationId"])
	assert.Equal(t, notificationID.String(), data["notification_id"])
	assert.Equal(t, NotificationTypeVoiceCallIncoming, data["notificationType"])
	assert.Equal(t, NotificationTypeVoiceCallIncoming, data["notification_type"])
	assert.Equal(t, "channel-123", data["navigationResourceId"])
	assert.Equal(t, "join_voice_call", data["navigationAction"])
	assert.Equal(t, "/workspace/chat?channel=channel-123&message=message-456", data["click_action"])
	assert.True(t, isIncomingVoiceCallPush(&PushNotificationPayload{Data: data}))
}

func TestBuildNotificationPayloadIncludesTypedVoiceCallMetadata(t *testing.T) {
	notificationID := dbuuid.Must()
	recipientID := dbuuid.Must()
	channelID := dbuuid.Must()
	callID := dbuuid.Must()
	invitationID := dbuuid.Must()
	senderID := dbuuid.Must()
	navigationTarget := &rpcv1.NavigationTarget{
		Domain:       SourceDomainChat,
		ResourceType: "channel",
		ResourceId:   channelID.String(),
		SecondaryId:  invitationID.String(),
		Action:       "join_voice_call",
	}
	actionData := map[string]string{
		"action":               "invite",
		"channelId":            channelID.String(),
		"channelName":          "Ops Room",
		"channelType":          "chat",
		"callId":               callID.String(),
		"invitationId":         invitationID.String(),
		"senderEmployeeId":     senderID.String(),
		"senderName":           "Test Caller",
		"alreadyInAnotherCall": "true",
	}

	payload := buildNotificationPayload(
		notificationID.String(),
		recipientID.String(),
		SourceDomainChat,
		NotificationTypeVoiceCallIncoming,
		PolicyKeyChatVoiceCallIncoming,
		SourceCategorySystem,
		DeliveryClassPersistent,
		actionData,
		navigationTarget,
	)

	require.NotNil(t, payload)
	assert.Equal(t, int32(1), payload.GetSchemaVersion())
	assert.Equal(t, notificationID.String(), payload.GetNotificationId())
	assert.Equal(t, recipientID.String(), payload.GetNotificationRecipientId())
	assert.Equal(t, PolicyKeyChatVoiceCallIncoming, payload.GetPolicyKey())
	assert.Equal(t, DeliveryClassPersistent, payload.GetDeliveryClass())
	assert.Equal(t, navigationTarget.GetResourceId(), payload.GetNavigationTarget().GetResourceId())
	require.NotNil(t, payload.GetChat())
	assert.Equal(t, channelID.String(), payload.GetChat().GetChannelId())
	require.NotNil(t, payload.GetVoiceCall())
	assert.Equal(t, callID.String(), payload.GetVoiceCall().GetCallId())
	assert.Equal(t, invitationID.String(), payload.GetVoiceCall().GetInvitationId())
	assert.Equal(t, senderID.String(), payload.GetVoiceCall().GetSenderEmployeeId())
	assert.Equal(t, "Test Caller", payload.GetVoiceCall().GetSenderName())
	assert.True(t, payload.GetVoiceCall().GetAlreadyInAnotherCall())
}

func TestBuildNotificationPayloadIncludesTypedChatLiveFields(t *testing.T) {
	payload := buildNotificationPayload(
		dbuuid.Must().String(),
		"",
		SourceDomainChat,
		NotificationTypeTyping,
		PolicyKeyChatTypingLive,
		SourceCategoryActivity,
		DeliveryClassLiveOnly,
		map[string]string{
			"channelId":       dbuuid.Must().String(),
			"employeeId":      dbuuid.Must().String(),
			"action":          "start",
			"parentMessageId": dbuuid.Must().String(),
			"emojiCode":       ":thumbsup:",
		},
		nil,
	)

	require.NotNil(t, payload.GetChat())
	assert.Equal(t, "start", payload.GetChat().GetAction())
	assert.NotEmpty(t, payload.GetChat().GetEmployeeId())
	assert.Equal(t, ":thumbsup:", payload.GetChat().GetEmojiCode())
	assert.NotEmpty(t, payload.GetChat().GetParentMessageId())
}

func TestBuildNotificationPayloadIncludesChatSectionForTaskDiscussionNotification(t *testing.T) {
	notificationID := dbuuid.Must()
	recipientID := dbuuid.Must()
	channelID := dbuuid.Must()
	messageID := dbuuid.Must()
	taskID := dbuuid.Must()
	projectID := dbuuid.Must()
	payload := buildNotificationPayload(
		notificationID.String(),
		recipientID.String(),
		SourceDomainProjects,
		NotificationTypeTaskCommented,
		PolicyKeyTaskComment,
		SourceCategoryActivity,
		DeliveryClassPersistent,
		map[string]string{
			"projectId":        projectID.String(),
			"taskId":           taskID.String(),
			"taskTitle":        "Bridge task",
			"channelId":        channelID.String(),
			"messageId":        messageID.String(),
			"channelType":      "chat",
			"channelName":      "task-discussion",
			"senderEmployeeId": dbuuid.Must().String(),
			"senderName":       "Poster",
			"action":           "view_message",
			"deepLink":         "chat/" + channelID.String(),
		},
		&rpcv1.NavigationTarget{
			Domain:       SourceDomainProjects,
			ResourceType: "task",
			ResourceId:   taskID.String(),
		},
	)

	require.NotNil(t, payload.GetTask())
	assert.Equal(t, projectID.String(), payload.GetTask().GetProjectId())
	assert.Equal(t, taskID.String(), payload.GetTask().GetTaskId())
	assert.Equal(t, "Bridge task", payload.GetTask().GetTaskTitle())
	require.NotNil(t, payload.GetChat())
	assert.Equal(t, channelID.String(), payload.GetChat().GetChannelId())
	assert.Equal(t, messageID.String(), payload.GetChat().GetMessageId())
	assert.Equal(t, "view_message", payload.GetChat().GetAction())
}

func TestValidateVoiceCallIncomingPayloadRequiresRoutingMetadata(t *testing.T) {
	channelID := dbuuid.Must()
	callID := dbuuid.Must()
	invitationID := dbuuid.Must()
	senderID := dbuuid.Must()
	req := &rpcv1.PublishNotificationRequest{
		SourceDomain:     SourceDomainChat,
		NotificationType: NotificationTypeVoiceCallIncoming,
		Priority:         int32(PriorityAlways),
		DeliveryClass:    DeliveryClassPersistent,
		ActionData: map[string]string{
			"channelId":            channelID.String(),
			"channelName":          "Ops Room",
			"channelType":          "chat",
			"callId":               callID.String(),
			"invitationId":         invitationID.String(),
			"senderEmployeeId":     senderID.String(),
			"senderName":           "Test Caller",
			"alreadyInAnotherCall": "false",
		},
		NavigationTarget: &rpcv1.NavigationTarget{
			Domain:       SourceDomainChat,
			ResourceType: "channel",
			ResourceId:   channelID.String(),
			SecondaryId:  invitationID.String(),
			Action:       "join_voice_call",
		},
	}

	require.NoError(t, validateVoiceCallIncomingPayload(req))

	req.ActionData["callId"] = ""
	assert.ErrorContains(t, validateVoiceCallIncomingPayload(req), "action_data.callId is required")
}

func TestRescuePushPayloadIncludesRecipientRoutingData(t *testing.T) {
	notificationID := dbuuid.Must()
	recipientID := dbuuid.Must()
	actionData, err := json.Marshal(map[string]string{
		"projectId": "project-123",
		"taskId":    "task-456",
	})
	require.NoError(t, err)
	navigationTarget, err := json.Marshal(map[string]string{
		"domain":       SourceDomainProjects,
		"resourceType": "task",
		"resourceId":   "task-456",
		"action":       "open",
	})
	require.NoError(t, err)

	data := pushDataFromNotificationFields(
		notificationID,
		recipientID,
		actionData,
		navigationTarget,
		SourceDomainProjects,
		NotificationTypeTaskAssigned,
		PolicyKeyTaskAssignment,
	)

	assert.Equal(t, recipientID.String(), data["notificationRecipientId"])
	assert.Equal(t, recipientID.String(), data["notification_recipient_id"])
	assert.Equal(t, "/workspace/tasks/project-123/tasks/task-456", data["click_action"])
}

func (s routingLogicStub) RouteEphemeralSignal(context.Context, dbuuid.UUID, *dbuuid.UUID, *rpcv1.NotificationEvent) error {
	return nil
}

func (s routingLogicStub) ShouldSendPush(context.Context, database.DBTX, dbuuid.UUID, dbuuid.UUID, int32, *dbuuid.UUID) (bool, error) {
	return false, nil
}

func (s routingLogicStub) ShouldSuppressPush(context.Context, database.DBTX, dbuuid.UUID, dbuuid.UUID, int32, string) (bool, error) {
	return false, nil
}

func (s routingLogicStub) DecideFallback(
	_ context.Context,
	_ database.DBTX,
	employeeID, _ dbuuid.UUID,
	_ int32,
	_ string,
	_ *dbuuid.UUID,
) FallbackDecision {
	decision, ok := s.decisions[employeeID]
	if !ok {
		return FallbackDecision{}
	}
	return decision
}

func TestCollectPushFallbackRecipients(t *testing.T) {
	employeeVisible := dbuuid.Must()
	employeeHidden := dbuuid.Must()
	orgID := dbuuid.Must()

	recipients := collectPushFallbackRecipients(
		context.Background(),
		nil,
		routingLogicStub{decisions: map[dbuuid.UUID]FallbackDecision{
			employeeVisible: {ShouldSend: false, Reason: FallbackReasonRecipientOnline},
			employeeHidden:  {ShouldSend: true},
		}},
		[]dbuuid.UUID{employeeVisible, employeeHidden},
		orgID,
		1,
		"chat",
		nil,
	)

	require.Len(t, recipients, 1)
	assert.Equal(t, employeeHidden, recipients[0])
}

func TestPlanPushFallbacks(t *testing.T) {
	employeeVisible := dbuuid.Must()
	employeeHidden := dbuuid.Must()
	employeeMuted := dbuuid.Must()
	orgID := dbuuid.Must()

	plan := planPushFallbacks(
		context.Background(),
		nil,
		routingLogicStub{decisions: map[dbuuid.UUID]FallbackDecision{
			employeeVisible: {ShouldSend: false, Reason: FallbackReasonRecipientOnline},
			employeeHidden:  {ShouldSend: true},
			employeeMuted:   {ShouldSend: false, Reason: FallbackReasonSuppressedByPreference},
		}},
		[]dbuuid.UUID{employeeVisible, employeeHidden, employeeMuted},
		orgID,
		1,
		SourceDomainChat,
		nil,
	)

	assert.Equal(t, []dbuuid.UUID{employeeHidden}, plan.immediatePushRecipients)
	assert.Equal(t, []dbuuid.UUID{employeeVisible}, plan.rescueQueueRecipients)
	assert.Equal(t, map[dbuuid.UUID]string{employeeMuted: FallbackReasonSuppressedByPreference}, plan.skippedRecipients)
}
