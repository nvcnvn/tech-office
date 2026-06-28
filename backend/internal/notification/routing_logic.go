package notification

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// RoutingLogic defines the interface for notification routing with presence awareness
type RoutingLogic interface {
	// RouteEphemeralSignal routes ephemeral signals (priority=4) directly to active channel viewers
	// without database writes
	RouteEphemeralSignal(ctx context.Context, orgID dbuuid.UUID, channelID *dbuuid.UUID, notification *rpcv1.NotificationEvent) error

	// ShouldSendPush determines if push notification should be sent based on employee presence
	ShouldSendPush(ctx context.Context, tx database.DBTX, employeeID, orgID dbuuid.UUID, priority int32, channelID *dbuuid.UUID) (bool, error)

	// ShouldSuppressPush checks DND and domain-mute to decide if push should be suppressed.
	// Priority 0 (always) bypasses all suppression.
	// Returns true if push should be suppressed (SSE still delivered).
	ShouldSuppressPush(ctx context.Context, tx database.DBTX, employeeID, orgID dbuuid.UUID, priority int32, sourceDomain string) (bool, error)

	// DecideFallback combines presence and preference checks to produce a single push fallback
	// decision with an explicit reason code. Callers use the Reason for delivery auditing.
	DecideFallback(ctx context.Context, tx database.DBTX, employeeID, orgID dbuuid.UUID, priority int32, sourceDomain string, channelID *dbuuid.UUID) FallbackDecision
}

// FallbackDecision is the authoritative outcome of the push fallback evaluation for one recipient.
type FallbackDecision struct {
	// ShouldSend is true when a push notification should be dispatched.
	ShouldSend bool
	// Reason is non-empty when ShouldSend is false, recording why push was skipped.
	// Matches the FallbackReason* constants in constants.go.
	Reason string
}

// routingLogicImpl implements RoutingLogic interface
type routingLogicImpl struct {
	Queries       *database.Queries
	Service       *NotificationService // Reference to parent service for SSE registry
	PresenceLogic PresenceLogic        // For fetching employee presence
}

// NewRoutingLogic creates a new routing logic instance
func NewRoutingLogic(queries *database.Queries, service *NotificationService, presenceLogic PresenceLogic) RoutingLogic {
	return &routingLogicImpl{
		Queries:       queries,
		Service:       service,
		PresenceLogic: presenceLogic,
	}
}

// RouteEphemeralSignal routes ephemeral signals (priority=4) to only active channel viewers
// These signals (typing indicators, reactions) are NOT written to the database.
//
// Parameters:
//   - ctx: Request context
//   - orgID: Organization UUID
//   - channelID: Target channel UUID (required for ephemeral signals)
//   - notification: Notification event to route
//
// Returns:
//   - error: Routing error if any
func (r *routingLogicImpl) RouteEphemeralSignal(
	ctx context.Context,
	orgID dbuuid.UUID,
	channelID *dbuuid.UUID,
	notification *rpcv1.NotificationEvent,
) error {
	if channelID == nil {
		slog.WarnContext(ctx, "ephemeral signal without channel_id, skipping",
			"eventType", notification.EventType)
		return nil
	}

	slog.DebugContext(ctx, "routing ephemeral signal to channel viewers",
		"function", "RouteEphemeralSignal",
		"orgID", orgID.String(),
		"channelID", channelID.String(),
		"eventType", notification.EventType)

	// Get all connections viewing this channel
	connections := r.Service.GetConnectionsByChannel(orgID, *channelID)

	if len(connections) == 0 {
		slog.DebugContext(ctx, "no connections viewing channel, ephemeral signal dropped",
			"channelID", channelID.String())
		return nil
	}

	// Send to all matching connections
	sentCount := 0
	for _, conn := range connections {
		select {
		case conn.EventChan <- notification:
			sentCount++
			slog.DebugContext(ctx, "ephemeral signal sent to connection",
				"connectionID", conn.ConnectionID.String(),
				"employeeID", conn.EmployeeID.String())
		default:
			// Channel full, skip this connection
			slog.WarnContext(ctx, "connection event channel full, dropping ephemeral signal",
				"connectionID", conn.ConnectionID.String())
		}
	}

	slog.InfoContext(ctx, "ephemeral signal routed",
		"channelID", channelID.String(),
		"totalConnections", len(connections),
		"sentCount", sentCount)

	return nil
}

