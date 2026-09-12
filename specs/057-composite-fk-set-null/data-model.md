# Phase 1 Data Model: Composite Foreign Keys Stop Nulling the Tenant Column

**Feature**: `057-composite-fk-set-null` | **Date**: 2026-09-12

No table is created, dropped, or gains a column. This feature changes **what the database
does to existing rows when a row they point at is deleted**. The entities below are the
constraints themselves.

---

## Entity: task origin (`collaboration.task.source_channel_id`, `source_message_id`)

Two nullable `uuid` columns added by feature 038. Unchanged in shape.

**What changes is the set of legal states.**

| state | before | after | means |
|---|---|---|---|
| `(NULL, NULL)` | legal | legal | task was not created from a message |
| `(channel, message)` | legal | legal | task carries an origin |
| `(channel, NULL)` | rejected by CHECK | **legal** | origin message was hard-deleted |
| `(NULL, message)` | rejected by CHECK | **legal**, transiently | mid-statement, during a channel delete |
| `(NULL, NULL)` after a channel delete | unreachable (delete failed) | **legal** | origin channel was deleted |

Rows 3 and 4 are the new states. Row 4 exists only *inside* a single `DELETE` statement —
PostgreSQL nulls the channel half before the message cascade reaches the task (research R2)
— but a row-level CHECK sees it, which is why no CHECK survives.

**Invariant, restated where it can actually hold**: an origin is written as a pair, in one
statement, inside the conversion transaction. It is *read* as present only when both halves
are present. Storage is permitted to hold half of it after a delete; no reader may act on
that half.

### Constraint changes

| constraint | before | after |
|---|---|---|
| `fk_task_source_message` | `FK (organization_id, source_message_id) → chat.message(organization_id, id) ON DELETE SET NULL` | `… ON DELETE SET NULL (source_message_id)` |
| `fk_task_source_channel` | `FK (organization_id, source_channel_id) → chat.channel(organization_id, id) ON DELETE SET NULL` | `… ON DELETE SET NULL (source_channel_id)` |
| `task_source_message_consistency` | `CHECK ((source_channel_id IS NULL) = (source_message_id IS NULL))` | **dropped** |

`idx_task_source_message` — the partial index `WHERE source_message_id IS NOT NULL` backing
the chip lookup — is unchanged, and is what keeps a task that lost its message out of the
chip query for free.

`fk_task_channel` (`collaboration.task.channel_id → chat.channel ON DELETE RESTRICT`) is a
**different column** — the task's own comment thread, not its origin — and is deliberately
untouched. It will still block deleting a channel that hosts a task thread, which is
correct and is not what Story 1 scenario 4 is about.

---

## Entity: message dependents (everything pointing at `chat.message`)

A message is hard-deletable only if every one of these permits it.

| constraint | table.column | before | after | why |
|---|---|---|---|---|
| `fk_message_parent` | `chat.message.parent_message_id` | `CASCADE` | unchanged | a reply to a deleted message is unreachable |
| `fk_reaction_message` | `chat.reaction.message_id` | `CASCADE` | unchanged | |
| `fk_task_source_message` | `collaboration.task.source_message_id` | `SET NULL` | `SET NULL (source_message_id)` | the defect |
| `fk_channel_membership_last_viewed_message` | `chat.channel_membership.last_viewed_message_id` | `RESTRICT` | `SET NULL (last_viewed_message_id)` | nothing reads the column; unread is computed from `last_viewed_at` |
| `fk_voice_message_message` | `voice.voice_message.message_id` | `RESTRICT` | `CASCADE` | `SET NULL` is barred by `voice_message_posted_requires_assets`; the row is unreachable without its message |

After this set, the transitive closure of a `DELETE FROM chat.message` is: the message, its
replies, their reactions and voice rows, its own reactions, its voice row. Nothing
references `voice.voice_message`, so the cascade terminates there.

**Not changed, and deliberately**: `voice.voice_message.file_id → files.file_metadata
ON DELETE RESTRICT`. It points the other way and blocks nothing. Cascading a voice row
leaves its `file_metadata` row orphaned — a storage row with no reader, not a constraint
failure. File lifetime is out of scope for this feature.

---

## Entity: the linter's view of a foreign key

New, internal to `backend/tools/tenancylint`. `tableInfo` gains a list of foreign keys
collected from the same parse that already collects unique keys.

```go
type fkInfo struct {
    name      string   // conname
    attrs     []string // fk_attrs — the referencing columns
    delAction string   // fk_del_action: "a" no action, "r" restrict, "c" cascade,
                       //                "n" set null, "d" set default
    delSetCols []string // fk_del_set_cols — empty when no column list was written
}
```

**Rule `set-null-tenant-column`** — evaluated only for tables the linter already classifies
as tenant tables (those with an `organization_id` column). A finding is reported when:

```
delAction ∈ {"n", "d"}  AND  len(attrs) > 1  AND
    ( len(delSetCols) == 0  OR  "organization_id" ∈ delSetCols )
```

Read as prose: *a composite foreign key on a tenant table may not null the whole key, and
may not name the tenant column in the columns it does null.*

| input | verdict |
|---|---|
| composite `SET NULL`, no column list | finding — nulls `organization_id`, which is `NOT NULL` |
| composite `SET NULL (source_message_id)` | clean |
| composite `SET NULL (organization_id, source_message_id)` | finding — nulling the tenant column is the defect itself |
| single-column `SET NULL` on a global table | clean — table is not a tenant table |
| single-column `SET NULL` on a tenant table | clean — not composite, so no tenant column to null |
| `CASCADE` / `RESTRICT` / `NO ACTION`, any shape | clean — out of the rule's scope |

`SET DEFAULT` is included because its failure mode is identical: the tenant column has no
default, so it would be set to `NULL` against a `NOT NULL` column. There are none in the
schema today; the rule exists so there are none tomorrow.

`ON UPDATE SET NULL` is **not** covered. Same defect in principle, unreachable in practice:
the referenced keys are UUID v7 primary keys and nothing updates them.
