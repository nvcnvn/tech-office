-- Migration: Add ritual_instances_scheduled notification type for bulk generation summaries
-- Direction: UP
-- Instead of N individual ritual_instance_assigned notifications when a scheduler run
-- generates N instances, the system now sends a single summary notification per assignee.

-- Step 1: Drop the old unnamed check constraint (notification_notification_type_check)
-- from the parent table and all Citus shard tables.
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN
        SELECT c.conrelid::regclass AS tbl
        FROM pg_constraint c
        WHERE c.conname = 'notification_notification_type_check'
    LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS notification_notification_type_check', rec.tbl);
    END LOOP;
END $$;

-- Step 2: Drop and re-create the named constraint on the parent table only.
-- Citus will propagate the new named constraint to shards automatically.
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
            'ritual_instances_scheduled',
            'calendar_event_invite', 'calendar_event_cancel', 'calendar_event_change',
            'calendar_event_reminder', 'calendar_check_in_missed', 'calendar_event_digest'
        ));
