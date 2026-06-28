-- SQL Queries for Chat Backend System
-- File: backend/database/scripts/chat.query.sql
-- Generated Go package: database
-- Generated Go types: sqlc models

-- =============================================================================
-- CHANNEL CRUD QUERIES
-- =============================================================================

-- name: CreateChannel :one
-- Creates a new channel and automatically creates membership for creator as admin.
INSERT INTO chat.channel (
  id,
  organization_id,
  title_slug,
  display_name,
  description,
  channel_type,
  is_private,
  created_by_employee_id
) VALUES (
  uuidv7(),
  $1,  -- organization_id
  $2,  -- title_slug
  $3,  -- display_name
  $4,  -- description
  $5,  -- channel_type
  $6,  -- is_private
  $7   -- created_by_employee_id
) RETURNING *;

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
FROM chat.channel
WHERE id = $1 AND organization_id = $2;

-- name: GetChannelBySlug :one
-- Retrieves a channel by its slug within an organization.
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
FROM chat.channel
WHERE title_slug = $1 AND organization_id = $2;

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
  (SELECT COUNT(*) FROM chat.channel_membership cm 
   WHERE cm.channel_id = c.id AND cm.organization_id = c.organization_id) as member_count
FROM chat.channel c
INNER JOIN chat.channel_membership m ON c.id = m.channel_id AND c.organization_id = m.organization_id
WHERE m.employee_id = $1 
  AND c.organization_id = $2
  AND ($3::bool IS NULL OR c.is_archived = $3)  -- Optional filter by archived status
ORDER BY c.updated_at DESC
LIMIT $4 OFFSET $5;

-- name: ListPublicChannels :many
-- Lists all active public channels in an organization (for discovery).
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
  updated_at,
  (SELECT COUNT(*) FROM chat.channel_membership cm 
   WHERE cm.channel_id = chat.channel.id AND cm.organization_id = chat.channel.organization_id) as member_count
FROM chat.channel
WHERE organization_id = $1 
  AND is_private = false 
  AND is_archived = false
ORDER BY updated_at DESC
LIMIT $2 OFFSET $3;

-- name: UpdateChannel :one
-- Updates channel metadata (display name, description, privacy).
UPDATE chat.channel
SET 
  display_name = COALESCE($3, display_name),
  description = COALESCE($4, description),
  is_private = COALESCE($5, is_private),
  updated_at = now()
WHERE id = $1 AND organization_id = $2
RETURNING *;

-- name: ArchiveChannel :one
-- Archives a channel (prevents new messages and notifications).
UPDATE chat.channel
SET is_archived = true, updated_at = now()
WHERE id = $1 AND organization_id = $2
RETURNING *;

-- name: UnarchiveChannel :one
-- Unarchives a channel (restores full functionality).
UPDATE chat.channel
SET is_archived = false, updated_at = now()
WHERE id = $1 AND organization_id = $2
RETURNING *;

-- name: DeleteChannel :exec
-- Permanently deletes a channel (use with caution, prefer archival).
DELETE FROM chat.channel
WHERE id = $1 AND organization_id = $2;

-- =============================================================================
-- CHANNEL MEMBERSHIP QUERIES
-- =============================================================================

-- name: CreateChannelMembership :one
-- Adds a member to a channel with optional admin status.
INSERT INTO chat.channel_membership (
  id,
  organization_id,
  channel_id,
  employee_id,
  is_admin,
  notification_preference
) VALUES (
  uuidv7(),
  $1,  -- organization_id
  $2,  -- channel_id
  $3,  -- employee_id
  $4,  -- is_admin
  COALESCE($5, 'all')  -- notification_preference (default 'all')
) RETURNING *;

-- name: GetChannelMembership :one
-- Retrieves a specific membership record.
SELECT 
  id,
  organization_id,
  channel_id,
  employee_id,
  is_admin,
  notification_preference,
  joined_at,
  updated_at
FROM chat.channel_membership
WHERE channel_id = $1 
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
  e.display_name as employee_name,
  e.email as employee_email
FROM chat.channel_membership cm
INNER JOIN organization.employee e ON cm.employee_id = e.id AND cm.organization_id = e.organization_id
WHERE cm.channel_id = $1 
  AND cm.organization_id = $2
ORDER BY cm.joined_at DESC
LIMIT $3 OFFSET $4;

