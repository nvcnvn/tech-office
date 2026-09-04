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
	ErrProjectNotFound       = errors.New("project not found")
	ErrTaskNotFound          = errors.New("task not found")
	ErrStateNotFound         = errors.New("project state not found")
	ErrLevelNotFound         = errors.New("task level not found")
	ErrCustomFieldNotFound   = errors.New("custom field not found")
	ErrWorkflowRuleNotFound  = errors.New("workflow rule not found")
	ErrSavedViewNotFound     = errors.New("saved view not found")
	ErrInvalidViewType       = errors.New("invalid view type")
	ErrInvalidTriggerType    = errors.New("invalid workflow trigger type")
	ErrInvalidActionType     = errors.New("invalid workflow action type")
	ErrAccessDenied          = errors.New("access denied")
	ErrInvalidParent         = errors.New("invalid parent task")
	ErrMaxDepthExceeded      = errors.New("maximum task depth exceeded")
	ErrMembershipNotFound    = errors.New("project membership not found")
	ErrDuplicateMembership   = errors.New("employee is already a project member")
	ErrCannotDeleteWithTasks = errors.New("cannot delete state/level with associated tasks")
	ErrInvalidFieldValue     = errors.New("invalid custom field value")
	// ErrProjectKeyTaken is a unique_project_key violation: another project in this
	// organization already uses the key. The key is permanent, so this is a refusal the
	// person has to resolve before saving, not something to auto-correct on their behalf.
	ErrProjectKeyTaken = errors.New("a project with this key already exists")
	// ErrProjectKeyInvalid is a valid_project_key CHECK violation. Both clients validate
	// first, so reaching this means a caller bypassed them — it still gets a field-named
	// answer rather than an Internal.
	ErrProjectKeyInvalid = errors.New(
		"project key must be 1-10 characters, starting with a letter, then letters, numbers or underscores")
	ErrInvalidAssigneeRole      = errors.New("invalid assignee role")
	ErrInvalidFieldType         = errors.New("invalid custom field type")
	ErrCustomFieldValueNotFound = errors.New("custom field value not found")
	ErrInvalidMemberRole        = errors.New("invalid project member role")
	ErrMemberNotFound           = errors.New("project member not found")
	ErrLastOwner                = errors.New("cannot remove last project owner")
)

// ChatLogic defines the interface for chat operations needed by collaboration.
//
// The dependency runs one way only: collaboration calls chat, never the reverse. Every
// method here is satisfied structurally by chatLogicImpl, and none of them tells chat
// anything about tasks beyond the strings it is asked to store.
type ChatLogic interface {
	// CreateChannel creates a new chat channel for task comments
	// (channel_type=project_ticket_thread).
	CreateChannel(ctx context.Context, tx database.DBTX, orgID, creatorID dbuuid.UUID, req *rpcv1.CreateChannelRequest) (*rpcv1.Channel, error)

	// GetChannel resolves the channel name shown in a task's origin block, and the
	// caller's channel membership — including whether they administer the channel, which
	// is what gates changing the channel's remembered task destination.
	GetChannel(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, channelID dbuuid.UUID) (*rpcv1.Channel, *rpcv1.LinkedResource, error)

	// GetMessage resolves the author and excerpt shown in a task's origin block.
	// Already implemented on chatLogicImpl and already used this way by internal/compliance.
	GetMessage(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, messageID dbuuid.UUID) (*rpcv1.Message, error)

	// AnnounceTaskCreatedFromMessage posts the threaded system reply that records a
	// message having been turned into a task. It notifies nobody, and it runs on the
	// caller's transaction so the announcement commits with the task or not at all.
	AnnounceTaskCreatedFromMessage(ctx context.Context, tx database.DBTX, orgID, actorID, channelID, sourceMessageID, taskID dbuuid.UUID, identifier, title string) (dbuuid.UUID, error)
}

