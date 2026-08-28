-- Add the 'acting_device_excluded' delivery_attempt reason.
--
-- A terminal call wake is no longer sent to the handset that caused the ending. The
-- iOS client module reports *every* call wake to CallKit as a new incoming call before
-- JavaScript runs, so a wake sent back to the phone that just answered or declined
-- rings it a second time. The device that acted has already closed its own call.
--
-- The skip is recorded rather than silent: the feature guarantees one delivery_attempt
-- row per device per call event, and a silent skip is exactly what makes a field report
-- of "my phone rang again after I declined" impossible to trace.
--
-- Rollback posture: forward-only. This widens a CHECK and rewrites two comments; there
-- is no data rewrite and nothing to undo for existing rows.

ALTER TABLE notification.delivery_attempt
    DROP CONSTRAINT IF EXISTS delivery_attempt_reason_valid;

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
            'delivery_error',
            'no_call_wake_target',
            'native_tier_unavailable',
            'call_already_ended',
            'acting_device_excluded'
        )
    );

COMMENT ON COLUMN notification.delivery_attempt.reason IS 'Why this attempt was queued, sent, skipped, or failed. Values: live_only_policy, no_active_context_match, no_push_target, recipient_ineligible, recipient_online, suppressed_by_preference, sse_receipt_confirmed, acknowledged_before_fallback, connection_unresponsive, provider_error, delivery_error, no_call_wake_target, native_tier_unavailable, call_already_ended, acting_device_excluded.';
