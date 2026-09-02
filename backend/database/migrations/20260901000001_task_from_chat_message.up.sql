-- Migration: create a task from a chat message (Feature 038)
-- Direction: UP
--
-- Rollback posture: forward-only, additive. Two nullable columns and a partial index on
-- collaboration.task, one new table, and one widened CHECK on chat.message. Nothing
-- existing is dropped or rewritten, so a revert is a compensating forward migration
-- rather than a restore (Constitution VI).
--
-- Direction of dependency: collaboration references chat, never the reverse. Both new
-- foreign keys out of collaboration.task are composite and lead with organization_id,
-- matching the existing fk_task_channel precedent (Constitution I).

-- ============================================================================
-- collaboration.task: where the task came from
--
-- Both columns are NULL for every task not created from a message, which is every task
-- that exists today and every task created through the ordinary task form.
--
-- ON DELETE SET NULL matters only for a hard delete. Message deletion in this system is
-- a SOFT delete — is_deleted is set and placeholder text preserved — so the "source
-- message is unavailable" state (FR-023) is read from is_deleted with the row and the
-- foreign key still intact.
--
-- Deliberately NOT added: a uniqueness constraint on source_message_id. FR-025 permits
-- one message to produce more than one task.
-- ============================================================================

ALTER TABLE collaboration.task
    ADD COLUMN IF NOT EXISTS source_channel_id uuid,
    ADD COLUMN IF NOT EXISTS source_message_id uuid;

COMMENT ON COLUMN collaboration.task.source_channel_id IS
    'Chat channel the originating message was posted in. NULL for tasks not created from a message.';
COMMENT ON COLUMN collaboration.task.source_message_id IS
    'Chat message this task was created from. NULL for tasks not created from a message.';

-- An origin is both halves or neither: a channel without a message could not render the
-- excerpt FR-020 requires.
ALTER TABLE collaboration.task
    DROP CONSTRAINT IF EXISTS task_source_message_consistency;

ALTER TABLE collaboration.task
    ADD CONSTRAINT task_source_message_consistency CHECK (
        (source_channel_id IS NULL) = (source_message_id IS NULL)
    );

ALTER TABLE collaboration.task
    DROP CONSTRAINT IF EXISTS fk_task_source_channel;

ALTER TABLE collaboration.task
    ADD CONSTRAINT fk_task_source_channel
        FOREIGN KEY (organization_id, source_channel_id)
        REFERENCES chat.channel(organization_id, id) ON DELETE SET NULL;

ALTER TABLE collaboration.task
    DROP CONSTRAINT IF EXISTS fk_task_source_message;

ALTER TABLE collaboration.task
    ADD CONSTRAINT fk_task_source_message
        FOREIGN KEY (organization_id, source_message_id)
        REFERENCES chat.message(organization_id, id) ON DELETE SET NULL;

-- Partial, because the overwhelming majority of tasks have no origin. This index is what
-- makes the batched reverse lookup behind the message chip cheap; it is the only index
-- this feature adds.
CREATE INDEX IF NOT EXISTS idx_task_source_message
    ON collaboration.task (organization_id, source_message_id)
    WHERE source_message_id IS NOT NULL;

-- ============================================================================
-- collaboration.channel_task_destination: the project a channel's tasks default to
--
-- One row per channel that has ever had a task created from it. The first conversion
-- writes it (INSERT … ON CONFLICT DO NOTHING); a later conversion that overrides the
-- project leaves it untouched (FR-015, FR-016).
--
-- No id column and no UUID v7 primary key: the row is identified by the channel it
-- describes and nothing paginates over this table.
--
-- Rows for archived or inaccessible projects are NOT cleaned up. FR-018 requires them to
-- be *treated* as unset at read time with a reason; deleting the row would lose the
-- setting if the project were later unarchived.
-- ============================================================================

CREATE TABLE IF NOT EXISTS collaboration.channel_task_destination (
    organization_id     uuid        NOT NULL,
    channel_id          uuid        NOT NULL,
    project_id          uuid        NOT NULL,
    set_by_employee_id  uuid        NOT NULL,
    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT channel_task_destination_pkey
        PRIMARY KEY (organization_id, channel_id),

    CONSTRAINT fk_channel_task_destination_organization
        FOREIGN KEY (organization_id)
        REFERENCES public.organization(id) ON DELETE CASCADE,

    -- The memory is meaningless once the channel is gone.
    CONSTRAINT fk_channel_task_destination_channel
        FOREIGN KEY (organization_id, channel_id)
        REFERENCES chat.channel(organization_id, id) ON DELETE CASCADE,

    -- A deleted project leaves no dangling default.
    CONSTRAINT fk_channel_task_destination_project
        FOREIGN KEY (organization_id, project_id)
        REFERENCES collaboration.project(organization_id, id) ON DELETE CASCADE,

    CONSTRAINT fk_channel_task_destination_set_by
        FOREIGN KEY (organization_id, set_by_employee_id)
        REFERENCES organization.employee(organization_id, id)
);

COMMENT ON TABLE collaboration.channel_task_destination IS
    'The project that tasks created from a chat channel default to. Written by the first conversion in a channel and changeable only by a channel administrator; a per-conversion override never changes it.';
COMMENT ON COLUMN collaboration.channel_task_destination.set_by_employee_id IS
    'Who last set the destination. Shown when explaining where the pre-filled project came from.';

-- ============================================================================
-- chat.message.system_event_type: one new permitted value
--
-- Constitution Principle VIII: this CHECK is mirrored by
-- SystemEventTypeTaskCreatedFromMessage in backend/internal/chat/constants.go and by the
-- system-event union in frontend/packages/apis/src/chat.ts, and the match is asserted in
-- backend/integration/collaboration_constants_test.go.
--
-- This adds a permitted value; it does not teach chat what a task is. The neighbouring
-- message_system_event_consistency CHECK is deliberately left untouched.
-- ============================================================================

ALTER TABLE chat.message
    DROP CONSTRAINT IF EXISTS message_system_event_type_valid;

ALTER TABLE chat.message
    ADD CONSTRAINT message_system_event_type_valid CHECK (
        system_event_type IS NULL OR system_event_type IN (
            'voice_call_started',
            'voice_call_ended',
            'voice_call_missed',
            'voice_call_cancelled',
            'task_created_from_message'
        )
    );
