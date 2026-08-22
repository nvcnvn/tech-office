package collaboration

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/database/txn"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *CollaborationServiceConnect) getMixedOverviewSummaryReadModel(
	ctx context.Context,
	projectID dbuuid.UUID,
) (*MixedOverviewSummary, error) {
	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var summary *MixedOverviewSummary
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		summary, txErr = s.Logic.GetMixedOverviewSummary(ctx, tx, organizationID, projectID)
		return txErr
	})
	if err != nil {
		return nil, fmt.Errorf("failed to load mixed overview summary: %w", err)
	}

	return summary, nil
}

func (s *CollaborationServiceConnect) getRitualWorklistReadModel(
	ctx context.Context,
	projectID dbuuid.UUID,
) (*RitualWorklistData, error) {
	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var worklist *RitualWorklistData
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		worklist, txErr = s.Logic.GetRitualWorklist(ctx, tx, organizationID, projectID)
		return txErr
	})
	if err != nil {
		return nil, fmt.Errorf("failed to load ritual worklist read model: %w", err)
	}

	return worklist, nil
}

// ============================================================================
// Ritual Definition RPC Handlers
// ============================================================================

func (s *CollaborationServiceConnect) CreateRitualDefinition(
	ctx context.Context,
	req *connect.Request[rpcv1.CreateRitualDefinitionRequest],
) (*connect.Response[rpcv1.CreateRitualDefinitionResponse], error) {
	slog.DebugContext(ctx, "CreateRitualDefinition RPC called")

	employeeID, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var def *rpcv1.RitualDefinition
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		def, txErr = s.Logic.CreateRitualDefinition(ctx, tx, organizationID, employeeID, req.Msg)
		if txErr != nil {
			return txErr
		}

		// Generate the immediately-due instances in the same transaction. This replaces
		// the flows.WithRunNow() that used to ride along with the per-definition schedule:
		// the definition and its first instances now commit atomically (FR-011).
		if _, genErr := s.Logic.GenerateRitualInstances(ctx, tx, organizationID, time.Now()); genErr != nil {
			return genErr
		}
		return nil
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create ritual definition", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.CreateRitualDefinitionResponse{
		RitualDefinition: def,
	}), nil
}

func (s *CollaborationServiceConnect) GetRitualDefinition(
	ctx context.Context,
	req *connect.Request[rpcv1.GetRitualDefinitionRequest],
) (*connect.Response[rpcv1.GetRitualDefinitionResponse], error) {
	slog.DebugContext(ctx, "GetRitualDefinition RPC called", "defID", req.Msg.GetRitualDefinitionId())

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	defID := dbuuid.MustParse(req.Msg.GetRitualDefinitionId())

	var def *rpcv1.RitualDefinition
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		def, txErr = s.Logic.GetRitualDefinition(ctx, tx, organizationID, defID)
		return txErr
	})
	if err != nil {
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.GetRitualDefinitionResponse{
		RitualDefinition: def,
	}), nil
}

func (s *CollaborationServiceConnect) UpdateRitualDefinition(
	ctx context.Context,
	req *connect.Request[rpcv1.UpdateRitualDefinitionRequest],
) (*connect.Response[rpcv1.UpdateRitualDefinitionResponse], error) {
	slog.DebugContext(ctx, "UpdateRitualDefinition RPC called", "defID", req.Msg.GetRitualDefinitionId())

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	defID := dbuuid.MustParse(req.Msg.GetRitualDefinitionId())

	var def *rpcv1.RitualDefinition
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		def, txErr = s.Logic.UpdateRitualDefinition(ctx, tx, organizationID, defID, req.Msg)
		if txErr != nil {
			return txErr
		}

		// A changed recurrence rule needs no scheduling work: the next global sweep reads
		// the stored rule directly.
		return nil
	})
	if err != nil {
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.UpdateRitualDefinitionResponse{
		RitualDefinition: def,
	}), nil
}

