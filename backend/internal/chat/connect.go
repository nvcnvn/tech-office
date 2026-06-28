package chat

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"connectrpc.com/connect"
	"github.com/nvcnvn/flows"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/database/txn"
	"github.com/nvcnvn/tech-office/backend/internal/converter"
	"github.com/nvcnvn/tech-office/backend/internal/files"
	"github.com/nvcnvn/tech-office/backend/internal/interceptor"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/nvcnvn/tech-office/backend/rpc/v1/rpcv1connect"
)

// ChatServiceConnect is the RPC handler layer for chat operations.
// It owns TenantPool, manages transactions, extracts auth context,
// and delegates to the logic layer. All chat operations are user-scope.
type ChatServiceConnect struct {
	rpcv1connect.UnimplementedChatServiceHandler
	rpcv1connect.UnimplementedChatFileServiceHandler

	// Logic layer for business operations
	Logic ChatLogic

	// FileLogic layer for file upload operations (Feature 015)
	// Uses files.FileLogic interface with tx database.DBTX parameters
	FileLogic files.FileLogic

	// R2Client for presigned URL generation (Feature 015)
	R2Client *files.R2Client

	// Queries for database operations (Feature 015 file uploads need direct query access)
	Queries *database.Queries

	// TenantPool: Used for all chat operations (user-scope only)
	TenantPool database.TenantDatabaseConnector

	// Flows client for async workflow orchestration (Feature 015)
	FlowsClient flows.Client

	// Post-processing workflow for PDF conversion and content indexing (Feature 015)
	PostProcess flows.Workflow[files.FilePostProcessingWorkflowInput, files.FilePostProcessingWorkflowOutput]

	// In-memory typing indicators (ephemeral, no DB persistence)
	typingIndicators sync.Map // key: channelID+employeeID, value: expiryTime
}

// NewChatServiceConnect creates a new chat service connect layer
func NewChatServiceConnect(
	logic ChatLogic,
	tenantPool database.TenantDatabaseConnector,
	fileLogic files.FileLogic,
	r2Client *files.R2Client,
	queries *database.Queries,
	flowsClient flows.Client,
	postProcess flows.Workflow[files.FilePostProcessingWorkflowInput, files.FilePostProcessingWorkflowOutput],
) *ChatServiceConnect {
	svc := &ChatServiceConnect{
		Logic:       logic,
		TenantPool:  tenantPool,
		FileLogic:   fileLogic,
		R2Client:    r2Client,
		Queries:     queries,
		FlowsClient: flowsClient,
		PostProcess: postProcess,
	}

	// Start background cleanup for typing indicators
	go svc.cleanupExpiredTypingIndicators()

	return svc
}

// extractAuthContext extracts employee ID and organization ID from request context
func (s *ChatServiceConnect) extractAuthContext(ctx context.Context) (employeeID, organizationID dbuuid.UUID, err error) {
	userID, ok := interceptor.UserIDFromContext(ctx)
	if !ok || userID == "" {
		return dbuuid.UUID{}, dbuuid.UUID{}, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("user ID not found in context"))
	}

	orgIDStr, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok || orgIDStr == "" {
		return dbuuid.UUID{}, dbuuid.UUID{}, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("organization ID not found in context"))
	}

	employeeID = dbuuid.MustParse(userID)
	organizationID = dbuuid.MustParse(orgIDStr)
	return employeeID, organizationID, nil
}

// ============================================================================
// Channel Management RPC Handlers
// ============================================================================

func (s *ChatServiceConnect) CreateChannel(
	ctx context.Context,
	req *connect.Request[rpcv1.CreateChannelRequest],
) (*connect.Response[rpcv1.CreateChannelResponse], error) {
	slog.DebugContext(ctx, "CreateChannel RPC called",
		"function", "CreateChannel",
		"slug", req.Msg.TitleSlug,
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Create channel in transaction
	var channel *rpcv1.Channel
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		channel, txErr = s.Logic.CreateChannel(ctx, tx, organizationID, employeeID, req.Msg)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create channel",
			"error", err,
			"slug", req.Msg.TitleSlug,
		)
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&rpcv1.CreateChannelResponse{
		Channel: channel,
	}), nil
}

func (s *ChatServiceConnect) GetChannel(
	ctx context.Context,
	req *connect.Request[rpcv1.GetChannelRequest],
) (*connect.Response[rpcv1.GetChannelResponse], error) {
	slog.DebugContext(ctx, "GetChannel RPC called",
		"function", "GetChannel",
		"channelID", req.Msg.ChannelId,
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Parse channel ID
	channelID := dbuuid.MustParse(req.Msg.ChannelId)

	// Read-only: pass pool directly
	channel, linkedResource, err := s.Logic.GetChannel(ctx, s.TenantPool, organizationID, employeeID, channelID)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}

	return connect.NewResponse(&rpcv1.GetChannelResponse{
		Channel:        channel,
		LinkedResource: linkedResource,
	}), nil
}

func (s *ChatServiceConnect) ListChannels(
	ctx context.Context,
	req *connect.Request[rpcv1.ListChannelsRequest],
) (*connect.Response[rpcv1.ListChannelsResponse], error) {
	slog.DebugContext(ctx, "ListChannels RPC called",
		"function", "ListChannels",
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Read-only: pass pool directly
	channels, nextPageToken, err := s.Logic.ListChannels(ctx, s.TenantPool, organizationID, employeeID, req.Msg)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&rpcv1.ListChannelsResponse{
		Channels:      channels,
		NextPageToken: nextPageToken,
	}), nil
}

