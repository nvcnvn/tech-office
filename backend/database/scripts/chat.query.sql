-- SQL Queries for Chat Backend System
-- File: backend/database/scripts/chat.query.sql
-- Generated Go package: database
-- Generated Go types: sqlc models
-- =============================================================================
-- CHANNEL CRUD QUERIES
-- =============================================================================
-- name: CreateChannel :one
-- Creates a new channel and automatically creates membership for creator as admin.
INSERT INTO chat.channel(id, organization_id, title_slug, display_name, description, channel_type, is_private, created_by_employee_id)
  VALUES (uuidv7(), $1, -- organization_id
    $2, -- title_slug
    $3, -- display_name
    $4, -- description
    $5, -- channel_type
    $6, -- is_private
    $7 -- created_by_employee_id
)
RETURNING
  *;

-- name: GetChannelByID :one
-- Retrieves a single channel by ID with organization filtering.
SELECT
  id,
  organization_id,
  title_slug,
  display_name,
  description,
  channel_type,
  is_private,
  is_archived,
  created_by_employee_id,
  updated_at
FROM
  chat.channel
WHERE
  id = $1
  AND organization_id = $2;

-- name: ListChannelsForUser :many
-- Lists all channels that a user is a member of, ordered by most recent activity.
-- Includes computed member_count via subquery.
SELECT
  c.id,
  c.organization_id,
  c.title_slug,
  c.display_name,
  c.description,
  c.channel_type,
  c.is_private,
  c.is_archived,
  c.created_by_employee_id,
  c.updated_at,
(
    SELECT
      COUNT(*)
    FROM
      chat.channel_membership cm
    WHERE
      cm.channel_id = c.id
      AND cm.organization_id = c.organization_id) AS member_count
FROM
  chat.channel c
  INNER JOIN chat.channel_membership m ON (c.organization_id, c.id) = (m.organization_id, m.channel_id)
WHERE
  m.employee_id = $1
  AND c.organization_id = $2
  AND ($3::bool IS NULL
    OR c.is_archived = $3) -- Optional filter by archived status
  ORDER BY
    c.updated_at DESC
  LIMIT $4 OFFSET $5;

-- name: UpdateChannel :one
-- Updates channel metadata (display name, description, privacy).
UPDATE
  chat.channel
SET
  display_name = COALESCE($3, display_name),
  description = COALESCE($4, description),
  is_private = COALESCE($5, is_private),
  updated_at = now()
WHERE
  id = $1
  AND organization_id = $2
RETURNING
  *;

-- name: ArchiveChannel :one
-- Archives a channel (prevents new messages and notifications).
UPDATE
  chat.channel
SET
  is_archived = TRUE,
  updated_at = now()
WHERE
  id = $1
  AND organization_id = $2
RETURNING
  *;

-- name: UnarchiveChannel :one
-- Unarchives a channel (restores full functionality).
UPDATE
  chat.channel
SET
  is_archived = FALSE,
  updated_at = now()
WHERE
  id = $1
  AND organization_id = $2
RETURNING
  *;

-- name: CreateChannelMembership :one
-- Adds a member to a channel with optional admin status.
INSERT INTO chat.channel_membership(id, organization_id, channel_id, employee_id, is_admin, notification_preference)
  VALUES (uuidv7(), $1, -- organization_id
    $2, -- channel_id
    $3, -- employee_id
    $4, -- is_admin
    $5 -- notification_preference
)
RETURNING
  *;

-- name: EnsureChannelMembership :exec
-- Idempotent upsert for active participants (assignees, commenters, @mentioned).
-- Inserts with 'all' preference; if already a member with 'mentions' (read-only access),
-- upgrades to 'all'. Explicit 'muted' preference is preserved.
INSERT INTO chat.channel_membership(id, organization_id, channel_id, employee_id, is_admin, notification_preference)
  VALUES (uuidv7(), @organization_id, @channel_id, @employee_id, FALSE, 'all')
ON CONFLICT (organization_id, channel_id, employee_id) DO UPDATE
  SET notification_preference = 'all'
  WHERE chat.channel_membership.notification_preference = 'mentions';

-- name: EnrollProjectMembersInChannel :exec
-- Batch-enrolls all current project members into a task channel when the task is created.
-- Uses 'mentions' preference so project members only get notified when @mentioned,
-- avoiding distraction for members not involved in the task. Existing memberships
-- (e.g. assignees already enrolled with 'all') are silently preserved.
INSERT INTO chat.channel_membership(id, organization_id, channel_id, employee_id, is_admin, notification_preference)
SELECT uuidv7(), @organization_id::uuid, @channel_id::uuid, pm.employee_id, FALSE, 'mentions'
FROM collaboration.project_membership pm
WHERE pm.organization_id = @organization_id::uuid
  AND pm.project_id = @project_id::uuid
ON CONFLICT (organization_id, channel_id, employee_id) DO NOTHING;

