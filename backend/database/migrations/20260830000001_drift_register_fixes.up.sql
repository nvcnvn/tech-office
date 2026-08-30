-- Drift-register fixes D1, D3 and D6.
--
-- D1 — files.file_metadata.upload_context still carried the original four-value CHECK
-- while Go had grown two more contexts. internal/voice writes 'voice_transcript' when it
-- persists a transcript and internal/files accepts 'calendar', so a voice transcript
-- upload failed on the constraint. The Go constant list in internal/files/constants.go is
-- the contract; this brings the column back in line with it.
--
-- D3 — three ritual notification types were reachable from the database but not from the
-- code: ritual_instance_assigned, ritual_instance_overdue and ritual_instance_missed. The
-- functions that published them had no callers, and nothing sweeps a ritual into an
-- overdue state, so no row of those types can be produced any more. The per-instance
-- assignment notification was replaced by the ritual_instances_scheduled summary in the
-- bulk generation run. Any surviving rows are from the pre-bulk design and describe an
-- event the product no longer models, so they are deleted rather than carried.
--
-- D6 — public.organization.project_id and app_id are Zitadel residue. Zitadel was removed
-- in feature 018; since then internal/organization has filled both columns with freshly
-- minted UUIDs that nothing ever reads. Dropping them removes the last schema-level trace
-- of the old identity provider.
--
-- Rollback posture: forward-only. D1 widens a CHECK. D3 deletes rows for notification
-- types the code can no longer emit, then narrows a CHECK. D6 drops two dead columns.

-- ── D1 ────────────────────────────────────────────────────────────────────────
ALTER TABLE files.file_metadata
    DROP CONSTRAINT IF EXISTS file_metadata_upload_context_check;

ALTER TABLE files.file_metadata
    ADD CONSTRAINT file_metadata_upload_context_check CHECK (
        upload_context IN ('chat', 'avatar', 'docs', 'project', 'calendar', 'voice_transcript')
    );

COMMENT ON COLUMN files.file_metadata.upload_context IS 'Upload source context: chat, avatar, docs, project, calendar, voice_transcript. MUST align with backend constants in internal/files/constants.go and frontend TypeScript types in packages/apis/src/files.ts';

-- ── D3 ────────────────────────────────────────────────────────────────────────
DELETE FROM notification.notification
WHERE notification_type IN (
    'ritual_instance_assigned',
    'ritual_instance_overdue',
    'ritual_instance_missed'
);

ALTER TABLE notification.notification
    DROP CONSTRAINT IF EXISTS notification_notification_type_valid;

ALTER TABLE notification.notification
    ADD CONSTRAINT notification_notification_type_valid CHECK (
        notification_type IN (
            'message',
            'mention',
            'reply',
            'typing',
            'reaction',
            'voice_call_incoming',
            'voice_call_started',
            'voice_call_updated',
            'voice_call_ended',
            'task_assigned',
            'task_status_changed',
            'task_commented',
            'task_mentioned',
            'task_description_modified',
            'task_updated',
            'doc_updated',
            'doc_commented',
            'doc_mentioned',
            'evidence_submitted',
            'evidence_approved',
            'evidence_rejected',
            'ritual_instances_scheduled',
            'calendar_event_invite',
            'calendar_event_cancel',
            'calendar_event_change',
            'calendar_event_reminder',
            'calendar_check_in_missed',
            'calendar_event_digest',
            'account_removal_requested'
        )
    );

COMMENT ON COLUMN notification.notification.notification_type IS 'What happened. MUST equal notification.AllNotificationTypes() in backend/internal/notification/constants.go — TestNotificationTypeCheckMatchesGoConstants asserts it.';

-- ── D6 ────────────────────────────────────────────────────────────────────────
ALTER TABLE public.organization DROP CONSTRAINT IF EXISTS organization_id_app_id_key;
ALTER TABLE public.organization DROP CONSTRAINT IF EXISTS organization_id_project_id_key;
ALTER TABLE public.organization DROP COLUMN IF EXISTS app_id;
ALTER TABLE public.organization DROP COLUMN IF EXISTS project_id;
