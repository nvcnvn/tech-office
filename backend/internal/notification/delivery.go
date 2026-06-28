package notification

import (
	"context"
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

		payload := rescuePushPayloadFromRow(row)
		if err := s.sendPushAndRecord(ctx, tx, row.EmployeeID, orgID, row.RecipientID, payload, FallbackReasonGhostConnectionTimeout); err != nil {
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
