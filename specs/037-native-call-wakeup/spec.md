# Feature Specification: Time-Sensitive Call Wakeup & Native Call Experience

**Feature Branch**: `037-native-call-wakeup`

**Created**: 2026-08-28

**Status**: Draft

**Input**: User description: "time-sensitive call support with wakeup. We do have voice call support already but this spec focusing on improvement for devices specific wakeup and UI like CallKit for iOS and core-telecom for Android."

## Context

Voice calling already works end to end: a caller starts a call in a channel, the callee is
rung through the notification pipeline, and both sides join a shared audio session. The gap
is what happens on a **phone that is not already awake with the app in front of the user**.
Today an incoming call reaches a mobile device as an ordinary alert notification competing
with every other notification, subject to the same delayed-fallback delivery, the same
do-not-disturb suppression, and the same in-app answer flow. The result is that calls to a
locked, backgrounded, or recently-killed phone arrive late, arrive silently, or do not
arrive at all — and when they do arrive, answering takes several taps through the app
rather than the one-tap answer people expect from a phone call.

This feature makes an incoming call behave like a phone call on the device: it wakes the
device immediately, rings on the lock screen using the operating system's own incoming-call
screen, and is answered, declined, muted and hung up through the same controls people use
for every other call on that phone.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Answering a call from a locked phone (Priority: P1)

A field technician's phone is in their pocket, locked, screen off, app not running in the
foreground. Their manager calls them from the workspace. The phone rings and vibrates like
a normal phone call and shows the operating system's full-screen incoming-call display with
the caller's name and the workspace's identity. The technician swipes to answer without
unlocking, and is in the conversation with audio working.

**Why this priority**: This is the entire point of a call. A call that cannot reach a
locked phone is not a calling feature — it is a chat notification. Every other story in
this spec is refinement on top of this one.

**Independent Test**: Lock a device, put the app in the background, place a call from
another account, and confirm the device rings within the target window, shows the native
incoming-call screen, and answers into working two-way audio without unlocking first.

**Acceptance Scenarios**:

1. **Given** the callee's device is locked with the app backgrounded, **When** a caller
   starts a call in a channel the callee belongs to, **Then** the device rings audibly and
   presents the operating system's incoming-call screen showing the caller's display name.
2. **Given** the native incoming-call screen is showing, **When** the callee accepts,
   **Then** the callee is joined to the call with two-way audio and the app opens to the
   in-call surface.
3. **Given** the native incoming-call screen is showing, **When** the callee declines,
   **Then** the caller is told the call was declined, the call ends with a declined
   outcome, and a missed/declined record appears in the conversation.
4. **Given** the callee's device has not run the app for several days, **When** a call
   arrives, **Then** the device still wakes and rings.
5. **Given** the call has been ringing beyond the ring timeout with no answer, **Then** the
   ringing stops on the device, the call ends as missed, and the missed call is visible in
   the conversation.

---

### User Story 2 - Managing an in-progress call from the phone's own controls (Priority: P1)

Once connected, the call behaves like any other call on the device: it appears in the
system call UI, mute and speaker work from the lock screen and control center, the call
shows in the device's recent-calls surface where the platform provides one, and audio
routing to a Bluetooth headset or car works without the user going back into the app.

**Why this priority**: A call answered through the system screen but then only controllable
inside the app is worse than either extreme — the user is stranded with no visible call and
no way to hang up. Native answer and native in-call control must ship together.

**Independent Test**: Answer a call, lock the phone, and confirm the call is visible and
controllable (mute, speaker, hang up) from the lock screen, and that hanging up there ends
the call for both parties.

**Acceptance Scenarios**:

1. **Given** a connected call, **When** the user locks the phone, **Then** the call remains
   visible and controllable from the system's call controls.
2. **Given** a connected call, **When** the user mutes from the system controls, **Then**
   the other participants stop hearing them and the app's own in-call surface shows muted.
