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
    priority,
    policy_key,
    delivery_class,
    navigation_target,
    source_category
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
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

-- name: SetFallbackQueuedForRecipients :many
UPDATE notification.notification_recipient
SET fallback_status = 'queued',
    fallback_reason = @fallback_reason,
    fallback_due_at = @fallback_due_at,
    fallback_updated_at = @updated_at,
    updated_at = @updated_at
WHERE organization_id = @organization_id
  AND notification_id = @notification_id
  AND employee_id = ANY(@employee_ids::uuid[])
RETURNING id, employee_id;

-- name: SetFallbackSkippedForRecipientsByEmployeeIDs :many
UPDATE notification.notification_recipient
SET fallback_status = 'skipped',
    fallback_reason = @fallback_reason,
    fallback_due_at = NULL,
    fallback_updated_at = @updated_at,
    updated_at = @updated_at
WHERE organization_id = @organization_id
  AND notification_id = @notification_id
  AND employee_id = ANY(@employee_ids::uuid[])
RETURNING id, employee_id;

-- name: ListNotificationRecipientIDsByEmployeeIDs :many
SELECT id, employee_id
FROM notification.notification_recipient
WHERE organization_id = @organization_id
  AND notification_id = @notification_id
  AND employee_id = ANY(@employee_ids::uuid[]);

-- name: SetFallbackSentForRecipient :exec
UPDATE notification.notification_recipient
SET fallback_status = 'sent',
    fallback_reason = sqlc.narg('fallback_reason'),
    fallback_due_at = NULL,
    fallback_updated_at = @updated_at,
    updated_at = @updated_at
WHERE organization_id = @organization_id
  AND id = @notification_recipient_id;

-- name: SetFallbackFailedForRecipient :exec
UPDATE notification.notification_recipient
SET fallback_status = 'failed',
    fallback_reason = @fallback_reason,
    fallback_due_at = NULL,
    fallback_updated_at = @updated_at,
    updated_at = @updated_at
WHERE organization_id = @organization_id
  AND id = @notification_recipient_id;

-- name: SetFallbackSkippedForRecipient :exec
UPDATE notification.notification_recipient
SET fallback_status = 'skipped',
    fallback_reason = @fallback_reason,
    fallback_due_at = NULL,
    fallback_updated_at = @updated_at,
    updated_at = @updated_at
WHERE organization_id = @organization_id
  AND id = @notification_recipient_id;

-- name: ListNotificationRecipientsForReceipt :many
SELECT nr.id,
       nr.employee_id,
       nr.fallback_status,
       nr.fallback_due_at,
       n.delivery_class
FROM notification.notification_recipient nr
JOIN notification.notification n ON (nr.organization_id, nr.notification_id) = (n.organization_id, n.id)
WHERE nr.organization_id = @organization_id
  AND nr.employee_id = @employee_id
  AND nr.id = ANY(@notification_recipient_ids::uuid[]);

-- name: UpsertLiveReceipt :exec
INSERT INTO notification.live_receipt (
    organization_id,
    notification_recipient_id,
    employee_id,
    connection_id,
    platform,
    app_state,
    visibility_state,
    received_at,
    metadata
) VALUES (
    @organization_id,
    @notification_recipient_id,
    @employee_id,
    @connection_id,
    @platform,
    @app_state,
    sqlc.narg('visibility_state'),
    @received_at,
    @metadata
)
ON CONFLICT (organization_id, notification_recipient_id, connection_id)
DO UPDATE SET
    platform = EXCLUDED.platform,
    app_state = EXCLUDED.app_state,
    visibility_state = EXCLUDED.visibility_state,
    received_at = EXCLUDED.received_at,
    metadata = EXCLUDED.metadata;

-- name: MarkQueuedFallbackSkippedByReceipt :many
UPDATE notification.notification_recipient
SET fallback_status = 'skipped',
    fallback_reason = 'sse_receipt_confirmed',
    fallback_due_at = NULL,
    fallback_updated_at = @updated_at,
    updated_at = @updated_at
