# Voice

Channel-scoped voice calls, voice messages, recordings and transcripts. Owned by
`internal/voice`; contract in `rpc/v1/voice.proto` (`VoiceService`, 12 RPCs).

**Status date: 2026-08-29.** Supersedes specs 032 and 037. Deeper reference:
`backend/docs/VOICE-COMMUNICATION-ARCHITECTURE.md`.

## Split of responsibility

- **Postgres (`voice` schema)** owns the business record: who called whom, when, outcome,
  artefacts.
- **LiveKit** owns the media plane only — room transport, WebRTC signalling, participant
  media, egress recording. It is never the source of truth for call state.
- **Notification SSE** is the discovery plane — ringing, active-call banners, state
  refreshes, post-call record refreshes.

Every call is anchored to a `chat.channel`, so a "call" is always a call *in a channel*
(including a DM channel for a 1:1 call).

## Call lifecycle

`voice.call_session` state machine:

```
ringing ──▶ active ──▶ ending ──▶ ended
   └──────────────────────────────▶ ended   (missed / declined / cancelled)
```

`state IN ('ringing','active','ending','ended')`; `outcome IN ('answered','missed',
'declined','cancelled','completed')`, NULL until ended. A CHECK enforces that
`state = 'ended'` implies both `outcome` and `ended_at` are set.

`ring_deadline_at` bounds the ring. It is set on the transition into `ringing` — start
plus `voice.RingTimeout`, **45 seconds** — and is NULL in every other state. Before spec
037 nothing bounded a ringing call: it ended only when LiveKit reported the room
finished, and with no participant ever joining that report never came.

A partial unique index —
`(organization_id, channel_id) WHERE state IN ('ringing','active','ending')` — enforces
**at most one live call per channel** at the database level, not in application code.
`livekit_room_name` is likewise unique per org, and the org ID is recoverable from the room
name (`organizationIDFromLiveKitRoomName`), which is how webhooks resolve their tenant.

RPCs: `StartVoiceCall`, `GetActiveVoiceCall`, `JoinVoiceCall`, `LeaveVoiceCall`,
`EndVoiceCall`, `InviteToVoiceCall`, `RespondToVoiceCallInvite`, `ListCallRecords`,
`GetCallRecord`. All gated on `chat.voiceCall`.

Supporting tables: `voice.call_participant` (states `invited → ringing → joining → joined
→ disconnected | left | declined | removed`), `voice.call_invitation` (`pending |
accepted | declined | expired | revoked`, FK to the `notification.notification` row that
rang the invitee).

## Ending a call tears down the room

`Logic.endCall` deletes the LiveKit room as well as writing the terminal record. This is
deliberate redundancy: `voice_call_ended` is published with `DeliveryClassLiveOnly`, so it
is never persisted and never replayed. A client whose stream happened to be down at the
moment the call ended — a backgrounded phone, a network blip, a web tab on another screen
— would never learn, and would sit in a room nobody else can join with the UI still
showing a call in progress and nothing left to end it. Room deletion is transport-level:
LiveKit disconnects whoever is still connected, and both clients already clear their call
state on an unexpected disconnect and re-read `GetActiveVoiceCall` rather than assuming
the call is over (in a channel call the room can drop just one participant). It also stops
a join token minted before the call ended from walking back into a live room.

The delete is best-effort and runs inside the same transaction as the record update. If
that transaction rolls back, the `room_finished` webhook LiveKit fires on deletion ends
the call anyway, and the ring timeout sweep is the backstop.

## The ring timeout sweep

`internal/voice/ring_timeout.go` runs on every instance on a one-second tick. It claims
`ringing` calls past `ring_deadline_at`, ends them `outcome = 'missed'` with
`ended_reason = 'ring_timeout'`, publishes the terminal call wake so every ringing device
stops, and writes the same `voice_call_missed` chat system message the webhook path
writes — one missed-call record, not two code paths.

The claim and the end are a **single UPDATE** (`ClaimExpiredRingingCalls`). That is what
makes it safe on every instance: two sweepers serialise on the row and the second one's
predicate no longer matches, so a call is ended exactly once.

## Callee availability: busy and unreachable

`StartVoiceCall` decides two things about the callee **before creating the call**, and
only for direct conversations — in a shared channel there is no single callee to be busy
or unreachable:

