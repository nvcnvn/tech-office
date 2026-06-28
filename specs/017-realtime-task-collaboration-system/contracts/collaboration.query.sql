-- Collaboration SQL Queries
-- For use with sqlc code generation
-- File: backend/database/scripts/collaboration.query.sql

-- =============================================================================
-- PROJECT QUERIES
-- =============================================================================

-- name: CreateProject :one
INSERT INTO collaboration.project (
    id, organization_id, name, key, description, visibility, owner_employee_id
) VALUES (
    $1, $2, $3, $4, $5, $6, $7
)
RETURNING *;

-- name: GetProject :one
SELECT * FROM collaboration.project
WHERE organization_id = $1 AND id = $2;

-- name: GetProjectByKey :one
SELECT * FROM collaboration.project
WHERE organization_id = $1 AND key = $2;

-- name: UpdateProject :one
UPDATE collaboration.project
SET 
    name = COALESCE(sqlc.narg('name'), name),
    description = COALESCE(sqlc.narg('description'), description),
    visibility = COALESCE(sqlc.narg('visibility'), visibility),
    updated_at = $3
WHERE organization_id = $1 AND id = $2
RETURNING *;

-- name: ListProjects :many
SELECT p.* FROM collaboration.project p
WHERE p.organization_id = $1
  AND (sqlc.narg('include_archived')::boolean IS TRUE OR p.is_archived = FALSE)
  AND (sqlc.narg('cursor')::uuid IS NULL OR p.id < sqlc.narg('cursor'))
ORDER BY p.updated_at DESC, p.id DESC
LIMIT $2;

-- name: ListProjectsForMember :many
SELECT p.* FROM collaboration.project p
JOIN collaboration.project_membership pm ON pm.organization_id = p.organization_id AND pm.project_id = p.id
WHERE p.organization_id = $1
  AND pm.employee_id = $2
  AND (sqlc.narg('include_archived')::boolean IS TRUE OR p.is_archived = FALSE)
  AND (sqlc.narg('cursor')::uuid IS NULL OR p.id < sqlc.narg('cursor'))
ORDER BY p.updated_at DESC, p.id DESC
LIMIT $3;

-- name: ArchiveProject :one
UPDATE collaboration.project
SET is_archived = $3, updated_at = $4
WHERE organization_id = $1 AND id = $2
RETURNING *;

-- name: IncrementProjectTaskNumber :one
UPDATE collaboration.project
SET next_task_number = next_task_number + 1, updated_at = $3
WHERE organization_id = $1 AND id = $2
RETURNING key, next_task_number;

-- name: IncrementProjectMemberCount :exec
UPDATE collaboration.project
SET member_count = member_count + $3, updated_at = $4
WHERE organization_id = $1 AND id = $2;

-- name: IncrementProjectTaskCount :exec
UPDATE collaboration.project
SET task_count = task_count + $3, updated_at = $4
WHERE organization_id = $1 AND id = $2;

-- =============================================================================
-- PROJECT STATE QUERIES
-- =============================================================================

-- name: CreateProjectState :one
INSERT INTO collaboration.project_state (
    id, organization_id, project_id, name, color, category, position, is_initial, is_closed
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9
)
RETURNING *;

-- name: GetProjectState :one
SELECT * FROM collaboration.project_state
WHERE organization_id = $1 AND id = $2;

-- name: GetInitialState :one
SELECT * FROM collaboration.project_state
WHERE organization_id = $1 AND project_id = $2 AND is_initial = TRUE
LIMIT 1;

-- name: UpdateProjectState :one
UPDATE collaboration.project_state
SET 
    name = COALESCE(sqlc.narg('name'), name),
    color = COALESCE(sqlc.narg('color'), color),
    category = COALESCE(sqlc.narg('category'), category),
    is_initial = COALESCE(sqlc.narg('is_initial'), is_initial),
    is_closed = COALESCE(sqlc.narg('is_closed'), is_closed),
    updated_at = $3
WHERE organization_id = $1 AND id = $2
RETURNING *;

