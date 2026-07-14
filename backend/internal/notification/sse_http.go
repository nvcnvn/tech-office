package notification

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"connectrpc.com/connect"

	"github.com/nvcnvn/tech-office/backend/internal/interceptor"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// notificationHTTPStreamHandler adapts the SSE infrastructure for plain HTTP EventSource clients.
type notificationHTTPStreamHandler struct {
	service *NotificationService
	auth    *interceptor.AuthInterceptor
}

// NewNotificationStreamHTTPHandler creates an HTTP handler that streams notifications using the
// same infrastructure as the ConnectRPC implementation.
func NewNotificationStreamHTTPHandler(service *NotificationService, auth *interceptor.AuthInterceptor) http.Handler {
	return &notificationHTTPStreamHandler{
		service: service,
		auth:    auth,
	}
}

func (h *notificationHTTPStreamHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		return
	}

	ctx := r.Context()

	// Authenticate request using shared JWT verifier.
	ctx, err := h.auth.AuthenticateHTTPRequest(ctx, r, []string{"notif.stream"})
	if err != nil {
		status := http.StatusUnauthorized
		if errors.Is(err, interceptor.ErrInsufficientPermissions) {
			status = http.StatusForbidden
		}
		http.Error(w, http.StatusText(status), status)
		return
	}

	lastEventID := strings.TrimSpace(r.Header.Get("Last-Event-ID"))
	if lastEventID == "" {
		lastEventID = strings.TrimSpace(r.URL.Query().Get("last_event_id"))
	}

	req := connect.NewRequest(&rpcv1.StreamNotificationsRequest{LastEventId: lastEventID})

	// Preserve request metadata that downstream logic relies on.
	for _, header := range []string{"User-Agent", "X-Forwarded-For", "X-Real-IP"} {
		if value := r.Header.Get(header); value != "" {
			req.Header().Set(header, value)
		}
	}

	sender, err := newHTTPEventSender(w)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if err := h.service.streamNotificationsCore(ctx, req, sender.Send); err != nil {
		if !sender.HasWritten() {
			status := statusFromConnectError(err)
			http.Error(w, http.StatusText(status), status)
		} else {
			slog.WarnContext(ctx, "SSE stream terminated with error after headers", "error", err)
		}
	}
}

func statusFromConnectError(err error) int {
	if err == nil {
		return http.StatusOK
	}

	var connectErr *connect.Error
	if errors.As(err, &connectErr) {
		switch connectErr.Code() {
		case connect.CodeUnauthenticated:
			return http.StatusUnauthorized
		case connect.CodePermissionDenied:
			return http.StatusForbidden
		default:
			return http.StatusInternalServerError
		}
	}

	return http.StatusInternalServerError
}

type httpEventSender struct {
	w           http.ResponseWriter
	flush       func() error
	headersSent bool
}

func newHTTPEventSender(w http.ResponseWriter) (*httpEventSender, error) {
	if rc := http.NewResponseController(w); rc != nil {
		return &httpEventSender{w: w, flush: rc.Flush}, nil
	}

	if flusher, ok := w.(http.Flusher); ok {
		return &httpEventSender{w: w, flush: func() error { flusher.Flush(); return nil }}, nil
	}

	return nil, fmt.Errorf("streaming not supported by server")
}

func (s *httpEventSender) HasWritten() bool {
	return s.headersSent
}

func (s *httpEventSender) ensureHeaders() error {
	if s.headersSent {
		return nil
	}

	headers := s.w.Header()
	headers.Set("Content-Type", "text/event-stream")
	headers.Set("Cache-Control", "no-cache, no-transform")
	headers.Set("Connection", "keep-alive")
	headers.Set("X-Accel-Buffering", "no")

	s.headersSent = true
	return s.flush()
}

func (s *httpEventSender) Send(event *rpcv1.NotificationEvent) error {
	if err := s.ensureHeaders(); err != nil {
		return err
	}

	payload, err := marshalNotificationEvent(event)
	if err != nil {
		return err
	}

	if event.EventType != "" {
		if _, err := fmt.Fprintf(s.w, "event: %s\n", event.EventType); err != nil {
			return err
		}
	}

	if event.EventId != "" {
		if _, err := fmt.Fprintf(s.w, "id: %s\n", event.EventId); err != nil {
			return err
		}
	}

	if _, err := fmt.Fprintf(s.w, "data: %s\n\n", payload); err != nil {
		return err
	}

	return s.flush()
}

