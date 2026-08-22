# Feature Specification: Presence Ping-Pong Protocol

**Feature Branch**: `033-presence-ping-pong`  
**Created**: 2026-08-22  
**Status**: Draft  
**Input**: User description: "custom ping pong protocol for checking user online status to support better notification. Replace the UpdatePresenceStatus endpoint with new ping pong protocol"

## Overview

Today a person's online status is *self-reported*: their app decides when to announce "I am online" and the platform trusts that announcement until a cleanup sweep eventually expires it. When an app is suspended, backgrounded, killed, or loses network without a clean shutdown, the platform keeps believing the person is present. That belief has a direct cost: notifications judged "deliverable live" are sent to a screen nobody is looking at, and the push/email fallback that would actually have reached the person is suppressed or delayed.

This feature replaces self-reported presence with a **challenge-and-answer (ping-pong) protocol**. The platform periodically challenges every live connection; only a connection that answers is treated as present. The answer also carries the person's current state (available / idle / hidden / in a meeting) and what they are currently looking at, so the answer fully replaces the existing `UpdatePresenceStatus` endpoint rather than sitting beside it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Notifications reach a colleague whose app went away silently (Priority: P1)

Mai sends Duc a direct message. Duc's laptop went to sleep ten minutes ago without his app announcing a departure. Because Duc's connection stops answering challenges, the platform stops treating him as present and delivers Mai's message through push notification to his phone instead of dropping it onto a sleeping screen. Duc sees the message on his phone within seconds.

**Why this priority**: This is the entire business reason for the feature. Silent disappearance is the dominant failure mode of self-reported presence, and every missed notification erodes trust in the product as a workplace communication tool. Shipping only this story already delivers the value.

**Independent Test**: Establish a live connection for a recipient, stop answering challenges without sending any explicit "going offline" message, then send that recipient a notification. Verify the recipient is treated as absent and the fallback delivery path is used, with the reason recorded as unresponsive rather than as a policy skip.

**Acceptance Scenarios**:

1. **Given** an employee has one live connection that has answered every challenge, **When** a notification is generated for them, **Then** it is delivered live and no fallback is queued.
2. **Given** an employee's only live connection stops answering challenges, **When** the unresponsive threshold passes and a notification is generated for them, **Then** the notification is routed to push/email fallback and the connection is not counted as a live delivery target.
3. **Given** an employee's connection was declared unresponsive, **When** the connection answers a subsequent challenge before the removal grace period elapses, **Then** the connection is restored to present and live delivery resumes without the employee re-authenticating or reloading.
4. **Given** an employee has two connections (laptop and phone) and only the phone answers challenges, **When** a notification is generated, **Then** it is delivered live to the phone only and no fallback is queued for the employee.

---

### User Story 2 - Teammates see an accurate presence indicator (Priority: P1)

Lan opens the team directory to decide whether to ask Duc a question now or leave an async note. The dots next to each teammate reflect who is genuinely reachable right now: people whose apps stopped answering appear offline rather than lingering as "online" for minutes.

**Why this priority**: Presence indicators are the visible surface of this protocol. Inaccurate dots cause people to wait for replies that will never come, which is the user-facing symptom colleagues actually complain about. It shares P1 with notification routing because both are fed by the same signal and would ship together.

**Independent Test**: Observe a viewer's presence view for a target employee, cut the target's connection without a clean shutdown, and verify the indicator transitions to offline within the stated detection window without any action by the viewer.

**Acceptance Scenarios**:

1. **Given** a viewer is looking at a colleague's presence indicator, **When** that colleague's connection stops answering challenges, **Then** the indicator moves to offline within the detection window.
2. **Given** a colleague has chosen to appear offline (hidden), **When** they are genuinely present and answering challenges, **Then** viewers continue to see them as offline while the platform still routes their notifications as live-deliverable.
3. **Given** a colleague briefly loses network and reconnects within the grace period, **When** the viewer's presence view refreshes, **Then** the colleague is shown as present again without an intermediate offline flicker.
4. **Given** a colleague is present on two devices with different states, **When** a viewer requests their presence, **Then** the most available of the two states is shown.

