package notification

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// invalidChannelCharsRegex matches characters invalid in PostgreSQL channel names.
// PostgreSQL identifiers (unquoted) can only contain alphanumeric, underscore, and must not start with digit.
// We replace all non-alphanumeric chars (except underscore) with underscore.
var invalidChannelCharsRegex = regexp.MustCompile(`[^a-zA-Z0-9_]`)

// sanitizeChannelName converts an instance ID into a valid PostgreSQL channel name.
// PostgreSQL unquoted identifiers cannot contain hyphens, dots, or other special chars.
// CRITICAL: PostgreSQL LISTEN lowercases unquoted identifiers, so we must lowercase
// the channel name to ensure NOTIFY and LISTEN use the same channel.
// Example: "Mac-mini-cua-Cao.local-30767" -> "mac_mini_cua_cao_local_30767"
func sanitizeChannelName(instanceID string) string {
	sanitized := invalidChannelCharsRegex.ReplaceAllString(instanceID, "_")
	return strings.ToLower(sanitized)
}

func listenTopicForInstance(instanceID string) string {
	return fmt.Sprintf("instance_%s_notifications", sanitizeChannelName(instanceID))
}

// initListener acquires a dedicated connection from AdminPool and subscribes to
// the instance-specific LISTEN channel: instance_{InstanceID}_notifications
func (s *NotificationService) initListener(ctx context.Context) error {
	slog.InfoContext(ctx, "initializing LISTEN connection", "instanceID", s.InstanceID)

	// Access the embedded pgxpool.Pool from AdminPool
	// AdminPool embeds *pgxpool.Pool, so we can type assert to access Acquire
	type poolAccessor interface {
		Acquire(ctx context.Context) (*pgxpool.Conn, error)
	}

	poolConn, ok := s.AdminPool.(poolAccessor)
	if !ok {
		return fmt.Errorf("AdminPool does not support Acquire method")
	}

	// Acquire dedicated connection for LISTEN
	conn, err := poolConn.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("failed to acquire connection: %w", err)
	}

	// Hijack removes the connection from the pool entirely, freeing the pool slot.
	// Using conn.Conn() would leak the pool slot because the *pgxpool.Conn is never released.
	s.ListenConn = conn.Hijack()

	// Log connection details for debugging
	slog.InfoContext(ctx, "🔗 LISTEN CONNECTION DETAILS",
		"connInfo", s.ListenConn.Config().ConnString(),
		"host", s.ListenConn.Config().Host,
		"database", s.ListenConn.Config().Database,
		"user", s.ListenConn.Config().User)

	// Subscribe to instance-specific channel (sanitize ID for PostgreSQL identifier rules)
	sanitizedID := sanitizeChannelName(s.InstanceID)
	channelName := listenTopicForInstance(s.InstanceID)

	slog.InfoContext(ctx, "🎯 SUBSCRIBING TO LISTEN CHANNEL",
		"channel", channelName,
		"originalInstanceID", s.InstanceID,
		"sanitizedInstanceID", sanitizedID)

	if _, err := s.ListenConn.Exec(ctx, fmt.Sprintf("LISTEN %s", channelName)); err != nil {
		slog.ErrorContext(ctx, "failed to LISTEN on channel, closing connection", "channel", channelName, "error", err)
		_ = s.ListenConn.Close(context.Background())
		s.ListenConn = nil
		return fmt.Errorf("failed to LISTEN on channel %s: %w", channelName, err)
	}

	slog.InfoContext(ctx, "✅ SUCCESSFULLY SUBSCRIBED TO LISTEN CHANNEL", "channel", channelName)

	if err := s.upsertActiveListener(ctx, channelName); err != nil {
		_ = s.ListenConn.Close(context.Background())
		s.ListenConn = nil
		return fmt.Errorf("failed to register active listener: %w", err)
	}

	// Verify LISTEN is active by querying pg_listening_channels()
	var listeningChannels []string
	rows, err := s.ListenConn.Query(ctx, "SELECT * FROM pg_listening_channels()")
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var ch string
			if err := rows.Scan(&ch); err == nil {
				listeningChannels = append(listeningChannels, ch)
			}
		}
		slog.InfoContext(ctx, "📡 ACTIVE LISTEN CHANNELS", "channels", listeningChannels, "count", len(listeningChannels))
	} else {
		slog.ErrorContext(ctx, "failed to query listening channels", "error", err)
	}

	// Start goroutine to consume notifications
	// Use service's listenerCtx for long-running operation (canceled in Stop())
	go s.consumeNotifications(s.listenerCtx)
	go s.startListenerHeartbeat(s.listenerCtx, channelName)

	// Send a test NOTIFY to verify the connection works
	go func() {
		ctx := s.listenerCtx
		if ctx == nil {
			return
		}

		select {
		case <-time.After(2 * time.Second):
		case <-ctx.Done():
			slog.Info("skipping test NOTIFY because notification listener is shutting down", "instanceID", s.InstanceID)
			return
		}

		if ctx.Err() != nil {
			slog.Info("skipping test NOTIFY because notification listener is shutting down", "instanceID", s.InstanceID)
			return
		}

		testPayload := `{"notification_id":"00000000-0000-0000-0000-000000000001","employee_ids":["00000000-0000-0000-0000-000000000001"],"priority":1}`
		query := "SELECT pg_notify($1, $2)"

		slog.InfoContext(ctx, "🧪 SENDING TEST NOTIFY", "channel", channelName, "payload", testPayload)

		// Use AdminPool to send test NOTIFY (channelName is already lowercase from sanitizeChannelName)
		if _, err := s.AdminPool.Exec(ctx, query, channelName, testPayload); err != nil {
			if isExpectedShutdownError(ctx, err) {
				slog.InfoContext(ctx, "skipping test NOTIFY because notification service is shutting down", "reason", err)
				return
			}
			slog.ErrorContext(ctx, "failed to send test NOTIFY", "error", err)
		} else {
			slog.InfoContext(ctx, "✅ TEST NOTIFY SENT - listener should receive it within 1 second")
		}
	}()

	return nil
}