WHERE organization_id = @organization_id
  AND employee_id = @employee_id
  AND id = ANY(@notification_recipient_ids::uuid[])
  AND fallback_status = 'queued'
  AND fallback_due_at IS NOT NULL
RETURNING id;

-- name: ValidateEmployeesExist :many
-- Validates that employee IDs exist in organization.employee table
-- Returns only the IDs that actually exist (for filtering invalid IDs)
SELECT e.id
FROM organization.employee e
WHERE e.organization_id = $1
  AND e.id = ANY($2::uuid[]);

-- ============================================================================
-- Notification V2 Resource Subscription Queries
-- ============================================================================

-- name: UpsertResourceSubscription :one
INSERT INTO notification.resource_subscription (
    organization_id,
    employee_id,
    resource_domain,
    resource_id,
    subscription_state,
    preference_level,
    updated_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7
)
ON CONFLICT (organization_id, employee_id, resource_domain, resource_id)
DO UPDATE SET
    subscription_state = EXCLUDED.subscription_state,
    preference_level = EXCLUDED.preference_level,
    updated_at = $7
RETURNING *;

-- name: GetResourceSubscriptionByEmployee :one
SELECT *
FROM notification.resource_subscription
WHERE organization_id = $1
  AND employee_id = $2
  AND resource_domain = $3
  AND resource_id = $4;

-- name: UpdateResourceSubscriptionPreference :one
UPDATE notification.resource_subscription
SET preference_level = $5, updated_at = $6
WHERE organization_id = $1
  AND employee_id = $2
  AND resource_domain = $3
  AND resource_id = $4
  AND subscription_state = 'active'
RETURNING *;

-- name: ListActiveResourceSubscriptionsByResource :many
SELECT *
FROM notification.resource_subscription
WHERE organization_id = $1
  AND resource_domain = $2
  AND resource_id = $3
  AND subscription_state = 'active'
ORDER BY created_at ASC;

-- name: AddResourceSubscriptionReason :exec
INSERT INTO notification.resource_subscription_reason (
    organization_id,
    subscription_id,
    reason_type,
    reason_ref_type,
    reason_ref_id,
    created_at
) VALUES (
    $1, $2, $3, $4, $5, $6
)
ON CONFLICT DO NOTHING;

-- name: DeleteResourceSubscriptionReason :exec
DELETE FROM notification.resource_subscription_reason
WHERE organization_id = $1
  AND subscription_id = $2
  AND reason_type = $3
  AND reason_ref_type IS NOT DISTINCT FROM $4
  AND reason_ref_id IS NOT DISTINCT FROM $5;

-- name: ListResourceSubscriptionReasons :many
SELECT *
FROM notification.resource_subscription_reason
WHERE organization_id = $1
  AND subscription_id = $2
ORDER BY created_at ASC;

-- name: UpsertResourceSurface :one
INSERT INTO notification.resource_surface (
    organization_id,
    parent_domain,
    parent_resource_id,
    surface_type,
    surface_domain,
    surface_resource_id,
    inherits_subscription,
    created_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8
)
ON CONFLICT (organization_id, surface_domain, surface_resource_id)
DO UPDATE SET
    parent_domain = EXCLUDED.parent_domain,
    parent_resource_id = EXCLUDED.parent_resource_id,
    surface_type = EXCLUDED.surface_type,
    inherits_subscription = EXCLUDED.inherits_subscription
RETURNING *;

-- name: GetResourceSurfaceBySurface :one
SELECT *
FROM notification.resource_surface
WHERE organization_id = $1
  AND surface_domain = $2
  AND surface_resource_id = $3;

-- name: ListNotificationsByEmployee :many
SELECT 
    nr.id AS recipient_id,
    nr.notification_id,
    nr.read_status,
    nr.read_at,
    nr.delivery_status,
    nr.delivered_at,
    nr.acknowledgement_status,
    nr.acknowledged_at,
    nr.acknowledgement_action,
    nr.fallback_status,
    nr.fallback_reason,
    n.source_domain,
    n.notification_type,
    n.title,
    n.message,
    n.action_data,
    n.navigation_target,
    n.policy_key,
    n.delivery_class,
    n.source_category,
    n.priority,
    n.updated_at