| Outcome | Condition | Error |
|---|---|---|
| busy | the callee is already on another workspace call | `FAILED_PRECONDITION` / `VOICE_CALLEE_BUSY` |
| unreachable | the callee has no valid push token **and** no responsive live connection | `FAILED_PRECONDITION` / `VOICE_CALLEE_UNREACHABLE` |

Both are evaluated *after* the channel authorisation and block guards, so a refused call
never reveals whether the other person could have been reached. The reachability check
fails open: if it errors, the call is placed rather than refused.

**Consequence worth knowing:** because the refusal happens before the call session
exists, no call record and no missed-call system message is written for an unreachable
callee. The caller learns immediately instead of listening to 45 seconds of ring; the
callee sees nothing.

## The block guard on call initiation

`StartVoiceCall` authorises the channel, then — since spec 036 — asks whether the call is
being placed **into a direct conversation** and, if so, whether either person has blocked
the other. A blocked pair is refused with `FAILED_PRECONDITION` and
`VOICE_DIRECT_CONTACT_BLOCKED`, in wording that names neither party.

Group calls in shared channels are untouched: blocking is scoped to direct contact. The
counterpart is resolved through `ChannelAuthorizer.DirectMessageCounterpart`, implemented
by `internal/chat`, so voice reads none of chat's tables; the block itself is checked
through a locally declared `ContactGuard` interface satisfied by `compliance.Logic`, so
`internal/voice` has no dependency on `internal/compliance`. Both are wired in
`cmd/server.go`. See [compliance-safety.md](compliance-safety.md).

`GetCallRecord` is also what the compliance domain calls to resolve a reported call's
initiator and snapshot.

## Webhook reconciliation

`/api/livekit/webhook` (`internal/voice/webhook.go`) is how LiveKit reality gets folded
back into the business record. Handled events:

| Event | Effect |
|---|---|
| `participant_joined` | participant → `joined`; first join promotes the call `ringing → active` |
| `participant_left` | participant → `disconnected`/`left` |
| `room_finished` | call → `ended`, outcome inferred by `inferWebhookOutcome`; a no-op when `endCall` deleted the room, since the call is already `ended` |
| `egress_started` | `recording_status → processing` |
| `egress_ended` | recording artefact → `ready`, triggers transcription |

Because outcome is *inferred* on `room_finished`, a call that no one answered ends as
`missed` without any client action. Since spec 037 the ring timeout sweep usually gets
there first for a call nobody joined.

For a call ended through `EndVoiceCall` or a final participant leaving, `endOutcomeFor`
decides: answered or active → `completed`; otherwise `cancelled` if the initiator ended it
and `declined` if anyone else did. Who ended it is the only thing that separates the two,
and the request carries no flag saying which — `ended_by_employee_id` against
`initiator_employee_id` is the whole rule. Without it a decline through the no-invitation
path was indistinguishable from the caller giving up.

## Chat integration

A call writes system messages into its channel: `chat.message` with
`message_kind = 'system'` and `system_event_type IN ('voice_call_started',
'voice_call_ended', 'voice_call_missed', 'voice_call_cancelled')`. This is what makes a
missed call visible in the transcript of the conversation rather than only in a call log.
Wiring is `voiceLogic.ChatAnnouncer = chatLogic` in `cmd/server.go`.

## Voice messages

Asynchronous voice notes, separate from calls: `RequestVoiceMessageUpload`,
`ConfirmVoiceMessageUpload`, `CancelVoiceMessage`. `voice.voice_message` tracks
`requested → uploading → posted | failed | cancelled` and FKs to `files.file_metadata`.
Posting produces a `chat.message` with `message_kind = 'voice'`.

## Recordings and transcripts

`voice.call_artifact` holds one row per artefact, typed `recording | transcript`, status
`pending → processing → ready | unavailable | failed`.

- **Recording** — LiveKit egress writes to a separate S3-compatible bucket configured by
  the `RECORDING_*` env vars (distinct from the main R2 bucket). Policy per call:
  `recording_policy IN ('not_allowed','allowed','required')`, defaulting to `not_allowed`.
