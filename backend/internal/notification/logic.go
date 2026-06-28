package notification

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// NotificationLogic defines the business logic interface for notification operations.
// This layer is pool-agnostic and receives transactions from the Connect layer.
//
// Note: PublishNotification is NOT in this interface because it's infrastructure-heavy
// (PostgreSQL NOTIFY/LISTEN, cross-instance delivery). It remains in NotificationService
// similar to StreamNotifications (SSE infrastructure).
type NotificationLogic interface {
	// Employee-facing operations
	ListNotifications(ctx context.Context, tx database.DBTX, employeeID, organizationID dbuuid.UUID, req *ListNotificationsParams) ([]*database.ListNotificationsByEmployeeRow, int64, string, error)
	MarkAsRead(ctx context.Context, tx database.DBTX, employeeID, organizationID dbuuid.UUID, recipientIDs []dbuuid.UUID) (int32, error)
	MarkAllBeforeTimestampAsRead(ctx context.Context, tx database.DBTX, employeeID, organizationID dbuuid.UUID, beforeTimestamp pgtype.Timestamptz) (int32, error)
	DeleteNotification(ctx context.Context, tx database.DBTX, employeeID, organizationID dbuuid.UUID, recipientID dbuuid.UUID) error
	GetUnreadCount(ctx context.Context, tx database.DBTX, employeeID, organizationID dbuuid.UUID) (int64, map[string]int32, error)

	// Acknowledgement operations (authoritative unread lifecycle)
	AcknowledgeNotifications(ctx context.Context, tx database.DBTX, employeeID, organizationID dbuuid.UUID, recipientIDs []dbuuid.UUID, action string) (int32, error)
	AcknowledgeAllBeforeTimestamp(ctx context.Context, tx database.DBTX, employeeID, organizationID dbuuid.UUID, beforeTimestamp pgtype.Timestamptz, action string) (int32, error)

	// V2 resource subscription preference operations
	GetResourceSubscription(ctx context.Context, tx database.DBTX, organizationID, employeeID dbuuid.UUID, domain string, resourceID dbuuid.UUID) (*rpcv1.GetResourceSubscriptionResponse, error)
	SetResourceSubscriptionPreference(ctx context.Context, tx database.DBTX, organizationID, employeeID dbuuid.UUID, domain string, resourceID dbuuid.UUID, level rpcv1.SubscriptionPreferenceLevel) (*rpcv1.SetResourceSubscriptionPreferenceResponse, error)

	// Helper for proto conversion
	NotificationRowToProto(ctx context.Context, n *database.ListNotificationsByEmployeeRow) *rpcv1.NotificationSummary
}

// ListNotificationsParams holds parameters for listing notifications
type ListNotificationsParams struct {
	PageSize      int32
	UnreadOnly    bool
	SourceDomains []string
}

type notificationLogicImpl struct {
	Queries *database.Queries
	// Note: Publisher and other helpers are NOT part of logic layer
	// They will be called by Connect layer
}

// NewNotificationLogic creates a new notification logic layer implementation
func NewNotificationLogic(queries *database.Queries) NotificationLogic {
	return &notificationLogicImpl{
		Queries: queries,
	}
}

