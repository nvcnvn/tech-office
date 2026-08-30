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
	"google.golang.org/protobuf/types/known/timestamppb"
)

// CreateProject creates a new project with default states and levels
func (l *logicImpl) CreateProject(
	ctx context.Context,
	tx database.DBTX,
	orgID, creatorID dbuuid.UUID,
	req *rpcv1.CreateProjectRequest,
) (*rpcv1.Project, []*rpcv1.ProjectState, []*rpcv1.TaskLevel, error) {
	slog.DebugContext(ctx, "CreateProject",
		"name", req.Name,
		"key", req.Key,
		"visibility", req.Visibility,
	)

	now := time.Now()

	// Create project
	project, err := l.Queries.CreateProject(ctx, tx, &database.CreateProjectParams{
		ID:                dbuuid.Must(),
		OrganizationID:    orgID,
		Name:              req.Name,
		Key:               req.Key,
		Description:       pgtype.Text{String: req.Description, Valid: req.Description != ""},
		Visibility:        visibilityToString(req.Visibility),
		OwnerEmployeeID:   creatorID,
		CollaborationMode: collaborationModeToString(req.CollaborationMode),
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create project",
			"error", err,
			"name", req.Name,
		)
		return nil, nil, nil, fmt.Errorf("failed to create project: %w", err)
	}

	projectID := dbuuid.UUID(project.ID)

	// Create default states if not provided
	var states []*rpcv1.ProjectState
	if len(req.DefaultStates) > 0 {
		for i, ds := range req.DefaultStates {
			state, err := l.Queries.CreateProjectState(ctx, tx, &database.CreateProjectStateParams{
				ID:             dbuuid.Must(),
				OrganizationID: orgID,
				ProjectID:      projectID,
				Name:           ds.Name,
				Color:          ds.Color,
				Category:       stateCategoryToString(ds.Category),
				Position:       int32(i),
				IsInitial:      ds.IsInitial,
				IsClosed:       ds.IsClosed,
			})
			if err != nil {
				slog.ErrorContext(ctx, "failed to create project state",
					"error", err,
					"name", ds.Name,
				)
				return nil, nil, nil, fmt.Errorf("failed to create project state: %w", err)
			}
			states = append(states, projectStateToProto(state))
		}
	} else {
		// Choose default states based on collaboration mode
		mode := collaborationModeToString(req.CollaborationMode)
		var defaultStates []struct {
			Name      string
			Color     string
			Category  string
			IsInitial bool
			IsClosed  bool
			StateType string
		}
		switch mode {
		case CollaborationModeRitual:
			defaultStates = DefaultRitualProjectStates
		case CollaborationModeMixed:
			defaultStates = DefaultMixedProjectStates
		default:
			defaultStates = DefaultProjectStates
		}

		for i, ds := range defaultStates {
			state, err := l.Queries.CreateProjectState(ctx, tx, &database.CreateProjectStateParams{
				ID:             dbuuid.Must(),
				OrganizationID: orgID,
				ProjectID:      projectID,
				Name:           ds.Name,
				Color:          ds.Color,
				Category:       ds.Category,
				Position:       int32(i),
				IsInitial:      ds.IsInitial,
				IsClosed:       ds.IsClosed,
				StateType:      ds.StateType,
			})
			if err != nil {
				slog.ErrorContext(ctx, "failed to create default state",
					"error", err,
					"name", ds.Name,
				)
				return nil, nil, nil, fmt.Errorf("failed to create default state: %w", err)
			}
			states = append(states, projectStateToProto(state))
		}
	}

	// Create default task levels
	var levels []*rpcv1.TaskLevel
	for _, dl := range DefaultTaskLevels {
		level, err := l.Queries.CreateTaskLevel(ctx, tx, &database.CreateTaskLevelParams{
			ID:             dbuuid.Must(),
			OrganizationID: orgID,
			ProjectID:      projectID,
			Name:           dl.Name,
			Icon:           pgtype.Text{}, // DefaultTaskLevels has no Icon
			Color:          dl.Color,
			Depth:          int32(dl.Depth),
		})
		if err != nil {
			slog.ErrorContext(ctx, "failed to create task level",
				"error", err,
				"name", dl.Name,
			)
			return nil, nil, nil, fmt.Errorf("failed to create task level: %w", err)
		}
		levels = append(levels, taskLevelToProto(level))
	}

	// Add creator as project owner
	_, err = l.Queries.CreateProjectMembership(ctx, tx, &database.CreateProjectMembershipParams{
		ID:                     dbuuid.Must(),
		OrganizationID:         orgID,
		ProjectID:              projectID,
		EmployeeID:             creatorID,
		Role:                   ProjectMemberRoleOwner,
		NotificationPreference: NotificationPreferenceAll,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to add creator as owner",
			"error", err,
		)
		return nil, nil, nil, fmt.Errorf("failed to add creator as owner: %w", err)
	}

	// Increment member count. The updated row replaces the copy read before the creator
	// was added, so the response carries the count the database now holds — the caller
	// renders the new project card straight from this response, and reporting the
	// pre-increment 0 members made a project with an owner look empty.
	updatedProject, err := l.Queries.IncrementProjectMemberCount(ctx, tx, &database.IncrementProjectMemberCountParams{
		OrganizationID: orgID,
		ID:             projectID,
		MemberCount:    1,
		UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to increment member count",
			"error", err,
		)
	} else {
		project = updatedProject
	}

	slog.InfoContext(ctx, "project created successfully",
		"projectID", projectID,
		"name", req.Name,
		"statesCount", len(states),
		"levelsCount", len(levels),
	)

	return projectToProto(project), states, levels, nil
}

