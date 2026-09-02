package collaboration

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5"
	"github.com/nvcnvn/flows"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/database/txn"
	"github.com/nvcnvn/tech-office/backend/internal/files"
	"github.com/nvcnvn/tech-office/backend/internal/interceptor"
	"github.com/nvcnvn/tech-office/backend/internal/linking"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"github.com/nvcnvn/tech-office/backend/rpc/v1/rpcv1connect"
	"google.golang.org/genproto/googleapis/rpc/errdetails"
)

// ============================================================================
// Collaboration Service Connect Layer
// ============================================================================

// CollaborationServiceConnect is the RPC handler layer for collaboration operations.
// It owns TenantPool, manages transactions, extracts auth context,
// and delegates to the logic layer. All operations are user-scope.
type CollaborationServiceConnect struct {
	rpcv1connect.UnimplementedCollaborationServiceHandler

	// Logic layer for business operations
	Logic Logic

	// FileLogic layer for file upload operations
	// Uses files.FileLogic interface with tx database.DBTX parameters
	FileLogic files.FileLogic

	// Queries for database operations (file uploads need direct query access)
	Queries *database.Queries

	// TenantPool: Used for all collaboration operations (user-scope only)
	TenantPool database.TenantDatabaseConnector

	// Flows client for async workflow orchestration
	FlowsClient flows.Client

	// Post-processing workflow for PDF conversion and content indexing
	PostProcess flows.Workflow[files.FilePostProcessingWorkflowInput, files.FilePostProcessingWorkflowOutput]
}

// NewCollaborationServiceConnect creates a new collaboration service connect layer
func NewCollaborationServiceConnect(
	logic Logic,
	tenantPool database.TenantDatabaseConnector,
	fileLogic files.FileLogic,
	queries *database.Queries,
	flowsClient flows.Client,
	postProcess flows.Workflow[files.FilePostProcessingWorkflowInput, files.FilePostProcessingWorkflowOutput],
) *CollaborationServiceConnect {
	return &CollaborationServiceConnect{
		Logic:       logic,
		TenantPool:  tenantPool,
		FileLogic:   fileLogic,
		Queries:     queries,
		FlowsClient: flowsClient,
		PostProcess: postProcess,
	}
}

// extractAuthContext extracts employee ID and organization ID from request context
func extractAuthContext(ctx context.Context) (employeeID, organizationID dbuuid.UUID, err error) {
	userID, ok := interceptor.UserIDFromContext(ctx)
	if !ok || userID == "" {
		return dbuuid.UUID{}, dbuuid.UUID{}, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("user ID not found in context"))
	}

	orgIDStr, ok := interceptor.UserOrgIDFromContext(ctx)
	if !ok || orgIDStr == "" {
		return dbuuid.UUID{}, dbuuid.UUID{}, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("organization ID not found in context"))
	}

	employeeID = dbuuid.MustParse(userID)
	organizationID = dbuuid.MustParse(orgIDStr)
	return employeeID, organizationID, nil
}

const getProjectIDByKeyForTaskLookupQuery = `
SELECT id::text
FROM collaboration.project
WHERE organization_id = $1 AND key = $2
`

func resolveProjectIDForTaskLookup(
	ctx context.Context,
	tx database.DBTX,
	organizationID dbuuid.UUID,
	rawProjectID string,
) (dbuuid.UUID, error) {
	trimmedProjectID := strings.TrimSpace(rawProjectID)
	if trimmedProjectID == "" {
		return dbuuid.UUID{}, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("project_id is required"))
	}

	projectID, err := dbuuid.Parse(trimmedProjectID)
	if err == nil {
		return projectID, nil
	}

	var resolvedProjectID string
	lookupErr := tx.QueryRow(ctx, getProjectIDByKeyForTaskLookupQuery, organizationID, strings.ToUpper(trimmedProjectID)).Scan(&resolvedProjectID)
	if lookupErr != nil {
		if errors.Is(lookupErr, pgx.ErrNoRows) {
			return dbuuid.UUID{}, ErrProjectNotFound
		}
		return dbuuid.UUID{}, fmt.Errorf("failed to resolve project_id %q: %w", trimmedProjectID, lookupErr)
	}

	projectID, err = dbuuid.Parse(resolvedProjectID)
	if err != nil {
		return dbuuid.UUID{}, fmt.Errorf("failed to parse resolved project_id %q: %w", resolvedProjectID, err)
	}

	return projectID, nil
}

// handleError converts logic errors to Connect errors
func handleError(err error) error {
	// Pass through existing Connect errors (e.g. validation errors from logic layer)
	var connectErr *connect.Error
	if errors.As(err, &connectErr) {
		return connectErr
	}
	switch {
	case errors.Is(err, ErrProjectNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, ErrTaskNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, ErrStateNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, ErrLevelNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, ErrCustomFieldNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, ErrWorkflowRuleNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, ErrSavedViewNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, ErrMembershipNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, ErrMemberNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, ErrAccessDenied):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, ErrEmptyTaskTitle):
		// Named field, so the quick sheet can mark the title input rather than showing a
		// whole-request error the user has to guess the cause of (Principle X).
		return fieldViolation(connect.CodeInvalidArgument, err, "title", err.Error())
	case errors.Is(err, ErrSourceMessageNotConvertible):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	case errors.Is(err, ErrDestinationUnusable):
		return destinationUnusable(err)
	case errors.Is(err, ErrTooManySourceMessages):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, ErrChannelAdminRequired):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, ErrInvalidViewType):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, ErrInvalidTriggerType):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, ErrInvalidActionType):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, ErrInvalidParent):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, ErrMaxDepthExceeded):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, ErrDuplicateMembership):
		return connect.NewError(connect.CodeAlreadyExists, err)
	case errors.Is(err, ErrProjectKeyExists):
		return connect.NewError(connect.CodeAlreadyExists, err)
	case errors.Is(err, ErrCannotDeleteWithTasks):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	case errors.Is(err, ErrLastOwner):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	case errors.Is(err, ErrInvalidFieldValue):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, ErrInvalidAssigneeRole):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, ErrInvalidFieldType):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, ErrInvalidMemberRole):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, ErrRitualDefinitionNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, ErrEvidenceRequirementNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, ErrEvidenceSubmissionNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, ErrNotRitualInstance):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, ErrRitualDefinitionArchived):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}

