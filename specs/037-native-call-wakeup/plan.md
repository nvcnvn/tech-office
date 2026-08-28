# Implementation Plan: Time-Sensitive Call Wakeup & Native Call Experience

**Branch**: `037-native-call-wakeup` | **Date**: 2026-08-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/037-native-call-wakeup/spec.md`

## Summary

Make an incoming workspace call behave like a phone call on the device. Two transports
replace the single alert-notification path used today: **APNs VoIP push → PushKit → CallKit**
on iOS, and **high-priority FCM data message → `androidx.core:core-telecom` `CallsManager`**
on Android. Both are driven from a new `call_wake` delivery class that the existing rescue
push worker dispatches with a zero window and no receipt-based cancellation, so the ring is
never artificially delayed or suppressed. On the client, one library
(`expo-callkit-telecom`) owns both platforms' call UI and audio session; LiveKit is demoted
to carrying media only. Devices that cannot run the native tier fall back to today's
already-shipped high-priority ring, which is why the ~80/20 split costs no extra code.

**Vocabulary**: *tier A* is the native call path introduced here; *tier B* is the existing
high-priority ring the spec describes in FR-014. These names are used throughout the plan,
tasks and quickstart as shorthand for those two spec concepts.

The call state machine, call records, invitations, chat system messages and the
direct-conversation block guard are untouched. **No new database tables** — the existing
`notification.push_token` carries VoIP tokens through its `token_metadata`, and
`notification.delivery_attempt` is the per-device audit FR-005 asks for, once its channel
and reason CHECKs are widened.

## Technical Context

**Language/Version**: Go 1.x (backend); TypeScript / React Native 0.83.4 on Expo SDK 55
(mobile); Swift and Kotlin only inside the adopted native module's config plugin surface

**Primary Dependencies**:
- New backend: `github.com/sideshow/apns2` (direct APNs HTTP/2, token-based `.p8` auth) —
  required because FCM cannot carry `apns-push-type: voip`
- New mobile: `expo-callkit-telecom@^0.4` (CallKit + `androidx.core:core-telecom`, MIT)
- Existing and unchanged: `firebase.google.com/go` (all non-call push), `@livekit/react-native`,
  `@react-native-firebase/messaging`, `expo-notifications` (tier-B fallback ring)

**Storage**: PostgreSQL (Citus). Schema change is limited to widening two CHECK constraints
on `notification.delivery_attempt` and adding one nullable column to `voice.call_session` for
the ring deadline. No new tables.

**Testing**: Go integration tests under `backend/integration/` using the `testWorld` pattern;
Maestro flows for the mobile app; manual device matrix for the parts no emulator can prove
(locked screen, cold start, Bluetooth routing, OEM battery killers)

**Target Platform**: iOS 16.4+, Android API 26+ for the native tier; every other device on
the existing fallback ring. (Planned as iOS 15.1; corrected during implementation — see
Deviations, item 6.)

**Project Type**: Mobile + API — Go backend, Expo mobile app, existing web client unchanged

**Performance Goals**: ring begins ≤5 s after the caller places the call (SC-001); answer to
audio ≤3 s (SC-002); system-control actions propagate ≤2 s (SC-007); unreachable verdict
≤10 s (SC-006); **ring timeout 45 s** — the spec requires a bounded ring but names no value,
so 45 s is chosen as the conventional VoIP ring length and defined once in
`backend/internal/voice/constants.go`

**Constraints**: two hard 5-second platform budgets on Android (notification after `addCall`,
and every Telecom callback); iOS 26 terminates the app if a VoIP push does not report a call;
push I/O must stay out of the publishing transaction; idle battery cost <1%/day (SC-009)

**Scale/Scope**: one new backend dispatch path, one new backend push provider, one mobile
call-integration layer, ~8 work packages. Existing call volumes; no new fan-out.

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1 design.*

| Principle | Status | Note |
|---|---|---|
| I. Data Governance & Multi-Tenancy | ✅ PASS | No new tables. Both touched tables are already org-scoped; every query keeps `organization_id` in the predicate. VoIP tokens are rows in the existing distributed `notification.push_token`. |
| II. Scenario-First Integration & E2E Testing | ✅ PASS | Spec's five user stories become the shared scenario set; backend integration tests cover wake dispatch, ring timeout, cancel and answered-elsewhere. **Declared limit**: no automated test can prove a locked-screen cold-start ring — that is a documented manual device-matrix gate, listed in `quickstart.md`, not an untested claim. |
| III. Two-Layer Service Architecture & Proto-Level Authorization | ✅ PASS | Wake dispatch lives in `internal/notification` logic; `RegisterPushToken` gains a token-type field and keeps `notif.managePushToken`. No new RPC bypasses proto-level authz. |
| IV. Cross-Domain Integration | ✅ PASS | `internal/voice` continues to publish through `internal/notification` and never learns about APNs or Telecom. The ring timeout sweep stays inside voice. No new cross-domain table reads. |
| V. Observability, Simplicity & YAGNI | ✅ PASS | Deliberately reuses the rescue worker, `delivery_attempt` and `push_token` instead of adding a parallel pipeline. Every wake attempt is logged and auditable. |
| VI. Versioning & Breaking Changes | ✅ PASS | Two breaking changes: the Android payload moves from a notification message to a data-only message, and the push-token type field becomes required. Atomicity is what satisfies this principle, so the change set covers **all three** registration call sites — backend, mobile (`use-push-notifications.ts`) and web (`usePushPermission.ts`). Schema changes are additive, so the rollback posture is forward-only with no data rewrite. |
| VII. Frontend API Wrapper Pattern | ✅ PASS | Token registration continues through `packages/apis`; no direct RPC calls from components. |
| VIII. Cross-Stack Constant Synchronization | ⚠️ ATTENTION | New shared vocabulary — push token types, call wake event kinds, call end reasons — must be defined once in proto and mirrored to `packages/apis`, not restated per platform. Called out as its own work package. |
| IX. UUID v7 & Nullable Cursor Params | ✅ PASS | No new identifiers or paginated surfaces. |
| X. Structured Error Details | ✅ PASS | "Callee busy" and "could not be reached" are caller-visible outcomes and need structured error details, not bare strings — extends the existing voice error vocabulary. |
| XI. Distributed-First Architecture | ✅ PASS | Dispatch runs on the existing worker on every instance, claiming rows from the shared queue; the ring-timeout sweep must use the same claim pattern so two instances cannot both end a call. Explicitly checked in the sweep's design. |
| XII. Living Documentation | ✅ PASS | `docs/domain/voice.md` and `docs/domain/notifications-presence.md` both change behaviour here and must be updated in the same change set, plus `backend/docs/NOTIFICATION-SYSTEM-ARCHITECTURE.md`. Enforced by the mandatory `speckit.docs.snapshot` hook after implement. |
| XIII. Mobile Design & Testing (Expo + Maestro) | ⚠️ ATTENTION | Native call UI is drawn by the OS and is **not reachable by Maestro**. Maestro covers what remains in-app (in-call surface, permission education, fallback ring); the native surface is covered by the manual device matrix. This is a scope statement, not a waiver. |

**Gate result: PASS.** Two ⚠️ items are scope/vigilance notes with named owners in the work
breakdown, not unjustified violations. Nothing is recorded in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/037-native-call-wakeup/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── call-wake-payloads.md
│   └── notification-proto-delta.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Created by /speckit-tasks, not here
```