func (s *notificationLogicImpl) ListNotifications(
	ctx context.Context,
	tx database.DBTX,
	employeeID, organizationID dbuuid.UUID,
	params *ListNotificationsParams,
) ([]*database.ListNotificationsByEmployeeRow, int64, string, error) {
	slog.InfoContext(ctx, "listing notifications",
		"function", "ListNotifications",
		"employeeID", employeeID.String(),
		"organizationID", organizationID.String(),
		"unreadOnly", params.UnreadOnly,
	)

	// Use acknowledgement_status filter: unreadOnly=true → filter for "pending" (unacknowledged)
	var ackStatusFilter pgtype.Text
	if params.UnreadOnly {
		ackStatusFilter = pgtype.Text{String: AcknowledgementStatusPending, Valid: true}
	}
	// If params.UnreadOnly is false, ackStatusFilter remains NULL (Valid=false), returning all notifications

	notifications, err := s.Queries.ListNotificationsByEmployee(ctx, tx, &database.ListNotificationsByEmployeeParams{
		EmployeeID:                  employeeID,
		OrganizationID:              organizationID,
		Limit:                       params.PageSize,
		Offset:                      0,
		AcknowledgementStatusFilter: ackStatusFilter,
		SourceDomains:               params.SourceDomains,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to list notifications",
			"function", "ListNotifications",
			"error", err,
			"employeeID", employeeID.String(),
		)
		return nil, 0, "", fmt.Errorf("failed to list notifications: %w", err)
	}

	// Get total unread count
	unreadCount, err := s.Queries.GetUnreadCountByEmployee(ctx, tx, &database.GetUnreadCountByEmployeeParams{
		EmployeeID:     employeeID,
		OrganizationID: organizationID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to get unread count",
			"function", "ListNotifications",
			"error", err,
			"employeeID", employeeID.String(),
		)
		// Don't fail the request, just set count to 0
		unreadCount = 0
	}

	// Generate next_page_token using cursor-based pagination
	var nextPageToken string
	if len(notifications) > 0 && len(notifications) == int(params.PageSize) {
		// Use last notification's updated_at as cursor
		lastNotif := notifications[len(notifications)-1]
		// Encode as base64 timestamp string
		nextPageToken = lastNotif.UpdatedAt.Time.Format("2006-01-02T15:04:05.999999999Z07:00")
	}

	slog.InfoContext(ctx, "notifications listed",
		"function", "ListNotifications",
		"count", len(notifications),
		"employeeID", employeeID.String(),
	)

	return notifications, unreadCount, nextPageToken, nil
}

func (s *notificationLogicImpl) MarkAsRead(
	ctx context.Context,
	tx database.DBTX,
	employeeID, organizationID dbuuid.UUID,
	recipientIDs []dbuuid.UUID,
) (int32, error) {
	slog.InfoContext(ctx, "marking notifications as read",
		"function", "MarkAsRead",
		"employeeID", employeeID.String(),
		"organizationID", organizationID.String(),
		"recipientCount", len(recipientIDs),
	)

	// Mark as read (query validates organization_id ownership)
	err := s.Queries.MarkNotificationsAsReadBatch(ctx, tx, &database.MarkNotificationsAsReadBatchParams{
		Column1:        recipientIDs, // recipient_ids array
		EmployeeID:     employeeID,
		OrganizationID: organizationID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to mark notifications as read",
			"function", "MarkAsRead",
			"error", err,
			"employeeID", employeeID.String(),
		)
		return 0, fmt.Errorf("failed to mark notifications as read: %w", err)
	}

	// Also update acknowledgement_status so the unread filter (which checks acknowledgement_status)
	// treats these as acknowledged. MarkAsRead is a backward-compat alias for AcknowledgeNotifications.
	if _, ackErr := s.AcknowledgeNotifications(ctx, tx, employeeID, organizationID, recipientIDs, AckActionExplicitAck); ackErr != nil {
		slog.WarnContext(ctx, "failed to acknowledge notifications during MarkAsRead (non-fatal)",
			"function", "MarkAsRead",
			"error", ackErr,
			"employeeID", employeeID.String(),
		)
	}

	slog.InfoContext(ctx, "notifications marked as read",
		"function", "MarkAsRead",
		"count", len(recipientIDs),
		"employeeID", employeeID.String(),
	)

	return int32(len(recipientIDs)), nil
}

