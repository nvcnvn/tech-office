# Feature Specification: Composite Foreign Keys Stop Nulling the Tenant Column

**Feature Branch**: `057-composite-fk-set-null`

**Created**: 2026-09-12

**Status**: Draft

**Input**: User description: "Composite foreign keys stop nulling the tenant column. fk_task_source_message and fk_task_source_channel are declared ON DELETE SET NULL over (organization_id, source_message_id), and Postgres nulls every column in the key, so deleting a chat message or channel a task was created from fails on task.organization_id being NOT NULL. It surfaces today as seed-demo-org refusing to re-run against an existing workspace, which the review notes promise is idempotent; production is shielded only because message deletion is soft. Postgres 15 takes a column list: ON DELETE SET NULL (source_message_id)."

## Why this exists

Constitution principle I requires every foreign key out of a tenant table to lead with
`organization_id`, so `collaboration.task` points at its originating chat message through
the composite key `(organization_id, source_message_id)`. Feature 038 declared that key
`ON DELETE SET NULL`, intending "when the message goes, forget which message it was."

PostgreSQL's plain `SET NULL` nulls **every** column of the referencing key, not just the
one that points at the vanished row. So the action it actually performs is "set
`organization_id = NULL` and `source_message_id = NULL`", and `task.organization_id` is
`NOT NULL`. The delete does not quietly do the wrong thing — it fails outright. The same
is true of `fk_task_source_channel`.

The combination that produced this is specific to a multi-tenant schema: a tenancy rule
that forces the key to be composite, plus a referential action that predates the column
list PostgreSQL 15 added for exactly this case. These are the only two `ON DELETE SET NULL`
constraints in the entire schema, so the blast radius is small — but it is also the reason
nothing has caught it, and nothing today stops a third one being written the same way.

### What it breaks today

| Path | Hard-deletes a message or channel? | Blocked today |
|---|---|---|
| `seed-demo-org` refreshing the demo conversation | yes, `DELETE FROM chat.message` | yes, once a reviewer has converted a message to a task |
| Message deletion in the product | no — soft delete, `is_deleted` is set | not reachable |
| Channel deletion in the product | no such path exists | not reachable |
| Voice call timeline de-duplication | yes, `DELETE FROM chat.message` for duplicate system rows | not by *this* bug (system messages cannot become tasks), but see FR-005 |

The user-visible symptom is the demo workspace. `docs/compliance/reviewer-notes.md` tells a
store reviewer the seed "is idempotent — run it again before a resubmission and it
refreshes the same workspace." The seed clears the demo conversation before rewriting it,
and `backend/cmd/seed_demo.go` already orders its work around this constraint with a
comment describing the exact failure. The ordering buys nothing once a reviewer has used
the fixture the way it invites them to: convert the deliberately rude message into a task
via the chat quick action, and the next seed run fails. The promise in the notes is
currently false for any workspace anyone has actually reviewed.

### Two things the one-line fix does not cover

**The consistency CHECK fires next.** `task_source_message_consistency` asserts
`(source_channel_id IS NULL) = (source_message_id IS NULL)`. A column list on
`fk_task_source_message` may only name columns of *that* key, so a message delete nulls
`source_message_id` and leaves `source_channel_id` set — which the CHECK rejects. Whatever
replaces the constraint has to let the two columns diverge in this one direction, or the
delete still fails, just with a different error. The read path is already tolerant: task
origin resolution treats either half being absent as "no origin", so a task that kept its
channel but lost its message renders as an ordinary task with no origin chip.

**Other dependents still block the delete.** `chat.channel_membership.last_viewed_message_id`
and `voice.voice_message.message_id` both reference `chat.message` `ON DELETE RESTRICT`.
A reviewer who merely *reads* the demo channel sets a last-viewed pointer, and the seed's
`DELETE FROM chat.message` fails on that even after the composite-key fix lands. Fixing
only the two `SET NULL` keys would move the seed's error message without making the seed
re-runnable, so the promise in the reviewer notes stays false. The requirement is stated at
the constraint level rather than in the seed, because the voice-call de-duplication path
deletes messages in production and is exposed to the same `RESTRICT`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A message a task was made from can be deleted (Priority: P1)

Somebody converts a chat message into a task, and later that message is deleted for real —
not soft-deleted. The delete succeeds. The task survives, still belongs to its
organization, still carries its title, identifier, project and state, and simply no longer
claims an origin it cannot show.

**Why this priority**: This is the defect. Every other item here follows from it, and it is
the one that leaves the database in a state where a legitimate delete is impossible rather
than merely inconvenient.

**Independent Test**: Create a task from a message, hard-delete that message, assert the
delete returns without error and the task row is intact with a non-null `organization_id`.
Fully testable with nothing else in this feature built.

**Acceptance Scenarios**:

1. **Given** a task created from a chat message, **When** that message row is deleted,
   **Then** the delete succeeds and the task still exists.
2. **Given** that same task after the delete, **When** it is read back, **Then** its
   organization is unchanged and every other column except the origin is unchanged.
