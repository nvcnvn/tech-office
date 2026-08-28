# Phase 0 Research: Time-Sensitive Call Wakeup & Native Call Experience

**Date**: 2026-08-28 | **Branch**: `037-native-call-wakeup`

Research was scoped by the user's direction: *use recent Android and iOS APIs, target ~80%
of common devices for this epic, and fall back to a simpler voice call for the rest.*

---

## R1 — iOS: how a call reaches a locked phone

**Decision**: APNs **VoIP push** (`apns-push-type: voip`, priority 10) delivered **directly
to APNs**, received by PushKit, reported immediately to **CallKit**.

**Rationale**: A normal alert push cannot present a full-screen incoming-call UI, cannot be
answered without unlocking, and cannot start audio in the background. Only PushKit + CallKit
does. Today `push_logic.go` already sends the best possible *alert* push for
`voice_call_incoming` — `apns-priority: 10` with `interruption-level: time-sensitive` — and
that is the ceiling of the alert path. The gap in the spec is exactly the gap between an
alert and a call.

**Hard constraint discovered — this shapes the whole design**: since **iOS 26**, any app
linked against the iOS 26 SDK that receives a VoIP push and *fails to report a call to
CallKit is terminated by the system*. The last unrestricted PushKit entitlement
(`com.apple.developer.pushkit.unrestricted-voip.ptt`) was disabled in the iOS 26 SDK.
iOS 26.4 adds a `didReceiveIncomingVoIPPushWithPayload` delegate carrying
`PKVoIPPushMetadata.mustReport`, which makes the obligation explicit per push.

Consequences we design to:

- A VoIP push may **only** be sent for a live call event (spec FR-003 is not a
  nice-to-have; violating it gets the app killed).
- Cancel / answered-elsewhere / ended must still be delivered as VoIP pushes, and the
  client must **report the call and then immediately end it** with the right
  `CXCallEndedReason` (`.unanswered`, `.remoteEnded`, `.answeredElsewhere`, `.declinedElsewhere`)
  rather than silently dropping the push. This is what makes spec FR-013 (no orphaned call
  screen) and US5 implementable at all.
- A wake arriving with no valid session (FR-019) still reports, then ends — it must not ring.

**Transport consequence**: **FCM cannot send VoIP pushes.** `apns-push-type: voip` is not a
value FCM will accept, and this has been a standing FCM limitation. The backend therefore
needs a **direct APNs HTTP/2 connection** for the iOS call path, alongside the existing
Firebase client for everything else.

**Alternatives considered**:
- *Keep the alert push, add `interruption-level: critical`* — critical alerts need a separate
  Apple entitlement, break through Do Not Disturb in a way FR-016 explicitly does not want,
  and still cannot present a call UI or answer without unlock. Rejected.
- *Live Activities / PTT framework* — PushToTalk is a different interaction model (channels,
  not calls) and is under the same iOS 26 reporting rules. Rejected as a mismatch.
- *LiveCommunicationKit* (iOS 17.4+) — Apple's newer sibling to CallKit. It is required for
  some regions/marketplaces and is the eventual direction, but the mature React Native
  tooling targets CallKit, and both are bound by the same PushKit rules. Recorded as a
  future migration, not this epic.

---

## R2 — Android: how a call reaches a locked phone

**Decision**: high-priority **FCM data-only message** → app's messaging service →
**`androidx.core:core-telecom` `CallsManager.addCall`** with a `CallStyle` notification
posted inside the 5-second budget.

**Rationale**: `core-telecom` (Jetpack Telecom) is Google's current, recommended VoIP surface
and supersedes writing a raw `android.telecom.ConnectionService`. It abstracts the platform
split for us — `ConnectionService` under the hood on API 33 and below, the modern
`CallControl`/foreground-service-types path on API 34+ — and it supports back to **API 26
(Android 8.0)**. It gives us the system call UI, audio routing (including Bluetooth), and
lock-screen controls that spec US2 requires, without us hand-writing per-version code.

Operational constraints that become tasks:

- `MANAGE_OWN_CALLS` permission; on API 34+ a declared foreground-service type plus the
  matching `FOREGROUND_SERVICE_*` permission.
- **Two 5-second budgets**: a notification must be posted within 5 s of `addCall`, and every
  callback (`onAnswerCall`, `onSetCallDisconnected`, `onSetCallActive`, `onSetCallInactive`)
  must complete within 5 s or Telecom tears the call down.
- The message must be **data-only**, not `notification`, so the app's handler runs
  deterministically on a killed app instead of the system drawing a tray notification.
  This is a change from today's `AndroidNotification{ChannelID: "voice-calls"}` payload.
