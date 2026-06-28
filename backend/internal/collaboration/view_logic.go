package collaboration

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

type MixedOverviewItem struct {
	TaskID      string
	Identifier  string
	Title       string
	TaskKind    string
	ScheduledAt *time.Time
	DueAt       *time.Time
}

type MixedOverviewSummary struct {
	ProjectID          string
	StandardTaskCount  int
	RitualTaskCount    int
	OverdueRitualCount int
	TodayRitualCount   int
	PendingReviewCount int
	NeedsAttentionNow  []MixedOverviewItem
}

type RitualWorklistData struct {
	ProjectID          string
	Overdue            []*rpcv1.Task
	Today              []*rpcv1.Task
	Upcoming           []*rpcv1.Task
	NeedsResubmission  []*rpcv1.Task
	PendingReview      []*rpcv1.Task
	PendingReviewCount int
}

// CreateSavedView creates a new saved view for a project
func (l *logicImpl) CreateSavedView(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	req *rpcv1.CreateSavedViewRequest,
) (*rpcv1.SavedView, error) {
	slog.DebugContext(ctx, "CreateSavedView",
		"projectID", req.ProjectId,
		"name", req.Name,
		"viewType", req.ViewType.String(),
	)

	projectID := dbuuid.MustParse(req.ProjectId)
	viewType := viewTypeToString(req.ViewType)

	// Validate view type
	if !IsValidViewType(viewType) {
		return nil, ErrInvalidViewType
	}

	// Serialize config
	var config []byte
	if req.Config != nil {
		var err error
		config, err = json.Marshal(req.Config)
		if err != nil {
			return nil, fmt.Errorf("failed to serialize config: %w", err)
		}
	} else {
		config = []byte("{}")
	}

	// Determine if personal or shared view
	var ownerEmployeeID dbuuid.NullUUID
	if !req.GetIsShared() {
		ownerEmployeeID = dbuuid.UUIDToNullUUID(employeeID)
	}

	// Get next position
	position, err := l.Queries.GetNextViewPosition(ctx, tx, &database.GetNextViewPositionParams{
		OrganizationID: orgID,
		ProjectID:      projectID,
		EmployeeID:     ownerEmployeeID,
	})
	if err != nil {
		position = 0
	}

	// Create view
	view, err := l.Queries.CreateSavedView(ctx, tx, &database.CreateSavedViewParams{
		ID:             dbuuid.Must(),
		OrganizationID: orgID,
		ProjectID:      projectID,
		EmployeeID:     ownerEmployeeID,
		Name:           req.Name,
		ViewType:       viewType,
		Config:         config,
		IsDefault:      req.GetIsDefault(),
		Position:       int32(position),
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create saved view",
			"error", err,
		)
		return nil, fmt.Errorf("failed to create saved view: %w", err)
	}

	// If this is the default, unset other defaults for same scope
	if req.GetIsDefault() {
		err = l.Queries.ClearDefaultView(ctx, tx, &database.ClearDefaultViewParams{
			OrganizationID: orgID,
			ProjectID:      projectID,
			EmployeeID:     ownerEmployeeID,
			UpdatedAt:      pgtype.Timestamptz{Time: time.Now(), Valid: true},
		})
		if err != nil {
			slog.WarnContext(ctx, "failed to unset other default views",
				"error", err,
			)
		}
	}

	slog.InfoContext(ctx, "saved view created successfully",
		"viewID", view.ID,
		"name", req.Name,
	)

	return savedViewToProto(view), nil
}