-- name: GetChannelMembership :one
-- Retrieves a specific membership record.
SELECT
  id,
  organization_id,
  channel_id,
  employee_id,
  is_admin,
  notification_preference,
  last_viewed_message_id,
  last_viewed_at,
  joined_at,
  updated_at
FROM
  chat.channel_membership
WHERE
  channel_id = $1
  AND employee_id = $2
  AND organization_id = $3;

-- name: ListChannelMembers :many
-- Lists all members of a channel with pagination.
SELECT
  cm.id,
  cm.organization_id,
  cm.channel_id,
  cm.employee_id,
  cm.is_admin,
  cm.notification_preference,
  cm.joined_at,
  cm.updated_at,
  e.given_name || ' ' || e.family_name AS employee_name,
  e.id::text AS employee_email
FROM
  chat.channel_membership cm
  INNER JOIN organization.employee e ON (cm.organization_id, cm.employee_id) = (e.organization_id, e.id)
WHERE
  cm.channel_id = $1
  AND cm.organization_id = $2
ORDER BY
  cm.joined_at DESC
LIMIT $3 OFFSET $4;

-- name: ListChannelMembersForNotification :many
-- Efficiently fetches members who should receive notifications for a channel.
-- Filters by notification preference (excludes muted unless is_mention is true).
SELECT
  employee_id,
  notification_preference
FROM
  chat.channel_membership
WHERE
  channel_id = $1
  AND organization_id = $2
  AND (notification_preference = 'all'
    OR (notification_preference = 'mentions'
      AND $3::bool = TRUE)
    OR -- is_mention parameter
    notification_preference IS NULL)
  AND notification_preference != 'muted';

-- name: CountChannelMembers :one
-- Counts total members in a channel.
SELECT
  COUNT(*) AS count
FROM
  chat.channel_membership
WHERE
  channel_id = $1
  AND organization_id = $2;

-- name: UpdateMembershipRole :one
-- Updates a member's admin status.
UPDATE
  chat.channel_membership
SET
  is_admin = $4,
  updated_at = now()
WHERE
  channel_id = $1
  AND employee_id = $2
  AND organization_id = $3
RETURNING
  *;

-- name: UpdateMembershipNotificationPreference :one
-- Updates a member's notification preference for a channel.
UPDATE
  chat.channel_membership
SET
  notification_preference = $4,
  updated_at = now()
WHERE
  channel_id = $1
  AND employee_id = $2
  AND organization_id = $3
RETURNING
  *;

-- name: RemoveChannelMember :exec
-- Removes a member from a channel.
DELETE FROM chat.channel_membership
WHERE channel_id = $1
  AND employee_id = $2
  AND organization_id = $3;

-- name: CountChannelAdmins :one
-- Counts number of admins in a channel (used to prevent removing last admin).
SELECT
  COUNT(*) AS count
FROM
  chat.channel_membership
WHERE
  channel_id = $1
  AND organization_id = $2
  AND is_admin = TRUE;

-- name: GetOldestMember :one
-- Retrieves oldest non-admin member (for auto-promotion when last admin leaves).
SELECT
  id,
  organization_id,
  channel_id,
  employee_id,
  is_admin,
  notification_preference,
  joined_at,
  updated_at
FROM
  chat.channel_membership
WHERE
  channel_id = $1
  AND organization_id = $2
  AND is_admin = FALSE
ORDER BY
  joined_at ASC
LIMIT 1;

-- =============================================================================
-- MESSAGE CRUD QUERIES
-- =============================================================================
-- name: CreateMessage :one
-- Creates a new message (top-level or reply). PGroonga automatically handles multilingual indexing.
INSERT INTO chat.message(id, organization_id, channel_id, message_text, author_employee_id, parent_message_id, mentions, file_ids)
  VALUES (uuidv7(), $1, -- organization_id
    $2, -- channel_id
    $3, -- message_text
    $4, -- author_employee_id
    $5, -- parent_message_id (NULL for top-level)
    $6, -- mentions (JSONB array of {type, id, label})
    $7 -- file_ids (JSONB array of file UUIDs)
)
RETURNING
  *;

-- name: GetMessageByID :one
-- Retrieves a single message by ID.
SELECT
  m.id,
  m.organization_id,
  m.channel_id,
  m.message_text,
  m.author_employee_id,
  m.parent_message_id,
  m.is_deleted,
  m.is_edited,
  m.file_ids,
  m.message_kind,
  m.system_event_type,
  m.metadata,
  m.updated_at,
  (e.given_name || ' ' || e.family_name)::text AS author_name,
  e.id::text AS author_email,
  (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'emoji_code', agg.emoji_code,
        'count', agg.count,
        'employee_ids', agg.employee_ids,
        'first_reacted_at', agg.first_reacted_at
      )
      ORDER BY agg.count DESC, agg.emoji_code
    ), '[]'::jsonb)
    FROM (
      SELECT
        r.emoji_code,
        COUNT(*) AS count,
        array_agg(r.employee_id ORDER BY r.employee_id) AS employee_ids,
        MIN(updated_at) AS first_reacted_at
      FROM chat.reaction r
      WHERE r.message_id = m.id
        AND r.organization_id = m.organization_id
      GROUP BY r.emoji_code
    ) agg
  )::jsonb AS reactions_json
