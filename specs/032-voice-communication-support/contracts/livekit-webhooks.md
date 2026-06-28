# Contract: LiveKit Webhooks

The backend exposes a server-to-server webhook endpoint for LiveKit room, participant, and egress events. The exact path can be implemented in the existing backend HTTP router, for example:

```text
POST /api/livekit/webhook
```

## Authentication

- Validate requests with the LiveKit webhook receiver/signature mechanism using `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` or a dedicated webhook secret if configured.
- Reject unsigned, expired, malformed, or replayed requests.
- Webhook handlers run in system scope but must resolve `organization_id` from `voice.call_session.livekit_room_name` or room metadata before any tenant updates.

## Required Events

### Participant Joined

Purpose: Reconcile a successful media join.

Required data:
- `room.name`: maps to `voice.call_session.livekit_room_name`.
- `participant.identity`: maps to `voice.call_participant.livekit_identity`.
- event timestamp.

Backend behavior:
- Set participant state to `joined` and `joined_at` if not already set.
- Move call from `ringing` to `active` when appropriate.
- Publish a `voice_call_updated` live-only SSE event.

### Participant Left

Purpose: Reconcile leave/disconnect and final-call ending.

Required data:
- `room.name`
- `participant.identity`
- disconnect reason when available.

Backend behavior:
- Mark participant `left` or `disconnected` based on reason and recent reconnect policy.
- If no active participants remain, move call to `ending` or `ended`.
- Publish `voice_call_updated` or `voice_call_ended` as appropriate.

### Room Finished

Purpose: Close any call not already ended by explicit user action.

Required data:
- `room.name`
- end timestamp.

Backend behavior:
- Mark call ended with `completed`, `missed`, `declined`, or `cancelled` based on participant history.
- Create or update the system call-record message in the chat timeline.
- Publish `voice_call_ended` live-only SSE.

### Egress Started

Purpose: Mark recording as processing.

Required data:
- `room.name`
- egress/job ID.
- artifact kind when available.

Backend behavior:
- Upsert `voice.call_artifact` with `artifact_type = recording`, `status = processing`, and provider job ID.

### Egress Ended Or Failed

Purpose: Attach recording artifact or mark it unavailable.

Required data:
- `room.name`
- egress/job ID.
- output file location or failure details.

Backend behavior:
- On success, create/confirm a `files.file_metadata` row for the recording artifact and set `voice.call_artifact.status = ready`.
- On failure, set `voice.call_artifact.status = failed` with error details.
- Update the call-record message metadata and publish `voice_call_updated` if clients should refresh artifacts.

## Idempotency

- Webhook processing must be idempotent by `(organization_id, provider, provider_job_id, event_type)` or by deterministic participant/call state checks.
- Replayed participant join/leave events must not corrupt timestamps or re-open ended calls.
- Replayed egress completion must return success without creating duplicate file metadata.

## Observability

Log with structured `slog` fields:
- `organization_id`
- `call_id`
- `livekit_room_name`
- `event_type`
- `provider_job_id`
- `participant_identity`
- `result`
- `error_code`