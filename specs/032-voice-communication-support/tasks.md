# Tasks: Voice Communication Support

**Input**: Design documents from `/specs/032-voice-communication-support/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`
**Tests**: Required by the project constitution and scenario contract. Backend integration, web E2E, and mobile Maestro tasks are included before implementation tasks for each user story.

**Organization**: Tasks are grouped by user story so each story can be independently implemented, tested, and reviewed.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it targets different files and does not depend on incomplete tasks in the same phase.
- **[Story]**: Applies only to user-story phases.
- Every task includes an exact file path.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add external media dependencies, package scaffolding, and local infrastructure entry points shared by all stories.

- [X] T001 Add LiveKit server SDK and media infrastructure dependencies in `backend/go.mod`
- [X] T002 [P] Add web LiveKit client and recorder dependencies in `frontend/apps/web/package.json`
- [X] T003 [P] Add mobile LiveKit React Native and audio recorder dependencies in `frontend/apps/mobile/package.json`
- [X] T004 [P] Create voice domain constants skeleton in `backend/internal/voice/constants.go`
- [X] T005 [P] Create web voice call hook skeleton in `frontend/apps/web/src/app/workspace/chat/hooks/useVoiceCall.ts`
- [X] T006 [P] Create mobile voice client skeleton in `frontend/apps/mobile/src/lib/voice/voice-client.ts`
- [X] T007 Add local LiveKit service with built-in TURN-over-TLS config in `backend/docker-compose.yml`
- [X] T008 [P] Add production LiveKit Kubernetes manifest with TURN-over-TLS listener in `backend/k8s/base/livekit/kustomization.yaml`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish schema, generated contracts, backend service shell, typed frontend API wrappers, and cross-stack constants needed by every user story.

**Critical**: No user story implementation starts until this phase is complete.

- [X] T009 Add `voice` schema tables and `chat.message` voice/system metadata columns in `backend/database/scripts/schema.sql`
- [X] T010 Add forward-only voice communication migration in `backend/k8s/base/database/migrations/20260407000001_voice_communication.up.sql`
- [X] T011 Add sqlc queries for call sessions, participants, invitations, artifacts, and voice messages in `backend/database/scripts/voice.query.sql`
- [X] T012 Regenerate sqlc voice outputs in `backend/database/voice.query.sql.go`
- [X] T013 Add `VoiceService` RPC contract and enums in `backend/rpc/v1/voice.proto`
- [X] T014 Regenerate backend voice protobuf and Connect outputs in `backend/rpc/v1/voice.pb.go` and `backend/rpc/v1/rpcv1connect/voice.connect.go`
- [X] T015 Regenerate frontend voice protobuf output in `frontend/packages/rpc/rpc/v1/voice_pb.ts`
- [X] T016 Add typed frontend voice API wrappers and exports in `frontend/packages/apis/src/voice.ts` and `frontend/packages/apis/src/index.ts`
- [X] T017 Add voice notification types and policy keys in `backend/internal/notification/constants.go` and `frontend/packages/apis/src/notification.ts`
- [X] T018 Add chat message kind and system event constants in `backend/internal/chat/constants.go` and `frontend/packages/apis/src/chat.ts`
- [X] T019 [P] Add automated cross-stack voice constant synchronization test for database CHECK values, Go constants, and TypeScript API unions in `backend/integration/voice_constants_test.go`
- [X] T020 Add structured voice error detail mapping in `backend/internal/voice/errors.go` and `frontend/packages/apis/src/errorDetails.ts`
- [X] T021 Add LiveKit, participant cap, and quality policy configuration loading and validation in `backend/internal/voice/config.go`
- [X] T022 Wire the voice service shell and dependencies in `backend/cmd/server.go`

**Checkpoint**: Schema, proto, generated code, API wrappers, constants, and service wiring compile before story work begins.

---

## Phase 3: User Story 1 - Start and Join Live Voice Calls (Priority: P1) MVP

**Goal**: Employees can start, join, leave, and end live voice calls from direct messages, channels, and task chat channels while preserving room access rules and enforcing one active call per room.

