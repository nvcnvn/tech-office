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
	"github.com/nvcnvn/tech-office/backend/internal/linking"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/nvcnvn/tech-office/backend/rpc/v1/rpcv1connect"
)

// ============================================================================
// Document Service Connect Layer
// ============================================================================

// DocumentServiceConnect is the RPC handler layer for document operations.
// It owns TenantPool, manages transactions, extracts auth context,
// and delegates to the logic layer. All document operations are user-scope.
type DocumentServiceConnect struct {
	rpcv1connect.UnimplementedDocumentServiceHandler

	// Logic layer for business operations
	Logic DocumentLogic

	// TenantPool: Used for all document operations (user-scope only)
	TenantPool database.TenantDatabaseConnector
}

// NewDocumentServiceConnect creates a new document service connect layer
func NewDocumentServiceConnect(
	logic DocumentLogic,
	tenantPool database.TenantDatabaseConnector,
) *DocumentServiceConnect {
	return &DocumentServiceConnect{
		Logic:      logic,
		TenantPool: tenantPool,
	}
}

// extractAuthContext extracts employee ID and organization ID from request context
func (s *DocumentServiceConnect) extractAuthContext(ctx context.Context) (employeeID, organizationID dbuuid.UUID, err error) {
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

func canonicalDocumentLinkTarget(tenantKey, documentID string, options linking.TargetOptions) linking.CanonicalLinkTarget {
	return linking.NewDocumentTarget(tenantKey, documentID, options)
}

// ============================================================================
// Document CRUD RPC Handlers
// ============================================================================

func (s *DocumentServiceConnect) CreateDocument(
	ctx context.Context,
	req *connect.Request[rpcv1.CreateDocumentRequest],
) (*connect.Response[rpcv1.CreateDocumentResponse], error) {
	slog.DebugContext(ctx, "CreateDocument RPC called",
		"function", "CreateDocument",
		"title", req.Msg.Title,
	)

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var document *rpcv1.Document
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		document, txErr = s.Logic.CreateDocument(ctx, tx, organizationID, employeeID, req.Msg)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create document",
			"error", err,
			"title", req.Msg.Title,
		)
		return nil, s.handleError(err)
	}

	return connect.NewResponse(&rpcv1.CreateDocumentResponse{
		Document: document,
	}), nil
}

func (s *DocumentServiceConnect) GetDocument(
	ctx context.Context,
	req *connect.Request[rpcv1.GetDocumentRequest],
) (*connect.Response[rpcv1.GetDocumentResponse], error) {
	slog.DebugContext(ctx, "GetDocument RPC called",
		"function", "GetDocument",
	)

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var document *rpcv1.Document
	var accessLevel rpcv1.AccessLevel
	var isOwner bool
	var isFollowing bool
	var activeEditorCount int32

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var docID dbuuid.UUID

		// Handle oneof identifier (id or slug)
		switch v := req.Msg.Identifier.(type) {
		case *rpcv1.GetDocumentRequest_Id:
			docID = dbuuid.MustParse(v.Id)
		case *rpcv1.GetDocumentRequest_Slug:
			// Resolve slug to document ID
			_, _, resolvedDocID, resolveErr := s.Logic.ResolveSlug(ctx, tx, organizationID, v.Slug)
			if resolveErr != nil {
				return resolveErr
			}
			docID = resolvedDocID
		default:
			return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("identifier (id or slug) is required"))
		}

		// Check access
		var accessErr error
		accessLevel, isOwner, accessErr = s.Logic.CheckAccess(ctx, tx, organizationID, employeeID, docID)
		if accessErr != nil {
			return accessErr
		}

		if accessLevel == rpcv1.AccessLevel_ACCESS_LEVEL_NONE && !isOwner {
			return ErrAccessDenied
		}

		// Get document
		var txErr error
		document, txErr = s.Logic.GetDocument(ctx, tx, organizationID, docID)
		if txErr != nil {
			return txErr
		}

		// Check if following
		isFollowing, _ = s.Logic.IsFollowing(ctx, tx, organizationID, employeeID, docID)

		// Get active editor count
		editors, _ := s.Logic.ListActiveEditors(ctx, tx, organizationID, docID)
		activeEditorCount = int32(len(editors))

		return nil
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	effectiveAccess := accessLevel
	if isOwner {
		effectiveAccess = rpcv1.AccessLevel_ACCESS_LEVEL_WRITE_UPDATE
	}

	return connect.NewResponse(&rpcv1.GetDocumentResponse{
		Document:          document,
		IsFollowing:       isFollowing,
		EffectiveAccess:   effectiveAccess,
		ActiveEditorCount: activeEditorCount,
	}), nil
}