3. **Given** a connected call, **When** the user hangs up from the system controls, **Then**
   the call ends for all participants and the call record closes with a completed outcome.
4. **Given** a connected call, **When** a Bluetooth headset connects or disconnects,
   **Then** audio follows the device's routing without dropping the call.

---

### User Story 3 - Calls and the rest of the phone coexisting (Priority: P2)

The workspace call has to behave correctly alongside the phone's other calls and the user's
own quiet-hours settings. A cellular call in progress means the workspace call is refused
rather than talked over; a workspace call in progress means the user is shown as busy to
further callers; and because a call is a live, time-sensitive event, it is allowed to ring
through routine notification muting while still respecting the user's operating-system
level controls.

**Why this priority**: Getting this wrong is worse than not shipping — two calls fighting
for the microphone, or a call ringing at 2am for someone who set quiet hours, both damage
trust. But it only matters once P1 works.

**Independent Test**: Place a workspace call to a device already on a cellular call, and to
a device with app notifications muted, and confirm each behaves per the scenarios below.

**Acceptance Scenarios**:

1. **Given** the callee is on a cellular call, **When** a workspace call arrives, **Then**
   the workspace call is not force-connected; the callee is informed per platform
   convention and the caller sees the call end as unanswered if it is not taken.
2. **Given** the callee is already on a workspace call, **When** a second workspace call
   arrives, **Then** the second caller is told the person is on another call and the first
   call is not interrupted.
3. **Given** the user has muted the workspace's routine notifications or set a
   do-not-disturb window in the workspace, **When** a call arrives, **Then** the call still
   rings, because a call is a live event rather than a routine notification.
4. **Given** the user has silenced calls at the operating-system level, **When** a call
   arrives, **Then** the workspace respects that setting and does not attempt to override
   it.

---

### User Story 4 - The caller knows what is happening (Priority: P2)

The caller sees honest state while the other side is being woken: ringing, then answered,
declined, busy, or unreachable. When the callee's device cannot be reached at all, the
caller learns that quickly instead of listening to a ring that will never be answered.

**Why this priority**: Without it, callers repeatedly re-dial unreachable people, which
multiplies both the annoyance and the load. It depends on P1 but is separately testable.

**Independent Test**: Call a device that is powered off or has no reachable delivery
target, and confirm the caller sees an unreachable outcome within the target window rather
than an indefinite ring.

**Acceptance Scenarios**:

1. **Given** a call is placed, **When** the callee's device has been woken and is ringing,
   **Then** the caller's screen shows ringing.
2. **Given** a call is placed to a person with no reachable device, **When** the wake
   attempt fails, **Then** the caller sees an unreachable/could-not-be-reached result and
   the call ends without a full ring timeout.
3. **Given** a call is placed to a person on more than one device, **When** one device
   answers, **Then** ringing stops on that person's other devices.

---

### User Story 5 - Calls do not become a spam or battery channel (Priority: P3)

The wakeup path is privileged — it can wake a locked phone past ordinary notification
settings — so it is used only for genuine, in-flight calls. It cannot be used to wake a
device for a marketing message, it stops as soon as the call is no longer live, and a
device that receives a wake for a call that has already ended shows nothing.

**Why this priority**: Platform vendors revoke this privilege from apps that abuse it, and
a stale wake that rings for a dead call is a bug users report immediately. Important, but
it is a constraint on P1 rather than standalone value.

**Independent Test**: Cancel a call immediately after placing it and confirm the callee's
device either never rings or stops ringing promptly with no lingering call screen; confirm
no non-call event can trigger the wake path.

**Acceptance Scenarios**:

1. **Given** a call is cancelled by the caller before it is answered, **When** the callee's
   device receives the wake, **Then** ringing stops promptly and no orphaned call screen
   remains.
2. **Given** a wake arrives for a call that has already ended, **When** the device
   processes it, **Then** the device reports the call as ended rather than presenting a
   ring.
