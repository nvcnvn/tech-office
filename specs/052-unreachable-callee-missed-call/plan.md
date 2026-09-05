# Implementation Plan: Unreachable Callee Still Gets a Missed Call

**Branch**: `052-unreachable-callee-missed-call` | **Date**: 2026-09-05 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/052-unreachable-callee-missed-call/spec.md`

## Summary

Decide drift **D22** in favour of the trail. When a direct call is refused with
`VOICE_CALLEE_UNREACHABLE`, write a finished, missed `voice.call_session` row plus the
existing `voice_call_missed` chat system message, so an offline worker returning to the app
finds an unread conversation with the attempts in it — while the caller keeps the immediate
refusal they get today.

The technical crux is that the refusal is an **error**, and the connect layer's
`txn.WithTxn` rolls its transaction back. The record therefore has to be written in a
second transaction opened after the first has rolled back, and returned alongside — not
instead of — the refusal. Everything else reuses machinery that already exists: the same
chat announcement the ring-timeout sweep makes, the same `voice_call_ended` live event the
clients already refresh on, and the same unread accounting that counts system messages.

Two client defects surfaced during research and are fixed here because they block the
feature's own requirements: both web and mobile clear a call error on a terminal voice
event even for a call they never held (which would wipe the refusal, FR-013), and mobile
never refetches the transcript on a terminal voice event (which would hide the entry,
FR-012). Both are root-cause fixes that also repair the equivalent ring-timeout path.

## Technical Context

**Language/Version**: Go 1.27 (backend), TypeScript 5 (web + mobile), SQL (PostgreSQL 17)

**Primary Dependencies**: ConnectRPC, sqlc, pgx v5, protobuf/buf, Next.js (web),
Expo Router / React Native (mobile), TanStack Query, LiveKit (media plane — untouched here)

**Storage**: PostgreSQL. `voice.call_session` and `chat.message`, both existing.
**No migration**: `ended_reason` is free-form `text` with no CHECK constraint, and every
other column written already exists. `backend/database/scripts/schema.sql` is unchanged.

**Testing**: Go integration tests in `backend/integration/` (testWorld pattern);
Playwright E2E in `frontend/apps/web/e2e/`; the existing assert-based reducer check file
for mobile. No unit/snapshot/component tests (Constitution II).

**Target Platform**: Linux server (Docker Swarm), modern browsers, iOS + Android

**Project Type**: Web application with a mobile client — backend + frontend monorepo

**Performance Goals**: SC-003 unchanged — the caller learns the call cannot be delivered
within ten seconds and never waits out a ring. The added work is one extra short
transaction (two INSERTs plus one notification publish) on an already-failing request path,
so the refusal stays sub-second.

**Constraints**: The record write MUST NOT be able to convert a refusal into a different
error for the caller (FR-005). The record MUST NOT hold the `idx_voice_call_active_per_channel`
partial unique index for any interval (FR-011, FR-014). No push, wake, or media room may be
produced (FR-006, FR-007).

**Scale/Scope**: One backend domain (`internal/voice`), one proto message field, one new
sqlc query, one shared frontend package function, two client call sites, three
documentation files. Roughly a dozen files.

## Constitution Check

*GATE: passed before Phase 0; re-evaluated after Phase 1 design — see below.*

| Principle | Verdict | How this design satisfies it |
|---|---|---|
| **I. Data Governance & Multi-Tenancy** | PASS | Both writes are tenant-scoped by `organization_id` on the tenant pool. The second transaction uses `s.TenantPool`, the same pool as the request. No cross-tenant query; no `lint:cross-tenant` exemption needed. |
| **II. Scenario-First Testing** | PASS | Scenario stubs for every User Story and every user-observable FR are the contract in [`contracts/test-scenarios.md`](contracts/test-scenarios.md), to be reviewed before `/tasks`. Backend scenarios in `backend/integration/`, E2E in `frontend/apps/web/e2e/`. Two exclusions (FR-015 prose, SC-002 wall clock) are documented there with justification. |
| **III. Two-Layer Architecture & Proto Authorization** | PASS | The record write is a pure `Logic` method taking `tx database.DBTX`; the connect layer opens both transactions. `StartVoiceCall`'s existing `access_control` (`chat.voiceCall`) is unchanged — no new RPC, no new permission. |
| **IV. Cross-Domain Integration** | PASS | `internal/voice` reaches chat only through the existing `ChatAnnouncer` interface it already declares, and compliance only through the existing `ContactGuard`. No new cross-domain dependency, no new table read across domains. |
| **V. Observability, Simplicity & YAGNI** | PASS | Reuses `announceVoiceCallEnded`, `publishVoiceCallEvent` and the existing missed-call message rather than inventing a parallel path. One new query, one new logic method. A failed record write is logged at error level with org, channel and caller. No outbox, no worker, no feature flag. |
| **VI. Versioning & Breaking Changes** | PASS | `VoiceCallSession.ended_reason` is an additive field 10, and backend + web + mobile ship as one change set. The caller-facing wording change is coordinated in the single shared `voiceCallErrorMessage`. |
| **VII. Frontend API Wrapper Pattern** | PASS | No new RPC call is made from the clients; the changed wording lives in the existing `frontend/packages/apis/src/voice.ts` wrapper, which both apps already import. Clients keep reading generated types, never hand-rolled shapes. |
| **VIII. Cross-Stack Constant Sync** | PASS *(with scope note)* | `ended_reason` becomes a wire value, so the eight reasons get `EndedReason*` Go constants, the seven existing literals in `internal/voice` are replaced, and `voice_constants_test.go` gains a sync scenario over Go, the SQL query file and the TypeScript union. This is a deliberate, mandated widening of the diff — see Complexity Tracking. |
| **IX. UUID v7 & Nullable Cursor Params** | PASS | The record row uses the table's `uuidv7()` default. No pagination change; `ListCompletedVoiceCallSessionsForChannel` already returns `ended` rows. |
| **X. Structured Error Details** | PASS | The caller still receives `FAILED_PRECONDITION` / `VOICE_CALLEE_UNREACHABLE` through the existing `handleVoiceError`, unchanged. The clients still classify on the structured reason, not on message text. |
| **XI. Distributed-First & Horizontal Scalability** | PASS | The record is inserted straight to `ended` in a single statement, so two simultaneous attempts never contend on the partial unique index and neither is lost (FR-011). No instance-local state, no leader, no in-process scheduling. |
| **XII. Living Documentation** | PASS | FR-015 makes it explicit: `docs/domain/voice.md` and the drift register in `docs/domain/README.md` (removing D22), plus `backend/docs/VOICE-COMMUNICATION-ARCHITECTURE.md`, are updated in this change set. |
| **XIII. Mobile Design & Testing** | PASS | No new mobile screen or component — the missed-call entry and call history already render. The two mobile edits are behavioural fixes in existing code, covered by the existing assert-based reducer check. No Maestro flow: the scenario needs a second deliberately-offline device the harness cannot stage, documented as an exclusion. |

**Gate result: PASS.** One justified scope widening, recorded in Complexity Tracking.

### Post-Phase-1 re-evaluation

Re-checked after `data-model.md` and `contracts/` were written. No verdict changed. The
design added no new entity, no new RPC, no new permission and no migration, so the two
principles most at risk from a design phase — I (tenancy) and III (layering) — are if
anything better served than at gate time: the record write turned out to be a single
statement on the request's own tenant pool.

## Project Structure

### Documentation (this feature)

```text
specs/052-unreachable-callee-missed-call/
├── plan.md                       # This file
├── spec.md                       # Feature specification
├── research.md                   # Phase 0 output
├── data-model.md                 # Phase 1 output
├── quickstart.md                 # Phase 1 output
├── contracts/
│   ├── voice-service.md          # RPC + client contracts
│   └── test-scenarios.md         # Behavioural contract (Constitution II gate)
└── tasks.md                      # Phase 2 — created by /speckit-tasks, not here
```

### Source Code (repository root)

```text
backend/
├── rpc/v1/voice.proto                          # + VoiceCallSession.ended_reason (field 10)
├── database/scripts/voice.query.sql            # + CreateEndedVoiceCallSession
├── database/voice.query.sql.go                 # regenerated by sqlc
├── internal/voice/
│   ├── constants.go                            # + EndedReason* constants (8 values)
│   ├── logic.go                                # + RecordUnreachableCallAttempt;
│   │                                           #   callToProto populates ended_reason;
│   │                                           #   endCall call sites use constants
│   ├── ring_timeout.go                         # "ring_timeout" literal -> constant
│   ├── webhook.go                              # "livekit_room_finished" -> constant
│   └── service_connect.go                      # second txn on ErrCalleeUnreachable
├── integration/
│   ├── voice_unreachable_missed_call_test.go   # NEW — the behavioural contract
│   ├── voice_constants_test.go                 # + ended-reason sync scenario
│   └── helper_test.go                          # + channel unread helper if absent
└── docs/VOICE-COMMUNICATION-ARCHITECTURE.md    # architecture reference (Principle XII)

