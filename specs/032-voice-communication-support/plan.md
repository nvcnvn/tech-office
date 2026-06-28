# Implementation Plan: Voice Communication Support

**Branch**: `032-voice-communication-support` | **Date**: 2026-05-10 | **Spec**: `/Volumes/T5/Codes/tech-office/specs/032-voice-communication-support/spec.md`
**Input**: Feature specification from `/Volumes/T5/Codes/tech-office/specs/032-voice-communication-support/spec.md`

## Summary

Add live voice calls, call invitations, voice messages, and post-call records to direct messages, channels, and task chat channels. The backend owns call lifecycle, room authorization, persistent call records, voice-message metadata, and notification fanout; LiveKit Server provides the production Go SFU/media plane and WebRTC signaling; existing notification SSE is used for discovery, active-call updates, and high-priority incoming-call alerts; existing R2-backed file storage stores voice messages, call recordings, and transcript artifacts.

The user specifically asked whether Pion Ion and the Pion ecosystem are the right SFU direction. Research chooses LiveKit Server as the primary SFU because it is a production Go SFU built on Pion with client SDKs, JWT auth, built-in TURN-over-TLS support, egress/recording hooks, distributed deployment support, and bandwidth adaptation. Pion Ion remains a useful reference, but LiveKit owns the media plane and ICE/TURN discovery for this implementation.

## Technical Context

