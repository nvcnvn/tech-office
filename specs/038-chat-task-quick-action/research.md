# Phase 0 Research: Create a Task from a Chat Message

The spec left no `NEEDS CLARIFICATION` markers — the three open UX questions were resolved
with the requester before planning began. What follows are the technical decisions the
resolved spec forces, each checked against the code as it stands on `main`.

---

## D1 — Collaboration owns the feature; chat learns nothing about tasks

**Decision**: Every new table, RPC and rule lives in `internal/collaboration`. `internal/chat`
receives exactly one new logic-layer method and no knowledge of tasks, projects or the
origin link.

**Rationale**: The dependency already runs one way. `internal/collaboration/logic.go` declares
a narrow `ChatLogic` interface (currently a single `CreateChannel` method) that `chat`
satisfies structurally, wired in `cmd/server.go`. `CreateTask` calls it to make a task's
comment channel. A chat→collaboration dependency would close that into a cycle, and
constitution principle IV forbids reaching across the boundary in SQL instead.

The same shape already exists for the block guard: `chat` declares its own `ContactGuard`
interface satisfied by `compliance.Logic`, precisely so `internal/chat` has no import of
`internal/compliance`. This feature follows that established pattern in the direction that
already works.

**Alternatives considered**:
- *Origin link owned by chat, tasks queried by chat*: requires chat→collaboration, a cycle.
- *A third package mediating both*: a new package with one caller, to avoid an edge that does
  not need to exist. Rejected as an abstraction nobody asked for.

---

## D2 — The origin is two nullable columns on `collaboration.task`

**Decision**: `source_channel_id` and `source_message_id` on `collaboration.task`, both
nullable, constrained to be set or unset together, with composite foreign keys into
`chat.channel(organization_id, id)` and `chat.message(organization_id, id)`.

**Rationale**: A task has at most one origin (the spec's Key Entities section says so
explicitly), so a join table would model a cardinality that does not exist. The composite
cross-schema foreign key is not novel here — `collaboration.task` already carries
`fk_task_channel FOREIGN KEY (organization_id, channel_id) REFERENCES chat.channel(organization_id, id)`.
Both referenced tables have `PRIMARY KEY (organization_id, id)`, so the constitution's
composite-FK rule is satisfiable directly.

Message deletion is a *soft* delete (`is_deleted`, placeholder text preserved), so FR-023's
"source message unavailable" state is reached by reading `is_deleted`, not by a dangling
reference. `ON DELETE SET NULL` covers only the hard-delete path that channel removal would
cascade into.

**Alternatives considered**:
- *A `collaboration.task_message_origin` join table*: correct but heavier — an extra table,
  an extra join on every task read, for a strictly 1:0..1 relationship.
- *A JSONB `origin` blob on the task*: unindexable for the reverse lookup D3 needs, and it
  would put an unconstrained reference where a foreign key belongs.

---

## D3 — The message chip is resolved by a batched collaboration RPC

**Decision**: `ListTasksBySourceMessages(repeated message_ids)` returns one link per message
the caller may see, including the task's live state. The client calls it once per rendered
page of messages. The chip is **not** rendered from data stored in chat.

**Rationale**: Two requirements make the chat-side alternative wrong rather than merely
different. FR-021 requires the chip to be hidden from viewers who cannot access the task —
that filter has to run server-side in the domain that owns project membership. And the chip
displays current state, which changes long after the message was written, so a value copied
into chat metadata at conversion time would go stale.

Storing the task identifier in the announcement message's metadata would additionally leak
it: every channel member can read a message's metadata, including people with no access to
the destination project.

Batching is a contract-level property, not a client convention: the request takes a repeated
field, so a per-message implementation is visibly wrong in review.

**Alternatives considered**:
- *Derive the chip from the announcement message's metadata*: no live state, and leaks the
  identifier to non-members.
- *One RPC per message*: N+1 on every channel open.
- *Push chips over the existing chat event stream*: couples chat's stream to task state
  changes, which is the cycle D1 exists to avoid.

---

## D4 — The remembered destination lives in collaboration, keyed by channel

**Decision**: A new `collaboration.channel_task_destination` table with
`PRIMARY KEY (organization_id, channel_id)`, holding the project, who set it, and when.

**Rationale**: The value is a *project* — a collaboration concept. Adding
`default_project_id` to `chat.channel` would put collaboration's vocabulary in chat's schema
and force chat to reason about project archival and project access, which is exactly the
knowledge D1 keeps out of it. Keyed by channel id without a join to chat at read time: the
resolution query joins only `channel_task_destination` to `collaboration.project`, both in
the same schema, so no cross-schema join is needed to render the sheet.

Direct messages need no special case. A DM is a channel row like any other, so it gets its
own remembered destination, which is what the spec's edge case asks for.

**Alternatives considered**:
- *A column on `chat.channel`*: cross-domain leakage, and chat would own a value it cannot
  validate.
- *Per-user rather than per-channel memory*: rejected in the spec itself — a user's last
  project is the wrong default the moment they switch channels.
- *No memory at all*: makes the second conversion as expensive as the first, which is the
  cost that stops people using the feature.

---

## D5 — `CreateTaskRequest.level_id` becomes optional

**Decision**: Change `string level_id = 3` to `optional string level_id = 3`. When absent,
`CreateTask` selects the project's shallowest task level.

**Rationale**: The quick sheet exposes four fields and a task level is not among them
(FR-007). Today the field is required, and `task_logic.go` parses it with
`dbuuid.MustParse(req.LevelId)` — an empty string panics the server rather than returning an
error. Forcing the client to fetch the project's levels before it can open a sheet adds a
round trip to the interaction the whole feature exists to shorten.