**Independent Test**: From a DM, channel, and task chat, start a voice call and have another eligible participant join. Verify both participants receive join credentials for the same LiveKit room, access follows room membership, one active call exists per room, and final leave ends the active state.

### Tests for User Story 1

- [X] T023 [P] [US1] Add backend integration scenarios for start, join, leave, end, room eligibility, one-active-call races, disconnect/rejoin, 5-second active-call discovery, and audio-only TURN/ICE configuration in `backend/integration/voice_communication_test.go`
- [X] T024 [P] [US1] Add web E2E scenarios for starting and joining calls, active-call visibility, and degraded-quality state in supported room types in `frontend/apps/web/e2e/voice-communication.spec.ts`
- [X] T025 [P] [US1] Add mobile Maestro happy path for channel call start, join, leave, and degraded-quality affordance in `frontend/apps/mobile/.maestro/voice-communication.yaml`
- [X] T026 [P] [US1] Add constrained-network manual or lab smoke checklist for 10-minute cellular continuity and intelligibility verification in `specs/032-voice-communication-support/quickstart.md`

### Implementation for User Story 1

- [X] T027 [US1] Implement `StartVoiceCall`, `GetActiveVoiceCall`, `JoinVoiceCall`, `LeaveVoiceCall`, and `EndVoiceCall` business logic in `backend/internal/voice/logic.go`
- [X] T028 [US1] Implement call lifecycle Connect handlers in `backend/internal/voice/service_connect.go`
- [X] T029 [US1] Implement one-active-call, participant state, and active-call lookup queries in `backend/database/scripts/voice.query.sql`
- [X] T030 [US1] Implement LiveKit room creation, scoped join token minting, audio-only room options, participant caps, and TURN/ICE configuration in `backend/internal/voice/livekit_client.go`
- [X] T031 [US1] Add chat room membership authorization interface used by voice logic in `backend/internal/chat/logic.go`
- [X] T032 [US1] Register VoiceService routes and LiveKit dependencies in `backend/cmd/server.go`
- [X] T033 [P] [US1] Implement web voice call state hook with join credentials handling and degraded-quality state in `frontend/apps/web/src/app/workspace/chat/hooks/useVoiceCall.ts`
- [X] T034 [P] [US1] Implement web active call controls in `frontend/apps/web/src/app/workspace/chat/components/voice/VoiceCallBar.tsx`
- [X] T035 [US1] Integrate web start/join/leave controls into the chat composer in `frontend/apps/web/src/app/workspace/chat/components/MessageComposer.tsx`
- [X] T036 [P] [US1] Implement mobile LiveKit join/leave client behavior and degraded-quality state in `frontend/apps/mobile/src/lib/voice/voice-client.ts`
- [X] T037 [US1] Add mobile call control banner to chat UI in `frontend/apps/mobile/src/components/chat/voice-call-banner.tsx`

**Checkpoint**: User Story 1 is independently testable and demoable as the MVP.

---

## Phase 4: User Story 2 - Surface Ongoing Group Calls and Invitations (Priority: P1)

**Goal**: Channel and task chat members can discover ongoing group calls, join from the conversation surface, and invite additional eligible people.

**Independent Test**: Start a call in a channel or task chat. Verify the room shows a system-generated announcement and active-call indicator, late joiners can join after reload, participants can invite another eligible employee, and ineligible users are denied.

### Tests for User Story 2

- [X] T038 [P] [US2] Add backend integration scenarios for group call announcements, late discovery, invitations, and denied ineligible joins in `backend/integration/voice_communication_test.go`
- [X] T039 [P] [US2] Add web E2E scenarios for active call announcement, room indicator, late join, invite, and access denied states in `frontend/apps/web/e2e/voice-communication.spec.ts`
- [X] T040 [P] [US2] Extend mobile Maestro flow for active call indicator and join-from-room behavior in `frontend/apps/mobile/.maestro/voice-communication.yaml`

### Implementation for User Story 2

