# Phase 1 Data Model: Unreachable Callee Still Gets a Missed Call

**Feature**: `052-unreachable-callee-missed-call` | **Date**: 2026-09-05

No migration. Every column this feature writes already exists; the change is a new
*combination* of values written by a new code path, plus one proto field that exposes a
column clients could not previously read.

## Entity 1 — Call record (`voice.call_session`)

Existing table (`backend/database/migrations/20260407000001_voice_communication.up.sql`).
The unreachable record is one row with this exact shape:

| Column | Value for this record | Why |
|---|---|---|
| `id` | `uuidv7()` | Principle IX. |
| `organization_id` | caller's org | Tenant key. |
| `channel_id` | the direct conversation | FR-001 — the record names the conversation. |
| `initiator_employee_id` | the caller | FR-001 — the record names the caller. |
| `livekit_room_name` | `makeLiveKitRoomName(orgID, channelID)` | `NOT NULL` and unique per org; the trailing UUID keeps it unique. **No LiveKit room is ever created for it.** |
| `state` | `ended` | FR-002 — finished from the moment it is written. |
| `outcome` | `missed` | FR-002, FR-003 — the same outcome a rang-out call gets. |
| `ended_reason` | `callee_unreachable` | FR-009 — the distinguishing value. |
| `started_at` | `now()` (column default) | The time of the attempt. |
| `answered_at` | `NULL` | FR-002, US3 scenario 2 — nobody answered. |
| `ended_at` | `now()` | Required by `voice_call_ended_requires_outcome`; equals `started_at`, so the derived duration is zero. |
| `ended_by_employee_id` | `NULL` | Nobody ended it; it was never live. |
| `recording_policy` | `not_allowed` | Nothing to record. |
| `recording_status` / `transcript_status` | `unavailable` | No artefacts. |
| `ring_deadline_at` | `NULL` | FR-007 — it never rings, so the ring-timeout sweep must never claim it. |

**Constraints this shape must satisfy, and does:**

- `voice_call_ended_requires_outcome` — `outcome` and `ended_at` are both set in the same
  `INSERT`, which is why a dedicated query is needed rather than
  `CreateVoiceCallSession`.
- `voice_call_outcome_valid` — `missed` is in the allowed set.
- `idx_voice_call_active_per_channel` (partial, `state IN ('ringing','active','ending')`) —
  an `ended` row is outside the index, so the record cannot block a live call (FR-014) and
  two simultaneous attempts cannot collide (FR-011).
- `idx_voice_call_livekit_room` (unique, not partial) — satisfied by the random UUID
  suffix in the room name.

**Related rows deliberately not written**: no `voice.call_participant` row (spec
Assumption 4 — nobody was invited, rung, or connected), no `voice.call_invitation`, no
`voice.call_artifact`, no `notification.notification` for the callee.

## Entity 2 — Missed-call conversation entry (`chat.message`)

Existing table, written by the existing `chat.createVoiceSystemMessage`. Nothing new is
introduced; the record simply produces one where it previously produced none.

| Column | Value |
|---|---|
| `message_kind` | `system` |
| `system_event_type` | `voice_call_missed` (`chat.SystemEventTypeVoiceCallMissed`) |
| `message_text` | `Voice call missed` |
| `author_employee_id` | the caller |
| `channel_id` | the direct conversation |
| `parent_message_id` | `NULL` |
| `metadata` | `{"callId": "<record id>", ...}` from `voiceCallTimelineMetadata` |

**Unread accounting (FR-008)** falls out of `GetUnreadMessageCount`, which counts every
non-deleted message with `updated_at > channel_membership.last_viewed_at` and does not
filter by `message_kind`. No change.

**Uniqueness (FR-011)**: `createVoiceSystemMessage` looks up an existing timeline message
by `metadata->>'callId'`. Each record has a fresh id, so each attempt inserts exactly one
message and repeated attempts produce repeated messages (US1 scenario 4).

## Entity 3 — Direct conversation (`chat.channel`, `channel_type = 'direct_message'`)

Unchanged. It is the scope condition: `ensureDirectCalleeAvailable` returns early for any
other channel type, so no shared-channel call can produce this record.

## Value set — `ended_reason` (new Go constants, Constitution VIII)

Free-form `text` column, no CHECK constraint. Existing values are literals scattered across
the package; this feature names them and adds one.

| Constant | Value | Written by |
|---|---|---|
| `EndedReasonEndedByUser` | `ended_by_user` | `EndVoiceCall` |
| `EndedReasonDirectParticipantLeft` | `direct_participant_left` | `LeaveVoiceCall`, DM |
| `EndedReasonFinalParticipantLeft` | `final_participant_left` | `LeaveVoiceCall`, last out |
| `EndedReasonDirectInviteDeclined` | `direct_invite_declined` | `RespondToVoiceCallInvite` |
| `EndedReasonDirectInviteExpired` | `direct_invite_expired` | invite expiry |
| `EndedReasonRingTimeout` | `ring_timeout` | `ClaimExpiredRingingCalls` (SQL literal) |
| `EndedReasonLiveKitRoomFinished` | `livekit_room_finished` | `webhook.go` |
| **`EndedReasonCalleeUnreachable`** | **`callee_unreachable`** | **this feature** |

`ring_timeout` remains a literal inside the SQL of `ClaimExpiredRingingCalls`; the Go
constant must equal it, and `voice_constants_test.go` asserts that the query file contains
every value in the set.

## State transitions

None. The record is created in its terminal state and never transitions:

```
(no prior state) ──INSERT──▶ ended / missed / callee_unreachable
```

It is deliberately outside the `ringing ▶ active ▶ ending ▶ ended` machine — it never
enters a state from which it could be joined, rung, swept, or ended a second time.
