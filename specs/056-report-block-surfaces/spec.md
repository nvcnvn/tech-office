# Feature Specification: Report and Block Wherever User Content Appears

**Feature Branch**: `056-report-block-surfaces`

**Created**: 2026-09-12

**Status**: Draft

**Input**: User description: "Report and block wherever user content appears. ReportSheet is mounted in the channel screen and nowhere else, so a message inside a thread, an uploaded file, a document comment and a person's profile offer neither control, while the backend already accepts file, document_comment and call_record as report targets. Mount the existing sheet in the thread and file screens and put Block on the person profile, where somebody trying to stop contact would look first."

## Why this exists

The workspace already has a complete safety system underneath: a person can report five
kinds of content, a report is reviewed by the people who run the workspace, and a block
stops direct conversations and calls without telling the blocked person. None of that has
changed and none of it needs to.

What is missing is the **doorway**. The report control is mounted on exactly one screen —
the channel timeline on mobile, and the chat message on web. Everywhere else a person reads
something somebody else wrote, there is no way to say it is wrong:

| Where content appears | Report available today | Block available today |
|---|---|---|
| Channel message (mobile) | yes | yes |
| Message inside a thread (mobile) | **no** | **no** |
| Uploaded file (mobile list, mobile detail) | **no** | n/a |
| Document comment (web) | **no** | n/a |
| A person's profile (mobile) | n/a | **no** |

A person who wants to stop contact currently has to find a message that person wrote and
long-press it. The profile screen — the first place anybody looks — offers nothing.

This is a client-side gap only. Every backend capability this feature needs already exists
and is unchanged.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Report a message inside a thread (Priority: P1)

A worker opens a thread on a channel message and reads a reply that is abusive. They
long-press the reply the same way they would in the channel timeline, and the same actions
they know from the channel are there: report it, and block whoever wrote it.

**Why this priority**: A thread reply is an ordinary message that happens to be one screen
deeper. Today it is the largest body of content in the product with no report control at
all, which is the gap a store reviewer checking for a way to flag objectionable content
would find first.

**Independent Test**: Open any thread, long-press a reply written by somebody else, tap
Report, tap a reason, see the confirmation. Fully testable with nothing else in this
feature built.

**Acceptance Scenarios**:

1. **Given** a thread with a reply written by another person, **When** the reader
   long-presses the reply and taps "Report this message", **Then** the same report sheet the
   channel screen uses opens, titled for "this message".
2. **Given** that sheet is open, **When** the reader taps a reason, **Then** the report is
   filed and the confirmation appears, without a further step.
3. **Given** a thread whose parent conversation is a direct conversation, **When** a reply
   is reported, **Then** the report is recorded against the direct-message target kind, not
   the channel-message kind.
4. **Given** a reply written by another person, **When** the reader opens the actions,
   **Then** "Block this person" is offered.
5. **Given** a reply the reader wrote themselves, **When** they open the actions, **Then**
   "Block this person" is not offered at all.
6. **Given** the thread's parent message shown at the top of the thread, **When** the reader
   long-presses it, **Then** the same report and block actions are offered as for a reply.

---

### User Story 2 - Stop contact from a person's profile (Priority: P2)

Someone is being contacted by a colleague they want to stop hearing from. They open that
person in the people directory and block them from there, without hunting for a message
first.

**Why this priority**: Blocking already works, so this is about the person finding it. The
profile is where somebody trying to stop contact looks first, and today it is the one screen
about a person that says nothing about contact at all.

**Independent Test**: Open a colleague in the people directory, tap Block, confirm, then
confirm the profile now offers Unblock. Testable with nothing else in this feature built.

**Acceptance Scenarios**:

1. **Given** a profile of somebody the reader has not blocked, **When** the profile loads,
   **Then** a Block control is offered.
2. **Given** that control, **When** it is tapped, **Then** the existing block confirmation
   opens, stating that direct conversations and calls stop and shared channels are
   unaffected.
3. **Given** the reader confirms, **When** the confirmation closes, **Then** the profile
   shows Unblock in place of Block without the reader leaving the screen.
4. **Given** a profile of somebody already on the reader's block list, **When** the profile
   loads, **Then** Unblock is offered instead of Block.
5. **Given** the reader's own directory entry, **When** it loads, **Then** neither Block nor
   Unblock is offered.
6. **Given** a person is blocked from their profile, **When** that person next opens the
   app, **Then** nothing anywhere tells them they were blocked.

---

### User Story 3 - Report an uploaded file (Priority: P3)

A worker sees a file in the workspace whose contents are abusive. They report it from the
file itself, in the list or on its detail screen, and the report reaches the same review
queue as a reported message.

**Why this priority**: Files are the second-largest body of person-created content, and the
backend has accepted the file target kind since the safety system shipped — nothing has ever
been able to send one.

**Independent Test**: Open the files list, report a file, see the confirmation; then open a
file's detail screen and report from there.

**Acceptance Scenarios**:

1. **Given** the mobile file list, **When** the reader opens the actions for a row, **Then**
   Report is offered alongside Download.