func (s *DocumentServiceConnect) UpdateDocument(
	ctx context.Context,
	req *connect.Request[rpcv1.UpdateDocumentRequest],
) (*connect.Response[rpcv1.UpdateDocumentResponse], error) {
	slog.DebugContext(ctx, "UpdateDocument RPC called",
		"function", "UpdateDocument",
		"documentID", req.Msg.Id,
	)

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var document *rpcv1.Document
	var versionNumber int32

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		docID := dbuuid.MustParse(req.Msg.Id)

		// Check write access
		accessLevel, isOwner, accessErr := s.Logic.CheckAccess(ctx, tx, organizationID, employeeID, docID)
		if accessErr != nil {
			return accessErr
		}

		if accessLevel != rpcv1.AccessLevel_ACCESS_LEVEL_WRITE_UPDATE && !isOwner {
			return ErrAccessDenied
		}

		// Update document
		var txErr error
		document, versionNumber, txErr = s.Logic.UpdateDocument(ctx, tx, organizationID, employeeID, req.Msg)
		return txErr
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	return connect.NewResponse(&rpcv1.UpdateDocumentResponse{
		Document:         document,
		NewVersionNumber: versionNumber,
	}), nil
}

func (s *DocumentServiceConnect) DeleteDocument(
	ctx context.Context,
	req *connect.Request[rpcv1.DeleteDocumentRequest],
) (*connect.Response[rpcv1.DeleteDocumentResponse], error) {
	slog.DebugContext(ctx, "DeleteDocument RPC called",
		"function", "DeleteDocument",
		"documentID", req.Msg.Id,
	)

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var orphanedChildrenCount int32

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		docID := dbuuid.MustParse(req.Msg.Id)

		// Check ownership (only owner can delete)
		_, isOwner, accessErr := s.Logic.CheckAccess(ctx, tx, organizationID, employeeID, docID)
		if accessErr != nil {
			return accessErr
		}

		if !isOwner {
			return ErrAccessDenied
		}

		// Delete document
		var txErr error
		orphanedChildrenCount, txErr = s.Logic.DeleteDocument(ctx, tx, organizationID, employeeID, docID)
		return txErr
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	return connect.NewResponse(&rpcv1.DeleteDocumentResponse{
		Success:               true,
		OrphanedChildrenCount: orphanedChildrenCount,
	}), nil
}

func (s *DocumentServiceConnect) ListDocuments(
	ctx context.Context,
	req *connect.Request[rpcv1.ListDocumentsRequest],
) (*connect.Response[rpcv1.ListDocumentsResponse], error) {
	slog.DebugContext(ctx, "ListDocuments RPC called",
		"function", "ListDocuments",
		"parentID", req.Msg.ParentDocumentId,
	)

	_, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var documents []*rpcv1.DocumentSummary

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var parentID *dbuuid.UUID
		if req.Msg.ParentDocumentId != "" {
			pid := dbuuid.MustParse(req.Msg.ParentDocumentId)
			parentID = &pid
		}

		var status *string
		if req.Msg.StatusFilter != rpcv1.DocumentStatus_DOCUMENT_STATUS_UNSPECIFIED {
			s := protoToStatus(req.Msg.StatusFilter)
			status = &s
		}

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
		documents, txErr = s.Logic.ListDocuments(ctx, tx, organizationID, parentID, status, cursor, limit)
		return txErr
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	var nextCursor string
	if len(documents) > 0 {
		nextCursor = documents[len(documents)-1].Id
	}

	return connect.NewResponse(&rpcv1.ListDocumentsResponse{
		Documents:  documents,
		NextCursor: nextCursor,
	}), nil
}