func (s *ChatServiceConnect) UpdateChannel(
	ctx context.Context,
	req *connect.Request[rpcv1.UpdateChannelRequest],
) (*connect.Response[rpcv1.UpdateChannelResponse], error) {
	slog.DebugContext(ctx, "UpdateChannel RPC called",
		"function", "UpdateChannel",
		"channelID", req.Msg.ChannelId,
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Update channel in transaction
	var channel *rpcv1.Channel
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		channel, txErr = s.Logic.UpdateChannel(ctx, tx, organizationID, employeeID, req.Msg)
		return txErr
	})
	if err != nil {
		return nil, connect.NewError(connect.CodePermissionDenied, err)
	}

	return connect.NewResponse(&rpcv1.UpdateChannelResponse{
		Channel: channel,
	}), nil
}

func (s *ChatServiceConnect) ArchiveChannel(
	ctx context.Context,
	req *connect.Request[rpcv1.ArchiveChannelRequest],
) (*connect.Response[rpcv1.ArchiveChannelResponse], error) {
	slog.DebugContext(ctx, "ArchiveChannel RPC called",
		"function", "ArchiveChannel",
		"channelID", req.Msg.ChannelId,
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Parse channel ID
	channelID := dbuuid.MustParse(req.Msg.ChannelId)

	// Archive channel in transaction
	var channel *rpcv1.Channel
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		channel, txErr = s.Logic.ArchiveChannel(ctx, tx, organizationID, employeeID, channelID)
		return txErr
	})
	if err != nil {
		return nil, connect.NewError(connect.CodePermissionDenied, err)
	}

	return connect.NewResponse(&rpcv1.ArchiveChannelResponse{
		Channel: channel,
	}), nil
}

func (s *ChatServiceConnect) UnarchiveChannel(
	ctx context.Context,
	req *connect.Request[rpcv1.UnarchiveChannelRequest],
) (*connect.Response[rpcv1.UnarchiveChannelResponse], error) {
	slog.DebugContext(ctx, "UnarchiveChannel RPC called",
		"function", "UnarchiveChannel",
		"channelID", req.Msg.ChannelId,
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Parse channel ID
	channelID := dbuuid.MustParse(req.Msg.ChannelId)

	// Unarchive channel in transaction
	var channel *rpcv1.Channel
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		channel, txErr = s.Logic.UnarchiveChannel(ctx, tx, organizationID, employeeID, channelID)
		return txErr
	})
	if err != nil {
		return nil, connect.NewError(connect.CodePermissionDenied, err)
	}

	return connect.NewResponse(&rpcv1.UnarchiveChannelResponse{
		Channel: channel,
	}), nil
}

// ============================================================================
// Channel Membership RPC Handlers
// ============================================================================

func (s *ChatServiceConnect) JoinChannel(
	ctx context.Context,
	req *connect.Request[rpcv1.JoinChannelRequest],
) (*connect.Response[rpcv1.JoinChannelResponse], error) {
	slog.DebugContext(ctx, "JoinChannel RPC called",
		"function", "JoinChannel",
		"channelID", req.Msg.ChannelId,
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Parse channel ID
	channelID := dbuuid.MustParse(req.Msg.ChannelId)

	// Join channel in transaction
	var membership *rpcv1.ChannelMembership
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		membership, txErr = s.Logic.JoinChannel(ctx, tx, organizationID, employeeID, channelID)
		return txErr
	})
	if err != nil {
		return nil, connect.NewError(connect.CodePermissionDenied, err)
	}

	return connect.NewResponse(&rpcv1.JoinChannelResponse{
		Membership: membership,
	}), nil
}

func (s *ChatServiceConnect) LeaveChannel(
	ctx context.Context,
	req *connect.Request[rpcv1.LeaveChannelRequest],
) (*connect.Response[rpcv1.LeaveChannelResponse], error) {
	slog.DebugContext(ctx, "LeaveChannel RPC called",
		"function", "LeaveChannel",
		"channelID", req.Msg.ChannelId,
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Parse channel ID
	channelID := dbuuid.MustParse(req.Msg.ChannelId)

	// Leave channel in transaction
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		return s.Logic.LeaveChannel(ctx, tx, organizationID, employeeID, channelID)
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeFailedPrecondition, err)
	}

	return connect.NewResponse(&rpcv1.LeaveChannelResponse{}), nil
}

func (s *ChatServiceConnect) InviteMember(
	ctx context.Context,
	req *connect.Request[rpcv1.InviteMemberRequest],
) (*connect.Response[rpcv1.InviteMemberResponse], error) {
	slog.DebugContext(ctx, "InviteMember RPC called",
		"function", "InviteMember",
		"channelID", req.Msg.ChannelId,
		"employeeID", req.Msg.EmployeeId,
	)

	// Extract auth context
	inviterID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Invite member in transaction
	var membership *rpcv1.ChannelMembership
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		membership, txErr = s.Logic.InviteMember(ctx, tx, organizationID, inviterID, req.Msg)
		return txErr
	})
	if err != nil {
		return nil, connect.NewError(connect.CodePermissionDenied, err)
	}

	return connect.NewResponse(&rpcv1.InviteMemberResponse{
		Membership: membership,
	}), nil
}