### Source Code (repository root)

```text
backend/
├── rpc/v1/
│   └── notification.proto              # token_type on RegisterPushToken; PushTokenInfo
├── internal/notification/
│   ├── push_logic.go                   # split: FCM provider stays, call wakes route out
│   ├── call_wake.go                    # NEW — call wake dispatcher, per-device fan-out
│   ├── apns_voip.go                    # NEW — direct APNs HTTP/2 VoIP provider
│   ├── publisher.go                    # zero-window, non-cancellable call_wake class
│   ├── routing_logic.go                # call wakes exempt from DND / muted-domain suppression
│   └── delivery.go                     # rescue worker routes call_wake to the dispatcher
├── internal/voice/
│   ├── logic.go                        # emit wake events on ring/cancel/answer/end
│   └── ring_timeout.go                 # NEW — bounded sweep ending unanswered ringing calls
├── database/migrations/
│   └── 2026MMDD000001_call_wake.up.sql # widen delivery_attempt CHECKs; ring deadline column
└── integration/
    └── native_call_wakeup_test.go      # NEW

frontend/
├── packages/apis/src/
│   ├── push-tokens.ts                  # token registration carries token type
│   └── voice.ts                        # busy / unreachable outcomes surfaced to the caller
├── apps/web/src/hooks/
│   └── usePushPermission.ts            # passes the now-required token type
└── apps/mobile/
    ├── app.json                        # expo-callkit-telecom plugin, entitlements, FGS types
    ├── src/lib/voice/
    │   ├── native-call.ts              # NEW — wake → report → join → end, both platforms
    │   ├── call-audio.ts               # NEW — CallKit/Telecom owns session, LiveKit media only
    │   └── voice-notifications.ts      # demoted to the tier-B fallback ring
    ├── src/hooks/
    │   └── use-push-notifications.ts   # existing registration, extended with the VoIP token
    └── src/components/voice/
        ├── incoming-voice-call-prompt.tsx  # fallback tier only
        └── active-voice-call-bar.tsx       # mirrors system call state
```

