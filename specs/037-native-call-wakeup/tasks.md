---

description: "Task list for 037-native-call-wakeup"
---

# Tasks: Time-Sensitive Call Wakeup & Native Call Experience

**Input**: Design documents from `/specs/037-native-call-wakeup/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Included and non-optional. Constitution principle II (Scenario-First Integration & E2E Testing) is NON-NEGOTIABLE, and [quickstart.md](./quickstart.md) already defines the scenario set. The device-matrix tasks in Phase 9 are release gates, not documentation — the headline behaviour (locked, cold-started phone ringing) cannot be proven by any automated test.

**Organization**: Grouped by user story. Phases 1–2 are blocking; Phases 3–7 map one-to-one to the spec's user stories.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US5)
- Exact file paths in every description

## Path Conventions

Mobile + API, per plan.md: Go backend under `backend/`, Expo app under `frontend/apps/mobile/`, shared client wrappers under `frontend/packages/apis/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Settle the riskiest unknown and put credentials and build config in place before any product code exists.

- [ ] T001 Throwaway spike: prove `expo-callkit-telecom` rings a locked, force-quit iPhone and Android device from a hand-rolled push, in a scratch branch — no product code, no merge. Record the result in `specs/037-native-call-wakeup/research.md` under a new "Spike outcome" heading. **This is the exit criterion for the epic**: if it fails, stop and re-plan on `react-native-callkeep` before starting T002
- [ ] T002 Add `expo-callkit-telecom@^0.4` to `frontend/apps/mobile/package.json` and register its config plugin in `frontend/apps/mobile/app.json`
- [ ] T003 [P] Add the VoIP background mode, the `com.devguards.TechOffice.voip` APNs topic and the CallKit entitlement to the iOS section of `frontend/apps/mobile/app.json`
- [ ] T004 [P] Add `android.permission.MANAGE_OWN_CALLS` and the calling foreground-service type plus its `FOREGROUND_SERVICE_*` permission to the Android section of `frontend/apps/mobile/app.json`
- [ ] T005 [P] Add `github.com/sideshow/apns2` to `backend/go.mod` and wire the VoIP `.p8` credential (key, key ID, team ID, topic) into `backend/cmd/server.go` following the existing `GOOGLE_APPLICATION_CREDENTIALS` pattern, logging loudly and degrading to tier B when unset
- [ ] T006 [P] Document the new APNs VoIP environment variables in `backend/docs/FCM-SETUP.md` (or a sibling `APNS-VOIP-SETUP.md` it links to)
- [ ] T007 Produce a development build of the mobile app and confirm it installs on one iOS and one Android device — the native module cannot run in Expo Go, so every later task depends on this working