// DocsLogic defines the interface for docs operations needed by collaboration
// Used to create task description documents
type DocsLogic interface {
	// CreateDocument creates a new document for task description
	CreateDocument(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.CreateDocumentRequest, documentType string) (*rpcv1.Document, error)

	// GetDocument reads one document by id WITHOUT applying the caller's per-document
	// access grants. That is deliberate and is the whole mechanism behind a ritual
	// procedure: a worker who can see a ritual instance may read the document attached to
	// its definition even with no row in docs.document_access. The access decision is made
	// on the collaboration side (can this caller see the definition's project), and never
	// becomes a grant row, so it cannot leak the document into the reader's tree, search
	// results, followed-document list, comments, versions or reactions.
	//
	// Callers MUST make their own authorization decision before calling this.
	GetDocument(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, docID dbuuid.UUID) (*rpcv1.Document, error)

	// CheckAccess answers the question GetDocument deliberately does not: may
	// THIS employee read this document with their own docs access? It is used on the
	// write side only — attaching a procedure must be refused when the manager could not
	// open the document themselves (FR-007), because the attachment grants sight of it to
	// everyone who can see the ritual. Without this check a manager could hand out a
	// document they were never allowed to read.
	//
	// It is deliberately NOT used on the read side: a worker reading a procedure has no
	// grant of their own, and requiring one would defeat the feature.
	CheckAccess(ctx context.Context, tx database.DBTX, orgID, employeeID, docID dbuuid.UUID) (rpcv1.AccessLevel, bool, error)
}

// NotificationPublisher defines the interface for publishing notifications
// Used to notify watchers of task updates
type NotificationPublisher interface {
	// PublishNotification publishes a notification to specified recipients
	PublishNotification(ctx context.Context, tx database.DBTX, req *rpcv1.PublishNotificationRequest) (*rpcv1.PublishNotificationResponse, error)
}

