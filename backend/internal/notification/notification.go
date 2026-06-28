package notification

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/interceptor"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// SSEConnection represents an active SSE streaming connection
type SSEConnection struct {
	EmployeeID      dbuuid.UUID
	ConnectionID    dbuuid.UUID
	OrganizationID  dbuuid.UUID
	EventChan       chan *rpcv1.NotificationEvent
	ActiveChannelID *dbuuid.UUID // Tracks which chat channel the connection is actively viewing (NULL if not in channel view)
}

// NotificationService implements the NotificationService RPC interface
// and provides notification publishing, listing, and real-time streaming.
//
// Pool Selection Rationale:
//   - AdminPool: Used for PublishNotification (backend-only publishing API).
//     Backend services need system-scope access to create notifications across
//     organizations without tenant-specific context.
//   - TenantPool: Used for all employee-facing operations (ListNotifications,
//     MarkAsRead, StreamNotifications, GetUnreadCount). These operations are
//     tenant-aware and scoped to the authenticated employee's organization.
type NotificationService struct {
	// AdminPool: Used for backend publishing operations (system-scope)
	// Justification: Backend services create notifications across tenants
	AdminPool database.AdminDatabaseConnector

	// TenantPool: Used for employee-facing operations (tenant-aware)
	TenantPool database.TenantDatabaseConnector

	// Queries: sqlc-generated query methods
	Queries *database.Queries

	// InstanceID: Backend instance identifier for LISTEN/NOTIFY channels
	// Example: "backend-pod-abc123" or hostname
	InstanceID string

	// ListenConn: Dedicated PostgreSQL connection for LISTEN operations
	// This connection subscribes to: instance_{InstanceID}_notifications
	ListenConn *pgx.Conn

	// PushLogic: Push notification logic for FCM delivery
	// Used for fallback delivery when SSE fails
	PushLogic PushLogic

	// RoutingLogic: Routing and fallback decision logic
	// Used to check DND / domain-mute suppression before sending push
	RoutingLogic RoutingLogic

	// activeConnections: In-memory map of active SSE connections
	// Key: connectionID, Value: SSEConnection with event channel
	activeConnections map[dbuuid.UUID]*SSEConnection
	connMutex         sync.RWMutex

	// listenerCtx: Context for long-running listener goroutine
	// Canceled by cancel() in Stop() method
	listenerCtx    context.Context
	listenerCancel context.CancelFunc

	// reconnectCount tracks how many times the LISTEN connection has been re-established
	reconnectCount atomic.Int32

	// In-memory health state for self-monitoring (avoids DB queries from heartbeat)
	consumerStatus     atomic.Value // string: "starting", "running", "reconnecting", "stopped"
	lastConsumerActive atomic.Value // time.Time: last NOTIFY processed
	lastError          atomic.Value // string: last error message
}

// NewNotificationService creates a new NotificationService instance.
//
// Parameters:
// - adminPool: Database connection pool for system-scope operations (publishing)
// - tenantPool: Database connection pool for tenant-aware operations (employee-facing)
// - queries: sqlc-generated database queries
// - instanceID: Backend instance identifier (used for instance-level LISTEN/NOTIFY channels)
//
// Returns:
// - *NotificationService: Initialized service
// - error: Any initialization error
func NewNotificationService(
	adminPool database.AdminDatabaseConnector,
	tenantPool database.TenantDatabaseConnector,
	queries *database.Queries,
	instanceID string,
	pushLogic PushLogic,
) (*NotificationService, error) {
	if adminPool == nil {
		return nil, fmt.Errorf("adminPool is required")
	}
	if tenantPool == nil {
		return nil, fmt.Errorf("tenantPool is required")
	}
	if queries == nil {
		return nil, fmt.Errorf("queries is required")
	}
	if instanceID == "" {
		return nil, fmt.Errorf("instanceID is required")
	}
	// pushLogic can be nil (optional - only needed for push fallback)

	return &NotificationService{
		AdminPool:         adminPool,
		TenantPool:        tenantPool,
		Queries:           queries,
		InstanceID:        instanceID,
		PushLogic:         pushLogic,
		activeConnections: make(map[dbuuid.UUID]*SSEConnection),
	}, nil
}