**Structure Decision**: Mobile + API. The backend change is contained to
`internal/notification` (transport) and `internal/voice` (ring lifecycle); the mobile change
is contained to `src/lib/voice`, `src/lib/push` and the Expo config. The web client is not
touched beyond receiving the existing call-ended events.

## Implementation Sequence

Ordered so the riskiest unknown is settled before anything is built on it.

1. **Spike (throwaway)** — prove `expo-callkit-telecom` rings a locked, cold-started iPhone
   and Android device against a hand-rolled push. Exit criterion for the whole epic; if it
   fails, fall back to `react-native-callkeep` before writing product code.
2. **Shared vocabulary** — proto and `packages/apis` definitions for token types, wake event
   kinds and call end reasons (Constitution VIII).
3. **Backend transport** — APNs VoIP provider, `call_wake` delivery class, zero-window
   non-cancellable dispatch, per-device audit rows, migration.
4. **Backend lifecycle** — ring timeout sweep, cancel / answered-elsewhere / ended wakes,
   busy and unreachable outcomes for the caller.
5. **Mobile ring** — receive wake, report the call, present native UI, answer and decline.
6. **Mobile in-call** — audio session handoff to LiveKit, system controls, end-of-call
   teardown in every direction (US2, FR-013).
7. **Coexistence and fallback** — cellular-call and second-call behaviour, permission
   education, OEM battery-allowlist onboarding, tier-B routing and its honest message.
8. **Docs and domain snapshots** — `docs/domain/voice.md`,
   `docs/domain/notifications-presence.md`, `backend/docs/NOTIFICATION-SYSTEM-ARCHITECTURE.md`.

## Deferred from this epic

**FR-021 (system-level recent-calls surface)** is not implemented here. Jetpack Telecom's
unified call history and `isLogExcluded` require **Android 16.1 (SDK 36.1)**, far above this
epic's API 26 floor, and the iOS equivalent carries its own privacy surface. FR-021 is a MAY
in the spec; revisit when the 16.1 install base justifies the work. Recorded here rather than
left as a silently uncovered requirement.

## Deviations recorded during implementation

Design decisions that differ from what this plan, `data-model.md` or `contracts/` said
before the code existed. Recorded here rather than left to be rediscovered from a diff.

**1. `push_token.token_type` is a real column, not a `token_metadata` key.**
`data-model.md` put the token type in the existing JSONB. That is not possible: the type
is part of the row's identity, because `push_token_unique` had to widen from
`(organization_id, employee_id, device_identifier)` to include it so a device can hold its
FCM *and* its VoIP token at once. A uniqueness key cannot live in JSONB under Citus. The
column is CHECK-constrained and `token_metadata.tokenType` is retired, so a token's type
has one definition rather than two.

