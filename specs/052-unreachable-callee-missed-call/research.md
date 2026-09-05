# Phase 0 Research: Unreachable Callee Still Gets a Missed Call

**Feature**: `052-unreachable-callee-missed-call` | **Date**: 2026-09-05

All research was done against the code, not against prior specs, per `AGENTS.md`. The
starting point was `docs/domain/voice.md`, which names the gap as drift **D22**.

## R1. Where the refusal happens, and why nothing is written

**Finding**: `Logic.StartVoiceCall` (`backend/internal/voice/logic.go:95`) runs four
guards in order — `authorize`, `ensureDirectCallAllowed` (block guard),
`GetActiveVoiceCallForChannel` (one-live-call), `ensureDirectCalleeAvailable` (busy then
unreachable) — and only then inserts the `voice.call_session` row. The unreachable verdict
comes from `CallWakeDispatcher.HasCallWakeTarget` and returns `ErrCalleeUnreachable`
(`logic.go:1639`) *before* any row exists.

**Consequence for the design**: the refusal ordering is a dependency the spec forbids
reordering, and it already satisfies FR-010 structurally — a blocked pair is rejected by
`ensureDirectCallAllowed` and never reaches the reachability check, so no record can be
written for it. FR-010 needs a test, not code.

## R2. The transaction problem (FR-004)

**Finding**: `ServiceConnect.StartVoiceCall` (`service_connect.go:44`) wraps the whole
logic call in `txn.WithTxn(ctx, s.TenantPool, ...)` and returns the logic error from the
callback. `txn.WithTxn` rolls back on a non-nil error. Any write made on that `tx` while
producing `ErrCalleeUnreachable` is therefore discarded — this is exactly the failure mode
the spec calls "the single most likely way to implement it wrongly".

**Decision**: write the record and the system message in a **second, separate
transaction**, opened in the connect layer after the first one has rolled back, and then
return the original refusal error unchanged.

**Rationale**: Constitution principle III makes the connect layer the only layer allowed
to own pools and open transactions, and `ServiceConnect` already holds `s.TenantPool`.
A second `txn.WithTxn` there is the smallest change that makes the record durable, and
running both writes inside that one transaction satisfies "written together — never one
without the other".

**Alternatives considered**:
- *Write on the same transaction and return success with an error field.* Rejected: FR-005
  requires the caller to receive the same refusal outcome as today, which is a
  `FAILED_PRECONDITION` error; a success response would break every client's error path.
- *Return a sentinel from the logic layer and have `txn.WithTxn` commit anyway.* Rejected:
  it makes "the transaction commits on error" a property of the shared helper, which is a
  trap for every other domain that uses it.
- *An outbox row swept by a worker.* Rejected under Constitution V (YAGNI): the write is
  two statements against the same tenant pool the request already used, and adding a
  background hop buys nothing but latency and a second failure surface.

## R3. How the record row must be written (FR-002, FR-006, FR-011, FR-014)

**Finding**: `voice.call_session` has
`CONSTRAINT voice_call_ended_requires_outcome CHECK (state <> 'ended' OR (outcome IS NOT
NULL AND ended_at IS NOT NULL))`, so a terminal row must be written with `state`,
`outcome` and `ended_at` in the same statement. `CreateVoiceCallSession` cannot express
that. The partial unique index `idx_voice_call_active_per_channel ... WHERE state IN
('ringing','active','ending')` excludes `ended`, so a terminal row neither collides with a
live call nor blocks the next one. `idx_voice_call_livekit_room` is a *non-partial* unique
index on `(organization_id, livekit_room_name)`, but `makeLiveKitRoomName` appends a fresh
UUID, so every name is unique.

**Decision**: add one sqlc query, `CreateEndedVoiceCallSession`, that inserts the finished
row in a single `INSERT` — `state = 'ended'`, `outcome = 'missed'`,
`ended_reason = 'callee_unreachable'`, `ended_at = now()`, `answered_at` left NULL,
`ring_deadline_at` left NULL — and never call `MediaClient.EnsureRoom`,
`upsertParticipant`, `credentials` or `createPendingInvitation` for it.

**Rationale**: one statement is what makes the "two attempts at once" edge case safe
(FR-011). Creating the row as `ringing` and immediately ending it would take the partial
unique index for the duration of the transaction, so two simultaneous attempts in the same
DM would serialise and the second would fail with a unique violation, losing a record the
spec requires. Inserting straight to `ended` never touches that index.

**Alternatives considered**:
- *Reuse `CreateVoiceCallSession` + `EndVoiceCallSession`.* Rejected for the index
  contention above, and because the intermediate `ringing` state is a moment in which the
  ring-timeout sweep or a `GetActiveVoiceCall` could observe a call that must never exist.
- *A synthetic `livekit_room_name` with its own prefix.* Rejected as unnecessary: no room
  is ever created, no token minted, and `organizationIDFromLiveKitRoomName` (used by
  webhook tenant resolution) keeps working unchanged if the standard shape is reused.

## R4. The conversation entry (FR-003, FR-008)

**Finding**: `Logic.announceVoiceCallEnded` → `chat.AnnounceVoiceCallEnded`
(`backend/internal/chat/logic.go:3416`) maps `outcome = "missed"` to
`SystemEventTypeVoiceCallMissed` with the text "Voice call missed", then
`createVoiceSystemMessage` looks for an existing timeline message carrying the same
`callId` and inserts a new one when there is none. Because no "call started" announcement
was made for this record, the lookup misses and a fresh missed-call message is inserted —
byte-for-byte the message the ring-timeout sweep produces.

