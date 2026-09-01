# Contract: `internal/chat` delta

Chat's public RPC surface does not change. This feature adds one logic-layer method, one
constant, and one rendering case. `internal/chat` gains no import of `internal/collaboration`
and no knowledge of tasks, projects, or the origin link.

---

## 1. `ChatLogic` interface widened (collaboration side)

`internal/collaboration/logic.go` currently declares a one-method interface satisfied
structurally by `chat`:

```go
type ChatLogic interface {
    CreateChannel(ctx context.Context, tx database.DBTX, orgID, creatorID dbuuid.UUID, req *rpcv1.CreateChannelRequest) (*rpcv1.Channel, error)
}
```

It gains two methods:

```go
type ChatLogic interface {
    CreateChannel(...) (*rpcv1.Channel, error)

    // GetMessage resolves the origin excerpt and author for GetTaskOrigin.
    // Already implemented on chatLogicImpl and already used this way by internal/compliance.
    GetMessage(ctx context.Context, tx database.DBTX, orgID, employeeID, messageID dbuuid.UUID) (*rpcv1.Message, error)

    // AnnounceTaskCreatedFromMessage posts the threaded, non-notifying system reply. New.
    AnnounceTaskCreatedFromMessage(ctx context.Context, tx database.DBTX, orgID, actorID, channelID, sourceMessageID, taskID dbuuid.UUID, identifier, title string) (dbuuid.UUID, error)
}
```

`GetMessage` already exists on `chatLogicImpl` with exactly this signature, so widening the
interface requires no change in `chat` and no change in `cmd/server.go` wiring — the existing
value continues to satisfy it structurally.

---

## 2. New: `AnnounceTaskCreatedFromMessage`

Modelled directly on `createVoiceSystemMessage` in `internal/chat/logic.go`, which is how
voice leaves a call record in a channel timeline without notifying anyone.

Inserts one row into `chat.message`:

| Field | Value |
|---|---|
| `message_kind` | `system` |
| `system_event_type` | `task_created_from_message` |
| `parent_message_id` | `sourceMessageID` — a thread reply, not a channel post |
| `author_employee_id` | `actorID`, the converting user (FR-028) |
| `message_text` | a short plain sentence naming the identifier |
| `metadata` | `{"taskId": …, "identifier": …, "title": …}` |
| `mentions` | `'[]'` |

**It MUST NOT call** `broadcastNewMessage` or `notifyMentionedUsersV2`. That omission is the
whole of FR-028a: the announcement appears in the thread but generates no reply or mention
notification. `SendMessage` cannot be reused for this reason — it always broadcasts.

Runs on the caller's transaction, so the announcement commits with the task (FR-031).

Returns the new message id, surfaced as `CreateTaskFromMessageResponse.announcement_message_id`
so a client can scroll to it or assert on it in a test.

---

## 3. New constant

`internal/chat/constants.go`:

```go
SystemEventTypeTaskCreatedFromMessage = "task_created_from_message"
```

added to the `IsValidSystemEventType` switch alongside the four voice values.

Must match the widened `message_system_event_type_valid` CHECK and the system-event union in
`frontend/packages/apis/src/chat.ts` exactly. Per constitution principle VIII this value is referenced by constant name
everywhere — never as a literal — and the match is asserted in
`backend/integration/collaboration_constants_test.go`.

---

## 4. Client rendering

Both apps already branch on `messageKind === 'system'` to render voice call records. They
gain one case for `task_created_from_message`, rendering the metadata's identifier and title
as a link to the task.

This is presentation only. The **chip** on the source message is a separate thing and is not
rendered from this metadata — chat metadata is visible to every channel member, and FR-021
requires the chip to be hidden from anyone without access to the task. The chip's data comes
from `CollaborationService.ListTasksBySourceMessages`, which filters server-side.

---

## What is deliberately unchanged

- No new `ChatService` RPC. The announcement is written by collaboration through the logic
  layer, never called by a client.
- No change to `SendMessage`, `ReplyToMessage`, or the notification path.
- No `default_project_id` on `chat.channel`. The remembered destination lives in
  `collaboration.channel_task_destination` — see D4 in [research.md](../research.md).
- No chat query joins `collaboration`. Chat cannot answer "did this message become a task";
  the client asks collaboration.