func (s *notificationLogicImpl) MarkAllBeforeTimestampAsRead(
	ctx context.Context,
	tx database.DBTX,
	employeeID, organizationID dbuuid.UUID,
	beforeTimestamp pgtype.Timestamptz,
) (int32, error) {
	slog.InfoContext(ctx, "marking all notifications before timestamp as read",
		"function", "MarkAllBeforeTimestampAsRead",
		"employeeID", employeeID.String(),
		"organizationID", organizationID.String(),
	)

	// Mark all as read
	count, err := s.Queries.MarkAllBeforeTimestampAsRead(ctx, tx, &database.MarkAllBeforeTimestampAsReadParams{
		EmployeeID:     employeeID,
		OrganizationID: organizationID,
		UpdatedAt:      beforeTimestamp,
		ReadAt:         beforeTimestamp,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to mark all notifications as read",
			"function", "MarkAllBeforeTimestampAsRead",
			"error", err,
			"employeeID", employeeID.String(),
		)
		return 0, fmt.Errorf("failed to mark all notifications as read: %w", err)
	}

	// Also update acknowledgement_status so the unread filter treats these as acknowledged.
	// MarkAllBeforeTimestampAsRead is a backward-compat alias for AcknowledgeAllBeforeTimestamp.
	if _, ackErr := s.AcknowledgeAllBeforeTimestamp(ctx, tx, employeeID, organizationID, beforeTimestamp, AckActionExplicitAck); ackErr != nil {
		slog.WarnContext(ctx, "failed to acknowledge notifications during MarkAllBeforeTimestampAsRead (non-fatal)",
			"function", "MarkAllBeforeTimestampAsRead",
			"error", ackErr,
			"employeeID", employeeID.String(),
		)
	}

	slog.InfoContext(ctx, "all notifications marked as read",
		"function", "MarkAllBeforeTimestampAsRead",
		"employeeID", employeeID.String(),
	)

	return int32(count), nil
}

func (s *notificationLogicImpl) DeleteNotification(
	ctx context.Context,
	tx database.DBTX,
	employeeID, organizationID dbuuid.UUID,
	recipientID dbuuid.UUID,
) error {
	slog.InfoContext(ctx, "deleting notification",
		"function", "DeleteNotification",
		"employeeID", employeeID.String(),
		"organizationID", organizationID.String(),
		"recipientID", recipientID.String(),
	)

	// Delete notification recipient (query validates organization_id ownership)
	err := s.Queries.DeleteNotificationRecipient(ctx, tx, &database.DeleteNotificationRecipientParams{
		ID:             recipientID,
		EmployeeID:     employeeID,
		OrganizationID: organizationID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to delete notification",
			"function", "DeleteNotification",
			"error", err,
			"employeeID", employeeID.String(),
		)
		return fmt.Errorf("failed to delete notification: %w", err)
	}

	slog.InfoContext(ctx, "notification deleted",
		"function", "DeleteNotification",
		"recipientID", recipientID.String(),
		"employeeID", employeeID.String(),
	)

	return nil
}

func (s *notificationLogicImpl) GetUnreadCount(
	ctx context.Context,
	tx database.DBTX,
	employeeID, organizationID dbuuid.UUID,
) (int64, map[string]int32, error) {
	slog.InfoContext(ctx, "getting unread count",
		"function", "GetUnreadCount",
		"employeeID", employeeID.String(),
		"organizationID", organizationID.String(),
	)

	// Get unread count
	unreadCount, err := s.Queries.GetUnreadCountByEmployee(ctx, tx, &database.GetUnreadCountByEmployeeParams{
		EmployeeID:     employeeID,
		OrganizationID: organizationID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to get unread count",
			"function", "GetUnreadCount",
			"error", err,
			"employeeID", employeeID.String(),
		)
		return 0, nil, fmt.Errorf("failed to get unread count: %w", err)
	}

	// Optionally get breakdown by source domain
	breakdownMap := make(map[string]int32)
	domainCounts, err := s.Queries.GetUnreadCountBySourceDomain(ctx, tx, &database.GetUnreadCountBySourceDomainParams{
		EmployeeID:     employeeID,
		OrganizationID: organizationID,
	})
	if err != nil {
		// Don't fail the request, just skip breakdown
		slog.WarnContext(ctx, "failed to get unread count breakdown",
			"function", "GetUnreadCount",
			"error", err,
			"employeeID", employeeID.String(),
		)
	} else {
		for _, dc := range domainCounts {
			breakdownMap[dc.SourceDomain] = int32(dc.UnreadCount)
		}
	}

	slog.InfoContext(ctx, "unread count retrieved",
		"function", "GetUnreadCount",
		"count", unreadCount,
		"employeeID", employeeID.String(),
	)

	return unreadCount, breakdownMap, nil
}

