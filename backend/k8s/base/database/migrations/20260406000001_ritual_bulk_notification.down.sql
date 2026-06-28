-- Migration: Add ritual_instances_scheduled notification type for bulk generation summaries
-- Direction: DOWN

ALTER TABLE notification.notification
    DROP CONSTRAINT IF EXISTS notification_notification_type_valid;
ALTER TABLE notification.notification
    ADD CONSTRAINT notification_notification_type_valid
        CHECK (notification_type IN (
            'message', 'mention', 'reply', 'typing', 'reaction',
            'task_assigned', 'task_status_changed', 'task_commented',
            'task_mentioned', 'task_description_modified', 'task_updated',
            'doc_updated', 'doc_commented', 'doc_mentioned',
            'ritual_instance_assigned', 'evidence_submitted',
            'evidence_approved', 'evidence_rejected',
            'ritual_instance_overdue', 'ritual_instance_missed',
            'calendar_event_invite', 'calendar_event_cancel', 'calendar_event_change',
            'calendar_event_reminder', 'calendar_check_in_missed', 'calendar_event_digest'
        ));
