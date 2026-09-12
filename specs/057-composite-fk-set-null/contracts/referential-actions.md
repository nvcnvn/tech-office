# Contract: referential actions on `chat.message` and `chat.channel`

**Feature**: `057-composite-fk-set-null`

This feature adds no RPC, no proto field and no query. Its interface is the **database's
promise about what a delete does** — consumed by every writer of a `DELETE` against
`chat.message` or `chat.channel`, and by the linter that enforces the shape.

Two contracts are stated here: the referential one (what the schema guarantees) and the
linter one (what the build rejects). The proto surface is included only to record that it
is unchanged.

---

## 1. Delete contract: `chat.message`

> **Hard-deleting a `chat.message` row succeeds unconditionally.**

No constraint referencing `chat.message` may be `RESTRICT` or `NO ACTION`. Callers —
today `backend/cmd/seed_demo.go:488` and the voice-call timeline de-duplication at
`backend/internal/chat/logic.go:3553` — may issue the delete without first clearing
dependents.

What happens to each dependent:

| dependent | effect |
|---|---|
| `chat.message.parent_message_id` (replies) | deleted, recursively |
| `chat.reaction.message_id` | deleted |
| `voice.voice_message.message_id` | deleted |
| `chat.channel_membership.last_viewed_message_id` | set to `NULL`; `last_viewed_at` untouched, so no unread badge changes |
| `collaboration.task.source_message_id` | set to `NULL`; **`organization_id` untouched** |

Postconditions:

- No row anywhere references the deleted message.
- Every `collaboration.task` that referenced it still exists, with the same
  `organization_id`, `identifier`, `title`, `project_id` and state.
- Soft deletion (`is_deleted = TRUE`) is a different operation and is unaffected. It leaves
  the row and every key intact, and the "source message unavailable" behaviour continues to
  be read from `is_deleted`.

## 2. Delete contract: `chat.channel`

> **Deleting a `chat.channel` row succeeds unless a task's comment thread lives in it.**

The channel's messages cascade, and each message's dependents follow contract 1.
`collaboration.task.source_channel_id` is set to `NULL` — and only that column.

`fk_task_channel` (`collaboration.task.channel_id`, the task's own comment thread) remains
`ON DELETE RESTRICT` and is the one thing that can still block a channel delete. That is
unchanged and intended: a thread is content owned by the task, not a pointer to content.

Postcondition: for every task created from a message in that channel, both origin columns
are `NULL` and every other column is unchanged.

## 3. Read contract: task origin

> **An origin is present only when both halves are present.**

Storage may hold `(source_channel_id set, source_message_id NULL)` after a message delete.
Every reader treats that as *no origin*:

| reader | behaviour |
|---|---|
| `GetTaskOrigin` | returns `has_origin: false` |
| `ListTasksBySourceMessages` | returns no link for the task |
| `Task` message (`taskToProto`) | emits **neither** `source_channel_id` nor `source_message_id` |

No RPC returns a partial origin. No client renders a chip or origin block for content that
is not there. Proto definitions in `proto/rpc/v1/collaboration.proto` are **unchanged** —
`source_channel_id` and `source_message_id` are already `optional`, and the change is which
combinations are populated.

## 4. Build contract: `make lint-tenancy`

> **A foreign key that would null a tenant column fails the build.**

`backend/tools/tenancylint` reports a `set-null-tenant-column` finding, naming the
constraint and the table, for any foreign key on a tenant table where:

- the delete action is `SET NULL` or `SET DEFAULT`, **and**
- the referencing key has more than one column, **and**
- either no column list was given, or the column list contains `organization_id`.

Exit code 1, consistent with the existing `unique-key` rule. The message must name the
constraint and state the fix, e.g.:

```
database/scripts/schema.sql: collaboration.task: foreign key "fk_task_source_message"
  is ON DELETE SET NULL over a composite key without a column list, so Postgres would
  null organization_id (NOT NULL). Write: ON DELETE SET NULL (source_message_id)
```

The rule reads the generated snapshot `backend/database/scripts/schema.sql`, so it only
sees a new constraint after `backend/scripts/regen-schema.sh` has been run — the same
condition every other schema rule in this linter already carries.