// UpdateSavedView updates a saved view
func (l *logicImpl) UpdateSavedView(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	req *rpcv1.UpdateSavedViewRequest,
) (*rpcv1.SavedView, error) {
	slog.DebugContext(ctx, "UpdateSavedView",
		"viewID", req.ViewId,
	)

	viewID := dbuuid.MustParse(req.ViewId)
	now := time.Now()

	// Get current view
	current, err := l.Queries.GetSavedView(ctx, tx, &database.GetSavedViewParams{
		OrganizationID: orgID,
		ID:             viewID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrSavedViewNotFound
		}
		return nil, fmt.Errorf("failed to get saved view: %w", err)
	}

	// Check ownership (personal views can only be edited by owner)
	if current.EmployeeID.Valid && dbuuid.UUID(current.EmployeeID.UUID) != employeeID {
		return nil, ErrAccessDenied
	}

	// Build update params
	name := current.Name
	if req.Name != nil {
		name = *req.Name
	}

	config := current.Config
	if req.Config != nil {
		var err error
		config, err = json.Marshal(req.Config)
		if err != nil {
			return nil, fmt.Errorf("failed to serialize config: %w", err)
		}
	}

	isDefault := current.IsDefault
	if req.IsDefault != nil {
		isDefault = *req.IsDefault
	}

	position := current.Position
	if req.Position != nil {
		position = *req.Position
	}

	// Update view
	updated, err := l.Queries.UpdateSavedView(ctx, tx, &database.UpdateSavedViewParams{
		OrganizationID: orgID,
		ID:             viewID,
		Name:           pgtype.Text{String: name, Valid: name != ""},
		Config:         config,
		IsDefault:      pgtype.Bool{Bool: isDefault, Valid: true},
		Position:       pgtype.Int4{Int32: position, Valid: true},
		UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update saved view",
			"error", err,
		)
		return nil, fmt.Errorf("failed to update saved view: %w", err)
	}

	// If this is now the default, unset other defaults
	if isDefault && !current.IsDefault {
		err = l.Queries.ClearDefaultView(ctx, tx, &database.ClearDefaultViewParams{
			OrganizationID: orgID,
			ProjectID:      dbuuid.UUID(current.ProjectID),
			EmployeeID:     current.EmployeeID,
			UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
		})
		if err != nil {
			slog.WarnContext(ctx, "failed to unset other default views",
				"error", err,
			)
		}
	}

	slog.InfoContext(ctx, "saved view updated successfully",
		"viewID", viewID,
	)

	return savedViewToProto(updated), nil
}

// DeleteSavedView deletes a saved view
func (l *logicImpl) DeleteSavedView(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	viewID dbuuid.UUID,
) error {
	slog.DebugContext(ctx, "DeleteSavedView",
		"viewID", viewID,
	)

	// Get view first to check ownership
	view, err := l.Queries.GetSavedView(ctx, tx, &database.GetSavedViewParams{
		OrganizationID: orgID,
		ID:             viewID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return ErrSavedViewNotFound
		}
		return fmt.Errorf("failed to get saved view: %w", err)
	}

	// Check ownership (personal views can only be deleted by owner)
	if view.EmployeeID.Valid && dbuuid.UUID(view.EmployeeID.UUID) != employeeID {
		return ErrAccessDenied
	}

	// Delete view
	err = l.Queries.DeleteSavedView(ctx, tx, &database.DeleteSavedViewParams{
		OrganizationID: orgID,
		ID:             viewID,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to delete saved view",
			"error", err,
		)
		return fmt.Errorf("failed to delete saved view: %w", err)
	}

	slog.InfoContext(ctx, "saved view deleted successfully",
		"viewID", viewID,
	)

	return nil
}

