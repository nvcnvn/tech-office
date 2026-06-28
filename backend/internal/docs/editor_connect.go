package docs

import (
	"context"
	"fmt"
	"log/slog"
	"os"

	"connectrpc.com/connect"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/database/txn"
	"github.com/nvcnvn/tech-office/backend/internal/interceptor"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/nvcnvn/tech-office/backend/rpc/v1/rpcv1connect"
)

// ============================================================================
// Document Editor Service Connect Layer
// ============================================================================

// EditorServiceConnect is the RPC handler for collaborative editing operations.
type EditorServiceConnect struct {
	rpcv1connect.UnimplementedDocumentEditorServiceHandler

	Logic      DocumentLogic
	TenantPool database.TenantDatabaseConnector
	instanceID string
}

// NewEditorServiceConnect creates a new editor service connect layer
func NewEditorServiceConnect(
	logic DocumentLogic,
	tenantPool database.TenantDatabaseConnector,
) *EditorServiceConnect {
	hostname, _ := os.Hostname()
	if hostname == "" {
		hostname = "unknown"
	}
	return &EditorServiceConnect{
		Logic:      logic,
		TenantPool: tenantPool,
		instanceID: hostname,
	}
}

func (s *EditorServiceConnect) getInstanceID() string {
	return s.instanceID
}

func (s *EditorServiceConnect) extractAuthContext(ctx context.Context) (employeeID, organizationID dbuuid.UUID, err error) {
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

func (s *EditorServiceConnect) JoinDocument(
	ctx context.Context,
	req *connect.Request[rpcv1.JoinDocumentRequest],
) (*connect.Response[rpcv1.JoinDocumentResponse], error) {
	slog.DebugContext(ctx, "JoinDocument RPC called",
		"function", "JoinDocument",
		"documentID", req.Msg.DocumentId,
	)

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var editors []*rpcv1.ActiveEditor
	var connID dbuuid.UUID
	var limitReached bool

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

		// Get instance ID from server context (for distributed deployment)
		instanceID := s.getInstanceID()

		var txErr error
		connID, editors, limitReached, txErr = s.Logic.JoinDocument(ctx, tx, organizationID, employeeID, docID, instanceID)
		return txErr
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	return connect.NewResponse(&rpcv1.JoinDocumentResponse{
		Success:            !limitReached,
		ConnectionId:       connID.String(),
		CurrentEditors:     editors,
		EditorLimitReached: limitReached,
	}), nil
}

func (s *EditorServiceConnect) LeaveDocument(
	ctx context.Context,
	req *connect.Request[rpcv1.LeaveDocumentRequest],
) (*connect.Response[rpcv1.LeaveDocumentResponse], error) {
	slog.DebugContext(ctx, "LeaveDocument RPC called",
		"function", "LeaveDocument",
		"documentID", req.Msg.DocumentId,
	)

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		docID := dbuuid.MustParse(req.Msg.DocumentId)
		return s.Logic.LeaveDocument(ctx, tx, organizationID, docID, employeeID)
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	return connect.NewResponse(&rpcv1.LeaveDocumentResponse{
		Success: true,
	}), nil
}

func (s *EditorServiceConnect) UpdateCursor(
	ctx context.Context,
	req *connect.Request[rpcv1.UpdateCursorRequest],
) (*connect.Response[rpcv1.UpdateCursorResponse], error) {
	slog.DebugContext(ctx, "UpdateCursor RPC called",
		"function", "UpdateCursor",
		"documentID", req.Msg.DocumentId,
	)

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		docID := dbuuid.MustParse(req.Msg.DocumentId)
		return s.Logic.UpdateCursor(ctx, tx, organizationID, employeeID, docID, req.Msg.BlockId, req.Msg.Offset)
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	return connect.NewResponse(&rpcv1.UpdateCursorResponse{
		Success: true,
	}), nil
}

func (s *EditorServiceConnect) ListActiveEditors(
	ctx context.Context,
	req *connect.Request[rpcv1.ListActiveEditorsRequest],
) (*connect.Response[rpcv1.ListActiveEditorsResponse], error) {
	slog.DebugContext(ctx, "ListActiveEditors RPC called",
		"function", "ListActiveEditors",
		"documentID", req.Msg.DocumentId,
	)

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var editors []*rpcv1.ActiveEditor

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
		editors, txErr = s.Logic.ListActiveEditors(ctx, tx, organizationID, docID)
		return txErr
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	return connect.NewResponse(&rpcv1.ListActiveEditorsResponse{
		Editors: editors,
	}), nil
}

func (s *EditorServiceConnect) Heartbeat(
	ctx context.Context,
	req *connect.Request[rpcv1.HeartbeatRequest],
) (*connect.Response[rpcv1.HeartbeatResponse], error) {
	slog.DebugContext(ctx, "Heartbeat RPC called",
		"function", "Heartbeat",
		"documentID", req.Msg.DocumentId,
	)

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		docID := dbuuid.MustParse(req.Msg.DocumentId)
		return s.Logic.Heartbeat(ctx, tx, organizationID, docID, employeeID)
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	return connect.NewResponse(&rpcv1.HeartbeatResponse{
		Success: true,
	}), nil
}

func (s *EditorServiceConnect) handleError(err error) error {
	switch {
	case err == ErrDocumentNotFound:
		return connect.NewError(connect.CodeNotFound, err)
	case err == ErrEditorNotFound:
		return connect.NewError(connect.CodeNotFound, err)
	case err == ErrAccessDenied:
		return connect.NewError(connect.CodePermissionDenied, err)
	case err == ErrMaxEditorsReached:
		return connect.NewError(connect.CodeResourceExhausted, err)
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}