FROM notification.notification_recipient nr
JOIN notification.notification n ON (nr.organization_id, nr.notification_id) = (n.organization_id, n.id)
WHERE nr.employee_id = $1
  AND nr.organization_id = $2
  AND n.delivery_class = 'persistent'
  AND (sqlc.narg('acknowledgement_status_filter')::text IS NULL OR nr.acknowledgement_status = sqlc.narg('acknowledgement_status_filter')) -- Filter by ack status if provided
  AND (sqlc.narg('source_domains')::text[] IS NULL OR n.source_domain = ANY(sqlc.narg('source_domains')::text[]))
ORDER BY n.updated_at DESC
LIMIT $3 OFFSET $4;

-- name: GetUnreadCountByEmployee :one
SELECT COUNT(*)
FROM notification.notification_recipient nr
JOIN notification.notification n ON (nr.organization_id, nr.notification_id) = (n.organization_id, n.id)
WHERE nr.employee_id = $1
  AND nr.organization_id = $2
  AND nr.acknowledgement_status = 'pending'
  AND n.delivery_class = 'persistent';

-- name: GetUnreadCountBySourceDomain :many
SELECT n.source_domain, COUNT(*) AS unread_count
FROM notification.notification_recipient nr
JOIN notification.notification n ON (nr.organization_id, nr.notification_id) = (n.organization_id, n.id)
WHERE nr.employee_id = $1
  AND nr.organization_id = $2
  AND nr.acknowledgement_status = 'pending'
  AND n.delivery_class = 'persistent'
GROUP BY n.source_domain;

-- name: ListPendingNotificationRecipientIDsByChannelDestination :many
SELECT nr.id
FROM notification.notification_recipient nr
JOIN notification.notification n ON (nr.organization_id, nr.notification_id) = (n.organization_id, n.id)
WHERE nr.employee_id = sqlc.arg('employee_id')
  AND nr.organization_id = sqlc.arg('organization_id')
  AND nr.acknowledgement_status = 'pending'
  AND n.delivery_class = 'persistent'
  AND (
    (
      n.navigation_target->>'resourceType' = 'channel'
      AND n.navigation_target->>'resourceId' = sqlc.arg('channel_id')::text
    )
    OR n.navigation_target->>'secondaryId' = sqlc.arg('channel_id')::text
  );

-- ============================================================================
-- Np As Read Operations
-- ============================================================================

-- name: MarkNotificationsAsReadBatch :exec
UPDATE notification.notification_recipient
SET read_status = true,
    read_at = $4,
    delivery_status = 'delivered',
    delivered_at = CASE WHEN delivered_at IS NOT NULL THEN delivered_at ELSE $4 END,
    updated_at = $4
WHERE id = ANY($1::uuid[])
  AND employee_id = $2
  AND organization_id = $3
  AND read_status = false;

-- name: MarkAllBeforeTimestampAsRead :execrows
UPDATE notification.notification_recipient nr
SET read_status = true,
    read_at = $4,
    delivery_status = 'delivered',
    delivered_at = CASE WHEN nr.delivered_at IS NOT NULL THEN nr.delivered_at ELSE $4 END,
    updated_at = $4
FROM notification.notification n
WHERE nr.organization_id = n.organization_id
  AND nr.notification_id = n.id
  AND nr.employee_id = $1
  AND nr.organization_id = $2
  AND n.updated_at < $3
  AND nr.read_status = false;

-- ============================================================================
-- Acknowledgement Operations (authoritative unread lifecycle)
-- ============================================================================

-- name: AcknowledgeNotificationsBatch :exec
UPDATE notification.notification_recipient
SET acknowledgement_status = 'acknowledged',
    acknowledged_at = $4,
    acknowledgement_action = $5,
    updated_at = $4
WHERE id = ANY($1::uuid[])
  AND employee_id = $2
  AND organization_id = $3
  AND acknowledgement_status = 'pending';

