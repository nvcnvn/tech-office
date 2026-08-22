package notification

import (
	"context"
	"fmt"
	"log/slog"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/database/txn"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// PresencePong answers a presence ping delivered on the notification stream, and is
// also sent unsolicited when the employee's state or active context changes.
//
// This is the ONLY way presence is reported. The server never advances a connection's
// liveness on its own — see sse.go, where the former heartbeat write was deleted.
//
// The handler validates, enqueues the pong on the per-instance batcher, and blocks on
// its own result. Awaiting the flush is what lets the response say authoritatively
// that a connection no longer exists.
func (s *NotificationServiceConnect) PresencePong(
	ctx context.Context,
	req *connect.Request[rpcv1.PresencePongRequest],
) (*connect.Response[rpcv1.PresencePongResponse], error) {
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	if req.Msg.ConnectionId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("connection_id is required - establish a notification stream first"))
	}
	connectionID, err := dbuuid.Parse(req.Msg.ConnectionId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid connection_id: %w", err))
	}

	// The client must state what it is: an unspecified status carries no information
	// and would silently overwrite a real one.
	if req.Msg.Status == rpcv1.PresenceStatus_PRESENCE_STATUS_UNSPECIFIED {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("status is required and must not be PRESENCE_STATUS_UNSPECIFIED"))
	}
	status := PresenceStatusFromProto(req.Msg.Status)

	var activeChannelID dbuuid.NullUUID
	if req.Msg.ActiveChannelId != "" {
		channelUUID, err := dbuuid.Parse(req.Msg.ActiveChannelId)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid active_channel_id: %w", err))
		}
		activeChannelID = dbuuid.NullUUID{UUID: [16]byte(channelUUID), Valid: true}
	}

	var lastInteractionAt pgtype.Timestamptz
	if req.Msg.LastInteractionAt != nil {
		lastInteractionAt = pgtype.Timestamptz{Time: req.Msg.LastInteractionAt.AsTime(), Valid: true}
	}

	directive, err := s.PongBatcher.Submit(ctx, PongRecord{
		OrganizationID:    organizationID,
		EmployeeID:        employeeID,
		ConnectionID:      connectionID,
		Status:            status,
		ActiveChannelID:   activeChannelID,
		LastInteractionAt: lastInteractionAt,
		Departing:         req.Msg.Departing,
	})
	if err != nil {
		slog.WarnContext(ctx, "failed to record presence pong",
			"function", "PresencePong",
			"employee_id", employeeID.String(),
			"connection_id", connectionID.String(),
			"error", err,
		)
		// The client simply answers the next ping.
		return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("failed to record presence pong: %w", err))
	}

	slog.DebugContext(ctx, "presence pong recorded",
		"function", "PresencePong",
		"employee_id", employeeID.String(),
		"connection_id", connectionID.String(),
		"status", status,
		"ping_id", req.Msg.PingId,
		"departing", req.Msg.Departing,
		"directive", directive,
	)

	// A connection belonging to another employee or organization simply fails to match,
	// so it is indistinguishable from a removed one by design: the response leaks
	// nothing about other tenants (FR-022, FR-023).
	protoDirective := rpcv1.PongDirective_PONG_DIRECTIVE_ACK
	if directive == PongDirectiveReconnect {
		protoDirective = rpcv1.PongDirective_PONG_DIRECTIVE_RECONNECT
	}

	return connect.NewResponse(&rpcv1.PresencePongResponse{Directive: protoDirective}), nil
}