func canonicalTaskLinkTarget(tenantKey, taskID string, options linking.TargetOptions) linking.CanonicalLinkTarget {
	return linking.NewTaskTarget(tenantKey, taskID, options)
}

func canonicalProjectLinkTarget(tenantKey, projectID string) linking.CanonicalLinkTarget {
	return linking.NewProjectTarget(tenantKey, projectID)
}

func canonicalWorkspaceLinkTarget(tenantKey string) linking.CanonicalLinkTarget {
	return linking.NewWorkspaceTarget(tenantKey)
}

func canonicalChatChannelLinkTarget(tenantKey, channelID string, options linking.TargetOptions) linking.CanonicalLinkTarget {
	return linking.NewChatChannelTarget(tenantKey, channelID, options)
}

func canonicalCalendarEventLinkTarget(tenantKey, eventID string, options linking.TargetOptions) linking.CanonicalLinkTarget {
	return linking.NewCalendarEventTarget(tenantKey, eventID, options)
}

// ============================================================================
// Project RPC Handlers
// ============================================================================

func (s *CollaborationServiceConnect) CreateProject(
	ctx context.Context,
	req *connect.Request[rpcv1.CreateProjectRequest],
) (*connect.Response[rpcv1.CreateProjectResponse], error) {
	slog.DebugContext(ctx, "CreateProject RPC called",
		"name", req.Msg.GetName(),
		"key", req.Msg.GetKey(),
	)

	employeeID, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var project *rpcv1.Project
	var states []*rpcv1.ProjectState
	var levels []*rpcv1.TaskLevel
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		project, states, levels, txErr = s.Logic.CreateProject(ctx, tx, organizationID, employeeID, req.Msg)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create project", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.CreateProjectResponse{
		Project: project,
		States:  states,
		Levels:  levels,
	}), nil
}

func (s *CollaborationServiceConnect) GetProject(
	ctx context.Context,
	req *connect.Request[rpcv1.GetProjectRequest],
) (*connect.Response[rpcv1.GetProjectResponse], error) {
	slog.DebugContext(ctx, "GetProject RPC called", "projectId", req.Msg.GetProjectId())

	employeeID, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	projectID := dbuuid.MustParse(req.Msg.GetProjectId())

	var project *rpcv1.Project
	var states []*rpcv1.ProjectState
	var levels []*rpcv1.TaskLevel
	var role rpcv1.ProjectMemberRole
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		project, states, levels, role, txErr = s.Logic.GetProject(ctx, tx, organizationID, employeeID, projectID)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to get project", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.GetProjectResponse{
		Project:         project,
		States:          states,
		Levels:          levels,
		CurrentUserRole: role,
	}), nil
}

func (s *CollaborationServiceConnect) UpdateProject(
	ctx context.Context,
	req *connect.Request[rpcv1.UpdateProjectRequest],
) (*connect.Response[rpcv1.UpdateProjectResponse], error) {
	slog.DebugContext(ctx, "UpdateProject RPC called", "projectId", req.Msg.GetProjectId())

	employeeID, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var project *rpcv1.Project
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		project, txErr = s.Logic.UpdateProject(ctx, tx, organizationID, employeeID, req.Msg)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update project", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.UpdateProjectResponse{
		Project: project,
	}), nil
}

func (s *CollaborationServiceConnect) ListProjects(
	ctx context.Context,
	req *connect.Request[rpcv1.ListProjectsRequest],
) (*connect.Response[rpcv1.ListProjectsResponse], error) {
	slog.DebugContext(ctx, "ListProjects RPC called")

	employeeID, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	// Parse optional cursor
	var cursor dbuuid.NullUUID
	if req.Msg.Cursor != nil && *req.Msg.Cursor != "" {
		cursor = dbuuid.UUIDToNullUUID(dbuuid.MustParse(*req.Msg.Cursor))
	}

	// Get limit with default
	limit := int32(20)
	if req.Msg.Limit != nil && *req.Msg.Limit > 0 {
		limit = *req.Msg.Limit
	}

	includeArchived := req.Msg.GetIncludeArchived()

	var projects []*rpcv1.Project
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		projects, txErr = s.Logic.ListProjects(ctx, tx, organizationID, employeeID, includeArchived, cursor, limit)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to list projects", "error", err)
		return nil, handleError(err)
	}

	resp := &rpcv1.ListProjectsResponse{
		Projects: projects,
	}

	// Set next cursor if we have results and potentially more
	if len(projects) == int(limit) && len(projects) > 0 {
		lastID := projects[len(projects)-1].GetId()
		resp.NextCursor = &lastID
	}

	return connect.NewResponse(resp), nil
}

func (s *CollaborationServiceConnect) ArchiveProject(
	ctx context.Context,
	req *connect.Request[rpcv1.ArchiveProjectRequest],
) (*connect.Response[rpcv1.ArchiveProjectResponse], error) {
	slog.DebugContext(ctx, "ArchiveProject RPC called", "projectId", req.Msg.GetProjectId())

	employeeID, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	projectID := dbuuid.MustParse(req.Msg.GetProjectId())

	var project *rpcv1.Project
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		project, txErr = s.Logic.ArchiveProject(ctx, tx, organizationID, employeeID, projectID, req.Msg.GetArchive())
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to archive project", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.ArchiveProjectResponse{
		Project: project,
	}), nil
}

// ============================================================================
// Project State RPC Handlers
// ============================================================================

func (s *CollaborationServiceConnect) CreateProjectState(
	ctx context.Context,
	req *connect.Request[rpcv1.CreateProjectStateRequest],
) (*connect.Response[rpcv1.CreateProjectStateResponse], error) {
	slog.DebugContext(ctx, "CreateProjectState RPC called", "projectId", req.Msg.GetProjectId())

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var state *rpcv1.ProjectState
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		state, txErr = s.Logic.CreateProjectState(ctx, tx, organizationID, req.Msg)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create project state", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.CreateProjectStateResponse{
		State: state,
	}), nil
}

func (s *CollaborationServiceConnect) UpdateProjectState(
	ctx context.Context,
	req *connect.Request[rpcv1.UpdateProjectStateRequest],
) (*connect.Response[rpcv1.UpdateProjectStateResponse], error) {
	slog.DebugContext(ctx, "UpdateProjectState RPC called", "stateId", req.Msg.GetStateId())

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var state *rpcv1.ProjectState
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		state, txErr = s.Logic.UpdateProjectState(ctx, tx, organizationID, req.Msg)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update project state", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.UpdateProjectStateResponse{
		State: state,
	}), nil
}

