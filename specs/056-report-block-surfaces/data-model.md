# Phase 1 Data Model: Report and Block Wherever User Content Appears

**Feature**: 056-report-block-surfaces | **Date**: 2026-09-12

## Persisted entities: none added, none changed

No migration, no `schema.sql` regeneration, no `sqlc` regeneration, no proto change.
Constitution Principle I does not engage.

The three tables this feature writes to already exist and keep their current
definitions:

| Table | Written by | Change |
|---|---|---|
| `compliance.content_report` | `ReportContent` | none — three of its five accepted `target_kind` values simply become reachable |
| `compliance.block` | `BlockPerson` | none — a second entry point creates the same row |
| — | `UnblockPerson` | none — deletes the same row |

`target_kind IN ('chat_message','direct_message','file','document_comment','call_record')`
is unchanged. `call_record` stays unreachable and stays recorded as such.

## Client-side types

### Widened: `ThreadReply` (mobile thread screen, local interface)

`frontend/apps/mobile/src/app/(app)/(chat)/thread/[messageId].tsx` declares a local
structural subset of the proto `Message`. It omits two fields the proto already
returns and this feature needs:

| Field | Type | Source | Needed by |
|---|---|---|---|
| `authorEmployeeId` | `string` | `rpc.v1.Message.author_employee_id` (field 5) | FR-003 — offer Block only for somebody else's message |
| `messageKind` | `string` (already present) | `rpc.v1.Message.message_kind` | FR-003 — never offer Block on a system row (research R-4) |

No new data is fetched; the fields are already in the responses the screen holds.

### Changed: `getMessageById` return shape (`frontend/packages/apis/src/chat.ts`)

The wrapper currently casts the proto response through unmapped. It must map the
channel the way every other channel-returning wrapper in the file does:

```
{
  message:  Message,                // unchanged, proto shape
  channel:  { id: string; channelType: ChannelType; displayName: string } | null,
  isMember: boolean,
}
```

`channelType` is the `ChannelType` **string union** (`'chat' | 'direct_message' |
'project_ticket_thread' | 'crm_deal_notes' | 'support_ticket'`), produced by the
existing `convertChannelType()` helper in the same file. This is a breaking change to
the wrapper's return type; both existing callers read only `channel.id`, so no caller
needs adapting.

Constitution Principle VIII: `ChannelType` is the already-synchronised union — SQL
CHECK on `chat.channel.channel_type`, Go constants in `internal/chat/constants.go`,
proto enum `rpc.v1.ChannelType`, TS union in `apis/src/chat.ts`. This change makes
one more call site honour it; it adds no new constant to keep in step.

## Derived client-side state

Nothing below is stored. Each is computed per render from data already on the screen.

| Value | Where | Rule |
|---|---|---|
| `reportTargetKind` (thread) | thread screen | `parentChannel.channelType === 'direct_message' ? 'direct_message' : 'chat_message'` — FR-002 |
| `canBlockAuthor` | thread screen **and** channel screen | `messageKind !== 'system' && !!authorEmployeeId && authorEmployeeId !== auth.employeeId` — FR-003, research R-4 |
| `contactControl` | person profile | `undefined` while `listBlockedPeople` is unresolved; then `'none'` if `entry.isSelf`, `'unblock'` if the entry's `employeeId` is in the blocked list, else `'block'` — FR-005…FR-007 and the "block list not loaded yet" edge case |
| `canReportComment` | web comments panel | `comment.authorEmployeeId !== user.membershipId` — FR-016 |

## Shared query keys

The profile joins the cache the other block surfaces already use, so one
invalidation settles every mounted screen (FR-008):

| Key | Read by | Invalidated by |
|---|---|---|
| `["compliance", "blocked-people"]` | channel screen, blocked-people settings screen, **person profile (new)** | `BlockConfirm.onDone` on every surface that mounts it |

## Subject vocabulary

`ReportSheet` and `ReportContentDialog` both take a `subjectLabel` describing what is
being reported in the person's own words. The complete set after this feature:

| Surface | `targetKind` | `subjectLabel` |
|---|---|---|
| Channel message (mobile), chat message (web) | `chat_message` / `direct_message` | `this message` |
| Thread parent and replies (mobile) | `chat_message` / `direct_message` | `this message` |
| File list row, file detail (mobile); files table (web) | `file` | `this file` |
| Document comment (web) | `document_comment` | `this comment` |

FR-015 and FR-017 are satisfied by this column, not by new code.
