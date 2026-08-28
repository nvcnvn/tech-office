package voice

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/database/txn"
	"github.com/nvcnvn/tech-office/backend/internal/interceptor"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

func extractVoiceAuthContext(ctx context.Context) (employeeID, organizationID dbuuid.UUID, err error) {
	userID, ok := interceptor.UserIDFromContext(ctx)
	if !ok || userID == "" {
		return dbuuid.UUID{}, dbuuid.UUID{}, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("user ID not found in context"))
	}
	orgID, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok || orgID == "" {
		return dbuuid.UUID{}, dbuuid.UUID{}, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("organization ID not found in context"))
	}
	employeeID, err = dbuuid.Parse(userID)
	if err != nil {
		return dbuuid.UUID{}, dbuuid.UUID{}, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("invalid user ID: %w", err))
	}
	organizationID, err = dbuuid.Parse(orgID)
	if err != nil {
		return dbuuid.UUID{}, dbuuid.UUID{}, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("invalid organization ID: %w", err))
	}
	return employeeID, organizationID, nil
}

func handleVoiceError(err error, metadata map[string]string) error {
	var connectErr *connect.Error
	if errors.As(err, &connectErr) {
		return connectErr
	}
	return ToConnectError(err, metadata)
}

func (s *ServiceConnect) StartVoiceCall(
	ctx context.Context,
	req *connect.Request[rpcv1.StartVoiceCallRequest],
) (*connect.Response[rpcv1.StartVoiceCallResponse], error) {
	employeeID, orgID, err := extractVoiceAuthContext(ctx)
	if err != nil {
		return nil, err
	}
	channelID, err := dbuuid.Parse(req.Msg.GetChannelId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid channel_id: %w", err))
	}

	var call *rpcv1.VoiceCallSession
	var credentials *rpcv1.VoiceJoinCredentials
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		call, credentials, logicErr = s.Logic.StartVoiceCall(ctx, tx, orgID, employeeID, channelID, req.Msg.GetRequestRecording())
		return logicErr
	}); err != nil {
		return nil, handleVoiceError(err, map[string]string{"channelId": req.Msg.GetChannelId()})
	}
	return connect.NewResponse(&rpcv1.StartVoiceCallResponse{Call: call, JoinCredentials: credentials}), nil
}

func (s *ServiceConnect) GetActiveVoiceCall(
	ctx context.Context,
	req *connect.Request[rpcv1.GetActiveVoiceCallRequest],
) (*connect.Response[rpcv1.GetActiveVoiceCallResponse], error) {
	employeeID, orgID, err := extractVoiceAuthContext(ctx)
	if err != nil {
		return nil, err
	}
	channelID, err := dbuuid.Parse(req.Msg.GetChannelId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid channel_id: %w", err))
	}

	var call *rpcv1.VoiceCallSession
	var hasActiveCall bool
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		call, hasActiveCall, logicErr = s.Logic.GetActiveVoiceCall(ctx, tx, orgID, employeeID, channelID)
		return logicErr
	}); err != nil {
		return nil, handleVoiceError(err, map[string]string{"channelId": req.Msg.GetChannelId()})
	}
	return connect.NewResponse(&rpcv1.GetActiveVoiceCallResponse{Call: call, HasActiveCall: hasActiveCall}), nil
}

func (s *ServiceConnect) JoinVoiceCall(
	ctx context.Context,
	req *connect.Request[rpcv1.JoinVoiceCallRequest],
) (*connect.Response[rpcv1.JoinVoiceCallResponse], error) {
	employeeID, orgID, err := extractVoiceAuthContext(ctx)
	if err != nil {
		return nil, err
	}
	callID, err := dbuuid.Parse(req.Msg.GetCallId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid call_id: %w", err))
	}

	var call *rpcv1.VoiceCallSession
	var credentials *rpcv1.VoiceJoinCredentials
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		call, credentials, logicErr = s.Logic.JoinVoiceCall(ctx, tx, orgID, employeeID, callID, req.Msg.GetDeviceIdentifier())
		return logicErr
	}); err != nil {
		return nil, handleVoiceError(err, map[string]string{"callId": req.Msg.GetCallId()})
	}
	return connect.NewResponse(&rpcv1.JoinVoiceCallResponse{Call: call, JoinCredentials: credentials}), nil
}

func (s *ServiceConnect) LeaveVoiceCall(
	ctx context.Context,
	req *connect.Request[rpcv1.LeaveVoiceCallRequest],
) (*connect.Response[rpcv1.LeaveVoiceCallResponse], error) {
	employeeID, orgID, err := extractVoiceAuthContext(ctx)
	if err != nil {
		return nil, err
	}
	callID, err := dbuuid.Parse(req.Msg.GetCallId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid call_id: %w", err))
	}

	var call *rpcv1.VoiceCallSession
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		call, logicErr = s.Logic.LeaveVoiceCall(ctx, tx, orgID, employeeID, callID, req.Msg.GetDeviceIdentifier())
		return logicErr
	}); err != nil {
		return nil, handleVoiceError(err, map[string]string{"callId": req.Msg.GetCallId()})
	}
	return connect.NewResponse(&rpcv1.LeaveVoiceCallResponse{Call: call}), nil
}