func (s *CollaborationServiceConnect) DeleteProjectState(
	ctx context.Context,
	req *connect.Request[rpcv1.DeleteProjectStateRequest],
) (*connect.Response[rpcv1.DeleteProjectStateResponse], error) {
	slog.DebugContext(ctx, "DeleteProjectState RPC called", "stateId", req.Msg.GetStateId())

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	stateID := dbuuid.MustParse(req.Msg.GetStateId())
	var migrateToStateID dbuuid.UUID
	if req.Msg.GetMigrateToStateId() != "" {
		migrateToStateID = dbuuid.MustParse(req.Msg.GetMigrateToStateId())
	}

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		return s.Logic.DeleteProjectState(ctx, tx, organizationID, stateID, migrateToStateID)
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to delete project state", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.DeleteProjectStateResponse{}), nil
}

func (s *CollaborationServiceConnect) ReorderProjectStates(
	ctx context.Context,
	req *connect.Request[rpcv1.ReorderProjectStatesRequest],
) (*connect.Response[rpcv1.ReorderProjectStatesResponse], error) {
	slog.DebugContext(ctx, "ReorderProjectStates RPC called", "projectId", req.Msg.GetProjectId())

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	projectID := dbuuid.MustParse(req.Msg.GetProjectId())
	stateIDs := make([]dbuuid.UUID, len(req.Msg.GetStateIds()))
	for i, sid := range req.Msg.GetStateIds() {
		stateIDs[i] = dbuuid.MustParse(sid)
	}

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		return s.Logic.ReorderProjectStates(ctx, tx, organizationID, projectID, stateIDs)
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to reorder project states", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.ReorderProjectStatesResponse{}), nil
}

func (s *CollaborationServiceConnect) ListProjectStates(
	ctx context.Context,
	req *connect.Request[rpcv1.ListProjectStatesRequest],
) (*connect.Response[rpcv1.ListProjectStatesResponse], error) {
	slog.DebugContext(ctx, "ListProjectStates RPC called", "projectId", req.Msg.GetProjectId())

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	projectID := dbuuid.MustParse(req.Msg.GetProjectId())

	var states []*rpcv1.ProjectState
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		states, txErr = s.Logic.ListProjectStates(ctx, tx, organizationID, projectID)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to list project states", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.ListProjectStatesResponse{
		States: states,
	}), nil
}

// ============================================================================
// Task Level RPC Handlers
// ============================================================================

func (s *CollaborationServiceConnect) CreateTaskLevel(
	ctx context.Context,
	req *connect.Request[rpcv1.CreateTaskLevelRequest],
) (*connect.Response[rpcv1.CreateTaskLevelResponse], error) {
	slog.DebugContext(ctx, "CreateTaskLevel RPC called", "projectId", req.Msg.GetProjectId())

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var level *rpcv1.TaskLevel
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		level, txErr = s.Logic.CreateTaskLevel(ctx, tx, organizationID, req.Msg)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create task level", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.CreateTaskLevelResponse{
		Level: level,
	}), nil
}

func (s *CollaborationServiceConnect) UpdateTaskLevel(
	ctx context.Context,
	req *connect.Request[rpcv1.UpdateTaskLevelRequest],
) (*connect.Response[rpcv1.UpdateTaskLevelResponse], error) {
	slog.DebugContext(ctx, "UpdateTaskLevel RPC called", "levelId", req.Msg.GetLevelId())

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var level *rpcv1.TaskLevel
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		level, txErr = s.Logic.UpdateTaskLevel(ctx, tx, organizationID, req.Msg)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update task level", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.UpdateTaskLevelResponse{
		Level: level,
	}), nil
}

func (s *CollaborationServiceConnect) DeleteTaskLevel(
	ctx context.Context,
	req *connect.Request[rpcv1.DeleteTaskLevelRequest],
) (*connect.Response[rpcv1.DeleteTaskLevelResponse], error) {
	slog.DebugContext(ctx, "DeleteTaskLevel RPC called", "levelId", req.Msg.GetLevelId())

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	levelID := dbuuid.MustParse(req.Msg.GetLevelId())
	var migrateToLevelID dbuuid.UUID
	if req.Msg.GetMigrateToLevelId() != "" {
		migrateToLevelID = dbuuid.MustParse(req.Msg.GetMigrateToLevelId())
	}

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		return s.Logic.DeleteTaskLevel(ctx, tx, organizationID, levelID, migrateToLevelID)
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to delete task level", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.DeleteTaskLevelResponse{}), nil
}

func (s *CollaborationServiceConnect) ListTaskLevels(
	ctx context.Context,
	req *connect.Request[rpcv1.ListTaskLevelsRequest],
) (*connect.Response[rpcv1.ListTaskLevelsResponse], error) {
	slog.DebugContext(ctx, "ListTaskLevels RPC called", "projectId", req.Msg.GetProjectId())

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	projectID := dbuuid.MustParse(req.Msg.GetProjectId())

	var levels []*rpcv1.TaskLevel
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		levels, txErr = s.Logic.ListTaskLevels(ctx, tx, organizationID, projectID)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to list task levels", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.ListTaskLevelsResponse{
		Levels: levels,
	}), nil
}

// ============================================================================
// Task RPC Handlers
// ============================================================================

func (s *CollaborationServiceConnect) CreateTask(
	ctx context.Context,
	req *connect.Request[rpcv1.CreateTaskRequest],
) (*connect.Response[rpcv1.CreateTaskResponse], error) {
	slog.DebugContext(ctx, "CreateTask RPC called", "projectId", req.Msg.GetProjectId())

	employeeID, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var task *rpcv1.Task
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		task, txErr = s.Logic.CreateTask(ctx, tx, organizationID, employeeID, req.Msg)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create task", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.CreateTaskResponse{
		Task: task,
	}), nil
}

