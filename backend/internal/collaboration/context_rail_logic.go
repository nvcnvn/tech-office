package collaboration

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

const defaultAssignedWorkSummaryLimit int32 = 5
const maxAssignedWorkSummaryLimit int32 = 20

func (l *logicImpl) GetAssignedWorkSummary(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	req *rpcv1.GetAssignedWorkSummaryRequest,
) (*rpcv1.GetAssignedWorkSummaryResponse, error) {
	asOf := time.Now()
	asOfDate := pgtype.Date{Time: asOf, Valid: true}
	limit := defaultAssignedWorkSummaryLimit
	if req.GetLimit() > 0 {
		limit = req.GetLimit()
		if limit > maxAssignedWorkSummaryLimit {
			limit = maxAssignedWorkSummaryLimit
		}
	}

	counts, err := l.Queries.GetAssignedWorkSummaryCounts(ctx, tx, &database.GetAssignedWorkSummaryCountsParams{
		OrganizationID:         orgID,
		EmployeeID:             employeeID,
		AsOfDate:               asOfDate,
		IncludeRitualInstances: req.GetIncludeRitualInstances(),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to load assigned work summary counts: %w", err)
	}

	rows, err := l.Queries.ListAssignedWorkSummaryItems(ctx, tx, &database.ListAssignedWorkSummaryItemsParams{
		OrganizationID:         orgID,
		EmployeeID:             employeeID,
		AsOfDate:               asOfDate,
		IncludeRitualInstances: req.GetIncludeRitualInstances(),
		ItemLimit:              limit,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to load assigned work summary items: %w", err)
	}

	items := make([]*rpcv1.AssignedWorkSummaryItem, 0, len(rows))
	for _, row := range rows {
		item := &rpcv1.AssignedWorkSummaryItem{
			TaskId:        row.TaskID.String(),
			ProjectId:     row.ProjectID.String(),
			ProjectKey:    row.ProjectKey,
			Title:         row.Title,
			UrgencyBucket: row.UrgencyBucket,
		}
		if row.DueDate.Valid {
			dueDate := row.DueDate.Time.Format("2006-01-02")
			item.DueDate = &dueDate
		}
		stateName := row.StateName
		item.StateName = &stateName
		items = append(items, item)
	}

	return &rpcv1.GetAssignedWorkSummaryResponse{
		AsOfDate:      asOf.Format("2006-01-02"),
		DueTodayCount: counts.DueTodayCount,
		OverdueCount:  counts.OverdueCount,
		Items:         items,
	}, nil
}