**2. The call wake payload uses the client module's envelope, not the flat shape in
`contracts/call-wake-payloads.md`.** `expo-callkit-telecom` parses the push and reports
the call to the OS *before JavaScript runs* — that native parsing is the entire reason a
locked, force-quit phone rings — and it only recognises an event nested under an
`incomingCall` key with its own field names. Every wake, terminal ones included, is
therefore shaped as an incoming-call event; our fields ride in the module's opaque
`metadata` pass-through and the client decides from `metadata.event` whether to ring or to
end. Field *meanings* are unchanged; only nesting differs. On iOS this also matters for
survival: a VoIP push the module cannot parse is reported as a *failed* call, which the
user sees as a phantom missed call on every cancel.

**3. `answered_elsewhere` fans out to all of a person's devices, including the one that
answered.** The contract says "that person's other devices". The backend knows which
*person* answered, not which handset — an answer arrives over an RPC that carries no
device identifier. Adding one would mean a proto change on `JoinVoiceCall` for a problem
the client already solves: the answering device recognises the call it is in and ignores
the wake. Device-level exclusion is the client's job (`native-call.ts`), person-level
fan-out is the server's.

**4. An unreachable callee is refused before the call session exists.** FR-006 asks for an
immediate unreachable verdict rather than a 45-second ring, and `StartVoiceCall` returns
`VOICE_CALLEE_UNREACHABLE` before creating the row. The consequence, stated plainly: no
call record and no missed-call system message is written, so the callee never learns
anyone tried. Creating the call and ending it inside the same transaction would not help —
returning an error rolls the transaction back. Changing this needs a deliberate decision
about whether an unreachable callee should still see a missed call.

**5. "Unreachable" counts live connections, not only push tokens.** A person sitting in
front of an open browser with no registered device is reachable over SSE, and refusing
that call would be wrong to both parties. The check is: no valid push token **and** no
responsive live connection.

**6. The iOS floor is 16.4, not the 15.1 this plan assumed.** `expo-callkit-telecom`'s
README says iOS 15.1; its **podspec says `:ios => '16.0'`**. CocoaPods silently *skips* a
pod whose platform requirement exceeds the project's deployment target, so the module
linked into nothing, the app built cleanly, and the only symptom would have been a phone
that never rings. The app now sets `ios.deploymentTarget: "16.4"` through
`expo-build-properties` — 16.4 because Expo SDK 55 refuses an explicit target below it.
Same device set as 16.0 (iPhone 8 and later), so the cost is iPhone 6s/7/SE-1st-gen.
Details and the escape hatch are in `research.md` under R3.

**FR-021 (system recent-calls surface) is deliberately not implemented in this epic.**
Jetpack Telecom's unified call history and `isLogExcluded` require **Android 16.1
(SDK 36.1)**, far above this epic's API 26 floor. FR-021 is a MAY; revisit when the 16.1
install base justifies the work. This restates the "Deferred from this epic" section
above as an implementation-time confirmation, not a new decision.

## Risks

| Risk | Impact | Response |
|---|---|---|
| `expo-callkit-telecom` is 0.4.0 and four months old | P1 path depends on it | Spike first; MIT so forkable; `react-native-callkeep` documented as the escape hatch |
| iOS 26 terminates the app if any VoIP push does not report a call | App killed in the field | Backend sends VoIP pushes only for live call events; client always reports then ends. Covered by an explicit test scenario |
| CallKit/Telecom and LiveKit both want the audio session | Call connects with no audio | Dedicated work package and quickstart scenario; native side owns the session, LiveKit owns media |
| OEM battery killers suppress the FCM data message | Ring never arrives on some Android devices | First-run allowlist onboarding; audit row records it; tier-B does not rescue this case and the plan says so |
| Two hard 5-second Android budgets | Telecom tears the call down | Do no network work inside the callbacks; post the notification before any await |
| New APNs credential (`.p8`) and a second push provider to operate | Ops surface grows | Reuse the existing secrets pattern; the provider degrades to tier-B and logs loudly when unconfigured, exactly as the FCM client does today |

## Complexity Tracking

No Constitution Check violations to justify — this section is intentionally empty.
