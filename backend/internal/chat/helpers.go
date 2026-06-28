package chat

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/converter"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// messageToProto converts a database GetMessageByID result to proto Message
func messageToProto(m *database.GetMessageByIDRow, currentEmployeeID dbuuid.UUID) *rpcv1.Message {
	protoMsg := &rpcv1.Message{
		Id:               m.ID.String(),
		OrganizationId:   m.OrganizationID.String(),
		ChannelId:        m.ChannelID.String(),
		MessageText:      m.MessageText,
		AuthorEmployeeId: m.AuthorEmployeeID.String(),
		AuthorName:       m.AuthorName,
		AuthorEmail:      m.AuthorEmail,
		IsDeleted:        m.IsDeleted,
		IsEdited:         m.IsEdited,
		FileIds:          converter.UUIDArrayToStrings(m.FileIds),
		MessageKind:      m.MessageKind,
		SystemEventType:  pgTextString(m.SystemEventType),
		MetadataJson:     metadataJSONString(m.Metadata),
		UpdatedAt:        timestamppb.New(m.UpdatedAt.Time),
	}

	if m.ParentMessageID.Valid {
		protoMsg.ParentMessageId = m.ParentMessageID.UUID.String()
	}

	applyReactions(protoMsg, m.ReactionsJson, currentEmployeeID)

	return protoMsg
}

// TODO: we can tell sqlc to use a common struct for these three list queries to avoid this type switch.
// messageToProtoWithReplyCount converts list rows (top-level messages) to proto Message with reply metadata.
func messageToProtoWithReplyCount(row any, currentEmployeeID dbuuid.UUID) *rpcv1.Message {
	switch m := row.(type) {
	case *database.ListChannelMessagesRow:
		return listRowToProto(m.ID, m.OrganizationID, m.ChannelID, m.MessageText, m.AuthorEmployeeID, m.ParentMessageID, m.IsDeleted, m.IsEdited, m.UpdatedAt, m.AuthorName, m.AuthorEmail, m.ReplyCount, m.ThreadParticipantIds, m.LastReplyAt, m.ReactionsJson, currentEmployeeID, m.FileIds, m.MessageKind, m.SystemEventType, m.Metadata)
	case *database.ListChannelMessagesUpToAnchorRow:
		return listRowToProto(m.ID, m.OrganizationID, m.ChannelID, m.MessageText, m.AuthorEmployeeID, m.ParentMessageID, m.IsDeleted, m.IsEdited, m.UpdatedAt, m.AuthorName, m.AuthorEmail, m.ReplyCount, m.ThreadParticipantIds, m.LastReplyAt, m.ReactionsJson, currentEmployeeID, m.FileIds, m.MessageKind, m.SystemEventType, m.Metadata)
	case *database.ListChannelMessagesAfterRow:
		return listRowToProto(m.ID, m.OrganizationID, m.ChannelID, m.MessageText, m.AuthorEmployeeID, m.ParentMessageID, m.IsDeleted, m.IsEdited, m.UpdatedAt, m.AuthorName, m.AuthorEmail, m.ReplyCount, m.ThreadParticipantIds, m.LastReplyAt, m.ReactionsJson, currentEmployeeID, m.FileIds, m.MessageKind, m.SystemEventType, m.Metadata)
	default:
		slog.Warn("unsupported message row type for conversion", "type", fmt.Sprintf("%T", row))
		return nil
	}
}

