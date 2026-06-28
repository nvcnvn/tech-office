# Notification Lifecycle Contract

## Planned RPC Contract Changes

### PublishNotificationRequest

Add or normalize these fields:

| Field | Purpose |
|-------|---------|
| `policy_key` | Identifies the evaluated delivery policy for the event |
| `delivery_class` | Distinguishes `persistent` vs `live_only` intent |
| `navigation_target` | Structured deep-link payload instead of loosely-typed action-only maps |
| `audience_context` | Optional contextual recipient scope (`channel`, `document`, `task`) for live routing |

### NotificationSummary

Expose separate lifecycle fields:

| Field | Purpose |
|-------|---------|
| `acknowledgement_status` | Authoritative unread/read state |
| `acknowledged_at` | Timestamp of acknowledgement |
| `acknowledgement_action` | `destination_open` or `explicit_ack` |
| `fallback_status` | Latest offline delivery state |
| `fallback_reason` | Why fallback was skipped, failed, or queued |
| `policy_key` | Evaluated policy shown for diagnostics and frontend branching |
| `navigation_target` | Shared destination contract |

### Acknowledgement Write API

Introduce or repurpose the write path so acknowledgement is explicit:

| RPC | Purpose |
|-----|---------|
| `AcknowledgeNotifications` | Marks one or more recipient rows acknowledged with an action |
| `AcknowledgeNotificationFromDestination` | Optional specialized endpoint if the team prefers a dedicated destination-open path |

The implementation can keep `MarkAsRead` temporarily as a compatibility alias, but the plan assumes acknowledgement semantics become authoritative and are documented as such.

## Navigation Target Contract

```json
{
  "domain": "projects",
  "resourceType": "task",
  "resourceId": "uuid",
  "secondaryId": "uuid-or-empty",
  "action": "open_comment"
}
```

Required behaviors:
- Popup action and notification center row use the same payload
- Destination open is the action that acknowledges popup-driven notifications
- Unsupported or stale targets must fail safely without acknowledging the notification

## Realtime Contract

### Live-only events
- `delivery_class = live_only`
- No persistent notification-center record is created
- `GetUnreadCount` and `ListNotifications` do not include them
- Delivery uses active context audience resolution when no explicit recipients are supplied

### Persistent events
- A notification row plus recipient rows are created
- Delivery attempts are recorded for SSE, replay, and push fallback channels
- Replay may deliver pending or failed persistent notifications after reconnect without re-acknowledging them

## Source-Domain Parity Contract

Backend and frontend must stay aligned on supported persistent domains:
- `chat`
- `docs`
- `projects`

If additional domains remain exposed in generic notification types, the frontend filter and unread breakdown contract must explicitly support them in the same release.