- [X] T041 [US2] Create server-authored voice call announcement and ended-event timeline messages in `backend/internal/chat/logic.go`
- [X] T042 [US2] Publish `voice_call_started`, `voice_call_updated`, and `voice_call_ended` live-only SSE events in `backend/internal/voice/logic.go`
- [X] T043 [US2] Implement `InviteToVoiceCall` and `RespondToVoiceCallInvite` business logic in `backend/internal/voice/logic.go`
- [X] T044 [US2] Implement invite and invite-response Connect handlers in `backend/internal/voice/service_connect.go`
- [X] T045 [US2] Add invitation and active-call notification policies in `backend/internal/notification/constants.go`
- [X] T046 [P] [US2] Parse voice SSE events in web chat stream handling in `frontend/apps/web/src/app/workspace/chat/hooks/useChatSSE.ts`
- [X] T047 [P] [US2] Implement web active call announcement component in `frontend/apps/web/src/app/workspace/chat/components/voice/VoiceCallAnnouncement.tsx`
- [X] T048 [US2] Integrate active call indicators into the web message list and channel sidebar in `frontend/apps/web/src/app/workspace/chat/components/VirtualizedMessageList.tsx` and `frontend/apps/web/src/app/workspace/chat/components/ChannelSidebar.tsx`
- [X] T049 [P] [US2] Parse voice SSE events for mobile chat in `frontend/apps/mobile/src/lib/chat-stream-events.ts`
- [X] T050 [US2] Render mobile active-call announcement and denied-join states in `frontend/apps/mobile/src/components/chat/chat-message-body.tsx`

**Checkpoint**: User Story 2 works independently once User Story 1 call lifecycle exists.

---

## Phase 5: User Story 3 - Send and Review Voice Messages (Priority: P2)

**Goal**: Employees can record, cancel, send, retry, and play voice messages in direct messages, channels, and task chat channels.

**Independent Test**: Record a voice message in each supported room type, cancel before send, send successfully, retry after interrupted upload, and confirm another participant can play the message with sender, timestamp, duration, and delivery status visible.

### Tests for User Story 3

- [X] T051 [P] [US3] Add backend integration scenarios for voice message upload request, confirm, cancel, retry, idempotency, playback metadata, 10-second playback visibility, and storage-size metadata in `backend/integration/voice_communication_test.go`
- [X] T052 [P] [US3] Add web E2E scenarios for record, cancel, retry, send, play, and 10-second playable-state timing for voice messages in `frontend/apps/web/e2e/voice-communication.spec.ts`
- [X] T053 [P] [US3] Add mobile Maestro flow for record, send, and play voice messages in `frontend/apps/mobile/.maestro/voice-communication.yaml`

### Implementation for User Story 3

- [X] T054 [US3] Implement `RequestVoiceMessageUpload`, `ConfirmVoiceMessageUpload`, and `CancelVoiceMessage` business logic in `backend/internal/voice/logic.go`
- [X] T055 [US3] Implement voice message Connect handlers in `backend/internal/voice/service_connect.go`
- [X] T056 [US3] Add voice message idempotency, status, and metadata queries in `backend/database/scripts/voice.query.sql`
- [X] T057 [US3] Extend chat message creation and list mapping for `message_kind = 'voice'` in `backend/internal/chat/logic.go` and `backend/database/scripts/chat.query.sql`
- [X] T058 [US3] Validate voice audio MIME types, codec, duration, size limits, and file metadata integration in `backend/internal/chat/file_upload.go`
- [X] T059 [US3] Add voice message API wrapper methods in `frontend/packages/apis/src/voice.ts`
- [X] T060 [P] [US3] Implement web voice recording/upload hook in `frontend/apps/web/src/app/workspace/chat/hooks/useVoiceMessages.ts`
- [X] T061 [P] [US3] Implement web voice recorder component in `frontend/apps/web/src/app/workspace/chat/components/voice/VoiceMessageRecorder.tsx`
- [X] T062 [P] [US3] Implement web voice message player component in `frontend/apps/web/src/app/workspace/chat/components/voice/VoiceMessagePlayer.tsx`
- [X] T063 [US3] Integrate web voice recording into the message composer in `frontend/apps/web/src/app/workspace/chat/components/MessageComposer.tsx`
- [X] T064 [US3] Render web voice message timeline items in `frontend/apps/web/src/app/workspace/chat/components/MessageItem.tsx`
- [X] T065 [P] [US3] Implement mobile voice message recorder helper in `frontend/apps/mobile/src/lib/voice/voice-message-recorder.ts`
- [X] T066 [P] [US3] Implement mobile voice message player component in `frontend/apps/mobile/src/components/chat/voice-message-player.tsx`
- [X] T067 [US3] Render mobile voice messages in `frontend/apps/mobile/src/components/chat/chat-message-body.tsx`

