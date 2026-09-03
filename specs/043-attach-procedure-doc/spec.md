# Feature Specification: Procedure Document On A Ritual Definition

**Feature Branch**: `043-attach-procedure-doc`

**Created**: 2026-09-04

**Status**: Draft

**Input**: User description: "Attach a procedure document to a ritual definition. One optional document link on the definition, shown on every instance and in the evidence capture flow. Definitions have only a free-text description, so the promise that the procedure sits next to the checklist item is unfulfilled."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Read The Procedure While Doing The Ritual (Priority: P1)

A worker opens today's ritual instance — the closing checklist, the safety inspection — and
the written procedure for it is one tap away, on the instance itself and again inside the
evidence capture flow, so they can check "what am I supposed to photograph here" without
leaving the checklist, hunting through the workspace document tree, or asking a supervisor.

**Why this priority**: This is the entire point of the feature. A checklist that says
"submit a photo of the closed till" without the procedure that defines what a correctly
closed till looks like produces evidence that gets rejected and work that gets redone. The
free-text description on a definition is a single field with no formatting, no images and no
version history; it cannot carry a real procedure. Every other story in this spec exists to
make this one possible or to extend it.

**Independent Test**: Attach a procedure document to a ritual definition, open a generated
instance of that ritual as an assigned worker on web and on mobile, and confirm the
procedure is reachable from the instance and from the evidence capture flow, and that
returning from it leaves any in-progress capture intact.

**Acceptance Scenarios**:

1. **Given** a ritual definition with a procedure document attached, **When** an assigned
   worker opens any instance of that ritual, **Then** the instance shows an entry point
   labelled with the procedure document's current title.
2. **Given** a worker viewing an instance, **When** they open the procedure, **Then** the
   document is rendered read-only inside the product and they can return to the instance
   they came from.
3. **Given** a worker part-way through capturing evidence for a requirement, **When** they
   open the procedure and come back, **Then** nothing they had already captured or typed is
   lost.
4. **Given** a ritual definition with **no** procedure document attached, **When** a worker
   opens an instance, **Then** no procedure entry point is shown and the instance is
   unchanged from today's behaviour.
5. **Given** a worker who has no explicit access grant on the procedure document, **When**
   they open an instance of the ritual it is attached to, **Then** they can read the
   procedure.

---

### User Story 2 - Attach, Replace And Remove The Procedure (Priority: P1)

A manager editing a ritual definition picks one existing workspace document as that
ritual's procedure, can swap it for a different one later, and can detach it entirely. The
attachment is a link, never a copy, so correcting the procedure in the document corrects it
for every future and open instance immediately.

**Why this priority**: Without this there is nothing for Story 1 to display. It is a
separate story because it is a separate surface, a separate permission and a separate
release risk: this one writes.

**Independent Test**: As a project owner or admin, open the ritual definition editor, attach
a document, confirm the definition reports it; replace it with a second document; remove it;
confirm the underlying documents still exist in the workspace throughout.

**Acceptance Scenarios**:

1. **Given** a manager with ritual definition management rights on the project, **When**
   they attach a workspace document to a definition, **Then** the definition reports that
   document as its procedure and every existing open instance of that ritual shows it.
2. **Given** a definition that already has a procedure attached, **When** the manager
   attaches a different document, **Then** the previous attachment is replaced, not
   accumulated — a definition never carries two procedures.
3. **Given** a definition with a procedure attached, **When** the manager removes the
   attachment, **Then** the document itself is untouched and remains in the workspace, and
   the ritual's instances stop showing a procedure.
4. **Given** a manager choosing a document to attach, **When** they confirm the choice,
   **Then** they are told first that everyone who can see an instance of this ritual will be
   able to read that document.
5. **Given** a member who is not an owner or admin of the project, **When** they attempt to
   attach, replace or remove a procedure document, **Then** the attempt is refused.