frontend/
├── packages/rpc/rpc/v1/voice_pb.ts             # regenerated by buf
├── packages/apis/src/voice.ts                  # FR-013 wording; ended-reason union type
├── apps/web/
│   ├── src/app/workspace/chat/hooks/useVoiceCall.ts   # don't clear the refusal (FR-013)
│   └── e2e/voice-communication.spec.ts                # + unreachable describe block
└── apps/mobile/src/
    ├── hooks/channel-voice-call-state.ts              # reducer: same fix
    ├── hooks/channel-voice-call-state.check.ts        # + assertion
    └── app/(app)/(chat)/[channelId].tsx               # refetch on terminal voice events

docs/domain/
├── voice.md                                    # describe the recorded outcome (FR-015)
└── README.md                                   # remove D22 from the drift register (FR-015)
```

**Structure Decision**: the existing backend + frontend monorepo layout. This feature adds
no directory and no module; it edits one backend domain package, one shared frontend
package, two client surfaces, and the documentation the constitution requires.

## Implementation Approach

### Backend

1. **`ended_reason` constants** (`internal/voice/constants.go`). Name the eight values,
   including the new `EndedReasonCalleeUnreachable = "callee_unreachable"`, and replace the
   seven literals at their call sites in `logic.go`, `ring_timeout.go` and `webhook.go`.
   The `ring_timeout` value stays a literal inside the SQL of `ClaimExpiredRingingCalls`;
   the sync test is what keeps them equal.

2. **`CreateEndedVoiceCallSession`** (`database/scripts/voice.query.sql`). One `INSERT`
   writing the terminal row — `state`, `outcome`, `ended_at`, `ended_reason` together, as
   `voice_call_ended_requires_outcome` demands — with `answered_at` and `ring_deadline_at`
   left NULL. A single statement is what keeps two simultaneous attempts from contending
   on the partial unique index. Run `sqlc generate`.

3. **`Logic.RecordUnreachableCallAttempt(ctx, tx, orgID, callerID, channelID)`**
   (`internal/voice/logic.go`). Insert the row via the new query, call
   `announceVoiceCallEnded(..., CallOutcomeMissed)`, then `publishVoiceCallEvent` with
   `NotificationTypeVoiceCallEnded` and `{"outcome": missed, "reason": callee_unreachable}`.
   It must not call `MediaClient.EnsureRoom`, `upsertParticipant`, `credentials`,
   `createPendingInvitation` or `emitTerminalCallWake`. Because the record has no
   participants, `publishVoiceCallParticipantEvent` returns early on its own — nothing is
   delivered to the callee.

4. **The second transaction** (`internal/voice/service_connect.go`). In `StartVoiceCall`,
   when the request transaction fails with `errors.Is(err, ErrCalleeUnreachable)`, open a
   second `txn.WithTxn` on `s.TenantPool` that calls `RecordUnreachableCallAttempt`, then
   return `handleVoiceError(err, ...)` as before. A failure of the second transaction is
   logged at error level and never replaces the caller's refusal.

5. **Expose the reason.** Add `string ended_reason = 10;` to `VoiceCallSession`, populate
   it in `callToProto`, run `buf generate`.

### Frontend

6. **Wording** (`packages/apis/src/voice.ts`): the `'unreachable'` case becomes
   *"They cannot be reached right now. They will see that you called."* The
   `voiceCallFailureKind` text fallback still matches `'cannot be reached'`, so
   classification is unaffected.

7. **Web** (`useVoiceCall.ts`): on a terminal voice event, only clear the error when this
   client actually held the ending call. Today the "don't wipe a newer call" guard requires
   a locally known call, so a client holding none falls through and clears the refusal it
   was just shown.

8. **Mobile reducer** (`channel-voice-call-state.ts`, `case "callEnded"`): the same fix —
   preserve `error` when there was no local call — plus an assertion in the existing
   `.check.ts`.

9. **Mobile transcript** (`app/(app)/(chat)/[channelId].tsx`): refetch newer messages for
   voice events regardless of whether `applyStreamEvent` returned `"terminal"`. Terminal is
   precisely when the system message is posted, so the current `"updated"`-only condition
   is inverted from what it needs to be. This also fixes missed ring-timeout and hang-up
   entries on mobile.

### Documentation

10. `docs/domain/voice.md`: replace the "Consequence worth knowing" paragraph with the
    recorded behaviour, and add `callee_unreachable` to the ended-reason description.
    `docs/domain/README.md`: delete the D22 row. `backend/docs/VOICE-COMMUNICATION-ARCHITECTURE.md`:
    describe the second-transaction write path.

### Sequencing

Constants → query → logic → connect → proto → clients → docs. The backend is independently
testable at step 4 (the record and the entry exist), which is User Story 1 in full; steps
6–9 are User Story 2; step 5 is User Story 3. That ordering matches the spec's priorities,
so P1 can ship and be verified before P2 or P3 is written.

## Risks

- **Silent loss of the record.** If the second transaction fails, the caller is refused and
  nothing is written — the exact behaviour this feature removes. Mitigated by an error-level
  log with org, channel and caller, and by the fact that the write is two statements on a
  pool the request has just successfully used. Not mitigated by a retry: a retry loop on a
  request that is already failing is a worse failure mode than one logged miss.
- **A regression in the caller's refusal.** The client fixes in steps 7–8 are the only thing
  standing between the new live event and a blanked-out error message. Both are covered by
  E2E and the reducer check respectively; neither should be landed without its test.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Widening the diff to name all eight `ended_reason` values as constants and replace seven existing literals, rather than adding only the new one | Constitution VIII forbids value literals where a constant exists and requires a synchronisation test once a string constant spans layers. Exposing `ended_reason` on the wire (FR-009) is the moment it starts spanning layers. | Adding `EndedReasonCalleeUnreachable` alone would leave seven sibling literals for the same column, which is precisely the state VIII exists to prevent — and the sync test would have to assert over a set that Go does not actually name. |
| Fixing two pre-existing client defects (error clearing, mobile transcript refresh) inside this feature | Both directly block this feature's own requirements: FR-013 (the refusal must be shown) and FR-012 (the entry must appear without a reload). Neither can be deferred without shipping a feature that fails its own acceptance scenarios. | Guarding only the unreachable case at each call site would leave the same bug for ring-timeout and hang-up terminal events, and would be a larger diff than the shared fix. |

## Assumptions

Beyond those already recorded in the spec, this plan makes the following calls:

- [ASSUMPTION: The record write runs in a second transaction opened by the connect layer,
  not by making `txn.WithTxn` commit on error. Constitution III reserves transaction
  ownership to the connect layer, and changing the shared helper's rollback semantics would
  be a trap for every other domain that uses it.]
- [ASSUMPTION: A failure of the record write is logged and swallowed, not surfaced to the
  caller. FR-005 requires the caller to receive the same refusal they get today; replacing
  a `FAILED_PRECONDITION` with an internal error because bookkeeping failed would be a
  worse outcome for the person placing the call.]
- [ASSUMPTION: `ended_reason` is exposed as a free-form proto string, not a proto enum. The
  column is free-form and diagnostic, clients branch on `outcome` and never on the reason,
  and an enum would force a regeneration cycle for every internal reason added.]
- [ASSUMPTION: The record reuses `makeLiveKitRoomName` for the `NOT NULL` room-name column
  rather than a distinct synthetic prefix. No room is created and no token minted, the
  trailing UUID keeps the unique index satisfied, and reusing the shape keeps
  `organizationIDFromLiveKitRoomName` working without a parser special case.]
- [ASSUMPTION: `ended_at` equals `started_at`, giving a zero duration, rather than
  `started_at` being backdated to when the caller pressed call. The refusal is
  sub-second, so any difference would be noise, and US3 asks only that no duration be
  shown.]
- [ASSUMPTION: The mobile transcript refetch is widened to all voice events rather than
  narrowed to this one case, which changes behaviour for ring-timeout and hang-up missed
  calls on mobile too. Those entries were also being missed until a reload; treating this
  as one bug is both the smaller diff and the correct fix.]
- [ASSUMPTION: No Maestro mobile flow is added. The scenario requires a second,
  deliberately unreachable device, which the Maestro harness cannot stage; the mobile-side
  logic is covered by the reducer check file and the backend scenarios.]