// ShiftCoverageReader answers "which of these employees is working during this
// interval", from shift events on the calendar. Declared here and implemented by
// calendar.Logic so that collaboration never imports calendar: the tier ordering in
// backend/docs/SYSTEM-ARCHITECTURE.md puts collaboration below calendar, and the
// calendar already depends on this package for overlay items.
//
// The interval is a half-open [dayStart, dayEnd) pair of UTC instants, already resolved
// from the ritual definition's own timezone by the caller. Keeping the timezone on this
// side is what lets a ritual in Asia/Tokyo and a shift stored in UTC agree without
// either domain learning the other's rules.
//
// A nil reader is a supported state, not a bug: seed and test harnesses construct
// collaboration logic without a calendar. Callers treat nil exactly as they treat an
// error — the slot is left awaiting shift resolution and nothing is guessed.
type ShiftCoverageReader interface {
	EmployeesOnShift(
		ctx context.Context,
		tx database.DBTX,
		orgID dbuuid.UUID,
		candidateEmployeeIDs []dbuuid.UUID,
		dayStart, dayEnd time.Time,
	) ([]dbuuid.UUID, error)
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

	// Tasks created from chat messages. Returns the task and the id of the threaded
	// announcement left on the source message.
	CreateTaskFromMessage(ctx context.Context, tx database.DBTX, orgID, actorID dbuuid.UUID, req *rpcv1.CreateTaskFromMessageRequest) (*rpcv1.Task, dbuuid.UUID, error)

	// ListTasksBySourceMessages resolves the chips a page of chat messages carries, in
	// one call. Links to tasks in projects the caller cannot see are omitted.
	ListTasksBySourceMessages(ctx context.Context, tx database.DBTX, orgID, actorID dbuuid.UUID, messageIDs []string) ([]*rpcv1.MessageTaskLink, error)

	// GetTaskOrigin resolves the human-readable origin block on a task created from a
	// message: channel name, message author and excerpt.
	GetTaskOrigin(ctx context.Context, tx database.DBTX, orgID, actorID dbuuid.UUID, taskID dbuuid.UUID) (*rpcv1.GetTaskOriginResponse, error)

	// The project a channel's tasks default to. Set by the first conversion in the
	// channel, changed or cleared only by a channel administrator.
	GetChannelTaskDestination(ctx context.Context, tx database.DBTX, orgID, actorID dbuuid.UUID, channelID dbuuid.UUID) (*rpcv1.GetChannelTaskDestinationResponse, error)
	SetChannelTaskDestination(ctx context.Context, tx database.DBTX, orgID, actorID dbuuid.UUID, channelID dbuuid.UUID, projectID *string) (*rpcv1.GetChannelTaskDestinationResponse, error)
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
	// employeeID is the authenticated caller, NOT the definition id — the definition is
	// named by req.RitualDefinitionId. Before feature 043 the connect layer passed the
	// definition id into this slot and the logic ignored it, so UpdateRitualDefinition
	// performed no project owner/admin check at all while CreateRitualDefinition did.
	UpdateRitualDefinition(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, req *rpcv1.UpdateRitualDefinitionRequest) (*rpcv1.RitualDefinition, error)
	ArchiveRitualDefinition(ctx context.Context, tx database.DBTX, orgID, defID dbuuid.UUID, archive bool) (*rpcv1.RitualDefinition, error)
	ListRitualDefinitions(ctx context.Context, tx database.DBTX, orgID, projectID dbuuid.UUID, includeArchived bool) ([]*rpcv1.RitualDefinition, error)

	// GetRitualProcedure resolves the workspace document attached to a ritual definition
	// and returns it with its current content, for read-only rendering next to an
	// instance. The resource check is "can this caller see the definition's project",
	// with no required role — the same bar as seeing the instance.
	GetRitualProcedure(ctx context.Context, tx database.DBTX, orgID, employeeID dbuuid.UUID, defID dbuuid.UUID) (*rpcv1.RitualProcedure, string, error)

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

	// Evidence Review Queue
	//
	// Both take the reviewer's employee id because reviewer scope — non-`viewer`
	// membership on the submission's project — is evaluated inside the query, so the
	// queue and the decision actions cannot disagree about who may decide what.
	// Neither checks the `collab.reviewEvidence` permission: that lives at the Connect
	// layer, which returns an empty page rather than an error when it is absent.
	ListEvidenceReviewQueue(ctx context.Context, tx database.DBTX, orgID, reviewerID dbuuid.UUID, req *rpcv1.ListEvidenceReviewQueueRequest) ([]*rpcv1.ReviewQueueEntry, string, error)
	GetEvidenceReviewQueueCount(ctx context.Context, tx database.DBTX, orgID, reviewerID dbuuid.UUID, req *rpcv1.GetEvidenceReviewQueueCountRequest) (int32, bool, error)

	// SetShiftCoverageReader injects the calendar's shift coverage read. It is a setter
	// rather than a NewLogic parameter because cmd/server.go constructs collaboration
	// before calendar — calendar.NewLogic takes collaborationLogic — so a constructor
	// argument would be a cycle. A nil reader is supported and means on-shift pools
	// resolve to awaiting_shift and nothing is guessed.
	SetShiftCoverageReader(reader ShiftCoverageReader)

	// Ritual Scheduler
	GenerateRitualInstances(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, now time.Time) (int, error)

	// Ritual Reconciliation
	// ReconcileOverdueRitualInstances applies the lateness rules to one organization's
	// late ritual instances and returns what it changed. It is safe to call repeatedly:
	// an instance already in its target state is neither rewritten nor re-notified.
	ReconcileOverdueRitualInstances(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, now time.Time) (RitualReconciliationCounts, error)

	// Ritual Shift Resolution
	// ResolveRitualShiftAssignments runs one organization's on-shift resolution pass:
	// it binds slots that were waiting for a rota, follows shift swaps, withdraws
	// assignments whose cover disappeared, and escalates slots whose scheduled date
	// arrived with nobody rostered. Safe to call repeatedly: every write is a
	// compare-and-set, so overlapping passes assign once and notify once.
	ResolveRitualShiftAssignments(ctx context.Context, tx database.DBTX, orgID dbuuid.UUID, now time.Time) (RitualShiftResolutionCounts, error)

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

	// shiftCoverage is injected after construction; see SetShiftCoverageReader. Nil
	// until wired, and legitimately nil in the seeder and in tests that never touch an
	// on-shift pool.
	shiftCoverage ShiftCoverageReader
}

// SetShiftCoverageReader implements Logic.
func (l *logicImpl) SetShiftCoverageReader(reader ShiftCoverageReader) {
	l.shiftCoverage = reader
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