6. **Given** a definition whose procedure is attached, replaced or removed, **When** the
   change is saved, **Then** no instances are regenerated, detached or deleted, no schedule
   change impact is reported, and no assignee is notified.

---

### User Story 3 - Decide Evidence Against The Procedure (Priority: P2)

A reviewer working the evidence review queue can open the procedure the submission was
supposed to follow, from the same screen where they approve or reject, so "is this photo
acceptable" is answered against the written standard rather than from memory.

**Why this priority**: Real value, and it is what makes rejection reasons defensible to the
worker receiving them, but the review queue is a manager surface used after the fact —
Stories 1 and 2 deliver the product promise on their own.

**Independent Test**: Submit evidence against a ritual whose definition has a procedure
attached, open the evidence review queue as a reviewer, and confirm the procedure is
reachable from the entry and from the decision surface without losing the queue position.

**Acceptance Scenarios**:

1. **Given** a pending submission for a ritual whose definition has a procedure attached,
   **When** a reviewer opens it from the review queue, **Then** the procedure is reachable
   from the decision surface.
2. **Given** a reviewer who opens the procedure from the queue, **When** they return,
   **Then** they are back at the same entry with any typed rejection reason intact.
3. **Given** a submission whose ritual definition has no procedure attached, **When** a
   reviewer opens it, **Then** the decision surface is unchanged from today's behaviour.

---

### Edge Cases

- **The attached document is deleted.** The instance must show an explicit "procedure
  unavailable" state that still tells the worker a procedure was meant to be here, rather
  than hiding the entry point (which would read as "there is no procedure") or showing a
  dead link. Evidence submission, approval and instance completion must all still work.
- **The attached document is archived** (status `archived`, still readable). It is shown
  normally, with its status visible, because an archived procedure is usually a procedure
  someone forgot to unarchive and is still better than none.
- **The procedure document is edited while a worker has the instance open.** The next open
  shows the new content; the product never pins an instance to an old revision.
- **The procedure document contains links to other documents.** Those follow ordinary
  document access rules — the implicit read granted by the attachment covers the attached
  document only, so a worker may reach an access-denied state one hop in. That is the
  correct outcome: the manager attached one document and was warned about one document.
- **The same document is attached to several definitions.** Permitted. One "Store closing
  procedure" backing the daily close in three projects is the normal case, not an error.
- **The definition is archived.** The attachment survives; unarchiving restores it. Nothing
  about an archived definition needs its procedure detached.
- **A worker views an instance that has been detached from its ritual** (a schedule change
  turned it into a standalone task). It no longer belongs to a definition, so it shows no
  procedure.
- **A manager attaches a document that is itself a task description or project brief**
  rather than a workspace document. Refused — those documents are owned by another resource
  and reached through it.
- **The procedure is opened on mobile with no connectivity.** The failure is the ordinary
  offline failure for reading a document; the instance and the evidence capture flow must
  remain usable.

## Requirements *(mandatory)*

### Functional Requirements

**Attachment model**

- **FR-001**: A ritual definition MUST support at most one optional procedure document
  attachment. Zero or one — never a list.
- **FR-002**: The attachment MUST be a reference to an existing workspace document in the
  same organization, never a copy of its content and never an arbitrary external address.
- **FR-003**: The system MUST reject attaching a document that belongs to another
  organization, or whose type is not a workspace document.
- **FR-004**: One document MUST be attachable as the procedure of any number of ritual
  definitions.
- **FR-005**: The free-text description on a ritual definition MUST be retained and MUST
  continue to be shown; the procedure document supplements it and does not replace it.

**Managing the attachment**

- **FR-006**: Users who may manage a ritual definition MUST be able to attach, replace and
  remove its procedure document. Users who may not manage the definition MUST be refused.
- **FR-007**: The chooser MUST offer only documents the acting manager can already read, so
  attachment cannot be used to discover documents.
- **FR-008**: Before an attachment is confirmed, the acting manager MUST be told that
  everyone who can see an instance of this ritual will gain read access to the chosen
  document.