func (s *CollaborationServiceConnect) GetTask(
	ctx context.Context,
	req *connect.Request[rpcv1.GetTaskRequest],
) (*connect.Response[rpcv1.GetTaskResponse], error) {
	slog.DebugContext(ctx, "GetTask RPC called", "taskId", req.Msg.GetTaskId())

	employeeID, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	taskID := dbuuid.MustParse(req.Msg.GetTaskId())

	var task *rpcv1.Task
	var watchers []*rpcv1.TaskWatcher
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		// EnsureTaskResources lazily creates channel + document for ritual instances on first access.
		// For non-ritual tasks or tasks that already have resources, it behaves like GetTask.
		task, watchers, txErr = s.Logic.EnsureTaskResources(ctx, tx, organizationID, employeeID, taskID)
		if txErr != nil {
			return txErr
		}
		// Enforce project-level access control (private project membership check)
		taskProjectID := dbuuid.MustParse(task.ProjectId)
		_, _, _, _, txErr = s.Logic.GetProject(ctx, tx, organizationID, employeeID, taskProjectID)
		return txErr
	})
	if err != nil {
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.GetTaskResponse{
		Task:     task,
		Watchers: watchers,
	}), nil
}

func (s *CollaborationServiceConnect) UpdateTask(
	ctx context.Context,
	req *connect.Request[rpcv1.UpdateTaskRequest],
) (*connect.Response[rpcv1.UpdateTaskResponse], error) {
	slog.DebugContext(ctx, "UpdateTask RPC called", "taskId", req.Msg.GetTaskId())

	employeeID, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var task *rpcv1.Task
	var ruleExecutions []*rpcv1.WorkflowRuleExecution
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		task, ruleExecutions, txErr = s.Logic.UpdateTask(ctx, tx, organizationID, employeeID, req.Msg)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update task", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.UpdateTaskResponse{
		Task:           task,
		RuleExecutions: ruleExecutions,
	}), nil
}

func (s *CollaborationServiceConnect) DeleteTask(
	ctx context.Context,
	req *connect.Request[rpcv1.DeleteTaskRequest],
) (*connect.Response[rpcv1.DeleteTaskResponse], error) {
	slog.DebugContext(ctx, "DeleteTask RPC called", "taskId", req.Msg.GetTaskId())

	employeeID, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	taskID := dbuuid.MustParse(req.Msg.GetTaskId())
	deleteChildren := req.Msg.GetDeleteChildren()

	var tasksDeleted int32
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		tasksDeleted, txErr = s.Logic.DeleteTask(ctx, tx, organizationID, employeeID, taskID, deleteChildren)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to delete task", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.DeleteTaskResponse{
		TasksDeleted: tasksDeleted,
	}), nil
}

func (s *CollaborationServiceConnect) ListTasks(
	ctx context.Context,
	req *connect.Request[rpcv1.ListTasksRequest],
) (*connect.Response[rpcv1.ListTasksResponse], error) {
	slog.DebugContext(ctx, "ListTasks RPC called", "projectId", req.Msg.GetProjectId())

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var tasks []*rpcv1.Task
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		tasks, txErr = s.Logic.ListTasks(ctx, tx, organizationID, req.Msg)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to list tasks", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.ListTasksResponse{
		Tasks: tasks,
	}), nil
}

func (s *CollaborationServiceConnect) GetAssignedWorkSummary(
	ctx context.Context,
	req *connect.Request[rpcv1.GetAssignedWorkSummaryRequest],
) (*connect.Response[rpcv1.GetAssignedWorkSummaryResponse], error) {
	slog.DebugContext(ctx, "GetAssignedWorkSummary RPC called")

	employeeID, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var summary *rpcv1.GetAssignedWorkSummaryResponse
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		summary, txErr = s.Logic.GetAssignedWorkSummary(ctx, tx, organizationID, employeeID, req.Msg)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to get assigned work summary", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(summary), nil
}

func (s *CollaborationServiceConnect) MoveTask(
	ctx context.Context,
	req *connect.Request[rpcv1.MoveTaskRequest],
) (*connect.Response[rpcv1.MoveTaskResponse], error) {
	slog.DebugContext(ctx, "MoveTask RPC called", "taskId", req.Msg.GetTaskId())

	employeeID, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	taskID := dbuuid.MustParse(req.Msg.GetTaskId())
	newStateID := dbuuid.MustParse(req.Msg.GetNewStateId())

	var task *rpcv1.Task
	var ruleExecutions []*rpcv1.WorkflowRuleExecution
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		task, ruleExecutions, txErr = s.Logic.MoveTask(ctx, tx, organizationID, employeeID, taskID, newStateID)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to move task", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.MoveTaskResponse{
		Task:           task,
		RuleExecutions: ruleExecutions,
	}), nil
}

func (s *CollaborationServiceConnect) GetTaskByIdentifier(
	ctx context.Context,
	req *connect.Request[rpcv1.GetTaskByIdentifierRequest],
) (*connect.Response[rpcv1.GetTaskByIdentifierResponse], error) {
	slog.DebugContext(ctx, "GetTaskByIdentifier RPC called", "identifier", req.Msg.GetIdentifier())

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var task *rpcv1.Task
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		projectID, txErr := resolveProjectIDForTaskLookup(ctx, tx, organizationID, req.Msg.GetProjectId())
		if txErr != nil {
			return txErr
		}

		task, txErr = s.Logic.GetTaskByIdentifier(ctx, tx, organizationID, projectID, req.Msg.GetIdentifier())
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to get task by identifier", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.GetTaskByIdentifierResponse{
		Task: task,
	}), nil
}

// ============================================================================
// Task Assignment RPC Handlers
// ============================================================================

func (s *CollaborationServiceConnect) AssignTask(
	ctx context.Context,
	req *connect.Request[rpcv1.AssignTaskRequest],
) (*connect.Response[rpcv1.AssignTaskResponse], error) {
	slog.DebugContext(ctx, "AssignTask RPC called", "taskId", req.Msg.GetTaskId())

	assignerID, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	taskID := dbuuid.MustParse(req.Msg.GetTaskId())
	employeeID := dbuuid.MustParse(req.Msg.GetEmployeeId())
	role := taskAssigneeRoleFromProto(req.Msg.GetRole())

	var assignee *rpcv1.TaskAssignee
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		assignee, txErr = s.Logic.AssignTask(ctx, tx, organizationID, assignerID, taskID, employeeID, role)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to assign task", "error", err)
		return nil, handleError(err)
	}

	// Response uses Task, but logic returns TaskAssignee. We need to fetch task for response.
	// For now return with task containing the new assignee - re-fetch would be required for full task.
	return connect.NewResponse(&rpcv1.AssignTaskResponse{
		Task: &rpcv1.Task{
			Id:        taskID.String(),
			Assignees: []*rpcv1.TaskAssignee{assignee},
		},
	}), nil
}

