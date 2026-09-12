-- Migration: composite foreign keys stop nulling the tenant column (Feature 057)
-- Direction: UP
--
-- Rollback posture: forward-only. Five constraints are replaced in place and one CHECK is
-- dropped. No column is added or removed and no row is rewritten, so a revert is a
-- compensating forward migration rather than a restore (Constitution VI).
--
-- The defect: a bare `ON DELETE SET NULL` over a composite key nulls EVERY column of that
-- key. Every foreign key out of a tenant table leads with organization_id (Constitution I),
-- and organization_id is NOT NULL, so the action PostgreSQL attempts is
-- `SET organization_id = NULL` and the delete fails outright. PostgreSQL 15's column list
-- — `ON DELETE SET NULL (<column>)` — names the columns to null and leaves the rest alone.
-- The project runs postgres:18 (backend/docker/postgres.Dockerfile), so it is available.
--
-- Every statement is DROP CONSTRAINT IF EXISTS before ADD CONSTRAINT, so re-running this
-- file is a no-op.

-- ============================================================================
-- 1. collaboration.task -> chat.message: a task outlives the message it was made from
--
-- Hard-deleting a message must null only the pointer to it. The task keeps its
-- organization, its identifier, its title, its project and its state.
-- ============================================================================

ALTER TABLE collaboration.task
    DROP CONSTRAINT IF EXISTS fk_task_source_message;

ALTER TABLE collaboration.task
    ADD CONSTRAINT fk_task_source_message
        FOREIGN KEY (organization_id, source_message_id)
        REFERENCES chat.message(organization_id, id)
        ON DELETE SET NULL (source_message_id);

-- ============================================================================
-- 2. collaboration.task -> chat.channel: same defect on the channel half
--
-- Deleting a channel nulls only source_channel_id. fk_task_channel — the task's own
-- comment thread, a DIFFERENT column — stays ON DELETE RESTRICT and is untouched: a
-- thread is content owned by the task, not a pointer to content.
-- ============================================================================

ALTER TABLE collaboration.task
    DROP CONSTRAINT IF EXISTS fk_task_source_channel;

ALTER TABLE collaboration.task
    ADD CONSTRAINT fk_task_source_channel
        FOREIGN KEY (organization_id, source_channel_id)
        REFERENCES chat.channel(organization_id, id)
        ON DELETE SET NULL (source_channel_id);

-- ============================================================================
-- 3. Drop task_source_message_consistency, and do not re-add it in any form
--
-- The CHECK asserted `(source_channel_id IS NULL) = (source_message_id IS NULL)`. Both
-- half-present states are now reachable, so no row-level constraint relating the two
-- columns can hold:
--
--   * (channel set, message NULL) — the resting state after a message is hard-deleted.
--   * (NULL, message set)         — a real intermediate state DURING a channel delete.
--                                   PostgreSQL nulls the channel half before the channel's
--                                   messages cascade into the message half, and a row-level
--                                   CHECK is never deferrable, so it sees that row.
--
-- A constraint that must permit both states permits everything; writing it down would look
-- like a guarantee without being one. The pairing invariant lives where it can actually
-- hold — the conversion writes both columns in one statement in one transaction — and the
-- read path treats a half-present origin as no origin at all (GetTaskOrigin,
-- ListTasksBySourceMessages, taskToProto).
-- ============================================================================

ALTER TABLE collaboration.task
    DROP CONSTRAINT IF EXISTS task_source_message_consistency;

-- ============================================================================
-- 4. chat.channel_membership -> chat.message: the last-viewed pointer stops blocking
--
-- This was ON DELETE RESTRICT, which made any hard delete of a message someone had read
-- fail. That is a live bug, not a latent one: the voice-call timeline already hard-deletes
-- duplicate system messages (backend/internal/chat/logic.go).
--
-- Nulling the pointer is free. Nothing reads it: the unread badge is computed from the
-- TIMESTAMP last_viewed_at, not from this column (chat.query.sql, "Calculate unread message
-- count for channel sidebar badges"). No badge changes and no member sees anything.
-- ============================================================================

ALTER TABLE chat.channel_membership
    DROP CONSTRAINT IF EXISTS fk_channel_membership_last_viewed_message;

ALTER TABLE chat.channel_membership
    ADD CONSTRAINT fk_channel_membership_last_viewed_message
        FOREIGN KEY (organization_id, last_viewed_message_id)
        REFERENCES chat.message(organization_id, id)
        ON DELETE SET NULL (last_viewed_message_id);

-- ============================================================================
-- 5. voice.voice_message -> chat.message: cascade, because SET NULL is barred
--
-- Also ON DELETE RESTRICT until now. SET NULL (message_id) is not available here:
-- voice_message_posted_requires_assets asserts `status <> 'posted' OR message_id IS NOT
-- NULL`, so nulling the column on a posted recording would trade a referential failure for
-- a CHECK failure. A voice_message row exists to be rendered inside its chat message and is
-- unreachable by every read path once that message is gone, and nothing references
-- voice.voice_message in turn, so the cascade terminates here.
--
-- Accepted residue: the cascade leaves the recording's files.file_metadata row behind.
-- fk_voice_message_file points the other way and blocks nothing, so this is an orphaned
-- storage row rather than a failure. File lifetime is a pre-existing gap, out of scope.
-- ============================================================================

ALTER TABLE voice.voice_message
    DROP CONSTRAINT IF EXISTS fk_voice_message_message;

ALTER TABLE voice.voice_message
    ADD CONSTRAINT fk_voice_message_message
        FOREIGN KEY (organization_id, message_id)
        REFERENCES chat.message(organization_id, id)
        ON DELETE CASCADE;
