package compliance

import (
	"context"

	"connectrpc.com/connect"
	"github.com/nvcnvn/tech-office/backend/database"
	"github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/database/txn"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// BlockPerson records a block. Note what is absent: no notification is published
// anywhere on this path. The blocked person must never learn they were blocked
// (FR-022), and the integration test asserts the silence.
func (s *ServiceConnect) BlockPerson(
	ctx context.Context,
	req *connect.Request[rpcv1.BlockPersonRequest],
) (*connect.Response[rpcv1.BlockPersonResponse], error) {
	blockerID, orgID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}
	blockedID, err := dbuuid.Parse(req.Msg.GetEmployeeId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	var block *database.ComplianceBlock
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		block, logicErr = s.Logic.BlockPerson(ctx, tx, orgID, blockerID, blockedID)
		return logicErr
	}); err != nil {
		return nil, handleError(err, nil)
	}

	return connect.NewResponse(&rpcv1.BlockPersonResponse{
		BlockId:   block.ID.String(),
		CreatedAt: tsToProto(block.CreatedAt),
	}), nil
}

func (s *ServiceConnect) UnblockPerson(
	ctx context.Context,
	req *connect.Request[rpcv1.UnblockPersonRequest],
) (*connect.Response[rpcv1.UnblockPersonResponse], error) {
	blockerID, orgID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}
	blockedID, err := dbuuid.Parse(req.Msg.GetEmployeeId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		return s.Logic.UnblockPerson(ctx, tx, orgID, blockerID, blockedID)
	}); err != nil {
		return nil, handleError(err, nil)
	}
	return connect.NewResponse(&rpcv1.UnblockPersonResponse{}), nil
}

// ListBlockedPeople returns the caller's own list. There is deliberately no RPC
// answering "who has blocked me": keeping that unanswerable at the API layer is
// what makes FR-022 hold beyond the UI.
func (s *ServiceConnect) ListBlockedPeople(
	ctx context.Context,
	_ *connect.Request[rpcv1.ListBlockedPeopleRequest],
) (*connect.Response[rpcv1.ListBlockedPeopleResponse], error) {
	blockerID, orgID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var rows []*database.ListBlockedPeopleRow
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		rows, logicErr = s.Logic.ListBlockedPeople(ctx, tx, orgID, blockerID)
		return logicErr
	}); err != nil {
		return nil, handleError(err, nil)
	}

	blocked := make([]*rpcv1.BlockedPerson, len(rows))
	for i, row := range rows {
		blocked[i] = &rpcv1.BlockedPerson{
			BlockId:     row.ID.String(),
			EmployeeId:  row.BlockedEmployeeID.String(),
			DisplayName: row.BlockedName,
			Email:       row.BlockedEmail,
			CreatedAt:   tsToProto(row.CreatedAt),
		}
	}
	return connect.NewResponse(&rpcv1.ListBlockedPeopleResponse{Blocked: blocked}), nil
}