**Checkpoint**: The spike has passed, the build carries the native module, and the backend can authenticate to APNs.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared vocabulary, schema and transport that every user story rides on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T008 Add the token type and native-call-capable fields to `RegisterPushTokenRequest` and `PushTokenInfo` in `backend/rpc/v1/notification.proto`, per [contracts/notification-proto-delta.md](./contracts/notification-proto-delta.md), and regenerate
- [ ] T009 [P] Define the call wake event kinds (`incoming`, `cancelled`, `answered_elsewhere`, `declined_elsewhere`, `ended`) and the push token types as shared constants in `backend/internal/notification/constants.go`, mirrored in `frontend/packages/apis/src/push-tokens.ts` — one definition per concept, per Constitution VIII
- [ ] T010 Write `backend/database/migrations/20260828000002_call_wake.up.sql`: widen `notification.delivery_attempt` channel CHECK to add `call_wake`, widen its reason CHECK to add `no_call_wake_target`, `native_tier_unavailable`, `call_already_ended`, add `voice.call_session.ring_deadline_at timestamptz NULL`, and update the affected column comments. Every change is additive (widened CHECKs, one nullable column), so the rollback posture is forward-only with no data rewrite — state that in the migration header, per Constitution VI. Regenerate `backend/database/scripts/schema.sql` from migrations — never hand-edit it
- [ ] T011 Extend `RegisterPushToken` in `backend/internal/notification/push_logic.go` to persist token type and native-call capability into `token_metadata`, allowing one row per type per `device_identifier` and keeping the existing duplicate cleanup scoped within a type
- [ ] T012 Implement the direct APNs VoIP provider in `backend/internal/notification/apns_voip.go`: HTTP/2 client, JWT auth with refresh, headers per [contracts/call-wake-payloads.md](./contracts/call-wake-payloads.md) (`apns-push-type: voip`, priority 10, expiration from the ring deadline, collapse ID from the call ID), and `410 Unregistered` marking the token row invalid
- [ ] T013 Implement the call wake dispatcher in `backend/internal/notification/call_wake.go`: resolve the callee's devices, pick tier A (VoIP for iOS, data-only FCM for Android) or tier B per device, emit the common payload with a per-call increasing `sequence`, and write one `delivery_attempt` row per device per event. Refuse to dispatch any notification type that is not a live call event
- [ ] T014 Add the `call_wake` delivery class to `backend/internal/notification/publisher.go` with a **zero** fallback window, and make it exempt from receipt-based cancellation — an SSE receipt must never cancel a ring (FR-002)
- [ ] T015 Exempt `call_wake` from DND and muted-domain suppression in `backend/internal/notification/routing_logic.go`, so `suppressed_by_preference` can never appear on a call wake row (FR-016)
- [ ] T016 Route `call_wake` rows from the rescue push worker in `backend/internal/notification/delivery.go` to the dispatcher instead of the FCM alert path, reusing the existing 1 s tick and batch claim
- [ ] T017 [P] Extend the **existing** mobile registration in `frontend/apps/mobile/src/hooks/use-push-notifications.ts` to register both tokens per device — FCM plus, on iOS, the PushKit VoIP token — under one shared `device_identifier`, with rotation and revoke covering every row for that device. Do not add a second registration path; `use-push-notifications.ts` stays the only place mobile registers tokens
- [ ] T018 [P] Surface token type and native-call capability through the client wrapper in `frontend/packages/apis/src/push-tokens.ts` — the module that actually owns `registerPushToken` (wrapper pattern only, no direct RPC from components, per Constitution VII)

- [ ] T019 Pass the new required token type from the web client in `frontend/apps/web/src/hooks/usePushPermission.ts` (`web_push`). **The token-type field is required, so web push registration breaks without this** — Constitution VI is satisfied by making the breaking change atomic across backend, web and mobile in one change set, not by defaulting the field

**Checkpoint**: A call event can reach a specific device on the right transport, and every attempt is auditable.

---

## Phase 3: User Story 1 — Answering a call from a locked phone (Priority: P1) 🎯 MVP

**Goal**: A locked, force-quit phone rings on the lock screen with the OS incoming-call UI and answers into working audio.

**Independent Test**: Lock a device, background the app, call from another account; the device rings within 5 s, shows the native screen, and answers into two-way audio without unlocking.

### Tests for User Story 1

- [ ] T020 [P] [US1] Integration test in `backend/integration/native_call_wakeup_test.go` (testWorld pattern, nested `t.Run` arrange/act/assert): a call to a person with two registered devices produces one `sent` `call_wake` row per device carrying the `incoming` payload
- [ ] T021 [P] [US1] Integration test in `backend/integration/native_call_wakeup_test.go`: the wake is dispatched even when the callee has a live SSE connection — the receipt must not cancel it
- [ ] T022 [P] [US1] Integration test in `backend/integration/native_call_wakeup_test.go`: calls answered, declined and missed through the native surface produce the same call records, chat system messages and missed-call visibility as in-app calls (FR-020) — three cases, including that the ring deadline sweep writes the same `voice_call_missed` message the webhook path writes
- [ ] T023 [P] [US1] Integration test in `backend/integration/native_call_wakeup_test.go`: two backend instances running the sweep concurrently end the call exactly once (Constitution XI)

### Implementation for User Story 1

