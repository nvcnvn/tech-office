package docs

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"connectrpc.com/connect"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/database/txn"
	"github.com/nvcnvn/tech-office/backend/internal/interceptor"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/nvcnvn/tech-office/backend/rpc/v1/rpcv1connect"
)

// ============================================================================
// Reaction Service Connect Layer
// ============================================================================

// ReactionServiceConnect is the RPC handler for document reaction operations.
type ReactionServiceConnect struct {
	rpcv1connect.UnimplementedDocumentReactionServiceHandler

	Logic      DocumentLogic
	TenantPool database.TenantDatabaseConnector
}

// NewReactionServiceConnect creates a new reaction service connect layer
func NewReactionServiceConnect(
	logic DocumentLogic,
	tenantPool database.TenantDatabaseConnector,
) *ReactionServiceConnect {
	return &ReactionServiceConnect{
		Logic:      logic,
		TenantPool: tenantPool,
	}
}

func (s *ReactionServiceConnect) AddReaction(
	ctx context.Context,
	req *connect.Request[rpcv1.AddDocumentReactionRequest],
) (*connect.Response[rpcv1.AddDocumentReactionResponse], error) {
	slog.DebugContext(ctx, "AddReaction RPC called",
		"documentID", req.Msg.DocumentId,
		"reactionType", req.Msg.ReactionType,
	)

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var reaction *rpcv1.DocumentReaction

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		docID := dbuuid.MustParse(req.Msg.DocumentId)
		reactionType := reactionTypeFromProto(req.Msg.ReactionType)

		// Check read access
		accessLevel, isOwner, accessErr := s.Logic.CheckAccess(ctx, tx, organizationID, employeeID, docID)
		if accessErr != nil {
			return accessErr
		}

		if accessLevel == rpcv1.AccessLevel_ACCESS_LEVEL_NONE && !isOwner {
			return ErrAccessDenied
		}

		var txErr error
		reaction, txErr = s.Logic.AddReaction(ctx, tx, organizationID, employeeID, docID, reactionType)
		return txErr
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	return connect.NewResponse(&rpcv1.AddDocumentReactionResponse{
		Reaction: reaction,
	}), nil
}

func (s *ReactionServiceConnect) RemoveReaction(
	ctx context.Context,
	req *connect.Request[rpcv1.RemoveDocumentReactionRequest],
) (*connect.Response[rpcv1.RemoveDocumentReactionResponse], error) {
	slog.DebugContext(ctx, "RemoveReaction RPC called",
		"documentID", req.Msg.DocumentId,
	)

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		docID := dbuuid.MustParse(req.Msg.DocumentId)
		return s.Logic.RemoveReaction(ctx, tx, organizationID, employeeID, docID)
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	return connect.NewResponse(&rpcv1.RemoveDocumentReactionResponse{
		Success: true,
	}), nil
}

func (s *ReactionServiceConnect) GetReactionStats(
	ctx context.Context,
	req *connect.Request[rpcv1.GetDocumentReactionStatsRequest],
) (*connect.Response[rpcv1.GetDocumentReactionStatsResponse], error) {
	slog.DebugContext(ctx, "GetReactionStats RPC called",
		"documentID", req.Msg.DocumentId,
	)

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var thumbsUpCount, thumbsDownCount int32
	var userReaction *rpcv1.ReactionType

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		docID := dbuuid.MustParse(req.Msg.DocumentId)

		// Check read access
		accessLevel, isOwner, accessErr := s.Logic.CheckAccess(ctx, tx, organizationID, employeeID, docID)
		if accessErr != nil {
			return accessErr
		}

		if accessLevel == rpcv1.AccessLevel_ACCESS_LEVEL_NONE && !isOwner {
			return ErrAccessDenied
		}

		var txErr error
		thumbsUpCount, thumbsDownCount, userReaction, txErr = s.Logic.GetReactionStats(ctx, tx, organizationID, employeeID, docID)
		return txErr
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	resp := &rpcv1.GetDocumentReactionStatsResponse{
		ThumbsUpCount:   thumbsUpCount,
		ThumbsDownCount: thumbsDownCount,
	}
	if userReaction != nil {
		resp.UserReaction = userReaction
	}

	return connect.NewResponse(resp), nil
}

// extractAuthContext extracts employee ID and organization ID from request context
func (s *ReactionServiceConnect) extractAuthContext(ctx context.Context) (employeeID, organizationID dbuuid.UUID, err error) {
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

// handleError converts domain errors to Connect errors
func (s *ReactionServiceConnect) handleError(err error) error {
	if err == nil {
		return nil
	}

	slog.Error("reaction service error", "error", err)

	// Map domain errors to Connect error codes
	switch {
	case errors.Is(err, ErrDocumentNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, ErrAccessDenied):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, ErrInvalidReactionType):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, ErrReactionNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}