**Language/Version**: Go 1.25.0 backend; TypeScript 5; Next.js 15.5.2/React 19 web; Expo 55/React Native 0.83 mobile  
**Primary Dependencies**: Connect RPC, protobuf, sqlc/pgx, PostgreSQL/Citus, existing notification SSE and files/R2 services, LiveKit Server and LiveKit server SDK/token APIs with built-in TURN over TLS, `livekit-client` for web, LiveKit React Native client modules for mobile, MediaRecorder/Web Audio on web, Expo audio recording module for mobile voice messages  
**Storage**: PostgreSQL/Citus tenant tables in a new `voice` schema plus small `chat.message` metadata extensions; R2/object storage through existing file metadata for voice-message audio, call recordings, and transcripts; Redis only for LiveKit distributed coordination if multi-node LiveKit is enabled  
**Testing**: Scenario-first Go integration tests in `backend/integration/`; Playwright behavior tests in `frontend/apps/web/e2e/`; Maestro happy-path mobile flow in `frontend/apps/mobile/.maestro/`; backend `go test ./integration/...`; web `pnpm --filter web exec playwright test`; mobile `make test-mobile` plus `pnpm --dir frontend run typecheck:mobile`  
**Target Platform**: Linux backend services, Docker Compose local development, Kubernetes production deployment, web browsers with WebRTC, iOS/Android Expo development clients  
**Project Type**: Full-stack SaaS feature with backend RPC service, database schema, external media infrastructure, web UI, mobile UI, and behavior tests  
**Performance Goals**: SC-001/SC-002: 95% call discovery and online incoming-call alerts within 5 seconds; SC-003/SC-004: typical cellular calls stay connected for 10 minutes with intelligible audio; SC-005: 95% post-call records visible within 2 minutes; SC-006/SC-007: recordings and voice messages become playable from the room; SC-008: retained audio uses less storage than equivalent raw captures while remaining understandable  
**Constraints**: Tenant isolation by `organization_id`; all unique/primary keys begin with `organization_id`; no user-facing request includes `organization_id`; each chat channel has at most one active voice call; backend remains stateless; live call discovery uses SSE but SDP/media signaling stays with LiveKit; audio continuity and intelligibility take priority over fidelity; all cross-stack constants are named and synchronized  
**Scale/Scope**: Initial target is direct calls and small/medium workplace group calls in existing chat rooms, with a configurable participant cap defaulting to 25 participants per call. Larger rooms can still discover calls, but participant admission can be limited by server policy until load testing raises the cap.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Plan Evidence |
|-----------|--------|---------------|
| I. Data Governance & Multi-Tenancy | PASS | New tenant data lives in `voice` schema with `organization_id` as leading key. Requests derive organization from auth. FKs to tenant tables use `(organization_id, id)`. Migrations go under `backend/k8s/base/database/migrations/` and schema/query files are source of truth. |
| II. Scenario-First Integration & E2E Testing | PASS | Scenario contract below maps all user stories and user-observable FRs to backend integration, web E2E, and mobile Maestro coverage. |
| III. Two-Layer Service Architecture & Proto-Level Authorization | PASS | Add `backend/internal/voice` logic layer and Connect layer. New RPCs declare `access_control` permissions in `backend/rpc/v1/voice.proto`. Logic accepts `database.DBTX` and domain interfaces. |
| IV. Cross-Domain Integration | PASS | Voice logic calls Chat/File/Notification logic interfaces. It does not join across business schemas for authorization. Database FKs are for integrity only; cross-domain reads go through logic methods. |
| V. Observability, Simplicity & YAGNI | PASS | Use LiveKit rather than building an SFU. Add structured `slog` logs for call lifecycle, token minting, LiveKit webhook handling, notification publication, artifact processing, and failed joins/uploads. |
| VI. Versioning, Breaking Changes & Review | PASS | New RPC and schema contracts are additive. Notification/message constants require synchronized backend/frontend/schema updates and contract tests. |
| VII. Frontend API Wrapper Pattern & Type Safety | PASS | Web/mobile import typed wrappers from `frontend/packages/apis/src/voice.ts`; app code does not import protobuf types directly. UI controls get `data-testid`/`testID` and theme colors. |
| VIII. Cross-Stack Constant & Type Synchronization | PASS | Add named constants for call states, outcomes, message kinds, artifact states, notification types, and policy keys across schema, Go, proto, and TypeScript. |
| IX. UUID v7 & Nullable Parameters | PASS | Database uses `uuidv7()` defaults; Go code uses internal `dbuuid`; optional filters/cursors use nullable sqlc params. |
| X. Structured Error Details | PASS | RPC errors for ineligible joins, duplicate active calls, unavailable media infrastructure, disabled recording, and upload idempotency conflicts attach structured details for frontend behavior. |
| XI. Distributed-First Architecture | PASS | Backend call state is persisted; live presence/discovery uses existing UNLOGGED SSE registries; SFU media state lives in LiveKit; no required in-process state. |
| XII. Architecture Documentation | PASS | Consulted `backend/docs/NOTIFICATION-SYSTEM-ARCHITECTURE.md`. Implementation must update `backend/docs/SYSTEM-ARCHITECTURE.md`, `backend/docs/NOTIFICATION-SYSTEM-ARCHITECTURE.md`, and `backend/docs/VOICE-COMMUNICATION-ARCHITECTURE.md` after tests pass. |
| XIII. Mobile Design & Testing | PASS | Mobile UX is purpose-built for employee task flows, not a direct web mirror. Maestro covers the main happy path and controls use `testID`. |

No constitution violations are introduced.

## Project Structure

### Documentation (this feature)

```text
/Volumes/T5/Codes/tech-office/specs/032-voice-communication-support/
+-- plan.md
+-- research.md
+-- data-model.md
+-- quickstart.md
+-- contracts/
|   +-- voice-rpc.proto.md
|   +-- voice-sse-events.md
|   +-- livekit-webhooks.md
+-- tasks.md                  # Created later by /speckit.tasks
```

### Source Code (repository root)