// GetProject retrieves a project by ID with states and levels
func (l *logicImpl) GetProject(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	projectID dbuuid.UUID,
) (*rpcv1.Project, []*rpcv1.ProjectState, []*rpcv1.TaskLevel, rpcv1.ProjectMemberRole, error) {
	slog.DebugContext(ctx, "GetProject",
		"projectID", projectID,
	)

	// Get project
	project, err := l.Queries.GetProject(ctx, tx, &database.GetProjectParams{
		OrganizationID: orgID,
		ID:             projectID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil, nil, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_UNSPECIFIED, ErrProjectNotFound
		}
		return nil, nil, nil, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_UNSPECIFIED, fmt.Errorf("failed to get project: %w", err)
	}

	// Check access and get role
	role, err := l.GetProjectMemberRole(ctx, tx, orgID, projectID, employeeID)
	if err != nil && err != ErrMembershipNotFound && err != ErrMemberNotFound {
		return nil, nil, nil, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_UNSPECIFIED, fmt.Errorf("failed to check access: %w", err)
	}

	// If not a member, check if project is public
	if err == ErrMembershipNotFound || err == ErrMemberNotFound {
		if project.Visibility != ProjectVisibilityPublic {
			return nil, nil, nil, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_UNSPECIFIED, ErrAccessDenied
		}
		// Non-member viewing public project gets viewer role
		role = ProjectMemberRoleViewer
	}

	// Get states
	dbStates, err := l.Queries.ListProjectStates(ctx, tx, &database.ListProjectStatesParams{
		OrganizationID: orgID,
		ProjectID:      projectID,
	})
	if err != nil {
		return nil, nil, nil, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_UNSPECIFIED, fmt.Errorf("failed to list states: %w", err)
	}
	states := make([]*rpcv1.ProjectState, len(dbStates))
	for i, s := range dbStates {
		states[i] = projectStateToProto(s)
	}

	// Get levels
	dbLevels, err := l.Queries.ListTaskLevels(ctx, tx, &database.ListTaskLevelsParams{
		OrganizationID: orgID,
		ProjectID:      projectID,
	})
	if err != nil {
		return nil, nil, nil, rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_UNSPECIFIED, fmt.Errorf("failed to list levels: %w", err)
	}
	levels := make([]*rpcv1.TaskLevel, len(dbLevels))
	for i, lv := range dbLevels {
		levels[i] = taskLevelToProto(lv)
	}

	return projectToProto(project), states, levels, stringToRoleProto(role), nil
}