func (s *ChatServiceConnect) RemoveMember(
	ctx context.Context,
	req *connect.Request[rpcv1.RemoveMemberRequest],
) (*connect.Response[rpcv1.RemoveMemberResponse], error) {
	slog.DebugContext(ctx, "RemoveMember RPC called",
		"function", "RemoveMember",
		"channelID", req.Msg.ChannelId,
		"employeeID", req.Msg.EmployeeId,
	)

	// Extract auth context
	removerID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Remove member in transaction
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		return s.Logic.RemoveMember(ctx, tx, organizationID, removerID, req.Msg)
	})
	if err != nil {
		return nil, connect.NewError(connect.CodePermissionDenied, err)
	}

	return connect.NewResponse(&rpcv1.RemoveMemberResponse{}), nil
}

func (s *ChatServiceConnect) ListChannelMembers(
	ctx context.Context,
	req *connect.Request[rpcv1.ListChannelMembersRequest],
) (*connect.Response[rpcv1.ListChannelMembersResponse], error) {
	slog.DebugContext(ctx, "ListChannelMembers RPC called",
		"function", "ListChannelMembers",
		"channelID", req.Msg.ChannelId,
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Read-only: pass pool directly
	members, nextPageToken, err := s.Logic.ListChannelMembers(ctx, s.TenantPool, organizationID, employeeID, req.Msg)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&rpcv1.ListChannelMembersResponse{
		Memberships:   members,
		NextPageToken: nextPageToken,
	}), nil
}

func (s *ChatServiceConnect) UpdateMemberRole(
	ctx context.Context,
	req *connect.Request[rpcv1.UpdateMemberRoleRequest],
) (*connect.Response[rpcv1.UpdateMemberRoleResponse], error) {
	slog.DebugContext(ctx, "UpdateMemberRole RPC called",
		"function", "UpdateMemberRole",
		"channelID", req.Msg.ChannelId,
		"employeeID", req.Msg.EmployeeId,
	)

	// Extract auth context
	updaterID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Update member role in transaction
	var membership *rpcv1.ChannelMembership
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		membership, txErr = s.Logic.UpdateMemberRole(ctx, tx, organizationID, updaterID, req.Msg)
		return txErr
	})
	if err != nil {
		return nil, connect.NewError(connect.CodePermissionDenied, err)
	}

	return connect.NewResponse(&rpcv1.UpdateMemberRoleResponse{
		Membership: membership,
	}), nil
}

func (s *ChatServiceConnect) UpdateNotificationPreference(
	ctx context.Context,
	req *connect.Request[rpcv1.UpdateNotificationPreferenceRequest],
) (*connect.Response[rpcv1.UpdateNotificationPreferenceResponse], error) {
	slog.DebugContext(ctx, "UpdateNotificationPreference RPC called",
		"function", "UpdateNotificationPreference",
		"channelID", req.Msg.ChannelId,
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Update notification preference in transaction
	var membership *rpcv1.ChannelMembership
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		membership, txErr = s.Logic.UpdateNotificationPreference(ctx, tx, organizationID, employeeID, req.Msg)
		return txErr
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&rpcv1.UpdateNotificationPreferenceResponse{
		Membership: membership,
	}), nil
}

// ============================================================================
// Messaging RPC Handlers
// ============================================================================

func (s *ChatServiceConnect) SendMessage(
	ctx context.Context,
	req *connect.Request[rpcv1.SendMessageRequest],
) (*connect.Response[rpcv1.SendMessageResponse], error) {
	slog.DebugContext(ctx, "SendMessage RPC called",
		"function", "SendMessage",
		"channelID", req.Msg.ChannelId,
	)

	// Extract auth context
	authorID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Send message in transaction (atomically with notifications)
	var message *rpcv1.Message
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		message, txErr = s.Logic.SendMessage(ctx, tx, organizationID, authorID, req.Msg)
		return txErr
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	return connect.NewResponse(&rpcv1.SendMessageResponse{
		Message: message,
	}), nil
}

func (s *ChatServiceConnect) ReplyToMessage(
	ctx context.Context,
	req *connect.Request[rpcv1.ReplyToMessageRequest],
) (*connect.Response[rpcv1.ReplyToMessageResponse], error) {
	slog.DebugContext(ctx, "ReplyToMessage RPC called",
		"function", "ReplyToMessage",
		"parentMessageID", req.Msg.ParentMessageId,
	)

	// Extract auth context
	authorID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Reply to message in transaction
	var message *rpcv1.Message
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		message, txErr = s.Logic.ReplyToMessage(ctx, tx, organizationID, authorID, req.Msg)
		return txErr
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	return connect.NewResponse(&rpcv1.ReplyToMessageResponse{
		Message: message,
	}), nil
}

func (s *ChatServiceConnect) EditMessage(
	ctx context.Context,
	req *connect.Request[rpcv1.EditMessageRequest],
) (*connect.Response[rpcv1.EditMessageResponse], error) {
	slog.DebugContext(ctx, "EditMessage RPC called",
		"function", "EditMessage",
		"messageID", req.Msg.MessageId,
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Edit message in transaction
	var message *rpcv1.Message
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		message, txErr = s.Logic.EditMessage(ctx, tx, organizationID, employeeID, req.Msg)
		return txErr
	})
	if err != nil {
		return nil, connect.NewError(connect.CodePermissionDenied, err)
	}

	return connect.NewResponse(&rpcv1.EditMessageResponse{
		Message: message,
	}), nil
}