**Checkpoint**: User Story 3 can be tested without active live calls, using only chat membership and file upload infrastructure.

---

## Phase 6: User Story 4 - Receive Follow-Up Records, Transcripts, and Priority Alerts (Priority: P2)

**Goal**: Employees receive high-priority incoming-call alerts and can review completed call records with participants, timing, storage-efficient recording artifacts, and transcripts when available.

**Independent Test**: Trigger incoming call and invite notifications while the recipient is not already in the room and while the recipient is already in another call, verify priority and switch/stay behavior, end the call, then verify the room shows a completed call record with metadata and available/unavailable recording and transcript artifacts.

### Tests for User Story 4

- [X] T068 [P] [US4] Add backend integration scenarios for priority alerts within 5 seconds, already-in-another-call switch/stay behavior, call outcomes, call records within 2 minutes, LiveKit webhook reconciliation, artifact states, and recording storage-size baseline in `backend/integration/voice_communication_test.go`
- [X] T069 [P] [US4] Add web E2E scenarios for incoming-call alert timing, switch/stay behavior, completed call record timing, recording playback, transcript display, and unavailable artifact states in `frontend/apps/web/e2e/voice-communication.spec.ts`
- [X] T070 [P] [US4] Extend mobile Maestro flow for incoming call navigation, switch/stay behavior, and completed call record review in `frontend/apps/mobile/.maestro/voice-communication.yaml`

### Implementation for User Story 4

- [X] T071 [US4] Implement LiveKit webhook authentication, participant reconciliation, and room-finished handling in `backend/internal/voice/webhook.go`
- [X] T072 [US4] Implement egress recording and transcript artifact state handling with optimized encoding metadata and `storage_bytes` tracking in `backend/internal/voice/artifacts.go`
- [X] T073 [US4] Implement `ListCallRecords` and `GetCallRecord` logic with artifact availability mapping in `backend/internal/voice/logic.go`
- [X] T074 [US4] Implement call record and artifact sqlc queries in `backend/database/scripts/voice.query.sql`
- [X] T075 [US4] Publish priority `voice_call_incoming` notifications and call-record refresh events in `backend/internal/voice/logic.go`
- [X] T076 [US4] Implement already-in-another-call switch/stay decision handling in `backend/internal/voice/logic.go`
- [X] T077 [US4] Wire LiveKit webhook HTTP route and voice artifact dependencies in `backend/cmd/server.go`
- [X] T078 [P] [US4] Implement web incoming-call alert surface with switch/stay actions in `frontend/apps/web/src/app/workspace/chat/components/voice/IncomingCallDialog.tsx`
- [X] T079 [P] [US4] Implement web call record renderer in `frontend/apps/web/src/app/workspace/chat/components/voice/VoiceCallRecord.tsx`
- [X] T080 [P] [US4] Implement web transcript panel and artifact unavailable states in `frontend/apps/web/src/app/workspace/chat/components/voice/VoiceTranscriptPanel.tsx`
- [X] T081 [US4] Render web call records and artifact status in `frontend/apps/web/src/app/workspace/chat/components/MessageItem.tsx`
- [X] T082 [P] [US4] Implement mobile incoming-call banner with switch/stay actions in `frontend/apps/mobile/src/components/chat/incoming-call-banner.tsx`
- [X] T083 [P] [US4] Implement mobile call record renderer in `frontend/apps/mobile/src/components/chat/voice-call-record.tsx`
- [X] T084 [US4] Render mobile call records and artifact status in `frontend/apps/mobile/src/components/chat/chat-message-body.tsx`