```text
/Volumes/T5/Codes/tech-office/backend/
+-- rpc/v1/voice.proto
+-- internal/voice/
|   +-- constants.go
|   +-- logic.go
|   +-- livekit_client.go
|   +-- artifacts.go
|   +-- service_connect.go
+-- internal/chat/
|   +-- logic updates for system call messages and voice-message timeline rows
+-- internal/notification/
|   +-- constants/policy updates for voice call events
+-- database/scripts/schema.sql
+-- database/scripts/voice.query.sql
+-- database/scripts/chat.query.sql
+-- k8s/base/database/migrations/
|   +-- 20260407000001_voice_communication.up.sql
+-- docker-compose.yml
+-- k8s/base/
|   +-- livekit/ and turn/ deployment manifests
+-- cmd/server.go
+-- integration/voice_communication_test.go
+-- integration/voice_constants_test.go

/Volumes/T5/Codes/tech-office/frontend/
+-- packages/apis/src/voice.ts
+-- packages/apis/src/notification.ts
+-- apps/web/src/app/workspace/chat/
|   +-- hooks/useVoiceCall.ts
|   +-- hooks/useVoiceMessages.ts
|   +-- components/voice/*
+-- apps/web/e2e/voice-communication.spec.ts
+-- apps/mobile/src/lib/voice/*
+-- apps/mobile/src/components/chat/voice-*
+-- apps/mobile/.maestro/voice-communication.yaml
```

**Structure Decision**: Add a dedicated backend `voice` domain for lifecycle, artifacts, and LiveKit integration while keeping room membership and timeline rendering anchored in existing `chat` channels/messages. This keeps media-specific logic isolated without duplicating chat membership or notification infrastructure.

## Scenario Contract

Backend integration file: `/Volumes/T5/Codes/tech-office/backend/integration/voice_communication_test.go` using `testWorld` helpers.  
Web E2E file: `/Volumes/T5/Codes/tech-office/frontend/apps/web/e2e/voice-communication.spec.ts` using arrange-via-API, act/assert-via-UI.  
Mobile Maestro file: `/Volumes/T5/Codes/tech-office/frontend/apps/mobile/.maestro/voice-communication.yaml` for the primary employee happy path.

| Scenario | Backend Integration | Web E2E | Mobile Maestro | FR Coverage |
|----------|---------------------|---------|----------------|-------------|
| when an employee starts a voice call in a direct message, channel, and task chat | Creates one active session per room, mints a LiveKit token, and authorizes eligible participants | Start-call controls appear in all supported room types and second user can join the same active call surface | Happy path starts from a channel and joins from another employee session where feasible | FR-001, FR-003, FR-017 |
| when two employees start a call in the same room at nearly the same time | Concurrent calls resolve to one active `voice.call_session`; both join paths return the same call | UI shows one ongoing call indicator and no duplicate call cards | Covered by backend only; mobile concurrency is not a reliable blackbox flow | FR-002, FR-024 |
| when a group call starts in a channel or task chat | System room event is created, active-call SSE event is published, and late joiners discover it via `GetActiveVoiceCall` | Conversation shows an active-call announcement and join affordance after reload | Room list/detail shows active call and join action | FR-004, FR-005, FR-019 |
| when a participant invites another eligible employee | Invitation row is created, priority-0 incoming-call notification is published, invitee can join existing call | Invitee sees incoming-call alert and joins the existing call | Incoming notification deep links to room/call if push/SSE is available in test harness | FR-006, FR-007 |
| when a non-member or removed member tries to join | Join and token minting are denied with structured error details | Ineligible user sees an access denied state and no token is exposed | Backend/web only unless mobile multi-user fixture is available | FR-003, FR-017, FR-024 |
| when participants leave, disconnect, and rejoin | Participant states move through joined, disconnected, rejoined, left; final leave ends the call | UI preserves ongoing call after one participant leaves and clears state after final leave | Happy path verifies leave clears active indicator | FR-018, FR-019, FR-020 |
| when a call ends with answered, missed, declined, cancelled, and completed outcomes | Post-call record outcome and participant/timestamp metadata are persisted | Completed/missed record appears in the room timeline with correct labels | Mobile shows compact call history row | FR-008, FR-009, FR-020 |
| when recording or transcription succeeds or fails | Artifact rows move to ready or unavailable without blocking call record creation | UI shows playable recording/transcript when ready and unavailable state on failure | Mobile can open/play available recording if fixture artifact exists | FR-010, FR-011, FR-012, FR-023, FR-024 |
| when an employee records, cancels, sends, retries, and plays a voice message | Upload idempotency prevents duplicate messages; cancelled recordings do not create timeline rows | Recorder, delivery status, retry, and playback states are visible and stable | Record/send/play happy path with explicit controls | FR-013, FR-014, FR-015, FR-016, FR-023, FR-024 |
| when network conditions are constrained | Server returns audio-only LiveKit room/token credentials while LiveKit provides ICE/TURN-over-TLS configuration through signaling; mocked LiveKit stats update quality state | Browser test validates UI quality/degraded states where deterministic; real intelligibility remains a manual/network-lab smoke check | Manual/device smoke check documented because Maestro cannot assert audio intelligibility | FR-021, FR-022, SC-003, SC-004 |