-- name: UpdateProjectStatePosition :exec
UPDATE collaboration.project_state
SET position = $3, updated_at = $4
WHERE organization_id = $1 AND id = $2;

-- name: DeleteProjectState :exec
DELETE FROM collaboration.project_state
WHERE organization_id = $1 AND id = $2;

-- name: ListProjectStates :many
SELECT * FROM collaboration.project_state
WHERE organization_id = $1 AND project_id = $2
ORDER BY position ASC;

-- name: CountTasksInState :one
SELECT COUNT(*) FROM collaboration.task
WHERE organization_id = $1 AND state_id = $2 AND is_deleted = FALSE;

-- name: MigrateTasksToState :exec
UPDATE collaboration.task
SET state_id = $3, updated_at = $4
WHERE organization_id = $1 AND state_id = $2 AND is_deleted = FALSE;

-- name: ClearInitialState :exec
UPDATE collaboration.project_state
SET is_initial = FALSE, updated_at = $3
WHERE organization_id = $1 AND project_id = $2 AND is_initial = TRUE;

-- =============================================================================
-- TASK LEVEL QUERIES
-- =============================================================================

-- name: CreateTaskLevel :one
INSERT INTO collaboration.task_level (
    id, organization_id, project_id, name, icon, color, depth
) VALUES (
    $1, $2, $3, $4, $5, $6, $7
)
RETURNING *;

-- name: GetTaskLevel :one
SELECT * FROM collaboration.task_level
WHERE organization_id = $1 AND id = $2;

-- name: UpdateTaskLevel :one
UPDATE collaboration.task_level
SET 
    name = COALESCE(sqlc.narg('name'), name),
    icon = COALESCE(sqlc.narg('icon'), icon),
    color = COALESCE(sqlc.narg('color'), color),
    updated_at = $3
WHERE organization_id = $1 AND id = $2
RETURNING *;

-- name: DeleteTaskLevel :exec
DELETE FROM collaboration.task_level
WHERE organization_id = $1 AND id = $2;

-- name: ListTaskLevels :many
SELECT * FROM collaboration.task_level
WHERE organization_id = $1 AND project_id = $2
ORDER BY depth ASC;

-- name: CountTasksAtLevel :one
SELECT COUNT(*) FROM collaboration.task
WHERE organization_id = $1 AND level_id = $2 AND is_deleted = FALSE;

-- name: MigrateTasksToLevel :exec
UPDATE collaboration.task
SET level_id = $3, updated_at = $4
WHERE organization_id = $1 AND level_id = $2 AND is_deleted = FALSE;

-- =============================================================================
-- TASK QUERIES
-- =============================================================================

-- name: CreateTask :one
INSERT INTO collaboration.task (
    id, organization_id, project_id, identifier, title,
    parent_task_id, depth, path, level_id, state_id,
    start_date, due_date, estimated_hours,
    channel_id, description_document_id,
    reporter_employee_id
) VALUES (
    $1, $2, $3, $4, $5,
    $6, $7, $8, $9, $10,
    $11, $12, $13,
    $14, $15,
    $16
)
RETURNING *;

-- name: GetTask :one
SELECT * FROM collaboration.task
WHERE organization_id = $1 AND id = $2 AND is_deleted = FALSE;

-- name: GetTaskWithProjectInfo :one
SELECT 
    t.*,
    p.key AS project_key,
    p.name AS project_name
FROM collaboration.task t
JOIN collaboration.project p ON p.organization_id = t.organization_id AND p.id = t.project_id
WHERE t.organization_id = $1 AND t.id = $2 AND t.is_deleted = FALSE;

-- name: GetTaskByIdentifier :one
SELECT * FROM collaboration.task
WHERE organization_id = $1 AND project_id = $2 AND identifier = $3 AND is_deleted = FALSE;

