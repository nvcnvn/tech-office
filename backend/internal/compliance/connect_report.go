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

func (s *ServiceConnect) ReportContent(
	ctx context.Context,
	req *connect.Request[rpcv1.ReportContentRequest],
) (*connect.Response[rpcv1.ReportContentResponse], error) {
	reporterID, orgID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	targetKind, ok := TargetKindFromProto(req.Msg.GetTargetKind())
	if !ok {
		return nil, ToConnectError(ErrInvalidTarget, nil)
	}
	reason, ok := ReasonFromProto(req.Msg.GetReason())
	if !ok {
		return nil, ToConnectError(ErrInvalidReason, nil)
	}
	targetID, err := dbuuid.Parse(req.Msg.GetTargetId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	var report *database.ComplianceContentReport
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		report, logicErr = s.Logic.ReportContent(ctx, tx, ReportContentParams{
			OrganizationID:     orgID,
			ReporterEmployeeID: reporterID,
			TargetKind:         targetKind,
			TargetID:           targetID,
			Reason:             reason,
			Note:               req.Msg.GetNote(),
		})
		return logicErr
	}); err != nil {
		return nil, handleError(err, map[string]string{"target_kind": targetKind})
	}

	return connect.NewResponse(&rpcv1.ReportContentResponse{
		ReportId:  report.ID.String(),
		CreatedAt: tsToProto(report.CreatedAt),
	}), nil
}

func (s *ServiceConnect) ListReports(
	ctx context.Context,
	req *connect.Request[rpcv1.ListReportsRequest],
) (*connect.Response[rpcv1.ListReportsResponse], error) {
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
	if status, ok := ReportStatusFromProto(req.Msg.GetStatusFilter()); ok {
		statusFilter = pgtype.Text{String: status, Valid: true}
	}

	var rows []*database.ListContentReportsRow
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var qErr error
		// Ask for one more than the page so the presence of a next page is known
		// without a second count query.
		rows, qErr = s.Logic.Queries.ListContentReports(ctx, tx, &database.ListContentReportsParams{
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

	reports := make([]*rpcv1.ContentReport, len(rows))
	for i, row := range rows {
		reports[i] = listRowToProto(row)
	}
	return connect.NewResponse(&rpcv1.ListReportsResponse{
		Reports:    reports,
		NextCursor: nextCursor,
	}), nil
}

func (s *ServiceConnect) GetReport(
	ctx context.Context,
	req *connect.Request[rpcv1.GetReportRequest],
) (*connect.Response[rpcv1.GetReportResponse], error) {
	viewerID, orgID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}
	reportID, err := dbuuid.Parse(req.Msg.GetReportId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	var row *database.GetContentReportRow
	var deepLink string
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var qErr error
		row, qErr = s.Logic.Queries.GetContentReport(ctx, tx, &database.GetContentReportParams{
			OrganizationID: orgID,
			ID:             reportID,
		})
		if qErr != nil {
			return ErrReportNotFound
		}
		// A deep link is a convenience, not a requirement: the snapshot is what
		// makes the report reviewable, so a target that has since been deleted
		// simply yields no link rather than an error.
		if resolver, ok := s.Logic.Resolvers[row.TargetKind]; ok {
			if target, resolveErr := resolver.ResolveReportTarget(ctx, tx, orgID, viewerID, row.TargetID); resolveErr == nil {
				deepLink = target.DeepLink
			}
		}
		return nil
	}); err != nil {
		return nil, handleError(err, nil)
	}

	return connect.NewResponse(&rpcv1.GetReportResponse{
		Report:              getRowToProto(row),
		LiveContentDeepLink: deepLink,
	}), nil
}

func (s *ServiceConnect) ResolveReport(
	ctx context.Context,
	req *connect.Request[rpcv1.ResolveReportRequest],
) (*connect.Response[rpcv1.ResolveReportResponse], error) {
	reviewerID, orgID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}
	reportID, err := dbuuid.Parse(req.Msg.GetReportId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	outcome, ok := ReportStatusFromProto(req.Msg.GetOutcome())
	if !ok || !IsReportOutcome(outcome) {
		return nil, ToConnectError(ErrInvalidTarget, nil)
	}

	var report *database.ComplianceContentReport
	if err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var logicErr error
		report, logicErr = s.Logic.ResolveReport(ctx, tx, ResolveReportParams{
			OrganizationID: orgID,
			ReviewerID:     reviewerID,
			ReportID:       reportID,
			Outcome:        outcome,
			OutcomeNote:    req.Msg.GetOutcomeNote(),
		})
		return logicErr
	}); err != nil {
		return nil, handleError(err, nil)
	}

	return connect.NewResponse(&rpcv1.ResolveReportResponse{
		Report: reportToProto(report, "", ""),
	}), nil
}

// --- proto conversion ---

func reportToProto(r *database.ComplianceContentReport, reporterName, reportedName string) *rpcv1.ContentReport {
	out := &rpcv1.ContentReport{
		Id:                 r.ID.String(),
		ReporterEmployeeId: r.ReporterEmployeeID.String(),
		ReporterName:       reporterName,
		ReportedEmployeeId: r.ReportedEmployeeID.String(),
		ReportedName:       reportedName,
		TargetKind:         TargetKindToProto(r.TargetKind),
		TargetId:           r.TargetID.String(),
		ContentSnapshot:    r.ContentSnapshot,
		Reason:             ReasonToProto(r.Reason),
		Note:               r.Note.String,
		Status:             ReportStatusToProto(r.Status),
		OutcomeNote:        r.OutcomeNote.String,
		ReviewedAt:         tsToProto(r.ReviewedAt),
		CreatedAt:          tsToProto(r.CreatedAt),
	}
	if r.ReviewedByEmployeeID.Valid {
		out.ReviewedByEmployeeId = dbuuid.UUID(r.ReviewedByEmployeeID.UUID).String()
	}
	return out
}

func listRowToProto(r *database.ListContentReportsRow) *rpcv1.ContentReport {
	return reportToProto(&database.ComplianceContentReport{
		ID:                   r.ID,
		OrganizationID:       r.OrganizationID,
		ReporterEmployeeID:   r.ReporterEmployeeID,
		ReportedEmployeeID:   r.ReportedEmployeeID,
		TargetKind:           r.TargetKind,
		TargetID:             r.TargetID,
		ContentSnapshot:      r.ContentSnapshot,
		Reason:               r.Reason,
		Note:                 r.Note,
		Status:               r.Status,
		OutcomeNote:          r.OutcomeNote,
		ReviewedByEmployeeID: r.ReviewedByEmployeeID,
		ReviewedAt:           r.ReviewedAt,
		CreatedAt:            r.CreatedAt,
	}, r.ReporterName, r.ReportedName)
}

func getRowToProto(r *database.GetContentReportRow) *rpcv1.ContentReport {
	return reportToProto(&database.ComplianceContentReport{
		ID:                   r.ID,
		OrganizationID:       r.OrganizationID,
		ReporterEmployeeID:   r.ReporterEmployeeID,
		ReportedEmployeeID:   r.ReportedEmployeeID,
		TargetKind:           r.TargetKind,
		TargetID:             r.TargetID,
		ContentSnapshot:      r.ContentSnapshot,
		Reason:               r.Reason,
		Note:                 r.Note,
		Status:               r.Status,
		OutcomeNote:          r.OutcomeNote,
		ReviewedByEmployeeID: r.ReviewedByEmployeeID,
		ReviewedAt:           r.ReviewedAt,
		CreatedAt:            r.CreatedAt,
	}, r.ReporterName, r.ReportedName)
}