3. **Given** that same task after the delete, **When** it is opened, **Then** it shows no
   origin — not a broken origin, and not an error.
4. **Given** a channel that a task was created from, **When** that channel row is deleted
   (which cascades its messages), **Then** the delete succeeds and the tasks survive with
   their organization intact and no origin.
5. **Given** a task that never had an origin, **When** any message or channel is deleted,
   **Then** the task is untouched.

---

### User Story 2 - The demo seed re-runs against a workspace a reviewer has used (Priority: P2)

An engineer re-runs `seed-demo-org --subdomain demo` before a store resubmission, against
a workspace where a reviewer has already signed in, read the conversation, converted the
rude message to a task and recorded a voice message. The command succeeds and refreshes
the workspace, exactly as the reviewer notes say it will.

**Why this priority**: It is the promise already published to Apple and Google in
`docs/compliance/reviewer-notes.md`, and it is the only path on which this defect is
reachable today. It is P2 rather than P1 because it depends on Story 1 landing first and
because its remaining blockers are a different constraint.

**Independent Test**: Seed a workspace, exercise it the way a reviewer would (read the
channel, create a task from a message, leave a voice message), re-run the seed, assert it
exits successfully and the conversation matches the fixture rather than containing two
copies of it.

**Acceptance Scenarios**:

1. **Given** a seeded demo workspace where a member has read the channel, **When** the seed
   is re-run, **Then** it succeeds and the channel contains exactly the fixture's messages,
   once.
2. **Given** a seeded demo workspace where a task was created from a demo message, **When**
   the seed is re-run, **Then** it succeeds and the task survives without an origin.
3. **Given** a seeded demo workspace containing a voice message in the demo channel,
   **When** the seed is re-run, **Then** it succeeds.
4. **Given** a workspace that has never been seeded, **When** the seed is run, **Then** it
   behaves exactly as it does today.

---

### User Story 3 - The mistake cannot be written a third time (Priority: P3)

An engineer adds a new foreign key out of a tenant table with `ON DELETE SET NULL` and
omits the column list. The build fails, with a message naming the constraint and what to
write instead.

**Why this priority**: The schema discipline that made this bug possible is permanent —
every tenant foreign key is composite by constitutional rule — so the next `SET NULL` key
has the same trap waiting. The project already enforces the neighbouring rules with
`make lint-tenancy` rather than with process, which is the cheapest place to put this.

**Independent Test**: Add a fixture constraint with a bare `ON DELETE SET NULL` over a
composite tenant key to the linter's test input and assert the linter reports it; add the
column-list form and assert it passes.

**Acceptance Scenarios**:

1. **Given** a composite foreign key on a tenant table declared `ON DELETE SET NULL` with no
   column list, **When** the schema linter runs, **Then** it fails and names the constraint.
2. **Given** the same constraint with a column list that excludes `organization_id`, **When**
   the linter runs, **Then** it passes.
3. **Given** a column list that includes `organization_id`, **When** the linter runs, **Then**
   it fails, because nulling the tenant column is the defect itself.
4. **Given** a single-column foreign key on a global table declared `ON DELETE SET NULL`,
   **When** the linter runs, **Then** it passes.
5. **Given** the schema as it will stand after this feature, **When** the linter runs,
   **Then** it reports no findings.

---

### Edge Cases

- **A channel delete fires two referential actions at once.** Deleting a channel cascades
  its messages and nulls `source_channel_id` in the same statement; the message cascade in
  turn nulls `source_message_id`. The order PostgreSQL applies them in is not guaranteed, so
  whatever replaces the consistency CHECK must hold for every interleaving, including the
  one where the channel is cleared before the message is (FR-002).
- **One message, several tasks.** Feature 038 deliberately permits a message to produce more
  than one task. All of them must survive the delete, not just the first.
- **A task whose origin channel still exists but whose origin message is gone.** This state
  is newly reachable. It must read as "no origin" everywhere — the task detail screen, the
  message-to-task chip lookup, and any export — and must never render a chip pointing at a
  message that is not there.
- **A soft-deleted message is not affected.** Soft delete leaves the row and the keys
  intact, and the existing "source message unavailable" behaviour is read from `is_deleted`.
  Nothing in this feature changes it.
- **The seed running against an organization that is mid-delete or partially seeded.** Out
  of scope; the seed's existing behaviour for a half-built workspace is unchanged.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Hard-deleting a chat message MUST NOT attempt to null `organization_id` on any
  task that references it. The referencing task MUST retain its organization.
- **FR-002**: Hard-deleting a chat message or a chat channel MUST leave every task that
  referenced it in a state that satisfies every constraint on the task table, for every
  order in which the database may apply the referential actions.
- **FR-003**: A task that has lost its origin MUST be indistinguishable, everywhere it is
  read, from a task that never had one. No screen, RPC response or export may show a
  partial or dangling origin.
- **FR-004**: Hard-deleting a chat channel MUST succeed and MUST leave every task created
  from a message in that channel intact apart from its origin.
