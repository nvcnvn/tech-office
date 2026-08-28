# Phase 1 Data Model: Time-Sensitive Call Wakeup

**Date**: 2026-08-28 | **Branch**: `037-native-call-wakeup`

The spec names three key entities. Two of them already exist in the schema and are extended
rather than created; the third lives on the device and has no server row. **No new tables.**

---

## 1. Call wake target → `notification.push_token` (existing, extended)

A registered device that can be woken for a call. Today the table holds one row per device
holding an FCM token; a device that also has an APNs VoIP token gets a **second row** with
the same `device_identifier`, distinguished by its token type.

| Field | Source | Note |
|---|---|---|
| `token_id`, `organization_id`, `employee_id`, `device_identifier` | existing | org-scoped, Citus-distributed; unchanged |
| `fcm_token` | existing | carries the provider token for whichever type this row is |
| `token_metadata.tokenType` | existing JSONB | gains `apns_voip`; existing values keep their meaning |
| `token_metadata.platform` | existing JSONB | `ios` / `android` / `web`; already populated |
| `token_metadata.deliveryProvider` | existing JSONB | already used by `isFirebaseSendableToken` to keep non-Firebase tokens out of the FCM path — the hook this design needs already exists |
| `token_metadata.nativeCallCapable` | **new** JSONB key | whether this device's build and permissions support the native tier; drives tier-A vs tier-B routing (FR-014) |
| `is_valid`, `permission_state`, `last_used_at` | existing | unchanged; APNs `410 Unregistered` marks the row invalid the way an FCM failure does |

**Rules**

- A device may hold at most one row per `tokenType`. The existing duplicate cleanup keyed on
  `fcm_token` continues to apply within a type.
- A VoIP token is only ever used for `call_wake` traffic. Routine notifications keep using
  the FCM row, so a device with both receives each class on the right transport.
- `nativeCallCapable = false` (or a device with no VoIP row on iOS) routes to tier B.

**Why not a new table**: a VoIP token is a push token with a different provider. Splitting it
out would duplicate the org scoping, validity lifecycle, permission state and cleanup logic
that already work, and would force every "which devices can I reach?" query to read two
tables.

---

## 2. Call wake attempt → `notification.delivery_attempt` (existing, extended)

The audit trail behind "my phone never rang" (FR-005). This is the table that already answers
that question for every other notification, so call wakes belong in it.

| Column | Change |
|---|---|
| `channel` | CHECK widened from `sse \| push \| replay` to add **`call_wake`** |
| `attempt_status` | unchanged: `queued \| sent \| skipped \| failed` |
| `reason` | CHECK widened to add **`no_call_wake_target`**, **`native_tier_unavailable`**, **`call_already_ended`** |
| everything else | unchanged |

One row per **device per call event**, not per recipient — this is what makes it possible to
say "her iPhone rang and her Android tablet did not, because its token was stale".

The column comment (`'Delivery channel: sse (realtime), push (FCM offline), replay (reconnect
replay).'`) is part of the migration, not an afterthought — `schema.sql` is generated from
migrations and must not be hand-edited.

**Deliberately excluded reasons**: `suppressed_by_preference` must never appear on a
`call_wake` row. Calls ring through workspace DND and muted domains (FR-016); if that reason
ever shows up on a call wake, the suppression exemption has regressed.

---

## 3. Ring deadline → `voice.call_session` (existing, one column)

There is no ring timeout today (see research R7): a `ringing` call ends only when LiveKit
reports the room finished. US1 scenario 5 and SC-006 both require a bounded ring.

| Column | Change |
|---|---|
| `ring_deadline_at` | **new**, `timestamptz NULL` — set when the call enters `ringing` (start + the 45 s ring timeout), cleared when it leaves |

**Rules**

- Set on transition into `ringing`; `NULL` in every other state.
- The sweep claims rows `WHERE state = 'ringing' AND ring_deadline_at < now()`, ends the call
  with `outcome = 'missed'`, and publishes the end-of-call wake so every ringing device stops.
- The 45 s timeout is a single constant in `backend/internal/voice/constants.go`, not a literal
  in the sweep and a second literal in the payload builder.
- The claim must be exclusive (Constitution XI): two instances running the sweep must not both
  end the same call. Same claim pattern as the existing worker.
- Ending via the sweep produces the same `voice_call_missed` chat system message as a webhook
  inferred miss — one code path, not two.

**Existing invariants that keep working**: the `state = 'ended'` ⇒ `outcome` and `ended_at`
CHECK; the partial unique index enforcing one live call per channel (a swept call leaves
`ringing`, which frees the channel).

---

## 4. Device call session → client-side only, no server row

The operating system's representation of the call on one device (a CallKit `CXCall` / a
Telecom `CallControlScope`), paired one-to-one with the device's participation in the
workspace call.

It is **not** persisted server-side. `voice.call_participant` already holds the authoritative
per-participant state (`invited → ringing → joining → joined → disconnected | left | declined
| removed`), and mirroring an OS object into the database would create two sources of truth
that drift the moment a push is lost.

**Client invariant (FR-013)**: the device call session's lifetime is a subset of the workspace
call's. It starts when a wake is reported and ends on *every* terminal path — answered,
declined, cancelled, timed out, ended remotely, answered on another device, session invalid,
or join failed. On iOS the report happens even for a cancel or an already-ended call, because
iOS 26 terminates the app for a VoIP push that reports nothing; the client reports and then
immediately ends with the matching reason.

---

## State transition map (per device, one call)

```
        wake: incoming
              │
              ▼
        ┌───────────┐  answer   ┌──────────┐  end (any side)   ┌────────┐
        │  ringing  │──────────▶│ connected│──────────────────▶│  ended │
        └───────────┘           └──────────┘                   └────────┘
              │                                                     ▲
              │ decline / cancel / timeout / answered elsewhere      │
              │ / no valid session / join failed                     │
              └──────────────────────────────────────────────────────┘
```

Every arrow into `ended` must also close the OS call object. There is no path that leaves a
device in `ringing` or `connected` once the server-side call is `ended` — that is the
zero-orphan requirement of SC-005 stated as a data rule.
