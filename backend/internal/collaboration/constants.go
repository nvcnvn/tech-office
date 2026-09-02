// Package collaboration defines task collaboration service constants.
// All constant values MUST align with:
// - Database CHECK constraints in backend/database/scripts/schema.sql
// - Proto enums in backend/rpc/v1/collaboration.proto
// - Frontend TypeScript types in packages/apis/src/collaboration.ts
//
// When adding/removing values:
// 1. Update database CHECK constraint in backend/database/scripts/schema.sql
// 2. Update these Go constants
// 3. Update proto enums in backend/rpc/v1/collaboration.proto
// 4. Update frontend TypeScript types
// 5. Submit all changes in single PR with alignment verification
package collaboration

import (
	"errors"

	"github.com/nvcnvn/tech-office/backend/internal/notification"
)

// Re-export source domain constant for collaboration service.
const SourceDomain = notification.SourceDomainProjects

// Re-export task notification type constants for use within collaboration service.
const (
	NotificationTypeTaskAssigned            = notification.NotificationTypeTaskAssigned
	NotificationTypeTaskStatusChanged       = notification.NotificationTypeTaskStatusChanged
	NotificationTypeTaskCommented           = notification.NotificationTypeTaskCommented
	NotificationTypeTaskMentioned           = notification.NotificationTypeTaskMentioned
	NotificationTypeTaskDescriptionModified = notification.NotificationTypeTaskDescriptionModified
	NotificationTypeTaskUpdated             = notification.NotificationTypeTaskUpdated
)

// ProjectVisibility defines allowed project visibility values.
// These MUST match the database CHECK constraint in collaboration.project table.
const (
	ProjectVisibilityPublic  = "public"
	ProjectVisibilityPrivate = "private"
)

// IsValidProjectVisibility checks if a visibility string is valid.
func IsValidProjectVisibility(visibility string) bool {
	switch visibility {
	case ProjectVisibilityPublic, ProjectVisibilityPrivate:
		return true
	default:
		return false
	}
}

// StateCategory defines allowed state category values.
// These MUST match the database CHECK constraint in collaboration.project_state table.
const (
	StateCategoryTodo       = "todo"
	StateCategoryInProgress = "in_progress"
	StateCategoryDone       = "done"
	StateCategoryCancelled  = "cancelled"
	StateCategoryScheduled  = "scheduled"
	StateCategorySubmitted  = "submitted"
	StateCategoryVerified   = "verified"
	StateCategoryOverdue    = "overdue"
	StateCategoryMissed     = "missed"
	StateCategorySkipped    = "skipped"
)

// StateType defines allowed state type values for swim lane separation.
// These MUST match the database CHECK constraint in collaboration.project_state table.
const (
	StateTypeStandard = "standard"
	StateTypeRitual   = "ritual"
)

// IsValidStateCategory checks if a category string is valid.
func IsValidStateCategory(category string) bool {
	switch category {
	case StateCategoryTodo, StateCategoryInProgress, StateCategoryDone, StateCategoryCancelled,
		StateCategoryScheduled, StateCategorySubmitted, StateCategoryVerified,
		StateCategoryOverdue, StateCategoryMissed, StateCategorySkipped:
		return true
	default:
		return false
	}
}

// CustomFieldType defines allowed custom field type values.
// These MUST match the database CHECK constraint in collaboration.custom_field_definition table.
const (
	CustomFieldTypeText         = "text"
	CustomFieldTypeNumber       = "number"
	CustomFieldTypeSingleSelect = "single_select"
	CustomFieldTypeMultiSelect  = "multi_select"
	CustomFieldTypeDate         = "date"
	CustomFieldTypeUser         = "user"
	CustomFieldTypeCheckbox     = "checkbox"
)

// IsValidCustomFieldType checks if a field type string is valid.
func IsValidCustomFieldType(fieldType string) bool {
	switch fieldType {
	case CustomFieldTypeText, CustomFieldTypeNumber, CustomFieldTypeSingleSelect,
		CustomFieldTypeMultiSelect, CustomFieldTypeDate, CustomFieldTypeUser, CustomFieldTypeCheckbox:
		return true
	default:
		return false
	}
}

