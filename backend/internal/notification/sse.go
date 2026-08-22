package notification

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/interceptor"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// StreamNotifications establishes Server-Sent Events (SSE) connection for real-time notifications.
// Registers connection in active_connection registry and streams new notifications.
// Uses TenantPool for employee operations.
type eventDispatcher func(*rpcv1.NotificationEvent) error

func (s *NotificationService) StreamNotifications(
	ctx context.Context,
	req *connect.Request[rpcv1.StreamNotificationsRequest],
	stream *connect.ServerStream[rpcv1.NotificationEvent],
) error {
	return s.streamNotificationsCore(ctx, req, stream.Send)
}

func (s *NotificationService) streamNotificationsCore(
	ctx context.Context,
	req *connect.Request[rpcv1.StreamNotificationsRequest],
	send eventDispatcher,
) error {
	slog.InfoContext(ctx, "stream connection requested", "lastEventID", req.Msg.LastEventId)

	employeeID, organizationID, err := s.validateStreamRequest(ctx, req.Msg)
	if err != nil {
		slog.ErrorContext(ctx, "stream validation failed", "error", err)
		return connect.NewError(connect.CodeUnauthenticated, err)
	}

	slog.InfoContext(ctx, "stream connection established",
		"employeeID", employeeID.String(),
		"organizationID", organizationID.String(),
		"instanceID", s.InstanceID)

	connectionID, cleanup, err := s.setupConnection(ctx, req, employeeID, organizationID)
	if err != nil {
		slog.ErrorContext(ctx, "failed to setup connection", "error", err, "employeeID", employeeID.String())
		return connect.NewError(connect.CodeInternal, err)
	}
	defer func() {
		cleanup()
		slog.InfoContext(ctx, "stream connection closed", "employeeID", employeeID.String(), "connectionID", connectionID.String())
	}()

	// Initial connection event includes connection ID for presence tracking.
	connectionEvent := &rpcv1.NotificationEvent{
		EventId:      dbuuid.Must().String(),
		EventType:    EventTypeConnectionEstablished,
		Timestamp:    timestamppb.Now(),
		ConnectionId: connectionID.String(),
	}

	if err := send(connectionEvent); err != nil {
		return connect.NewError(connect.CodeInternal, fmt.Errorf("failed to send connection_established event: %w", err))
	}

	if req.Msg.LastEventId != "" {
		if err := s.sendMissedNotifications(ctx, send, employeeID, organizationID); err != nil {
			slog.WarnContext(ctx, "failed to send missed notifications", "error", err, "employeeID", employeeID.String())
		}
	}

	pingTicker := time.NewTicker(PingIntervalSeconds * time.Second)
	defer pingTicker.Stop()

	s.connMutex.RLock()
	sseConn, exists := s.activeConnections[connectionID]
	s.connMutex.RUnlock()

	if !exists {
		return connect.NewError(connect.CodeInternal, fmt.Errorf("connection not found in active connections"))
	}

	slog.DebugContext(ctx, "starting SSE event loop",
		"employeeID", employeeID.String(),
		"connectionID", connectionID.String(),
		"channelBufferSize", cap(sseConn.EventChan))

	for {
		select {
		case <-ctx.Done():
			slog.InfoContext(ctx, "SSE stream context done", "employeeID", employeeID.String())
			return nil

		case event, ok := <-sseConn.EventChan:
			slog.DebugContext(ctx, "StreamNotifications received notification event from channel",
				"employeeID", employeeID.String(),
				"eventID", func() string {
					if event != nil {
						return event.EventId
					}
					return "nil"
				}(),
				"channelOpen", ok)

			if !ok {
				slog.InfoContext(ctx, "event channel closed", "employeeID", employeeID.String())
				return nil
			}

			if err := send(event); err != nil {
				slog.ErrorContext(ctx, "failed to send notification event", "error", err, "employeeID", employeeID.String())
				return connect.NewError(connect.CodeInternal, fmt.Errorf("failed to send notification: %w", err))
			}

			slog.InfoContext(ctx, "notification sent to client",
				"employeeID", employeeID.String(),
				"eventID", event.EventId,
				"eventType", event.EventType)

		case <-pingTicker.C:
			// The ping is a liveness challenge, and its event_id IS the ping id: the
			// client answers with PresencePong echoing it.
			//
			// Nothing here writes to the connection's row. That deletion is the whole
			// point of this protocol: as long as anything server-side advanced the
			// liveness timestamp, a client that had gone away was unobservable, and a
			// sleeping laptop stayed "online" while its notifications were suppressed.
			// Liveness is now established only by an answer that made the full round
			// trip — server → stream → client → RPC → server. A connection whose row
			// vanished (UNLOGGED-table recovery) is told to reconnect by its next pong's
			// directive rather than being silently re-registered here.
			ping := &rpcv1.NotificationEvent{
				EventId:      dbuuid.Must().String(),
				EventType:    EventTypePing,
				Timestamp:    timestamppb.Now(),
				ConnectionId: connectionID.String(),
			}

			if err := send(ping); err != nil {
				return connect.NewError(connect.CodeInternal, fmt.Errorf("failed to send ping: %w", err))
			}
		}
	}
}

