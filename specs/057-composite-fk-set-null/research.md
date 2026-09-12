# Phase 0 Research: Composite Foreign Keys Stop Nulling the Tenant Column

**Feature**: `057-composite-fk-set-null` | **Date**: 2026-09-12

Every question below was settled by running the real thing — `pg_query_go` for the parse
shapes, the project's own PostgreSQL 18 container (`tech-office-backend-postgres-1`) for
the referential-action behaviour. Nothing here is inferred from documentation.

---

## R1. Does PostgreSQL 18 accept the column-list form, and does `pg_dump` round-trip it?

**Decision**: Use `ON DELETE SET NULL (<column>)` on both constraints. No version gate.

**Rationale**: `backend/docker/postgres.Dockerfile` is `FROM postgres:18-bookworm`, so the
PostgreSQL 15 feature is available everywhere. Verified in the running container that the
form parses, executes, *and* survives a dump:

```
$ pg_dump -U postgres -s -t task
    ADD CONSTRAINT fk_task_src_chan FOREIGN KEY (org_id, src_chan)
        REFERENCES public.chan(org_id, id) ON DELETE SET NULL (src_chan);
```

This last point is load-bearing. `backend/database/scripts/schema.sql` is a `pg_dump`
snapshot and it is what `tenancylint` parses. Had `pg_dump` dropped the column list, the
linter added in FR-007 would have flagged the very constraints this feature fixes
(Story 3, scenario 5). It does not.

**Alternatives considered**: A `BEFORE DELETE` trigger on `chat.message` that clears the
task columns by hand — rejected: it is application logic in the database doing what one
keyword now does, and it would have to be kept in step with every future origin column.

---

## R2. In what order does PostgreSQL apply the two referential actions on a channel delete?

**Decision**: Treat the order as **unavailable to depend on**, because the order that
actually runs is the hostile one.

**Rationale**: Deleting a `chat.channel` row fires `fk_task_source_channel`'s
`SET NULL (source_channel_id)` *and* cascades the channel's messages, whose deletion in
turn fires `fk_task_source_message`'s `SET NULL (source_message_id)`. Reproduced the exact
shape in the PG18 container with a relaxed "a message implies a channel" CHECK in place:

```
ERROR:  new row for relation "task" violates check constraint "task_origin_consistency"
DETAIL:  Failing row contains (1, 1000, null, 100).
CONTEXT:  SQL statement "UPDATE ONLY "public"."task" SET "src_chan" = NULL ..."
```

The channel half is nulled **first**, leaving the intermediate row
`(source_channel_id = NULL, source_message_id = <still set>)`. That is precisely the state
the spec's preferred relaxation forbids. The ordering follows constraint OID order, which
is an artefact of the order the constraints happened to be created in — not a contract.

**Consequence for FR-002**: see R3.

---

## R3. What replaces `task_source_message_consistency`?

**Decision**: **Drop the CHECK and add nothing in its place.** The pairing invariant moves
to the one place that can hold it — the write path — and the read path is made explicitly
tolerant of a half-present origin (R5).

**Rationale**: A row-level CHECK in PostgreSQL is never deferrable; it is evaluated on every
row update, including the intermediate updates a multi-action delete performs. The two
reachable intermediate states are `(channel NULL, message set)` — produced by a channel
delete, per R2 — and `(channel set, message NULL)` — produced by a message delete. Any
CHECK relating the two columns rejects one of them. A constraint that must permit both
states is a constraint that permits everything, so writing it down is worse than dropping
it: it looks like a guarantee and is not one.

Verified the no-CHECK design end to end against PG18 — message-only delete, channel delete,
two tasks from one message, and a task with no origin, all in one transcript:

| scenario | task 1000 | task 1001 | task 1002 (never had an origin) |
|---|---|---|---|
| start | `(10, 100)` | `(10, 100)` | `(NULL, NULL)` |
| after hard-deleting message 100 | `(10, NULL)` | `(10, NULL)` | `(NULL, NULL)` |
| after deleting channel 10 | `(NULL, NULL)` | `(NULL, NULL)` | `(NULL, NULL)` |

`organization_id` is non-null on every row throughout, and no delete errors.

**Alternatives considered**:

- *Relax to "a message implies a channel"* — the spec's stated preference. **Rejected on
  evidence**: R2 shows it fails on the channel-delete path, which is exactly the "ordering
  analysis" escape hatch the spec's own assumption left open ("the plan may still choose
  the trigger if FR-002's ordering analysis demands it").