func (s *DocumentServiceConnect) GetDocumentTree(
	ctx context.Context,
	req *connect.Request[rpcv1.GetDocumentTreeRequest],
) (*connect.Response[rpcv1.GetDocumentTreeResponse], error) {
	slog.DebugContext(ctx, "GetDocumentTree RPC called",
		"function", "GetDocumentTree",
		"rootID", req.Msg.RootDocumentId,
	)

	_, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var tree []*rpcv1.DocumentTreeNode

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var rootID *dbuuid.UUID
		if req.Msg.RootDocumentId != "" {
			rid := dbuuid.MustParse(req.Msg.RootDocumentId)
			rootID = &rid
		}

		maxDepth := req.Msg.MaxDepth
		if maxDepth <= 0 || maxDepth > MaxDocumentDepth {
			maxDepth = MaxDocumentDepth
		}

		var txErr error
		tree, txErr = s.Logic.GetDocumentTree(ctx, tx, organizationID, rootID, maxDepth)
		return txErr
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	return connect.NewResponse(&rpcv1.GetDocumentTreeResponse{
		Nodes: tree,
	}), nil
}

func (s *DocumentServiceConnect) SearchDocuments(
	ctx context.Context,
	req *connect.Request[rpcv1.SearchDocumentsRequest],
) (*connect.Response[rpcv1.SearchDocumentsResponse], error) {
	slog.DebugContext(ctx, "SearchDocuments RPC called",
		"function", "SearchDocuments",
		"query", req.Msg.Query,
	)

	_, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var results []*rpcv1.SearchResult

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var status *string
		if req.Msg.StatusFilter != rpcv1.DocumentStatus_DOCUMENT_STATUS_UNSPECIFIED {
			s := protoToStatus(req.Msg.StatusFilter)
			status = &s
		}

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
		results, txErr = s.Logic.SearchDocuments(ctx, tx, organizationID, req.Msg.Query, status, cursor, limit)
		return txErr
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	var nextCursor string
	if len(results) > 0 {
		nextCursor = results[len(results)-1].Document.Id
	}

	return connect.NewResponse(&rpcv1.SearchDocumentsResponse{
		Results:    results,
		NextCursor: nextCursor,
	}), nil
}

func (s *DocumentServiceConnect) UpdateDocumentStatus(
	ctx context.Context,
	req *connect.Request[rpcv1.UpdateDocumentStatusRequest],
) (*connect.Response[rpcv1.UpdateDocumentStatusResponse], error) {
	slog.DebugContext(ctx, "UpdateDocumentStatus RPC called",
		"function", "UpdateDocumentStatus",
		"documentID", req.Msg.Id,
		"status", req.Msg.Status,
	)

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var document *rpcv1.Document

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		docID := dbuuid.MustParse(req.Msg.Id)

		// Check write access
		accessLevel, isOwner, accessErr := s.Logic.CheckAccess(ctx, tx, organizationID, employeeID, docID)
		if accessErr != nil {
			return accessErr
		}

		if accessLevel != rpcv1.AccessLevel_ACCESS_LEVEL_WRITE_UPDATE && !isOwner {
			return ErrAccessDenied
		}

		var txErr error
		document, txErr = s.Logic.UpdateDocumentStatus(ctx, tx, organizationID, employeeID, docID, protoToStatus(req.Msg.Status))
		return txErr
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	return connect.NewResponse(&rpcv1.UpdateDocumentStatusResponse{
		Document: document,
	}), nil
}

func (s *DocumentServiceConnect) ResolveSlug(
	ctx context.Context,
	req *connect.Request[rpcv1.ResolveSlugRequest],
) (*connect.Response[rpcv1.ResolveSlugResponse], error) {
	slog.DebugContext(ctx, "ResolveSlug RPC called",
		"function", "ResolveSlug",
		"slug", req.Msg.Slug,
	)

	_, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var currentSlug string
	var isRedirect bool
	var docID dbuuid.UUID

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		currentSlug, isRedirect, docID, txErr = s.Logic.ResolveSlug(ctx, tx, organizationID, req.Msg.Slug)
		return txErr
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	return connect.NewResponse(&rpcv1.ResolveSlugResponse{
		CurrentSlug: currentSlug,
		IsRedirect:  isRedirect,
		DocumentId:  docID.String(),
	}), nil
}

// ============================================================================
// Error Handling
// ============================================================================

func (s *DocumentServiceConnect) handleError(err error) error {
	switch {
	case errors.Is(err, ErrDocumentNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, ErrSlugNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, ErrAccessDenied):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, ErrMaxDepthExceeded):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, ErrInvalidParent):
		return connect.NewError(connect.CodeInvalidArgument, err)
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}