-- name: ListChannelMembersForNotification :many
-- Efficiently fetches members who should receive notifications for a channel.
-- Filters by notification preference (excludes muted unless is_mention is true).
SELECT 
  employee_id,
  notification_preference
FROM chat.channel_membership
WHERE channel_id = $1 
  AND organization_id = $2
  AND (
    notification_preference = 'all' OR
    (notification_preference = 'mentions' AND $3::bool = true) OR  -- is_mention parameter
    notification_preference IS NULL
  )
  AND notification_preference != 'muted';

-- name: CountChannelMembers :one
-- Counts total members in a channel.
SELECT COUNT(*) as count
FROM chat.channel_membership
WHERE channel_id = $1 AND organization_id = $2;

-- name: UpdateMembershipRole :one
-- Updates a member's admin status.
UPDATE chat.channel_membership
SET is_admin = $4, updated_at = now()
WHERE channel_id = $1 
  AND employee_id = $2 
  AND organization_id = $3
RETURNING *;

-- name: UpdateMembershipNotificationPreference :one
-- Updates a member's notification preference for a channel.
UPDATE chat.channel_membership
SET notification_preference = $4, updated_at = now()
WHERE channel_id = $1 
  AND employee_id = $2 
  AND organization_id = $3
RETURNING *;

-- name: RemoveChannelMember :exec
-- Removes a member from a channel.
DELETE FROM chat.channel_membership
WHERE channel_id = $1 
  AND employee_id = $2 
  AND organization_id = $3;

-- name: CountChannelAdmins :one
-- Counts number of admins in a channel (used to prevent removing last admin).
SELECT COUNT(*) as count
FROM chat.channel_membership
WHERE channel_id = $1 
  AND organization_id = $2 
  AND is_admin = true;

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
FROM chat.channel_membership
WHERE channel_id = $1 
  AND organization_id = $2
  AND is_admin = false
ORDER BY joined_at ASC
LIMIT 1;

-- =============================================================================
-- MESSAGE CRUD QUERIES
-- =============================================================================

-- name: CreateMessage :one
-- Creates a new message (top-level or reply).
INSERT INTO chat.message (
  id,
  organization_id,
  channel_id,
  message_text,
  author_employee_id,
  parent_message_id
) VALUES (
  uuidv7(),
  $1,  -- organization_id
  $2,  -- channel_id
  $3,  -- message_text
  $4,  -- author_employee_id
  $5   -- parent_message_id (NULL for top-level)
) RETURNING *;

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
  m.updated_at,
  e.display_name as author_name,
  e.email as author_email
FROM chat.message m
INNER JOIN organization.employee e ON m.author_employee_id = e.id AND m.organization_id = e.organization_id
WHERE m.id = $1 AND m.organization_id = $2;

-- name: ListChannelMessages :many
-- Lists messages in a channel with cursor-based pagination (ordered by updated_at DESC).
-- Use updated_at of last message as cursor for next page.
SELECT 
  m.id,
  m.organization_id,
  m.channel_id,
  m.message_text,
  m.author_employee_id,
  m.parent_message_id,
  m.is_deleted,
  m.is_edited,
  m.updated_at,
  e.display_name as author_name,
  e.email as author_email,
  (SELECT COUNT(*) FROM chat.message replies 
   WHERE replies.parent_message_id = m.id AND replies.organization_id = m.organization_id) as reply_count
FROM chat.message m
INNER JOIN organization.employee e ON m.author_employee_id = e.id AND m.organization_id = e.organization_id
WHERE m.channel_id = $1 
  AND m.organization_id = $2
  AND m.parent_message_id IS NULL  -- Only top-level messages
  AND m.is_deleted = false
  AND ($3::timestamptz IS NULL OR m.updated_at < $3)  -- Cursor for pagination
ORDER BY m.updated_at DESC
LIMIT $4;

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
  m.updated_at,
  e.display_name as author_name,
  e.email as author_email
FROM chat.message m
INNER JOIN organization.employee e ON m.author_employee_id = e.id AND m.organization_id = e.organization_id
WHERE m.parent_message_id = $1 
  AND m.organization_id = $2
ORDER BY m.updated_at ASC;

-- name: UpdateMessage :one
-- Edits a message (sets is_edited flag, updates message_text).
-- Note: edit_history JSONB update should be done at application level.
UPDATE chat.message
SET 
  message_text = $3,
  is_edited = true,
  updated_at = now()