FROM
  chat.message m
  INNER JOIN organization.employee e ON (m.organization_id, m.author_employee_id) = (e.organization_id, e.id)
WHERE
  m.id = $1
  AND m.organization_id = $2;

-- name: ListChannelMessages :many
-- Lists messages in a channel with cursor-based pagination (ordered by id DESC for loading newest first).
-- Uses UUID v7 as cursor: id encodes creation timestamp, enabling time-based pagination without separate timestamp column.
-- When no cursor: returns most recent messages (newest first).
-- When cursor provided: returns older messages (before cursor id).
-- Frontend reverses the array to display oldest-to-newest (chat UX: newest at bottom).
-- Includes thread reply metadata and aggregated reactions for initial render.
SELECT
  m.id,
  m.organization_id,
  m.channel_id,
  m.message_text,
  m.author_employee_id,
  m.parent_message_id,
  m.is_deleted,
  m.is_edited,
  m.file_ids,
  m.message_kind,
  m.system_event_type,
  m.metadata,
  m.updated_at,
  (e.given_name || ' ' || e.family_name)::text AS author_name,
  e.id::text AS author_email,
  (
    SELECT COUNT(*)
    FROM chat.message replies
    WHERE replies.parent_message_id = m.id
      AND replies.organization_id = m.organization_id
  ) AS reply_count,
  (
    SELECT COALESCE(array_agg(DISTINCT replies.author_employee_id ORDER BY replies.author_employee_id), ARRAY[]::uuid[])
    FROM chat.message replies
    WHERE replies.parent_message_id = m.id
      AND replies.organization_id = m.organization_id
  )::uuid[] AS thread_participant_ids,
  (
    SELECT MAX(replies.updated_at)
    FROM chat.message replies
    WHERE replies.parent_message_id = m.id
      AND replies.organization_id = m.organization_id
  )::timestamptz AS last_reply_at,
  (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'emoji_code', agg.emoji_code,
        'count', agg.count,
        'employee_ids', agg.employee_ids,
        'first_reacted_at', agg.first_reacted_at
      )
      ORDER BY agg.count DESC, agg.emoji_code
    ), '[]'::jsonb)
    FROM (
      SELECT
        r.emoji_code,
        COUNT(*) AS count,
        array_agg(r.employee_id ORDER BY r.employee_id) AS employee_ids,
        MIN(r.updated_at) AS first_reacted_at
      FROM chat.reaction r
      WHERE r.message_id = m.id
        AND r.organization_id = m.organization_id
      GROUP BY r.emoji_code
    ) agg
  )::jsonb AS reactions_json
FROM
  chat.message m
  INNER JOIN organization.employee e ON (m.organization_id, m.author_employee_id) = (e.organization_id, e.id)
WHERE
  m.channel_id = sqlc.arg('channel_id')
  AND m.organization_id = sqlc.arg('organization_id')
  AND m.parent_message_id IS NULL -- Only top-level messages
  AND m.is_deleted = FALSE
  AND (sqlc.narg('cursor_id')::uuid IS NULL
    OR m.id < sqlc.narg('cursor_id')::uuid) -- UUID v7 cursor (time-sortable, stable ordering)
ORDER BY
  m.id DESC
LIMIT sqlc.arg('limit');

-- name: ListChannelMessagesUpToAnchor :many
-- Lists messages up to and including the specified anchor message ID (used for deep-link initialization).
-- Results are ordered newest-first and should be reversed in application code for display.
SELECT
  m.id,
  m.organization_id,
  m.channel_id,
  m.message_text,
  m.author_employee_id,
  m.parent_message_id,
  m.is_deleted,
  m.is_edited,
  m.file_ids,
  m.message_kind,
  m.system_event_type,
  m.metadata,
  m.updated_at,
  (e.given_name || ' ' || e.family_name)::text AS author_name,
  e.id::text AS author_email,
  (
    SELECT COUNT(*)
    FROM chat.message replies
    WHERE replies.parent_message_id = m.id
      AND replies.organization_id = m.organization_id
  ) AS reply_count,
  (
    SELECT COALESCE(array_agg(DISTINCT replies.author_employee_id ORDER BY replies.author_employee_id), ARRAY[]::uuid[])
    FROM chat.message replies
    WHERE replies.parent_message_id = m.id
      AND replies.organization_id = m.organization_id
  )::uuid[] AS thread_participant_ids,
  (
    SELECT MAX(replies.updated_at)
    FROM chat.message replies
    WHERE replies.parent_message_id = m.id
      AND replies.organization_id = m.organization_id
  )::timestamptz AS last_reply_at,
  (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'emoji_code', agg.emoji_code,
        'count', agg.count,
        'employee_ids', agg.employee_ids,
        'first_reacted_at', agg.first_reacted_at
      )
      ORDER BY agg.count DESC, agg.emoji_code
    ), '[]'::jsonb)
    FROM (
      SELECT
        r.emoji_code,
        COUNT(*) AS count,
        array_agg(r.employee_id ORDER BY r.employee_id) AS employee_ids,
        MIN(updated_at) AS first_reacted_at
      FROM chat.reaction r
      WHERE r.message_id = m.id
        AND r.organization_id = m.organization_id
      GROUP BY r.emoji_code
    ) agg
  )::jsonb AS reactions_json