// Start initializes the notification service by:
// 1. Cleaning up stale connections for this instance
// 2. Setting up PostgreSQL LISTEN/NOTIFY connection
// 3. Starting connection registry cleanup worker
// 4. Starting presence/push token cleanup workers
func (s *NotificationService) Start(ctx context.Context) error {
	// Create cancellable context for long-running operations
	s.listenerCtx, s.listenerCancel = context.WithCancel(context.Background())

	if err := s.cleanupInstanceListener(ctx); err != nil {
		slog.WarnContext(ctx, "failed to cleanup instance listener", "error", err)
	}

	// Clean up any stale connections for this instance from previous runs
	// (happens when backend restarts without graceful shutdown)
	slog.InfoContext(ctx, "cleaning up stale connections for instance", "instanceID", s.InstanceID)
	if err := s.cleanupInstanceConnections(ctx); err != nil {
		slog.WarnContext(ctx, "failed to cleanup instance connections", "error", err)
		// Don't fail startup - this is a best-effort cleanup
	}

	// Initialize LISTEN/NOTIFY connection
	if err := s.initListener(ctx); err != nil {
		return fmt.Errorf("failed to initialize listener: %w", err)
	}

	// Start connection cleanup worker (removes stale connections every minute)
	go s.startCleanupWorker(s.listenerCtx)

	// Start presence/push token cleanup workers (stale connections: 30s, push tokens: 24h)
	// Note: This will be called again from server.go after service dependencies are wired
	s.StartCleanupWorker(s.listenerCtx)

	// Start failed delivery retry worker (retries failed push notifications every 5 minutes)
	go s.startRetryWorker(s.listenerCtx)

	// Start rescue push worker (short-delay fallback for ghost SSE connections)
	go s.startRescuePushWorker(s.listenerCtx)

	return nil
}

// Stop gracefully shuts down the notification service by:
// 1. Closing LISTEN/NOTIFY connection
// 2. Stopping background workers (via context cancellation)
func (s *NotificationService) Stop() {
	if err := s.removeActiveListener(context.Background()); err != nil {
		slog.Warn("failed to remove active listener during shutdown", "instanceID", s.InstanceID, "error", err)
	}

	// Cancel listener context to stop all goroutines
	if s.listenerCancel != nil {
		s.listenerCancel()
	}

	// Close database connection
	if s.ListenConn != nil {
		_ = s.ListenConn.Close(context.Background())
	}
}

// ActiveConnectionCount returns the number of active SSE connections.
func (s *NotificationService) ActiveConnectionCount() int {
	s.connMutex.RLock()
	defer s.connMutex.RUnlock()
	return len(s.activeConnections)
}

// HasActiveConnection checks if a connection exists in the in-memory map
// and belongs to the given employee. Used as a fallback when the DB row is
// missing (e.g. after UNLOGGED table data loss from PostgreSQL recovery).
func (s *NotificationService) HasActiveConnection(connectionID, employeeID dbuuid.UUID) bool {
	s.connMutex.RLock()
	defer s.connMutex.RUnlock()
	conn, ok := s.activeConnections[connectionID]
	return ok && conn.EmployeeID == employeeID
}