func (s *ChatServiceConnect) DeleteMessage(
	ctx context.Context,
	req *connect.Request[rpcv1.DeleteMessageRequest],
) (*connect.Response[rpcv1.DeleteMessageResponse], error) {
	slog.DebugContext(ctx, "DeleteMessage RPC called",
		"function", "DeleteMessage",
		"messageID", req.Msg.MessageId,
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Parse message ID
	messageID := dbuuid.MustParse(req.Msg.MessageId)

	// Delete message in transaction
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		return s.Logic.DeleteMessage(ctx, tx, organizationID, employeeID, messageID)
	})
	if err != nil {
		return nil, connect.NewError(connect.CodePermissionDenied, err)
	}

	return connect.NewResponse(&rpcv1.DeleteMessageResponse{}), nil
}

func (s *ChatServiceConnect) ListMessages(
	ctx context.Context,
	req *connect.Request[rpcv1.ListMessagesRequest],
) (*connect.Response[rpcv1.ListMessagesResponse], error) {
	slog.DebugContext(ctx, "ListMessages RPC called",
		"function", "ListMessages",
		"channelID", req.Msg.ChannelId,
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Read-only: pass pool directly
	messages, previousPageToken, nextPageToken, err := s.Logic.ListMessages(ctx, s.TenantPool, organizationID, employeeID, req.Msg)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&rpcv1.ListMessagesResponse{
		Messages:          messages,
		PreviousPageToken: previousPageToken,
		NextPageToken:     nextPageToken,
	}), nil
}

func (s *ChatServiceConnect) GetMessage(
	ctx context.Context,
	req *connect.Request[rpcv1.GetMessageRequest],
) (*connect.Response[rpcv1.GetMessageResponse], error) {
	slog.DebugContext(ctx, "GetMessage RPC called",
		"function", "GetMessage",
		"messageID", req.Msg.MessageId,
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Parse message ID
	messageID := dbuuid.MustParse(req.Msg.MessageId)

	// Read-only: pass pool directly
	message, err := s.Logic.GetMessage(ctx, s.TenantPool, organizationID, employeeID, messageID)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}

	return connect.NewResponse(&rpcv1.GetMessageResponse{
		Message: message,
	}), nil
}

func (s *ChatServiceConnect) ListReplies(
	ctx context.Context,
	req *connect.Request[rpcv1.ListRepliesRequest],
) (*connect.Response[rpcv1.ListRepliesResponse], error) {
	slog.DebugContext(ctx, "ListReplies RPC called",
		"function", "ListReplies",
		"parentMessageID", req.Msg.ParentMessageId,
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Read-only: pass pool directly
	replies, nextPageToken, err := s.Logic.ListReplies(ctx, s.TenantPool, organizationID, employeeID, req.Msg)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&rpcv1.ListRepliesResponse{
		Replies:       replies,
		NextPageToken: nextPageToken,
	}), nil
}

// ============================================================================
// Message Navigation & Unread Tracking RPC Handlers
// ============================================================================