FROM
  chat.message m
  INNER JOIN organization.employee e ON (m.organization_id, m.author_employee_id) = (e.organization_id, e.id)
WHERE
  m.channel_id = sqlc.arg('channel_id')
  AND m.organization_id = sqlc.arg('organization_id')
  AND m.parent_message_id IS NULL
  AND m.is_deleted = FALSE
  AND m.id <= sqlc.arg('anchor_id')::uuid
ORDER BY
  m.id DESC
LIMIT sqlc.arg('limit');

-- name: ListChannelMessagesAfter :many
-- Lists messages newer than the provided cursor (ascending order) for forward pagination.
SELECT
  m.id,
  m.organization_id,
  m.channel_id,
  m.message_text,
  m.author_employee_id,
  m.parent_message_id,
  m.is_deleted,
  m.is_edited,
  m.file_ids,
  m.message_kind,
  m.system_event_type,
  m.metadata,
  m.updated_at,
  (e.given_name || ' ' || e.family_name)::text AS author_name,
  e.id::text AS author_email,
  (
    SELECT COUNT(*)
    FROM chat.message replies
    WHERE replies.parent_message_id = m.id
      AND replies.organization_id = m.organization_id
  ) AS reply_count,
  (
    SELECT COALESCE(array_agg(DISTINCT replies.author_employee_id ORDER BY replies.author_employee_id), ARRAY[]::uuid[])
    FROM chat.message replies
    WHERE replies.parent_message_id = m.id
      AND replies.organization_id = m.organization_id
  )::uuid[] AS thread_participant_ids,
  (
    SELECT MAX(replies.updated_at)
    FROM chat.message replies
    WHERE replies.parent_message_id = m.id
      AND replies.organization_id = m.organization_id
  )::timestamptz AS last_reply_at,
  (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'emoji_code', agg.emoji_code,
        'count', agg.count,
        'employee_ids', agg.employee_ids,
        'first_reacted_at', agg.first_reacted_at
      )
      ORDER BY agg.count DESC, agg.emoji_code
    ), '[]'::jsonb)
    FROM (
      SELECT
        r.emoji_code,
        COUNT(*) AS count,
        array_agg(r.employee_id ORDER BY r.employee_id) AS employee_ids,
        MIN(updated_at) AS first_reacted_at
      FROM chat.reaction r
      WHERE r.message_id = m.id
        AND r.organization_id = m.organization_id
      GROUP BY r.emoji_code
    ) agg
  )::jsonb AS reactions_json
FROM
  chat.message m
  INNER JOIN organization.employee e ON (m.organization_id, m.author_employee_id) = (e.organization_id, e.id)
WHERE
  m.channel_id = sqlc.arg('channel_id')
  AND m.organization_id = sqlc.arg('organization_id')
  AND m.parent_message_id IS NULL
  AND m.is_deleted = FALSE
  AND m.id > sqlc.arg('after_id')::uuid
ORDER BY
  m.id ASC
LIMIT sqlc.arg('limit');

-- name: ListMessageReplies :many
-- Lists all replies to a specific message.
SELECT
  m.id,
  m.organization_id,
  m.channel_id,
  m.message_text,
  m.author_employee_id,
  m.parent_message_id,
  m.is_deleted,
  m.is_edited,
  m.file_ids,
  m.message_kind,
  m.system_event_type,
  m.metadata,
  m.updated_at,
  (e.given_name || ' ' || e.family_name)::text AS author_name,
  e.id::text AS author_email,
  (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'emoji_code', agg.emoji_code,
        'count', agg.count,
        'employee_ids', agg.employee_ids,
        'first_reacted_at', agg.first_reacted_at
      )
      ORDER BY agg.count DESC, agg.emoji_code
    ), '[]'::jsonb)
    FROM (
      SELECT
        r.emoji_code,
        COUNT(*) AS count,
        array_agg(r.employee_id ORDER BY r.employee_id) AS employee_ids,
        MIN(updated_at) AS first_reacted_at
      FROM chat.reaction r
      WHERE r.message_id = m.id
        AND r.organization_id = m.organization_id
      GROUP BY r.emoji_code
    ) agg
  )::jsonb AS reactions_json