---

### User Story 3 - A person's own state and context stay accurate without a separate status call (Priority: P2)

Duc switches from the #engineering channel to a task, then steps away for lunch. His app reports the new context and the shift to idle through the same answer channel used for liveness. When he returns and moves the mouse, his state returns to available immediately rather than at the next scheduled challenge.

**Why this priority**: This is what makes the ping-pong protocol a genuine *replacement* for the status endpoint rather than an addition to it. It matters for correct routing (do not notify me about the channel I am staring at) but the P1 stories already deliver the core value.

**Independent Test**: Change state and active context on a connected client and verify the platform reflects the new state and context without the client invoking any separate status-update operation.

**Acceptance Scenarios**:

1. **Given** a person is viewing a channel, **When** they navigate to a different channel, **Then** their recorded active context updates to the new channel and live notifications for the newly-viewed channel are suppressed as already-seen.
2. **Given** a person has been inactive past their client's idle threshold, **When** the next answer is sent, **Then** their state is recorded as idle and routing treats them accordingly.
3. **Given** a person changes state between scheduled challenges (returns from idle, hides their presence, joins a meeting), **When** the client reports the change immediately, **Then** the platform records it without waiting for the next challenge.
4. **Given** a person closes the application cleanly, **When** the client reports departure, **Then** the person is marked offline immediately rather than after the unresponsive threshold.

---

### User Story 4 - Clients migrate off the old status endpoint (Priority: P2)

The web app and the mobile app both stop calling the separate presence-update operation; all presence flows through the ping-pong protocol. No stale client can push a presence claim that contradicts what the challenge results show.

**Why this priority**: Removing the old path is required by the request and prevents two competing sources of truth, but the protocol must exist and be proven first.

**Independent Test**: Search the client codebases for the removed operation and confirm no call sites remain; confirm the platform no longer exposes the operation and that presence for both clients is still accurate end to end.

**Acceptance Scenarios**:

1. **Given** the new protocol is live, **When** any caller invokes the removed presence-update operation, **Then** the platform rejects it as unavailable and no presence record is modified.
2. **Given** the web and mobile clients have migrated, **When** each is exercised through a full presence lifecycle (connect, idle, change context, disconnect), **Then** presence remains accurate with no calls to the removed operation.
3. **Given** the removal is a breaking API change, **When** the change ships, **Then** the API contract, cross-stack constants, and client wrappers are updated together in one change set.

---

### Edge Cases

- **Answer arrives after the connection was removed**: the platform treats the late answer as an implicit reconnect request and instructs the client to re-establish rather than silently resurrecting a removed connection.
- **Clock disagreement between client and platform**: liveness decisions rely on platform-observed arrival of answers, never on timestamps supplied by the client; client-supplied interaction times are treated as advisory and clamped to a sane range.
- **Many connections for one person** (several tabs, phone plus laptop, a forgotten office machine): each connection is challenged independently; a person is present if any connection answers, and their displayed state is the most available among answering connections.
- **Mobile app in background**: a backgrounded app that can still answer is treated as present but background-stated, so notifications that need attention still take the push path.
- **Platform restart or connection rebalancing**: connections that the platform can no longer challenge (their owning worker is gone) are treated as unresponsive on the same timetable as any other silent connection, and clients reconnect.
- **Answer storms after a network partition heals**: a burst of simultaneous answers must not overload the platform or produce duplicate presence records for the same connection.
- **A person who never answers a single challenge**: a connection that is established but never answers is removed on the same schedule as one that stopped answering, and is never counted for live delivery.
- **Hidden presence during unresponsiveness**: a person appearing offline by choice who then goes unresponsive is still routed to fallback delivery; visibility choice must not mask real absence from the routing decision.
- **Notification generated exactly at the threshold boundary**: routing must make a single deterministic decision (live or fallback) and never both deliver live and queue an unsuppressed fallback for the same recipient and notification.

