package collaboration

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
)

// Common errors for collaboration operations
var (
	ErrProjectNotFound          = errors.New("project not found")
	ErrTaskNotFound             = errors.New("task not found")
	ErrStateNotFound            = errors.New("project state not found")
	ErrLevelNotFound            = errors.New("task level not found")
	ErrCustomFieldNotFound      = errors.New("custom field not found")
	ErrWorkflowRuleNotFound     = errors.New("workflow rule not found")
	ErrSavedViewNotFound        = errors.New("saved view not found")
	ErrInvalidViewType          = errors.New("invalid view type")
	ErrInvalidTriggerType       = errors.New("invalid workflow trigger type")
	ErrInvalidActionType        = errors.New("invalid workflow action type")
	ErrAccessDenied             = errors.New("access denied")
	ErrInvalidParent            = errors.New("invalid parent task")
	ErrMaxDepthExceeded         = errors.New("maximum task depth exceeded")
	ErrMembershipNotFound       = errors.New("project membership not found")
	ErrDuplicateMembership      = errors.New("employee is already a project member")
	ErrCannotDeleteWithTasks    = errors.New("cannot delete state/level with associated tasks")
	ErrInvalidFieldValue        = errors.New("invalid custom field value")
	ErrProjectKeyExists         = errors.New("project key already exists")
	ErrInvalidAssigneeRole      = errors.New("invalid assignee role")
	ErrInvalidFieldType         = errors.New("invalid custom field type")
	ErrCustomFieldValueNotFound = errors.New("custom field value not found")
	ErrInvalidMemberRole        = errors.New("invalid project member role")
	ErrMemberNotFound           = errors.New("project member not found")
	ErrLastOwner                = errors.New("cannot remove last project owner")
)

// ChatLogic defines the interface for chat operations needed by collaboration
// Used to create task comment channels (channel_type=project_ticket_thread)
type ChatLogic interface {
	// CreateChannel creates a new chat channel for task comments
	CreateChannel(ctx context.Context, tx database.DBTX, orgID, creatorID dbuuid.UUID, req *rpcv1.CreateChannelRequest) (*rpcv1.Channel, error)
}

// DocsLogic defines the interface for docs operations needed by collaboration
// Used to create task description documents
type DocsLogic interface {
	// CreateDocument creates a new document for task description
	CreateDocument(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.CreateDocumentRequest) (*rpcv1.Document, error)
}

// NotificationPublisher defines the interface for publishing notifications
// Used to notify watchers of task updates
type NotificationPublisher interface {
	// PublishNotification publishes a notification to specified recipients
	PublishNotification(ctx context.Context, tx database.DBTX, req *rpcv1.PublishNotificationRequest) (*rpcv1.PublishNotificationResponse, error)
}

