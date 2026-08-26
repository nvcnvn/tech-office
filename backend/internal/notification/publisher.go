package notification

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/url"
	"strings"
	"time"

	"connectrpc.com/connect"
	googl "github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

const (
	directRescuePushWindow     = 2 * time.Second
	subscribedRescuePushWindow = 4 * time.Second
	maxRescuePushWindow        = 5 * time.Second
)

// Helper function to convert string to pgtype.Text
func stringToNullText(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{Valid: false}
	}
	return pgtype.Text{String: s, Valid: true}
}

// navigationTargetToJSON marshals a NavigationTarget proto message to JSONB bytes.
// Returns an empty JSON object if nt is nil.
func navigationTargetToJSON(nt *rpcv1.NavigationTarget) ([]byte, error) {
	if nt == nil {
		return []byte("{}"), nil
	}
	return json.Marshal(map[string]string{
		"domain":       nt.GetDomain(),
		"resourceType": nt.GetResourceType(),
		"resourceId":   nt.GetResourceId(),
		"secondaryId":  nt.GetSecondaryId(),
		"action":       nt.GetAction(),
	})
}

// navigationTargetFromJSON unmarshals JSONB bytes to a NavigationTarget proto message.
func navigationTargetFromJSON(data []byte) *rpcv1.NavigationTarget {
	if len(data) == 0 {
		return nil
	}
	var m map[string]string
	if err := json.Unmarshal(data, &m); err != nil {
		return nil
	}
	if len(m) == 0 {
		return nil
	}
	return &rpcv1.NavigationTarget{
		Domain:       m["domain"],
		ResourceType: m["resourceType"],
		ResourceId:   m["resourceId"],
		SecondaryId:  m["secondaryId"],
		Action:       m["action"],
	}
}

func pushDataFromNotificationRecord(record *database.NotificationNotification) map[string]string {
	return pushDataFromNotificationFields(record.ID, dbuuid.UUID{}, record.ActionData, record.NavigationTarget, record.SourceDomain, record.NotificationType, record.PolicyKey)
}

func pushDataFromNotificationFields(notificationID, recipientID dbuuid.UUID, actionDataRaw, navigationTargetRaw []byte, sourceDomain, notificationType, policyKey string) map[string]string {
	actionData := map[string]string{}
	_ = json.Unmarshal(actionDataRaw, &actionData)

	data := make(map[string]string, len(actionData)+14)
	for key, value := range actionData {
		data[key] = value
	}
	data["notificationId"] = notificationID.String()
	data["notification_id"] = notificationID.String()
	if recipientID != (dbuuid.UUID{}) {
		data["notificationRecipientId"] = recipientID.String()
		data["notification_recipient_id"] = recipientID.String()
	}
	data["sourceDomain"] = sourceDomain
	data["source_domain"] = sourceDomain
	data["notificationType"] = notificationType
	data["notification_type"] = notificationType
	if policyKey != "" {
		data["policyKey"] = policyKey
		data["policy_key"] = policyKey
	}
	if navigationTarget := navigationTargetFromJSON(navigationTargetRaw); navigationTarget != nil {
		data["navigationDomain"] = navigationTarget.GetDomain()
		data["navigationResourceType"] = navigationTarget.GetResourceType()
		data["navigationResourceId"] = navigationTarget.GetResourceId()
		data["navigationSecondaryId"] = navigationTarget.GetSecondaryId()
		data["navigationAction"] = navigationTarget.GetAction()
		applyPushClickAction(data, sourceDomain, notificationType, navigationTarget)
	} else {
		applyPushClickAction(data, sourceDomain, notificationType, nil)
	}
	return data
}

func applyPushClickAction(data map[string]string, sourceDomain, notificationType string, navigationTarget *rpcv1.NavigationTarget) {
	if data == nil {
		return
	}
	if clickAction := resolveWebPushClickAction(data, sourceDomain, notificationType, navigationTarget); clickAction != "" {
		data["click_action"] = clickAction
	}
}

func resolveWebPushClickAction(data map[string]string, sourceDomain, notificationType string, navigationTarget *rpcv1.NavigationTarget) string {
	if href := strings.TrimSpace(data["click_action"]); href != "" {
		return href
	}
	if href := strings.TrimSpace(data["webHref"]); href != "" {
		return href
	}

	deepLink := strings.TrimSpace(data["deepLink"])
	if deepLink != "" {
		parts := strings.Split(strings.Trim(deepLink, "/"), "/")
		switch {
		case len(parts) >= 3 && parts[0] == "tasks":
			return "/workspace/tasks/" + url.PathEscape(parts[1]) + "/tasks/" + url.PathEscape(parts[2])
		case len(parts) >= 2 && parts[0] == "chat":
			return webChatHref(parts[1], data)
		}
	}

	if navigationTarget != nil {
		switch navigationTarget.GetResourceType() {
		case "task":
			projectID := strings.TrimSpace(data["projectId"])
			taskID := strings.TrimSpace(data["taskId"])
			if taskID == "" {
				taskID = strings.TrimSpace(navigationTarget.GetResourceId())
			}
			if projectID != "" && taskID != "" {
				return "/workspace/tasks/" + url.PathEscape(projectID) + "/tasks/" + url.PathEscape(taskID)
			}
		case "channel", "chat_channel":
			if channelID := strings.TrimSpace(navigationTarget.GetResourceId()); channelID != "" {
				return webChatHref(channelID, data)
			}
		}
	}

	if sourceDomain == SourceDomainChat || notificationType == NotificationTypeVoiceCallIncoming {
		if channelID := strings.TrimSpace(data["channelId"]); channelID != "" {
			return webChatHref(channelID, data)
		}
	}

	return "/workspace"
}

