package notification

import (
	"context"
	"fmt"
	"time"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/database/txn"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

func (s *NotificationServiceConnect) ConfirmNotificationReceipt(
	ctx context.Context,
	req *connect.Request[rpcv1.ConfirmNotificationReceiptRequest],
) (*connect.Response[rpcv1.ConfirmNotificationReceiptResponse], error) {
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	connectionID, err := dbuuid.Parse(req.Msg.ConnectionId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("valid connection_id is required: %w", err))
	}
	platform := req.Msg.Platform
	if !IsValidLiveReceiptPlatform(platform) {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("platform must be web or mobile"))
	}
	appState := req.Msg.AppState
	if !IsValidLiveReceiptAppState(appState) {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("app_state must be foreground or background"))
	}
	visibilityState := req.Msg.VisibilityState
	if visibilityState != "" && !IsValidLiveReceiptVisibilityState(visibilityState) {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("visibility_state must be visible or hidden"))
	}
	if platform == LiveReceiptPlatformWeb && visibilityState == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("visibility_state is required for web receipts"))
	}

	recipientIDs := make([]dbuuid.UUID, 0, len(req.Msg.NotificationRecipientIds))
	seen := make(map[dbuuid.UUID]struct{}, len(req.Msg.NotificationRecipientIds))
	for i, idStr := range req.Msg.NotificationRecipientIds {
		recipientID, parseErr := dbuuid.Parse(idStr)
		if parseErr != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid notification recipient ID at index %d: %w", i, parseErr))
		}
		if _, ok := seen[recipientID]; ok {
			continue
		}
		seen[recipientID] = struct{}{}
		recipientIDs = append(recipientIDs, recipientID)
	}
	if len(recipientIDs) == 0 {
		return connect.NewResponse(&rpcv1.ConfirmNotificationReceiptResponse{}), nil
	}

	receivedAt := time.Now().UTC()
	if req.Msg.ReceivedAt != nil && req.Msg.ReceivedAt.IsValid() {
		receivedAt = req.Msg.ReceivedAt.AsTime().UTC()
	}

	confirmedCount := int32(0)
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		if _, err := s.NotificationService.Queries.GetActiveConnectionByID(ctx, tx, &database.GetActiveConnectionByIDParams{
			OrganizationID: organizationID,
			EmployeeID:     employeeID,
			ConnectionID:   connectionID,
		}); err != nil {
			return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("connection_id does not belong to employee or is stale"))
		}

		rows, err := s.NotificationService.Queries.ListNotificationRecipientsForReceipt(ctx, tx, &database.ListNotificationRecipientsForReceiptParams{
			OrganizationID:           organizationID,
			EmployeeID:               employeeID,
			NotificationRecipientIds: recipientIDs,
		})
		if err != nil {
			return err
		}

		validIDs := make([]dbuuid.UUID, 0, len(rows))
		for _, row := range rows {
			if row.DeliveryClass != DeliveryClassPersistent {
				continue
			}
			validIDs = append(validIDs, row.ID)
			visibility := pgtype.Text{Valid: false}
			if visibilityState != "" {
				visibility = pgtype.Text{String: visibilityState, Valid: true}
			}
			if err := s.NotificationService.Queries.UpsertLiveReceipt(ctx, tx, &database.UpsertLiveReceiptParams{
				OrganizationID:          organizationID,
				NotificationRecipientID: row.ID,
				EmployeeID:              employeeID,
				ConnectionID:            connectionID,
				Platform:                platform,
				AppState:                appState,
				VisibilityState:         visibility,
				ReceivedAt:              pgtype.Timestamptz{Time: receivedAt, Valid: true},
				Metadata:                []byte("{}"),
			}); err != nil {
				return err
			}

			if err := s.NotificationService.recordDeliveryAttempt(ctx, tx, organizationID, row.ID, "sse", "sent", "", pgtype.Timestamptz{Time: receivedAt, Valid: true}, map[string]string{
				"connectionId":      connectionID.String(),
				"platform":          platform,
				"appState":          appState,
				"visibilityState":   visibilityState,
				"clientReceiptKind": "transport",
			}); err != nil {
				return err
			}
		}

		confirmedCount = int32(len(validIDs))
		if confirmedCount == 0 || !receiptSuppressesRescue(platform, appState, visibilityState) {
			return nil
		}

		skippedIDs, err := s.NotificationService.Queries.MarkQueuedFallbackSkippedByReceipt(ctx, tx, &database.MarkQueuedFallbackSkippedByReceiptParams{
			UpdatedAt:                pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
			OrganizationID:           organizationID,
			EmployeeID:               employeeID,
			NotificationRecipientIds: validIDs,
		})
		if err != nil {
			return err
		}
		for _, skippedID := range skippedIDs {
			if err := s.NotificationService.recordDeliveryAttempt(ctx, tx, organizationID, skippedID, "push", "skipped", FallbackReasonSSEReceiptConfirmed, pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true}, nil); err != nil {
				return err
			}
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&rpcv1.ConfirmNotificationReceiptResponse{
		ConfirmedCount: confirmedCount,
	}), nil
}

func receiptSuppressesRescue(platform, appState, visibilityState string) bool {
	if platform == LiveReceiptPlatformMobile {
		return appState == LiveReceiptAppForeground
	}
	return platform == LiveReceiptPlatformWeb && appState == LiveReceiptAppForeground && visibilityState == LiveReceiptVisibilityVisible
}
