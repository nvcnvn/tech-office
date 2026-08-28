# Quickstart: Validating Time-Sensitive Call Wakeup

**Date**: 2026-08-28 | **Branch**: `037-native-call-wakeup`

How to prove this feature works. Read [contracts/call-wake-payloads.md](./contracts/call-wake-payloads.md)
for payload shapes and [data-model.md](./data-model.md) for the state rules referenced below.

The honest framing first: **the headline behaviour cannot be proven by an automated test.**
No emulator, and no Maestro flow, can demonstrate a locked, cold-started phone ringing on the
lock screen. Sections A and B are automatable and gate CI. Section C is a manual device matrix
that gates release. Section C is not optional and not a formality — it is where this feature
actually gets verified.

---

## Prerequisites

| Requirement | Why |
|---|---|
| Apple developer account with a **VoIP services `.p8` key** and the `com.devguards.TechOffice.voip` APNs topic | VoIP pushes are a separate credential from the existing FCM/APNs setup |
| Firebase project already configured (`GOOGLE_APPLICATION_CREDENTIALS`) | routine notifications and the Android call transport |
| A **development build** of the mobile app — not Expo Go | the native call module requires custom native code |
| An iPhone running **iOS 16.4 or later** | the call module's podspec requires it; below that CocoaPods silently drops the module and the app builds fine but never rings |
| Two physical devices per platform, on the same organization, plus a second account to call from | answered-elsewhere and multi-device ring-stop cannot be tested with one device |
| Local LiveKit via `make voice-dev-infra-up` | media plane |

Backend config: the APNs VoIP credential follows the existing secrets pattern. When it is
absent, the backend logs loudly and every iOS device routes to tier B — the same degradation
the FCM client already has when unconfigured. That is itself a scenario worth exercising once.

---

## A. Backend integration tests (CI gate)

Run: `cd backend && go test ./integration/ -run NativeCallWakeup -v`

Written in the `testWorld` pattern with nested `t.Run` arrange/act/assert, with the push
providers faked so the assertions are about *what the backend decided*, not about Apple's or
Google's availability.

| Scenario | Asserts |
|---|---|
| Call to a person with two registered devices | one `call_wake` `delivery_attempt` row per device, both `sent`, both with the `incoming` payload |
| Call while the callee has a live SSE connection | the wake is still dispatched — an SSE receipt must **not** cancel it (FR-002) |
| Call while the callee has workspace DND active or the voice domain muted | the wake is still dispatched, and no row carries `suppressed_by_preference` (FR-016) |
| Call to a person with no valid token | call ends promptly with `VOICE_CALLEE_UNREACHABLE`, audit reason `no_call_wake_target` (FR-006, SC-006) |
| Call answered, declined or missed through the native surface | the same call records, chat system messages and missed-call visibility as an in-app call (FR-020) |
| Caller cancels before answer | a `cancelled` wake goes to every device that received `incoming`, with a higher `sequence` |
| One device answers | `answered_elsewhere` goes to the person's other devices and to no one else (FR-004) |
| Ring deadline passes with no answer | the sweep ends the call `missed`, publishes `ended`, and writes the `voice_call_missed` chat system message — the same one the webhook path writes |
| Two backend instances run the sweep concurrently | the call is ended exactly once (Constitution XI) |
| Call into a direct conversation where one party blocked the other | refused with `VOICE_DIRECT_CONTACT_BLOCKED` and **zero** `call_wake` rows — nothing was woken (FR-018) |
| Any non-call notification type | never dispatched on the `call_wake` channel (FR-003) |

The last two are the ones to keep an eye on in review: the first proves the block guard still
runs before the transport, the second is the rule that keeps the iOS app from being terminated.

---

## B. Mobile automated coverage (CI gate)

Maestro reaches the app's own surfaces, not the OS call UI. Flows:

- permission education screen appears, explains why, and the app stays usable when declined
  (FR-017)
- the OEM battery-allowlist onboarding step appears on an affected device profile and can be
  skipped
- a device marked not-native-capable shows the tier-B incoming call prompt and can answer and
  decline from it (FR-014)