func (s *CollaborationServiceConnect) UnassignTask(
	ctx context.Context,
	req *connect.Request[rpcv1.UnassignTaskRequest],
) (*connect.Response[rpcv1.UnassignTaskResponse], error) {
	slog.DebugContext(ctx, "UnassignTask RPC called", "taskId", req.Msg.GetTaskId())

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	taskID := dbuuid.MustParse(req.Msg.GetTaskId())
	employeeID := dbuuid.MustParse(req.Msg.GetEmployeeId())
	role := ""
	if req.Msg.Role != nil {
		role = req.Msg.Role.String()
	}

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		return s.Logic.UnassignTask(ctx, tx, organizationID, taskID, employeeID, role)
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to unassign task", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.UnassignTaskResponse{}), nil
}

func (s *CollaborationServiceConnect) WatchTask(
	ctx context.Context,
	req *connect.Request[rpcv1.WatchTaskRequest],
) (*connect.Response[rpcv1.WatchTaskResponse], error) {
	slog.DebugContext(ctx, "WatchTask RPC called", "taskId", req.Msg.GetTaskId())

	employeeID, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	taskID := dbuuid.MustParse(req.Msg.GetTaskId())

	var watcher *rpcv1.TaskWatcher
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		watcher, txErr = s.Logic.WatchTask(ctx, tx, organizationID, taskID, employeeID)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to watch task", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.WatchTaskResponse{
		Watching: watcher != nil,
	}), nil
}

func (s *CollaborationServiceConnect) UnwatchTask(
	ctx context.Context,
	req *connect.Request[rpcv1.UnwatchTaskRequest],
) (*connect.Response[rpcv1.UnwatchTaskResponse], error) {
	slog.DebugContext(ctx, "UnwatchTask RPC called", "taskId", req.Msg.GetTaskId())

	employeeID, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	taskID := dbuuid.MustParse(req.Msg.GetTaskId())

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		return s.Logic.UnwatchTask(ctx, tx, organizationID, taskID, employeeID)
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to unwatch task", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.UnwatchTaskResponse{}), nil
}

// ============================================================================
// Custom Field RPC Handlers
// ============================================================================

func (s *CollaborationServiceConnect) CreateCustomField(
	ctx context.Context,
	req *connect.Request[rpcv1.CreateCustomFieldRequest],
) (*connect.Response[rpcv1.CreateCustomFieldResponse], error) {
	slog.DebugContext(ctx, "CreateCustomField RPC called", "projectId", req.Msg.GetProjectId())

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var field *rpcv1.CustomFieldDefinition
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		field, txErr = s.Logic.CreateCustomField(ctx, tx, organizationID, req.Msg)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create custom field", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.CreateCustomFieldResponse{
		Field: field,
	}), nil
}

func (s *CollaborationServiceConnect) UpdateCustomField(
	ctx context.Context,
	req *connect.Request[rpcv1.UpdateCustomFieldRequest],
) (*connect.Response[rpcv1.UpdateCustomFieldResponse], error) {
	slog.DebugContext(ctx, "UpdateCustomField RPC called", "fieldId", req.Msg.GetFieldId())

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var field *rpcv1.CustomFieldDefinition
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		field, txErr = s.Logic.UpdateCustomField(ctx, tx, organizationID, req.Msg)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update custom field", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.UpdateCustomFieldResponse{
		Field: field,
	}), nil
}

func (s *CollaborationServiceConnect) ArchiveCustomField(
	ctx context.Context,
	req *connect.Request[rpcv1.ArchiveCustomFieldRequest],
) (*connect.Response[rpcv1.ArchiveCustomFieldResponse], error) {
	slog.DebugContext(ctx, "ArchiveCustomField RPC called", "fieldId", req.Msg.GetFieldId())

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	fieldID := dbuuid.MustParse(req.Msg.GetFieldId())
	archive := req.Msg.GetArchive()

	var field *rpcv1.CustomFieldDefinition
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		field, txErr = s.Logic.ArchiveCustomField(ctx, tx, organizationID, fieldID, archive)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to archive custom field", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.ArchiveCustomFieldResponse{
		Field: field,
	}), nil
}

func (s *CollaborationServiceConnect) ListCustomFields(
	ctx context.Context,
	req *connect.Request[rpcv1.ListCustomFieldsRequest],
) (*connect.Response[rpcv1.ListCustomFieldsResponse], error) {
	slog.DebugContext(ctx, "ListCustomFields RPC called", "projectId", req.Msg.GetProjectId())

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	projectID := dbuuid.MustParse(req.Msg.GetProjectId())
	includeArchived := req.Msg.GetIncludeArchived()

	var fields []*rpcv1.CustomFieldDefinition
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		fields, txErr = s.Logic.ListCustomFields(ctx, tx, organizationID, projectID, includeArchived)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to list custom fields", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.ListCustomFieldsResponse{
		Fields: fields,
	}), nil
}

func (s *CollaborationServiceConnect) SetCustomFieldValue(
	ctx context.Context,
	req *connect.Request[rpcv1.SetCustomFieldValueRequest],
) (*connect.Response[rpcv1.SetCustomFieldValueResponse], error) {
	slog.DebugContext(ctx, "SetCustomFieldValue RPC called", "taskId", req.Msg.GetTaskId())

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	taskID := dbuuid.MustParse(req.Msg.GetTaskId())
	fieldID := dbuuid.MustParse(req.Msg.GetFieldId())

	// Convert oneof value to JSON string for storage
	valueStr, err := customFieldValueOneofToJSON(req.Msg)
	if err != nil {
		slog.ErrorContext(ctx, "failed to convert custom field value to JSON", "error", err)
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid custom field value: %w", err))
	}

	var value *rpcv1.CustomFieldValue
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		value, txErr = s.Logic.SetCustomFieldValue(ctx, tx, organizationID, taskID, fieldID, valueStr)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to set custom field value", "error", err)
		return nil, handleError(err)
	}

	// Response includes Task - for now return minimal task with custom field value
	return connect.NewResponse(&rpcv1.SetCustomFieldValueResponse{
		Task: &rpcv1.Task{
			Id:                taskID.String(),
			CustomFieldValues: []*rpcv1.CustomFieldValue{value},
		},
	}), nil
}

