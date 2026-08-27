package compliance

import (
	"context"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/database/txn"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// GetAccountRemovalPath tells the client which of the two paths this person gets,
// so mobile and web render the right screen instead of each inferring it from
// other fields and eventually disagreeing (FR-007b).
func (s *ServiceConnect) GetAccountRemovalPath(
	ctx context.Context,
	_ *connect.Request[rpcv1.GetAccountRemovalPathRequest],
) (*connect.Response[rpcv1.GetAccountRemovalPathResponse], error) {
	employeeID, orgID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	resp := &rpcv1.GetAccountRemovalPathResponse{}
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		orgManaged, mErr := s.Logic.Eraser.IsOrgManaged(ctx, tx, employeeID)
		if mErr != nil {
			return mErr
		}
		if !orgManaged {
			resp.Path = rpcv1.AccountRemovalPath_ACCOUNT_REMOVAL_PATH_SELF_DELETE
			return nil
		}

		resp.Path = rpcv1.AccountRemovalPath_ACCOUNT_REMOVAL_PATH_REQUEST_REMOVAL
		org, oErr := s.Logic.Queries.GetOrganizationByID(ctx, tx, orgID)
		if oErr != nil {
			return oErr
		}
		resp.ManagingOrganizationName = org.CompanyName

		latest, lErr := s.Logic.LatestRemovalRequest(ctx, tx, orgID, employeeID)
		if lErr != nil {
			return lErr
		}
		if latest != nil {
			resp.LatestRequest = removalRequestToProto(latest, "")
		}
		return nil
	}); err != nil {
		return nil, handleError(err, nil)
	}
	return connect.NewResponse(resp), nil
}

func (s *ServiceConnect) RequestAccountRemoval(
	ctx context.Context,
	req *connect.Request[rpcv1.RequestAccountRemovalRequest],
) (*connect.Response[rpcv1.RequestAccountRemovalResponse], error) {
	employeeID, orgID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var request *database.ComplianceRemovalRequest
	var alreadyOutstanding bool
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		orgManaged, mErr := s.Logic.Eraser.IsOrgManaged(ctx, tx, employeeID)
		if mErr != nil {
			return mErr
		}
		if !orgManaged {
			// A self-registered person deletes their own account; sending them down
			// the request path would make deletion depend on somebody else agreeing.
			return ErrNotOrgManaged
		}
		var logicErr error
		request, alreadyOutstanding, logicErr = s.Logic.RequestAccountRemoval(ctx, tx, orgID, employeeID, req.Msg.GetNote())
		return logicErr
	}); err != nil {
		return nil, handleError(err, nil)
	}

	return connect.NewResponse(&rpcv1.RequestAccountRemovalResponse{
		Request:            removalRequestToProto(request, ""),
		AlreadyOutstanding: alreadyOutstanding,
	}), nil
}

func (s *ServiceConnect) ListRemovalRequests(
	ctx context.Context,
	req *connect.Request[rpcv1.ListRemovalRequestsRequest],
) (*connect.Response[rpcv1.ListRemovalRequestsResponse], error) {
	_, orgID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}
	cursor, err := parseOptionalUUID(req.Msg.GetCursor())
	if err != nil {
		return nil, err
	}
	limit := clampLimit(req.Msg.GetLimit())

	var statusFilter pgtype.Text
	if status, ok := RemovalStatusFromProto(req.Msg.GetStatusFilter()); ok {
		statusFilter = pgtype.Text{String: status, Valid: true}
	}

	var rows []*database.ListRemovalRequestsRow
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var qErr error
		rows, qErr = s.Logic.Queries.ListRemovalRequests(ctx, tx, &database.ListRemovalRequestsParams{
			OrganizationID: orgID,
			StatusFilter:   statusFilter,
			Cursor:         cursor,
			Limit:          limit + 1,
		})
		return qErr
	}); err != nil {
		return nil, handleError(err, nil)
	}

	nextCursor := ""
	if int32(len(rows)) > limit {
		rows = rows[:limit]
		nextCursor = rows[len(rows)-1].ID.String()
	}

	requests := make([]*rpcv1.RemovalRequest, len(rows))
	for i, row := range rows {
		requests[i] = removalRequestToProto(&database.ComplianceRemovalRequest{
			ID:                  row.ID,
			OrganizationID:      row.OrganizationID,
			EmployeeID:          row.EmployeeID,
			Status:              row.Status,
			Note:                row.Note,
			DecidedByEmployeeID: row.DecidedByEmployeeID,
			DecidedAt:           row.DecidedAt,
			CreatedAt:           row.CreatedAt,
		}, row.EmployeeName)
	}
	return connect.NewResponse(&rpcv1.ListRemovalRequestsResponse{
		Requests:   requests,
		NextCursor: nextCursor,
	}), nil
}

func (s *ServiceConnect) DecideRemovalRequest(
	ctx context.Context,
	req *connect.Request[rpcv1.DecideRemovalRequestRequest],
) (*connect.Response[rpcv1.DecideRemovalRequestResponse], error) {
	deciderID, orgID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}
	requestID, err := dbuuid.Parse(req.Msg.GetRequestId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	decision, ok := RemovalStatusFromProto(req.Msg.GetDecision())
	if !ok || !IsRemovalDecision(decision) {
		return nil, ToConnectError(ErrInvalidDecision, nil)
	}

	var decided *database.ComplianceRemovalRequest
	var purgeEnqueued bool
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		decided, purgeEnqueued, logicErr = s.Logic.DecideRemovalRequest(ctx, tx, orgID, deciderID, requestID, decision)
		return logicErr
	}); err != nil {
		return nil, handleError(err, nil)
	}

	return connect.NewResponse(&rpcv1.DecideRemovalRequestResponse{
		Request:             removalRequestToProto(decided, ""),
		GlobalPurgeEnqueued: purgeEnqueued,
	}), nil
}

func removalRequestToProto(r *database.ComplianceRemovalRequest, employeeName string) *rpcv1.RemovalRequest {
	if r == nil {
		return nil
	}
	out := &rpcv1.RemovalRequest{
		Id:           r.ID.String(),
		EmployeeId:   r.EmployeeID.String(),
		EmployeeName: employeeName,
		Status:       RemovalStatusToProto(r.Status),
		Note:         r.Note.String,
		DecidedAt:    tsToProto(r.DecidedAt),
		CreatedAt:    tsToProto(r.CreatedAt),
	}
	if r.DecidedByEmployeeID.Valid {
		out.DecidedByEmployeeId = dbuuid.UUID(r.DecidedByEmployeeID.UUID).String()
	}
	return out
}