2. **Given** the mobile file detail screen, **When** it loads, **Then** Report is offered
   alongside Download.
3. **Given** a file is being reported, **When** the sheet opens, **Then** it is titled for
   "this file" rather than "this message".
4. **Given** the web files page, **When** the reader opens a file's actions, **Then** Report
   is offered and opens the existing report dialog.
5. **Given** a reader reports a file that another person deleted a moment earlier, **When**
   they choose a reason, **Then** they see a readable message saying the file is gone rather
   than a silent failure or a raw error.

---

### User Story 4 - Report a document comment (Priority: P4)

A reader of a shared document finds an abusive comment in the margin and reports the comment
itself, not the document.

**Why this priority**: Comments are the smallest of the four gaps by volume, and they exist
on one client only, so this is the last slice. It is still a real gap: the backend has
accepted the document-comment target kind from the beginning.

**Independent Test**: Open a document with comments on web, report one comment, see the
confirmation.

**Acceptance Scenarios**:

1. **Given** a comment written by somebody else in the web comments panel, **When** the
   reader opens that comment's actions, **Then** Report is offered.
2. **Given** Report is chosen, **When** the dialog opens, **Then** it is titled for "this
   comment" and records the document-comment target kind.
3. **Given** a comment the reader wrote themselves, **When** they open its actions, **Then**
   Report is not offered — a person does not report their own comment.

---

### Edge Cases

- **A system message inside a thread** (somebody joined, a call ended): it is offered a
  report control like any other message, because a reader cannot be expected to tell which
  messages the system wrote; it is offered no block control, because there is no person
  behind it.
- **A message whose author has since left the workspace**: report still works — the server
  resolves the author and snapshot at report time, and a departed person's messages remain.
  Block is not offered, because the profile of a departed person shows the "no longer in
  your workspace" state instead.
- **Reporting the same thing twice**: the second attempt is refused by the server as already
  reported. The refusal is shown in place, on the sheet, with the content still on screen.
- **Blocking somebody who is already blocked**: cannot happen from the profile, because the
  profile shows Unblock in that state; if the block list is stale, the server accepts the
  request without creating a duplicate.
- **Unblocking somebody who is not blocked**: succeeds silently — the existing operation is
  idempotent.
- **Offline or failing network**: every control surfaces a readable failure and leaves the
  sheet open so the person can retry. No control reports success it did not get.
- **The block list has not loaded yet on the profile**: the contact control is not shown
  until the app knows which of Block or Unblock is correct, rather than guessing and then
  flipping.
- **Blocking from a profile, then opening a direct conversation with that person**: the
  existing refusal applies unchanged; this feature adds no new enforcement point.
- **A file whose safety check has not finished**: report is still offered — the reason for
  reporting is the content, not the scan.

## Requirements *(mandatory)*

### Functional Requirements

#### Reporting and blocking inside threads

- **FR-001**: The thread message actions MUST offer a report control for the thread's parent
  message and for every reply, on every route that shows a thread.
- **FR-002**: A report filed from a thread MUST record the direct-message target kind when
  the thread's parent conversation is a direct conversation, and the channel-message target
  kind otherwise.
- **FR-003**: The thread message actions MUST offer a block control for a message written by
  somebody other than the signed-in person, and MUST NOT offer it for the signed-in person's
  own message or for a message with no human author.
- **FR-004**: Reporting a thread message MUST be reachable in three taps or fewer from
  seeing it — long-press, Report, reason — matching the channel timeline.

#### Blocking from a person's profile

- **FR-005**: A person's profile MUST offer a block control for another person the signed-in
  person has not blocked.
- **FR-006**: That profile MUST offer an unblock control instead when the person is already
  on the signed-in person's block list.
- **FR-007**: The profile MUST offer neither control on the signed-in person's own entry.
- **FR-008**: After blocking or unblocking from the profile, the profile MUST show the
  resulting state without the person navigating away and back.
- **FR-009**: The block control MUST state its scope in the words the existing confirmation
  already uses: direct conversations and calls stop; shared channels are unaffected.
- **FR-010**: Blocking from the profile MUST emit no notification and MUST produce no signal
  of any kind to the blocked person.
- **FR-011**: Blocking MUST be reachable in three taps or fewer from the profile — Block,
  confirm — and MUST NOT require the person to find a message first.

#### Reporting files

- **FR-012**: Each row of the mobile file list MUST offer a report control for that file.
- **FR-013**: The mobile file detail screen MUST offer a report control for the file it
  shows.
- **FR-014**: The web files page MUST offer a report control per file.
- **FR-015**: A report filed from any file surface MUST record the file target kind and MUST
  describe its subject to the person as a file, not as a message.

#### Reporting document comments

- **FR-016**: Each comment in the web document comments panel that the signed-in person did
  not write MUST offer a report control.
- **FR-017**: A report filed from a comment MUST record the document-comment target kind and
  MUST describe its subject to the person as a comment.

#### Across all of the above

- **FR-018**: Every control added by this feature MUST use the report sheet, report dialog
  and block confirmation that already exist. No second report form, second block
  confirmation, or second set of reason labels may be introduced on any client.