// validateStreamRequest validates auth context and extracts employee_id and organization_id.
func (s *NotificationService) validateStreamRequest(
	ctx context.Context,
	req *rpcv1.StreamNotificationsRequest,
) (dbuuid.UUID, dbuuid.UUID, error) {
	// Extract user ID from auth context
	userID, ok := interceptor.UserIDFromContext(ctx)
	if !ok || userID == "" {
		return dbuuid.UUID{}, dbuuid.UUID{}, fmt.Errorf("user ID not found in context")
	}

	// Extract organization ID from auth context
	orgIDStr, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok || orgIDStr == "" {
		return dbuuid.UUID{}, dbuuid.UUID{}, fmt.Errorf("organization ID not found in context")
	}

	// Parse UUIDs
	employeeID, err := dbuuid.Parse(userID)
	if err != nil {
		return dbuuid.UUID{}, dbuuid.UUID{}, fmt.Errorf("invalid employee ID: %w", err)
	}

	organizationID, err := dbuuid.Parse(orgIDStr)
	if err != nil {
		return dbuuid.UUID{}, dbuuid.UUID{}, fmt.Errorf("invalid organization ID: %w", err)
	}

	return employeeID, organizationID, nil
}

// setupConnection registers the connection in active_connection registry.
// Returns connection_id and cleanup function.
func (s *NotificationService) setupConnection(
	ctx context.Context,
	req *connect.Request[rpcv1.StreamNotificationsRequest],
	employeeID dbuuid.UUID,
	organizationID dbuuid.UUID,
) (dbuuid.UUID, func(), error) {
	connectionID := dbuuid.Must()

	// Extract User-Agent and IP address from request headers
	userAgent := req.Header().Get("User-Agent")

	// Try to extract real IP from X-Forwarded-For or X-Real-IP headers
	ipAddress := req.Header().Get("X-Forwarded-For")
	if ipAddress == "" {
		ipAddress = req.Header().Get("X-Real-IP")
	}
	// Take first IP if comma-separated list
	if idx := len(ipAddress); idx > 0 {
		for i, c := range ipAddress {
			if c == ',' {
				ipAddress = ipAddress[:i]
				break
			}
		}
	}

	// Register connection
	if err := s.registerConnection(ctx, employeeID, connectionID, organizationID, userAgent, ipAddress); err != nil {
		return dbuuid.UUID{}, nil, fmt.Errorf("failed to register connection: %w", err)
	}

	// Register SSE connection in memory for event routing
	eventChan := make(chan *rpcv1.NotificationEvent, 100) // Buffer for 100 events
	sseConn := &SSEConnection{
		EmployeeID:     employeeID,
		ConnectionID:   connectionID,
		OrganizationID: organizationID,
		EventChan:      eventChan,
	}

	s.connMutex.Lock()
	s.activeConnections[connectionID] = sseConn
	s.connMutex.Unlock()

	// Return cleanup function
	cleanup := func() {
		// Remove from in-memory map
		s.connMutex.Lock()
		delete(s.activeConnections, connectionID)
		s.connMutex.Unlock()
		close(eventChan)

		// Use background context for cleanup (original context may be canceled)
		cleanupCtx := context.Background()
		if err := s.unregisterConnection(cleanupCtx, employeeID, connectionID, organizationID); err != nil {
			slog.ErrorContext(cleanupCtx, "failed to unregister connection", "error", err, "employeeID", employeeID.String())
		}
	}

	return connectionID, cleanup, nil
}

// sendMissedNotifications queries and sends notifications that were missed while disconnected.
func (s *NotificationService) sendMissedNotifications(
	ctx context.Context,
	send eventDispatcher,
	employeeID dbuuid.UUID,
	organizationID dbuuid.UUID,
) error {
	// Parse lastEventID as notification UUID (if provided)
	// For now, we'll send recent undelivered notifications without parsing lastEventID
	// In production, lastEventID would be used to query notifications after a specific point

	// Query recent pending notifications for replay (last 100, unacknowledged only)
	notifications, err := s.Queries.ListNotificationsByEmployee(ctx, s.TenantPool, &database.ListNotificationsByEmployeeParams{
		EmployeeID:                  employeeID,
		OrganizationID:              organizationID,
		Limit:                       100,
		Offset:                      0,
		AcknowledgementStatusFilter: pgtype.Text{String: AcknowledgementStatusPending, Valid: true}, // Replay unacknowledged only
		SourceDomains:               nil,                                                            // All source domains
	})
	if err != nil {
		return fmt.Errorf("failed to query missed notifications: %w", err)
	}

	// notificationTypesExcludedFromReplay lists types that must not be replayed on SSE
	// reconnect. These are transient, time-sensitive signals: replaying them after the
	// triggering event has passed (call ended, invitation already answered, etc.) causes
	// stale popups that fail with "already responded" or similar precondition errors.
	notificationTypesExcludedFromReplay := map[string]struct{}{
		NotificationTypeVoiceCallIncoming: {},
	}

	// Send each notification as a "notification" event
	for _, n := range notifications {
		// Skip time-sensitive notification types that must not be replayed
		if _, skip := notificationTypesExcludedFromReplay[n.NotificationType]; skip {
			slog.InfoContext(ctx, "skipping time-sensitive notification during replay",
				"notificationType", n.NotificationType,
				"notificationID", n.NotificationID.String(),
				"employeeID", employeeID.String())
			continue
		}

		// Convert to NotificationSummary
		notifSummary := s.notificationRowToProto(ctx, n)

		// Send as notification event
		event := &rpcv1.NotificationEvent{
			EventId:      n.NotificationID.String(), // Use notification ID as event ID
			EventType:    EventTypeNotification,
			Timestamp:    timestamppb.New(n.UpdatedAt.Time),
			Notification: notifSummary,
		}

		if err := send(event); err != nil {
			return fmt.Errorf("failed to send missed notification: %w", err)
		}
	}

	slog.InfoContext(ctx, "sent missed notifications", "count", len(notifications), "employeeID", employeeID.String())
	return nil
}
