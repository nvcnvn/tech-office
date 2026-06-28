package notification

import (
	"context"
	"errors"
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

// UpdatePresenceStatus implements the RPC handler for updating employee presence status.
// This method is called frequently (every 30s heartbeat) and on state changes.
func (s *NotificationServiceConnect) UpdatePresenceStatus(
	ctx context.Context,
	req *connect.Request[rpcv1.UpdatePresenceStatusRequest],
) (*connect.Response[rpcv1.UpdatePresenceStatusResponse], error) {
	slog.DebugContext(ctx, "UpdatePresenceStatus RPC called",
		"function", "UpdatePresenceStatus",
		"status", req.Msg.Status.String(),
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// connection_id is REQUIRED - MUST be provided by frontend (obtained from SSE stream)
	// UpdatePresenceStatus ONLY updates existing connections, never creates new ones
	if req.Msg.ConnectionId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("connection_id is required - establish SSE connection first"))
	}

	connectionID, parseErr := dbuuid.Parse(req.Msg.ConnectionId)
	if parseErr != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("invalid connection_id: %w", parseErr))
	}

	slog.DebugContext(ctx, "UpdatePresenceStatus validating connection ownership",
		"function", "UpdatePresenceStatus",
		"connection_id", connectionID.String(),
	)

	// Convert proto status to database string
	statusStr := presenceStatusProtoToString(req.Msg.Status)

	// Parse active channel ID (optional)
	var activeChannelID dbuuid.NullUUID
	if req.Msg.ActiveChannelId != "" {
		channelUUID, err := dbuuid.Parse(req.Msg.ActiveChannelId)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid active_channel_id: %w", err))
		}
		// dbuuid.UUID is an alias for google/dbuuid.UUID, direct cast is safe
		activeChannelID = dbuuid.NullUUID{
			UUID:  [16]byte(channelUUID),
			Valid: true,
		}
	}

	// Convert last interaction timestamp
	var lastInteractionAt pgtype.Timestamptz
	if req.Msg.LastInteractionAt != nil {
		lastInteractionAt = pgtype.Timestamptz{
			Time:  req.Msg.LastInteractionAt.AsTime(),
			Valid: true,
		}
	}

	// Build update params
	// Always require connection ownership verification since connection_id is mandatory
	params := &UpdatePresenceParams{
		OrganizationID:             organizationID,
		EmployeeID:                 employeeID,
		ConnectionID:               connectionID,
		Status:                     statusStr,
		ActiveChannelID:            activeChannelID,
		LastInteractionAt:          lastInteractionAt,
		RequestedInstanceID:        s.NotificationService.InstanceID,
		RequireConnectionOwnership: true, // Always true - connection_id is mandatory
	}

	// Update presence status (transaction for consistency)
	var presence *EmployeePresence
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		presence, txErr = s.PresenceLogic.UpdatePresenceStatus(ctx, tx, params)
		return txErr
	})
	if err != nil {
		if errors.Is(err, ErrConnectionNotFound) {
			// The DB row is missing, but the SSE stream may still be alive —
			// this happens after PostgreSQL crash/recovery because active_connection
			// is an UNLOGGED table (data is truncated on recovery).
			// Verify the connection exists in memory and retry without the
			// ownership SELECT; the UpdatePresenceStatus SQL is an UPSERT that
			// will re-create the row.
			if s.NotificationService.HasActiveConnection(connectionID, employeeID) {
				slog.WarnContext(ctx, "connection row missing but SSE stream alive, re-upserting",
					"function", "UpdatePresenceStatus",
					"connectionID", connectionID.String(),
					"employeeID", employeeID.String(),
				)
				params.RequireConnectionOwnership = false
				err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
					var txErr error
					presence, txErr = s.PresenceLogic.UpdatePresenceStatus(ctx, tx, params)
					return txErr
				})
			}
			if err != nil {
				return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("connection_id does not belong to employee"))
			}
		} else {
			slog.ErrorContext(ctx, "failed to update presence status",
				"function", "UpdatePresenceStatus",
				"error", err,
			)
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}

	// Build response
	resp := &rpcv1.UpdatePresenceStatusResponse{
		Status:       presenceStatusStringToProto(presence.Status),
		ConnectionId: connectionID.String(),
	}
	if presence.LastHeartbeat.Valid {
		resp.UpdatedAt = timestamppb.New(presence.LastHeartbeat.Time)
	}
	if presence.ActiveChannelID.Valid {
		resp.ActiveChannelId = presence.ActiveChannelID.UUID.String()
	}

	slog.InfoContext(ctx, "presence status updated successfully",
		"employee_id", employeeID.String(),
		"status", presence.Status,
		"connection_id", connectionID.String(),
	)

	return connect.NewResponse(resp), nil
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
		Status:     presenceStatusStringToProto(presence.Status),
	}

	if presence.ActiveChannelID.Valid {
		protoPresence.ActiveChannelId = presence.ActiveChannelID.UUID.String()
	}

	if presence.LastInteractionAt.Valid {
		protoPresence.LastInteractionAt = timestamppb.New(presence.LastInteractionAt.Time)
	}

	if presence.LastHeartbeat.Valid {
		protoPresence.LastHeartbeat = timestamppb.New(presence.LastHeartbeat.Time)
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
			Status:     presenceStatusStringToProto(p.Status),
		}

		if p.ActiveChannelID.Valid {
			protoPresence.ActiveChannelId = p.ActiveChannelID.UUID.String()
		}

		if p.LastInteractionAt.Valid {
			protoPresence.LastInteractionAt = timestamppb.New(p.LastInteractionAt.Time)
		}

		if p.LastHeartbeat.Valid {
			protoPresence.LastHeartbeat = timestamppb.New(p.LastHeartbeat.Time)
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

func presenceStatusProtoToString(status rpcv1.PresenceStatus) string {
	switch status {
	case rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE:
		return PresenceStatusOnline
	case rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE_HIDDEN:
		return PresenceStatusOnlineHidden
	case rpcv1.PresenceStatus_PRESENCE_STATUS_IDLE:
		return PresenceStatusIdle
	case rpcv1.PresenceStatus_PRESENCE_STATUS_OFFLINE:
		return PresenceStatusOffline
	default:
		return PresenceStatusOffline
	}
}

func presenceStatusStringToProto(status string) rpcv1.PresenceStatus {
	switch status {
	case PresenceStatusOnline:
		return rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE
	case PresenceStatusOnlineHidden:
		return rpcv1.PresenceStatus_PRESENCE_STATUS_ONLINE_HIDDEN
	case PresenceStatusIdle:
		return rpcv1.PresenceStatus_PRESENCE_STATUS_IDLE
	case PresenceStatusOffline:
		return rpcv1.PresenceStatus_PRESENCE_STATUS_OFFLINE
	default:
		return rpcv1.PresenceStatus_PRESENCE_STATUS_OFFLINE
	}
}

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
