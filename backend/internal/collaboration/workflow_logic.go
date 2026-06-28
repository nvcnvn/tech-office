package collaboration

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/nvcnvn/tech-office/backend/database"
	dbuuid "github.com/nvcnvn/tech-office/backend/database/dbuuid"
	rpcv1 "github.com/nvcnvn/tech-office/backend/rpc/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

// CreateWorkflowRule creates a new workflow automation rule
func (l *logicImpl) CreateWorkflowRule(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	req *rpcv1.CreateWorkflowRuleRequest,
) (*rpcv1.WorkflowRule, error) {
	slog.DebugContext(ctx, "CreateWorkflowRule",
		"projectID", req.ProjectId,
		"name", req.Name,
	)

	projectID := dbuuid.MustParse(req.ProjectId)
	triggerType := triggerTypeToString(req.TriggerType)
	actionType := actionTypeToString(req.ActionType)

	// Validate trigger and action types
	if !IsValidWorkflowTriggerType(triggerType) {
		return nil, ErrInvalidTriggerType
	}
	if !IsValidWorkflowActionType(actionType) {
		return nil, ErrInvalidActionType
	}

	// Parse trigger state ID
	var triggerStateID dbuuid.NullUUID
	if req.TriggerStateId != nil && *req.TriggerStateId != "" {
		triggerStateID = dbuuid.UUIDToNullUUID(dbuuid.MustParse(*req.TriggerStateId))
	}

	// Parse trigger field ID
	var triggerFieldID dbuuid.NullUUID
	if req.TriggerFieldId != nil && *req.TriggerFieldId != "" {
		triggerFieldID = dbuuid.UUIDToNullUUID(dbuuid.MustParse(*req.TriggerFieldId))
	}

	// Serialize trigger condition
	var triggerCondition []byte
	if req.TriggerCondition != nil {
		var err error
		triggerCondition, err = json.Marshal(req.TriggerCondition.AsMap())
		if err != nil {
			return nil, fmt.Errorf("failed to serialize trigger condition: %w", err)
		}
	}

	// Serialize action payload
	actionPayload, err := json.Marshal(req.ActionPayload)
	if err != nil {
		return nil, fmt.Errorf("failed to serialize action payload: %w", err)
	}

	// Get next position
	position, err := l.Queries.GetNextRulePosition(ctx, tx, &database.GetNextRulePositionParams{
		OrganizationID: orgID,
		ProjectID:      projectID,
	})
	if err != nil {
		position = 0
	}

	// Create rule
	rule, err := l.Queries.CreateWorkflowRule(ctx, tx, &database.CreateWorkflowRuleParams{
		ID:               dbuuid.Must(),
		OrganizationID:   orgID,
		ProjectID:        projectID,
		Name:             req.Name,
		Description:      pgtype.Text{String: req.GetDescription(), Valid: req.Description != nil},
		TriggerType:      triggerType,
		TriggerStateID:   triggerStateID,
		TriggerFieldID:   triggerFieldID,
		TriggerCondition: triggerCondition,
		ActionType:       actionType,
		ActionPayload:    actionPayload,
		Position:         int32(position),
		IsEnabled:        true,
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to create workflow rule",
			"error", err,
		)
		return nil, fmt.Errorf("failed to create workflow rule: %w", err)
	}

	slog.InfoContext(ctx, "workflow rule created successfully",
		"ruleID", rule.ID,
		"name", req.Name,
	)

	return workflowRuleToProto(rule), nil
}