-- name: AcknowledgeVoiceCallInvitationNotification :exec
-- Acknowledges the voice_call_incoming notification for a specific invitation (by secondaryId).
-- Called when an invitee responds to a voice call invitation so the notification is not
-- replayed as a stale popup on the next SSE reconnect.
UPDATE notification.notification_recipient nr
SET acknowledgement_status = 'acknowledged',
    acknowledged_at = sqlc.arg('acknowledged_at')::timestamptz,
    acknowledgement_action = 'explicit_ack',
    updated_at = sqlc.arg('acknowledged_at')::timestamptz
FROM notification.notification n
WHERE nr.organization_id = n.organization_id
  AND nr.notification_id = n.id
  AND nr.employee_id = sqlc.arg('employee_id')::uuid
  AND nr.organization_id = sqlc.arg('organization_id')::uuid
  AND nr.acknowledgement_status = 'pending'
  AND n.notification_type = 'voice_call_incoming'
  AND n.navigation_target->>'secondaryId' = sqlc.arg('invitation_id')::text;

-- name: AcknowledgeVoiceCallNotificationsForCall :exec
-- Acknowledges all pending incoming-call notifications for a call after the call reaches
-- a terminal lifecycle state, preventing stale global ringing popups on reconnect.
UPDATE notification.notification_recipient nr
SET acknowledgement_status = 'acknowledged',
    acknowledged_at = sqlc.arg('acknowledged_at')::timestamptz,
    acknowledgement_action = 'explicit_ack',
    updated_at = sqlc.arg('acknowledged_at')::timestamptz
FROM notification.notification n
WHERE nr.organization_id = n.organization_id
  AND nr.notification_id = n.id
  AND nr.organization_id = sqlc.arg('organization_id')::uuid
  AND nr.acknowledgement_status = 'pending'
  AND n.notification_type = 'voice_call_incoming'
  AND n.action_data->>'callId' = sqlc.arg('call_id')::text;

-- name: AcknowledgeAllBeforeTimestamp :execrows
UPDATE notification.notification_recipient nr
SET acknowledgement_status = 'acknowledged',
    acknowledged_at = $4,
    acknowledgement_action = $5,
    updated_at = $4
FROM notification.notification n
WHERE nr.organization_id = n.organization_id
  AND nr.notification_id = n.id
  AND nr.employee_id = $1
  AND nr.organization_id = $2
  AND n.updated_at < $3
  AND nr.acknowledgement_status = 'pending';

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
) ON CONFLICT (organization_id, employee_id, connection_id)
DO UPDATE SET
    instance_id = EXCLUDED.instance_id,
    last_pong_at = $8;

-- name: RemoveActiveConnection :exec
DELETE FROM notification.active_connection
WHERE organization_id = $1
  AND employee_id = $2
  AND connection_id = $3;

-- name: RecordPresencePongs :many
-- Advance liveness for a batch of connections in one organization.
-- UPDATE only — never an upsert — so a connection removed by the janitor is not
-- resurrected by a late pong. The RETURNING set tells the caller which pongs matched;
-- unmatched connection_ids receive PONG_DIRECTIVE_RECONNECT.
-- last_pong_at uses the DATABASE clock: client clocks are never trusted for liveness.
-- Matching on employee_id as well as connection_id is what enforces ownership: a pong
-- can only ever touch a row belonging to the authenticated employee, and a mismatched
-- pair simply fails to match — no separate authorization query.
-- active_channel_ids travels as text[] so an empty string can carry "no channel":
-- a uuid[] cannot hold a NULL element through the generated parameter type.
UPDATE notification.active_connection ac
SET presence_status    = p.presence_status,
    active_channel_id  = p.active_channel_id,
    last_interaction_at = p.last_interaction_at,
    last_pong_at       = now()
FROM (
        SELECT (@connection_ids::uuid[])[i]           AS connection_id,
               (@employee_ids::uuid[])[i]             AS employee_id,
               (@presence_statuses::text[])[i]        AS presence_status,
               nullif((@active_channel_ids::text[])[i], '')::uuid AS active_channel_id,
               (@last_interactions::timestamptz[])[i] AS last_interaction_at
        FROM generate_subscripts(@connection_ids::uuid[], 1) AS i
     ) AS p