- **FR-009**: Removing an attachment MUST NOT delete, archive or otherwise modify the
  document.
- **FR-010**: Attaching, replacing or removing a procedure MUST NOT count as a schedule
  change: no instance regeneration, no instance deletion or detachment, no schedule-change
  impact report, and no notification to assignees.
- **FR-011**: Configuring the attachment MUST be available on web only, per Constitution
  principle XIII. Reading the procedure MUST be available on every client that shows a
  ritual instance, including mobile.

**Showing the procedure**

- **FR-012**: Every surface that shows a ritual instance MUST show an entry point to the
  procedure when one is attached, labelled with the document's **current** title.
- **FR-013**: The evidence capture flow MUST show the procedure entry point, and opening it
  MUST NOT discard evidence already captured or text already entered.
- **FR-014**: The evidence review and decision surface MUST show the procedure entry point
  for a submission whose ritual definition has one, and opening it MUST NOT discard a typed
  rejection reason or the reviewer's place in the queue.
- **FR-015**: Opening the procedure MUST render the document read-only inside the product,
  with a way back to the surface it was opened from.
- **FR-016**: Instances MUST always resolve the procedure's **current** content. No
  instance-time or submission-time snapshot of the procedure is kept.
- **FR-017**: A ritual definition with no procedure attached MUST render exactly as it does
  today, with no empty entry point and no placeholder.

**Access**

- **FR-018**: Anyone who can see an instance of a ritual MUST be able to read that ritual's
  attached procedure document, irrespective of that document's own access grants. The
  attachment is the grant.
- **FR-019**: That implicit access MUST be read-only, MUST cover only the attached document
  itself and not documents it links to or nests beneath it, and MUST NOT allow commenting,
  editing, version history changes or reactions beyond whatever the reader was already
  entitled to.
- **FR-020**: Removing the attachment, or deleting the definition, MUST end the implicit
  access it granted. A worker who could read a procedure only because of an attachment MUST
  lose that read the moment the attachment goes.
- **FR-021**: The implicit access MUST NOT make the document appear in the reader's
  workspace document tree, search results, or followed-document lists. It is reachable
  through the ritual and nowhere else.

**Degradation**

- **FR-022**: When an attached document has been deleted or cannot be resolved, every
  surface MUST show an explicit unavailable state that still indicates a procedure was
  attached, and MUST NOT hide the entry point entirely.
- **FR-023**: An unavailable procedure MUST NOT block evidence submission, evidence
  decisions, instance state transitions or instance completion.
- **FR-024**: An archived but readable document MUST still be shown as the procedure, with
  its archived status visible to the reader.

### Key Entities

- **Ritual Definition**: Gains one optional reference to a procedure document, alongside its
  existing name, description, recurrence rule, evidence requirements and assignment
  configuration. The reference is the only new state; nothing about scheduling changes.
- **Procedure Document**: An ordinary workspace document, authored, versioned, commented on
  and access-controlled by the documents feature exactly as any other. It has no special
  type and does not know it is being used as a procedure.
- **Ritual Instance**: Resolves its procedure through its definition. Holds no procedure
  reference of its own, which is what makes a corrected procedure reach every open instance
  at once.
- **Evidence Requirement / Evidence Submission**: Unchanged. Both are shown alongside the
  procedure but neither carries its own attachment in this feature.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A worker who has an instance open can reach its written procedure in a single
  action from the instance and from the evidence capture flow, on both web and mobile.
- **SC-002**: A manager can attach a procedure to an existing ritual definition in under one
  minute, without creating anything, copying anything, or leaving the definition editor
  except to pick the document.
- **SC-003**: Correcting a procedure is a single edit to one document, and takes effect for
  100% of that ritual's open and future instances with no further manager action and no
  instance regeneration.
- **SC-004**: 100% of workers assigned a ritual instance can read its attached procedure,
  including workers newly rostered onto the ritual after the attachment was made, with no
  per-person access administration.