// WorkflowTriggerType defines allowed workflow trigger type values.
// These MUST match the database CHECK constraint in collaboration.workflow_rule table.
const (
	WorkflowTriggerTypeStateEntered = "state_entered"
	WorkflowTriggerTypeStateExited  = "state_exited"
	WorkflowTriggerTypeFieldChanged = "field_changed"
	WorkflowTriggerTypeTaskCreated  = "task_created"
)

// IsValidWorkflowTriggerType checks if a trigger type string is valid.
func IsValidWorkflowTriggerType(triggerType string) bool {
	switch triggerType {
	case WorkflowTriggerTypeStateEntered, WorkflowTriggerTypeStateExited,
		WorkflowTriggerTypeFieldChanged, WorkflowTriggerTypeTaskCreated:
		return true
	default:
		return false
	}
}

// WorkflowActionType defines allowed workflow action type values.
// These MUST match the database CHECK constraint in collaboration.workflow_rule table.
const (
	WorkflowActionTypeSetState   = "set_state"
	WorkflowActionTypeSetField   = "set_field"
	WorkflowActionTypeAssignUser = "assign_user"
	WorkflowActionTypeNotify     = "notify"
	WorkflowActionTypeCloseTask  = "close_task"
)

// IsValidWorkflowActionType checks if an action type string is valid.
func IsValidWorkflowActionType(actionType string) bool {
	switch actionType {
	case WorkflowActionTypeSetState, WorkflowActionTypeSetField,
		WorkflowActionTypeAssignUser, WorkflowActionTypeNotify, WorkflowActionTypeCloseTask:
		return true
	default:
		return false
	}
}

// ProjectMemberRole defines allowed project member role values.
// These MUST match the database CHECK constraint in collaboration.project_membership table.
const (
	ProjectMemberRoleOwner  = "owner"
	ProjectMemberRoleAdmin  = "admin"
	ProjectMemberRoleMember = "member"
	ProjectMemberRoleViewer = "viewer"
)

// IsValidProjectMemberRole checks if a role string is valid.
func IsValidProjectMemberRole(role string) bool {
	switch role {
	case ProjectMemberRoleOwner, ProjectMemberRoleAdmin, ProjectMemberRoleMember, ProjectMemberRoleViewer:
		return true
	default:
		return false
	}
}

// TaskAssigneeRole defines allowed task assignee role values.
// These MUST match the database CHECK constraint in collaboration.task_assignee table.
const (
	TaskAssigneeRoleAssignee = "assignee"
	TaskAssigneeRoleReviewer = "reviewer"
	TaskAssigneeRoleApprover = "approver"
)

// IsValidTaskAssigneeRole checks if an assignee role string is valid.
func IsValidTaskAssigneeRole(role string) bool {
	switch role {
	case TaskAssigneeRoleAssignee, TaskAssigneeRoleReviewer, TaskAssigneeRoleApprover:
		return true
	default:
		return false
	}
}

// ViewType defines allowed saved view type values.
// These MUST match the database CHECK constraint in collaboration.saved_view table.
const (
	ViewTypeBoard    = "board"
	ViewTypeList     = "list"
	ViewTypeGantt    = "gantt"
	ViewTypeCalendar = "calendar"
	ViewTypeToday    = "today"
	ViewTypeHealth   = "health"
)

// IsValidViewType checks if a view type string is valid.
func IsValidViewType(viewType string) bool {
	switch viewType {
	case ViewTypeBoard, ViewTypeList, ViewTypeGantt, ViewTypeCalendar, ViewTypeToday, ViewTypeHealth:
		return true
	default:
		return false
	}
}

