# Contract: Voice SSE And Notification Events

Voice discovery uses the existing `NotificationService.StreamNotifications` SSE/Connect stream. Events are delivered as `NotificationEvent` with `event_type = "notification"` and a `NotificationSummary` payload.

## Notification Constants

Use `source_domain = "chat"` so call events remain attached to chat rooms. Add these `notification_type` values to schema constraints, Go constants, frontend TypeScript unions, and alignment tests:
- `voice_call_incoming`
- `voice_call_started`
- `voice_call_updated`
- `voice_call_ended`

Add these `policy_key` values:
- `chat_voice_call_incoming`
- `chat_voice_call_live`
- `chat_voice_call_record`

## Event: Incoming Call

Purpose: High-priority alert for call starts and explicit invitations.

```json
{
  "event_type": "notification",
  "notification": {
    "source_domain": "chat",
    "notification_type": "voice_call_incoming",
    "title": "Incoming voice call",
    "message": "A call is starting in this conversation.",
    "priority": 0,
    "policy_key": "chat_voice_call_incoming",
    "delivery_class": "persistent",
    "source_category": "system",
    "action_data": {
      "channelId": "<channel-id>",
      "callId": "<call-id>",
      "invitationId": "<invitation-id>",
      "initiatorEmployeeId": "<employee-id>"
    },
    "navigation_target": {
      "domain": "chat",
      "resource_type": "channel",
      "resource_id": "<channel-id>",
      "action": "join_voice_call"
    }
  }
}
```

Delivery rules:
- Direct targeted to eligible call recipients not already in the active room.
- Priority `0` so online users receive the alert promptly and offline fallback can be considered by existing notification routing.
- Does not grant room access; `JoinVoiceCall` must re-check membership.

## Event: Voice Call Started Or Updated

Purpose: Live-only room discovery for active-call banners, call cards, and participant count changes.

```json
{
  "event_type": "notification",
  "notification": {
    "source_domain": "chat",
    "notification_type": "voice_call_started",
    "title": "Voice call active",
    "message": "A voice call is active in this conversation.",
    "priority": 2,
    "policy_key": "chat_voice_call_live",
    "delivery_class": "live_only",
    "source_category": "system",
    "action_data": {
      "channelId": "<channel-id>",
      "callId": "<call-id>",
      "state": "active",
      "participantCount": "2"
    },
    "navigation_target": {
      "domain": "chat",
      "resource_type": "channel",
      "resource_id": "<channel-id>",
      "action": "show_active_voice_call"
    }
  }
}
```

Delivery rules:
- Use `active_channel_id` for channel-scoped live delivery to currently viewing members.
- Also publish targeted live-only events to online invitees or room members when needed for room-list indicators.
- Clients must call `GetActiveVoiceCall(channel_id)` when opening or reloading a room to recover from missed SSE events.

## Event: Voice Call Ended

Purpose: Clear active indicators and prompt clients to show the completed call record.

```json
{
  "event_type": "notification",
  "notification": {
    "source_domain": "chat",
    "notification_type": "voice_call_ended",
    "title": "Voice call ended",
    "message": "The voice call has ended.",
    "priority": 2,
    "policy_key": "chat_voice_call_live",
    "delivery_class": "live_only",
    "source_category": "system",
    "action_data": {
      "channelId": "<channel-id>",
      "callId": "<call-id>",
      "outcome": "completed",
      "recordMessageId": "<message-id>"
    },
    "navigation_target": {
      "domain": "chat",
      "resource_type": "message",
      "resource_id": "<record-message-id>",
      "action": "open_call_record"
    }
  }
}
```

Delivery rules:
- Live-only for clearing indicators.
- The durable room history is the system `chat.message` call record plus `voice.call_session` and `voice.call_artifact` rows, not the SSE event.

## Client Handling Rules

- Unknown voice notification types are ignored but logged at debug level.
- `voice_call_incoming` shows an interruptive incoming-call surface with accept/decline actions.
- `voice_call_started` and `voice_call_updated` update active-call state but do not automatically join media.
- `voice_call_ended` tears down local call state if the user is in the call and clears active room indicators.
- All join attempts go through `VoiceService.JoinVoiceCall`; clients must never trust SSE payloads as authorization.