type timestampJSON struct {
	Seconds string `json:"seconds,omitempty"`
	Nanos   int32  `json:"nanos,omitempty"`
}

type notificationSummaryJSON struct {
	NotificationID          string                   `json:"notificationId"`
	NotificationRecipientID string                   `json:"notificationRecipientId"`
	SourceDomain            string                   `json:"sourceDomain"`
	NotificationType        string                   `json:"notificationType"`
	Title                   string                   `json:"title"`
	Message                 string                   `json:"message"`
	ActionData              map[string]string        `json:"actionData,omitempty"`
	ReadStatus              bool                     `json:"readStatus"`
	ReadAt                  *timestampJSON           `json:"readAt,omitempty"`
	DeliveryStatus          string                   `json:"deliveryStatus"`
	DeliveredAt             *timestampJSON           `json:"deliveredAt,omitempty"`
	CreatedAt               *timestampJSON           `json:"createdAt,omitempty"`
	AcknowledgementStatus   string                   `json:"acknowledgementStatus,omitempty"`
	AcknowledgedAt          *timestampJSON           `json:"acknowledgedAt,omitempty"`
	AcknowledgementAction   string                   `json:"acknowledgementAction,omitempty"`
	FallbackStatus          string                   `json:"fallbackStatus,omitempty"`
	FallbackReason          string                   `json:"fallbackReason,omitempty"`
	PolicyKey               string                   `json:"policyKey,omitempty"`
	SourceCategory          string                   `json:"sourceCategory,omitempty"`
	NavigationTarget        *navigationTargetJSON    `json:"navigationTarget,omitempty"`
	Payload                 *notificationPayloadJSON `json:"payload,omitempty"`
}

type notificationPayloadJSON struct {
	SchemaVersion           int32                      `json:"schemaVersion"`
	NotificationID          string                     `json:"notificationId"`
	NotificationRecipientID string                     `json:"notificationRecipientId,omitempty"`
	SourceDomain            string                     `json:"sourceDomain"`
	NotificationType        string                     `json:"notificationType"`
	PolicyKey               string                     `json:"policyKey,omitempty"`
	SourceCategory          string                     `json:"sourceCategory,omitempty"`
	DeliveryClass           string                     `json:"deliveryClass,omitempty"`
	NavigationTarget        *navigationTargetJSON      `json:"navigationTarget,omitempty"`
	ActionData              map[string]string          `json:"actionData,omitempty"`
	Chat                    *chatNotificationJSON      `json:"chat,omitempty"`
	VoiceCall               *voiceCallNotificationJSON `json:"voiceCall,omitempty"`
	Task                    *taskNotificationJSON      `json:"task,omitempty"`
	Document                *documentNotificationJSON  `json:"document,omitempty"`
	Calendar                *calendarNotificationJSON  `json:"calendar,omitempty"`
}

type chatNotificationJSON struct {
	ChannelID        string `json:"channelId,omitempty"`
	ChannelType      string `json:"channelType,omitempty"`
	ChannelName      string `json:"channelName,omitempty"`
	MessageID        string `json:"messageId,omitempty"`
	ParentMessageID  string `json:"parentMessageId,omitempty"`
	SenderEmployeeID string `json:"senderEmployeeId,omitempty"`
	SenderName       string `json:"senderName,omitempty"`
	Action           string `json:"action,omitempty"`
}

type voiceCallNotificationJSON struct {
	ChannelID            string `json:"channelId,omitempty"`
	ChannelType          string `json:"channelType,omitempty"`
	ChannelName          string `json:"channelName,omitempty"`
	CallID               string `json:"callId,omitempty"`
	InvitationID         string `json:"invitationId,omitempty"`
	SenderEmployeeID     string `json:"senderEmployeeId,omitempty"`
	SenderName           string `json:"senderName,omitempty"`
	InitiatorEmployeeID  string `json:"initiatorEmployeeId,omitempty"`
	State                string `json:"state,omitempty"`
	ParticipantCount     int32  `json:"participantCount,omitempty"`
	AlreadyInAnotherCall bool   `json:"alreadyInAnotherCall,omitempty"`
	Action               string `json:"action,omitempty"`
	Outcome              string `json:"outcome,omitempty"`
}

