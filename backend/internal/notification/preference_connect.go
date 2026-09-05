package notification

import (
	"context"
	"errors"
	"log/slog"

	"connectrpc.com/connect"
	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/txn"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// GetNotificationPreferences returns the caller's own notification preferences,
// or the documented defaults with exists = false when nothing has been stored.
func (s *NotificationServiceConnect) GetNotificationPreferences(
	ctx context.Context,
	req *connect.Request[rpcv1.GetNotificationPreferencesRequest],
) (*connect.Response[rpcv1.GetNotificationPreferencesResponse], error) {
	slog.DebugContext(ctx, "GetNotificationPreferences RPC called",
		"function", "GetNotificationPreferences",
	)

	// The person is taken from the session, never from the request.
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var prefs *NotificationPreferences
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		prefs, txErr = s.PreferenceLogic.GetNotificationPreferences(ctx, tx, employeeID, organizationID)
		return txErr
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&rpcv1.GetNotificationPreferencesResponse{
		Preferences: preferencesToProto(prefs),
		Exists:      prefs.Exists,
	}), nil
}

// UpdateNotificationPreferences replaces the caller's whole preference record.
func (s *NotificationServiceConnect) UpdateNotificationPreferences(
	ctx context.Context,
	req *connect.Request[rpcv1.UpdateNotificationPreferencesRequest],
) (*connect.Response[rpcv1.UpdateNotificationPreferencesResponse], error) {
	slog.DebugContext(ctx, "UpdateNotificationPreferences RPC called",
		"function", "UpdateNotificationPreferences",
		"muted_domain_count", len(req.Msg.GetMutedDomains()),
	)

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	params := &NotificationPreferences{
		InAppAlertsEnabled: req.Msg.GetInAppAlertsEnabled(),
		MutedDomains:       req.Msg.GetMutedDomains(),
		DndEnabled:         req.Msg.GetDndEnabled(),
		DndStart:           req.Msg.GetDndStart(),
		DndEnd:             req.Msg.GetDndEnd(),
	}

	var prefs *NotificationPreferences
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		prefs, txErr = s.PreferenceLogic.UpdateNotificationPreferences(ctx, tx, employeeID, organizationID, params)
		return txErr
	})
	if err != nil {
		// A rejected value is the caller's to fix, and the message names it.
		if errors.Is(err, ErrInvalidPreference) {
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	slog.InfoContext(ctx, "notification preferences updated",
		"employee_id", employeeID.String(),
		"in_app_alerts_enabled", prefs.InAppAlertsEnabled,
		"muted_domains", prefs.MutedDomains,
	)

	return connect.NewResponse(&rpcv1.UpdateNotificationPreferencesResponse{
		Preferences: preferencesToProto(prefs),
	}), nil
}

func preferencesToProto(prefs *NotificationPreferences) *rpcv1.NotificationPreferences {
	proto := &rpcv1.NotificationPreferences{
		InAppAlertsEnabled: prefs.InAppAlertsEnabled,
		MutedDomains:       prefs.MutedDomains,
		DndEnabled:         prefs.DndEnabled,
		DndStart:           prefs.DndStart,
		DndEnd:             prefs.DndEnd,
	}
	if !prefs.UpdatedAt.IsZero() {
		proto.UpdatedAt = timestamppb.New(prefs.UpdatedAt)
	}
	return proto
}
