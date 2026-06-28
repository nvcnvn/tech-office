-- SQL queries to add to backend/database/scripts/notification.query.sql
-- These queries will be processed by sqlc to generate type-safe Go code

-- ============================================================================
-- PRESENCE STATUS QUERIES
-- ============================================================================

-- name: UpdatePresenceStatus :one
UPDATE notification.active_connection
SET presence_status = sqlc.arg('presence_status'),
    active_channel_id = sqlc.narg('active_channel_id'),
    last_interaction_at = sqlc.arg('last_interaction_at'),
    last_heartbeat = sqlc.arg('last_heartbeat')
WHERE organization_id = sqlc.arg('organization_id')
  AND connection_id = sqlc.arg('connection_id')
RETURNING *;

-- name: GetActiveConnectionsByPresence :many
SELECT connection_id, employee_id, organization_id, instance_id,
       presence_status, active_channel_id, last_heartbeat, last_interaction_at
FROM notification.active_connection
WHERE organization_id = sqlc.arg('organization_id')
  AND presence_status = ANY(sqlc.arg('statuses')::text[])
  AND last_heartbeat > sqlc.arg('stale_threshold');

-- name: GetActiveConnectionsByChannel :many
SELECT connection_id, employee_id, organization_id, instance_id,
       presence_status, last_heartbeat
FROM notification.active_connection
WHERE organization_id = sqlc.arg('organization_id')
  AND active_channel_id = sqlc.arg('channel_id')
  AND presence_status = sqlc.arg('presence_status')
  AND last_heartbeat > sqlc.arg('stale_threshold');

-- name: GetEmployeeActiveConnections :many
SELECT connection_id, instance_id, presence_status, active_channel_id, last_heartbeat
FROM notification.active_connection
WHERE organization_id = sqlc.arg('organization_id')
  AND employee_id = sqlc.arg('employee_id')
  AND last_heartbeat > sqlc.arg('stale_threshold');

-- name: CleanupStaleConnections :exec
DELETE FROM notification.active_connection
WHERE last_heartbeat < sqlc.arg('stale_threshold');

-- ============================================================================
-- PUSH TOKEN QUERIES
-- ============================================================================

-- name: InsertPushToken :one
INSERT INTO notification.push_token (
    token_id, employee_id, organization_id, device_identifier,
    fcm_token, endpoint, keys, registered_at, last_used_at, updated_at
)
VALUES (
    sqlc.arg('token_id'),
    sqlc.arg('employee_id'),
    sqlc.arg('organization_id'),
    sqlc.arg('device_identifier'),
    sqlc.arg('fcm_token'),
    sqlc.arg('endpoint'),
    sqlc.arg('keys'),
    sqlc.arg('registered_at'),
    sqlc.arg('last_used_at'),
    sqlc.arg('updated_at')
)
RETURNING *;

-- name: UpsertPushToken :one
INSERT INTO notification.push_token (
    token_id, employee_id, organization_id, device_identifier,
    fcm_token, endpoint, keys, registered_at, last_used_at, updated_at
)
VALUES (
    sqlc.arg('token_id'),
    sqlc.arg('employee_id'),
    sqlc.arg('organization_id'),
    sqlc.arg('device_identifier'),
    sqlc.arg('fcm_token'),
    sqlc.arg('endpoint'),
    sqlc.arg('keys'),
    sqlc.arg('registered_at'),
    sqlc.arg('last_used_at'),
    sqlc.arg('updated_at')
)
ON CONFLICT (organization_id, employee_id, device_identifier) DO UPDATE
SET fcm_token = EXCLUDED.fcm_token,
    endpoint = EXCLUDED.endpoint,
    keys = EXCLUDED.keys,
    is_valid = true,
    updated_at = EXCLUDED.updated_at
RETURNING *;

-- name: GetEmployeePushTokens :many
SELECT token_id, device_identifier, fcm_token, endpoint, keys, is_valid,
       registered_at, last_used_at
FROM notification.push_token
WHERE organization_id = sqlc.arg('organization_id')
  AND employee_id = sqlc.arg('employee_id')
  AND is_valid = true
ORDER BY last_used_at DESC;

-- name: GetPushTokenByID :one
SELECT token_id, employee_id, organization_id, device_identifier,
       fcm_token, endpoint, keys, is_valid, registered_at, last_used_at, updated_at
FROM notification.push_token
WHERE organization_id = sqlc.arg('organization_id')
  AND token_id = sqlc.arg('token_id');

-- name: GetPushTokenByDeviceID :one
SELECT token_id, employee_id, organization_id, device_identifier,
       fcm_token, endpoint, keys, is_valid, registered_at, last_used_at, updated_at
FROM notification.push_token
WHERE organization_id = sqlc.arg('organization_id')
  AND employee_id = sqlc.arg('employee_id')
  AND device_identifier = sqlc.arg('device_identifier');

-- name: UpdatePushTokenLastUsed :exec
UPDATE notification.push_token
SET last_used_at = sqlc.arg('last_used_at'),
    updated_at = sqlc.arg('updated_at')
WHERE organization_id = sqlc.arg('organization_id')
  AND token_id = sqlc.arg('token_id');

-- name: InvalidatePushToken :exec
UPDATE notification.push_token
SET is_valid = false,
    updated_at = sqlc.arg('updated_at')
WHERE organization_id = sqlc.arg('organization_id')
  AND token_id = sqlc.arg('token_id');

-- name: RevokePushTokenByID :exec
DELETE FROM notification.push_token
WHERE organization_id = sqlc.arg('organization_id')
  AND employee_id = sqlc.arg('employee_id')
  AND token_id = sqlc.arg('token_id');