- **FR-005**: A chat message MUST be hard-deletable without a referential failure from any
  code path, including when a channel member's last-viewed pointer refers to it and when a
  voice recording is attached to it. What happens to those dependents is a design decision
  for the plan; what is required is that the delete completes and no dependent row is left
  pointing at a message that no longer exists.
- **FR-006**: Re-running the demo seed against a workspace that has been signed into, read,
  converted to tasks and recorded into MUST succeed and MUST leave the demo conversation
  holding exactly one copy of the fixture.
- **FR-007**: The schema linter MUST reject a foreign key on a tenant table that declares
  `ON DELETE SET NULL` or `ON DELETE SET DEFAULT` over a composite key without a column list,
  or with a column list that includes `organization_id`, and MUST run as part of the
  existing `make lint-tenancy` target.
- **FR-008**: The generated schema snapshot MUST be regenerated from the migration rather
  than edited, and the domain documentation for tasks MUST be updated to describe what a
  hard delete now does to a task's origin.
- **FR-009**: The comment in the demo seed that explains why work is seeded before content,
  and the ordering it justifies, MUST be revisited: if the constraint it works around no
  longer exists, the comment MUST stop asserting that it does.

### Key Entities

- **Task origin** — the pair of columns on a task recording the channel and message it was
  created from. Today the pair is all-or-nothing. After this feature it may also be
  half-present, which every reader must treat as absent.
- **Referential action** — what the database does to a referencing row when the row it
  points at is deleted. The unit of the defect: the action's *scope* (which columns it
  touches) is what is wrong, not the action itself.
- **Message dependents** — the other rows that point at a chat message: read pointers, voice
  recordings, reactions, threaded replies. Their deletion behaviour collectively determines
  whether a message can be deleted at all.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Deleting a chat message that one or more tasks were created from succeeds
  100% of the time, where today it fails 100% of the time.
- **SC-002**: Every task that referenced a deleted message or channel still exists after the
  delete, with the same organization, title, identifier, project and state it had before.
- **SC-003**: `seed-demo-org` re-run against a workspace that has been fully exercised by a
  reviewer completes successfully and leaves the demo channel with exactly the six fixture
  messages — making the idempotency claim in the published reviewer notes true.
- **SC-004**: The schema contains zero foreign keys whose delete action would null a tenant
  column, and the build fails if one is added.
- **SC-005**: No task anywhere in the product displays an origin referring to content that
  no longer exists.

## Assumptions

- [ASSUMPTION: A task outlives the message it was created from. The alternative — deleting
  the task with the message — was rejected because a task is work somebody committed to,
  not an annotation on a conversation, and because the existing constraint was written as
  `SET NULL` rather than `CASCADE`, which states the original intent plainly.]
- [ASSUMPTION: A task that has lost its origin message may keep its origin channel in
  storage, because a column list on a foreign key can only name columns of that key and
  nulling both would require a trigger. This is invisible to every reader: the origin
  resolution path in `task_from_message_logic.go` already treats either half being absent
  as "no origin". The alternative — a trigger that clears both — was rejected as more
  machinery than the observable difference justifies. FR-003 is what makes this safe, and
  the plan may still choose the trigger if FR-002's ordering analysis demands it.]
- [ASSUMPTION: The consistency CHECK is relaxed rather than dropped. "A message implies a
  channel" preserves what the constraint was actually protecting — that no task claims an
  origin whose excerpt cannot be rendered — while permitting the one direction a delete
  creates. Dropping it entirely was rejected because the write path is not the only thing
  that touches these columns.]
- [ASSUMPTION: Backward compatibility is not a concern. Per the project's early-development
  stance, the migration replaces the two constraints and the CHECK outright rather than
  adding parallel ones, and no compensating path is kept for the old behaviour.]
- [ASSUMPTION: The database is PostgreSQL 18 (`backend/docker/postgres.Dockerfile`), so the
  column-list form of `SET NULL` introduced in PostgreSQL 15 is available in development,
  test and production alike. No version gate is needed.]
- [ASSUMPTION: The existing `ON DELETE RESTRICT` on the last-viewed pointer and on voice
  recordings was written when nothing hard-deleted messages, not as a deliberate protection,
  so FR-005 may change it. If the plan finds evidence of intent, it should say so and solve
  FR-006 in the seed instead.]
- [ASSUMPTION: No data migration is needed. No row can currently be in the broken state,
  because the broken state is exactly the one the failing delete prevents from being
  written.]
- Production is not currently affected, because message and channel deletion in the product
  are soft. This is a latent defect that becomes live the first time a hard delete is added,
  plus a live defect in the demo seed.

## Out of Scope

- Changing message or channel deletion in the product from soft to hard.
- Any change to how a task is created from a message, to the message-to-task chip, or to the
  "source message unavailable" behaviour that soft deletion drives.
- Auditing referential actions unrelated to `chat.message` and `chat.channel`. The schema has
  no other `SET NULL` or `SET DEFAULT` foreign keys; FR-007 covers the ones not yet written.
- Retention, purge or right-to-erasure work. Those would need hard deletion and are the
  reason this defect matters beyond the seed, but they are not being built here.