-- name: UpdateTask :one
UPDATE collaboration.task
SET 
    title = COALESCE(sqlc.narg('title'), title),
    state_id = COALESCE(sqlc.narg('state_id'), state_id),
    level_id = COALESCE(sqlc.narg('level_id'), level_id),
    parent_task_id = COALESCE(sqlc.narg('parent_task_id'), parent_task_id),
    start_date = COALESCE(sqlc.narg('start_date'), start_date),
    due_date = COALESCE(sqlc.narg('due_date'), due_date),
    estimated_hours = COALESCE(sqlc.narg('estimated_hours'), estimated_hours),
    updated_at = $3
WHERE organization_id = $1 AND id = $2 AND is_deleted = FALSE
RETURNING *;

-- name: UpdateTaskState :one
UPDATE collaboration.task
SET state_id = $3, updated_at = $4
WHERE organization_id = $1 AND id = $2 AND is_deleted = FALSE
RETURNING *;

-- name: UpdateTaskPath :exec
UPDATE collaboration.task
SET depth = $3, path = $4, updated_at = $5
WHERE organization_id = $1 AND id = $2;

-- name: UpdateTaskChannelID :exec
UPDATE collaboration.task
SET channel_id = $3, updated_at = $4
WHERE organization_id = $1 AND id = $2;

-- name: UpdateTaskDescriptionDocID :exec
UPDATE collaboration.task
SET description_document_id = $3, updated_at = $4
WHERE organization_id = $1 AND id = $2;

-- name: UpdateTaskFileIDs :exec
UPDATE collaboration.task
SET file_ids = $3, updated_at = $4
WHERE organization_id = $1 AND id = $2;

-- name: SoftDeleteTask :exec
UPDATE collaboration.task
SET is_deleted = TRUE, updated_at = $3
WHERE organization_id = $1 AND id = $2;

-- name: SoftDeleteTaskChildren :exec
UPDATE collaboration.task
SET is_deleted = TRUE, updated_at = $3
WHERE organization_id = $1 AND $2 = ANY(path) AND is_deleted = FALSE;

-- name: IncrementTaskChildCount :exec
UPDATE collaboration.task
SET child_count = child_count + $3, updated_at = $4
WHERE organization_id = $1 AND id = $2;

-- name: IncrementTaskCommentCount :exec
UPDATE collaboration.task
SET comment_count = comment_count + $3, updated_at = $4
WHERE organization_id = $1 AND id = $2;

-- name: ListTasks :many
SELECT t.* FROM collaboration.task t
WHERE t.organization_id = $1 
  AND t.project_id = $2
  AND t.is_deleted = FALSE
  AND (sqlc.narg('state_id')::uuid IS NULL OR t.state_id = sqlc.narg('state_id'))
  AND (sqlc.narg('level_id')::uuid IS NULL OR t.level_id = sqlc.narg('level_id'))
  AND (sqlc.narg('reporter_employee_id')::uuid IS NULL OR t.reporter_employee_id = sqlc.narg('reporter_employee_id'))
  AND (sqlc.narg('parent_task_id')::uuid IS NULL OR t.parent_task_id = sqlc.narg('parent_task_id'))
  AND (sqlc.narg('root_only')::boolean IS NOT TRUE OR t.parent_task_id IS NULL)
  AND (sqlc.narg('cursor')::uuid IS NULL OR t.id < sqlc.narg('cursor'))
ORDER BY t.updated_at DESC, t.id DESC
LIMIT $3;

-- name: ListTasksByAssignee :many
SELECT t.* FROM collaboration.task t
JOIN collaboration.task_assignee ta ON ta.organization_id = t.organization_id AND ta.task_id = t.id
WHERE t.organization_id = $1 
  AND t.project_id = $2
  AND ta.employee_id = $3
  AND t.is_deleted = FALSE
  AND (sqlc.narg('cursor')::uuid IS NULL OR t.id < sqlc.narg('cursor'))
ORDER BY t.updated_at DESC, t.id DESC
LIMIT $4;

-- name: ListTasksForGantt :many
SELECT t.* FROM collaboration.task t
WHERE t.organization_id = $1 
  AND t.project_id = $2
  AND t.is_deleted = FALSE
  AND (t.start_date IS NOT NULL OR t.due_date IS NOT NULL)
ORDER BY COALESCE(t.start_date, t.due_date) ASC, t.id ASC;