WHERE ac.organization_id = @organization_id
  AND ac.employee_id     = p.employee_id
  AND ac.connection_id   = p.connection_id
RETURNING ac.connection_id;

-- name: RemoveDepartedConnections :execrows
-- Immediate removal for clients that announced a deliberate teardown.
-- Issued in the same flush as RecordPresencePongs, after it, for the departing subset.
DELETE FROM notification.active_connection
WHERE organization_id = @organization_id
  AND employee_id     = ANY(@employee_ids::uuid[])
  AND connection_id   = ANY(@connection_ids::uuid[]);

-- name: DeleteExpiredConnections :execrows
-- Sweep connections that have not pongged within the removal window.
-- Replaces the old mark-then-sweep pair; there is no longer anything to mark.
DELETE FROM notification.active_connection
WHERE organization_id = @organization_id
  AND last_pong_at < now() - make_interval(secs => @removal_window_seconds::int);

-- name: GetEmployeeActiveConnections :many
-- Feeds both presence aggregation and ShouldSendPush. A connection is a live-delivery
-- target iff it pongged within the responsive window — exactly one derived predicate,
-- compared on the database clock against a window Go owns (Constitution VIII).
SELECT connection_id,
       instance_id,
       active_channel_id,
       presence_status,
       last_pong_at,
       last_interaction_at
FROM notification.active_connection
WHERE organization_id = @organization_id
  AND employee_id = @employee_id
  AND last_pong_at >= now() - make_interval(secs => @responsive_window_seconds::int);

-- name: GetActiveConnectionsByEmployeeIDs :many
-- Live-routing fan-out by instance.
SELECT instance_id, array_agg(employee_id)::uuid[] AS employee_ids
FROM notification.active_connection
WHERE employee_id = ANY(@employee_ids::uuid[])
  AND organization_id = @organization_id
  AND last_pong_at >= now() - make_interval(secs => @responsive_window_seconds::int)
GROUP BY instance_id;

-- name: GetActiveConnectionsByChannelID :many
-- Channel-scoped live routing.
SELECT instance_id, array_agg(employee_id)::uuid[] AS employee_ids
FROM notification.active_connection
WHERE active_channel_id = @active_channel_id
  AND organization_id = @organization_id
  AND last_pong_at >= now() - make_interval(secs => @responsive_window_seconds::int)
GROUP BY instance_id;

-- name: GetEmployeeDepartments :many
SELECT department_id
FROM organization.department_member
WHERE employee_id = $1
  AND organization_id = $2;

-- name: ListOrganizationsWithActiveConnections :many
SELECT DISTINCT organization_id
FROM notification.active_connection;

-- name: ListOrganizationsWithDueFallbackRecipients :many
SELECT DISTINCT organization_id
FROM notification.notification_recipient
WHERE fallback_status = 'queued'
  AND fallback_due_at IS NOT NULL
  AND fallback_due_at <= @now_at;

-- ============================================================================
-- Delivery Attempt Operations (per-channel delivery audit trail)
-- ============================================================================

-- name: UpsertPushToken :one
INSERT INTO notification.push_token (
    token_id,
    organization_id,
    employee_id,
    device_identifier,
    fcm_token,
    permission_state,
    endpoint,
    keys,
    user_agent,
    registered_at,
    last_used_at,
    updated_at,
  is_valid,
  token_metadata
)
VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
)
ON CONFLICT (organization_id, employee_id, device_identifier) DO UPDATE
SET fcm_token = EXCLUDED.fcm_token,
    permission_state = EXCLUDED.permission_state,
    endpoint = EXCLUDED.endpoint,
    keys = EXCLUDED.keys,
    user_agent = EXCLUDED.user_agent,
    last_used_at = EXCLUDED.last_used_at,
    updated_at = EXCLUDED.updated_at,
  is_valid = true,
  token_metadata = EXCLUDED.token_metadata
RETURNING *;

