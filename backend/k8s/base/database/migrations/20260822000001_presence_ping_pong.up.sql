-- Presence Ping-Pong Protocol (spec 033-presence-ping-pong)
--
-- Liveness stops being self-reported and self-renewing. `last_pong_at` is advanced
-- only by a received PresencePong; nothing server-side refreshes it. Responsive vs
-- unresponsive is derived at read time from that one column, so the stored
-- `connection_status` flag and the background job that maintained it both go away.
--
-- notification.active_connection is UNLOGGED and reconstructible by client
-- reconnection, so there is no data migration: rows present at deploy time are simply
-- swept by the janitor if their clients do not pong.

BEGIN;

-- ---------------------------------------------------------------------------
-- active_connection: one column carries the whole state machine
-- ---------------------------------------------------------------------------

ALTER TABLE notification.active_connection
    RENAME COLUMN last_heartbeat TO last_pong_at;

UPDATE notification.active_connection SET last_pong_at = now() WHERE last_pong_at IS NULL;

ALTER TABLE notification.active_connection
    ALTER COLUMN last_pong_at SET NOT NULL;

ALTER TABLE notification.active_connection
    DROP COLUMN connection_status;

-- Indexes predicated on the removed column, or leading with a stored status.
DROP INDEX IF EXISTS notification.idx_active_connection_employee;
DROP INDEX IF EXISTS notification.idx_active_connection_instance;
DROP INDEX IF EXISTS notification.idx_active_connection_org;
DROP INDEX IF EXISTS notification.idx_active_connection_org_presence;
DROP INDEX IF EXISTS notification.idx_active_connection_heartbeat;
DROP INDEX IF EXISTS notification.idx_active_connection_active_channel;

-- Serves presence lookups and routing eligibility, the two hottest reads.
CREATE INDEX IF NOT EXISTS idx_active_connection_employee_live
    ON notification.active_connection(organization_id, employee_id, last_pong_at DESC);

-- Serves channel-scoped live routing.
CREATE INDEX IF NOT EXISTS idx_active_connection_channel_live
    ON notification.active_connection(organization_id, active_channel_id, last_pong_at DESC)
    WHERE active_channel_id IS NOT NULL;

-- Serves the janitor sweep.
CREATE INDEX IF NOT EXISTS idx_active_connection_expiry
    ON notification.active_connection(organization_id, last_pong_at);

-- Serves instance-startup cleanup.
CREATE INDEX IF NOT EXISTS idx_active_connection_instance
    ON notification.active_connection(organization_id, instance_id);

COMMENT ON COLUMN notification.active_connection.last_pong_at IS 'Instant the database observed a client answer a presence ping (PresencePong RPC). Advanced ONLY by a received pong — nothing server-side ever refreshes it. Liveness is derived: a connection is a live-delivery target iff last_pong_at >= now() - 45s, and is deleted by the janitor once silent for 90s.';

COMMENT ON COLUMN notification.active_connection.presence_status IS 'Real-time presence indicator reported by each pong. Allowed values: online, online_hidden, idle, offline, in_meeting. Aligned with rpc.v1.PresenceStatus enum.';

-- ---------------------------------------------------------------------------
-- Fallback reasons: connection_unresponsive replaces ghost_connection_timeout
--
-- ghost_connection_timeout named the workaround for the defect this feature fixes —
-- a connection that looked online but was not. Absence is now observable directly,
-- so the reason is stated plainly and the old value becomes unreachable.
-- ---------------------------------------------------------------------------

ALTER TABLE notification.notification_recipient
    DROP CONSTRAINT IF EXISTS notification_recipient_fallback_reason_valid;

UPDATE notification.notification_recipient
   SET fallback_reason = 'connection_unresponsive'
 WHERE fallback_reason = 'ghost_connection_timeout';

ALTER TABLE notification.notification_recipient
    ADD CONSTRAINT notification_recipient_fallback_reason_valid CHECK (
        fallback_reason IS NULL OR fallback_reason IN (
            'live_only_policy',
            'no_push_target',
            'recipient_ineligible',
            'recipient_online',
            'suppressed_by_preference',
            'sse_receipt_confirmed',
            'acknowledged_before_fallback',
            'connection_unresponsive',
            'delivery_error'
        )
    );

COMMENT ON COLUMN notification.notification_recipient.fallback_reason IS 'Why fallback was queued, skipped, sent, or failed. Values: live_only_policy, no_push_target, recipient_ineligible, recipient_online, suppressed_by_preference, sse_receipt_confirmed, acknowledged_before_fallback, connection_unresponsive, delivery_error.';

ALTER TABLE notification.delivery_attempt
    DROP CONSTRAINT IF EXISTS delivery_attempt_reason_valid;

UPDATE notification.delivery_attempt
   SET reason = 'connection_unresponsive'
 WHERE reason = 'ghost_connection_timeout';

ALTER TABLE notification.delivery_attempt
    ADD CONSTRAINT delivery_attempt_reason_valid CHECK (
        reason IS NULL OR reason IN (
            'live_only_policy',
            'no_active_context_match',
            'no_push_target',
            'recipient_ineligible',
            'recipient_online',
            'suppressed_by_preference',
            'sse_receipt_confirmed',
            'acknowledged_before_fallback',
            'connection_unresponsive',
            'provider_error',
            'delivery_error'
        )
    );

COMMIT;
