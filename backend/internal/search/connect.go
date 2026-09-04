package search

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/interceptor"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/nvcnvn/tech-office/backend/rpc/v1/rpcv1connect"
)

// SearchServiceServer implements the SearchService RPC interface.
type SearchServiceServer struct {
	// TenantPool is handed to the fan-out as-is rather than being wrapped in a
	// transaction: a pgx transaction is NOT safe for concurrent use, and the fan-out is
	// concurrent by design. *pgxpool.Pool is concurrency-safe and hands each source its
	// own connection. Search is a read with no cross-source consistency requirement.
	TenantPool database.TenantDatabaseConnector
	logic      SearchLogic
	sources    []source
}

// NewService creates a new SearchServiceServer.
func NewService(tenantPool database.TenantDatabaseConnector, deps Deps) rpcv1connect.SearchServiceHandler {
	return &SearchServiceServer{
		TenantPool: tenantPool,
		logic:      NewLogic(deps),
		sources:    buildSources(deps),
	}
}

func (s *SearchServiceServer) Search(
	ctx context.Context,
	req *connect.Request[rpcv1.SearchRequest],
) (*connect.Response[rpcv1.SearchResponse], error) {
	orgIDStr, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok || orgIDStr == "" {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("organization ID not found in context"))
	}
	orgID, err := dbuuid.Parse(orgIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("invalid organization ID: %w", err))
	}

	employeeIDStr, ok := interceptor.UserIDFromContext(ctx)
	if !ok || employeeIDStr == "" {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("employee ID not found in context"))
	}
	employeeID, err := dbuuid.Parse(employeeIDStr)
	if err != nil {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("invalid employee ID: %w", err))
	}

	query := strings.TrimSpace(req.Msg.GetQuery())
	if len([]rune(query)) < minQueryLength {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("query must be at least %d characters", minQueryLength))
	}
	if r := []rune(query); len(r) > maxQueryLength {
		// Truncated rather than rejected: a long paste is not a caller error.
		query = string(r[:maxQueryLength])
	}

	kindFilter := req.Msg.GetKindFilter()
	limit := ClampLimit(req.Msg.GetLimit(), kindFilter)

	// A permission gap is a skip, not a failure: the source is reported NOT_PERMITTED
	// and is never queried, and the search as a whole still succeeds.
	permissions, _ := interceptor.UserPermissionsFromContext(ctx)
	notPermitted := s.deniedSources(permissions)

	start := time.Now()
	hits, outcomes := s.logic.Search(ctx, s.TenantPool, Params{
		OrgID:        orgID,
		EmployeeID:   employeeID,
		Query:        query,
		KindFilter:   kindFilter,
		Limit:        limit,
		NotPermitted: notPermitted,
	})

	slog.InfoContext(ctx, "federated search completed",
		"organization_id", orgID.String(),
		"employee_id", employeeID.String(),
		"kind_filter", kindFilter.String(),
		"hit_count", len(hits),
		"duration_ms", time.Since(start).Milliseconds(),
		"outcomes", outcomeSummary(outcomes),
	)

	// The one case where an error is the honest answer: every source that was actually
	// attempted failed. An empty successful list would tell the person their workspace
	// contains nothing. A caller permitted to search NOTHING is not this case — nothing
	// is broken, it is just not theirs — and gets a normal empty response.
	attempted, succeeded := 0, 0
	for _, o := range outcomes {
		switch o.GetStatus() {
		case rpcv1.SourceStatus_SOURCE_STATUS_OK:
			attempted++
			succeeded++
		case rpcv1.SourceStatus_SOURCE_STATUS_UNAVAILABLE:
			attempted++
		}
	}
	if attempted > 0 && succeeded == 0 {
		return nil, connect.NewError(connect.CodeUnavailable,
			fmt.Errorf("no search source could be reached"))
	}

	return connect.NewResponse(&rpcv1.SearchResponse{
		Hits:     hits,
		Outcomes: outcomes,
	}), nil
}

// deniedSources maps the caller's effective permissions onto the source table. Events
// have no permission and are therefore never denied.
func (s *SearchServiceServer) deniedSources(permissions []string) map[rpcv1.SearchKind]string {
	held := make(map[string]struct{}, len(permissions))
	for _, p := range permissions {
		held[p] = struct{}{}
	}

	denied := make(map[rpcv1.SearchKind]string)
	for _, src := range s.sources {
		if src.permission == "" {
			continue
		}
		if _, ok := held[src.permission]; !ok {
			denied[src.kind] = "missing permission " + src.permission
		}
	}
	return denied
}

func outcomeSummary(outcomes []*rpcv1.SourceOutcome) string {
	parts := make([]string, 0, len(outcomes))
	for _, o := range outcomes {
		parts = append(parts, fmt.Sprintf("%s=%s(%d)",
			strings.TrimPrefix(o.GetKind().String(), "SEARCH_KIND_"),
			strings.TrimPrefix(o.GetStatus().String(), "SOURCE_STATUS_"),
			o.GetHitCount(),
		))
	}
	return strings.Join(parts, " ")
}