func (s *CollaborationServiceConnect) ArchiveRitualDefinition(
	ctx context.Context,
	req *connect.Request[rpcv1.ArchiveRitualDefinitionRequest],
) (*connect.Response[rpcv1.ArchiveRitualDefinitionResponse], error) {
	slog.DebugContext(ctx, "ArchiveRitualDefinition RPC called", "defID", req.Msg.GetRitualDefinitionId())

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	defID := dbuuid.MustParse(req.Msg.GetRitualDefinitionId())

	var def *rpcv1.RitualDefinition
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		def, txErr = s.Logic.ArchiveRitualDefinition(ctx, tx, organizationID, defID, req.Msg.GetArchive())
		if txErr != nil {
			return txErr
		}

		// is_archived is the whole mechanism now: the sweep's discovery query selects
		// unarchived definitions only, so there is no schedule to pause or resume (FR-010).
		return nil
	})
	if err != nil {
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.ArchiveRitualDefinitionResponse{
		RitualDefinition: def,
	}), nil
}

func (s *CollaborationServiceConnect) ListRitualDefinitions(
	ctx context.Context,
	req *connect.Request[rpcv1.ListRitualDefinitionsRequest],
) (*connect.Response[rpcv1.ListRitualDefinitionsResponse], error) {
	slog.DebugContext(ctx, "ListRitualDefinitions RPC called", "projectID", req.Msg.GetProjectId())

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	projectID := dbuuid.MustParse(req.Msg.GetProjectId())

	var defs []*rpcv1.RitualDefinition
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		defs, txErr = s.Logic.ListRitualDefinitions(ctx, tx, organizationID, projectID, req.Msg.GetIncludeArchived())
		return txErr
	})
	if err != nil {
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.ListRitualDefinitionsResponse{
		RitualDefinitions: defs,
	}), nil
}

// ============================================================================
// Evidence Requirement RPC Handlers
// ============================================================================

func (s *CollaborationServiceConnect) CreateEvidenceRequirement(
	ctx context.Context,
	req *connect.Request[rpcv1.CreateEvidenceRequirementRequest],
) (*connect.Response[rpcv1.CreateEvidenceRequirementResponse], error) {
	slog.DebugContext(ctx, "CreateEvidenceRequirement RPC called")

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var er *rpcv1.EvidenceRequirementDetail
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		er, txErr = s.Logic.CreateEvidenceRequirement(ctx, tx, organizationID, req.Msg)
		return txErr
	})
	if err != nil {
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.CreateEvidenceRequirementResponse{
		EvidenceRequirement: er,
	}), nil
}

func (s *CollaborationServiceConnect) UpdateEvidenceRequirement(
	ctx context.Context,
	req *connect.Request[rpcv1.UpdateEvidenceRequirementRequest],
) (*connect.Response[rpcv1.UpdateEvidenceRequirementResponse], error) {
	slog.DebugContext(ctx, "UpdateEvidenceRequirement RPC called")

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var er *rpcv1.EvidenceRequirementDetail
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		er, txErr = s.Logic.UpdateEvidenceRequirement(ctx, tx, organizationID, req.Msg)
		return txErr
	})
	if err != nil {
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.UpdateEvidenceRequirementResponse{
		EvidenceRequirement: er,
	}), nil
}

func (s *CollaborationServiceConnect) DeleteEvidenceRequirement(
	ctx context.Context,
	req *connect.Request[rpcv1.DeleteEvidenceRequirementRequest],
) (*connect.Response[rpcv1.DeleteEvidenceRequirementResponse], error) {
	slog.DebugContext(ctx, "DeleteEvidenceRequirement RPC called")

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	reqID := dbuuid.MustParse(req.Msg.GetEvidenceRequirementId())

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		return s.Logic.DeleteEvidenceRequirement(ctx, tx, organizationID, reqID)
	})
	if err != nil {
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.DeleteEvidenceRequirementResponse{}), nil
}

func (s *CollaborationServiceConnect) ListEvidenceRequirements(
	ctx context.Context,
	req *connect.Request[rpcv1.ListEvidenceRequirementsRequest],
) (*connect.Response[rpcv1.ListEvidenceRequirementsResponse], error) {
	slog.DebugContext(ctx, "ListEvidenceRequirements RPC called")

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	defID := dbuuid.MustParse(req.Msg.GetRitualDefinitionId())

	var reqs []*rpcv1.EvidenceRequirementDetail
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		reqs, txErr = s.Logic.ListEvidenceRequirements(ctx, tx, organizationID, defID)
		return txErr
	})
	if err != nil {
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.ListEvidenceRequirementsResponse{
		EvidenceRequirements: reqs,
	}), nil
}