- *A `DEFERRABLE INITIALLY DEFERRED` constraint trigger asserting the biconditional at
  commit* — **rejected**: it would fire after a plain message delete and reject a state the
  feature exists to permit, so it would have to become a *fixing* trigger that also nulls
  `source_channel_id`. That is a stored procedure maintaining an invariant no reader can
  observe (R5), to protect against a write path that already sets both columns in one
  statement inside one transaction.
- *Collapse the origin to `source_message_id` alone and derive the channel by joining the
  message* — genuinely the cleanest schema, and it would need no CHECK at all. **Rejected
  as out of scope**: the spec explicitly excludes changing how a task is created from a
  message or how the chip is read, and `source_channel_id` is what the partial-index-backed
  chip lookup and the origin block navigate by. Recorded here as the shape a future
  simplification should take.

[ASSUMPTION: dropping the CHECK rather than relaxing it deviates from the spec's third
Assumption. The spec anticipated this ("the plan may still choose the trigger if FR-002's
ordering analysis demands it") and the analysis demands neither relaxation nor a trigger —
it rules out any row-level constraint. The migration carries a comment saying so, so the
next reader does not re-add it.]

---

## R4. How do the other `chat.message` dependents stop blocking a hard delete? (FR-005)

Five foreign keys reference `chat.message`. Three already permit a delete:

| constraint | action today | verdict |
|---|---|---|
| `fk_message_parent` | `CASCADE` | correct — a reply to a deleted message is unreachable |
| `fk_reaction_message` | `CASCADE` | correct |
| `fk_task_source_message` | `SET NULL` | the defect; fixed by R1 |
| `fk_channel_membership_last_viewed_message` | `RESTRICT` | change to `SET NULL (last_viewed_message_id)` |
| `fk_voice_message_message` | `RESTRICT` | change to `CASCADE` |

**Decision for the last-viewed pointer**: `ON DELETE SET NULL (last_viewed_message_id)`.

**Rationale**: The column is already nullable, no CHECK mentions it, and — decisively —
**nothing reads it**. The unread badge is computed from the *timestamp*, not the pointer:

```sql
-- chat.query.sql:756  Calculate unread message count for channel sidebar badges.
  AND (cm.last_viewed_at IS NULL OR m.updated_at > cm.last_viewed_at)
```

`last_viewed_message_id` is written by `UpdateChannelMembershipLastViewed` and selected by
`GetChannelMembership`, and no logic branches on it. Nulling it is therefore free: no badge
changes, no scroll position moves, no member sees anything.

**Decision for the voice recording**: `ON DELETE CASCADE`.

**Rationale**: `SET NULL` is not available — `voice_message_posted_requires_assets` asserts
`status <> 'posted' OR message_id IS NOT NULL`, so nulling the column on a posted recording
trades one referential failure for a CHECK failure. A `voice.voice_message` row exists to
be rendered inside its chat message; once the message is gone the row is unreachable by
every read path. Nothing references `voice.voice_message` in turn, so the cascade
terminates immediately.

**Residual**: the cascade leaves the recording's `files.file_metadata` row behind
(`fk_voice_message_file` is `RESTRICT` in the *other* direction, so it blocks nothing). That
is an orphaned storage row, not a failure, and it is the pre-existing shape of file
lifetime in this system rather than something this feature introduces. Out of scope; noted
so it is not mistaken for a regression.

**On the spec's "was the RESTRICT deliberate?" question**: no evidence of intent was found —
neither constraint carries a comment, and the voice-call timeline **already hard-deletes
messages in production**. `backend/internal/chat/logic.go:3553` runs
`DELETE FROM chat.message ... AND id <> $4` to de-duplicate voice-call system rows. A member
who has read such a row has a `last_viewed_message_id` pointing at it, and that delete fails
today. So the `RESTRICT` on the last-viewed pointer is not a latent problem: it is a live
production bug on the voice path, independent of the composite-key defect, and FR-005 fixes
it. This is the strongest argument for solving FR-005 at the constraint level rather than in
the seed.

---

## R5. What does a half-present origin look like to a reader? (FR-003, SC-005)

**Decision**: One guard in `taskToProto`; no client change.

**Rationale**: Traced all four readers of the origin columns.

- `GetTaskOrigin` (`task_from_message_logic.go:314`) already returns `HasOrigin: false`
  when *either* half is absent. Correct as written.
- `ListTasksBySourceMessages` (`:276`) skips rows whose `SourceMessageID` is invalid, and
  the query is backed by the partial index `WHERE source_message_id IS NOT NULL`, so a task
  that lost its message cannot produce a chip. Correct as written.
- Both clients gate the origin block on `sourceMessageId` alone —
  `frontend/apps/web/.../tasks/[taskId]/page.tsx:1041` and
  `frontend/apps/mobile/.../task/[taskId].tsx:1848` pass `sourceMessageId` and render
  nothing without it. No frontend change is required.
- `taskToProto` (`task_logic.go:956`) is the gap. It copies each column independently,
  under a comment that says *"The table's CHECK guarantees both halves are set together"* —
  a comment this feature makes false. After a message delete it would emit a `Task` with
  `source_channel_id` set and `source_message_id` absent.

So FR-003 costs one guard: emit both fields or neither, and replace the comment with the
reason. It is defence in depth rather than a user-visible fix today, but it is the single
place where "half-present in storage, absent to every reader" is actually established, and
leaving it would make SC-005 true only by the accident of how the clients happen to gate.

---

## R6. How does the linter learn this rule? (FR-007)

**Decision**: Extend `backend/tools/tenancylint` with a `set-null-tenant-column` schema
rule. Confirmed the parse shape by running `pg_query_go/v6` over both forms:

```jsonc
// ON DELETE SET NULL                    → no fk_del_set_cols key at all
{"contype":"CONSTR_FOREIGN","conname":"fk_a","fk_attrs":[...],"fk_del_action":"n"}
// ON DELETE SET NULL (source_message_id) → fk_del_set_cols present
{"contype":"CONSTR_FOREIGN","conname":"fk_b","fk_attrs":[...],"fk_del_action":"n",
 "fk_del_set_cols":[{"String":{"sval":"source_message_id"}}]}
// ON DELETE CASCADE                      → fk_del_action":"c"
```

So the rule is three field reads: `fk_del_action` in `{"n","d"}` (SET NULL, SET DEFAULT),
`len(fk_attrs) > 1`, and `fk_del_set_cols` either missing or containing `organization_id`.

**Rationale**: The linter already parses `schema.sql` with the real PostgreSQL parser and
already classifies tenant tables by the presence of an `organization_id` column, so there
is no new machinery and no allowlist. It runs in `make lint-tenancy`, which the constitution
already names as the machine check for exactly this family of rule. This matches how the
project prefers to enforce schema properties — a linter rather than process.

**Scope**: delete actions only, matching FR-007. `ON UPDATE SET NULL` has the identical
defect but is unreachable here: the referenced keys are `(organization_id, id)` UUID v7
primary keys and nothing updates them. Left out deliberately rather than overlooked.

**Testability**: `loadSchema` currently reads a file and parses it in one function. Splitting
the parse half into `collectSchema(src string)` lets `main_test.go` feed DDL strings
directly, which is what Story 3's five acceptance scenarios need. That is the only
refactor; no existing behaviour moves.

---

## R7. Does the demo seed need code changes? (FR-006, FR-009)

**Decision**: The seed needs **no logic change** — only the comment at
`backend/cmd/seed_demo.go:187` must stop asserting a constraint that no longer exists.

**Rationale**: The seed's `DELETE FROM chat.message WHERE organization_id = $1 AND
channel_id = $2` (`:488`) is blocked today by three things, and R1/R4 remove all three. The
work-before-content ordering the comment justifies is still *harmless* — demo tasks are
deleted before demo messages either way — but the reason given for it becomes false, and a
comment describing a fixed bug as a live one is how the bug gets re-introduced. FR-009 asks
for exactly this, so the comment is rewritten to say the ordering is now incidental.

**Alternatives considered**: solving FR-006 inside the seed by clearing the dependent rows
before deleting messages. **Rejected**: it fixes one caller of a broken delete and leaves the
voice-call de-duplication path (R4) still broken in production. The constraint-level fix is
both the smaller diff and the root-cause fix.

---

## R8. Is a data migration needed?

**Decision**: No.

**Rationale**: The only states the new constraints make reachable are ones the old
constraints made *impossible to write* — the delete failed rather than half-completing. No
existing row can be in the new state. The migration is pure DDL: three constraints replaced,
two re-aimed, one CHECK dropped.

Per the project's early-development stance the migration replaces constraints outright
rather than adding parallel ones, and the `DROP CONSTRAINT IF EXISTS` / `ADD CONSTRAINT`
pairing matches the idempotent DDL style the constitution requires.
