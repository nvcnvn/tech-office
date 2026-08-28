package notification

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/database/txn"
)

const rescueWorkerBatchSize = 100

// trackDelivery updates delivery tracking information for a notification recipient.
func (s *NotificationService) trackDelivery(
	ctx context.Context,
	recipientID dbuuid.UUID,
	deliveryStatus string,
	errorMessage string,
	organizationID dbuuid.UUID,
) error {
	err := s.Queries.UpdateDeliveryStatus(ctx, s.AdminPool, &database.UpdateDeliveryStatusParams{
		DeliveryStatus:    stringToNullText(deliveryStatus),
		LastDeliveryError: stringToNullText(errorMessage),
		OrganizationID:    organizationID,
		ID:                recipientID,
	})
	if err != nil {
		return fmt.Errorf("failed to update delivery status: %w", err)
	}
	return nil
}

// startRetryWorker runs a background job that periodically retries failed deliveries.
// Runs every 5 minutes until context is cancelled.
func (s *NotificationService) startRetryWorker(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	slog.InfoContext(ctx, "starting failed delivery retry worker", "interval", "5m")

	// Run immediately on startup
	if err := s.retryFailedDeliveries(ctx); err != nil {
		if isExpectedShutdownError(ctx, err) {
			slog.InfoContext(ctx, "failed delivery retry worker stopped during shutdown", "reason", err)
			return
		}
		slog.ErrorContext(ctx, "failed delivery retry error", "error", err)
	}

	for {
		select {
		case <-ctx.Done():
			slog.InfoContext(ctx, "stopping failed delivery retry worker")
			return
		case <-ticker.C:
			if err := s.retryFailedDeliveries(ctx); err != nil {
				if isExpectedShutdownError(ctx, err) {
					slog.InfoContext(ctx, "failed delivery retry worker stopped during shutdown", "reason", err)
					return
				}
				slog.ErrorContext(ctx, "failed delivery retry error", "error", err)
			}
		}
	}
}

func (s *NotificationService) startRescuePushWorker(ctx context.Context) {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	slog.InfoContext(ctx, "starting rescue push worker", "interval", "1s")

	for {
		select {
		case <-ctx.Done():
			slog.InfoContext(ctx, "stopping rescue push worker")
			return
		case <-ticker.C:
			if err := s.processDueRescuePushes(ctx); err != nil {
				if isExpectedShutdownError(ctx, err) {
					slog.InfoContext(ctx, "rescue push worker stopped during shutdown", "reason", err)
					return
				}
				slog.ErrorContext(ctx, "rescue push worker error", "error", err)
			}
		}
	}
}

func (s *NotificationService) processDueRescuePushes(ctx context.Context) error {
	now := pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true}
	orgIDs, err := s.Queries.ListOrganizationsWithDueFallbackRecipients(ctx, s.AdminPool, now)
	if err != nil {
		return fmt.Errorf("failed to list organizations with due fallbacks: %w", err)
	}

	for _, orgID := range orgIDs {
		if err := txn.WithTxn(ctx, s.AdminPool, func(ctx context.Context, tx database.DBTX) error {
			return s.processDueRescuePushesForOrg(ctx, tx, orgID, now)
		}); err != nil {
			slog.WarnContext(ctx, "failed to process due rescue pushes for organization",
				"organization_id", orgID.String(),
				"error", err)
		}
	}

	return nil
}

func (s *NotificationService) processDueRescuePushesForOrg(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, now pgtype.Timestamptz) error {
	rows, err := s.Queries.ClaimDueFallbackRecipients(ctx, tx, &database.ClaimDueFallbackRecipientsParams{
		OrganizationID: orgID,
		NowAt:          now,
		BatchLimit:     rescueWorkerBatchSize,
	})
	if err != nil {
		return fmt.Errorf("failed to claim due fallback recipients: %w", err)
	}

	for _, row := range rows {
		// A call wake is not a rescue push and does not go through this path's rules.
		// It is dispatched with no window, it is never cancelled by an SSE receipt —
		// the phone must ring natively even when a tab is open (FR-002) — and it never
		// consults do-not-disturb or muted domains, because a call rings through them
		// (FR-016). Routing it here rather than to the FCM alert below is also what
		// keeps a device from being served both tiers for one call.
		if isCallWakeNotification(row.NotificationType) {
			if err := s.dispatchCallWakeForRow(ctx, tx, orgID, row, now); err != nil {
				return err
			}
			continue
		}

		if row.AcknowledgementStatus == AcknowledgementStatusAcknowledged {
			if err := s.Queries.SetFallbackSkippedForRecipient(ctx, tx, &database.SetFallbackSkippedForRecipientParams{
				FallbackReason:          pgtype.Text{String: FallbackReasonAcknowledgedBeforePush, Valid: true},
				UpdatedAt:               now,
				OrganizationID:          orgID,
				NotificationRecipientID: row.RecipientID,
			}); err != nil {
				return err
			}
			if err := s.recordDeliveryAttempt(ctx, tx, orgID, row.RecipientID, "push", "skipped", FallbackReasonAcknowledgedBeforePush, now, nil); err != nil {
				return err
			}
			continue
		}

		hasReceipt, err := s.Queries.HasSuppressibleLiveReceipt(ctx, tx, &database.HasSuppressibleLiveReceiptParams{
			OrganizationID:          orgID,
			NotificationRecipientID: row.RecipientID,
		})
		if err != nil {
			return err
		}
		if hasReceipt {
			if err := s.Queries.SetFallbackSkippedForRecipient(ctx, tx, &database.SetFallbackSkippedForRecipientParams{
				FallbackReason:          pgtype.Text{String: FallbackReasonSSEReceiptConfirmed, Valid: true},
				UpdatedAt:               now,
				OrganizationID:          orgID,
				NotificationRecipientID: row.RecipientID,
			}); err != nil {
				return err
			}
			if err := s.recordDeliveryAttempt(ctx, tx, orgID, row.RecipientID, "push", "skipped", FallbackReasonSSEReceiptConfirmed, now, nil); err != nil {
				return err
			}
			continue
		}

		// The recipient looked reachable when the notification was routed but never
		// confirmed receipt: their connections stopped answering presence pings.
		payload := rescuePushPayloadFromRow(row)
		if err := s.sendPushAndRecord(ctx, tx, row.EmployeeID, orgID, row.RecipientID, payload, FallbackReasonConnectionUnresponsive); err != nil {
			return err
		}
	}

	return nil
}

