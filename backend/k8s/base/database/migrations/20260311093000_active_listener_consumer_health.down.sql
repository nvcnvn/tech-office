ALTER TABLE notification.active_listener
    DROP COLUMN IF EXISTS consumer_status,
    DROP COLUMN IF EXISTS consumer_last_active_at,
    DROP COLUMN IF EXISTS reconnect_count,
    DROP COLUMN IF EXISTS last_error,
    DROP COLUMN IF EXISTS last_error_at;
