# Data Model: Notification Delivery Consistency and Coverage

## Overview

This feature keeps domain-specific recipient data in existing domain tables and extends the notification schema to persist policy, acknowledgement, fallback, and shared-context routing state.

## Schema Changes Summary

| Change | Type | Schema | Object |
|--------|------|--------|--------|
| Persist evaluated policy and navigation target | ALTER TABLE | notification | notification.notification |
| Separate acknowledgement and fallback summary | ALTER TABLE | notification | notification.notification_recipient |
| Record per-attempt delivery/fallback outcomes | CREATE TABLE | notification | notification.delivery_attempt |
| Generalize contextual live audience tracking | CREATE UNLOGGED TABLE | notification | notification.active_context |

## 1. Altered Table: notification.notification

```sql
ALTER TABLE notification.notification
ADD COLUMN IF NOT EXISTS policy_key text NOT NULL DEFAULT 'persistent_default',
ADD COLUMN IF NOT EXISTS delivery_class text NOT NULL DEFAULT 'persistent',
ADD COLUMN IF NOT EXISTS navigation_target jsonb NOT NULL DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS source_category text NOT NULL DEFAULT 'activity',
ADD CONSTRAINT notification_policy_key_valid CHECK (
    policy_key IN (
        'chat_message',
        'chat_mention',
        'chat_reply',
        'chat_typing_live',
        'chat_reaction_live',
        'task_assignment',
        'task_comment',
        'task_mention',
        'task_status',
        'document_update',
        'document_comment',
        'document_mention'
    )
),
ADD CONSTRAINT notification_delivery_class_valid CHECK (
    delivery_class IN ('persistent', 'live_only')
),
ADD CONSTRAINT notification_source_category_valid CHECK (
    source_category IN ('activity', 'mention', 'system')
);
```

**Purpose**:
- `policy_key` stores the evaluated business rule set applied at publication time.
- `delivery_class` distinguishes persistent notifications from live-only signals.
- `navigation_target` stores structured domain navigation metadata for popup and center parity.
- `source_category` gives frontend and analytics a consistent grouping axis beyond raw type names.

## 2. Altered Table: notification.notification_recipient

```sql
ALTER TABLE notification.notification_recipient
ADD COLUMN IF NOT EXISTS acknowledgement_status text NOT NULL DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
ADD COLUMN IF NOT EXISTS acknowledgement_action text,
ADD COLUMN IF NOT EXISTS fallback_status text NOT NULL DEFAULT 'not_applicable',
ADD COLUMN IF NOT EXISTS fallback_reason text,
ADD COLUMN IF NOT EXISTS fallback_updated_at timestamptz,
ADD CONSTRAINT notification_recipient_ack_status_valid CHECK (
    acknowledgement_status IN ('pending', 'acknowledged')
),
ADD CONSTRAINT notification_recipient_ack_action_valid CHECK (
    acknowledgement_action IS NULL OR acknowledgement_action IN (
        'destination_open',
        'explicit_ack'
    )
),
ADD CONSTRAINT notification_recipient_fallback_status_valid CHECK (
    fallback_status IN (
        'not_applicable',
        'queued',
        'sent',
        'skipped',
        'failed'
    )
),
ADD CONSTRAINT notification_recipient_fallback_reason_valid CHECK (
    fallback_reason IS NULL OR fallback_reason IN (
        'live_only_policy',
        'no_push_target',
        'recipient_ineligible',
        'recipient_online',
        'suppressed_by_preference',
        'delivery_error'
    )
);
```

**Purpose**:
- `acknowledgement_status` becomes the authoritative unread signal.
- `acknowledgement_action` records how the notification was acknowledged.
- `fallback_status` and `fallback_reason` summarize the latest offline-delivery outcome for support and reporting.

## 3. New Table: notification.delivery_attempt

```sql
CREATE TABLE IF NOT EXISTS notification.delivery_attempt (
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    id uuid NOT NULL DEFAULT uuidv7(),
    notification_recipient_id uuid NOT NULL,
    channel text NOT NULL,
    attempt_status text NOT NULL,
    reason text,
    attempted_at timestamptz NOT NULL,
    instance_id text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (organization_id, id),
    CONSTRAINT delivery_attempt_channel_valid CHECK (
        channel IN ('sse', 'push', 'replay')
    ),
    CONSTRAINT delivery_attempt_status_valid CHECK (
        attempt_status IN ('queued', 'sent', 'skipped', 'failed')
    ),
    CONSTRAINT delivery_attempt_reason_valid CHECK (
        reason IS NULL OR reason IN (
            'live_only_policy',
            'no_active_context_match',
            'no_push_target',
            'recipient_ineligible',
            'suppressed_by_preference',
            'provider_error',
            'delivery_error'
        )
    ),
    CONSTRAINT delivery_attempt_recipient_fk FOREIGN KEY (organization_id, notification_recipient_id)
        REFERENCES notification.notification_recipient (organization_id, id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_delivery_attempt_org_recipient_attempted
    ON notification.delivery_attempt (organization_id, notification_recipient_id, attempted_at DESC);
```

**Purpose**:
- Maintains an auditable sequence of delivery and fallback actions.
- Supports debugging of why a recipient never saw a notification.
- Separates canonical recipient summary from detailed attempt history.

## 4. New UNLOGGED Table: notification.active_context

```sql
CREATE UNLOGGED TABLE IF NOT EXISTS notification.active_context (
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    connection_id uuid NOT NULL,
    context_type text NOT NULL,
    context_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    last_seen_at timestamptz NOT NULL,
    PRIMARY KEY (organization_id, connection_id, context_type, context_id),
    CONSTRAINT active_context_type_valid CHECK (
        context_type IN ('channel', 'document', 'task')
    )
);

CREATE INDEX IF NOT EXISTS idx_active_context_org_lookup
    ON notification.active_context (organization_id, context_type, context_id, last_seen_at DESC);
```

**Purpose**:
- Allows live-only or context-scoped notifications to resolve recipients from current activity context.
- Replaces the chat-only assumption embedded in `active_channel_id` without requiring process-local state.

**Data loss acceptance**:
- UNLOGGED state may be lost on crash; clients reconnect and repopulate context.
- Loss is acceptable because the table models ephemeral realtime presence, not durable notification history.

## Domain Recipient Eligibility Rules

### Documents
- Always eligible when configured by event type: followers, authors, commenters, explicitly mentioned users
- Actor excluded from self-notifications
- Deduplication key: `(organization_id, notification_id, employee_id)` via recipient creation path

### Tasks
- Always eligible when configured by event type: assignees, reporters, watchers, commenters, explicitly mentioned users
- Actor excluded from self-notifications unless product later introduces self-reminders
- Assignment notifications remain direct-recipient critical notifications

## Contract Impact

### Proto / API additions
- `NotificationSummary` will expose acknowledgement fields and navigation target metadata
- `AcknowledgeNotifications` (or equivalent acknowledgement RPC) becomes the authoritative write path for unread changes
- `ListNotifications` and `GetUnreadCount` operate on acknowledgement state

### SQLC query impact
New or updated queries are required for:
- listing notifications with acknowledgement and fallback summary fields
- acknowledging notifications by recipient IDs and action
- reading/writing active context state
- recording delivery attempts
- resolving document/task eligible recipients with clear relationship labels

## Migration Notes

- Update `backend/database/scripts/schema.sql` first
- Add paired migrations under `backend/k8s/base/database/migrations/`
- Regenerate sqlc after query updates
- Regenerate proto clients after API changes
- Run frontend workspace build so wrapper and generated contracts remain aligned
