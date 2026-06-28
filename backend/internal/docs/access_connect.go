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
// Access Control Service Connect Layer
// ============================================================================

// AccessServiceConnect is the RPC handler for document access control operations.
type AccessServiceConnect struct {
	rpcv1connect.UnimplementedDocumentAccessServiceHandler

	Logic      DocumentLogic
	TenantPool database.TenantDatabaseConnector
}

// NewAccessServiceConnect creates a new access service connect layer
func NewAccessServiceConnect(
	logic DocumentLogic,
	tenantPool database.TenantDatabaseConnector,
) *AccessServiceConnect {
	return &AccessServiceConnect{
		Logic:      logic,
		TenantPool: tenantPool,
	}
}

func (s *AccessServiceConnect) extractAuthContext(ctx context.Context) (employeeID, organizationID dbuuid.UUID, err error) {
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

func (s *AccessServiceConnect) SetAccess(
	ctx context.Context,
	req *connect.Request[rpcv1.SetAccessRequest],
) (*connect.Response[rpcv1.SetAccessResponse], error) {
	slog.DebugContext(ctx, "SetAccess RPC called",
		"function", "SetAccess",
		"documentID", req.Msg.DocumentId,
		"granteeID", req.Msg.GranteeId,
	)

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var access *rpcv1.DocumentAccess

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		docID := dbuuid.MustParse(req.Msg.DocumentId)

		// Only owner can grant access
		_, isOwner, accessErr := s.Logic.CheckAccess(ctx, tx, organizationID, employeeID, docID)
		if accessErr != nil {
			return accessErr
		}

		if !isOwner {
			return ErrAccessDenied
		}

		var txErr error
		access, txErr = s.Logic.SetAccess(ctx, tx, organizationID, employeeID, req.Msg)
		return txErr
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	return connect.NewResponse(&rpcv1.SetAccessResponse{
		Access: access,
	}), nil
}

func (s *AccessServiceConnect) RemoveAccess(
	ctx context.Context,
	req *connect.Request[rpcv1.RemoveAccessRequest],
) (*connect.Response[rpcv1.RemoveAccessResponse], error) {
	slog.DebugContext(ctx, "RemoveAccess RPC called",
		"function", "RemoveAccess",
		"documentID", req.Msg.DocumentId,
		"granteeID", req.Msg.GranteeId,
	)

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		docID := dbuuid.MustParse(req.Msg.DocumentId)

		// Only owner can remove access
		_, isOwner, accessErr := s.Logic.CheckAccess(ctx, tx, organizationID, employeeID, docID)
		if accessErr != nil {
			return accessErr
		}

		if !isOwner {
			return ErrAccessDenied
		}

		return s.Logic.RemoveAccess(ctx, tx, organizationID, employeeID, req.Msg)
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	return connect.NewResponse(&rpcv1.RemoveAccessResponse{
		Success: true,
	}), nil
}

func (s *AccessServiceConnect) ListAccess(
	ctx context.Context,
	req *connect.Request[rpcv1.ListAccessRequest],
) (*connect.Response[rpcv1.ListAccessResponse], error) {
	slog.DebugContext(ctx, "ListAccess RPC called",
		"function", "ListAccess",
		"documentID", req.Msg.DocumentId,
	)

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var accessList []*rpcv1.DocumentAccess
	var visibility rpcv1.DocumentVisibility

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		docID := dbuuid.MustParse(req.Msg.DocumentId)

		// Check if user has access to view access list
		accessLevel, isOwner, accessErr := s.Logic.CheckAccess(ctx, tx, organizationID, employeeID, docID)
		if accessErr != nil {
			return accessErr
		}

		if accessLevel == rpcv1.AccessLevel_ACCESS_LEVEL_NONE && !isOwner {
			return ErrAccessDenied
		}

		var txErr error
		accessList, visibility, txErr = s.Logic.ListAccess(ctx, tx, organizationID, docID)
		return txErr
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	return connect.NewResponse(&rpcv1.ListAccessResponse{
		AccessList:          accessList,
		InheritedVisibility: visibility,
	}), nil
}

func (s *AccessServiceConnect) CheckAccess(
	ctx context.Context,
	req *connect.Request[rpcv1.CheckAccessRequest],
) (*connect.Response[rpcv1.CheckAccessResponse], error) {
	slog.DebugContext(ctx, "CheckAccess RPC called",
		"function", "CheckAccess",
		"documentID", req.Msg.DocumentId,
	)

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var accessLevel rpcv1.AccessLevel
	var isOwner bool

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		docID := dbuuid.MustParse(req.Msg.DocumentId)

		var txErr error
		accessLevel, isOwner, txErr = s.Logic.CheckAccess(ctx, tx, organizationID, employeeID, docID)
		return txErr
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	return connect.NewResponse(&rpcv1.CheckAccessResponse{
		AccessLevel: accessLevel,
		IsOwner:     isOwner,
	}), nil
}

func (s *AccessServiceConnect) handleError(err error) error {
	switch {
	case err == ErrDocumentNotFound:
		return connect.NewError(connect.CodeNotFound, err)
	case err == ErrAccessDenied:
		return connect.NewError(connect.CodePermissionDenied, err)
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}
