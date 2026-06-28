-- Add consumer health tracking columns to notification.active_listener.
-- These columns expose the state of the consumeNotifications goroutine
-- independently from the listener heartbeat, making split-state bugs visible.
-- Note: CHECK constraint and COMMENTs are in schema.sql reference only.
-- Citus reference tables cannot execute multiple utility events in one migration.
ALTER TABLE notification.active_listener
    ADD COLUMN IF NOT EXISTS consumer_status text NOT NULL DEFAULT 'starting',
    ADD COLUMN IF NOT EXISTS consumer_last_active_at timestamptz,
    ADD COLUMN IF NOT EXISTS reconnect_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_error text,
    ADD COLUMN IF NOT EXISTS last_error_at timestamptz;