- [ ] T024 [US1] Emit the `incoming` call wake from `backend/internal/voice/logic.go` when a call enters `ringing`, after the existing channel authorization and direct-contact block guard — nothing may be woken for a refused call (FR-018)
- [ ] T025 [US1] Set and clear `ring_deadline_at` on the `ringing` transition in `backend/internal/voice/logic.go`, using a **45-second** ring timeout defined once as a constant in `backend/internal/voice/constants.go` and carried to clients as `ringExpiresAt` in the wake payload
- [ ] T026 [US1] Implement the bounded ring timeout sweep in `backend/internal/voice/ring_timeout.go`: claim `ringing` calls past their deadline exclusively, end them `missed`, and publish the terminal wake. Reuse the existing scheduler; do not add a daemon
- [ ] T027 [US1] Implement wake receipt and call reporting in `frontend/apps/mobile/src/lib/voice/native-call.ts`: on every wake, report the call to the OS **first**, then act on the event kind. Present the native incoming UI for `incoming` showing only caller display name and workspace name (FR-008). The tier-A path owns its own navigation on answer and does **not** route through the `voice_call_incoming` special case in `frontend/apps/mobile/src/lib/linking.ts`, which stays the tier-B route only
- [ ] T028 [US1] Implement answer and decline handlers in `frontend/apps/mobile/src/lib/voice/native-call.ts`, joining the LiveKit room on answer and opening the in-call surface, and ending the call with a declined outcome on decline without opening the app. Keep every Telecom callback inside the 5 s budget — no network round trip inside a callback
- [ ] T029 [US1] Post the Android call notification within 5 s of `CallsManager.addCall` in `frontend/apps/mobile/src/lib/voice/native-call.ts`, before any awaited work
- [ ] T030 [US1] Handle a wake arriving with no valid workspace session in `frontend/apps/mobile/src/lib/voice/native-call.ts`: report the call, then end it immediately without ringing (FR-019)
- [ ] T031 [US1] Add structured logging for every wake received, reported, answered and ended in `frontend/apps/mobile/src/lib/voice/native-call.ts`, so a field report can be traced against the backend audit rows

**Checkpoint**: The headline scenario works end to end. This is the MVP — stop and run [quickstart.md](./quickstart.md) section C1 before continuing.

---

## Phase 4: User Story 2 — Managing an in-progress call from the phone's own controls (Priority: P1)

**Goal**: A connected call is visible and controllable from the lock screen and system controls, with audio routing that follows the device.

**Independent Test**: Answer a call, lock the phone, and mute, switch to speaker and hang up from the lock screen; each takes effect for the other party.

**⚠️ Ships with US1.** A call answered natively but only controllable in-app strands the user with no visible call and no way to hang up.

### Tests for User Story 2

- [ ] T032 [P] [US2] Maestro flow in `frontend/apps/mobile/.maestro/native-call/in-call-surface.yaml`: the in-app in-call surface mirrors muted state and closes when the call ends

### Implementation for User Story 2

- [ ] T033 [US2] Implement the audio session handoff in `frontend/apps/mobile/src/lib/voice/call-audio.ts`: the native framework owns the session, LiveKit carries media only. On iOS, do not let LiveKit activate `AVAudioSession` — start audio in the CallKit `didActivate` callback. On Android, leave routing to Telecom and use `STREAM_VOICE_CALL`; never call `setCommunicationDevice` or `startBluetoothSco`. **This is the highest-risk task in the epic** — the failure mode is a call that connects with no audio
- [ ] T034 [US2] Keep the OS call object alive for the whole call in `frontend/apps/mobile/src/lib/voice/native-call.ts`, so lock-screen and control-centre controls stay available
- [ ] T035 [US2] Wire system control actions (mute, speaker, hold, hang up) to the workspace call in `frontend/apps/mobile/src/lib/voice/native-call.ts`, and reflect workspace-side state changes back into the OS call object (FR-012)
- [ ] T036 [US2] Mirror system call state into the in-app surface in `frontend/apps/mobile/src/components/voice/active-voice-call-bar.tsx`
- [ ] T037 [US2] Handle Bluetooth connect and disconnect mid-call in `frontend/apps/mobile/src/lib/voice/call-audio.ts` without dropping the call

**Checkpoint**: A call can be lived with entirely from the phone's own controls.

---

## Phase 5: User Story 3 — Calls and the rest of the phone coexisting (Priority: P2)

**Goal**: Workspace calls behave correctly alongside cellular calls, a second workspace call, and the user's quiet-hours settings.

**Independent Test**: Call a device already on a cellular call, and a device with workspace notifications muted; each behaves per the spec's scenarios.

### Tests for User Story 3

- [ ] T038 [P] [US3] Integration test in `backend/integration/native_call_wakeup_test.go`: a wake is still dispatched when the callee has workspace DND active or the voice domain muted, and no row carries `suppressed_by_preference`
- [ ] T039 [P] [US3] Integration test in `backend/integration/native_call_wakeup_test.go`: a second call to a person already on a workspace call returns `VOICE_CALLEE_BUSY` and does not interrupt the first call
- [ ] T040 [P] [US3] Maestro flow in `frontend/apps/mobile/.maestro/native-call/permissions.yaml`: the permission education screen explains why, and the app stays usable when the permission is declined