- High-priority FCM grants a temporary Doze allowlist *and* the exemption that lets us start
  a foreground service from the background. Miss the window and we get
  `ForegroundServiceStartNotAllowedException`.
- Do **not** use `AudioManager#setCommunicationDevice` / `startBluetoothSco`; Telecom owns
  routing. Relevant because the LiveKit client also wants to manage audio — the two must be
  reconciled (see R4).

**Jetpack Telecom 1.1.0** adds unified call history, `isLogExcluded` on `CallAttributesCompat`,
and native dialer callback, but those features require **Android 16.1 (SDK 36.1)**. They map
to spec FR-021, which is already a MAY. Adopt opportunistically; do not gate the epic on them.

**Alternatives considered**:
- *Raw `ConnectionService`* — what `react-native-callkeep` does. More code, per-version
  branching, and Google's own guidance points at `CallsManager`. Rejected.
- *Full-screen intent notification without Telecom* — `USE_FULL_SCREEN_INTENT` is restricted
  to calling/alarm apps since Android 14 and gives no system in-call controls, no audio
  routing, no call-log integration. This is essentially the fallback tier we already ship.
  Rejected as the primary path, kept as the fallback.

---

## R3 — React Native / Expo integration

**Decision**: adopt **`expo-callkit-telecom`** (0.4.0, MIT, published 2026-06-16).

**Rationale**: It wraps CallKit and `androidx.core:core-telecom` behind one TypeScript API,
is built on the **Expo Modules API with a config plugin**, and is documented against
**Expo SDK 55 / React Native 0.83 with the New Architecture** — which is exactly this repo
(`expo ~55.0.11`, `react-native 0.83.4`). Its config plugin handles entitlements, background
modes, microphone permission, ringtone bundling and FCM service registration at prebuild,
and it parses APNs VoIP and FCM data payloads natively, so the cold-start case works without
JS-side glue. Its peer dependency `@livekit/react-native-webrtc` is already in the tree via
`@livekit/react-native ^2.10.2`. Minimum platforms: **iOS 15.1, Android API 26**.

**Risk, stated plainly**: it is a **0.x library** four months old. It sits on the P1 path.
Mitigations, in order: (1) the first work package is a throwaway spike that proves cold-start
ring on one real iPhone and one real Android before any product code is written; (2) it is
MIT, so forking is available if it stalls; (3) the tier-B fallback below means a failure
degrades to today's behaviour rather than to no calls.

**Alternatives considered**:
- *`react-native-callkeep` + `@config-plugins/react-native-callkeep`* — far more mature and
  widely deployed, but built on `ConnectionService` (the API `core-telecom` supersedes) and
  with no stated support for RN 0.83 / New Architecture. Kept as the documented escape hatch.
- *Write our own Expo native modules* — two native modules (Swift + Kotlin) plus a config
  plugin is thousands of lines of platform code we would then own forever, to reach the same
  place a maintained MIT library already reaches. Rejected.

---

## R4 — Reconciling Telecom/CallKit audio with LiveKit

**Decision**: the native call framework owns the **audio session and routing**; LiveKit owns
the **media stream only**. On iOS, LiveKit's WebRTC audio session must be configured for
CallKit (do not let it activate the `AVAudioSession` itself; start audio in
`provider(_:didActivate:)`). On Android, leave routing to Telecom and use
`STREAM_VOICE_CALL`.

**Rationale**: both frameworks want to own the audio session; whichever loses produces the
classic "call connects but nobody can hear" bug. This is the single highest-risk integration
point in the epic and gets its own work package and its own quickstart scenario.

---

## R5 — Device coverage and where the 80% target actually binds

**Decision**: target **iOS 15.1+ and Android API 26+** for the native tier (tier A), and keep
today's shipped alert-notification ring as tier B. Measure the 80% goal as *"≥80% of ring
attempts are served by tier A"*, not as an OS-version percentage.

**Rationale**: OS version is not the binding constraint. Android API 26+ is roughly 96% of
devices (April 2026 distribution puts API 30 at ~87% and API 33 at ~69%, so API 26 is well
above both), and iOS 15.1+ is close to universal. The library's own floors (iOS 15.1 /
API 26) therefore cost us almost nothing.

What actually costs the remaining share is behavioural, not versional:

| Reason a device falls to tier B | Mitigation |
|---|---|
| OEM battery killers (Xiaomi, Huawei, Oppo, Vivo, Samsung) suspend the app so the FCM data message never lands | First-run flow that detects the OEM and walks the user through battery allowlisting |
| User denied the phone-account / notification permission | Explain-then-request at a moment the user understands (FR-017), re-offer from settings |
| Region or build where the native call surface is unavailable | Tier B, with the honest in-app explanation FR-014 requires |
| Push token expired or never registered | Existing token refresh; audit row says `no_push_target` |

Because tier B is **what already ships today**, the fallback costs us no new code — only the
routing decision and the honest message. That is what makes an 80/20 split affordable.

---

## R6 — Getting the wake out immediately (spec FR-002)

**Decision**: give call wakes their own delivery class that the rescue-push worker dispatches
with a **zero fallback window and no receipt-based cancellation**, rather than building a
second delivery pipeline.

**Rationale**: `PublishNotification` deliberately performs no push I/O inline — that was a
fix for FCM stalling the publishing transaction, and it should not be undone. The existing
rescue worker already ticks every 1 s, already supports a zero window for recipients judged
unreachable, and already writes the `delivery_attempt` audit rows that FR-005 asks for. A
call wake is the same queue with three differences: window is always 0, an SSE receipt must
**not** cancel it (the phone should ring natively even when a tab is open), and personal
DND/muted-domain suppression must not apply (FR-016). Worst case the ring starts one worker
tick (≤1 s) after commit, comfortably inside the 5 s of SC-001.

**Alternatives considered**:
- *Send inline from `PublishNotification`* — reintroduces the exact transaction-stall bug the
  current design was written to fix. Rejected.
- *A separate call-signal dispatcher with its own table and its own tick* — a second copy of
  a worker that already exists, plus a second audit trail to reconcile when debugging "my
  phone never rang". Rejected; the whole value of `delivery_attempt` is that it is one place.

---

## R7 — Server-authoritative ring timeout

**Finding**: there is **no ring timeout today**. A `ringing` call ends when LiveKit emits
`room_finished` and `inferWebhookOutcome` decides it was missed. With no participant ever
joining, nothing bounds the ring. Spec US1 scenario 5 and SC-006 both require one.

**Decision**: add a bounded sweep over `voice.call_session WHERE state = 'ringing' AND
ring_deadline_at < now()` that ends the call as `missed` and publishes the end-of-call wake.
Reuse the existing scheduler rather than adding a new daemon.

**Ring timeout: 45 seconds.** The spec requires a bounded ring but names no value. 45 s is the
conventional VoIP ring length — long enough to reach a phone in a pocket, short enough that a
caller is not left listening to a ring nobody will answer. Defined once in
`backend/internal/voice/constants.go` and carried to clients as `ringExpiresAt`.

---

## R8 — What does *not* change

Confirmed against `docs/domain/voice.md` and the code: the call state machine, the
one-live-call-per-channel partial unique index, `voice.call_participant` /
`call_invitation`, the LiveKit webhook reconciliation, chat system messages
(`voice_call_started` / `_ended` / `_missed` / `_cancelled`), the direct-conversation block
guard in `StartVoiceCall`, recordings and transcripts. This epic changes **how a call reaches
and is presented on a device**, not what a call is — matching the spec's first assumption.

---

## Sources

- [Core-Telecom — Android Developers](https://developer.android.com/develop/connectivity/telecom/voip-app/telecom)
- [Bring Native Visibility to Your VoIP App Experience with Telecom's Latest Alpha — Android Developers Blog](https://android-developers.googleblog.com/2026/05/voip-native-visibility-telecom-alpha.html)
- [Restrictions on starting a foreground service from the background — Android Developers](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)
- [Set and manage Android message priority — Firebase](https://firebase.google.com/docs/cloud-messaging/android-message-priority)
- [CallKit and PushToTalk related changes in iOS 26 — Apple Developer Forums](https://developer.apple.com/forums/thread/787466)
- [CallKit — Apple Developer Documentation](https://developer.apple.com/documentation/CallKit)
- [Migrate a calling app from CallKit to LiveCommunicationKit](https://www.theswift.dev/posts/migrate-a-calling-app-from-callkit-to-livecommunicationkit/)
- [expo-callkit-telecom](https://expo-callkit-telecom.mfairley.com/) and [vs. callkeep](https://github.com/mfairley/expo-callkit-telecom/blob/main/docs/vs-callkeep.md)
- [react-native-callkeep](https://github.com/react-native-webrtc/react-native-callkeep) / [@config-plugins/react-native-callkeep](https://www.npmjs.com/package/@config-plugins/react-native-callkeep)
- [sideshow/apns2](https://github.com/sideshow/apns2)
- [API Levels — cumulative Android usage](https://apilevels.com/)