- **SC-005**: Deleting an attached procedure document leaves 100% of that ritual's instances
  completable, with the loss visible rather than silent.
- **SC-006**: Attaching, replacing or removing a procedure changes zero instances: no
  instance is created, deleted, detached, reassigned or re-notified as a result.
- **SC-007**: A definition with no procedure attached is visually and behaviourally
  unchanged from before this feature on every surface.

## Assumptions

- [ASSUMPTION: The "document link" is a reference to an internal workspace document, not an
  arbitrary external URL. The product already stores rich task descriptions as documents,
  and an internal document is versioned, searchable, renderable in-app and access-controlled
  — where an external URL would throw a shop-floor worker into a browser, out of the
  checklist they were told to follow. If external procedure URLs are wanted later they are a
  separate, additive feature.]
- [ASSUMPTION: The attachment sits on the ritual **definition**, not on individual evidence
  requirements, matching the user's phrasing. Per-requirement procedures are out of scope;
  the definition-level document is expected to cover all of a ritual's steps.]
- [ASSUMPTION: Attaching a procedure implicitly grants read access on that document to
  anyone who can see an instance of the ritual (FR-018). The alternative — letting the
  document's own access rules deny the assignee — hands a worker a checklist and refuses
  them the procedure it depends on, which is the exact failure this feature exists to
  remove. Assignees change constantly under round-robin and on-shift pools, so per-person
  grants would be unmaintainable. The manager is warned at attach time (FR-008), which is the
  same mental model as sharing a file.]
- [ASSUMPTION: The implicit grant covers the attached document only, not its child pages or
  documents it links to (FR-019). Granting a whole subtree from one attach action would leak
  more than the warning described.]
- [ASSUMPTION: The procedure is live, never snapshotted (FR-016). A corrected procedure must
  reach today's shift; an instance pinned to the revision current when it was generated
  thirty days ago would show a worker a procedure the business has already retired. Evidence
  submissions therefore do not record which revision of the procedure was in force. If
  audit-grade "which procedure was live when this was signed off" is required, that is a
  separate feature.]
- [ASSUMPTION: Authoring happens in the documents feature. The definition editor picks an
  existing document; it does not create, template or edit one. A "create a blank procedure"
  shortcut is deliberately excluded from this feature as unnecessary to the promise being
  fulfilled.]
- [ASSUMPTION: Configuring the attachment is web-only and reading it is universal (FR-011),
  following Constitution principle XIII and the existing precedent that the ritual definition
  editor is a web surface with no mobile equivalent.]
- [ASSUMPTION: No notification type is added. A procedure being attached or changed is not
  an event a worker needs pushed to them; they see it the next time they open the instance.]
- [ASSUMPTION: Archiving a ritual definition leaves the attachment intact, matching how
  archiving already leaves assignment pools and evidence requirements intact.]

## Dependencies

- The documents feature supplies the document, its rendering, and its ordinary access rules.
  This feature adds one read path into it, which must go through the documents feature's own
  interface rather than around it, per Constitution principle IV.
- Canonical resource links (feature 030) already cover opening a document page from a link
  on either client; the procedure entry point is expected to reuse that rather than invent a
  navigation path.
- The evidence review queue (feature 041) supplies the reviewer surface Story 3 extends.
- Per the project's Definition of Done, the living domain snapshots
  `docs/domain/rituals-tasks.md` and `docs/domain/docs-knowledge.md` must be updated in the
  same change set, since this changes ritual behaviour and adds a cross-domain read.

## Out of Scope

- External (non-workspace) procedure URLs.
- Per-evidence-requirement procedure attachments.
- More than one procedure document per definition.
- Creating or editing procedure documents from the ritual definition editor.
- Snapshotting the procedure at instance generation or evidence submission time for audit.
- Requiring a worker to acknowledge having read the procedure before submitting evidence.
- Attaching procedures to standard (non-ritual) tasks — those already have a description
  document of their own.
- Mobile configuration of the attachment.