// ShouldSendPush determines if push notification should be sent based on presence.
//
// Logic:
//   - Priority=0 (critical): Always send push
//   - Priority=1-3: Send push if employee is offline OR if online but hidden
//   - If employee is viewing target channel: Don't send push (SSE is enough)
//
// Parameters:
//   - ctx: Request context
//   - tx: Database transaction
//   - employeeID: Target employee UUID
//   - orgID: Organization UUID
//   - priority: Notification priority (0=critical, 1-3=normal, 4=ephemeral)
//   - channelID: Optional target channel ID (for context-aware routing)
//
// Returns:
//   - bool: True if push should be sent
//   - error: Error if any
func (r *routingLogicImpl) ShouldSendPush(
	ctx context.Context,
	tx database.DBTX,
	employeeID, orgID dbuuid.UUID,
	priority int32,
	channelID *dbuuid.UUID,
) (bool, error) {
	slog.DebugContext(ctx, "checking if push should be sent",
		"function", "ShouldSendPush",
		"employeeID", employeeID.String(),
		"orgID", orgID.String(),
		"priority", priority)

	// Priority=0 (critical): Always send push
	if priority == 0 {
		slog.DebugContext(ctx, "critical notification, sending push",
			"employeeID", employeeID.String())
		return true, nil
	}

	// Priority=4 (ephemeral): Never send push
	if priority == 4 {
		return false, nil
	}

	// Get employee's active connections to determine online status
	activeConnections, err := r.PresenceLogic.GetEmployeeActiveConnections(ctx, tx, employeeID, orgID)
	if err != nil {
		slog.ErrorContext(ctx, "failed to get employee active connections",
			"function", "ShouldSendPush",
			"error", err,
			"employeeID", employeeID.String())
		// Fallback: send push if we can't determine presence
		return true, fmt.Errorf("failed to get active connections: %w", err)
	}

	isOnline := len(activeConnections) > 0

	// Offline: send push
	if !isOnline {
		slog.DebugContext(ctx, "employee offline, sending push",
			"employeeID", employeeID.String())
		return true, nil
	}

	// Online: check if viewing target channel
	if channelID != nil {
		for _, conn := range activeConnections {
			// Convert dbuuid.UUID to google uuid for comparison
			connChannelUUID := dbuuid.UUID(conn.ActiveChannelID.UUID)
			if conn.ActiveChannelID.Valid && connChannelUUID == *channelID {
				// Employee is viewing target channel - suppress push
				slog.DebugContext(ctx, "employee viewing target channel, suppress push",
					"employeeID", employeeID.String(),
					"channelID", channelID.String())
				return false, nil
			}
		}
	}

	// Online but not viewing target or status is hidden: check presence status
	for _, conn := range activeConnections {
		if conn.PresenceStatus == PresenceStatusOnlineHidden {
			// Employee set status to hidden - send push
			slog.DebugContext(ctx, "employee status is online_hidden, sending push",
				"employeeID", employeeID.String())
			return true, nil
		}
	}

	// Online and viewing or status is visible: don't send push (SSE is enough)
	slog.DebugContext(ctx, "employee online and visible, skip push",
		"employeeID", employeeID.String())
	return false, nil
}

// ShouldSuppressPush checks DND schedule and domain-mute to decide if push
// notification should be suppressed. SSE delivery is unaffected.
//
// Priority 0 (always/critical) bypasses all suppression rules.
func (r *routingLogicImpl) ShouldSuppressPush(
	ctx context.Context,
	tx database.DBTX,
	employeeID, orgID dbuuid.UUID,
	priority int32,
	sourceDomain string,
) (bool, error) {
	// Priority 0 bypasses all suppression
	if priority == 0 {
		return false, nil
	}

	pref, err := r.Queries.GetPersonalPreference(ctx, tx, &database.GetPersonalPreferenceParams{
		OrganizationID: orgID,
		EmployeeID:     employeeID,
	})
	if err != nil {
		// No preference row means no suppression
		slog.DebugContext(ctx, "no personal preference found, no suppression",
			"employeeID", employeeID.String())
		return false, nil
	}

	// Check domain mute
	for _, d := range pref.MutedDomains {
		if d == sourceDomain {
			slog.InfoContext(ctx, "push suppressed: domain muted",
				"employeeID", employeeID.String(),
				"domain", sourceDomain)
			return true, nil
		}
	}

	// Check DND
	if pref.DndEnabled && pref.DndStart.Valid && pref.DndEnd.Valid {
		now := pgtype.Time{Valid: true}
		// Use DB server time query for consistency
		if err := tx.QueryRow(ctx, "SELECT LOCALTIME").Scan(&now); err != nil {
			slog.ErrorContext(ctx, "failed to get server time for DND check", "error", err)
			return false, nil
		}
		start := pref.DndStart.Microseconds
		end := pref.DndEnd.Microseconds
		current := now.Microseconds
		if start <= end {
			// Normal range (e.g., 22:00 to 06:00 doesn't wrap)
			if current >= start && current <= end {
				slog.InfoContext(ctx, "push suppressed: DND active",
					"employeeID", employeeID.String())
				return true, nil
			}
		} else {
			// Wraps midnight (e.g., 22:00 to 06:00)
			if current >= start || current <= end {
				slog.InfoContext(ctx, "push suppressed: DND active (midnight wrap)",
					"employeeID", employeeID.String())
				return true, nil
			}
		}
	}

	return false, nil
}

// DecideFallback is the single authoritative fallback evaluation. It combines
// presence-based routing (ShouldSendPush) and preference-based suppression
// (ShouldSuppressPush) into a single result with an explicit reason code.
//
// Callers should use Reason to record the outcome in the delivery_attempt table.
func (r *routingLogicImpl) DecideFallback(
	ctx context.Context,
	tx database.DBTX,
	employeeID, orgID dbuuid.UUID,
	priority int32,
	sourceDomain string,
	channelID *dbuuid.UUID,
) FallbackDecision {
	// Check presence: is the employee even reachable via push?
	sendPush, err := r.ShouldSendPush(ctx, tx, employeeID, orgID, priority, channelID)
	if err != nil {
		slog.WarnContext(ctx, "DecideFallback: presence check failed, defaulting to send",
			"employeeID", employeeID.String(), "error", err)
		// Fail open: attempt push to avoid silent data loss
		return FallbackDecision{ShouldSend: true}
	}
	if !sendPush {
		// Employee is online and reachable via SSE
		return FallbackDecision{ShouldSend: false, Reason: FallbackReasonRecipientOnline}
	}

	// Check preference suppression (DND, muted domain)
	suppress, err := r.ShouldSuppressPush(ctx, tx, employeeID, orgID, priority, sourceDomain)
	if err != nil {
		slog.WarnContext(ctx, "DecideFallback: suppression check failed, defaulting to send",
			"employeeID", employeeID.String(), "error", err)
		return FallbackDecision{ShouldSend: true}
	}
	if suppress {
		return FallbackDecision{ShouldSend: false, Reason: FallbackReasonSuppressedByPreference}
	}

	return FallbackDecision{ShouldSend: true}
}
