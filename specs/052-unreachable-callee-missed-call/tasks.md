---
description: "Task list for 052-unreachable-callee-missed-call"
---

# Tasks: Unreachable Callee Still Gets a Missed Call

**Input**: Design documents from `/specs/052-unreachable-callee-missed-call/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/voice-service.md](contracts/voice-service.md),
[contracts/test-scenarios.md](contracts/test-scenarios.md), [quickstart.md](quickstart.md)

**Tests**: INCLUDED. Constitution principle II (Scenario-First Testing) is mandatory in this
repository, and [`contracts/test-scenarios.md`](contracts/test-scenarios.md) is the reviewed
behavioural contract for this feature. Test tasks precede the implementation they cover.

**Organization**: Tasks are grouped by user story. Each story is independently implementable
and independently testable, in the priority order the spec sets (P1 → P2 → P3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: `[US1]`, `[US2]`, `[US3]` — maps to the user stories in spec.md
- Every task names the exact file it touches

## Path Conventions

Monorepo, per plan.md "Project Structure": Go backend under `backend/`, web and mobile
clients under `frontend/apps/`, shared frontend packages under `frontend/packages/`, living
behaviour docs under `docs/domain/`.

**No migration.** `backend/database/scripts/schema.sql` must be unchanged at the end of this
feature — every column written already exists.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Get the voice-capable local stack running the way the voice integration tests
expect, and establish a green baseline so any later failure is attributable to this feature.

- [ ] T001 Bring up the voice-capable dev stack per [quickstart.md](quickstart.md) §Prerequisites — `make infra-up`, `make voice-dev-infra-up`, `make check-servers` — confirming the test process and server agree on `PUBLIC_LIVEKIT_URL`
- [ ] T002 Record a green baseline for the existing voice suite by running `cd backend && go test ./integration/ -run 'Voice' -count=1` and noting any pre-existing failure, so regressions introduced by this feature are distinguishable

**Checkpoint**: Stack is up and the existing voice behaviour is known-green.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Name the `ended_reason` value set as constants (Constitution VIII) and add the
single-statement terminal-row query. Both are prerequisites for the record write in US1 and
for the wire exposure in US3.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T003 Add the eight `EndedReason*` constants to `backend/internal/voice/constants.go` — `EndedReasonEndedByUser` = `ended_by_user`, `EndedReasonDirectParticipantLeft` = `direct_participant_left`, `EndedReasonFinalParticipantLeft` = `final_participant_left`, `EndedReasonDirectInviteDeclined` = `direct_invite_declined`, `EndedReasonDirectInviteExpired` = `direct_invite_expired`, `EndedReasonRingTimeout` = `ring_timeout`, `EndedReasonLiveKitRoomFinished` = `livekit_room_finished`, `EndedReasonCalleeUnreachable` = `callee_unreachable` (values per [data-model.md](data-model.md) §Value set)
- [ ] T004 Replace the four `ended_reason` string literals at the `endCall` call sites in `backend/internal/voice/logic.go` (lines ~307, ~319, ~359, ~964, ~987) with the constants from T003
- [ ] T005 [P] Replace the two `"ring_timeout"` literals in `backend/internal/voice/ring_timeout.go` (the log field at ~line 41 and the event `"reason"` at ~line 110) with `EndedReasonRingTimeout`
- [ ] T006 [P] Replace the `"livekit_room_finished"` literal in `backend/internal/voice/webhook.go` (~line 288) with `EndedReasonLiveKitRoomFinished`
- [ ] T007 Add the `CreateEndedVoiceCallSession` query to `backend/database/scripts/voice.query.sql` — one `INSERT` writing `state='ended'`, `outcome='missed'`, `ended_reason='callee_unreachable'`, `ended_at=now()`, `recording_policy='not_allowed'`, `recording_status='unavailable'`, `transcript_status='unavailable'`, with `answered_at`, `ended_by_employee_id` and `ring_deadline_at` left NULL, per the row shape in [data-model.md](data-model.md) §Entity 1. A single statement is what keeps two simultaneous attempts off `idx_voice_call_active_per_channel` (FR-011)
- [ ] T008 Run `cd backend && sqlc generate` to regenerate `backend/database/voice.query.sql.go`, then confirm `git status` shows `backend/database/scripts/schema.sql` **unchanged** — a modified schema.sql means a migration crept in that this feature does not need

**Checkpoint**: Constants exist, the terminal-row query compiles, and the value set is ready
to be written and exposed. User story implementation can begin.

---

## Phase 3: User Story 1 - The offline worker sees that someone tried (Priority: P1) 🎯 MVP

**Goal**: A direct call refused with `VOICE_CALLEE_UNREACHABLE` durably writes a finished
missed `voice.call_session` row and the existing `voice_call_missed` chat system message, so
an offline worker returning to the app finds an unread conversation with the attempt in it —
while the caller keeps the immediate refusal.

**Independent Test**: Make a person unreachable (register no call-wake device for them), place
a direct call, confirm the caller is refused, then read that person's direct conversation and
its unread state. The missed-call entry and the unread state must both be there with no action
taken by the caller in between.

### Tests for User Story 1 ⚠️

> **Write these FIRST and confirm they FAIL before implementing T012–T013.**

- [ ] T009 [P] [US1] Create `backend/integration/voice_unreachable_missed_call_test.go` with `TestUnreachableCalleeStillGetsAMissedCall` and fully-asserted bodies for the US1, FR-004, repeated-attempts, simultaneous-attempts, blocked-pair, busy-callee, reachable-callee, shared-channel and next-call-not-blocked blocks from [contracts/test-scenarios.md](contracts/test-scenarios.md). Make the callee unreachable by not calling `w.registerCallWakeDevice` for them, as `native_call_wakeup_test.go:298` already does. Leave the call-history block to T024
- [ ] T010 [P] [US1] Add a `channelUnreadCount(actor testUser, channelID string) int32` helper to `backend/integration/helper_test.go` that reads `Channel.unread_count` (chat.proto field 17) for a single channel, so FR-008 can be asserted without `markChannelAsRead` mutating the state under test

### Implementation for User Story 1

- [ ] T011 [US1] Implement `Logic.RecordUnreachableCallAttempt(ctx, tx database.DBTX, orgID, callerID, channelID)` in `backend/internal/voice/logic.go` — insert the row via `CreateEndedVoiceCallSession` using `makeLiveKitRoomName(orgID, channelID)`, call `announceVoiceCallEnded(..., CallOutcomeMissed)`, then `publishVoiceCallEvent` with `NotificationTypeVoiceCallEnded` and `actionData` `{"outcome": "missed", "reason": EndedReasonCalleeUnreachable}`. It MUST NOT call `MediaClient.EnsureRoom`, `upsertParticipant`, `credentials`, `createPendingInvitation` or `emitTerminalCallWake` (FR-006, FR-007)
- [ ] T012 [US1] Wire the second transaction in `backend/internal/voice/service_connect.go` `StartVoiceCall`: when the request transaction fails with `errors.Is(err, ErrCalleeUnreachable)`, open a fresh `txn.WithTxn` on `s.TenantPool` calling `RecordUnreachableCallAttempt`, then return `handleVoiceError(err, ...)` unchanged. A failure of the second transaction is logged at error level with org, channel and caller and MUST NOT replace the caller's refusal (FR-004, FR-005)
- [ ] T013 [US1] Run `make test-backend-one T=TestUnreachableCalleeStillGetsAMissedCall` until every scenario from T009 passes, confirming in particular that the record and the message both survive the failing request (FR-004) and that the blocked and busy paths still write nothing (FR-010, Assumption 1)

**Checkpoint**: User Story 1 is complete and independently shippable — the record and the
entry exist, the callee's conversation is unread, and the caller's refusal is unchanged. This
is the MVP; the spec says it is valuable even if nothing else ships.

---

## Phase 4: User Story 2 - The caller is told the attempt will be seen (Priority: P2)

**Goal**: The caller sees the missed-call entry appear in their open conversation without a
reload, and reads a refusal that says the person will see the call without saying why they
could not be reached.

**Independent Test**: With the caller's direct conversation open on screen, place a call to an
unreachable person and watch without reloading. The refusal and the missed-call entry must
both appear, the refusal must not name why, and no call bar or ringing state may be shown.

**Depends on**: US1 (the live event and the entry must exist for the clients to react to).

### Tests for User Story 2 ⚠️

- [ ] T014 [P] [US2] Add the `calling someone who cannot be reached` describe block to `frontend/apps/web/e2e/voice-communication.spec.ts` with the four tests named in [contracts/test-scenarios.md](contracts/test-scenarios.md) §Web E2E — entry appears without reload (FR-012), refusal wording says the person will see the call and does not say why (FR-013), no call bar or hang-up affordance (FR-005, SC-004), and the callee returning finds the conversation unread (FR-008)
- [ ] T015 [P] [US2] Add the assertion to `frontend/apps/mobile/src/hooks/channel-voice-call-state.check.ts` that a `callEnded` event for a call this client never held leaves `error` in place (FR-005, FR-013)

### Implementation for User Story 2

- [ ] T016 [P] [US2] Change the `'unreachable'` case of `voiceCallErrorMessage` in `frontend/packages/apis/src/voice.ts` to `'They cannot be reached right now. They will see that you called.'`, confirming the `voiceCallFailureKind` text fallback still matches the `'cannot be reached'` substring so classification is unaffected (FR-013, contract C3)
- [ ] T017 [P] [US2] Fix the terminal-event error clearing in `frontend/apps/web/src/app/workspace/chat/hooks/useVoiceCall.ts` so only a client that actually held the ending call clears its error — today a client holding no local call falls through the "don't wipe a newer call" guard and wipes the refusal it was just shown (FR-013, contract C4). This is a root-cause fix that also repairs the ring-timeout path
- [ ] T018 [P] [US2] Apply the same fix to `case "callEnded"` in the reducer in `frontend/apps/mobile/src/hooks/channel-voice-call-state.ts` — preserve `error` when there was no local call (FR-013, contract C4)
- [ ] T019 [P] [US2] Refetch newer messages for voice events regardless of whether `applyStreamEvent` returned `"terminal"` in `frontend/apps/mobile/src/app/(app)/(chat)/[channelId].tsx` — terminal is precisely when the system message is posted, so the current `"updated"`-only condition is inverted. This also fixes missed ring-timeout and hang-up entries on mobile (FR-012, plan Assumption 6)
- [ ] T020 [US2] Run `make test-frontend-one F=voice-communication` and `node --experimental-strip-types frontend/apps/mobile/src/hooks/channel-voice-call-state.check.ts` until both pass

**Checkpoint**: User Stories 1 AND 2 both work — the record exists and both clients present it
correctly, with the refusal intact.

---

## Phase 5: User Story 3 - Call history tells "never rang" from "rang out" (Priority: P3)

**Goal**: A reader of a conversation's call history can tell a call that never reached a
device from one that rang out unanswered, because the reason is on the wire.

**Independent Test**: Produce one missed call by letting a call ring out and one by calling an
unreachable person, then read the channel's call history and confirm the two records are
distinguishable by their recorded reason, and that the unreachable one shows no answer time
and no duration.

**Depends on**: US1 (a record must exist to expose) and Phase 2 (the constants are the value
set being exposed).

### Tests for User Story 3 ⚠️

- [ ] T021 [P] [US3] Extend `backend/integration/voice_constants_test.go` with the ended-reason synchronisation scenario — assert the `EndedReason*` set matches the literals in `backend/database/scripts/voice.query.sql` (including the `ring_timeout` literal inside `ClaimExpiredRingingCalls`) and the TypeScript union in `frontend/packages/apis/src/voice.ts` (Constitution VIII, FR-009)

### Implementation for User Story 3

- [ ] T022 [US3] Add `string ended_reason = 10;` to `message VoiceCallSession` in `backend/rpc/v1/voice.proto` with the comment from [contracts/voice-service.md](contracts/voice-service.md) §C1 stating that clients branch on `outcome` and never on this field. `VoiceCallRecord` embeds `VoiceCallSession`, so call history picks it up with no second field
- [ ] T023 [US3] Populate `EndedReason` in `Logic.callToProto` in `backend/internal/voice/logic.go` (empty while the call is live), then run `cd backend && buf generate` to regenerate `backend/rpc/v1/voice.pb.go` and `frontend/packages/rpc/rpc/v1/voice_pb.ts`
- [ ] T024 [US3] Add the `VoiceCallEndedReason` TypeScript union of the eight values to `frontend/packages/apis/src/voice.ts`, which is what T021's sync scenario asserts against
- [ ] T025 [US3] Add the call-history block from [contracts/test-scenarios.md](contracts/test-scenarios.md) to `backend/integration/voice_unreachable_missed_call_test.go` — both calls read as missed (US3.1), each carries a distinct recorded reason (FR-009, SC-006), and the unreachable record shows no answer time and no duration (US3.2)
- [ ] T026 [US3] Run `make test-backend-one T=TestUnreachableCalleeStillGetsAMissedCall` and `make test-backend-one T=TestVoiceConstantSync` until both pass

**Checkpoint**: All three user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: The documentation FR-015 requires, and the full-suite gate that is this
repository's Definition of Done.

- [ ] T027 [P] Update `docs/domain/voice.md` — replace the "Consequence worth knowing" paragraph with the recorded behaviour, delete the claim that the callee sees nothing, and add `callee_unreachable` to the ended-reason description (FR-015, Constitution XII)
- [ ] T028 [P] Delete the D22 row from the open drift register in `docs/domain/README.md` — this feature is the decision that register was waiting for (FR-015, SC-007)
- [ ] T029 [P] Describe the second-transaction write path in `backend/docs/VOICE-COMMUNICATION-ARCHITECTURE.md`, including why the record is inserted straight to `ended` and why a failed write is logged rather than retried (Constitution XII)
- [ ] T030 Run the full backend suite with `make test-backend` and confirm no regression against the T002 baseline — this is the Definition of Done gate (Constitution II)
- [ ] T031 Walk [quickstart.md](quickstart.md) §5–§7 manually: three refusals produce three separate entries, the callee's channel list shows the conversation unread, the two `psql` checks return `ended | missed | callee_unreachable` with a NULL `answered_at`, zero duration and zero participants, and the blocked, busy and reachable paths produce no new record
- [ ] T032 Run the documentation gate from [quickstart.md](quickstart.md) §8 — `grep -n "D22" docs/domain/README.md` must return no match, and `grep -n "callee_unreachable" docs/domain/voice.md` must match

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Phase 2 (T003 constants, T007–T008 query)
- **US2 (Phase 4)**: Depends on US1 — the clients react to the live event and entry US1 writes
- **US3 (Phase 5)**: Depends on US1 and Phase 2 — exposes the reason US1 records
- **Polish (Phase 6)**: Depends on all three stories

### User Story Dependencies

- **US1 (P1)**: Independent once Phase 2 is done. Ships and is verifiable on its own.
- **US2 (P2)**: Needs US1's record to exist. Independently testable through the web E2E block.
- **US3 (P3)**: Needs US1's record to exist. Independently testable through call history.

US2 and US3 touch disjoint files (clients vs. proto + backend tests) and can run in parallel
once US1 is green.

### Within Each Story

- Test tasks are written and confirmed failing before the implementation they cover
- Constants before the code that uses them; query before the logic that calls it
- Logic before the connect layer that opens the transaction
- Backend before clients

### Parallel Opportunities

- **Phase 2**: T005 and T006 in parallel after T003 (different files); T007 in parallel with all three
- **Phase 3**: T009 and T010 in parallel (different files)
- **Phase 4**: T014–T019 are six different files and all carry [P]; only T020 must wait
- **Phase 5**: T021 in parallel with T022; T024 in parallel with T025 after T023
- **Phase 6**: T027, T028 and T029 in parallel (three different documents)
- **Across stories**: after T013, the whole of US2 and the whole of US3 can proceed in parallel

---

## Parallel Example: User Story 2

```bash
# All six US2 implementation and test tasks touch different files:
Task: "Add the unreachable describe block to frontend/apps/web/e2e/voice-communication.spec.ts"
Task: "Add the assertion to frontend/apps/mobile/src/hooks/channel-voice-call-state.check.ts"
Task: "Change the unreachable wording in frontend/packages/apis/src/voice.ts"
Task: "Fix terminal-event error clearing in frontend/apps/web/src/app/workspace/chat/hooks/useVoiceCall.ts"
Task: "Fix the callEnded reducer case in frontend/apps/mobile/src/hooks/channel-voice-call-state.ts"
Task: "Refetch on terminal voice events in frontend/apps/mobile/src/app/(app)/(chat)/[channelId].tsx"
```

## Parallel Example: Phase 2 Foundational

```bash
# After T003 names the constants:
Task: "Replace the ring_timeout literals in backend/internal/voice/ring_timeout.go"
Task: "Replace the livekit_room_finished literal in backend/internal/voice/webhook.go"
Task: "Add CreateEndedVoiceCallSession to backend/database/scripts/voice.query.sql"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: Setup — stack up, baseline green
2. Phase 2: Foundational — constants and the terminal-row query (CRITICAL, blocks everything)
3. Phase 3: User Story 1 — the record and the entry
4. **STOP and VALIDATE**: `make test-backend-one T=TestUnreachableCalleeStillGetsAMissedCall`,
   then confirm manually that an offline callee returns to an unread conversation with the
   missed-call entry in it
