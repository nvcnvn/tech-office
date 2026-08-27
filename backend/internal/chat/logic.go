package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/converter"
	"github.com/nvcnvn/tech-office/backend/internal/notification"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ChatLogic defines the business logic interface for chat operations.
// This layer is pool-agnostic and receives transactions from the Connect layer.
type ChatLogic interface {
	// Channel Management
	CreateChannel(ctx context.Context, tx database.DBTX, orgID, creatorID dbuuid.UUID, req *rpcv1.CreateChannelRequest) (*rpcv1.Channel, error)
	GetChannel(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, channelID dbuuid.UUID) (*rpcv1.Channel, *rpcv1.LinkedResource, error)
	ListChannels(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.ListChannelsRequest) ([]*rpcv1.Channel, string, error)
	UpdateChannel(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.UpdateChannelRequest) (*rpcv1.Channel, error)
	ArchiveChannel(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, channelID dbuuid.UUID) (*rpcv1.Channel, error)
	UnarchiveChannel(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, channelID dbuuid.UUID) (*rpcv1.Channel, error)

	// Channel Membership
	JoinChannel(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, channelID dbuuid.UUID) (*rpcv1.ChannelMembership, error)
	LeaveChannel(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, channelID dbuuid.UUID) error
	InviteMember(ctx context.Context, tx database.DBTX, orgID, inviterID dbuuid.UUID, req *rpcv1.InviteMemberRequest) (*rpcv1.ChannelMembership, error)
	RemoveMember(ctx context.Context, tx database.DBTX, orgID, removerID dbuuid.UUID, req *rpcv1.RemoveMemberRequest) error
	ListChannelMembers(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.ListChannelMembersRequest) ([]*rpcv1.ChannelMembership, string, error)
	UpdateMemberRole(ctx context.Context, tx database.DBTX, orgID, updaterID dbuuid.UUID, req *rpcv1.UpdateMemberRoleRequest) (*rpcv1.ChannelMembership, error)
	UpdateNotificationPreference(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.UpdateNotificationPreferenceRequest) (*rpcv1.ChannelMembership, error)

	// Messaging
	SendMessage(ctx context.Context, tx database.DBTX, orgID, authorID dbuuid.UUID, req *rpcv1.SendMessageRequest) (*rpcv1.Message, error)
	CreateVoiceMessage(ctx context.Context, tx database.DBTX, orgID, senderID, channelID, voiceMessageID, fileID dbuuid.UUID, durationMs int64, mimeType string, waveformPeaks []float32, sizeBytes int64) (dbuuid.UUID, error)
	ReplyToMessage(ctx context.Context, tx database.DBTX, orgID, authorID dbuuid.UUID, req *rpcv1.ReplyToMessageRequest) (*rpcv1.Message, error)
	EditMessage(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.EditMessageRequest) (*rpcv1.Message, error)
	DeleteMessage(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, messageID dbuuid.UUID) error
	ListMessages(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.ListMessagesRequest) ([]*rpcv1.Message, string, string, error)
	GetMessage(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, messageID dbuuid.UUID) (*rpcv1.Message, error)
	ListReplies(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.ListRepliesRequest) ([]*rpcv1.Message, string, error)

	// Message Navigation & Unread Tracking
	GetMessageById(ctx context.Context, tx database.DBTX, orgID, employeeID, messageID dbuuid.UUID) (*rpcv1.GetMessageByIdResponse, error)
	MarkChannelAsRead(ctx context.Context, tx database.DBTX, orgID, employeeID, channelID dbuuid.UUID, lastReadMessageID *dbuuid.UUID) (*rpcv1.MarkChannelAsReadResponse, error)

	// Reactions
	AddReaction(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.AddReactionRequest) (*rpcv1.Reaction, error)
	RemoveReaction(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.RemoveReactionRequest) error
	ListReactions(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, messageID dbuuid.UUID) ([]*rpcv1.ReactionSummary, error)
	// Typing indicators (ephemeral)
	StartTyping(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.StartTypingRequest) (*rpcv1.StartTypingResponse, error)
	StopTyping(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.StopTypingRequest) (*rpcv1.StopTypingResponse, error)

	// Search methods (multilingual fuzzy search)
	SearchChannels(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, queryText string, limit int32, cursor *dbuuid.UUID) ([]*database.SearchChannelsRow, error)
	SearchMessages(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, queryText string, limit int32, cursor *dbuuid.UUID) ([]*database.SearchMessagesRow, error)
	AutocompleteChannels(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, prefix string, limit int32) ([]*database.AutocompleteChannelsRow, error)

	// Direct Message methods
	CreateOrGetDirectMessage(ctx context.Context, tx database.DBTX, orgID, currentEmployeeID, otherEmployeeID dbuuid.UUID) (*rpcv1.CreateOrGetDirectMessageResponse, error)

	// SetContactGuard wires in the block check used by CreateOrGetDirectMessage
	// (Feature 036). Wired after construction because the compliance domain is
	// built later in server start-up.
	SetContactGuard(guard ContactGuard)

	// DirectMessageCounterpart returns the other person in a direct conversation,
	// or ok=false when the channel is not a direct message. Voice uses it to apply
	// the same block guard to call initiation without reaching into chat's tables.
	DirectMessageCounterpart(ctx context.Context, tx database.DBTX, orgID, employeeID, channelID dbuuid.UUID) (dbuuid.UUID, bool, error)
	AuthorizeVoiceChannel(ctx context.Context, tx database.DBTX, orgID, employeeID, channelID dbuuid.UUID) error
	AnnounceVoiceCallStarted(ctx context.Context, tx database.DBTX, orgID, actorID, channelID, callID dbuuid.UUID) error
	AnnounceVoiceCallEnded(ctx context.Context, tx database.DBTX, orgID, actorID, channelID, callID dbuuid.UUID, outcome string) error

	// User Chat Config methods
	GetUserChatConfig(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID) (*database.ChatUserChatConfig, error)
	AddChannelToCategory(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, channelID dbuuid.UUID, category string) error
	UpdateChannelCategories(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, channelCategories string) error
	UpdateCategoryLimits(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, categoryLimits string) error
	RemoveChannelFromVisible(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, channelID dbuuid.UUID) error
	UpdateRecentChannels(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, channelIDs []dbuuid.UUID) error
	UpdatePinnedChannels(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, channelIDs []dbuuid.UUID) error
	UpdateSidebarCategoryCollapsed(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, collapsedState string) error
	ListRecentChannels(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID) ([]*rpcv1.ChannelWithDetails, error)

	// Context Rail Summaries
	GetChannelContextSummary(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.GetChannelContextSummaryRequest) (*rpcv1.GetChannelContextSummaryResponse, error)
}

type NotificationPublisher interface {
	PublishNotification(ctx context.Context, tx database.DBTX, req *rpcv1.PublishNotificationRequest) (*rpcv1.PublishNotificationResponse, error)
}

// ContactGuard answers whether direct contact between two people is refused
// because one has blocked the other (Feature 036, FR-020).
//
// It is declared here rather than imported so internal/chat keeps no dependency on
// internal/compliance; the compliance logic satisfies it structurally and is wired
// in at server start-up. Blocking is enforced at this one chokepoint and at voice
// call initiation — not as a filter threaded through every message read path
// (research.md R8).
type ContactGuard interface {
	IsDirectContactBlocked(ctx context.Context, tx database.DBTX, orgID, a, b dbuuid.UUID) (bool, error)
}

type chatLogicImpl struct {
	Queries               *database.Queries
	NotificationPublisher NotificationPublisher

	// ContactGuard may be nil in tests and in any deployment where the compliance
	// domain is not wired; a nil guard means no block is enforced, never a panic.
	ContactGuard ContactGuard
}

// NewChatLogic creates a new chat logic layer implementation
func NewChatLogic(queries *database.Queries, notificationPublisher NotificationPublisher) ChatLogic {
	return &chatLogicImpl{
		Queries:               queries,
		NotificationPublisher: notificationPublisher,
	}
}

// SetContactGuard wires the block check in after construction.
func (s *chatLogicImpl) SetContactGuard(guard ContactGuard) { s.ContactGuard = guard }

func chatNotificationChannelName(channel *database.ChatChannel) string {
	if name := strings.TrimSpace(channel.DisplayName); name != "" {
		return name
	}

	if slug := strings.TrimSpace(channel.TitleSlug); slug != "" {
		return slug
	}

	return "conversation"
}

func buildChatNotificationActionData(
	channel *database.ChatChannel,
	messageID dbuuid.UUID,
	senderID dbuuid.UUID,
	senderName string,
	action string,
	extra map[string]string,
) map[string]string {
	resolvedSenderName := strings.TrimSpace(senderName)
	if resolvedSenderName == "" {
		resolvedSenderName = "Someone"
	}

	actionData := map[string]string{
		"channelId":        channel.ID.String(),
		"channelType":      channel.ChannelType,
		"channelName":      chatNotificationChannelName(channel),
		"messageId":        messageID.String(),
		"senderEmployeeId": senderID.String(),
		"senderName":       resolvedSenderName,
		"action":           action,
	}

	for key, value := range extra {
		if strings.TrimSpace(value) == "" {
			continue
		}
		actionData[key] = value
	}

	return actionData
}

// CreateChannel creates a new channel and automatically adds creator as admin
func (s *chatLogicImpl) CreateChannel(
	ctx context.Context,
	tx database.DBTX,
	orgID, creatorID dbuuid.UUID,
	req *rpcv1.CreateChannelRequest,
) (*rpcv1.Channel, error) {
	slog.InfoContext(ctx, "creating channel",
		"function", "CreateChannel",
		"organizationID", orgID.String(),
		"creatorID", creatorID.String(),
		"slug", req.TitleSlug,
	)

	// Validate slug format
	if !isValidSlug(req.TitleSlug) {
		return nil, fmt.Errorf("invalid slug format: must be alphanumeric with hyphens, max 64 chars")
	}

	// Map proto enum to DB string
	channelType := mapChannelTypeToString(req.ChannelType)

	// Create channel
	channel, err := s.Queries.CreateChannel(ctx, tx, &database.CreateChannelParams{
		OrganizationID:      orgID,
		TitleSlug:           req.TitleSlug,
		DisplayName:         req.DisplayName,
		Description:         pgtype.Text{String: req.Description, Valid: req.Description != ""},
		ChannelType:         channelType,
		IsPrivate:           req.IsPrivate,
		CreatedByEmployeeID: creatorID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create channel",
			"error", err,
			"slug", req.TitleSlug,
		)
		return nil, fmt.Errorf("failed to create channel: %w", err)
	}

	// Create membership for creator as admin
	_, err = s.Queries.CreateChannelMembership(ctx, tx, &database.CreateChannelMembershipParams{
		OrganizationID:         orgID,
		ChannelID:              channel.ID,
		EmployeeID:             creatorID,
		IsAdmin:                true,
		NotificationPreference: NotificationPreferenceAll,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create creator membership",
			"error", err,
			"channelID", channel.ID.String(),
		)
		return nil, fmt.Errorf("failed to create creator membership: %w", err)
	}

	slog.InfoContext(ctx, "channel created successfully",
		"channelID", channel.ID.String(),
		"slug", channel.TitleSlug,
	)

	return channelToProto(channel, 1, true, nil), nil
}

// GetChannel retrieves a channel by ID with access control
func (s *chatLogicImpl) GetChannel(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	channelID dbuuid.UUID,
) (*rpcv1.Channel, *rpcv1.LinkedResource, error) {
	slog.InfoContext(ctx, "getting channel",
		"function", "GetChannel",
		"channelID", channelID.String(),
	)

	channel, err := s.Queries.GetChannelByID(ctx, tx, &database.GetChannelByIDParams{
		ID:             channelID,
		OrganizationID: orgID,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("channel not found: %w", err)
	}

	// Check access: public channels or membership
	if channel.IsPrivate {
		_, err := s.Queries.GetChannelMembership(ctx, tx, &database.GetChannelMembershipParams{
			ChannelID:      channelID,
			EmployeeID:     employeeID,
			OrganizationID: orgID,
		})
		if err != nil {
			return nil, nil, fmt.Errorf("access denied: not a member of private channel")
		}
	}

	var linkedResource *rpcv1.LinkedResource
	if channel.ChannelType == ChannelTypeProjectTicketThread {
		taskSummaries, err := s.Queries.GetTaskSummariesByChannelIDs(ctx, tx, &database.GetTaskSummariesByChannelIDsParams{
			OrganizationID: orgID,
			ChannelIds:     []dbuuid.UUID{channelID},
		})
		if err != nil {
			slog.WarnContext(ctx, "failed to enrich channel with linked task resource",
				"channel_id", channelID.String(),
				"error", err,
			)
		} else if len(taskSummaries) > 0 {
			taskSummary := taskSummaries[0]
			linkedResource = &rpcv1.LinkedResource{
				ResourceType:      "task",
				ResourceId:        taskSummary.TaskID.String(),
				ParentId:          taskSummary.ProjectID.String(),
				DisplayIdentifier: taskSummary.Identifier,
				DisplayTitle:      taskSummary.Title,
			}
		}
	}

	// Get member count
	memberCount, err := s.Queries.CountChannelMembers(ctx, tx, &database.CountChannelMembersParams{
		ChannelID:      channelID,
		OrganizationID: orgID,
	})
	if err != nil {
		memberCount = 0
	}

	// Get user's membership
	membership, err := s.Queries.GetChannelMembership(ctx, tx, &database.GetChannelMembershipParams{
		ChannelID:      channelID,
		EmployeeID:     employeeID,
		OrganizationID: orgID,
	})

	var membershipProto *rpcv1.ChannelMembership
	if err == nil {
		membershipProto = membershipToProto(membership, "", "")
	}

	return channelToProto(channel, int32(memberCount), err == nil, membershipProto), linkedResource, nil
}

// ListChannels lists channels for a user with filtering
func (s *chatLogicImpl) ListChannels(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	req *rpcv1.ListChannelsRequest,
) ([]*rpcv1.Channel, string, error) {
	slog.InfoContext(ctx, "listing channels",
		"function", "ListChannels",
		"employeeID", employeeID.String(),
	)

	pageSize := req.PageSize
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 50
	}

	channels, err := s.Queries.ListChannelsForUser(ctx, tx, &database.ListChannelsForUserParams{
		EmployeeID:     employeeID,
		OrganizationID: orgID,
		Column3:        req.IncludeArchived,
		Limit:          pageSize,
		Offset:         0,
	})
	if err != nil {
		return nil, "", fmt.Errorf("failed to list channels: %w", err)
	}

	result := make([]*rpcv1.Channel, 0, len(channels))
	for _, ch := range channels {
		channelProto := &rpcv1.Channel{
			Id:                  ch.ID.String(),
			OrganizationId:      ch.OrganizationID.String(),
			TitleSlug:           ch.TitleSlug,
			DisplayName:         ch.DisplayName,
			Description:         ch.Description.String,
			ChannelType:         mapStringToChannelType(ch.ChannelType),
			IsPrivate:           ch.IsPrivate,
			IsArchived:          ch.IsArchived,
			CreatedByEmployeeId: ch.CreatedByEmployeeID.String(),
			UpdatedAt:           timestamppb.New(ch.UpdatedAt.Time),
			MemberCount:         int32(ch.MemberCount),
			IsMember:            true, // User is member (from JOIN in query)
		}
		result = append(result, channelProto)
	}

	return result, "", nil
}