`GetUnreadMessageCount` counts every non-deleted `chat.message` with
`updated_at > last_viewed_at`, with no filter on `message_kind`. FR-008 therefore needs no
code: the system message counts towards the callee's channel unread state the moment it is
inserted.

**Decision**: reuse `announceVoiceCallEnded(..., CallOutcomeMissed)` verbatim. No new chat
surface, no new system event type, no change to unread accounting.

## R5. The caller's live refresh (FR-012)

**Finding**: `publishVoiceCallEvent` publishes a channel-scoped `voice_call_ended` live
event; `useChatSSE.ts:499` invalidates `["messages", channelId]` on exactly that type, and
`ChannelSidebar.tsx:92` refreshes the channel list. Publishing the same event for the
recorded attempt gives the web caller FR-012 for free. `publishVoiceCallParticipantEvent`
returns early because the record has no participants, so nothing is delivered to the
callee — which is what FR-007 wants.

**Two client defects surfaced by this, both of which must be fixed here**:

1. **Both clients wipe the refusal message.** `useVoiceCall.ts:599` and the mobile reducer
   `channel-voice-call-state.ts` `case "callEnded"` both set the error to `null` on a
   terminal voice event. Their "don't wipe a newer call" guard requires a *locally known*
   call, so when the client holds no call — precisely our case — the guard falls through
   and the "They cannot be reached right now." message the caller was just shown is
   cleared. This directly breaks FR-005/FR-013.
   **Decision**: in both clients, only clear the error when the client actually held the
   call that ended. This is the root-cause fix: it also protects any other terminal event
   for a call this client never had.
2. **Mobile never refetches the transcript on a terminal voice event.**
   `app/(app)/(chat)/[channelId].tsx:1434` only calls `fetchNewerIntoCache()` when
   `applyStreamEvent` returns `"updated"`, i.e. for non-terminal events. The terminal event
   is the *only* one that posts a system message, so mobile misses it.
   **Decision**: always refetch newer messages for voice events. This fixes the same
   latent gap for ring-timeout and hang-up missed calls, not just this feature.

**Alternative considered**: publishing a brand-new `voice_call_missed` notification type.
Rejected — it would need handling added in six client call sites across web and mobile, and
it would be dishonest: the record *is* an ended call.

## R6. Distinguishing "never rang" from "rang out" (FR-009)

**Finding**: `voice.call_session.ended_reason` is a free-form `text` column with no CHECK
constraint. The ring-timeout sweep writes `'ring_timeout'` (as a literal inside
`ClaimExpiredRingingCalls`); other paths write `'ended_by_user'`,
`'direct_participant_left'`, `'final_participant_left'`, `'direct_invite_declined'`,
`'direct_invite_expired'` and `'livekit_room_finished'`. **`ended_reason` is not exposed in
the proto at all** — `callToProto` omits it — so today no client can read it.

**Decision**: add `string ended_reason = 10;` to `VoiceCallSession` in
`backend/rpc/v1/voice.proto` and populate it in `callToProto`, so it flows into
`ListCallRecords`, `GetCallRecord` and `GetActiveVoiceCall` alike. Introduce
`EndedReason*` Go constants in `backend/internal/voice/constants.go` covering the full set
including the new `callee_unreachable`, and replace the existing literals.

**Rationale**: US3 reads the reason "from the conversation's call history", which is the
`ListCallRecords` RPC — a database-only value cannot satisfy it. Constitution VIII forbids
value literals where a constant exists and requires cross-stack constants to be
synchronised and covered by a test; adding the eighth reason and exporting the set to
clients is the moment that rule bites. A free-form string field rather than a proto enum
is the right shape here because the column is free-form and diagnostic, and clients
branch on `outcome`, never on the reason.

**Alternatives considered**:
- *Put the reason in the chat system message metadata instead.* Rejected: FR-003 requires
  the entry to be indistinguishable from a rang-out missed call, and US3 asks for the
  distinction in the **call history**, which is a different surface.
- *A proto enum for the reason.* Rejected under principle VIII's own guidance: an enum
  would force a migration-and-regeneration cycle every time an internal diagnostic reason
  is added, for a value no client branches on.

## R7. Caller wording (FR-013)

**Finding**: `voiceCallErrorMessage` in `frontend/packages/apis/src/voice.ts:111` is the
single source of the caller-facing sentence for both web (`useVoiceCall.ts:136`) and mobile
(`use-channel-voice-call.ts:201`). The spec's assumption that the wording changes in one
place is confirmed.

**Decision**: `'They cannot be reached right now. They will see that you called.'` — the
existing sentence plus the new fact, still saying nothing about why.

## R8. What deliberately does not change

- **Busy stays silent.** `ErrCalleeBusy` is a different error raised before the
  reachability check and is untouched (spec Assumption 1).
- **The block guard order stays.** `ensureDirectCallAllowed` runs before
  `ensureDirectCalleeAvailable`; that ordering is what makes FR-010 free.
- **Fail-open reachability stays.** When `HasCallWakeTarget` errors the call is placed and
  rings normally, producing an ordinary call, not a record.
- **Shared channels are untouched.** `ensureDirectCalleeAvailable` returns early when the
  channel is not a direct conversation.
- **No push, no wake.** `emitTerminalCallWake` is not called; there is no ringing device to
  stop and no device that can be woken.
- **No migration.** `ended_reason` is free-form text and the terminal row uses columns that
  already exist, so `backend/database/scripts/schema.sql` is unchanged.

## Resolved unknowns

Every `[NEEDS CLARIFICATION]` raised while filling Technical Context was resolved above:
transaction boundary (R2), row-write mechanism (R3), reason exposure (R6), and the two
client-side defects that block FR-012/FR-013 (R5). No open questions remain.
