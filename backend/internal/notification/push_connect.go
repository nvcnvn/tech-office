package notification

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"connectrpc.com/connect"
	googl "github.com/google/uuid"
	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/database/txn"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// RegisterPushToken implements the RPC handler for registering push notification tokens.
func (s *NotificationServiceConnect) RegisterPushToken(
	ctx context.Context,
	req *connect.Request[rpcv1.RegisterPushTokenRequest],
) (*connect.Response[rpcv1.RegisterPushTokenResponse], error) {
	slog.DebugContext(ctx, "RegisterPushToken RPC called",
		"function", "RegisterPushToken",
		"device_identifier", req.Msg.DeviceIdentifier,
		"token_type", req.Msg.TokenType.String(),
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Validate required fields
	if req.Msg.FcmToken == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("fcm_token is required"))
	}
	if req.Msg.DeviceIdentifier == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("device_identifier is required"))
	}
	tokenType := pushTokenTypeProtoToString(req.Msg.TokenType)
	if tokenType == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("token_type is required"))
	}

	// Build registration params
	params := &RegisterPushTokenParams{
		FCMToken:          req.Msg.FcmToken,
		DeviceIdentifier:  req.Msg.DeviceIdentifier,
		PermissionState:   permissionStateProtoToString(req.Msg.PermissionState),
		TokenType:         tokenType,
		NativeCallCapable: req.Msg.NativeCallCapable,
	}

	if req.Msg.Endpoint != "" {
		params.Endpoint = &req.Msg.Endpoint
	}
	if req.Msg.KeysJson != "" {
		params.Keys = &req.Msg.KeysJson
	}
	if req.Msg.UserAgent != "" {
		params.UserAgent = &req.Msg.UserAgent
	}
	if len(req.Msg.TokenMetadata) > 0 {
		// Convert map to JSON string
		metadataJSON := mapToJSON(req.Msg.TokenMetadata)
		params.TokenMetadata = &metadataJSON
	}

	// Register token with validation
	var token *database.NotificationPushToken
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		token, txErr = s.PushLogic.RegisterPushToken(ctx, tx, employeeID, organizationID, params)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to register push token",
			"function", "RegisterPushToken",
			"error", err,
		)
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Build response
	resp := &rpcv1.RegisterPushTokenResponse{
		TokenId: token.TokenID.String(),
		IsValid: token.IsValid,
	}
	if token.RegisteredAt.Valid {
		resp.RegisteredAt = timestamppb.New(token.RegisteredAt.Time)
	}

	slog.InfoContext(ctx, "push token registered successfully",
		"token_id", token.TokenID.String(),
		"is_valid", token.IsValid,
	)

	return connect.NewResponse(resp), nil
}

// RevokePushToken implements the RPC handler for revoking push tokens.
func (s *NotificationServiceConnect) RevokePushToken(
	ctx context.Context,
	req *connect.Request[rpcv1.RevokePushTokenRequest],
) (*connect.Response[rpcv1.RevokePushTokenResponse], error) {
	slog.DebugContext(ctx, "RevokePushToken RPC called",
		"function", "RevokePushToken",
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Parse revoke target (token_id or device_identifier)
	var tokenID dbuuid.NullUUID
	var deviceID *string

	switch target := req.Msg.Target.(type) {
	case *rpcv1.RevokePushTokenRequest_TokenId:
		parsed, err := dbuuid.Parse(target.TokenId)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid token_id: %w", err))
		}
		tokenID = dbuuid.NullUUID{UUID: googl.UUID(parsed), Valid: true}
	case *rpcv1.RevokePushTokenRequest_DeviceIdentifier:
		deviceID = &target.DeviceIdentifier
	default:
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("either token_id or device_identifier must be provided"))
	}

	// Revoke token(s)
	var revokedCount int64
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		revokedCount, txErr = s.PushLogic.RevokePushToken(ctx, tx, employeeID, organizationID, tokenID, deviceID)
		return txErr
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	slog.InfoContext(ctx, "push tokens revoked",
		"revoked_count", revokedCount,
	)

	return connect.NewResponse(&rpcv1.RevokePushTokenResponse{
		RevokedCount: int32(revokedCount),
	}), nil
}