func rescuePushPayloadFromRow(row *database.ClaimDueFallbackRecipientsRow) *PushNotificationPayload {
	data := pushDataFromNotificationFields(row.NotificationID, row.RecipientID, row.ActionData, row.NavigationTarget, row.SourceDomain, row.NotificationType, row.PolicyKey)
	return &PushNotificationPayload{
		Title:    row.Title,
		Body:     row.Message,
		Data:     data,
		Priority: "high",
	}
}

// retryFailedDeliveries is a background job that queries pending/failed deliveries
// and attempts to redeliver them or trigger fallback mechanisms.
func (s *NotificationService) retryFailedDeliveries(ctx context.Context) error {
	// Query failed deliveries that need retry
	failedDeliveries, err := s.Queries.GetFailedDeliveries(ctx, s.AdminPool, 100)
	if err != nil {
		return fmt.Errorf("failed to query failed deliveries: %w", err)
	}

	for _, delivery := range failedDeliveries {
		// Check delivery attempts (pgtype.Int2 is struct with Int16 and Valid fields)
		attempts := int16(0)
		if delivery.DeliveryAttempts.Valid {
			attempts = delivery.DeliveryAttempts.Int16
		}

		if attempts < 3 {
			// Retry SSE delivery
			// In practice, this would check if user has active SSE connection
			// and attempt to push notification via event channel

			// For now, just update the delivery attempt counter
			if err := s.trackDelivery(ctx, delivery.ID, "pending", "", delivery.OrganizationID); err != nil {
				slog.WarnContext(ctx, "failed to update delivery status", "error", err)
			}
		} else {
			// Trigger fallback: push notification or email
			slog.InfoContext(ctx, "triggering fallback delivery after max retry attempts",
				"employeeID", delivery.EmployeeID.String(),
				"notificationID", delivery.NotificationID.String(),
				"attempts", attempts)

			// Mark as failed with fallback triggered
			if err := s.trackDelivery(ctx, delivery.ID, "failed_fallback_triggered",
				"Max retry attempts reached, fallback to push/email triggered", delivery.OrganizationID); err != nil {
				slog.WarnContext(ctx, "failed to update delivery status", "error", err)
			}

			// Trigger push notification via FCM
			if s.PushLogic != nil {
				// Fetch notification details to build push payload
				notifRecord, err := s.Queries.GetNotificationByID(ctx, s.AdminPool, &database.GetNotificationByIDParams{
					ID:             delivery.NotificationID,
					OrganizationID: delivery.OrganizationID,
				})
				if err != nil {
					slog.ErrorContext(ctx, "failed to fetch notification for push fallback",
						"error", err,
						"notificationID", delivery.NotificationID.String())
				} else {
					// Build push notification payload
					pushPayload := &PushNotificationPayload{
						Title:    notifRecord.Title,
						Body:     notifRecord.Message,
						Priority: "high",
						Data:     pushDataFromNotificationRecord(notifRecord),
					}

					// Send push notification
					if err := s.PushLogic.SendPushNotification(ctx, delivery.EmployeeID, delivery.OrganizationID, pushPayload); err != nil {
						slog.ErrorContext(ctx, "failed to send push notification fallback",
							"error", err,
							"employeeID", delivery.EmployeeID.String(),
							"notificationID", delivery.NotificationID.String())
					} else {
						slog.InfoContext(ctx, "push notification fallback sent successfully",
							"employeeID", delivery.EmployeeID.String(),
							"notificationID", delivery.NotificationID.String())
					}
				}
			} else {
				slog.WarnContext(ctx, "push logic not configured, skipping push fallback",
					"employeeID", delivery.EmployeeID.String())
			}

			// TODO: Integrate with email service (e.g., SendGrid, AWS SES) as secondary fallback
			slog.InfoContext(ctx, "fallback delivery completed",
				"employeeID", delivery.EmployeeID.String(),
				"notificationID", delivery.NotificationID.String())
		}
	}

	return nil
}