// ListSavedViews lists all saved views for a project (both shared and personal)
func (l *logicImpl) ListSavedViews(
	ctx context.Context,
	tx database.DBTX,
	orgID, projectID, employeeID dbuuid.UUID,
) ([]*rpcv1.SavedView, error) {
	slog.DebugContext(ctx, "ListSavedViews",
		"projectID", projectID,
		"employeeID", employeeID,
	)

	dbViews, err := l.Queries.ListSavedViews(ctx, tx, &database.ListSavedViewsParams{
		OrganizationID: orgID,
		ProjectID:      projectID,
		EmployeeID:     dbuuid.UUIDToNullUUID(employeeID),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list saved views: %w", err)
	}

	views := make([]*rpcv1.SavedView, len(dbViews))
	for i, v := range dbViews {
		views[i] = savedViewToProto(v)
	}

	return views, nil
}

// GetDefaultView gets the default view for a project and user
func (l *logicImpl) GetDefaultView(
	ctx context.Context,
	tx database.DBTX,
	orgID, projectID, employeeID dbuuid.UUID,
) (*rpcv1.SavedView, error) {
	slog.DebugContext(ctx, "GetDefaultView",
		"projectID", projectID,
		"employeeID", employeeID,
	)

	// List views ordered by is_default DESC, position ASC
	// This includes personal views (employee_id matches) and shared views (employee_id IS NULL)
	views, err := l.Queries.ListSavedViews(ctx, tx, &database.ListSavedViewsParams{
		OrganizationID: orgID,
		ProjectID:      projectID,
		EmployeeID:     dbuuid.UUIDToNullUUID(employeeID),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list views: %w", err)
	}

	// Find the first default view (personal defaults take priority)
	// ListSavedViews orders by is_default DESC, so default views come first
	for _, view := range views {
		if view.IsDefault {
			// Prefer personal default over shared default
			if view.EmployeeID.Valid {
				return savedViewToProto(view), nil
			}
		}
	}

	// Fallback to any shared default
	for _, view := range views {
		if view.IsDefault && !view.EmployeeID.Valid {
			return savedViewToProto(view), nil
		}
	}

	// No default found
	if len(views) > 0 {
		// Return first view as fallback
		return savedViewToProto(views[0]), nil
	}

	return nil, ErrSavedViewNotFound
}

// ============================================================================
// Helper Functions
// ============================================================================

func savedViewToProto(v *database.CollaborationSavedView) *rpcv1.SavedView {
	view := &rpcv1.SavedView{
		Id:        v.ID.String(),
		ProjectId: v.ProjectID.String(),
		Name:      v.Name,
		ViewType:  stringToViewTypeProto(v.ViewType),
		IsDefault: v.IsDefault,
		Position:  v.Position,
	}

	if v.EmployeeID.Valid {
		s := v.EmployeeID.UUID.String()
		view.EmployeeId = &s
	}

	// Parse config
	if len(v.Config) > 0 {
		var configMap map[string]interface{}
		if err := json.Unmarshal(v.Config, &configMap); err == nil {
			if pbStruct, err := structpb.NewStruct(configMap); err == nil {
				view.Config = pbStruct
			}
		}
	}

	return view
}

func viewTypeToString(t rpcv1.ViewType) string {
	switch t {
	case rpcv1.ViewType_VIEW_TYPE_BOARD:
		return ViewTypeBoard
	case rpcv1.ViewType_VIEW_TYPE_LIST:
		return ViewTypeList
	case rpcv1.ViewType_VIEW_TYPE_GANTT:
		return ViewTypeGantt
	case rpcv1.ViewType_VIEW_TYPE_CALENDAR:
		return ViewTypeCalendar
	case rpcv1.ViewType_VIEW_TYPE_TODAY:
		return ViewTypeToday
	case rpcv1.ViewType_VIEW_TYPE_HEALTH:
		return ViewTypeHealth
	default:
		return ""
	}
}

func stringToViewTypeProto(s string) rpcv1.ViewType {
	switch s {
	case ViewTypeBoard:
		return rpcv1.ViewType_VIEW_TYPE_BOARD
	case ViewTypeList:
		return rpcv1.ViewType_VIEW_TYPE_LIST
	case ViewTypeGantt:
		return rpcv1.ViewType_VIEW_TYPE_GANTT
	case ViewTypeCalendar:
		return rpcv1.ViewType_VIEW_TYPE_CALENDAR
	case ViewTypeToday:
		return rpcv1.ViewType_VIEW_TYPE_TODAY
	case ViewTypeHealth:
		return rpcv1.ViewType_VIEW_TYPE_HEALTH
	default:
		return rpcv1.ViewType_VIEW_TYPE_UNSPECIFIED
	}
}

func (l *logicImpl) GetMixedOverviewSummary(
	ctx context.Context,
	tx database.DBTX,
	orgID, projectID dbuuid.UUID,
) (*MixedOverviewSummary, error) {
	tasks, err := l.Queries.ListTasks(ctx, tx, &database.ListTasksParams{
		OrganizationID: orgID,
		ProjectID:      projectID,
		Limit:          200,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list project tasks for mixed overview: %w", err)
	}

	summary := &MixedOverviewSummary{ProjectID: projectID.String()}
	now := time.Now()
	today := startOfOverviewDay(now)

	for _, task := range tasks {
		if task.TaskKind == "ritual_instance" {
			summary.RitualTaskCount++
			if task.CompletionDeadline.Valid && task.CompletionDeadline.Time.Before(now) {
				summary.OverdueRitualCount++
			}
			if task.ScheduledDate.Valid && startOfOverviewDay(task.ScheduledDate.Time).Equal(today) {
				summary.TodayRitualCount++
			}
			evidenceProgress := l.buildTaskEvidenceProgressSummary(ctx, tx, orgID, task.ID)
			if evidenceProgress != nil {
				summary.PendingReviewCount += int(evidenceProgress.PendingReviewCount)
			}
			if shouldIncludeRitualTaskInOverview(task, evidenceProgress, now, today) {
				summary.NeedsAttentionNow = append(summary.NeedsAttentionNow, mixedOverviewItemFromTask(task))
			}
			continue
		}

		summary.StandardTaskCount++
		if shouldIncludeStandardTaskInOverview(task, today) {
			summary.NeedsAttentionNow = append(summary.NeedsAttentionNow, mixedOverviewItemFromTask(task))
		}
	}

	sort.Slice(summary.NeedsAttentionNow, func(i, j int) bool {
		return summary.NeedsAttentionNow[i].Identifier < summary.NeedsAttentionNow[j].Identifier
	})

	return summary, nil
}

func (l *logicImpl) GetRitualWorklist(
	ctx context.Context,
	tx database.DBTX,
	orgID, projectID dbuuid.UUID,
) (*RitualWorklistData, error) {
	rows, err := l.Queries.ListTasks(ctx, tx, &database.ListTasksParams{
		OrganizationID: orgID,
		ProjectID:      projectID,
		TaskKind:       pgtype.Text{String: "ritual_instance", Valid: true},
		Limit:          200,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list ritual worklist tasks: %w", err)
	}

	worklist := &RitualWorklistData{ProjectID: projectID.String()}
	now := time.Now()
	today := startOfOverviewDay(now)

	for _, row := range rows {
		task := l.taskToProto(row, nil, nil)
		evidenceProgress := l.buildTaskEvidenceProgressSummary(ctx, tx, orgID, row.ID)
		if evidenceProgress != nil {
			task.EvidenceProgress = evidenceProgress
			worklist.PendingReviewCount += int(evidenceProgress.PendingReviewCount)
		}

		switch classifyRitualWorklistTask(row, evidenceProgress, now, today) {
		case "needs_resubmission":
			worklist.NeedsResubmission = append(worklist.NeedsResubmission, task)
		case "pending_review":
			worklist.PendingReview = append(worklist.PendingReview, task)
		case "overdue":
			worklist.Overdue = append(worklist.Overdue, task)
		case "today":
			worklist.Today = append(worklist.Today, task)
		default:
			worklist.Upcoming = append(worklist.Upcoming, task)
		}
	}

	return worklist, nil
}

func startOfOverviewDay(date time.Time) time.Time {
	return time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, date.Location())
}

func mixedOverviewItemFromTask(task *database.CollaborationTask) MixedOverviewItem {
	item := MixedOverviewItem{
		TaskID:     task.ID.String(),
		Identifier: task.Identifier,
		Title:      task.Title,
		TaskKind:   task.TaskKind,
	}

	if task.ScheduledDate.Valid {
		scheduledAt := task.ScheduledDate.Time
		item.ScheduledAt = &scheduledAt
	}

	if task.CompletionDeadline.Valid {
		dueAt := task.CompletionDeadline.Time
		item.DueAt = &dueAt
	}

	return item
}

func shouldIncludeStandardTaskInOverview(task *database.CollaborationTask, today time.Time) bool {
	if !task.DueDate.Valid {
		return false
	}

	return !startOfOverviewDay(task.DueDate.Time).After(today)
}

func shouldIncludeRitualTaskInOverview(
	task *database.CollaborationTask,
	evidenceProgress *rpcv1.TaskEvidenceProgress,
	now time.Time,
	today time.Time,
) bool {
	if evidenceProgress != nil {
		if evidenceProgress.RejectedCount > 0 || evidenceProgress.PendingReviewCount > 0 {
			return true
		}
	}

	if task.CompletionDeadline.Valid && task.CompletionDeadline.Time.Before(now) {
		return true
	}

	return task.ScheduledDate.Valid && !startOfOverviewDay(task.ScheduledDate.Time).After(today)
}

func classifyRitualWorklistTask(
	task *database.CollaborationTask,
	evidenceProgress *rpcv1.TaskEvidenceProgress,
	now time.Time,
	today time.Time,
) string {
	if evidenceProgress != nil {
		if evidenceProgress.RejectedCount > 0 {
			return "needs_resubmission"
		}
		if evidenceProgress.PendingReviewCount > 0 {
			return "pending_review"
		}
	}

	if task.CompletionDeadline.Valid && task.CompletionDeadline.Time.Before(now) {
		return "overdue"
	}

	if task.ScheduledDate.Valid {
		scheduledDay := startOfOverviewDay(task.ScheduledDate.Time)
		if scheduledDay.Before(today) {
			return "overdue"
		}
		if scheduledDay.Equal(today) {
			return "today"
		}
	}

	return "upcoming"
}

func (l *logicImpl) buildTaskEvidenceProgressSummary(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	taskID dbuuid.UUID,
) *rpcv1.TaskEvidenceProgress {
	task, err := l.Queries.GetTask(ctx, tx, &database.GetTaskParams{
		OrganizationID: orgID,
		ID:             taskID,
	})
	if err != nil {
		return nil
	}

	snapshot, err := l.loadTaskEvidenceSnapshot(ctx, tx, orgID, task)
	if err != nil {
		return nil
	}

	return snapshot.progress
}
