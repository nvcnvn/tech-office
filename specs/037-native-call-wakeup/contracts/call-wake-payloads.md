# Contract: Call Wake Payloads

**Date**: 2026-08-28 | **Branch**: `037-native-call-wakeup`

The wire contract between the backend's call wake dispatcher and the mobile app, for each
platform. Field names are the shared vocabulary of Constitution VIII — defined once in proto
and mirrored to `packages/apis`, never restated per platform.

---

## Event kinds

One vocabulary for both transports. Every call wake carries exactly one.

| `event` | When sent | Client obligation |
|---|---|---|
| `incoming` | a call starts ringing this device | report the call and present the native incoming UI |
| `cancelled` | caller hung up before answer | report, then end immediately with *unanswered* |
| `answered_elsewhere` | the same person answered on another device | report, then end immediately with *answered elsewhere* |
| `declined_elsewhere` | declined on another device | report, then end immediately with *declined elsewhere* |
| `ended` | the call ended for any other reason (remote hang-up, ring timeout, failure) | report, then end immediately with *remote ended* |

**Rule that binds the backend**: no other notification type may be delivered on this
transport. On iOS this is not a style preference — a VoIP push that does not result in a
reported call terminates the app (research R1). The dispatcher must therefore refuse to emit
a call wake for anything but a live call event, and every event kind above has a defined
client action that ends in a reported call.

**Rule that binds the client**: *always report first*. Even for `ended` on a call the client
has never heard of, and even when the local session is invalid or expired, the client reports
the call to the OS and then ends it. Never return from a VoIP push without reporting.

---

## Common payload

```json
{
  "event": "incoming",
  "callId": "<uuid>",
  "channelId": "<uuid>",
  "organizationId": "<uuid>",
  "callerDisplayName": "Ana Duarte",
  "callerEmployeeId": "<uuid>",
  "workspaceName": "Bright Plumbing",
  "ringExpiresAt": "2026-08-28T10:15:42Z",
  "sequence": 1
}
```

- `callerDisplayName` and `workspaceName` are the **only** human-readable strings — FR-008
  forbids message content or conversation detail on the lock screen.
- `ringExpiresAt` is the call's start plus the 45 s ring timeout. It lets a device that was
  woken late decide not to ring at all, and bounds the UI if the terminal wake is lost.
- There is no video field. Video is out of scope for this epic, and a field that exists only
  for excluded scope is exactly what Constitution V rules out.
- `sequence` increases per call; a client that receives an out-of-order or duplicate wake for
  the same `callId` applies the highest sequence and ignores the rest. This is what makes the
  "cancelled during the same second" edge case deterministic.
- Terminal events (`cancelled`, `answered_elsewhere`, `declined_elsewhere`, `ended`) carry
  `event`, `callId`, `organizationId` and `sequence` only.

---

## iOS — APNs VoIP push

Sent **directly to APNs**, not through FCM (FCM cannot carry VoIP pushes).

| Header | Value |
|---|---|
| `apns-push-type` | `voip` |
| `apns-priority` | `10` |
| `apns-topic` | `com.devguards.TechOffice.voip` |
| `apns-expiration` | the call's ring deadline as a unix timestamp, so a stale wake is dropped by APNs rather than by the app |
| `apns-collapse-id` | the `callId`, so a superseded wake replaces rather than queues behind its predecessor |

Body is the common payload at the top level of the JSON (no `aps` dictionary — VoIP pushes
carry no alert). Authentication is token-based (`.p8` key, JWT), refreshed on the interval
APNs requires.

**Failure handling**: APNs `410 Unregistered` marks the `push_token` row invalid, exactly as
an FCM `UNREGISTERED` does today. `429`/`5xx` are retried within the ring deadline and then
recorded as `failed`; there is no retry after the call is over.

---

## Android — FCM data-only message

```jsonc
{
  "token": "<fcm token>",
  "android": { "priority": "high", "ttl": "<seconds until ring deadline>" },
  "data": { /* common payload, all values stringified per FCM */ }
}
```

**`data` only — no `notification` block.** A `notification` message lets the system draw a
tray notification and may not run the app's handler on a killed app; a data-only
high-priority message always dispatches to the messaging service, which is what earns the
Doze temporary allowlist and the background foreground-service-start exemption
(research R2). This is a breaking change from today's payload, shipped atomically with the
mobile release.

The handler must reach `CallsManager.addCall` and post its call notification **within 5
seconds**, and every Telecom callback must complete within 5 seconds. No network round trip
belongs inside those windows — the payload above is deliberately self-sufficient, so the
device can ring without calling back to the server first.

---

## Tier-B fallback

A device recorded as not native-call capable keeps receiving **today's** notification: an FCM
message with the `voice-calls` Android channel at max importance, and on iOS an alert push at
`apns-priority: 10` with `interruption-level: time-sensitive`. That path is unchanged and
already shipped; this contract only decides which devices get which transport.

A device must never receive both tiers for the same call event.

---

## Caller-visible outcomes

The caller's client needs to distinguish these, so they are structured error details
(Constitution X), not message strings:

| Outcome | Meaning |
|---|---|
| `VOICE_CALLEE_UNREACHABLE` | no device could be woken — end the call now rather than ringing out (SC-006) |
| `VOICE_CALLEE_BUSY` | the callee is on another call, workspace or cellular |
| existing `VOICE_DIRECT_CONTACT_BLOCKED` | unchanged; still evaluated before any device is woken |
