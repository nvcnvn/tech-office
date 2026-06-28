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

// CreateProjectState creates a new state for a project
func (l *logicImpl) CreateProjectState(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	req *rpcv1.CreateProjectStateRequest,
) (*rpcv1.ProjectState, error) {
	slog.DebugContext(ctx, "CreateProjectState",
		"projectID", req.ProjectId,
		"name", req.Name,
	)

	projectID := dbuuid.MustParse(req.ProjectId)

	// Get max position for new state
	var position int32
	if req.Position != nil {
		position = *req.Position
	} else {
		// Get next position by listing all states and finding max position
		existingStates, err := l.Queries.ListProjectStates(ctx, tx, &database.ListProjectStatesParams{
			OrganizationID: orgID,
			ProjectID:      projectID,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to list states for position: %w", err)
		}
		for _, s := range existingStates {
			if s.Position >= position {
				position = s.Position + 1
			}
		}
	}

	isInitial := false
	if req.IsInitial != nil {
		isInitial = *req.IsInitial
	}

	// If this is initial, clear other initial flags
	if isInitial {
		err := l.Queries.ClearInitialState(ctx, tx, &database.ClearInitialStateParams{
			OrganizationID: orgID,
			ProjectID:      projectID,
			UpdatedAt:      pgtype.Timestamptz{Time: time.Now(), Valid: true},
		})
		if err != nil {
			slog.WarnContext(ctx, "failed to clear initial state flag",
				"error", err,
			)
		}
	}

	state, err := l.Queries.CreateProjectState(ctx, tx, &database.CreateProjectStateParams{
		ID:             dbuuid.Must(),
		OrganizationID: orgID,
		ProjectID:      projectID,
		Name:           req.Name,
		Color:          req.Color,
		Category:       stateCategoryToString(req.Category),
		Position:       position,
		IsInitial:      isInitial,
		IsClosed:       false,
		StateType:      stateTypeProtoToString(req.GetStateType()),
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create project state",
			"error", err,
		)
		return nil, fmt.Errorf("failed to create project state: %w", err)
	}

	return projectStateToProto(state), nil
}

// UpdateProjectState updates a project state
func (l *logicImpl) UpdateProjectState(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	req *rpcv1.UpdateProjectStateRequest,
) (*rpcv1.ProjectState, error) {
	slog.DebugContext(ctx, "UpdateProjectState",
		"stateID", req.StateId,
	)

	stateID := dbuuid.MustParse(req.StateId)
	now := time.Now()

	// Get current state
	current, err := l.Queries.GetProjectState(ctx, tx, &database.GetProjectStateParams{
		OrganizationID: orgID,
		ID:             stateID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrStateNotFound
		}
		return nil, fmt.Errorf("failed to get state: %w", err)
	}

	// Build update params
	name := current.Name
	if req.Name != nil {
		name = *req.Name
	}

	color := current.Color
	if req.Color != nil {
		color = *req.Color
	}

	category := current.Category
	if req.Category != nil {
		category = stateCategoryToString(*req.Category)
	}

	isInitial := current.IsInitial
	if req.IsInitial != nil {
		isInitial = *req.IsInitial
		// If setting as initial, clear other initial flags
		if isInitial {
			err := l.Queries.ClearInitialState(ctx, tx, &database.ClearInitialStateParams{
				OrganizationID: orgID,
				ProjectID:      dbuuid.UUID(current.ProjectID),
				UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
			})
			if err != nil {
				slog.WarnContext(ctx, "failed to clear initial state flag",
					"error", err,
				)
			}
		}
	}

	isClosed := current.IsClosed
	if req.IsClosed != nil {
		isClosed = *req.IsClosed
	}

	stateType := current.StateType
	if req.StateType != nil {
		stateType = stateTypeProtoToString(*req.StateType)
	}

	updated, err := l.Queries.UpdateProjectState(ctx, tx, &database.UpdateProjectStateParams{
		OrganizationID: orgID,
		ID:             stateID,
		Name:           pgtype.Text{String: name, Valid: name != ""},
		Color:          pgtype.Text{String: color, Valid: color != ""},
		Category:       pgtype.Text{String: category, Valid: category != ""},
		IsInitial:      pgtype.Bool{Bool: isInitial, Valid: true},
		IsClosed:       pgtype.Bool{Bool: isClosed, Valid: true},
		StateType:      pgtype.Text{String: stateType, Valid: stateType != ""},
		UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update project state",
			"error", err,
		)
		return nil, fmt.Errorf("failed to update project state: %w", err)
	}

	return projectStateToProto(updated), nil
}

// DeleteProjectState deletes a project state and migrates tasks
func (l *logicImpl) DeleteProjectState(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	stateID, migrateToStateID dbuuid.UUID,
) error {
	slog.DebugContext(ctx, "DeleteProjectState",
		"stateID", stateID,
		"migrateToStateID", migrateToStateID,
	)

	now := time.Now()

	// Migrate tasks to new state
	err := l.Queries.MigrateTasksToState(ctx, tx, &database.MigrateTasksToStateParams{
		OrganizationID: orgID,
		StateID:        stateID,
		StateID_2:      migrateToStateID,
		UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to migrate tasks",
			"error", err,
		)
		return fmt.Errorf("failed to migrate tasks: %w", err)
	}

	// Delete state
	err = l.Queries.DeleteProjectState(ctx, tx, &database.DeleteProjectStateParams{
		OrganizationID: orgID,
		ID:             stateID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return ErrStateNotFound
		}
		slog.ErrorContext(ctx, "failed to delete project state",
			"error", err,
		)
		return fmt.Errorf("failed to delete project state: %w", err)
	}

	return nil
}

// ReorderProjectStates reorders project states
func (l *logicImpl) ReorderProjectStates(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	projectID dbuuid.UUID,
	stateIDs []dbuuid.UUID,
) error {
	slog.DebugContext(ctx, "ReorderProjectStates",
		"projectID", projectID,
		"stateCount", len(stateIDs),
	)

	now := time.Now()

	for i, stateID := range stateIDs {
		err := l.Queries.UpdateProjectStatePosition(ctx, tx, &database.UpdateProjectStatePositionParams{
			OrganizationID: orgID,
			ID:             stateID,
			Position:       int32(i),
			UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
		})
		if err != nil {
			slog.ErrorContext(ctx, "failed to update state position",
				"error", err,
				"stateID", stateID,
			)
			return fmt.Errorf("failed to update state position: %w", err)
		}
	}

	return nil
}

// ListProjectStates lists all states for a project
func (l *logicImpl) ListProjectStates(
	ctx context.Context,
	tx database.DBTX,
	orgID, projectID dbuuid.UUID,
) ([]*rpcv1.ProjectState, error) {
	slog.DebugContext(ctx, "ListProjectStates",
		"projectID", projectID,
	)

	dbStates, err := l.Queries.ListProjectStates(ctx, tx, &database.ListProjectStatesParams{
		OrganizationID: orgID,
		ProjectID:      projectID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list states: %w", err)
	}

	states := make([]*rpcv1.ProjectState, len(dbStates))
	for i, s := range dbStates {
		states[i] = projectStateToProto(s)
	}

	return states, nil
}