// ============================================================================
// Workflow Rule RPC Handlers
// ============================================================================

func (s *CollaborationServiceConnect) CreateWorkflowRule(
	ctx context.Context,
	req *connect.Request[rpcv1.CreateWorkflowRuleRequest],
) (*connect.Response[rpcv1.CreateWorkflowRuleResponse], error) {
	slog.DebugContext(ctx, "CreateWorkflowRule RPC called", "projectId", req.Msg.GetProjectId())

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var rule *rpcv1.WorkflowRule
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		rule, txErr = s.Logic.CreateWorkflowRule(ctx, tx, organizationID, req.Msg)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create workflow rule", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.CreateWorkflowRuleResponse{
		Rule: rule,
	}), nil
}

func (s *CollaborationServiceConnect) UpdateWorkflowRule(
	ctx context.Context,
	req *connect.Request[rpcv1.UpdateWorkflowRuleRequest],
) (*connect.Response[rpcv1.UpdateWorkflowRuleResponse], error) {
	slog.DebugContext(ctx, "UpdateWorkflowRule RPC called", "ruleId", req.Msg.GetRuleId())

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var rule *rpcv1.WorkflowRule
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		rule, txErr = s.Logic.UpdateWorkflowRule(ctx, tx, organizationID, req.Msg)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update workflow rule", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.UpdateWorkflowRuleResponse{
		Rule: rule,
	}), nil
}

func (s *CollaborationServiceConnect) DeleteWorkflowRule(
	ctx context.Context,
	req *connect.Request[rpcv1.DeleteWorkflowRuleRequest],
) (*connect.Response[rpcv1.DeleteWorkflowRuleResponse], error) {
	slog.DebugContext(ctx, "DeleteWorkflowRule RPC called", "ruleId", req.Msg.GetRuleId())

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	ruleID := dbuuid.MustParse(req.Msg.GetRuleId())

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		return s.Logic.DeleteWorkflowRule(ctx, tx, organizationID, ruleID)
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to delete workflow rule", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.DeleteWorkflowRuleResponse{}), nil
}

func (s *CollaborationServiceConnect) ListWorkflowRules(
	ctx context.Context,
	req *connect.Request[rpcv1.ListWorkflowRulesRequest],
) (*connect.Response[rpcv1.ListWorkflowRulesResponse], error) {
	slog.DebugContext(ctx, "ListWorkflowRules RPC called", "projectId", req.Msg.GetProjectId())

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	projectID := dbuuid.MustParse(req.Msg.GetProjectId())
	includeDisabled := req.Msg.GetIncludeDisabled()

	var rules []*rpcv1.WorkflowRule
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		rules, txErr = s.Logic.ListWorkflowRules(ctx, tx, organizationID, projectID, includeDisabled)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to list workflow rules", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.ListWorkflowRulesResponse{
		Rules: rules,
	}), nil
}

// ============================================================================
// Project Member RPC Handlers
// ============================================================================

func (s *CollaborationServiceConnect) AddProjectMember(
	ctx context.Context,
	req *connect.Request[rpcv1.AddProjectMemberRequest],
) (*connect.Response[rpcv1.AddProjectMemberResponse], error) {
	slog.DebugContext(ctx, "AddProjectMember RPC called", "projectId", req.Msg.GetProjectId())

	inviterID, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	projectID := dbuuid.MustParse(req.Msg.GetProjectId())
	employeeID := dbuuid.MustParse(req.Msg.GetEmployeeId())
	role := projectMemberRoleFromProto(req.Msg.GetRole())

	var member *rpcv1.ProjectMember
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		member, txErr = s.Logic.AddProjectMember(ctx, tx, organizationID, inviterID, projectID, employeeID, role)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to add project member", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.AddProjectMemberResponse{
		Member: member,
	}), nil
}

func (s *CollaborationServiceConnect) RemoveProjectMember(
	ctx context.Context,
	req *connect.Request[rpcv1.RemoveProjectMemberRequest],
) (*connect.Response[rpcv1.RemoveProjectMemberResponse], error) {
	slog.DebugContext(ctx, "RemoveProjectMember RPC called", "projectId", req.Msg.GetProjectId())

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	projectID := dbuuid.MustParse(req.Msg.GetProjectId())
	employeeID := dbuuid.MustParse(req.Msg.GetEmployeeId())

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		return s.Logic.RemoveProjectMember(ctx, tx, organizationID, projectID, employeeID)
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to remove project member", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.RemoveProjectMemberResponse{}), nil
}

func (s *CollaborationServiceConnect) UpdateProjectMemberRole(
	ctx context.Context,
	req *connect.Request[rpcv1.UpdateProjectMemberRoleRequest],
) (*connect.Response[rpcv1.UpdateProjectMemberRoleResponse], error) {
	slog.DebugContext(ctx, "UpdateProjectMemberRole RPC called", "projectId", req.Msg.GetProjectId())

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	projectID := dbuuid.MustParse(req.Msg.GetProjectId())
	employeeID := dbuuid.MustParse(req.Msg.GetEmployeeId())
	role := projectMemberRoleFromProto(req.Msg.GetRole())

	var member *rpcv1.ProjectMember
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		member, txErr = s.Logic.UpdateProjectMemberRole(ctx, tx, organizationID, projectID, employeeID, role)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update project member role", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.UpdateProjectMemberRoleResponse{
		Member: member,
	}), nil
}

func (s *CollaborationServiceConnect) ListProjectMembers(
	ctx context.Context,
	req *connect.Request[rpcv1.ListProjectMembersRequest],
) (*connect.Response[rpcv1.ListProjectMembersResponse], error) {
	slog.DebugContext(ctx, "ListProjectMembers RPC called", "projectId", req.Msg.GetProjectId())

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	projectID := dbuuid.MustParse(req.Msg.GetProjectId())

	var members []*rpcv1.ProjectMember
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		members, txErr = s.Logic.ListProjectMembers(ctx, tx, organizationID, projectID)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to list project members", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.ListProjectMembersResponse{
		Members: members,
	}), nil
}

// ============================================================================
// Saved View RPC Handlers
// ============================================================================