// UpdateChannel updates channel metadata (admin or creator only)
func (s *chatLogicImpl) UpdateChannel(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	req *rpcv1.UpdateChannelRequest,
) (*rpcv1.Channel, error) {
	channelID, err := dbuuid.Parse(req.ChannelId)
	if err != nil {
		return nil, fmt.Errorf("invalid channel ID: %w", err)
	}

	// Verify admin or creator
	if err := s.verifyAdminOrCreator(ctx, tx, orgID, employeeID, channelID); err != nil {
		return nil, err
	}

	// Get current channel data
	currentChannel, err := s.Queries.GetChannelByID(ctx, tx, &database.GetChannelByIDParams{
		ID:             channelID,
		OrganizationID: orgID,
	})
	if err != nil {
		return nil, fmt.Errorf("channel not found: %w", err)
	}

	// Use current values as defaults
	displayName := currentChannel.DisplayName
	description := currentChannel.Description
	isPrivate := currentChannel.IsPrivate

	// Override with new values if provided
	if req.DisplayName != nil {
		displayName = *req.DisplayName
	}
	if req.Description != nil {
		description = pgtype.Text{String: *req.Description, Valid: true}
	}
	if req.IsPrivate != nil {
		isPrivate = *req.IsPrivate
	}

	channel, err := s.Queries.UpdateChannel(ctx, tx, &database.UpdateChannelParams{
		ID:             channelID,
		OrganizationID: orgID,
		DisplayName:    displayName,
		Description:    description,
		IsPrivate:      isPrivate,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to update channel: %w", err)
	}

	return channelToProto(channel, 0, true, nil), nil
}

// ArchiveChannel archives a channel (admin only)
func (s *chatLogicImpl) ArchiveChannel(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	channelID dbuuid.UUID,
) (*rpcv1.Channel, error) {
	if err := s.verifyAdmin(ctx, tx, orgID, employeeID, channelID); err != nil {
		return nil, err
	}

	channel, err := s.Queries.ArchiveChannel(ctx, tx, &database.ArchiveChannelParams{
		ID:             channelID,
		OrganizationID: orgID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to archive channel: %w", err)
	}

	return channelToProto(channel, 0, true, nil), nil
}

// UnarchiveChannel unarchives a channel (admin only)
func (s *chatLogicImpl) UnarchiveChannel(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	channelID dbuuid.UUID,
) (*rpcv1.Channel, error) {
	if err := s.verifyAdmin(ctx, tx, orgID, employeeID, channelID); err != nil {
		return nil, err
	}

	channel, err := s.Queries.UnarchiveChannel(ctx, tx, &database.UnarchiveChannelParams{
		ID:             channelID,
		OrganizationID: orgID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to unarchive channel: %w", err)
	}

	return channelToProto(channel, 0, true, nil), nil
}

// Helper functions

func isValidSlug(slug string) bool {
	if len(slug) == 0 || len(slug) > 64 {
		return false
	}
	for _, c := range slug {
		if !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-') {
			return false
		}
	}
	return true
}

func mapChannelTypeToString(ct rpcv1.ChannelType) string {
	switch ct {
	case rpcv1.ChannelType_CHANNEL_TYPE_CHAT:
		return ChannelTypeChat
	case rpcv1.ChannelType_CHANNEL_TYPE_DIRECT_MESSAGE:
		return ChannelTypeDirectMessage
	case rpcv1.ChannelType_CHANNEL_TYPE_PROJECT_TICKET_THREAD:
		return ChannelTypeProjectTicketThread
	case rpcv1.ChannelType_CHANNEL_TYPE_CRM_DEAL_NOTES:
		return ChannelTypeCRMDealNotes
	case rpcv1.ChannelType_CHANNEL_TYPE_SUPPORT_TICKET:
		return ChannelTypeSupportTicket
	default:
		return ChannelTypeChat
	}
}

func mapStringToChannelType(s string) rpcv1.ChannelType {
	switch s {
	case ChannelTypeChat:
		return rpcv1.ChannelType_CHANNEL_TYPE_CHAT
	case ChannelTypeDirectMessage:
		return rpcv1.ChannelType_CHANNEL_TYPE_DIRECT_MESSAGE
	case ChannelTypeProjectTicketThread:
		return rpcv1.ChannelType_CHANNEL_TYPE_PROJECT_TICKET_THREAD
	case ChannelTypeCRMDealNotes:
		return rpcv1.ChannelType_CHANNEL_TYPE_CRM_DEAL_NOTES
	case ChannelTypeSupportTicket:
		return rpcv1.ChannelType_CHANNEL_TYPE_SUPPORT_TICKET
	default:
		return rpcv1.ChannelType_CHANNEL_TYPE_UNSPECIFIED
	}
}

func mapStringToNotificationPreference(s string) rpcv1.NotificationPreference {
	switch s {
	case NotificationPreferenceAll:
		return rpcv1.NotificationPreference_NOTIFICATION_PREFERENCE_ALL
	case NotificationPreferenceMentions:
		return rpcv1.NotificationPreference_NOTIFICATION_PREFERENCE_MENTIONS
	case NotificationPreferenceMuted:
		return rpcv1.NotificationPreference_NOTIFICATION_PREFERENCE_MUTED
	default:
		return rpcv1.NotificationPreference_NOTIFICATION_PREFERENCE_UNSPECIFIED
	}
}

func mapNotificationPreferenceToString(np rpcv1.NotificationPreference) string {
	switch np {
	case rpcv1.NotificationPreference_NOTIFICATION_PREFERENCE_ALL:
		return NotificationPreferenceAll
	case rpcv1.NotificationPreference_NOTIFICATION_PREFERENCE_MENTIONS:
		return NotificationPreferenceMentions
	case rpcv1.NotificationPreference_NOTIFICATION_PREFERENCE_MUTED:
		return NotificationPreferenceMuted
	default:
		return NotificationPreferenceAll
	}
}

func channelToProto(
	ch *database.ChatChannel,
	memberCount int32,
	isMember bool,
	membership *rpcv1.ChannelMembership,
) *rpcv1.Channel {
	return &rpcv1.Channel{
		Id:                    ch.ID.String(),
		OrganizationId:        ch.OrganizationID.String(),
		TitleSlug:             ch.TitleSlug,
		DisplayName:           ch.DisplayName,
		Description:           ch.Description.String,
		ChannelType:           mapStringToChannelType(ch.ChannelType),
		IsPrivate:             ch.IsPrivate,
		IsArchived:            ch.IsArchived,
		CreatedByEmployeeId:   ch.CreatedByEmployeeID.String(),
		UpdatedAt:             timestamppb.New(ch.UpdatedAt.Time),
		MemberCount:           memberCount,
		IsMember:              isMember,
		CurrentUserMembership: membership,
	}
}

func membershipToProto(
	m *database.ChatChannelMembership,
	employeeName string,
	employeeEmail string,
) *rpcv1.ChannelMembership {
	return &rpcv1.ChannelMembership{
		Id:                     m.ID.String(),
		OrganizationId:         m.OrganizationID.String(),
		ChannelId:              m.ChannelID.String(),
		EmployeeId:             m.EmployeeID.String(),
		IsAdmin:                m.IsAdmin,
		NotificationPreference: mapStringToNotificationPreference(m.NotificationPreference),
		JoinedAt:               timestamppb.New(m.JoinedAt.Time),
		UpdatedAt:              timestamppb.New(m.UpdatedAt.Time),
		EmployeeName:           employeeName,
		EmployeeEmail:          employeeEmail,
	}
}

func (s *chatLogicImpl) verifyAdmin(ctx context.Context, tx database.DBTX, orgID, employeeID, channelID dbuuid.UUID) error {
	membership, err := s.Queries.GetChannelMembership(ctx, tx, &database.GetChannelMembershipParams{
		ChannelID:      channelID,
		EmployeeID:     employeeID,
		OrganizationID: orgID,
	})
	if err != nil {
		return fmt.Errorf("not a member of channel")
	}
	if !membership.IsAdmin {
		return fmt.Errorf("admin privileges required")
	}
	return nil
}

func (s *chatLogicImpl) verifyAdminOrCreator(ctx context.Context, tx database.DBTX, orgID, employeeID, channelID dbuuid.UUID) error {
	channel, err := s.Queries.GetChannelByID(ctx, tx, &database.GetChannelByIDParams{
		ID:             channelID,
		OrganizationID: orgID,
	})
	if err != nil {
		return fmt.Errorf("channel not found")
	}

	if channel.CreatedByEmployeeID == employeeID {
		return nil
	}

	return s.verifyAdmin(ctx, tx, orgID, employeeID, channelID)
}

// ============================================================================
// Membership Management Implementation
// ============================================================================

func (s *chatLogicImpl) JoinChannel(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, channelID dbuuid.UUID) (*rpcv1.ChannelMembership, error) {
	slog.InfoContext(ctx, "employee joining channel",
		"function", "JoinChannel",
		"employeeID", employeeID.String(),
		"channelID", channelID.String(),
	)

	// Verify channel exists and is public
	channel, err := s.Queries.GetChannelByID(ctx, tx, &database.GetChannelByIDParams{
		ID:             channelID,
		OrganizationID: orgID,
	})
	if err != nil {
		return nil, fmt.Errorf("channel not found: %w", err)
	}

	if channel.IsPrivate {
		return nil, fmt.Errorf("cannot join private channel (invitation required)")
	}

	if channel.IsArchived {
		return nil, fmt.Errorf("cannot join archived channel")
	}

	// Check if already a member
	existing, err := s.Queries.GetChannelMembership(ctx, tx, &database.GetChannelMembershipParams{
		ChannelID:      channelID,
		EmployeeID:     employeeID,
		OrganizationID: orgID,
	})
	if err == nil {
		// Already a member, return existing membership
		return membershipToProto(existing, "", ""), nil
	}

	// Create membership with default notification preference
	membership, err := s.Queries.CreateChannelMembership(ctx, tx, &database.CreateChannelMembershipParams{
		OrganizationID:         orgID,
		ChannelID:              channelID,
		EmployeeID:             employeeID,
		IsAdmin:                false,
		NotificationPreference: NotificationPreferenceAll,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create membership: %w", err)
	}

	slog.InfoContext(ctx, "employee joined channel successfully",
		"employeeID", employeeID.String(),
		"channelID", channelID.String(),
	)

	return membershipToProto(membership, "", ""), nil
}

func (s *chatLogicImpl) LeaveChannel(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, channelID dbuuid.UUID) error {
	slog.InfoContext(ctx, "employee leaving channel",
		"function", "LeaveChannel",
		"employeeID", employeeID.String(),
		"channelID", channelID.String(),
	)

	// Get membership
	membership, err := s.Queries.GetChannelMembership(ctx, tx, &database.GetChannelMembershipParams{
		ChannelID:      channelID,
		EmployeeID:     employeeID,
		OrganizationID: orgID,
	})
	if err != nil {
		return fmt.Errorf("not a member of channel")
	}

	// If leaving member is an admin, check if they're the last admin
	if membership.IsAdmin {
		adminCount, err := s.Queries.CountChannelAdmins(ctx, tx, &database.CountChannelAdminsParams{
			ChannelID:      channelID,
			OrganizationID: orgID,
		})
		if err != nil {
			return fmt.Errorf("failed to count admins: %w", err)
		}

		if adminCount == 1 {
			// This is the last admin - auto-promote oldest member
			oldestMember, err := s.Queries.GetOldestMember(ctx, tx, &database.GetOldestMemberParams{
				ChannelID:      channelID,
				OrganizationID: orgID,
			})
			if err == nil {
				// Promote oldest member to admin
				_, err = s.Queries.UpdateMembershipRole(ctx, tx, &database.UpdateMembershipRoleParams{
					ChannelID:      channelID,
					EmployeeID:     oldestMember.EmployeeID,
					OrganizationID: orgID,
					IsAdmin:        true,
				})
				if err != nil {
					return fmt.Errorf("failed to promote new admin: %w", err)
				}
				slog.InfoContext(ctx, "promoted oldest member to admin",
					"newAdminID", oldestMember.EmployeeID.String(),
					"channelID", channelID.String(),
				)
			}
		}
	}

	// Remove membership
	err = s.Queries.RemoveChannelMember(ctx, tx, &database.RemoveChannelMemberParams{
		ChannelID:      channelID,
		EmployeeID:     employeeID,
		OrganizationID: orgID,
	})
	if err != nil {
		return fmt.Errorf("failed to remove membership: %w", err)
	}

	slog.InfoContext(ctx, "employee left channel successfully",
		"employeeID", employeeID.String(),
		"channelID", channelID.String(),
	)

	return nil
}

func (s *chatLogicImpl) InviteMember(ctx context.Context, tx database.DBTX, orgID, inviterID dbuuid.UUID, req *rpcv1.InviteMemberRequest) (*rpcv1.ChannelMembership, error) {
	slog.InfoContext(ctx, "inviting member to channel",
		"function", "InviteMember",
		"inviterID", inviterID.String(),
		"channelID", req.ChannelId,
		"employeeID", req.EmployeeId,
	)

	channelID := dbuuid.MustParse(req.ChannelId)
	employeeID := dbuuid.MustParse(req.EmployeeId)

	// Verify inviter is admin
	if err := s.verifyAdmin(ctx, tx, orgID, inviterID, channelID); err != nil {
		return nil, err
	}

	// Check if already a member
	existing, err := s.Queries.GetChannelMembership(ctx, tx, &database.GetChannelMembershipParams{
		ChannelID:      channelID,
		EmployeeID:     employeeID,
		OrganizationID: orgID,
	})
	if err == nil {
		// Already a member
		return membershipToProto(existing, "", ""), nil
	}

	// Create membership
	membership, err := s.Queries.CreateChannelMembership(ctx, tx, &database.CreateChannelMembershipParams{
		OrganizationID:         orgID,
		ChannelID:              channelID,
		EmployeeID:             employeeID,
		IsAdmin:                false,
		NotificationPreference: NotificationPreferenceAll,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create membership: %w", err)
	}

	slog.InfoContext(ctx, "member invited to channel successfully",
		"channelID", channelID.String(),
		"employeeID", employeeID.String(),
	)

	return membershipToProto(membership, "", ""), nil
}

func (s *chatLogicImpl) RemoveMember(ctx context.Context, tx database.DBTX, orgID, removerID dbuuid.UUID, req *rpcv1.RemoveMemberRequest) error {
	slog.InfoContext(ctx, "removing member from channel",
		"function", "RemoveMember",
		"removerID", removerID.String(),
		"channelID", req.ChannelId,
		"employeeID", req.EmployeeId,
	)

	channelID := dbuuid.MustParse(req.ChannelId)
	employeeID := dbuuid.MustParse(req.EmployeeId)

	// Verify remover is admin
	if err := s.verifyAdmin(ctx, tx, orgID, removerID, channelID); err != nil {
		return err
	}

	// Get target member's membership
	membership, err := s.Queries.GetChannelMembership(ctx, tx, &database.GetChannelMembershipParams{
		ChannelID:      channelID,
		EmployeeID:     employeeID,
		OrganizationID: orgID,
	})
	if err != nil {
		return fmt.Errorf("member not found in channel")
	}

	// If removing an admin, check if they're the last admin
	if membership.IsAdmin {
		adminCount, err := s.Queries.CountChannelAdmins(ctx, tx, &database.CountChannelAdminsParams{
			ChannelID:      channelID,
			OrganizationID: orgID,
		})
		if err != nil {
			return fmt.Errorf("failed to count admins: %w", err)
		}

		if adminCount == 1 {
			return fmt.Errorf("cannot remove last admin (promote another member first)")
		}
	}

	// Remove membership
	err = s.Queries.RemoveChannelMember(ctx, tx, &database.RemoveChannelMemberParams{
		ChannelID:      channelID,
		EmployeeID:     employeeID,
		OrganizationID: orgID,
	})
	if err != nil {
		return fmt.Errorf("failed to remove member: %w", err)
	}

	slog.InfoContext(ctx, "member removed from channel successfully",
		"channelID", channelID.String(),
		"employeeID", employeeID.String(),
	)

	return nil
}

func (s *chatLogicImpl) ListChannelMembers(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.ListChannelMembersRequest) ([]*rpcv1.ChannelMembership, string, error) {
	slog.InfoContext(ctx, "listing channel members",
		"function", "ListChannelMembers",
		"channelID", req.ChannelId,
	)

	channelID := dbuuid.MustParse(req.ChannelId)

	// Verify user has access to channel
	channel, err := s.Queries.GetChannelByID(ctx, tx, &database.GetChannelByIDParams{
		ID:             channelID,
		OrganizationID: orgID,
	})
	if err != nil {
		return nil, "", fmt.Errorf("channel not found: %w", err)
	}

	// For private channels, verify membership
	if channel.IsPrivate {
		_, err := s.Queries.GetChannelMembership(ctx, tx, &database.GetChannelMembershipParams{
			ChannelID:      channelID,
			EmployeeID:     employeeID,
			OrganizationID: orgID,
		})
		if err != nil {
			return nil, "", fmt.Errorf("access denied: not a member of private channel")
		}
	}

	// List members with employee details
	pageSize := req.PageSize
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 50
	}

	members, err := s.Queries.ListChannelMembers(ctx, tx, &database.ListChannelMembersParams{
		ChannelID:      channelID,
		OrganizationID: orgID,
		Limit:          pageSize,
		Offset:         0,
	})
	if err != nil {
		return nil, "", fmt.Errorf("failed to list members: %w", err)
	}

	result := make([]*rpcv1.ChannelMembership, 0, len(members))
	for _, m := range members {
		memberProto := &rpcv1.ChannelMembership{
			Id:                     m.ID.String(),
			OrganizationId:         m.OrganizationID.String(),
			ChannelId:              m.ChannelID.String(),
			EmployeeId:             m.EmployeeID.String(),
			IsAdmin:                m.IsAdmin,
			NotificationPreference: mapStringToNotificationPreference(m.NotificationPreference),
			JoinedAt:               timestamppb.New(m.JoinedAt.Time),
			UpdatedAt:              timestamppb.New(m.UpdatedAt.Time),
			EmployeeName:           m.EmployeeName.(string),
			EmployeeEmail:          m.EmployeeEmail,
		}
		result = append(result, memberProto)
	}

	return result, "", nil
}

func (s *chatLogicImpl) UpdateMemberRole(ctx context.Context, tx database.DBTX, orgID, updaterID dbuuid.UUID, req *rpcv1.UpdateMemberRoleRequest) (*rpcv1.ChannelMembership, error) {
	slog.InfoContext(ctx, "updating member role",
		"function", "UpdateMemberRole",
		"updaterID", updaterID.String(),
		"channelID", req.ChannelId,
		"employeeID", req.EmployeeId,
		"isAdmin", req.IsAdmin,
	)

	channelID := dbuuid.MustParse(req.ChannelId)
	employeeID := dbuuid.MustParse(req.EmployeeId)

	// Verify updater is admin
	if err := s.verifyAdmin(ctx, tx, orgID, updaterID, channelID); err != nil {
		return nil, err
	}

	// If demoting to non-admin, check if they're the last admin
	if !req.IsAdmin {
		adminCount, err := s.Queries.CountChannelAdmins(ctx, tx, &database.CountChannelAdminsParams{
			ChannelID:      channelID,
			OrganizationID: orgID,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to count admins: %w", err)
		}

		// Check if target member is currently an admin
		targetMembership, err := s.Queries.GetChannelMembership(ctx, tx, &database.GetChannelMembershipParams{
			ChannelID:      channelID,
			EmployeeID:     employeeID,
			OrganizationID: orgID,
		})
		if err != nil {
			return nil, fmt.Errorf("member not found: %w", err)
		}

		if targetMembership.IsAdmin && adminCount == 1 {
			return nil, fmt.Errorf("cannot demote last admin")
		}
	}

	// Update role
	membership, err := s.Queries.UpdateMembershipRole(ctx, tx, &database.UpdateMembershipRoleParams{
		ChannelID:      channelID,
		EmployeeID:     employeeID,
		OrganizationID: orgID,
		IsAdmin:        req.IsAdmin,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to update role: %w", err)
	}

	slog.InfoContext(ctx, "member role updated successfully",
		"channelID", channelID.String(),
		"employeeID", employeeID.String(),
		"isAdmin", req.IsAdmin,
	)

	return membershipToProto(membership, "", ""), nil
}

func (s *chatLogicImpl) UpdateNotificationPreference(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.UpdateNotificationPreferenceRequest) (*rpcv1.ChannelMembership, error) {
	slog.InfoContext(ctx, "updating notification preference",
		"function", "UpdateNotificationPreference",
		"employeeID", employeeID.String(),
		"channelID", req.ChannelId,
		"preference", req.Preference.String(),
	)

	channelID := dbuuid.MustParse(req.ChannelId)
	preference := mapNotificationPreferenceToString(req.Preference)

	// Update preference
	membership, err := s.Queries.UpdateMembershipNotificationPreference(ctx, tx, &database.UpdateMembershipNotificationPreferenceParams{
		ChannelID:              channelID,
		EmployeeID:             employeeID,
		OrganizationID:         orgID,
		NotificationPreference: preference,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to update notification preference: %w", err)
	}

	slog.InfoContext(ctx, "notification preference updated successfully",
		"channelID", channelID.String(),
		"preference", preference,
	)

	return membershipToProto(membership, "", ""), nil
}

func (s *chatLogicImpl) SendMessage(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.SendMessageRequest) (*rpcv1.Message, error) {
	slog.InfoContext(ctx, "💬 sending message",
		"function", "SendMessage",
		"employeeID", employeeID.String(),
		"channelID", req.ChannelId,
	)

	channelID := dbuuid.MustParse(req.ChannelId)

	// Sanitize HTML first (used for storage and mention parsing)
	sanitizedText := sanitizeMessageHTML(req.MessageText)

	// Create message (validates membership and message length, stores sanitized HTML)
	fullMessage, err := s.createChannelMessage(ctx, tx, orgID, employeeID, channelID, sanitizedText, req.FileIds)
	if err != nil {
		return nil, err
	}

	// Broadcast new message notification to all channel members (use sanitized text)
	channel, err := s.broadcastNewMessage(ctx, tx, orgID, employeeID, fullMessage, sanitizedText)
	if err != nil {
		slog.WarnContext(ctx, "failed to broadcast new message",
			"error", err,
			"messageID", fullMessage.ID.String(),
		)
	}

	// Send targeted notifications for @mentions
	// Note: mentions were already stored in message during createChannelMessage
	mentions := parseTipTapMentions(sanitizedText)
	if len(mentions) > 0 {
		if err := s.notifyMentionedUsersV2(ctx, tx, orgID, employeeID, channelID, fullMessage, sanitizedText, mentions); err != nil {
			slog.WarnContext(ctx, "failed to notify mentioned users",
				"error", err,
				"messageID", fullMessage.ID.String(),
			)
		}
	}

	// V2: If this channel is a task discussion surface, bridge to task_commented
	// and auto-subscribe the commenter to the parent task.
	if channel != nil && channel.ChannelType == ChannelTypeProjectTicketThread {
		s.bridgeTaskChannelMessage(ctx, tx, orgID, employeeID, channelID, fullMessage, sanitizedText, mentions)
	}

	slog.InfoContext(ctx, "message sent successfully",
		"messageID", fullMessage.ID.String(),
		"channelID", channelID.String(),
		"mentionCount", len(mentions),
	)

	return messageToProto(fullMessage, employeeID), nil
}

// createChannelMessage validates and creates a new message in the database.
// Returns the full message with author details.
func (s *chatLogicImpl) createChannelMessage(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID, channelID dbuuid.UUID,
	messageText string,
	fileIDs []string,
) (*database.GetMessageByIDRow, error) {
	slog.DebugContext(ctx, "creating channel message",
		"function", "createChannelMessage",
		"channelID", channelID.String(),
	)

	// Validate message length (messageText is already sanitized by caller)
	if len(messageText) == 0 || isHTMLContentEmpty(messageText) {
		return nil, fmt.Errorf("message text cannot be empty")
	}
	if len(messageText) > 10000 {
		return nil, fmt.Errorf("message text exceeds maximum length of 10000 characters")
	}

	// Verify user is member of channel; for public channels, auto-join if not already a member
	_, err := s.Queries.GetChannelMembership(ctx, tx, &database.GetChannelMembershipParams{
		ChannelID:      channelID,
		EmployeeID:     employeeID,
		OrganizationID: orgID,
	})
	if err != nil {
		// Not a member — try to auto-join (JoinChannel handles public/private distinction)
		if _, joinErr := s.JoinChannel(ctx, tx, orgID, employeeID, channelID); joinErr != nil {
			return nil, fmt.Errorf("not a member of channel")
		}
	}

	// Parse mentions and convert to JSON
	mentions := parseTipTapMentions(messageText)
	var mentionsJSON []byte
	if len(mentions) > 0 {
		mentionsJSON, err = json.Marshal(mentions)
		if err != nil {
			slog.WarnContext(ctx, "failed to marshal mentions, continuing without metadata",
				"error", err,
			)
			mentionsJSON = nil
		}
	}

	var fileUUIDs []dbuuid.UUID
	for _, fid := range fileIDs {
		fileUUIDs = append(fileUUIDs, dbuuid.MustParse(fid))
	}

	// Create message (PGroonga handles multilingual indexing automatically)
	// messageText contains sanitized HTML (plaintext is valid HTML, renders correctly)
	message, err := s.Queries.CreateMessage(ctx, tx, &database.CreateMessageParams{
		OrganizationID:   orgID,
		ChannelID:        channelID,
		MessageText:      messageText,
		AuthorEmployeeID: employeeID,
		ParentMessageID:  dbuuid.NullUUID{},
		Mentions:         mentionsJSON,
		FileIds:          fileUUIDs,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create message: %w", err)
	}

	// Fetch full message with author details (for author name and proto conversion)
	fullMessage, err := s.Queries.GetMessageByID(ctx, tx, &database.GetMessageByIDParams{
		ID:             message.ID,
		OrganizationID: orgID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to fetch created message: %w", err)
	}

	slog.DebugContext(ctx, "message created successfully",
		"messageID", message.ID.String(),
	)

	return fullMessage, nil
}

// broadcastNewMessage sends real-time notification to all channel members (excluding author).
// This enables SSE streaming updates for users viewing the channel.
func (s *chatLogicImpl) broadcastNewMessage(
	ctx context.Context,
	tx database.DBTX,
	orgID, authorID dbuuid.UUID,
	message *database.GetMessageByIDRow,
	messageText string,
) (*database.ChatChannel, error) {
	channelID := message.ChannelID
	messageID := message.ID

	slog.DebugContext(ctx, "broadcasting new message",
		"function", "broadcastNewMessage",
		"messageID", messageID.String(),
		"channelID", channelID.String(),
	)

	// Get channel details for notification title
	channel, err := s.Queries.GetChannelByID(ctx, tx, &database.GetChannelByIDParams{
		ID:             channelID,
		OrganizationID: orgID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get channel: %w", err)
	}

	// Extract author name from message
	authorName := "Someone" // Fallback
	if message.AuthorName != "" {
		authorName = message.AuthorName
	}

	// List channel members for notification
	members, err := s.Queries.ListChannelMembersForNotification(ctx, tx, &database.ListChannelMembersForNotificationParams{
		ChannelID:      channelID,
		OrganizationID: orgID,
		Column3:        false, // is_mention = false (all members get new message events)
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list channel members: %w", err)
	}

	// Build recipient list (include all members, including the author).
	// The author needs to receive the SSE event so that their other open
	// sessions (e.g. a second browser tab/device) also see the new message.
	// The active sender tab is handled separately via the mutation onSuccess
	// callback, and frontend deduplication prevents double-rendering there.
	recipientIDs := make([]string, 0, len(members))
	for _, member := range members {
		recipientIDs = append(recipientIDs, member.EmployeeID.String())
	}

	if len(recipientIDs) == 0 {
		slog.DebugContext(ctx, "no recipients for broadcast (empty channel)",
			"channelID", channelID.String(),
		)
		return channel, nil
	}

	previewText := messageNotificationPreview(messageText, 200)
	if previewText == "" {
		previewText = "Sent a message"
	}

	actionData := buildChatNotificationActionData(
		channel,
		messageID,
		authorID,
		authorName,
		"new_message",
		nil,
	)

	// Format notification title based on channel type
	var title string
	deliveryClass := notification.DeliveryClassLiveOnly
	if channel.ChannelType == ChannelTypeDirectMessage {
		// Direct message: "{{authorName}} direct messaged you"
		title = fmt.Sprintf("%s direct messaged you", authorName)
		deliveryClass = notification.DeliveryClassPersistent
	} else {
		// Regular channel: "{{authorName}} in #{{channelSlug}}"
		title = fmt.Sprintf("%s in #%s", authorName, channel.TitleSlug)
	}

	// Publish streaming notification for real-time updates
	if _, err := s.NotificationPublisher.PublishNotification(ctx, tx, &rpcv1.PublishNotificationRequest{
		SourceDomain:     ChannelTypeChat,
		NotificationType: NotificationTypeMessage,
		OrganizationId:   orgID.String(),
		Recipients: &rpcv1.NotificationRecipients{
			EmployeeIds: recipientIDs,
		},
		Title:          title,
		Message:        previewText,
		ActionData:     actionData,
		Priority:       notification.PriorityAlways,
		PolicyKey:      notification.PolicyKeyChatMessage,
		DeliveryClass:  deliveryClass,
		SourceCategory: notification.SourceCategoryActivity,
		NavigationTarget: &rpcv1.NavigationTarget{
			Domain:       notification.SourceDomainChat,
			ResourceType: "channel",
			ResourceId:   channelID.String(),
		},
	}); err != nil {
		slog.ErrorContext(ctx, "failed to publish message notification",
			"error", err,
			"messageID", messageID.String(),
		)
		return nil, fmt.Errorf("failed to publish message notification: %w", err)
	}

	slog.InfoContext(ctx, "💬 message notification published to channel members",
		"messageID", messageID.String(),
		"recipientCount", len(recipientIDs),
	)

	return channel, nil
}

// notifyMentionedUsersV2 sends targeted @mention notifications for TipTap-formatted mentions.
// Handles both employee mentions and department mentions with proper expansion logic.
// For private channels, only notifies department members who are channel members.
func (s *chatLogicImpl) notifyMentionedUsersV2(
	ctx context.Context,
	tx database.DBTX,
	orgID, authorID, channelID dbuuid.UUID,
	fullMessage *database.GetMessageByIDRow,
	messageText string,
	mentions []MentionData,
) error {
	slog.DebugContext(ctx, "notifying mentioned users (v2)",
		"function", "notifyMentionedUsersV2",
		"messageID", fullMessage.ID.String(),
		"mentionCount", len(mentions),
	)

	// Get channel details for notification title and privacy check
	channel, err := s.Queries.GetChannelByID(ctx, tx, &database.GetChannelByIDParams{
		ID:             channelID,
		OrganizationID: orgID,
	})
	if err != nil {
		return fmt.Errorf("failed to get channel: %w", err)
	}

	// Collect all employee IDs to notify (deduplicated)
	employeeIDsToNotify := make(map[dbuuid.UUID]bool)

	// Process mentions
	for _, mention := range mentions {
		switch mention.Type {
		case "employee":
			// Direct employee mention - add to notification list
			employeeID, err := dbuuid.Parse(mention.ID)
			if err != nil {
				slog.WarnContext(ctx, "invalid employee ID in mention",
					"mentionID", mention.ID,
					"error", err,
				)
				continue
			}
			employeeIDsToNotify[employeeID] = true

		case "department":
			// Department mention - expand to all department members
			deptID, err := dbuuid.Parse(mention.ID)
			if err != nil {
				slog.WarnContext(ctx, "invalid department ID in mention",
					"mentionID", mention.ID,
					"error", err,
				)
				continue
			}

			// Get all department members
			deptMembers, err := s.Queries.GetDepartmentMembers(ctx, tx, &database.GetDepartmentMembersParams{
				DepartmentID:   deptID,
				OrganizationID: orgID,
			})
			if err != nil {
				slog.WarnContext(ctx, "failed to get department members",
					"departmentID", deptID.String(),
					"error", err,
				)
				continue
			}

			slog.DebugContext(ctx, "retrieved department members",
				"departmentID", deptID.String(),
				"memberCount", len(deptMembers),
				"organizationID", orgID.String(),
			)

			// For private channels, only include members who have channel access
			if channel.IsPrivate {
				for _, member := range deptMembers {
					slog.DebugContext(ctx, "checking private channel membership",
						"employeeID", member.EmployeeID.String(),
						"channelID", channelID.String(),
						"organizationID", orgID.String(),
					)

					// Check if employee is channel member
					_, err := s.Queries.GetChannelMembership(ctx, tx, &database.GetChannelMembershipParams{
						ChannelID:      channelID,
						EmployeeID:     member.EmployeeID,
						OrganizationID: orgID,
					})
					if err == nil {
						// Employee is channel member, include in notifications
						employeeIDsToNotify[dbuuid.UUID(member.EmployeeID)] = true
						slog.DebugContext(ctx, "added channel member to notification list",
							"employeeID", member.EmployeeID.String(),
						)
					}
				}
			} else {
				// Public channel - include all department members
				for _, member := range deptMembers {
					employeeIDsToNotify[dbuuid.UUID(member.EmployeeID)] = true
					slog.DebugContext(ctx, "added department member to notification list",
						"employeeID", member.EmployeeID.String(),
						"departmentID", deptID.String(),
						"organizationID", orgID.String(),
					)
				}
			}
		}
	}

	// Remove author from notification list (no self-mentions)
	delete(employeeIDsToNotify, authorID)

	if len(employeeIDsToNotify) == 0 {
		slog.DebugContext(ctx, "no valid employees to notify",
			"messageID", fullMessage.ID.String(),
		)
		return nil
	}

	// Extract author name from message
	authorName := "Someone" // Fallback
	if fullMessage.AuthorName != "" {
		authorName = fullMessage.AuthorName
	}

	previewText := messageNotificationPreview(messageText, 200)
	if previewText == "" {
		previewText = "Mentioned you"
	}

	// Publish notifications for all mentioned employees
	actionData := buildChatNotificationActionData(
		channel,
		fullMessage.ID,
		authorID,
		authorName,
		"view_message",
		nil,
	)

	// Format title based on channel type
	var title string
	if channel.ChannelType == ChannelTypeDirectMessage {
		title = fmt.Sprintf("%s mentioned you", authorName)
	} else {
		title = fmt.Sprintf("%s mentioned you in #%s", authorName, channel.TitleSlug)
	}

	// Convert map keys to string slice
	employeeIDStrings := make([]string, 0, len(employeeIDsToNotify))
	for empID := range employeeIDsToNotify {
		employeeIDStrings = append(employeeIDStrings, empID.String())
	}

	_, err = s.NotificationPublisher.PublishNotification(ctx, tx, &rpcv1.PublishNotificationRequest{
		SourceDomain:     ChannelTypeChat,
		NotificationType: NotificationTypeMention,
		OrganizationId:   orgID.String(),
		Recipients: &rpcv1.NotificationRecipients{
			EmployeeIds: employeeIDStrings,
		},
		Title:          title,
		Message:        previewText,
		ActionData:     actionData,
		Priority:       notification.PriorityAlways,
		PolicyKey:      notification.PolicyKeyChatMention,
		DeliveryClass:  notification.DeliveryClassPersistent,
		SourceCategory: notification.SourceCategoryMention,
		NavigationTarget: &rpcv1.NavigationTarget{
			Domain:       notification.SourceDomainChat,
			ResourceType: "channel",
			ResourceId:   channelID.String(),
		},
	})
	if err != nil {
		return fmt.Errorf("failed to publish mention notifications: %w", err)
	}

	slog.InfoContext(ctx, "mention notifications completed",
		"messageID", fullMessage.ID.String(),
		"notifiedCount", len(employeeIDsToNotify),
	)

	return nil
}

// bridgeTaskChannelMessage checks whether a channel is a task discussion surface.
// If it is, this method:
//  1. Emits task_commented to all active parent-task subscribers (V2 bundle).
//  2. Auto-subscribes the message author to the parent task (commented reason).
//  3. Emits task_mentioned for any @mentions in the message.
func (s *chatLogicImpl) bridgeTaskChannelMessage(
	ctx context.Context,
	tx database.DBTX,
	orgID, authorID, channelID dbuuid.UUID,
	fullMessage *database.GetMessageByIDRow,
	messageText string,
	mentions []MentionData,
) {
	if s.NotificationPublisher == nil {
		return
	}

	// Look up whether this channel is a task discussion surface.
	surface, err := s.Queries.GetResourceSurfaceBySurface(ctx, tx, &database.GetResourceSurfaceBySurfaceParams{
		OrganizationID:    orgID,
		SurfaceDomain:     notification.ResourceSurfaceDomainChatChannel,
		SurfaceResourceID: channelID,
	})
	if err != nil {
		// Not a task channel — nothing to bridge.
		return
	}
	if surface.SurfaceType != notification.ResourceSurfaceTypeTaskDiscussion {
		return
	}

	parentTaskID := dbuuid.UUID(surface.ParentResourceID)
	parentTask, err := s.Queries.GetTask(ctx, tx, &database.GetTaskParams{
		OrganizationID: orgID,
		ID:             parentTaskID,
	})
	if err != nil {
		slog.WarnContext(ctx, "failed to load parent task for task discussion notification",
			"error", err, "taskID", parentTaskID,
		)
		return
	}
	projectID := dbuuid.UUID(parentTask.ProjectID)
	chatDeepLink := fmt.Sprintf("chat/%s", channelID.String())

	// Auto-subscribe the commenter to the parent task (V2 commented reason).
	s.ensureTaskCommentSubscription(ctx, tx, orgID, authorID, parentTaskID)

	// Auto-enroll the commenter in the task channel membership so the channel
	// appears in their chat sidebar.
	if err := s.Queries.EnsureChannelMembership(ctx, tx, &database.EnsureChannelMembershipParams{
		OrganizationID: orgID,
		ChannelID:      channelID,
		EmployeeID:     authorID,
	}); err != nil {
		slog.WarnContext(ctx, "failed to enroll commenter in task channel membership",
			"error", err, "channelID", channelID, "employeeID", authorID,
		)
	}

	// Resolve parent-task subscribers for task_commented notification.
	subscribers, err := s.Queries.ListActiveResourceSubscriptionsByResource(ctx, tx, &database.ListActiveResourceSubscriptionsByResourceParams{
		OrganizationID: orgID,
		ResourceDomain: notification.ResourceDomainTask,
		ResourceID:     parentTaskID,
	})
	if err != nil {
		slog.WarnContext(ctx, "failed to list task subscribers for task_commented bridge",
			"error", err, "taskID", parentTaskID,
		)
		return
	}

	// Build recipient set from active subscribers, excluding the message author.
	recipientIDs := make([]string, 0, len(subscribers))
	for _, sub := range subscribers {
		if dbuuid.UUID(sub.EmployeeID) == authorID {
			continue
		}
		// Respect preference: muted → skip; mentions → skip routine activity.
		switch sub.PreferenceLevel {
		case notification.NotificationPreferenceMuted:
			continue
		case notification.NotificationPreferenceMentions:
			continue // task_commented is subscribed_activity, not direct_targeted
		}
		recipientIDs = append(recipientIDs, sub.EmployeeID.String())
	}

	previewText := messageNotificationPreview(messageText, 200)
	if previewText == "" {
		previewText = "Commented on task"
	}

	authorName := "Someone"
	if fullMessage.AuthorName != "" {
		authorName = fullMessage.AuthorName
	}

	// Emit task_commented to parent-task subscribers.
	if len(recipientIDs) > 0 {
		_, err = s.NotificationPublisher.PublishNotification(ctx, tx, &rpcv1.PublishNotificationRequest{
			OrganizationId:   orgID.String(),
			SourceDomain:     notification.SourceDomainProjects,
			NotificationType: notification.NotificationTypeTaskCommented,
			Recipients: &rpcv1.NotificationRecipients{
				EmployeeIds: recipientIDs,
			},
			Title:          fmt.Sprintf("%s commented on task", authorName),
			Message:        previewText,
			Priority:       int32(notification.PriorityDefault),
			PolicyKey:      notification.PolicyKeyTaskComment,
			DeliveryClass:  notification.DeliveryClassPersistent,
			SourceCategory: notification.SourceCategoryActivity,
			ActionData: map[string]string{
				"projectId": projectID.String(),
				"taskId":    parentTaskID.String(),
				"channelId": channelID.String(),
				"messageId": fullMessage.ID.String(),
				"deepLink":  chatDeepLink,
			},
			NavigationTarget: &rpcv1.NavigationTarget{
				Domain:       notification.SourceDomainProjects,
				ResourceType: "task",
				ResourceId:   parentTaskID.String(),
				SecondaryId:  channelID.String(),
			},
		})
		if err != nil {
			slog.WarnContext(ctx, "failed to publish task_commented bridge notification",
				"error", err, "taskID", parentTaskID,
			)
		}
	}

	// Emit task_mentioned for any @mentions in the message.
	if len(mentions) > 0 {
		mentionedIDs := make([]string, 0, len(mentions))
		for _, m := range mentions {
			if m.Type != "employee" {
				continue
			}
			empID, err := dbuuid.Parse(m.ID)
			if err != nil {
				continue
			}
			if empID == authorID {
				continue
			}
			// Auto-enroll mentioned employee in task channel membership.
			if err := s.Queries.EnsureChannelMembership(ctx, tx, &database.EnsureChannelMembershipParams{
				OrganizationID: orgID,
				ChannelID:      channelID,
				EmployeeID:     empID,
			}); err != nil {
				slog.WarnContext(ctx, "failed to enroll mentioned employee in task channel membership",
					"error", err, "channelID", channelID, "employeeID", empID,
				)
			}
			mentionedIDs = append(mentionedIDs, empID.String())
		}
		if len(mentionedIDs) > 0 {
			_, err = s.NotificationPublisher.PublishNotification(ctx, tx, &rpcv1.PublishNotificationRequest{
				OrganizationId:   orgID.String(),
				SourceDomain:     notification.SourceDomainProjects,
				NotificationType: notification.NotificationTypeTaskMentioned,
				Recipients: &rpcv1.NotificationRecipients{
					EmployeeIds: mentionedIDs,
				},
				Title:          fmt.Sprintf("%s mentioned you in task discussion", authorName),
				Message:        previewText,
				Priority:       int32(notification.PriorityAlways),
				PolicyKey:      notification.PolicyKeyTaskMention,
				DeliveryClass:  notification.DeliveryClassPersistent,
				SourceCategory: notification.SourceCategoryMention,
				ActionData: map[string]string{
					"projectId": projectID.String(),
					"taskId":    parentTaskID.String(),
					"channelId": channelID.String(),
					"messageId": fullMessage.ID.String(),
					"deepLink":  chatDeepLink,
				},
				NavigationTarget: &rpcv1.NavigationTarget{
					Domain:       notification.SourceDomainProjects,
					ResourceType: "task",
					ResourceId:   parentTaskID.String(),
					SecondaryId:  channelID.String(),
				},
			})
			if err != nil {
				slog.WarnContext(ctx, "failed to publish task_mentioned bridge notification",
					"error", err, "taskID", parentTaskID,
				)
			}
		}
	}
}

// ensureTaskCommentSubscription upserts a V2 resource_subscription for the parent
// task with a 'commented' reason, so the commenter receives future task activity.
func (s *chatLogicImpl) ensureTaskCommentSubscription(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID, taskID dbuuid.UUID,
) {
	// Preserve existing preference if subscription already exists.
	preferenceLevel := notification.NotificationPreferenceAll
	existing, err := s.Queries.GetResourceSubscriptionByEmployee(ctx, tx, &database.GetResourceSubscriptionByEmployeeParams{
		OrganizationID: orgID,
		EmployeeID:     employeeID,
		ResourceDomain: notification.ResourceDomainTask,
		ResourceID:     taskID,
	})
	if err == nil {
		preferenceLevel = existing.PreferenceLevel
	}

	sub, err := s.Queries.UpsertResourceSubscription(ctx, tx, &database.UpsertResourceSubscriptionParams{
		OrganizationID:    orgID,
		EmployeeID:        employeeID,
		ResourceDomain:    notification.ResourceDomainTask,
		ResourceID:        taskID,
		SubscriptionState: notification.ResourceSubscriptionStateActive,
		PreferenceLevel:   preferenceLevel,
		UpdatedAt:         pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
	if err != nil {
		slog.WarnContext(ctx, "failed to upsert task subscription for commenter",
			"error", err, "taskID", taskID, "employeeID", employeeID,
		)
		return
	}

	if err := s.Queries.AddResourceSubscriptionReason(ctx, tx, &database.AddResourceSubscriptionReasonParams{
		OrganizationID: sub.OrganizationID,
		SubscriptionID: sub.ID,
		ReasonType:     notification.ResourceSubscriptionReasonCommented,
		ReasonRefType:  pgtype.Text{},
		ReasonRefID:    dbuuid.NullUUID{},
		CreatedAt:      pgtype.Timestamptz{Time: time.Now(), Valid: true},
	}); err != nil {
		slog.WarnContext(ctx, "failed to add commented reason for task subscription",
			"error", err, "taskID", taskID, "employeeID", employeeID,
		)
	}
}

func (s *chatLogicImpl) ReplyToMessage(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.ReplyToMessageRequest) (*rpcv1.Message, error) {
	slog.InfoContext(ctx, "replying to message",
		"function", "ReplyToMessage",
		"employeeID", employeeID.String(),
		"parentMessageID", req.ParentMessageId,
	)

	parentMessageID := dbuuid.MustParse(req.ParentMessageId)

	// Sanitize HTML (strips dangerous tags, preserves safe formatting)
	sanitizedText := sanitizeMessageHTML(req.MessageText)

	// Validate message length (after sanitization)
	if len(sanitizedText) == 0 || isHTMLContentEmpty(sanitizedText) {
		return nil, fmt.Errorf("message text cannot be empty")
	}
	if len(sanitizedText) > 10000 {
		return nil, fmt.Errorf("message text exceeds maximum length of 10000 characters")
	}

	// Verify parent message exists
	parentMessage, err := s.Queries.GetMessageByID(ctx, tx, &database.GetMessageByIDParams{
		ID:             parentMessageID,
		OrganizationID: orgID,
	})
	if err != nil {
		return nil, fmt.Errorf("parent message not found: %w", err)
	}

	// Enforce 1-level threading: parent must be top-level
	if parentMessage.ParentMessageID.Valid {
		return nil, fmt.Errorf("cannot reply to a reply (only 1-level threading supported)")
	}

	// Verify user is member of channel; for public channels, auto-join if not already a member
	_, err = s.Queries.GetChannelMembership(ctx, tx, &database.GetChannelMembershipParams{
		ChannelID:      parentMessage.ChannelID,
		EmployeeID:     employeeID,
		OrganizationID: orgID,
	})
	if err != nil {
		// Not a member — try to auto-join (JoinChannel handles public/private distinction)
		if _, joinErr := s.JoinChannel(ctx, tx, orgID, employeeID, parentMessage.ChannelID); joinErr != nil {
			return nil, fmt.Errorf("not a member of channel")
		}
	}

	// Parse mentions and convert to JSON
	replyMentions := parseTipTapMentions(sanitizedText)
	var mentionsJSON []byte
	if len(replyMentions) > 0 {
		mentionsJSON, err = json.Marshal(replyMentions)
		if err != nil {
			slog.WarnContext(ctx, "failed to marshal mentions in reply, continuing without metadata",
				"error", err,
			)
			mentionsJSON = nil
		}
	}

	// Convert file_ids slice to JSONB for storage
	var fileIDs []dbuuid.UUID
	for _, fid := range req.FileIds {
		fileIDs = append(fileIDs, dbuuid.MustParse(fid))
	}

	// Create reply with sanitized HTML (PGroonga handles multilingual indexing automatically)
	message, err := s.Queries.CreateMessage(ctx, tx, &database.CreateMessageParams{
		OrganizationID:   orgID,
		ChannelID:        parentMessage.ChannelID,
		MessageText:      sanitizedText,
		AuthorEmployeeID: employeeID,
		ParentMessageID:  dbuuid.UUIDToNullUUID(parentMessageID),
		Mentions:         mentionsJSON,
		FileIds:          fileIDs,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create reply: %w", err)
	}

	// Fetch full message with author details (for reply author name and proto conversion)
	fullMessage, err := s.Queries.GetMessageByID(ctx, tx, &database.GetMessageByIDParams{
		ID:             message.ID,
		OrganizationID: orgID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to fetch created reply: %w", err)
	}

	// Get channel details for notifications
	channel, err := s.Queries.GetChannelByID(ctx, tx, &database.GetChannelByIDParams{
		ID:             parentMessage.ChannelID,
		OrganizationID: orgID,
	})
	if err != nil {
		slog.WarnContext(ctx, "failed to get channel for reply notification",
			"error", err,
			"channelID", parentMessage.ChannelID.String(),
		)
	} else {
		// Extract reply author name
		replyAuthorName := "Someone" // Fallback
		if fullMessage.AuthorName != "" {
			replyAuthorName = fullMessage.AuthorName
		}

		previewText := messageNotificationPreview(sanitizedText, 200)
		if previewText == "" {
			previewText = "Replied to a message"
		}

		// Publish real-time reply notification to all channel members (for SSE streaming)
		members, err := s.Queries.ListChannelMembersForNotification(ctx, tx, &database.ListChannelMembersForNotificationParams{
			ChannelID:      parentMessage.ChannelID,
			OrganizationID: orgID,
			Column3:        false, // is_mention = false (all members get new reply events)
		})
		if err != nil {
			slog.ErrorContext(ctx, "failed to list channel members for reply notification",
				"error", err,
				"channelID", parentMessage.ChannelID.String(),
			)
		} else {
			// Build recipient list (exclude reply author)
			recipientIDs := make([]string, 0, len(members))
			for _, member := range members {
				if member.EmployeeID != employeeID {
					recipientIDs = append(recipientIDs, member.EmployeeID.String())
				}
			}

			if len(recipientIDs) > 0 {
				actionData := buildChatNotificationActionData(
					channel,
					message.ID,
					employeeID,
					replyAuthorName,
					"new_reply",
					map[string]string{
						"parentMessageId": parentMessageID.String(),
					},
				)

				// Format title based on channel type
				var title string
				if channel.ChannelType == ChannelTypeDirectMessage {
					// Direct message: "{{authorName}} replied to you"
					title = fmt.Sprintf("%s replied to you", replyAuthorName)
				} else {
					// Regular channel: "{{authorName}} replied in #{{channelSlug}}"
					title = fmt.Sprintf("%s replied in #%s", replyAuthorName, channel.TitleSlug)
				}

				// Publish streaming notification for real-time updates
				_, err = s.NotificationPublisher.PublishNotification(ctx, tx, &rpcv1.PublishNotificationRequest{
					SourceDomain:     ChannelTypeChat,
					NotificationType: NotificationTypeReply,
					OrganizationId:   orgID.String(),
					Recipients: &rpcv1.NotificationRecipients{
						EmployeeIds: recipientIDs,
					},
					Title:          title,
					Message:        previewText,
					ActionData:     actionData,
					Priority:       0,
					PolicyKey:      notification.PolicyKeyChatReply,
					DeliveryClass:  notification.DeliveryClassPersistent,
					SourceCategory: notification.SourceCategoryActivity,
					NavigationTarget: &rpcv1.NavigationTarget{
						Domain:       notification.SourceDomainChat,
						ResourceType: "channel",
						ResourceId:   parentMessage.ChannelID.String(),
					},
				})
				if err != nil {
					slog.ErrorContext(ctx, "failed to publish reply streaming notification",
						"error", err,
						"messageID", message.ID.String(),
						"recipientCount", len(recipientIDs),
					)
				} else {
					slog.InfoContext(ctx, "reply streaming notification published to channel members",
						"messageID", message.ID.String(),
						"recipientCount", len(recipientIDs),
					)
				}
			}
		}
	}

	// Send targeted notification to parent message author (unless replying to self)
	if parentMessage.AuthorEmployeeID != employeeID && channel != nil {
		// Extract reply author name
		replyAuthorName := "Someone" // Fallback
		if fullMessage.AuthorName != "" {
			replyAuthorName = fullMessage.AuthorName
		}

		previewText := messageNotificationPreview(sanitizedText, 200)
		if previewText == "" {
			previewText = "Replied to your message"
		}

		actionData := buildChatNotificationActionData(
			channel,
			message.ID,
			employeeID,
			replyAuthorName,
			"view_thread",
			map[string]string{
				"parentMessageId": parentMessageID.String(),
			},
		)

		// Format title based on channel type
		var title string
		if channel.ChannelType == ChannelTypeDirectMessage {
			// Direct message: "{{authorName}} replied to you"
			title = fmt.Sprintf("%s replied to you", replyAuthorName)
		} else {
			// Regular channel: "{{authorName}} replied to your message in #{{channelSlug}}"
			title = fmt.Sprintf("%s replied to your message in #%s", replyAuthorName, channel.TitleSlug)
		}

		_, err = s.NotificationPublisher.PublishNotification(ctx, tx, &rpcv1.PublishNotificationRequest{
			SourceDomain:     ChannelTypeChat,
			NotificationType: NotificationTypeReply,
			OrganizationId:   orgID.String(),
			Recipients: &rpcv1.NotificationRecipients{
				EmployeeIds: []string{parentMessage.AuthorEmployeeID.String()},
			},
			Title:          title,
			Message:        previewText,
			ActionData:     actionData,
			Priority:       0,
			PolicyKey:      notification.PolicyKeyChatReply,
			DeliveryClass:  notification.DeliveryClassPersistent,
			SourceCategory: notification.SourceCategoryActivity,
			NavigationTarget: &rpcv1.NavigationTarget{
				Domain:       notification.SourceDomainChat,
				ResourceType: "channel",
				ResourceId:   parentMessage.ChannelID.String(),
			},
		})
		if err != nil {
			slog.ErrorContext(ctx, "failed to publish reply notification",
				"error", err,
				"parentAuthorID", parentMessage.AuthorEmployeeID.String(),
				"messageID", message.ID.String(),
			)
		} else {
			slog.InfoContext(ctx, "reply notification published",
				"parentAuthorID", parentMessage.AuthorEmployeeID.String(),
				"messageID", message.ID.String(),
			)
		}
	}

	// Send targeted notifications for @mentions in reply (parse from sanitized text)
	mentions := parseTipTapMentions(sanitizedText)
	if len(mentions) > 0 {
		if err := s.notifyMentionedUsersV2(ctx, tx, orgID, employeeID, parentMessage.ChannelID, fullMessage, sanitizedText, mentions); err != nil {
			slog.WarnContext(ctx, "failed to notify mentioned users in reply",
				"error", err,
				"messageID", fullMessage.ID.String(),
			)
		}
	}

	slog.InfoContext(ctx, "reply sent successfully",
		"messageID", message.ID.String(),
		"parentMessageID", parentMessageID.String(),
		"mentionCount", len(mentions),
	)

	return messageToProto(fullMessage, employeeID), nil
}

func (s *chatLogicImpl) EditMessage(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.EditMessageRequest) (*rpcv1.Message, error) {
	slog.InfoContext(ctx, "editing message",
		"function", "EditMessage",
		"employeeID", employeeID.String(),
		"messageID", req.MessageId,
	)

	messageID := dbuuid.MustParse(req.MessageId)

	// Sanitize HTML (strips dangerous tags, preserves safe formatting)
	sanitizedText := sanitizeMessageHTML(req.NewText)

	// Validate message length (after sanitization)
	if len(sanitizedText) == 0 || isHTMLContentEmpty(sanitizedText) {
		return nil, fmt.Errorf("message text cannot be empty")
	}
	if len(sanitizedText) > 10000 {
		return nil, fmt.Errorf("message text exceeds maximum length of 10000 characters")
	}

	// Verify message exists and user is author
	message, err := s.Queries.GetMessageByID(ctx, tx, &database.GetMessageByIDParams{
		ID:             messageID,
		OrganizationID: orgID,
	})
	if err != nil {
		return nil, fmt.Errorf("message not found: %w", err)
	}

	if message.AuthorEmployeeID != employeeID {
		return nil, fmt.Errorf("only message author can edit message")
	}

	if message.IsDeleted {
		return nil, fmt.Errorf("cannot edit deleted message")
	}

	// Update message with sanitized HTML
	updatedMessage, err := s.Queries.UpdateMessage(ctx, tx, &database.UpdateMessageParams{
		ID:             messageID,
		OrganizationID: orgID,
		MessageText:    sanitizedText,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to update message: %w", err)
	}

	slog.InfoContext(ctx, "message edited successfully",
		"messageID", messageID.String(),
	)

	// Fetch full message with author details
	fullMessage, err := s.Queries.GetMessageByID(ctx, tx, &database.GetMessageByIDParams{
		ID:             updatedMessage.ID,
		OrganizationID: orgID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to fetch updated message: %w", err)
	}

	return messageToProto(fullMessage, employeeID), nil
}

func (s *chatLogicImpl) DeleteMessage(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, messageID dbuuid.UUID) error {
	slog.InfoContext(ctx, "deleting message",
		"function", "DeleteMessage",
		"employeeID", employeeID.String(),
		"messageID", messageID.String(),
	)

	// Verify message exists
	message, err := s.Queries.GetMessageByID(ctx, tx, &database.GetMessageByIDParams{
		ID:             messageID,
		OrganizationID: orgID,
	})
	if err != nil {
		return fmt.Errorf("message not found: %w", err)
	}

	// Check if user is author or channel admin
	isAuthor := message.AuthorEmployeeID == employeeID
	isAdmin := false
	if !isAuthor {
		membership, err := s.Queries.GetChannelMembership(ctx, tx, &database.GetChannelMembershipParams{
			ChannelID:      message.ChannelID,
			EmployeeID:     employeeID,
			OrganizationID: orgID,
		})
		if err == nil {
			isAdmin = membership.IsAdmin
		}
	}

	if !isAuthor && !isAdmin {
		return fmt.Errorf("only message author or channel admin can delete message")
	}

	// Soft delete message
	_, err = s.Queries.SoftDeleteMessage(ctx, tx, &database.SoftDeleteMessageParams{
		ID:             messageID,
		OrganizationID: orgID,
	})
	if err != nil {
		return fmt.Errorf("failed to delete message: %w", err)
	}

	slog.InfoContext(ctx, "message deleted successfully",
		"messageID", messageID.String(),
	)

	return nil
}

func (s *chatLogicImpl) ListMessages(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.ListMessagesRequest) ([]*rpcv1.Message, string, string, error) {
	slog.InfoContext(ctx, "listing messages",
		"function", "ListMessages",
		"channelID", req.ChannelId,
	)

	channelID := dbuuid.MustParse(req.ChannelId)

	// Verify user is member of channel
	channel, err := s.Queries.GetChannelByID(ctx, tx, &database.GetChannelByIDParams{
		ID:             channelID,
		OrganizationID: orgID,
	})
	if err != nil {
		return nil, "", "", fmt.Errorf("channel not found: %w", err)
	}

	// For private channels, verify membership
	if channel.IsPrivate {
		_, err := s.Queries.GetChannelMembership(ctx, tx, &database.GetChannelMembershipParams{
			ChannelID:      channelID,
			EmployeeID:     employeeID,
			OrganizationID: orgID,
		})
		if err != nil {
			return nil, "", "", fmt.Errorf("access denied: not a member of private channel")
		}
	}

	// Parse cursor (UUID v7 - time-sortable)
	var cursorID dbuuid.NullUUID
	if req.PageToken != "" {
		parsed, err := uuid.Parse(req.PageToken)
		if err != nil {
			return nil, "", "", fmt.Errorf("invalid page token: %w", err)
		}
		cursorID = dbuuid.NullUUID{UUID: parsed, Valid: true}
	}

	pageSize := req.PageSize
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 50
	}

	direction := req.Direction
	if direction == rpcv1.ListMessagesDirection_LIST_MESSAGES_DIRECTION_UNSPECIFIED {
		direction = rpcv1.ListMessagesDirection_LIST_MESSAGES_DIRECTION_OLDER
	}

	var (
		result            []*rpcv1.Message
		previousPageToken string
		nextPageToken     string
	)

	// Anchor-based initialization takes precedence when provided without a cursor.
	if req.AnchorMessageId != "" && req.PageToken == "" {
		anchorID, err := dbuuid.Parse(req.AnchorMessageId)
		if err != nil {
			return nil, "", "", fmt.Errorf("invalid anchor message ID: %w", err)
		}

		anchorMessage, err := s.Queries.GetMessageByID(ctx, tx, &database.GetMessageByIDParams{
			ID:             anchorID,
			OrganizationID: orgID,
		})
		if err != nil {
			return nil, "", "", fmt.Errorf("anchor message not found: %w", err)
		}

		if anchorMessage.ChannelID != channelID {
			return nil, "", "", fmt.Errorf("anchor message not part of requested channel")
		}

		rows, err := s.Queries.ListChannelMessagesUpToAnchor(ctx, tx, &database.ListChannelMessagesUpToAnchorParams{
			ChannelID:      channelID,
			OrganizationID: orgID,
			AnchorID:       anchorID,
			Limit:          pageSize,
		})
		if err != nil {
			return nil, "", "", fmt.Errorf("failed to list messages up to anchor: %w", err)
		}

		result = make([]*rpcv1.Message, 0, len(rows))
		for i := len(rows) - 1; i >= 0; i-- {
			if msg := messageToProtoWithReplyCount(rows[i], employeeID); msg != nil {
				result = append(result, msg)
			}
		}

		if len(rows) == int(pageSize) {
			previousPageToken = rows[len(rows)-1].ID.String()
		}

		if len(result) > 0 {
			nextPageToken = result[len(result)-1].Id
		} else {
			nextPageToken = anchorID.String()
		}

		slog.DebugContext(ctx, "anchor pagination initialized",
			"function", "ListMessages",
			"channelID", channelID.String(),
			"anchorID", anchorID.String(),
			"messagesReturned", len(result),
			"pageSize", pageSize,
		)

		return result, previousPageToken, nextPageToken, nil
	}

	switch direction {
	case rpcv1.ListMessagesDirection_LIST_MESSAGES_DIRECTION_NEWER:
		if !cursorID.Valid {
			return nil, "", "", fmt.Errorf("page token is required when requesting newer messages")
		}

		rows, err := s.Queries.ListChannelMessagesAfter(ctx, tx, &database.ListChannelMessagesAfterParams{
			ChannelID:      channelID,
			OrganizationID: orgID,
			AfterID:        dbuuid.UUID(cursorID.UUID),
			Limit:          pageSize,
		})
		if err != nil {
			return nil, "", "", fmt.Errorf("failed to list newer messages: %w", err)
		}

		result = make([]*rpcv1.Message, 0, len(rows))
		for _, row := range rows {
			if msg := messageToProtoWithReplyCount(row, employeeID); msg != nil {
				result = append(result, msg)
			}
		}

		if len(result) > 0 {
			previousPageToken = result[0].Id
			nextPageToken = result[len(result)-1].Id
		} else {
			nextPageToken = req.PageToken
		}

		slog.DebugContext(ctx, "pagination: fetched newer messages",
			"function", "ListMessages",
			"channelID", channelID.String(),
			"fromCursor", req.PageToken,
			"messagesReturned", len(result),
			"pageSize", pageSize,
		)

		return result, previousPageToken, nextPageToken, nil

	default:
		rows, err := s.Queries.ListChannelMessages(ctx, tx, &database.ListChannelMessagesParams{
			ChannelID:      channelID,
			OrganizationID: orgID,
			CursorID:       cursorID,
			Limit:          pageSize,
		})
		if err != nil {
			return nil, "", "", fmt.Errorf("failed to list messages: %w", err)
		}

		result = make([]*rpcv1.Message, 0, len(rows))
		for i := len(rows) - 1; i >= 0; i-- {
			if msg := messageToProtoWithReplyCount(rows[i], employeeID); msg != nil {
				result = append(result, msg)
			}
		}

		if len(rows) == int(pageSize) {
			previousPageToken = rows[len(rows)-1].ID.String()
		}

		if len(rows) > 0 {
			nextPageToken = rows[0].ID.String()
		} else {
			nextPageToken = req.PageToken
		}

		slog.DebugContext(ctx, "pagination: fetched older messages",
			"function", "ListMessages",
			"channelID", channelID.String(),
			"messagesReturned", len(result),
			"pageSize", pageSize,
			"previousPageToken", previousPageToken,
			"nextPageToken", nextPageToken,
		)

		return result, previousPageToken, nextPageToken, nil
	}

}

func (s *chatLogicImpl) GetMessage(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, messageID dbuuid.UUID) (*rpcv1.Message, error) {
	slog.InfoContext(ctx, "getting message",
		"function", "GetMessage",
		"messageID", messageID.String(),
	)

	// Fetch message
	message, err := s.Queries.GetMessageByID(ctx, tx, &database.GetMessageByIDParams{
		ID:             messageID,
		OrganizationID: orgID,
	})
	if err != nil {
		return nil, fmt.Errorf("message not found: %w", err)
	}

	// Verify user has access to channel
	channel, err := s.Queries.GetChannelByID(ctx, tx, &database.GetChannelByIDParams{
		ID:             message.ChannelID,
		OrganizationID: orgID,
	})
	if err != nil {
		return nil, fmt.Errorf("channel not found: %w", err)
	}

	// For private channels, verify membership
	if channel.IsPrivate {
		_, err := s.Queries.GetChannelMembership(ctx, tx, &database.GetChannelMembershipParams{
			ChannelID:      message.ChannelID,
			EmployeeID:     employeeID,
			OrganizationID: orgID,
		})
		if err != nil {
			return nil, fmt.Errorf("access denied: not a member of private channel")
		}
	}

	return messageToProto(message, employeeID), nil
}

func (s *chatLogicImpl) ListReplies(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.ListRepliesRequest) ([]*rpcv1.Message, string, error) {
	slog.InfoContext(ctx, "listing replies",
		"function", "ListReplies",
		"parentMessageID", req.ParentMessageId,
	)

	parentMessageID := dbuuid.MustParse(req.ParentMessageId)

	// Verify parent message exists
	parentMessage, err := s.Queries.GetMessageByID(ctx, tx, &database.GetMessageByIDParams{
		ID:             parentMessageID,
		OrganizationID: orgID,
	})
	if err != nil {
		return nil, "", fmt.Errorf("parent message not found: %w", err)
	}

	// Verify user has access to channel
	channel, err := s.Queries.GetChannelByID(ctx, tx, &database.GetChannelByIDParams{
		ID:             parentMessage.ChannelID,
		OrganizationID: orgID,
	})
	if err != nil {
		return nil, "", fmt.Errorf("channel not found: %w", err)
	}

	// For private channels, verify membership
	if channel.IsPrivate {
		_, err := s.Queries.GetChannelMembership(ctx, tx, &database.GetChannelMembershipParams{
			ChannelID:      parentMessage.ChannelID,
			EmployeeID:     employeeID,
			OrganizationID: orgID,
		})
		if err != nil {
			return nil, "", fmt.Errorf("access denied: not a member of private channel")
		}
	}

	// List replies (no pagination for now, replies are typically few)
	replies, err := s.Queries.ListMessageReplies(ctx, tx, &database.ListMessageRepliesParams{
		ParentMessageID: dbuuid.UUIDToNullUUID(parentMessageID),
		OrganizationID:  orgID,
	})
	if err != nil {
		return nil, "", fmt.Errorf("failed to list replies: %w", err)
	}

	result := make([]*rpcv1.Message, 0, len(replies))
	for _, r := range replies {
		result = append(result, messageReplyToProto(r, employeeID))
	}

	return result, "", nil
}

// ============================================================================
// Message Navigation & Unread Tracking Implementation
// ============================================================================

// GetMessageById fetches a message by ID with channel context for notification navigation.
// Validates channel membership before returning message details.
func (s *chatLogicImpl) GetMessageById(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID, messageID dbuuid.UUID,
) (*rpcv1.GetMessageByIdResponse, error) {
	slog.InfoContext(ctx, "getting message by ID",
		"function", "GetMessageById",
		"messageID", messageID.String(),
		"employeeID", employeeID.String(),
	)

	// Fetch message with channel context
	message, err := s.Queries.GetMessageByIdWithChannel(ctx, tx, &database.GetMessageByIdWithChannelParams{
		ID:             messageID,
		OrganizationID: orgID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "message not found",
			"error", err,
			"messageID", messageID.String(),
		)
		return nil, fmt.Errorf("message not found: %w", err)
	}

	// Check channel membership (security check)
	membershipCheck, err := s.Queries.CheckChannelMembership(ctx, tx, &database.CheckChannelMembershipParams{
		EmployeeID:     employeeID,
		ChannelID:      message.ChatMessage.ChannelID,
		OrganizationID: orgID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to check membership",
			"error", err,
			"channelID", message.ChatMessage.ChannelID.String(),
		)
		return nil, fmt.Errorf("failed to verify channel access: %w", err)
	}

	if !membershipCheck {
		slog.WarnContext(ctx, "access denied: not a channel member",
			"employeeID", employeeID.String(),
			"channelID", message.ChatMessage.ChannelID.String(),
		)
		return nil, fmt.Errorf("access denied: not a member of this channel")
	}

	// Build response with message and channel context
	protoMessage := &rpcv1.Message{
		Id:               message.ChatMessage.ID.String(),
		OrganizationId:   message.ChatMessage.OrganizationID.String(),
		ChannelId:        message.ChatMessage.ChannelID.String(),
		MessageText:      message.ChatMessage.MessageText,
		AuthorEmployeeId: message.ChatMessage.AuthorEmployeeID.String(),
		AuthorName:       message.AuthorName.(string),
		AuthorEmail:      message.AuthorEmail,
		IsDeleted:        message.ChatMessage.IsDeleted,
		IsEdited:         message.ChatMessage.IsEdited,
		UpdatedAt:        timestamppb.New(message.ChatMessage.UpdatedAt.Time),
	}

	if message.ChatMessage.ParentMessageID.Valid {
		protoMessage.ParentMessageId = message.ChatMessage.ParentMessageID.UUID.String()
	}

	protoChannel := &rpcv1.Channel{
		Id:             message.ChatMessage.ChannelID.String(),
		OrganizationId: message.ChatMessage.OrganizationID.String(),
		TitleSlug:      message.ChannelSlug,
		DisplayName:    message.ChannelDisplayName,
		IsPrivate:      message.ChannelIsPrivate,
	}

	slog.InfoContext(ctx, "message retrieved successfully",
		"messageID", messageID.String(),
		"channelID", message.ChatMessage.ChannelID.String(),
	)

	return &rpcv1.GetMessageByIdResponse{
		Message:  protoMessage,
		Channel:  protoChannel,
		IsMember: membershipCheck,
	}, nil
}

// MarkChannelAsRead updates the last viewed message and timestamp for unread tracking.
// Returns remaining unread count after marking as read.
func (s *chatLogicImpl) MarkChannelAsRead(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID, channelID dbuuid.UUID,
	lastReadMessageID *dbuuid.UUID,
) (*rpcv1.MarkChannelAsReadResponse, error) {
	slog.InfoContext(ctx, "marking channel as read",
		"function", "MarkChannelAsRead",
		"channelID", channelID.String(),
		"employeeID", employeeID.String(),
	)

	// Check channel membership (security check)
	membershipCheck, err := s.Queries.CheckChannelMembership(ctx, tx, &database.CheckChannelMembershipParams{
		EmployeeID:     employeeID,
		ChannelID:      channelID,
		OrganizationID: orgID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to check membership",
			"error", err,
			"channelID", channelID.String(),
		)
		return nil, fmt.Errorf("failed to verify channel access: %w", err)
	}

	if !membershipCheck {
		slog.WarnContext(ctx, "access denied: not a channel member",
			"employeeID", employeeID.String(),
			"channelID", channelID.String(),
		)
		return nil, fmt.Errorf("access denied: not a member of this channel")
	}

	// Update last viewed timestamp and optionally message ID
	var lastMsgID dbuuid.NullUUID
	if lastReadMessageID != nil {
		lastMsgID = dbuuid.UUIDToNullUUID(*lastReadMessageID)
	}

	err = s.Queries.UpdateChannelMembershipLastViewed(ctx, tx, &database.UpdateChannelMembershipLastViewedParams{
		LastViewedMessageID: lastMsgID,
		EmployeeID:          employeeID,
		ChannelID:           channelID,
		OrganizationID:      orgID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update last viewed",
			"error", err,
			"channelID", channelID.String(),
		)
		return nil, fmt.Errorf("failed to mark channel as read: %w", err)
	}

	pendingRecipientIDs, err := s.Queries.ListPendingNotificationRecipientIDsByChannelDestination(ctx, tx, &database.ListPendingNotificationRecipientIDsByChannelDestinationParams{
		EmployeeID:     employeeID,
		OrganizationID: orgID,
		ChannelID:      channelID.String(),
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to list pending notification recipients for channel acknowledgement",
			"error", err,
			"channelID", channelID.String(),
		)
		return nil, fmt.Errorf("failed to acknowledge channel notifications: %w", err)
	}

	if len(pendingRecipientIDs) > 0 {
		acknowledgedAt := pgtype.Timestamptz{Time: time.Now(), Valid: true}
		acknowledgementAction := pgtype.Text{String: notification.AckActionDestinationOpen, Valid: true}

		err = s.Queries.AcknowledgeNotificationsBatch(ctx, tx, &database.AcknowledgeNotificationsBatchParams{
			Column1:               pendingRecipientIDs,
			EmployeeID:            employeeID,
			OrganizationID:        orgID,
			AcknowledgedAt:        acknowledgedAt,
			AcknowledgementAction: acknowledgementAction,
		})
		if err != nil {
			slog.ErrorContext(ctx, "failed to acknowledge channel destination notifications",
				"error", err,
				"channelID", channelID.String(),
				"recipientCount", len(pendingRecipientIDs),
			)
			return nil, fmt.Errorf("failed to acknowledge channel notifications: %w", err)
		}
	}

	// Get remaining unread count
	unreadCount, err := s.Queries.GetUnreadMessageCount(ctx, tx, &database.GetUnreadMessageCountParams{
		EmployeeID:     employeeID,
		ChannelID:      channelID,
		OrganizationID: orgID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to get unread count",
			"error", err,
			"channelID", channelID.String(),
		)
		return nil, fmt.Errorf("failed to get unread count: %w", err)
	}

	slog.InfoContext(ctx, "channel marked as read",
		"channelID", channelID.String(),
		"unreadCount", unreadCount,
	)

	return &rpcv1.MarkChannelAsReadResponse{
		UnreadCount:  unreadCount,
		LastViewedAt: timestamppb.New(time.Now()),
	}, nil
}

// ============================================================================
// Reactions Implementation
// ============================================================================

func (s *chatLogicImpl) AddReaction(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.AddReactionRequest) (*rpcv1.Reaction, error) {
	slog.InfoContext(ctx, "adding reaction",
		"function", "AddReaction",
		"employeeID", employeeID.String(),
		"messageID", req.MessageId,
		"emojiCode", req.EmojiCode,
	)

	messageID := dbuuid.MustParse(req.MessageId)

	// Validate emoji: must be non-empty and contain no whitespace
	// Accepts: :emoji_name: format, Unicode emoji, or plain names like "thumbsup"
	if len(req.EmojiCode) == 0 {
		return nil, fmt.Errorf("invalid emoji format: emoji cannot be empty")
	}
	for _, r := range req.EmojiCode {
		if r == ' ' || r == '\t' || r == '\n' {
			return nil, fmt.Errorf("invalid emoji format (expected :emoji_name:, got %s)", req.EmojiCode)
		}
	}

	// Verify message exists and user has access
	message, err := s.Queries.GetMessageByID(ctx, tx, &database.GetMessageByIDParams{
		ID:             messageID,
		OrganizationID: orgID,
	})
	if err != nil {
		return nil, fmt.Errorf("message not found: %w", err)
	}

	// Verify user has access to channel
	channel, err := s.Queries.GetChannelByID(ctx, tx, &database.GetChannelByIDParams{
		ID:             message.ChannelID,
		OrganizationID: orgID,
	})
	if err != nil {
		return nil, fmt.Errorf("channel not found: %w", err)
	}

	// For private channels, verify membership
	if channel.IsPrivate {
		_, err := s.Queries.GetChannelMembership(ctx, tx, &database.GetChannelMembershipParams{
			ChannelID:      message.ChannelID,
			EmployeeID:     employeeID,
			OrganizationID: orgID,
		})
		if err != nil {
			return nil, fmt.Errorf("access denied: not a member of private channel")
		}
	}

	// Add reaction (idempotent due to ON CONFLICT DO NOTHING)
	reaction, err := s.Queries.AddReaction(ctx, tx, &database.AddReactionParams{
		OrganizationID: orgID,
		MessageID:      messageID,
		EmployeeID:     employeeID,
		EmojiCode:      req.EmojiCode,
		UpdatedAt:      pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to add reaction: %w", err)
	}

	slog.InfoContext(ctx, "reaction added successfully",
		"messageID", messageID.String(),
		"emojiCode", req.EmojiCode,
	)

	// Try to resolve reactor (current employee) display name for a friendly notification title
	reactorName := "Someone"
	if currentEmp, err := s.Queries.GetEmployeeByID(ctx, tx, &database.GetEmployeeByIDParams{
		ID:             employeeID,
		OrganizationID: orgID,
	}); err == nil {
		reactorName = strings.TrimSpace(currentEmp.GivenName + " " + currentEmp.FamilyName)
		if reactorName == "" {
			reactorName = currentEmp.Email
		}
	}
	title := fmt.Sprintf("%s reacted to your message", reactorName)
	messagePreview := req.EmojiCode

	resp, err := s.NotificationPublisher.PublishNotification(ctx, tx, &rpcv1.PublishNotificationRequest{
		OrganizationId: converter.UUIDToProto(orgID),
		Recipients: &rpcv1.NotificationRecipients{
			EmployeeIds: []string{message.AuthorEmployeeID.String()},
		},
		SourceDomain:     notification.SourceDomainChat,
		NotificationType: NotificationTypeReaction,
		ActionCategory:   notification.NotificationTypeReaction,
		ActionData: func() map[string]string {
			actionData := map[string]string{
				"channelId": message.ChannelID.String(),
				"messageId": message.ID.String(),
				"emojiCode": req.EmojiCode,
			}
			if message.ParentMessageID.Valid {
				actionData["parentMessageId"] = message.ParentMessageID.UUID.String()
			}
			return actionData
		}(),
		Title:           title,
		Message:         messagePreview,
		Priority:        int32(notification.PrioritySilent),
		ActiveChannelId: message.ChannelID.String(),
		PolicyKey:       notification.PolicyKeyChatReactionLive,
		DeliveryClass:   notification.DeliveryClassLiveOnly,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to publish reaction notification",
			"error", err,
			"messageID", message.ID.String(),
		)
	} else {
		slog.InfoContext(ctx, "reaction notification published",
			"notificationID", resp.NotificationId,
			"messageID", message.ID.String(),
		)
	}

	return &rpcv1.Reaction{
		Id:             reaction.ID.String(),
		OrganizationId: reaction.OrganizationID.String(),
		MessageId:      reaction.MessageID.String(),
		EmployeeId:     reaction.EmployeeID.String(),
		EmojiCode:      reaction.EmojiCode,
		UpdatedAt:      timestamppb.New(reaction.UpdatedAt.Time),
	}, nil
}

func (s *chatLogicImpl) RemoveReaction(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.RemoveReactionRequest) error {
	slog.InfoContext(ctx, "removing reaction",
		"function", "RemoveReaction",
		"employeeID", employeeID.String(),
		"messageID", req.MessageId,
		"emojiCode", req.EmojiCode,
	)

	messageID := dbuuid.MustParse(req.MessageId)

	// Verify message exists (for better error messages)
	message, err := s.Queries.GetMessageByID(ctx, tx, &database.GetMessageByIDParams{
		ID:             messageID,
		OrganizationID: orgID,
	})
	if err != nil {
		return fmt.Errorf("message not found: %w", err)
	}

	// Remove reaction (idempotent - no error if doesn't exist)
	err = s.Queries.RemoveReaction(ctx, tx, &database.RemoveReactionParams{
		MessageID:      messageID,
		EmployeeID:     employeeID,
		EmojiCode:      req.EmojiCode,
		OrganizationID: orgID,
	})
	if err != nil {
		return fmt.Errorf("failed to remove reaction: %w", err)
	}

	slog.InfoContext(ctx, "reaction removed successfully",
		"messageID", messageID.String(),
		"emojiCode", req.EmojiCode,
	)

	// Notify message author of reaction removal via ephemeral notification (no DB persist)
	removerName := "Someone"
	if currentEmp, err := s.Queries.GetEmployeeByID(ctx, tx, &database.GetEmployeeByIDParams{
		ID:             employeeID,
		OrganizationID: orgID,
	}); err == nil {
		removerName = strings.TrimSpace(currentEmp.GivenName + " " + currentEmp.FamilyName)
		if removerName == "" {
			removerName = currentEmp.Email
		}
	}
	title := fmt.Sprintf("%s removed a reaction from your message", removerName)
	messagePreview := req.EmojiCode

	if _, err := s.NotificationPublisher.PublishNotification(ctx, tx, &rpcv1.PublishNotificationRequest{
		OrganizationId: converter.UUIDToProto(orgID),
		Recipients: &rpcv1.NotificationRecipients{
			EmployeeIds: []string{message.AuthorEmployeeID.String()},
		},
		SourceDomain:     notification.SourceDomainChat,
		NotificationType: NotificationTypeReaction,
		ActionCategory:   notification.NotificationTypeReaction,
		ActionData: func() map[string]string {
			actionData := map[string]string{
				"channelId": message.ChannelID.String(),
				"messageId": message.ID.String(),
				"emojiCode": req.EmojiCode,
				"action":    "removed",
			}
			if message.ParentMessageID.Valid {
				actionData["parentMessageId"] = message.ParentMessageID.UUID.String()
			}
			return actionData
		}(),
		Title:           title,
		Message:         messagePreview,
		Priority:        int32(notification.PriorityOnline),
		ActiveChannelId: message.ChannelID.String(),
		PolicyKey:       notification.PolicyKeyChatReactionLive,
		DeliveryClass:   notification.DeliveryClassLiveOnly,
	}); err != nil {
		slog.ErrorContext(ctx, "failed to publish reaction-removed notification", "error", err)
	}

	return nil
}

func (s *chatLogicImpl) ListReactions(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, messageID dbuuid.UUID) ([]*rpcv1.ReactionSummary, error) {
	slog.InfoContext(ctx, "listing reactions",
		"function", "ListReactions",
		"messageID", messageID.String(),
	)

	// Verify message exists and user has access
	message, err := s.Queries.GetMessageByID(ctx, tx, &database.GetMessageByIDParams{
		ID:             messageID,
		OrganizationID: orgID,
	})
	if err != nil {
		return nil, fmt.Errorf("message not found: %w", err)
	}

	// Verify user has access to channel
	channel, err := s.Queries.GetChannelByID(ctx, tx, &database.GetChannelByIDParams{
		ID:             message.ChannelID,
		OrganizationID: orgID,
	})
	if err != nil {
		return nil, fmt.Errorf("channel not found: %w", err)
	}

	// For private channels, verify membership
	if channel.IsPrivate {
		_, err := s.Queries.GetChannelMembership(ctx, tx, &database.GetChannelMembershipParams{
			ChannelID:      message.ChannelID,
			EmployeeID:     employeeID,
			OrganizationID: orgID,
		})
		if err != nil {
			return nil, fmt.Errorf("access denied: not a member of private channel")
		}
	}

	// List reactions
	reactions, err := s.Queries.ListMessageReactions(ctx, tx, &database.ListMessageReactionsParams{
		MessageID:      messageID,
		OrganizationID: orgID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list reactions: %w", err)
	}

	result := make([]*rpcv1.ReactionSummary, 0, len(reactions))
	for _, r := range reactions {
		// Type assert employee_ids array (comes as []interface{} from PostgreSQL array_agg)
		employeeIDsInterface, ok := r.EmployeeIds.([]interface{})
		if !ok {
			slog.WarnContext(ctx, "unexpected type for employee_ids", "type", fmt.Sprintf("%T", r.EmployeeIds))
			continue
		}

		// Convert employee_ids to string array
		employeeIDs := make([]string, 0, len(employeeIDsInterface))
		currentUserReacted := false

		for _, idInterface := range employeeIDsInterface {
			// Each element is a UUID bytes array
			idBytes, ok := idInterface.([16]byte)
			if !ok {
				continue
			}
			id := dbuuid.UUID(idBytes)
			employeeIDs = append(employeeIDs, id.String())

			// Check if current user reacted
			if id == employeeID {
				currentUserReacted = true
			}
		}

		result = append(result, &rpcv1.ReactionSummary{
			EmojiCode:          r.EmojiCode,
			Count:              int32(r.Count),
			EmployeeIds:        employeeIDs,
			CurrentUserReacted: currentUserReacted,
		})
	}

	return result, nil
}

// StartTyping publishes an ephemeral typing indicator to other channel members.
func (s *chatLogicImpl) StartTyping(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.StartTypingRequest) (*rpcv1.StartTypingResponse, error) {

	channelID := dbuuid.MustParse(req.ChannelId)

	// Verify channel exists
	channel, err := s.Queries.GetChannelByID(ctx, tx, &database.GetChannelByIDParams{
		ID:             channelID,
		OrganizationID: orgID,
	})
	if err != nil {
		return &rpcv1.StartTypingResponse{Success: false}, fmt.Errorf("channel not found: %w", err)
	}

	// For private channels, verify membership
	if channel.IsPrivate {
		_, err := s.Queries.GetChannelMembership(ctx, tx, &database.GetChannelMembershipParams{
			ChannelID:      channelID,
			EmployeeID:     employeeID,
			OrganizationID: orgID,
		})
		if err != nil {
			return &rpcv1.StartTypingResponse{Success: false}, fmt.Errorf("access denied: not a member of private channel")
		}
	}

	typerName := "Someone"
	if emp, err := s.Queries.GetEmployeeByID(ctx, tx, &database.GetEmployeeByIDParams{ID: employeeID, OrganizationID: orgID}); err == nil {
		typerName = strings.TrimSpace(emp.GivenName + " " + emp.FamilyName)
		if typerName == "" {
			typerName = emp.Email
		}
	}

	// Build action data with optional parent message ID for thread support
	actionData := map[string]string{
		"channelId":  channelID.String(),
		"action":     "start",
		"employeeId": employeeID.String(),
	}
	if req.ParentMessageId != "" {
		actionData["parentMessageId"] = req.ParentMessageId
	}

	title := fmt.Sprintf("%s is typing...", typerName)
	slog.InfoContext(ctx, "StartTyping: publishing typing-start notification",
		"channel_id", channelID.String(),
		"parent_message_id", req.ParentMessageId)

	if _, err := s.NotificationPublisher.PublishNotification(ctx, tx, &rpcv1.PublishNotificationRequest{
		OrganizationId: converter.UUIDToProto(orgID),
		Recipients: &rpcv1.NotificationRecipients{
			EmployeeIds: []string{},
		},
		SourceDomain:     notification.SourceDomainChat,
		NotificationType: NotificationTypeTyping,
		ActionCategory:   notification.NotificationTypeTyping,
		ActionData:       actionData,
		Title:            title,
		Message:          "",
		Priority:         int32(notification.PrioritySilent),
		ActiveChannelId:  channelID.String(),
		PolicyKey:        notification.PolicyKeyChatTypingLive,
		DeliveryClass:    notification.DeliveryClassLiveOnly,
	}); err != nil {
		slog.ErrorContext(ctx, "failed to publish typing-start notification", "error", err)
	}

	return &rpcv1.StartTypingResponse{Success: true}, nil
}

// StopTyping publishes an ephemeral typing-stop indicator to other channel members.
func (s *chatLogicImpl) StopTyping(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.StopTypingRequest) (*rpcv1.StopTypingResponse, error) {
	channelID := dbuuid.MustParse(req.ChannelId)

	// Verify channel exists
	channel, err := s.Queries.GetChannelByID(ctx, tx, &database.GetChannelByIDParams{
		ID:             channelID,
		OrganizationID: orgID,
	})
	if err != nil {
		return &rpcv1.StopTypingResponse{Success: false}, fmt.Errorf("channel not found: %w", err)
	}

	// For private channels, verify membership
	if channel.IsPrivate {
		_, err := s.Queries.GetChannelMembership(ctx, tx, &database.GetChannelMembershipParams{
			ChannelID:      channelID,
			EmployeeID:     employeeID,
			OrganizationID: orgID,
		})
		if err != nil {
			return &rpcv1.StopTypingResponse{Success: false}, fmt.Errorf("access denied: not a member of private channel")
		}
	}

	// Build action data with optional parent message ID for thread support
	actionData := map[string]string{
		"channelId":  channelID.String(),
		"action":     "stop",
		"employeeId": employeeID.String(),
	}
	if req.ParentMessageId != "" {
		actionData["parentMessageId"] = req.ParentMessageId
	}

	if _, err := s.NotificationPublisher.PublishNotification(ctx, tx, &rpcv1.PublishNotificationRequest{
		OrganizationId: converter.UUIDToProto(orgID),
		Recipients: &rpcv1.NotificationRecipients{
			EmployeeIds: []string{},
		},
		SourceDomain:     notification.SourceDomainChat,
		NotificationType: NotificationTypeTyping,
		ActionCategory:   notification.NotificationTypeTyping,
		ActionData:       actionData,
		Title:            "",
		Message:          "",
		Priority:         int32(notification.PrioritySilent),
		ActiveChannelId:  channelID.String(),
		PolicyKey:        notification.PolicyKeyChatTypingLive,
		DeliveryClass:    notification.DeliveryClassLiveOnly,
	}); err != nil {
		slog.ErrorContext(ctx, "failed to publish typing-stop notification", "error", err)
	}

	return &rpcv1.StopTypingResponse{Success: true}, nil
}

// SearchChannels performs fuzzy search on channel names and descriptions with permission filtering.
// Returns only channels the employee can access (public or member of private).
func (s *chatLogicImpl) SearchChannels(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	queryText string,
	limit int32,
	cursor *dbuuid.UUID,
) ([]*database.SearchChannelsRow, error) {
	slog.DebugContext(ctx, "SearchChannels called",
		"org_id", orgID.String(),
		"employee_id", employeeID.String(),
		"query_text", queryText,
		"limit", limit,
	)

	// Validate inputs
	if queryText == "" {
		return nil, fmt.Errorf("query_text cannot be empty")
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}

	// Convert cursor pointer to NullUUID
	var cursorParam dbuuid.NullUUID
	if cursor != nil {
		cursorParam = dbuuid.UUIDToNullUUID(*cursor)
	}

	results, err := s.Queries.SearchChannels(ctx, tx, &database.SearchChannelsParams{
		OrganizationID: orgID,
		EmployeeID:     employeeID,
		QueryText:      queryText,
		Limit:          limit,
		Cursor:         cursorParam,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to search channels",
			"org_id", orgID.String(),
			"employee_id", employeeID.String(),
			"query_text", queryText,
			"error", err,
		)
		return nil, fmt.Errorf("failed to search channels: %w", err)
	}

	slog.DebugContext(ctx, "channel search completed",
		"org_id", orgID.String(),
		"result_count", len(results),
	)

	return results, nil
}

// SearchMessages performs fuzzy search on message content with permission filtering.
// Returns messages only from channels the employee can access.
func (s *chatLogicImpl) SearchMessages(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	queryText string,
	limit int32,
	cursor *dbuuid.UUID,
) ([]*database.SearchMessagesRow, error) {
	slog.DebugContext(ctx, "SearchMessages called",
		"org_id", orgID.String(),
		"employee_id", employeeID.String(),
		"query_text", queryText,
		"limit", limit,
	)

	// Validate inputs
	if queryText == "" {
		return nil, fmt.Errorf("query_text cannot be empty")
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}

	// Convert cursor pointer to NullUUID
	var cursorParam dbuuid.NullUUID
	if cursor != nil {
		cursorParam = dbuuid.UUIDToNullUUID(*cursor)
	}

	results, err := s.Queries.SearchMessages(ctx, tx, &database.SearchMessagesParams{
		OrganizationID: orgID,
		EmployeeID:     employeeID,
		QueryText:      queryText,
		Limit:          limit,
		Cursor:         cursorParam,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to search messages",
			"org_id", orgID.String(),
			"employee_id", employeeID.String(),
			"query_text", queryText,
			"error", err,
		)
		return nil, fmt.Errorf("failed to search messages: %w", err)
	}

	slog.DebugContext(ctx, "message search completed",
		"org_id", orgID.String(),
		"result_count", len(results),
	)

	return results, nil
}

// AutocompleteChannels provides prefix-based channel suggestions with permission filtering.
// Used for quick channel selection in UI.
func (s *chatLogicImpl) AutocompleteChannels(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	prefix string,
	limit int32,
) ([]*database.AutocompleteChannelsRow, error) {
	slog.DebugContext(ctx, "AutocompleteChannels called",
		"org_id", orgID.String(),
		"employee_id", employeeID.String(),
		"prefix", prefix,
		"limit", limit,
	)

	// Validate inputs
	if prefix == "" {
		return nil, fmt.Errorf("prefix cannot be empty")
	}
	if limit <= 0 {
		limit = 10
	}
	if limit > 20 {
		limit = 20
	}

	results, err := s.Queries.AutocompleteChannels(ctx, tx, &database.AutocompleteChannelsParams{
		OrganizationID: orgID,
		EmployeeID:     employeeID,
		Prefix:         pgtype.Text{String: prefix, Valid: true},
		Limit:          limit,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to autocomplete channels",
			"org_id", orgID.String(),
			"employee_id", employeeID.String(),
			"prefix", prefix,
			"error", err,
		)
		return nil, fmt.Errorf("failed to autocomplete channels: %w", err)
	}

	slog.DebugContext(ctx, "channel autocomplete completed",
		"org_id", orgID.String(),
		"result_count", len(results),
	)

	return results, nil
}

// =============================================================================
// DIRECT MESSAGE METHODS
// =============================================================================

// CreateOrGetDirectMessage finds or creates a direct message channel between two employees.
// Returns the existing channel if one exists, otherwise creates a new one.
func (s *chatLogicImpl) CreateOrGetDirectMessage(
	ctx context.Context,
	tx database.DBTX,
	orgID, currentEmployeeID, otherEmployeeID dbuuid.UUID,
) (*rpcv1.CreateOrGetDirectMessageResponse, error) {
	slog.InfoContext(ctx, "creating or getting direct message",
		"function", "CreateOrGetDirectMessage",
		"organizationID", orgID.String(),
		"currentEmployeeID", currentEmployeeID.String(),
		"otherEmployeeID", otherEmployeeID.String(),
	)

	// Validate that we're not creating a DM with ourselves
	if currentEmployeeID.String() == otherEmployeeID.String() {
		return nil, fmt.Errorf("cannot create direct message with yourself")
	}

	// A block refuses direct contact in both directions. The refusal deliberately
	// does not say who blocked whom: the blocked person must not learn they were
	// blocked (FR-020, FR-022).
	if s.ContactGuard != nil {
		blocked, err := s.ContactGuard.IsDirectContactBlocked(ctx, tx, orgID, currentEmployeeID, otherEmployeeID)
		if err != nil {
			return nil, fmt.Errorf("check direct contact block: %w", err)
		}
		if blocked {
			return nil, ErrDirectContactBlocked
		}
	}

	// Try to find existing DM channel between the two users
	existingChannel, err := s.Queries.FindDirectMessageChannel(ctx, tx, &database.FindDirectMessageChannelParams{
		OrganizationID: orgID,
		EmployeeID:     currentEmployeeID,
		EmployeeID_2:   otherEmployeeID,
	})

	if id, idErr := existingChannel.ID.UUIDValue(); err == nil && idErr == nil && id.Valid {
		// Existing channel found
		slog.DebugContext(ctx, "found existing direct message channel",
			"channel_id", existingChannel.ID.String(),
		)

		// Get participants for display
		participants, err := s.Queries.GetDirectMessageParticipants(ctx, tx, &database.GetDirectMessageParticipantsParams{
			ChannelID:      existingChannel.ID,
			OrganizationID: orgID,
			EmployeeID:     currentEmployeeID,
		})
		if err != nil {
			slog.ErrorContext(ctx, "failed to get DM participants",
				"channel_id", existingChannel.ID.String(),
				"error", err,
			)
			return nil, fmt.Errorf("failed to get participants: %w", err)
		}

		protoParticipants := make([]*rpcv1.DirectMessageParticipant, len(participants))
		for i, p := range participants {
			protoParticipants[i] = &rpcv1.DirectMessageParticipant{
				Id:         p.ID.String(),
				GivenName:  p.GivenName,
				FamilyName: p.FamilyName,
				Email:      p.Email,
			}
		}

		return &rpcv1.CreateOrGetDirectMessageResponse{
			Channel:      dbChannelToProto(existingChannel),
			WasCreated:   false,
			Participants: protoParticipants,
		}, nil
	}

	// No existing channel found - create a new DM channel
	slog.DebugContext(ctx, "creating new direct message channel")

	// Generate consistent slug for DM: dm-{smaller_uuid}-{larger_uuid}
	// Remove hyphens from UUIDs to fit within 64-char limit
	// Format: dm-{32chars}-{32chars} = 67 chars, so we truncate to first 30 chars of each UUID
	currentUUID := strings.ReplaceAll(currentEmployeeID.String(), "-", "")
	otherUUID := strings.ReplaceAll(otherEmployeeID.String(), "-", "")

	var slug string
	if currentEmployeeID.String() < otherEmployeeID.String() {
		// dm-{first30}-{first30} = 3 + 30 + 1 + 30 = 64 chars (exactly fits)
		slug = fmt.Sprintf("dm-%s-%s", currentUUID[:30], otherUUID[:30])
	} else {
		slug = fmt.Sprintf("dm-%s-%s", otherUUID[:30], currentUUID[:30])
	}

	// Get employee names for display_name
	currentEmployee, err := s.Queries.GetEmployeeByID(ctx, tx, &database.GetEmployeeByIDParams{
		ID:             currentEmployeeID,
		OrganizationID: orgID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get current employee: %w", err)
	}

	otherEmployee, err := s.Queries.GetEmployeeByID(ctx, tx, &database.GetEmployeeByIDParams{
		ID:             otherEmployeeID,
		OrganizationID: orgID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get other employee: %w", err)
	}

	displayName := fmt.Sprintf("%s %s & %s %s",
		currentEmployee.GivenName,
		currentEmployee.FamilyName,
		otherEmployee.GivenName,
		otherEmployee.FamilyName,
	)

	// Create DM channel (always private)
	newChannel, err := s.Queries.CreateDirectMessageChannel(ctx, tx, &database.CreateDirectMessageChannelParams{
		OrganizationID:      orgID,
		TitleSlug:           slug,
		DisplayName:         displayName,
		IsPrivate:           true,
		CreatedByEmployeeID: currentEmployeeID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create direct message channel",
			"error", err,
		)
		return nil, fmt.Errorf("failed to create DM channel: %w", err)
	}

	// Add both users as members (default notification preference: 'all')
	_, err = s.Queries.CreateChannelMembership(ctx, tx, &database.CreateChannelMembershipParams{
		OrganizationID:         orgID,
		ChannelID:              newChannel.ID,
		EmployeeID:             currentEmployeeID,
		IsAdmin:                false,
		NotificationPreference: NotificationPreferenceAll,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to add current employee to DM: %w", err)
	}

	_, err = s.Queries.CreateChannelMembership(ctx, tx, &database.CreateChannelMembershipParams{
		OrganizationID:         orgID,
		ChannelID:              newChannel.ID,
		EmployeeID:             otherEmployeeID,
		IsAdmin:                false,
		NotificationPreference: NotificationPreferenceAll,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to add other employee to DM: %w", err)
	}

	slog.InfoContext(ctx, "direct message channel created successfully",
		"channel_id", newChannel.ID.String(),
		"slug", slug,
	)

	// Get participants for response
	participants := []*rpcv1.DirectMessageParticipant{
		{
			Id:         otherEmployee.ID.String(),
			GivenName:  otherEmployee.GivenName,
			FamilyName: otherEmployee.FamilyName,
			Email:      otherEmployee.Email,
		},
	}

	return &rpcv1.CreateOrGetDirectMessageResponse{
		Channel:      dbChannelToProto(newChannel),
		WasCreated:   true,
		Participants: participants,
	}, nil
}

func (s *chatLogicImpl) AuthorizeVoiceChannel(ctx context.Context, tx database.DBTX, orgID, employeeID, channelID dbuuid.UUID) error {
	_, _, err := s.GetChannel(ctx, tx, orgID, employeeID, channelID)
	if err != nil {
		return fmt.Errorf("voice channel access denied: %w", err)
	}
	return nil
}

func (s *chatLogicImpl) AnnounceVoiceCallStarted(ctx context.Context, tx database.DBTX, orgID, actorID, channelID, callID dbuuid.UUID) error {
	return s.createVoiceSystemMessage(ctx, tx, orgID, actorID, channelID, callID, SystemEventTypeVoiceCallStarted, "Voice call started", "")
}

func (s *chatLogicImpl) AnnounceVoiceCallEnded(ctx context.Context, tx database.DBTX, orgID, actorID, channelID, callID dbuuid.UUID, outcome string) error {
	eventType := SystemEventTypeVoiceCallEnded
	messageText := "Voice call ended"
	switch outcome {
	case "missed":
		eventType = SystemEventTypeVoiceCallMissed
		messageText = "Voice call missed"
	case "declined":
		messageText = "Voice call declined"
	case "cancelled":
		eventType = SystemEventTypeVoiceCallCancelled
		messageText = "Voice call cancelled"
	}
	return s.createVoiceSystemMessage(ctx, tx, orgID, actorID, channelID, callID, eventType, messageText, outcome)
}

func (s *chatLogicImpl) CreateVoiceMessage(ctx context.Context, tx database.DBTX, orgID, senderID, channelID, voiceMessageID, fileID dbuuid.UUID, durationMs int64, mimeType string, waveformPeaks []float32, sizeBytes int64) (dbuuid.UUID, error) {
	metadata := map[string]any{
		"voiceMessageId": voiceMessageID.String(),
		"durationMs":     durationMs,
		"mimeType":       mimeType,
		"waveformPeaks":  waveformPeaks,
		"sizeBytes":      sizeBytes,
		"status":         "posted",
	}
	metadataJSON, err := json.Marshal(metadata)
	if err != nil {
		return dbuuid.UUID{}, fmt.Errorf("marshal voice message metadata: %w", err)
	}
	var messageID dbuuid.UUID
	if err := tx.QueryRow(ctx, `
INSERT INTO chat.message(
    id, organization_id, channel_id, message_text, author_employee_id,
    parent_message_id, mentions, file_ids, message_kind, metadata
) VALUES (
    uuidv7(), $1, $2, $3, $4,
    NULL, '[]'::jsonb, ARRAY[$5]::uuid[], 'voice', $6::jsonb
)
RETURNING id`, orgID, channelID, "Voice message", senderID, fileID, string(metadataJSON)).Scan(&messageID); err != nil {
		return dbuuid.UUID{}, fmt.Errorf("create voice message: %w", err)
	}
	return messageID, nil
}

func (s *chatLogicImpl) createVoiceSystemMessage(ctx context.Context, tx database.DBTX, orgID, actorID, channelID, callID dbuuid.UUID, eventType, messageText, outcome string) error {
	metadata := s.voiceCallTimelineMetadata(ctx, tx, orgID, callID, outcome)
	metadataJSON, err := json.Marshal(metadata)
	if err != nil {
		return fmt.Errorf("marshal voice system message metadata: %w", err)
	}

	if eventType != SystemEventTypeVoiceCallStarted {
		var timelineMessageID dbuuid.UUID
		err = tx.QueryRow(ctx, `
SELECT id
FROM chat.message
WHERE organization_id = $1
  AND channel_id = $2
  AND parent_message_id IS NULL
  AND message_kind = 'system'
  AND metadata->>'callId' = $3
ORDER BY id ASC
LIMIT 1`, orgID, channelID, callID.String()).Scan(&timelineMessageID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("find voice call timeline message: %w", err)
		}
		if err == nil {
			if _, err := tx.Exec(ctx, `
UPDATE chat.message
SET message_text = $4,
    author_employee_id = $5,
    system_event_type = $6,
    metadata = $7::jsonb,
    updated_at = now()
WHERE organization_id = $1
  AND channel_id = $2
  AND id = $3`, orgID, channelID, timelineMessageID, messageText, actorID, eventType, string(metadataJSON)); err != nil {
				return fmt.Errorf("update voice call timeline message: %w", err)
			}
			if _, err := tx.Exec(ctx, `
DELETE FROM chat.message
WHERE organization_id = $1
  AND channel_id = $2
  AND parent_message_id IS NULL
  AND message_kind = 'system'
  AND metadata->>'callId' = $3
  AND id <> $4`, orgID, channelID, callID.String(), timelineMessageID); err != nil {
				return fmt.Errorf("delete duplicate voice call timeline messages: %w", err)
			}
			return nil
		}
	}

	_, err = tx.Exec(ctx, `
INSERT INTO chat.message(
    id, organization_id, channel_id, message_text, author_employee_id,
    parent_message_id, mentions, file_ids, message_kind, system_event_type, metadata
) VALUES (
    uuidv7(), $1, $2, $3, $4,
    NULL, '[]'::jsonb, ARRAY[]::uuid[], 'system', $5, $6::jsonb
)`, orgID, channelID, messageText, actorID, eventType, string(metadataJSON))
	if err != nil {
		return fmt.Errorf("create voice system message: %w", err)
	}
	return nil
}

func (s *chatLogicImpl) voiceCallTimelineMetadata(ctx context.Context, tx database.DBTX, orgID, callID dbuuid.UUID, fallbackOutcome string) map[string]any {
	metadata := map[string]any{
		"callId": callID.String(),
	}

	var state string
	var outcome pgtype.Text
	var recordingStatus string
	var transcriptStatus string
	var startedAt pgtype.Timestamptz
	var endedAt pgtype.Timestamptz
	var participantCount int64
	err := tx.QueryRow(ctx, `
SELECT c.state,
       c.outcome,
       c.started_at,
       c.ended_at,
       c.recording_status,
       c.transcript_status,
       (
         SELECT COUNT(*)
         FROM voice.call_participant p
         WHERE p.organization_id = c.organization_id
           AND p.call_session_id = c.id
       ) AS participant_count
FROM voice.call_session c
WHERE c.organization_id = $1
  AND c.id = $2`, orgID, callID).Scan(&state, &outcome, &startedAt, &endedAt, &recordingStatus, &transcriptStatus, &participantCount)
	if err != nil {
		slog.WarnContext(ctx, "failed to load voice call timeline metadata", "error", err, "call_id", callID.String())
		if fallbackOutcome != "" {
			metadata["outcome"] = fallbackOutcome
		}
		return metadata
	}

	metadata["state"] = state
	metadata["participantCount"] = participantCount
	metadata["recordingStatus"] = recordingStatus
	metadata["transcriptStatus"] = transcriptStatus
	if outcome.Valid {
		metadata["outcome"] = outcome.String
	} else if fallbackOutcome != "" {
		metadata["outcome"] = fallbackOutcome
	}
	if startedAt.Valid {
		metadata["startedAt"] = startedAt.Time.UTC().Format(time.RFC3339Nano)
	}
	if endedAt.Valid {
		metadata["endedAt"] = endedAt.Time.UTC().Format(time.RFC3339Nano)
	}
	if startedAt.Valid && endedAt.Valid {
		metadata["durationMs"] = endedAt.Time.Sub(startedAt.Time).Milliseconds()
	}
	return metadata
}

// =============================================================================
// USER CHAT CONFIG METHODS
// =============================================================================

// GetUserChatConfig retrieves user's chat configuration (recent channels, pinned, sidebar state).
func (s *chatLogicImpl) GetUserChatConfig(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
) (*database.ChatUserChatConfig, error) {
	slog.DebugContext(ctx, "getting user chat config",
		"org_id", orgID.String(),
		"employee_id", employeeID.String(),
	)

	config, err := s.Queries.GetUserChatConfig(ctx, tx, &database.GetUserChatConfigParams{
		OrganizationID: orgID,
		EmployeeID:     employeeID,
	})
	if err != nil {
		// Return empty config if not found (user hasn't configured anything yet)
		slog.DebugContext(ctx, "user chat config not found, will create on first update",
			"org_id", orgID.String(),
			"employee_id", employeeID.String(),
		)
		return &database.ChatUserChatConfig{
			OrganizationID:           orgID,
			EmployeeID:               employeeID,
			ChannelCategories:        []byte("{}"),
			CategoryLimits:           []byte(`{"channels": 10, "direct_messages": 10, "archived": 5}`),
			PinnedChannelIds:         []dbuuid.UUID{},
			SidebarCategoryCollapsed: []byte("{}"),
		}, nil
	}

	return config, nil
}

// AddChannelToCategory adds a channel to user's visible channels with category assignment.
// Called when user joins a channel or starts a DM (makes it visible in sidebar).
func (s *chatLogicImpl) AddChannelToCategory(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	channelID dbuuid.UUID,
	category string,
) error {
	slog.DebugContext(ctx, "adding channel to category",
		"org_id", orgID.String(),
		"employee_id", employeeID.String(),
		"channel_id", channelID.String(),
		"category", category,
	)

	// Validate category
	validCategories := map[string]bool{
		"channels":        true,
		"direct_messages": true,
		"archived":        true,
	}
	if !validCategories[category] {
		return fmt.Errorf("invalid category: %s (must be one of: channels, direct_messages, archived)", category)
	}

	// Build initial channel_categories JSONB: {"channel_id": "category"}
	channelCategoriesMap := map[string]string{channelID.String(): category}
	channelCategoriesJSON, err := json.Marshal(channelCategoriesMap)
	if err != nil {
		return fmt.Errorf("failed to marshal channel_categories: %w", err)
	}

	// Build category value JSONB: "category"
	categoryValueJSON, err := json.Marshal(category)
	if err != nil {
		return fmt.Errorf("failed to marshal category_value: %w", err)
	}

	err = s.Queries.AddChannelToCategory(ctx, tx, &database.AddChannelToCategoryParams{
		OrganizationID:    dbuuid.UUID(orgID),
		EmployeeID:        dbuuid.UUID(employeeID),
		ChannelCategories: channelCategoriesJSON, // {"channel_id": "category"}
		UpdatedAt:         pgtype.Timestamptz{Time: time.Now(), Valid: true},
		ChannelID:         channelID.String(), // For jsonb_set path
		CategoryValue:     categoryValueJSON,  // "category"
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to add channel to category",
			"org_id", orgID.String(),
			"employee_id", employeeID.String(),
			"channel_id", channelID.String(),
			"category", category,
			"error", err,
		)
		return fmt.Errorf("failed to add channel to category: %w", err)
	}

	return nil
}

// UpdateChannelCategories bulk updates channel category mappings.
// Used for drag-and-drop reordering between categories.
func (s *chatLogicImpl) UpdateChannelCategories(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	channelCategories string,
) error {
	slog.DebugContext(ctx, "updating channel categories",
		"org_id", orgID.String(),
		"employee_id", employeeID.String(),
	)

	// Validate JSON format
	var categoriesMap map[string]string
	if err := json.Unmarshal([]byte(channelCategories), &categoriesMap); err != nil {
		return fmt.Errorf("invalid channel_categories JSON: %w", err)
	}

	// Validate category values
	validCategories := map[string]bool{
		"channels":        true,
		"direct_messages": true,
		"archived":        true,
	}
	for channelID, category := range categoriesMap {
		if !validCategories[category] {
			return fmt.Errorf("invalid category '%s' for channel %s", category, channelID)
		}
	}

	err := s.Queries.BulkUpdateChannelCategories(ctx, tx, &database.BulkUpdateChannelCategoriesParams{
		ChannelCategories: []byte(channelCategories),
		OrganizationID:    orgID,
		EmployeeID:        employeeID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update channel categories",
			"org_id", orgID.String(),
			"employee_id", employeeID.String(),
			"error", err,
		)
		return fmt.Errorf("failed to update channel categories: %w", err)
	}

	return nil
}

// UpdateCategoryLimits updates per-category limits configuration.
func (s *chatLogicImpl) UpdateCategoryLimits(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	categoryLimits string,
) error {
	slog.DebugContext(ctx, "updating category limits",
		"org_id", orgID.String(),
		"employee_id", employeeID.String(),
	)

	// Validate JSON format
	var limitsMap map[string]int
	if err := json.Unmarshal([]byte(categoryLimits), &limitsMap); err != nil {
		return fmt.Errorf("invalid category_limits JSON: %w", err)
	}

	// Validate limits are positive
	for category, limit := range limitsMap {
		if limit < 0 {
			return fmt.Errorf("category limit for '%s' must be non-negative, got %d", category, limit)
		}
		if limit > 100 {
			return fmt.Errorf("category limit for '%s' exceeds maximum of 100, got %d", category, limit)
		}
	}

	err := s.Queries.UpdateCategoryLimits(ctx, tx, &database.UpdateCategoryLimitsParams{
		CategoryLimits: []byte(categoryLimits),
		OrganizationID: orgID,
		EmployeeID:     employeeID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update category limits",
			"org_id", orgID.String(),
			"employee_id", employeeID.String(),
			"error", err,
		)
		return fmt.Errorf("failed to update category limits: %w", err)
	}

	return nil
}

// RemoveChannelFromVisible removes a channel from user's visible channels.
// Used when user hides/archives a channel or leaves it.
func (s *chatLogicImpl) RemoveChannelFromVisible(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	channelID dbuuid.UUID,
) error {
	slog.DebugContext(ctx, "removing channel from visible",
		"org_id", orgID.String(),
		"employee_id", employeeID.String(),
		"channel_id", channelID.String(),
	)

	err := s.Queries.RemoveChannelFromVisible(ctx, tx, &database.RemoveChannelFromVisibleParams{
		ChannelID:      channelID.String(),
		OrganizationID: orgID,
		EmployeeID:     employeeID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to remove channel from visible",
			"org_id", orgID.String(),
			"employee_id", employeeID.String(),
			"channel_id", channelID.String(),
			"error", err,
		)
		return fmt.Errorf("failed to remove channel from visible: %w", err)
	}

	return nil
}

// UpdateRecentChannels is deprecated - use AddChannelToCategory instead.
// Kept for backward compatibility with existing RPC calls.
func (s *chatLogicImpl) UpdateRecentChannels(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	channelIDs []dbuuid.UUID,
) error {
	// This is now a no-op or could auto-categorize channels
	slog.WarnContext(ctx, "UpdateRecentChannels is deprecated, use AddChannelToCategory",
		"org_id", orgID.String(),
		"employee_id", employeeID.String(),
	)
	return nil
}

// UpdatePinnedChannels updates the user's pinned channels list.
func (s *chatLogicImpl) UpdatePinnedChannels(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	channelIDs []dbuuid.UUID,
) error {
	slog.DebugContext(ctx, "updating pinned channels",
		"org_id", orgID.String(),
		"employee_id", employeeID.String(),
		"pinned_count", len(channelIDs),
	)

	// Convert to dbuuid.UUID
	dbuuids := make([]dbuuid.UUID, len(channelIDs))
	for i, id := range channelIDs {
		dbuuids[i] = dbuuid.UUID(id)
	}

	err := s.Queries.UpdatePinnedChannels(ctx, tx, &database.UpdatePinnedChannelsParams{
		PinnedChannelIds: dbuuids,
		OrganizationID:   orgID,
		EmployeeID:       employeeID,
		UpdatedAt:        pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update pinned channels",
			"org_id", orgID.String(),
			"employee_id", employeeID.String(),
			"error", err,
		)
		return fmt.Errorf("failed to update pinned channels: %w", err)
	}

	return nil
}

// UpdateSidebarCategoryCollapsed updates the sidebar category collapsed state.
func (s *chatLogicImpl) UpdateSidebarCategoryCollapsed(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	collapsedState string,
) error {
	slog.DebugContext(ctx, "updating sidebar category collapsed state",
		"org_id", orgID.String(),
		"employee_id", employeeID.String(),
	)

	// Convert JSON string to []byte
	collapsedBytes := []byte(collapsedState)

	err := s.Queries.UpdateSidebarCategoryCollapsed(ctx, tx, &database.UpdateSidebarCategoryCollapsedParams{
		SidebarCategoryCollapsed: collapsedBytes,
		OrganizationID:           orgID,
		EmployeeID:               employeeID,
		UpdatedAt:                pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update sidebar collapsed state",
			"org_id", orgID.String(),
			"employee_id", employeeID.String(),
			"error", err,
		)
		return fmt.Errorf("failed to update sidebar collapsed state: %w", err)
	}

	return nil
}

// ListRecentChannels returns user's visible channels (from channel_categories) with full details.
// Ordered by pinned status and most recent activity.
// Simplified implementation: SQL returns basic channels, application layer handles sorting and pinned status.
func (s *chatLogicImpl) ListRecentChannels(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
) ([]*rpcv1.ChannelWithDetails, error) {
	slog.DebugContext(ctx, "listing visible channels",
		"org_id", orgID.String(),
		"employee_id", employeeID.String(),
	)

	// Get channels (simplified SQL query without complex CTEs)
	channels, err := s.Queries.ListVisibleChannelsWithDetails(ctx, tx, &database.ListVisibleChannelsWithDetailsParams{
		OrganizationID: orgID,
		EmployeeID:     employeeID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "ListVisibleChannelsWithDetails failed",
			"org_id", orgID.String(),
			"employee_id", employeeID.String(),
			"error", err,
		)
		return nil, fmt.Errorf("failed to list recent channels: %w", err)
	}

	// Get user chat config for pinned channels (for sorting)
	userConfig, err := s.Queries.GetUserChatConfig(ctx, tx, &database.GetUserChatConfigParams{
		OrganizationID: orgID,
		EmployeeID:     employeeID,
	})
	if err != nil {
		// If no config exists yet, continue without pinned info
		slog.DebugContext(ctx, "no user chat config found, proceeding without pinned channels",
			"org_id", orgID.String(),
			"employee_id", employeeID.String(),
		)
	}

	// Build a set of pinned channel IDs for quick lookup
	pinnedSet := make(map[string]bool)
	if userConfig != nil && len(userConfig.PinnedChannelIds) > 0 {
		for _, pinnedID := range userConfig.PinnedChannelIds {
			pinnedSet[pinnedID.String()] = true
		}
	}

	result := make([]*rpcv1.ChannelWithDetails, len(channels))
	for i, ch := range channels {
		protoChannel := &rpcv1.Channel{
			Id:                  ch.ID.String(),
			OrganizationId:      ch.OrganizationID.String(),
			TitleSlug:           ch.TitleSlug,
			DisplayName:         ch.DisplayName,
			Description:         ch.Description.String,
			ChannelType:         mapDBChannelTypeToProto(ch.ChannelType),
			IsPrivate:           ch.IsPrivate,
			IsArchived:          ch.IsArchived,
			CreatedByEmployeeId: ch.CreatedByEmployeeID.String(),
			UpdatedAt:           timestamppb.New(ch.UpdatedAt.Time),
		}

		// Get DM participants if this is a direct message
		var dmParticipants []*rpcv1.DirectMessageParticipant
		if ch.ChannelType == ChannelTypeDirectMessage {
			// ch.ID and ch.OrganizationID are already dbuuid.UUID (no conversion needed)
			participants, err := s.Queries.GetDirectMessageParticipants(ctx, tx, &database.GetDirectMessageParticipantsParams{
				ChannelID:      ch.ID,
				OrganizationID: ch.OrganizationID,
				EmployeeID:     employeeID, // Exclude current user
			})
			if err == nil {
				dmParticipants = make([]*rpcv1.DirectMessageParticipant, len(participants))
				for j, p := range participants {
					dmParticipants[j] = &rpcv1.DirectMessageParticipant{
						Id:         p.ID.String(),
						GivenName:  p.GivenName,
						FamilyName: p.FamilyName,
						Email:      p.Email,
					}
				}
			}
		}

		result[i] = &rpcv1.ChannelWithDetails{
			Channel:        protoChannel,
			MemberCount:    int32(ch.MemberCount),
			DmParticipants: dmParticipants,
		}
	}

	// Enrich task channels with linked resource metadata (batch lookup).
	var taskChannelIDs []dbuuid.UUID
	taskChannelIdx := make(map[string]int) // channelID -> result index
	for i, ch := range channels {
		if ch.ChannelType == ChannelTypeProjectTicketThread {
			taskChannelIDs = append(taskChannelIDs, ch.ID)
			taskChannelIdx[ch.ID.String()] = i
		}
	}
	if len(taskChannelIDs) > 0 {
		taskSummaries, err := s.Queries.GetTaskSummariesByChannelIDs(ctx, tx, &database.GetTaskSummariesByChannelIDsParams{
			OrganizationID: orgID,
			ChannelIds:     taskChannelIDs,
		})
		if err != nil {
			slog.WarnContext(ctx, "failed to enrich task channels with linked resource",
				"error", err,
			)
		} else {
			for _, ts := range taskSummaries {
				idx, ok := taskChannelIdx[ts.ChannelID.String()]
				if !ok {
					continue
				}
				result[idx].LinkedResource = &rpcv1.LinkedResource{
					ResourceType:      "task",
					ResourceId:        ts.TaskID.String(),
					ParentId:          ts.ProjectID.String(),
					DisplayIdentifier: ts.Identifier,
					DisplayTitle:      ts.Title,
				}
			}
		}
	}

	// Sort channels: pinned first, then by updated_at DESC (most recent first)
	// This sorting is done in application layer instead of complex SQL CTEs for easier debugging
	if len(pinnedSet) > 0 {
		// Use stable sort to preserve updated_at ordering within pinned/unpinned groups
		for i := 0; i < len(result); i++ {
			for j := i + 1; j < len(result); j++ {
				iPinned := pinnedSet[result[i].Channel.Id]
				jPinned := pinnedSet[result[j].Channel.Id]

				// If i is unpinned but j is pinned, swap them
				if !iPinned && jPinned {
					result[i], result[j] = result[j], result[i]
				}
			}
		}
	}

	slog.DebugContext(ctx, "recent channels retrieved and sorted",
		"org_id", orgID.String(),
		"channel_count", len(result),
		"pinned_count", len(pinnedSet),
	)

	return result, nil
}

// Helper function to convert DB channel to proto
func dbChannelToProto(ch *database.ChatChannel) *rpcv1.Channel {
	return &rpcv1.Channel{
		Id:                  ch.ID.String(),
		OrganizationId:      ch.OrganizationID.String(),
		TitleSlug:           ch.TitleSlug,
		DisplayName:         ch.DisplayName,
		Description:         ch.Description.String,
		ChannelType:         mapDBChannelTypeToProto(ch.ChannelType),
		IsPrivate:           ch.IsPrivate,
		IsArchived:          ch.IsArchived,
		CreatedByEmployeeId: ch.CreatedByEmployeeID.String(),
		UpdatedAt:           timestamppb.New(ch.UpdatedAt.Time),
	}
}

// Helper function to map database channel type string to proto enum
func mapDBChannelTypeToProto(dbType string) rpcv1.ChannelType {
	switch dbType {
	case ChannelTypeChat:
		return rpcv1.ChannelType_CHANNEL_TYPE_CHAT
	case ChannelTypeDirectMessage:
		return rpcv1.ChannelType_CHANNEL_TYPE_DIRECT_MESSAGE
	case ChannelTypeProjectTicketThread:
		return rpcv1.ChannelType_CHANNEL_TYPE_PROJECT_TICKET_THREAD
	case ChannelTypeCRMDealNotes:
		return rpcv1.ChannelType_CHANNEL_TYPE_CRM_DEAL_NOTES
	case ChannelTypeSupportTicket:
		return rpcv1.ChannelType_CHANNEL_TYPE_SUPPORT_TICKET
	default:
		slog.Warn("unknown channel type, defaulting to UNSPECIFIED",
			"channel_type", dbType,
		)
		return rpcv1.ChannelType_CHANNEL_TYPE_UNSPECIFIED
	}
}

// ============================================================================
// Context Rail Summaries Implementation
// ============================================================================

func (s *chatLogicImpl) GetChannelContextSummary(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	req *rpcv1.GetChannelContextSummaryRequest,
) (*rpcv1.GetChannelContextSummaryResponse, error) {
	slog.InfoContext(ctx, "getting channel context summary",
		"function", "GetChannelContextSummary",
		"channelID", req.ChannelId,
	)

	channelID, err := dbuuid.Parse(req.ChannelId)
	if err != nil {
		return nil, fmt.Errorf("invalid channel ID: %w", err)
	}

	// 1. Verify access to the channel
	channel, err := s.Queries.GetChannelByID(ctx, tx, &database.GetChannelByIDParams{
		ID:             channelID,
		OrganizationID: orgID,
	})
	if err != nil {
		return nil, fmt.Errorf("channel not found: %w", err)
	}

	if channel.IsPrivate {
		_, err := s.Queries.GetChannelMembership(ctx, tx, &database.GetChannelMembershipParams{
			ChannelID:      channelID,
			EmployeeID:     employeeID,
			OrganizationID: orgID,
		})
		if err != nil {
			return nil, fmt.Errorf("access denied: not a member of private channel")
		}
	}

	// 2. Fetch members
	dbMembers, err := s.Queries.ListChannelMembers(ctx, tx, &database.ListChannelMembersParams{
		ChannelID:      channelID,
		OrganizationID: orgID,
		Limit:          1000, // Reasonable cap for rail display
		Offset:         0,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list channel members: %w", err)
	}

	memberCount := int32(len(dbMembers))
	members := make([]*rpcv1.ChannelMemberSummary, 0, len(dbMembers))

	// DM check: identify counterpart
	isDirectMessage := channel.ChannelType == ChannelTypeDirectMessage
	var dmCounterpart *rpcv1.DirectMessageProfile

	for _, m := range dbMembers {
		roleLabel := "Member"
		if m.IsAdmin {
			roleLabel = "Admin"
		}

		employeeName := ""
		if m.EmployeeName != nil {
			if str, ok := m.EmployeeName.(string); ok {
				employeeName = str
			}
		}

		memberSummary := &rpcv1.ChannelMemberSummary{
			EmployeeId:     m.EmployeeID.String(),
			DisplayName:    employeeName,
			Email:          m.EmployeeEmail,
			AvatarUrl:      "",        // Avatars are handled at UI layer via employee profiles if missing
			PresenceStatus: "offline", // Ephemeral state fetched client-side usually
			RoleLabel:      roleLabel,
		}
		members = append(members, memberSummary)

		if isDirectMessage && m.EmployeeID != employeeID {
			dmCounterpart = &rpcv1.DirectMessageProfile{
				EmployeeId:     m.EmployeeID.String(),
				DisplayName:    employeeName,
				Email:          m.EmployeeEmail,
				AvatarUrl:      "",
				PresenceStatus: "offline",
				StatusText:     "",
			}
		}
	}

	// 3. Fetch Pinned Messages (Currently empty as DB doesn't support them yet)
	// TODO: Implement pinned message fetching once schema is updated
	pinnedMessages := make([]*rpcv1.PinnedMessageSummary, 0)

	return &rpcv1.GetChannelContextSummaryResponse{
		MemberCount:    memberCount,
		Members:        members,
		PinnedMessages: pinnedMessages,
		DmCounterpart:  dmCounterpart,
	}, nil
}

// DirectMessageCounterpart returns the other participant of a direct conversation.
//
// It exists so voice can apply the block guard to a call started in a DM without
// querying chat's tables itself (Feature 036, FR-020). A channel that is not a
// direct message returns ok=false and no error: group calls are not blocked, since
// blocking is scoped to direct contact (research.md R8).
func (s *chatLogicImpl) DirectMessageCounterpart(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID, channelID dbuuid.UUID,
) (dbuuid.UUID, bool, error) {
	channel, err := s.Queries.GetChannelByID(ctx, tx, &database.GetChannelByIDParams{
		ID:             channelID,
		OrganizationID: orgID,
	})
	if err != nil {
		return dbuuid.UUID{}, false, fmt.Errorf("channel not found: %w", err)
	}
	if channel.ChannelType != ChannelTypeDirectMessage {
		return dbuuid.UUID{}, false, nil
	}

	participants, err := s.Queries.GetDirectMessageParticipants(ctx, tx, &database.GetDirectMessageParticipantsParams{
		ChannelID:      channelID,
		OrganizationID: orgID,
		EmployeeID:     employeeID,
	})
	if err != nil {
		return dbuuid.UUID{}, false, fmt.Errorf("get direct message participants: %w", err)
	}
	if len(participants) != 1 {
		// A direct conversation has exactly one other person in it. Anything else is
		// not a two-person conversation, so the direct-contact block does not apply.
		return dbuuid.UUID{}, false, nil
	}
	return participants[0].ID, true, nil
}