func webChatHref(channelID string, data map[string]string) string {
	params := url.Values{}
	params.Set("channel", channelID)
	if parentMessageID := strings.TrimSpace(data["parentMessageId"]); parentMessageID != "" {
		params.Set("thread", parentMessageID)
		if messageID := strings.TrimSpace(data["messageId"]); messageID != "" {
			params.Set("message", messageID)
		} else {
			params.Set("message", parentMessageID)
		}
	} else if messageID := strings.TrimSpace(data["messageId"]); messageID != "" {
		params.Set("message", messageID)
	}
	return "/workspace/chat?" + params.Encode()
}

func collectPushFallbackRecipients(
	ctx context.Context,
	tx database.DBTX,
	routing RoutingLogic,
	employeeIDs []dbuuid.UUID,
	orgID dbuuid.UUID,
	priority int32,
	sourceDomain string,
	channelID *dbuuid.UUID,
) []dbuuid.UUID {
	plan := planPushFallbacks(ctx, tx, routing, employeeIDs, orgID, priority, sourceDomain, channelID)
	return plan.immediatePushRecipients
}

type pushFallbackPlan struct {
	immediatePushRecipients []dbuuid.UUID
	rescueQueueRecipients   []dbuuid.UUID
	skippedRecipients       map[dbuuid.UUID]string
	// pushReasons records why each immediate-push recipient got one. Non-empty only
	// where absence of a responsive connection drove the decision (FR-014), so the
	// delivery record distinguishes "unreachable live" from a priority or policy send.
	pushReasons map[dbuuid.UUID]string
}

func planPushFallbacks(
	ctx context.Context,
	tx database.DBTX,
	routing RoutingLogic,
	employeeIDs []dbuuid.UUID,
	orgID dbuuid.UUID,
	priority int32,
	sourceDomain string,
	channelID *dbuuid.UUID,
) pushFallbackPlan {
	plan := pushFallbackPlan{
		skippedRecipients: make(map[dbuuid.UUID]string),
		pushReasons:       make(map[dbuuid.UUID]string),
	}

	if routing == nil || len(employeeIDs) == 0 {
		return plan
	}

	skippedByReason := make(map[string]int)
	for _, employeeID := range employeeIDs {
		decision := routing.DecideFallback(ctx, tx, employeeID, orgID, priority, sourceDomain, channelID)
		if decision.ShouldSend {
			plan.immediatePushRecipients = append(plan.immediatePushRecipients, employeeID)
			if decision.Reason != "" {
				plan.pushReasons[employeeID] = decision.Reason
			}
			continue
		}

		reason := decision.Reason
		if reason == "" {
			reason = "unknown"
		}

		if reason == FallbackReasonRecipientOnline {
			plan.rescueQueueRecipients = append(plan.rescueQueueRecipients, employeeID)
		} else {
			plan.skippedRecipients[employeeID] = reason
		}

		skippedByReason[reason]++

		slog.DebugContext(ctx, "push fallback skipped by routing decision",
			"employee_id", employeeID.String(),
			"organization_id", orgID.String(),
			"reason", reason,
		)
	}

	slog.InfoContext(ctx, "push fallback routing evaluated",
		"organization_id", orgID.String(),
		"candidate_count", len(employeeIDs),
		"push_recipient_count", len(plan.immediatePushRecipients),
		"rescue_queue_count", len(plan.rescueQueueRecipients),
		"skipped_by_reason", skippedByReason,
	)

	return plan
}

func rescuePushWindowForRequest(req *rpcv1.PublishNotificationRequest) time.Duration {
	if req == nil {
		return directRescuePushWindow
	}
	if req.Priority == int32(PriorityAlways) {
		return 0
	}
	window := directRescuePushWindow
	if req.SourceCategory == SourceCategoryActivity {
		window = subscribedRescuePushWindow
	}
	if window > maxRescuePushWindow {
		return maxRescuePushWindow
	}
	return window
}

func (s *NotificationService) queueRescueFallbacks(
	ctx context.Context,
	tx database.DBTX,
	notificationID dbuuid.UUID,
	orgID dbuuid.UUID,
	employeeIDs []dbuuid.UUID,
	window time.Duration,
	reason string,
) ([]*database.SetFallbackQueuedForRecipientsRow, error) {
	if len(employeeIDs) == 0 {
		return nil, nil
	}

	now := time.Now().UTC()
	rows, err := s.Queries.SetFallbackQueuedForRecipients(ctx, tx, &database.SetFallbackQueuedForRecipientsParams{
		FallbackReason: pgtype.Text{String: reason, Valid: true},
		FallbackDueAt:  pgtype.Timestamptz{Time: now.Add(window), Valid: true},
		UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
		OrganizationID: orgID,
		NotificationID: notificationID,
		EmployeeIds:    employeeIDs,
	})
	if err != nil {
		return nil, err
	}

	attemptedAt := pgtype.Timestamptz{Time: now, Valid: true}
	for _, row := range rows {
		if err := s.recordDeliveryAttempt(ctx, tx, orgID, row.ID, "push", "queued", reason, attemptedAt, map[string]string{
			"fallbackDueAt": now.Add(window).Format(time.RFC3339Nano),
		}); err != nil {
			return nil, err
		}
	}

	return rows, nil
}

