CREATE TABLE IF NOT EXISTS notification.active_listener (
    instance_id text PRIMARY KEY,
    listen_topic text NOT NULL,
    backend_pid integer,
    connected_at timestamptz NOT NULL DEFAULT now(),
    last_heartbeat timestamptz NOT NULL DEFAULT now(),
    listener_status text NOT NULL DEFAULT 'active' CHECK (listener_status IN ('active', 'stale'))
);

CREATE INDEX IF NOT EXISTS idx_active_listener_status
    ON notification.active_listener(listener_status, last_heartbeat DESC);

COMMENT ON TABLE notification.active_listener IS 'Reference-table registry of backend LISTEN connections for instance-scoped notification topics. Used for operational debugging and stale listener cleanup.';

COMMENT ON COLUMN notification.active_listener.listen_topic IS 'PostgreSQL LISTEN topic currently owned by the backend instance, e.g. instance_backend_pod_abc_notifications.';

COMMENT ON COLUMN notification.active_listener.backend_pid IS 'Backend PostgreSQL session PID for the dedicated LISTEN connection when available.';

COMMENT ON COLUMN notification.active_listener.last_heartbeat IS 'Updated periodically by the backend listener goroutine. Stale entries indicate the LISTEN loop likely died or the instance crashed.';