WHERE id = $1 AND organization_id = $2
RETURNING *;

-- name: SoftDeleteMessage :one
-- Soft deletes a message (preserves with is_deleted flag).
UPDATE chat.message
SET is_deleted = true, updated_at = now()
WHERE id = $1 AND organization_id = $2
RETURNING *;

-- name: HardDeleteMessage :exec
-- Permanently deletes a message (use with caution).
DELETE FROM chat.message
WHERE id = $1 AND organization_id = $2;

-- name: CountMessageReplies :one
-- Counts number of replies to a message.
SELECT COUNT(*) as count
FROM chat.message
WHERE parent_message_id = $1 AND organization_id = $2;

-- =============================================================================
-- REACTION QUERIES
-- =============================================================================

-- name: AddReaction :one
-- Adds a reaction to a message (or does nothing if already exists due to unique constraint).
INSERT INTO chat.reaction (
  id,
  organization_id,
  message_id,
  employee_id,
  emoji_code
) VALUES (
  uuidv7(),
  $1,  -- organization_id
  $2,  -- message_id
  $3,  -- employee_id
  $4   -- emoji_code
) 
ON CONFLICT (message_id, employee_id, emoji_code, organization_id) DO NOTHING
RETURNING *;

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
  COUNT(*) as count,
  array_agg(employee_id) as employee_ids
FROM chat.reaction
WHERE message_id = $1 AND organization_id = $2
GROUP BY emoji_code
ORDER BY count DESC, emoji_code ASC;

-- name: GetUserReactionOnMessage :one
-- Checks if a specific user reacted to a message with a specific emoji.
SELECT 
  id,
  organization_id,
  message_id,
  employee_id,
  emoji_code,
  updated_at
FROM chat.reaction
WHERE message_id = $1 
  AND employee_id = $2 
  AND emoji_code = $3 
  AND organization_id = $4;

-- name: CountMessageReactions :one
-- Counts total reactions on a message.
SELECT COUNT(*) as count
FROM chat.reaction
WHERE message_id = $1 AND organization_id = $2;

-- =============================================================================
-- UTILITY & ANALYTICS QUERIES
-- =============================================================================

-- name: GetChannelActivityStats :one
-- Retrieves activity statistics for a channel.
SELECT 
  c.id,
  c.organization_id,
  c.display_name,
  (SELECT COUNT(*) FROM chat.channel_membership cm 
   WHERE cm.channel_id = c.id AND cm.organization_id = c.organization_id) as member_count,
  (SELECT COUNT(*) FROM chat.message m 
   WHERE m.channel_id = c.id AND m.organization_id = c.organization_id AND m.is_deleted = false) as message_count,
  (SELECT MAX(updated_at) FROM chat.message m 
   WHERE m.channel_id = c.id AND m.organization_id = c.organization_id) as last_message_at
FROM chat.channel c
WHERE c.id = $1 AND c.organization_id = $2;

-- name: SearchChannelsByName :many
-- Searches channels by display name or title slug (case-insensitive).
-- Filters by user membership and visibility.
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
FROM chat.channel c
LEFT JOIN chat.channel_membership m ON c.id = m.channel_id AND m.employee_id = $2 AND m.organization_id = c.organization_id
WHERE c.organization_id = $1
  AND c.is_archived = false
  AND (
    c.is_private = false OR  -- Public channels
    m.employee_id IS NOT NULL  -- Or user is a member
  )
  AND (
    LOWER(c.display_name) LIKE LOWER($3) OR
    LOWER(c.title_slug) LIKE LOWER($3)
  )
ORDER BY c.updated_at DESC
LIMIT $4;

-- name: GetDirectMessageChannel :one
-- Finds or returns NULL for a direct message channel between two employees.
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
FROM chat.channel c
INNER JOIN chat.channel_membership m1 ON c.id = m1.channel_id AND m1.employee_id = $2 AND m1.organization_id = c.organization_id
INNER JOIN chat.channel_membership m2 ON c.id = m2.channel_id AND m2.employee_id = $3 AND m2.organization_id = c.organization_id
WHERE c.organization_id = $1
  AND c.channel_type = 'direct_message'
  AND (SELECT COUNT(*) FROM chat.channel_membership cm WHERE cm.channel_id = c.id AND cm.organization_id = c.organization_id) = 2
LIMIT 1;