// listRowToProto builds a message proto from common row fields.
func listRowToProto(
	id dbuuid.UUID,
	organizationID dbuuid.UUID,
	channelID dbuuid.UUID,
	messageText string,
	authorEmployeeID dbuuid.UUID,
	parentMessageID dbuuid.NullUUID,
	isDeleted bool,
	isEdited bool,
	updatedAt pgtype.Timestamptz,
	authorName string,
	authorEmail string,
	replyCount int64,
	threadParticipantIds []dbuuid.UUID,
	lastReplyAt pgtype.Timestamptz,
	reactionsJSON []byte,
	currentEmployeeID dbuuid.UUID,
	filesID []dbuuid.UUID,
	messageKind string,
	systemEventType pgtype.Text,
	metadata []byte,
) *rpcv1.Message {
	protoMsg := &rpcv1.Message{
		Id:                   id.String(),
		OrganizationId:       organizationID.String(),
		ChannelId:            channelID.String(),
		MessageText:          messageText,
		AuthorEmployeeId:     authorEmployeeID.String(),
		AuthorEmail:          authorEmail,
		IsDeleted:            isDeleted,
		IsEdited:             isEdited,
		UpdatedAt:            timestamppb.New(updatedAt.Time),
		LastReplyAt:          timestamppb.New(lastReplyAt.Time),
		ReplyCount:           int32(replyCount),
		FileIds:              converter.UUIDArrayToStrings(filesID),
		MessageKind:          messageKind,
		SystemEventType:      pgTextString(systemEventType),
		MetadataJson:         metadataJSONString(metadata),
		ThreadParticipantIds: converter.UUIDArrayToStrings(threadParticipantIds),
		AuthorName:           authorName,
	}

	if parentMessageID.Valid {
		protoMsg.ParentMessageId = parentMessageID.UUID.String()
	}

	applyReactions(protoMsg, reactionsJSON, currentEmployeeID)

	return protoMsg
}

// messageReplyToProto converts a ListMessageReplies result to proto Message
func messageReplyToProto(m *database.ListMessageRepliesRow, currentEmployeeID dbuuid.UUID) *rpcv1.Message {
	protoMsg := &rpcv1.Message{
		Id:               m.ID.String(),
		OrganizationId:   m.OrganizationID.String(),
		ChannelId:        m.ChannelID.String(),
		MessageText:      m.MessageText,
		AuthorEmployeeId: m.AuthorEmployeeID.String(),
		AuthorName:       m.AuthorName,
		AuthorEmail:      m.AuthorEmail,
		IsDeleted:        m.IsDeleted,
		IsEdited:         m.IsEdited,
		FileIds:          converter.UUIDArrayToStrings(m.FileIds),
		MessageKind:      m.MessageKind,
		SystemEventType:  pgTextString(m.SystemEventType),
		MetadataJson:     metadataJSONString(m.Metadata),
		UpdatedAt:        timestamppb.New(m.UpdatedAt.Time),
	}

	if m.ParentMessageID.Valid {
		protoMsg.ParentMessageId = m.ParentMessageID.UUID.String()
	}

	applyReactions(protoMsg, m.ReactionsJson, currentEmployeeID)

	return protoMsg
}

func pgTextString(value pgtype.Text) string {
	if !value.Valid {
		return ""
	}
	return value.String
}

func metadataJSONString(value []byte) string {
	if len(value) == 0 || string(value) == "null" {
		return ""
	}
	return string(value)
}

// MentionData represents parsed mention information
type MentionData struct {
	Type  string `json:"type"`  // "employee" or "department"
	ID    string `json:"id"`    // Employee ID or Department ID
	Label string `json:"label"` // Display name from data-label attribute
}

