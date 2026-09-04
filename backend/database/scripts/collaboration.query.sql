-- Collaboration SQL Queries
-- For use with sqlc code generation
-- File: backend/database/scripts/collaboration.query.sql

-- =============================================================================
-- PROJECT QUERIES
-- =============================================================================

-- name: CreateProject :one
INSERT INTO collaboration.project (
    id, organization_id, name, key, description, visibility, owner_employee_id, collaboration_mode
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, COALESCE(sqlc.narg('collaboration_mode'), 'standard')
)
RETURNING *;

-- name: GetProject :one
SELECT * FROM collaboration.project
WHERE organization_id = $1 AND id = $2;

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

-- Returns the updated row so a caller that already holds a pre-increment copy of the
-- project can answer with the count the database now has, instead of the stale one.
-- name: IncrementProjectMemberCount :one
UPDATE collaboration.project
SET member_count = member_count + $3, updated_at = $4
WHERE organization_id = $1 AND id = $2
RETURNING *;

-- name: IncrementProjectTaskCount :exec
UPDATE collaboration.project
SET task_count = task_count + $3, updated_at = $4
WHERE organization_id = $1 AND id = $2;

-- =============================================================================
-- PROJECT STATE QUERIES
-- =============================================================================

-- name: CreateProjectState :one
INSERT INTO collaboration.project_state (
    id, organization_id, project_id, name, color, category, position, is_initial, is_closed, state_type
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
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
    state_type = COALESCE(sqlc.narg('state_type'), state_type),
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
    reporter_employee_id,
    task_kind, ritual_definition_id, scheduled_date, completion_deadline
) VALUES (
    $1, $2, $3, $4, $5,
    $6, $7, $8, $9, $10,
    $11, $12, $13,
    $14, $15,
    $16,
    COALESCE(sqlc.narg('task_kind'), 'standard'),
    sqlc.narg('ritual_definition_id'),
    sqlc.narg('scheduled_date'),
    sqlc.narg('completion_deadline')
)
RETURNING *;

-- name: GetTask :one
SELECT * FROM collaboration.task
WHERE organization_id = $1 AND id = $2 AND is_deleted = FALSE;

-- name: SetTaskOrigin :one
-- Records the chat message a task was created from. Run in the same transaction as the
-- CreateTask that produced the task, so a task never exists with a half-written origin.
-- The CHECK on the table enforces that both halves are set or neither is.
UPDATE collaboration.task
SET source_channel_id = sqlc.narg('source_channel_id'),
    source_message_id = sqlc.narg('source_message_id')
WHERE organization_id = $1 AND id = $2
RETURNING *;

-- name: GetTaskOrigin :one
-- Reads a task back with just its origin columns, for the origin block on task detail.
SELECT id, project_id, source_channel_id, source_message_id
FROM collaboration.task
WHERE organization_id = $1 AND id = $2 AND is_deleted = FALSE;

-- name: ListTasksBySourceMessages :many
-- The batched reverse lookup behind the chip a message carries once it has become a task.
-- One call per rendered page of messages, never one per message; idx_task_source_message
-- is the partial index that makes it cheap.
--
-- Access filtering happens here rather than in Go: a link to a task in a project the
-- caller cannot see is omitted from the result entirely, because returning it with a flag
-- would leak the identifier (FR-021).
--
-- Every join stays inside the collaboration schema. The chat side is only ever the stored
-- source_message_id value, never a join target.
SELECT
    t.id,
    t.source_message_id,
    t.identifier,
    t.title,
    t.project_id,
    ps.name     AS state_name,
    ps.category AS state_category
FROM collaboration.task t
JOIN collaboration.project p
    ON p.organization_id = t.organization_id AND p.id = t.project_id
JOIN collaboration.project_state ps
    ON ps.organization_id = t.organization_id AND ps.id = t.state_id
WHERE t.organization_id = $1
  AND t.source_message_id = ANY(@message_ids::uuid[])
  AND t.is_deleted = FALSE
  AND (
      p.visibility = 'public'
      OR EXISTS (
          SELECT 1 FROM collaboration.project_membership pm
          WHERE pm.organization_id = t.organization_id
            AND pm.project_id = t.project_id
            AND pm.employee_id = @employee_id
      )
  )
ORDER BY t.id;

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
    skip_reason = COALESCE(sqlc.narg('skip_reason'), skip_reason),
    updated_at = $3
WHERE organization_id = $1 AND id = $2 AND is_deleted = FALSE
RETURNING *;

-- name: UpdateTaskState :one
UPDATE collaboration.task
SET state_id = $3, updated_at = $4
WHERE organization_id = $1 AND id = $2 AND is_deleted = FALSE
RETURNING *;

-- name: UpdateRitualTaskStateIfUnchanged :one
-- Compare-and-set used by ritual reconciliation. The expected_state_id predicate is what
-- makes two overlapping passes safe without a lock or an advisory table: the second pass
-- matches zero rows, so it neither rewrites the state nor publishes a second notification.
-- Without it, two passes that read the same row before either wrote would both perform the
-- transition and the recipient would be told twice.
UPDATE collaboration.task
SET state_id = @state_id, updated_at = @updated_at
WHERE organization_id = @organization_id
  AND id = @id
  AND state_id = @expected_state_id
  AND is_deleted = FALSE
RETURNING *;

-- name: AppendTaskFileID :one
UPDATE collaboration.task
SET file_ids = array_append(file_ids, @file_id::uuid), updated_at = @updated_at
WHERE organization_id = @organization_id AND id = @task_id
RETURNING *;

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
  AND (sqlc.narg('task_kind')::text IS NULL OR t.task_kind = sqlc.narg('task_kind'))
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

-- name: GetAssignedWorkSummaryCounts :one
SELECT
  COUNT(*) FILTER (WHERE urgency_bucket = 'due_today')::int AS due_today_count,
  COUNT(*) FILTER (WHERE urgency_bucket = 'overdue')::int AS overdue_count
FROM (
  -- A ritual instance's lateness is its stored state, not a date comparison: the
  -- reconciliation sweep is the authority. The OR keeps standard tasks working
  -- unchanged, since standard projects have no 'overdue' state to match.
  SELECT CASE
    WHEN ps.category = 'overdue' OR t.due_date < sqlc.arg(as_of_date)::date THEN 'overdue'
    ELSE 'due_today'
  END AS urgency_bucket
  FROM collaboration.task t
  JOIN collaboration.task_assignee ta
    ON ta.organization_id = t.organization_id
   AND ta.task_id = t.id
  JOIN collaboration.project_state ps
    ON ps.organization_id = t.organization_id
   AND ps.id = t.state_id
  WHERE t.organization_id = sqlc.arg(organization_id)
    AND ta.employee_id = sqlc.arg(employee_id)
    AND ta.role = 'assignee'
    AND t.is_deleted = FALSE
    AND ps.is_closed = FALSE
    AND t.due_date IS NOT NULL
    AND t.due_date <= sqlc.arg(as_of_date)::date
    AND (sqlc.arg(include_ritual_instances)::boolean OR t.task_kind <> 'ritual_instance')
) filtered;

-- name: ListAssignedWorkSummaryItems :many
SELECT
  t.id AS task_id,
  t.project_id,
  p.key AS project_key,
  t.title,
  t.due_date,
  -- Same rule as GetAssignedWorkSummaryCounts: the stored state wins for rituals.
  CASE
    WHEN ps.category = 'overdue' OR t.due_date < sqlc.arg(as_of_date)::date THEN 'overdue'
    ELSE 'due_today'
  END AS urgency_bucket,
  ps.name AS state_name
FROM collaboration.task t
JOIN collaboration.task_assignee ta
  ON ta.organization_id = t.organization_id
 AND ta.task_id = t.id
JOIN collaboration.project_state ps
  ON ps.organization_id = t.organization_id
 AND ps.id = t.state_id
JOIN collaboration.project p
  ON p.organization_id = t.organization_id
 AND p.id = t.project_id
WHERE t.organization_id = sqlc.arg(organization_id)
  AND ta.employee_id = sqlc.arg(employee_id)
  AND ta.role = 'assignee'
  AND t.is_deleted = FALSE
  AND ps.is_closed = FALSE
  AND t.due_date IS NOT NULL
  AND t.due_date <= sqlc.arg(as_of_date)::date
  AND (sqlc.arg(include_ritual_instances)::boolean OR t.task_kind <> 'ritual_instance')