// reconnectListener re-establishes the dedicated LISTEN connection after an unexpected disconnection.
// It closes the old connection (if any), acquires a new one from the pool, and re-subscribes to the channel.
func (s *NotificationService) reconnectListener(ctx context.Context) error {
	slog.InfoContext(ctx, "🔄 reconnecting LISTEN connection", "instanceID", s.InstanceID)

	s.reconnectCount.Add(1)

	// Close old connection if it exists
	if s.ListenConn != nil {
		_ = s.ListenConn.Close(context.Background())
		s.ListenConn = nil
	}

	type poolAccessor interface {
		Acquire(ctx context.Context) (*pgxpool.Conn, error)
	}

	poolConn, ok := s.AdminPool.(poolAccessor)
	if !ok {
		return fmt.Errorf("AdminPool does not support Acquire method")
	}

	conn, err := poolConn.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("failed to acquire connection: %w", err)
	}

	// Hijack removes the connection from the pool, freeing the pool slot for other queries.
	s.ListenConn = conn.Hijack()
	channelName := listenTopicForInstance(s.InstanceID)

	if _, err := s.ListenConn.Exec(ctx, fmt.Sprintf("LISTEN %s", channelName)); err != nil {
		_ = s.ListenConn.Close(context.Background())
		s.ListenConn = nil
		return fmt.Errorf("failed to LISTEN on channel %s: %w", channelName, err)
	}

	if err := s.upsertActiveListener(ctx, channelName); err != nil {
		slog.WarnContext(ctx, "failed to update active listener after reconnect", "error", err)
	}

	slog.InfoContext(ctx, "✅ LISTEN connection re-established", "channel", channelName)
	return nil
}

func (s *NotificationService) upsertActiveListener(ctx context.Context, channelName string) error {
	now := time.Now()
	var backendPID *int32
	if s.ListenConn != nil && s.ListenConn.PgConn() != nil {
		pid := int32(s.ListenConn.PgConn().PID())
		backendPID = &pid
	}

	const query = `
INSERT INTO notification.active_listener (
    instance_id,
    listen_topic,
    backend_pid,
    connected_at,
    last_heartbeat,
    listener_status,
    consumer_status,
    reconnect_count
) VALUES (
    $1, $2, $3, $4, $4, 'active', 'starting', $5
)
ON CONFLICT (instance_id)
DO UPDATE SET
    listen_topic = EXCLUDED.listen_topic,
    backend_pid = EXCLUDED.backend_pid,
    last_heartbeat = EXCLUDED.last_heartbeat,
    listener_status = 'active',
    reconnect_count = EXCLUDED.reconnect_count`

	if _, err := s.AdminPool.Exec(ctx, query, s.InstanceID, channelName, backendPID, now, s.reconnectCount.Load()); err != nil {
		return err
	}

	return nil
}

