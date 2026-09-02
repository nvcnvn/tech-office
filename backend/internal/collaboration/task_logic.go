package collaboration

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	"github.com/nvcnvn/tech-office/backend/internal/linking"
	"github.com/nvcnvn/tech-office/backend/internal/notification"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type taskPreviewProvider struct{}

func NewTaskPreviewProvider() linking.PreviewProvider {
	return taskPreviewProvider{}
}

func (taskPreviewProvider) Preview(target linking.CanonicalLinkTarget, canonicalURL string) (*linking.LinkPreviewMetadata, bool) {
	if target.ResourceType != linking.ResourceTypeTaskInstance {
		return nil, false
	}
	subtitle := "Task"
	if target.FocusIntent != "" {
		subtitle = fmt.Sprintf("Task • %s", strings.ReplaceAll(target.FocusIntent, "_", " "))
	}
	return &linking.LinkPreviewMetadata{
		Title:        fmt.Sprintf("Task %s", target.ResourceID),
		Subtitle:     subtitle,
		ResourceType: target.ResourceType,
		Href:         canonicalURL,
	}, true
}

// CreateTask creates a new task with cross-domain integrations
func (l *logicImpl) CreateTask(
	ctx context.Context,
	tx database.DBTX,
	orgID, reporterID dbuuid.UUID,
	req *rpcv1.CreateTaskRequest,
) (*rpcv1.Task, error) {
	slog.DebugContext(ctx, "CreateTask",
		"projectID", req.ProjectId,
		"title", req.Title,
	)

	now := time.Now()
	projectID := dbuuid.MustParse(req.ProjectId)

	// Check creator's project role — viewers cannot create tasks
	role, roleErr := l.GetProjectMemberRole(ctx, tx, orgID, projectID, reporterID)
	if roleErr != nil || role == ProjectMemberRoleViewer {
		return nil, ErrAccessDenied
	}

	// Resolve the level before anything parses it. level_id is optional: the quick sheet
	// that creates a task from a chat message has four fields and a task level is not one
	// of them. This resolution must stay ahead of the parse below — MustParse panics on an
	// empty string, so an absent level would take the server down rather than default.
	levelID, err := l.resolveTaskLevel(ctx, tx, orgID, projectID, req.LevelId)
	if err != nil {
		return nil, err
	}

	// Get next task number atomically
	taskNumberResult, err := l.Queries.IncrementProjectTaskNumber(ctx, tx, &database.IncrementProjectTaskNumberParams{
		OrganizationID: orgID,
		ID:             projectID,
		UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to get next task number",
			"error", err,
		)
		return nil, fmt.Errorf("failed to get next task number: %w", err)
	}

	// Generate task identifier (e.g., "PROJ-123")
	identifier := fmt.Sprintf("%s-%d", taskNumberResult.Key, taskNumberResult.NextTaskNumber)

	// Compute depth and path from parent
	var parentTaskID dbuuid.NullUUID
	var depth int16 = 0
	path := []dbuuid.UUID{}

	if req.ParentTaskId != nil && *req.ParentTaskId != "" {
		parentID := dbuuid.MustParse(*req.ParentTaskId)
		parentTaskID = dbuuid.UUIDToNullUUID(parentID)

		parent, err := l.Queries.GetTask(ctx, tx, &database.GetTaskParams{
			OrganizationID: orgID,
			ID:             parentID,
		})
		if err != nil {
			if err == pgx.ErrNoRows {
				return nil, ErrInvalidParent
			}
			return nil, fmt.Errorf("failed to get parent task: %w", err)
		}

		depth = parent.Depth + 1
		if int(depth) > MaxTaskDepth {
			return nil, ErrMaxDepthExceeded
		}

		// Validate that the child level is at a deeper depth than the parent level
		parentLevel, err := l.Queries.GetTaskLevel(ctx, tx, &database.GetTaskLevelParams{
			OrganizationID: orgID,
			ID:             dbuuid.UUID(parent.LevelID),
		})
		if err == nil {
			childLevel, err := l.Queries.GetTaskLevel(ctx, tx, &database.GetTaskLevelParams{
				OrganizationID: orgID,
				ID:             levelID,
			})
			if err == nil && childLevel.Depth <= parentLevel.Depth {
				return nil, ErrInvalidParent
			}
		}

		// Build path from parent's path + parent ID
		path = append(path, parent.Path...)
		path = append(path, dbuuid.UUID(parent.ID))
	}

	// Determine initial state
	var stateID dbuuid.UUID
	if req.StateId != nil && *req.StateId != "" {
		stateID = dbuuid.MustParse(*req.StateId)
	} else {
		// Get initial state
		initialState, err := l.Queries.GetInitialState(ctx, tx, &database.GetInitialStateParams{
			OrganizationID: orgID,
			ProjectID:      projectID,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to get initial state: %w", err)
		}
		stateID = dbuuid.UUID(initialState.ID)
	}

	// A task's chat channel and description document are NOT created here. They are
	// provisioned by EnsureTaskResources the first time someone opens the task, so a task
	// nobody opens never creates a channel nobody reads. Both columns stay NULL until then.
	var channelID, descriptionDocID dbuuid.NullUUID

	// Parse dates
	var startDate, dueDate pgtype.Date
	if req.StartDate != nil && *req.StartDate != "" {
		t, err := time.Parse("2006-01-02", *req.StartDate)
		if err == nil {
			startDate = pgtype.Date{Time: t, Valid: true}
		}
	}
	if req.DueDate != nil && *req.DueDate != "" {
		t, err := time.Parse("2006-01-02", *req.DueDate)
		if err == nil {
			dueDate = pgtype.Date{Time: t, Valid: true}
		}
	}

	// Parse estimated hours
	var estimatedHours pgtype.Numeric
	if req.EstimatedHours != nil {
		estimatedHours = pgtype.Numeric{Valid: true}
		_ = estimatedHours.Scan(*req.EstimatedHours)
	}

	// Parse ritual fields
	var ritualDefinitionID dbuuid.NullUUID
	if req.RitualDefinitionId != nil && *req.RitualDefinitionId != "" {
		ritualDefinitionID = dbuuid.UUIDToNullUUID(dbuuid.MustParse(*req.RitualDefinitionId))
	}
	var scheduledDate pgtype.Date
	if req.ScheduledDate != nil && *req.ScheduledDate != "" {
		t, err := time.Parse("2006-01-02", *req.ScheduledDate)
		if err == nil {
			scheduledDate = pgtype.Date{Time: t, Valid: true}
		}
	}
	var completionDeadline pgtype.Timestamptz
	if req.CompletionDeadline != nil {
		completionDeadline = pgtype.Timestamptz{Time: req.CompletionDeadline.AsTime(), Valid: true}
	}

	// Generate new task ID
	taskID := dbuuid.Must()

	// Create task
	task, err := l.Queries.CreateTask(ctx, tx, &database.CreateTaskParams{
		ID:                    taskID,
		OrganizationID:        orgID,
		ProjectID:             projectID,
		Identifier:            identifier,
		Title:                 req.Title,
		ParentTaskID:          parentTaskID,
		Depth:                 depth,
		Path:                  path,
		LevelID:               levelID,
		StateID:               stateID,
		StartDate:             startDate,
		DueDate:               dueDate,
		EstimatedHours:        estimatedHours,
		ChannelID:             channelID,
		DescriptionDocumentID: descriptionDocID,
		ReporterEmployeeID:    reporterID,
		TaskKind:              taskKindToString(req.TaskKind),
		RitualDefinitionID:    ritualDefinitionID,
		ScheduledDate:         scheduledDate,
		CompletionDeadline:    completionDeadline,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create task",
			"error", err,
		)
		return nil, fmt.Errorf("failed to create task: %w", err)
	}

	// Register V2 resource surfaces for parent-subscription inheritance
	l.registerTaskResourceSurfaces(ctx, tx, orgID, taskID, channelID, descriptionDocID)

	// Add reporter as watcher
	err = l.createTaskWatcher(ctx, tx, orgID, taskID, reporterID, TaskWatchReasonReporter)
	if err != nil {
		slog.WarnContext(ctx, "failed to add reporter as watcher",
			"error", err,
		)
	}

	// Add assignees
	for _, assigneeIDStr := range req.AssigneeEmployeeIds {
		assigneeID := dbuuid.MustParse(assigneeIDStr)
		_, err := l.AssignTask(ctx, tx, orgID, reporterID, taskID, assigneeID, TaskAssigneeRoleAssignee)
		if err != nil {
			slog.WarnContext(ctx, "failed to assign task",
				"error", err,
				"assigneeID", assigneeIDStr,
			)
		}
	}

	// Increment project task count. The delta is explicit: leaving it zero made every
	// create a no-op while DeleteTask still decremented, so the first deletion in a
	// project drove task_count to -1 and tripped project_task_count_check.
	err = l.Queries.IncrementProjectTaskCount(ctx, tx, &database.IncrementProjectTaskCountParams{
		OrganizationID: orgID,
		ID:             projectID,
		TaskCount:      1,
		UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		slog.WarnContext(ctx, "failed to increment project task count",
			"error", err,
		)
	}

	// Increment parent child count if applicable
	if parentTaskID.Valid {
		err = l.Queries.IncrementTaskChildCount(ctx, tx, &database.IncrementTaskChildCountParams{
			OrganizationID: orgID,
			ID:             dbuuid.UUID(parentTaskID.UUID),
			UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
		})
		if err != nil {
			slog.WarnContext(ctx, "failed to increment parent child count",
				"error", err,
			)
		}
	}

	slog.InfoContext(ctx, "task created successfully",
		"taskID", taskID,
		"identifier", identifier,
	)

	return l.taskToProto(task, nil, nil), nil
}

// resolveTaskLevel turns an optional level_id into the level the task will actually get.
// An explicit level is used as given; an absent one falls back to the project's shallowest
// level, which is the level an ordinary top-level task belongs at.
//
// This exists because level_id is optional on CreateTaskRequest and is parsed with
// MustParse, which panics on an empty string. Every caller must go through here before
// that parse.
func (l *logicImpl) resolveTaskLevel(
	ctx context.Context,
	tx database.DBTX,
	orgID, projectID dbuuid.UUID,
	requested *string,
) (dbuuid.UUID, error) {
	if requested != nil && *requested != "" {
		return dbuuid.MustParse(*requested), nil
	}

	// ListTaskLevels already orders by depth ASC, so the shallowest level is the first.
	levels, err := l.Queries.ListTaskLevels(ctx, tx, &database.ListTaskLevelsParams{
		OrganizationID: orgID,
		ProjectID:      projectID,
	})
	if err != nil {
		return dbuuid.UUID{}, fmt.Errorf("failed to list task levels for default: %w", err)
	}
	if len(levels) == 0 {
		return dbuuid.UUID{}, ErrLevelNotFound
	}
	return dbuuid.UUID(levels[0].ID), nil
}

// GetTask retrieves a task by ID
func (l *logicImpl) GetTask(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	taskID dbuuid.UUID,
	includeCustomFields bool,
) (*rpcv1.Task, []*rpcv1.TaskWatcher, error) {
	slog.DebugContext(ctx, "GetTask",
		"taskID", taskID,
	)

	task, err := l.Queries.GetTask(ctx, tx, &database.GetTaskParams{
		OrganizationID: orgID,
		ID:             taskID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil, ErrTaskNotFound
		}
		return nil, nil, fmt.Errorf("failed to get task: %w", err)
	}

	// Get assignees
	assignees, err := l.Queries.ListTaskAssignees(ctx, tx, &database.ListTaskAssigneesParams{
		OrganizationID: orgID,
		TaskID:         taskID,
	})
	if err != nil {
		slog.WarnContext(ctx, "failed to list assignees",
			"error", err,
		)
	}

	// Get watchers from V2 resource subscriptions
	subscriptions, err := l.Queries.ListActiveResourceSubscriptionsByResource(ctx, tx, &database.ListActiveResourceSubscriptionsByResourceParams{
		OrganizationID: orgID,
		ResourceDomain: notification.ResourceDomainTask,
		ResourceID:     taskID,
	})
	if err != nil {
		slog.WarnContext(ctx, "failed to list task subscriptions",
			"error", err,
		)
	}

	// Load reasons for each subscription to determine watch reason
	subReasons, err := l.Queries.ListResourceSubscriptionReasonsForResource(ctx, tx, &database.ListResourceSubscriptionReasonsForResourceParams{
		OrganizationID: orgID,
		ResourceDomain: notification.ResourceDomainTask,
		ResourceID:     taskID,
	})
	if err != nil {
		slog.WarnContext(ctx, "failed to list subscription reasons",
			"error", err,
		)
	}

	// Index reasons by subscription ID for fast lookup
	reasonsBySubID := make(map[dbuuid.UUID]string)
	for _, r := range subReasons {
		reasonsBySubID[r.SubscriptionID] = subscriptionReasonToWatchReason(r.ReasonType)
	}

	watchers := make([]*rpcv1.TaskWatcher, len(subscriptions))
	for i, s := range subscriptions {
		reason := reasonsBySubID[s.ID]
		if reason == "" {
			reason = TaskWatchReasonManual
		}
		watchers[i] = &rpcv1.TaskWatcher{
			EmployeeId:  s.EmployeeID.String(),
			WatchReason: reason,
		}
	}

	// Get custom field values if requested
	var customFieldValues []*rpcv1.CustomFieldValue
	if includeCustomFields {
		dbValues, err := l.Queries.ListCustomFieldValues(ctx, tx, &database.ListCustomFieldValuesParams{
			OrganizationID: orgID,
			TaskID:         taskID,
		})
		if err != nil {
			slog.WarnContext(ctx, "failed to list custom field values",
				"error", err,
			)
		}
		customFieldValues = make([]*rpcv1.CustomFieldValue, len(dbValues))
		for i, v := range dbValues {
			customFieldValues[i] = customFieldValueToProto(v)
		}
	}

	taskProto := l.taskToProto(task, assignees, customFieldValues)
	if task.TaskKind == "ritual_instance" {
		taskProto.EvidenceProgress = l.buildTaskEvidenceProgressSummary(ctx, tx, orgID, taskID)
	}

	return taskProto, watchers, nil
}

// EnsureTaskResources lazily provisions a chat channel and description document for a
// task that does not have them yet. Every task is created without resources, so this is
// where they come from for all of them, on first open. It is idempotent: concurrent
// callers will not create duplicate resources.
func (l *logicImpl) EnsureTaskResources(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID, taskID dbuuid.UUID,
) (*rpcv1.Task, []*rpcv1.TaskWatcher, error) {
	task, err := l.Queries.GetTask(ctx, tx, &database.GetTaskParams{
		OrganizationID: orgID,
		ID:             taskID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil, ErrTaskNotFound
		}
		return nil, nil, fmt.Errorf("failed to get task: %w", err)
	}

	// Fast path: resources already exist
	if task.ChannelID.Valid && task.DescriptionDocumentID.Valid {
		return l.GetTask(ctx, tx, orgID, taskID, true)
	}

	// Resources are owned by the task's reporter, not by whoever happens to open the task
	// first. Provisioning is lazy, so the opener is arbitrary; making them the channel
	// admin would hand control of the discussion to a passer-by and make ownership race.
	// The eager path this replaced always used the reporter, and so does this.
	ownerID := dbuuid.UUID(task.ReporterEmployeeID)

	// Create channel if not yet set
	if !task.ChannelID.Valid && l.ChatLogic != nil {
		lowercaseSlug := strings.ToLower(task.Identifier)
		channel, chErr := l.ChatLogic.CreateChannel(ctx, tx, orgID, ownerID, &rpcv1.CreateChannelRequest{
			TitleSlug:   fmt.Sprintf("task-%s", lowercaseSlug),
			DisplayName: fmt.Sprintf("Task: %s", task.Title),
			Description: fmt.Sprintf("Discussion for task %s", task.Identifier),
			ChannelType: rpcv1.ChannelType_CHANNEL_TYPE_PROJECT_TICKET_THREAD,
			IsPrivate:   true,
		})
		if chErr != nil {
			slog.WarnContext(ctx, "EnsureTaskResources: failed to create channel", "error", chErr, "taskID", taskID)
		} else {
			channelID := dbuuid.MustParse(channel.Id)
			// Atomic CAS: only one concurrent caller wins
			_, casErr := l.Queries.EnsureTaskChannel(ctx, tx, &database.EnsureTaskChannelParams{
				OrganizationID: orgID,
				ID:             taskID,
				ChannelID:      dbuuid.UUIDToNullUUID(channelID),
			})
			if casErr != nil && casErr != pgx.ErrNoRows {
				slog.WarnContext(ctx, "EnsureTaskResources: failed to set channel_id", "error", casErr, "taskID", taskID)
			}
			// Enroll project members in the channel
			if enrollErr := l.Queries.EnrollProjectMembersInChannel(ctx, tx, &database.EnrollProjectMembersInChannelParams{
				OrganizationID: orgID,
				ChannelID:      channelID,
				ProjectID:      dbuuid.UUID(task.ProjectID),
			}); enrollErr != nil {
				slog.WarnContext(ctx, "EnsureTaskResources: failed to enroll project members", "error", enrollErr)
			}
		}
	}

	// Create document if not yet set
	if !task.DescriptionDocumentID.Valid && l.DocsLogic != nil {
		doc, docErr := l.DocsLogic.CreateDocument(ctx, tx, orgID, ownerID, &rpcv1.CreateDocumentRequest{
			Title:       fmt.Sprintf("Task: %s", task.Title),
			ContentJson: "{}",
			Visibility:  rpcv1.DocumentVisibility_DOCUMENT_VISIBILITY_PUBLIC,
		})
		if docErr != nil {
			slog.WarnContext(ctx, "EnsureTaskResources: failed to create document", "error", docErr, "taskID", taskID)
		} else {
			docID := dbuuid.MustParse(doc.Id)
			_, casErr := l.Queries.EnsureTaskDocument(ctx, tx, &database.EnsureTaskDocumentParams{
				OrganizationID:        orgID,
				ID:                    taskID,
				DescriptionDocumentID: dbuuid.UUIDToNullUUID(docID),
			})
			if casErr != nil && casErr != pgx.ErrNoRows {
				slog.WarnContext(ctx, "EnsureTaskResources: failed to set description_document_id", "error", casErr, "taskID", taskID)
			}
		}
	}

	// Re-fetch task to get current state (possibly updated by concurrent caller)
	refreshed, err := l.Queries.GetTask(ctx, tx, &database.GetTaskParams{
		OrganizationID: orgID,
		ID:             taskID,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("failed to re-fetch task after resource creation: %w", err)
	}

	// Register V2 notification surfaces
	l.registerTaskResourceSurfaces(ctx, tx, orgID, taskID, refreshed.ChannelID, refreshed.DescriptionDocumentID)

	return l.GetTask(ctx, tx, orgID, taskID, true)
}

// GetTaskByIdentifier retrieves a task by its human-readable identifier
func (l *logicImpl) GetTaskByIdentifier(
	ctx context.Context,
	tx database.DBTX,
	orgID, projectID dbuuid.UUID,
	identifier string,
) (*rpcv1.Task, error) {
	slog.DebugContext(ctx, "GetTaskByIdentifier",
		"projectID", projectID,
		"identifier", identifier,
	)

	task, err := l.Queries.GetTaskByIdentifier(ctx, tx, &database.GetTaskByIdentifierParams{
		OrganizationID: orgID,
		ProjectID:      projectID,
		Identifier:     identifier,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrTaskNotFound
		}
		return nil, fmt.Errorf("failed to get task: %w", err)
	}

	return l.taskToProto(task, nil, nil), nil
}

// UpdateTask updates a task
func (l *logicImpl) UpdateTask(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	req *rpcv1.UpdateTaskRequest,
) (*rpcv1.Task, []*rpcv1.WorkflowRuleExecution, error) {
	slog.DebugContext(ctx, "UpdateTask",
		"taskID", req.TaskId,
	)

	taskID := dbuuid.MustParse(req.TaskId)
	now := time.Now()

	// Get current task
	current, err := l.Queries.GetTask(ctx, tx, &database.GetTaskParams{
		OrganizationID: orgID,
		ID:             taskID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil, ErrTaskNotFound
		}
		return nil, nil, fmt.Errorf("failed to get task: %w", err)
	}

	// Build update params
	title := current.Title
	if req.Title != nil {
		title = *req.Title
	}

	stateID := dbuuid.UUID(current.StateID)
	oldStateID := stateID
	if req.StateId != nil {
		stateID = dbuuid.MustParse(*req.StateId)
	}

	startDate := current.StartDate
	if req.StartDate != nil {
		if *req.StartDate == "" {
			startDate = pgtype.Date{}
		} else {
			t, err := time.Parse("2006-01-02", *req.StartDate)
			if err == nil {
				startDate = pgtype.Date{Time: t, Valid: true}
			}
		}
	}

	dueDate := current.DueDate
	if req.DueDate != nil {
		if *req.DueDate == "" {
			dueDate = pgtype.Date{}
		} else {
			t, err := time.Parse("2006-01-02", *req.DueDate)
			if err == nil {
				dueDate = pgtype.Date{Time: t, Valid: true}
			}
		}
	}

	estimatedHours := current.EstimatedHours
	if req.EstimatedHours != nil {
		estimatedHours = pgtype.Numeric{Valid: true}
		_ = estimatedHours.Scan(*req.EstimatedHours)
	}

	levelID := dbuuid.UUID(current.LevelID)
	if req.LevelId != nil {
		levelID = dbuuid.MustParse(*req.LevelId)
	}

	// Handle parent change
	parentTaskID := current.ParentTaskID
	depth := current.Depth
	path := current.Path
	if req.ParentTaskId != nil {
		if *req.ParentTaskId == "" {
			// Move to root
			parentTaskID = dbuuid.NullUUID{}
			depth = 0
			path = []dbuuid.UUID{}
		} else {
			// Move to new parent
			newParentID := dbuuid.MustParse(*req.ParentTaskId)
			parent, err := l.Queries.GetTask(ctx, tx, &database.GetTaskParams{
				OrganizationID: orgID,
				ID:             newParentID,
			})
			if err != nil {
				return nil, nil, ErrInvalidParent
			}
			parentTaskID = dbuuid.UUIDToNullUUID(newParentID)
			depth = parent.Depth + 1
			if int(depth) > MaxTaskDepth {
				return nil, nil, ErrMaxDepthExceeded
			}
			path = append([]dbuuid.UUID{}, parent.Path...)
			path = append(path, dbuuid.UUID(parent.ID))
		}
	}

	skipReasonVal := ""
	if req.SkipReason != nil {
		skipReasonVal = *req.SkipReason
	}

	// Update task
	updated, err := l.Queries.UpdateTask(ctx, tx, &database.UpdateTaskParams{
		OrganizationID: orgID,
		ID:             taskID,
		Title:          pgtype.Text{String: title, Valid: title != ""},
		StateID:        dbuuid.UUIDToNullUUID(stateID),
		LevelID:        dbuuid.UUIDToNullUUID(levelID),
		ParentTaskID:   parentTaskID,
		StartDate:      startDate,
		DueDate:        dueDate,
		EstimatedHours: estimatedHours,
		SkipReason:     pgtype.Text{String: skipReasonVal, Valid: skipReasonVal != ""},
		UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update task",
			"error", err,
		)
		return nil, nil, fmt.Errorf("failed to update task: %w", err)
	}

	// Execute workflow rules if state changed
	var ruleExecutions []*rpcv1.WorkflowRuleExecution
	if stateID != oldStateID {
		ruleExecutions, err = l.ExecuteRulesForStateTrigger(ctx, tx, orgID, dbuuid.UUID(current.ProjectID), stateID, taskID, employeeID)
		if err != nil {
			slog.WarnContext(ctx, "failed to execute workflow rules",
				"error", err,
			)
		}
	}

	return l.taskToProto(updated, nil, nil), ruleExecutions, nil
}

// DeleteTask deletes a task
func (l *logicImpl) DeleteTask(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	taskID dbuuid.UUID,
	deleteChildren bool,
) (int32, error) {
	slog.DebugContext(ctx, "DeleteTask",
		"taskID", taskID,
		"deleteChildren", deleteChildren,
	)

	now := time.Now()

	// Get task first
	task, err := l.Queries.GetTask(ctx, tx, &database.GetTaskParams{
		OrganizationID: orgID,
		ID:             taskID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return 0, ErrTaskNotFound
		}
		return 0, fmt.Errorf("failed to get task: %w", err)
	}

	var deletedCount int32 = 1

	if deleteChildren {
		// Delete children recursively using soft delete
		err := l.Queries.SoftDeleteTaskChildren(ctx, tx, &database.SoftDeleteTaskChildrenParams{
			OrganizationID: orgID,
			Path:           []dbuuid.UUID{taskID}, // Tasks with this ID in path are children
			UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
		})
		if err != nil {
			slog.WarnContext(ctx, "failed to delete child tasks",
				"error", err,
			)
		}
		// Note: deletedCount is approximate, actual count would require separate query
	}

	// Soft delete the task
	err = l.Queries.SoftDeleteTask(ctx, tx, &database.SoftDeleteTaskParams{
		OrganizationID: orgID,
		ID:             taskID,
		UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to delete task",
			"error", err,
		)
		return 0, fmt.Errorf("failed to delete task: %w", err)
	}

	// Decrement project task count
	err = l.Queries.IncrementProjectTaskCount(ctx, tx, &database.IncrementProjectTaskCountParams{
		OrganizationID: orgID,
		ID:             dbuuid.UUID(task.ProjectID),
		TaskCount:      -1, // Decrement by 1
		UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		slog.WarnContext(ctx, "failed to decrement project task count",
			"error", err,
		)
	}

	// Decrement parent child count if applicable
	if task.ParentTaskID.Valid {
		err = l.Queries.IncrementTaskChildCount(ctx, tx, &database.IncrementTaskChildCountParams{
			OrganizationID: orgID,
			ID:             dbuuid.UUID(task.ParentTaskID.UUID),
			ChildCount:     -1, // Decrement by 1
			UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
		})
		if err != nil {
			slog.WarnContext(ctx, "failed to decrement parent child count",
				"error", err,
			)
		}
	}

	return deletedCount, nil
}

// ListTasks lists tasks with filters
func (l *logicImpl) ListTasks(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	req *rpcv1.ListTasksRequest,
) ([]*rpcv1.Task, error) {
	slog.DebugContext(ctx, "ListTasks",
		"projectID", req.ProjectId,
	)

	projectID := dbuuid.MustParse(req.ProjectId)

	// Build filter params
	params := &database.ListTasksParams{
		OrganizationID: orgID,
		ProjectID:      projectID,
		Limit:          50,
	}

	if req.Limit != nil && *req.Limit > 0 && *req.Limit <= 100 {
		params.Limit = *req.Limit
	}

	if req.Cursor != nil && *req.Cursor != "" {
		params.Cursor = dbuuid.UUIDToNullUUID(dbuuid.MustParse(*req.Cursor))
	}

	if req.StateId != nil && *req.StateId != "" {
		params.StateID = dbuuid.UUIDToNullUUID(dbuuid.MustParse(*req.StateId))
	}

	if req.LevelId != nil && *req.LevelId != "" {
		params.LevelID = dbuuid.UUIDToNullUUID(dbuuid.MustParse(*req.LevelId))
	}

	if req.ParentTaskId != nil && *req.ParentTaskId != "" {
		params.ParentTaskID = dbuuid.UUIDToNullUUID(dbuuid.MustParse(*req.ParentTaskId))
	}

	if req.RootOnly != nil && *req.RootOnly {
		params.RootOnly = pgtype.Bool{Bool: true, Valid: true}
	}

	if req.TaskKind != nil && *req.TaskKind != rpcv1.TaskKind_TASK_KIND_UNSPECIFIED {
		params.TaskKind = pgtype.Text{String: taskKindToString(req.TaskKind), Valid: true}
	}

	// Use assignee-specific query when filtering by assignee
	if req.AssigneeEmployeeId != nil && *req.AssigneeEmployeeId != "" {
		assigneeID := dbuuid.MustParse(*req.AssigneeEmployeeId)
		dbTasks, err := l.Queries.ListTasksByAssignee(ctx, tx, &database.ListTasksByAssigneeParams{
			OrganizationID: orgID,
			ProjectID:      projectID,
			EmployeeID:     assigneeID,
			Limit:          params.Limit,
			Cursor:         params.Cursor,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to list tasks by assignee: %w", err)
		}
		tasks := make([]*rpcv1.Task, len(dbTasks))
		for i, t := range dbTasks {
			taskProto := l.taskToProto(t, nil, nil)
			if t.TaskKind == "ritual_instance" {
				taskProto.EvidenceProgress = l.buildTaskEvidenceProgressSummary(ctx, tx, orgID, t.ID)
			}
			tasks[i] = taskProto
		}
		return tasks, nil
	}

	dbTasks, err := l.Queries.ListTasks(ctx, tx, params)
	if err != nil {
		return nil, fmt.Errorf("failed to list tasks: %w", err)
	}

	tasks := make([]*rpcv1.Task, len(dbTasks))
	for i, t := range dbTasks {
		taskProto := l.taskToProto(t, nil, nil)
		if t.TaskKind == "ritual_instance" {
			taskProto.EvidenceProgress = l.buildTaskEvidenceProgressSummary(ctx, tx, orgID, t.ID)
		}
		tasks[i] = taskProto
	}

	return tasks, nil
}

// MoveTask moves a task to a new state
func (l *logicImpl) MoveTask(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	taskID, newStateID dbuuid.UUID,
) (*rpcv1.Task, []*rpcv1.WorkflowRuleExecution, error) {
	slog.DebugContext(ctx, "MoveTask",
		"taskID", taskID,
		"newStateID", newStateID,
	)

	now := time.Now()

	// Get current task
	task, err := l.Queries.GetTask(ctx, tx, &database.GetTaskParams{
		OrganizationID: orgID,
		ID:             taskID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil, ErrTaskNotFound
		}
		return nil, nil, fmt.Errorf("failed to get task: %w", err)
	}

	oldStateID := dbuuid.UUID(task.StateID)
	if oldStateID == newStateID {
		// No change needed
		return l.taskToProto(task, nil, nil), nil, nil
	}

	// Update task state
	updated, err := l.Queries.UpdateTaskState(ctx, tx, &database.UpdateTaskStateParams{
		OrganizationID: orgID,
		ID:             taskID,
		StateID:        newStateID,
		UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update task state",
			"error", err,
		)
		return nil, nil, fmt.Errorf("failed to update task state: %w", err)
	}

	// Execute workflow rules for state change
	ruleExecutions, err := l.ExecuteRulesForStateTrigger(ctx, tx, orgID, dbuuid.UUID(task.ProjectID), newStateID, taskID, employeeID)
	if err != nil {
		slog.WarnContext(ctx, "failed to execute workflow rules",
			"error", err,
		)
	}

	// Notify watchers
	l.notifyTaskWatchers(ctx, tx, orgID, taskID, employeeID,
		NotificationTypeTaskStatusChanged, 1, false,
		"Task status changed", "Task state has been updated")

	return l.taskToProto(updated, nil, nil), ruleExecutions, nil
}

// ============================================================================
// Helper Functions
// ============================================================================

func (l *logicImpl) taskToProto(t *database.CollaborationTask, assignees []*database.CollaborationTaskAssignee, customFieldValues []*rpcv1.CustomFieldValue) *rpcv1.Task {
	task := &rpcv1.Task{
		Id:                 t.ID.String(),
		ProjectId:          t.ProjectID.String(),
		Identifier:         t.Identifier,
		Title:              t.Title,
		Depth:              int32(t.Depth),
		LevelId:            t.LevelID.String(),
		ChildCount:         t.ChildCount,
		StateId:            t.StateID.String(),
		ReporterEmployeeId: t.ReporterEmployeeID.String(),
		CommentCount:       t.CommentCount,
		UpdatedAt:          timestamppb.New(t.UpdatedAt.Time),
		CustomFieldValues:  customFieldValues,
		TaskKind:           stringToTaskKindProto(t.TaskKind),
	}

	if t.RitualDefinitionID.Valid {
		task.RitualDefinitionId = t.RitualDefinitionID.UUID.String()
	}
	if t.ScheduledDate.Valid {
		task.ScheduledDate = t.ScheduledDate.Time.Format("2006-01-02")
	}
	if t.CompletionDeadline.Valid {
		task.CompletionDeadline = timestamppb.New(t.CompletionDeadline.Time)
	}
	if t.SkipReason.Valid {
		task.SkipReason = t.SkipReason.String
	}

	task.DetachedFromRitual = t.DetachedFromRitual

	if t.ParentTaskID.Valid {
		s := t.ParentTaskID.UUID.String()
		task.ParentTaskId = &s
	}

	// Where the task came from, when it was created from a chat message. The table's
	// CHECK guarantees both halves are set together, so either both appear or neither.
	if t.SourceChannelID.Valid {
		s := t.SourceChannelID.UUID.String()
		task.SourceChannelId = &s
	}
	if t.SourceMessageID.Valid {
		s := t.SourceMessageID.UUID.String()
		task.SourceMessageId = &s
	}

	if t.StartDate.Valid {
		s := t.StartDate.Time.Format("2006-01-02")
		task.StartDate = &s
	}

	if t.DueDate.Valid {
		s := t.DueDate.Time.Format("2006-01-02")
		task.DueDate = &s
	}

	if t.EstimatedHours.Valid {
		var f float64
		_ = t.EstimatedHours.Scan(&f)
		task.EstimatedHours = &f
	}

	if t.ChannelID.Valid {
		s := t.ChannelID.UUID.String()
		task.ChannelId = &s
	}

	if t.DescriptionDocumentID.Valid {
		s := t.DescriptionDocumentID.UUID.String()
		task.DescriptionDocumentId = &s
	}

	// Convert file IDs
	task.FileIds = make([]string, len(t.FileIds))
	for i, id := range t.FileIds {
		task.FileIds[i] = id.String()
	}

	// Convert assignees
	if assignees != nil {
		task.Assignees = make([]*rpcv1.TaskAssignee, len(assignees))
		for i, a := range assignees {
			task.Assignees[i] = &rpcv1.TaskAssignee{
				EmployeeId: a.EmployeeID.String(),
				Role:       stringToAssigneeRoleProto(a.Role),
				AssignedAt: timestamppb.New(a.AssignedAt.Time),
			}
		}
	}

	return task
}

func (l *logicImpl) createTaskWatcher(
	ctx context.Context,
	tx database.DBTX,
	orgID, taskID, employeeID dbuuid.UUID,
	reason string,
) error {
	reasonType, ok := taskResourceSubscriptionReason(reason)
	if !ok {
		return nil
	}

	if _, err := l.upsertTaskResourceSubscription(ctx, tx, orgID, taskID, employeeID, notification.ResourceSubscriptionStateActive); err != nil {
		return err
	}

	return l.syncTaskResourceSubscriptionReason(ctx, tx, orgID, taskID, employeeID, reasonType, false)
}

func (l *logicImpl) upsertTaskResourceSubscription(
	ctx context.Context,
	tx database.DBTX,
	orgID, taskID, employeeID dbuuid.UUID,
	state string,
) (*database.NotificationResourceSubscription, error) {
	preferenceLevel := notification.NotificationPreferenceAll
	existing, err := l.Queries.GetResourceSubscriptionByEmployee(ctx, tx, &database.GetResourceSubscriptionByEmployeeParams{
		OrganizationID: orgID,
		EmployeeID:     employeeID,
		ResourceDomain: notification.ResourceDomainTask,
		ResourceID:     taskID,
	})
	if err == nil {
		preferenceLevel = existing.PreferenceLevel
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("failed to load existing task subscription: %w", err)
	}

	return l.Queries.UpsertResourceSubscription(ctx, tx, &database.UpsertResourceSubscriptionParams{
		OrganizationID:    orgID,
		EmployeeID:        employeeID,
		ResourceDomain:    notification.ResourceDomainTask,
		ResourceID:        taskID,
		SubscriptionState: state,
		PreferenceLevel:   preferenceLevel,
		UpdatedAt:         pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
}

func (l *logicImpl) syncTaskResourceSubscriptionReason(
	ctx context.Context,
	tx database.DBTX,
	orgID, taskID, employeeID dbuuid.UUID,
	reasonType string,
	remove bool,
) error {
	if remove {
		subscription, err := l.Queries.GetResourceSubscriptionByEmployee(ctx, tx, &database.GetResourceSubscriptionByEmployeeParams{
			OrganizationID: orgID,
			EmployeeID:     employeeID,
			ResourceDomain: notification.ResourceDomainTask,
			ResourceID:     taskID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil
			}
			return fmt.Errorf("failed to load task subscription for reason removal: %w", err)
		}
		return l.Queries.DeleteResourceSubscriptionReason(ctx, tx, &database.DeleteResourceSubscriptionReasonParams{
			OrganizationID: subscription.OrganizationID,
			SubscriptionID: subscription.ID,
			ReasonType:     reasonType,
			ReasonRefType:  pgtype.Text{},
			ReasonRefID:    dbuuid.NullUUID{},
		})
	}

	subscription, err := l.upsertTaskResourceSubscription(ctx, tx, orgID, taskID, employeeID, notification.ResourceSubscriptionStateActive)
	if err != nil {
		return err
	}

	return l.Queries.AddResourceSubscriptionReason(ctx, tx, &database.AddResourceSubscriptionReasonParams{
		OrganizationID: subscription.OrganizationID,
		SubscriptionID: subscription.ID,
		ReasonType:     reasonType,
		ReasonRefType:  pgtype.Text{},
		ReasonRefID:    dbuuid.NullUUID{},
		CreatedAt:      pgtype.Timestamptz{Time: time.Now(), Valid: true},
	})
}

func taskResourceSubscriptionReason(watchReason string) (string, bool) {
	switch watchReason {
	case TaskWatchReasonManual:
		return notification.ResourceSubscriptionReasonManualFollow, true
	case TaskWatchReasonAssigned:
		return notification.ResourceSubscriptionReasonAssignee, true
	case TaskWatchReasonReporter:
		return notification.ResourceSubscriptionReasonReporter, true
	case TaskWatchReasonCommented:
		return notification.ResourceSubscriptionReasonCommented, true
	default:
		return "", false
	}
}

// subscriptionReasonToWatchReason maps a V2 subscription reason type back to
// the legacy WatchReason string used in the TaskWatcher proto.
func subscriptionReasonToWatchReason(reasonType string) string {
	switch reasonType {
	case notification.ResourceSubscriptionReasonManualFollow:
		return TaskWatchReasonManual
	case notification.ResourceSubscriptionReasonAssignee:
		return TaskWatchReasonAssigned
	case notification.ResourceSubscriptionReasonReporter:
		return TaskWatchReasonReporter
	case notification.ResourceSubscriptionReasonCommented:
		return TaskWatchReasonCommented
	default:
		return TaskWatchReasonManual
	}
}

// registerTaskResourceSurfaces creates resource_surface rows linking a task to its
// discussion channel and description document so V2 subscription inheritance works.
func (l *logicImpl) registerTaskResourceSurfaces(
	ctx context.Context,
	tx database.DBTX,
	orgID, taskID dbuuid.UUID,
	channelID dbuuid.NullUUID,
	descriptionDocID dbuuid.NullUUID,
) {
	now := pgtype.Timestamptz{Time: time.Now(), Valid: true}

	if channelID.Valid {
		if _, err := l.Queries.UpsertResourceSurface(ctx, tx, &database.UpsertResourceSurfaceParams{
			OrganizationID:       orgID,
			ParentDomain:         notification.ResourceDomainTask,
			ParentResourceID:     taskID,
			SurfaceType:          notification.ResourceSurfaceTypeTaskDiscussion,
			SurfaceDomain:        notification.ResourceSurfaceDomainChatChannel,
			SurfaceResourceID:    dbuuid.UUID(channelID.UUID),
			InheritsSubscription: true,
			CreatedAt:            now,
		}); err != nil {
			slog.WarnContext(ctx, "failed to register task_discussion surface",
				"error", err, "taskID", taskID, "channelID", channelID.UUID,
			)
		}
	}

	if descriptionDocID.Valid {
		if _, err := l.Queries.UpsertResourceSurface(ctx, tx, &database.UpsertResourceSurfaceParams{
			OrganizationID:       orgID,
			ParentDomain:         notification.ResourceDomainTask,
			ParentResourceID:     taskID,
			SurfaceType:          notification.ResourceSurfaceTypeTaskDescription,
			SurfaceDomain:        notification.ResourceSurfaceDomainDocument,
			SurfaceResourceID:    dbuuid.UUID(descriptionDocID.UUID),
			InheritsSubscription: true,
			CreatedAt:            now,
		}); err != nil {
			slog.WarnContext(ctx, "failed to register task_description surface",
				"error", err, "taskID", taskID, "docID", descriptionDocID.UUID,
			)
		}
	}
}

func (l *logicImpl) notifyTaskWatchers(
	ctx context.Context,
	tx database.DBTX,
	orgID, taskID, actorID dbuuid.UUID,
	notificationType string,
	priority int32,
	isMention bool,
	title, message string,
) {
	if l.NotificationPublisher == nil {
		return
	}

	// Determine policy key and source category from notification type
	policyKey, sourceCategory := taskNotificationPolicy(notificationType, isMention)

	// V2: Resolve recipients from resource_subscription table instead of legacy task_watcher.
	subscribers, err := l.Queries.ListActiveResourceSubscriptionsByResource(ctx, tx, &database.ListActiveResourceSubscriptionsByResourceParams{
		OrganizationID: orgID,
		ResourceDomain: notification.ResourceDomainTask,
		ResourceID:     taskID,
	})
	if err != nil {
		slog.WarnContext(ctx, "failed to list task subscribers for notification",
			"error", err, "taskID", taskID,
		)
		return
	}

	// Build recipient set from active subscribers, excluding the actor.
	recipientIDs := make([]string, 0, len(subscribers))
	for _, sub := range subscribers {
		empID := dbuuid.UUID(sub.EmployeeID)
		if empID == actorID {
			slog.DebugContext(ctx, "recipient excluded: actor",
				"employeeID", empID.String(), "taskID", taskID.String())
			continue
		}
		// Respect V2 preference level.
		switch sub.PreferenceLevel {
		case notification.NotificationPreferenceMuted:
			slog.DebugContext(ctx, "recipient excluded: muted",
				"employeeID", empID.String(), "taskID", taskID.String())
			continue
		case notification.NotificationPreferenceMentions:
			if !isMention {
				slog.DebugContext(ctx, "recipient excluded: mentions-only, not a mention",
					"employeeID", empID.String(), "taskID", taskID.String())
				continue
			}
		}
		recipientIDs = append(recipientIDs, sub.EmployeeID.String())
	}

	slog.DebugContext(ctx, "task notification recipient resolution",
		"taskID", taskID.String(),
		"notificationType", notificationType,
		"totalSubscribers", len(subscribers),
		"eligibleRecipients", len(recipientIDs),
	)

	if len(recipientIDs) == 0 {
		return
	}

	actionData := map[string]string{
		"taskId": taskID.String(),
	}
	navigationTarget := &rpcv1.NavigationTarget{
		Domain:       notification.SourceDomainProjects,
		ResourceType: "task",
		ResourceId:   taskID.String(),
	}

	task, err := l.Queries.GetTask(ctx, tx, &database.GetTaskParams{
		OrganizationID: orgID,
		ID:             taskID,
	})
	if err != nil {
		slog.WarnContext(ctx, "failed to load task context for notification payload",
			"error", err, "taskID", taskID,
		)
	} else {
		projectID := dbuuid.UUID(task.ProjectID)
		actionData["projectId"] = projectID.String()
		actionData["deepLink"] = fmt.Sprintf("tasks/%s/%s", projectID.String(), taskID.String())
	}

	_, err = l.NotificationPublisher.PublishNotification(ctx, tx, &rpcv1.PublishNotificationRequest{
		Recipients: &rpcv1.NotificationRecipients{
			EmployeeIds: recipientIDs,
		},
		OrganizationId:   orgID.String(),
		SourceDomain:     notification.SourceDomainProjects,
		NotificationType: notificationType,
		Priority:         priority,
		Title:            title,
		Message:          message,
		PolicyKey:        policyKey,
		DeliveryClass:    notification.DeliveryClassPersistent,
		SourceCategory:   sourceCategory,
		ActionData:       actionData,
		NavigationTarget: navigationTarget,
	})
	if err != nil {
		slog.WarnContext(ctx, "failed to publish notification to watchers",
			"error", err,
		)
	}
}

// taskNotificationPolicy maps a notification type to the appropriate policy key and source category.
func taskNotificationPolicy(notificationType string, isMention bool) (policyKey, sourceCategory string) {
	if isMention {
		return notification.PolicyKeyTaskMention, notification.SourceCategoryMention
	}
	switch notificationType {
	case notification.NotificationTypeTaskAssigned:
		return notification.PolicyKeyTaskAssignment, notification.SourceCategorySystem
	case notification.NotificationTypeTaskCommented:
		return notification.PolicyKeyTaskComment, notification.SourceCategoryActivity
	case notification.NotificationTypeTaskStatusChanged:
		return notification.PolicyKeyTaskStatus, notification.SourceCategoryActivity
	case notification.NotificationTypeTaskDescriptionModified:
		return notification.PolicyKeyTaskDescriptionModified, notification.SourceCategoryActivity
	case notification.NotificationTypeTaskUpdated:
		return notification.PolicyKeyTaskUpdate, notification.SourceCategoryActivity
	default:
		return notification.PolicyKeyPersistentDefault, notification.SourceCategoryActivity
	}
}

func stringToAssigneeRoleProto(s string) rpcv1.TaskAssigneeRole {
	switch s {
	case TaskAssigneeRoleAssignee:
		return rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_ASSIGNEE
	case TaskAssigneeRoleReviewer:
		return rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_REVIEWER
	case TaskAssigneeRoleApprover:
		return rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_APPROVER
	default:
		return rpcv1.TaskAssigneeRole_TASK_ASSIGNEE_ROLE_UNSPECIFIED
	}
}

func customFieldValueToProto(v *database.ListCustomFieldValuesRow) *rpcv1.CustomFieldValue {
	result := &rpcv1.CustomFieldValue{
		FieldId:   v.FieldDefinitionID.String(),
		FieldName: v.FieldName,
		FieldType: stringToFieldTypeProto(v.FieldType),
	}

	// Parse JSONB value and set appropriate oneof field
	if err := setCustomFieldValueOneof(result, v.Value, v.FieldType); err != nil {
		slog.Warn("failed to parse custom field value JSON",
			"error", err,
			"fieldType", v.FieldType,
			"fieldName", v.FieldName,
			"valueBytes", string(v.Value),
			"valueLength", len(v.Value),
		)
		// Leave value unset (nil oneof) on error
	}

	return result
}

func stringToFieldTypeProto(s string) rpcv1.CustomFieldType {
	switch s {
	case CustomFieldTypeText:
		return rpcv1.CustomFieldType_CUSTOM_FIELD_TYPE_TEXT
	case CustomFieldTypeNumber:
		return rpcv1.CustomFieldType_CUSTOM_FIELD_TYPE_NUMBER
	case CustomFieldTypeSingleSelect:
		return rpcv1.CustomFieldType_CUSTOM_FIELD_TYPE_SINGLE_SELECT
	case CustomFieldTypeMultiSelect:
		return rpcv1.CustomFieldType_CUSTOM_FIELD_TYPE_MULTI_SELECT
	case CustomFieldTypeDate:
		return rpcv1.CustomFieldType_CUSTOM_FIELD_TYPE_DATE
	case CustomFieldTypeUser:
		return rpcv1.CustomFieldType_CUSTOM_FIELD_TYPE_USER
	case CustomFieldTypeCheckbox:
		return rpcv1.CustomFieldType_CUSTOM_FIELD_TYPE_CHECKBOX
	default:
		return rpcv1.CustomFieldType_CUSTOM_FIELD_TYPE_UNSPECIFIED
	}
}

// setCustomFieldValueOneof parses stored JSON value and sets the appropriate oneof field
func setCustomFieldValueOneof(result *rpcv1.CustomFieldValue, valueJSON []byte, fieldType string) error {
	// Handle null/empty values
	if len(valueJSON) == 0 || string(valueJSON) == "null" {
		return nil // Leave oneof unset
	}

	slog.Debug("setCustomFieldValueOneof",
		"fieldType", fieldType,
		"valueJSON", string(valueJSON),
	)

	// First, unmarshal the outer JSON layer (values are stored as JSON strings)
	var rawValue string
	if err := json.Unmarshal(valueJSON, &rawValue); err != nil {
		// If it's not a JSON string, try parsing directly (for backward compatibility)
		slog.Debug("not a JSON string, trying direct parse", "error", err)
		return setCustomFieldValueOneofDirect(result, valueJSON, fieldType)
	}

	slog.Debug("unwrapped JSON string", "rawValue", rawValue)

	// Now parse the unwrapped value based on field type
	switch fieldType {
	case CustomFieldTypeText, CustomFieldTypeSingleSelect, CustomFieldTypeDate, CustomFieldTypeUser:
		// String types - set stringValue
		result.Value = &rpcv1.FieldValue{
			Value: &rpcv1.FieldValue_StringValue{StringValue: rawValue},
		}
		return nil

	case CustomFieldTypeNumber:
		// Parse string to float64 and set numberValue
		n, err := strconv.ParseFloat(rawValue, 64)
		if err != nil {
			return fmt.Errorf("failed to parse number value: %w", err)
		}
		result.Value = &rpcv1.FieldValue{
			Value: &rpcv1.FieldValue_NumberValue{NumberValue: n},
		}
		return nil

	case CustomFieldTypeCheckbox:
		// Parse string to bool and set boolValue
		b, err := strconv.ParseBool(rawValue)
		if err != nil {
			return fmt.Errorf("failed to parse boolean value: %w", err)
		}
		result.Value = &rpcv1.FieldValue{
			Value: &rpcv1.FieldValue_BoolValue{BoolValue: b},
		}
		return nil

	case CustomFieldTypeMultiSelect:
		// Parse comma-separated string to array and set stringArrayValue
		if rawValue == "" {
			result.Value = &rpcv1.FieldValue{
				Value: &rpcv1.FieldValue_StringArrayValue{
					StringArrayValue: &rpcv1.StringArray{Values: []string{}},
				},
			}
			return nil
		}
		parts := strings.Split(rawValue, ",")
		for i := range parts {
			parts[i] = strings.TrimSpace(parts[i])
		}
		result.Value = &rpcv1.FieldValue{
			Value: &rpcv1.FieldValue_StringArrayValue{
				StringArrayValue: &rpcv1.StringArray{Values: parts},
			},
		}
		return nil

	default:
		return fmt.Errorf("unknown field type: %s", fieldType)
	}
}

// setCustomFieldValueOneofDirect tries to parse JSON value directly and set oneof (for backward compatibility)
func setCustomFieldValueOneofDirect(result *rpcv1.CustomFieldValue, valueJSON []byte, fieldType string) error {
	switch fieldType {
	case CustomFieldTypeText, CustomFieldTypeSingleSelect, CustomFieldTypeDate, CustomFieldTypeUser:
		var s string
		if err := json.Unmarshal(valueJSON, &s); err != nil {
			return fmt.Errorf("failed to parse string value: %w", err)
		}
		result.Value = &rpcv1.FieldValue{
			Value: &rpcv1.FieldValue_StringValue{StringValue: s},
		}
		return nil

	case CustomFieldTypeNumber:
		var n float64
		if err := json.Unmarshal(valueJSON, &n); err != nil {
			return fmt.Errorf("failed to parse number value: %w", err)
		}
		result.Value = &rpcv1.FieldValue{
			Value: &rpcv1.FieldValue_NumberValue{NumberValue: n},
		}
		return nil

	case CustomFieldTypeCheckbox:
		var b bool
		if err := json.Unmarshal(valueJSON, &b); err != nil {
			return fmt.Errorf("failed to parse boolean value: %w", err)
		}
		result.Value = &rpcv1.FieldValue{
			Value: &rpcv1.FieldValue_BoolValue{BoolValue: b},
		}
		return nil

	case CustomFieldTypeMultiSelect:
		var arr []string
		if err := json.Unmarshal(valueJSON, &arr); err != nil {
			return fmt.Errorf("failed to parse array value: %w", err)
		}
		result.Value = &rpcv1.FieldValue{
			Value: &rpcv1.FieldValue_StringArrayValue{
				StringArrayValue: &rpcv1.StringArray{Values: arr},
			},
		}
		return nil

	default:
		return fmt.Errorf("unknown field type: %s", fieldType)
	}
}

func taskKindToString(k *rpcv1.TaskKind) string {
	if k == nil {
		return TaskKindStandard
	}
	switch *k {
	case rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE:
		return TaskKindRitualInstance
	default:
		return TaskKindStandard
	}
}

func stringToTaskKindProto(s string) rpcv1.TaskKind {
	switch s {
	case TaskKindRitualInstance:
		return rpcv1.TaskKind_TASK_KIND_RITUAL_INSTANCE
	default:
		return rpcv1.TaskKind_TASK_KIND_STANDARD
	}
}

// SkipRitualInstance marks a ritual instance task as skipped with a reason.
func (l *logicImpl) SkipRitualInstance(
	ctx context.Context,
	tx database.DBTX,
	orgID, employeeID dbuuid.UUID,
	req *rpcv1.SkipRitualInstanceRequest,
) (*rpcv1.Task, error) {
	taskID := dbuuid.MustParse(req.GetTaskId())

	// Get the task
	task, err := l.Queries.GetTask(ctx, tx, &database.GetTaskParams{
		OrganizationID: orgID,
		ID:             taskID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrTaskNotFound
		}
		return nil, fmt.Errorf("failed to get task: %w", err)
	}

	// Verify it's a ritual instance
	if task.TaskKind != TaskKindRitualInstance {
		return nil, ErrNotRitualInstance
	}

	// Find the 'skipped' state for this project
	states, err := l.Queries.ListProjectStates(ctx, tx, &database.ListProjectStatesParams{
		OrganizationID: orgID,
		ProjectID:      dbuuid.UUID(task.ProjectID),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list project states: %w", err)
	}

	var skippedStateID dbuuid.UUID
	found := false
	for _, s := range states {
		if s.Category == "skipped" {
			skippedStateID = dbuuid.UUID(s.ID)
			found = true
			break
		}
	}
	if !found {
		return nil, fmt.Errorf("no skipped state found for project")
	}

	// Update task with skip reason and skipped state
	now := time.Now()
	updated, err := l.Queries.UpdateTask(ctx, tx, &database.UpdateTaskParams{
		OrganizationID: orgID,
		ID:             taskID,
		UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
		StateID:        dbuuid.UUIDToNullUUID(skippedStateID),
		SkipReason:     pgtype.Text{String: req.GetReason(), Valid: req.GetReason() != ""},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to skip ritual instance: %w", err)
	}

	return l.taskToProto(updated, nil, nil), nil
}