// Logic defines the business logic interface for collaboration operations.
// This layer is pool-agnostic and receives transactions from the Connect layer.
type Logic interface {
	// Project CRUD
	CreateProject(ctx context.Context, tx database.DBTX, orgID, creatorID dbuuid.UUID, req *rpcv1.CreateProjectRequest) (*rpcv1.Project, []*rpcv1.ProjectState, []*rpcv1.TaskLevel, error)
	GetProject(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, projectID dbuuid.UUID) (*rpcv1.Project, []*rpcv1.ProjectState, []*rpcv1.TaskLevel, rpcv1.ProjectMemberRole, error)
	UpdateProject(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.UpdateProjectRequest) (*rpcv1.Project, error)
	ListProjects(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, includeArchived bool, cursor dbuuid.NullUUID, limit int32) ([]*rpcv1.Project, error)
	ArchiveProject(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, projectID dbuuid.UUID, archive bool) (*rpcv1.Project, error)

	// Project State CRUD
	CreateProjectState(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, req *rpcv1.CreateProjectStateRequest) (*rpcv1.ProjectState, error)
	UpdateProjectState(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, req *rpcv1.UpdateProjectStateRequest) (*rpcv1.ProjectState, error)
	DeleteProjectState(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, stateID, migrateToStateID dbuuid.UUID) error
	ReorderProjectStates(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, projectID dbuuid.UUID, stateIDs []dbuuid.UUID) error
	ListProjectStates(ctx context.Context, tx database.DBTX, orgID, projectID dbuuid.UUID) ([]*rpcv1.ProjectState, error)

	// Task Level CRUD
	CreateTaskLevel(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, req *rpcv1.CreateTaskLevelRequest) (*rpcv1.TaskLevel, error)
	UpdateTaskLevel(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, req *rpcv1.UpdateTaskLevelRequest) (*rpcv1.TaskLevel, error)
	DeleteTaskLevel(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, levelID, migrateToLevelID dbuuid.UUID) error
	ListTaskLevels(ctx context.Context, tx database.DBTX, orgID, projectID dbuuid.UUID) ([]*rpcv1.TaskLevel, error)

	// Task CRUD
	CreateTask(ctx context.Context, tx database.DBTX, orgID, reporterID dbuuid.UUID, req *rpcv1.CreateTaskRequest) (*rpcv1.Task, error)
	GetTask(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, taskID dbuuid.UUID, includeCustomFields bool) (*rpcv1.Task, []*rpcv1.TaskWatcher, error)
	GetTaskByIdentifier(ctx context.Context, tx database.DBTX, orgID, projectID dbuuid.UUID, identifier string) (*rpcv1.Task, error)
	UpdateTask(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.UpdateTaskRequest) (*rpcv1.Task, []*rpcv1.WorkflowRuleExecution, error)
	DeleteTask(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, taskID dbuuid.UUID, deleteChildren bool) (int32, error)
	ListTasks(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, req *rpcv1.ListTasksRequest) ([]*rpcv1.Task, error)
	GetAssignedWorkSummary(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.GetAssignedWorkSummaryRequest) (*rpcv1.GetAssignedWorkSummaryResponse, error)
	MoveTask(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, taskID, newStateID dbuuid.UUID) (*rpcv1.Task, []*rpcv1.WorkflowRuleExecution, error)

	// Task Assignment
	AssignTask(ctx context.Context, tx database.DBTX, orgID, assignerID dbuuid.UUID, taskID, employeeID dbuuid.UUID, role string) (*rpcv1.TaskAssignee, error)
	UnassignTask(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, taskID, employeeID dbuuid.UUID, role string) error
	WatchTask(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, taskID, employeeID dbuuid.UUID) (*rpcv1.TaskWatcher, error)
	UnwatchTask(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, taskID, employeeID dbuuid.UUID) error

	// Custom Field CRUD
	CreateCustomField(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, req *rpcv1.CreateCustomFieldRequest) (*rpcv1.CustomFieldDefinition, error)
	UpdateCustomField(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, req *rpcv1.UpdateCustomFieldRequest) (*rpcv1.CustomFieldDefinition, error)
	ArchiveCustomField(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, fieldID dbuuid.UUID, archive bool) (*rpcv1.CustomFieldDefinition, error)
	ListCustomFields(ctx context.Context, tx database.DBTX, orgID, projectID dbuuid.UUID, includeArchived bool) ([]*rpcv1.CustomFieldDefinition, error)
	SetCustomFieldValue(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, taskID, fieldID dbuuid.UUID, value string) (*rpcv1.CustomFieldValue, error)

	// Workflow Rules
	CreateWorkflowRule(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, req *rpcv1.CreateWorkflowRuleRequest) (*rpcv1.WorkflowRule, error)
	UpdateWorkflowRule(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, req *rpcv1.UpdateWorkflowRuleRequest) (*rpcv1.WorkflowRule, error)
	DeleteWorkflowRule(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, ruleID dbuuid.UUID) error
	ListWorkflowRules(ctx context.Context, tx database.DBTX, orgID, projectID dbuuid.UUID, includeDisabled bool) ([]*rpcv1.WorkflowRule, error)
	ExecuteRulesForStateTrigger(ctx context.Context, tx database.DBTX, orgID, projectID, stateID, taskID, triggeredByID dbuuid.UUID) ([]*rpcv1.WorkflowRuleExecution, error)

	// Project Membership
	AddProjectMember(ctx context.Context, tx database.DBTX, orgID, inviterID dbuuid.UUID, projectID, employeeID dbuuid.UUID, role string) (*rpcv1.ProjectMember, error)
	RemoveProjectMember(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, projectID, employeeID dbuuid.UUID) error
	UpdateProjectMemberRole(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, projectID, employeeID dbuuid.UUID, role string) (*rpcv1.ProjectMember, error)
	ListProjectMembers(ctx context.Context, tx database.DBTX, orgID, projectID dbuuid.UUID) ([]*rpcv1.ProjectMember, error)
	GetProjectMemberRole(ctx context.Context, tx database.DBTX, orgID, projectID, employeeID dbuuid.UUID) (string, error)
	CheckProjectAccess(ctx context.Context, tx database.DBTX, orgID, projectID, employeeID dbuuid.UUID, requiredRoles []string) (bool, error)

	// Saved Views
	CreateSavedView(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.CreateSavedViewRequest) (*rpcv1.SavedView, error)
	UpdateSavedView(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.UpdateSavedViewRequest) (*rpcv1.SavedView, error)
	DeleteSavedView(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, viewID dbuuid.UUID) error
	ListSavedViews(ctx context.Context, tx database.DBTX, orgID, projectID, employeeID dbuuid.UUID) ([]*rpcv1.SavedView, error)

	// Analytics
	GetTaskAnalytics(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, req *rpcv1.GetTaskAnalyticsRequest) (*rpcv1.GetTaskAnalyticsResponse, error)
	ExportTasksCSV(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, req *rpcv1.ExportTasksCSVRequest) ([]byte, error)
	GetMixedOverviewSummary(ctx context.Context, tx database.DBTX, orgID, projectID dbuuid.UUID) (*MixedOverviewSummary, error)
	GetRitualWorklist(ctx context.Context, tx database.DBTX, orgID, projectID dbuuid.UUID) (*RitualWorklistData, error)

	// Ritual Definition CRUD
	CreateRitualDefinition(ctx context.Context, tx database.DBTX, orgID, creatorID dbuuid.UUID, req *rpcv1.CreateRitualDefinitionRequest) (*rpcv1.RitualDefinition, error)
	GetRitualDefinition(ctx context.Context, tx database.DBTX, orgID, defID dbuuid.UUID) (*rpcv1.RitualDefinition, error)
	UpdateRitualDefinition(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, defID dbuuid.UUID, req *rpcv1.UpdateRitualDefinitionRequest) (*rpcv1.RitualDefinition, error)
	ArchiveRitualDefinition(ctx context.Context, tx database.DBTX, orgID, defID dbuuid.UUID, archive bool) (*rpcv1.RitualDefinition, error)
	ListRitualDefinitions(ctx context.Context, tx database.DBTX, orgID, projectID dbuuid.UUID, includeArchived bool) ([]*rpcv1.RitualDefinition, error)

	// Evidence Requirements
	CreateEvidenceRequirement(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, req *rpcv1.CreateEvidenceRequirementRequest) (*rpcv1.EvidenceRequirementDetail, error)
	UpdateEvidenceRequirement(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, req *rpcv1.UpdateEvidenceRequirementRequest) (*rpcv1.EvidenceRequirementDetail, error)
	DeleteEvidenceRequirement(ctx context.Context, tx database.DBTX, orgID, reqID dbuuid.UUID) error
	ListEvidenceRequirements(ctx context.Context, tx database.DBTX, orgID, defID dbuuid.UUID) ([]*rpcv1.EvidenceRequirementDetail, error)

	// Evidence Submissions
	SubmitEvidence(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.SubmitEvidenceRequest) (*rpcv1.EvidenceSubmission, error)
	ApproveEvidence(ctx context.Context, tx database.DBTX, orgID, reviewerID dbuuid.UUID, req *rpcv1.ApproveEvidenceRequest) (*rpcv1.EvidenceSubmission, error)
	RejectEvidence(ctx context.Context, tx database.DBTX, orgID, reviewerID dbuuid.UUID, req *rpcv1.RejectEvidenceRequest) (*rpcv1.EvidenceSubmission, error)
	ListEvidenceSubmissions(ctx context.Context, tx database.DBTX, orgID, taskID dbuuid.UUID) ([]*rpcv1.EvidenceSubmission, error)

	// Ritual Scheduler
	GenerateRitualInstances(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, now time.Time) (int, error)

	// Operational Health
	GetOperationalHealth(ctx context.Context, tx database.DBTX, orgID, projectID dbuuid.UUID, startDate, endDate pgtype.Date) (*rpcv1.GetOperationalHealthResponse, error)
	GetRitualComplianceSummary(ctx context.Context, tx database.DBTX, orgID, projectID dbuuid.UUID, startDate, endDate pgtype.Date) (*rpcv1.GetRitualComplianceSummaryResponse, error)
	ExportRitualComplianceCSV(ctx context.Context, tx database.DBTX, orgID, projectID dbuuid.UUID, startDate, endDate pgtype.Date) ([]byte, error)

	// Skip Ritual Instance
	SkipRitualInstance(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.SkipRitualInstanceRequest) (*rpcv1.Task, error)

	// Lazy Resource Creation
	EnsureTaskResources(ctx context.Context, tx database.DBTX, orgID, employeeID, taskID dbuuid.UUID) (*rpcv1.Task, []*rpcv1.TaskWatcher, error)

	// Ritual Schedule Change
	GetScheduleChangeImpact(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.GetScheduleChangeImpactRequest) (*rpcv1.GetScheduleChangeImpactResponse, error)
	ChangeRitualDefinitionSchedule(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.ChangeRitualDefinitionScheduleRequest) (*rpcv1.ChangeRitualDefinitionScheduleResponse, error)

	// Calendar Overlay Readers — used by the calendar service to render overlay items.
	GetTasksDueInRange(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, from, to time.Time) ([]*rpcv1.OverlayItem, error)
	GetRitualInstancesInRange(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, from, to time.Time) ([]*rpcv1.OverlayItem, error)
}

