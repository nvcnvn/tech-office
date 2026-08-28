-- Migration: allow the account-removal-request notification type (Feature 036)
-- Direction: UP

-- ============================================================================
-- notification.notification: allow the removal-request notification type
--
-- Constitution Principle VIII: this CHECK is mirrored by
-- NotificationTypeAccountRemovalRequested in backend/internal/notification/constants.go
-- and the NotificationType union in frontend/packages/apis/src/notification.ts.
-- ============================================================================

ALTER TABLE notification.notification
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
            'calendar_event_reminder', 'calendar_check_in_missed', 'calendar_event_digest',
            'account_removal_requested'
        )
    );
