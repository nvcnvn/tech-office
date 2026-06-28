-- Migration: Extend notification CHECK constraints for calendar (Feature 026)
-- Direction: UP

-- Extend source_domain to include 'calendar'
ALTER TABLE notification.notification
    DROP CONSTRAINT IF EXISTS notification_source_domain_valid;
ALTER TABLE notification.notification
    ADD CONSTRAINT notification_source_domain_valid
        CHECK (source_domain IN (
            'chat', 'crm', 'projects', 'hr', 'support', 'finance', 'docs', 'system', 'calendar'
        ));

-- Extend notification_type to include calendar notification types
-- The inline CHECK on the column does not have a named constraint yet; add a named one
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

-- Extend policy_key to include calendar policy keys
ALTER TABLE notification.notification
    DROP CONSTRAINT IF EXISTS notification_policy_key_valid;
ALTER TABLE notification.notification
    ADD CONSTRAINT notification_policy_key_valid
        CHECK (policy_key IN (
            'persistent_default', 'chat_message', 'chat_mention', 'chat_reply',
            'chat_typing_live', 'chat_reaction_live',
            'task_assignment', 'task_comment', 'task_mention',
            'task_status', 'task_description_modified', 'task_update',
            'document_update', 'document_comment', 'document_mention',
            'calendar_event_invite', 'calendar_event_cancel', 'calendar_event_change',
            'calendar_event_reminder', 'calendar_check_in_missed', 'calendar_event_digest'
        ));

-- Extend resource_domain to include 'calendar_event'
ALTER TABLE notification.resource_subscription
    DROP CONSTRAINT IF EXISTS resource_subscription_domain_valid;
ALTER TABLE notification.resource_subscription
    ADD CONSTRAINT resource_subscription_domain_valid
        CHECK (resource_domain IN ('task', 'document', 'channel', 'calendar_event'));

-- Extend presence_status to include 'in_meeting'
ALTER TABLE notification.active_connection
    DROP CONSTRAINT IF EXISTS presence_status_valid;
ALTER TABLE notification.active_connection
    ADD CONSTRAINT presence_status_valid
        CHECK (presence_status IN ('online', 'online_hidden', 'idle', 'offline', 'in_meeting'));

