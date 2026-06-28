package collaboration

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// CreateTaskLevel creates a new task level for a project
func (l *logicImpl) CreateTaskLevel(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	req *rpcv1.CreateTaskLevelRequest,
) (*rpcv1.TaskLevel, error) {
	slog.DebugContext(ctx, "CreateTaskLevel",
		"projectID", req.ProjectId,
		"name", req.Name,
	)

	projectID := dbuuid.MustParse(req.ProjectId)

	// Handle optional fields
	var icon pgtype.Text
	if req.Icon != nil && *req.Icon != "" {
		icon = pgtype.Text{String: *req.Icon, Valid: true}
	}

	color := "#6b7280" // Default color from schema
	if req.Color != nil {
		color = *req.Color
	}

	level, err := l.Queries.CreateTaskLevel(ctx, tx, &database.CreateTaskLevelParams{
		ID:             dbuuid.Must(),
		OrganizationID: orgID,
		ProjectID:      projectID,
		Name:           req.Name,
		Icon:           icon,
		Color:          color,
		Depth:          req.Depth,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create task level",
			"error", err,
		)
		return nil, fmt.Errorf("failed to create task level: %w", err)
	}

	return taskLevelToProto(level), nil
}

// UpdateTaskLevel updates a task level
func (l *logicImpl) UpdateTaskLevel(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	req *rpcv1.UpdateTaskLevelRequest,
) (*rpcv1.TaskLevel, error) {
	slog.DebugContext(ctx, "UpdateTaskLevel",
		"levelID", req.LevelId,
	)

	levelID := dbuuid.MustParse(req.LevelId)
	now := time.Now()

	// Get current level
	current, err := l.Queries.GetTaskLevel(ctx, tx, &database.GetTaskLevelParams{
		OrganizationID: orgID,
		ID:             levelID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrLevelNotFound
		}
		return nil, fmt.Errorf("failed to get level: %w", err)
	}

	// Build update params
	name := current.Name
	if req.Name != nil {
		name = *req.Name
	}

	icon := current.Icon.String
	if req.Icon != nil {
		icon = *req.Icon
	}

	color := current.Color
	if req.Color != nil {
		color = *req.Color
	}

	updated, err := l.Queries.UpdateTaskLevel(ctx, tx, &database.UpdateTaskLevelParams{
		OrganizationID: orgID,
		ID:             levelID,
		Name:           pgtype.Text{String: name, Valid: true},
		Icon:           pgtype.Text{String: icon, Valid: icon != ""},
		Color:          pgtype.Text{String: color, Valid: true},
		UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update task level",
			"error", err,
		)
		return nil, fmt.Errorf("failed to update task level: %w", err)
	}

	return taskLevelToProto(updated), nil
}

// DeleteTaskLevel deletes a task level and migrates tasks
func (l *logicImpl) DeleteTaskLevel(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	levelID, migrateToLevelID dbuuid.UUID,
) error {
	slog.DebugContext(ctx, "DeleteTaskLevel",
		"levelID", levelID,
		"migrateToLevelID", migrateToLevelID,
	)

	now := time.Now()

	// Migrate tasks to new level
	err := l.Queries.MigrateTasksToLevel(ctx, tx, &database.MigrateTasksToLevelParams{
		OrganizationID: orgID,
		LevelID:        levelID,
		LevelID_2:      migrateToLevelID,
		UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to migrate tasks",
			"error", err,
		)
		return fmt.Errorf("failed to migrate tasks: %w", err)
	}

	// Delete level
	err = l.Queries.DeleteTaskLevel(ctx, tx, &database.DeleteTaskLevelParams{
		OrganizationID: orgID,
		ID:             levelID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return ErrLevelNotFound
		}
		slog.ErrorContext(ctx, "failed to delete task level",
			"error", err,
		)
		return fmt.Errorf("failed to delete task level: %w", err)
	}

	return nil
}

// ListTaskLevels lists all task levels for a project
func (l *logicImpl) ListTaskLevels(
	ctx context.Context,
	tx database.DBTX,
	orgID, projectID dbuuid.UUID,
) ([]*rpcv1.TaskLevel, error) {
	slog.DebugContext(ctx, "ListTaskLevels",
		"projectID", projectID,
	)

	dbLevels, err := l.Queries.ListTaskLevels(ctx, tx, &database.ListTaskLevelsParams{
		OrganizationID: orgID,
		ProjectID:      projectID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list levels: %w", err)
	}

	levels := make([]*rpcv1.TaskLevel, len(dbLevels))
	for i, lv := range dbLevels {
		levels[i] = taskLevelToProto(lv)
	}

	return levels, nil
}
