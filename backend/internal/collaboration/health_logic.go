package collaboration

import (
	"bytes"
	"context"
	"encoding/csv"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// GetOperationalHealth returns the operational health summary for a project.
func (l *logicImpl) GetOperationalHealth(
	ctx context.Context,
	tx database.DBTX,
	orgID, projectID dbuuid.UUID,
	startDate, endDate pgtype.Date,
) (*rpcv1.GetOperationalHealthResponse, error) {
	// Get overall project summary
	summary, err := l.Queries.GetProjectRitualSummary(ctx, tx, &database.GetProjectRitualSummaryParams{
		OrganizationID: orgID,
		ProjectID:      projectID,
		StartDate:      startDate,
		EndDate:        endDate,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get project ritual summary: %w", err)
	}

	var completionRate, onTimeRate float64
	if summary.TotalInstances > 0 {
		onTimeCount := summary.VerifiedCount
		completionRate = float64(onTimeCount+summary.OverdueCount) / float64(summary.TotalInstances)
		onTimeRate = float64(onTimeCount) / float64(summary.TotalInstances)
	}

	resp := &rpcv1.GetOperationalHealthResponse{
		Summary: &rpcv1.OperationalHealthSummary{
			ProjectId:          projectID.String(),
			TotalInstances:     summary.TotalInstances,
			OnTimeCount:        summary.VerifiedCount,
			OverdueCount:       summary.OverdueCount,
			MissedCount:        summary.MissedCount,
			PendingReviewCount: summary.PendingReviewCount,
			CompletionRate:     completionRate,
			OnTimeRate:         onTimeRate,
		},
	}

	// Get per-definition breakdown
	details, err := l.Queries.GetRitualHealthByDefinition(ctx, tx, &database.GetRitualHealthByDefinitionParams{
		OrganizationID: orgID,
		ProjectID:      projectID,
		StartDate:      startDate,
		EndDate:        endDate,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get ritual health by definition: %w", err)
	}

	for _, d := range details {
		var healthScore float64
		if d.TotalInstances > 0 {
			healthScore = float64(d.VerifiedCount) / float64(d.TotalInstances)
		}

		resp.RitualDetails = append(resp.RitualDetails, &rpcv1.RitualHealthDetail{
			RitualDefinitionId: dbuuid.NullUUIDToUUID(d.RitualDefinitionID).String(),
			RitualName:         d.RitualName,
			TotalInstances:     d.TotalInstances,
			VerifiedCount:      d.VerifiedCount,
			OverdueCount:       d.OverdueCount,
			MissedCount:        d.MissedCount,
			HealthScore:        healthScore,
		})
	}

	return resp, nil
}

// GetRitualComplianceSummary returns employee compliance summaries for a project.
func (l *logicImpl) GetRitualComplianceSummary(
	ctx context.Context,
	tx database.DBTX,
	orgID, projectID dbuuid.UUID,
	startDate, endDate pgtype.Date,
) (*rpcv1.GetRitualComplianceSummaryResponse, error) {
	rows, err := l.Queries.GetEmployeeComplianceSummary(ctx, tx, &database.GetEmployeeComplianceSummaryParams{
		OrganizationID: orgID,
		ProjectID:      projectID,
		StartDate:      startDate,
		EndDate:        endDate,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get employee compliance summary: %w", err)
	}

	resp := &rpcv1.GetRitualComplianceSummaryResponse{
		EmployeeSummaries: make([]*rpcv1.EmployeeComplianceSummary, 0, len(rows)),
	}
	for _, r := range rows {
		var complianceRate float64
		if r.TotalAssigned > 0 {
			complianceRate = float64(r.CompletedOnTime) / float64(r.TotalAssigned)
		}

		resp.EmployeeSummaries = append(resp.EmployeeSummaries, &rpcv1.EmployeeComplianceSummary{
			EmployeeId:      r.EmployeeID.String(),
			TotalAssigned:   r.TotalAssigned,
			CompletedOnTime: r.CompletedOnTime,
			CompletedLate:   r.CompletedLate,
			Missed:          r.Missed,
			ComplianceRate:  complianceRate,
		})
	}

	return resp, nil
}

// ExportRitualComplianceCSV exports compliance data as CSV bytes.
func (l *logicImpl) ExportRitualComplianceCSV(
	ctx context.Context,
	tx database.DBTX,
	orgID, projectID dbuuid.UUID,
	startDate, endDate pgtype.Date,
) ([]byte, error) {
	rows, err := l.Queries.GetEmployeeComplianceSummary(ctx, tx, &database.GetEmployeeComplianceSummaryParams{
		OrganizationID: orgID,
		ProjectID:      projectID,
		StartDate:      startDate,
		EndDate:        endDate,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get compliance data for export: %w", err)
	}

	var buf bytes.Buffer
	w := csv.NewWriter(&buf)

	// Header
	if err := w.Write([]string{
		"Employee ID",
		"Total Assigned",
		"Completed On Time",
		"Completed Late",
		"Missed",
		"Compliance Rate",
	}); err != nil {
		return nil, fmt.Errorf("failed to write CSV header: %w", err)
	}

	for _, r := range rows {
		var complianceRate float64
		if r.TotalAssigned > 0 {
			complianceRate = float64(r.CompletedOnTime) / float64(r.TotalAssigned)
		}

		if err := w.Write([]string{
			r.EmployeeID.String(),
			fmt.Sprintf("%d", r.TotalAssigned),
			fmt.Sprintf("%d", r.CompletedOnTime),
			fmt.Sprintf("%d", r.CompletedLate),
			fmt.Sprintf("%d", r.Missed),
			fmt.Sprintf("%.2f", complianceRate),
		}); err != nil {
			return nil, fmt.Errorf("failed to write CSV row: %w", err)
		}
	}

	w.Flush()
	if err := w.Error(); err != nil {
		return nil, fmt.Errorf("CSV flush error: %w", err)
	}

	return buf.Bytes(), nil
}
