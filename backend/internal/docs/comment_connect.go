package docs

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
)

// ============================================================================
// Comment Service Connect Layer
// ============================================================================

// CommentServiceConnect is the RPC handler for document comment operations.
type CommentServiceConnect struct {
	rpcv1connect.UnimplementedCommentServiceHandler

	Logic      DocumentLogic
	TenantPool database.TenantDatabaseConnector
}

// NewCommentServiceConnect creates a new comment service connect layer
func NewCommentServiceConnect(
	logic DocumentLogic,
	tenantPool database.TenantDatabaseConnector,
) *CommentServiceConnect {
	return &CommentServiceConnect{
		Logic:      logic,
		TenantPool: tenantPool,
	}
}

func (s *CommentServiceConnect) extractAuthContext(ctx context.Context) (employeeID, organizationID dbuuid.UUID, err error) {
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

func (s *CommentServiceConnect) AddComment(
	ctx context.Context,
	req *connect.Request[rpcv1.AddCommentRequest],
) (*connect.Response[rpcv1.AddCommentResponse], error) {
	slog.DebugContext(ctx, "AddComment RPC called",
		"function", "AddComment",
		"documentID", req.Msg.DocumentId,
	)

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var comment *rpcv1.Comment

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		docID := dbuuid.MustParse(req.Msg.DocumentId)

		// Check read access (users with read access can comment)
		accessLevel, isOwner, accessErr := s.Logic.CheckAccess(ctx, tx, organizationID, employeeID, docID)
		if accessErr != nil {
			return accessErr
		}

		if accessLevel == rpcv1.AccessLevel_ACCESS_LEVEL_NONE && !isOwner {
			return ErrAccessDenied
		}

		var txErr error
		comment, txErr = s.Logic.AddComment(ctx, tx, organizationID, employeeID, req.Msg)
		return txErr
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	return connect.NewResponse(&rpcv1.AddCommentResponse{
		Comment: comment,
	}), nil
}

func (s *CommentServiceConnect) AddCommentReply(
	ctx context.Context,
	req *connect.Request[rpcv1.AddCommentReplyRequest],
) (*connect.Response[rpcv1.AddCommentReplyResponse], error) {
	slog.DebugContext(ctx, "AddCommentReply RPC called",
		"function", "AddCommentReply",
		"commentID", req.Msg.CommentId,
	)

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var reply *rpcv1.CommentReply

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		commentID := dbuuid.MustParse(req.Msg.CommentId)

		var txErr error
		reply, txErr = s.Logic.AddCommentReply(ctx, tx, organizationID, employeeID, commentID, req.Msg.ReplyText)
		return txErr
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	return connect.NewResponse(&rpcv1.AddCommentReplyResponse{
		Reply: reply,
	}), nil
}

func (s *CommentServiceConnect) ResolveComment(
	ctx context.Context,
	req *connect.Request[rpcv1.ResolveCommentRequest],
) (*connect.Response[rpcv1.ResolveCommentResponse], error) {
	slog.DebugContext(ctx, "ResolveComment RPC called",
		"function", "ResolveComment",
		"commentID", req.Msg.CommentId,
	)

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var comment *rpcv1.Comment

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		commentID := dbuuid.MustParse(req.Msg.CommentId)

		var txErr error
		comment, txErr = s.Logic.ResolveComment(ctx, tx, organizationID, employeeID, commentID)
		return txErr
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	return connect.NewResponse(&rpcv1.ResolveCommentResponse{
		Comment: comment,
	}), nil
}

func (s *CommentServiceConnect) ListComments(
	ctx context.Context,
	req *connect.Request[rpcv1.ListCommentsRequest],
) (*connect.Response[rpcv1.ListCommentsResponse], error) {
	slog.DebugContext(ctx, "ListComments RPC called",
		"function", "ListComments",
		"documentID", req.Msg.DocumentId,
	)

	// Validate documentId is not empty
	if req.Msg.DocumentId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("document_id is required"))
	}

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var comments []*rpcv1.Comment

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		docID := dbuuid.MustParse(req.Msg.DocumentId)

		// Check access
		accessLevel, isOwner, accessErr := s.Logic.CheckAccess(ctx, tx, organizationID, employeeID, docID)
		if accessErr != nil {
			return accessErr
		}

		if accessLevel == rpcv1.AccessLevel_ACCESS_LEVEL_NONE && !isOwner {
			return ErrAccessDenied
		}

		var txErr error
		comments, txErr = s.Logic.ListComments(ctx, tx, organizationID, docID, req.Msg.IncludeResolved)
		return txErr
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	return connect.NewResponse(&rpcv1.ListCommentsResponse{
		Comments: comments,
	}), nil
}

func (s *CommentServiceConnect) DeleteComment(
	ctx context.Context,
	req *connect.Request[rpcv1.DeleteCommentRequest],
) (*connect.Response[rpcv1.DeleteCommentResponse], error) {
	slog.DebugContext(ctx, "DeleteComment RPC called",
		"function", "DeleteComment",
		"commentID", req.Msg.CommentId,
	)

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		commentID := dbuuid.MustParse(req.Msg.CommentId)
		return s.Logic.DeleteComment(ctx, tx, organizationID, employeeID, commentID)
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	return connect.NewResponse(&rpcv1.DeleteCommentResponse{
		Success: true,
	}), nil
}

func (s *CommentServiceConnect) handleError(err error) error {
	switch {
	case err == ErrDocumentNotFound:
		return connect.NewError(connect.CodeNotFound, err)
	case err == ErrCommentNotFound:
		return connect.NewError(connect.CodeNotFound, err)
	case err == ErrAccessDenied:
		return connect.NewError(connect.CodePermissionDenied, err)
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}