func (s *ServiceConnect) EndVoiceCall(
	ctx context.Context,
	req *connect.Request[rpcv1.EndVoiceCallRequest],
) (*connect.Response[rpcv1.EndVoiceCallResponse], error) {
	employeeID, orgID, err := extractVoiceAuthContext(ctx)
	if err != nil {
		return nil, err
	}
	callID, err := dbuuid.Parse(req.Msg.GetCallId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid call_id: %w", err))
	}

	var call *rpcv1.VoiceCallSession
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		call, logicErr = s.Logic.EndVoiceCall(ctx, tx, orgID, employeeID, callID, req.Msg.GetDeviceIdentifier())
		return logicErr
	}); err != nil {
		return nil, handleVoiceError(err, map[string]string{"callId": req.Msg.GetCallId()})
	}
	return connect.NewResponse(&rpcv1.EndVoiceCallResponse{Call: call}), nil
}

func (s *ServiceConnect) InviteToVoiceCall(
	ctx context.Context,
	req *connect.Request[rpcv1.InviteToVoiceCallRequest],
) (*connect.Response[rpcv1.InviteToVoiceCallResponse], error) {
	employeeID, orgID, err := extractVoiceAuthContext(ctx)
	if err != nil {
		return nil, err
	}
	callID, err := dbuuid.Parse(req.Msg.GetCallId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid call_id: %w", err))
	}
	inviteeIDs := make([]dbuuid.UUID, 0, len(req.Msg.GetEmployeeIds()))
	for _, employeeIDValue := range req.Msg.GetEmployeeIds() {
		inviteeID, err := dbuuid.Parse(employeeIDValue)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid employee_id: %w", err))
		}
		inviteeIDs = append(inviteeIDs, inviteeID)
	}
	if len(inviteeIDs) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("employee_ids is required"))
	}

	var call *rpcv1.VoiceCallSession
	var invitations []*rpcv1.VoiceCallInvitation
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		call, invitations, logicErr = s.Logic.InviteToVoiceCall(ctx, tx, orgID, employeeID, callID, inviteeIDs)
		return logicErr
	}); err != nil {
		return nil, handleVoiceError(err, map[string]string{"callId": req.Msg.GetCallId()})
	}
	return connect.NewResponse(&rpcv1.InviteToVoiceCallResponse{Call: call, Invitations: invitations}), nil
}

func (s *ServiceConnect) RespondToVoiceCallInvite(
	ctx context.Context,
	req *connect.Request[rpcv1.RespondToVoiceCallInviteRequest],
) (*connect.Response[rpcv1.RespondToVoiceCallInviteResponse], error) {
	employeeID, orgID, err := extractVoiceAuthContext(ctx)
	if err != nil {
		return nil, err
	}
	invitationID, err := dbuuid.Parse(req.Msg.GetInvitationId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid invitation_id: %w", err))
	}
	switch req.Msg.GetResponse() {
	case rpcv1.VoiceInviteResponse_VOICE_INVITE_RESPONSE_ACCEPT,
		rpcv1.VoiceInviteResponse_VOICE_INVITE_RESPONSE_DECLINE:
	case rpcv1.VoiceInviteResponse_VOICE_INVITE_RESPONSE_UNSPECIFIED:
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("response is required"))
	default:
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("unsupported response"))
	}

	var invitation *rpcv1.VoiceCallInvitation
	var credentials *rpcv1.VoiceJoinCredentials
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		invitation, credentials, logicErr = s.Logic.RespondToVoiceCallInvite(ctx, tx, orgID, employeeID, invitationID, req.Msg.GetResponse(), req.Msg.GetDeviceIdentifier())
		return logicErr
	}); err != nil {
		return nil, handleVoiceError(err, map[string]string{"invitationId": req.Msg.GetInvitationId()})
	}
	return connect.NewResponse(&rpcv1.RespondToVoiceCallInviteResponse{Invitation: invitation, JoinCredentials: credentials}), nil
}

func (s *ServiceConnect) ListCallRecords(
	ctx context.Context,
	req *connect.Request[rpcv1.ListCallRecordsRequest],
) (*connect.Response[rpcv1.ListCallRecordsResponse], error) {
	employeeID, orgID, err := extractVoiceAuthContext(ctx)
	if err != nil {
		return nil, err
	}
	channelID, err := dbuuid.Parse(req.Msg.GetChannelId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid channel_id: %w", err))
	}

	var records []*rpcv1.VoiceCallRecord
	var nextCursor string
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		records, nextCursor, logicErr = s.Logic.ListCallRecords(ctx, tx, orgID, employeeID, channelID, req.Msg.GetCursor(), req.Msg.GetLimit())
		return logicErr
	}); err != nil {
		return nil, handleVoiceError(err, map[string]string{"channelId": req.Msg.GetChannelId()})
	}
	return connect.NewResponse(&rpcv1.ListCallRecordsResponse{Records: records, NextCursor: nextCursor}), nil
}