FROM
  chat.message m
  INNER JOIN organization.employee e ON (m.organization_id, m.author_employee_id) = (e.organization_id, e.id)
WHERE
  m.parent_message_id = $1
  AND m.organization_id = $2
ORDER BY
  m.updated_at ASC;

-- name: UpdateMessage :one
-- Edits a message (sets is_edited flag, updates message_text).
-- Note: edit_history JSONB update should be done at application level.
UPDATE
  chat.message
SET
  message_text = $3,
  is_edited = TRUE,
  updated_at = now()
WHERE
  id = $1
  AND organization_id = $2
RETURNING
  *;

-- name: SoftDeleteMessage :one
-- Soft deletes a message (preserves with is_deleted flag).
UPDATE
  chat.message
SET
  is_deleted = TRUE,
  updated_at = now()
WHERE
  id = $1
  AND organization_id = $2
RETURNING
  *;

-- name: AddReaction :one
-- Adds a reaction to a message (or does nothing if already exists due to unique constraint).
INSERT INTO chat.reaction(id, organization_id, message_id, employee_id, emoji_code)
  VALUES (uuidv7(), $1, -- organization_id
    $2, -- message_id
    $3, -- employee_id
    $4 -- emoji_code
)
ON CONFLICT (message_id, employee_id, emoji_code, organization_id)
  DO UPDATE SET updated_at = $5
RETURNING
  *;

-- name: RemoveReaction :exec
-- Removes a specific reaction from a message.
DELETE FROM chat.reaction
WHERE message_id = $1
  AND employee_id = $2
  AND emoji_code = $3
  AND organization_id = $4;

-- name: ListMessageReactions :many
-- Lists all reactions for a message, aggregated by emoji.
SELECT
  emoji_code,
  COUNT(*) AS count,
  MIN(updated_at) AS first_reacted_at,
  array_agg(employee_id) AS employee_ids
FROM
  chat.reaction
WHERE
  message_id = $1
  AND organization_id = $2
GROUP BY
  emoji_code
ORDER BY
  MIN(updated_at) ASC,
  emoji_code ASC;

-- name: GetMessageByIdWithChannel :one
-- Fetch message with channel context for notification navigation.
-- Security: Caller MUST verify employee is channel member before returning.
SELECT
  sqlc.embed(m),
  e.email AS author_email,
  CONCAT(e.given_name, ' ', e.family_name) AS author_name,
  c.title_slug AS channel_slug,
  c.display_name AS channel_display_name,
  c.is_private AS channel_is_private,
  (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'emoji_code', agg.emoji_code,
        'count', agg.count,
        'employee_ids', agg.employee_ids,
        'first_reacted_at', agg.first_reacted_at
      )
      ORDER BY agg.count DESC, agg.emoji_code
    ), '[]'::jsonb)
    FROM (
      SELECT
        r.emoji_code,
        COUNT(*) AS count,
        array_agg(r.employee_id ORDER BY r.employee_id) AS employee_ids,
        MIN(updated_at) AS first_reacted_at
      FROM chat.reaction r
      WHERE r.message_id = m.id
        AND r.organization_id = m.organization_id
      GROUP BY r.emoji_code
    ) agg
  )::jsonb AS reactions_json
FROM
  chat.message m
  JOIN organization.employee e ON (e.organization_id, e.id) = (m.organization_id, m.author_employee_id)
  JOIN chat.channel c ON (c.organization_id, c.id) = (m.organization_id, m.channel_id)
WHERE
  m.id = $1
  AND m.organization_id = $2
  AND m.is_deleted = FALSE;

-- name: UpdateChannelMembershipLastViewed :exec
-- Update last viewed message and timestamp for unread tracking.
UPDATE
  chat.channel_membership
SET
  last_viewed_message_id = $1,
  last_viewed_at = NOW()
WHERE
  employee_id = $2
  AND channel_id = $3
  AND organization_id = $4;

-- name: CheckChannelMembership :one
-- Validate if employee is member of channel (security check for GetMessageById).
SELECT
  EXISTS (
    SELECT
      1
    FROM
      chat.channel_membership
    WHERE
      employee_id = $1
      AND channel_id = $2
      AND organization_id = $3) AS is_member;

-- name: GetUnreadMessageCount :one
-- Calculate unread message count for channel sidebar badges.
SELECT
  COUNT(*)::int AS unread_count
FROM
  chat.message m
  JOIN chat.channel_membership cm ON (cm.organization_id, cm.channel_id) = (m.organization_id, m.channel_id)
WHERE
  cm.employee_id = $1
  AND cm.channel_id = $2
  AND cm.organization_id = $3
  AND (cm.last_viewed_at IS NULL
    OR m.updated_at > cm.last_viewed_at)
  AND m.is_deleted = FALSE;