// NotificationRowToProto converts a database notification row to proto message.
func (s *notificationLogicImpl) NotificationRowToProto(ctx context.Context, n *database.ListNotificationsByEmployeeRow) *rpcv1.NotificationSummary {
	// Parse action_data JSON to map
	actionData := make(map[string]string)
	if len(n.ActionData) > 0 {
		var rawData map[string]interface{}
		if err := json.Unmarshal(n.ActionData, &rawData); err != nil {
			// Log error but continue with empty map
			slog.WarnContext(ctx, "failed to unmarshal action_data",
				"function", "NotificationRowToProto",
				"error", err,
				"notificationID", n.NotificationID.String(),
			)
		} else {
			// Convert all values to strings
			for k, v := range rawData {
				if v != nil {
					actionData[k] = fmt.Sprintf("%v", v)
				}
			}
		}
	}

	summary := &rpcv1.NotificationSummary{
		NotificationRecipientId: n.RecipientID.String(),
		NotificationId:          n.NotificationID.String(),
		SourceDomain:            n.SourceDomain,
		NotificationType:        n.NotificationType,
		Title:                   n.Title,
		Message:                 n.Message,
		ActionData:              actionData,
		ReadStatus:              n.ReadStatus.Bool,
		ReadAt:                  timestampProtoOrNil(n.ReadAt),
		DeliveryStatus:          n.DeliveryStatus.String,
		DeliveredAt:             timestampProtoOrNil(n.DeliveredAt),
		CreatedAt:               timestampProto(n.UpdatedAt),
		// Acknowledgement lifecycle fields
		AcknowledgementStatus: n.AcknowledgementStatus,
		AcknowledgedAt:        timestampProtoOrNil(n.AcknowledgedAt),
		AcknowledgementAction: n.AcknowledgementAction.String,
		// Fallback delivery fields
		FallbackStatus: n.FallbackStatus,
		FallbackReason: n.FallbackReason.String,
		// Policy and routing metadata
		PolicyKey:      n.PolicyKey,
		SourceCategory: n.SourceCategory,
		// Typed navigation target
		NavigationTarget: navigationTargetFromJSON(n.NavigationTarget),
	}

	return summary
}

// AcknowledgeNotifications marks one or more recipient rows as acknowledged with a given action.
func (s *notificationLogicImpl) AcknowledgeNotifications(
	ctx context.Context,
	tx database.DBTX,
	employeeID, organizationID dbuuid.UUID,
	recipientIDs []dbuuid.UUID,
	action string,
) (int32, error) {
	slog.InfoContext(ctx, "acknowledging notifications",
		"function", "AcknowledgeNotifications",
		"employeeID", employeeID.String(),
		"organizationID", organizationID.String(),
		"recipientCount", len(recipientIDs),
		"action", action,
	)

	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}
	ackAction := pgtype.Text{String: action, Valid: action != ""}

	err := s.Queries.AcknowledgeNotificationsBatch(ctx, tx, &database.AcknowledgeNotificationsBatchParams{
		Column1:               recipientIDs,
		EmployeeID:            employeeID,
		OrganizationID:        organizationID,
		AcknowledgedAt:        now,
		AcknowledgementAction: ackAction,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to acknowledge notifications",
			"function", "AcknowledgeNotifications",
			"error", err,
			"employeeID", employeeID.String(),
		)
		return 0, fmt.Errorf("failed to acknowledge notifications: %w", err)
	}

	slog.InfoContext(ctx, "notifications acknowledged",
		"function", "AcknowledgeNotifications",
		"count", len(recipientIDs),
		"action", action,
		"employeeID", employeeID.String(),
	)

	return int32(len(recipientIDs)), nil
}

