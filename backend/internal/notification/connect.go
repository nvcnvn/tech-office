package notification

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/database/txn"
	"github.com/nvcnvn/tech-office/backend/internal/interceptor"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/nvcnvn/tech-office/backend/rpc/v1/rpcv1connect"
)

// NotificationServiceConnect is the RPC handler layer for notification operations.
// It owns connection pools, manages transactions, extracts auth context,
// and delegates to the logic layer and infrastructure helpers (SSE, registry, publisher).
type NotificationServiceConnect struct {
	rpcv1connect.UnimplementedNotificationServiceHandler

	// Logic layer for business operations
	Logic           NotificationLogic
	PresenceLogic   PresenceLogic
	PushLogic       PushLogic
	VisibilityLogic VisibilityLogic

	// AdminPool: Used for backend publishing operations (system-scope)
	// Justification: Backend services create notifications across tenants
	AdminPool database.AdminDatabaseConnector

	// TenantPool: Used for employee-facing operations (tenant-aware)
	TenantPool database.TenantDatabaseConnector

	// Infrastructure components (SSE, registry, publisher, listener)
	// These are kept in Connect layer as they handle infrastructure concerns
	NotificationService *NotificationService // Original service for SSE/registry/publisher

	// PongBatcher coalesces presence pongs arriving at this instance into one
	// multi-row UPDATE per organization per flush tick. The connect layer owns it
	// because it owns the pool; PresenceLogic stays pool-agnostic.
	PongBatcher *pongBatcher
}

// NewNotificationServiceConnect creates a new notification service connect layer
func NewNotificationServiceConnect(
	logic NotificationLogic,
	presenceLogic PresenceLogic,
	pushLogic PushLogic,
	visibilityLogic VisibilityLogic,
	adminPool database.AdminDatabaseConnector,
	tenantPool database.TenantDatabaseConnector,
	notificationService *NotificationService, // Original service for infra
) *NotificationServiceConnect {
	return &NotificationServiceConnect{
		Logic:               logic,
		PresenceLogic:       presenceLogic,
		PushLogic:           pushLogic,
		VisibilityLogic:     visibilityLogic,
		AdminPool:           adminPool,
		TenantPool:          tenantPool,
		NotificationService: notificationService,
		PongBatcher:         newPongBatcher(adminPool, presenceLogic),
	}
}

// StartPongBatcher launches the pong flush loop. Call once at startup.
func (s *NotificationServiceConnect) StartPongBatcher(ctx context.Context) {
	s.PongBatcher.Start(ctx)
}

// StopPongBatcher drains in-flight pongs so no request is left waiting on shutdown.
func (s *NotificationServiceConnect) StopPongBatcher() {
	s.PongBatcher.Stop()
}

func (s *NotificationServiceConnect) ListNotifications(
	ctx context.Context,
	req *connect.Request[rpcv1.ListNotificationsRequest],
) (*connect.Response[rpcv1.ListNotificationsResponse], error) {
	slog.DebugContext(ctx, "ListNotifications RPC called",
		"function", "ListNotifications",
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Convert request
	params := &ListNotificationsParams{
		PageSize:      req.Msg.PageSize,
		UnreadOnly:    req.Msg.UnreadOnly,
		SourceDomains: req.Msg.SourceDomains,
	}

	// Read-only: pass pool directly
	notifications, unreadCount, nextPageToken, err := s.Logic.ListNotifications(ctx, s.TenantPool, employeeID, organizationID, params)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Convert to proto
	protoNotifications := make([]*rpcv1.NotificationSummary, len(notifications))
	for i, n := range notifications {
		protoNotifications[i] = s.Logic.NotificationRowToProto(ctx, n)
	}

	return connect.NewResponse(&rpcv1.ListNotificationsResponse{
		Notifications:    protoNotifications,
		TotalUnreadCount: int32(unreadCount),
		NextPageToken:    nextPageToken,
	}), nil
}

func (s *NotificationServiceConnect) MarkAsRead(
	ctx context.Context,
	req *connect.Request[rpcv1.MarkAsReadRequest],
) (*connect.Response[rpcv1.MarkAsReadResponse], error) {
	slog.DebugContext(ctx, "MarkAsRead RPC called",
		"function", "MarkAsRead",
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Convert string IDs to UUIDs
	recipientIDs := make([]dbuuid.UUID, len(req.Msg.NotificationRecipientIds))
	for i, idStr := range req.Msg.NotificationRecipientIds {
		recipientID, parseErr := dbuuid.Parse(idStr)
		if parseErr != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid notification recipient ID at index %d: %w", i, parseErr))
		}
		recipientIDs[i] = recipientID
	}

	// Read-only: pass pool directly (MarkAsRead updates but doesn't need transaction)
	updatedCount, err := s.Logic.MarkAsRead(ctx, s.TenantPool, employeeID, organizationID, recipientIDs)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&rpcv1.MarkAsReadResponse{
		UpdatedCount: updatedCount,
	}), nil
}