ORDER BY
  CASE WHEN ps.category = 'overdue' OR t.due_date < sqlc.arg(as_of_date)::date THEN 0 ELSE 1 END,
  t.due_date ASC,
  t.updated_at DESC,
  t.id DESC
LIMIT sqlc.arg(item_limit);

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
    id, organization_id, task_id, field_definition_id, value, updated_at
) VALUES (
    $1, $2, $3, $4, $5, $6
)
ON CONFLICT (organization_id, task_id, field_definition_id) DO UPDATE
SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
RETURNING *;

-- name: GetCustomFieldValue :one
SELECT * FROM collaboration.custom_field_value
WHERE organization_id = $1 AND task_id = $2 AND field_definition_id = $3;

-- name: ListCustomFieldValues :many
SELECT cfv.*, cfd.name AS field_name, cfd.field_type
FROM collaboration.custom_field_value cfv
JOIN collaboration.custom_field_definition cfd 
    ON cfd.organization_id = cfv.organization_id AND cfd.id = cfv.field_definition_id
WHERE cfv.organization_id = $1 AND cfv.task_id = $2
ORDER BY cfd.position ASC;

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

-- ============================================================================
-- Task Watcher Preference-Aware Queries
-- ============================================================================

-- ============================================================================
-- Task Recipient Eligibility Queries (for notification targeting)
-- ============================================================================

-- name: GetTaskSummariesByChannelIDs :many
-- Returns task summary info for channels that are task discussion surfaces.
-- Used by ListRecentChannels to enrich task channels with linked resource metadata.
SELECT
    t.id::uuid AS task_id,
    t.project_id::uuid AS project_id,
    t.channel_id::uuid AS channel_id,
    t.identifier AS identifier,
    t.title AS title
FROM collaboration.task t
WHERE t.organization_id = @organization_id
  AND t.channel_id = ANY(@channel_ids::uuid[])
  AND t.is_deleted = FALSE;

-- ============================================================
-- RITUAL DEFINITION QUERIES
-- ============================================================

-- name: CreateRitualDefinition :one
INSERT INTO collaboration.ritual_definition (
    id, organization_id, project_id, name, description,
    recurrence_rule, completion_window_hours, timezone,
    created_by_employee_id, generation_window_days, updated_at,
    procedure_document_id
) VALUES (
    @id, @organization_id, @project_id, @name, @description,
    @recurrence_rule, @completion_window_hours, @timezone,
    @created_by_employee_id, @generation_window_days, @updated_at,
    sqlc.narg('procedure_document_id')
) RETURNING *;

-- name: GetRitualDefinition :one
SELECT * FROM collaboration.ritual_definition
WHERE organization_id = @organization_id AND id = @id;

-- name: UpdateRitualDefinition :one
UPDATE collaboration.ritual_definition
SET name = COALESCE(sqlc.narg('name'), name),
    description = COALESCE(sqlc.narg('description'), description),
    recurrence_rule = COALESCE(sqlc.narg('recurrence_rule'), recurrence_rule),
    completion_window_hours = COALESCE(sqlc.narg('completion_window_hours'), completion_window_hours),
    timezone = COALESCE(sqlc.narg('timezone'), timezone),
    generation_window_days = COALESCE(sqlc.narg('generation_window_days'), generation_window_days),
    -- Three-valued, and therefore not a COALESCE: COALESCE cannot express "set this to
    -- NULL". update_procedure = false leaves the attachment alone (the field was absent
    -- from the request); true with a NULL id detaches; true with an id attaches or
    -- replaces.
    procedure_document_id = CASE
        WHEN sqlc.arg('update_procedure')::boolean THEN sqlc.narg('procedure_document_id')::uuid
        ELSE procedure_document_id
    END,
    updated_at = @updated_at
WHERE organization_id = @organization_id AND id = @id
RETURNING *;

-- name: ArchiveRitualDefinition :one
-- Unarchiving clears the generation waterline. Archiving soft-deletes every pending
-- instance, so a restored definition whose last_generated_date still pointed at the end of
-- the old window produced nothing until real time caught up — up to generation_window_days
-- of a ritual that reads as active and generates no runs.
UPDATE collaboration.ritual_definition
SET is_archived = @is_archived,
    last_generated_date = CASE WHEN @is_archived THEN last_generated_date ELSE NULL END,
    updated_at = @updated_at
WHERE organization_id = @organization_id AND id = @id
RETURNING *;

-- name: SoftDeletePendingRitualInstances :exec
UPDATE collaboration.task t
SET is_deleted = TRUE, updated_at = NOW()
WHERE t.organization_id = @organization_id
  AND t.ritual_definition_id = @ritual_definition_id
  AND t.task_kind = 'ritual_instance'
  AND t.is_deleted = FALSE
  AND t.state_id IN (
    SELECT ps.id FROM collaboration.project_state ps
    WHERE ps.organization_id = t.organization_id
      AND ps.project_id = t.project_id
      AND ps.category IN ('scheduled', 'todo')
  );

-- name: ListRitualDefinitions :many
SELECT * FROM collaboration.ritual_definition
WHERE organization_id = @organization_id
  AND project_id = @project_id
  AND (sqlc.arg('include_archived')::boolean = TRUE OR is_archived = FALSE)
ORDER BY name ASC;

-- name: ListActiveRitualDefinitionsForGeneration :many
SELECT * FROM collaboration.ritual_definition
WHERE organization_id = @organization_id
  AND is_archived = FALSE
  AND (last_generated_date IS NULL OR last_generated_date < sqlc.arg('target_date')::date + generation_window_days)
ORDER BY id;