// updateConsumerStatus updates just the consumer-related fields in the active_listener row.
func (s *NotificationService) updateConsumerStatus(ctx context.Context, status string, lastError string) {
	// Update in-memory state for self-monitoring (read by heartbeat without DB)
	s.consumerStatus.Store(status)
	if lastError != "" {
		s.lastError.Store(lastError)
	}

	var errText *string
	var errAt *time.Time
	if lastError != "" {
		if len(lastError) > 500 {
			lastError = lastError[:500]
		}
		errText = &lastError
		now := time.Now()
		errAt = &now
	}

	const query = `
UPDATE notification.active_listener
SET consumer_status = $2,
    reconnect_count = $3,
    last_error = COALESCE($4, last_error),
    last_error_at = COALESCE($5, last_error_at)
WHERE instance_id = $1`

	if _, err := s.AdminPool.Exec(ctx, query, s.InstanceID, status, s.reconnectCount.Load(), errText, errAt); err != nil {
		if !isExpectedShutdownError(ctx, err) {
			slog.WarnContext(ctx, "failed to update consumer status",
				"instanceID", s.InstanceID,
				"status", status,
				"error", err)
		}
	}
}

// updateConsumerLastActive updates the consumer_last_active_at timestamp.
func (s *NotificationService) updateConsumerLastActive(ctx context.Context) {
	// Update in-memory state for self-monitoring
	s.consumerStatus.Store("running")
	s.lastConsumerActive.Store(time.Now())

	const query = `
UPDATE notification.active_listener
SET consumer_status = 'running',
    consumer_last_active_at = now()
WHERE instance_id = $1`

	if _, err := s.AdminPool.Exec(ctx, query, s.InstanceID); err != nil {
		if !isExpectedShutdownError(ctx, err) {
			slog.WarnContext(ctx, "failed to update consumer last active",
				"instanceID", s.InstanceID, "error", err)
		}
	}
}

func (s *NotificationService) startListenerHeartbeat(ctx context.Context, channelName string) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.upsertActiveListener(ctx, channelName); err != nil {
				if isExpectedShutdownError(ctx, err) {
					return
				}
				slog.WarnContext(ctx, "failed to heartbeat active listener",
					"instanceID", s.InstanceID,
					"listenTopic", channelName,
					"error", err,
				)
			} else if s.ListenConn != nil && !s.ListenConn.IsClosed() {
				// Connection is confirmed alive even if no NOTIFY arrived — reset
				// the stale timer so idle periods don't trigger false CONSUMER STALE alerts.
				s.lastConsumerActive.Store(time.Now())
			}

			// Self-monitoring: check consumer health from in-memory state
			s.checkConsumerHealth(ctx)
		}
	}
}

// checkConsumerHealth reads in-memory consumer state and logs warnings when degraded.
// Called every 15s by the heartbeat goroutine. Produces structured log lines that
// monitoring systems (Loki, CloudWatch, etc.) can alert on.
func (s *NotificationService) checkConsumerHealth(ctx context.Context) {
	status, _ := s.consumerStatus.Load().(string)
	if status == "" {
		status = "unknown"
	}

	connCount := s.ActiveConnectionCount()
	reconnects := s.reconnectCount.Load()

	switch status {
	case "running":
		// Check if consumer is stuck (no NOTIFY processed for > 5 minutes while connections exist)
		if lastActive, ok := s.lastConsumerActive.Load().(time.Time); ok && connCount > 0 {
			staleDuration := time.Since(lastActive)
			if staleDuration > 5*time.Minute {
				slog.ErrorContext(ctx, "CONSUMER STALE: no notifications processed",
					"instanceID", s.InstanceID,
					"consumer_status", status,
					"last_active_ago", staleDuration.Round(time.Second).String(),
					"active_connections", connCount,
					"reconnect_count", reconnects,
				)
			}
		}
	case "reconnecting":
		if lastErr, ok := s.lastError.Load().(string); ok {
			slog.ErrorContext(ctx, "CONSUMER DEGRADED: reconnecting",
				"instanceID", s.InstanceID,
				"consumer_status", status,
				"active_connections", connCount,
				"reconnect_count", reconnects,
				"last_error", lastErr,
			)
		}
	case "stopped":
		slog.ErrorContext(ctx, "CONSUMER DOWN: goroutine exited while heartbeat alive",
			"instanceID", s.InstanceID,
			"consumer_status", status,
			"active_connections", connCount,
			"reconnect_count", reconnects,
		)
	}
}

