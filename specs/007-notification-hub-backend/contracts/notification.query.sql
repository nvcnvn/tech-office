-- Notification Hub sqlc Queries
-- Schema: notification
-- Generated Go package: database

-- ============================================================================
-- Notification Creation (Publishing)
-- ============================================================================

-- name: CreateNotification :one
INSERT INTO notification.notification (
    organization_id,
    source_domain,
    notification_type,
    publishing_service_id,
    title,
    message,
    action_data,
    action_category,
    priority
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9
) RETURNING *;

-- name: CreateNotificationRecipient :one
INSERT INTO notification.notification_recipient (
    notification_id,
    employee_id,
    organization_id,
    recipient_type,
    target_department_ids
) VALUES (
    $1, $2, $3, $4, $5
) RETURNING *;

-- name: CreateNotificationRecipientsBatch :copyfrom
INSERT INTO notification.notification_recipient (
    notification_id,
    employee_id,
    organization_id,
    recipient_type,
    target_department_ids
) VALUES (
    $1, $2, $3, $4, $5
);

-- name: CreateNotificationBatch :one
INSERT INTO notification.notification_batch (
    organization_id,
    batch_key,
    publishing_service_id,
    notification_ids,
    target_employee_ids,
    processing_status
) VALUES (
    $1, $2, $3, $4, $5, $6
) RETURNING *;

-- ============================================================================
-- Employee-Facing Queries (List Notifications)
-- ============================================================================

-- name: ListNotificationsByEmployee :many
SELECT 
    nr.id AS recipient_id,
    nr.notification_id,
    nr.read_status,
    nr.read_at,
    nr.delivery_status,
    nr.delivered_at,
    n.source_domain,
    n.notification_type,
    n.title,
    n.message,
    n.action_data,
    n.priority,
    n.updated_at
FROM notification.notification_recipient nr
JOIN notification.notification n ON nr.notification_id = n.id
WHERE nr.employee_id = $1
  AND nr.organization_id = $2
  AND ($3::boolean IS NULL OR nr.read_status = $3) -- Filter by read status if provided
  AND (sqlc.narg('source_domains')::text[] IS NULL OR n.source_domain = ANY(sqlc.narg('source_domains')::text[]))
ORDER BY n.updated_at DESC
LIMIT $4 OFFSET $5;

-- name: CountNotificationsByEmployee :one
SELECT COUNT(*)
FROM notification.notification_recipient nr
WHERE nr.employee_id = $1
  AND nr.organization_id = $2
  AND ($3::boolean IS NULL OR nr.read_status = $3)
  AND (sqlc.narg('source_domains')::text[] IS NULL OR EXISTS (
    SELECT 1 FROM notification.notification n 
    WHERE n.id = nr.notification_id 
      AND n.source_domain = ANY(sqlc.narg('source_domains')::text[])
  ));

-- name: GetUnreadCountByEmployee :one
SELECT COUNT(*)
FROM notification.notification_recipient
WHERE employee_id = $1
  AND organization_id = $2
  AND read_status = false;

-- name: GetUnreadCountBySourceDomain :many
SELECT n.source_domain, COUNT(*) AS unread_count
FROM notification.notification_recipient nr
JOIN notification.notification n ON nr.notification_id = n.id
WHERE nr.employee_id = $1
  AND nr.organization_id = $2
  AND nr.read_status = false
GROUP BY n.source_domain;

-- ============================================================================
-- Mark As Read Operations
-- ============================================================================

-- name: MarkNotificationAsRead :exec
UPDATE notification.notification_recipient
SET read_status = true,
    read_at = now(),
    updated_at = now()
WHERE id = $1
  AND employee_id = $2
  AND organization_id = $3
  AND read_status = false;

-- name: MarkNotificationsAsReadBatch :exec
UPDATE notification.notification_recipient
SET read_status = true,
    read_at = now(),
    updated_at = now()
WHERE id = ANY($1::uuid[])
  AND employee_id = $2
  AND organization_id = $3
  AND read_status = false;

-- name: MarkAllBeforeTimestampAsRead :exec
UPDATE notification.notification_recipient nr
SET read_status = true,
    read_at = now(),
    updated_at = now()
FROM notification.notification n
WHERE nr.notification_id = n.id
  AND nr.employee_id = $1
  AND nr.organization_id = $2
  AND n.updated_at < $3
  AND nr.read_status = false;

-- ============================================================================
-- Delete Notification (Soft Delete)
-- ============================================================================

-- name: DeleteNotificationRecipient :exec
DELETE FROM notification.notification_recipient
WHERE id = $1
  AND employee_id = $2
  AND organization_id = $3;

-- ============================================================================
-- Connection Registry Operations
-- ============================================================================

-- name: InsertActiveConnection :exec
INSERT INTO notification.active_connection (
    employee_id,
    instance_id,
    connection_id,
    organization_id,
    department_ids,
    user_agent,
    ip_address
) VALUES (
    $1, $2, $3, $4, $5, $6, $7
) ON CONFLICT (employee_id, connection_id) 
DO UPDATE SET 
    last_heartbeat = now(),
    connection_status = 'active';