// AcknowledgeAllBeforeTimestamp acknowledges all pending notifications before a given timestamp.
func (s *notificationLogicImpl) AcknowledgeAllBeforeTimestamp(
	ctx context.Context,
	tx database.DBTX,
	employeeID, organizationID dbuuid.UUID,
	beforeTimestamp pgtype.Timestamptz,
	action string,
) (int32, error) {
	slog.InfoContext(ctx, "acknowledging all notifications before timestamp",
		"function", "AcknowledgeAllBeforeTimestamp",
		"employeeID", employeeID.String(),
		"organizationID", organizationID.String(),
		"action", action,
	)

	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}
	ackAction := pgtype.Text{String: action, Valid: action != ""}

	count, err := s.Queries.AcknowledgeAllBeforeTimestamp(ctx, tx, &database.AcknowledgeAllBeforeTimestampParams{
		EmployeeID:            employeeID,
		OrganizationID:        organizationID,
		UpdatedAt:             beforeTimestamp,
		AcknowledgedAt:        now,
		AcknowledgementAction: ackAction,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to acknowledge all notifications before timestamp",
			"function", "AcknowledgeAllBeforeTimestamp",
			"error", err,
			"employeeID", employeeID.String(),
		)
		return 0, fmt.Errorf("failed to acknowledge all notifications before timestamp: %w", err)
	}

	slog.InfoContext(ctx, "all notifications acknowledged before timestamp",
		"function", "AcknowledgeAllBeforeTimestamp",
		"count", count,
		"employeeID", employeeID.String(),
	)

	return int32(count), nil
}

// GetResourceSubscription returns the user's subscription state and preference for a resource.
func (s *notificationLogicImpl) GetResourceSubscription(
	ctx context.Context,
	tx database.DBTX,
	organizationID, employeeID dbuuid.UUID,
	domain string,
	resourceID dbuuid.UUID,
) (*rpcv1.GetResourceSubscriptionResponse, error) {
	sub, err := s.Queries.GetResourceSubscriptionByEmployee(ctx, tx, &database.GetResourceSubscriptionByEmployeeParams{
		OrganizationID: organizationID,
		EmployeeID:     employeeID,
		ResourceDomain: domain,
		ResourceID:     resourceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return &rpcv1.GetResourceSubscriptionResponse{
			Subscribed:        false,
			SubscriptionState: ResourceSubscriptionStateUnfollowed,
			PreferenceLevel:   PreferenceLevelToProto(NotificationPreferenceAll),
		}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get resource subscription: %w", err)
	}

	// Fetch reasons
	reasons, err := s.Queries.ListResourceSubscriptionReasons(ctx, tx, &database.ListResourceSubscriptionReasonsParams{
		OrganizationID: organizationID,
		SubscriptionID: sub.ID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list subscription reasons: %w", err)
	}

	reasonStrs := make([]string, 0, len(reasons))
	for _, r := range reasons {
		reasonStrs = append(reasonStrs, r.ReasonType)
	}

	return &rpcv1.GetResourceSubscriptionResponse{
		Subscribed:        sub.SubscriptionState == ResourceSubscriptionStateActive,
		SubscriptionState: sub.SubscriptionState,
		PreferenceLevel:   PreferenceLevelToProto(sub.PreferenceLevel),
		Reasons:           reasonStrs,
	}, nil
}

// SetResourceSubscriptionPreference updates the preference level for an active subscription.
func (s *notificationLogicImpl) SetResourceSubscriptionPreference(
	ctx context.Context,
	tx database.DBTX,
	organizationID, employeeID dbuuid.UUID,
	domain string,
	resourceID dbuuid.UUID,
	level rpcv1.SubscriptionPreferenceLevel,
) (*rpcv1.SetResourceSubscriptionPreferenceResponse, error) {
	prefStr := PreferenceLevelFromProto(level)

	updated, err := s.Queries.UpdateResourceSubscriptionPreference(ctx, tx, &database.UpdateResourceSubscriptionPreferenceParams{
		OrganizationID:  organizationID,
		EmployeeID:      employeeID,
		ResourceDomain:  domain,
		ResourceID:      resourceID,
		PreferenceLevel: prefStr,
		UpdatedAt:       pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("no active subscription found for resource %s/%s", domain, resourceID.String())
	}
	if err != nil {
		return nil, fmt.Errorf("failed to update subscription preference: %w", err)
	}

	slog.InfoContext(ctx, "subscription preference updated",
		"employeeID", employeeID.String(),
		"domain", domain,
		"resourceID", resourceID.String(),
		"preference", updated.PreferenceLevel,
	)

	return &rpcv1.SetResourceSubscriptionPreferenceResponse{
		Success:         true,
		PreferenceLevel: PreferenceLevelToProto(updated.PreferenceLevel),
	}, nil
}