5. This alone closes drift D22's product question and is worth shipping

### Incremental Delivery

1. Setup + Foundational → the value set and the write path exist
2. US1 → the offline worker sees the attempt → **MVP**
3. US2 → the caller sees the entry live and reads honest wording → deploy
4. US3 → call history distinguishes "never rang" from "rang out" → deploy
5. Polish → living documentation updated and D22 struck from the register

### Parallel Team Strategy

1. One developer takes Phase 1 + Phase 2 + US1 — it is a single serial thread through the
   backend and cannot usefully be split
2. Once T013 is green:
   - Developer A: US2 (both clients and the E2E block)
   - Developer B: US3 (proto, call history, constant sync)
   - Developer C: Phase 6 documentation (T027–T029), which depends only on the US1 decision
3. T030–T032 run last, once everything has landed

---

## Notes

- **The load-bearing risk** is FR-004: the record must survive a request that fails. T012 is
  the task where this is won or lost, and T009's "the record and the message are both durably
  stored" scenario is what proves it. Do not mark T012 done on a compile.
- **Do not reorder the guards.** `authorize` → `ensureDirectCallAllowed` (block) →
  one-live-call → `ensureDirectCalleeAvailable` (busy, then unreachable). FR-010 is satisfied
  structurally by that order: a blocked pair never reaches the reachability check.
- T004 and T011 both edit `backend/internal/voice/logic.go`, as do T023 — they are sequenced
  across phases and none carries [P] against the others.
- T016 and T024 both edit `frontend/packages/apis/src/voice.ts` in different phases; if US2
  and US3 run concurrently, coordinate those two.
- No migration. If `backend/database/scripts/schema.sql` shows as modified at any point,
  stop and find what added one — that file is generated from migrations and never hand-edited.
- Commit after each task or logical group. Stop at any checkpoint to validate the story.