type taskNotificationJSON struct {
	ProjectID     string `json:"projectId,omitempty"`
	TaskID        string `json:"taskId,omitempty"`
	TaskTitle     string `json:"taskTitle,omitempty"`
	RequirementID string `json:"requirementId,omitempty"`
	FocusIntent   string `json:"focusIntent,omitempty"`
	EntryContext  string `json:"entryContext,omitempty"`
}

type documentNotificationJSON struct {
	DocumentID string `json:"documentId,omitempty"`
	CommentID  string `json:"commentId,omitempty"`
	ReplyID    string `json:"replyId,omitempty"`
}

type calendarNotificationJSON struct {
	EventID    string `json:"eventId,omitempty"`
	EventTitle string `json:"eventTitle,omitempty"`
}

type navigationTargetJSON struct {
	Domain       string `json:"domain,omitempty"`
	ResourceType string `json:"resourceType,omitempty"`
	ResourceID   string `json:"resourceId,omitempty"`
	SecondaryID  string `json:"secondaryId,omitempty"`
	Action       string `json:"action,omitempty"`
}

type notificationEventJSON struct {
	EventID      string                   `json:"eventId"`
	EventType    string                   `json:"eventType"`
	Notification *notificationSummaryJSON `json:"notification,omitempty"`
	Timestamp    *timestampJSON           `json:"timestamp,omitempty"`
	ConnectionID string                   `json:"connectionId,omitempty"`
}

func marshalNotificationEvent(event *rpcv1.NotificationEvent) ([]byte, error) {
	payload := notificationEventJSON{
		EventID:      event.EventId,
		EventType:    event.EventType,
		Timestamp:    toTimestampJSON(event.Timestamp),
		ConnectionID: event.ConnectionId,
	}

	if event.Notification != nil {
		var actionData map[string]string
		if len(event.Notification.ActionData) > 0 {
			actionData = make(map[string]string, len(event.Notification.ActionData))
			for k, v := range event.Notification.ActionData {
				actionData[k] = v
			}
		}

		notificationPayload := &notificationSummaryJSON{
			NotificationID:          event.Notification.NotificationId,
			NotificationRecipientID: event.Notification.NotificationRecipientId,
			SourceDomain:            event.Notification.SourceDomain,
			NotificationType:        event.Notification.NotificationType,
			Title:                   event.Notification.Title,
			Message:                 event.Notification.Message,
			ActionData:              actionData,
			ReadStatus:              event.Notification.ReadStatus,
			ReadAt:                  toTimestampJSON(event.Notification.ReadAt),
			DeliveryStatus:          event.Notification.DeliveryStatus,
			DeliveredAt:             toTimestampJSON(event.Notification.DeliveredAt),
			CreatedAt:               toTimestampJSON(event.Notification.CreatedAt),
			AcknowledgementStatus:   event.Notification.AcknowledgementStatus,
			AcknowledgedAt:          toTimestampJSON(event.Notification.AcknowledgedAt),
			AcknowledgementAction:   event.Notification.AcknowledgementAction,
			FallbackStatus:          event.Notification.FallbackStatus,
			FallbackReason:          event.Notification.FallbackReason,
			PolicyKey:               event.Notification.PolicyKey,
			SourceCategory:          event.Notification.SourceCategory,
			Payload:                 notificationPayloadJSONFromProto(event.Notification.Payload),
		}
		if target := event.Notification.NavigationTarget; target != nil {
			notificationPayload.NavigationTarget = navigationTargetJSONFromProto(target)
		}
		payload.Notification = notificationPayload
	}

	return json.Marshal(payload)
}