-- name: RevokePushTokenByDeviceID :exec
DELETE FROM notification.push_token
WHERE organization_id = sqlc.arg('organization_id')
  AND employee_id = sqlc.arg('employee_id')
  AND device_identifier = sqlc.arg('device_identifier');

-- name: CleanupUnusedPushTokens :exec
DELETE FROM notification.push_token
WHERE is_valid = true
  AND last_used_at < sqlc.arg('unused_threshold');

-- ============================================================================
-- PRESENCE VISIBILITY QUERIES
-- ============================================================================

-- name: GetPresenceVisibility :one
SELECT employee_id, organization_id, visibility_mode,
       custom_status_text, custom_status_emoji, updated_at
FROM notification.presence_visibility
WHERE organization_id = sqlc.arg('organization_id')
  AND employee_id = sqlc.arg('employee_id');

-- name: UpsertPresenceVisibility :one
INSERT INTO notification.presence_visibility (
    employee_id, organization_id, visibility_mode,
    custom_status_text, custom_status_emoji, updated_at
)
VALUES (
    sqlc.arg('employee_id'),
    sqlc.arg('organization_id'),
    sqlc.arg('visibility_mode'),
    sqlc.narg('custom_status_text'),
    sqlc.narg('custom_status_emoji'),
    sqlc.arg('updated_at')
)
ON CONFLICT (organization_id, employee_id) DO UPDATE
SET visibility_mode = EXCLUDED.visibility_mode,
    custom_status_text = EXCLUDED.custom_status_text,
    custom_status_emoji = EXCLUDED.custom_status_emoji,
    updated_at = EXCLUDED.updated_at
RETURNING *;

-- name: GetBatchPresenceVisibility :many
SELECT employee_id, visibility_mode, custom_status_text, custom_status_emoji
FROM notification.presence_visibility
WHERE organization_id = sqlc.arg('organization_id')
  AND employee_id = ANY(sqlc.arg('employee_ids')::uuid[]);

-- ============================================================================
-- DEPARTMENT MEMBERSHIP CHECKS (for visibility filtering)
-- ============================================================================

-- name: SharesDepartment :one
SELECT EXISTS (
    SELECT 1
    FROM organization.department_member dm1
    INNER JOIN organization.department_member dm2
        ON dm1.organization_id = dm2.organization_id
        AND dm1.department_id = dm2.department_id
    WHERE dm1.organization_id = sqlc.arg('organization_id')
      AND dm1.employee_id = sqlc.arg('viewer_employee_id')
      AND dm2.employee_id = sqlc.arg('target_employee_id')
) AS shares_department;

-- name: GetEmployeeDepartments :many
SELECT department_id
FROM organization.department_member
WHERE organization_id = sqlc.arg('organization_id')
  AND employee_id = sqlc.arg('employee_id');

-- ============================================================================
-- COMBINED PRESENCE + VISIBILITY QUERIES
-- ============================================================================

-- name: GetEmployeeVisiblePresence :one
-- Get employee presence with visibility filtering applied
SELECT 
    ac.employee_id,
    CASE 
        WHEN pv.visibility_mode = 'offline' THEN 'offline'
        WHEN pv.visibility_mode = 'departments' AND NOT EXISTS (
            SELECT 1
            FROM organization.department_member dm1
            INNER JOIN organization.department_member dm2
                ON dm1.organization_id = dm2.organization_id
                AND dm1.department_id = dm2.department_id
            WHERE dm1.organization_id = sqlc.arg('organization_id')
              AND dm1.employee_id = sqlc.arg('viewer_employee_id')
              AND dm2.employee_id = sqlc.arg('target_employee_id')
        ) THEN 'offline'
        ELSE COALESCE(ac.presence_status, 'offline')
    END AS visible_status,
    pv.custom_status_text,
    pv.custom_status_emoji,
    GREATEST(ac.last_heartbeat, pv.updated_at) AS updated_at
FROM organization.employee e
LEFT JOIN notification.active_connection ac
    ON ac.organization_id = e.organization_id
    AND ac.employee_id = e.id
    AND ac.last_heartbeat > sqlc.arg('stale_threshold')
LEFT JOIN notification.presence_visibility pv
    ON pv.organization_id = e.organization_id
    AND pv.employee_id = e.id
WHERE e.organization_id = sqlc.arg('organization_id')
  AND e.id = sqlc.arg('target_employee_id');

-- name: GetBatchEmployeeVisiblePresence :many
-- Get presence for multiple employees with visibility filtering
SELECT 
    e.id AS employee_id,
    CASE 
        WHEN pv.visibility_mode = 'offline' THEN 'offline'
        WHEN pv.visibility_mode = 'departments' AND NOT EXISTS (
            SELECT 1
            FROM organization.department_member dm1
            INNER JOIN organization.department_member dm2
                ON dm1.organization_id = dm2.organization_id
                AND dm1.department_id = dm2.department_id
            WHERE dm1.organization_id = sqlc.arg('organization_id')
              AND dm1.employee_id = sqlc.arg('viewer_employee_id')
              AND dm2.employee_id = e.id
        ) THEN 'offline'
        ELSE COALESCE(ac.presence_status, 'offline')
    END AS visible_status,
    pv.custom_status_text,
    pv.custom_status_emoji,
    GREATEST(ac.last_heartbeat, pv.updated_at) AS updated_at
FROM organization.employee e
LEFT JOIN notification.active_connection ac
    ON ac.organization_id = e.organization_id
    AND ac.employee_id = e.id
    AND ac.last_heartbeat > sqlc.arg('stale_threshold')
LEFT JOIN notification.presence_visibility pv
    ON pv.organization_id = e.organization_id
    AND pv.employee_id = e.id
WHERE e.organization_id = sqlc.arg('organization_id')
  AND e.id = ANY(sqlc.arg('employee_ids')::uuid[]);
