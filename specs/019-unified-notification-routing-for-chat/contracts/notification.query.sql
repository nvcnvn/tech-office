-- Unified Notification Routing — New/Modified sqlc Queries
-- These queries support preference-aware notification filtering across domains.

-- ============================================================================
-- Personal Notification Preferences
-- ============================================================================

-- name: GetPersonalPreference :one
SELECT * FROM notification.personal_preference
WHERE organization_id = @organization_id AND employee_id = @employee_id;

-- name: UpsertPersonalPreference :one
INSERT INTO notification.personal_preference (
    organization_id,
    employee_id,
    dnd_enabled,
    dnd_start,
    dnd_end,
    muted_domains
) VALUES (
    @organization_id, @employee_id, @dnd_enabled, @dnd_start, @dnd_end, @muted_domains
)
ON CONFLICT (organization_id, employee_id)
DO UPDATE SET
    dnd_enabled = EXCLUDED.dnd_enabled,
    dnd_start = EXCLUDED.dnd_start,
    dnd_end = EXCLUDED.dnd_end,
    muted_domains = EXCLUDED.muted_domains,
    updated_at = now()
RETURNING *;

-- name: DeletePersonalPreference :exec
DELETE FROM notification.personal_preference
WHERE organization_id = @organization_id AND employee_id = @employee_id;

-- ============================================================================
-- Document Follower Preference-Aware Queries
-- ============================================================================

-- name: GetDocumentFollowersForNotification :many
-- Fetches followers who should receive notifications for a document.
-- Filters by notification preference (excludes muted unless is_mention is true).
-- Matches chat.ListChannelMembersForNotification pattern.
SELECT
    f.employee_id,
    f.notification_preference
FROM docs.document_follower f
WHERE
    f.organization_id = @organization_id
    AND f.document_id = @document_id
    AND (f.notification_preference = 'all'
        OR (f.notification_preference = 'mentions' AND @is_mention::bool = TRUE)
        OR f.notification_preference IS NULL)
    AND f.notification_preference != 'muted';

-- name: UpdateDocumentFollowerPreference :exec
UPDATE docs.document_follower
SET notification_preference = @notification_preference
WHERE organization_id = @organization_id
    AND document_id = @document_id
    AND employee_id = @employee_id;

-- ============================================================================
-- Task Watcher Preference-Aware Queries
-- ============================================================================

-- name: ListTaskWatchersForNotification :many
-- Fetches watchers who should receive notifications for a task.
-- Joins with project_membership to check notification_preference at project level.
-- Matches chat.ListChannelMembersForNotification pattern.
SELECT
    tw.employee_id,
    tw.watch_reason,
    COALESCE(pm.notification_preference, 'all') AS notification_preference
FROM collaboration.task_watcher tw
LEFT JOIN collaboration.task t
    ON t.organization_id = tw.organization_id AND t.id = tw.task_id
LEFT JOIN collaboration.project_membership pm
    ON pm.organization_id = tw.organization_id
    AND pm.project_id = t.project_id
    AND pm.employee_id = tw.employee_id
WHERE
    tw.organization_id = @organization_id
    AND tw.task_id = @task_id
    AND (COALESCE(pm.notification_preference, 'all') = 'all'
        OR (COALESCE(pm.notification_preference, 'all') = 'mentions' AND @is_mention::bool = TRUE)
        OR (COALESCE(pm.notification_preference, 'all') = 'assigned' AND tw.watch_reason = 'assigned')
        OR pm.notification_preference IS NULL)
    AND COALESCE(pm.notification_preference, 'all') != 'muted';

-- ============================================================================
-- Global Preference Filtering (used at publish time)
-- ============================================================================

-- name: GetEmployeesMutedForDomain :many
-- Returns employee IDs that have muted a specific domain.
-- Used as exclusion list during notification publishing.
SELECT employee_id
FROM notification.personal_preference
WHERE organization_id = @organization_id
    AND @domain::text = ANY(muted_domains);

-- name: GetEmployeesInDND :many
-- Returns employee IDs currently in DND window.
-- Used to suppress push notifications (SSE still delivered).
SELECT employee_id
FROM notification.personal_preference
WHERE organization_id = @organization_id
    AND dnd_enabled = true
    AND dnd_start IS NOT NULL
    AND dnd_end IS NOT NULL
    AND @current_time::time BETWEEN dnd_start AND dnd_end;