// parseTipTapMentions extracts mention data from TipTap-formatted HTML.
// TipTap Mention extension renders: <span data-type="mention" data-id="[id]" data-label="[label]">@[label]</span>
// Returns array of unique mentions with their type and ID.
func parseTipTapMentions(htmlText string) []MentionData {
	mentions := make(map[string]MentionData) // Deduplicate by ID
	var result []MentionData

	// Parse HTML to find mention spans
	// Pattern: <span ... data-id="[id]" ... data-mention-type="[type]" ...>
	// We need to extract data-id and data-mention-type attributes

	// Simple parsing approach: look for <span tags with data-id attribute
	// More robust approach would use golang.org/x/net/html parser

	start := 0
	for {
		// Find next <span tag
		spanStart := strings.Index(htmlText[start:], "<span")
		if spanStart == -1 {
			break
		}
		spanStart += start

		// Find end of opening tag
		tagEnd := strings.Index(htmlText[spanStart:], ">")
		if tagEnd == -1 {
			break
		}
		tagEnd += spanStart

		// Extract tag content
		tagContent := htmlText[spanStart:tagEnd]

		// Check if this is a mention span (has data-type="mention")
		if !strings.Contains(tagContent, `data-type="mention"`) {
			start = tagEnd + 1
			continue
		}

		// Extract data-id and data-label attributes
		dataID := extractAttribute(tagContent, "data-id")
		dataLabel := extractAttribute(tagContent, "data-label")
		if dataID == "" {
			start = tagEnd + 1
			continue
		}

		// Determine mention type from data-id format or content
		// If ID is a UUID, it's an employee mention
		// If ID starts with "dept-", it's a department mention
		mentionType := "employee"
		if strings.HasPrefix(dataID, "dept-") {
			mentionType = "department"
			dataID = strings.TrimPrefix(dataID, "dept-")
		}

		// Add to results if not already present
		if _, exists := mentions[dataID]; !exists {
			mention := MentionData{
				Type:  mentionType,
				ID:    dataID,
				Label: dataLabel,
			}
			mentions[dataID] = mention
			result = append(result, mention)
		}

		start = tagEnd + 1
	}

	return result
}

// extractAttribute extracts the value of an HTML attribute from a tag string
func extractAttribute(tagContent, attrName string) string {
	// Look for attrName="value" pattern
	pattern := attrName + `="`
	attrStart := strings.Index(tagContent, pattern)
	if attrStart == -1 {
		return ""
	}
	attrStart += len(pattern)

	// Find closing quote
	attrEnd := strings.Index(tagContent[attrStart:], `"`)
	if attrEnd == -1 {
		return ""
	}

	return tagContent[attrStart : attrStart+attrEnd]
}

// reactionSummaryPayload represents a single reaction entry in JSON aggregation.
type reactionSummaryPayload struct {
	EmojiCode      string   `json:"emoji_code"`
	Count          int32    `json:"count"`
	EmployeeIDs    []string `json:"employee_ids"`
	FirstReactedAt string   `json:"first_reacted_at"`
}

// buildReactionSummaries converts a JSON aggregate representation into proto reaction summaries.
func buildReactionSummaries(reactionsJSON []byte, currentEmployeeID dbuuid.UUID) ([]*rpcv1.ReactionSummary, error) {
	if reactionsJSON == nil {
		return nil, nil
	}

	if len(reactionsJSON) == 0 {
		return nil, nil
	}

	var payload []reactionSummaryPayload
	if err := json.Unmarshal(reactionsJSON, &payload); err != nil {
		return nil, err
	}

	summaries := make([]*rpcv1.ReactionSummary, 0, len(payload))
	currentID := ""
	if currentEmployeeID != (dbuuid.UUID{}) {
		currentID = currentEmployeeID.String()
	}

	for _, item := range payload {
		t, _ := time.Parse(time.RFC3339, item.FirstReactedAt)
		summary := &rpcv1.ReactionSummary{
			EmojiCode: item.EmojiCode,
			Count:     item.Count,
			EmployeeIds: func(ids []string) []string {
				if ids == nil {
					return []string{}
				}
				return ids
			}(item.EmployeeIDs),
			FirstReactedAt: timestamppb.New(t),
		}

		if currentID != "" {
			for _, id := range item.EmployeeIDs {
				if id == currentID {
					summary.CurrentUserReacted = true
					break
				}
			}
		}

		summaries = append(summaries, summary)
	}

	return summaries, nil
}

// applyReactions populates proto message reactions from aggregated JSON.
func applyReactions(msg *rpcv1.Message, reactionsJSON []byte, currentEmployeeID dbuuid.UUID) {
	if msg == nil {
		return
	}

	reactions, err := buildReactionSummaries(reactionsJSON, currentEmployeeID)
	if err != nil {
		slog.Warn("failed to parse reactions", "error", err)
		return
	}

	if len(reactions) == 0 {
		msg.Reactions = nil
		return
	}

	msg.Reactions = reactions
}