-- =============================================================================
-- SEARCH QUERIES (Multilingual Fuzzy Search with pg_trgm)
-- =============================================================================
-- name: SearchChannels :many
-- Fuzzy search for channels by display_name and description with permission filtering.
-- Returns only channels the employee can access (public or member of private).
-- Uses lower similarity threshold (0.3) for better matching on short queries.
WITH search_config AS (
  SELECT
    set_limit(0.3) -- Lower threshold for short queries
)
SELECT
  c.id,
  c.organization_id,
  c.title_slug,
  c.display_name,
  c.description,
  c.channel_type,
  c.is_private,
  c.updated_at,
  similarity(c.display_name, sqlc.arg('query_text')) AS relevance_score
FROM
  chat.channel c
  CROSS JOIN search_config
WHERE
  c.organization_id = sqlc.arg('organization_id')
  AND c.is_archived = FALSE
  AND c.display_name % sqlc.arg('query_text')
  AND ( -- Permission filtering: public channels OR user is member
    c.is_private = FALSE
    OR EXISTS (
      SELECT
        1
      FROM
        chat.channel_membership cm
      WHERE
        cm.channel_id = c.id
        AND cm.employee_id = sqlc.arg('employee_id')
        AND cm.organization_id = c.organization_id))
  AND (sqlc.narg('cursor')::uuid IS NULL
    OR c.id < sqlc.narg('cursor')::uuid)
ORDER BY
  relevance_score DESC,
  c.updated_at DESC,
  c.id DESC
LIMIT sqlc.arg('limit')::int;

-- name: SearchMessages :many
-- Multilingual full-text search using PGroonga with automatic language detection.
-- Returns ranked results with highlighted snippets and channel context.
-- Permission filtering: Only returns messages from channels the employee can access.
--
-- APPROACH:
-- - Uses PGroonga's &@~ operator for full-text search across all languages
-- - Automatic tokenization for CJK (Chinese, Japanese, Korean) and Latin scripts
-- - Built-in relevance scoring via pgroonga_score()
-- - Native snippet generation with pgroonga_snippet_html()
--
-- INDEX USAGE:
-- - Requires PGroonga index: idx_message_pgroonga_search (see migration below)
-- - Single index handles all languages efficiently
-- - No need for separate FTS and trigram indexes
--
-- PERFORMANCE:
-- - Faster than pg_trgm for CJK languages
-- - Comparable to tsvector for Latin scripts
-- - Unified index reduces storage overhead
SELECT
  m.id,
  m.organization_id,
  m.channel_id,
  m.message_text,
  m.author_employee_id,
  m.parent_message_id,
  m.is_edited,
  m.file_ids,
  m.updated_at, -- PGroonga relevance score (higher = better match)
  pgroonga_score(m.tableoid, m.ctid)::real AS relevance_score, -- Highlighted snippet with <mark> tags (PGroonga default)
  pgroonga_snippet_html(m.message_text, pgroonga_query_extract_keywords(sqlc.arg('query_text'))) AS highlighted_snippet, -- Channel context for display
  c.display_name AS channel_name,
  c.is_private AS channel_is_private
FROM
  chat.message m
  INNER JOIN chat.channel c ON (m.organization_id, m.channel_id) = (c.organization_id, c.id)
WHERE
  m.organization_id = sqlc.arg('organization_id')
  AND m.is_deleted = FALSE -- PGroonga full-text search (supports all languages automatically)
  AND m.message_text &@~ sqlc.arg('query_text') -- Permission filtering: public channels OR member of private channel
    AND (c.is_private = FALSE
      OR EXISTS (
        SELECT
          1
        FROM
          chat.channel_membership cm
        WHERE
          cm.channel_id = c.id
          AND cm.employee_id = sqlc.arg('employee_id')
          AND cm.organization_id = m.organization_id)) -- Cursor pagination using UUID v7
    AND (sqlc.narg('cursor')::uuid IS NULL
      OR m.id < sqlc.narg('cursor')::uuid)
  ORDER BY
    relevance_score DESC,
    m.updated_at DESC,
    m.id DESC
  LIMIT sqlc.arg('limit')::int;

-- name: AutocompleteChannels :many
-- Prefix-based autocomplete for channel names with permission filtering.
-- Used for quick channel selection in UI.
SELECT
  c.id,
  c.organization_id,
  c.display_name,
  c.channel_type,
  c.is_private
FROM
  chat.channel c
WHERE
  c.organization_id = sqlc.arg('organization_id')
  AND c.is_archived = FALSE
  AND c.display_name ILIKE sqlc.arg('prefix') || '%'
  AND (c.is_private = FALSE
    OR EXISTS (
      SELECT
        1
      FROM
        chat.channel_membership cm
      WHERE
        cm.channel_id = c.id
        AND cm.employee_id = sqlc.arg('employee_id')
        AND cm.organization_id = c.organization_id))
ORDER BY
  c.display_name
LIMIT sqlc.arg('limit')::int;