// ============================================================================
// Evidence Submission RPC Handlers
// ============================================================================

func (s *CollaborationServiceConnect) SubmitEvidence(
	ctx context.Context,
	req *connect.Request[rpcv1.SubmitEvidenceRequest],
) (*connect.Response[rpcv1.SubmitEvidenceResponse], error) {
	slog.DebugContext(ctx, "SubmitEvidence RPC called")

	employeeID, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var sub *rpcv1.EvidenceSubmission
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		sub, txErr = s.Logic.SubmitEvidence(ctx, tx, organizationID, employeeID, req.Msg)
		return txErr
	})
	if err != nil {
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.SubmitEvidenceResponse{
		EvidenceSubmission: sub,
	}), nil
}

func (s *CollaborationServiceConnect) ApproveEvidence(
	ctx context.Context,
	req *connect.Request[rpcv1.ApproveEvidenceRequest],
) (*connect.Response[rpcv1.ApproveEvidenceResponse], error) {
	slog.DebugContext(ctx, "ApproveEvidence RPC called")

	employeeID, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var sub *rpcv1.EvidenceSubmission
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		sub, txErr = s.Logic.ApproveEvidence(ctx, tx, organizationID, employeeID, req.Msg)
		return txErr
	})
	if err != nil {
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.ApproveEvidenceResponse{
		EvidenceSubmission: sub,
	}), nil
}

func (s *CollaborationServiceConnect) RejectEvidence(
	ctx context.Context,
	req *connect.Request[rpcv1.RejectEvidenceRequest],
) (*connect.Response[rpcv1.RejectEvidenceResponse], error) {
	slog.DebugContext(ctx, "RejectEvidence RPC called")

	employeeID, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var sub *rpcv1.EvidenceSubmission
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		sub, txErr = s.Logic.RejectEvidence(ctx, tx, organizationID, employeeID, req.Msg)
		return txErr
	})
	if err != nil {
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.RejectEvidenceResponse{
		EvidenceSubmission: sub,
	}), nil
}

func (s *CollaborationServiceConnect) ListEvidenceSubmissions(
	ctx context.Context,
	req *connect.Request[rpcv1.ListEvidenceSubmissionsRequest],
) (*connect.Response[rpcv1.ListEvidenceSubmissionsResponse], error) {
	slog.DebugContext(ctx, "ListEvidenceSubmissions RPC called")

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	taskID := dbuuid.MustParse(req.Msg.GetTaskId())

	var subs []*rpcv1.EvidenceSubmission
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		subs, txErr = s.Logic.ListEvidenceSubmissions(ctx, tx, organizationID, taskID)
		return txErr
	})
	if err != nil {
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.ListEvidenceSubmissionsResponse{
		EvidenceSubmissions: subs,
	}), nil
}

// ============================================================================
// Skip Ritual Instance RPC Handler
// ============================================================================

func (s *CollaborationServiceConnect) SkipRitualInstance(
	ctx context.Context,
	req *connect.Request[rpcv1.SkipRitualInstanceRequest],
) (*connect.Response[rpcv1.SkipRitualInstanceResponse], error) {
	slog.DebugContext(ctx, "SkipRitualInstance RPC called", "taskID", req.Msg.GetTaskId())

	employeeID, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var task *rpcv1.Task
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		task, txErr = s.Logic.SkipRitualInstance(ctx, tx, organizationID, employeeID, req.Msg)
		return txErr
	})
	if err != nil {
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.SkipRitualInstanceResponse{
		Task: task,
	}), nil
}

// ============================================================================
// Schedule Change RPC Handlers
// ============================================================================

func (s *CollaborationServiceConnect) GetScheduleChangeImpact(
	ctx context.Context,
	req *connect.Request[rpcv1.GetScheduleChangeImpactRequest],
) (*connect.Response[rpcv1.GetScheduleChangeImpactResponse], error) {
	slog.DebugContext(ctx, "GetScheduleChangeImpact RPC called", "defID", req.Msg.GetRitualDefinitionId())

	employeeID, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var resp *rpcv1.GetScheduleChangeImpactResponse
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		resp, txErr = s.Logic.GetScheduleChangeImpact(ctx, tx, organizationID, employeeID, req.Msg)
		return txErr
	})
	if err != nil {
		return nil, handleError(err)
	}

	return connect.NewResponse(resp), nil
}

