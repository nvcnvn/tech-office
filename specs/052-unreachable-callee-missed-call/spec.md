# Feature Specification: Unreachable Callee Still Gets a Missed Call

**Feature Branch**: `052-unreachable-callee-missed-call`

**Created**: 2026-09-05

**Status**: Draft

**Input**: User description: "Unreachable callee still gets a missed call. Decide drift D22: write the call record and the missed-call system message even when a direct call is refused immediately as unreachable, so an offline worker returning to the app sees that the manager tried to reach them."

## Context

When someone places a direct call, the workspace decides *before the call exists* whether
the other person can be reached at all. If no device of theirs can be woken — no valid
push registration, no responsive live connection — the call is refused on the spot with
"They cannot be reached right now." That refusal is deliberate and stays: it is what keeps
a caller from listening to forty-five seconds of ring for a phone that was never going to
ring, and it is what spec 037's FR-006 and SC-006 asked for.

The cost of refusing that early is that **nothing is written down**. No call happens, so
there is no call record, no entry in the conversation, and no unread badge. A field worker
whose phone was off, out of signal, or freshly reinstalled comes back online to a
conversation that looks exactly as it did before — while their manager believes they tried
to reach them. Only the caller knows the attempt happened. This is the open product
decision recorded as drift **D22**.

The comparable case already behaves the other way round. When a callee's phone *can* be
woken but nobody answers, the call rings out, the ring-timeout sweep ends it as missed, and
a "Voice call missed" entry appears in the conversation for both people. The person who
was less reachable therefore gets *less* of a trail than the person who simply ignored the
call — which is backwards.

This feature decides D22 in favour of the trail: an unreachable direct call is recorded as
a missed call, exactly as a call that rang out is, while the caller keeps the immediate
refusal. The two goals are not in conflict — the caller's feedback and the callee's record
are different surfaces.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The offline worker sees that someone tried (Priority: P1)

A site technician spends the morning in a basement with no signal, with the workspace app
closed. Their supervisor calls them twice from the office and is told both times that they
cannot be reached. At lunchtime the technician surfaces, opens the app, and their direct
conversation with the supervisor carries an unread marker and two "Voice call missed"
entries with the times of the attempts. They call back without the supervisor having to
chase them a third time.

**Why this priority**: This is the entire point of the change and the only part a worker
experiences. Without it, the feature does not exist — every other story is a consequence of
this one. It is independently valuable even if nothing else in this spec ships.

**Independent Test**: Make a person unreachable (no woken device of any kind), place a
direct call to them, confirm the caller is refused, then bring that person online and open
their direct conversation. The missed-call entry and the unread state must both be there,
with no action taken by the caller in between.

**Acceptance Scenarios**:

1. **Given** a person with no device that can be woken, **When** a colleague places a
   direct call to them and is refused as unreachable, **Then** their direct conversation
   contains a missed-call entry attributed to the caller at the time of the attempt.
2. **Given** that missed-call entry exists and the callee has not opened the conversation
   since, **When** the callee next opens the app, **Then** the conversation is shown as
   unread, so the entry is discoverable without browsing every channel.
3. **Given** the callee opens the conversation, **When** they look at the missed-call
   entry, **Then** it reads as a missed call from that colleague and offers no way to join
   anything, because there is no live call to join.
4. **Given** the same caller is refused three times in a row over ten minutes, **When** the
   callee returns, **Then** they see three separate missed-call entries with their own
   times, not one collapsed entry — three attempts is information the callee should have.

---

### User Story 2 - The caller is told the attempt will be seen (Priority: P2)

A supervisor calls a worker who is offline. The refusal comes back at once, as it does
today, but the conversation the supervisor is looking at now shows the same missed-call
entry the worker will see. The supervisor knows the attempt was left behind and does not
have to type "tried to call you" as a follow-up message.

**Why this priority**: It closes the loop for the person taking the action, and it is what
makes the recorded attempt trustworthy rather than invisible bookkeeping. It depends on
Story 1's record existing, so it ships second.

**Independent Test**: With the caller's direct conversation open on screen, place a call to
an unreachable person and watch without reloading. The refusal and the missed-call entry
must both appear, and the refusal must not name why the callee could not be reached.

**Acceptance Scenarios**:

1. **Given** a caller with the direct conversation open, **When** their call is refused as
   unreachable, **Then** the missed-call entry appears in that conversation without a
   manual reload.
