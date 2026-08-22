# Voice

Channel-scoped voice calls, voice messages, recordings and transcripts. Owned by
`internal/voice`; contract in `rpc/v1/voice.proto` (`VoiceService`, 12 RPCs).

**Status date: 2026-08-22.** Supersedes spec 032. Deeper reference:
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
`missed` without any client action.

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
`voice_call_incoming` is the ring — it is priority-sensitive and is the one notification
type where a mobile client branches explicitly rather than by inferring a route
(`apps/mobile/src/lib/linking.ts` special-cases it).

## Client surfaces

- Web: `/workspace/voice`.
- Mobile: `src/components/voice/`, `src/lib/voice/` including `voice-notifications.ts`.
- Client: `packages/apis/src/voice.ts`.

## Tests

`integration/voice_communication_test.go`, `voice_constants_test.go`,
`voice_livekit_connectivity_test.go`.

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