-- =============================================================================
-- SEARCH QUERY NOTES:
-- 1. All search queries enforce organization_id for multi-tenant isolation
-- 2. Permission filtering uses EXISTS subqueries for efficient membership checks
-- 3. Trigram similarity (%) operator uses GIN indexes for fast fuzzy matching
-- 4. Autocomplete uses ILIKE prefix matching for instant suggestions
-- 5. Cursor pagination uses UUID v7 ordering for consistent paging
-- 6. Messages inherit permissions from their parent channel
-- 7. FTS (Full-Text Search) uses tsvector @@ tsquery for ranked message search
-- 8. ts_headline() generates highlighted snippets with <b> tags for match display
-- 9. Language-specific FTS configs handled by trigger (see schema.sql)
-- =============================================================================

-- =============================================================================
-- DIRECT MESSAGE QUERIES
-- =============================================================================

-- name: FindDirectMessageChannel :one
-- Finds existing direct message channel between two employees.
-- Returns NULL if no DM channel exists between the two users.
SELECT
  c.id,
  c.organization_id,
  c.title_slug,
  c.display_name,
  c.description,
  c.channel_type,
  c.is_private,
  c.is_archived,
  c.created_by_employee_id,
  c.updated_at
FROM
  chat.channel c
WHERE
  c.organization_id = $1
  AND c.channel_type = 'direct_message'
  AND c.is_archived = FALSE
  AND EXISTS (
    SELECT
      1
    FROM
      chat.channel_membership cm1
    WHERE
      cm1.channel_id = c.id
      AND cm1.employee_id = $2
      AND cm1.organization_id = c.organization_id)
  AND EXISTS (
    SELECT
      1
    FROM
      chat.channel_membership cm2
    WHERE
      cm2.channel_id = c.id
      AND cm2.employee_id = $3
      AND cm2.organization_id = c.organization_id)
  AND (
    SELECT
      COUNT(*)
    FROM
      chat.channel_membership cm
    WHERE
      cm.channel_id = c.id
      AND cm.organization_id = c.organization_id) = 2
LIMIT 1;

-- name: CreateDirectMessageChannel :one
-- Creates a new direct message channel.
-- Channel slug format: "dm-{smaller_uuid}-{larger_uuid}" for consistency.
INSERT INTO chat.channel(id, organization_id, title_slug, display_name, description, channel_type, is_private, created_by_employee_id)
  VALUES (uuidv7(), $1, -- organization_id
    $2, -- title_slug (generated: dm-uuid1-uuid2)
    $3, -- display_name (e.g., "Alice & Bob")
    '', -- description (empty for DMs)
    'direct_message', $4, -- is_private (always TRUE for DMs)
    $5 -- created_by_employee_id
)
RETURNING
  *;

-- =============================================================================
-- USER CHAT CONFIG QUERIES
-- =============================================================================

-- name: GetUserChatConfig :one
-- Retrieves user chat configuration (visible channels via categories, pinned channels, limits, display preferences).
SELECT
  id,
  organization_id,
  employee_id,
  channel_categories,
  category_limits,
  pinned_channel_ids,
  sidebar_category_collapsed,
  updated_at
FROM
  chat.user_chat_config
WHERE
  organization_id = $1
  AND employee_id = $2;

-- name: AddChannelToCategory :exec
-- Adds a channel to user's visible channels with category assignment.
-- Used when user joins a channel or starts a DM (makes it visible in sidebar).
-- Note: Actual ordering is done by channel.updated_at, not insertion order.
-- Uses UPSERT to create config if it doesn't exist yet.
INSERT INTO chat.user_chat_config (
  organization_id,
  employee_id,
  channel_categories,
  category_limits,
  pinned_channel_ids,
  sidebar_category_collapsed,
  updated_at
)
VALUES (
  sqlc.arg('organization_id'),
  sqlc.arg('employee_id'),
  sqlc.arg('channel_categories')::jsonb,
  '{"channels": 10, "direct_messages": 10, "archived": 5}'::jsonb,
  ARRAY[]::uuid[],
  '{}'::jsonb,
  sqlc.arg('updated_at')
)
ON CONFLICT (organization_id, employee_id)
DO UPDATE SET
  channel_categories = jsonb_set(
    COALESCE(user_chat_config.channel_categories, '{}'::jsonb),
    ARRAY[sqlc.arg('channel_id')::text],
    sqlc.arg('category_value')::jsonb,
    true
  ),
  updated_at = sqlc.arg('updated_at');