### Implementation for User Story 3

- [ ] T041 [US3] Return `VOICE_CALLEE_BUSY` as a structured error detail from `backend/internal/voice/logic.go` when the callee is already on a workspace call, extending the existing voice error vocabulary (Constitution X)
- [ ] T042 [US3] Refuse to force-connect while the device is on another call in `frontend/apps/mobile/src/lib/voice/native-call.ts`, reporting the busy state per platform convention (FR-015)
- [ ] T043 [US3] Respect OS-level call silencing and never attempt to override it in `frontend/apps/mobile/src/lib/voice/native-call.ts` (FR-016)
- [ ] T044 [US3] Add permission education before requesting the native call permissions in `frontend/apps/mobile/src/lib/voice/native-call.ts`, at a point where the user understands why, leaving the app usable if declined (FR-017)

**Checkpoint**: The phone is a good citizen — no talked-over cellular calls, no 2am surprises, no overridden OS settings.

---

## Phase 6: User Story 4 — The caller knows what is happening (Priority: P2)

**Goal**: The caller sees ringing, answered, declined, busy or unreachable, and learns quickly when nobody can be reached.

**Independent Test**: Call a device that is powered off or has no reachable token; the caller sees an unreachable result within 10 s instead of ringing out.

### Tests for User Story 4

- [ ] T045 [P] [US4] Integration test in `backend/integration/native_call_wakeup_test.go`: a call to a person with no valid token ends promptly with `VOICE_CALLEE_UNREACHABLE` and audit reason `no_call_wake_target`
- [ ] T046 [P] [US4] Integration test in `backend/integration/native_call_wakeup_test.go`: when one device answers, `answered_elsewhere` goes to that person's other devices and to no one else

### Implementation for User Story 4

- [ ] T047 [US4] Return `VOICE_CALLEE_UNREACHABLE` as a structured error detail and end the call immediately when no device can be woken, in `backend/internal/voice/logic.go` (FR-006, SC-006)
- [ ] T048 [US4] Emit `answered_elsewhere` and `declined_elsewhere` wakes to the person's other devices on answer and decline, in `backend/internal/voice/logic.go` (FR-004)
- [ ] T049 [US4] Surface ringing, busy and unreachable states to the caller in `frontend/packages/apis/src/voice.ts` and the caller's in-call UI

**Checkpoint**: Callers stop re-dialling people who cannot be reached.

---

## Phase 7: User Story 5 — Calls do not become a spam or battery channel (Priority: P3)

**Goal**: The privileged wake path is used only for live calls, stops the moment the call is not live, and never leaves an orphaned call screen.

**Independent Test**: Cancel a call immediately after placing it; the callee's device either never rings or stops promptly with no lingering call screen.

**⚠️ On iOS this is a survival requirement, not hygiene** — since iOS 26, a VoIP push that does not report a call terminates the app.

### Tests for User Story 5

- [ ] T050 [P] [US5] Integration test in `backend/integration/native_call_wakeup_test.go`: no notification type other than a live call event is ever dispatched on the `call_wake` channel (FR-003)
- [ ] T051 [P] [US5] Integration test in `backend/integration/native_call_wakeup_test.go`: a caller cancelling before answer sends a `cancelled` wake, at a higher `sequence`, to exactly the devices that received `incoming`
- [ ] T052 [P] [US5] Integration test in `backend/integration/native_call_wakeup_test.go`: a call into a direct conversation where one party blocked the other is refused with `VOICE_DIRECT_CONTACT_BLOCKED` and writes **zero** `call_wake` rows

### Implementation for User Story 5

- [ ] T053 [US5] Emit the `cancelled` and `ended` wakes on every terminal path in `backend/internal/voice/logic.go` — caller cancel, remote hang-up, ring timeout, join failure — so no device is left ringing
- [ ] T054 [US5] Enforce report-then-end for every terminal event kind in `frontend/apps/mobile/src/lib/voice/native-call.ts`, mapping each to its OS end reason (unanswered, remote ended, answered elsewhere, declined elsewhere), including for a call the client has never seen (FR-013)
- [ ] T055 [US5] Apply `sequence` ordering and duplicate suppression per `callId` in `frontend/apps/mobile/src/lib/voice/native-call.ts`, so an out-of-order or repeated wake cannot resurrect a dead call
- [ ] T056 [US5] Drop a wake whose `ringExpiresAt` has passed in `frontend/apps/mobile/src/lib/voice/native-call.ts` — report and end rather than ring (US5 scenario 2)
- [ ] T057 [US5] Close the OS call when joining fails after an answer (network, capacity, revoked microphone permission) in `frontend/apps/mobile/src/lib/voice/native-call.ts`, showing the failure rather than leaving the call hanging

