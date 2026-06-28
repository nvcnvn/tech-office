package collaboration

import (
	"bytes"
	"context"
	"encoding/csv"
	"fmt"
	"log/slog"

	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

// GetTaskAnalytics retrieves task analytics for a project
func (l *logicImpl) GetTaskAnalytics(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	req *rpcv1.GetTaskAnalyticsRequest,
) (*rpcv1.GetTaskAnalyticsResponse, error) {
	projectID := dbuuid.MustParse(req.ProjectId)

	slog.DebugContext(ctx, "GetTaskAnalytics",
		"projectID", projectID,
		"groupBy", req.GroupBy,
	)

	// Get project task summary for overall statistics
	summary, err := l.Queries.GetProjectTaskSummary(ctx, tx, &database.GetProjectTaskSummaryParams{
		OrganizationID: orgID,
		ProjectID:      projectID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get task summary: %w", err)
	}

	// Calculate completion rate
	var completionRate float64
	if summary.TotalTasks > 0 {
		completionRate = float64(summary.CompletedTasks) / float64(summary.TotalTasks) * 100
	}

	// Build analytics response
	response := &rpcv1.GetTaskAnalyticsResponse{
		Rows: make([]*rpcv1.AnalyticsRow, 0),
		Summary: &rpcv1.AnalyticsSummary{
			TotalTasks:     int32(summary.TotalTasks),
			CompletedTasks: int32(summary.CompletedTasks),
			OpenTasks:      int32(summary.OpenTasks),
			CompletionRate: completionRate,
		},
	}

	// Add analytics rows based on groupBy (string array)
	for _, groupBy := range req.GroupBy {
		switch groupBy {
		case "state":
			stateCounts, err := l.Queries.GetTaskCountsByState(ctx, tx, &database.GetTaskCountsByStateParams{
				OrganizationID: orgID,
				ProjectID:      projectID,
			})
			if err != nil {
				slog.WarnContext(ctx, "failed to get state counts", "error", err)
			} else {
				for _, sc := range stateCounts {
					if sc.TaskCount == 0 {
						continue
					}
					row := &rpcv1.AnalyticsRow{
						Dimensions: map[string]*structpb.Value{
							"state_id":   structpb.NewStringValue(sc.StateID.String()),
							"state_name": structpb.NewStringValue(sc.StateName),
							"category":   structpb.NewStringValue(sc.Category),
							"color":      structpb.NewStringValue(sc.Color),
						},
						Metrics: map[string]float64{
							"task_count": float64(sc.TaskCount),
						},
					}
					response.Rows = append(response.Rows, row)
				}
			}

		case "assignee":
			assigneeCounts, err := l.Queries.GetTaskCountsByAssignee(ctx, tx, &database.GetTaskCountsByAssigneeParams{
				OrganizationID: orgID,
				ProjectID:      projectID,
			})
			if err != nil {
				slog.WarnContext(ctx, "failed to get assignee counts", "error", err)
			} else {
				for _, ac := range assigneeCounts {
					row := &rpcv1.AnalyticsRow{
						Dimensions: map[string]*structpb.Value{
							"employee_id": structpb.NewStringValue(ac.EmployeeID.String()),
						},
						Metrics: map[string]float64{
							"task_count": float64(ac.TaskCount),
						},
					}
					response.Rows = append(response.Rows, row)
				}
			}

		case "level":
			levelCounts, err := l.Queries.GetTaskCountsByLevel(ctx, tx, &database.GetTaskCountsByLevelParams{
				OrganizationID: orgID,
				ProjectID:      projectID,
			})
			if err != nil {
				slog.WarnContext(ctx, "failed to get level counts", "error", err)
			} else {
				for _, lc := range levelCounts {
					if lc.TaskCount == 0 {
						continue
					}
					row := &rpcv1.AnalyticsRow{
						Dimensions: map[string]*structpb.Value{
							"level_id":   structpb.NewStringValue(lc.LevelID.String()),
							"level_name": structpb.NewStringValue(lc.LevelName),
							"color":      structpb.NewStringValue(lc.Color),
						},
						Metrics: map[string]float64{
							"task_count": float64(lc.TaskCount),
						},
					}
					response.Rows = append(response.Rows, row)
				}
			}

		default:
			// Unknown groupBy value - skip
			slog.WarnContext(ctx, "unknown groupBy value", "groupBy", groupBy)
		}
	}

	return response, nil
}

// ExportTasksCSV exports tasks to CSV format
func (l *logicImpl) ExportTasksCSV(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	req *rpcv1.ExportTasksCSVRequest,
) ([]byte, error) {
	slog.DebugContext(ctx, "ExportTasksCSV",
		"projectID", req.ProjectId,
	)

	projectID := dbuuid.MustParse(req.ProjectId)

	// Get all tasks for project using ListTasks
	tasks, err := l.Queries.ListTasks(ctx, tx, &database.ListTasksParams{
		OrganizationID: orgID,
		ProjectID:      projectID,
		Limit:          10000, // Reasonable export limit
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list tasks: %w", err)
	}

	// Get states for state name lookup
	states, err := l.Queries.ListProjectStates(ctx, tx, &database.ListProjectStatesParams{
		OrganizationID: orgID,
		ProjectID:      projectID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list states: %w", err)
	}
	stateNames := make(map[dbuuid.UUID]string)
	for _, s := range states {
		stateNames[s.ID] = s.Name
	}

	// Get levels for level name lookup
	levels, err := l.Queries.ListTaskLevels(ctx, tx, &database.ListTaskLevelsParams{
		OrganizationID: orgID,
		ProjectID:      projectID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list levels: %w", err)
	}
	levelNames := make(map[dbuuid.UUID]string)
	for _, l := range levels {
		levelNames[l.ID] = l.Name
	}

	// Create CSV
	var buf bytes.Buffer
	writer := csv.NewWriter(&buf)

	// Write header
	header := []string{
		"Identifier",
		"Title",
		"State",
		"Level",
		"Start Date",
		"Due Date",
		"Estimated Hours",
		"Updated At",
	}
	if err := writer.Write(header); err != nil {
		return nil, fmt.Errorf("failed to write header: %w", err)
	}

	// Write rows
	for _, t := range tasks {
		stateName := stateNames[t.StateID]
		levelName := levelNames[t.LevelID]

		startDate := ""
		if t.StartDate.Valid {
			startDate = t.StartDate.Time.Format("2006-01-02")
		}

		dueDate := ""
		if t.DueDate.Valid {
			dueDate = t.DueDate.Time.Format("2006-01-02")
		}

		estimatedHours := ""
		if t.EstimatedHours.Valid {
			// Convert pgtype.Numeric to string
			estimatedHours = t.EstimatedHours.Int.String()
			if t.EstimatedHours.Exp != 0 {
				// Has decimal places
				f64, _ := t.EstimatedHours.Float64Value()
				if f64.Valid {
					estimatedHours = fmt.Sprintf("%.2f", f64.Float64)
				}
			}
		}

		row := []string{
			t.Identifier,
			t.Title,
			stateName,
			levelName,
			startDate,
			dueDate,
			estimatedHours,
			t.UpdatedAt.Time.Format("2006-01-02 15:04:05"),
		}
		if err := writer.Write(row); err != nil {
			return nil, fmt.Errorf("failed to write row: %w", err)
		}
	}

	writer.Flush()
	if err := writer.Error(); err != nil {
		return nil, fmt.Errorf("failed to flush CSV: %w", err)
	}

	slog.InfoContext(ctx, "tasks exported successfully",
		"projectID", projectID,
		"taskCount", len(tasks),
	)

	return buf.Bytes(), nil
}