func (s *NotificationServiceConnect) MarkAllBeforeTimestampAsRead(
	ctx context.Context,
	req *connect.Request[rpcv1.MarkAllBeforeTimestampAsReadRequest],
) (*connect.Response[rpcv1.MarkAllBeforeTimestampAsReadResponse], error) {
	slog.DebugContext(ctx, "MarkAllBeforeTimestampAsRead RPC called",
		"function", "MarkAllBeforeTimestampAsRead",
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Convert timestamp; treat nil/zero as "mark everything up to now".
	var beforeTimestamp pgtype.Timestamptz
	if req.Msg.BeforeTimestamp != nil && req.Msg.BeforeTimestamp.IsValid() {
		beforeTimestamp = pgtype.Timestamptz{Time: req.Msg.BeforeTimestamp.AsTime(), Valid: true}
	} else {
		beforeTimestamp = pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true}
	}

	// Pass pool directly
	updatedCount, err := s.Logic.MarkAllBeforeTimestampAsRead(ctx, s.TenantPool, employeeID, organizationID, beforeTimestamp)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&rpcv1.MarkAllBeforeTimestampAsReadResponse{
		UpdatedCount: updatedCount,
	}), nil
}

func (s *NotificationServiceConnect) DeleteNotification(
	ctx context.Context,
	req *connect.Request[rpcv1.DeleteNotificationRequest],
) (*connect.Response[rpcv1.DeleteNotificationResponse], error) {
	slog.DebugContext(ctx, "DeleteNotification RPC called",
		"function", "DeleteNotification",
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	recipientID, parseErr := dbuuid.Parse(req.Msg.NotificationRecipientId)
	if parseErr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid notification recipient ID: %w", parseErr))
	}

	// Pass pool directly
	err = s.Logic.DeleteNotification(ctx, s.TenantPool, employeeID, organizationID, recipientID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&rpcv1.DeleteNotificationResponse{}), nil
}

func (s *NotificationServiceConnect) GetUnreadCount(
	ctx context.Context,
	req *connect.Request[rpcv1.GetUnreadCountRequest],
) (*connect.Response[rpcv1.GetUnreadCountResponse], error) {
	slog.DebugContext(ctx, "GetUnreadCount RPC called",
		"function", "GetUnreadCount",
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Pass pool directly
	unreadCount, breakdownMap, err := s.Logic.GetUnreadCount(ctx, s.TenantPool, employeeID, organizationID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&rpcv1.GetUnreadCountResponse{
		UnreadCount:          int32(unreadCount),
		UnreadBySourceDomain: breakdownMap,
	}), nil
}

// StreamNotifications delegates to the original NotificationService infrastructure
// SSE streaming is infrastructure concern, not business logic
func (s *NotificationServiceConnect) StreamNotifications(
	ctx context.Context,
	req *connect.Request[rpcv1.StreamNotificationsRequest],
	stream *connect.ServerStream[rpcv1.NotificationEvent],
) error {
	slog.DebugContext(ctx, "StreamNotifications RPC called",
		"function", "StreamNotifications",
	)

	// Delegate to original service for SSE handling
	return s.NotificationService.StreamNotifications(ctx, req, stream)
}

// PublishNotification delegates to the original NotificationService publisher
// Publishing involves complex NOTIFY logic, kept as infrastructure
func (s *NotificationServiceConnect) PublishNotification(
	ctx context.Context,
	req *connect.Request[rpcv1.PublishNotificationRequest],
) (*connect.Response[rpcv1.PublishNotificationResponse], error) {
	slog.DebugContext(ctx, "PublishNotification RPC called",
		"function", "PublishNotification",
	)

	// Delegate to original service for publishing (uses AdminPool with transaction)
	var notificationResponse *rpcv1.PublishNotificationResponse
	err := txn.WithTxn(ctx, s.AdminPool, func(ctx context.Context, tx database.DBTX) error {
		var err error
		notificationResponse, err = s.NotificationService.PublishNotification(ctx, tx, req.Msg)
		if err != nil {
			return fmt.Errorf("failed to publish notification: %w", err)
		}
		return nil
	})

	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Note: Original PublishNotification does not return response details
	return connect.NewResponse(notificationResponse), nil
}

// AcknowledgeNotifications marks notifications as acknowledged by the authenticated employee.
// This is the authoritative "mark as read" path — use MarkAsRead only as a compatibility alias.
func (s *NotificationServiceConnect) AcknowledgeNotifications(
	ctx context.Context,
	req *connect.Request[rpcv1.AcknowledgeNotificationsRequest],
) (*connect.Response[rpcv1.AcknowledgeNotificationsResponse], error) {
	slog.DebugContext(ctx, "AcknowledgeNotifications RPC called")

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	recipientIDs := make([]dbuuid.UUID, len(req.Msg.NotificationRecipientIds))
	for i, idStr := range req.Msg.NotificationRecipientIds {
		recipientID, parseErr := dbuuid.Parse(idStr)
		if parseErr != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid notification recipient ID at index %d: %w", i, parseErr))
		}
		recipientIDs[i] = recipientID
	}

	action := req.Msg.AcknowledgementAction
	if action == "" {
		action = AckActionExplicitAck
	}

	updatedCount, err := s.Logic.AcknowledgeNotifications(ctx, s.TenantPool, employeeID, organizationID, recipientIDs, action)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&rpcv1.AcknowledgeNotificationsResponse{
		AcknowledgedCount: updatedCount,
	}), nil
}

