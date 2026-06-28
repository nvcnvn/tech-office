# Feature Specification: Voice Communication Support

**Feature Branch**: `032-voice-communication-support`  
**Created**: 2026-05-10  
**Status**: Draft  
**Input**: User description: "voice call and voice message support.
- we want to support voice call in dm, channel, task chat channel.
- in case of call making in group, we create a system message that telling people on the room there is a call is happening, and they can join the chat room by clicking the button (still not sure where is that button, on the interactive message or on the top of channel indicator that a call is happening), or new people can get invited to an on-going call
- after call, a record (storage optimized) and transcript if possible
- in-comming call priority notification
- bandwidth optimized is non functional requirement"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Start and Join Live Voice Calls (Priority: P1)

An employee can start and join live voice calls directly from a direct message, team channel, or task chat so conversations can move from typing to speaking without leaving the workspace.

**Why this priority**: Real-time voice is the core user need in this request. Without reliable start and join flows, the rest of the feature has little value.

**Independent Test**: From a DM, a channel, and a task chat, start a voice call and have another eligible participant join. Verify both participants can hear one another and that access follows room membership.

**Acceptance Scenarios**:

1. **Given** an employee is in a direct message, channel, or task chat they can access, **When** they start a voice call, **Then** the room enters an active-call state and eligible participants can join it.
2. **Given** a voice call is already active in a room, **When** another eligible participant opens that room and chooses to join, **Then** they enter the live call without starting a second parallel call for the same room.
3. **Given** a participant leaves an active call, **When** at least one other participant remains, **Then** the call continues for the remaining participants.
4. **Given** the final participant leaves the call, **When** the room has no active participants, **Then** the call ends and the room exits the active-call state.

---

### User Story 2 - Surface Ongoing Group Calls and Invitations (Priority: P1)

A member of a channel or task chat can immediately see that a voice call is in progress, join from the conversation surface, and invite additional eligible people into that ongoing call.

**Why this priority**: Group calling only works if ongoing calls remain visible and discoverable to room members after the initial call starts.

**Independent Test**: Start a call in a channel or task chat. Verify the room shows an in-context announcement, late joiners can enter from the room, and an existing participant can invite another eligible person into the ongoing call.

**Acceptance Scenarios**:

1. **Given** a voice call starts in a channel or task chat, **When** the call becomes active, **Then** the conversation shows a system-generated announcement that a call is in progress and provides a clear way to join.
2. **Given** a member opens a room with an ongoing group call, **When** they view the conversation, **Then** they can see that the call is active even if they did not witness it start.
3. **Given** an ongoing group call is active, **When** a current participant invites another eligible person, **Then** the invited person receives an invitation and can join the existing call.
4. **Given** a person no longer has access to the room, **When** they attempt to open or join the ongoing call, **Then** access is denied.

---

### User Story 3 - Send and Review Voice Messages (Priority: P2)

An employee can record and send a voice message in a direct message, channel, or task chat so they can communicate asynchronously when a live call is unnecessary or not possible.

**Why this priority**: Voice messages extend the value of voice communication to offline and time-shifted collaboration.

**Independent Test**: Record a voice message in each supported room type, send it, and confirm another participant can play it back, see its sender and send time, and continue the surrounding text conversation normally.

**Acceptance Scenarios**:

1. **Given** an employee can post messages in a room, **When** they record and send a voice message, **Then** the voice message appears in the timeline as a playable message item.
2. **Given** a voice message exists in the room, **When** another eligible participant opens the conversation, **Then** they can play the message and identify who sent it and when.
3. **Given** a sender cancels before sending, **When** the recording is discarded, **Then** no partial voice message is posted to the room.
4. **Given** network quality is temporarily poor, **When** a voice message is being sent, **Then** the sender receives clear delivery status and the message is not duplicated.

---

### User Story 4 - Receive Follow-Up Records, Transcripts, and Priority Alerts (Priority: P2)

An employee receives a high-priority alert for incoming calls and, after a call ends, can review a compact post-call record that includes call metadata, a storage-efficient recording when available, and a transcript when one can be produced.

**Why this priority**: Calls are time-sensitive, and teams also need a usable record afterward for people who joined late, missed the call, or need to revisit what was said.

**Independent Test**: Trigger an incoming call while the recipient is not already inside that room, verify the alert is treated as urgent, end the call, and verify the room shows a completed call record with participants, timing, and any available recording/transcript artifacts.

**Acceptance Scenarios**:

1. **Given** an eligible participant is not already in the active room, **When** a voice call is initiated or they are invited into an ongoing call, **Then** they receive a high-priority incoming-call notification.
2. **Given** a voice call has ended, **When** a participant opens the room later, **Then** they can see a completed call record with start time, end time, and participant list.
3. **Given** call recording is permitted for that room, **When** the call ends successfully, **Then** the completed call record includes a storage-efficient audio playback artifact.
4. **Given** transcript generation succeeds for a completed call, **When** a participant views the post-call record, **Then** a transcript is available alongside the call record.

### Edge Cases

