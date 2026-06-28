-- ============================================================
-- Ritual Tasks — SQLC Query Additions
-- These queries are ADDED to backend/database/scripts/collaboration.query.sql
-- ============================================================

-- ============================================================
-- RITUAL DEFINITION QUERIES
-- ============================================================

-- name: CreateRitualDefinition :one
INSERT INTO collaboration.ritual_definition (
    id, organization_id, project_id, name, description,
    recurrence_rule, completion_window_hours, timezone,
    created_by_employee_id, generation_window_days, updated_at
) VALUES (
    @id, @organization_id, @project_id, @name, @description,
    @recurrence_rule, @completion_window_hours, @timezone,
    @created_by_employee_id, @generation_window_days, @updated_at
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
    updated_at = @updated_at
WHERE organization_id = @organization_id AND id = @id
RETURNING *;

-- name: ArchiveRitualDefinition :one
UPDATE collaboration.ritual_definition
SET is_archived = @is_archived, updated_at = @updated_at
WHERE organization_id = @organization_id AND id = @id
RETURNING *;

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
  AND (last_generated_date IS NULL OR last_generated_date < @target_date)
ORDER BY id;

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

-- name: DeleteRitualDefinitionAssignee :exec
DELETE FROM collaboration.ritual_definition_assignee
WHERE organization_id = @organization_id
  AND ritual_definition_id = @ritual_definition_id
  AND employee_id = @employee_id;

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
UPDATE collaboration.evidence_submission
SET approval_status = @approval_status,
    reviewed_by_employee_id = @reviewed_by_employee_id,
    reviewed_at = @reviewed_at,
    reviewer_comment = @reviewer_comment,
    updated_at = @updated_at
WHERE organization_id = @organization_id AND id = @id
RETURNING *;

-- name: ListEvidenceSubmissions :many
SELECT * FROM collaboration.evidence_submission
WHERE organization_id = @organization_id
  AND task_id = @task_id
ORDER BY server_timestamp ASC;

-- name: ListEvidenceSubmissionsByRequirement :many
SELECT * FROM collaboration.evidence_submission
WHERE organization_id = @organization_id
  AND task_id = @task_id
  AND evidence_requirement_id = @evidence_requirement_id
ORDER BY server_timestamp ASC;

-- name: GetTaskEvidenceProgress :one
-- Lightweight progress summary for embedding in Task responses.
-- Returns counts of evidence requirements and their submission/approval status for a task.
SELECT
  (SELECT COUNT(*) FROM collaboration.evidence_requirement er
   WHERE er.organization_id = @organization_id
     AND er.ritual_definition_id = t.ritual_definition_id)::int AS total_requirements,
  (SELECT COUNT(*) FROM collaboration.evidence_requirement er
   WHERE er.organization_id = @organization_id
     AND er.ritual_definition_id = t.ritual_definition_id
     AND er.is_required = true)::int AS required_count,
  (SELECT COUNT(DISTINCT es.evidence_requirement_id) FROM collaboration.evidence_submission es
   WHERE es.organization_id = @organization_id
     AND es.task_id = t.id)::int AS submitted_count,
  (SELECT COUNT(DISTINCT es.evidence_requirement_id) FROM collaboration.evidence_submission es
   WHERE es.organization_id = @organization_id
     AND es.task_id = t.id
     AND es.approval_status = 'approved')::int AS approved_count,
  (SELECT COUNT(DISTINCT es.evidence_requirement_id) FROM collaboration.evidence_submission es
   WHERE es.organization_id = @organization_id
     AND es.task_id = t.id
     AND es.approval_status = 'rejected')::int AS rejected_count,
  (SELECT COUNT(DISTINCT es.evidence_requirement_id) FROM collaboration.evidence_submission es
   WHERE es.organization_id = @organization_id
     AND es.task_id = t.id
     AND es.approval_status = 'pending_review')::int AS pending_review_count
FROM collaboration.task t
WHERE t.organization_id = @organization_id
  AND t.id = @task_id
  AND t.task_kind = 'ritual_instance';

-- name: GetTaskEvidenceRequirementStatuses :many
-- Full evidence checklist for task detail view: each requirement with its latest submission status.
SELECT
  er.*,
  COALESCE(
    (SELECT es.approval_status FROM collaboration.evidence_submission es
     WHERE es.organization_id = er.organization_id
       AND es.task_id = @task_id
       AND es.evidence_requirement_id = er.id
     ORDER BY es.server_timestamp DESC LIMIT 1),
    'pending_review'
  ) AS latest_approval_status
FROM collaboration.evidence_requirement er
WHERE er.organization_id = @organization_id
  AND er.ritual_definition_id = @ritual_definition_id
ORDER BY er.position ASC
ORDER BY server_timestamp ASC;

-- name: CountPendingEvidenceReviews :one
SELECT COUNT(*) FROM collaboration.evidence_submission es
JOIN collaboration.task t ON (t.organization_id, t.id) = (es.organization_id, es.task_id)
WHERE es.organization_id = @organization_id
  AND t.project_id = @project_id
  AND es.approval_status = 'pending_review';

-- name: ListPendingEvidenceReviews :many
SELECT es.* FROM collaboration.evidence_submission es
JOIN collaboration.task t ON (t.organization_id, t.id) = (es.organization_id, es.task_id)
WHERE es.organization_id = @organization_id
  AND t.project_id = @project_id
  AND es.approval_status = 'pending_review'
ORDER BY es.server_timestamp ASC
LIMIT @limit_val;

-- ============================================================
-- RITUAL INSTANCE QUERIES (on task table)
-- ============================================================

-- name: ListRitualInstancesByDefinition :many
SELECT * FROM collaboration.task
WHERE organization_id = @organization_id
  AND ritual_definition_id = @ritual_definition_id
  AND task_kind = 'ritual_instance'
  AND is_deleted = FALSE
ORDER BY scheduled_date DESC
LIMIT @limit_val;

-- name: ListRitualInstancesForToday :many
SELECT t.*, ps.name AS state_name, ps.category AS state_category
FROM collaboration.task t
JOIN collaboration.project_state ps ON (ps.organization_id, ps.id) = (t.organization_id, t.state_id)
WHERE t.organization_id = @organization_id
  AND t.task_kind = 'ritual_instance'
  AND t.is_deleted = FALSE
  AND t.scheduled_date = @today
  AND EXISTS (
    SELECT 1 FROM collaboration.task_assignee ta
    WHERE ta.organization_id = t.organization_id
      AND ta.task_id = t.id
      AND ta.employee_id = @employee_id
  )
ORDER BY
  CASE WHEN ps.category = 'overdue' THEN 0
       WHEN t.completion_deadline <= @now THEN 1
       ELSE 2
  END ASC,
  t.completion_deadline ASC;

-- name: ListOverdueRitualInstances :many
SELECT t.* FROM collaboration.task t
JOIN collaboration.project_state ps ON (ps.organization_id, ps.id) = (t.organization_id, t.state_id)
WHERE t.organization_id = @organization_id
  AND t.project_id = @project_id
  AND t.task_kind = 'ritual_instance'
  AND t.is_deleted = FALSE
  AND t.completion_deadline < @now
  AND ps.category NOT IN ('verified', 'missed', 'skipped');

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
  COUNT(*) AS total_instances,
  COUNT(*) FILTER (WHERE ps.category = 'verified') AS verified_count,
  COUNT(*) FILTER (WHERE ps.category = 'overdue') AS overdue_count,
  COUNT(*) FILTER (WHERE ps.category = 'missed') AS missed_count,
  COUNT(*) FILTER (WHERE ps.category = 'skipped') AS skipped_count
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
SELECT
  ta.employee_id,
  COUNT(*) AS total_assigned,
  COUNT(*) FILTER (WHERE ps.category = 'verified' AND t.completion_deadline >= t.updated_at) AS completed_on_time,
  COUNT(*) FILTER (WHERE ps.category = 'verified' AND t.completion_deadline < t.updated_at) AS completed_late,
  COUNT(*) FILTER (WHERE ps.category = 'missed') AS missed
FROM collaboration.task t
JOIN collaboration.task_assignee ta ON (ta.organization_id, ta.task_id) = (t.organization_id, t.id)
JOIN collaboration.project_state ps ON (ps.organization_id, ps.id) = (t.organization_id, t.state_id)
WHERE t.organization_id = @organization_id
  AND t.project_id = @project_id
  AND t.task_kind = 'ritual_instance'
  AND t.is_deleted = FALSE
  AND t.scheduled_date >= @start_date
  AND t.scheduled_date <= @end_date
  AND ta.role = 'assignee'
GROUP BY ta.employee_id;

-- name: GetProjectRitualSummary :one
SELECT
  COUNT(*) AS total_instances,
  COUNT(*) FILTER (WHERE ps.category = 'verified') AS verified_count,
  COUNT(*) FILTER (WHERE ps.category = 'overdue') AS overdue_count,
  COUNT(*) FILTER (WHERE ps.category = 'missed') AS missed_count,
  COUNT(*) FILTER (WHERE ps.category IN ('submitted')) AS pending_review_count
FROM collaboration.task t
JOIN collaboration.project_state ps ON (ps.organization_id, ps.id) = (t.organization_id, t.state_id)
WHERE t.organization_id = @organization_id
  AND t.project_id = @project_id
  AND t.task_kind = 'ritual_instance'
  AND t.is_deleted = FALSE
  AND t.scheduled_date >= @start_date
  AND t.scheduled_date <= @end_date;

-- ============================================================
-- MODIFICATIONS TO EXISTING QUERIES
-- ============================================================

-- ListTasks: Add task_kind filter
-- Change existing ListTasks to add:
--   AND (sqlc.narg('task_kind')::text IS NULL OR t.task_kind = sqlc.narg('task_kind'))

-- CreateTask: Add new columns
-- Change existing CreateTask to include:
--   task_kind, ritual_definition_id, scheduled_date, completion_deadline
--   with appropriate defaults for standard tasks

-- UpdateTask: Add skip_reason
-- Change existing UpdateTask COALESCE set to include:
--   skip_reason = COALESCE(sqlc.narg('skip_reason'), skip_reason)