2. **Given** the refusal is shown to the caller, **When** they read it, **Then** it tells
   them the person cannot be reached and that the person will see the attempt, and it says
   nothing about why — whether the callee has no device, revoked notifications, or is
   simply switched off is not the caller's business.
3. **Given** the call was refused, **When** the caller looks at their own screen, **Then**
   no call is in progress, no call bar or ringing state is shown, and there is nothing to
   hang up.

---

### User Story 3 - Call history tells "never rang" from "rang out" (Priority: P3)

A manager reviewing a conversation's call history sees that two calls to the same person
were missed, and can tell that one rang for the full timeout unanswered while the other
never reached a device at all. The two mean different things about the person's
availability, and about whether calling again is worth doing.

**Why this priority**: Useful for whoever reads the record later — support, an operations
lead, or the caller a day afterwards — but nobody is blocked without it, and the entries
are legible as missed calls either way.

**Independent Test**: Produce one missed call by letting a call ring out and one by calling
an unreachable person, then read the channel's call history and confirm the two records
are distinguishable by their recorded reason.

**Acceptance Scenarios**:

1. **Given** one call that rang out unanswered and one refused as unreachable, **When**
   both are read from the conversation's call history, **Then** both are missed calls and
   each carries a distinct recorded reason for how it ended.
2. **Given** a call refused as unreachable, **When** its record is read, **Then** it shows
   no answer time and no call duration, because nobody was ever connected.

---

### Edge Cases

- **The write must survive the failure.** The call attempt ends in an error for the caller,
  yet the record and the conversation entry must be durably kept. A refusal that discards
  its own trail is the bug this feature exists to fix, and is the single most likely way to
  implement it wrongly.
- **A blocked pair writes nothing.** When a direct call is refused because one person has
  blocked the other, no record and no entry may be written for either side. Blocking is
  silent by design; a missed-call entry appearing in a blocked person's conversation would
  announce both the attempt and the block.
- **A busy callee is unchanged.** A call refused because the callee is already on another
  call continues to write nothing (see Assumptions).
- **Group and shared channels are untouched.** There is no single callee to be unreachable
  in a shared channel, so no channel call can produce this record.
- **The recorded call must never be joinable.** No media room may be created for it, no
  join credentials issued, and no device may be able to walk into it from a stale link — it
  is a closed record from the moment it is written.
- **It must not block the next call.** The workspace allows only one live call per
  conversation. A missed-call record written this way is already finished, so the caller
  can immediately try again, and a real call in that conversation must still start
  normally.
- **No device is rung.** The premise is that no device can be woken; the record must not
  cause a ring, a wake, or a push attempt on any device, including one that comes online a
  second later.
- **The reachability check still fails open.** If the workspace cannot determine whether
  the callee is reachable, the call is placed and rings as it does today; that path
  produces an ordinary call, not one of these records.
- **Two attempts at once.** If the same caller places two calls to the same unreachable
  person simultaneously, each is refused and each is recorded; neither may leave a
  half-written record or a record with no matching conversation entry.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When a direct call is refused because the callee cannot be reached, the
  system MUST write a completed call record for that attempt, naming the caller as its
  initiator and the conversation it was placed in.
- **FR-002**: That record MUST be recorded as a finished, missed call with a start time, an
  end time, no answer time and no participant having joined.
- **FR-003**: The system MUST write a missed-call entry into the direct conversation for
  the same attempt, of the same kind and appearance as the entry written when a call rings
  out unanswered — one missed-call entry as far as anyone reading the conversation is
  concerned.
- **FR-004**: The record and the conversation entry MUST be durably stored even though the
  call request itself fails for the caller, and MUST be written together — never one
  without the other.
- **FR-005**: The caller MUST still be refused immediately, with the same outcome they get
  today, and MUST NOT be placed into a call, given anything to join, or made to wait out a
  ring.
- **FR-006**: The system MUST NOT create a media room, issue join credentials, or admit any
  participant for a call recorded this way.
- **FR-007**: The system MUST NOT ring, wake, or attempt to push to any device as a result
  of a call refused as unreachable.
- **FR-008**: The callee's direct conversation MUST count the missed-call entry towards its
  unread state, so the attempt is discoverable when they return without opening every
  conversation.
- **FR-009**: The record MUST carry a reason that distinguishes a call that never reached a
  device from a call that rang out unanswered, and both MUST remain readable in the
  conversation's call history.
- **FR-010**: A direct call refused because the two people have blocked each other MUST NOT
  write a record or a conversation entry.