-- name: SearchTasks :many
SELECT t.* FROM collaboration.task t
WHERE t.organization_id = $1 
  AND t.project_id = $2
  AND t.is_deleted = FALSE
  AND (
    t.title &@~ $3 -- PGroonga full-text search
    OR t.identifier ILIKE $4 -- Exact identifier match
  )
ORDER BY t.updated_at DESC
LIMIT $5;

-- name: GetTaskChildren :many
SELECT * FROM collaboration.task
WHERE organization_id = $1 AND parent_task_id = $2 AND is_deleted = FALSE
ORDER BY updated_at DESC;

-- name: GetTaskSubtree :many
SELECT * FROM collaboration.task
WHERE organization_id = $1 AND $2 = ANY(path) AND is_deleted = FALSE
ORDER BY depth ASC, updated_at DESC;

-- =============================================================================
-- TASK ASSIGNEE QUERIES
-- =============================================================================

-- name: CreateTaskAssignee :one
INSERT INTO collaboration.task_assignee (
    id, organization_id, task_id, employee_id, role, assigned_by_employee_id
) VALUES (
    $1, $2, $3, $4, $5, $6
)
RETURNING *;

-- name: DeleteTaskAssignee :exec
DELETE FROM collaboration.task_assignee
WHERE organization_id = $1 AND task_id = $2 AND employee_id = $3
  AND (sqlc.narg('role')::text IS NULL OR role = sqlc.narg('role'));

-- name: ListTaskAssignees :many
SELECT * FROM collaboration.task_assignee
WHERE organization_id = $1 AND task_id = $2
ORDER BY assigned_at ASC;

-- name: GetTaskAssigneeIDs :many
SELECT employee_id FROM collaboration.task_assignee
WHERE organization_id = $1 AND task_id = $2;

-- =============================================================================
-- TASK WATCHER QUERIES
-- =============================================================================

-- name: CreateTaskWatcher :one
INSERT INTO collaboration.task_watcher (
    id, organization_id, task_id, employee_id, watch_reason
) VALUES (
    $1, $2, $3, $4, $5
)
ON CONFLICT (organization_id, task_id, employee_id) DO UPDATE
SET watch_reason = EXCLUDED.watch_reason, watched_at = now()
RETURNING *;

-- name: DeleteTaskWatcher :exec
DELETE FROM collaboration.task_watcher
WHERE organization_id = $1 AND task_id = $2 AND employee_id = $3;

-- name: ListTaskWatchers :many
SELECT * FROM collaboration.task_watcher
WHERE organization_id = $1 AND task_id = $2
ORDER BY watched_at ASC;

-- name: GetTaskWatcherIDs :many
SELECT employee_id FROM collaboration.task_watcher
WHERE organization_id = $1 AND task_id = $2;

-- name: IsWatchingTask :one
SELECT EXISTS(
    SELECT 1 FROM collaboration.task_watcher
    WHERE organization_id = $1 AND task_id = $2 AND employee_id = $3
) AS watching;

-- =============================================================================
-- CUSTOM FIELD DEFINITION QUERIES
-- =============================================================================

-- name: CreateCustomFieldDefinition :one
INSERT INTO collaboration.custom_field_definition (
    id, organization_id, project_id, name, description, field_type,
    options, default_value, is_required, min_value, max_value, position
) VALUES (
    $1, $2, $3, $4, $5, $6,
    $7, $8, $9, $10, $11, $12
)
RETURNING *;

-- name: GetCustomFieldDefinition :one
SELECT * FROM collaboration.custom_field_definition
WHERE organization_id = $1 AND id = $2;

-- name: UpdateCustomFieldDefinition :one
UPDATE collaboration.custom_field_definition
SET 
    name = COALESCE(sqlc.narg('name'), name),
    description = COALESCE(sqlc.narg('description'), description),
    options = COALESCE(sqlc.narg('options'), options),
    default_value = COALESCE(sqlc.narg('default_value'), default_value),
    is_required = COALESCE(sqlc.narg('is_required'), is_required),
    min_value = COALESCE(sqlc.narg('min_value'), min_value),
    max_value = COALESCE(sqlc.narg('max_value'), max_value),
    updated_at = $3