Automated tests validate state transitions, permissions, event delivery, token issuance, and UI behavior. Human-perceived audio intelligibility under real cellular conditions is documented as a manual or lab network-shaping verification because normal CI Playwright/Maestro cannot reliably assert audio quality.

## Phase 0 Research

Output: `/Volumes/T5/Codes/tech-office/specs/032-voice-communication-support/research.md`

Key decisions:
- Use LiveKit Server as the SFU/media plane.
- Use existing notification SSE for discovery, ringing, active-call state, and invitation events.
- Use LiveKit built-in TURN over TLS; the app backend does not mint or return separate TURN credentials.
- Store voice message and call artifact media through existing file/R2 infrastructure.

## Phase 1 Design Artifacts

Outputs:
- `/Volumes/T5/Codes/tech-office/specs/032-voice-communication-support/data-model.md`
- `/Volumes/T5/Codes/tech-office/specs/032-voice-communication-support/contracts/voice-rpc.proto.md`
- `/Volumes/T5/Codes/tech-office/specs/032-voice-communication-support/contracts/voice-sse-events.md`
- `/Volumes/T5/Codes/tech-office/specs/032-voice-communication-support/contracts/livekit-webhooks.md`
- `/Volumes/T5/Codes/tech-office/specs/032-voice-communication-support/quickstart.md`

## Post-Design Constitution Check

| Principle | Status | Post-Design Evidence |
|-----------|--------|----------------------|
| Data Governance & Multi-Tenancy | PASS | Data model defines composite tenant keys, Citus-safe unique indexes, and no user-supplied `organization_id`. |
| Scenario-First Testing | PASS | Scenario contract covers every user story and all FR-001 through FR-024, with justified manual coverage only for audio intelligibility. |
| Two-Layer Service & Proto Auth | PASS | RPC contract defines a `VoiceService`; implementation plan separates Connect/service wiring from `internal/voice` logic and LiveKit adapter. |
| Cross-Domain Integration | PASS | Chat, File, and Notification interactions are via logic interfaces or publisher; no authorization-by-SQL across domains. |
| Observability & Simplicity | PASS | External SFU avoids building media forwarding. Plan adds explicit structured logs and LiveKit webhook visibility. |
| Versioning & Review | PASS | Additive contracts plus synchronized constants and contract tests. |
| Frontend Wrapper & Type Safety | PASS | Contract requires `packages/apis` wrappers and app-level custom TypeScript types. |
| Constant Synchronization | PASS | Data model and contracts list constants requiring schema, Go, proto, and TypeScript alignment tests. |
| UUID v7 & Nullable Params | PASS | Schema defaults use UUID v7; Go implementation must use `dbuuid`. |
| Structured Errors | PASS | Contract names structured error cases. |
| Distributed-First | PASS | Persistent call state plus LiveKit media state and SSE registries avoid process-local authority. |
| Architecture Docs | PASS | Quickstart and plan require backend architecture docs update after implementation. |
| Mobile Design & Testing | PASS | Mobile contract includes task-first controls and Maestro coverage. |

No post-design violations remain.

## Complexity Tracking

No constitution violations require justification. The added LiveKit/TURN infrastructure is necessary because implementing an SFU, NAT traversal, recording egress, and bandwidth adaptation inside the existing backend would be substantially more complex and riskier than operating a proven Go media service.