- **FR-011**: Each refused attempt MUST produce exactly one record and exactly one
  conversation entry — repeated attempts produce repeated entries, and a single attempt
  never produces two.
- **FR-012**: A caller with the conversation open MUST see the missed-call entry appear
  without reloading the app or the conversation.
- **FR-013**: The refusal shown to the caller MUST tell them the person will see that they
  called, and MUST NOT disclose why the person could not be reached.
- **FR-014**: A call recorded this way MUST NOT prevent a subsequent call in the same
  conversation from starting.
- **FR-015**: The living behaviour documentation MUST be updated to describe the new
  behaviour and drift **D22** MUST be removed from the open drift register, since this
  feature is the decision that register was waiting for.

### Key Entities

- **Call record**: The workspace's record of one call attempt in a conversation — who
  placed it, when it started and ended, how it ended, and whether anyone answered. Already
  exists; this feature adds a case in which one is written for a call that never rang.
- **Missed-call conversation entry**: The line in a direct conversation's transcript saying
  a call was missed, linked to its call record. Already exists; this feature adds a case in
  which one is written.
- **Direct conversation**: The one-to-one channel between two people. The only place these
  records can arise, because it is the only place a single callee exists.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of direct calls refused because the callee is unreachable leave exactly
  one missed-call entry and one call record in the conversation.
- **SC-002**: A worker who was offline when called sees the attempt within thirty seconds
  of opening the app, without being told about it by the caller and without opening more
  than the conversation list and the conversation itself.
- **SC-003**: The caller still learns the call cannot be delivered within ten seconds of
  placing it, unchanged from today, and never waits out a ring.
- **SC-004**: Zero calls recorded this way are joinable, ring any device, or appear as a
  call in progress on either person's screen.
- **SC-005**: Zero missed-call entries or records are produced for a refusal caused by a
  block, in either direction.
- **SC-006**: A reader of a conversation's call history can tell a call that never reached
  a device from one that rang out unanswered in 100% of cases.
- **SC-007**: The open drift register no longer lists D22, and the voice behaviour
  documentation describes the recorded outcome rather than the silent one.

## Assumptions

- [ASSUMPTION: A busy callee — someone already on another workspace call — continues to
  produce no record and no conversation entry. The drift being decided names the
  unreachable case only, and the two are different: a busy refusal tells the caller to try
  again shortly and they usually do within a minute, so recording every busy attempt would
  fill the conversation with entries about a person who is present and about to be free.
  If a busy callee should also get a trail, that is a separate decision and should be
  raised as its own drift.]
- [ASSUMPTION: No push notification and no persisted alert is generated for the callee. By
  definition no device of theirs can be woken, so a push would fail; and the ring-timeout
  path — the missed call this one is modelled on — emits no persisted alert either. The
  conversation's unread state is the discovery surface for both, which keeps one behaviour
  rather than two.]
- [ASSUMPTION: Repeated attempts are recorded one per attempt rather than collapsed into a
  single "called 3 times" entry. This matches both the existing ring-out behaviour and what
  a phone does, and the number and spacing of attempts is information the callee wants. If
  entry noise becomes a real complaint, collapsing is a later change that does not alter
  what is recorded.]
- [ASSUMPTION: The callee is not written into the call record as a participant. Nobody was
  invited, rung, or connected, so there is no participation to record; the conversation the
  record belongs to already identifies who was being called, because it has exactly two
  people in it.]
- [ASSUMPTION: The caller-facing wording becomes "They cannot be reached right now. They
  will see that you called." — the existing sentence plus the new fact, still saying
  nothing about why. Clients already own this wording centrally, so it changes in one
  place.]
- [ASSUMPTION: No stored-data shape change is needed. The existing call record already
  supports a finished, missed call with a free-form reason, and the existing conversation
  entry already supports the missed-call kind that clients render today.]
- [ASSUMPTION: Both clients already render missed-call entries and call history, so no new
  screen or component is expected — the visible work is that the entry now exists in a case
  where it previously did not, plus the caller-side refresh in FR-012 and the wording in
  FR-013.]

## Dependencies

- The existing direct-call reachability decision, which is what identifies this case at
  all, and the block guard that runs before it — this feature must not reorder them.
- The existing missed-call announcement used by the ring-timeout sweep, which this feature
  reuses so that both kinds of missed call remain one behaviour rather than two.
- The living behaviour documentation for voice and its drift register, which FR-015
  requires this feature to update.