// AcknowledgeAllBeforeTimestamp acknowledges all pending notifications before a given timestamp.
func (s *NotificationServiceConnect) AcknowledgeAllBeforeTimestamp(
	ctx context.Context,
	req *connect.Request[rpcv1.AcknowledgeAllBeforeTimestampRequest],
) (*connect.Response[rpcv1.AcknowledgeAllBeforeTimestampResponse], error) {
	slog.DebugContext(ctx, "AcknowledgeAllBeforeTimestamp RPC called")

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	beforeTimestamp := pgtype.Timestamptz{Time: req.Msg.BeforeTimestamp.AsTime(), Valid: true}

	action := req.Msg.AcknowledgementAction
	if action == "" {
		action = AckActionExplicitAck
	}

	updatedCount, err := s.Logic.AcknowledgeAllBeforeTimestamp(ctx, s.TenantPool, employeeID, organizationID, beforeTimestamp, action)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&rpcv1.AcknowledgeAllBeforeTimestampResponse{
		AcknowledgedCount: updatedCount,
	}), nil
}

// extractAuthContext extracts employee ID and organization ID from auth context.
func (s *NotificationServiceConnect) extractAuthContext(ctx context.Context) (employeeID dbuuid.UUID, organizationID dbuuid.UUID, err error) {
	userID, ok := interceptor.UserIDFromContext(ctx)
	if !ok || userID == "" {
		return dbuuid.UUID{}, dbuuid.UUID{}, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("user ID not found in context"))
	}

	orgIDStr, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok || orgIDStr == "" {
		return dbuuid.UUID{}, dbuuid.UUID{}, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("organization ID not found in context"))
	}

	employeeID = dbuuid.MustParse(userID)
	organizationID = dbuuid.MustParse(orgIDStr)
	return employeeID, organizationID, nil
}

// GetResourceSubscription returns the authenticated user's subscription state and preference for a resource.
func (s *NotificationServiceConnect) GetResourceSubscription(
	ctx context.Context,
	req *connect.Request[rpcv1.GetResourceSubscriptionRequest],
) (*connect.Response[rpcv1.GetResourceSubscriptionResponse], error) {
	slog.DebugContext(ctx, "GetResourceSubscription RPC called",
		"resource_domain", req.Msg.GetResourceDomain(),
		"resource_id", req.Msg.GetResourceId())

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	domain := req.Msg.GetResourceDomain()
	if !IsValidResourceDomain(domain) {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid resource_domain: %q", domain))
	}
	resourceID := dbuuid.MustParse(req.Msg.GetResourceId())

	sub, err := s.Logic.GetResourceSubscription(ctx, s.TenantPool, organizationID, employeeID, domain, resourceID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(sub), nil
}

// SetResourceSubscriptionPreference updates the preference level for an active subscription.
func (s *NotificationServiceConnect) SetResourceSubscriptionPreference(
	ctx context.Context,
	req *connect.Request[rpcv1.SetResourceSubscriptionPreferenceRequest],
) (*connect.Response[rpcv1.SetResourceSubscriptionPreferenceResponse], error) {
	slog.DebugContext(ctx, "SetResourceSubscriptionPreference RPC called",
		"resource_domain", req.Msg.GetResourceDomain(),
		"resource_id", req.Msg.GetResourceId(),
		"preference_level", req.Msg.GetPreferenceLevel())

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	domain := req.Msg.GetResourceDomain()
	if !IsValidResourceDomain(domain) {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid resource_domain: %q", domain))
	}
	resourceID := dbuuid.MustParse(req.Msg.GetResourceId())

	prefLevel := req.Msg.GetPreferenceLevel()
	if prefLevel == rpcv1.SubscriptionPreferenceLevel_SUBSCRIPTION_PREFERENCE_LEVEL_UNSPECIFIED {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("preference_level is required"))
	}

	resp, err := s.Logic.SetResourceSubscriptionPreference(ctx, s.TenantPool, organizationID, employeeID, domain, resourceID, prefLevel)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(resp), nil
}