**Checkpoint**: User Story 4 delivers urgent call notification behavior and durable post-call history even when recording/transcript artifacts fail.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Finish generated-code hygiene, full-suite verification, security review, then documentation and runbook updates.

- [X] T085 Validate generated code and formatting outputs in `backend/rpc/v1/voice.pb.go`, `backend/database/voice.query.sql.go`, and `frontend/packages/rpc/rpc/v1/voice_pb.ts`
- [X] T086 Run backend integration suite and fix failures in `backend/integration/voice_communication_test.go` and `backend/integration/voice_constants_test.go`
- [X] T087 Run web Playwright suite and fix failures in `frontend/apps/web/e2e/voice-communication.spec.ts`
- [X] T088 Run mobile typecheck and fix voice UI type errors in `frontend/apps/mobile/src/lib/voice/voice-client.ts`
- [X] T089 Run Maestro mobile suite and fix flow issues in `frontend/apps/mobile/.maestro/voice-communication.yaml`
- [X] T090 Perform tenant isolation, LiveKit token scope, webhook signature, and notification priority security review in `backend/internal/voice/logic.go` and `backend/internal/voice/webhook.go`
- [X] T091 [P] After T086-T089 pass, update system architecture domain catalog, dependency graphs, server initialization order, and FK map in `backend/docs/SYSTEM-ARCHITECTURE.md`
- [X] T092 [P] After T086-T089 pass, update backend voice architecture documentation in `backend/docs/VOICE-COMMUNICATION-ARCHITECTURE.md`
- [X] T093 [P] After T086-T089 pass, update SSE voice event notes in `backend/docs/NOTIFICATION-SYSTEM-ARCHITECTURE.md`
- [X] T094 [P] After T086-T089 pass, add voice deployment and TURN/STUN runbook details in `backend/docs/VOICE-COMMUNICATION-ARCHITECTURE.md`
- [X] T095 Verify quickstart commands and update drift in `specs/032-voice-communication-support/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: No dependencies; can begin immediately.
- **Phase 2 Foundational**: Depends on Phase 1 dependency/package and infrastructure decisions.
- **Phase 3 US1**: Depends on Phase 2; this is the MVP and unlocks live call behavior.
- **Phase 4 US2**: Depends on US1 call lifecycle because discovery/invites attach to active calls.
- **Phase 5 US3**: Depends on Phase 2 only; can proceed after foundational APIs and schema are ready.
- **Phase 6 US4**: Depends on US1 for call lifecycle and partially on US2 for incoming-call notification surfaces.
- **Phase 7 Polish**: Depends on all desired user stories being implemented.

### User Story Dependencies

- **US1 (P1)**: Independent MVP after foundational work.
- **US2 (P1)**: Requires US1 active call lifecycle, but its UI and SSE parsing can be developed in parallel with backend invite logic.
- **US3 (P2)**: Independent from live calls after foundational schema/proto work.
- **US4 (P2)**: Requires US1 call records and LiveKit room naming; priority alert UI overlaps with US2 notification handling.

### Within Each User Story

- Write story tests first and confirm they fail for the missing behavior.
- Implement database/query changes before backend logic that depends on generated sqlc methods.
- Implement backend logic before Connect handlers and frontend API wrappers that consume response shapes.
- Implement frontend state hooks before visual components that depend on hook state.
- Run the story's independent backend integration, web E2E, and mobile checks before moving to the next story.

### Parallel Opportunities

- Setup dependency and infrastructure changes T001-T008 can be split by backend, web, mobile, and infrastructure owners.
- Foundational schema/proto/API wrapper/constant-sync work T009-T021 can run in parallel by file once naming is agreed.
- US1 tests T023-T026 can be written in parallel before implementation.
- US1 web and mobile UI tasks T033-T037 can run in parallel with backend handler work T027-T032 after the RPC contract is generated.
- US2 tests T038-T040 and UI parsing/rendering T046-T050 can run in parallel with backend invite work T041-T045.
- US3 web recorder/player tasks T060-T064 can run in parallel with mobile recorder/player tasks T065-T067 after API wrappers exist.
- US4 web record/alert components T078-T081 can run in parallel with mobile record/alert components T082-T084 and backend webhook/artifact work T071-T077.
- Documentation tasks T091-T094 can run in parallel with each other after final verification T085-T089 and security review T090 complete.

## Parallel Example: User Story 1

```text
Task: "T023 [P] [US1] Add backend integration scenarios for start, join, leave, end, room eligibility, one-active-call races, disconnect/rejoin, 5-second active-call discovery, and audio-only TURN/ICE configuration in backend/integration/voice_communication_test.go"
Task: "T024 [P] [US1] Add web E2E scenarios for starting and joining calls, active-call visibility, and degraded-quality state in supported room types in frontend/apps/web/e2e/voice-communication.spec.ts"
Task: "T025 [P] [US1] Add mobile Maestro happy path for channel call start, join, leave, and degraded-quality affordance in frontend/apps/mobile/.maestro/voice-communication.yaml"
Task: "T033 [P] [US1] Implement web voice call state hook with join credentials handling and degraded-quality state in frontend/apps/web/src/app/workspace/chat/hooks/useVoiceCall.ts"
Task: "T036 [P] [US1] Implement mobile LiveKit join/leave client behavior and degraded-quality state in frontend/apps/mobile/src/lib/voice/voice-client.ts"
```

## Parallel Example: User Story 3

```text
Task: "T060 [P] [US3] Implement web voice recording/upload hook in frontend/apps/web/src/app/workspace/chat/hooks/useVoiceMessages.ts"
Task: "T061 [P] [US3] Implement web voice recorder component in frontend/apps/web/src/app/workspace/chat/components/voice/VoiceMessageRecorder.tsx"
Task: "T062 [P] [US3] Implement web voice message player component in frontend/apps/web/src/app/workspace/chat/components/voice/VoiceMessagePlayer.tsx"
Task: "T065 [P] [US3] Implement mobile voice message recorder helper in frontend/apps/mobile/src/lib/voice/voice-message-recorder.ts"
Task: "T066 [P] [US3] Implement mobile voice message player component in frontend/apps/mobile/src/components/chat/voice-message-player.tsx"
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 Setup.
2. Complete Phase 2 Foundational.
3. Complete Phase 3 User Story 1.
4. Run backend integration, web E2E, and mobile happy-path checks for User Story 1.
5. Demo start/join/leave/end calls in DM, channel, and task chat without invitations, recordings, transcripts, or voice messages.