// consumeNotifications runs in background and routes incoming NOTIFY payloads to active SSE connections.
func (s *NotificationService) consumeNotifications(ctx context.Context) {
	slog.InfoContext(ctx, "🔔 LISTENER GOROUTINE STARTED - waiting for notifications", "goroutineID", "consumeNotifications")
	s.updateConsumerStatus(ctx, "running", "")

	defer func() {
		s.updateConsumerStatus(ctx, "stopped", "")
	}()

	for {
		// Check if connection is still alive
		if s.ListenConn == nil || s.ListenConn.IsClosed() {
			if ctx.Err() != nil {
				slog.InfoContext(ctx, "listener connection closed during shutdown")
				return
			}
			slog.WarnContext(ctx, "⚠️ ListenConn is closed unexpectedly, attempting reconnect")
			s.updateConsumerStatus(ctx, "reconnecting", "ListenConn closed unexpectedly")
			if err := s.reconnectListener(ctx); err != nil {
				slog.ErrorContext(ctx, "❌ failed to reconnect listener, will retry", "error", err)
				s.updateConsumerStatus(ctx, "reconnecting", err.Error())
				select {
				case <-ctx.Done():
					return
				case <-time.After(5 * time.Second):
				}
				continue
			}
			slog.InfoContext(ctx, "✅ listener reconnected successfully")
			s.updateConsumerStatus(ctx, "running", "")

			// After DB recovery, UNLOGGED tables (active_connection) are truncated.
			// Re-register all in-memory SSE connections so they become visible again
			// for presence, routing, and heartbeat.
			s.reRegisterActiveConnections(ctx)
		}

		notification, err := s.ListenConn.WaitForNotification(ctx)
		if err != nil {
			if isExpectedShutdownError(ctx, err) {
				slog.InfoContext(ctx, "consumeNotifications shutting down", "reason", err)
				return
			}
			slog.ErrorContext(ctx, "❌ WaitForNotification returned error", "error", err)
			if isConnectionError(err) || s.ListenConn.IsClosed() {
				slog.WarnContext(ctx, "⚠️ connection error detected, will reconnect on next iteration")
				s.updateConsumerStatus(ctx, "reconnecting", err.Error())
			}
			continue
		}

		slog.InfoContext(ctx, "✅ NOTIFY RECEIVED!", "channel", notification.Channel, "payload", notification.Payload)

		// Update consumer last active timestamp (throttled — only on actual NOTIFY events)
		s.updateConsumerLastActive(ctx)

		// Parse payload
		var payload NotifyPayload
		if err := json.Unmarshal([]byte(notification.Payload), &payload); err != nil {
			slog.ErrorContext(ctx, "failed to parse notification payload", "error", err, "raw_payload", notification.Payload)
			continue
		}

		slog.DebugContext(ctx, "parsed payload", "notificationID", payload.NotificationID, "employeeIDs", payload.EmployeeIDs, "priority", payload.Priority)

		// Convert employee ID strings to UUIDs
		employeeIDs := make([]dbuuid.UUID, 0, len(payload.EmployeeIDs))
		for _, idStr := range payload.EmployeeIDs {
			id, err := dbuuid.Parse(idStr)
			if err != nil {
				slog.ErrorContext(ctx, "invalid employee ID in payload", "error", err)
				continue
			}
			employeeIDs = append(employeeIDs, id)
		}

		slog.DebugContext(ctx, "routing notification", "employeeCount", len(employeeIDs))

		// Route notification to target employees' SSE connections
		if payload.IsEphemeral {
			// Ephemeral event with inline data (no DB query)
			s.routeEphemeralNotificationToConnections(ctx, &payload, employeeIDs)
		} else {
			// Persistent notification (query DB for details)
			s.routeNotificationToConnections(ctx, payload.NotificationID, payload.OrganizationID, employeeIDs, payload.Priority)
		}
	}
}