WHERE organization_id = $1 AND id = $2
RETURNING *;

-- name: ArchiveCustomFieldDefinition :one
UPDATE collaboration.custom_field_definition
SET is_archived = $3, updated_at = $4
WHERE organization_id = $1 AND id = $2
RETURNING *;

-- name: ListCustomFieldDefinitions :many
SELECT * FROM collaboration.custom_field_definition
WHERE organization_id = $1 AND project_id = $2
  AND (sqlc.narg('include_archived')::boolean IS TRUE OR is_archived = FALSE)
ORDER BY position ASC;

-- name: GetNextFieldPosition :one
SELECT COALESCE(MAX(position), 0) + 1 AS next_position
FROM collaboration.custom_field_definition
WHERE organization_id = $1 AND project_id = $2;

-- =============================================================================
-- CUSTOM FIELD VALUE QUERIES
-- =============================================================================

-- name: UpsertCustomFieldValue :one
INSERT INTO collaboration.custom_field_value (
    id, organization_id, task_id, field_definition_id, value
) VALUES (
    $1, $2, $3, $4, $5
)
ON CONFLICT (organization_id, task_id, field_definition_id) DO UPDATE
SET value = EXCLUDED.value, updated_at = now()
RETURNING *;

-- name: GetCustomFieldValue :one
SELECT * FROM collaboration.custom_field_value
WHERE organization_id = $1 AND task_id = $2 AND field_definition_id = $3;

-- name: DeleteCustomFieldValue :exec
DELETE FROM collaboration.custom_field_value
WHERE organization_id = $1 AND task_id = $2 AND field_definition_id = $3;

-- name: ListCustomFieldValues :many
SELECT cfv.*, cfd.name AS field_name, cfd.field_type
FROM collaboration.custom_field_value cfv
JOIN collaboration.custom_field_definition cfd 
    ON cfd.organization_id = cfv.organization_id AND cfd.id = cfv.field_definition_id
WHERE cfv.organization_id = $1 AND cfv.task_id = $2
ORDER BY cfd.position ASC;

-- name: ListCustomFieldValuesForTasks :many
SELECT cfv.*, cfd.name AS field_name, cfd.field_type
FROM collaboration.custom_field_value cfv
JOIN collaboration.custom_field_definition cfd 
    ON cfd.organization_id = cfv.organization_id AND cfd.id = cfv.field_definition_id
WHERE cfv.organization_id = $1 AND cfv.task_id = ANY($2::uuid[])
ORDER BY cfv.task_id, cfd.position ASC;

-- =============================================================================
-- WORKFLOW RULE QUERIES
-- =============================================================================

-- name: CreateWorkflowRule :one
INSERT INTO collaboration.workflow_rule (
    id, organization_id, project_id, name, description,
    trigger_type, trigger_state_id, trigger_field_id, trigger_condition,
    action_type, action_payload, position, is_enabled
) VALUES (
    $1, $2, $3, $4, $5,
    $6, $7, $8, $9,
    $10, $11, $12, $13
)
RETURNING *;

-- name: GetWorkflowRule :one
SELECT * FROM collaboration.workflow_rule
WHERE organization_id = $1 AND id = $2;

-- name: UpdateWorkflowRule :one
UPDATE collaboration.workflow_rule
SET 
    name = COALESCE(sqlc.narg('name'), name),
    description = COALESCE(sqlc.narg('description'), description),
    trigger_type = COALESCE(sqlc.narg('trigger_type'), trigger_type),
    trigger_state_id = COALESCE(sqlc.narg('trigger_state_id'), trigger_state_id),
    trigger_field_id = COALESCE(sqlc.narg('trigger_field_id'), trigger_field_id),
    trigger_condition = COALESCE(sqlc.narg('trigger_condition'), trigger_condition),
    action_type = COALESCE(sqlc.narg('action_type'), action_type),
    action_payload = COALESCE(sqlc.narg('action_payload'), action_payload),
    position = COALESCE(sqlc.narg('position'), position),
    is_enabled = COALESCE(sqlc.narg('is_enabled'), is_enabled),
    updated_at = $3