// logicImpl implements the Logic interface
type logicImpl struct {
	Queries               *database.Queries
	ChatLogic             ChatLogic
	DocsLogic             DocsLogic
	NotificationPublisher NotificationPublisher
}

// NewLogic creates a new collaboration logic layer implementation
func NewLogic(
	queries *database.Queries,
	chatLogic ChatLogic,
	docsLogic DocsLogic,
	notificationPublisher NotificationPublisher,
) Logic {
	return &logicImpl{
		Queries:               queries,
		ChatLogic:             chatLogic,
		DocsLogic:             docsLogic,
		NotificationPublisher: notificationPublisher,
	}
}

// MaxTaskDepth defines the maximum nesting level for tasks (0-5)
const MaxTaskDepth = 5

// canModifyRole checks if a role can modify another role (role hierarchy)
// owner > admin > member > viewer
func canModifyRole(actorRole, targetRole string) bool {
	roleHierarchy := map[string]int{
		ProjectMemberRoleOwner:  4,
		ProjectMemberRoleAdmin:  3,
		ProjectMemberRoleMember: 2,
		ProjectMemberRoleViewer: 1,
	}

	actorLevel := roleHierarchy[actorRole]
	targetLevel := roleHierarchy[targetRole]

	// Actor must have higher level to modify target
	return actorLevel > targetLevel
}

// hasRolePermission checks if role has required permission
func hasRolePermission(role string, requiredRoles []string) bool {
	for _, required := range requiredRoles {
		if role == required {
			return true
		}
	}
	return false
}