func (s *CollaborationServiceConnect) ChangeRitualDefinitionSchedule(
	ctx context.Context,
	req *connect.Request[rpcv1.ChangeRitualDefinitionScheduleRequest],
) (*connect.Response[rpcv1.ChangeRitualDefinitionScheduleResponse], error) {
	slog.DebugContext(ctx, "ChangeRitualDefinitionSchedule RPC called", "defID", req.Msg.GetRitualDefinitionId())

	employeeID, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var resp *rpcv1.ChangeRitualDefinitionScheduleResponse
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		resp, txErr = s.Logic.ChangeRitualDefinitionSchedule(ctx, tx, organizationID, employeeID, req.Msg)
		if txErr != nil {
			return txErr
		}

		// Regeneration and the removed/detached/created counts happen in the logic layer
		// (FR-012); there is no timer left to rewrite.
		return nil
	})
	if err != nil {
		return nil, handleError(err)
	}

	return connect.NewResponse(resp), nil
}

// ============================================================================
// Operational Health RPC Handlers
// ============================================================================

func (s *CollaborationServiceConnect) GetOperationalHealth(
	ctx context.Context,
	req *connect.Request[rpcv1.GetOperationalHealthRequest],
) (*connect.Response[rpcv1.GetOperationalHealthResponse], error) {
	slog.DebugContext(ctx, "GetOperationalHealth RPC called", "projectID", req.Msg.GetProjectId())

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	projectID := dbuuid.MustParse(req.Msg.GetProjectId())
	startDate := timestampToDate(req.Msg.GetStartDate())
	endDate := timestampToDate(req.Msg.GetEndDate())

	var resp *rpcv1.GetOperationalHealthResponse
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		resp, txErr = s.Logic.GetOperationalHealth(ctx, tx, organizationID, projectID, startDate, endDate)
		return txErr
	})
	if err != nil {
		return nil, handleError(err)
	}

	return connect.NewResponse(resp), nil
}

func (s *CollaborationServiceConnect) GetRitualComplianceSummary(
	ctx context.Context,
	req *connect.Request[rpcv1.GetRitualComplianceSummaryRequest],
) (*connect.Response[rpcv1.GetRitualComplianceSummaryResponse], error) {
	slog.DebugContext(ctx, "GetRitualComplianceSummary RPC called", "projectID", req.Msg.GetProjectId())

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	projectID := dbuuid.MustParse(req.Msg.GetProjectId())
	startDate := timestampToDate(req.Msg.GetStartDate())
	endDate := timestampToDate(req.Msg.GetEndDate())

	var resp *rpcv1.GetRitualComplianceSummaryResponse
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		resp, txErr = s.Logic.GetRitualComplianceSummary(ctx, tx, organizationID, projectID, startDate, endDate)
		return txErr
	})
	if err != nil {
		return nil, handleError(err)
	}

	return connect.NewResponse(resp), nil
}

func (s *CollaborationServiceConnect) ExportRitualComplianceCSV(
	ctx context.Context,
	req *connect.Request[rpcv1.ExportRitualComplianceCSVRequest],
) (*connect.Response[rpcv1.ExportRitualComplianceCSVResponse], error) {
	slog.DebugContext(ctx, "ExportRitualComplianceCSV RPC called", "projectID", req.Msg.GetProjectId())

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	projectID := dbuuid.MustParse(req.Msg.GetProjectId())
	startDate := timestampToDate(req.Msg.GetStartDate())
	endDate := timestampToDate(req.Msg.GetEndDate())

	var csvData []byte
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		csvData, txErr = s.Logic.ExportRitualComplianceCSV(ctx, tx, organizationID, projectID, startDate, endDate)
		return txErr
	})
	if err != nil {
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.ExportRitualComplianceCSVResponse{
		CsvData: csvData,
	}), nil
}

// timestampToDate converts a protobuf Timestamp to pgtype.Date.
func timestampToDate(ts *timestamppb.Timestamp) pgtype.Date {
	if ts == nil {
		return pgtype.Date{}
	}
	return pgtype.Date{Time: ts.AsTime(), Valid: true}
}
