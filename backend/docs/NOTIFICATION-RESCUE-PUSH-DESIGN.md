# Notification Rescue Push Design

This document defines a concrete design for making persistent notifications more reliable when SSE connections become ghost connections. The design does not try to prove that SSE delivery was perfect. Instead, it treats SSE as the first delivery attempt and push as a delayed rescue path when no trustworthy client receipt arrives in time.

## Decision Summary

Use `optimistic SSE + delayed rescue push`, not `SSE ack suppresses push immediately`.

Rules:

- Persistent notifications still go to SSE first when the employee has a fresh active connection.
- If the employee has no fresh active connection, send push immediately after commit.
- If the employee has a fresh active connection, queue a rescue push for a short grace window.
- Cancel the queued rescue push only when the backend receives a valid client receipt from a suppressible context.
- Accept occasional duplicate delivery. Reliability is more important than exactly-once delivery.
- Never use notification acknowledgement as a transport receipt. Acknowledgement stays part of the unread lifecycle.

## Problem This Solves

Current routing assumes that a fresh `notification.active_connection` row plus a successful backend send into the in-memory SSE channel is enough to skip push. That is not strong enough when:

- the app is closed abruptly and the active connection row is still fresh
- Envoy or Cloudflare keeps the HTTP stream looking alive longer than the client really is
- the backend sends into the per-connection event channel, but the client never receives or processes the event
- the user is shown as `online` or `active_channel_id = X`, so push is suppressed, but the stream is actually dead

The failure mode is false success: the backend believes SSE was enough, the user gets no push, and the notification is lost until they reconnect.

## Product Goal

Primary goal:

- ensure the user gets the notification even when SSE delivery is ambiguous

Secondary goals:

- avoid unnecessary duplicate push when a foreground client clearly received the event
- keep live-only events out of push fallback
- reuse the existing notification lifecycle vocabulary where possible

Non-goals:

- exactly-once delivery across SSE and push
- proving that the user read or saw the notification
- changing the authoritative unread model away from acknowledgement state

## Core Policy

### 1. Live-only notifications

`delivery_class = live_only` never queues rescue push.

Examples:

- typing
- reactions
- live voice-call presence updates

### 2. Priority Always notifications

Priority `0` should favor certainty over suppression.

Policy:

- send SSE immediately
- send push immediately after commit
- do not wait for a receipt window

This applies to notifications such as:

- mentions that must break through
- direct assignment alerts
- incoming voice-call invitations

If the team later wants to reduce duplication here, it can do so after metrics prove the rescue model is stable.

### 3. Other persistent notifications

For persistent notifications with push eligibility:

- if there is no fresh active connection, send push immediately
- if there is at least one fresh active connection, attempt SSE and queue a rescue push

Recommended default grace windows:

- direct targeted persistent notifications: `2s`
- subscribed activity persistent notifications: `4s`
- cap all rescue windows at `5s`

### 4. Preference suppression

User preference suppression still applies before any rescue push is queued or sent.

Examples:

- muted domains
- DND suppression for non-critical events
- recipient not eligible for push

If push is suppressed by policy, the system should never queue a rescue push. The receipt path still records whether SSE likely worked.

## Important Semantic Change

The current concept of `recipient is online` or `recipient is viewing the target channel` must no longer mean `never send push`.

It should mean only:

- do not send push immediately
- queue a rescue push unless a trustworthy client receipt arrives before the deadline

This is the main change that closes the ghost-connection gap.

## Receipt Semantics

Introduce a new concept: `client receipt`.

`client receipt` means:

- the authenticated client received the notification event
- the client parsed it successfully
- the client was still bound to the reported `connection_id`
- the client reports its app visibility state when sending the receipt

`client receipt` does not mean:

- the user saw the notification
- the user opened the destination
- the notification should be marked acknowledged

## Suppression Policy for Receipts

The first rollout should be conservative.

Only these receipts suppress the queued rescue push:

- web receipt from a visible tab
- mobile receipt while the app is foreground/active

These receipts should not suppress rescue push in phase 1:

