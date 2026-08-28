# Voice

Channel-scoped voice calls, voice messages, recordings and transcripts. Owned by
`internal/voice`; contract in `rpc/v1/voice.proto` (`VoiceService`, 12 RPCs).

**Status date: 2026-08-28.** Supersedes specs 032 and 037. Deeper reference:
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
| `room_finished` | call → `ended`, outcome inferred by `inferWebhookOutcome` |
| `egress_started` | `recording_status → processing` |
| `egress_ended` | recording artefact → `ready`, triggers transcription |

Because outcome is *inferred* on `room_finished`, a call that no one answered ends as
`missed` without any client action. Since spec 037 the ring timeout sweep usually gets
there first for a call nobody joined.

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
  `files.file_metadata` row. It is a no-op unless `TranscriptionEnabled` and a Whisper API
  key are both set.

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

`answered_elsewhere` fans out to *all* of that person's devices, including the one that
answered — the backend knows which person answered, not which handset. The answering
device recognises the call it is in and ignores the wake.

## Client surfaces

- Web: `/workspace/voice`.
- Mobile: `src/components/voice/` and `src/lib/voice/`:
  - `native-call.ts` — wake → report → join → end, both platforms (tier A).
  - `call-audio.ts` — the audio session belongs to CallKit/Telecom; LiveKit carries media
    only. On iOS audio starts in the framework's activation callback; on Android routing
    is left to Telecom and `setCommunicationDevice`/`startBluetoothSco` are never called.
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

**D1 — voice transcripts violate a database CHECK.**
`internal/voice/transcription.go:132` writes `files.file_metadata` with
`UploadContext: "voice_transcript"`, but the column's constraint is still
`CHECK (upload_context IN ('chat','avatar','docs','project'))` — unchanged since the
initial migration. The insert is inside the transcript-persist transaction, so every
transcript fails at `persist_failed` and the artefact never reaches `ready`. Integration
tests do not catch it because transcription is disabled without a Whisper key. Fixing it
means either widening the constraint (also covering `'calendar'`, already accepted by
`files.IsValidUploadContext`) or reusing an existing context value. Same root cause as the
files-side half of D1 — see [files.md](files.md#known-drift).