**Checkpoint**: Zero orphaned call screens, and the wake path cannot be used for anything but a call.

---

## Phase 8: Fallback Tier & Coverage

**Purpose**: The ~20% of devices that cannot run the native tier, and the measurement that tells us what the split actually is.

- [ ] T058 Record reason `native_tier_unavailable` and enforce the never-both-tiers guard for fallback devices in `backend/internal/notification/call_wake.go`. The tier-A/tier-B routing decision itself is implemented in T013 — do not re-implement it here
- [ ] T059 [P] Demote `frontend/apps/mobile/src/lib/voice/voice-notifications.ts` and `frontend/apps/mobile/src/components/voice/incoming-voice-call-prompt.tsx` to the tier-B path only, and tell the user plainly what they lose (FR-014)
- [ ] T060 [P] Maestro flow in `frontend/apps/mobile/.maestro/native-call/fallback-ring.yaml`: a not-native-capable device shows the tier-B prompt and can answer and decline from it
- [ ] T061 [P] Add first-run OEM battery-allowlist onboarding for Xiaomi, Huawei, Oppo, Vivo and Samsung devices in `frontend/apps/mobile/src/lib/voice/native-call.ts`, skippable, shown once
- [ ] T062 [P] Maestro flow in `frontend/apps/mobile/.maestro/native-call/battery-allowlist.yaml`: the onboarding step appears on an affected device profile and can be skipped
- [ ] T063 [P] Record in `specs/037-native-call-wakeup/plan.md` that FR-021 (system recent-calls surface) is **deliberately not implemented in this epic**: Jetpack Telecom's unified call history and `isLogExcluded` require Android 16.1 (SDK 36.1), far above this epic's API 26 floor. FR-021 is a MAY; revisit when the 16.1 install base justifies it
- [ ] T064 Add the tier-A share and SC-001/SC-004/SC-006 measurement queries from [quickstart.md](./quickstart.md) to `backend/docs/NOTIFICATION-SYSTEM-ARCHITECTURE.md`, so the ~80% target is read from audit data rather than guessed

---

## Phase 9: Device Matrix (Release Gate)

**Purpose**: Verify what no automated test can. Each task is a release gate; a failure blocks release rather than filing a bug.

- [ ] T065 Run [quickstart.md](./quickstart.md) C1 (locked, force-quit, Doze; ring, answer, decline, ring-out) on physical iOS and Android devices and record pass/fail per device, timing both the wake-to-ring interval (SC-001, ≤5 s) and the accept-to-audio interval (SC-002, ≤3 s)
- [ ] T066 [P] Run [quickstart.md](./quickstart.md) C2 (lock-screen mute, speaker, Bluetooth connect/disconnect, system hang-up) — the audio-session bug lives here
- [ ] T067 [P] Run [quickstart.md](./quickstart.md) C3 (cellular call in progress, second workspace call, OS-level call silencing)
- [ ] T068 Run [quickstart.md](./quickstart.md) C4: the 200-call zero-orphan soak across cancel, decline, timeout, remote hang-up, answered-elsewhere, offline-then-back, and answer-then-join-failure (SC-005)
- [ ] T069 Run [quickstart.md](./quickstart.md) C5 on an iOS 26+ development build: exercise every terminal event kind, including for a call the app has never seen, and confirm the app survives with no failed-to-report dialog. **Must pass before any App Store build**, where the same failure becomes a silent termination
- [ ] T070 [P] Run [quickstart.md](./quickstart.md) C6 on an aggressive-battery OEM device before and after the allowlist onboarding, and record the tier-A share

---

## Phase 10: Polish & Documentation