-- name: GetEmployeePushTokens :many
SELECT token_id,
       device_identifier,
       fcm_token,
       permission_state,
       endpoint,
       keys,
       user_agent,
       registered_at,
       last_used_at,
       updated_at,
       is_valid,
       token_metadata
FROM notification.push_token
WHERE organization_id = $1
  AND employee_id = $2
  AND is_valid = true
ORDER BY last_used_at DESC;

-- name: GetPushTokenByID :one
SELECT *
FROM notification.push_token
WHERE organization_id = $1
  AND token_id = $2;

-- name: MarkPushTokenInvalid :exec
UPDATE notification.push_token
SET is_valid = false,
    updated_at = $3
WHERE organization_id = $1
  AND token_id = $2;

-- name: DeletePushToken :execrows
DELETE FROM notification.push_token
WHERE organization_id = $1
  AND (
      ($2::uuid IS NOT NULL AND token_id = $2)
    OR (
      $3::uuid IS NOT NULL
      AND $4::text IS NOT NULL
      AND employee_id = $3
      AND device_identifier = $4
    )
   );

-- name: CleanupStalePushTokens :execrows
DELETE FROM notification.push_token
WHERE organization_id = $1
  AND (
      is_valid = false
    OR last_used_at < $2
  );

-- =========================================================================
-- Presence Visibility Queries
-- =========================================================================

-- name: UpsertPresenceVisibility :one
INSERT INTO notification.presence_visibility (
    organization_id,
    employee_id,
    visibility_mode,
    custom_status_text,
    custom_status_emoji,
    updated_at
)
VALUES (
    $1, $2, $3, $4, $5, $6
)
ON CONFLICT (organization_id, employee_id) DO UPDATE
SET visibility_mode = EXCLUDED.visibility_mode,
    custom_status_text = EXCLUDED.custom_status_text,
    custom_status_emoji = EXCLUDED.custom_status_emoji,
    updated_at = EXCLUDED.updated_at
RETURNING *;

-- name: GetPresenceVisibility :one
SELECT organization_id,
       employee_id,
       visibility_mode,
       custom_status_text,
       custom_status_emoji,
       updated_at
FROM notification.presence_visibility
WHERE organization_id = $1
  AND employee_id = $2;

-- name: GetEmployeeVisiblePresence :many
SELECT ac.employee_id,
       ac.organization_id,
       ac.presence_status,
       ac.active_channel_id,
       ac.last_interaction_at,
       ac.last_pong_at,
       pv.visibility_mode,
       pv.custom_status_text,
  pv.custom_status_emoji,
  pv.updated_at
FROM notification.active_connection ac
LEFT JOIN notification.presence_visibility pv
  ON pv.organization_id = ac.organization_id
 AND pv.employee_id = ac.employee_id
WHERE ac.organization_id = @organization_id
  AND ac.employee_id = ANY(@employee_ids::uuid[])
  AND ac.last_pong_at >= now() - make_interval(secs => @responsive_window_seconds::int);

-- name: SharesDepartment :one
SELECT EXISTS (
    SELECT 1
    FROM organization.department_member dm1
    INNER JOIN organization.department_member dm2
        ON (dm1.organization_id, dm1.department_id) = (dm2.organization_id, dm2.department_id)
    WHERE dm1.organization_id = $1
      AND dm1.employee_id = $2
      AND dm2.employee_id = $3
) AS shares_department;

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
WHERE organization_id = $3
  AND id = $4;

-- name: GetFailedDeliveries :many
SELECT nr.*, n.priority
FROM notification.notification_recipient nr
JOIN notification.notification n ON (nr.organization_id, nr.notification_id) = (n.organization_id, n.id)
WHERE nr.delivery_status = 'failed'
  AND nr.delivery_attempts < 3
  AND nr.updated_at > now() - INTERVAL '24 hours'
ORDER BY nr.updated_at ASC
LIMIT $1;