// UpdateWorkflowRule updates a workflow rule
func (l *logicImpl) UpdateWorkflowRule(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	req *rpcv1.UpdateWorkflowRuleRequest,
) (*rpcv1.WorkflowRule, error) {
	slog.DebugContext(ctx, "UpdateWorkflowRule",
		"ruleID", req.RuleId,
	)

	ruleID := dbuuid.MustParse(req.RuleId)
	now := time.Now()

	// Get current rule
	current, err := l.Queries.GetWorkflowRule(ctx, tx, &database.GetWorkflowRuleParams{
		OrganizationID: orgID,
		ID:             ruleID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrWorkflowRuleNotFound
		}
		return nil, fmt.Errorf("failed to get workflow rule: %w", err)
	}

	// Build update params
	name := current.Name
	if req.Name != nil {
		name = *req.Name
	}

	description := current.Description
	if req.Description != nil {
		description = pgtype.Text{String: *req.Description, Valid: true}
	}

	triggerCondition := current.TriggerCondition
	if req.TriggerCondition != nil {
		var err error
		triggerCondition, err = json.Marshal(req.TriggerCondition.AsMap())
		if err != nil {
			return nil, fmt.Errorf("failed to serialize trigger condition: %w", err)
		}
	}

	actionPayload := current.ActionPayload
	if req.ActionPayload != nil {
		var err error
		actionPayload, err = json.Marshal(req.ActionPayload)
		if err != nil {
			return nil, fmt.Errorf("failed to serialize action payload: %w", err)
		}
	}

	isEnabled := current.IsEnabled
	if req.IsEnabled != nil {
		isEnabled = *req.IsEnabled
	}

	position := current.Position
	if req.Position != nil {
		position = *req.Position
	}

	// Update rule
	updated, err := l.Queries.UpdateWorkflowRule(ctx, tx, &database.UpdateWorkflowRuleParams{
		OrganizationID:   orgID,
		ID:               ruleID,
		Name:             pgtype.Text{String: name, Valid: name != ""},
		Description:      description,
		TriggerCondition: triggerCondition,
		ActionPayload:    actionPayload,
		IsEnabled:        pgtype.Bool{Bool: isEnabled, Valid: true},
		Position:         pgtype.Int4{Int32: position, Valid: true},
		UpdatedAt:        pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		slog.ErrorContext(ctx, "failed to update workflow rule",
			"error", err,
		)
		return nil, fmt.Errorf("failed to update workflow rule: %w", err)
	}

	slog.InfoContext(ctx, "workflow rule updated successfully",
		"ruleID", ruleID,
	)

	return workflowRuleToProto(updated), nil
}

// DeleteWorkflowRule deletes a workflow rule
func (l *logicImpl) DeleteWorkflowRule(
	ctx context.Context,
	tx database.DBTX,
	orgID dbuuid.UUID,
	ruleID dbuuid.UUID,
) error {
	slog.DebugContext(ctx, "DeleteWorkflowRule",
		"ruleID", ruleID,
	)

	err := l.Queries.DeleteWorkflowRule(ctx, tx, &database.DeleteWorkflowRuleParams{
		OrganizationID: orgID,
		ID:             ruleID,
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return ErrWorkflowRuleNotFound
		}
		slog.ErrorContext(ctx, "failed to delete workflow rule",
			"error", err,
		)
		return fmt.Errorf("failed to delete workflow rule: %w", err)
	}

	slog.InfoContext(ctx, "workflow rule deleted successfully",
		"ruleID", ruleID,
	)

	return nil
}

// ListWorkflowRules lists all workflow rules for a project
func (l *logicImpl) ListWorkflowRules(
	ctx context.Context,
	tx database.DBTX,
	orgID, projectID dbuuid.UUID,
	includeDisabled bool,
) ([]*rpcv1.WorkflowRule, error) {
	slog.DebugContext(ctx, "ListWorkflowRules",
		"projectID", projectID,
		"includeDisabled", includeDisabled,
	)

	dbRules, err := l.Queries.ListWorkflowRules(ctx, tx, &database.ListWorkflowRulesParams{
		OrganizationID:  orgID,
		ProjectID:       projectID,
		IncludeDisabled: pgtype.Bool{Bool: includeDisabled, Valid: true},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list workflow rules: %w", err)
	}

	rules := make([]*rpcv1.WorkflowRule, len(dbRules))
	for i, r := range dbRules {
		rules[i] = workflowRuleToProto(r)
	}

	return rules, nil
}

// ExecuteRulesForStateTrigger executes all matching rules when a task enters a state
func (l *logicImpl) ExecuteRulesForStateTrigger(
	ctx context.Context,
	tx database.DBTX,
	orgID, projectID, stateID, taskID, triggeredByID dbuuid.UUID,
) ([]*rpcv1.WorkflowRuleExecution, error) {
	slog.DebugContext(ctx, "ExecuteRulesForStateTrigger",
		"projectID", projectID,
		"stateID", stateID,
		"taskID", taskID,
	)

	// Get matching rules for state_entered trigger
	rules, err := l.Queries.GetRulesForStateTrigger(ctx, tx, &database.GetRulesForStateTriggerParams{
		OrganizationID: orgID,
		ProjectID:      projectID,
		TriggerStateID: dbuuid.UUIDToNullUUID(stateID),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get matching rules: %w", err)
	}

	var executions []*rpcv1.WorkflowRuleExecution

	for _, rule := range rules {
		execution, err := l.executeRule(ctx, tx, orgID, dbuuid.UUID(rule.ID), taskID, triggeredByID)
		if err != nil {
			slog.WarnContext(ctx, "failed to execute workflow rule",
				"ruleID", rule.ID,
				"error", err,
			)
		}
		if execution != nil {
			executions = append(executions, execution)
		}
	}

	return executions, nil
}

// executeRule executes a single workflow rule
func (l *logicImpl) executeRule(
	ctx context.Context,
	tx database.DBTX,
	orgID, ruleID, taskID, triggeredByID dbuuid.UUID,
) (*rpcv1.WorkflowRuleExecution, error) {
	startTime := time.Now()

	// Get rule
	rule, err := l.Queries.GetWorkflowRule(ctx, tx, &database.GetWorkflowRuleParams{
		OrganizationID: orgID,
		ID:             ruleID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get rule: %w", err)
	}

	// Parse action payload
	var actionPayload map[string]interface{}
	if err := json.Unmarshal(rule.ActionPayload, &actionPayload); err != nil {
		return nil, fmt.Errorf("failed to parse action payload: %w", err)
	}

	// Execute action based on type
	var execErr error
	switch rule.ActionType {
	case WorkflowActionTypeSetState:
		execErr = l.executeSetStateAction(ctx, tx, orgID, taskID, actionPayload)
	case WorkflowActionTypeSetField:
		execErr = l.executeSetFieldAction(ctx, tx, orgID, taskID, actionPayload)
	case WorkflowActionTypeAssignUser:
		execErr = l.executeAssignUserAction(ctx, tx, orgID, taskID, triggeredByID, actionPayload)
	case WorkflowActionTypeNotify:
		execErr = l.executeNotifyAction(ctx, tx, orgID, taskID, triggeredByID, actionPayload)
	case WorkflowActionTypeCloseTask:
		execErr = l.executeCloseTaskAction(ctx, tx, orgID, taskID)
	default:
		execErr = fmt.Errorf("unknown action type: %s", rule.ActionType)
	}

	durationMs := int32(time.Since(startTime).Milliseconds())

	// Record execution
	status := WorkflowRuleExecutionStatusSuccess
	var errorMessage pgtype.Text
	if execErr != nil {
		status = WorkflowRuleExecutionStatusFailed
		errorMessage = pgtype.Text{String: execErr.Error(), Valid: true}
	}

	_, err = l.Queries.CreateWorkflowRuleExecution(ctx, tx, &database.CreateWorkflowRuleExecutionParams{
		ID:                    dbuuid.Must(),
		OrganizationID:        orgID,
		RuleID:                ruleID,
		TaskID:                taskID,
		Status:                status,
		ErrorMessage:          errorMessage,
		TriggeredByEmployeeID: triggeredByID,
		DurationMs:            pgtype.Int4{Int32: durationMs, Valid: true},
		ExecutionContext:      []byte("{}"),
	})
	if err != nil {
		slog.WarnContext(ctx, "failed to record rule execution",
			"error", err,
		)
	}

	var errMsg *string
	if execErr != nil {
		s := execErr.Error()
		errMsg = &s
	}

	return &rpcv1.WorkflowRuleExecution{
		RuleId:       ruleID.String(),
		RuleName:     rule.Name,
		Status:       status,
		ErrorMessage: errMsg,
	}, execErr
}

func (l *logicImpl) executeSetStateAction(
	ctx context.Context,
	tx database.DBTX,
	orgID, taskID dbuuid.UUID,
	payload map[string]interface{},
) error {
	stateIDStr, ok := payload["stateId"].(string)
	if !ok {
		return fmt.Errorf("stateId not found in payload")
	}

	stateID := dbuuid.MustParse(stateIDStr)
	now := time.Now()

	_, err := l.Queries.UpdateTaskState(ctx, tx, &database.UpdateTaskStateParams{
		OrganizationID: orgID,
		ID:             taskID,
		StateID:        stateID,
		UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
	})

	return err
}

func (l *logicImpl) executeSetFieldAction(
	ctx context.Context,
	tx database.DBTX,
	orgID, taskID dbuuid.UUID,
	payload map[string]interface{},
) error {
	fieldIDStr, ok := payload["fieldId"].(string)
	if !ok {
		return fmt.Errorf("fieldId not found in payload")
	}

	value, ok := payload["value"]
	if !ok {
		return fmt.Errorf("value not found in payload")
	}

	fieldID := dbuuid.MustParse(fieldIDStr)
	valueBytes, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("failed to serialize value: %w", err)
	}

	_, err = l.SetCustomFieldValue(ctx, tx, orgID, taskID, fieldID, string(valueBytes))
	return err
}

func (l *logicImpl) executeAssignUserAction(
	ctx context.Context,
	tx database.DBTX,
	orgID, taskID, triggeredByID dbuuid.UUID,
	payload map[string]interface{},
) error {
	employeeIDStr, ok := payload["employeeId"].(string)
	if !ok {
		return fmt.Errorf("employeeId not found in payload")
	}

	role, ok := payload["role"].(string)
	if !ok {
		role = TaskAssigneeRoleAssignee
	}

	employeeID := dbuuid.MustParse(employeeIDStr)
	_, err := l.AssignTask(ctx, tx, orgID, triggeredByID, taskID, employeeID, role)
	return err
}

func (l *logicImpl) executeNotifyAction(
	ctx context.Context,
	tx database.DBTX,
	orgID, taskID, triggeredByID dbuuid.UUID,
	payload map[string]interface{},
) error {
	title, _ := payload["title"].(string)
	message, _ := payload["message"].(string)

	if title == "" {
		title = "Workflow notification"
	}

	l.notifyTaskWatchers(ctx, tx, orgID, taskID, triggeredByID,
		NotificationTypeTaskStatusChanged, 1, false,
		title, message)
	return nil
}

func (l *logicImpl) executeCloseTaskAction(
	ctx context.Context,
	tx database.DBTX,
	orgID, taskID dbuuid.UUID,
) error {
	// Get task's project
	task, err := l.Queries.GetTask(ctx, tx, &database.GetTaskParams{
		OrganizationID: orgID,
		ID:             taskID,
	})
	if err != nil {
		return fmt.Errorf("failed to get task: %w", err)
	}

	// Find a closed state in the project
	states, err := l.Queries.ListProjectStates(ctx, tx, &database.ListProjectStatesParams{
		OrganizationID: orgID,
		ProjectID:      dbuuid.UUID(task.ProjectID),
	})
	if err != nil {
		return fmt.Errorf("failed to list project states: %w", err)
	}

	var closedStateID dbuuid.UUID
	for _, state := range states {
		if state.IsClosed {
			closedStateID = dbuuid.UUID(state.ID)
			break
		}
	}

	if closedStateID == (dbuuid.UUID{}) {
		return fmt.Errorf("no closed state found for project")
	}

	now := time.Now()
	_, err = l.Queries.UpdateTaskState(ctx, tx, &database.UpdateTaskStateParams{
		OrganizationID: orgID,
		ID:             taskID,
		StateID:        closedStateID,
		UpdatedAt:      pgtype.Timestamptz{Time: now, Valid: true},
	})

	return err
}

// ============================================================================
// Helper Functions
// ============================================================================

func workflowRuleToProto(r *database.CollaborationWorkflowRule) *rpcv1.WorkflowRule {
	rule := &rpcv1.WorkflowRule{
		Id:          r.ID.String(),
		ProjectId:   r.ProjectID.String(),
		Name:        r.Name,
		TriggerType: stringToTriggerTypeProto(r.TriggerType),
		ActionType:  stringToActionTypeProto(r.ActionType),
		Position:    r.Position,
		IsEnabled:   r.IsEnabled,
	}

	if r.Description.Valid {
		rule.Description = r.Description.String
	}

	if r.TriggerStateID.Valid {
		s := r.TriggerStateID.UUID.String()
		rule.TriggerStateId = &s
	}

	if r.TriggerFieldID.Valid {
		s := r.TriggerFieldID.UUID.String()
		rule.TriggerFieldId = &s
	}

	if len(r.TriggerCondition) > 0 {
		var condMap map[string]interface{}
		if err := json.Unmarshal(r.TriggerCondition, &condMap); err == nil {
			if pbStruct, err := structpb.NewStruct(condMap); err == nil {
				rule.TriggerCondition = pbStruct
			}
		}
	}

	if len(r.ActionPayload) > 0 {
		var payloadMap map[string]interface{}
		if err := json.Unmarshal(r.ActionPayload, &payloadMap); err == nil {
			if pbStruct, err := structpb.NewStruct(payloadMap); err == nil {
				rule.ActionPayload = pbStruct
			}
		}
	}

	return rule
}

func triggerTypeToString(t rpcv1.WorkflowTriggerType) string {
	switch t {
	case rpcv1.WorkflowTriggerType_WORKFLOW_TRIGGER_TYPE_STATE_ENTERED:
		return WorkflowTriggerTypeStateEntered
	case rpcv1.WorkflowTriggerType_WORKFLOW_TRIGGER_TYPE_STATE_EXITED:
		return WorkflowTriggerTypeStateExited
	case rpcv1.WorkflowTriggerType_WORKFLOW_TRIGGER_TYPE_FIELD_CHANGED:
		return WorkflowTriggerTypeFieldChanged
	case rpcv1.WorkflowTriggerType_WORKFLOW_TRIGGER_TYPE_TASK_CREATED:
		return WorkflowTriggerTypeTaskCreated
	default:
		return ""
	}
}

func actionTypeToString(t rpcv1.WorkflowActionType) string {
	switch t {
	case rpcv1.WorkflowActionType_WORKFLOW_ACTION_TYPE_SET_STATE:
		return WorkflowActionTypeSetState
	case rpcv1.WorkflowActionType_WORKFLOW_ACTION_TYPE_SET_FIELD:
		return WorkflowActionTypeSetField
	case rpcv1.WorkflowActionType_WORKFLOW_ACTION_TYPE_ASSIGN_USER:
		return WorkflowActionTypeAssignUser
	case rpcv1.WorkflowActionType_WORKFLOW_ACTION_TYPE_NOTIFY:
		return WorkflowActionTypeNotify
	case rpcv1.WorkflowActionType_WORKFLOW_ACTION_TYPE_CLOSE_TASK:
		return WorkflowActionTypeCloseTask
	default:
		return ""
	}
}

func stringToTriggerTypeProto(s string) rpcv1.WorkflowTriggerType {
	switch s {
	case WorkflowTriggerTypeStateEntered:
		return rpcv1.WorkflowTriggerType_WORKFLOW_TRIGGER_TYPE_STATE_ENTERED
	case WorkflowTriggerTypeStateExited:
		return rpcv1.WorkflowTriggerType_WORKFLOW_TRIGGER_TYPE_STATE_EXITED
	case WorkflowTriggerTypeFieldChanged:
		return rpcv1.WorkflowTriggerType_WORKFLOW_TRIGGER_TYPE_FIELD_CHANGED
	case WorkflowTriggerTypeTaskCreated:
		return rpcv1.WorkflowTriggerType_WORKFLOW_TRIGGER_TYPE_TASK_CREATED
	default:
		return rpcv1.WorkflowTriggerType_WORKFLOW_TRIGGER_TYPE_UNSPECIFIED
	}
}

func stringToActionTypeProto(s string) rpcv1.WorkflowActionType {
	switch s {
	case WorkflowActionTypeSetState:
		return rpcv1.WorkflowActionType_WORKFLOW_ACTION_TYPE_SET_STATE
	case WorkflowActionTypeSetField:
		return rpcv1.WorkflowActionType_WORKFLOW_ACTION_TYPE_SET_FIELD
	case WorkflowActionTypeAssignUser:
		return rpcv1.WorkflowActionType_WORKFLOW_ACTION_TYPE_ASSIGN_USER
	case WorkflowActionTypeNotify:
		return rpcv1.WorkflowActionType_WORKFLOW_ACTION_TYPE_NOTIFY
	case WorkflowActionTypeCloseTask:
		return rpcv1.WorkflowActionType_WORKFLOW_ACTION_TYPE_CLOSE_TASK
	default:
		return rpcv1.WorkflowActionType_WORKFLOW_ACTION_TYPE_UNSPECIFIED
	}
}