## Requirements *(mandatory)*

### Functional Requirements

**Challenge and answer**

- **FR-001**: The platform MUST periodically challenge every live connection to prove it is still attended, on a fixed cadence, without any action from the person using the client.
- **FR-002**: A client MUST answer each challenge, and each answer MUST carry the person's current state, their current active context (if any), and the time of their last interaction.
- **FR-003**: The platform MUST derive presence solely from answers received from clients; it MUST NOT extend or refresh a connection's presence on the basis of platform-side activity alone.
- **FR-004**: A client MUST be able to send an unsolicited answer at any time to report a state or context change immediately, without waiting for the next challenge.
- **FR-005**: A client MUST be able to report a clean departure, which marks that connection offline immediately.
- **FR-006**: The platform MUST correlate every answer to a specific connection and reject answers that do not correspond to a connection owned by the authenticated person in the authenticated organization.

**Liveness state machine**

- **FR-007**: The platform MUST classify each connection as responsive, unresponsive, or removed, based on how long it has been since a valid answer was received.
- **FR-008**: The platform MUST mark a connection unresponsive after a defined number of consecutive unanswered challenges, and MUST remove it after a further grace period without an answer.
- **FR-009**: An unresponsive connection MUST return to responsive on receipt of any valid answer received before removal, with no re-authentication and no client-visible interruption.
- **FR-010**: A removed connection MUST NOT be resurrected by a late answer; the platform MUST direct the client to establish a new connection instead.
- **FR-011**: Presence for a person MUST be aggregated across all of their connections: they are present if at least one connection is responsive, and their reported state is the most available state among responsive connections.

**Notification routing**

- **FR-012**: Notification routing MUST treat only responsive connections as eligible live-delivery targets; unresponsive and removed connections MUST be excluded.
- **FR-013**: When a person has no responsive connection, notifications eligible for fallback MUST be routed to push/email delivery rather than suppressed as "recipient online".
- **FR-014**: The platform MUST record, for each notification that took the fallback path, whether the decision was driven by absence, by an unresponsive connection, by policy, or by the recipient's preference, so delivery outcomes remain auditable.
- **FR-015**: A person's choice to appear offline to colleagues MUST NOT change routing: their notifications are routed on their real responsiveness, not their displayed state.
- **FR-016**: Live delivery and unsuppressed fallback delivery MUST NOT both occur for the same notification and recipient; the routing decision MUST be made once per recipient per notification.

**Replacement of the existing endpoint**

- **FR-017**: The standalone presence-update operation (`UpdatePresenceStatus`) MUST be removed from the API surface; invoking it MUST fail as unavailable.
- **FR-018**: All state transitions previously expressible through that operation — available, hidden, idle, in a meeting, offline, and active channel context — MUST be expressible through an answer in the new protocol.
- **FR-019**: The web client and the mobile client MUST both be migrated to the new protocol in the same change set that removes the old operation, with no remaining call sites.
- **FR-020**: Presence read operations (single-employee and batch lookups) and presence visibility settings MUST continue to work unchanged from the caller's perspective.
- **FR-021**: Presence state values MUST remain synchronized across the API contract, the platform's stored values, and both client type definitions, per the project's cross-stack constant synchronization rules.

**Access control, tenancy, and operations**

- **FR-022**: Answering a challenge MUST be permitted for any authenticated person for their own connections, and MUST NOT be usable to alter another person's presence.
- **FR-023**: All presence records and liveness evaluation MUST remain scoped to a single organization; no presence signal may cross organization boundaries.
- **FR-024**: The platform MUST continue to detect and clear connections that outlive their owner's session or their owning worker, without relying on a client to announce the loss.
- **FR-025**: The platform MUST emit observable signals for challenge-answer health — answers received, connections marked unresponsive, connections removed, and reconnections — sufficient to diagnose presence problems in production without adding new instrumentation.
- **FR-026**: The protocol MUST tolerate the platform running as multiple interchangeable workers: any worker holding a connection challenges it, and presence decisions read consistently regardless of which worker serves a request.