WHERE organization_id = $1 AND id = $2
RETURNING *;

-- name: DeleteWorkflowRule :exec
DELETE FROM collaboration.workflow_rule
WHERE organization_id = $1 AND id = $2;

-- name: ListWorkflowRules :many
SELECT * FROM collaboration.workflow_rule
WHERE organization_id = $1 AND project_id = $2
  AND (sqlc.narg('include_disabled')::boolean IS TRUE OR is_enabled = TRUE)
ORDER BY position ASC;

-- name: GetRulesForStateTrigger :many
SELECT * FROM collaboration.workflow_rule
WHERE organization_id = $1 
  AND project_id = $2
  AND trigger_type = 'state_entered'
  AND trigger_state_id = $3
  AND is_enabled = TRUE
ORDER BY position ASC;

-- name: GetNextRulePosition :one
SELECT COALESCE(MAX(position), 0) + 1 AS next_position
FROM collaboration.workflow_rule
WHERE organization_id = $1 AND project_id = $2;

-- =============================================================================
-- WORKFLOW RULE EXECUTION QUERIES
-- =============================================================================

-- name: CreateWorkflowRuleExecution :one
INSERT INTO collaboration.workflow_rule_execution (
    id, organization_id, rule_id, task_id,
    status, error_message, triggered_by_employee_id,
    execution_context, duration_ms
) VALUES (
    $1, $2, $3, $4,
    $5, $6, $7,
    $8, $9
)
RETURNING *;

-- name: ListWorkflowRuleExecutions :many
SELECT wre.*, wr.name AS rule_name
FROM collaboration.workflow_rule_execution wre
JOIN collaboration.workflow_rule wr ON wr.organization_id = wre.organization_id AND wr.id = wre.rule_id
WHERE wre.organization_id = $1 AND wre.task_id = $2
ORDER BY wre.executed_at DESC
LIMIT $3;

-- =============================================================================
-- PROJECT MEMBERSHIP QUERIES
-- =============================================================================

-- name: CreateProjectMembership :one
INSERT INTO collaboration.project_membership (
    id, organization_id, project_id, employee_id, role,
    notification_preference, invited_by_employee_id
) VALUES (
    $1, $2, $3, $4, $5,
    $6, $7
)
RETURNING *;

-- name: GetProjectMembership :one
SELECT * FROM collaboration.project_membership
WHERE organization_id = $1 AND project_id = $2 AND employee_id = $3;

-- name: UpdateProjectMembershipRole :one
UPDATE collaboration.project_membership
SET role = $4, updated_at = $5
WHERE organization_id = $1 AND project_id = $2 AND employee_id = $3
RETURNING *;

-- name: UpdateProjectMembershipNotificationPref :one
UPDATE collaboration.project_membership
SET notification_preference = $4, updated_at = $5
WHERE organization_id = $1 AND project_id = $2 AND employee_id = $3
RETURNING *;

-- name: DeleteProjectMembership :exec
DELETE FROM collaboration.project_membership
WHERE organization_id = $1 AND project_id = $2 AND employee_id = $3;

-- name: ListProjectMembers :many
SELECT * FROM collaboration.project_membership
WHERE organization_id = $1 AND project_id = $2
ORDER BY joined_at ASC;

-- name: GetProjectMemberIDs :many
SELECT employee_id FROM collaboration.project_membership
WHERE organization_id = $1 AND project_id = $2;

-- name: IsProjectMember :one
SELECT EXISTS(
    SELECT 1 FROM collaboration.project_membership
    WHERE organization_id = $1 AND project_id = $2 AND employee_id = $3
) AS is_member;

-- name: GetProjectMemberRole :one
SELECT role FROM collaboration.project_membership
WHERE organization_id = $1 AND project_id = $2 AND employee_id = $3;

-- =============================================================================
-- SAVED VIEW QUERIES
-- =============================================================================