func (s *NotificationService) markSkippedFallbacks(
	ctx context.Context,
	tx database.DBTX,
	notificationID dbuuid.UUID,
	orgID dbuuid.UUID,
	skipped map[dbuuid.UUID]string,
) error {
	if len(skipped) == 0 {
		return nil
	}

	byReason := make(map[string][]dbuuid.UUID)
	for employeeID, reason := range skipped {
		if reason == "" {
			reason = FallbackReasonRecipientIneligible
		}
		byReason[reason] = append(byReason[reason], employeeID)
	}

	now := pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true}
	for reason, employeeIDs := range byReason {
		rows, err := s.Queries.SetFallbackSkippedForRecipientsByEmployeeIDs(ctx, tx, &database.SetFallbackSkippedForRecipientsByEmployeeIDsParams{
			FallbackReason: pgtype.Text{String: reason, Valid: true},
			UpdatedAt:      now,
			OrganizationID: orgID,
			NotificationID: notificationID,
			EmployeeIds:    employeeIDs,
		})
		if err != nil {
			return err
		}
		for _, row := range rows {
			if err := s.recordDeliveryAttempt(ctx, tx, orgID, row.ID, "push", "skipped", reason, now, nil); err != nil {
				return err
			}
		}
	}

	return nil
}

func (s *NotificationService) sendPushAndRecord(
	ctx context.Context,
	tx database.DBTX,
	employeeID dbuuid.UUID,
	orgID dbuuid.UUID,
	recipientID dbuuid.UUID,
	payload *PushNotificationPayload,
	sentReason string,
) error {
	now := pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true}
	if s.PushLogic == nil {
		slog.WarnContext(ctx, "push delivery is not configured",
			"employee_id", employeeID.String(),
			"notification_recipient_id", recipientID.String())
		if err := s.Queries.SetFallbackFailedForRecipient(ctx, tx, &database.SetFallbackFailedForRecipientParams{
			FallbackReason:          pgtype.Text{String: FallbackReasonDeliveryError, Valid: true},
			UpdatedAt:               now,
			OrganizationID:          orgID,
			NotificationRecipientID: recipientID,
		}); err != nil {
			return err
		}
		return s.recordDeliveryAttempt(ctx, tx, orgID, recipientID, "push", "failed", FallbackReasonDeliveryError, now, map[string]string{"error": "push_not_configured"})
	}

	tokens, err := s.PushLogic.GetEmployeePushTokens(ctx, tx, employeeID, orgID)
	if err != nil {
		return err
	}
	if len(tokens) == 0 {
		if err := s.Queries.SetFallbackSkippedForRecipient(ctx, tx, &database.SetFallbackSkippedForRecipientParams{
			FallbackReason:          pgtype.Text{String: FallbackReasonNoPushTarget, Valid: true},
			UpdatedAt:               now,
			OrganizationID:          orgID,
			NotificationRecipientID: recipientID,
		}); err != nil {
			return err
		}
		return s.recordDeliveryAttempt(ctx, tx, orgID, recipientID, "push", "skipped", FallbackReasonNoPushTarget, now, nil)
	}

	if err := s.PushLogic.SendPushNotification(context.Background(), employeeID, orgID, payload); err != nil {
		if updateErr := s.Queries.SetFallbackFailedForRecipient(ctx, tx, &database.SetFallbackFailedForRecipientParams{
			FallbackReason:          pgtype.Text{String: FallbackReasonDeliveryError, Valid: true},
			UpdatedAt:               now,
			OrganizationID:          orgID,
			NotificationRecipientID: recipientID,
		}); updateErr != nil {
			return updateErr
		}
		return s.recordDeliveryAttempt(ctx, tx, orgID, recipientID, "push", "failed", FallbackReasonDeliveryError, now, map[string]string{"error": err.Error()})
	}

	reason := pgtype.Text{Valid: false}
	if sentReason != "" {
		reason = pgtype.Text{String: sentReason, Valid: true}
	}
	if err := s.Queries.SetFallbackSentForRecipient(ctx, tx, &database.SetFallbackSentForRecipientParams{
		FallbackReason:          reason,
		UpdatedAt:               now,
		OrganizationID:          orgID,
		NotificationRecipientID: recipientID,
	}); err != nil {
		return err
	}
	return s.recordDeliveryAttempt(ctx, tx, orgID, recipientID, "push", "sent", sentReason, now, nil)
}

func (s *NotificationService) recordDeliveryAttempt(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	recipientID dbuuid.UUID,
	channel string,
	status string,
	reason string,
	attemptedAt pgtype.Timestamptz,
	metadata map[string]string,
) error {
	reasonText := pgtype.Text{Valid: false}
	if reason != "" {
		reasonText = pgtype.Text{String: reason, Valid: true}
	}
	instanceID := pgtype.Text{Valid: false}
	if s.InstanceID != "" {
		instanceID = pgtype.Text{String: s.InstanceID, Valid: true}
	}
	metadataJSON := []byte("{}")
	if len(metadata) > 0 {
		encoded, err := json.Marshal(metadata)
		if err != nil {
			return err
		}
		metadataJSON = encoded
	}

	return s.Queries.InsertDeliveryAttempt(ctx, tx, &database.InsertDeliveryAttemptParams{
		OrganizationID:          orgID,
		NotificationRecipientID: recipientID,
		Channel:                 channel,
		AttemptStatus:           status,
		Reason:                  reasonText,
		AttemptedAt:             attemptedAt,
		InstanceID:              instanceID,
		Metadata:                metadataJSON,
	})
}

