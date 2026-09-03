-- Feature 040: overdue and missed rituals become real states with alerts.
--
-- The reconciliation sweep publishes two notification types that were dropped on
-- 2026-08-30 along with the per-instance assignment flood. They are restored here
-- because this feature gives them a producer again.
--
-- 'ritual_instance_assigned' is deliberately NOT re-added: it has no producer, having
-- been replaced by the 'ritual_instances_scheduled' summary in feature 034.
--
-- TestNotificationTypeCheckMatchesGoConstants asserts this list equals
-- notification.AllNotificationTypes() in backend/internal/notification/constants.go.

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
            'ritual_instance_overdue',
            'ritual_instance_missed',
            'calendar_event_invite',
            'calendar_event_cancel',
            'calendar_event_change',
            'calendar_event_reminder',
            'calendar_check_in_missed',
            'calendar_event_digest',
            'account_removal_requested'
        )
    );