// ListPushTokens implements the RPC handler for listing employee's push tokens.
func (s *NotificationServiceConnect) ListPushTokens(
	ctx context.Context,
	req *connect.Request[rpcv1.ListPushTokensRequest],
) (*connect.Response[rpcv1.ListPushTokensResponse], error) {
	slog.DebugContext(ctx, "ListPushTokens RPC called",
		"function", "ListPushTokens",
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Fetch tokens
	var tokens []*database.GetEmployeePushTokensRow
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		tokens, txErr = s.PushLogic.GetEmployeePushTokens(ctx, tx, employeeID, organizationID)
		return txErr
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Build response
	protoTokens := make([]*rpcv1.PushTokenInfo, 0, len(tokens))
	for _, t := range tokens {
		info := &rpcv1.PushTokenInfo{
			TokenId:           t.TokenID.String(),
			DeviceIdentifier:  t.DeviceIdentifier,
			PermissionState:   permissionStateStringToProto(t.PermissionState),
			IsValid:           t.IsValid,
			TokenType:         pushTokenTypeStringToProto(t.TokenType),
			NativeCallCapable: nativeCallCapableFromMetadata(t.TokenMetadata),
		}

		if t.RegisteredAt.Valid {
			info.RegisteredAt = timestamppb.New(t.RegisteredAt.Time)
		}
		if t.LastUsedAt.Valid {
			info.LastUsedAt = timestamppb.New(t.LastUsedAt.Time)
		}
		if t.UserAgent != "" {
			info.UserAgent = t.UserAgent
		}
		if len(t.TokenMetadata) > 0 {
			info.TokenMetadata = jsonToMap(string(t.TokenMetadata))
		}

		protoTokens = append(protoTokens, info)
	}

	return connect.NewResponse(&rpcv1.ListPushTokensResponse{
		Tokens: protoTokens,
	}), nil
}

// Helper functions for proto conversion

func permissionStateProtoToString(state rpcv1.PermissionState) string {
	switch state {
	case rpcv1.PermissionState_PERMISSION_STATE_GRANTED:
		return "granted"
	case rpcv1.PermissionState_PERMISSION_STATE_DENIED:
		return "denied"
	case rpcv1.PermissionState_PERMISSION_STATE_PROMPT:
		return "prompt"
	default:
		return "prompt"
	}
}

func permissionStateStringToProto(state string) rpcv1.PermissionState {
	switch state {
	case "granted":
		return rpcv1.PermissionState_PERMISSION_STATE_GRANTED
	case "denied":
		return rpcv1.PermissionState_PERMISSION_STATE_DENIED
	case "prompt":
		return rpcv1.PermissionState_PERMISSION_STATE_PROMPT
	default:
		return rpcv1.PermissionState_PERMISSION_STATE_UNSPECIFIED
	}
}

// Helper functions for JSON conversion

func mapToJSON(m map[string]string) string {
	if len(m) == 0 {
		return "{}"
	}
	encoded, err := json.Marshal(m)
	if err != nil {
		slog.Warn("failed to encode push token metadata", "error", err)
		return "{}"
	}
	return string(encoded)
}

func jsonToMap(s string) map[string]string {
	if s == "" {
		return make(map[string]string)
	}

	var out map[string]string
	if err := json.Unmarshal([]byte(s), &out); err != nil {
		slog.Warn("failed to decode push token metadata", "error", err)
		return make(map[string]string)
	}
	if out == nil {
		return make(map[string]string)
	}
	return out
}

// pushTokenTypeProtoToString converts the proto enum to the database-ready value.
// PUSH_TOKEN_TYPE_UNSPECIFIED maps to the empty string, which the caller rejects:
// the field is required precisely so a transport is never guessed.
func pushTokenTypeProtoToString(tokenType rpcv1.PushTokenType) string {
	switch tokenType {
	case rpcv1.PushTokenType_PUSH_TOKEN_TYPE_FCM:
		return PushTokenTypeFCM
	case rpcv1.PushTokenType_PUSH_TOKEN_TYPE_APNS_VOIP:
		return PushTokenTypeAPNSVoIP
	case rpcv1.PushTokenType_PUSH_TOKEN_TYPE_WEB_PUSH:
		return PushTokenTypeWebPush
	default:
		return ""
	}
}

// pushTokenTypeStringToProto converts the database value back to the proto enum.
func pushTokenTypeStringToProto(tokenType string) rpcv1.PushTokenType {
	switch tokenType {
	case PushTokenTypeFCM:
		return rpcv1.PushTokenType_PUSH_TOKEN_TYPE_FCM
	case PushTokenTypeAPNSVoIP:
		return rpcv1.PushTokenType_PUSH_TOKEN_TYPE_APNS_VOIP
	case PushTokenTypeWebPush:
		return rpcv1.PushTokenType_PUSH_TOKEN_TYPE_WEB_PUSH
	default:
		return rpcv1.PushTokenType_PUSH_TOKEN_TYPE_UNSPECIFIED
	}
}