- web hidden-tab receipts
- background/mobile-inactive receipts
- stale or unowned `connection_id` receipts

Rationale:

- a hidden web tab receiving SSE does not prove the user noticed anything
- mobile already closes the shared SSE stream when backgrounded, so a missing mobile receipt is expected
- if duplicates are acceptable, suppression should be biased toward caution

## Delivery State Machine

For each `notification.notification_recipient` row:

1. `pending`
2. `sse_attempted`
3. one of:
   - `rescue_not_needed`
   - `rescue_queued`
   - `push_sent`
   - `push_skipped`
   - `push_failed`

This does not replace `acknowledgement_status`. It only governs transport and fallback.

### Summary fields on recipient row

Use `fallback_status` and `fallback_reason` as the high-level support view.

Recommended meanings:

- `not_applicable`: live-only or push not part of policy
- `queued`: waiting for rescue push deadline
- `sent`: rescue push sent
- `skipped`: rescue push intentionally skipped
- `failed`: rescue push attempted and failed

Recommended reasons:

- `live_only_policy`
- `suppressed_by_preference`
- `no_push_target`
- `recipient_ineligible`
- `recipient_online`
- `sse_receipt_confirmed`
- `acknowledged_before_fallback`
- `delivery_error`

`recipient_online` becomes a temporary queueing reason, not a final guarantee.

## Schema Changes

### 1. Extend `notification.notification_recipient`

Add:

- `fallback_due_at timestamptz`

Purpose:

- lets the rescue worker query due fallback jobs without a separate job table in phase 1

Optional later additions if summary querying becomes expensive:

- `last_live_receipt_at timestamptz`
- `last_live_receipt_connection_id uuid`

Phase 1 should avoid these summary columns unless profiling shows a need.

### 2. Add `notification.live_receipt`

Create a dedicated table instead of overloading acknowledgement or delivery-attempt semantics.

Suggested shape:

```sql
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
        ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_live_receipt_org_recipient_connection
    ON notification.live_receipt (organization_id, notification_recipient_id, connection_id);

CREATE INDEX IF NOT EXISTS idx_live_receipt_org_recipient_received
    ON notification.live_receipt (organization_id, notification_recipient_id, received_at DESC);
```

Purpose:

- stores authoritative transport receipts separate from unread acknowledgement
- allows multiple receipts from multiple connections without flattening them into one summary row
- gives support and debugging a clean answer to `which client confirmed receipt?`

### 3. Extend `notification.delivery_attempt`

Do not add a new table for rescue scheduling in phase 1. Use `fallback_due_at` on recipient rows.

Do extend `delivery_attempt.reason` to include:

- `sse_receipt_confirmed`
- `acknowledged_before_fallback`
- `connection_unresponsive` (was `ghost_connection_timeout`, which named the workaround for a defect the presence ping-pong protocol removed)

Use `delivery_attempt` for audit trail entries such as:

- `channel = 'sse', attempt_status = 'sent'`
- `channel = 'push', attempt_status = 'queued'`
- `channel = 'push', attempt_status = 'skipped', reason = 'sse_receipt_confirmed'`
- `channel = 'push', attempt_status = 'sent'`
- `channel = 'push', attempt_status = 'failed', reason = 'delivery_error'`

## New RPC

Add a new authenticated write RPC.

Suggested name:

- `ConfirmNotificationReceipt`

Suggested request:

```protobuf
message ConfirmNotificationReceiptRequest {
  repeated string notification_recipient_ids = 1;
  string connection_id = 2;
  string platform = 3;          // web | mobile
  string app_state = 4;         // foreground | background
  string visibility_state = 5;  // visible | hidden | empty for mobile
  google.protobuf.Timestamp received_at = 6;
}
```

Suggested response:

```protobuf
message ConfirmNotificationReceiptResponse {
  int32 confirmed_count = 1;
}
```

Validation rules:

- authenticate employee and organization from context
- require `connection_id`
- verify `connection_id` belongs to the employee and is still fresh in `active_connection`
- require recipient rows to belong to the authenticated employee and organization
- upsert receipts idempotently by `(organization_id, notification_recipient_id, connection_id)`