- What happens when two people try to start a call in the same room at nearly the same time? → The room resolves to one active call and all join attempts route into that single active session.
- What happens when a participant loses connectivity during a live call? → The participant is marked disconnected, can rejoin the same ongoing call if it is still active, and the rest of the call continues.
- What happens when a room has no one else available to answer? → The initiator sees that the call was unanswered, and the room records the missed-call outcome.
- What happens when a participant receives an incoming call while already in another call? → The new call is still surfaced as high priority, but the participant must explicitly choose whether to switch or stay in the current call.
- What happens when an invited person lacks room access? → The invitation cannot grant call access by itself; room access must be granted first.
- What happens when recording or transcript generation fails after the call? → The completed call record still appears with call metadata, and unavailable artifacts are shown as unavailable rather than blocking the record.
- What happens when bandwidth drops during a call? → The call prioritizes continuing intelligible audio over maintaining higher-fidelity quality.
- What happens when a voice message upload is interrupted? → The sender sees a failed or pending state and can retry without creating duplicate posted messages.
- What happens when a room already contains an active-call announcement and the call ends? → The active-call indication is cleared and the room retains the historical call record.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support starting, joining, leaving, and ending voice calls in direct messages, channels, and task chat channels.
- **FR-002**: System MUST ensure each room can have at most one active voice call at a time.
- **FR-003**: System MUST allow only eligible room participants to join a voice call associated with that room.
- **FR-004**: System MUST surface active-call state within the room so members can discover and join an ongoing call after it starts.
- **FR-005**: System MUST create a system-generated room event when a voice call starts in a channel or task chat, indicating that a call is happening and providing an in-context join path.
- **FR-006**: System MUST allow current participants in a channel or task chat call to invite additional eligible people into the ongoing call.
- **FR-007**: System MUST deliver incoming-call alerts as high-priority notifications for call starts and call invitations.
- **FR-008**: System MUST distinguish between answered, missed, declined, cancelled, and completed call outcomes in the post-call record.
- **FR-009**: System MUST create a completed call record after every ended call, including room reference, initiator, participants, timestamps, and call outcome.
- **FR-010**: System MUST attach a storage-optimized audio recording to the completed call record when recording is permitted and capture succeeds.
- **FR-011**: System MUST attach a transcript to the completed call record when transcription succeeds.
- **FR-012**: System MUST make it clear to participants whether recording and transcript artifacts are available for a completed call.
- **FR-013**: System MUST support recording and sending voice messages in direct messages, channels, and task chat channels.
- **FR-014**: System MUST display voice messages inline in the conversation timeline with sender identity, send time, playback controls, and delivery status.
- **FR-015**: System MUST let senders cancel a voice message before it is posted.
- **FR-016**: System MUST prevent duplicate voice-message posts when delivery is retried after interruption.
- **FR-017**: System MUST preserve room membership and permission rules for both live calls and voice messages.
- **FR-018**: System MUST allow participants who disconnect unexpectedly to rejoin the same ongoing call while it remains active.
- **FR-019**: System MUST show when a room currently has an ongoing call and clear that active-call indication when the call ends.
- **FR-020**: System MUST retain the historical call record in the room after the call ends.
- **FR-021**: System MUST keep live voice communication usable under constrained network conditions by prioritizing continuity and intelligibility of audio.
- **FR-022**: System MUST adapt live call quality to changing network conditions without requiring the user to restart the call.
- **FR-023**: System MUST minimize storage footprint for retained call recordings and voice messages while keeping playback understandable.
- **FR-024**: System MUST provide clear status to users when a call invitation, call join, voice message upload, recording generation, or transcript generation cannot be completed.

### Key Entities *(include if feature involves data)*

- **Voice Call Session**: A live audio conversation attached to one direct message, channel, or task chat room. Tracks lifecycle state, initiator, active participants, invitations, and call outcome.
- **Call Announcement**: A system-generated room event that tells members a group call is in progress and gives them a room-scoped way to join.
- **Call Record**: The post-call summary retained in the room after a call ends. Includes timing, participants, outcome, and any available recording or transcript artifacts.
- **Voice Message**: An asynchronous audio message posted into a room timeline with sender identity, timestamp, delivery state, and playback information.
- **Call Invitation**: A targeted invite sent to an eligible person to join an ongoing call, with high-priority notification behavior.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In supported rooms, 95% of successful call starts make a joinable call visible to eligible participants within 5 seconds.
- **SC-002**: 95% of recipients of an incoming call or call invitation receive a high-priority alert within 5 seconds while they are online.
- **SC-003**: 90% of participants on a typical cellular connection can remain in a call for 10 minutes without needing to manually reconnect.
- **SC-004**: During constrained-network conditions, audio remains understandable enough for participants to complete a short coordination conversation in 90% of observed sessions.
- **SC-005**: 95% of completed calls generate a post-call record visible in the room within 2 minutes of call end.
- **SC-006**: When recording is permitted and capture succeeds, 95% of completed-call recordings are playable from the room record without the user needing to download a separate file.
- **SC-007**: 95% of successfully sent voice messages become playable in the room timeline within 10 seconds of the sender finishing the recording.
- **SC-008**: Storage usage per minute of retained call audio is reduced enough that the median retained recording consumes less space than an equivalent raw audio capture while remaining intelligible to listeners.

## Assumptions

- Direct messages remain limited to their existing participant model, while channels and task chat channels may involve larger groups and ongoing-call invitations.
- A room-level active-call indication may appear in more than one surface inside the conversation experience, as long as members always have a clear in-context way to discover and join the ongoing call.
- Call access follows the room's existing membership and permission model; inviting someone to a call does not, by itself, grant them access to a room they cannot access.
- Every completed call produces a call history record, while audio recording artifacts are created only in rooms where recording is allowed and capture completes successfully.
- Transcript generation is best effort and may be unavailable because of language quality, audio quality, or processing failure.
- Priority call notifications are expected to interrupt normal chat-notification ordering because calls are time-sensitive.
- Bandwidth optimization favors preserving clear speech and call continuity over higher-fidelity audio quality.