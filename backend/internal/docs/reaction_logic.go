package docs

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ============================================================================
// Reaction Domain Errors
// ============================================================================

var (
	ErrInvalidReactionType = errors.New("invalid reaction type")
	ErrReactionNotFound    = errors.New("reaction not found")
)

// ============================================================================
// Reaction Methods
// ============================================================================

func (l *documentLogicImpl) AddReaction(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID, docID dbuuid.UUID,
	reactionType string,
) (*rpcv1.DocumentReaction, error) {
	slog.DebugContext(ctx, "DocumentLogic.AddReaction",
		"docID", docID,
		"employeeID", employeeID,
		"reactionType", reactionType,
	)

	// Validate reaction type
	if !IsValidReactionType(reactionType) {
		return nil, ErrInvalidReactionType
	}

	// Verify document exists and user has read access
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

	// Upsert reaction (replace existing if user already reacted)
	reaction, err := l.Queries.UpsertDocumentReaction(ctx, tx, &database.UpsertDocumentReactionParams{
		ID:             dbuuid.UUID(uuid.New()),
		OrganizationID: orgID,
		DocumentID:     docID,
		EmployeeID:     employeeID,
		ReactionType:   reactionType,
		UpdatedAt:      pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to upsert reaction",
			"error", err,
			"docID", docID,
		)
		return nil, fmt.Errorf("failed to add reaction: %w", err)
	}

	return &rpcv1.DocumentReaction{
		Id:           reaction.ID.String(),
		DocumentId:   reaction.DocumentID.String(),
		EmployeeId:   reaction.EmployeeID.String(),
		EmployeeName: "Employee", // Placeholder, not fetched in upsert
		ReactionType: reactionTypeToProto(reaction.ReactionType),
		UpdatedAt:    timestamppb.New(reaction.UpdatedAt.Time),
	}, nil
}

func (l *documentLogicImpl) RemoveReaction(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID, docID dbuuid.UUID,
) error {
	slog.DebugContext(ctx, "DocumentLogic.RemoveReaction",
		"docID", docID,
		"employeeID", employeeID,
	)

	err := l.Queries.DeleteDocumentReaction(ctx, tx, &database.DeleteDocumentReactionParams{
		OrganizationID: orgID,
		DocumentID:     docID,
		EmployeeID:     employeeID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to delete reaction",
			"error", err,
			"docID", docID,
		)
		return fmt.Errorf("failed to remove reaction: %w", err)
	}

	return nil
}

func (l *documentLogicImpl) GetReactionStats(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID, docID dbuuid.UUID,
) (thumbsUpCount, thumbsDownCount int32, userReaction *rpcv1.ReactionType, err error) {
	// Get aggregate stats
	stats, err := l.Queries.GetDocumentReactionStats(ctx, tx, &database.GetDocumentReactionStatsParams{
		OrganizationID: orgID,
		DocumentID:     docID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Document exists but has no reactions
			return 0, 0, nil, nil
		}
		return 0, 0, nil, fmt.Errorf("failed to get reaction stats: %w", err)
	}

	// Get user's reaction if any
	userReactionRow, err := l.Queries.GetUserDocumentReaction(ctx, tx, &database.GetUserDocumentReactionParams{
		OrganizationID: orgID,
		DocumentID:     docID,
		EmployeeID:     employeeID,
	})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return 0, 0, nil, fmt.Errorf("failed to get user reaction: %w", err)
	}

	if err == nil {
		reactionProto := reactionTypeToProto(userReactionRow.ReactionType)
		userReaction = &reactionProto
	}

	return stats.ThumbsUpCount, stats.ThumbsDownCount, userReaction, nil
}

// ============================================================================
// Reaction Helper Functions
// ============================================================================

func reactionTypeToProto(reactionType string) rpcv1.ReactionType {
	switch reactionType {
	case ReactionTypeThumbsUp:
		return rpcv1.ReactionType_REACTION_TYPE_THUMBS_UP
	case ReactionTypeThumbsDown:
		return rpcv1.ReactionType_REACTION_TYPE_THUMBS_DOWN
	default:
		return rpcv1.ReactionType_REACTION_TYPE_UNSPECIFIED
	}
}

func reactionTypeFromProto(reactionType rpcv1.ReactionType) string {
	switch reactionType {
	case rpcv1.ReactionType_REACTION_TYPE_THUMBS_UP:
		return ReactionTypeThumbsUp
	case rpcv1.ReactionType_REACTION_TYPE_THUMBS_DOWN:
		return ReactionTypeThumbsDown
	default:
		return ""
	}
}