3. **Given** any non-call notification, **When** it is published, **Then** it does not use
   the call wakeup path.

---

### Edge Cases

- The app has been force-quit by the user; a call must still wake the device.
- The device is in airplane mode or offline when the call is placed, and comes back online
  after the call has already ended — no phantom ring.
- The wake arrives but the workspace session has expired or the account was deactivated;
  the device must not ring into a call it cannot join.
- The user answers on the native screen but joining the call fails (network, capacity,
  permission revoked mid-flight); the failure must be shown, and the system call must be
  closed rather than left hanging.
- Microphone permission was revoked since the last call; answering must fail cleanly with
  an explanation rather than connecting to silence.
- The callee's device is woken, but the caller hangs up during the same second.
- The same person is signed in on multiple devices, including a browser tab; answering
  anywhere must settle the call everywhere.
- The device's operating system version predates the native call surface, or the user
  denied the permission the native call surface requires; a usable fallback ring must
  remain.
- Regions where the platform's native call surface is unavailable or restricted.
- The person is blocked by the caller in a direct conversation — the block check must still
  refuse the call *before* any device is woken.

## Requirements *(mandatory)*

### Functional Requirements

#### Wakeup

- **FR-001**: System MUST deliver an incoming call to the callee's mobile devices over a
  time-sensitive path that wakes a locked device with the app backgrounded or not running.
- **FR-002**: The call wakeup MUST bypass the delayed-fallback delivery used for routine
  notifications, so no artificial delay is inserted between placing the call and the device
  ringing.
- **FR-003**: The call wakeup MUST be reserved for live call events (ring, cancel, end);
  no other notification type may use it.
- **FR-004**: System MUST target every registered device belonging to the callee, and MUST
  stop the ring on the remaining devices once the call is answered, declined, cancelled, or
  timed out.
- **FR-005**: System MUST record, per device and per call, whether the wake was delivered,
  refused, or failed, so unreachable people can be diagnosed after the fact.
- **FR-006**: When no device can be woken, System MUST end the call promptly with an
  unreachable outcome instead of ringing for the full timeout.

#### Native call presentation

- **FR-007**: On receiving a call wake, the mobile app MUST present the operating system's
  own incoming-call experience — full-screen on the lock screen, with the platform's
  standard answer and decline controls — rather than an ordinary notification banner.
- **FR-008**: The incoming-call display MUST show the caller's display name and identify
  the workspace, and MUST NOT disclose message content or other conversation detail on the
  lock screen.
- **FR-009**: Accepting from the native screen MUST join the call and open the app's in-call
  surface, with no additional unlock, tap-through, or sign-in step when a valid session
  exists.
- **FR-010**: Declining from the native screen MUST end the call with a declined outcome
  and inform the caller, without opening the app.
- **FR-011**: A connected call MUST be represented in the device's system call UI for its
  whole duration, so mute, speaker, audio routing and hang-up work from the lock screen and
  system controls.
- **FR-012**: Call state changes made through system controls MUST be reflected in the
  workspace call record and to other participants, and workspace-side state changes MUST be
  reflected back into the system call UI.
- **FR-013**: The app MUST close the system call when the call ends for any reason —
  answered elsewhere, cancelled, declined, timed out, hung up remotely, or failed to join —
  leaving no orphaned call screen.
- **FR-014**: On devices where the native call surface is unavailable, unsupported, or its
  permission has been denied, the app MUST fall back to a high-priority in-app ring that
  still allows answering and declining, and MUST tell the user what they lose.

#### Coexistence and permissions

- **FR-015**: System MUST refuse to force-connect a workspace call while the device is on
  another call (cellular or workspace), and MUST report the busy state to the caller.
- **FR-016**: Incoming calls MUST ring through workspace-level notification muting and
  workspace do-not-disturb windows, because a call is a live event; System MUST NOT
  attempt to override operating-system level call silencing.