// PublishNotification creates and sends notifications to target employees.
// BACKEND SERVICES ONLY - not accessible to end users.
// Uses AdminPool for system-scope cross-tenant publishing.
func (s *NotificationService) PublishNotification(ctx context.Context, tx database.DBTX, req *rpcv1.PublishNotificationRequest) (*rpcv1.PublishNotificationResponse, error) {
	slog.InfoContext(ctx, "publishing notification",
		"sourceDomain", req.SourceDomain,
		"notificationType", req.NotificationType,
		"organizationID", req.OrganizationId,
		"priority", req.Priority,
		"publishingServiceID", req.PublishingServiceId)

	// Validate request
	if err := s.validatePublishRequest(req); err != nil {
		slog.ErrorContext(ctx, "invalid publish request", "error", err)
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	var notificationID dbuuid.UUID
	var recipientEmployeeIDs []dbuuid.UUID
	var recipientCount int32
	orgID := dbuuid.MustParse(req.OrganizationId)

	// Check if this is a live-only (ephemeral) event: either via delivery_class or the
	// legacy active_channel_id + PrioritySilent pattern for backward compatibility.
	isEphemeralChannelEvent := (req.DeliveryClass == DeliveryClassLiveOnly && req.ActiveChannelId != "") ||
		(req.ActiveChannelId != "" && req.Priority == int32(PrioritySilent))

	// Live-only with explicit recipients but no channel context: route via employee-scoped
	// NOTIFY with inline data, no DB persistence, no push notifications.
	isLiveOnlyBroadcast := req.DeliveryClass == DeliveryClassLiveOnly && req.ActiveChannelId == ""

	if isLiveOnlyBroadcast {
		notificationID = dbuuid.UUID(googl.New())

		slog.InfoContext(ctx, "live-only broadcast - skipping DB persistence",
			"notificationID", notificationID.String(),
			"notificationType", req.NotificationType,
		)

		employeeIDs, _, err := s.resolveRecipients(ctx, tx, orgID, req.Recipients)
		if err != nil {
			return nil, fmt.Errorf("failed to resolve recipients for live-only broadcast: %w", err)
		}

		instanceEmployeeMap, err := s.queryInstancesForEmployees(ctx, tx, employeeIDs, orgID)
		if err != nil {
			return nil, fmt.Errorf("failed to query instances for live-only broadcast: %w", err)
		}

		if err := s.notifyInstancesWithEphemeralData(ctx, tx, instanceEmployeeMap, notificationID, orgID, int(req.Priority), req); err != nil {
			return nil, fmt.Errorf("failed to publish live-only broadcast: %w", err)
		}

		recipientIDStrings := make([]string, len(employeeIDs))
		for i, id := range employeeIDs {
			recipientIDStrings[i] = id.String()
		}

		return &rpcv1.PublishNotificationResponse{
			NotificationId:       notificationID.String(),
			RecipientCount:       int32(len(employeeIDs)),
			RecipientEmployeeIds: recipientIDStrings,
		}, nil
	}

	if isEphemeralChannelEvent {
		// Ephemeral channel events (typing, reactions): NO database persistence
		// Generate transient notification ID for NOTIFY routing only
		notificationID = dbuuid.UUID(googl.New())

		slog.InfoContext(ctx, "ephemeral channel event - skipping DB persistence",
			"notificationID", notificationID.String(),
			"channelID", req.ActiveChannelId,
			"notificationType", req.NotificationType,
			"actionData", req.ActionData,
		)

		// Publish to instances via NOTIFY (channel-scoped)
		channelID, err := dbuuid.Parse(req.ActiveChannelId)
		if err != nil {
			slog.ErrorContext(ctx, "invalid active_channel_id", "error", err, "channelID", req.ActiveChannelId)
			return nil, fmt.Errorf("invalid active_channel_id: %w", err)
		}
		slog.InfoContext(ctx, "calling publishToInstancesByChannel for ephemeral event",
			"channelID", channelID.String(),
			"organizationID", orgID.String(),
			"notificationType", req.NotificationType)
		if err := s.publishToInstancesByChannel(ctx, tx, channelID, orgID, notificationID, int(req.Priority), req); err != nil {
			slog.ErrorContext(ctx, "failed to publish ephemeral event to channel", "error", err)
			return nil, fmt.Errorf("failed to publish ephemeral event: %w", err)
		}
		slog.InfoContext(ctx, "successfully published ephemeral event to channel",
			"channelID", channelID.String())

		// Return minimal response (no recipient tracking for ephemeral events)
		return &rpcv1.PublishNotificationResponse{
			NotificationId:       notificationID.String(),
			RecipientCount:       0, // Ephemeral - not tracked
			RecipientEmployeeIds: []string{},
		}, nil
	}

	// Normal persistent notification flow
	// Resolve recipients (employee_ids and department_ids)
	employeeIDs, deptIDs, err := s.resolveRecipients(ctx, tx, orgID, req.Recipients)
	if err != nil {
		slog.ErrorContext(ctx, "failed to resolve recipients", "error", err, "organizationID", req.OrganizationId)
		return nil, fmt.Errorf("failed to resolve recipients: %w", err)
	}
	recipientEmployeeIDs = employeeIDs
	recipientCount = int32(len(employeeIDs))

	slog.DebugContext(ctx, "resolved recipients", "count", recipientCount, "departments", len(deptIDs))

	// Create notification with recipients in database
	notification, err := s.createNotificationWithRecipients(ctx, tx, req, employeeIDs, deptIDs)
	if err != nil {
		slog.ErrorContext(ctx, "failed to create notification", "error", err)
		return nil, fmt.Errorf("failed to create notification: %w", err)
	}
	notificationID = notification.ID

	slog.InfoContext(ctx, "notification created", "notificationID", notificationID.String(), "recipientCount", recipientCount)

	// Publish to instances via NOTIFY and identify offline employees
	offlineEmployees, err := s.publishToInstances(ctx, tx, employeeIDs, orgID, notificationID, int(req.Priority))
	if err != nil {
		slog.ErrorContext(ctx, "failed to publish to instances", "error", err, "notificationID", notificationID.String())
		return nil, fmt.Errorf("failed to publish to instances: %w", err)
	}

	slog.InfoContext(ctx, "✅ TRANSACTION COMMITTED - NOTIFY should have been broadcast", "notificationID", notificationID.String())

	var pushChannelID *dbuuid.UUID
	if req.ActiveChannelId != "" {
		channelID, parseErr := dbuuid.Parse(req.ActiveChannelId)
		if parseErr != nil {
			slog.WarnContext(ctx, "invalid active_channel_id for push fallback evaluation",
				"notificationID", notificationID.String(),
				"activeChannelID", req.ActiveChannelId,
				"error", parseErr,
			)
		} else {
			pushChannelID = &channelID
		}
	}

	fallbackPlan := pushFallbackPlan{
		immediatePushRecipients: offlineEmployees,
		skippedRecipients:       map[dbuuid.UUID]string{},
		pushReasons:             map[dbuuid.UUID]string{},
	}
	if s.RoutingLogic != nil {
		fallbackPlan = planPushFallbacks(
			ctx,
			tx,
			s.RoutingLogic,
			employeeIDs,
			orgID,
			req.Priority,
			req.SourceDomain,
			pushChannelID,
		)
	}

	queuedRows, err := s.queueRescueFallbacks(ctx, tx, notificationID, orgID, fallbackPlan.rescueQueueRecipients, rescuePushWindowForRequest(req), FallbackReasonRecipientOnline)
	if err != nil {
		return nil, fmt.Errorf("failed to queue rescue push fallbacks: %w", err)
	}
	if err := s.markSkippedFallbacks(ctx, tx, notificationID, orgID, fallbackPlan.skippedRecipients); err != nil {
		return nil, fmt.Errorf("failed to mark skipped push fallbacks: %w", err)
	}

	// Recipients that cannot be reached live are queued with a zero window instead of
	// being pushed inline. The rescue push worker (1s tick) does the FCM round-trip on
	// its own connection, so an unresponsive FCM can no longer hold this request — and
	// its Postgres transaction — open for the full fcmBatchTimeout.
	immediateByReason := make(map[string][]dbuuid.UUID, len(fallbackPlan.immediatePushRecipients))
	for _, empID := range fallbackPlan.immediatePushRecipients {
		reason := fallbackPlan.pushReasons[empID]
		if reason == "" {
			reason = FallbackReasonConnectionUnresponsive
		}
		immediateByReason[reason] = append(immediateByReason[reason], empID)
	}
	for reason, empIDs := range immediateByReason {
		if _, err := s.queueRescueFallbacks(ctx, tx, notificationID, orgID, empIDs, 0, reason); err != nil {
			return nil, fmt.Errorf("failed to queue immediate push fallbacks: %w", err)
		}
	}

	slog.InfoContext(ctx, "push fallback evaluation complete",
		"notificationID", notificationID.String(),
		"total_recipients", len(employeeIDs),
		"offline_recipient_count", len(offlineEmployees),
		"push_recipient_count", len(fallbackPlan.immediatePushRecipients),
		"rescue_queue_count", len(queuedRows),
		"push_configured", s.PushLogic != nil,
	)

	// Convert UUIDs to strings for response
	recipientIDStrings := make([]string, len(recipientEmployeeIDs))
	for i, id := range recipientEmployeeIDs {
		recipientIDStrings[i] = id.String()
	}

	return &rpcv1.PublishNotificationResponse{
		NotificationId:       notificationID.String(),
		RecipientCount:       recipientCount,
		RecipientEmployeeIds: recipientIDStrings,
	}, nil
}

// validatePublishRequest validates the publish notification request.
func (s *NotificationService) validatePublishRequest(req *rpcv1.PublishNotificationRequest) error {
	if req.OrganizationId == "" {
		return fmt.Errorf("organization_id is required")
	}
	isLiveOnly := req.DeliveryClass == DeliveryClassLiveOnly || (req.ActiveChannelId != "" && req.Priority == int32(PrioritySilent))
	if req.Recipients == nil && req.ActiveChannelId == "" {
		return fmt.Errorf("recipients is required")
	}
	if req.Recipients != nil && req.ActiveChannelId == "" && len(req.Recipients.EmployeeIds) == 0 && len(req.Recipients.DepartmentIds) == 0 {
		return fmt.Errorf("at least one of employee_ids or department_ids is required")
	}
	if req.SourceDomain == "" {
		return fmt.Errorf("source_domain is required")
	}
	if req.NotificationType == "" {
		return fmt.Errorf("notification_type is required")
	}
	if req.Title == "" {
		return fmt.Errorf("title is required")
	}
	if !isLiveOnly && req.Message == "" {
		return fmt.Errorf("message is required")
	}
	if req.Priority < 0 || req.Priority > 4 {
		return fmt.Errorf("priority must be 0, 1, 2, or 4")
	}
	return nil
}

// resolveRecipients resolves employee_ids and department_ids to a final list of employee UUIDs.
// Returns: (employeeIDs, departmentIDs, error)
func (s *NotificationService) resolveRecipients(
	ctx context.Context,
	tx database.DBTX,
	organizationID dbuuid.UUID,
	recipients *rpcv1.NotificationRecipients,
) ([]dbuuid.UUID, []dbuuid.UUID, error) {
	slog.DebugContext(ctx, "resolveRecipients called",
		"function", "resolveRecipients",
		"organizationID", organizationID,
		"inputEmployeeIDs", recipients.EmployeeIds,
		"inputDepartmentIDs", recipients.DepartmentIds,
	)

	employeeIDMap := make(map[dbuuid.UUID]bool)
	var departmentIDs []dbuuid.UUID

	// Add direct employee_ids
	for _, idStr := range recipients.EmployeeIds {
		id, err := dbuuid.Parse(idStr)
		if err != nil {
			return nil, nil, fmt.Errorf("invalid employee_id: %w", err)
		}
		employeeIDMap[id] = true
	}

	slog.DebugContext(ctx, "added direct employee IDs",
		"function", "resolveRecipients",
		"count", len(employeeIDMap),
	)

	// Resolve department_ids to employees
	for _, deptIDStr := range recipients.DepartmentIds {
		deptID, err := dbuuid.Parse(deptIDStr)
		if err != nil {
			return nil, nil, fmt.Errorf("invalid department_id: %w", err)
		}

		// Track department IDs
		departmentIDs = append(departmentIDs, deptID)

		slog.DebugContext(ctx, "querying department members",
			"function", "resolveRecipients",
			"departmentID", deptID,
		)

		// Query department members
		members, err := s.Queries.GetDepartmentMembers(ctx, tx, &database.GetDepartmentMembersParams{
			DepartmentID:   deptID,
			OrganizationID: organizationID,
		})
		if err != nil {
			return nil, nil, fmt.Errorf("failed to query department members: %w", err)
		}

		slog.DebugContext(ctx, "department members retrieved",
			"function", "resolveRecipients",
			"departmentID", deptID,
			"memberCount", len(members),
		)

		for _, member := range members {
			employeeIDMap[member.EmployeeID] = true
		}
	}

	// Convert map to slice
	candidateEmployeeIDs := make([]dbuuid.UUID, 0, len(employeeIDMap))
	for id := range employeeIDMap {
		candidateEmployeeIDs = append(candidateEmployeeIDs, id)
	}

	slog.DebugContext(ctx, "candidate recipients before validation",
		"function", "resolveRecipients",
		"candidateCount", len(candidateEmployeeIDs),
	)

	// Validate that all employee IDs actually exist in organization.employee table
	// This prevents FK constraint violations when creating notification_recipient records
	validEmployeeIDs, err := s.Queries.ValidateEmployeesExist(ctx, tx, &database.ValidateEmployeesExistParams{
		OrganizationID: organizationID,
		Column2:        candidateEmployeeIDs,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("failed to validate employee IDs: %w", err)
	}

	// Convert validated IDs to dbuuid.UUID slice
	employeeIDs := make([]dbuuid.UUID, len(validEmployeeIDs))
	for i, id := range validEmployeeIDs {
		employeeIDs[i] = dbuuid.UUID(id)
	}

	// Log warning if any IDs were filtered out (data integrity issue)
	filteredCount := len(candidateEmployeeIDs) - len(employeeIDs)
	if filteredCount > 0 {
		slog.WarnContext(ctx, "filtered out invalid employee IDs (data integrity issue)",
			"function", "resolveRecipients",
			"filteredCount", filteredCount,
			"validCount", len(employeeIDs),
			"candidateCount", len(candidateEmployeeIDs),
		)
	}

	slog.DebugContext(ctx, "resolved recipients final count",
		"function", "resolveRecipients",
		"totalEmployeeCount", len(employeeIDs),
		"departmentCount", len(departmentIDs),
		"employeeIDs", employeeIDs,
	)

	if len(employeeIDs) == 0 {
		return nil, nil, fmt.Errorf("no valid recipients found")
	}

	return employeeIDs, departmentIDs, nil
}

// createNotificationWithRecipients creates a notification and associated recipient records.
func (s *NotificationService) createNotificationWithRecipients(
	ctx context.Context,
	tx database.DBTX,
	req *rpcv1.PublishNotificationRequest,
	employeeIDs []dbuuid.UUID,
	departmentIDs []dbuuid.UUID,
) (*database.NotificationNotification, error) {
	// Convert action_data map to JSONB
	var actionDataJSON []byte
	if len(req.ActionData) > 0 {
		var err error
		actionDataJSON, err = json.Marshal(req.ActionData)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal action_data: %w", err)
		}
	}

	// Marshal navigation_target to JSONB
	navTargetJSON, err := navigationTargetToJSON(req.NavigationTarget)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal navigation_target: %w", err)
	}

	// Apply defaults for optional policy fields
	policyKey := req.PolicyKey
	if policyKey == "" {
		policyKey = PolicyKeyPersistentDefault
	}
	deliveryClass := req.DeliveryClass
	if deliveryClass == "" {
		deliveryClass = DeliveryClassPersistent
	}
	sourceCategory := req.SourceCategory
	if sourceCategory == "" {
		sourceCategory = SourceCategoryActivity
	}

	// Create notification
	notification, err := s.Queries.CreateNotification(ctx, tx, &database.CreateNotificationParams{
		OrganizationID:      dbuuid.MustParse(req.OrganizationId),
		SourceDomain:        req.SourceDomain,
		NotificationType:    req.NotificationType,
		PublishingServiceID: stringToNullText(req.PublishingServiceId),
		Title:               req.Title,
		Message:             req.Message,
		ActionData:          actionDataJSON,
		ActionCategory:      stringToNullText(req.ActionCategory),
		Priority:            int16(req.Priority),
		PolicyKey:           policyKey,
		DeliveryClass:       deliveryClass,
		NavigationTarget:    navTargetJSON,
		SourceCategory:      sourceCategory,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create notification: %w", err)
	}

	// Create recipient records in batch
	recipientParams := make([]*database.CreateNotificationRecipientsBatchParams, len(employeeIDs))
	for i, employeeID := range employeeIDs {
		recipientParams[i] = &database.CreateNotificationRecipientsBatchParams{
			NotificationID:      notification.ID,
			EmployeeID:          employeeID,
			OrganizationID:      dbuuid.MustParse(req.OrganizationId),
			RecipientType:       "individual",
			TargetDepartmentIds: departmentIDs, // Store resolved department IDs
		}
	}

	// Use CopyFrom for batch insert
	_, err = s.Queries.CreateNotificationRecipientsBatch(ctx, tx, recipientParams)
	if err != nil {
		return nil, fmt.Errorf("failed to create notification recipients: %w", err)
	}

	return notification, nil
}

// publishToInstances queries active connections and sends NOTIFY to instance channels.
// Returns: (offlineEmployees, error) - list of employees without active connections
func (s *NotificationService) publishToInstances(
	ctx context.Context,
	tx database.DBTX,
	employeeIDs []dbuuid.UUID,
	organizationID dbuuid.UUID,
	notificationID dbuuid.UUID,
	priority int,
) ([]dbuuid.UUID, error) {
	slog.DebugContext(ctx, "publishToInstances called",
		"function", "publishToInstances",
		"employeeIDsCount", len(employeeIDs),
		"employeeIDs", employeeIDs,
		"organizationID", organizationID,
		"notificationID", notificationID,
		"priority", priority,
	)

	// Query active connections grouped by instance
	instanceEmployeeMap, err := s.queryInstancesForEmployees(ctx, tx, employeeIDs, organizationID)
	if err != nil {
		return nil, fmt.Errorf("failed to query instances: %w", err)
	}

	slog.DebugContext(ctx, "instance map retrieved",
		"function", "publishToInstances",
		"instanceCount", len(instanceEmployeeMap),
		"instanceMap", instanceEmployeeMap,
	)

	// Identify offline employees (no active connections)
	onlineEmployees := make(map[dbuuid.UUID]bool)
	for _, empIDs := range instanceEmployeeMap {
		for _, empID := range empIDs {
			onlineEmployees[empID] = true
		}
	}

	offlineEmployees := make([]dbuuid.UUID, 0)
	for _, empID := range employeeIDs {
		if !onlineEmployees[empID] {
			offlineEmployees = append(offlineEmployees, empID)
		}
	}

	if len(offlineEmployees) > 0 {
		slog.InfoContext(ctx, "🔔 detected offline employees - will return for push notification fallback",
			"offlineCount", len(offlineEmployees),
			"offlineEmployees", offlineEmployees,
			"notificationID", notificationID,
		)
	}

	// Send NOTIFY to each instance channel (for online employees only)
	if err := s.notifyInstances(ctx, tx, instanceEmployeeMap, notificationID, organizationID, priority); err != nil {
		return nil, fmt.Errorf("failed to notify instances: %w", err)
	}

	return offlineEmployees, nil
}

// publishToInstancesByChannel publishes notification to employees actively viewing a specific channel.
// Only sends to users who have active_channel_id set to the target channel.
// For ephemeral events, pass the request to include event data in NOTIFY payload.
func (s *NotificationService) publishToInstancesByChannel(
	ctx context.Context,
	tx database.DBTX,
	channelID dbuuid.UUID,
	organizationID dbuuid.UUID,
	notificationID dbuuid.UUID,
	priority int,
	req *rpcv1.PublishNotificationRequest, // Optional: for ephemeral events
) error {
	slog.DebugContext(ctx, "publishToInstancesByChannel called",
		"function", "publishToInstancesByChannel",
		"channelID", channelID.String(),
		"organizationID", organizationID.String(),
		"notificationID", notificationID.String(),
		"priority", priority,
	)

	// Query active connections for employees viewing this channel
	// Note: channelID is dbuuid.UUID (array), need to cast to googl.UUID for NullUUID
	connections, err := s.Queries.GetActiveConnectionsByChannelID(ctx, tx, &database.GetActiveConnectionsByChannelIDParams{
		ActiveChannelID:         dbuuid.NullUUID{UUID: googl.UUID(channelID), Valid: true},
		OrganizationID:          organizationID,
		ResponsiveWindowSeconds: ResponsiveWindowSeconds,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to query active connections by channel",
			"error", err,
			"channelID", channelID.String(),
			"organizationID", organizationID.String())
		return fmt.Errorf("failed to query active connections by channel: %w", err)
	}

	slog.InfoContext(ctx, "query returned connections for channel",
		"function", "publishToInstancesByChannel",
		"connectionCount", len(connections),
		"channelID", channelID.String(),
		"connections", connections,
	)

	// Group by instance_id (same logic as queryInstancesForEmployees)
	instanceMap := make(map[string][]dbuuid.UUID)
	for _, conn := range connections {
		instanceMap[conn.InstanceID] = conn.EmployeeIds
	}

	slog.DebugContext(ctx, "final instance map for channel",
		"function", "publishToInstancesByChannel",
		"instanceCount", len(instanceMap),
		"instanceMap", instanceMap,
		"channelID", channelID.String(),
	)

	// Determine if this is ephemeral (no DB persistence)
	isEphemeral := req != nil && priority == int(PrioritySilent)

	// Send NOTIFY to each instance channel
	if isEphemeral {
		// Send ephemeral event with inline data (no DB query needed by listener)
		if err := s.notifyInstancesWithEphemeralData(ctx, tx, instanceMap, notificationID, organizationID, priority, req); err != nil {
			return fmt.Errorf("failed to notify instances with ephemeral data: %w", err)
		}
	} else {
		// Normal persistent notification (listener will query DB)
		if err := s.notifyInstances(ctx, tx, instanceMap, notificationID, organizationID, priority); err != nil {
			return fmt.Errorf("failed to notify instances: %w", err)
		}
	}

	return nil
}

// queryInstancesForEmployees returns a map of instance_id → employee_ids.
func (s *NotificationService) queryInstancesForEmployees(
	ctx context.Context,
	tx database.DBTX,
	employeeIDs []dbuuid.UUID,
	organizationID dbuuid.UUID,
) (map[string][]dbuuid.UUID, error) {
	slog.DebugContext(ctx, "queryInstancesForEmployees called",
		"function", "queryInstancesForEmployees",
		"inputEmployeeIDs", employeeIDs,
		"organizationID", organizationID,
	)

	// Query active connections
	connections, err := s.Queries.GetActiveConnectionsByEmployeeIDs(ctx, tx, &database.GetActiveConnectionsByEmployeeIDsParams{
		EmployeeIds:             employeeIDs,
		OrganizationID:          organizationID,
		ResponsiveWindowSeconds: ResponsiveWindowSeconds,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to query active connections: %w", err)
	}

	slog.DebugContext(ctx, "query returned connections",
		"function", "queryInstancesForEmployees",
		"connectionCount", len(connections),
	)

	// Group by instance_id
	instanceMap := make(map[string][]dbuuid.UUID)
	for i, conn := range connections {
		slog.DebugContext(ctx, "processing connection row",
			"function", "queryInstancesForEmployees",
			"rowIndex", i,
			"instanceID", conn.InstanceID,
			"employeeIdsValue", conn.EmployeeIds,
		)

		slog.DebugContext(ctx, "parsed employee IDs",
			"function", "queryInstancesForEmployees",
			"instanceID", conn.InstanceID,
			"parsedCount", len(conn.EmployeeIds),
			"uuids", conn.EmployeeIds,
		)

		instanceMap[conn.InstanceID] = conn.EmployeeIds
	}

	slog.DebugContext(ctx, "final instance map",
		"function", "queryInstancesForEmployees",
		"instanceCount", len(instanceMap),
		"instanceMap", instanceMap,
	)

	return instanceMap, nil
}

// CandidateRecipient represents a potential notification recipient with their preference.
type CandidateRecipient struct {
	EmployeeID dbuuid.UUID
	Preference string // "all", "mentions", "muted"
}

// FilterRecipientsByPreference filters candidates based on their subscription preference
// and the notification type. This is a pure function with no DB calls.
//
// Rules:
//   - preference="all" → always included
//   - preference="mentions" → included only if isMention is true
//   - preference="muted" → always excluded
func FilterRecipientsByPreference(candidates []CandidateRecipient, isMention bool) []dbuuid.UUID {
	result := make([]dbuuid.UUID, 0, len(candidates))
	for _, c := range candidates {
		switch c.Preference {
		case NotificationPreferenceAll:
			result = append(result, c.EmployeeID)
		case NotificationPreferenceMentions:
			if isMention {
				result = append(result, c.EmployeeID)
			}
		case NotificationPreferenceMuted:
			// excluded
		default:
			// Unknown preference treated as "all" for safety
			result = append(result, c.EmployeeID)
		}
	}
	return result
}