-- name: CreateSavedView :one
INSERT INTO collaboration.saved_view (
    id, organization_id, project_id, employee_id, name,
    view_type, config, is_default, position
) VALUES (
    $1, $2, $3, $4, $5,
    $6, $7, $8, $9
)
RETURNING *;

-- name: GetSavedView :one
SELECT * FROM collaboration.saved_view
WHERE organization_id = $1 AND id = $2;

-- name: UpdateSavedView :one
UPDATE collaboration.saved_view
SET 
    name = COALESCE(sqlc.narg('name'), name),
    config = COALESCE(sqlc.narg('config'), config),
    is_default = COALESCE(sqlc.narg('is_default'), is_default),
    position = COALESCE(sqlc.narg('position'), position),
    updated_at = $3
WHERE organization_id = $1 AND id = $2
RETURNING *;

-- name: DeleteSavedView :exec
DELETE FROM collaboration.saved_view
WHERE organization_id = $1 AND id = $2;

-- name: ListSavedViews :many
SELECT * FROM collaboration.saved_view
WHERE organization_id = $1 AND project_id = $2
  AND (employee_id IS NULL OR employee_id = $3) -- Shared or owned by user
ORDER BY is_default DESC, position ASC;

-- name: ClearDefaultView :exec
UPDATE collaboration.saved_view
SET is_default = FALSE, updated_at = $4
WHERE organization_id = $1 AND project_id = $2 
  AND (employee_id IS NULL OR employee_id = $3)
  AND is_default = TRUE;

-- name: GetNextViewPosition :one
SELECT COALESCE(MAX(position), 0) + 1 AS next_position
FROM collaboration.saved_view
WHERE organization_id = $1 AND project_id = $2 AND (employee_id IS NULL OR employee_id = $3);

-- =============================================================================
-- ANALYTICS QUERIES
-- =============================================================================

-- name: GetTaskCountsByState :many
SELECT 
    s.id AS state_id,
    s.name AS state_name,
    s.category,
    s.color,
    COUNT(t.id) AS task_count
FROM collaboration.project_state s
LEFT JOIN collaboration.task t ON t.organization_id = s.organization_id 
    AND t.project_id = s.project_id 
    AND t.state_id = s.id 
    AND t.is_deleted = FALSE
WHERE s.organization_id = $1 AND s.project_id = $2
GROUP BY s.id, s.name, s.category, s.color, s.position
ORDER BY s.position ASC;

-- name: GetTaskCountsByAssignee :many
SELECT 
    ta.employee_id,
    COUNT(t.id) AS task_count
FROM collaboration.task_assignee ta
JOIN collaboration.task t ON t.organization_id = ta.organization_id AND t.id = ta.task_id
WHERE t.organization_id = $1 
  AND t.project_id = $2 
  AND t.is_deleted = FALSE
GROUP BY ta.employee_id;

-- name: GetTaskCountsByLevel :many
SELECT 
    l.id AS level_id,
    l.name AS level_name,
    l.color,
    COUNT(t.id) AS task_count
FROM collaboration.task_level l
LEFT JOIN collaboration.task t ON t.organization_id = l.organization_id 
    AND t.project_id = l.project_id 
    AND t.level_id = l.id 
    AND t.is_deleted = FALSE
WHERE l.organization_id = $1 AND l.project_id = $2
GROUP BY l.id, l.name, l.color, l.depth
ORDER BY l.depth ASC;

-- name: GetProjectTaskSummary :one
SELECT 
    COUNT(*) AS total_tasks,
    COUNT(*) FILTER (WHERE s.is_closed = TRUE) AS completed_tasks,
    COUNT(*) FILTER (WHERE s.is_closed = FALSE) AS open_tasks,
    COUNT(*) FILTER (WHERE t.due_date < CURRENT_DATE AND s.is_closed = FALSE) AS overdue_tasks
FROM collaboration.task t
JOIN collaboration.project_state s ON s.organization_id = t.organization_id AND s.id = t.state_id
WHERE t.organization_id = $1 AND t.project_id = $2 AND t.is_deleted = FALSE;