Behavior:

- insert or update `live_receipt`
- append an audit row to `delivery_attempt`
- if the rescue push is still queued and the receipt is suppressible, mark fallback as skipped and clear `fallback_due_at`

## Backend Flow Changes

### A. Publish path

Update `PublishNotification` and the fallback decision path as follows:

1. Create notification and recipient rows as today.
2. Attempt live SSE routing as today.
3. For each recipient, evaluate push eligibility:
   - if push is not eligible by policy, set `fallback_status = 'skipped'`
   - if there is no fresh active connection, send push immediately after commit
   - if there is a fresh active connection, set:
     - `fallback_status = 'queued'`
     - `fallback_reason = 'recipient_online'`
     - `fallback_due_at = now() + grace_window`
4. Write delivery-attempt audit rows for the SSE attempt and push queueing decision.

### B. Rescue worker

Add a dedicated short-interval rescue worker.

Recommended behavior:

- run every `1s`
- claim a small batch of due queued recipients with `FOR UPDATE SKIP LOCKED`
- for each claimed recipient:
  - if already acknowledged, skip push and mark `acknowledged_before_fallback`
  - else if a suppressible receipt exists, skip push and mark `sse_receipt_confirmed`
  - else send FCM push

On successful push send:

- `fallback_status = 'sent'`
- `fallback_reason = NULL`
- `fallback_due_at = NULL`

On push failure:

- `fallback_status = 'failed'`
- `fallback_reason = 'delivery_error'`
- `fallback_due_at = NULL`

### C. Retry worker separation

Keep the existing five-minute retry worker for real provider failures and cleanup-style retries.

Do not use it for the new rescue path. Seconds-scale rescue needs its own short-delay worker.

## Frontend Changes

### Web

In the shared web notification stream path:

- after a persistent notification event is parsed and accepted by the client, enqueue a receipt call
- batch multiple recipient IDs in a short debounce window, for example `250ms`
- send suppressible receipts only when `document.hidden === false`
- optionally still send non-suppressing diagnostic receipts when hidden if the team wants visibility into hidden-tab delivery

Do not send receipts for:

- live-only events
- malformed events without `notificationRecipientId`

### Mobile

In the shared mobile notification stream provider:

- after a persistent notification event is parsed and accepted while the app is active, enqueue a receipt call
- use the provider's current `connectionId`
- do not send receipts when the app is backgrounded; the stream is intentionally closed there already

### Client batching

Both web and mobile should batch receipts.

Suggested client strategy:

- collect recipient IDs for `250ms`
- send one RPC with all pending IDs for the current `connection_id`
- drop duplicates locally within the current connection session

## Duplicate Handling

Duplicate delivery is expected sometimes.

To keep the user experience clean, both mobile and web should dedupe transport handling by:

- `notificationId`
- `notificationRecipientId`

Recommended behavior:

- if SSE already applied the notification locally and the same notification later arrives via push, do not create a second in-app banner or duplicate cache entry
- if the OS already showed a remote push, opening the app should still merge into the same notification record

This is an app-surface dedupe rule, not a transport suppression rule.

## Recommended Timing Defaults

Phase 1 defaults:

- priority `0`: immediate push
- persistent direct targeted alerts: `2s` rescue window
- persistent subscribed activity: `4s` rescue window
- worker poll interval: `1s`
- client receipt batching: `250ms`

These values should be configuration-driven.

## Metrics and Observability

Add counters and logs for:

- queued rescue pushes
- rescue pushes skipped by receipt
- rescue pushes skipped by acknowledgement
- rescue pushes actually sent
- rescue push failures
- receipt counts by platform and visibility
- notifications where the employee had an active connection but still needed rescue push

Important ratio to watch:

- `connection_unresponsive_rate = rescue_push_sent_after_online_queue / total_online_queued`

If this is non-trivial, the design is catching exactly the class of failures it was introduced for.

## Implementation Refinements

### FCM payload routing contract

Every persistent rescue push must include enough data for both web and mobile to merge and route the notification without another lookup.

