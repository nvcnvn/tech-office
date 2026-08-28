-- Migration: native call wakeup (Feature 037)
-- Direction: UP
--
-- Rollback posture: forward-only, no data rewrite. Every change here is additive —
-- two widened CHECK constraints, one nullable column, one new column with a default
-- that reproduces today's behaviour, and one widened unique constraint. Nothing
-- existing is dropped or rewritten, so a revert is a compensating forward migration
-- rather than a restore (Constitution VI).

-- ============================================================================
-- notification.delivery_attempt: the call_wake channel and its reasons
--
-- Constitution Principle VIII: these CHECKs are mirrored by DeliveryChannelCallWake
-- and the FallbackReason* constants in backend/internal/notification/constants.go,
-- and by the CallWakeEvent union in frontend/packages/apis/src/push-tokens.ts.
--
-- Deliberately NOT added here: 'suppressed_by_preference' is already in the reason
-- vocabulary but must never appear on a call_wake row. Calls ring through workspace
-- do-not-disturb and muted domains (FR-016); a call_wake row carrying that reason
-- means the suppression exemption has regressed.
-- ============================================================================

ALTER TABLE notification.delivery_attempt
    DROP CONSTRAINT IF EXISTS delivery_attempt_channel_valid;

ALTER TABLE notification.delivery_attempt
    ADD CONSTRAINT delivery_attempt_channel_valid CHECK (
        channel IN ('sse', 'push', 'replay', 'call_wake')
    );

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
            'call_already_ended'
        )
    );

COMMENT ON COLUMN notification.delivery_attempt.channel IS 'Delivery channel: sse (realtime), push (FCM offline), replay (reconnect replay), call_wake (native call wake, one row per device per call event).';

COMMENT ON COLUMN notification.delivery_attempt.reason IS 'Why this attempt was queued, sent, skipped, or failed. Values: live_only_policy, no_active_context_match, no_push_target, recipient_ineligible, recipient_online, suppressed_by_preference, sse_receipt_confirmed, acknowledged_before_fallback, connection_unresponsive, provider_error, delivery_error, no_call_wake_target, native_tier_unavailable, call_already_ended.';

-- ============================================================================
-- notification.push_token: token type as a first-class column
--
-- A device that can be woken natively holds TWO rows sharing one device_identifier:
-- its FCM token for routine notifications, and its APNs VoIP token for calls. The
-- existing push_token_unique (organization_id, employee_id, device_identifier)
-- constraint permits only one, so the token type joins the key.
--
-- token_type is a real column rather than a token_metadata JSONB key because it is
-- part of the uniqueness key and is CHECK-constrained; a JSONB expression index
-- would satisfy neither cleanly. token_metadata.tokenType is retired in
-- favour of this column — there is one definition of a token's type, not two.
--
-- The 'fcm' default reproduces today's behaviour for every existing row: every
-- token registered before this feature is an FCM (or web push) token reached
-- through Firebase, which is exactly what the dispatcher will keep doing with it.
--
-- Constitution Principle VIII: this CHECK is mirrored by the PushTokenType*
-- constants in backend/internal/notification/constants.go and the PushTokenType
-- union in frontend/packages/apis/src/push-tokens.ts.
-- ============================================================================

ALTER TABLE notification.push_token
    ADD COLUMN IF NOT EXISTS token_type text NOT NULL DEFAULT 'fcm';

ALTER TABLE notification.push_token
    DROP CONSTRAINT IF EXISTS push_token_token_type_valid;

ALTER TABLE notification.push_token
    ADD CONSTRAINT push_token_token_type_valid CHECK (
        token_type IN ('fcm', 'apns_voip', 'web_push')
    );

ALTER TABLE notification.push_token
    DROP CONSTRAINT IF EXISTS push_token_unique;

ALTER TABLE notification.push_token
    ADD CONSTRAINT push_token_unique UNIQUE (organization_id, employee_id, device_identifier, token_type);

COMMENT ON COLUMN notification.push_token.token_type IS 'Which provider token this row carries: fcm (Firebase, routine notifications and the Android call transport), apns_voip (direct APNs VoIP push, the iOS call transport), web_push (browser). One row per type per device_identifier.';

COMMENT ON COLUMN notification.push_token.token_metadata IS 'Device facts that do not key a row: platform (ios/android/web), deliveryProvider, and nativeCallCapable (whether this device build and its permissions support the native call tier, driving tier-A vs tier-B routing).';

-- ============================================================================
-- voice.call_session: the ring deadline
--
-- There was no ring timeout before this feature: a ringing call ended only when
-- LiveKit reported the room finished, so a call nobody answered rang without bound
-- (US1 scenario 5, SC-006). ring_deadline_at is set on the transition into
-- 'ringing' and NULL in every other state; a bounded sweep claims rows past their
-- deadline and ends the call missed.
--
-- Constitution Principle VIII: the 45-second timeout that populates this column is
-- defined once as RingTimeout in backend/internal/voice/constants.go.
-- ============================================================================

ALTER TABLE voice.call_session
    ADD COLUMN IF NOT EXISTS ring_deadline_at timestamptz;

COMMENT ON COLUMN voice.call_session.ring_deadline_at IS 'When an unanswered ringing call expires. Set on the transition into ringing (started_at + the 45s ring timeout), NULL in every other state. The ring timeout sweep claims rows past this deadline and ends the call missed.';

CREATE INDEX IF NOT EXISTS idx_call_session_ring_deadline
    ON voice.call_session (organization_id, ring_deadline_at)
    WHERE state = 'ringing' AND ring_deadline_at IS NOT NULL;