// TaskWatchReason defines allowed task watcher reason values used in the TaskWatcher proto.
// Mapped to/from V2 notification.resource_subscription_reason.reason_type.
const (
	TaskWatchReasonManual    = "manual"
	TaskWatchReasonMentioned = "mentioned"
	TaskWatchReasonAssigned  = "assigned"
	TaskWatchReasonReporter  = "reporter"
	TaskWatchReasonCommented = "commented"
)

// IsValidTaskWatchReason checks if a watch reason string is valid.
func IsValidTaskWatchReason(reason string) bool {
	switch reason {
	case TaskWatchReasonManual, TaskWatchReasonMentioned, TaskWatchReasonAssigned,
		TaskWatchReasonReporter, TaskWatchReasonCommented:
		return true
	default:
		return false
	}
}

// NotificationPreference defines allowed project notification preference values.
// These MUST match the database CHECK constraint in collaboration.project_membership table.
const (
	NotificationPreferenceAll      = "all"
	NotificationPreferenceMentions = "mentions"
	NotificationPreferenceAssigned = "assigned"
	NotificationPreferenceMuted    = "muted"
)

// IsValidNotificationPreference checks if a notification preference string is valid.
func IsValidNotificationPreference(pref string) bool {
	switch pref {
	case NotificationPreferenceAll, NotificationPreferenceMentions,
		NotificationPreferenceAssigned, NotificationPreferenceMuted:
		return true
	default:
		return false
	}
}

// WorkflowRuleExecutionStatus defines allowed rule execution status values.
// These MUST match the database CHECK constraint in collaboration.workflow_rule_execution table.
const (
	WorkflowRuleExecutionStatusSuccess = "success"
	WorkflowRuleExecutionStatusFailed  = "failed"
	WorkflowRuleExecutionStatusSkipped = "skipped"
)

// IsValidWorkflowRuleExecutionStatus checks if an execution status string is valid.
func IsValidWorkflowRuleExecutionStatus(status string) bool {
	switch status {
	case WorkflowRuleExecutionStatusSuccess, WorkflowRuleExecutionStatusFailed, WorkflowRuleExecutionStatusSkipped:
		return true
	default:
		return false
	}
}

// Default colors for UI elements
const (
	DefaultStateColor = "#3b82f6" // Blue
	DefaultLevelColor = "#6b7280" // Gray
)

// CollaborationMode defines allowed project collaboration mode values.
const (
	CollaborationModeStandard = "standard"
	CollaborationModeRitual   = "ritual"
	CollaborationModeMixed    = "mixed"
)

// TaskKind defines allowed task kind values.
const (
	TaskKindStandard       = "standard"
	TaskKindRitualInstance = "ritual_instance"
)

// EvidenceType defines allowed evidence type values.
const (
	EvidenceTypePhoto      = "photo"
	EvidenceTypeVoiceMemo  = "voice_memo"
	EvidenceTypePDF        = "pdf"
	EvidenceTypeFile       = "file"
	EvidenceTypeLink       = "link"
	EvidenceTypeTextNote   = "text_note"
	EvidenceTypeGPSCheckin = "gps_checkin"
)

// ApprovalMode defines allowed evidence approval mode values.
const (
	ApprovalModeManual      = "manual"
	ApprovalModeAutoApprove = "auto_approve"
)

// ApprovalStatus defines allowed evidence submission approval status values.
const (
	ApprovalStatusPendingReview = "pending_review"
	ApprovalStatusApproved      = "approved"
	ApprovalStatusRejected      = "rejected"
)

// RecurrenceType defines allowed ritual recurrence type values.
const (
	RecurrenceTypeDaily          = "daily"
	RecurrenceTypeWeekly         = "weekly"
	RecurrenceTypeMonthly        = "monthly"
	RecurrenceTypeCustomInterval = "custom_interval"
)

