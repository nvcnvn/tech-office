-- Notification rescue push: delayed fallback due times and live client receipts

ALTER TABLE notification.notification_recipient
    ADD COLUMN IF NOT EXISTS fallback_due_at timestamptz;

ALTER TABLE notification.notification_recipient
    DROP CONSTRAINT IF EXISTS notification_recipient_fallback_reason_valid;

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
            'ghost_connection_timeout',
            'delivery_error'
        )
    );

CREATE INDEX IF NOT EXISTS idx_recipient_fallback_due
    ON notification.notification_recipient(organization_id, fallback_status, fallback_due_at)
    WHERE fallback_status = 'queued' AND fallback_due_at IS NOT NULL;

COMMENT ON COLUMN notification.notification_recipient.fallback_reason IS 'Why fallback was queued, skipped, sent, or failed. Values: live_only_policy, no_push_target, recipient_ineligible, recipient_online, suppressed_by_preference, sse_receipt_confirmed, acknowledged_before_fallback, ghost_connection_timeout, delivery_error.';

COMMENT ON COLUMN notification.notification_recipient.fallback_due_at IS 'Deadline for delayed rescue push when SSE delivery is ambiguous. NULL when no rescue job is queued.';

CREATE TABLE IF NOT EXISTS notification.live_receipt (
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    id uuid NOT NULL DEFAULT uuidv7(),
    notification_recipient_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    connection_id uuid NOT NULL,
    platform text NOT NULL,
    app_state text NOT NULL,
    visibility_state text,
    received_at timestamptz NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (organization_id, id),
    CONSTRAINT live_receipt_platform_valid CHECK (platform IN ('web', 'mobile')),
    CONSTRAINT live_receipt_app_state_valid CHECK (app_state IN ('foreground', 'background')),
    CONSTRAINT live_receipt_visibility_valid CHECK (
        visibility_state IS NULL OR visibility_state IN ('visible', 'hidden')
    ),
    CONSTRAINT live_receipt_recipient_fk FOREIGN KEY (organization_id, notification_recipient_id)
        REFERENCES notification.notification_recipient (organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT live_receipt_employee_fk FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee (organization_id, id)
        ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_live_receipt_org_recipient_connection
    ON notification.live_receipt (organization_id, notification_recipient_id, connection_id);

CREATE INDEX IF NOT EXISTS idx_live_receipt_org_recipient_received
    ON notification.live_receipt (organization_id, notification_recipient_id, received_at DESC);

COMMENT ON TABLE notification.live_receipt IS 'Client transport receipts for persistent notification SSE delivery. Does not mark notifications read or acknowledged.';

COMMENT ON COLUMN notification.live_receipt.connection_id IS 'SSE connection ID that received and parsed the notification event.';

COMMENT ON COLUMN notification.live_receipt.app_state IS 'Client app state at receipt time: foreground or background. Only foreground/visible receipts can suppress rescue push in phase 1.';

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
            'ghost_connection_timeout',
            'provider_error',
            'delivery_error'
        )
    );