package preference

import (
	"context"
	"fmt"
	"log/slog"

	"connectrpc.com/connect"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/database/txn"
	"github.com/nvcnvn/tech-office/backend/internal/interceptor"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/nvcnvn/tech-office/backend/rpc/v1/rpcv1connect"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// PreferenceServiceServer implements the PreferenceService RPC interface
type PreferenceServiceServer struct {
	TenantPool database.TenantDatabaseConnector
	logic      PreferenceLogic
}

// NewService creates a new PreferenceServiceServer
func NewService(tenantPool database.TenantDatabaseConnector, logic PreferenceLogic) rpcv1connect.PreferenceServiceHandler {
	return &PreferenceServiceServer{
		TenantPool: tenantPool,
		logic:      logic,
	}
}

// GetUserPreference retrieves the current user's preference settings
func (s *PreferenceServiceServer) GetUserPreference(
	ctx context.Context,
	req *connect.Request[rpcv1.GetUserPreferenceRequest],
) (*connect.Response[rpcv1.GetUserPreferenceResponse], error) {
	// Extract auth context
	orgIDStr, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("organization ID not found in context"))
	}
	orgID, err := dbuuid.Parse(orgIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization ID: %w", err))
	}

	employeeIDStr, ok := interceptor.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("employee ID not found in context"))
	}
	employeeID, err := dbuuid.Parse(employeeIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid employee ID: %w", err))
	}

	slog.DebugContext(ctx, "GetUserPreference RPC called",
		"organization_id", orgID,
		"employee_id", employeeID)

	var pref *database.IamUserPreference
	var exists bool

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		pref, exists, txErr = s.logic.GetUserPreference(ctx, tx, dbuuid.UUID(orgID), dbuuid.UUID(employeeID))
		return txErr
	})

	if err != nil {
		slog.ErrorContext(ctx, "failed to get user preference",
			"error", err,
			"organization_id", orgID,
			"employee_id", employeeID)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("get user preference: %w", err))
	}

	// If preference doesn't exist, return defaults
	if !exists {
		slog.DebugContext(ctx, "user preference not found, returning defaults")
		return connect.NewResponse(&rpcv1.GetUserPreferenceResponse{
			Preference: &rpcv1.UserPreference{
				Id:               "",
				EmployeeId:       employeeID.String(),
				ThemeMode:        rpcv1.ThemeMode_THEME_MODE_LIGHT,
				PreferenceSource: rpcv1.PreferenceSource_PREFERENCE_SOURCE_OS_DEFAULT,
				UpdatedAt:        timestamppb.Now(),
			},
			Exists: false,
		}), nil
	}

	// Convert database model to proto
	protoPreference := &rpcv1.UserPreference{
		Id:               pref.ID.String(),
		EmployeeId:       pref.EmployeeID.String(),
		ThemeMode:        convertThemeModeToProto(pref.ThemeMode),
		PreferenceSource: convertPreferenceSourceToProto(pref.PreferenceSource),
		UpdatedAt:        timestamppb.New(pref.UpdatedAt.Time),
	}

	return connect.NewResponse(&rpcv1.GetUserPreferenceResponse{
		Preference: protoPreference,
		Exists:     true,
	}), nil
}