// Ritual notification type constants. Aliases of the notification package's own
// definitions, which are the single list the database CHECK is asserted against.
//
// There is deliberately no ritual_instance_assigned / _overdue / _missed here: the
// per-instance assignment notification was replaced by the ritual_instances_scheduled
// summary, and nothing sweeps a ritual into an overdue or missed state — overdue is
// derived when an evidence write triggers state reconciliation, not published.
const (
	NotificationTypeEvidenceSubmitted = notification.NotificationTypeEvidenceSubmitted
	NotificationTypeEvidenceApproved  = notification.NotificationTypeEvidenceApproved
	NotificationTypeEvidenceRejected  = notification.NotificationTypeEvidenceRejected
	// NotificationTypeRitualInstancesScheduled is sent once per assignee after a bulk
	// generation run completes, so a scheduler run that creates many instances produces
	// one notification per person rather than one per instance.
	NotificationTypeRitualInstancesScheduled = notification.NotificationTypeRitualInstancesScheduled
)

// Ritual-specific errors
var (
	ErrRitualDefinitionNotFound    = errors.New("ritual definition not found")
	ErrEvidenceRequirementNotFound = errors.New("evidence requirement not found")
	ErrEvidenceSubmissionNotFound  = errors.New("evidence submission not found")
	ErrNotRitualInstance           = errors.New("task is not a ritual instance")
	ErrRitualDefinitionArchived    = errors.New("ritual definition is archived")
)

// Default task levels created with new projects
var DefaultTaskLevels = []struct {
	Name  string
	Depth int
	Color string
}{
	{Name: "Epic", Depth: 0, Color: "#7c3aed"},    // Purple
	{Name: "Story", Depth: 1, Color: "#2563eb"},   // Blue
	{Name: "Task", Depth: 2, Color: "#059669"},    // Green
	{Name: "Subtask", Depth: 3, Color: "#6b7280"}, // Gray
}

// Default states created with new projects when no custom states provided
var DefaultProjectStates = []struct {
	Name      string
	Color     string
	Category  string
	IsInitial bool
	IsClosed  bool
	StateType string
}{
	{Name: "Backlog", Color: "#6b7280", Category: StateCategoryTodo, IsInitial: true, IsClosed: false, StateType: StateTypeStandard},
	{Name: "In Progress", Color: "#f59e0b", Category: StateCategoryInProgress, IsInitial: false, IsClosed: false, StateType: StateTypeStandard},
	{Name: "Done", Color: "#10b981", Category: StateCategoryDone, IsInitial: false, IsClosed: true, StateType: StateTypeStandard},
}

// DefaultRitualProjectStates defines the default states for ritual-only projects.
var DefaultRitualProjectStates = []struct {
	Name      string
	Color     string
	Category  string
	IsInitial bool
	IsClosed  bool
	StateType string
}{
	{Name: "Scheduled", Color: "#6b7280", Category: StateCategoryScheduled, IsInitial: true, IsClosed: false, StateType: StateTypeRitual},
	{Name: "Open", Color: "#3b82f6", Category: StateCategoryTodo, IsInitial: false, IsClosed: false, StateType: StateTypeRitual},
	{Name: "In Progress", Color: "#f59e0b", Category: StateCategoryInProgress, IsInitial: false, IsClosed: false, StateType: StateTypeRitual},
	{Name: "Submitted", Color: "#8b5cf6", Category: StateCategorySubmitted, IsInitial: false, IsClosed: false, StateType: StateTypeRitual},
	{Name: "Verified", Color: "#10b981", Category: StateCategoryVerified, IsInitial: false, IsClosed: true, StateType: StateTypeRitual},
	{Name: "Overdue", Color: "#ef4444", Category: StateCategoryOverdue, IsInitial: false, IsClosed: false, StateType: StateTypeRitual},
	{Name: "Missed", Color: "#dc2626", Category: StateCategoryMissed, IsInitial: false, IsClosed: true, StateType: StateTypeRitual},
	{Name: "Skipped", Color: "#9ca3af", Category: StateCategorySkipped, IsInitial: false, IsClosed: true, StateType: StateTypeRitual},
}

