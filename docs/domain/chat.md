# Chat

Channels, messages, threads, reactions, presence-aware typing, and the per-user sidebar.
Owned by `internal/chat`; contracts in `rpc/v1/chat.proto` (`ChatService`, 39 RPCs) and
`rpc/v1/chat_files.proto` (`ChatFileService`, 2 RPCs).

**Status date: 2026-09-02.** Supersedes specs 009, 010, 027.

## Channels

`chat.channel` — `title_slug` (unique per org, `^[a-z0-9-]+$`, ≤64 chars), `display_name`,
`description`, `is_private`, `is_archived`.

`channel_type` is the important field, because chat is reused as the comment substrate for
other domains:

| Type | Created by | Purpose |
|---|---|---|
| `chat` | users | ordinary channel |
| `direct_message` | `CreateOrGetDirectMessage` | 1:1 DM |
| `project_ticket_thread` | collaboration, when a task is first opened | task comment thread |
| `crm_deal_notes` | — | reserved |
| `support_ticket` | — | reserved |

That reuse is why `collaboration.task.channel_id` FKs into `chat.channel`, and why chat
notifications need `sourceDomain` to distinguish a real chat message from a task comment.
A task's thread is created lazily, the first time somebody opens the task, so a task nobody
opens never creates a channel nobody reads — see [rituals-tasks.md](rituals-tasks.md).

`chat.channel_membership` holds `is_admin`, `notification_preference`
(`all | mentions | muted`), and the unread cursor (`last_viewed_message_id`,
`last_viewed_at`). Unread state is per-member cursor, not a counter — `MarkChannelAsRead`
advances the cursor and `GetUnreadCount` derives from it.

## Messages

`chat.message` stores **sanitised HTML** in `message_text` — allowed tags are `<b>`,
`<strong>`, `<i>`, `<em>`, `<u>`, `<code>`, `<pre>`, `<a>`, `<ul>`, `<ol>`, `<li>`, `<p>`,
`<br>`. Plaintext is valid HTML, so there is no separate plaintext path.

- **Threading is exactly one level.** `parent_message_id` points at a top-level message; a
  reply cannot itself be replied to.
- `is_deleted` is a soft delete (placeholder text preserved); `is_edited` plus
  `edit_history` (JSONB array of `{edited_at, previous_text}`) keeps the trail.
- `mentions` is a JSONB array of `{type: "employee"|"department", id, label}` — department
  mentions fan out to every member.
- `file_ids uuid[]` references `files.file_metadata`.
- `message_kind IN ('text','voice','system')`. System messages carry
  `system_event_type IN ('voice_call_started','voice_call_ended','voice_call_missed','voice_call_cancelled','task_created_from_message')`,
  and a CHECK enforces that `system` ⇔ `system_event_type IS NOT NULL`. This is how a
  voice call leaves a trace in the channel timeline — see [voice.md](voice.md) — and how a
  conversion into a task leaves one on the message it came from, below.

Pagination uses the UUID v7 message ID as the cursor: v7 embeds a millisecond timestamp in
its first 48 bits, so `ORDER BY id DESC` is chronological and the index
`(organization_id, channel_id, id DESC)` serves it directly. `ListMessages` takes a
`ListMessagesDirection` so a client can page in either direction from an anchor —
which is what deep-linking to a specific message needs.

## Direct conversations and the block guard

`CreateOrGetDirectMessage` finds or creates the `direct_message` channel between two
employees. Since spec 036 it applies a **contact guard** before doing either: if either
person has blocked the other, it refuses with `FAILED_PRECONDITION` and a message that
names neither party and does not say a block exists — the blocked person must never learn
they were blocked.

The guard is one of exactly two chokepoints where a block is enforced (the other is voice
call initiation, see [voice.md](voice.md)); it is deliberately **not** a filter on message
reads. Blocking is scoped to direct contact, so a blocked colleague's messages in a shared
channel stay visible. Hiding them would let somebody silently conceal work instructions
addressed to them, and would corrupt the per-member unread cursor, which advances past
messages a filter would have removed from the page.

`chat` declares its own `ContactGuard` interface, satisfied structurally by
`compliance.Logic` and wired in `cmd/server.go`, so `internal/chat` has no dependency on
`internal/compliance`. `DirectMessageCounterpart` exists on `ChatLogic` for the same
reason in reverse: voice needs the other participant of a direct conversation without
reading chat's tables.

`GetMessage` is also what the compliance domain calls to resolve a reported message's
author and snapshot — see [compliance-safety.md](compliance-safety.md) — and what
collaboration calls to render the origin block on a task created from a message.

## The task-conversion announcement

`AnnounceTaskCreatedFromMessage` on `ChatLogic` writes one `chat.message` row recording
that a message was turned into a task:

| Field | Value |
|---|---|
| `message_kind` | `system` |
| `system_event_type` | `task_created_from_message` |
| `parent_message_id` | the source message — a thread reply, not a channel post |
| `author_employee_id` | the person who converted |
| `metadata` | `{"taskId", "identifier", "title"}` |

It is called only by `internal/collaboration`, on that caller's transaction, so the
announcement commits with the task or not at all. No client can call it: chat's RPC surface
is unchanged.

**It notifies nobody.** It writes the row directly and does not call `broadcastNewMessage`
or `notifyMentionedUsersV2`, which is why `SendMessage` could not be reused — that always
broadcasts. The announcement appears in the thread and produces no reply notification for
the source message's author and no mention notification for anyone. This mirrors how voice
leaves a call record (`createVoiceSystemMessage`).

