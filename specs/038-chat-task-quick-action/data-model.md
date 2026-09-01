# Phase 1 Data Model: Create a Task from a Chat Message

One migration: `backend/database/migrations/20260901000001_task_from_chat_message.up.sql`.
After applying it, regenerate the snapshot with `backend/scripts/regen-schema.sh` — never
hand-edit `backend/database/scripts/schema.sql`.

Three changes: two columns on an existing table, one new table, one widened CHECK constraint
in another schema.

---

## 1. `collaboration.task` — origin columns

| Column | Type | Null | Meaning |
|---|---|---|---|
| `source_channel_id` | `uuid` | yes | Chat channel the originating message was posted in |
| `source_message_id` | `uuid` | yes | The message this task was created from |

Both are `NULL` for every task not created from a message, which is every task that exists
today and every task created through the ordinary task form.

**Constraints**

- `CHECK ((source_channel_id IS NULL) = (source_message_id IS NULL))` — an origin is both
  halves or neither. A channel without a message could not render the excerpt FR-020 requires.
- `FOREIGN KEY (organization_id, source_channel_id) REFERENCES chat.channel(organization_id, id) ON DELETE SET NULL`
- `FOREIGN KEY (organization_id, source_message_id) REFERENCES chat.message(organization_id, id) ON DELETE SET NULL`

Both foreign keys lead with `organization_id` and reference composite keys, as constitution
principle I requires; `chat.channel` and `chat.message` both have `PRIMARY KEY (organization_id, id)`.
`fk_task_channel` on the same table is the existing precedent for a composite cross-schema
reference from collaboration into chat.

`ON DELETE SET NULL` matters only for a hard delete. Message deletion in this system is a
*soft* delete — `is_deleted` is set and placeholder text is preserved — so FR-023's
"source message is unavailable" state is read from `is_deleted`, with the row and the foreign
key still intact.

**Index**

```
CREATE INDEX IF NOT EXISTS idx_task_source_message
    ON collaboration.task (organization_id, source_message_id)
    WHERE source_message_id IS NOT NULL;
```

Partial, because the overwhelming majority of tasks have no origin. This index is what makes
D3's batched reverse lookup cheap; it is the only index this feature adds.

**Deliberately not added**: a uniqueness constraint on `source_message_id`. FR-025 permits a
message to produce more than one task.

---

## 2. `collaboration.channel_task_destination` — the remembered project

One row per channel that has ever had a task created from it.

| Column | Type | Null | Meaning |
|---|---|---|---|
| `organization_id` | `uuid` | no | Tenant |
| `channel_id` | `uuid` | no | Chat channel this default belongs to |
| `project_id` | `uuid` | no | Project new tasks from this channel default to |
| `set_by_employee_id` | `uuid` | no | Who last set it — shown when explaining the default |
| `updated_at` | `timestamptz` | no | `DEFAULT now()` |

- `PRIMARY KEY (organization_id, channel_id)` — leads with `organization_id`, and one channel
  has at most one remembered destination.
- `FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE`
- `FOREIGN KEY (organization_id, channel_id) REFERENCES chat.channel(organization_id, id) ON DELETE CASCADE`
  — the memory is meaningless once the channel is gone.
- `FOREIGN KEY (organization_id, project_id) REFERENCES collaboration.project(organization_id, id) ON DELETE CASCADE`
  — a deleted project leaves no dangling default.
- `FOREIGN KEY (organization_id, set_by_employee_id) REFERENCES organization.employee(organization_id, id)`

There is no `id` column and no UUID v7 primary key: the row is identified by the channel it
describes, and nothing paginates over this table.

**Read path and the cross-schema rule.** Resolving a destination for display joins
`channel_task_destination` to `collaboration.project` for the name and key — same schema, so
no cross-schema join. The `chat.channel` side is only ever a stored value, never a join target.

**Archived or inaccessible destinations are not cleaned up.** FR-018 requires them to be
*treated* as unset at read time, with a reason; deleting the row would lose the setting if the
project were later unarchived. `is_archived` on the project and the caller's project role
decide this on every read.

---

## 3. `chat.message.system_event_type` — one new permitted value

`message_system_event_type_valid` currently admits only the four voice values. It is dropped
and recreated to also admit `task_created_from_message`.

The neighbouring `message_system_event_consistency` CHECK (`message_kind = 'system'` if and
only if `system_event_type IS NOT NULL`) is unchanged and continues to apply.

This is the only change this feature makes to the `chat` schema. It adds a permitted value;
it does not teach chat what a task is.

**Announcement row shape**

| Field | Value |
|---|---|
| `message_kind` | `system` |
| `system_event_type` | `task_created_from_message` |
| `parent_message_id` | the source message — the announcement is a thread reply, not a channel post |
| `author_employee_id` | the converting user (FR-028: attributed to them) |
| `message_text` | a short plain sentence naming the task identifier |
| `metadata` | `{"taskId": "<uuid>", "identifier": "PROJ-12", "title": "..."}` |

`metadata` is readable by every channel member, so it holds only what is safe to show them.
The access-filtered task data behind the chip comes from `ListTasksBySourceMessages`, not
from here.

---

## Cross-stack constant

`task_created_from_message` appears in four places and must match exactly (constitution
principle VIII):

| Layer | Location |
|---|---|
| Database | `message_system_event_type_valid` CHECK |
| Backend | `SystemEventTypeTaskCreatedFromMessage` in `internal/chat/constants.go`, admitted by `IsValidSystemEventType` |
| Shared TS | the system-event union in `frontend/packages/apis/src/chat.ts` |
| Clients | referenced by constant name only — never as a literal, in either app |

Covered by an assertion in `backend/integration/collaboration_constants_test.go`, following
the existing constant-synchronisation test in that file.

---

## Entity relationships

```text
chat.channel ──────┐                    collaboration.project
      │            │                            │
      │            │ (remembered destination)   │
      │            └──> collaboration.channel_task_destination
      │                                          
      │ posted in                                
      ▼                                         
chat.message ──── source_message_id ────> collaboration.task ──> channel_id ──> chat.channel
      ▲                                          │                              (comment thread,
      │                                          │                               created lazily)
      └──── parent_message_id ───────────────────┘
            (the system announcement reply)
```

Every arrow from collaboration into chat is a stored reference or a logic-layer call. No
arrow runs from chat into collaboration.

---

## Validation rules

| Rule | Enforced where | Requirement |
|---|---|---|
| Title non-empty after trimming | Logic layer, before insert | FR-011 |
| Destination project in the same organization as the source message | Logic layer, from auth context — never from the request | FR-013 |
| Caller is not a `viewer` on the destination project | `GetProjectMemberRole` in `CreateTask`, unchanged | FR-012 |
| Caller can read the source channel (member, or channel is public) | Logic layer via chat, before the task is created | FR-002 |
| Source message is not `system` kind and not soft-deleted | Logic layer | FR-002 |
| Created task is `task_kind = 'standard'` with no ritual fields | Structurally — `CreateTaskFromMessageRequest` has no ritual fields to set | FR-005 |
| Destination remembered only when the channel has none | `INSERT … ON CONFLICT DO NOTHING` | FR-015, FR-016 |
| Channel-admin required to change or clear a remembered destination | Logic-layer resource check, above the interceptor's permission check | FR-017 |
| Origin written in the same transaction as the task | Single `txn.WithTxn` in the Connect handler | FR-031 |
