package notification

import (
	"context"
	"log/slog"

	"connectrpc.com/connect"
	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/txn"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// SetPresenceVisibility implements the RPC handler for setting presence visibility preferences.
func (s *NotificationServiceConnect) SetPresenceVisibility(
	ctx context.Context,
	req *connect.Request[rpcv1.SetPresenceVisibilityRequest],
) (*connect.Response[rpcv1.SetPresenceVisibilityResponse], error) {
	slog.DebugContext(ctx, "SetPresenceVisibility RPC called",
		"function", "SetPresenceVisibility",
		"visibility_mode", req.Msg.VisibilityMode.String(),
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Build visibility params
	params := &SetPresenceVisibilityParams{
		Mode: visibilityModeProtoToString(req.Msg.VisibilityMode),
	}

	if req.Msg.CustomStatusText != "" {
		params.StatusText = &req.Msg.CustomStatusText
	}
	if req.Msg.CustomStatusEmoji != "" {
		params.StatusEmoji = &req.Msg.CustomStatusEmoji
	}

	// Set visibility
	var visibility *database.NotificationPresenceVisibility
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		visibility, txErr = s.VisibilityLogic.SetPresenceVisibility(ctx, tx, employeeID, organizationID, params)
		return txErr
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Build response
	protoVisibility := &rpcv1.PresenceVisibility{
		VisibilityMode:    visibilityModeStringToProto(visibility.VisibilityMode),
		CustomStatusText:  visibility.CustomStatusText.String,
		CustomStatusEmoji: visibility.CustomStatusEmoji.String,
	}
	if visibility.UpdatedAt.Valid {
		protoVisibility.UpdatedAt = timestamppb.New(visibility.UpdatedAt.Time)
	}

	slog.InfoContext(ctx, "presence visibility updated",
		"employee_id", employeeID.String(),
		"visibility_mode", visibility.VisibilityMode,
	)

	return connect.NewResponse(&rpcv1.SetPresenceVisibilityResponse{
		Visibility: protoVisibility,
	}), nil
}

// GetPresenceSettings implements the RPC handler for fetching current visibility settings.
func (s *NotificationServiceConnect) GetPresenceSettings(
	ctx context.Context,
	req *connect.Request[rpcv1.GetPresenceSettingsRequest],
) (*connect.Response[rpcv1.GetPresenceSettingsResponse], error) {
	slog.DebugContext(ctx, "GetPresenceSettings RPC called",
		"function", "GetPresenceSettings",
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Fetch visibility settings
	var visibility *database.NotificationPresenceVisibility
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		visibility, txErr = s.VisibilityLogic.GetPresenceVisibility(ctx, tx, employeeID, organizationID)
		return txErr
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Build response
	protoVisibility := &rpcv1.PresenceVisibility{
		VisibilityMode:    visibilityModeStringToProto(visibility.VisibilityMode),
		CustomStatusText:  visibility.CustomStatusText.String,
		CustomStatusEmoji: visibility.CustomStatusEmoji.String,
	}
	if visibility.UpdatedAt.Valid {
		protoVisibility.UpdatedAt = timestamppb.New(visibility.UpdatedAt.Time)
	}

	return connect.NewResponse(&rpcv1.GetPresenceSettingsResponse{
		Visibility: protoVisibility,
	}), nil
}

// Helper functions for proto conversion

func visibilityModeProtoToString(mode rpcv1.VisibilityMode) string {
	switch mode {
	case rpcv1.VisibilityMode_VISIBILITY_MODE_EVERYONE:
		return VisibilityModeEveryone
	case rpcv1.VisibilityMode_VISIBILITY_MODE_DEPARTMENTS:
		return VisibilityModeDepartments
	case rpcv1.VisibilityMode_VISIBILITY_MODE_OFFLINE:
		return VisibilityModeOffline
	default:
		return VisibilityModeEveryone
	}
}