Chat learns nothing about tasks here. The identifier and title are opaque strings it
stores for rendering, and this metadata is readable by every channel member — which is why
the access-filtered task chip on the source message is served by collaboration rather than
read out of it.

Both clients render this row from its metadata rather than from `message_text`: web shows
the identifier as a link to the task, mobile shows it as a record card. Mobile does not
link, because the metadata carries no project id and every mobile task route is
project-scoped; the chip on the source message does carry one, and that is what navigates
there.

Collaboration also reads chat through `ChatLogic.GetChannel`, for the channel name shown in
a task's origin block and for the channel-administrator check that gates changing a
channel's remembered task destination. Both were already implemented on `chatLogicImpl`;
the interface is satisfied structurally and chat gained nothing for them.

## Reactions and typing

`chat.reaction` is one row per (message, employee, emoji). `AddReaction` / `RemoveReaction`
/ `ListReactions`.

`chat.typing_indicator` is one row per (channel, employee), refreshed as a heartbeat by
`StartTyping` and cleared by `StopTyping`. Typing does **not** create a notification row:
it is published as an *ephemeral signal* at priority 4, routed only to connections whose
`active_channel_id` matches, and never persisted. See
[notifications-presence.md](notifications-presence.md#ephemeral-signals).

## The sidebar (`chat.user_chat_config`)

One row per employee holding the entire sidebar state:

- `channel_categories` — JSONB `{channel_id: "channels"|"direct_messages"|"archived"}`.
  **Presence in this map is what makes a channel visible in the sidebar**; a channel you are
  a member of but which is not in the map does not appear.
- `category_limits` — defaults `{"channels": 30, "direct_messages": 20, "archived": 10}`.
  When a category exceeds its limit, the oldest channels by `updated_at` are dropped from
  `channel_categories` — they remain joined, just not listed.
- `pinned_channel_ids uuid[]` — a subset of the map's keys; pinned entries sort to the top
  of their category in array order.
- `sidebar_category_collapsed` — collapsed state per category.

Ordering within a category is `channel.updated_at DESC`, not stored.

RPCs: `GetUserChatConfig`, `UpdateRecentChannels`, `AddChannelToCategory`,
`UpdateChannelCategories`, `UpdateCategoryLimits`, `UpdatePinnedChannels`,
`UpdateSidebarCategoryCollapsed`, `ListRecentChannels`.

## File attachments

Chat owns its own upload endpoints rather than using the generic `FileService` — a
deliberate security boundary (feature 015):

1. `RequestChannelFileUpload` verifies channel membership **inside the transaction**,
   derives the access scope from the channel's privacy setting (server-side, never from the
   client), calls `FileLogic` directly (an in-process call, not an RPC, to keep the
   dependency Chat → Files and avoid a cycle), and returns a presigned R2 URL.
2. The client PUTs to R2.
3. `ConfirmChannelFileUpload` re-verifies membership (guarding the race), writes the
   `files.file_access_rule` linking file to channel, and triggers the validation and
   post-processing workflows.

Both RPCs require `chat.filesUpload`. See [files.md](files.md).

## Context summary

`GetChannelContextSummary` backs the workspace context rail — the panel that shows what a
channel is *about* (linked task/project, recent activity) alongside the message list. See
[workspace-navigation.md](workspace-navigation.md#context-rail).

## Notifications produced

`internal/chat` publishes through `NotificationService`. Types: `message`, `mention`,
`reply`, plus the ephemeral `typing` and `reaction`. Source domain is `chat`. Per-channel
`notification_preference` (`all | mentions | muted`) filters recipients before routing.

## Client surfaces

- Web: `/workspace/chat` with `components/`, `hooks/`, `utils/`.
- Mobile: `app/(app)/(chat)/` — channel list, `[channelId]`, `thread/[messageId]`,
  `new-channel`, `search`; plus `app/(shared)/resource/chat/` for deep-link
  entry. `search` is the single people-and-channels modal behind the header
  "New Message" action, the empty-state "Start Chat" button and the in-channel
  magnifier; it shares its bar and result rows with global search
  (`components/ui/search-bar.tsx`).
- Clients: `packages/apis/src/chat.ts`, `chat-files.ts`, `chat-reactions.ts`;
  `apps/mobile/src/lib/chat-stream-events.ts` for live event handling.

On mobile, both message lists — the channel and the thread — dismiss the keyboard when
dragged and keep a tap on a message working while it is up. The composer is lifted clear of
the keyboard by an explicit measurement rather than by `KeyboardAvoidingView`'s own: the
Android app draws edge to edge, so its window is never resized for the keyboard and there
is nothing for that component to measure against (`src/hooks/use-keyboard-height.ts`).

## Tests

`integration/chat_messaging_test.go`, `chat_stream_test.go`,
`workflow_chat_files_test.go`, `notification_chat_acknowledgement_test.go`,
`context_rail_test.go`.

## Known drift

None specific to chat. Two adjacent items land here:

- The mobile route resolver recognises chat notification types the backend cannot emit —
  see [D7](notifications-presence.md#known-drift).
- `crm_deal_notes` and `support_ticket` channel types are reserved in the CHECK constraint
  and the proto enum but nothing creates them; the `crm` and `support` schemas are empty.
