# Research: Voice Communication Support

## Decision: Use LiveKit Server as the primary SFU/media plane

**Rationale**: LiveKit Server is an open-source Go WebRTC SFU built on the Pion ecosystem. It provides production-oriented room management, JWT-based participant authorization, client SDKs for web and React Native, UDP/TCP/TURN networking, bandwidth estimation/adaptation, distributed deployment support, and egress/recording hooks. Those map directly to the feature requirements: small group calls, constrained-network audio, access-controlled joins, post-call recordings, and deployable infrastructure.

**Alternatives considered**:
- Pion Ion / Ion SFU: useful as a reference and example, especially for ICE/TURN and simple SFU concepts, but current repository snippets identify it as a work-in-progress remake. It should not be the primary dependency for a production SaaS call feature.
- Raw `pion/webrtc`: excellent library foundation, but building and operating an SFU, room signaling, congestion adaptation, reconnection, egress, and client SDK behavior from scratch would violate the simplicity/YAGNI gate.
- Galene: mature Go videoconferencing server with Pion, recording, WHIP, and modest resource usage. It is more of a standalone conferencing application with its own group/auth model, making SaaS room membership, typed RPC, and existing chat integration harder than LiveKit.
- MediaMTX: strong for streaming/relay protocols, but less aligned with interactive authenticated room calls and in-app call lifecycle.
- Janus/Jitsi: capable, but not Go-first and would add a different operational and extension model.

## Decision: Use existing notification SSE for discovery and ringing, not WebRTC SDP signaling

**Rationale**: The current notification system already supports live-only SSE delivery through PostgreSQL NOTIFY, `notification.active_connection`, and `notification.active_context`. Voice call discovery is a good fit for that path: active-call indicators, system call announcements, call invitations, incoming-call priority alerts, and call-ended updates can all be delivered as notification events. WebRTC SDP/ICE signaling should remain with LiveKit because that is part of the SFU's contract and avoids duplicating stateful media signaling in the app backend.

**Alternatives considered**:
- Build custom SSE SDP signaling: possible for peer-to-peer or a custom Pion SFU, but unnecessary with LiveKit and likely to create competing call authority.
- WebSocket signaling in the app backend: adds another realtime channel when SSE already serves notification/discovery and LiveKit already handles media signaling.
- Polling for active calls only: simpler, but misses the 5-second online alert and active-call discovery goals.

## Decision: Use LiveKit built-in TURN over TLS

**Rationale**: LiveKit owns the media plane and already exposes TURN configuration through its signaling contract. Running TURN from LiveKit keeps credential generation, ICE server discovery, and media networking in one service. The app backend should mint only LiveKit room tokens and should not mint or return separate TURN credentials. Production networking should expose LiveKit's TURN-over-TLS listener so constrained networks can use a firewall-friendly TLS path while SSE remains only the discovery/ringing channel.

**Alternatives considered**:
- Run a separate TURN service from day one: useful only if LiveKit's built-in TURN is insufficient for a specific deployment, but it adds operational surface and a second credential mechanism.
- Rely only on public STUN: too fragile for employee mobile/cellular networks and not acceptable for a reliable voice feature.
- Embed TURN into the existing backend process: would compromise stateless backend expectations and complicate scaling unless isolated behind clear runtime ownership.

## Decision: Persist call lifecycle in PostgreSQL and keep media state in LiveKit

**Rationale**: The app must enforce tenant isolation, room membership, one active call per room, call outcomes, call history, artifact availability, and notification fanout. Those are business records and belong in Postgres. LiveKit owns participant media sessions, connection quality, and recording egress. Backend reconciliation occurs through LiveKit webhooks plus explicit user RPCs.

**Alternatives considered**:
- Treat LiveKit rooms as the only source of truth: insufficient for post-call records, room membership authorization, notification audit, and one-active-call constraints.
- Store live participant state only in memory: violates distributed-first architecture.

## Decision: Model voice messages as chat timeline messages with voice metadata

**Rationale**: Users expect voice messages to appear inline with existing text messages, permissions, notifications, and file attachments. Extending chat messages with a message kind plus a `voice.voice_message` metadata row preserves the existing timeline while giving voice-specific idempotency, duration, waveform, codec, and upload state. Audio bytes use existing file upload/R2 flows.

**Alternatives considered**:
- Separate voice-message timeline: duplicates chat rendering, read state, notifications, and permissions.
- Store voice message only as generic file attachment: loses recording duration, upload/retry state, waveform/playback metadata, and idempotent retry behavior.

## Decision: Use async artifact processing for recordings and transcripts

**Rationale**: Every ended call must create a call record quickly, but recording and transcription can fail or take longer. A `voice.call_artifact` table with `pending`, `processing`, `ready`, `unavailable`, and `failed` states lets the UI show metadata immediately and update when media/transcripts arrive. Recording should prefer storage-efficient Opus-based audio where supported, with transcript generation best effort behind an interface.

**Alternatives considered**:
- Block call record creation until recording/transcript completes: violates SC-005 and makes failures user-visible in the wrong place.
- Store raw audio captures: conflicts with the storage optimization requirement.

## Decision: Use scenario-first tests with mocked media where CI cannot assert real audio

**Rationale**: Backend integration and E2E tests can deterministically validate authorization, call lifecycle, one-active-call constraints, LiveKit token generation, webhook reconciliation, SSE events, and UI states. CI cannot reliably prove human-perceived audio intelligibility, especially under cellular-like packet loss. That part should be covered by documented manual or lab network-shaping smoke checks while automated tests verify the server and client behavior that enables it.

**Alternatives considered**:
- No media-path testing: misses a critical feature risk.
- Full real-audio CI test for every run: fragile, slow, and hard to make deterministic across browser/device environments.