// routeEphemeralNotificationToConnections sends ephemeral notification events directly to SSE connections
// without querying the database (used for typing indicators, reactions, etc.)
func (s *NotificationService) routeEphemeralNotificationToConnections(
	ctx context.Context,
	payload *NotifyPayload,
	employeeIDs []dbuuid.UUID,
) {
	slog.DebugContext(ctx, "routeEphemeralNotificationToConnections called",
		"notificationID", payload.NotificationID,
		"notificationType", payload.NotificationType,
		"employeeCount", len(employeeIDs))

	// Find active connections for target employees
	s.connMutex.RLock()
	defer s.connMutex.RUnlock()

	matchedConnections := 0

	// Create ephemeral notification event directly from payload
	event := &rpcv1.NotificationEvent{
		EventId:   dbuuid.Must().String(),
		EventType: "notification",
		Timestamp: timestamppb.Now(),
		Notification: &rpcv1.NotificationSummary{
			NotificationId:          payload.NotificationID,
			NotificationRecipientId: "", // No recipient record for ephemeral events
			SourceDomain:            payload.SourceDomain,
			NotificationType:        payload.NotificationType,
			Title:                   payload.Title,
			Message:                 payload.Message,
			ActionData:              payload.ActionData,
			ReadStatus:              false,
			DeliveryStatus:          "delivered", // Ephemeral events are always "delivered" (sent via SSE)
			CreatedAt:               timestamppb.Now(),
			// Leave ReadAt, DeliveredAt empty for ephemeral events
		},
	}

	// Send event to all connections for target employees
	for _, employeeID := range employeeIDs {
		for connID, conn := range s.activeConnections {
			if conn.EmployeeID == employeeID {
				matchedConnections++
				slog.DebugContext(ctx, "sending ephemeral event to connection",
					"employeeID", employeeID.String(),
					"connectionID", connID.String(),
					"notificationType", payload.NotificationType)

				// Send event to connection's channel (non-blocking)
				select {
				case conn.EventChan <- event:
					slog.DebugContext(ctx, "ephemeral event sent", "employeeID", employeeID.String())
				default:
					slog.WarnContext(ctx, "event channel full, dropping ephemeral event", "employeeID", employeeID.String())
				}
			}
		}
	}

	slog.InfoContext(ctx, "routed ephemeral notification",
		"matchedConnections", matchedConnections,
		"employeeCount", len(employeeIDs),
		"notificationType", payload.NotificationType)
}