### Key Entities

- **Connection**: One live client session belonging to one person in one organization. Holds the state last reported for that session, the active context being viewed, the time the last valid answer arrived, and its liveness classification (responsive / unresponsive / removed).
- **Challenge**: A platform-initiated prompt sent to one connection asking it to prove it is attended. Carries enough identity for the answer to be matched back to the connection that was challenged.
- **Answer**: A client-initiated response — solicited by a challenge or sent spontaneously on change — reporting the person's current state, active context, and last interaction time for that connection.
- **Person's presence**: The aggregate view of one person derived from all of their connections: overall availability state, the context they are viewing, and whether they are reachable live at all. Subject to visibility rules before being shown to a viewer.
- **Presence visibility preference**: The person's existing choice about who may see their presence and whether they appear offline. Unchanged by this feature, applied only to what viewers see.
- **Routing decision record**: The audit trail of how each notification was delivered for each recipient, including whether responsiveness drove the choice of live versus fallback delivery.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: When a person's device sleeps, loses network, or is force-closed without a clean shutdown, teammates see them as offline within 60 seconds of the last answer.
- **SC-002**: 95% of notifications sent to a person whose app has silently gone away are delivered by push or email within 30 seconds of the notification being created, instead of being dropped onto an unattended screen.
- **SC-003**: Notifications delivered live but never acknowledged because nobody was there ("ghost deliveries") fall by at least 90% compared with the current self-reported presence behaviour.
- **SC-004**: A person who briefly loses connectivity and reconnects within the grace period never appears offline to teammates and never triggers a duplicate push for a notification already delivered live.
- **SC-005**: Presence indicators shown to a viewer match the person's true reachability in at least 99% of sampled observations taken more than 60 seconds after any state change.
- **SC-006**: A person's own state and context changes (idle, return, hidden, switching channel) are reflected for other viewers within 5 seconds of the change.
- **SC-007**: Zero call sites of the removed presence-update operation remain in the web and mobile clients, and the operation is absent from the published API contract.
- **SC-008**: The protocol sustains the platform's target concurrent-connection load with no more than a single small exchange per connection per challenge interval, and adds no measurable delay to notification delivery.
- **SC-009**: Support reports of "I never got notified" attributable to stale presence drop to near zero over the first month after release.

## Assumptions

- **A-001**: A challenge cadence of roughly 20–30 seconds, unresponsive after two consecutive missed answers, and removal after a further grace period of about 60 seconds satisfies SC-001 while keeping traffic negligible. Exact values are tunable configuration, not fixed behaviour, and are chosen during planning.
- **A-002**: The protocol runs over the existing live client-to-platform connection used for notifications rather than introducing a new always-on transport. The specific mechanism is an implementation choice for the planning phase.
- **A-003**: This is an intentional breaking API change. The web and mobile clients are released together with the platform from this repository, so the removed operation needs no deprecation window; the change ships as one coordinated change set as required by the project's versioning rules.
- **A-004**: Clients keep their existing local rules for deciding when a person is idle (inactivity timer) and when their presence is hidden; this feature changes how those decisions are transported, not how they are made.
- **A-005**: The existing presence status vocabulary (available, hidden, idle, in a meeting, offline) is retained. No new presence states are introduced by this feature.
- **A-006**: Existing presence visibility settings, presence read operations, and push-token registration are out of scope except where they must keep working unchanged.
- **A-007**: Historical presence records need no migration; presence is inherently current-state data and is rebuilt from live connections after release.

## Out of Scope

- Presence for entities other than people (bots, integrations, shared devices).
- Changing what notifications are generated, their priorities, or their policies — only the live-versus-fallback delivery decision is affected.
- New presence states such as "do not disturb" or calendar-driven automatic status.
- Presence history, analytics dashboards, or reporting on who was online when.
- Changes to push token registration, push provider integration, or email fallback content.