-- lint:cross-tenant scheduler sweep — the organization list is the result, so it cannot be the input
-- name: ListOrganizationIDsWithActiveRitualDefinitions :many
-- System-scope background query for the global ritual sweep. Intentionally NOT filtered by
-- organization_id: its purpose is to discover which organizations to sweep. Returns only
-- organization IDs and a per-organization active-definition count, no tenant row data, and
-- runs on AdminPool. See Constitution Principle I ("Use AdminPool ONLY for system operations
-- (requires documented justification)"). The count exists so the sweep can report
-- definitions processed (FR-014) without a second query per organization.
-- ponytail: cross-shard scan each sweep; cost scales with organization count, not ritual
-- count. If it becomes measurable, narrow to organizations with definitions actually due
-- (last_generated_date < target_date + generation_window_days) or cache between sweeps.
SELECT organization_id, count(*)::int AS definition_count
FROM collaboration.ritual_definition
WHERE is_archived = FALSE
GROUP BY organization_id
ORDER BY organization_id;

-- lint:cross-tenant reconciliation sweep — the organization list is the result, so it cannot be the input
-- name: ListOrganizationIDsWithReconcilableRitualInstances :many
-- System-scope background query for the ritual reconciliation sweep. Intentionally NOT
-- filtered by organization_id: its purpose is to discover which organizations to sweep.
-- Returns only organization IDs, no tenant row data, and runs on AdminPool. See
-- Constitution Principle I ("Use AdminPool ONLY for system operations (requires documented
-- justification)").
--
-- The shared candidate predicate, used verbatim by ListRitualInstancesForReconciliation:
--   task_kind = 'ritual_instance'   standard tasks are never reconciled
--   is_deleted = FALSE              deleted instances are not work
--   detached_from_ritual = FALSE    FR-004: a detached instance is no longer a ritual
--   completion_deadline IS NOT NULL FR-005: no deadline means never late
--   completion_deadline < now       the lateness threshold itself
--   ps.category IN (scheduled, todo, in_progress, overdue)
--       'submitted' is absent because fully submitted evidence awaiting review is the
--       reviewer's delay, not the worker's; 'verified', 'missed' and 'skipped' are
--       terminal (FR-003, FR-004); 'overdue' is present because that is how an instance
--       reaches 'missed'.
--
-- There is deliberately NO join to collaboration.ritual_definition: an instance outlives
-- its definition's archival and must still be reconciled (FR-009).
-- ponytail: cross-shard scan each sweep; cost scales with the number of late instances.
-- If it becomes measurable, add a partial index on (organization_id, completion_deadline)
-- WHERE task_kind = 'ritual_instance' AND is_deleted = FALSE.
SELECT DISTINCT t.organization_id
FROM collaboration.task t
JOIN collaboration.project_state ps
  ON ps.organization_id = t.organization_id AND ps.id = t.state_id
WHERE t.task_kind = 'ritual_instance'
  AND t.is_deleted = FALSE
  AND t.detached_from_ritual = FALSE
  AND t.completion_deadline IS NOT NULL
  AND t.completion_deadline < @now
  AND ps.category IN ('scheduled', 'todo', 'in_progress', 'overdue')
ORDER BY t.organization_id;

-- name: ListRitualInstancesForReconciliation :many
-- Organization-scoped counterpart to ListOrganizationIDsWithReconcilableRitualInstances.
-- Same candidate predicate (documented in full on that query), plus the per-pass bound.
-- Ascending completion_deadline makes a partially drained backlog progress strictly:
-- the oldest late instances are always reconciled first (FR-013).
SELECT t.*
FROM collaboration.task t
JOIN collaboration.project_state ps
  ON ps.organization_id = t.organization_id AND ps.id = t.state_id
WHERE t.organization_id = @organization_id
  AND t.task_kind = 'ritual_instance'
  AND t.is_deleted = FALSE
  AND t.detached_from_ritual = FALSE
  AND t.completion_deadline IS NOT NULL
  AND t.completion_deadline < @now
  AND ps.category IN ('scheduled', 'todo', 'in_progress', 'overdue')
ORDER BY t.completion_deadline ASC, t.id ASC
LIMIT @instance_limit;

-- name: UpdateRitualDefinitionLastGenerated :exec
UPDATE collaboration.ritual_definition
SET last_generated_date = @last_generated_date, updated_at = @updated_at
WHERE organization_id = @organization_id AND id = @id;

-- ============================================================
-- RITUAL DEFINITION ASSIGNEE QUERIES
-- ============================================================

-- name: CreateRitualDefinitionAssignee :one
INSERT INTO collaboration.ritual_definition_assignee (
    id, organization_id, ritual_definition_id, employee_id, updated_at
) VALUES (
    @id, @organization_id, @ritual_definition_id, @employee_id, @updated_at
) ON CONFLICT (organization_id, ritual_definition_id, employee_id) DO NOTHING
RETURNING *;

-- name: DeleteAllRitualDefinitionAssignees :exec
DELETE FROM collaboration.ritual_definition_assignee
WHERE organization_id = @organization_id
  AND ritual_definition_id = @ritual_definition_id;

-- name: ListRitualDefinitionAssignees :many
SELECT * FROM collaboration.ritual_definition_assignee
WHERE organization_id = @organization_id
  AND ritual_definition_id = @ritual_definition_id;

-- ============================================================
-- EVIDENCE REQUIREMENT QUERIES
-- ============================================================

-- name: CreateEvidenceRequirement :one
INSERT INTO collaboration.evidence_requirement (
    id, organization_id, ritual_definition_id, name, description,
    evidence_types, is_required, approval_mode, auto_approve_config,
    position, deadline_offset_hours, updated_at
) VALUES (
    @id, @organization_id, @ritual_definition_id, @name, @description,
    @evidence_types, @is_required, @approval_mode, @auto_approve_config,
    @position, @deadline_offset_hours, @updated_at
) RETURNING *;

-- name: GetEvidenceRequirement :one
SELECT * FROM collaboration.evidence_requirement
WHERE organization_id = @organization_id AND id = @id;

-- name: UpdateEvidenceRequirement :one
UPDATE collaboration.evidence_requirement
SET name = COALESCE(sqlc.narg('name'), name),
    description = COALESCE(sqlc.narg('description'), description),
    evidence_types = COALESCE(sqlc.narg('evidence_types'), evidence_types),
    is_required = COALESCE(sqlc.narg('is_required'), is_required),
    approval_mode = COALESCE(sqlc.narg('approval_mode'), approval_mode),
    auto_approve_config = COALESCE(sqlc.narg('auto_approve_config'), auto_approve_config),
    deadline_offset_hours = COALESCE(sqlc.narg('deadline_offset_hours'), deadline_offset_hours),
    updated_at = @updated_at
WHERE organization_id = @organization_id AND id = @id
RETURNING *;

-- name: DeleteEvidenceRequirement :exec
DELETE FROM collaboration.evidence_requirement
WHERE organization_id = @organization_id AND id = @id;

-- name: ListEvidenceRequirements :many
SELECT * FROM collaboration.evidence_requirement
WHERE organization_id = @organization_id
  AND ritual_definition_id = @ritual_definition_id
ORDER BY position ASC;

-- name: GetNextEvidenceRequirementPosition :one
SELECT COALESCE(MAX(position), -1) + 1 AS next_position
FROM collaboration.evidence_requirement
WHERE organization_id = @organization_id
  AND ritual_definition_id = @ritual_definition_id;

-- ============================================================
-- EVIDENCE SUBMISSION QUERIES
-- ============================================================

-- name: CreateEvidenceSubmission :one
INSERT INTO collaboration.evidence_submission (
    id, organization_id, task_id, evidence_requirement_id,
    submitted_by_employee_id, evidence_type,
    file_id, text_content, link_url,
    device_timestamp, server_timestamp,
    gps_latitude, gps_longitude, gps_accuracy_meters,
    approval_status, updated_at
) VALUES (
    @id, @organization_id, @task_id, @evidence_requirement_id,
    @submitted_by_employee_id, @evidence_type,
    @file_id, @text_content, @link_url,
    @device_timestamp, @server_timestamp,
    @gps_latitude, @gps_longitude, @gps_accuracy_meters,
    @approval_status, @updated_at
) RETURNING *;

-- name: GetEvidenceSubmission :one
SELECT * FROM collaboration.evidence_submission
WHERE organization_id = @organization_id AND id = @id;

-- name: UpdateEvidenceSubmissionApproval :one
-- Compare-and-set: the `approval_status = 'pending_review'` predicate is what makes a
-- second decider lose rather than silently overwrite the first. Zero rows now means "no
-- longer pending", not "not found" — the caller distinguishes the two by having read the
-- row earlier in the same transaction with GetEvidenceSubmissionForReview.
UPDATE collaboration.evidence_submission
SET approval_status = @approval_status,
    reviewed_by_employee_id = @reviewed_by_employee_id,
    reviewed_at = @reviewed_at,
    reviewer_comment = @reviewer_comment,
    updated_at = @updated_at
WHERE organization_id = @organization_id
  AND id = @id
  AND approval_status = 'pending_review'
RETURNING *;

-- name: GetEvidenceSubmissionForReview :one
-- Step 1 of the decision transaction: the submission plus the project the scope check
-- needs, plus the current decision fields so an already-decided refusal can name who
-- decided it and when.
SELECT
  es.*,
  t.project_id,
  t.title AS task_title,
  reviewer.given_name AS reviewer_given_name,
  reviewer.family_name AS reviewer_family_name
FROM collaboration.evidence_submission es
JOIN collaboration.task t
  ON (t.organization_id, t.id) = (es.organization_id, es.task_id)
LEFT JOIN organization.employee reviewer
  ON (reviewer.organization_id, reviewer.id) = (es.organization_id, es.reviewed_by_employee_id)
WHERE es.organization_id = @organization_id
  AND es.id = @id;

-- ============================================================
-- EVIDENCE REVIEW QUEUE QUERIES
-- ============================================================
--
-- The queue is a read-only projection: every pending submission the caller is entitled to
-- decide, across all rituals and all projects. The `project_membership` inner join with
-- `role <> 'viewer'` IS the reviewer scope, and the decision path evaluates the identical
-- predicate through CheckProjectAccess — so nothing appears here that the actions would
-- refuse, and nothing the actions accept is hidden.
--
-- `urgency_rank` is computed once in the CTE so the keyset WHERE and the ORDER BY reference
-- the same expression. The sort tuple `(urgency_rank, server_timestamp, id)` is total: the
-- `id` leg is a UUID v7 primary key, so no two rows tie and the page boundary can neither
-- duplicate nor skip within a snapshot.

-- name: ListEvidenceReviewQueue :many
WITH queue AS (
  SELECT
    es.id AS evidence_submission_id,
    es.task_id,
    t.identifier AS task_identifier,
    t.title AS task_title,
    t.project_id,
    p.name AS project_name,
    t.ritual_definition_id,
    COALESCE(rd.name, '')::text AS ritual_name,
    -- The id only, from the ritual_definition join the queue already performs: a page of
    -- entries costs zero additional queries. The reviewer's control is labelled
    -- "Procedure" and fetches the title and content from GetRitualProcedure when opened.
    rd.procedure_document_id,
    es.evidence_requirement_id,
    COALESCE(er.name, '')::text AS evidence_requirement_name,
    COALESCE(er.position, 0)::int AS evidence_requirement_position,
    COALESCE(er.is_required, FALSE)::boolean AS evidence_requirement_is_required,
    (er.id IS NULL OR rd.id IS NULL)::boolean AS requirement_unresolved,
    es.submitted_by_employee_id,
    (emp.given_name || ' ' || emp.family_name)::text AS submitted_by_display_name,
    es.server_timestamp,
    es.device_timestamp,
    es.evidence_type,
    es.file_id,
    es.text_content,
    es.link_url,
    es.gps_latitude,
    es.gps_longitude,
    es.gps_accuracy_meters,
    ps.category AS instance_state_category,
    t.completion_deadline AS instance_completion_deadline,
    (CASE WHEN ps.category IN ('overdue', 'missed') THEN 0 ELSE 1 END)::int AS urgency_rank
  FROM collaboration.evidence_submission es
  JOIN collaboration.task t
    ON (t.organization_id, t.id) = (es.organization_id, es.task_id)
  JOIN collaboration.project p
    ON (p.organization_id, p.id) = (t.organization_id, t.project_id)
  JOIN collaboration.project_state ps
    ON (ps.organization_id, ps.id) = (t.organization_id, t.state_id)
  JOIN collaboration.project_membership pm
    ON (pm.organization_id, pm.project_id) = (t.organization_id, t.project_id)
  JOIN organization.employee emp
    ON (emp.organization_id, emp.id) = (es.organization_id, es.submitted_by_employee_id)
  LEFT JOIN collaboration.ritual_definition rd
    ON (rd.organization_id, rd.id) = (t.organization_id, t.ritual_definition_id)
  LEFT JOIN collaboration.evidence_requirement er
    ON (er.organization_id, er.id) = (es.organization_id, es.evidence_requirement_id)
  WHERE es.organization_id = @organization_id
    AND es.approval_status = 'pending_review'
    AND t.task_kind = 'ritual_instance'
    AND t.is_deleted = FALSE
    AND t.detached_from_ritual = FALSE
    AND pm.employee_id = @reviewer_employee_id
    AND pm.role <> 'viewer'
    AND (sqlc.narg('project_id')::uuid IS NULL OR t.project_id = sqlc.narg('project_id')::uuid)
)
SELECT * FROM queue
WHERE sqlc.narg('cursor_submission_id')::uuid IS NULL
   OR (urgency_rank, server_timestamp, evidence_submission_id)
      > (sqlc.narg('cursor_urgency_rank')::int, sqlc.narg('cursor_server_timestamp')::timestamptz, sqlc.narg('cursor_submission_id')::uuid)
ORDER BY urgency_rank, server_timestamp, evidence_submission_id
LIMIT @page_limit;

-- name: CountEvidenceReviewQueue :one
-- Identical predicate to ListEvidenceReviewQueue, wrapped in a bounded subquery so a
-- reviewer returning from leave with 4 000 pending items costs the same as one with 100.
-- `is_capped` is derived client-side from `pending_count >= cap`.
SELECT COUNT(*)::int AS pending_count
FROM (
  SELECT 1
  FROM collaboration.evidence_submission es
  JOIN collaboration.task t
    ON (t.organization_id, t.id) = (es.organization_id, es.task_id)
  JOIN collaboration.project_membership pm
    ON (pm.organization_id, pm.project_id) = (t.organization_id, t.project_id)
  WHERE es.organization_id = @organization_id
    AND es.approval_status = 'pending_review'
    AND t.task_kind = 'ritual_instance'
    AND t.is_deleted = FALSE
    AND t.detached_from_ritual = FALSE
    AND pm.employee_id = @reviewer_employee_id
    AND pm.role <> 'viewer'
    AND (sqlc.narg('project_id')::uuid IS NULL OR t.project_id = sqlc.narg('project_id')::uuid)
  LIMIT @count_cap
) capped;

-- name: ListEvidenceSubmissions :many
SELECT * FROM collaboration.evidence_submission
WHERE organization_id = @organization_id
  AND task_id = @task_id
ORDER BY server_timestamp ASC;

-- name: CheckRitualInstanceExists :one
SELECT EXISTS (
  SELECT 1 FROM collaboration.task
  WHERE organization_id = @organization_id
    AND ritual_definition_id = @ritual_definition_id
    AND scheduled_date = @scheduled_date
    AND task_kind = 'ritual_instance'
    AND is_deleted = FALSE
) AS exists;

-- ============================================================
-- OPERATIONAL HEALTH QUERIES
-- ============================================================

-- name: GetRitualHealthByDefinition :many
SELECT
  t.ritual_definition_id,
  rd.name AS ritual_name,
  COUNT(*)::int AS total_instances,
  COUNT(*) FILTER (WHERE ps.category = 'verified')::int AS verified_count,
  COUNT(*) FILTER (WHERE ps.category = 'overdue')::int AS overdue_count,
  COUNT(*) FILTER (WHERE ps.category = 'missed')::int AS missed_count,
  COUNT(*) FILTER (WHERE ps.category = 'skipped')::int AS skipped_count
FROM collaboration.task t
JOIN collaboration.project_state ps ON (ps.organization_id, ps.id) = (t.organization_id, t.state_id)
JOIN collaboration.ritual_definition rd ON (rd.organization_id, rd.id) = (t.organization_id, t.ritual_definition_id)
WHERE t.organization_id = @organization_id
  AND t.project_id = @project_id
  AND t.task_kind = 'ritual_instance'
  AND t.is_deleted = FALSE
  AND t.scheduled_date >= @start_date
  AND t.scheduled_date <= @end_date
GROUP BY t.ritual_definition_id, rd.name;

-- name: GetEmployeeComplianceSummary :many
-- The employee name is joined in because every consumer — the Health tab table and the
-- CSV export — is read by a person deciding who needs following up, and a UUID does not
-- identify anyone.
SELECT
  ta.employee_id,
  (emp.given_name || ' ' || emp.family_name)::text AS employee_name,
  COUNT(*)::int AS total_assigned,
  COUNT(*) FILTER (WHERE ps.category = 'verified' AND t.completion_deadline >= t.updated_at)::int AS completed_on_time,
  COUNT(*) FILTER (WHERE ps.category = 'verified' AND t.completion_deadline < t.updated_at)::int AS completed_late,
  COUNT(*) FILTER (WHERE ps.category = 'missed')::int AS missed
FROM collaboration.task t
JOIN collaboration.task_assignee ta ON (ta.organization_id, ta.task_id) = (t.organization_id, t.id)
JOIN collaboration.project_state ps ON (ps.organization_id, ps.id) = (t.organization_id, t.state_id)
JOIN organization.employee emp ON (emp.organization_id, emp.id) = (ta.organization_id, ta.employee_id)
WHERE t.organization_id = @organization_id
  AND t.project_id = @project_id
  AND t.task_kind = 'ritual_instance'
  AND t.is_deleted = FALSE
  AND t.scheduled_date >= @start_date
  AND t.scheduled_date <= @end_date
  AND ta.role = 'assignee'
GROUP BY ta.employee_id, emp.given_name, emp.family_name;

-- name: GetProjectRitualSummary :one
SELECT
  COUNT(*)::int AS total_instances,
  COUNT(*) FILTER (WHERE ps.category = 'verified')::int AS verified_count,
  COUNT(*) FILTER (WHERE ps.category = 'overdue')::int AS overdue_count,
  COUNT(*) FILTER (WHERE ps.category = 'missed')::int AS missed_count,
  COUNT(*) FILTER (WHERE ps.category IN ('submitted'))::int AS pending_review_count
FROM collaboration.task t
JOIN collaboration.project_state ps ON (ps.organization_id, ps.id) = (t.organization_id, t.state_id)
WHERE t.organization_id = @organization_id
  AND t.project_id = @project_id
  AND t.task_kind = 'ritual_instance'
  AND t.is_deleted = FALSE
  AND t.scheduled_date >= @start_date
  AND t.scheduled_date <= @end_date;

-- =============================================================================
-- QUERIES — Ritual Schedule Change
-- =============================================================================

-- name: UpdateRitualDefinitionSchedule :one
-- Updates the recurrence_rule, increments schedule_version, and resets
-- last_generated_date so regeneration restarts from the next day.
UPDATE collaboration.ritual_definition
SET
  recurrence_rule = @recurrence_rule,
  schedule_version = schedule_version + 1,
  last_generated_date = @waterline_reset_date,
  updated_at = NOW()
WHERE organization_id = @organization_id
  AND id = @id
RETURNING *;

-- name: EnsureTaskChannel :one
-- Atomically sets channel_id on a ritual instance task.
-- Returns the row ONLY if the UPDATE succeeded (i.e., channel_id was NULL).
UPDATE collaboration.task
SET channel_id = @channel_id
WHERE organization_id = @organization_id
  AND id = @id
  AND channel_id IS NULL
RETURNING *;

-- name: EnsureTaskDocument :one
-- Atomically sets description_document_id on a ritual instance task.
-- Returns the row ONLY if the UPDATE succeeded.
UPDATE collaboration.task
SET description_document_id = @description_document_id
WHERE organization_id = @organization_id
  AND id = @id
  AND description_document_id IS NULL
RETURNING *;

-- name: ListFutureRitualInstancesForClassification :many
-- Returns the minimal fields needed to classify each future ritual instance
-- as "untouched" (soft-delete candidate) or "touched" (detach candidate).
-- is_initial_state: true when the task's current state is the project's initial state.
-- has_evidence: true when at least one evidence_submission exists for the task.
-- has_channel: true when the task's channel has been lazily created (user opened detail view).
-- This query is the single source of classification inputs; Go code does the bucketing.
SELECT
    t.id,
    t.comment_count,
    ps.is_initial AS is_initial_state,
    EXISTS (
        SELECT 1 FROM collaboration.evidence_submission es
        WHERE es.organization_id = t.organization_id
          AND es.task_id = t.id
    ) AS has_evidence,
    (t.channel_id IS NOT NULL)::bool AS has_channel
FROM collaboration.task t
JOIN collaboration.project_state ps
    ON ps.id = t.state_id
   AND ps.organization_id = t.organization_id
WHERE t.organization_id = @organization_id
  AND t.ritual_definition_id = @ritual_definition_id
  AND t.task_kind = 'ritual_instance'
  AND t.is_deleted = FALSE
  AND t.scheduled_date > @today_cutoff;

-- name: SoftDeleteTasksByIDs :execrows
-- Soft-deletes a specific set of tasks (by UUID list) within an organization.
-- Used by ChangeRitualDefinitionSchedule to delete the classified "untouched" set.
UPDATE collaboration.task
SET is_deleted = TRUE, updated_at = NOW()
WHERE organization_id = @organization_id
  AND id = ANY(@ids::uuid[]);

-- name: DetachRitualInstancesByIDs :execrows
-- Detaches a specific set of ritual instances (by UUID list), converting them to
-- standalone standard tasks. Used by ChangeRitualDefinitionSchedule for the "touched" set.
UPDATE collaboration.task
SET
    ritual_definition_id = NULL,
    task_kind = 'standard',
    detached_from_ritual = TRUE,
    updated_at = NOW()
WHERE organization_id = @organization_id
  AND id = ANY(@ids::uuid[]);

-- ============================================================
-- RITUAL DEFINITION DEPARTMENT POOL QUERIES
-- ============================================================

-- name: UpsertRitualDefinitionDepartmentPool :one
INSERT INTO collaboration.ritual_definition_department_pool (
    id, organization_id, ritual_definition_id, department_id,
    assignment_strategy, updated_at
) VALUES (
    @id, @organization_id, @ritual_definition_id, @department_id,
    @assignment_strategy, @updated_at
) ON CONFLICT (organization_id, ritual_definition_id, department_id) DO UPDATE
    SET assignment_strategy = EXCLUDED.assignment_strategy,
        updated_at = EXCLUDED.updated_at
RETURNING *;

-- name: DeleteAllRitualDefinitionDepartmentPools :exec
DELETE FROM collaboration.ritual_definition_department_pool
WHERE organization_id = @organization_id
  AND ritual_definition_id = @ritual_definition_id;

-- name: ListRitualDefinitionDepartmentPools :many
SELECT rddp.id, rddp.organization_id, rddp.ritual_definition_id,
       rddp.department_id, rddp.assignment_strategy,
       rddp.last_assigned_employee_id, rddp.updated_at,
       d.name AS department_name
FROM collaboration.ritual_definition_department_pool rddp
JOIN organization.department d
    ON d.organization_id = rddp.organization_id
   AND d.id = rddp.department_id
WHERE rddp.organization_id = @organization_id
  AND rddp.ritual_definition_id = @ritual_definition_id
ORDER BY rddp.id;

-- name: UpdateDepartmentPoolLastAssigned :exec
UPDATE collaboration.ritual_definition_department_pool
SET last_assigned_employee_id = @last_assigned_employee_id,
    updated_at = @updated_at
WHERE organization_id = @organization_id
  AND id = @id;

-- name: ListActiveDepartmentMembers :many
-- Returns active employee IDs in a department ordered by UUID for deterministic round-robin.
SELECT dm.employee_id
FROM organization.department_member dm
JOIN organization.employee e
    ON e.organization_id = dm.organization_id
   AND e.id = dm.employee_id
WHERE dm.organization_id = @organization_id
  AND dm.department_id = @department_id
  AND e.is_active = TRUE
ORDER BY dm.employee_id ASC;

-- name: GetLeastAssignedDepartmentEmployee :one
-- Returns the active employee in the department with fewest ritual assignments in the given period.
SELECT dm.employee_id
FROM organization.department_member dm
JOIN organization.employee e
    ON e.organization_id = dm.organization_id
   AND e.id = dm.employee_id
LEFT JOIN (
    SELECT ta.employee_id, COUNT(*) AS cnt
    FROM collaboration.task_assignee ta
    JOIN collaboration.task t
        ON t.organization_id = ta.organization_id
       AND t.id = ta.task_id
    WHERE ta.organization_id = @organization_id
      AND t.task_kind = 'ritual_instance'
      AND ta.assigned_at >= @since
    GROUP BY ta.employee_id
) recent ON recent.employee_id = dm.employee_id
WHERE dm.organization_id = @organization_id
  AND dm.department_id = @department_id
  AND e.is_active = TRUE
ORDER BY COALESCE(recent.cnt, 0) ASC, dm.employee_id ASC
LIMIT 1;

-- =============================================================================
-- CHANNEL TASK DESTINATION QUERIES
--
-- The project a channel's tasks default to. Written by the first conversion in a
-- channel; changed or cleared only by a channel administrator. Rows are never deleted
-- because the project became archived or unreachable — FR-018 requires those to be
-- *treated* as unset at read time, so unarchiving restores the setting.
-- =============================================================================

-- name: GetChannelTaskDestination :one
-- LEFT JOIN rather than JOIN: the project FK cascades, so a missing project row should
-- not exist, but reading a row whose project has gone must report it rather than return
-- nothing at all.
SELECT
    d.channel_id,
    d.project_id,
    d.set_by_employee_id,
    p.id          AS resolved_project_id,
    p.name        AS project_name,
    p.key         AS project_key,
    p.visibility  AS project_visibility,
    p.is_archived AS project_is_archived
FROM collaboration.channel_task_destination d
LEFT JOIN collaboration.project p
    ON p.organization_id = d.organization_id AND p.id = d.project_id
WHERE d.organization_id = $1 AND d.channel_id = $2;

-- name: RememberChannelTaskDestination :exec
-- The first conversion in a channel sets the destination; every later conversion,
-- including one that overrides the project for itself, leaves it exactly as it was
-- (FR-015, FR-016). DO NOTHING is what makes those two requirements one statement.
INSERT INTO collaboration.channel_task_destination (
    organization_id, channel_id, project_id, set_by_employee_id
) VALUES ($1, $2, $3, $4)
ON CONFLICT (organization_id, channel_id) DO NOTHING;

-- name: SetChannelTaskDestination :exec
-- The channel-administrator path, which does overwrite.
INSERT INTO collaboration.channel_task_destination (
    organization_id, channel_id, project_id, set_by_employee_id, updated_at
) VALUES ($1, $2, $3, $4, now())
ON CONFLICT (organization_id, channel_id) DO UPDATE
SET project_id         = EXCLUDED.project_id,
    set_by_employee_id = EXCLUDED.set_by_employee_id,
    updated_at         = EXCLUDED.updated_at;

-- name: ClearChannelTaskDestination :exec
DELETE FROM collaboration.channel_task_destination
WHERE organization_id = $1 AND channel_id = $2;

-- =============================================================================
-- RITUAL INSTANCE POOL ASSIGNMENT QUERIES (feature 042 — on-shift assignment)
--
-- One row per (ritual instance, department pool) governed by the on_shift strategy.
-- Every mutation below is a compare-and-set on resolution_state, which is what makes
-- two overlapping resolution passes assign once and notify once.
-- =============================================================================

-- name: UpsertRitualPoolAssignment :one
-- Written by generation and by the resolution pass's adoption path. ON CONFLICT keeps
-- generation idempotent: a re-run over a date whose instance already exists must not
-- create a second slot record.
INSERT INTO collaboration.ritual_instance_pool_assignment (
    organization_id, task_id, pool_id, resolution_state,
    assigned_employee_id, resolve_by, resolved_at, updated_at
) VALUES (
    @organization_id, @task_id, @pool_id, @resolution_state,
    @assigned_employee_id, @resolve_by, @resolved_at, @updated_at
)
ON CONFLICT (organization_id, task_id, pool_id) DO NOTHING
RETURNING *;

-- name: ResolveRitualPoolAssignment :one
-- Compare-and-set: only a row still in the state the decision was made from is written.
UPDATE collaboration.ritual_instance_pool_assignment
SET resolution_state = 'resolved',
    assigned_employee_id = @assigned_employee_id,
    resolved_at = @now,
    closed_reason = NULL,
    updated_at = @now
WHERE organization_id = @organization_id
  AND id = @id
  AND resolution_state = @expected_state
RETURNING *;

-- name: WithdrawRitualPoolAssignment :one
-- Back to awaiting: the assignee's covering shift disappeared and nobody else covers.
UPDATE collaboration.ritual_instance_pool_assignment
SET resolution_state = 'awaiting_shift',
    assigned_employee_id = NULL,
    resolved_at = NULL,
    updated_at = @now
WHERE organization_id = @organization_id
  AND id = @id
  AND resolution_state = 'resolved'
RETURNING *;

-- name: CloseRitualPoolAssignment :one
-- The once-only transition. The owner alert is published if and only if this returns a
-- row, which is what makes two overlapping passes escalate once.
UPDATE collaboration.ritual_instance_pool_assignment
SET resolution_state = 'closed_unresolved',
    closed_reason = @closed_reason,
    escalated_at = @escalated_at,
    updated_at = @now
WHERE organization_id = @organization_id
  AND id = @id
  AND resolution_state = @expected_state
RETURNING *;

-- name: DeleteRitualPoolAssignment :exec
-- The pool is no longer on-shift; the row has nothing left to describe.
DELETE FROM collaboration.ritual_instance_pool_assignment
WHERE organization_id = @organization_id AND id = @id;

-- lint:cross-tenant scheduler sweep — the organization list is the result, not the input.
-- name: ListOrganizationIDsWithResolvableRitualPoolAssignments :many
-- System-scope background query for the ritual shift resolution sweep, intentionally NOT
-- filtered by organization_id: its purpose is to discover which organizations to sweep.
-- Returns only organization IDs, no tenant row data, and runs on AdminPool. See
-- Constitution Principle I.
SELECT DISTINCT organization_id
FROM collaboration.ritual_instance_pool_assignment
WHERE resolution_state IN ('awaiting_shift', 'resolved')
ORDER BY organization_id;

-- name: ListRitualPoolSlotsForResolution :many
-- One query serves three of the feature's cases, which is why it is a LEFT JOIN:
--   * a row generation already created            -> a.id IS NOT NULL, awaiting/resolved
--   * a pool just switched TO on_shift            -> a.id IS NULL, adopt it
--   * a resolved row whose rota moved             -> a.id IS NOT NULL, state resolved
-- The scheduled_date floor is a coarse prefilter only: no timezone on earth moves a date
-- by more than a day, so a genuinely-future instance can never be excluded by it. The
-- exact "still in the future" test is now < resolve_by, applied in Go.
SELECT
    p.id                AS pool_id,
    p.department_id,
    p.assignment_strategy,
    -- Only read when a pool has been switched away from on_shift and its waiting slot has
    -- to be handed over to the round-robin waterline.
    p.last_assigned_employee_id,
    t.id                AS task_id,
    t.project_id,
    t.scheduled_date,
    d.id                AS ritual_definition_id,
    d.name              AS ritual_name,
    d.timezone,
    d.created_by_employee_id,
    a.id                AS assignment_id,
    a.resolution_state,
    a.assigned_employee_id,
    a.resolve_by,
    EXISTS (
        SELECT 1 FROM collaboration.evidence_submission es
        WHERE es.organization_id = t.organization_id AND es.task_id = t.id
    ) AS has_evidence
FROM collaboration.ritual_definition_department_pool p
JOIN collaboration.ritual_definition d
    ON d.organization_id = p.organization_id AND d.id = p.ritual_definition_id
JOIN collaboration.task t
    ON t.organization_id = d.organization_id AND t.ritual_definition_id = d.id
LEFT JOIN collaboration.ritual_instance_pool_assignment a
    ON a.organization_id = t.organization_id AND a.task_id = t.id AND a.pool_id = p.id
WHERE p.organization_id = @organization_id
  AND t.task_kind = 'ritual_instance'
  AND t.is_deleted = FALSE
  AND t.detached_from_ritual = FALSE
  AND t.scheduled_date >= @scheduled_date_floor
  AND (
        (p.assignment_strategy = 'on_shift'
             AND (a.id IS NULL OR a.resolution_state IN ('awaiting_shift', 'resolved')))
     OR (p.assignment_strategy <> 'on_shift' AND a.id IS NOT NULL)
      )
ORDER BY t.scheduled_date ASC, t.id ASC, p.id ASC
LIMIT @slot_limit;

-- name: ListRitualPoolAssignmentsDueEscalation :many
-- An awaiting slot whose scheduled date has arrived. resolve_by is stored as an instant
-- in the definition's timezone, so this predicate needs no timezone arithmetic.
SELECT a.*, t.project_id, d.name AS ritual_name
FROM collaboration.ritual_instance_pool_assignment a
JOIN collaboration.task t
    ON t.organization_id = a.organization_id AND t.id = a.task_id
LEFT JOIN collaboration.ritual_definition d
    ON d.organization_id = t.organization_id AND d.id = t.ritual_definition_id
WHERE a.organization_id = @organization_id
  AND a.resolution_state = 'awaiting_shift'
  AND a.resolve_by <= @now
ORDER BY a.resolve_by ASC, a.id ASC
LIMIT @slot_limit;

-- name: ListRitualPoolAssignmentStatesForTasks :many
-- Batched read for the "waiting for the rota" explanation on a task. One query per page
-- of tasks, never one per task.
SELECT task_id, resolution_state
FROM collaboration.ritual_instance_pool_assignment
WHERE organization_id = @organization_id
  AND task_id = ANY(@task_ids::uuid[]);

-- name: GetLeastAssignedEmployeeAmongCandidates :one
-- Fewest ritual instances in the trailing window, ties broken by lowest employee UUID so
-- a repeated resolution on unchanged data returns the same answer.
--
-- Unlike GetLeastAssignedDepartmentEmployee this takes the candidate set as an array, so
-- it needs no join into organization.department_member — the caller has already applied
-- both department membership and shift coverage.
-- The explicit ::uuid cast on the projection is required: sqlc cannot infer a column
-- type out of UNNEST and would otherwise generate interface{}.
SELECT c.employee_id::uuid AS employee_id
FROM UNNEST(@candidate_ids::uuid[]) AS c(employee_id)
LEFT JOIN (
    SELECT ta.employee_id, COUNT(*) AS cnt
    FROM collaboration.task_assignee ta
    JOIN collaboration.task t
        ON t.organization_id = ta.organization_id
       AND t.id = ta.task_id
    WHERE ta.organization_id = @organization_id
      AND t.task_kind = 'ritual_instance'
      AND ta.assigned_at >= @since
    GROUP BY ta.employee_id
) recent ON recent.employee_id = c.employee_id
ORDER BY COALESCE(recent.cnt, 0) ASC, c.employee_id ASC
LIMIT 1;

-- name: TaskAssigneeExists :one
-- The manual-override test: is the employee this feature assigned still in the slot?
SELECT EXISTS (
    SELECT 1 FROM collaboration.task_assignee
    WHERE organization_id = @organization_id
      AND task_id = @task_id
      AND employee_id = @employee_id
      AND role = 'assignee'
);

-- name: SearchTasks :many
-- Cross-project work-item search (feature 045, FR-009): ordinary tasks and ritual
-- instances alike, scoped to projects the caller may read. Matches on title with
-- PGroonga, backed by the existing idx_task_title_pgroonga.
--
-- Nothing existed to reuse: ListTasksRequest has a `search_query` field, but no query in
-- this file reads it, and ListTasks is single-project anyway. The project-access
-- predicate is copied from ListTasksBySourceMessages so the project visibility rule stays
-- single-sourced even though the query is new. Every join stays inside the collaboration
-- schema.
SELECT
    t.id,
    t.organization_id,
    t.project_id,
    t.identifier,
    t.title,
    t.task_kind,
    t.due_date,
    t.updated_at,
    p.name AS project_name,
    p.key  AS project_key,
    ps.name     AS state_name,
    ps.category AS state_category,
    pgroonga_score(t.tableoid, t.ctid)::real AS relevance_score
FROM collaboration.task t
JOIN collaboration.project p
    ON (p.organization_id, p.id) = (t.organization_id, t.project_id)
JOIN collaboration.project_state ps
    ON (ps.organization_id, ps.id) = (t.organization_id, t.state_id)
WHERE t.organization_id = @organization_id
  AND t.is_deleted  = FALSE
  -- An archived project's work is not findable.
  AND p.is_archived = FALSE
  AND t.title &@~ @query
  -- Project access — same predicate as ListTasksBySourceMessages.
  AND (
      p.visibility = 'public'
      OR EXISTS (
          SELECT 1 FROM collaboration.project_membership pm
           WHERE pm.organization_id = t.organization_id
             AND pm.project_id      = t.project_id
             AND pm.employee_id     = @employee_id
      )
  )
  AND (sqlc.narg('cursor')::uuid IS NULL OR t.id < sqlc.narg('cursor'))
ORDER BY relevance_score DESC, t.updated_at DESC, t.id DESC
LIMIT @search_limit;

-- name: ListTaskPreviews :many
-- Task cards for a page of chat link previews (feature 046, FR-001).
--
-- The access predicate is the one ListTasksBySourceMessages and SearchTasks already
-- share, so "which tasks may this reader see" keeps a single definition. A task the
-- reader cannot see is absent from the result rather than flagged — that absence is what
-- makes access_denied and not_found indistinguishable to the caller (FR-010).
--
-- The earliest assignee comes from a LATERAL taking one row, and the count from a
-- correlated sub-select, rather than from a join on task_assignee: a task with three
-- assignees must still produce exactly one row.
--
-- The assignee id is COALESCEd to the nil uuid because sqlc infers a LEFT JOIN'd NOT NULL
-- column as non-nullable, and scanning a real NULL into dbuuid.UUID fails the whole batch.
-- The nil uuid is not a valid employee id; the Go side reads assignee_count, not the id,
-- to decide whether there is an assignee at all.
SELECT
    t.id,
    t.identifier,
    t.title,
    t.project_id,
    ps.name     AS state_name,
    ps.category AS state_category,
    COALESCE(primary_assignee.employee_id, '00000000-0000-0000-0000-000000000000'::uuid) AS primary_assignee_id,
    (SELECT count(*)
       FROM collaboration.task_assignee ta
      WHERE ta.organization_id = t.organization_id
        AND ta.task_id         = t.id
        AND ta.role            = 'assignee') AS assignee_count
FROM collaboration.task t
JOIN collaboration.project p
    ON (p.organization_id, p.id) = (t.organization_id, t.project_id)
JOIN collaboration.project_state ps
    ON (ps.organization_id, ps.id) = (t.organization_id, t.state_id)
LEFT JOIN LATERAL (
    SELECT ta.employee_id
      FROM collaboration.task_assignee ta
     WHERE ta.organization_id = t.organization_id
       AND ta.task_id         = t.id
       AND ta.role            = 'assignee'
     ORDER BY ta.assigned_at, ta.id
     LIMIT 1
) primary_assignee ON TRUE
WHERE t.organization_id = @organization_id
  AND t.id = ANY(@task_ids::uuid[])
  AND t.is_deleted = FALSE
  -- Project access — same predicate as ListTasksBySourceMessages.
  AND (
      p.visibility = 'public'
      OR EXISTS (
          SELECT 1 FROM collaboration.project_membership pm
           WHERE pm.organization_id = t.organization_id
             AND pm.project_id      = t.project_id
             AND pm.employee_id     = @employee_id
      )
  );

-- name: ListProjectPreviews :many
-- Project cards (feature 046, FR-004). The predicate mirrors
-- Service.resolveProjectStatus: a private project is visible to its owner and its members.
-- An archived project still previews — it exists and the reader may open it.
SELECT
    p.id,
    p.name,
    p.key,
    p.is_archived
FROM collaboration.project p
WHERE p.organization_id = @organization_id
  AND p.id = ANY(@project_ids::uuid[])
  AND (
      p.visibility <> 'private'
      OR p.owner_employee_id = @employee_id
      OR EXISTS (
          SELECT 1 FROM collaboration.project_membership pm
           WHERE pm.organization_id = p.organization_id
             AND pm.project_id      = p.id
             AND pm.employee_id     = @employee_id
      )
  );

-- ---------------------------------------------------------------------------
-- Team Attention Summary (feature 047)
--
-- Two queries behind the supervisor's Team block on mobile Today. They share one base
-- predicate verbatim, and differ only in projection and bound: FR-004 says a count the
-- caller cannot substantiate by opening the rows is worse than no count, and the only way
-- to keep that true is for the two to disagree about nothing else.
--
-- Lateness is `ps.category = 'overdue'` — the stored state the reconciliation sweep writes,
-- never a comparison against completion_deadline. Computing it here would disagree with the
-- caller's own "Running late" section for up to five minutes at every deadline.
--
-- Supervisory scope is `project_membership.role IN ('owner','admin')`: one notch tighter
-- than the review queue's `role <> 'viewer'`, because `member` would mean every employee
-- sees the whole workspace's late work.
-- ---------------------------------------------------------------------------

-- name: CountTeamAttention :one
-- Each category count is COUNT(*) over a LIMIT @count_cap subquery, so a workspace with a
-- 5 000-instance backlog costs the same to summarise as a healthy one. `*_count_capped` is
-- derived in Go from `count >= cap`, exactly as GetEvidenceReviewQueueCount derives
-- is_capped.
SELECT
  (SELECT COUNT(*) FROM (
    SELECT 1
    FROM collaboration.task t
    JOIN collaboration.project p
      ON (p.organization_id, p.id) = (t.organization_id, t.project_id)
    JOIN collaboration.project_state ps
      ON (ps.organization_id, ps.id) = (t.organization_id, t.state_id)
    WHERE t.organization_id = @organization_id
      AND t.task_kind = 'ritual_instance'
      AND t.is_deleted = FALSE
      AND t.detached_from_ritual = FALSE
      AND ps.is_closed = FALSE
      AND p.is_archived = FALSE
      AND EXISTS (
        SELECT 1 FROM collaboration.project_membership pm
         WHERE (pm.organization_id, pm.project_id) = (t.organization_id, t.project_id)
           AND pm.employee_id = @caller_employee_id
           AND pm.role IN ('owner', 'admin')
      )
      AND NOT EXISTS (
        SELECT 1 FROM collaboration.task_assignee ta
         WHERE (ta.organization_id, ta.task_id) = (t.organization_id, t.id)
           AND ta.role = 'assignee'
           AND ta.employee_id = @caller_employee_id
      )
      AND ps.category = 'overdue'
    LIMIT @count_cap
  ) capped_overdue)::int AS overdue_count,

  (SELECT COUNT(*) FROM (
    SELECT 1
    FROM collaboration.task t
    JOIN collaboration.project p
      ON (p.organization_id, p.id) = (t.organization_id, t.project_id)
    JOIN collaboration.project_state ps
      ON (ps.organization_id, ps.id) = (t.organization_id, t.state_id)
    WHERE t.organization_id = @organization_id
      AND t.task_kind = 'ritual_instance'
      AND t.is_deleted = FALSE
      AND t.detached_from_ritual = FALSE
      AND ps.is_closed = FALSE
      AND p.is_archived = FALSE
      AND EXISTS (
        SELECT 1 FROM collaboration.project_membership pm
         WHERE (pm.organization_id, pm.project_id) = (t.organization_id, t.project_id)
           AND pm.employee_id = @caller_employee_id
           AND pm.role IN ('owner', 'admin')
      )
      AND NOT EXISTS (
        SELECT 1 FROM collaboration.task_assignee ta
         WHERE (ta.organization_id, ta.task_id) = (t.organization_id, t.id)
           AND ta.role = 'assignee'
           AND ta.employee_id = @caller_employee_id
      )
      -- Disjoint from the overdue leg by construction, which is what makes an instance
      -- that is both appear once and count once without a DISTINCT in either query.
      AND ps.category <> 'overdue'
      -- Equality, not `<=`: next Tuesday's unassigned instance is not this morning's
      -- problem.
      AND t.scheduled_date = @as_of_date::date
      AND NOT EXISTS (
        SELECT 1 FROM collaboration.task_assignee ta
         WHERE (ta.organization_id, ta.task_id) = (t.organization_id, t.id)
           AND ta.role = 'assignee'
      )
    LIMIT @count_cap
  ) capped_unassigned)::int AS unassigned_count,

  -- The scope's own cardinality. The all-clear message names it (FR-016), and zero is what
  -- makes the whole block disappear (FR-001), so it cannot be inferred from a zero count.
  (SELECT COUNT(*)
     FROM collaboration.project p
     JOIN collaboration.project_membership pm
       ON (pm.organization_id, pm.project_id) = (p.organization_id, p.id)
    WHERE p.organization_id = @organization_id
      AND p.is_archived = FALSE
      AND pm.employee_id = @caller_employee_id
      AND pm.role IN ('owner', 'admin'))::int AS supervised_project_count;

-- name: ListTeamAttentionItems :many
-- The rows behind the counts above. `attention_rank` is the ordering authority and the wire
-- enum is derived from it in Go, so the two cannot disagree — the same discipline
-- ListEvidenceReviewQueue applies to urgency_rank.
--
-- The earliest assignee comes from a LATERAL taking one row and the count from a correlated
-- sub-select, both copied from ListTaskPreviews: an instance with three assignees must
-- still produce exactly one row. The id is COALESCEd to the nil uuid because sqlc infers a
-- LEFT JOIN'd NOT NULL column as non-nullable; the Go side reads assignee_count, not the
-- id, to decide whether anyone is on it.
--
-- Both legs MUST carry the base predicate of CountTeamAttention verbatim. FR-004 depends on
-- the count query and this one differing in nothing but projection and bound.
(
  SELECT
    t.id AS task_id,
    t.project_id,
    p.name AS project_name,
    t.title,
    0::int AS attention_rank,
    t.completion_deadline::date AS sort_date,
    COALESCE(primary_assignee.employee_id, '00000000-0000-0000-0000-000000000000'::uuid) AS primary_assignee_id,
    (SELECT count(*)
       FROM collaboration.task_assignee ta
      WHERE (ta.organization_id, ta.task_id) = (t.organization_id, t.id)
        AND ta.role = 'assignee')::int AS assignee_count
  FROM collaboration.task t
  JOIN collaboration.project p
    ON (p.organization_id, p.id) = (t.organization_id, t.project_id)
  JOIN collaboration.project_state ps
    ON (ps.organization_id, ps.id) = (t.organization_id, t.state_id)
  LEFT JOIN LATERAL (
    SELECT ta.employee_id
      FROM collaboration.task_assignee ta
     WHERE (ta.organization_id, ta.task_id) = (t.organization_id, t.id)
       AND ta.role = 'assignee'
     ORDER BY ta.assigned_at, ta.id
     LIMIT 1
  ) primary_assignee ON TRUE
  WHERE t.organization_id = @organization_id
    AND t.task_kind = 'ritual_instance'
    AND t.is_deleted = FALSE
    AND t.detached_from_ritual = FALSE
    AND ps.is_closed = FALSE
    AND p.is_archived = FALSE
    AND EXISTS (
      SELECT 1 FROM collaboration.project_membership pm
       WHERE (pm.organization_id, pm.project_id) = (t.organization_id, t.project_id)
         AND pm.employee_id = @caller_employee_id
         AND pm.role IN ('owner', 'admin')
    )
    AND NOT EXISTS (
      SELECT 1 FROM collaboration.task_assignee ta
       WHERE (ta.organization_id, ta.task_id) = (t.organization_id, t.id)
         AND ta.role = 'assignee'
         AND ta.employee_id = @caller_employee_id
    )
    AND ps.category = 'overdue'
  LIMIT @item_limit
)
UNION ALL
(
  SELECT
    t.id AS task_id,
    t.project_id,
    p.name AS project_name,
    t.title,
    1::int AS attention_rank,
    t.scheduled_date AS sort_date,
    '00000000-0000-0000-0000-000000000000'::uuid AS primary_assignee_id,
    0::int AS assignee_count
  FROM collaboration.task t
  JOIN collaboration.project p
    ON (p.organization_id, p.id) = (t.organization_id, t.project_id)
  JOIN collaboration.project_state ps
    ON (ps.organization_id, ps.id) = (t.organization_id, t.state_id)
  WHERE t.organization_id = @organization_id
    AND t.task_kind = 'ritual_instance'
    AND t.is_deleted = FALSE
    AND t.detached_from_ritual = FALSE
    AND ps.is_closed = FALSE
    AND p.is_archived = FALSE
    AND EXISTS (
      SELECT 1 FROM collaboration.project_membership pm
       WHERE (pm.organization_id, pm.project_id) = (t.organization_id, t.project_id)
         AND pm.employee_id = @caller_employee_id
         AND pm.role IN ('owner', 'admin')
    )
    AND NOT EXISTS (
      SELECT 1 FROM collaboration.task_assignee ta
       WHERE (ta.organization_id, ta.task_id) = (t.organization_id, t.id)
         AND ta.role = 'assignee'
         AND ta.employee_id = @caller_employee_id
    )
    AND ps.category <> 'overdue'
    AND t.scheduled_date = @as_of_date::date
    -- No assignee at all. The self-exclusion above is a different clause and a different
    -- fact: this one is "nobody is on it", that one is "it is my own work".
    AND NOT EXISTS (
      SELECT 1 FROM collaboration.task_assignee ta
       WHERE (ta.organization_id, ta.task_id) = (t.organization_id, t.id)
         AND ta.role = 'assignee'
    )
  LIMIT @item_limit
)
-- completion_deadline ASC *is* "longest late first": the oldest deadline has been late the
-- longest. The task id is a UUID v7 primary key, so the tiebreak is total and the order is
-- deterministic across requests.
ORDER BY attention_rank ASC, sort_date ASC NULLS LAST, task_id ASC;