-- name: UpdatePinnedChannels :exec
-- Updates only the pinned_channel_ids array for a user.
-- Used when user pins/unpins or reorders pinned channels.
-- Uses UPSERT to create config if it doesn't exist yet.
INSERT INTO chat.user_chat_config (
  organization_id,
  employee_id,
  channel_categories,
  category_limits,
  pinned_channel_ids,
  sidebar_category_collapsed,
  updated_at
)
VALUES (
  $2,
  $3,
  '{}'::jsonb,
  '{"channels": 10, "direct_messages": 10, "archived": 5}'::jsonb,
  $1,
  '{}'::jsonb,
  NOW()
)
ON CONFLICT (organization_id, employee_id)
DO UPDATE SET
  pinned_channel_ids = EXCLUDED.pinned_channel_ids,
  updated_at = sqlc.arg('updated_at');

-- name: UpdateSidebarCategoryCollapsed :exec
-- Updates the sidebar category collapsed state.
-- Used when user collapses/expands category sections.
-- Uses UPSERT to create config if it doesn't exist yet.
INSERT INTO chat.user_chat_config (
  organization_id,
  employee_id,
  channel_categories,
  category_limits,
  pinned_channel_ids,
  sidebar_category_collapsed,
  updated_at
)
VALUES (
  $2,
  $3,
  '{}'::jsonb,
  '{"channels": 10, "direct_messages": 10, "archived": 5}'::jsonb,
  ARRAY[]::uuid[],
  $1,
  NOW()
)
ON CONFLICT (organization_id, employee_id)
DO UPDATE SET
  sidebar_category_collapsed = EXCLUDED.sidebar_category_collapsed,
  updated_at = sqlc.arg('updated_at');

-- name: ListVisibleChannelsWithDetails :many
-- Lists user's visible channels (from channel_membership) with full details and member count.
-- Simplified query without complex CTEs - easier to debug and maintain.
-- Returns channels that the user is a member of.
SELECT
  c.id,
  c.organization_id,
  c.title_slug,
  c.display_name,
  c.description,
  c.channel_type,
  c.is_private,
  c.is_archived,
  c.created_by_employee_id,
  c.updated_at,
  (
    SELECT
      COUNT(*)
    FROM
      chat.channel_membership cm
    WHERE
      cm.channel_id = c.id
      AND cm.organization_id = c.organization_id
  ) AS member_count,
  NULL::text AS category -- Placeholder, will be filled by application layer
FROM
  chat.channel c
WHERE
  c.organization_id = $1
  AND EXISTS (
    SELECT 1
    FROM chat.channel_membership cm
    WHERE cm.channel_id = c.id
      AND cm.organization_id = $1
      AND cm.employee_id = $2
  )
ORDER BY
  c.updated_at DESC
LIMIT 100;

-- name: GetDirectMessageParticipants :many
-- Gets all participants in a direct message channel (excluding the requesting employee).
-- Used to display DM partner names in sidebar.
SELECT
  e.id,
  e.organization_id,
  e.given_name,
  e.family_name,
  e.email
FROM
  chat.channel_membership cm
  JOIN organization.employee e ON (e.organization_id, e.id) = (cm.organization_id, cm.employee_id)
WHERE
  cm.channel_id = $1
  AND cm.organization_id = $2
  AND cm.employee_id != $3;

-- name: GetEmployeeByID :one
-- Retrieves employee details by ID (for DM display names).
SELECT
  e.id,
  e.organization_id,
  e.given_name,
  e.family_name,
  e.email
FROM
  organization.employee e
WHERE
  e.id = $1
  AND e.organization_id = $2;

-- =============================================================================
-- USER CHAT CONFIG - CATEGORY MANAGEMENT QUERIES
-- =============================================================================

-- name: UpdateChannelCategories :exec
-- Updates channel category mappings for a user.
-- Used when user moves channels between categories or system auto-categorizes.
UPDATE
  chat.user_chat_config
SET
  channel_categories = $1,
  updated_at = NOW()
WHERE
  organization_id = $2
  AND employee_id = $3;

-- name: UpdateCategoryLimits :exec
-- Updates per-category limits for recent channels.
-- Used when user or admin configures max channels to keep per category.
UPDATE
  chat.user_chat_config
SET
  category_limits = $1,
  updated_at = NOW()
WHERE
  organization_id = $2
  AND employee_id = $3;

-- name: RemoveChannelFromVisible :exec
-- Removes a channel from user's visible channels (removes from channel_categories).
-- Used when user hides/archives a channel or leaves it.
UPDATE
  chat.user_chat_config
SET
  channel_categories = channel_categories - sqlc.arg('channel_id')::text, -- Remove channel_id key
  updated_at = NOW()
WHERE
  organization_id = sqlc.arg('organization_id')
  AND employee_id = sqlc.arg('employee_id');

-- name: BulkUpdateChannelCategories :exec
-- Updates multiple channels' categories at once (for drag-and-drop reordering between categories).
-- Replaces entire channel_categories map.
UPDATE
  chat.user_chat_config
SET
  channel_categories = sqlc.arg('channel_categories'),
  updated_at = NOW()
WHERE
  organization_id = sqlc.arg('organization_id')
  AND employee_id = sqlc.arg('employee_id');

-- End of chat.query.sql