Making the field optional keeps every existing caller compiling and passing its explicit
level; the default only fires where nothing was chosen. The project's shallowest level is
already the level a task without a parent belongs at — `CreateTask` validates that a child's
level is deeper than its parent's — so this is the existing rule made into the default
rather than a new policy.

The change is breaking at the contract level and ships atomically across backend, web and
mobile, which is how constitution principle VI is satisfied in this repository.

**Alternatives considered**:
- *Keep `level_id` required and have the client fetch levels first*: an extra round trip on
  every sheet open, to supply a value the user was never asked for.
- *Add a separate `CreateQuickTask` RPC that omits the field*: a second task-creation path to
  keep in sync with the first, forever.

---

## D6 — Task resources become uniformly lazy

**Decision**: Remove the eager chat-channel and description-document creation from
`CreateTask`. Remove the `task.TaskKind != TaskKindRitualInstance` early return from
`EnsureTaskResources`. Every task, whatever its kind, gets its channel and document on first
open of the task detail view.

**Rationale**: FR-026a requires the comment thread of a chat-created task to be created
lazily. Reaching that without touching the shared path would mean a flag on `CreateTask` and
a branch honouring it — more code, and a rule that holds for one caller.

Lifting the gate is the smaller change and the more correct one. The reasoning that
justified lazy creation for ritual instances (feature 023 — a 30-day generation window would
create thousands of channels and documents nobody opens) applies verbatim to conversions,
which are designed to be cheap and frequent. It also removes a duplicated block: `CreateTask`
and `EnsureTaskResources` currently contain near-identical channel-and-document creation
code, and after this change only one copy remains.

The client side already anticipates it. `apps/web/.../tasks/[taskId]/page.tsx` has a
`retryProvisionResources` callback whose comment reads "Re-triggers EnsureTaskResources on
the backend by calling getTask again", and `GetTask` already routes through
`EnsureTaskResources` for every task, not only ritual instances. The gate is the only thing
stopping it from working for standard tasks today.

**Risk**: any caller assuming `task.channelId` is populated in the `CreateTask` response now
sees it empty. The mobile task detail must be audited for that assumption; the existing
`workflow_task_lifecycle_test.go` and `task-lifecycle.spec.ts` suites are the regression net.

**Alternatives considered**:
- *A `skip_resource_creation` flag on `CreateTask`*: adds a branch to serve one caller and
  leaves two code paths that must not diverge.
- *Chat-created tasks reuse the source channel as their comment thread*: rejected in the
  spec (FR-026) — task discussion would flood the channel the task was captured from.

---

## D7 — The announcement is a threaded system message with no notification fan-out

**Decision**: Add `SystemEventTypeTaskCreatedFromMessage = "task_created_from_message"` to
`internal/chat/constants.go`, widen the `message_system_event_type_valid` CHECK, and add
`ChatLogic.AnnounceTaskCreatedFromMessage`, which inserts one `message_kind = 'system'` row
with `parent_message_id` set to the source message, `author_employee_id` set to the
converting user, and `metadata` carrying the task id, identifier and title.

**Rationale**: This is the mechanism voice already uses. `createVoiceSystemMessage` writes a
system message directly, carries structured data in `metadata`, and never calls
`broadcastNewMessage` or `notifyMentionedUsersV2` — so a call record appears in the timeline
without notifying anyone. FR-028a wants exactly that, and reusing the pattern means no new
concept and no change to `SendMessage`, which unavoidably notifies.

Setting `parent_message_id` puts the announcement in the source message's thread rather than
the channel timeline, which is the placement chosen with the requester. One-level threading
is respected: the source message is a top-level message, and the announcement is its reply.

The metadata deliberately holds only what chat may safely show every channel member; the
authoritative, access-filtered task data comes from D3's RPC.

**Alternatives considered**:
- *`SendMessage` as the converting user*: broadcasts to every channel member and would fire
  mention notifications, violating FR-028a.
- *A channel-level system message*: rejected with the requester — noisier, and it separates
  the confirmation from the sentence it came from.
- *No announcement, chip only*: also rejected with the requester; a conversion would be
  invisible to anyone not re-reading the message.

---

## D8 — Navigation reuses canonical resource links

**Decision**: The chip navigates via `r/task/{taskId}`; the origin link navigates via
`r/chat/{channelId}` with `anchorType=message` and `anchorId={messageId}`.

**Rationale**: `internal/linking` already defines `ResourceTypeChatMessageAnchor = "message"`
and `AnchorTypeMessage = "message"`, and both clients already route canonical URLs — web
through `app/o/[tenantKey]/r/[...slug]/page.tsx`, mobile through `app/+native-intent.tsx` and
the `(shared)/resource/…` group. Federated search already opens a channel positioned on a
specific message using `highlightedMessageId`, so the landing behaviour FR-020 needs exists.

Using canonical links also means the origin link survives being copied out of the app into an
email or a push notification, which a route-local href would not.

**Alternatives considered**:
- *Platform-specific hrefs*: two code paths, and links that break the moment they leave the app.
- *A new `task-origin` resource type*: nothing to add — the target is a message, and that
  resource type already exists.

---

## D9 — The conversion is one transaction

**Decision**: The `CreateTaskFromMessage` Connect handler opens a single transaction on
`TenantPool` and passes it to task creation, the origin write, the destination upsert and the
announcement.

**Rationale**: FR-031 requires that a task never exists showing no origin. The repository's
pattern makes this straightforward — every logic method takes `tx database.DBTX`, transactions
are never nested, and `CreateTask` already performs a cross-domain call to `ChatLogic` inside
the caller's transaction. The announcement joins that same transaction rather than becoming a
best-effort follow-up.

Idempotency is deliberately *not* added: FR-025 says two people converting the same message
both get a task, because silently discarding the second person's work is worse than a
duplicate the UI already warns about.