func (s *CollaborationServiceConnect) CreateSavedView(
	ctx context.Context,
	req *connect.Request[rpcv1.CreateSavedViewRequest],
) (*connect.Response[rpcv1.CreateSavedViewResponse], error) {
	slog.DebugContext(ctx, "CreateSavedView RPC called", "projectId", req.Msg.GetProjectId())

	employeeID, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var view *rpcv1.SavedView
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		view, txErr = s.Logic.CreateSavedView(ctx, tx, organizationID, employeeID, req.Msg)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create saved view", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.CreateSavedViewResponse{
		View: view,
	}), nil
}

func (s *CollaborationServiceConnect) UpdateSavedView(
	ctx context.Context,
	req *connect.Request[rpcv1.UpdateSavedViewRequest],
) (*connect.Response[rpcv1.UpdateSavedViewResponse], error) {
	slog.DebugContext(ctx, "UpdateSavedView RPC called", "viewId", req.Msg.GetViewId())

	employeeID, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var view *rpcv1.SavedView
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		view, txErr = s.Logic.UpdateSavedView(ctx, tx, organizationID, employeeID, req.Msg)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update saved view", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.UpdateSavedViewResponse{
		View: view,
	}), nil
}

func (s *CollaborationServiceConnect) DeleteSavedView(
	ctx context.Context,
	req *connect.Request[rpcv1.DeleteSavedViewRequest],
) (*connect.Response[rpcv1.DeleteSavedViewResponse], error) {
	slog.DebugContext(ctx, "DeleteSavedView RPC called", "viewId", req.Msg.GetViewId())

	employeeID, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	viewID := dbuuid.MustParse(req.Msg.GetViewId())

	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		return s.Logic.DeleteSavedView(ctx, tx, organizationID, employeeID, viewID)
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to delete saved view", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.DeleteSavedViewResponse{}), nil
}

func (s *CollaborationServiceConnect) ListSavedViews(
	ctx context.Context,
	req *connect.Request[rpcv1.ListSavedViewsRequest],
) (*connect.Response[rpcv1.ListSavedViewsResponse], error) {
	slog.DebugContext(ctx, "ListSavedViews RPC called", "projectId", req.Msg.GetProjectId())

	employeeID, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	projectID := dbuuid.MustParse(req.Msg.GetProjectId())

	var views []*rpcv1.SavedView
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		views, txErr = s.Logic.ListSavedViews(ctx, tx, organizationID, projectID, employeeID)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to list saved views", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.ListSavedViewsResponse{
		Views: views,
	}), nil
}

// ============================================================================
// Analytics RPC Handlers
// ============================================================================

func (s *CollaborationServiceConnect) GetTaskAnalytics(
	ctx context.Context,
	req *connect.Request[rpcv1.GetTaskAnalyticsRequest],
) (*connect.Response[rpcv1.GetTaskAnalyticsResponse], error) {
	slog.DebugContext(ctx, "GetTaskAnalytics RPC called", "projectId", req.Msg.GetProjectId())

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var response *rpcv1.GetTaskAnalyticsResponse
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		response, txErr = s.Logic.GetTaskAnalytics(ctx, tx, organizationID, req.Msg)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to get task analytics", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(response), nil
}

func (s *CollaborationServiceConnect) ExportTasksCSV(
	ctx context.Context,
	req *connect.Request[rpcv1.ExportTasksCSVRequest],
) (*connect.Response[rpcv1.ExportTasksCSVResponse], error) {
	slog.DebugContext(ctx, "ExportTasksCSV RPC called", "projectId", req.Msg.GetProjectId())

	_, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var csvData []byte
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		csvData, txErr = s.Logic.ExportTasksCSV(ctx, tx, organizationID, req.Msg)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to export tasks CSV", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.ExportTasksCSVResponse{
		CsvData:  csvData,
		Filename: "tasks_export.csv",
	}), nil
}

// ============================================================================
// Helper Functions
// ============================================================================

// customFieldValueOneofToJSON converts a oneof custom field value to JSON string for storage
func customFieldValueOneofToJSON(req *rpcv1.SetCustomFieldValueRequest) (string, error) {
	switch v := req.Value.(type) {
	case *rpcv1.SetCustomFieldValueRequest_StringValue:
		// Store string values as JSON strings (double-encoded for consistency)
		valueBytes, err := json.Marshal(v.StringValue)
		if err != nil {
			return "", fmt.Errorf("failed to marshal string value: %w", err)
		}
		return string(valueBytes), nil

	case *rpcv1.SetCustomFieldValueRequest_NumberValue:
		// Store number as string (for consistency with existing storage pattern)
		valueBytes, err := json.Marshal(fmt.Sprintf("%v", v.NumberValue))
		if err != nil {
			return "", fmt.Errorf("failed to marshal number value: %w", err)
		}
		return string(valueBytes), nil

	case *rpcv1.SetCustomFieldValueRequest_BoolValue:
		// Store boolean as string (for consistency with existing storage pattern)
		valueBytes, err := json.Marshal(fmt.Sprintf("%t", v.BoolValue))
		if err != nil {
			return "", fmt.Errorf("failed to marshal bool value: %w", err)
		}
		return string(valueBytes), nil

	case *rpcv1.SetCustomFieldValueRequest_StringArrayValue:
		// Store string array as comma-separated string
		if v.StringArrayValue == nil || len(v.StringArrayValue.Values) == 0 {
			return `""`, nil // Empty array as empty string
		}
		joined := strings.Join(v.StringArrayValue.Values, ",")
		valueBytes, err := json.Marshal(joined)
		if err != nil {
			return "", fmt.Errorf("failed to marshal string array value: %w", err)
		}
		return string(valueBytes), nil

	case nil:
		// No value set - store as JSON null
		return "null", nil

	default:
		return "", fmt.Errorf("unknown custom field value type: %T", v)
	}
}

// projectMemberRoleFromProto converts proto ProjectMemberRole enum to DB string.
func projectMemberRoleFromProto(role rpcv1.ProjectMemberRole) string {
	switch role {
	case rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_OWNER:
		return ProjectMemberRoleOwner
	case rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_ADMIN:
		return ProjectMemberRoleAdmin
	case rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_MEMBER:
		return ProjectMemberRoleMember
	case rpcv1.ProjectMemberRole_PROJECT_MEMBER_ROLE_VIEWER:
		return ProjectMemberRoleViewer
	default:
		return ""
	}
}