// routeNotificationToConnections sends notification events to active SSE connections.
func (s *NotificationService) routeNotificationToConnections(
	ctx context.Context,
	notificationIDStr string,
	organizationIDStr string,
	employeeIDs []dbuuid.UUID,
	priority int,
) {
	slog.DebugContext(ctx, "routeNotificationToConnections called", "notificationID", notificationIDStr, "organizationID", organizationIDStr, "employeeCount", len(employeeIDs))

	// Parse notification ID
	notificationID, err := dbuuid.Parse(notificationIDStr)
	if err != nil {
		slog.ErrorContext(ctx, "invalid notification ID", "error", err, "notificationID", notificationIDStr)
		return
	}

	organizationID, err := dbuuid.Parse(organizationIDStr)
	if err != nil {
		slog.ErrorContext(ctx, "invalid organization ID", "error", err, "organizationID", organizationIDStr)
		return
	}

	// Query full notification details with recipient-specific data (read status, etc.)
	// This returns one row per employee_id in the array
	rows, err := s.Queries.GetNotificationWithRecipientDetails(ctx, s.AdminPool, &database.GetNotificationWithRecipientDetailsParams{
		ID:             notificationID,
		Column2:        employeeIDs,
		OrganizationID: organizationID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to query notification details", "error", err, "notificationID", notificationID.String(), "organizationID", organizationID.String())
		return
	}

	if len(rows) == 0 {
		slog.WarnContext(ctx, "no notification recipients found", "notificationID", notificationID.String(), "organizationID", organizationID.String(), "employeeCount", len(employeeIDs))
		return
	}

	slog.DebugContext(ctx, "queried notification details", "rowCount", len(rows))

	// Find active connections for target employees
	s.connMutex.RLock()
	defer s.connMutex.RUnlock()

	slog.DebugContext(ctx, "checking active connections", "count", len(s.activeConnections))

	matchedConnections := 0
	employeesWithoutConnection := make(map[dbuuid.UUID]*database.GetNotificationWithRecipientDetailsRow)

	// Create a map of employeeID -> notification row for quick lookup
	employeeNotificationMap := make(map[dbuuid.UUID]*database.GetNotificationWithRecipientDetailsRow)
	for i := range rows {
		row := rows[i]
		employeeNotificationMap[row.EmployeeID] = row
	}

	// Send notification to each employee's active connections
	for _, employeeID := range employeeIDs {
		// Find matching row for this employee
		row, exists := employeeNotificationMap[employeeID]
		if !exists {
			slog.WarnContext(ctx, "no notification recipient found for employee", "employeeID", employeeID.String())
			continue
		}

		// Convert database row to proto message
		event := &rpcv1.NotificationEvent{
			EventId:      dbuuid.Must().String(), // Generate unique event ID
			EventType:    "notification",
			Timestamp:    timestamppb.Now(),
			Notification: s.notificationRecipientRowToProto(ctx, row),
		}

		// Track if we found any active connections for this employee
		foundConnection := false

		// Find all connections for this employee
		for connID, conn := range s.activeConnections {
			if conn.EmployeeID == employeeID {
				foundConnection = true
				matchedConnections++
				slog.DebugContext(ctx, "found connection for employee", "employeeID", employeeID.String(), "connectionID", connID.String())

				// Send event to connection's channel (non-blocking)
				select {
				case conn.EventChan <- event:
					// Event sent successfully
					slog.DebugContext(ctx, "sent event to connection", "employeeID", employeeID.String(), "connectionID", connID.String())
				default:
					// Channel full, skip (prevents blocking)
					slog.WarnContext(ctx, "event channel full, dropping event", "employeeID", employeeID.String())
				}
			}
		}

		// If no active SSE connection found, add to push notification fallback list
		if !foundConnection {
			employeesWithoutConnection[employeeID] = row
			slog.DebugContext(ctx, "no active connection for employee, will attempt push notification fallback", "employeeID", employeeID.String())
		}
	}

	slog.InfoContext(ctx, "routed notification", "matchedConnections", matchedConnections, "totalRows", len(rows), "employeesWithoutConnection", len(employeesWithoutConnection))

	// Note: Push notification fallback for offline employees is now handled in publishToInstances (publisher.go)
	// This prevents duplicate push notifications and ensures immediate delivery after transaction commits
	if len(employeesWithoutConnection) > 0 {
		slog.InfoContext(ctx, "📭 employees without active SSE connections (push notifications handled in publishToInstances)",
			"count", len(employeesWithoutConnection),
			"notification_id", notificationIDStr,
		)
	}
}

// notificationRecipientRowToProto converts GetNotificationWithRecipientDetailsRow to NotificationSummary proto.
func (s *NotificationService) notificationRecipientRowToProto(ctx context.Context, n *database.GetNotificationWithRecipientDetailsRow) *rpcv1.NotificationSummary {
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
		AcknowledgementStatus:   n.AcknowledgementStatus,
		AcknowledgedAt:          timestampProtoOrNil(n.AcknowledgedAt),
		AcknowledgementAction:   n.AcknowledgementAction.String,
		FallbackStatus:          n.FallbackStatus,
		FallbackReason:          n.FallbackReason.String,
		PolicyKey:               n.PolicyKey,
		SourceCategory:          n.SourceCategory,
		NavigationTarget:        navigationTargetFromJSON(n.NavigationTarget),
	}
}

// NotifyPayload represents the JSON structure sent via NOTIFY.
type NotifyPayload struct {
	NotificationID string   `json:"notification_id"`
	EmployeeIDs    []string `json:"employee_ids"`
	OrganizationID string   `json:"organization_id"`
	Priority       int      `json:"priority"`

	// Ephemeral event data (only for non-persisted events like typing, reactions)
	IsEphemeral      bool              `json:"is_ephemeral,omitempty"`
	SourceDomain     string            `json:"source_domain,omitempty"`
	NotificationType string            `json:"notification_type,omitempty"`
	Title            string            `json:"title,omitempty"`
	Message          string            `json:"message,omitempty"`
	ActionData       map[string]string `json:"action_data,omitempty"`
}