// UpdateProject updates a project
func (l *logicImpl) UpdateProject(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	req *rpcv1.UpdateProjectRequest,
) (*rpcv1.Project, error) {
	slog.DebugContext(ctx, "UpdateProject",
		"projectID", req.ProjectId,
	)

	projectID := dbuuid.MustParse(req.ProjectId)
	now := time.Now()

	// Check authorization (owner or admin only)
	role, err := l.GetProjectMemberRole(ctx, tx, orgID, projectID, employeeID)
	if err != nil {
		return nil, err
	}
	if role != ProjectMemberRoleOwner && role != ProjectMemberRoleAdmin {
		return nil, ErrAccessDenied
	}

	// Get current project
	current, err := l.Queries.GetProject(ctx, tx, &database.GetProjectParams{
		OrganizationID: orgID,
		ID:             projectID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrProjectNotFound
		}
		return nil, fmt.Errorf("failed to get project: %w", err)
	}

	// Build update params
	name := current.Name
	if req.Name != nil {
		name = *req.Name
	}

	description := current.Description.String
	if req.Description != nil {
		description = *req.Description
	}

	visibility := current.Visibility
	if req.Visibility != nil {
		visibility = visibilityToString(*req.Visibility)
	}

	// Update project
	updated, err := l.Queries.UpdateProject(ctx, tx, &database.UpdateProjectParams{
		OrganizationID: orgID,
		ID:             projectID,
		Name:           pgtype.Text{String: name, Valid: name != ""},
		Description:    pgtype.Text{String: description, Valid: description != ""},
		Visibility:     pgtype.Text{String: visibility, Valid: visibility != ""},
		UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update project",
			"error", err,
			"projectID", req.ProjectId,
		)
		return nil, fmt.Errorf("failed to update project: %w", err)
	}

	return projectToProto(updated), nil
}