// isCallWakeNotification reports whether a queued recipient row is a call ring rather
// than an ordinary notification. Only the incoming-call notification qualifies: the
// terminal events do not create notifications of their own, they are dispatched
// straight from internal/voice against the incoming call's recipient row.
func isCallWakeNotification(notificationType string) bool {
	return notificationType == NotificationTypeVoiceCallIncoming
}

// dispatchCallWakeForRow turns a queued incoming-call row into per-device wakes.
//
// Everything the payload needs already sits in the notification's action_data, which is
// what lets the wake be built here without a second round of queries — and, on the
// device, lets the phone ring without calling back to the server first.
func (s *NotificationService) dispatchCallWakeForRow(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	row *database.ClaimDueFallbackRecipientsRow,
	now pgtype.Timestamptz,
) error {
	if s.CallWakeDispatcher == nil {
		slog.WarnContext(ctx, "call wake dispatcher is not configured - falling back to the alert ring",
			"employee_id", row.EmployeeID.String())
		return s.sendPushAndRecord(ctx, tx, row.EmployeeID, orgID, row.RecipientID, rescuePushPayloadFromRow(row), FallbackReasonNativeTierUnavailable)
	}

	actionData := decodeActionData(row.ActionData)
	callID, err := dbuuid.Parse(actionData["callId"])
	if err != nil {
		slog.ErrorContext(ctx, "incoming call notification carries no usable callId - cannot wake a device",
			"error", err,
			"notification_id", row.NotificationID.String(),
		)
		return s.markCallWakeSkipped(ctx, tx, orgID, row.RecipientID, now, FallbackReasonDeliveryError)
	}

	req := &CallWakeRequest{
		OrganizationID:    orgID,
		EmployeeID:        row.EmployeeID,
		RecipientID:       row.RecipientID,
		Event:             CallWakeEventIncoming,
		CallID:            callID,
		CallerDisplayName: actionData["senderName"],
		WorkspaceName:     actionData["workspaceName"],
	}
	if channelID, parseErr := dbuuid.Parse(actionData["channelId"]); parseErr == nil {
		req.ChannelID = channelID
	}
	// Carried so a lock-screen decline can decline the invitation rather than end the
	// call — the difference between a "declined" and a "cancelled" call record.
	if invitationID, parseErr := dbuuid.Parse(actionData["invitationId"]); parseErr == nil {
		req.InvitationID = invitationID
	}
	if callerID, parseErr := dbuuid.Parse(actionData["senderEmployeeId"]); parseErr == nil {
		req.CallerEmployeeID = callerID
	}
	if startedAt, parseErr := time.Parse(time.RFC3339, actionData["callStartedAt"]); parseErr == nil {
		req.CallStartedAt = startedAt
	}
	if ringExpiresAt, parseErr := time.Parse(time.RFC3339, actionData["ringExpiresAt"]); parseErr == nil {
		req.RingExpiresAt = ringExpiresAt
	}

	if _, err := s.CallWakeDispatcher.DispatchCallWake(ctx, tx, req); err != nil {
		return err
	}

	// The recipient's own fallback bookkeeping still has to close out, or the row stays
	// queued and the worker picks it up again on the next tick.
	return s.Queries.SetFallbackSentForRecipient(ctx, tx, &database.SetFallbackSentForRecipientParams{
		FallbackReason:          pgtype.Text{Valid: false},
		UpdatedAt:               now,
		OrganizationID:          orgID,
		NotificationRecipientID: row.RecipientID,
	})
}

func (s *NotificationService) markCallWakeSkipped(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	recipientID dbuuid.UUID,
	now pgtype.Timestamptz,
	reason string,
) error {
	if err := s.Queries.SetFallbackSkippedForRecipient(ctx, tx, &database.SetFallbackSkippedForRecipientParams{
		FallbackReason:          pgtype.Text{String: reason, Valid: true},
		UpdatedAt:               now,
		OrganizationID:          orgID,
		NotificationRecipientID: recipientID,
	}); err != nil {
		return err
	}
	return s.recordDeliveryAttempt(ctx, tx, orgID, recipientID, DeliveryChannelCallWake, "skipped", reason, now, nil)
}

// decodeActionData reads a notification's action_data back into a flat string map.
func decodeActionData(raw []byte) map[string]string {
	if len(raw) == 0 {
		return map[string]string{}
	}
	decoded := map[string]string{}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return map[string]string{}
	}
	return decoded
}
