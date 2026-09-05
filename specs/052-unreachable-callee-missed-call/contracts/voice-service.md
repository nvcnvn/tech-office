# Contract: VoiceService — unreachable direct call

**Feature**: `052-unreachable-callee-missed-call`

Two contracts change: one RPC response shape (additive proto field) and one behavioural
contract on an existing error path. No RPC is added or removed, and no `access_control`
option changes.

## C1. `VoiceCallSession` gains `ended_reason`

`backend/rpc/v1/voice.proto`:

```protobuf
message VoiceCallSession {
  string id = 1;
  string channel_id = 2;
  string initiator_employee_id = 3;
  VoiceCallState state = 4;
  VoiceCallOutcome outcome = 5;
  repeated VoiceCallParticipant participants = 6;
  bool recording_permitted = 7;
  google.protobuf.Timestamp started_at = 8;
  google.protobuf.Timestamp ended_at = 9;

  // Why the call ended, as a free-form diagnostic string. Empty while the call is live.
  // Clients branch on `outcome`, never on this — it distinguishes two calls that share an
  // outcome, such as a missed call that rang out (`ring_timeout`) from one that never
  // reached a device (`callee_unreachable`). Values are the EndedReason* constants in
  // backend/internal/voice/constants.go.
  string ended_reason = 10;
}
```

Populated in `Logic.callToProto`, so it appears in every response that carries a
`VoiceCallSession`: `StartVoiceCall`, `GetActiveVoiceCall`, `JoinVoiceCall`,
`LeaveVoiceCall`, `EndVoiceCall`, `ListCallRecords`, `GetCallRecord`.

Regeneration: `cd backend && buf generate` (writes Go in place and TypeScript into
`frontend/packages/rpc`).

**Breaking-change note**: adding field 10 to a message is wire-compatible, and all three
clients in this repository ship together, so this lands as one coordinated change set
(Constitution VI).

## C2. `StartVoiceCall` — behaviour on `VOICE_CALLEE_UNREACHABLE`

**Request**: unchanged (`channel_id`, `request_recording`).

**Response to the caller**: unchanged. `connect.CodeFailedPrecondition` with error reason
`VOICE_CALLEE_UNREACHABLE` and message "the person you are calling cannot be reached".
No session, no join credentials, no ring (FR-005, SC-003).

**New server-side effect**, committed in a transaction of its own after the request
transaction has rolled back:

| Effect | Detail | Requirement |
|---|---|---|
| Call record written | `voice.call_session` row, `state=ended`, `outcome=missed`, `ended_reason=callee_unreachable`, `answered_at=NULL` | FR-001, FR-002 |
| Conversation entry written | `chat.message`, `message_kind=system`, `system_event_type=voice_call_missed`, text "Voice call missed" | FR-003 |
| Written atomically | both in one transaction, or neither | FR-004 |
| `voice_call_ended` live event published | channel-scoped, `actionData.outcome=missed`, `actionData.reason=callee_unreachable` | FR-012 |
| No media room | `MediaClient.EnsureRoom` not called; no join token minted | FR-006 |
| No participants | no `voice.call_participant` rows, so no participant-scoped live event and no per-employee delivery | FR-006, FR-007 |
| No wake | `emitTerminalCallWake` not called; no push, no `voice_call_incoming` | FR-007 |
| Not joinable | `state=ended` from the first write, so `JoinVoiceCall` fails its `getLiveCall` lookup | FR-006, SC-004 |
| Does not block the next call | `state=ended` is outside `idx_voice_call_active_per_channel` | FR-014, SC-004 |

**Ordering guarantee (unchanged, and load-bearing)**: `authorize` →
`ensureDirectCallAllowed` (block) → one-live-call check → `ensureDirectCalleeAvailable`
(busy, then unreachable). A blocked pair therefore never reaches the reachability check
and can never produce a record (FR-010, SC-005).

**Paths that produce no record**: `VOICE_CALLEE_BUSY`; `VOICE_DIRECT_CONTACT_BLOCKED`;
any non-direct channel; a reachability check that errors (fails open — the call is placed
and rings normally).

**Failure of the record write itself**: logged at error level with the org, channel and
caller; the caller still receives the refusal. The refusal must never be replaced by a
bookkeeping error.

## C3. Client contract — caller-facing wording

`frontend/packages/apis/src/voice.ts`, `voiceCallErrorMessage`, case `'unreachable'`:

```
'They cannot be reached right now. They will see that you called.'
```

Says nothing about why (FR-013). Single source for web and mobile. `voiceCallFailureKind`
still matches on the structured `VOICE_CALLEE_UNREACHABLE` reason first, so this wording
change cannot reclassify an outcome — but its text-fallback branch matches the substring
`'cannot be reached'`, which the new sentence still contains.

## C4. Client contract — a terminal event for an unknown call

Both clients receive `voice_call_ended` for a call they never held. The required
behaviour, in both:

- **MUST NOT** clear a call error the user is currently being shown. Only a client that
  held the ending call may clear its error (FR-005, FR-013).
- **MUST** refresh the channel transcript so the missed-call entry appears without a
  reload (FR-012). On mobile this means voice events refetch newer messages on terminal
  events too, not only on non-terminal ones.
- **MUST NOT** present a call bar, ringing state, or anything to hang up (FR-005,
  SC-004) — which follows from there being no local call to restore.
