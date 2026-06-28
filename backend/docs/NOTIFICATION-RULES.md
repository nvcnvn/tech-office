# Notification Rules

This document captures the current backend notification contract plus the intended mobile live-notification behavior for chat-heavy scenarios.

## Chat Payload Metadata

Chat SSE and persisted notification payloads should include these `actionData` fields when the notification type is `message`, `mention`, or `reply`:

- `channelId`
- `channelType`
- `channelName`
- `messageId`
- `senderEmployeeId`
- `senderName`
- `action`
- `parentMessageId` for reply and thread notifications

These fields let mobile foreground notification logic classify busy channels, DMs, and thread replies without parsing the notification title string.

## Incoming Voice Call Payload Metadata

`voice_call_incoming` notifications are a special chat route, even when the call happens inside a task-linked discussion channel. The backend title should name the caller, the message should name the channel or conversation, and the payload should include these `actionData` fields:

- `channelId`
- `channelType`
- `channelName`
- `callId`
- `invitationId`
- `senderEmployeeId`
- `senderName`
- `alreadyInAnotherCall`

The `NavigationTarget` must use domain `chat`, resource type `channel`, the chat channel ID as `resourceId`, the invitation ID as `secondaryId`, and action `join_voice_call`. Mobile notification routing should resolve this notification type explicitly to the chat channel and should fall back to Alerts home when route-critical channel data is missing.

## Mobile Live Rules

### Channel messages

- Suppress exact duplicate delivery events with a short cache window.
- Suppress repeated spam when the same sender posts the same normalized body in the same channel inside a short window.
- For busy channels, group non-DM traffic into a 3 to 5 second burst and surface sender-aware copy such as `Joe, Tom, Alice +4 are talking in #ops`.

### Direct messages

- If the user is already inside the same DM, suppress the popup.
- Otherwise, show the first incoming DM immediately.
- If more DM messages arrive in a short burst, switch to grouped copy for follow-up notifications.
- Apply the same spam suppression rule for repeated identical content from the same sender.

### Threads and replies

- If the user is actively viewing the same thread, suppress the popup.
- If the user is in the parent channel but not the thread, surface lighter thread copy.
- Group rapid replies by `parentMessageId` so followed threads do not create one popup per reply.

## Why This Exists

The backend routing layer decides who receives each notification, but mobile needs richer payload metadata to make context-aware foreground decisions. The goal is to keep live chat notifications noticeable without making high-volume channels unusable.