func notificationPayloadJSONFromProto(payload *rpcv1.NotificationPayload) *notificationPayloadJSON {
	if payload == nil {
		return nil
	}
	return &notificationPayloadJSON{
		SchemaVersion:           payload.SchemaVersion,
		NotificationID:          payload.NotificationId,
		NotificationRecipientID: payload.NotificationRecipientId,
		SourceDomain:            payload.SourceDomain,
		NotificationType:        payload.NotificationType,
		PolicyKey:               payload.PolicyKey,
		SourceCategory:          payload.SourceCategory,
		DeliveryClass:           payload.DeliveryClass,
		NavigationTarget:        navigationTargetJSONFromProto(payload.NavigationTarget),
		ActionData:              cloneStringMap(payload.ActionData),
		Chat:                    chatNotificationJSONFromProto(payload.Chat),
		VoiceCall:               voiceCallNotificationJSONFromProto(payload.VoiceCall),
		Task:                    taskNotificationJSONFromProto(payload.Task),
		Document:                documentNotificationJSONFromProto(payload.Document),
		Calendar:                calendarNotificationJSONFromProto(payload.Calendar),
	}
}

func navigationTargetJSONFromProto(target *rpcv1.NavigationTarget) *navigationTargetJSON {
	if target == nil {
		return nil
	}
	return &navigationTargetJSON{
		Domain:       target.Domain,
		ResourceType: target.ResourceType,
		ResourceID:   target.ResourceId,
		SecondaryID:  target.SecondaryId,
		Action:       target.Action,
	}
}

func chatNotificationJSONFromProto(chat *rpcv1.ChatNotificationPayload) *chatNotificationJSON {
	if chat == nil {
		return nil
	}
	return &chatNotificationJSON{
		ChannelID:        chat.ChannelId,
		ChannelType:      chat.ChannelType,
		ChannelName:      chat.ChannelName,
		MessageID:        chat.MessageId,
		ParentMessageID:  chat.ParentMessageId,
		SenderEmployeeID: chat.SenderEmployeeId,
		SenderName:       chat.SenderName,
		Action:           chat.Action,
	}
}

func voiceCallNotificationJSONFromProto(voiceCall *rpcv1.VoiceCallNotificationPayload) *voiceCallNotificationJSON {
	if voiceCall == nil {
		return nil
	}
	return &voiceCallNotificationJSON{
		ChannelID:            voiceCall.ChannelId,
		ChannelType:          voiceCall.ChannelType,
		ChannelName:          voiceCall.ChannelName,
		CallID:               voiceCall.CallId,
		InvitationID:         voiceCall.InvitationId,
		SenderEmployeeID:     voiceCall.SenderEmployeeId,
		SenderName:           voiceCall.SenderName,
		InitiatorEmployeeID:  voiceCall.InitiatorEmployeeId,
		State:                voiceCall.State,
		ParticipantCount:     voiceCall.ParticipantCount,
		AlreadyInAnotherCall: voiceCall.AlreadyInAnotherCall,
		Action:               voiceCall.Action,
		Outcome:              voiceCall.Outcome,
	}
}

func taskNotificationJSONFromProto(task *rpcv1.TaskNotificationPayload) *taskNotificationJSON {
	if task == nil {
		return nil
	}
	return &taskNotificationJSON{
		ProjectID:     task.ProjectId,
		TaskID:        task.TaskId,
		TaskTitle:     task.TaskTitle,
		RequirementID: task.RequirementId,
		FocusIntent:   task.FocusIntent,
		EntryContext:  task.EntryContext,
	}
}

func documentNotificationJSONFromProto(document *rpcv1.DocumentNotificationPayload) *documentNotificationJSON {
	if document == nil {
		return nil
	}
	return &documentNotificationJSON{
		DocumentID: document.DocumentId,
		CommentID:  document.CommentId,
		ReplyID:    document.ReplyId,
	}
}

func calendarNotificationJSONFromProto(calendar *rpcv1.CalendarNotificationPayload) *calendarNotificationJSON {
	if calendar == nil {
		return nil
	}
	return &calendarNotificationJSON{
		EventID:    calendar.EventId,
		EventTitle: calendar.EventTitle,
	}
}

func toTimestampJSON(ts *timestamppb.Timestamp) *timestampJSON {
	if ts == nil {
		return nil
	}

	if err := ts.CheckValid(); err != nil {
		// Invalid timestamps are ignored to avoid breaking the SSE stream.
		slog.Warn("invalid timestamp in notification event", "error", err)
		return nil
	}

	seconds := strconv.FormatInt(ts.Seconds, 10)
	return &timestampJSON{
		Seconds: seconds,
		Nanos:   int32(ts.Nanos),
	}
}