-- name: InsertDeliveryAttempt :exec
INSERT INTO notification.delivery_attempt (
    organization_id,
    notification_recipient_id,
    channel,
    attempt_status,
    reason,
    attempted_at,
    instance_id,
    metadata
) VALUES (
    @organization_id,
    @notification_recipient_id,
    @channel,
    @attempt_status,
    sqlc.narg('reason'),
    @attempted_at,
    sqlc.narg('instance_id'),
    @metadata
);

-- name: ClaimDueFallbackRecipients :many
SELECT nr.id AS recipient_id,
       nr.notification_id,
       nr.employee_id,
       nr.organization_id,
       nr.acknowledgement_status,
       n.title,
       n.message,
       n.action_data,
       n.navigation_target,
       n.source_domain,
       n.notification_type,
       n.policy_key,
       n.priority
FROM notification.notification_recipient nr
JOIN notification.notification n ON (nr.organization_id, nr.notification_id) = (n.organization_id, n.id)
WHERE nr.organization_id = @organization_id
  AND nr.fallback_status = 'queued'
  AND nr.fallback_due_at IS NOT NULL
  AND nr.fallback_due_at <= @now_at
ORDER BY nr.fallback_due_at ASC, nr.id ASC
LIMIT @batch_limit
FOR UPDATE SKIP LOCKED;

-- name: HasSuppressibleLiveReceipt :one
SELECT EXISTS (
    SELECT 1
    FROM notification.live_receipt lr
    WHERE lr.organization_id = @organization_id
      AND lr.notification_recipient_id = @notification_recipient_id
      AND (
        (lr.platform = 'web' AND lr.app_state = 'foreground' AND lr.visibility_state = 'visible')
        OR (lr.platform = 'mobile' AND lr.app_state = 'foreground')
      )
) AS has_receipt;

-- ============================================================================
-- Batch Operations
-- ============================================================================

-- name: GetNotificationByID :one
SELECT *
FROM notification.notification
WHERE id = $1
  AND organization_id = $2;

-- name: GetNotificationWithRecipientDetails :many
SELECT 
    nr.id AS recipient_id,
    nr.notification_id,
    nr.employee_id,
    nr.read_status,
    nr.read_at,
    nr.delivery_status,
    nr.delivered_at,
  nr.acknowledgement_status,
  nr.acknowledged_at,
  nr.acknowledgement_action,
  nr.fallback_status,
  nr.fallback_reason,
    n.source_domain,
    n.notification_type,
    n.title,
    n.message,
    n.action_data,
  n.navigation_target,
  n.policy_key,
  n.delivery_class,
  n.source_category,
    n.priority,
    n.updated_at,
    n.organization_id
FROM notification.notification_recipient nr
JOIN notification.notification n ON (nr.organization_id, nr.notification_id) = (n.organization_id, n.id)
WHERE n.id = $1
  AND nr.employee_id = ANY($2::uuid[])
  AND n.organization_id = $3;

-- ============================================================================
-- Metrics & Monitoring
-- ============================================================================

-- name: GetPersonalPreference :one
SELECT * FROM notification.personal_preference
WHERE organization_id = @organization_id AND employee_id = @employee_id;

-- name: ListFollowedDocumentsBySubscription :many
SELECT d.*
FROM docs.document d
JOIN notification.resource_subscription rs
    ON rs.organization_id = d.organization_id AND rs.resource_id = d.id
WHERE rs.organization_id = @organization_id
  AND rs.employee_id = @employee_id
  AND rs.resource_domain = 'document'
  AND rs.subscription_state = 'active'
  AND d.is_deleted = FALSE
  AND (sqlc.narg('cursor')::uuid IS NULL OR d.id < sqlc.narg('cursor'))
ORDER BY d.id DESC
LIMIT @doc_limit;

-- name: ListResourceSubscriptionReasonsForResource :many
SELECT rsr.*
FROM notification.resource_subscription_reason rsr
JOIN notification.resource_subscription rs
    ON rsr.organization_id = rs.organization_id AND rsr.subscription_id = rs.id
WHERE rs.organization_id = @organization_id
  AND rs.resource_domain = @resource_domain
  AND rs.resource_id = @resource_id
ORDER BY rsr.created_at ASC;
