package notification

import (
	"encoding/json"
	"testing"

	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// The SSE JSON mirror structs must not drop typed payload fields that clients
// consume: web reads chat.employeeId/emojiCode for typing and reaction events,
// mobile linking reads task/document/calendar deepLink and document slug.
func TestMarshalNotificationEventPreservesTypedPayloadFields(t *testing.T) {
	event := &rpcv1.NotificationEvent{
		EventId:   "event-1",
		EventType: "notification",
		Timestamp: timestamppb.New(timestamppb.Now().AsTime()),
		Notification: &rpcv1.NotificationSummary{
			NotificationId:   "notification-1",
			SourceDomain:     SourceDomainChat,
			NotificationType: NotificationTypeReaction,
			Payload: &rpcv1.NotificationPayload{
				SchemaVersion:    1,
				NotificationId:   "notification-1",
				SourceDomain:     SourceDomainChat,
				NotificationType: NotificationTypeReaction,
				Chat: &rpcv1.ChatNotificationPayload{
					ChannelId:       "channel-1",
					MessageId:       "message-1",
					ParentMessageId: "parent-1",
					Action:          "added",
					EmployeeId:      "employee-1",
					EmojiCode:       ":thumbsup:",
				},
				VoiceCall: &rpcv1.VoiceCallNotificationPayload{
					ChannelId:            "channel-1",
					CallId:               "call-1",
					InvitationId:         "invitation-1",
					ParticipantCount:     3,
					AlreadyInAnotherCall: true,
				},
				Task: &rpcv1.TaskNotificationPayload{
					ProjectId: "project-1",
					TaskId:    "task-1",
					DeepLink:  "tasks/project-1/task-1",
				},
				Document: &rpcv1.DocumentNotificationPayload{
					DocumentId: "document-1",
					Slug:       "release-notes",
					DeepLink:   "docs/release-notes",
				},
				Calendar: &rpcv1.CalendarNotificationPayload{
					EventId:  "calendar-event-1",
					DeepLink: "calendar/calendar-event-1",
				},
			},
		},
	}

	data, err := marshalNotificationEvent(event)
	require.NoError(t, err)

	var decoded struct {
		Notification struct {
			Payload struct {
				SchemaVersion int32 `json:"schemaVersion"`
				Chat          struct {
					ChannelID  string `json:"channelId"`
					Action     string `json:"action"`
					EmployeeID string `json:"employeeId"`
					EmojiCode  string `json:"emojiCode"`
				} `json:"chat"`
				VoiceCall struct {
					CallID               string `json:"callId"`
					InvitationID         string `json:"invitationId"`
					ParticipantCount     int32  `json:"participantCount"`
					AlreadyInAnotherCall bool   `json:"alreadyInAnotherCall"`
				} `json:"voiceCall"`
				Task struct {
					TaskID   string `json:"taskId"`
					DeepLink string `json:"deepLink"`
				} `json:"task"`
				Document struct {
					Slug     string `json:"slug"`
					DeepLink string `json:"deepLink"`
				} `json:"document"`
				Calendar struct {
					EventID  string `json:"eventId"`
					DeepLink string `json:"deepLink"`
				} `json:"calendar"`
			} `json:"payload"`
		} `json:"notification"`
	}
	require.NoError(t, json.Unmarshal(data, &decoded))

	payload := decoded.Notification.Payload
	assert.Equal(t, int32(1), payload.SchemaVersion)
	assert.Equal(t, "channel-1", payload.Chat.ChannelID)
	assert.Equal(t, "added", payload.Chat.Action)
	assert.Equal(t, "employee-1", payload.Chat.EmployeeID)
	assert.Equal(t, ":thumbsup:", payload.Chat.EmojiCode)
	assert.Equal(t, "call-1", payload.VoiceCall.CallID)
	assert.Equal(t, "invitation-1", payload.VoiceCall.InvitationID)
	assert.Equal(t, int32(3), payload.VoiceCall.ParticipantCount)
	assert.True(t, payload.VoiceCall.AlreadyInAnotherCall)
	assert.Equal(t, "task-1", payload.Task.TaskID)
	assert.Equal(t, "tasks/project-1/task-1", payload.Task.DeepLink)
	assert.Equal(t, "release-notes", payload.Document.Slug)
	assert.Equal(t, "docs/release-notes", payload.Document.DeepLink)
	assert.Equal(t, "calendar-event-1", payload.Calendar.EventID)
	assert.Equal(t, "calendar/calendar-event-1", payload.Calendar.DeepLink)
}