- [ ] T071 [P] Update `docs/domain/voice.md`: native call presentation, the ring deadline and its sweep, the terminal wake events, and the busy and unreachable outcomes. Delete behaviour that no longer exists
- [ ] T072 [P] Update `docs/domain/notifications-presence.md`: the `call_wake` delivery class, its zero window, its exemption from receipt cancellation and from DND suppression, the new `delivery_attempt` channel and reasons, and VoIP token rows
- [ ] T073 [P] Update `backend/docs/NOTIFICATION-SYSTEM-ARCHITECTURE.md` with the two-transport dispatch path and the tier-A/tier-B routing decision (Constitution XII)
- [ ] T074 [P] Record the drift register entry in `docs/domain/README.md` if any behaviour shipped differently from this spec
- [ ] T075 Confirm idle battery cost stays under 1%/day on a device receiving no calls (SC-009) and record the measurement

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: no dependencies. T001 gates everything — do not start T002 until the spike passes
- **Phase 2 (Foundational)**: depends on Phase 1. **Blocks all user stories**
- **Phase 3 (US1)**: depends on Phase 2
- **Phase 4 (US2)**: depends on Phase 3 — there is no in-call state to control until a call can be answered. Ships *with* US1, not after it
- **Phase 5 (US3)**, **Phase 6 (US4)**: depend on Phase 3; independent of each other and can run in parallel
- **Phase 7 (US5)**: depends on Phase 3; the terminal-event work in T053–T057 touches the same files as US1, so sequence it after Phase 4 to avoid conflicts
- **Phase 8 (Fallback)**: depends on Phase 2; can run in parallel with Phases 5–7
- **Phase 9 (Device Matrix)**: depends on Phases 3, 4 and 7 being complete
- **Phase 10 (Docs)**: depends on all shipped stories

### User Story Dependencies

- **US1 (P1)**: the foundation. Everything else assumes a call can ring and be answered
- **US2 (P1)**: depends on US1. Deliberately not independently shippable — see the Phase 4 warning
- **US3 (P2)**, **US4 (P2)**: independent of each other, both depend on US1
- **US5 (P3)**: depends on US1; hardening rather than new capability, but the iOS half is a survival requirement

### Within Each Story

Tests before implementation. Backend transport before mobile presentation. Core behaviour before edge cases.

### Parallel Opportunities

- Phase 1: T003, T004, T005, T006 in parallel after T002
- Phase 2: T008 → T009 first (proto, then the constants everything else mirrors); T017, T018 and T019 in parallel after them; T012–T016 are sequential through the dispatch path
- All test tasks within a phase marked [P] run in parallel
- Phases 5, 6 and 8 can be staffed in parallel once Phase 3 lands
- Phase 10 documentation tasks are all parallel

---

## Parallel Example: User Story 1

```bash
# Launch the US1 integration tests together:
Task: "Two-device wake fan-out test in backend/integration/native_call_wakeup_test.go"
Task: "SSE-receipt-does-not-cancel test in backend/integration/native_call_wakeup_test.go"
Task: "Answered/declined/missed record-parity test (FR-020) in backend/integration/native_call_wakeup_test.go"
Task: "Concurrent-sweep exactly-once test in backend/integration/native_call_wakeup_test.go"
```

---

## Implementation Strategy

### MVP scope

Phases 1, 2, 3 and 4. US1 alone is not shippable — a call that answers from the lock screen but can only be hung up inside the app is worse than no native integration. The MVP is **US1 + US2 together**, validated by quickstart C1 and C2.

### Incremental delivery

1. Phase 1 → the spike answers whether this epic is buildable as planned
2. Phase 2 → a call event can reach a device on the right transport
3. Phases 3 + 4 → **MVP**: ring, answer, live with the call. Validate on real devices, then demo
4. Phase 8 → the fallback tier, so the release is safe for every device
5. Phases 5, 6, 7 → coexistence, caller feedback, hardening
6. Phase 9 → the release gate
7. Phase 10 → domain snapshots and architecture docs

### Parallel team strategy

After Phase 3 lands: one developer on Phase 4 (audio session — give this to whoever is strongest on native), one on Phases 5 + 6, one on Phase 8. Phase 7 rejoins the Phase 4 developer, since it edits the same files.

---

## Notes

- [P] = different files, no dependencies on incomplete tasks
- `backend/database/scripts/schema.sql` is generated from migrations — regenerate it, never hand-edit
- The project takes no backward-compatibility burden: the Android payload change from notification to data-only and the required token-type field ship atomically across backend and mobile
- Two hard 5-second Android budgets (notification after `addCall`, and every Telecom callback) — no network round trip inside either
- Commit after each task or logical group; stop at any checkpoint to validate
