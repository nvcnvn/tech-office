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
// Follower Service Connect Layer
// ============================================================================

// FollowerServiceConnect is the RPC handler for document follower operations.
type FollowerServiceConnect struct {
	rpcv1connect.UnimplementedDocumentFollowerServiceHandler

	Logic      DocumentLogic
	TenantPool database.TenantDatabaseConnector
}

// NewFollowerServiceConnect creates a new follower service connect layer
func NewFollowerServiceConnect(
	logic DocumentLogic,
	tenantPool database.TenantDatabaseConnector,
) *FollowerServiceConnect {
	return &FollowerServiceConnect{
		Logic:      logic,
		TenantPool: tenantPool,
	}
}

func (s *FollowerServiceConnect) extractAuthContext(ctx context.Context) (employeeID, organizationID dbuuid.UUID, err error) {
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

func (s *FollowerServiceConnect) FollowDocument(
	ctx context.Context,
	req *connect.Request[rpcv1.FollowDocumentRequest],
) (*connect.Response[rpcv1.FollowDocumentResponse], error) {
	slog.DebugContext(ctx, "FollowDocument RPC called",
		"function", "FollowDocument",
		"documentID", req.Msg.DocumentId,
	)

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		docID := dbuuid.MustParse(req.Msg.DocumentId)

		// Check access (must be able to read to follow)
		accessLevel, isOwner, accessErr := s.Logic.CheckAccess(ctx, tx, organizationID, employeeID, docID)
		if accessErr != nil {
			return accessErr
		}

		if accessLevel == rpcv1.AccessLevel_ACCESS_LEVEL_NONE && !isOwner {
			return ErrAccessDenied
		}

		return s.Logic.FollowDocument(ctx, tx, organizationID, employeeID, docID)
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	return connect.NewResponse(&rpcv1.FollowDocumentResponse{
		Success: true,
	}), nil
}

func (s *FollowerServiceConnect) UnfollowDocument(
	ctx context.Context,
	req *connect.Request[rpcv1.UnfollowDocumentRequest],
) (*connect.Response[rpcv1.UnfollowDocumentResponse], error) {
	slog.DebugContext(ctx, "UnfollowDocument RPC called",
		"function", "UnfollowDocument",
		"documentID", req.Msg.DocumentId,
	)

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		docID := dbuuid.MustParse(req.Msg.DocumentId)
		return s.Logic.UnfollowDocument(ctx, tx, organizationID, employeeID, docID)
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	return connect.NewResponse(&rpcv1.UnfollowDocumentResponse{
		Success: true,
	}), nil
}

func (s *FollowerServiceConnect) ListFollowedDocuments(
	ctx context.Context,
	req *connect.Request[rpcv1.ListFollowedDocumentsRequest],
) (*connect.Response[rpcv1.ListFollowedDocumentsResponse], error) {
	slog.DebugContext(ctx, "ListFollowedDocuments RPC called",
		"function", "ListFollowedDocuments",
	)

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var documents []*rpcv1.DocumentSummary

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var cursor *dbuuid.UUID
		if req.Msg.Cursor != "" {
			c := dbuuid.MustParse(req.Msg.Cursor)
			cursor = &c
		}

		limit := req.Msg.Limit
		if limit <= 0 || limit > 100 {
			limit = 20
		}

		var txErr error
		documents, txErr = s.Logic.ListFollowedDocuments(ctx, tx, organizationID, employeeID, cursor, limit)
		return txErr
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	var nextCursor string
	if len(documents) > 0 {
		nextCursor = documents[len(documents)-1].Id
	}

	return connect.NewResponse(&rpcv1.ListFollowedDocumentsResponse{
		Documents:  documents,
		NextCursor: nextCursor,
	}), nil
}

func (s *FollowerServiceConnect) handleError(err error) error {
	switch {
	case err == ErrDocumentNotFound:
		return connect.NewError(connect.CodeNotFound, err)
	case err == ErrAccessDenied:
		return connect.NewError(connect.CodePermissionDenied, err)
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}
