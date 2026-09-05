# Feature Specification: Document Edit Conflict Protection

**Feature Branch**: `049-doc-edit-conflict-protection`

**Created**: 2026-09-05

**Status**: Draft

**Input**: User description: "Document edit conflict protection. Reject an update whose base version is stale and let the client reload and retry, instead of last-write-wins. Two people editing the same procedure silently lose one person's work; this is the smallest fix that prevents data loss without CRDT merge."

## Problem

Two people can open the same document, edit it, and save. Today the second save
wins outright: it replaces the whole document body with the text that person was
looking at, which never contained the first person's changes. Nobody is told.
The first person's work is still recoverable from version history, but neither
person knows to look, and the document silently reverts to a version somebody
else has already moved past.

This bites hardest on a ritual procedure document, where a manager rewrites a
step while a supervisor is fixing a typo in the same page, and the shop floor
reads whichever version survived.

The fix in scope is the small one: a save carries the version it started from,
and the system refuses a save whose starting version is no longer the current
one. Character-level merging of concurrent edits (CRDT / operational transform)
is explicitly **not** in scope.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A stale save is refused instead of overwriting (Priority: P1)

Two colleagues open the same procedure document. The first saves. The second
then saves the text they had been editing, which predates the first person's
change. Instead of quietly replacing it, the system refuses the second save and
says why: someone else has changed this document since you opened it.

**Why this priority**: This alone removes the data loss. Without it, no client
behaviour can help, because by the time the second save lands the first person's
text is already gone from the live document.

**Independent Test**: Fully testable at the service boundary — load a document,
save once as person A, then attempt a save as person B carrying the version A
started from, and confirm the second save is refused and the stored document
still holds A's content.

**Acceptance Scenarios**:

1. **Given** a document at version 5 that two people have both opened,
   **When** the first person saves and the document becomes version 6, and the
   second person then saves a change based on version 5,
   **Then** the second save is refused as a conflict, the stored document still
   holds the first person's content, and no new version is created.
2. **Given** a document at version 5,
   **When** the only person editing it saves a change based on version 5,
   **Then** the save succeeds and the document becomes version 6, exactly as
   before this feature.
3. **Given** a document at version 6,
   **When** a save arrives claiming a base version *newer* than the current one
   (version 9, which does not exist),
   **Then** the save is refused rather than accepted, because a client that
   cannot state a version it actually read cannot be trusted to have read the
   current content.
4. **Given** a document that a person may edit,
   **When** they change only the title and save with a stale base version,
   **Then** the save is refused on the same rule — the protection covers the
   whole update, not only the body text.
5. **Given** two saves for the same document that arrive at the same instant,
   both based on the current version,
   **Then** exactly one succeeds and the other is refused as a conflict; the two
   never both create a version.

---

### User Story 2 - The editor tells the person and keeps their work (Priority: P1)

The person whose save was refused sees, in the editor, that somebody else
changed the document while they were writing. Their own unsaved text is still
in front of them — the editor does not throw it away and does not silently
replace it with the newer version. They can reload the current version and
reapply their change, and they are told who made the conflicting change and
when.

**Why this priority**: A refusal that the person cannot act on turns silent data
loss into loud data loss. The refusal and the recovery path are one feature.

**Independent Test**: Testable in the browser end to end — open the same
document in two sessions, save in one, then save in the other and confirm the
second session shows a conflict notice, still holds its unsaved text, and can
recover to the current version through the offered action.

**Acceptance Scenarios**:

1. **Given** a person editing a document whose save was just refused as a
   conflict,
   **When** the refusal comes back,
   **Then** the editor shows a clear message naming the person who saved the
   conflicting change and when, and the editor still contains the text the
   person typed.
2. **Given** that conflict notice,
   **When** the person chooses to reload,
   **Then** the editor loads the current version of the document and their next
   save is accepted, having started from the version they just loaded.
3. **Given** that conflict notice,
   **When** the person chooses not to reload yet,
   **Then** they can keep editing and copy their text out; nothing is discarded
   without their action.
4. **Given** a save refused as a conflict,
   **When** the editor reports it,
   **Then** the message distinguishes a conflict from an ordinary failure (lost
   connection, no permission), so the person knows retrying unchanged will not
   help.

---

### User Story 3 - Editors see a change land while they are still typing (Priority: P3)

Someone editing a document is told that a colleague saved a new version, at the
moment it happens, rather than at the moment their own save is refused.

**Why this priority**: Nice, not necessary. P1 and P2 already prevent the data
loss; this only shortens the window in which somebody writes into a version
that is already superseded. It is listed so it is not mistaken for part of the
minimum fix.

**Independent Test**: Two sessions in the same document; save in one, and
confirm the other surfaces a notice without its owner attempting a save.

**Acceptance Scenarios**:

1. **Given** two people with the document open,
   **When** one of them saves,
   **Then** the other sees a non-blocking notice that a newer version exists,
   and can reload at a moment of their choosing.

---

### Edge Cases

- **A person's own two tabs.** The rule is per-document, not per-person: a
  second tab belonging to the same person is refused exactly like a colleague's,
  because its text is equally stale.
- **Editing the current version with no change at all.** A save whose base
  version is current is accepted and creates a version, unchanged from today's
  behaviour; deduplicating no-op saves is out of scope.