// GetConnectionsByChannel returns all active SSE connections that are currently viewing the specified channel.
// This method is used for routing ephemeral signals (priority=4 like typing indicators and reactions)
// to only the connections actively viewing the channel, without writing to the database.
//
// Parameters:
//   - orgID: Organization UUID to filter connections
//   - channelID: Channel UUID to filter connections by active_channel_id
//
// Returns:
//   - []*SSEConnection: Slice of connections matching the criteria
func (s *NotificationService) GetConnectionsByChannel(orgID dbuuid.UUID, channelID dbuuid.UUID) []*SSEConnection {
	s.connMutex.RLock()
	defer s.connMutex.RUnlock()

	var matchingConnections []*SSEConnection
	for _, conn := range s.activeConnections {
		// Filter by organization_id and active_channel_id
		if conn.OrganizationID == orgID && conn.ActiveChannelID != nil && *conn.ActiveChannelID == channelID {
			matchingConnections = append(matchingConnections, conn)
		}
	}

	slog.Debug("GetConnectionsByChannel",
		"orgID", orgID.String(),
		"channelID", channelID.String(),
		"matchingConnections", len(matchingConnections))

	return matchingConnections
}

// ListNotifications returns paginated list of notifications for the authenticated employee.
// Uses TenantPool for tenant-aware operations.
func (s *NotificationService) ListNotifications(
	ctx context.Context,
	req *connect.Request[rpcv1.ListNotificationsRequest],
) (*connect.Response[rpcv1.ListNotificationsResponse], error) {
	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	slog.InfoContext(ctx, "listing notifications",
		"employeeID", employeeID.String(),
		"organizationID", organizationID.String(),
		"unreadOnly", req.Msg.UnreadOnly)

	// Prepare acknowledgement status filter for unread-only filtering
	var ackStatusFilter pgtype.Text
	if req.Msg.UnreadOnly {
		ackStatusFilter = pgtype.Text{String: AcknowledgementStatusPending, Valid: true}
	}
	// If UnreadOnly is false, ackStatusFilter remains NULL (Valid=false), returning all notifications

	// Query notifications
	notifications, err := s.Queries.ListNotificationsByEmployee(ctx, s.TenantPool, &database.ListNotificationsByEmployeeParams{
		EmployeeID:                  employeeID,
		OrganizationID:              organizationID,
		Limit:                       req.Msg.PageSize,
		Offset:                      0,
		AcknowledgementStatusFilter: ackStatusFilter,
		SourceDomains:               req.Msg.SourceDomains,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to list notifications", "error", err, "employeeID", employeeID.String())
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to list notifications: %w", err))
	}

	// Get total unread count
	unreadCount, err := s.Queries.GetUnreadCountByEmployee(ctx, s.TenantPool, &database.GetUnreadCountByEmployeeParams{
		EmployeeID:     employeeID,
		OrganizationID: organizationID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to get unread count", "error", err, "employeeID", employeeID.String())
		// Don't fail the request, just set count to 0
		unreadCount = 0
	}

	// Convert to proto
	protoNotifications := make([]*rpcv1.NotificationSummary, len(notifications))
	for i, n := range notifications {
		protoNotifications[i] = s.notificationRowToProto(ctx, n)
	}

	slog.InfoContext(ctx, "notifications listed", "count", len(notifications), "employeeID", employeeID.String())

	// Generate next_page_token using cursor-based pagination
	var nextPageToken string
	if len(notifications) > 0 && len(notifications) == int(req.Msg.PageSize) {
		// Use last notification's updated_at as cursor
		lastNotif := notifications[len(notifications)-1]
		// Encode as base64 timestamp string
		nextPageToken = lastNotif.UpdatedAt.Time.Format("2006-01-02T15:04:05.999999999Z07:00")
	}

	return connect.NewResponse(&rpcv1.ListNotificationsResponse{
		Notifications:    protoNotifications,
		TotalUnreadCount: int32(unreadCount),
		NextPageToken:    nextPageToken,
	}), nil
}

// MarkAsRead marks one or more notifications as read for the authenticated employee.
// Uses TenantPool with organization context validation.
func (s *NotificationService) MarkAsRead(
	ctx context.Context,
	req *connect.Request[rpcv1.MarkAsReadRequest],
) (*connect.Response[rpcv1.MarkAsReadResponse], error) {
	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	slog.InfoContext(ctx, "marking notifications as read",
		"employeeID", employeeID.String(),
		"organizationID", organizationID.String(),
		"recipientCount", len(req.Msg.NotificationRecipientIds))

	// Convert string IDs to UUIDs
	recipientIDs := make([]dbuuid.UUID, len(req.Msg.NotificationRecipientIds))
	for i, idStr := range req.Msg.NotificationRecipientIds {
		recipientIDs[i] = dbuuid.MustParse(idStr)
	}

	// Mark as read (query validates organization_id ownership)
	now := time.Now()
	params := &database.MarkNotificationsAsReadBatchParams{
		Column1:        recipientIDs, // recipient_ids array
		EmployeeID:     employeeID,
		OrganizationID: organizationID,
		ReadAt:         pgtype.Timestamptz{Time: now, Valid: true},
	}
	slog.DebugContext(ctx, "marking notifications as read with params",
		"params", params,
		"now", now,
		"readAtValid", params.ReadAt.Valid,
		"readAtTime", params.ReadAt.Time)
	err = s.Queries.MarkNotificationsAsReadBatch(ctx, s.TenantPool, params)
	if err != nil {
		slog.ErrorContext(ctx, "failed to mark notifications as read", "error", err, "employeeID", employeeID.String())
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to mark notifications as read: %w", err))
	}

	slog.InfoContext(ctx, "notifications marked as read", "count", len(recipientIDs), "employeeID", employeeID.String())

	return connect.NewResponse(&rpcv1.MarkAsReadResponse{
		UpdatedCount: int32(len(recipientIDs)),
	}), nil
}

// MarkAllBeforeTimestampAsRead bulk marks all notifications before a timestamp as read.
// Uses TenantPool with organization context validation.
func (s *NotificationService) MarkAllBeforeTimestampAsRead(
	ctx context.Context,
	req *connect.Request[rpcv1.MarkAllBeforeTimestampAsReadRequest],
) (*connect.Response[rpcv1.MarkAllBeforeTimestampAsReadResponse], error) {
	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	slog.InfoContext(ctx, "marking all notifications before timestamp as read",
		"employeeID", employeeID.String(),
		"organizationID", organizationID.String(),
		"before_timestamp", req.Msg.BeforeTimestamp)

	// Mark all as read
	now := time.Now()
	updatedCount, err := s.Queries.MarkAllBeforeTimestampAsRead(ctx, s.TenantPool, &database.MarkAllBeforeTimestampAsReadParams{
		EmployeeID:     employeeID,
		OrganizationID: organizationID,
		UpdatedAt:      pgtype.Timestamptz{Time: req.Msg.BeforeTimestamp.AsTime(), Valid: true},
		ReadAt:         pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to mark all notifications as read", "error", err, "employeeID", employeeID.String())
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to mark all notifications as read: %w", err))
	}

	slog.InfoContext(ctx, "all notifications marked as read", "employeeID", employeeID.String())

	return connect.NewResponse(&rpcv1.MarkAllBeforeTimestampAsReadResponse{
		UpdatedCount: int32(updatedCount),
	}), nil
}

// DeleteNotification removes a notification from the employee's view (soft delete).
// Uses TenantPool with organization context validation.
func (s *NotificationService) DeleteNotification(
	ctx context.Context,
	req *connect.Request[rpcv1.DeleteNotificationRequest],
) (*connect.Response[rpcv1.DeleteNotificationResponse], error) {
	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	slog.InfoContext(ctx, "deleting notification",
		"employeeID", employeeID.String(),
		"organizationID", organizationID.String(),
		"recipientID", req.Msg.NotificationRecipientId)

	// Delete notification recipient (query validates organization_id ownership)
	err = s.Queries.DeleteNotificationRecipient(ctx, s.TenantPool, &database.DeleteNotificationRecipientParams{
		ID:             dbuuid.MustParse(req.Msg.NotificationRecipientId),
		EmployeeID:     employeeID,
		OrganizationID: organizationID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to delete notification", "error", err, "employeeID", employeeID.String())
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to delete notification: %w", err))
	}

	slog.InfoContext(ctx, "notification deleted", "recipientID", req.Msg.NotificationRecipientId, "employeeID", employeeID.String())

	return connect.NewResponse(&rpcv1.DeleteNotificationResponse{}), nil
}

// GetUnreadCount returns the count of unread notifications for the authenticated employee.
// Uses TenantPool with organization context from auth token.
func (s *NotificationService) GetUnreadCount(
	ctx context.Context,
	req *connect.Request[rpcv1.GetUnreadCountRequest],
) (*connect.Response[rpcv1.GetUnreadCountResponse], error) {
	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	slog.InfoContext(ctx, "getting unread count", "employeeID", employeeID.String(), "organizationID", organizationID.String())

	// Get unread count
	unreadCount, err := s.Queries.GetUnreadCountByEmployee(ctx, s.TenantPool, &database.GetUnreadCountByEmployeeParams{
		EmployeeID:     employeeID,
		OrganizationID: organizationID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to get unread count", "error", err, "employeeID", employeeID.String())
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to get unread count: %w", err))
	}

	// Optionally get breakdown by source domain
	breakdownMap := make(map[string]int32)
	domainCounts, err := s.Queries.GetUnreadCountBySourceDomain(ctx, s.TenantPool, &database.GetUnreadCountBySourceDomainParams{
		EmployeeID:     employeeID,
		OrganizationID: organizationID,
	})
	if err != nil {
		// Don't fail the request, just skip breakdown
		slog.WarnContext(ctx, "failed to get unread count breakdown", "error", err, "employeeID", employeeID.String())
	} else {
		for _, dc := range domainCounts {
			breakdownMap[dc.SourceDomain] = int32(dc.UnreadCount)
		}
	}

	slog.InfoContext(ctx, "unread count retrieved", "count", unreadCount, "employeeID", employeeID.String())

	return connect.NewResponse(&rpcv1.GetUnreadCountResponse{
		UnreadCount:          int32(unreadCount),
		UnreadBySourceDomain: breakdownMap,
	}), nil
}

// extractAuthContext extracts employee ID and organization ID from auth context.
func (s *NotificationService) extractAuthContext(ctx context.Context) (employeeID dbuuid.UUID, organizationID dbuuid.UUID, err error) {
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

// notificationRowToProto converts a database notification row to proto message.
func (s *NotificationService) notificationRowToProto(ctx context.Context, n *database.ListNotificationsByEmployeeRow) *rpcv1.NotificationSummary {
	// Parse action_data JSON to map
	actionData := make(map[string]string)
	if len(n.ActionData) > 0 {
		var rawData map[string]interface{}
		if err := json.Unmarshal(n.ActionData, &rawData); err != nil {
			// Log error but continue with empty map
			slog.WarnContext(ctx, "failed to unmarshal action_data", "error", err, "notificationID", n.NotificationID.String())
		} else {
			// Convert all values to strings
			for k, v := range rawData {
				if v != nil {
					actionData[k] = fmt.Sprintf("%v", v)
				}
			}
		}
	}

	return &rpcv1.NotificationSummary{
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
		PolicyKey:        n.PolicyKey,
		SourceCategory:   n.SourceCategory,
		NavigationTarget: navigationTargetFromJSON(n.NavigationTarget),
	}
}

// Helper functions for timestamp conversion
func timestampProto(t pgtype.Timestamptz) *timestamppb.Timestamp {
	if !t.Valid {
		return nil
	}
	return timestamppb.New(t.Time)
}

func timestampProtoOrNil(t pgtype.Timestamptz) *timestamppb.Timestamp {
	if !t.Valid {
		return nil
	}
	return timestamppb.New(t.Time)
}