-- name: UpdateConnectionHeartbeat :exec
UPDATE notification.active_connection
SET last_heartbeat = now()
WHERE employee_id = $1
  AND connection_id = $2
  AND connection_status = 'active';

-- name: RemoveActiveConnection :exec
DELETE FROM notification.active_connection
WHERE employee_id = $1
  AND connection_id = $2;

-- name: GetActiveConnectionsByEmployeeIDs :many
SELECT instance_id, array_agg(employee_id) AS employee_ids
FROM notification.active_connection
WHERE employee_id = ANY($1::uuid[])
  AND organization_id = $2
  AND connection_status = 'active'
GROUP BY instance_id;

-- name: GetActiveConnectionsByDepartmentIDs :many
SELECT instance_id, array_agg(employee_id) AS employee_ids
FROM notification.active_connection
WHERE department_ids && $1::uuid[] -- Array overlap operator
  AND organization_id = $2
  AND connection_status = 'active'
GROUP BY instance_id;

-- name: GetEmployeeDepartments :many
SELECT department_id
FROM organization.department_member
WHERE employee_id = $1
  AND organization_id = $2;

-- name: MarkStaleConnections :exec
UPDATE notification.active_connection
SET connection_status = 'stale'
WHERE last_heartbeat < now() - INTERVAL '60 seconds'
  AND connection_status = 'active';

-- name: CleanupStaleConnections :exec
DELETE FROM notification.active_connection
WHERE connection_status = 'stale'
  AND last_heartbeat < now() - INTERVAL '5 minutes';

-- ============================================================================
-- Delivery Tracking
-- ============================================================================

-- name: UpdateDeliveryStatus :exec
UPDATE notification.notification_recipient
SET delivery_status = $1,
    delivered_at = CASE WHEN $1 = 'delivered' THEN now() ELSE delivered_at END,
    delivery_attempts = delivery_attempts + 1,
    last_delivery_error = $2,
    updated_at = now()
WHERE id = $3;

-- name: CreateDeliveryLog :exec
INSERT INTO notification.notification_delivery_log (
    notification_recipient_id,
    delivery_method,
    attempt_number,
    delivery_result,
    error_message,
    latency_ms
) VALUES (
    $1, $2, $3, $4, $5, $6
);

-- name: GetPendingDeliveries :many
SELECT *
FROM notification.notification_recipient
WHERE delivery_status = 'pending'
  AND updated_at > now() - INTERVAL '1 hour'
ORDER BY updated_at ASC
LIMIT $1;

-- name: GetFailedDeliveries :many
SELECT nr.*, n.priority
FROM notification.notification_recipient nr
JOIN notification.notification n ON nr.notification_id = n.id
WHERE nr.delivery_status = 'failed'
  AND nr.delivery_attempts < 3
  AND nr.updated_at > now() - INTERVAL '24 hours'
ORDER BY nr.updated_at ASC
LIMIT $1;

-- ============================================================================
-- Batch Operations
-- ============================================================================

-- name: GetPendingBatches :many
SELECT *
FROM notification.notification_batch
WHERE processing_status = 'pending'
  AND updated_at > now() - INTERVAL '10 seconds'
ORDER BY updated_at ASC
LIMIT $1;

-- name: UpdateBatchStatus :exec
UPDATE notification.notification_batch
SET processing_status = $1,
    processed_at = CASE WHEN $1 = 'completed' THEN now() ELSE processed_at END,
    updated_at = now()
WHERE id = $2;

-- ============================================================================
-- Notification Details
-- ============================================================================

-- name: GetNotificationByID :one
SELECT *
FROM notification.notification
WHERE id = $1
  AND organization_id = $2;

-- name: GetNotificationRecipientByID :one
SELECT *
FROM notification.notification_recipient
WHERE id = $1
  AND employee_id = $2
  AND organization_id = $3;

-- ============================================================================
-- Metrics & Monitoring
-- ============================================================================

-- name: GetActiveConnectionCountByInstance :many
SELECT instance_id, COUNT(*) AS connection_count
FROM notification.active_connection
WHERE connection_status = 'active'
GROUP BY instance_id;

-- name: GetNotificationCountBySourceDomain :many
SELECT source_domain, COUNT(*) AS notification_count
FROM notification.notification
WHERE organization_id = $1
  AND updated_at > $2
GROUP BY source_domain;

-- name: GetDeliverySuccessRate :one
SELECT 
    COUNT(*) FILTER (WHERE delivery_status = 'delivered') AS delivered_count,
    COUNT(*) FILTER (WHERE delivery_status = 'failed') AS failed_count,
    COUNT(*) AS total_count
FROM notification.notification_recipient
WHERE organization_id = $1
  AND updated_at > $2;