// UpdateUserPreference updates the current user's preference settings
func (s *PreferenceServiceServer) UpdateUserPreference(
	ctx context.Context,
	req *connect.Request[rpcv1.UpdateUserPreferenceRequest],
) (*connect.Response[rpcv1.UpdateUserPreferenceResponse], error) {
	// Extract auth context
	orgIDStr, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("organization ID not found in context"))
	}
	orgID, err := dbuuid.Parse(orgIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization ID: %w", err))
	}

	employeeIDStr, ok := interceptor.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("employee ID not found in context"))
	}
	employeeID, err := dbuuid.Parse(employeeIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid employee ID: %w", err))
	}

	slog.DebugContext(ctx, "UpdateUserPreference RPC called",
		"organization_id", orgID,
		"employee_id", employeeID,
		"theme_mode", req.Msg.ThemeMode,
		"preference_source", req.Msg.PreferenceSource)

	// Validate request
	if req.Msg.ThemeMode == rpcv1.ThemeMode_THEME_MODE_UNSPECIFIED {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("theme_mode is required"))
	}
	if req.Msg.PreferenceSource == rpcv1.PreferenceSource_PREFERENCE_SOURCE_UNSPECIFIED {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("preference_source is required"))
	}

	// Convert proto enums to database constants
	themeMode := convertThemeModeFromProto(req.Msg.ThemeMode)
	preferenceSource := convertPreferenceSourceFromProto(req.Msg.PreferenceSource)

	var pref *database.IamUserPreference

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		pref, txErr = s.logic.UpsertUserPreference(ctx, tx, UpsertPreferenceParams{
			OrganizationID:        dbuuid.UUID(orgID),
			EmployeeID:            dbuuid.UUID(employeeID),
			ThemeMode:             themeMode,
			PreferenceSource:      preferenceSource,
			AdditionalPreferences: []byte("{}"), // Empty JSONB for now
		})
		return txErr
	})

	if err != nil {
		slog.ErrorContext(ctx, "failed to update user preference",
			"error", err,
			"organization_id", orgID,
			"employee_id", employeeID)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("update user preference: %w", err))
	}

	// Convert database model to proto
	protoPreference := &rpcv1.UserPreference{
		Id:               pref.ID.String(),
		EmployeeId:       pref.EmployeeID.String(),
		ThemeMode:        convertThemeModeToProto(pref.ThemeMode),
		PreferenceSource: convertPreferenceSourceToProto(pref.PreferenceSource),
		UpdatedAt:        timestamppb.New(pref.UpdatedAt.Time),
	}

	slog.InfoContext(ctx, "user preference updated successfully",
		"organization_id", orgID,
		"employee_id", employeeID)

	return connect.NewResponse(&rpcv1.UpdateUserPreferenceResponse{
		Preference: protoPreference,
	}), nil
}

// ResetUserPreference deletes the current user's preference record
func (s *PreferenceServiceServer) ResetUserPreference(
	ctx context.Context,
	req *connect.Request[rpcv1.ResetUserPreferenceRequest],
) (*connect.Response[rpcv1.ResetUserPreferenceResponse], error) {
	// Extract auth context
	orgIDStr, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("organization ID not found in context"))
	}
	orgID, err := dbuuid.Parse(orgIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid organization ID: %w", err))
	}

	employeeIDStr, ok := interceptor.UserIDFromContext(ctx)
	if !ok {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("employee ID not found in context"))
	}
	employeeID, err := dbuuid.Parse(employeeIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid employee ID: %w", err))
	}

	slog.DebugContext(ctx, "ResetUserPreference RPC called",
		"organization_id", orgID,
		"employee_id", employeeID)

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		return s.logic.DeleteUserPreference(ctx, tx, dbuuid.UUID(orgID), dbuuid.UUID(employeeID))
	})

	if err != nil {
		slog.ErrorContext(ctx, "failed to reset user preference",
			"error", err,
			"organization_id", orgID,
			"employee_id", employeeID)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("reset user preference: %w", err))
	}

	slog.InfoContext(ctx, "user preference reset successfully",
		"organization_id", orgID,
		"employee_id", employeeID)

	return connect.NewResponse(&rpcv1.ResetUserPreferenceResponse{
		Success: true,
	}), nil
}

// Helper functions to convert between proto enums and database constants

func convertThemeModeToProto(mode string) rpcv1.ThemeMode {
	switch mode {
	case ThemeModeLight:
		return rpcv1.ThemeMode_THEME_MODE_LIGHT
	case ThemeModeDark:
		return rpcv1.ThemeMode_THEME_MODE_DARK
	default:
		return rpcv1.ThemeMode_THEME_MODE_UNSPECIFIED
	}
}

func convertThemeModeFromProto(mode rpcv1.ThemeMode) string {
	switch mode {
	case rpcv1.ThemeMode_THEME_MODE_LIGHT:
		return ThemeModeLight
	case rpcv1.ThemeMode_THEME_MODE_DARK:
		return ThemeModeDark
	default:
		return ThemeModeLight // Default to light
	}
}

func convertPreferenceSourceToProto(source string) rpcv1.PreferenceSource {
	switch source {
	case PreferenceSourceManual:
		return rpcv1.PreferenceSource_PREFERENCE_SOURCE_MANUAL
	case PreferenceSourceOSDefault:
		return rpcv1.PreferenceSource_PREFERENCE_SOURCE_OS_DEFAULT
	default:
		return rpcv1.PreferenceSource_PREFERENCE_SOURCE_UNSPECIFIED
	}
}

func convertPreferenceSourceFromProto(source rpcv1.PreferenceSource) string {
	switch source {
	case rpcv1.PreferenceSource_PREFERENCE_SOURCE_MANUAL:
		return PreferenceSourceManual
	case rpcv1.PreferenceSource_PREFERENCE_SOURCE_OS_DEFAULT:
		return PreferenceSourceOSDefault
	default:
		return PreferenceSourceOSDefault // Default to OS default
	}
}