// taskAssigneeRoleFromProto converts proto TaskAssigneeRole enum to DB string.
func taskAssigneeRoleFromProto(role rpcv1.TaskAssigneeRole) string {
	switch role {
	case rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE:
		return TaskAssigneeRoleAssignee
	case rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_REVIEWER:
		return TaskAssigneeRoleReviewer
	case rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_APPROVER:
		return TaskAssigneeRoleApprover
	default:
		return ""
	}
}

// fieldViolation attaches a BadRequest naming the single input the caller got wrong, so a
// client can mark that field instead of showing a whole-request error (Principle X).
func fieldViolation(code connect.Code, err error, field, description string) *connect.Error {
	cErr := connect.NewError(code, err)
	badReq := &errdetails.BadRequest{
		FieldViolations: []*errdetails.BadRequest_FieldViolation{
			{Field: field, Description: description},
		},
	}
	if d, detailErr := connect.NewErrorDetail(badReq); detailErr == nil {
		cErr.AddDetail(d)
	}
	return cErr
}

// destinationUnusable reports a destination project that can no longer receive tasks.
// The PreconditionFailure names the project so the quick sheet reopens its project picker
// with an explanation, rather than showing a dead end the user cannot act on (FR-018).
func destinationUnusable(err error) *connect.Error {
	cErr := connect.NewError(connect.CodeFailedPrecondition, err)
	pf := &errdetails.PreconditionFailure{
		Violations: []*errdetails.PreconditionFailure_Violation{
			{
				Type:        "DESTINATION_PROJECT_UNUSABLE",
				Subject:     "project",
				Description: err.Error(),
			},
		},
	}
	if d, detailErr := connect.NewErrorDetail(pf); detailErr == nil {
		cErr.AddDetail(d)
	}
	return cErr
}

// CreateTaskFromMessage turns a chat message into a task.
//
// The whole conversion runs inside one transaction: the task row, its origin columns and
// the threaded announcement on the source message commit together or not at all. A task
// that exists with no trace in the conversation it came from would be worse than a
// refusal the user can retry (FR-031).
func (s *CollaborationServiceConnect) CreateTaskFromMessage(
	ctx context.Context,
	req *connect.Request[rpcv1.CreateTaskFromMessageRequest],
) (*connect.Response[rpcv1.CreateTaskFromMessageResponse], error) {
	slog.DebugContext(ctx, "CreateTaskFromMessage RPC called",
		"sourceMessageId", req.Msg.GetSourceMessageId(),
		"projectId", req.Msg.GetProjectId(),
	)

	employeeID, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var task *rpcv1.Task
	var announcementID dbuuid.UUID
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		task, announcementID, txErr = s.Logic.CreateTaskFromMessage(ctx, tx, organizationID, employeeID, req.Msg)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create task from message", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.CreateTaskFromMessageResponse{
		Task:                  task,
		AnnouncementMessageId: announcementID.String(),
	}), nil
}

// ListTasksBySourceMessages resolves the chips for a whole rendered page of messages in
// one call. The repeated request field is the contract-level N+1 guard: a client that
// called this per message would be visibly misusing the shape.
func (s *CollaborationServiceConnect) ListTasksBySourceMessages(
	ctx context.Context,
	req *connect.Request[rpcv1.ListTasksBySourceMessagesRequest],
) (*connect.Response[rpcv1.ListTasksBySourceMessagesResponse], error) {
	employeeID, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}

	var links []*rpcv1.MessageTaskLink
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		links, txErr = s.Logic.ListTasksBySourceMessages(ctx, tx, organizationID, employeeID, req.Msg.GetMessageIds())
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to list tasks by source messages", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.ListTasksBySourceMessagesResponse{Links: links}), nil
}

// GetTaskOrigin resolves the origin block on a task created from a message. It is a
// separate call from GetTask so the ordinary task read stays a single-domain query; the
// client makes it only when the task carries a source message id.
func (s *CollaborationServiceConnect) GetTaskOrigin(
	ctx context.Context,
	req *connect.Request[rpcv1.GetTaskOriginRequest],
) (*connect.Response[rpcv1.GetTaskOriginResponse], error) {
	employeeID, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}
	taskID, err := parseUUID(req.Msg.GetTaskId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, ErrTaskNotFound)
	}

	var origin *rpcv1.GetTaskOriginResponse
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		origin, txErr = s.Logic.GetTaskOrigin(ctx, tx, organizationID, employeeID, taskID)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to get task origin", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(origin), nil
}

// GetChannelTaskDestination reports where this channel's tasks go, resolved against what
// the caller can actually use.
func (s *CollaborationServiceConnect) GetChannelTaskDestination(
	ctx context.Context,
	req *connect.Request[rpcv1.GetChannelTaskDestinationRequest],
) (*connect.Response[rpcv1.GetChannelTaskDestinationResponse], error) {
	employeeID, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}
	channelID, err := parseUUID(req.Msg.GetChannelId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	var dest *rpcv1.GetChannelTaskDestinationResponse
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		dest, txErr = s.Logic.GetChannelTaskDestination(ctx, tx, organizationID, employeeID, channelID)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to get channel task destination", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(dest), nil
}

// SetChannelTaskDestination changes or clears a channel's remembered destination. An
// absent project id clears it. Requires the caller to administer the channel, checked in
// the logic layer above the interceptor's permission check.
func (s *CollaborationServiceConnect) SetChannelTaskDestination(
	ctx context.Context,
	req *connect.Request[rpcv1.SetChannelTaskDestinationRequest],
) (*connect.Response[rpcv1.SetChannelTaskDestinationResponse], error) {
	employeeID, organizationID, err := extractAuthContext(ctx)
	if err != nil {
		return nil, err
	}
	channelID, err := parseUUID(req.Msg.GetChannelId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	var dest *rpcv1.GetChannelTaskDestinationResponse
	err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
		var txErr error
		dest, txErr = s.Logic.SetChannelTaskDestination(ctx, tx, organizationID, employeeID, channelID, req.Msg.ProjectId)
		return txErr
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to set channel task destination", "error", err)
		return nil, handleError(err)
	}

	return connect.NewResponse(&rpcv1.SetChannelTaskDestinationResponse{Destination: dest}), nil
}