- **Transcript** — `TranscriptionWorker` (`internal/voice/transcription.go`) pulls the
  recording, calls an **OpenAI Whisper-compatible API**, and stores WebVTT in R2 as a
  `files.file_metadata` row with `upload_context = 'voice_transcript'`, one of the six
  values the column's CHECK accepts (see [files.md](files.md)). It is a no-op unless
  `TranscriptionEnabled` and a Whisper API key are both set.

## Configuration

| Variable | Default | Note |
|---|---|---|
| `LIVEKIT_URL` | `ws://localhost:7880` | |
| `PUBLIC_LIVEKIT_URL` | unset | URL handed to clients when it differs from the server-side one |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | `devkey` / `devsecret…` | **dev defaults; must be overridden** |
| `MAX_PARTICIPANTS` | — | logged at startup |
| `RECORDING_*` | — | separate bucket, region, credentials, prefix, path-style flag |
| `TRANSCRIPTION_ENABLED`, Whisper API key | off | transcription silently disabled when unset |

`make voice-dev-infra-up` / `voice-dev-backend` / `voice-dev-print-env` bring up a local
LiveKit for development.

## Notifications produced

`voice_call_incoming`, `voice_call_started`, `voice_call_updated`, `voice_call_ended`.
`voice_call_incoming` is the ring, and it is the row the rescue push worker hands to the
**call wake dispatcher** rather than sending as an ordinary alert push — see
[notifications-presence.md](notifications-presence.md#call-wakes).

On mobile it is also the one notification type where the client branches explicitly
instead of inferring a route: `apps/mobile/src/lib/linking.ts` special-cases it. That
branch now serves the **tier-B path only**. A call presented as a system call navigates
from `native-call.ts` when the user answers, and never passes through the route resolver.

## Native call presentation

Since spec 037 a call is presented by the operating system rather than by the app, on the
devices that support it. `internal/voice` emits call events; `internal/notification`
decides how a device learns about them. Voice knows nothing about APNs, Firebase or
Telecom — it depends on a locally declared `CallWakeDispatcher` interface
(`internal/voice/call_wake.go`) that `internal/notification` satisfies structurally, wired
in `cmd/server.go`.

Five event kinds reach a device. `incoming` rings it; the other four stop it:

| Emitted when | Kind |
|---|---|
| the call starts ringing | `incoming` |
| the caller hangs up before an answer | `cancelled` |
| this person answered on another device | `answered_elsewhere` |
| this person declined on another device | `declined_elsewhere` |
| anything else ends the call (remote hang-up, ring timeout, join failure) | `ended` |

The native tier requires **iOS 16.4+** (the call module's podspec floor, which is why
`ios.deploymentTarget` is pinned in `app.json`) and **Android API 26+**. Anything below
either falls to tier B.

**Every terminal wake is emitted from `Logic.endCall`**, the one function every ending
path routes through, rather than from each caller. That is what makes it impossible for a
new way of ending a call to forget to stop the phones. The webhook path and the ring
timeout sweep call it too.

**The handset that acted is excluded from the terminal fan-out.** `JoinVoiceCall`,
`LeaveVoiceCall`, `EndVoiceCall` and `RespondToVoiceCallInvite` each carry a
`device_identifier`, and the device that named itself is skipped, recorded as
`acting_device_excluded` on its `delivery_attempt` row. This is not tidiness: the iOS
client module reports *every* call wake to CallKit as a new incoming call before
JavaScript runs, so a terminal wake sent back to the phone that just answered or declined
rings it a second time and no client-side check can prevent it. The person's *other*
devices are still stopped, which is why the exclusion is per device rather than per
person. Clients that do not present calls natively send an empty identifier and are
unaffected.

**Exactly one OS call survives per workspace call, and it is the one already on screen.**
The client module mints a fresh OS call id for every push and never dedups on the
workspace call id, so a terminal wake for a call the phone is already ringing puts a
*second* system call up before JavaScript runs — one labelled with the call id rather than
a name, because a terminal wake carries no caller. `handleWake` in `native-call.ts` ends
that stray first, with end reason `answeredElsewhere` so it leaves no entry in the phone's
call history, and every later branch then acts on the OS call that was already presented.
Without it, a caller who cancelled before pickup left the callee's phone showing a
lingering call named after a UUID. When module state names no such call — it does not
survive a JavaScript reload — the OS session store is asked instead, so the survivor is
found even for a call this module has forgotten.

**Answering and declining from the system UI go through the invitation, not the call.**
The `incoming` wake carries the pending `invitationId`, so the lock screen's answer calls
`RespondToVoiceCallInvite(accept)` and its decline calls `RespondToVoiceCallInvite(decline)`
— the same two RPCs the in-app prompt uses. That is what makes a native decline record
outcome `declined`, publish `voice_call_ended` to the caller, and acknowledge the
persistent `voice_call_incoming` notification so it is not replayed. `EndVoiceCall` is
used only once the call has been answered on this device. A wake naming no invitation
falls back to `JoinVoiceCall`.

The answer is confirmed to the OS **before** that RPC runs, not after it. iOS fails the
answer action — the user sees "Call failed" — if it is not fulfilled promptly, Telecom
tears the call down after five seconds, and CallKit only activates the audio session once
the answer is fulfilled, which is what `call-audio.ts` starts LiveKit's audio from. A join
round trip ahead of it sat inside both budgets and held off the activation. If the join
then fails, the OS call is closed rather than left showing a connected call with no audio.

The identifier naming this handset is registered with the voice client as the first thing
the push-registration effect does, before the VoIP token poll, the permission prompt or
any network call, and independently of whether those succeed. It needs only local storage,
and a call answered before it was set named no device — so the terminal wake meant for the
person's other phones came back to this one and rang it again.

**Everything the wake path needs is readable on a locked screen.** The mobile Keychain
values — access token, expiry, org and employee id, and the stable push installation id —
are stored at `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` rather than `expo-secure-store`'s
`WHEN_UNLOCKED` default; see [auth-identity.md](auth-identity.md#sessions). It reads like a
storage detail and is not: an app woken by a VoIP push that cannot read its own token
boots unauthenticated, and a call cannot be joined without a session. Before the
integration moved to the root layout that state had no listener at all — CallKit failed
the answer action on its own 30-second timeout, the user watched "Connecting…" and the
call dropped, the backend was never told anyone answered, and the call rang out to the
45-second timeout as missed. Now the wake is reported and ended at once instead, but a
phone that cannot read its token still cannot take the call.

The client tracks each presented call in module state, which does not survive a JavaScript
reload while the OS call does. **A hang-up is resolved from the session the OS hands to the
ended event**, not from that state: the session carries the wake payload verbatim,
including the invitation id, so the workspace call is named even when the module has
forgotten it. Getting this wrong was not a degraded hang-up but a silent one — the server
was told nothing and the other party sat in a call the person had already left until the
ring deadline swept it. Answering has no such session on its event and still rebuilds from
`getActiveCallSession()`.

**Only one incoming surface is ever drawn.** A device that registered a VoIP token (iOS)
or runs Telecom (Android) reports itself native-call capable to both the backend and the
mobile client; on that device `notification-stream-provider.tsx` suppresses the tier-B
in-app prompt and the local call notification entirely, leaving the system call screen as
the sole incoming UI. The channel screen suppresses the same way: it does not raise its
own inline incoming banner on a native-capable device, and while the OS is presenting an
unanswered call it draws **no** call banner at all — neither the "voice call started …
Join / Later" discovery prompt nor the join affordance that prompt falls through to.
Answering it opens the conversation behind the system UI, which is how the in-call bar and
the transcript become reachable once the phone is unlocked; from that point the in-app
banner is drawn again, because it is the surface that shows connection quality, reports
mute state and leaves the call.

**Mute is reachable in the app, not only from the OS.** Both the channel's call banner and
the global return bar carry a microphone toggle; both call `voiceClient.setMuted`, which
is the single owner of the state, and `native-call.ts` mirrors every change into the OS
call object so the lock screen and the app cannot disagree. It has to be in the app
because a fallback tier-B device — one the OS does not ring for — has no system call UI at
all, and without an in-app control the user there could not mute anywhere.

**Only one in-app in-call surface is drawn at a time.** The global active-call bar above
the tab navigator is a *return* affordance: it exists to say the call is still running on a
screen you have navigated away from. It is therefore not drawn while the conversation the
call belongs to is the open route — `_layout.tsx` compares the pathname against
`voiceSnapshot.activeChannelId` — because on that screen there is nothing to return to and
the channel already carries its own call banner. Stacking the two under the operating
system's own call chip put three rows of the same call on one screen, which is what the
person answering from the lock screen saw as soon as the conversation opened behind the
system UI. The mute state and control travel with the suppression: the
channel's call banner appends **Muted** to its status line and carries its own microphone
toggle while the media is connected, so the state set from the lock screen is both visible
and changeable where the bar is not.

**One owner for a conversation's call state.** `useChannelVoiceCall` in
`apps/mobile/src/hooks/use-channel-voice-call.ts` holds every piece of it, and the pure
reducer it runs on lives in `channel-voice-call-state.ts` so the guards can be exercised
without a renderer (`npm run check:voice-state`). Three rules the channel screen used to
leave implicit are now stated once:

- **An ended call never comes back.** Terminal call ids accumulate in a bounded
  `endedCallIds` list, and every write of a call checks it. The screen previously kept a
  single ref holding one ended id, which a second call — or a terminal event carrying no
  call id — silently defeated, so a `GetActiveVoiceCall` response issued before the call
  ended and landing after it put the call controls back on screen until the next signal
  removed them again.
- **Only the newest server read wins.** Each read takes a ticket, and applies only while
  it still holds the latest one; changing conversation or leaving the screen invalidates
  every read in flight.
- **The incoming call has one source**, the notification provider. The channel screen no
  longer keeps a second copy from its own stream subscription.

**Declining is an answer the caller hears.** In a direct conversation the in-app prompt
offers Answer and Decline only, and Decline declines the invitation — or ends the call
when there is no invitation to decline, the same rule `native-call.ts` applies to a
hang-up from the system call UI. **Later** remains on group channels, where "that call can
run without me" is a real answer and is local to the device; on a one-to-one call it left
the caller ringing for the full timeout while the callee believed they had responded.

**A call this device places or joins from inside the app is reported to the OS too.**
Every in-app path that connects the media — placing a call, joining one already running,
accepting from the tier-B prompt — goes through `connectCallWithNativePresentation` in
`native-call.ts` rather than calling `voiceClient.connect` directly, and that reports an
outgoing call to CallKit or Telecom before the media connects. On iOS this is not a
nicety: the call module puts WebRTC into manual-audio mode at app launch and the audio
unit is only ever enabled when CallKit activates the session for a call it knows about, so
a call the app connected without reporting one published silence and played nothing. Both
ends sat on a call that looked connected in the app, in the call records and in LiveKit's
own participant list, and heard an empty line. Reporting it also gives the person who
placed the call the same lock-screen controls as the person who answered one. A call the
OS is already presenting — one answered from the lock screen — is not reported a second
time; if the OS refuses the call the media still connects with LiveKit owning the audio
session, which is correct on Android and logged so a silent iOS call can be traced to it.

**Leaving from inside the app closes the system call.** The app has several ways to hang
up — the global active-call bar, the channel's call banner, an unexpected LiveKit
disconnect. None of them talk to CallKit or Telecom. Instead `native-call.ts` watches the
`voiceClient` snapshot and, when the active call id leaves a call the OS is presenting,
reports that call ended to the OS. Without it the system call screen survives the hang-up
with a running timer and no audio, and the user cannot dismiss it from the app. It is
mirrored centrally, from the one snapshot, rather than in each leave button.

## Two client rules the call surfaces depend on

**A loaded call never overrides a call known to have ended.** `GetActiveVoiceCall`
answers "was there a call when this request was issued", so a refresh started by an
earlier signal — an incoming ring, a participant joining — can land *after* the terminal
event and report the call as still active. Both clients funnel every server-loaded call
through one guard (`applyLoadedCall` on web, `applyLoadedVoiceCall` on mobile) that drops
a call whose id is the last one seen to end. Without it a stale response resurrects an
ended call and nothing later clears it — no further event is coming for a call that is
already over — which is how the web bar got stuck on *"Voice call in progress — join
now"* after the other side hung up.

**`voice_call_started`, `voice_call_updated` and `voice_call_ended` are never drawn as
notifications.** They are published silent and live-only with a placeholder `"Voice call"`
title and an empty body: they exist to drive the call surfaces, not to be read. Both
clients drop them before the generic toast/banner path (`mapNotificationToPopup` on web,
the live-banner enqueue on mobile). `voice_call_incoming` is the only voice notification
with a real title and body, and it is handled by the call surfaces too.

## Client surfaces

- Web: `/workspace/voice`.
- Mobile: `src/components/voice/` and `src/lib/voice/`:
  - `native-call.ts` — wake → report → join → end, both platforms (tier A). Started from
    the root layout, so the OS always has a listener even on a device that cannot
    authenticate; whether a call can be joined is answered by `getSession`, not by
    whether the integration is running. It also mirrors the client's mute state into the OS call object from the
    `voiceClient` snapshot, so the lock screen and the app cannot disagree, and closes
    the OS call when that snapshot shows the app has left it. `useNativeCallPresented`
    exposes the presented-call set to in-app surfaces so they can stand aside.
  - `voice-client.ts` — LiveKit transport. Its snapshot carries
    `remoteParticipantCount`, which is what lets the global active-call bar say
    **Calling** rather than *In voice call* while the caller is still alone in the room —
    connected to the room is not the same as connected to a person, and saying otherwise
    is what made a declined 1:1 call look as though it were running. During a system-presented call it is told the
    audio session is owned externally and does not start its own; the answer path builds
    join credentials with the shared `toVoiceJoinCredentials`.
  - `call-audio.ts` — the audio session belongs to CallKit/Telecom; LiveKit carries media
    only. On iOS audio starts in the framework's activation callback; on Android routing
    is left to Telecom and `setCommunicationDevice`/`startBluetoothSco` are never called. On
    Android there is a native prerequisite behind this: `@livekit/react-native` builds its
    WebRTC audio device module and audio-record samples dispatcher in
    `LiveKitReactNative.setup()`, which must run in `Application.onCreate` before React
    Native starts. Nothing in the SDK or its upstream Expo plugin does that for the
    version pinned here, and `android/` is prebuild output, so
    `plugins/with-livekit-android-setup.js` patches `MainApplication.kt` to call it.
    Without it answering a call throws `audioRecordSamplesDispatcher is not initialized`
    the moment the microphone is touched — iOS is unaffected.
  - `voice-notifications.ts` and `incoming-voice-call-prompt.tsx` — the tier-B fallback
    ring, for devices that cannot run the native tier.
- Client: `packages/apis/src/voice.ts` (`voiceCallFailureKind` distinguishes busy,
  unreachable and unavailable), `packages/apis/src/push-tokens.ts` (call wake vocabulary).

## Tests

`integration/voice_communication_test.go`, `voice_constants_test.go`,
`voice_livekit_connectivity_test.go`, `native_call_wakeup_test.go`.

**Declared coverage limit.** No automated test can demonstrate the behaviour this feature
exists for — a locked, force-quit phone ringing on its lock screen. The integration tests
cover what the backend *decided*: which devices, which tier, what was recorded, what was
refused. The rest is the manual device matrix in
`specs/037-native-call-wakeup/quickstart.md` section C, which gates release.

## Known drift

**Spec 037's FR-021 (system recent-calls surface) is not implemented.** Jetpack Telecom's
unified call history and `isLogExcluded` require Android 16.1 (SDK 36.1), far above the
epic's API 26 floor. FR-021 is a MAY; revisit when the 16.1 install base justifies it.

**An unreachable callee gets no missed-call trail.** A direct call to a callee with no push
token and no live connection is refused with `VOICE_CALLEE_UNREACHABLE` *before* the call
session is created, so no call record and no missed-call system message is written — the
callee never learns anyone tried. This satisfies FR-006/SC-006 (an immediate verdict
instead of a 45-second ring) at the cost of the trail an offline callee used to get.
Whether they should still see a missed call is an open product decision, not an oversight.

**`PUBLIC_LIVEKIT_URL` goes stale silently.** A developer's local `backend/.env` pins a LAN
IP and the file is gitignored, so it rots whenever the machine changes network. Clients
then receive join credentials aimed at an unreachable host and the call connects with no
audio — the same symptom as an audio-session bug, with a completely different cause.
`TestVoiceLiveKitConnectivity` is the test that catches it; treat its failure as a config
problem before suspecting code.
