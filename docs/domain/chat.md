# Chat

Channels, messages, threads, reactions, presence-aware typing, and the per-user sidebar.
Owned by `internal/chat`; contracts in `rpc/v1/chat.proto` (`ChatService`, 39 RPCs) and
`rpc/v1/chat_files.proto` (`ChatFileService`, 2 RPCs).

**Status date: 2026-08-22.** Supersedes specs 009, 010, 027.

## Channels

`chat.channel` — `title_slug` (unique per org, `^[a-z0-9-]+$`, ≤64 chars), `display_name`,
`description`, `is_private`, `is_archived`.

`channel_type` is the important field, because chat is reused as the comment substrate for
other domains:

| Type | Created by | Purpose |
|---|---|---|
| `chat` | users | ordinary channel |
| `direct_message` | `CreateOrGetDirectMessage` | 1:1 DM |
| `project_ticket_thread` | collaboration, on task creation | task comment thread |
| `crm_deal_notes` | — | reserved |
| `support_ticket` | — | reserved |

That reuse is why `collaboration.task.channel_id` FKs into `chat.channel`, and why chat
notifications need `sourceDomain` to distinguish a real chat message from a task comment.

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
  `system_event_type IN ('voice_call_started','voice_call_ended','voice_call_missed','voice_call_cancelled')`,
  and a CHECK enforces that `system` ⇔ `system_event_type IS NOT NULL`. This is how a
  voice call leaves a trace in the channel timeline — see [voice.md](voice.md).

Pagination uses the UUID v7 message ID as the cursor: v7 embeds a millisecond timestamp in
its first 48 bits, so `ORDER BY id DESC` is chronological and the index
`(organization_id, channel_id, id DESC)` serves it directly. `ListMessages` takes a
`ListMessagesDirection` so a client can page in either direction from an anchor —
which is what deep-linking to a specific message needs.

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
  `new-channel`, `new-dm`, `search`; plus `app/(shared)/resource/chat/` for deep-link
  entry.
- Clients: `packages/apis/src/chat.ts`, `chat-files.ts`, `chat-reactions.ts`;
  `apps/mobile/src/lib/chat-stream-events.ts` for live event handling.

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