### Incremental Delivery

1. **US1**: Live call lifecycle and room membership enforcement.
2. **US2**: Group call discovery, system announcements, and invitations.
3. **US3**: Async voice messages in the conversation timeline.
4. **US4**: Priority incoming-call alerts, completed call records, recordings, transcripts, and webhook reconciliation.
5. **Polish**: Full-suite verification, docs, security review, and quickstart validation.

### Team Strategy

With multiple contributors after Phase 2:
- Backend owner implements `backend/internal/voice/*`, `backend/database/scripts/voice.query.sql`, and integration tests.
- Web owner implements `frontend/packages/apis/src/voice.ts`, web hooks/components, and Playwright scenarios.
- Mobile owner implements `frontend/apps/mobile/src/lib/voice/*`, chat renderers, and Maestro flows.
- Infrastructure owner implements `backend/docker-compose.yml`, Kubernetes manifests, LiveKit/TURN deployment config, and runbooks.

## Notes

- Use internal package `dbuuid` for Go UUID generation and parsing in voice code.
- Keep LiveKit tokens short-lived and scoped to one room and one authenticated employee.
- SSE notification payloads are discovery signals only; every join still calls `JoinVoiceCall` and rechecks room access.
- Audio intelligibility under constrained cellular conditions needs documented manual or lab network-shaping verification in addition to automated state tests.