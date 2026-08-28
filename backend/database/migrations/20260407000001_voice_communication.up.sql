-- Migration: Voice communication foundational schema (Feature 032)
-- Direction: UP

CREATE SCHEMA IF NOT EXISTS voice;

INSERT INTO public.permission (id, domain, description) VALUES
('chat.voiceCall', 'chat', 'Start, join, leave, and manage voice calls')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.default_role_permission (role_id, permission_id)
SELECT 'owner', id FROM public.permission
WHERE id = 'chat.voiceCall'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO public.default_role_permission (role_id, permission_id)
SELECT 'operator', id FROM public.permission
WHERE id = 'chat.voiceCall'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO public.default_role_permission (role_id, permission_id)
SELECT 'employee', id FROM public.permission
WHERE id = 'chat.voiceCall'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO iam.role_permission (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, 'chat.voiceCall'
FROM iam.role r
WHERE r.source_default_role_id IN ('owner', 'operator', 'employee')
ON CONFLICT (organization_id, role_id, permission_id) DO NOTHING;

ALTER TABLE chat.message
    ADD COLUMN IF NOT EXISTS message_kind text NOT NULL DEFAULT 'text',
    ADD COLUMN IF NOT EXISTS system_event_type text,
    ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE chat.message
    DROP CONSTRAINT IF EXISTS message_kind_valid,
    DROP CONSTRAINT IF EXISTS message_system_event_type_valid,
    DROP CONSTRAINT IF EXISTS message_system_event_consistency,
    DROP CONSTRAINT IF EXISTS message_metadata_object;

ALTER TABLE chat.message
    ADD CONSTRAINT message_kind_valid CHECK (message_kind IN ('text', 'voice', 'system'));

ALTER TABLE chat.message
    ADD CONSTRAINT message_system_event_type_valid CHECK (
        system_event_type IS NULL
        OR system_event_type IN ('voice_call_started', 'voice_call_ended', 'voice_call_missed', 'voice_call_cancelled')
    );

ALTER TABLE chat.message
    ADD CONSTRAINT message_system_event_consistency CHECK (
        (message_kind = 'system' AND system_event_type IS NOT NULL)
        OR (message_kind <> 'system' AND system_event_type IS NULL)
    );

ALTER TABLE chat.message
    ADD CONSTRAINT message_metadata_object CHECK (jsonb_typeof(metadata) = 'object');

ALTER TABLE notification.notification
    DROP CONSTRAINT IF EXISTS notification_source_domain_check,
    DROP CONSTRAINT IF EXISTS notification_source_domain_valid;

ALTER TABLE notification.notification
    ADD CONSTRAINT notification_source_domain_valid CHECK (
        source_domain IN ('chat', 'crm', 'projects', 'hr', 'support', 'finance', 'docs', 'system', 'calendar')
    );

ALTER TABLE notification.notification
    DROP CONSTRAINT IF EXISTS notification_notification_type_check,
    DROP CONSTRAINT IF EXISTS notification_notification_type_valid;

ALTER TABLE notification.notification
    ADD CONSTRAINT notification_notification_type_valid CHECK (
        notification_type IN (
            'message', 'mention', 'reply', 'typing', 'reaction',
            'voice_call_incoming', 'voice_call_started', 'voice_call_updated', 'voice_call_ended',
            'task_assigned', 'task_status_changed', 'task_commented',
            'task_mentioned', 'task_description_modified', 'task_updated',
            'doc_updated', 'doc_commented', 'doc_mentioned',
            'ritual_instance_assigned', 'evidence_submitted',
            'evidence_approved', 'evidence_rejected',
            'ritual_instance_overdue', 'ritual_instance_missed', 'ritual_instances_scheduled',
            'calendar_event_invite', 'calendar_event_cancel', 'calendar_event_change',
            'calendar_event_reminder', 'calendar_check_in_missed', 'calendar_event_digest'
        )
    );

ALTER TABLE notification.notification
    DROP CONSTRAINT IF EXISTS notification_policy_key_valid;

ALTER TABLE notification.notification
    ADD CONSTRAINT notification_policy_key_valid CHECK (
        policy_key IN (
            'persistent_default', 'chat_message', 'chat_mention', 'chat_reply',
            'chat_typing_live', 'chat_reaction_live',
            'chat_voice_call_incoming', 'chat_voice_call_live', 'chat_voice_call_record',
            'task_assignment', 'task_comment', 'task_mention',
            'task_status', 'task_description_modified', 'task_update',
            'document_update', 'document_comment', 'document_mention',
            'calendar_event_invite', 'calendar_event_cancel', 'calendar_event_change',
            'calendar_event_reminder', 'calendar_check_in_missed', 'calendar_event_digest'
        )
    );

CREATE TABLE IF NOT EXISTS voice.call_session(
    id uuid DEFAULT uuidv7(),
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    channel_id uuid NOT NULL,
    initiator_employee_id uuid NOT NULL,
    livekit_room_name text NOT NULL,
    state text NOT NULL DEFAULT 'ringing',
    outcome text,
    recording_policy text NOT NULL DEFAULT 'not_allowed',
    recording_status text NOT NULL DEFAULT 'unavailable',
    transcript_status text NOT NULL DEFAULT 'unavailable',
    started_at timestamptz NOT NULL DEFAULT now(),
    answered_at timestamptz,
    ended_at timestamptz,
    ended_by_employee_id uuid,
    ended_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_voice_call_channel
        FOREIGN KEY (organization_id, channel_id)
        REFERENCES chat.channel(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_voice_call_initiator
        FOREIGN KEY (organization_id, initiator_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_voice_call_ended_by
        FOREIGN KEY (organization_id, ended_by_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT voice_call_state_valid CHECK (state IN ('ringing', 'active', 'ending', 'ended')),
    CONSTRAINT voice_call_outcome_valid CHECK (outcome IS NULL OR outcome IN ('answered', 'missed', 'declined', 'cancelled', 'completed')),
    CONSTRAINT voice_call_recording_policy_valid CHECK (recording_policy IN ('not_allowed', 'allowed', 'required')),
    CONSTRAINT voice_call_recording_status_valid CHECK (recording_status IN ('unavailable', 'pending', 'processing', 'ready', 'failed')),
    CONSTRAINT voice_call_transcript_status_valid CHECK (transcript_status IN ('unavailable', 'pending', 'processing', 'ready', 'failed')),
    CONSTRAINT voice_call_ended_requires_outcome CHECK (state <> 'ended' OR (outcome IS NOT NULL AND ended_at IS NOT NULL))
);

ALTER TABLE voice.call_session
    DROP CONSTRAINT IF EXISTS fk_voice_call_ended_by;

ALTER TABLE voice.call_session
    ADD CONSTRAINT fk_voice_call_ended_by
    FOREIGN KEY (organization_id, ended_by_employee_id)
    REFERENCES organization.employee(organization_id, id)
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_call_active_per_channel
    ON voice.call_session(organization_id, channel_id)
    WHERE state IN ('ringing', 'active', 'ending');
CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_call_livekit_room
    ON voice.call_session(organization_id, livekit_room_name);
CREATE INDEX IF NOT EXISTS idx_voice_call_channel_history
    ON voice.call_session(organization_id, channel_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_call_state_updated
    ON voice.call_session(organization_id, state, updated_at DESC);

CREATE TABLE IF NOT EXISTS voice.call_participant(
    id uuid DEFAULT uuidv7(),
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    call_session_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    invited_by_employee_id uuid,
    role text NOT NULL DEFAULT 'participant',
    state text NOT NULL DEFAULT 'joining',
    livekit_identity text NOT NULL,
    joined_at timestamptz,
    left_at timestamptz,
    last_seen_at timestamptz,
    disconnect_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_voice_participant_call
        FOREIGN KEY (organization_id, call_session_id)
        REFERENCES voice.call_session(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_voice_participant_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_voice_participant_inviter
        FOREIGN KEY (organization_id, invited_by_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT voice_participant_unique UNIQUE (organization_id, call_session_id, employee_id),
    CONSTRAINT voice_participant_role_valid CHECK (role IN ('initiator', 'participant')),
    CONSTRAINT voice_participant_state_valid CHECK (state IN ('invited', 'ringing', 'joining', 'joined', 'disconnected', 'left', 'declined', 'removed')),
    CONSTRAINT voice_participant_joined_at_valid CHECK (state NOT IN ('joined', 'disconnected', 'left') OR joined_at IS NOT NULL),
    CONSTRAINT voice_participant_left_at_valid CHECK (state NOT IN ('left', 'declined', 'removed') OR left_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_voice_participant_employee
    ON voice.call_participant(organization_id, employee_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_participant_call_state
    ON voice.call_participant(organization_id, call_session_id, state);
CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_participant_identity
    ON voice.call_participant(organization_id, livekit_identity);

CREATE TABLE IF NOT EXISTS voice.call_invitation(
    id uuid DEFAULT uuidv7(),
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    call_session_id uuid NOT NULL,
    inviter_employee_id uuid NOT NULL,
    invitee_employee_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    notification_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    responded_at timestamptz,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_voice_invitation_call
        FOREIGN KEY (organization_id, call_session_id)
        REFERENCES voice.call_session(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_voice_invitation_inviter
        FOREIGN KEY (organization_id, inviter_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_voice_invitation_invitee
        FOREIGN KEY (organization_id, invitee_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_voice_invitation_notification
        FOREIGN KEY (organization_id, notification_id)
        REFERENCES notification.notification(organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT voice_invitation_status_valid CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'revoked')),
    CONSTRAINT voice_invitation_response_time_valid CHECK ((status = 'pending' AND responded_at IS NULL) OR (status <> 'pending' AND responded_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_invitation_pending
    ON voice.call_invitation(organization_id, call_session_id, invitee_employee_id)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_voice_invitation_invitee
    ON voice.call_invitation(organization_id, invitee_employee_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS voice.call_artifact(
    id uuid DEFAULT uuidv7(),
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    call_session_id uuid NOT NULL,
    artifact_type text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    file_id uuid,
    mime_type text,
    duration_ms bigint,
    storage_bytes bigint,
    provider text,
    provider_job_id text,
    error_code text,
    error_message text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_voice_artifact_call
        FOREIGN KEY (organization_id, call_session_id)
        REFERENCES voice.call_session(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_voice_artifact_file
        FOREIGN KEY (organization_id, file_id)
        REFERENCES files.file_metadata(organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT voice_artifact_unique UNIQUE (organization_id, call_session_id, artifact_type),
    CONSTRAINT voice_artifact_type_valid CHECK (artifact_type IN ('recording', 'transcript')),
    CONSTRAINT voice_artifact_status_valid CHECK (status IN ('pending', 'processing', 'ready', 'unavailable', 'failed')),
    CONSTRAINT voice_artifact_provider_valid CHECK (provider IS NULL OR provider IN ('livekit_egress', 'transcription_worker')),
    CONSTRAINT voice_artifact_ready_requires_file CHECK (status <> 'ready' OR file_id IS NOT NULL),
    CONSTRAINT voice_artifact_failed_requires_error CHECK (status <> 'failed' OR error_code IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_voice_artifact_status
    ON voice.call_artifact(organization_id, status, updated_at);

CREATE TABLE IF NOT EXISTS voice.voice_message(
    id uuid DEFAULT uuidv7(),
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    channel_id uuid NOT NULL,
    sender_employee_id uuid NOT NULL,
    message_id uuid,
    file_id uuid,
    client_deduplication_key text NOT NULL,
    status text NOT NULL DEFAULT 'requested',
    duration_ms bigint,
    mime_type text NOT NULL,
    codec text,
    waveform_peaks jsonb,
    size_bytes bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    posted_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_voice_message_channel
        FOREIGN KEY (organization_id, channel_id)
        REFERENCES chat.channel(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_voice_message_sender
        FOREIGN KEY (organization_id, sender_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_voice_message_message
        FOREIGN KEY (organization_id, message_id)
        REFERENCES chat.message(organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_voice_message_file
        FOREIGN KEY (organization_id, file_id)
        REFERENCES files.file_metadata(organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT voice_message_dedup_unique UNIQUE (organization_id, channel_id, sender_employee_id, client_deduplication_key),
    CONSTRAINT voice_message_status_valid CHECK (status IN ('requested', 'uploading', 'posted', 'failed', 'cancelled')),
    CONSTRAINT voice_message_codec_valid CHECK (codec IS NULL OR codec IN ('opus', 'aac')),
    CONSTRAINT voice_message_mime_type_valid CHECK (mime_type IN ('audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav')),
    CONSTRAINT voice_message_size_positive CHECK (size_bytes > 0),
    CONSTRAINT voice_message_duration_positive CHECK (duration_ms IS NULL OR duration_ms > 0),
    CONSTRAINT voice_message_waveform_array CHECK (waveform_peaks IS NULL OR jsonb_typeof(waveform_peaks) = 'array'),
    CONSTRAINT voice_message_posted_requires_assets CHECK (status <> 'posted' OR (message_id IS NOT NULL AND file_id IS NOT NULL AND duration_ms IS NOT NULL AND posted_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_message_posted_message
    ON voice.voice_message(organization_id, message_id)
    WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_voice_message_channel
    ON voice.voice_message(organization_id, channel_id, created_at DESC);