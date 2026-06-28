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
// Section Embed Service Connect Layer
// ============================================================================

// EmbedServiceConnect is the RPC handler for section embed operations.
type EmbedServiceConnect struct {
	rpcv1connect.UnimplementedSectionEmbedServiceHandler

	Logic      DocumentLogic
	TenantPool database.TenantDatabaseConnector
}

// NewEmbedServiceConnect creates a new embed service connect layer
func NewEmbedServiceConnect(
	logic DocumentLogic,
	tenantPool database.TenantDatabaseConnector,
) *EmbedServiceConnect {
	return &EmbedServiceConnect{
		Logic:      logic,
		TenantPool: tenantPool,
	}
}

func (s *EmbedServiceConnect) extractAuthContext(ctx context.Context) (employeeID, organizationID dbuuid.UUID, err error) {
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

func (s *EmbedServiceConnect) CreateEmbed(
	ctx context.Context,
	req *connect.Request[rpcv1.CreateEmbedRequest],
) (*connect.Response[rpcv1.CreateEmbedResponse], error) {
	slog.DebugContext(ctx, "CreateEmbed RPC called",
		"function", "CreateEmbed",
		"sourceDocumentID", req.Msg.SourceDocumentId,
		"targetDocumentID", req.Msg.TargetDocumentId,
	)

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var embed *rpcv1.SectionEmbed

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		sourceDocID := dbuuid.MustParse(req.Msg.SourceDocumentId)

		// Check write access to source document
		accessLevel, isOwner, accessErr := s.Logic.CheckAccess(ctx, tx, organizationID, employeeID, sourceDocID)
		if accessErr != nil {
			return accessErr
		}

		if accessLevel != rpcv1.AccessLevel_ACCESS_LEVEL_WRITE_UPDATE && !isOwner {
			return ErrAccessDenied
		}

		// Check read access to target document
		targetDocID := dbuuid.MustParse(req.Msg.TargetDocumentId)
		targetAccessLevel, isTargetOwner, targetAccessErr := s.Logic.CheckAccess(ctx, tx, organizationID, employeeID, targetDocID)
		if targetAccessErr != nil {
			return targetAccessErr
		}

		if targetAccessLevel == rpcv1.AccessLevel_ACCESS_LEVEL_NONE && !isTargetOwner {
			return ErrAccessDenied
		}

		var txErr error
		embed, txErr = s.Logic.CreateEmbed(ctx, tx, organizationID, req.Msg)
		return txErr
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	return connect.NewResponse(&rpcv1.CreateEmbedResponse{
		Embed: embed,
	}), nil
}

func (s *EmbedServiceConnect) GetEmbeddedSection(
	ctx context.Context,
	req *connect.Request[rpcv1.GetEmbeddedSectionRequest],
) (*connect.Response[rpcv1.GetEmbeddedSectionResponse], error) {
	slog.DebugContext(ctx, "GetEmbeddedSection RPC called",
		"function", "GetEmbeddedSection",
		"embedID", req.Msg.EmbedId,
	)

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var embed *rpcv1.SectionEmbed
	var contentJson string
	var contentText string
	var targetAccessible bool

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		embedID := dbuuid.MustParse(req.Msg.EmbedId)

		var txErr error
		embed, contentText, contentJson, targetAccessible, txErr = s.Logic.GetEmbeddedSection(ctx, tx, organizationID, employeeID, embedID)
		return txErr
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	return connect.NewResponse(&rpcv1.GetEmbeddedSectionResponse{
		Embed:            embed,
		ContentText:      contentText,
		ContentJson:      contentJson,
		TargetAccessible: targetAccessible,
	}), nil
}

func (s *EmbedServiceConnect) ListEmbeds(
	ctx context.Context,
	req *connect.Request[rpcv1.ListEmbedsRequest],
) (*connect.Response[rpcv1.ListEmbedsResponse], error) {
	slog.DebugContext(ctx, "ListEmbeds RPC called",
		"function", "ListEmbeds",
		"documentID", req.Msg.DocumentId,
	)

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var embeds []*rpcv1.SectionEmbed

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
		embeds, txErr = s.Logic.ListEmbeds(ctx, tx, organizationID, docID)
		return txErr
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	return connect.NewResponse(&rpcv1.ListEmbedsResponse{
		Embeds: embeds,
	}), nil
}

func (s *EmbedServiceConnect) ListIncomingCitations(
	ctx context.Context,
	req *connect.Request[rpcv1.ListIncomingCitationsRequest],
) (*connect.Response[rpcv1.ListIncomingCitationsResponse], error) {
	slog.DebugContext(ctx, "ListIncomingCitations RPC called",
		"function", "ListIncomingCitations",
		"documentID", req.Msg.DocumentId,
	)

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var response *rpcv1.ListIncomingCitationsResponse

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		docID := dbuuid.MustParse(req.Msg.DocumentId)

		// Check access - user must have at least read access to see who cites their document
		accessLevel, isOwner, accessErr := s.Logic.CheckAccess(ctx, tx, organizationID, employeeID, docID)
		if accessErr != nil {
			return accessErr
		}

		if accessLevel == rpcv1.AccessLevel_ACCESS_LEVEL_NONE && !isOwner {
			return ErrAccessDenied
		}

		var txErr error
		response, txErr = s.Logic.ListIncomingCitations(ctx, tx, organizationID, docID)
		return txErr
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	return connect.NewResponse(response), nil
}

func (s *EmbedServiceConnect) DeleteEmbed(
	ctx context.Context,
	req *connect.Request[rpcv1.DeleteEmbedRequest],
) (*connect.Response[rpcv1.DeleteEmbedResponse], error) {
	slog.DebugContext(ctx, "DeleteEmbed RPC called",
		"function", "DeleteEmbed",
		"embedID", req.Msg.EmbedId,
	)

	employeeID, organizationID, err := s.extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		embedID := dbuuid.MustParse(req.Msg.EmbedId)
		return s.Logic.DeleteEmbed(ctx, tx, organizationID, employeeID, embedID)
	})
	if err != nil {
		return nil, s.handleError(err)
	}

	return connect.NewResponse(&rpcv1.DeleteEmbedResponse{
		Success: true,
	}), nil
}

func (s *EmbedServiceConnect) handleError(err error) error {
	switch {
	case err == ErrDocumentNotFound:
		return connect.NewError(connect.CodeNotFound, err)
	case err == ErrEmbedNotFound:
		return connect.NewError(connect.CodeNotFound, err)
	case err == ErrAccessDenied:
		return connect.NewError(connect.CodePermissionDenied, err)
	case err == ErrCircularEmbed:
		return connect.NewError(connect.CodeInvalidArgument, err)
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}