// ListProjects lists projects the employee has access to
func (l *logicImpl) ListProjects(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	includeArchived bool,
	cursor dbuuid.NullUUID,
	limit int32,
) ([]*rpcv1.Project, error) {
	slog.DebugContext(ctx, "ListProjects",
		"employeeID", employeeID,
		"includeArchived", includeArchived,
	)

	if limit <= 0 || limit > 100 {
		limit = 50
	}

	// List projects by membership
	dbProjects, err := l.Queries.ListProjectsForMember(ctx, tx, &database.ListProjectsForMemberParams{
		OrganizationID:  orgID,
		EmployeeID:      employeeID,
		IncludeArchived: pgtype.Bool{Bool: includeArchived, Valid: true},
		Cursor:          cursor,
		Limit:           limit,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list projects: %w", err)
	}

	// Also include public projects the user is not a member of
	allOrgProjects, err := l.Queries.ListProjects(ctx, tx, &database.ListProjectsParams{
		OrganizationID:  orgID,
		IncludeArchived: pgtype.Bool{Bool: includeArchived, Valid: true},
		Limit:           1000,
	})
	if err == nil {
		memberIDs := make(map[string]struct{}, len(dbProjects))
		for _, p := range dbProjects {
			memberIDs[p.ID.String()] = struct{}{}
		}
		for _, p := range allOrgProjects {
			if _, isMember := memberIDs[p.ID.String()]; !isMember && p.Visibility == ProjectVisibilityPublic {
				dbProjects = append(dbProjects, p)
			}
		}
	}

	projects := make([]*rpcv1.Project, len(dbProjects))
	for i, p := range dbProjects {
		projects[i] = projectToProto(p)
	}

	return projects, nil
}

// ArchiveProject archives or unarchives a project
func (l *logicImpl) ArchiveProject(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	projectID dbuuid.UUID,
	archive bool,
) (*rpcv1.Project, error) {
	slog.DebugContext(ctx, "ArchiveProject",
		"projectID", projectID,
		"archive", archive,
	)

	now := time.Now()

	// Check authorization (owner only)
	role, err := l.GetProjectMemberRole(ctx, tx, orgID, projectID, employeeID)
	if err != nil {
		return nil, err
	}
	if role != ProjectMemberRoleOwner {
		return nil, ErrAccessDenied
	}

	// Archive/unarchive project
	updated, err := l.Queries.ArchiveProject(ctx, tx, &database.ArchiveProjectParams{
		OrganizationID: orgID,
		ID:             projectID,
		IsArchived:     archive,
		UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrProjectNotFound
		}
		slog.ErrorContext(ctx, "failed to archive project",
			"error", err,
			"projectID", projectID,
		)
		return nil, fmt.Errorf("failed to archive project: %w", err)
	}

	return projectToProto(updated), nil
}

// ============================================================================
// Helper Functions
// ============================================================================

func projectToProto(p *database.CollaborationProject) *rpcv1.Project {
	return &rpcv1.Project{
		Id:                p.ID.String(),
		Name:              p.Name,
		Key:               p.Key,
		Description:       p.Description.String,
		Visibility:        stringToVisibilityProto(p.Visibility),
		IsArchived:        p.IsArchived,
		OwnerEmployeeId:   p.OwnerEmployeeID.String(),
		MemberCount:       p.MemberCount,
		TaskCount:         p.TaskCount,
		UpdatedAt:         timestamppb.New(p.UpdatedAt.Time),
		CollaborationMode: stringToCollaborationModeProto(p.CollaborationMode),
	}
}

func stringToCollaborationModeProto(s string) rpcv1.CollaborationMode {
	switch s {
	case CollaborationModeStandard:
		return rpcv1.CollaborationMode_COLLABORATION_MODE_STANDARD
	case CollaborationModeRitual:
		return rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL
	case CollaborationModeMixed:
		return rpcv1.CollaborationMode_COLLABORATION_MODE_MIXED
	default:
		return rpcv1.CollaborationMode_COLLABORATION_MODE_STANDARD
	}
}

func collaborationModeToString(m rpcv1.CollaborationMode) string {
	switch m {
	case rpcv1.CollaborationMode_COLLABORATION_MODE_RITUAL:
		return CollaborationModeRitual
	case rpcv1.CollaborationMode_COLLABORATION_MODE_MIXED:
		return CollaborationModeMixed
	default:
		return CollaborationModeStandard
	}
}

func projectStateToProto(s *database.CollaborationProjectState) *rpcv1.ProjectState {
	return &rpcv1.ProjectState{
		Id:        s.ID.String(),
		ProjectId: s.ProjectID.String(),
		Name:      s.Name,
		Color:     s.Color,
		Category:  stringToStateCategoryProto(s.Category),
		Position:  s.Position,
		IsInitial: s.IsInitial,
		IsClosed:  s.IsClosed,
		StateType: stringToStateTypeProto(s.StateType),
	}
}

func taskLevelToProto(lv *database.CollaborationTaskLevel) *rpcv1.TaskLevel {
	return &rpcv1.TaskLevel{
		Id:        lv.ID.String(),
		ProjectId: lv.ProjectID.String(),
		Name:      lv.Name,
		Icon:      lv.Icon.String,
		Color:     lv.Color,
		Depth:     lv.Depth,
	}
}

func visibilityToString(v rpcv1.ProjectVisibility) string {
	switch v {
	case rpcv1.ProjectVisibility_PROJECT_VISIBILITY_PUBLIC:
		return ProjectVisibilityPublic
	case rpcv1.ProjectVisibility_PROJECT_VISIBILITY_PRIVATE:
		return ProjectVisibilityPrivate
	default:
		return ProjectVisibilityPrivate
	}
}

func stringToVisibilityProto(s string) rpcv1.ProjectVisibility {
	switch s {
	case ProjectVisibilityPublic:
		return rpcv1.ProjectVisibility_PROJECT_VISIBILITY_PUBLIC
	case ProjectVisibilityPrivate:
		return rpcv1.ProjectVisibility_PROJECT_VISIBILITY_PRIVATE
	default:
		return rpcv1.ProjectVisibility_PROJECT_VISIBILITY_UNSPECIFIED
	}
}

func stateCategoryToString(c rpcv1.StateCategory) string {
	switch c {
	case rpcv1.StateCategory_STATE_CATEGORY_TODO:
		return StateCategoryTodo
	case rpcv1.StateCategory_STATE_CATEGORY_IN_PROGRESS:
		return StateCategoryInProgress
	case rpcv1.StateCategory_STATE_CATEGORY_DONE:
		return StateCategoryDone
	case rpcv1.StateCategory_STATE_CATEGORY_CANCELLED:
		return StateCategoryCancelled
	case rpcv1.StateCategory_STATE_CATEGORY_SCHEDULED:
		return StateCategoryScheduled
	case rpcv1.StateCategory_STATE_CATEGORY_SUBMITTED:
		return StateCategorySubmitted
	case rpcv1.StateCategory_STATE_CATEGORY_VERIFIED:
		return StateCategoryVerified
	case rpcv1.StateCategory_STATE_CATEGORY_OVERDUE:
		return StateCategoryOverdue
	case rpcv1.StateCategory_STATE_CATEGORY_MISSED:
		return StateCategoryMissed
	case rpcv1.StateCategory_STATE_CATEGORY_SKIPPED:
		return StateCategorySkipped
	default:
		return StateCategoryTodo
	}
}

func stringToStateCategoryProto(s string) rpcv1.StateCategory {
	switch s {
	case StateCategoryTodo:
		return rpcv1.StateCategory_STATE_CATEGORY_TODO
	case StateCategoryInProgress:
		return rpcv1.StateCategory_STATE_CATEGORY_IN_PROGRESS
	case StateCategoryDone:
		return rpcv1.StateCategory_STATE_CATEGORY_DONE
	case StateCategoryCancelled:
		return rpcv1.StateCategory_STATE_CATEGORY_CANCELLED
	case StateCategoryScheduled:
		return rpcv1.StateCategory_STATE_CATEGORY_SCHEDULED
	case StateCategorySubmitted:
		return rpcv1.StateCategory_STATE_CATEGORY_SUBMITTED
	case StateCategoryVerified:
		return rpcv1.StateCategory_STATE_CATEGORY_VERIFIED
	case StateCategoryOverdue:
		return rpcv1.StateCategory_STATE_CATEGORY_OVERDUE
	case StateCategoryMissed:
		return rpcv1.StateCategory_STATE_CATEGORY_MISSED
	case StateCategorySkipped:
		return rpcv1.StateCategory_STATE_CATEGORY_SKIPPED
	default:
		return rpcv1.StateCategory_STATE_CATEGORY_UNSPECIFIED
	}
}

func stringToStateTypeProto(s string) rpcv1.StateType {
	switch s {
	case StateTypeStandard:
		return rpcv1.StateType_STATE_TYPE_STANDARD
	case StateTypeRitual:
		return rpcv1.StateType_STATE_TYPE_RITUAL
	default:
		return rpcv1.StateType_STATE_TYPE_UNSPECIFIED
	}
}

func stateTypeProtoToString(t rpcv1.StateType) string {
	switch t {
	case rpcv1.StateType_STATE_TYPE_STANDARD:
		return StateTypeStandard
	case rpcv1.StateType_STATE_TYPE_RITUAL:
		return StateTypeRitual
	default:
		return StateTypeStandard
	}
}

func stringToRoleProto(s string) rpcv1.ProjectMemberRole {
	switch s {
	case ProjectMemberRoleOwner:
		return rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_OWNER
	case ProjectMemberRoleAdmin:
		return rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_ADMIN
	case ProjectMemberRoleMember:
		return rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER
	case ProjectMemberRoleViewer:
		return rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_VIEWER
	default:
		return rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_UNSPECIFIED
	}
}