Required data keys:

- `notificationId` and `notification_id`
- `notificationRecipientId` and `notification_recipient_id`
- `sourceDomain` and `source_domain`
- `notificationType` and `notification_type`
- `policyKey` and `policy_key` when present
- `navigationDomain`, `navigationResourceType`, `navigationResourceId`, `navigationSecondaryId`, and `navigationAction` when `NavigationTarget` is present
- original `actionData` keys, including domain-specific IDs such as `channelId`, `messageId`, `parentMessageId`, `projectId`, `taskId`, `callId`, and `invitationId`
- `click_action` for web service-worker notification clicks

The web `click_action` should be derived from the same typed navigation/action data used by in-app notification navigation. The mobile app should continue resolving native push taps from `href`, `deepLink`, typed navigation fields, and action data. This keeps FCM payloads self-sufficient for deep links and dedupe.

### Time-sensitive voice-call pushes

Incoming voice-call notifications remain priority `0` and are sent by push immediately rather than waiting for rescue. Their FCM payload must preserve the voice-call action data (`channelId`, `callId`, `invitationId`, caller metadata) and the push sender must keep the dedicated Android `voice-calls` channel plus APNS alert headers with `apns-priority: 10` and time-sensitive interruption metadata.

This means a foreground SSE receipt never delays the OS-level incoming-call path for phase 1.

### Shard-safe rescue worker claim strategy

The rescue worker should avoid one cross-tenant `FOR UPDATE SKIP LOCKED` scan. Phase 1 can first list organizations with due queued fallback rows, then claim a bounded batch per organization with `FOR UPDATE SKIP LOCKED`. This keeps each claim scoped by `organization_id` and aligned with Citus sharding rules.

### Client receipt flushing

Web receipts are sent only from visible tabs. Mobile receipts are sent only while the app is active; if the app transitions away from active while a receipt batch is pending, flush the already-accepted active receipt before closing SSE. Do not create new receipts after the app is backgrounded.

## Rollout Plan

### Phase 1: Reliability-first

Implement:

- `fallback_due_at`
- `live_receipt` table
- `ConfirmNotificationReceipt` RPC
- rescue worker
- conservative suppressible receipts only from foreground/visible contexts

Policy:

- priority `0` sends push immediately
- other persistent notifications with active connections queue rescue push
- if no receipt arrives before the deadline, send push even if this may duplicate SSE

### Phase 2: Smarter suppression

After metrics stabilize, consider:

- per-policy grace windows
- suppressing rescue push for additional contexts
- device-aware suppression rules if the team later wants `web receipt does not suppress mobile push`

### Phase 3: Optional device-aware routing

If duplicate push becomes too noisy, extend receipts and push-token metadata so suppression can be evaluated per device class instead of only per employee.

This is intentionally out of scope for phase 1.

## Implementation Touchpoints

Backend:

- `backend/internal/notification/publisher.go`
- `backend/internal/notification/routing_logic.go`
- `backend/internal/notification/listener.go`
- `backend/internal/notification/delivery.go`
- `backend/internal/notification/push_logic.go`
- `backend/internal/notification/sse.go`
- `backend/database/scripts/schema.sql`
- `backend/database/scripts/notification.query.sql`
- RPC contracts under `backend/rpc/v1`

Web:

- `frontend/apps/web/src/app/workspace/providers/NotificationStreamProvider.tsx`
- `frontend/packages/notifications/src/useSSEConnection.ts`
- `frontend/apps/web/src/hooks/usePresenceTracking.ts`

Mobile:

- `frontend/apps/mobile/src/providers/notification-stream-provider.tsx`
- mobile push handling path that merges FCM and in-app notification state

## Final Recommendation

Do not frame this feature as `SSE ack decides whether push is sent`.

Frame it as:

- `SSE is the optimistic first attempt`
- `client receipt is a short-window confidence signal`
- `push is the rescue path when that confidence never arrives`

That framing matches the actual failure mode and keeps the system biased toward delivery, which is the right tradeoff for this product requirement.