- the in-call surface mirrors muted state and ends when the call ends

Run: `cd frontend/apps/mobile && maestro test .maestro/native-call/`

---

## C. Manual device matrix (release gate)

Each row is performed on a **physical** device with a development or TestFlight build. Record
pass/fail per device; a failure here blocks release regardless of CI.

### C1 — The headline (US1)

1. Sign in, grant permissions, confirm both token rows exist via `ListPushTokens`.
2. Force-quit the app. Lock the device. Put it in a pocket for two minutes so it enters Doze.
3. Call from the second account.
4. **Expect**: the device rings audibly within 5 seconds and shows the OS incoming-call screen
   with the caller's name and the workspace name — and nothing else (FR-008). Time this: it is
   the SC-001 measurement.
5. Answer from the lock screen without unlocking. **Expect**: two-way audio within 3 seconds of
   accepting (SC-002 — time this too), and the app opens to the in-call surface.

Repeat with decline (caller sees declined, conversation shows the record) and with no action
(rings out after the 45-second ring timeout, ends missed, missed call visible in the
conversation).

### C2 — In-call from the phone's own controls (US2)

Answer, then lock the phone. Mute from the lock screen and confirm the other side stops
hearing you and the app's in-call surface shows muted. Switch to speaker. Connect and
disconnect a Bluetooth headset mid-call — audio follows, the call does not drop. Hang up from
the system controls and confirm the call ends for both parties.

**This is where the audio-session bug lives.** If audio is silent after answering from the
lock screen, the native framework and LiveKit are fighting over the session (research R4).

### C3 — Coexistence (US3)

- Be on a cellular call, receive a workspace call: it is not force-connected; the caller sees
  the callee as busy or unanswered.
- Be on a workspace call, receive a second: the second caller is told busy, the first call is
  not interrupted.
- Silence calls at the OS level, receive a call: the workspace does not override it (FR-016).

### C4 — Zero orphaned call screens (SC-005)

The soak that catches the worst class of bug. Across at least 200 calls, in a mix of: caller
cancels immediately, callee declines, ring times out, remote party hangs up, callee answers on
another device, device is offline during the call and comes back after it ended, and answer
followed by an immediate join failure.

**Expect**: within 5 seconds of each call ending, no device shows an incoming or in-progress
call. Any orphan is a release blocker, not a bug to file.

### C5 — iOS 26 termination rule

On an iOS 26+ device with a development build, exercise every terminal event kind
(`cancelled`, `answered_elsewhere`, `declined_elsewhere`, `ended`) including for a call the app
has never seen. **Expect**: the app is still running afterwards and no diagnostic dialog about
failing to report a call appears. Those dialogs only show on development and TestFlight builds
— which is exactly why this must be exercised before an App Store build, when the same failure
becomes a silent termination.

### C6 — The 80/20 boundary

On a device from an OEM with aggressive battery management (Xiaomi, Huawei, Oppo, Vivo,
Samsung), run C1 both before and after completing the battery-allowlist onboarding. Record
which devices need it. This is the measurement behind the epic's ~80% target — the number that
matters is the share of ring attempts served by the native tier, read from the `call_wake`
audit rows, not the OS version spread.

---

## Measuring the success criteria

All from the `delivery_attempt` audit joined to `voice.call_session`:

| Criterion | Query shape |
|---|---|
| SC-001 ring within 5 s | `sent_at` on the `call_wake` row minus the call's `started_at`, p95 |
| SC-004 calls never presented | calls with zero `sent` `call_wake` rows ÷ total calls |
| SC-006 unreachable within 10 s | time from `started_at` to `ended_at` for calls ending `VOICE_CALLEE_UNREACHABLE` |
| tier-A share (the ~80% target) | `call_wake` rows ÷ (`call_wake` + tier-B `push` rows) for call notification types |

SC-002 and SC-003 are timed in C1, SC-005 in C4, SC-007 in C2 and SC-009 in a separate idle
soak; SC-008 is read from support volume four weeks after release.