- **FR-017**: The app MUST request the permissions the native call experience requires at a
  point where the user understands why, and MUST remain usable if they are declined.
- **FR-018**: Existing call authorization MUST be evaluated before any device is woken —
  including channel permission and the direct-conversation block guard — so a refused call
  never rings anyone.
- **FR-019**: A wake that arrives on a device with no valid workspace session MUST NOT
  present a ring.

#### Records and history

- **FR-020**: Calls answered, declined or missed through the native surface MUST produce
  the same call records, conversation system messages and missed-call visibility as calls
  handled inside the app.
- **FR-021**: Where the platform offers a system-level recent-calls surface, workspace
  calls MAY appear there only if the user has enabled it, and workspace calls MUST be
  distinguishable from personal phone calls.

### Key Entities

- **Call wake target**: a registered device of a callee that can be woken for a call, with
  the platform it belongs to and whether it currently supports the native call experience.
  Distinct from the device's routine notification registration, because the two can be
  independently valid or expired.
- **Call wake attempt**: the record of trying to wake one device for one call — when it was
  attempted, whether the platform accepted it, and the outcome. This is the audit trail
  behind "my phone never rang".
- **Device call session**: the operating system's representation of the call on one device,
  paired one-to-one with a participant's presence in the workspace call. Its lifecycle must
  start and end with the workspace call's.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A locked phone with the app not running begins ringing within 5 seconds of
  the caller placing the call, in at least 95% of attempts on a normal network.
- **SC-002**: A called person can answer and be talking within 3 seconds of accepting, in
  at least 95% of answers.
- **SC-003**: Answering takes one action on the lock screen — no unlock, no app navigation,
  no second confirmation.
- **SC-004**: The share of placed calls that are never presented to any of the callee's
  devices drops below 2%, measured over a week of real usage.
- **SC-005**: Zero orphaned call screens: after any call ends, no device still shows an
  incoming or in-progress call within 5 seconds, across a 200-call soak covering cancel,
  decline, timeout and remote hang-up.
- **SC-006**: A caller learns the call cannot be delivered within 10 seconds when the
  callee has no reachable device, rather than waiting out the full ring timeout.
- **SC-007**: Mute, speaker, audio-route change and hang-up performed from the phone's own
  controls take effect for other participants within 2 seconds, 100% of the time.
- **SC-008**: Support contacts about missed or silent workspace calls fall by 70% relative
  to the four weeks before release.
- **SC-009**: Continuous idle battery cost attributable to call readiness stays below 1% of
  battery per day on a device receiving no calls.

## Assumptions

- The existing call lifecycle, call records, invitations, conversation system messages and
  the direct-conversation block guard are reused unchanged; this feature changes how a call
  reaches and is presented on a device, not what a call is.
- The user's mention of the iOS and Android native calling frameworks is read as the intent
  "use each platform's own incoming-call and in-call experience", and the choice of the
  specific platform mechanism is a planning decision, not a requirement of this spec.
- Mobile means the workspace's iOS and Android apps. Web calling is unchanged and out of
  scope beyond FR-004's requirement that answering on a phone settles the call for a
  browser session too.
- Video calling is out of scope; calls remain audio.
- The native call experience requires a build of the app that includes platform call
  integration, so this feature ships with a store release rather than an over-the-air
  update.
- Existing device registration is extended rather than replaced; a device may hold a call
  wake target and a routine notification registration at the same time.
- No new organization-level administrative settings are introduced; whether calls ring is a
  personal and operating-system level choice.
- Region-restricted platform call surfaces are handled by the fallback in FR-014 rather
  than by a separate regional feature.

## Out of Scope

- Video calls.
- Dialling or receiving calls from the public telephone network.
- Call transfer, hold-and-swap between two workspace calls, and conference merge.
- Changes to recording, transcription or call artefact handling.
- Desktop and web notification wakeup behaviour.