// DefaultMixedProjectStates defines the default states for mixed projects (standard + ritual lanes).
var DefaultMixedProjectStates = []struct {
	Name      string
	Color     string
	Category  string
	IsInitial bool
	IsClosed  bool
	StateType string
}{
	// Standard lane
	{Name: "Backlog", Color: "#6b7280", Category: StateCategoryTodo, IsInitial: true, IsClosed: false, StateType: StateTypeStandard},
	{Name: "In Progress", Color: "#f59e0b", Category: StateCategoryInProgress, IsInitial: false, IsClosed: false, StateType: StateTypeStandard},
	{Name: "Done", Color: "#10b981", Category: StateCategoryDone, IsInitial: false, IsClosed: true, StateType: StateTypeStandard},
	{Name: "Cancelled", Color: "#6b7280", Category: StateCategoryCancelled, IsInitial: false, IsClosed: true, StateType: StateTypeStandard},
	// Ritual lane
	{Name: "Scheduled", Color: "#6b7280", Category: StateCategoryScheduled, IsInitial: false, IsClosed: false, StateType: StateTypeRitual},
	{Name: "Open", Color: "#3b82f6", Category: StateCategoryTodo, IsInitial: false, IsClosed: false, StateType: StateTypeRitual},
	{Name: "Ritual In Progress", Color: "#f59e0b", Category: StateCategoryInProgress, IsInitial: false, IsClosed: false, StateType: StateTypeRitual},
	{Name: "Submitted", Color: "#8b5cf6", Category: StateCategorySubmitted, IsInitial: false, IsClosed: false, StateType: StateTypeRitual},
	{Name: "Verified", Color: "#10b981", Category: StateCategoryVerified, IsInitial: false, IsClosed: true, StateType: StateTypeRitual},
	{Name: "Overdue", Color: "#ef4444", Category: StateCategoryOverdue, IsInitial: false, IsClosed: false, StateType: StateTypeRitual},
	{Name: "Missed", Color: "#dc2626", Category: StateCategoryMissed, IsInitial: false, IsClosed: true, StateType: StateTypeRitual},
	{Name: "Skipped", Color: "#9ca3af", Category: StateCategorySkipped, IsInitial: false, IsClosed: true, StateType: StateTypeRitual},
}

// ---------------------------------------------------------------------------
// Tasks created from chat messages
// ---------------------------------------------------------------------------

// Errors specific to turning a chat message into a task. Each maps to a Connect code in
// handleError; the two that carry a structured detail are noted below.
var (
	// ErrEmptyTaskTitle is returned when the title is blank after trimming. Carries a
	// BadRequest detail naming the title field, so the sheet can mark that one input
	// rather than showing a whole-request error.
	ErrEmptyTaskTitle = errors.New("task title must not be empty")

	// ErrSourceMessageNotConvertible is returned for a message that cannot become a task:
	// a system message, or one that has been soft-deleted.
	ErrSourceMessageNotConvertible = errors.New("this message cannot be turned into a task")

	// ErrDestinationUnusable is returned when the destination project is archived,
	// deleted, or not writable by the caller. Carries a PreconditionFailure naming the
	// project so the client reopens the project picker instead of showing a dead end.
	ErrDestinationUnusable = errors.New("the destination project can no longer receive tasks")

	// ErrTooManySourceMessages is returned when a chip lookup asks for more message ids
	// than one rendered page could hold.
	ErrTooManySourceMessages = errors.New("too many message ids in one request")

	// ErrChannelAdminRequired is returned when a channel member who does not administer
	// the channel tries to change or clear its remembered task destination. It is a
	// resource check above the interceptor's permission check, in the same shape as
	// ritual definition management.
	ErrChannelAdminRequired = errors.New("only a channel administrator can change where this channel's tasks go")
)

// MaxSourceMessagesPerLookup caps a single reverse lookup of tasks by source message.
// The client makes one call per rendered page of messages, which is far below this.
const MaxSourceMessagesPerLookup = 200

// MaxTaskTitleLength is where a title derived from a message body is truncated, at a word
// boundary. Long messages are common; a task list full of paragraphs is not usable.
const MaxTaskTitleLength = 120