// notifyInstancesWithEphemeralData sends NOTIFY with inline event data for ephemeral notifications.
// Used for typing indicators, reactions, etc. that don't persist in database.
func (s *NotificationService) notifyInstancesWithEphemeralData(
	ctx context.Context,
	tx database.DBTX,
	instanceEmployeeMap map[string][]dbuuid.UUID,
	notificationID dbuuid.UUID,
	organizationID dbuuid.UUID,
	priority int,
	req *rpcv1.PublishNotificationRequest,
) error {
	slog.DebugContext(ctx, "notifyInstancesWithEphemeralData called", "instanceCount", len(instanceEmployeeMap), "organizationID", organizationID)

	for instanceID, employeeIDs := range instanceEmployeeMap {
		// Convert employee UUIDs to strings
		employeeIDStrings := make([]string, len(employeeIDs))
		for i, id := range employeeIDs {
			employeeIDStrings[i] = id.String()
		}

		// Build payload with ephemeral event data inline
		payload := NotifyPayload{
			NotificationID:   notificationID.String(),
			EmployeeIDs:      employeeIDStrings,
			OrganizationID:   organizationID.String(),
			Priority:         priority,
			IsEphemeral:      true,
			SourceDomain:     req.SourceDomain,
			NotificationType: req.NotificationType,
			Title:            req.Title,
			Message:          req.Message,
			ActionData:       req.ActionData,
		}

		payloadJSON, err := json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("failed to marshal ephemeral NOTIFY payload: %w", err)
		}

		// Execute NOTIFY within transaction
		sanitizedID := sanitizeChannelName(instanceID)
		channelName := fmt.Sprintf("instance_%s_notifications", sanitizedID)

		slog.InfoContext(ctx, "🔔 SENDING EPHEMERAL NOTIFY",
			"channel", channelName,
			"notificationType", req.NotificationType,
			"employeeCount", len(employeeIDs))

		query := "SELECT pg_notify($1, $2)"
		if pgxTx, ok := tx.(pgx.Tx); ok {
			_, err = pgxTx.Exec(ctx, query, channelName, string(payloadJSON))
		} else {
			return fmt.Errorf("tx is not a pgx.Tx")
		}

		if err != nil {
			slog.ErrorContext(ctx, "failed to send ephemeral NOTIFY", "error", err)
			return fmt.Errorf("failed to NOTIFY channel %s: %w", channelName, err)
		}

		slog.InfoContext(ctx, "✅ EPHEMERAL NOTIFY SENT", "channel", channelName)
	}

	return nil
}

// notifyInstances sends NOTIFY to instance-specific channels.
// Called within a transaction - NOTIFY is sent after COMMIT.
func (s *NotificationService) notifyInstances(
	ctx context.Context,
	tx database.DBTX,
	instanceEmployeeMap map[string][]dbuuid.UUID,
	notificationID dbuuid.UUID,
	organizationID dbuuid.UUID,
	priority int,
) error {
	slog.DebugContext(ctx, "notifyInstances called", "instanceCount", len(instanceEmployeeMap), "organizationID", organizationID)

	for instanceID, employeeIDs := range instanceEmployeeMap {
		// Convert employee UUIDs to strings
		employeeIDStrings := make([]string, len(employeeIDs))
		for i, id := range employeeIDs {
			employeeIDStrings[i] = id.String()
		}

		// Build payload
		payload := NotifyPayload{
			NotificationID: notificationID.String(),
			EmployeeIDs:    employeeIDStrings,
			OrganizationID: organizationID.String(),
			Priority:       priority,
		}

		payloadJSON, err := json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("failed to marshal NOTIFY payload: %w", err)
		}

		// Execute NOTIFY within transaction (sanitize ID for PostgreSQL identifier rules)
		sanitizedID := sanitizeChannelName(instanceID)
		channelName := fmt.Sprintf("instance_%s_notifications", sanitizedID)

		slog.InfoContext(ctx, "🔔 PREPARING TO SEND NOTIFY",
			"channel", channelName,
			"originalInstanceID", instanceID,
			"sanitizedInstanceID", sanitizedID,
			"payload", string(payloadJSON))

		// Use pg_notify function with proper parameter binding (prevents SQL injection)
		query := "SELECT pg_notify($1, $2)"

		// Execute using the transaction connection
		if pgxTx, ok := tx.(pgx.Tx); ok {
			_, err = pgxTx.Exec(ctx, query, channelName, string(payloadJSON))
		} else {
			return fmt.Errorf("tx is not a pgx.Tx")
		}

		if err != nil {
			slog.ErrorContext(ctx, "❌ FAILED TO NOTIFY CHANNEL", "channel", channelName, "error", err)
			return fmt.Errorf("failed to NOTIFY channel %s: %w", channelName, err)
		}

		slog.InfoContext(ctx, "✅ SUCCESSFULLY SENT NOTIFY (within transaction, will broadcast on COMMIT)", "channel", channelName, "employeeCount", len(employeeIDs))
	}

	return nil
}