- **FR-019**: A refusal from the server — already reported, content gone, contact refused —
  MUST be shown to the person in readable words, in place, with the content still on screen.
- **FR-020**: The person reporting MUST never supply who wrote the content or what it said;
  those stay resolved by the server, as they are today.
- **FR-021**: Every control added by this feature MUST carry a stable test identifier and be
  covered by at least one blackbox flow on the client it appears on.
- **FR-022**: This feature MUST require no change to the reporting, blocking, review or
  removal contracts, to the database, or to permissions. Every capability it surfaces already
  exists and is already permitted to the roles that will use it.

### Key Entities

No new entities. This feature adds reachability to three that already exist:

- **Content report**: a reporter, a reported author, a target kind and id, a content snapshot
  taken at report time, a reason and an optional note. Unchanged. Five target kinds are
  accepted today; this feature makes three of them reachable for the first time.
- **Block**: a one-directional record that one person has blocked another, which stops direct
  conversations and calls and nothing else. Unchanged. This feature adds a second place to
  create one and the first place to see whether one exists.
- **Person (directory entry)**: the profile a reader opens from the people directory. Gains a
  contact control; gains no new data.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every screen in either client that displays content another person created —
  channel message, thread message, uploaded file, document comment — offers a report control
  reachable in three taps or clicks or fewer from seeing that content. Verified by walking
  each surface; the count of surfaces missing a control is zero.
- **SC-002**: A person can block somebody from that person's profile in three taps or fewer,
  without first locating a message that person wrote.
- **SC-003**: The number of distinct report submission forms stays at one per client, and the
  number of distinct block confirmations stays at one per client, after the feature ships.
- **SC-004**: A store reviewer following the published review notes can file a report from
  every content surface the notes name, in one session, without leaving the app or contacting
  anybody.
- **SC-005**: After a block is created from a profile, the blocked person receives zero
  notifications about it and sees no change in their conversation list or channel views —
  verified by an automated check, not by inspection.
- **SC-006**: A person who reports something and then loses their connection mid-submission
  sees a failure message and can retry; no submission is reported as successful that the
  server did not accept.

## Assumptions

- [ASSUMPTION: **Web document comments and web files are in scope.** The description names "a
  document comment" as a surface offering no control, and comments exist only on the web
  client — so closing that gap at all means touching web. Files were included on the same
  client for consistency: leaving the web files page as the one file surface without a report
  control would recreate the gap this feature exists to close.]
- [ASSUMPTION: **The web chat thread is already covered.** It renders the same message
  component as the channel timeline, so it inherits the report control that component already
  has. No web thread work is planned; the thread work in this feature is mobile-only.]
- [ASSUMPTION: **Reporting a call record is out of scope.** The description notes that the
  backend accepts it, but does not ask for it, and the remedy for unwanted calls from a person
  is to block them — which is exactly what this feature makes easy to find. Reporting a call
  record stays unreachable, and stays recorded as such.]
- [ASSUMPTION: **Blocking from web is out of scope, and is a real remaining gap.** Web offers
  unblock in settings and no way to block anywhere. The description scopes block to the person
  profile, and web has no employee-facing person profile — only the administrative employee
  dialog behind organization permissions. Adding a block control to the web chat message menu
  would be the cheap parity fix; it is deliberately not included here, and is recorded below
  as a follow-up for the owner to scope.]
- [ASSUMPTION: **Thread block mirrors the channel screen exactly**, including the rule that
  blocking is not offered for the reader's own message. Introducing a different rule one
  screen deeper would be a worse outcome than the gap it closes.]
- [ASSUMPTION: **Whether a person is blocked is read from the signed-in person's own block
  list**, which is the only list the system exposes. Nothing in this feature asks, or could
  ask, who has blocked whom in the other direction.]
- [ASSUMPTION: **Reporting one's own content is not offered** on the comment surface, matching
  the existing rule that a person is not offered the ability to block themselves. It remains
  offered for messages and files, where the existing screens do not distinguish authorship for
  the report control and changing that is not part of this feature.]
- [ASSUMPTION: **No backend, schema, proto or permission change is required.** Every RPC,
  target kind and permission this feature uses is already implemented, already granted to
  Owner, Operator and Employee, and already covered by tests. If planning finds otherwise, that
  is a finding worth surfacing before any code is written.]

## Out of Scope

- Any change to what a block does. It stops direct conversations and calls; shared channels
  stay visible. That scope is deliberate and documented, and this feature does not revisit it.
- Any change to the review queue, report resolution, or removal requests. Those remain
  web-only surfaces for the roles that hold the reviewing permissions.
- Reporting a call record (see assumptions).
- A block control on the web client (see assumptions) — **flagged as a remaining gap**: today
  a web user can unblock from settings but cannot block from anywhere.
- Reporting a document itself, as opposed to a comment on it. The accepted target kinds do not
  include a document, and adding one is a backend change this feature explicitly avoids.
- Hiding or filtering content from a blocked person beyond the existing client-side hiding of
  direct history.