- **A very long editing session.** There is no time limit — a save based on a
  version that is still the current one is accepted no matter how old it is.
  Staleness is defined by another save landing, never by elapsed time.
- **A document whose version history is long.** Version numbers are never reused
  and versions are never pruned, so a base version is always either the current
  one or definitively behind it; the comparison cannot be ambiguous.
- **A save from a client that omits the base version.** Refused. The base
  version is a required part of a save, not an optional hint, so an old or
  malfunctioning client cannot opt back into last-write-wins.
- **A conflict on a document the person may no longer edit.** Permission is
  checked as it is today; a permission failure is reported as a permission
  failure, not as a conflict.
- **Reading surfaces are unaffected.** Viewing, commenting, reacting, following,
  status changes, deletion, and reads of a ritual procedure document do not carry
  a base version and are not touched by this rule.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A document update MUST carry the version number the editing
  session started from ("base version").
- **FR-002**: The system MUST refuse an update whose base version is not the
  document's current version, and MUST make no change to the document and create
  no new version when it does so.
- **FR-003**: The system MUST refuse an update that omits the base version or
  states a base version that does not correspond to an existing version of that
  document.
- **FR-004**: A refusal under FR-002 or FR-003 MUST be reported as a distinct
  conflict outcome that a client can recognise without parsing prose, separate
  from not-found, permission-denied, and validation failures.
- **FR-005**: The conflict outcome MUST tell the client the document's current
  version number, so a client can decide what to reload without a second round
  trip.
- **FR-006**: The conflict outcome MUST identify who made the conflicting change
  and when, so the person can go and talk to them.
- **FR-007**: The check and the write MUST be atomic: of two updates racing on
  the same document from the same base version, exactly one MUST succeed.
- **FR-008**: An update whose base version is current MUST behave exactly as it
  does today — the document is updated, a version is created, embeds are synced,
  the slug history is written on a title change, and followers are notified.
- **FR-009**: The reader that supplies a document to an editor MUST supply the
  version number that reader is looking at, so the editor has a base version to
  send back.
- **FR-010**: The web document editor MUST, on a conflict, keep the person's
  unsaved content in the editor and MUST NOT replace or discard it without an
  explicit action by that person.
- **FR-011**: The web document editor MUST show a conflict distinctly from other
  save failures, naming the conflicting author and time, and MUST offer an
  action that loads the current version so the person can reapply their change
  and save successfully.
- **FR-012**: After a person reloads through that action, their next save MUST
  be accepted, having a current base version.
- **FR-013**: The system MUST NOT attempt to merge concurrent edits. A conflict
  is reported to a person, never resolved automatically.

### Key Entities *(include if data involved)*

- **Document**: the page being edited. Already carries a current version; the
  rule compares an incoming save against it.
- **Document version**: an immutable, numbered, full snapshot of the document
  with an author and a timestamp. Already exists, is never pruned, and is what
  makes "stale" decidable and what supplies the conflicting author's name.
- **Base version**: the version number an editing session loaded and is
  proposing to replace. New; travels with an update.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Two people editing the same document concurrently can no longer
  lose either person's text without being told: in 100% of concurrent-save
  attempts, either the save is applied on top of the current content or the
  person is shown a conflict.
- **SC-002**: A person whose save is refused still has 100% of the text they
  typed available to them in the editor, with no manual recovery from version
  history required.
- **SC-003**: A person who hits a conflict can get their change saved within one
  reload and one re-save, without leaving the document.
- **SC-004**: A person shown a conflict can say who else changed the document,
  from the message alone.
- **SC-005**: Saving a document alone — the overwhelmingly common case — is no
  slower and no different than before, with no extra step for the person.
- **SC-006**: Under two saves issued simultaneously from the same base version,
  exactly one version is created, repeatably.

## Assumptions

- [ASSUMPTION: "Base version" means the document version number the editor
  loaded, because the version table already stores full numbered snapshots and
  requires no new state. A separate opaque revision token or content hash was
  rejected as more machinery for the same guarantee.]
- [ASSUMPTION: The base version is a required field on an update rather than an
  optional one. The project is in early development with no external API
  consumers and all clients ship together, so an optional field that preserves
  last-write-wins for old callers would be a compatibility shim with no
  beneficiary.]
- [ASSUMPTION: A base version *newer* than the current version is treated as a
  conflict rather than accepted. It cannot happen with an honest client and
  accepting it would let a malformed client bypass the protection entirely.]
- [ASSUMPTION: The rule applies to a person's own second tab identically. Making
  the check per-person would reintroduce the loss for the commonest self-inflicted
  case.]
- [ASSUMPTION: Live editing presence — the existing editor list, cursors and
  heartbeat — is left as it is. It already tells people who else is in the
  document; this feature does not change it, and User Story 3 rides on it if it
  is built.]
- [ASSUMPTION: The mobile document surface is read-only today, so it needs no
  conflict handling. It is in scope only to the extent that it must keep working
  against the changed update contract.]
- [ASSUMPTION: Comments, reactions, follows, status changes, and access changes
  keep last-write-wins. They are small independent writes where a lost update
  costs a click, not a rewritten page.]
- [ASSUMPTION: The conflicting author's name and timestamp are safe to disclose
  to anyone who could already edit the document; someone with write access to a
  document can already read its version history and see the same names.]