func (s *ChatServiceConnect) GetMessageById(
	ctx context.Context,
	req *connect.Request[rpcv1.GetMessageByIdRequest],
) (*connect.Response[rpcv1.GetMessageByIdResponse], error) {
	slog.DebugContext(ctx, "GetMessageById RPC called",
		"function", "GetMessageById",
		"messageID", req.Msg.MessageId,
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	messageID := dbuuid.MustParse(req.Msg.MessageId)

	// Read-only: pass pool directly
	response, err := s.Logic.GetMessageById(ctx, s.TenantPool, organizationID, employeeID, messageID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(response), nil
}

func (s *ChatServiceConnect) MarkChannelAsRead(
	ctx context.Context,
	req *connect.Request[rpcv1.MarkChannelAsReadRequest],
) (*connect.Response[rpcv1.MarkChannelAsReadResponse], error) {
	slog.DebugContext(ctx, "MarkChannelAsRead RPC called",
		"function", "MarkChannelAsRead",
		"channelID", req.Msg.ChannelId,
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	channelID := dbuuid.MustParse(req.Msg.ChannelId)

	// Parse optional last read message ID
	var lastReadMessageID *dbuuid.UUID
	if req.Msg.LastReadMessageId != "" {
		msgID := dbuuid.MustParse(req.Msg.LastReadMessageId)
		lastReadMessageID = &msgID
	}

	// Write operation: use transaction
	var response *rpcv1.MarkChannelAsReadResponse
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		response, txErr = s.Logic.MarkChannelAsRead(ctx, tx, organizationID, employeeID, channelID, lastReadMessageID)
		return txErr
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(response), nil
}

// ============================================================================
// Reactions RPC Handlers
// ============================================================================

func (s *ChatServiceConnect) AddReaction(
	ctx context.Context,
	req *connect.Request[rpcv1.AddReactionRequest],
) (*connect.Response[rpcv1.AddReactionResponse], error) {
	slog.DebugContext(ctx, "AddReaction RPC called",
		"function", "AddReaction",
		"messageID", req.Msg.MessageId,
		"emojiCode", req.Msg.EmojiCode,
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Add reaction in transaction
	var reaction *rpcv1.Reaction
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		reaction, txErr = s.Logic.AddReaction(ctx, tx, organizationID, employeeID, req.Msg)
		return txErr
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	return connect.NewResponse(&rpcv1.AddReactionResponse{
		Reaction: reaction,
	}), nil
}

func (s *ChatServiceConnect) RemoveReaction(
	ctx context.Context,
	req *connect.Request[rpcv1.RemoveReactionRequest],
) (*connect.Response[rpcv1.RemoveReactionResponse], error) {
	slog.DebugContext(ctx, "RemoveReaction RPC called",
		"function", "RemoveReaction",
		"messageID", req.Msg.MessageId,
		"emojiCode", req.Msg.EmojiCode,
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Remove reaction in transaction
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		return s.Logic.RemoveReaction(ctx, tx, organizationID, employeeID, req.Msg)
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}

	return connect.NewResponse(&rpcv1.RemoveReactionResponse{}), nil
}

func (s *ChatServiceConnect) ListReactions(
	ctx context.Context,
	req *connect.Request[rpcv1.ListReactionsRequest],
) (*connect.Response[rpcv1.ListReactionsResponse], error) {
	slog.DebugContext(ctx, "ListReactions RPC called",
		"function", "ListReactions",
		"messageID", req.Msg.MessageId,
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Parse message ID
	messageID := dbuuid.MustParse(req.Msg.MessageId)

	// Read-only: pass pool directly
	reactionGroups, err := s.Logic.ListReactions(ctx, s.TenantPool, organizationID, employeeID, messageID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&rpcv1.ListReactionsResponse{
		Reactions: reactionGroups,
	}), nil
}

// ============================================================================
// Typing Indicators (Ephemeral, In-Memory)
// ============================================================================

func (s *ChatServiceConnect) StartTyping(
	ctx context.Context,
	req *connect.Request[rpcv1.StartTypingRequest],
) (*connect.Response[rpcv1.StartTypingResponse], error) {
	slog.DebugContext(ctx, "StartTyping RPC called",
		"function", "StartTyping",
		"channelID", req.Msg.ChannelId,
	)

	// Extract auth context
	employeeID, _, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Store typing indicator with TTL (3 seconds)
	key := fmt.Sprintf("%s:%s", req.Msg.ChannelId, employeeID.String())
	s.typingIndicators.Store(key, time.Now().Add(3*time.Second))

	// TODO: Optionally broadcast via notification hub for real-time updates
	// This would require integrating with notification.NotificationHub

	return connect.NewResponse(&rpcv1.StartTypingResponse{}), nil
}

func (s *ChatServiceConnect) StopTyping(
	ctx context.Context,
	req *connect.Request[rpcv1.StopTypingRequest],
) (*connect.Response[rpcv1.StopTypingResponse], error) {
	slog.DebugContext(ctx, "StopTyping RPC called",
		"function", "StopTyping",
		"channelID", req.Msg.ChannelId,
	)

	// Extract auth context
	employeeID, _, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Remove typing indicator
	key := fmt.Sprintf("%s:%s", req.Msg.ChannelId, employeeID.String())
	s.typingIndicators.Delete(key)

	return connect.NewResponse(&rpcv1.StopTypingResponse{}), nil
}

// cleanupExpiredTypingIndicators runs in background to remove expired typing indicators
func (s *ChatServiceConnect) cleanupExpiredTypingIndicators() {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		now := time.Now()
		s.typingIndicators.Range(func(key, value interface{}) bool {
			if expiryTime, ok := value.(time.Time); ok {
				if now.After(expiryTime) {
					s.typingIndicators.Delete(key)
				}
			}
			return true
		})
	}
}

// SearchChannels performs fuzzy search on channel names and descriptions with permission filtering.
func (s *ChatServiceConnect) SearchChannels(
	ctx context.Context,
	req *connect.Request[rpcv1.SearchChannelsRequest],
) (*connect.Response[rpcv1.SearchChannelsResponse], error) {
	slog.DebugContext(ctx, "SearchChannels RPC called",
		"function", "SearchChannels",
		"query_text", req.Msg.QueryText,
		"limit", req.Msg.Limit,
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Convert cursor
	var cursor *dbuuid.UUID
	if req.Msg.Cursor != "" {
		c, err := dbuuid.Parse(req.Msg.Cursor)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid cursor: %w", err))
		}
		cursor = &c
	}

	// Call logic layer
	results, err := s.Logic.SearchChannels(
		ctx,
		s.TenantPool,
		organizationID,
		employeeID,
		req.Msg.QueryText,
		req.Msg.Limit,
		cursor,
	)
	if err != nil {
		slog.ErrorContext(ctx, "channel search failed",
			"function", "SearchChannels",
			"error", err,
		)
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Convert results to proto
	protoResults := make([]*rpcv1.ChannelSearchResult, len(results))
	for i, r := range results {
		// Convert ChannelType string to enum
		channelType := rpcv1.ChannelType_CHANNEL_TYPE_UNSPECIFIED
		switch r.ChannelType {
		case ChannelTypeChat:
			channelType = rpcv1.ChannelType_CHANNEL_TYPE_CHAT
		case ChannelTypeDirectMessage:
			channelType = rpcv1.ChannelType_CHANNEL_TYPE_DIRECT_MESSAGE
		case ChannelTypeProjectTicketThread:
			channelType = rpcv1.ChannelType_CHANNEL_TYPE_PROJECT_TICKET_THREAD
		case ChannelTypeCRMDealNotes:
			channelType = rpcv1.ChannelType_CHANNEL_TYPE_CRM_DEAL_NOTES
		case ChannelTypeSupportTicket:
			channelType = rpcv1.ChannelType_CHANNEL_TYPE_SUPPORT_TICKET
		}

		protoResults[i] = &rpcv1.ChannelSearchResult{
			Id:             r.ID.String(),
			DisplayName:    r.DisplayName,
			Description:    r.Description.String,
			ChannelType:    channelType,
			TitleSlug:      r.TitleSlug,
			IsPrivate:      r.IsPrivate,
			RelevanceScore: r.RelevanceScore,
			UpdatedAt:      converter.TimeToProto(r.UpdatedAt),
		}
	}

	resp := &rpcv1.SearchChannelsResponse{
		Results: protoResults,
	}

	slog.DebugContext(ctx, "channel search completed",
		"function", "SearchChannels",
		"result_count", len(protoResults),
	)

	return connect.NewResponse(resp), nil
}

// SearchMessages performs fuzzy search on message content with permission filtering.
func (s *ChatServiceConnect) SearchMessages(
	ctx context.Context,
	req *connect.Request[rpcv1.SearchMessagesRequest],
) (*connect.Response[rpcv1.SearchMessagesResponse], error) {
	slog.DebugContext(ctx, "SearchMessages RPC called",
		"function", "SearchMessages",
		"query_text", req.Msg.QueryText,
		"limit", req.Msg.Limit,
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Convert cursor
	var cursor *dbuuid.UUID
	if req.Msg.Cursor != "" {
		c, err := dbuuid.Parse(req.Msg.Cursor)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid cursor: %w", err))
		}
		cursor = &c
	}

	// Call logic layer
	results, err := s.Logic.SearchMessages(
		ctx,
		s.TenantPool,
		organizationID,
		employeeID,
		req.Msg.QueryText,
		req.Msg.Limit,
		cursor,
	)
	if err != nil {
		slog.ErrorContext(ctx, "message search failed",
			"function", "SearchMessages",
			"error", err,
		)
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Convert results to proto
	protoResults := make([]*rpcv1.MessageSearchResult, len(results))
	for i, r := range results {
		protoResults[i] = &rpcv1.MessageSearchResult{
			Id:               r.ID.String(),
			MessageText:      r.MessageText,
			AuthorEmployeeId: r.AuthorEmployeeID.String(),
			ChannelId:        r.ChannelID.String(),
			ParentMessageId:  converter.NullUUIDToProto(r.ParentMessageID),
			IsEdited:         r.IsEdited,
			RelevanceScore:   r.RelevanceScore,
			UpdatedAt:        converter.TimeToProto(r.UpdatedAt),
			ChannelName:      r.ChannelName,
			ChannelIsPrivate: r.ChannelIsPrivate,
		}
	}

	resp := &rpcv1.SearchMessagesResponse{
		Results: protoResults,
	}

	slog.DebugContext(ctx, "message search completed",
		"function", "SearchMessages",
		"result_count", len(protoResults),
	)

	return connect.NewResponse(resp), nil
}

// AutocompleteChannels provides prefix-based channel suggestions with permission filtering.
func (s *ChatServiceConnect) AutocompleteChannels(
	ctx context.Context,
	req *connect.Request[rpcv1.AutocompleteChannelsRequest],
) (*connect.Response[rpcv1.AutocompleteChannelsResponse], error) {
	slog.DebugContext(ctx, "AutocompleteChannels RPC called",
		"function", "AutocompleteChannels",
		"prefix", req.Msg.Prefix,
		"limit", req.Msg.Limit,
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Call logic layer
	results, err := s.Logic.AutocompleteChannels(
		ctx,
		s.TenantPool,
		organizationID,
		employeeID,
		req.Msg.Prefix,
		req.Msg.Limit,
	)
	if err != nil {
		slog.ErrorContext(ctx, "channel autocomplete failed",
			"function", "AutocompleteChannels",
			"error", err,
		)
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Convert results to proto
	protoSuggestions := make([]*rpcv1.ChannelAutocompleteSuggestion, len(results))
	for i, r := range results {
		// Convert ChannelType string to enum
		channelType := rpcv1.ChannelType_CHANNEL_TYPE_UNSPECIFIED
		switch r.ChannelType {
		case ChannelTypeChat:
			channelType = rpcv1.ChannelType_CHANNEL_TYPE_CHAT
		case ChannelTypeDirectMessage:
			channelType = rpcv1.ChannelType_CHANNEL_TYPE_DIRECT_MESSAGE
		case ChannelTypeProjectTicketThread:
			channelType = rpcv1.ChannelType_CHANNEL_TYPE_PROJECT_TICKET_THREAD
		case ChannelTypeCRMDealNotes:
			channelType = rpcv1.ChannelType_CHANNEL_TYPE_CRM_DEAL_NOTES
		case ChannelTypeSupportTicket:
			channelType = rpcv1.ChannelType_CHANNEL_TYPE_SUPPORT_TICKET
		}

		protoSuggestions[i] = &rpcv1.ChannelAutocompleteSuggestion{
			Id:          r.ID.String(),
			DisplayName: r.DisplayName,
			ChannelType: channelType,
			IsPrivate:   r.IsPrivate,
		}
	}

	resp := &rpcv1.AutocompleteChannelsResponse{
		Suggestions: protoSuggestions,
	}

	slog.DebugContext(ctx, "channel autocomplete completed",
		"function", "AutocompleteChannels",
		"suggestion_count", len(protoSuggestions),
	)

	return connect.NewResponse(resp), nil
}

// ============================================================================
// Direct Message (DM) RPC Handlers
// ============================================================================

// CreateOrGetDirectMessage creates a new DM channel or returns existing one
func (s *ChatServiceConnect) CreateOrGetDirectMessage(
	ctx context.Context,
	req *connect.Request[rpcv1.CreateOrGetDirectMessageRequest],
) (*connect.Response[rpcv1.CreateOrGetDirectMessageResponse], error) {
	slog.DebugContext(ctx, "CreateOrGetDirectMessage RPC called",
		"function", "CreateOrGetDirectMessage",
		"other_employee_id", req.Msg.OtherEmployeeId,
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Parse participant ID
	participantID := dbuuid.MustParse(req.Msg.OtherEmployeeId)

	// Validate: can't create DM with self
	if participantID == employeeID {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("cannot create DM with yourself"))
	}

	// Create or get DM in transaction
	var resp *rpcv1.CreateOrGetDirectMessageResponse
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		resp, txErr = s.Logic.CreateOrGetDirectMessage(ctx, tx, organizationID, employeeID, participantID)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create or get DM",
			"function", "CreateOrGetDirectMessage",
			"error", err,
			"other_employee_id", req.Msg.OtherEmployeeId,
		)
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	slog.InfoContext(ctx, "DM created or retrieved successfully",
		"channel_id", resp.Channel.Id,
		"was_created", resp.WasCreated,
	)

	return connect.NewResponse(resp), nil
}

// ============================================================================
// User Chat Config RPC Handlers
// ============================================================================

// GetUserChatConfig returns user's chat preferences
func (s *ChatServiceConnect) GetUserChatConfig(
	ctx context.Context,
	req *connect.Request[rpcv1.GetUserChatConfigRequest],
) (*connect.Response[rpcv1.GetUserChatConfigResponse], error) {
	slog.DebugContext(ctx, "GetUserChatConfig RPC called",
		"function", "GetUserChatConfig",
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Get config in transaction
	var config *database.ChatUserChatConfig
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		config, txErr = s.Logic.GetUserChatConfig(ctx, tx, organizationID, employeeID)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to get user chat config",
			"function", "GetUserChatConfig",
			"error", err,
		)
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Convert to proto
	resp := &rpcv1.GetUserChatConfigResponse{
		Config: &rpcv1.UserChatConfig{
			ChannelCategories:        string(config.ChannelCategories),
			CategoryLimits:           string(config.CategoryLimits),
			PinnedChannelIds:         converter.UUIDArrayToStrings(config.PinnedChannelIds),
			SidebarCategoryCollapsed: string(config.SidebarCategoryCollapsed),
		},
	}

	slog.DebugContext(ctx, "user chat config retrieved",
		"pinned_count", len(config.PinnedChannelIds),
	)

	return connect.NewResponse(resp), nil
}

// UpdateRecentChannels updates user's recent channels list
func (s *ChatServiceConnect) UpdateRecentChannels(
	ctx context.Context,
	req *connect.Request[rpcv1.UpdateRecentChannelsRequest],
) (*connect.Response[rpcv1.UpdateRecentChannelsResponse], error) {
	slog.DebugContext(ctx, "UpdateRecentChannels RPC called",
		"function", "UpdateRecentChannels",
		"channel_count", len(req.Msg.ChannelIds),
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Parse channel IDs
	channelIDs := converter.StringsToUUIDs(req.Msg.ChannelIds)

	// Update in transaction
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		return s.Logic.UpdateRecentChannels(ctx, tx, organizationID, employeeID, channelIDs)
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update recent channels",
			"function", "UpdateRecentChannels",
			"error", err,
		)
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	slog.InfoContext(ctx, "recent channels updated",
		"channel_count", len(channelIDs),
	)

	return connect.NewResponse(&rpcv1.UpdateRecentChannelsResponse{}), nil
}

// UpdatePinnedChannels updates user's pinned channels list
func (s *ChatServiceConnect) UpdatePinnedChannels(
	ctx context.Context,
	req *connect.Request[rpcv1.UpdatePinnedChannelsRequest],
) (*connect.Response[rpcv1.UpdatePinnedChannelsResponse], error) {
	slog.DebugContext(ctx, "UpdatePinnedChannels RPC called",
		"function", "UpdatePinnedChannels",
		"channel_count", len(req.Msg.ChannelIds),
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Parse channel IDs
	channelIDs := converter.StringsToUUIDs(req.Msg.ChannelIds)

	// Update in transaction
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		return s.Logic.UpdatePinnedChannels(ctx, tx, organizationID, employeeID, channelIDs)
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update pinned channels",
			"function", "UpdatePinnedChannels",
			"error", err,
		)
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	slog.InfoContext(ctx, "pinned channels updated",
		"channel_count", len(channelIDs),
	)

	return connect.NewResponse(&rpcv1.UpdatePinnedChannelsResponse{}), nil
}

// UpdateSidebarCategoryCollapsed updates collapsed state of sidebar categories
func (s *ChatServiceConnect) UpdateSidebarCategoryCollapsed(
	ctx context.Context,
	req *connect.Request[rpcv1.UpdateSidebarCategoryCollapsedRequest],
) (*connect.Response[rpcv1.UpdateSidebarCategoryCollapsedResponse], error) {
	slog.DebugContext(ctx, "UpdateSidebarCategoryCollapsed RPC called",
		"function", "UpdateSidebarCategoryCollapsed",
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Update in transaction
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		return s.Logic.UpdateSidebarCategoryCollapsed(ctx, tx, organizationID, employeeID, req.Msg.CollapsedState)
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update sidebar collapsed state",
			"function", "UpdateSidebarCategoryCollapsed",
			"error", err,
		)
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	slog.InfoContext(ctx, "sidebar collapsed state updated")

	return connect.NewResponse(&rpcv1.UpdateSidebarCategoryCollapsedResponse{}), nil
}

// AddChannelToCategory adds a channel to user's visible channels with category assignment
func (s *ChatServiceConnect) AddChannelToCategory(
	ctx context.Context,
	req *connect.Request[rpcv1.AddChannelToCategoryRequest],
) (*connect.Response[rpcv1.AddChannelToCategoryResponse], error) {
	slog.DebugContext(ctx, "AddChannelToCategory RPC called",
		"function", "AddChannelToCategory",
		"channel_id", req.Msg.ChannelId,
		"category", req.Msg.Category,
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Parse channel ID
	channelID, err := dbuuid.Parse(req.Msg.ChannelId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid channel_id: %w", err))
	}

	// Add channel to category in transaction
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		return s.Logic.AddChannelToCategory(ctx, tx, organizationID, employeeID, channelID, req.Msg.Category)
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to add channel to category",
			"function", "AddChannelToCategory",
			"channel_id", req.Msg.ChannelId,
			"category", req.Msg.Category,
			"error", err,
		)
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	slog.InfoContext(ctx, "channel added to category",
		"channel_id", req.Msg.ChannelId,
		"category", req.Msg.Category,
	)

	return connect.NewResponse(&rpcv1.AddChannelToCategoryResponse{Success: true}), nil
}

// UpdateChannelCategories bulk updates channel category mappings
func (s *ChatServiceConnect) UpdateChannelCategories(
	ctx context.Context,
	req *connect.Request[rpcv1.UpdateChannelCategoriesRequest],
) (*connect.Response[rpcv1.UpdateChannelCategoriesResponse], error) {
	slog.DebugContext(ctx, "UpdateChannelCategories RPC called",
		"function", "UpdateChannelCategories",
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Update in transaction
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		return s.Logic.UpdateChannelCategories(ctx, tx, organizationID, employeeID, req.Msg.ChannelCategories)
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update channel categories",
			"function", "UpdateChannelCategories",
			"error", err,
		)
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	slog.InfoContext(ctx, "channel categories updated")

	return connect.NewResponse(&rpcv1.UpdateChannelCategoriesResponse{Success: true}), nil
}

// UpdateCategoryLimits updates per-category limits configuration
func (s *ChatServiceConnect) UpdateCategoryLimits(
	ctx context.Context,
	req *connect.Request[rpcv1.UpdateCategoryLimitsRequest],
) (*connect.Response[rpcv1.UpdateCategoryLimitsResponse], error) {
	slog.DebugContext(ctx, "UpdateCategoryLimits RPC called",
		"function", "UpdateCategoryLimits",
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Update in transaction
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		return s.Logic.UpdateCategoryLimits(ctx, tx, organizationID, employeeID, req.Msg.CategoryLimits)
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update category limits",
			"function", "UpdateCategoryLimits",
			"error", err,
		)
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	slog.InfoContext(ctx, "category limits updated")

	return connect.NewResponse(&rpcv1.UpdateCategoryLimitsResponse{Success: true}), nil
}

// ListRecentChannels returns user's recent channels with full details
func (s *ChatServiceConnect) ListRecentChannels(
	ctx context.Context,
	req *connect.Request[rpcv1.ListRecentChannelsRequest],
) (*connect.Response[rpcv1.ListRecentChannelsResponse], error) {
	slog.DebugContext(ctx, "ListRecentChannels RPC called",
		"function", "ListRecentChannels",
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// List channels in transaction
	var channels []*rpcv1.ChannelWithDetails
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		channels, txErr = s.Logic.ListRecentChannels(ctx, tx, organizationID, employeeID)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to list recent channels",
			"function", "ListRecentChannels",
			"error", err,
		)
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	resp := &rpcv1.ListRecentChannelsResponse{
		Channels: channels,
	}

	slog.InfoContext(ctx, "recent channels listed",
		"count", len(channels),
	)

	return connect.NewResponse(resp), nil
}

// Context Rail Summary
func (s *ChatServiceConnect) GetChannelContextSummary(
	ctx context.Context,
	req *connect.Request[rpcv1.GetChannelContextSummaryRequest],
) (*connect.Response[rpcv1.GetChannelContextSummaryResponse], error) {
	slog.DebugContext(ctx, "GetChannelContextSummary RPC called",
		"function", "GetChannelContextSummary",
		"channelID", req.Msg.ChannelId,
	)

	// Extract auth context
	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Read-only: pass pool directly
	response, err := s.Logic.GetChannelContextSummary(ctx, s.TenantPool, organizationID, employeeID, req.Msg)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}

	return connect.NewResponse(response), nil
}