func (s *ServiceConnect) GetCallRecord(
	ctx context.Context,
	req *connect.Request[rpcv1.GetCallRecordRequest],
) (*connect.Response[rpcv1.GetCallRecordResponse], error) {
	employeeID, orgID, err := extractVoiceAuthContext(ctx)
	if err != nil {
		return nil, err
	}
	callID, err := dbuuid.Parse(req.Msg.GetCallId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid call_id: %w", err))
	}

	var record *rpcv1.VoiceCallRecord
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		record, logicErr = s.Logic.GetCallRecord(ctx, tx, orgID, employeeID, callID)
		return logicErr
	}); err != nil {
		return nil, handleVoiceError(err, map[string]string{"callId": req.Msg.GetCallId()})
	}
	return connect.NewResponse(&rpcv1.GetCallRecordResponse{Record: record}), nil
}

func (s *ServiceConnect) RequestVoiceMessageUpload(
	ctx context.Context,
	req *connect.Request[rpcv1.RequestVoiceMessageUploadRequest],
) (*connect.Response[rpcv1.RequestVoiceMessageUploadResponse], error) {
	employeeID, orgID, err := extractVoiceAuthContext(ctx)
	if err != nil {
		return nil, err
	}
	channelID, err := dbuuid.Parse(req.Msg.GetChannelId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid channel_id: %w", err))
	}

	var upload *rpcv1.RequestVoiceMessageUploadResponse
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		upload, logicErr = s.Logic.RequestVoiceMessageUpload(ctx, tx, orgID, employeeID, channelID, req.Msg.GetClientDeduplicationKey(), req.Msg.GetFilename(), req.Msg.GetMimeType(), req.Msg.GetSizeBytes(), req.Msg.GetExpectedDurationMs())
		return logicErr
	}); err != nil {
		return nil, handleVoiceError(err, map[string]string{"channelId": req.Msg.GetChannelId(), "clientDeduplicationKey": req.Msg.GetClientDeduplicationKey()})
	}
	return connect.NewResponse(upload), nil
}

func (s *ServiceConnect) ConfirmVoiceMessageUpload(
	ctx context.Context,
	req *connect.Request[rpcv1.ConfirmVoiceMessageUploadRequest],
) (*connect.Response[rpcv1.ConfirmVoiceMessageUploadResponse], error) {
	employeeID, orgID, err := extractVoiceAuthContext(ctx)
	if err != nil {
		return nil, err
	}
	voiceMessageID, err := dbuuid.Parse(req.Msg.GetVoiceMessageId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid voice_message_id: %w", err))
	}
	fileID, err := dbuuid.Parse(req.Msg.GetFileId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid file_id: %w", err))
	}

	var voiceMessage *rpcv1.VoiceMessage
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		voiceMessage, logicErr = s.Logic.ConfirmVoiceMessageUpload(ctx, tx, orgID, employeeID, voiceMessageID, fileID, req.Msg.GetClientDeduplicationKey(), req.Msg.GetDurationMs(), req.Msg.GetWaveformPeaks())
		return logicErr
	}); err != nil {
		return nil, handleVoiceError(err, map[string]string{"voiceMessageId": req.Msg.GetVoiceMessageId(), "fileId": req.Msg.GetFileId()})
	}
	return connect.NewResponse(&rpcv1.ConfirmVoiceMessageUploadResponse{VoiceMessage: voiceMessage}), nil
}

func (s *ServiceConnect) CancelVoiceMessage(
	ctx context.Context,
	req *connect.Request[rpcv1.CancelVoiceMessageRequest],
) (*connect.Response[rpcv1.CancelVoiceMessageResponse], error) {
	employeeID, orgID, err := extractVoiceAuthContext(ctx)
	if err != nil {
		return nil, err
	}
	voiceMessageID, err := dbuuid.Parse(req.Msg.GetVoiceMessageId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid voice_message_id: %w", err))
	}

	var voiceMessage *rpcv1.VoiceMessage
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		voiceMessage, logicErr = s.Logic.CancelVoiceMessage(ctx, tx, orgID, employeeID, voiceMessageID)
		return logicErr
	}); err != nil {
		return nil, handleVoiceError(err, map[string]string{"voiceMessageId": req.Msg.GetVoiceMessageId()})
	}
	return connect.NewResponse(&rpcv1.CancelVoiceMessageResponse{VoiceMessage: voiceMessage}), nil
}