// GetEmployeePresence implements the RPC handler for fetching single employee presence.
func (s *NotificationServiceConnect) GetEmployeePresence(
	ctx context.Context,
	req *connect.Request[rpcv1.GetEmployeePresenceRequest],
) (*connect.Response[rpcv1.GetEmployeePresenceResponse], error) {
	slog.DebugContext(ctx, "GetEmployeePresence RPC called",
		"function", "GetEmployeePresence",
		"target_employee_id", req.Msg.EmployeeId,
	)

	// Extract auth context (viewer)
	viewerID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Parse target employee ID
	targetEmployeeID, err := dbuuid.Parse(req.Msg.EmployeeId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid employee_id: %w", err))
	}

	// Fetch presence with visibility filtering
	var presence *EmployeePresence
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		presence, txErr = s.PresenceLogic.GetEmployeePresence(ctx, tx, targetEmployeeID, organizationID)
		if txErr != nil {
			return txErr
		}

		// Apply visibility filtering
		filtered, filterErr := s.VisibilityLogic.FilterVisiblePresence(
			ctx, tx, []*EmployeePresence{presence}, viewerID, organizationID,
		)
		if filterErr != nil {
			return filterErr
		}

		if len(filtered) == 0 {
			// Viewer doesn't have permission to see this presence
			presence = &EmployeePresence{
				EmployeeID:     targetEmployeeID,
				OrganizationID: organizationID,
				Status:         PresenceStatusOffline, // Show as offline when hidden
			}
		} else {
			presence = filtered[0]
		}

		return nil
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Build response
	protoPresence := &rpcv1.EmployeePresence{
		EmployeeId: presence.EmployeeID.String(),
		Status:     PresenceStatusToProto(presence.Status),
	}

	if presence.ActiveChannelID.Valid {
		protoPresence.ActiveChannelId = presence.ActiveChannelID.UUID.String()
	}

	if presence.LastInteractionAt.Valid {
		protoPresence.LastInteractionAt = timestamppb.New(presence.LastInteractionAt.Time)
	}

	// The proto field keeps its name and number; last_pong_at is what fills it now.
	if presence.LastPongAt.Valid {
		protoPresence.LastHeartbeat = timestamppb.New(presence.LastPongAt.Time)
	}

	if presence.Visibility != nil {
		protoPresence.Visibility = &rpcv1.PresenceVisibility{
			VisibilityMode:    visibilityModeStringToProto(presence.Visibility.VisibilityMode),
			CustomStatusText:  presence.Visibility.CustomStatusText.String,
			CustomStatusEmoji: presence.Visibility.CustomStatusEmoji.String,
		}
		if presence.Visibility.UpdatedAt.Valid {
			protoPresence.Visibility.UpdatedAt = timestamppb.New(presence.Visibility.UpdatedAt.Time)
		}
	}

	return connect.NewResponse(&rpcv1.GetEmployeePresenceResponse{
		Presence: protoPresence,
	}), nil
}

// GetBatchEmployeePresence implements the RPC handler for fetching multiple employees' presence.
func (s *NotificationServiceConnect) GetBatchEmployeePresence(
	ctx context.Context,
	req *connect.Request[rpcv1.GetBatchEmployeePresenceRequest],
) (*connect.Response[rpcv1.GetBatchEmployeePresenceResponse], error) {
	slog.DebugContext(ctx, "GetBatchEmployeePresence RPC called",
		"function", "GetBatchEmployeePresence",
		"employee_count", len(req.Msg.EmployeeIds),
	)

	// Extract auth context (viewer)
	viewerID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Parse employee IDs
	employeeIDs := make([]dbuuid.UUID, 0, len(req.Msg.EmployeeIds))
	for _, idStr := range req.Msg.EmployeeIds {
		id, err := dbuuid.Parse(idStr)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid employee_id: %s: %w", idStr, err))
		}
		employeeIDs = append(employeeIDs, id)
	}

	// Fetch batch presence with visibility filtering
	var presences []*EmployeePresence
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		presences, txErr = s.PresenceLogic.GetBatchEmployeePresence(
			ctx, tx, employeeIDs, organizationID, viewerID,
		)
		return txErr
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Build response
	protoPresences := make([]*rpcv1.EmployeePresence, 0, len(presences))
	for _, p := range presences {
		protoPresence := &rpcv1.EmployeePresence{
			EmployeeId: p.EmployeeID.String(),
			Status:     PresenceStatusToProto(p.Status),
		}

		if p.ActiveChannelID.Valid {
			protoPresence.ActiveChannelId = p.ActiveChannelID.UUID.String()
		}

		if p.LastInteractionAt.Valid {
			protoPresence.LastInteractionAt = timestamppb.New(p.LastInteractionAt.Time)
		}

		// The proto field keeps its name and number; last_pong_at is what fills it now.
		if p.LastPongAt.Valid {
			protoPresence.LastHeartbeat = timestamppb.New(p.LastPongAt.Time)
		}

		if p.Visibility != nil {
			protoPresence.Visibility = &rpcv1.PresenceVisibility{
				VisibilityMode:    visibilityModeStringToProto(p.Visibility.VisibilityMode),
				CustomStatusText:  p.Visibility.CustomStatusText.String,
				CustomStatusEmoji: p.Visibility.CustomStatusEmoji.String,
			}
			if p.Visibility.UpdatedAt.Valid {
				protoPresence.Visibility.UpdatedAt = timestamppb.New(p.Visibility.UpdatedAt.Time)
			}
		}

		protoPresences = append(protoPresences, protoPresence)
	}

	return connect.NewResponse(&rpcv1.GetBatchEmployeePresenceResponse{
		Presences: protoPresences,
	}), nil
}

// Helper functions for proto conversion

func visibilityModeStringToProto(mode string) rpcv1.VisibilityMode {
	switch mode {
	case VisibilityModeEveryone:
		return rpcv1.VisibilityMode_VISIBILITY_MODE_EVERYONE
	case VisibilityModeDepartments:
		return rpcv1.VisibilityMode_VISIBILITY_MODE_DEPARTMENTS
	case VisibilityModeOffline:
		return rpcv1.VisibilityMode_VISIBILITY_MODE_OFFLINE
	default:
		return rpcv1.VisibilityMode_VISIBILITY_MODE_EVERYONE
	}
}
