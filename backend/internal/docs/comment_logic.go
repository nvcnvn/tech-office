package docs

import (
	"context"
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
	"github.com/nvcnvn/tech-office/backend/internal/notification"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ============================================================================
// Comment Domain Errors
// ============================================================================

var (
	ErrCommentNotFound        = errors.New("comment not found")
	ErrCommentReplyNotFound   = errors.New("comment reply not found")
	ErrCommentAlreadyResolved = errors.New("comment already resolved")
)

// ============================================================================
// Comment Methods
// ============================================================================

func (l *documentLogicImpl) AddComment(
	ctx context.Context,
	tx database.DBTX,
	orgID, authorID dbuuid.UUID,
	req *rpcv1.AddCommentRequest,
) (*rpcv1.Comment, error) {
	slog.DebugContext(ctx, "DocumentLogic.AddComment",
		"docID", req.DocumentId,
		"authorID", authorID,
		"blockID", req.BlockId,
	)

	docID := dbuuid.MustParse(req.DocumentId)

	// Verify document exists
	_, err := l.Queries.GetDocumentByID(ctx, tx, &database.GetDocumentByIDParams{
		OrganizationID: orgID,
		ID:             docID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrDocumentNotFound
		}
		return nil, fmt.Errorf("failed to get document: %w", err)
	}

	// Parse block_id if provided (nullable for document-level comments)
	var blockID dbuuid.NullUUID
	if req.BlockId != nil && *req.BlockId != "" {
		parsedBlockID, err := dbuuid.Parse(*req.BlockId)
		if err != nil {
			return nil, fmt.Errorf("invalid block_id: %w", err)
		}
		blockID = dbuuid.UUIDToNullUUID(parsedBlockID)
	}

	comment, err := l.Queries.CreateComment(ctx, tx, &database.CreateCommentParams{
		ID:                 dbuuid.UUID(uuid.New()),
		OrganizationID:     orgID,
		DocumentID:         docID,
		BlockID:            blockID,
		TextSelectionStart: int32ToPgInt4(req.TextSelectionStart),
		TextSelectionEnd:   int32ToPgInt4(req.TextSelectionEnd),
		CommentText:        req.CommentText,
		AuthorEmployeeID:   authorID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create comment",
			"error", err,
			"docID", req.DocumentId,
		)
		return nil, fmt.Errorf("failed to create comment: %w", err)
	}

	_ = l.ensureDocumentCommentedSubscription(ctx, tx, orgID, authorID, docID)

	// Notify followers of the comment
	l.notifyDocFollowers(ctx, tx, orgID, docID, authorID,
		notification.NotificationTypeDocCommented, 1, false,
		"New comment on document", req.CommentText)

	// Notify @mentioned users with direct-targeted doc_mentioned
	l.notifyDocCommentMentions(ctx, tx, orgID, docID, authorID, req.CommentText)

	return l.commentToProto(comment, "Author"), nil
}

func (l *documentLogicImpl) ListComments(
	ctx context.Context,
	tx database.DBTX,
	orgID, docID dbuuid.UUID,
	includeResolved bool,
) ([]*rpcv1.Comment, error) {
	comments, err := l.Queries.ListDocumentComments(ctx, tx, &database.ListDocumentCommentsParams{
		OrganizationID:  orgID,
		DocumentID:      docID,
		IncludeResolved: includeResolved,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list comments: %w", err)
	}

	result := make([]*rpcv1.Comment, len(comments))
	for i, c := range comments {
		// Convert nullable block_id
		var blockIDStr *string
		if c.BlockID.Valid {
			blockIDValue := c.BlockID.UUID.String()
			blockIDStr = &blockIDValue
		}

		result[i] = &rpcv1.Comment{
			Id:                 c.ID.String(),
			DocumentId:         c.DocumentID.String(),
			BlockId:            blockIDStr,
			TextSelectionStart: pgInt4ToInt32(c.TextSelectionStart),
			TextSelectionEnd:   pgInt4ToInt32(c.TextSelectionEnd),
			CommentText:        c.CommentText,
			AuthorEmployeeId:   c.AuthorEmployeeID.String(),
			AuthorName:         interfaceToString(c.AuthorName),
			IsResolved:         c.IsResolved,
			ResolvedByName:     interfaceToString(c.ResolvedByName),
			ResolvedAt:         nullTimeToProto(c.ResolvedAt),
			ReplyCount:         c.ReplyCount,
			UpdatedAt:          timestamppb.New(c.UpdatedAt.Time),
		}
	}

	return result, nil
}

func (l *documentLogicImpl) ResolveComment(
	ctx context.Context,
	tx database.DBTX,
	orgID, resolverID, commentID dbuuid.UUID,
) (*rpcv1.Comment, error) {
	slog.DebugContext(ctx, "DocumentLogic.ResolveComment",
		"commentID", commentID,
		"resolverID", resolverID,
	)

	comment, err := l.Queries.ResolveComment(ctx, tx, &database.ResolveCommentParams{
		OrganizationID: orgID,
		ID:             commentID,
		ResolvedBy:     dbuuid.UUIDToNullUUID(resolverID),
		ResolvedAt:     pgtype.Timestamptz{Time: time.Now(), Valid: true},
		UpdatedAt:      pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrCommentNotFound
		}
		slog.ErrorContext(ctx, "failed to resolve comment",
			"error", err,
			"commentID", commentID,
		)
		return nil, fmt.Errorf("failed to resolve comment: %w", err)
	}

	return l.commentToProto(comment, "Author"), nil
}

func (l *documentLogicImpl) DeleteComment(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID, commentID dbuuid.UUID,
) error {
	// Get comment to check ownership/access
	docID, err := l.Queries.GetCommentDocumentID(ctx, tx, &database.GetCommentDocumentIDParams{
		OrganizationID: orgID,
		ID:             commentID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrCommentNotFound
		}
		return fmt.Errorf("failed to get comment: %w", err)
	}

	// Check if employee has write access to document
	accessLevel, isOwner, err := l.CheckAccess(ctx, tx, orgID, employeeID, dbuuid.UUID(docID))
	if err != nil {
		return fmt.Errorf("failed to check access: %w", err)
	}

	if !isOwner && accessLevel != rpcv1.AccessLevel_ACCESS_LEVEL_WRITE_UPDATE {
		return ErrAccessDenied
	}

	return l.Queries.DeleteComment(ctx, tx, &database.DeleteCommentParams{
		OrganizationID: orgID,
		ID:             commentID,
	})
}

// ============================================================================
// Comment Reply Methods
// ============================================================================

func (l *documentLogicImpl) AddCommentReply(
	ctx context.Context,
	tx database.DBTX,
	orgID, authorID dbuuid.UUID,
	commentID dbuuid.UUID,
	replyText string,
) (*rpcv1.CommentReply, error) {
	slog.DebugContext(ctx, "DocumentLogic.AddCommentReply",
		"commentID", commentID,
		"authorID", authorID,
	)

	// Verify comment exists by getting its document ID
	docID, err := l.Queries.GetCommentDocumentID(ctx, tx, &database.GetCommentDocumentIDParams{
		OrganizationID: orgID,
		ID:             commentID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrCommentNotFound
		}
		return nil, fmt.Errorf("failed to get comment: %w", err)
	}

	reply, err := l.Queries.CreateCommentReply(ctx, tx, &database.CreateCommentReplyParams{
		ID:               dbuuid.UUID(uuid.New()),
		OrganizationID:   orgID,
		CommentID:        commentID,
		ReplyText:        replyText,
		AuthorEmployeeID: authorID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create comment reply",
			"error", err,
			"commentID", commentID,
		)
		return nil, fmt.Errorf("failed to create comment reply: %w", err)
	}

	// Increment reply count
	if err := l.Queries.IncrementCommentReplyCount(ctx, tx, &database.IncrementCommentReplyCountParams{
		UpdatedAt:      pgtype.Timestamptz{Time: time.Now(), Valid: true},
		OrganizationID: orgID,
		ID:             commentID,
	}); err != nil {
		slog.ErrorContext(ctx, "failed to increment reply count",
			"error", err,
			"commentID", commentID,
		)
		// Non-fatal
	}

	// Notify document followers of the reply
	l.notifyDocFollowers(ctx, tx, orgID, docID, authorID,
		notification.NotificationTypeDocCommented, 1, false,
		"New reply on document comment", replyText)

	return &rpcv1.CommentReply{
		Id:               reply.ID.String(),
		CommentId:        reply.CommentID.String(),
		ReplyText:        reply.ReplyText,
		AuthorEmployeeId: reply.AuthorEmployeeID.String(),
		AuthorName:       "Author",
		UpdatedAt:        timestamppb.New(reply.UpdatedAt.Time),
	}, nil
}

// ============================================================================
// Comment Helper Functions
// ============================================================================

func (l *documentLogicImpl) commentToProto(c *database.DocsComment, authorName string) *rpcv1.Comment {
	var resolvedByName string
	if c.ResolvedByEmployeeID.Valid {
		resolvedByName = "Resolver"
	}

	// Convert nullable block_id
	var blockIDStr *string
	if c.BlockID.Valid {
		blockIDValue := c.BlockID.UUID.String()
		blockIDStr = &blockIDValue
	}

	return &rpcv1.Comment{
		Id:                 c.ID.String(),
		DocumentId:         c.DocumentID.String(),
		BlockId:            blockIDStr,
		TextSelectionStart: pgInt4ToInt32(c.TextSelectionStart),
		TextSelectionEnd:   pgInt4ToInt32(c.TextSelectionEnd),
		CommentText:        c.CommentText,
		AuthorEmployeeId:   c.AuthorEmployeeID.String(),
		AuthorName:         authorName,
		IsResolved:         c.IsResolved,
		ResolvedByName:     resolvedByName,
		ResolvedAt:         nullTimeToProto(c.ResolvedAt),
		ReplyCount:         c.ReplyCount,
		UpdatedAt:          timestamppb.New(c.UpdatedAt.Time),
	}
}

func int32ToPgInt4(v int32) pgtype.Int4 {
	if v == 0 {
		return pgtype.Int4{}
	}
	return pgtype.Int4{Int32: v, Valid: true}
}

func pgInt4ToInt32(v pgtype.Int4) int32 {
	if !v.Valid {
		return 0
	}
	return v.Int32
}

func nullTimeToProto(t pgtype.Timestamptz) *timestamppb.Timestamp {
	if !t.Valid {
		return nil
	}
	return timestamppb.New(t.Time)
}

func interfaceToString(v interface{}) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// notifyDocCommentMentions parses TipTap-style @mentions from comment text and
// publishes a direct-targeted doc_mentioned notification for each mentioned user.
func (l *documentLogicImpl) notifyDocCommentMentions(
	ctx context.Context,
	tx database.DBTX,
	orgID, docID, authorID dbuuid.UUID,
	commentText string,
) {
	if l.NotificationPublisher == nil {
		return
	}

	mentionedIDs := parseCommentMentions(commentText)
	if len(mentionedIDs) == 0 {
		return
	}

	// Exclude the author from mention targets
	recipientIDs := make([]string, 0, len(mentionedIDs))
	for _, id := range mentionedIDs {
		if id != authorID.String() {
			recipientIDs = append(recipientIDs, id)
		}
	}
	if len(recipientIDs) == 0 {
		return
	}

	truncatedText := commentText
	if len(truncatedText) > 200 {
		truncatedText = truncatedText[:197] + "..."
	}

	if _, err := l.NotificationPublisher.PublishNotification(ctx, tx, &rpcv1.PublishNotificationRequest{
		Recipients: &rpcv1.NotificationRecipients{
			EmployeeIds: recipientIDs,
		},
		OrganizationId:   orgID.String(),
		SourceDomain:     notification.SourceDomainDocs,
		NotificationType: notification.NotificationTypeDocMentioned,
		Priority:         notification.PriorityAlways,
		Title:            "You were mentioned in a document comment",
		Message:          truncatedText,
		PolicyKey:        notification.PolicyKeyDocumentMention,
		DeliveryClass:    notification.DeliveryClassPersistent,
		SourceCategory:   notification.SourceCategoryMention,
		NavigationTarget: &rpcv1.NavigationTarget{
			Domain:       notification.SourceDomainDocs,
			ResourceType: "document",
			ResourceId:   docID.String(),
		},
	}); err != nil {
		slog.WarnContext(ctx, "failed to publish doc_mentioned notification",
			"error", err, "docID", docID.String())
	}
}

// parseCommentMentions extracts employee UUIDs from TipTap mention spans in HTML text.
func parseCommentMentions(htmlText string) []string {
	seen := make(map[string]struct{})
	var result []string

	start := 0
	for {
		spanStart := strings.Index(htmlText[start:], "<span")
		if spanStart == -1 {
			break
		}
		spanStart += start

		tagEnd := strings.Index(htmlText[spanStart:], ">")
		if tagEnd == -1 {
			break
		}
		tagEnd += spanStart

		tagContent := htmlText[spanStart:tagEnd]
		if !strings.Contains(tagContent, `data-type="mention"`) {
			start = tagEnd + 1
			continue
		}

		dataID := extractMentionDataID(tagContent)
		if dataID == "" {
			start = tagEnd + 1
			continue
		}

		// Only include valid UUIDs (employee mentions)
		if _, err := uuid.Parse(dataID); err != nil {
			start = tagEnd + 1
			continue
		}

		if _, exists := seen[dataID]; !exists {
			seen[dataID] = struct{}{}
			result = append(result, dataID)
		}

		start = tagEnd + 1
	}

	return result
}

// extractMentionDataID extracts the data-id attribute value from an HTML tag string.
func extractMentionDataID(tag string) string {
	key := `data-id="`
	idx := strings.Index(tag, key)
	if idx == -1 {
		return ""
	}
	rest := tag[idx+len(key):]
	endIdx := strings.Index(rest, `"`)
	if endIdx == -1 {
		return ""
	}
	return rest[:endIdx]
}
