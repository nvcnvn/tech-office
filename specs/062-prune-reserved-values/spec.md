# Feature Specification: Prune Reserved-But-Unused Values

**Feature Branch**: `062-prune-reserved-values`

**Created**: 2026-09-12

**Status**: Draft

**Input**: User description: "Prune what nothing uses. Drop the reserved channel types and empty schemas for CRM, support, payroll and similar, the biometric credential type, and legacy route normalisation. Every reserved value is a constraint new work must route around, and the no-backward-compatibility stance makes removal free."

## Why This Exists

The workspace carries a set of placeholders for product areas that were sketched at the
start and never built — customer relationship management, support ticketing, payroll,
inventory, hiring and a dozen more. They exist as values a new record is permitted to
hold, as empty storage areas, as greyed-out navigation entries, as mute toggles for
notification categories that nothing ever sends, and as a sign-in method that was
abandoned mid-design. None of them does anything.

They are not free. Every one of them is a value that someone reading the system has to
investigate before concluding it is inert, a branch that validation and mapping code has
to carry, and a row in a settings list that asks a person to make a choice with no
consequence. The project's own behaviour documentation already flags most of them as
open questions. Removing them costs nothing because there is no outside party depending
on them.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A person configuring notifications sees only real categories (Priority: P1)

An employee opens the notification settings screen to stop a category of noise. Today the
list offers nine categories, four of which — Customers, People and HR, Support, Finance —
can never produce a notification, because no part of the product publishes into them.
Muting one of them changes nothing, and the person cannot tell that from looking. After
this change the list shows only the categories the workspace actually sends: chat, tasks
and projects, documents, calendar and system messages.

**Why this priority**: This is the only part of the prune a person can see. It removes
four dead controls from a settings screen and is independently shippable.

**Independent Test**: Open notification preferences on mobile and on web, confirm exactly
the live categories are listed, mute each one, and confirm the mute takes effect for a
notification the workspace can genuinely produce.

**Acceptance Scenarios**:

1. **Given** an employee on the notification preferences screen, **When** they review the
   mutable categories, **Then** every category listed corresponds to something the
   workspace can send, and no category is listed that the workspace never sends.
2. **Given** an employee who previously muted one of the removed categories, **When** they
   next open preferences, **Then** the screen loads without error and their remaining
   mutes are intact.
3. **Given** any notification the workspace publishes, **When** it is recorded, **Then**
   its category is one the preferences screen offers.

---

### User Story 2 - A person browsing the workspace is not shown modules that do not exist (Priority: P2)

The workspace navigation lists CRM, Finance and HR alongside the real areas, rendered as
permanently disabled entries with keyboard shortcuts assigned to them. They cannot be
opened. After this change the navigation lists only areas a person can enter, and the
keyboard shortcuts number contiguously across what is actually there.

**Why this priority**: Visible, but lower impact than a settings control that invites a
useless action. Independently shippable from the rest.

**Independent Test**: Load the workspace, confirm every navigation entry opens a working
area, and confirm each listed keyboard shortcut reaches the entry it is labelled with.

**Acceptance Scenarios**:

1. **Given** a signed-in employee, **When** the workspace navigation renders, **Then**
   every entry shown leads to a functioning area.
2. **Given** a signed-in employee, **When** they press each advertised navigation
   shortcut, **Then** each one opens the area printed next to it, with no gaps or dead
   keys in the sequence.

---

### User Story 3 - A contributor reads the system and finds no inert values to investigate (Priority: P1)

Someone adding a feature to chat, files, notifications or sign-in reads the permitted
values for a record and finds only values the system produces. There is no channel kind
for deal notes or support tickets, no file-attachment context for deals or tickets, no
sign-in credential kind for biometrics, and no empty storage area named after an unbuilt
product line. Documentation of current behaviour says the same thing the system does, so
the contributor does not have to check whether a value is live before designing around it.

**Why this priority**: This is the substance of the request and the reason it was raised —
each inert value is a standing tax on every future change in that area.

**Independent Test**: Inspect the permitted-value sets for channels, file contexts,
sign-in credentials and notification categories and confirm each listed value has at least
one place in the system that produces it; inspect the storage layout and confirm no
area exists with nothing in it.

**Acceptance Scenarios**:

1. **Given** the set of channel kinds a channel may have, **When** each is checked,
   **Then** each is a kind the workspace creates.
2. **Given** the set of contexts a file attachment may belong to, **When** each is
   checked, **Then** each is a context the workspace attaches files in.
3. **Given** the set of sign-in credential kinds, **When** each is checked, **Then** each
   is a kind the workspace issues and verifies.
4. **Given** the storage layout, **When** each named area is checked, **Then** each holds
   at least one record type.

---

### User Story 4 - A shared link resolves by one grammar, not two (Priority: P2)

When a person pastes a link to a task, a document, a chat channel or a calendar event, the
workspace resolves it and takes them to the item. Today it accepts two different link
shapes for this: the canonical shape the workspace itself produces, and a second,
historical shape that nothing in the product has generated. After this change only the
canonical shape resolves; anything else returns the same clear "this link is not
recognised" outcome as any other unusable link.

**Why this priority**: Closes a documented open question and halves the link grammar the
system must keep working, but the second grammar is not reachable from any link the
product emits, so nothing a person does today depends on it.

**Independent Test**: Share a link from each supported item type, open it on web and on
mobile, and confirm it resolves; then present a link in the historical shape and confirm
it is rejected with the standard unrecognised-link outcome rather than silently resolving.

**Acceptance Scenarios**:

1. **Given** a link the workspace generated for a task, document, channel or calendar
   event, **When** a person opens it on web or mobile, **Then** it resolves to that item
   exactly as before.
2. **Given** a link in the historical, non-canonical shape, **When** a person opens it,
   **Then** the workspace reports it as unrecognised rather than resolving it.
3. **Given** any resolved link, **When** the result is inspected, **Then** it carries no
   indication of having been rewritten from a historical shape, because that concept no
   longer exists.

---

### Edge Cases

- **Records already holding a removed value.** If any stored record holds one of the
  removed values — a channel of a removed kind, a file attachment in a removed context, a
  sign-in credential of the removed kind, a notification in a removed category, a person's
  mute list naming a removed category — that record must be dealt with before the value is
  disallowed, not left to fail a constraint check later. See the Assumptions section for
  the disposition chosen.
- **A person's saved mute list naming a removed category.** Their preferences must keep
  loading and their surviving mutes must be preserved; the removed entries drop away
  silently rather than producing an error.
- **The historical link shape in the wild.** If someone genuinely holds a link in the old
  shape — pasted into a note months ago — it stops working. That is the accepted cost; it
  degrades to the standard unrecognised-link message, not to a crash or a blank screen.
- **A test suite that exercises a removed value.** Existing checks that assert a removed
  value is accepted must be removed alongside it; a check that outlives its subject is a
  false gate.
- **Behaviour documentation that describes a removed value.** Documentation that names a
  pruned value must be corrected in the same change, including the entries that currently
  record these items as open questions — those questions are answered by this work, not
  merely noted.
- **A future decision to build one of these modules.** Nothing in this change prevents it.
  Re-adding a value later is the same size of change as adding any new value, which is the
  point: the cost is paid when the module is real, not before.

## Requirements *(mandatory)*

### Functional Requirements

**Removal scope**

- **FR-001**: The system MUST NOT accept or offer channel kinds for CRM deal notes or
  support tickets. The kinds a channel may have MUST be limited to those the workspace
  creates.
- **FR-002**: The system MUST NOT accept or offer file-attachment contexts for CRM deals
  or support tickets.
- **FR-003**: The system MUST NOT accept or offer a biometric sign-in credential kind. The
  permitted credential kinds MUST be limited to those the workspace issues and verifies.
- **FR-004**: The system MUST NOT contain named storage areas that hold no record types.
  Every storage area present MUST hold at least one record type.
- **FR-005**: The system MUST NOT accept or offer notification categories that no part of
  the workspace publishes into. The categories offered for muting MUST be exactly the
  categories the workspace can publish.
- **FR-006**: The system MUST resolve shared links by the canonical link shape only. It
  MUST NOT recognise, rewrite or report on historical link shapes, and MUST NOT expose any
  indication that a resolved link was rewritten.
- **FR-007**: Workspace navigation MUST list only areas a person can open. It MUST NOT
  render permanently disabled entries, and MUST NOT reserve keyboard shortcuts for them.

**Consistency and integrity**

- **FR-008**: For each removed value, every layer that declares the permitted set MUST be
  changed together — stored-data constraints, service-side validation, the published
  interface contract, and each client's own copy — so that no layer permits a value
  another layer rejects.
- **FR-009**: Before a value is disallowed, the system MUST establish that no stored record
  holds it, and MUST dispose of any that do according to the disposition recorded in
  Assumptions. A change that leaves a record violating a newly tightened constraint is not
  acceptable.
- **FR-010**: A person's saved notification mute list MUST survive the removal of
  categories: preferences MUST continue to load, and mutes for surviving categories MUST
  remain in force.
- **FR-011**: Every behaviour that existed before this change and is not named in FR-001
  through FR-007 MUST continue to work unchanged. This is a removal of inert values, not a
  change to live behaviour.

**Verification and documentation**

- **FR-012**: The project's automated checks MUST pass with no reduction in coverage of
  surviving behaviour. Checks that exercised only a removed value MUST be deleted rather
  than adapted to assert removal of something no longer present.
- **FR-013**: The existing check that every notification category the workspace publishes
  can also be muted MUST continue to hold over the reduced category set.
- **FR-014**: The living behaviour documentation MUST be updated in the same change set to
  describe the reduced value sets, with the removed values deleted rather than annotated,
  and the open questions this work answers MUST be closed out rather than left standing.

### Key Entities

- **Channel kind**: The category a chat channel belongs to, constraining how it is
  created and displayed. Loses its CRM-deal-notes and support-ticket values.
- **File-attachment context**: The thing a file is attached to, which governs who may see
  it. Loses its CRM-deal and support-ticket values. This is a distinct set from the
  upload-context set, which is not in scope for this change.
- **Sign-in credential kind**: The kind of secret an organisation-managed person signs in
  with. Loses its biometric value, retaining only the PIN the product actually issues.
- **Notification category**: The part of the workspace a notification came from, used both
  to label it and to let a person mute it. Loses the four categories nothing publishes into.
- **Storage area**: A named division of stored data, one per product area. The divisions
  holding no records are removed.
- **Navigation entry**: An area of the workspace reachable from the main navigation, with
  a label and a keyboard shortcut. The entries that cannot be opened are removed.
- **Shared link**: An address for an item in the workspace that resolves to that item on
  web or mobile. Keeps its canonical shape and loses its historical alternative shape.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every value a record is permitted to hold, across the sets named in this
  specification, is produced somewhere in the workspace — zero inert values remain in
  those sets.
- **SC-002**: The notification preferences screen offers five categories instead of nine,
  and every one of them can be demonstrated to suppress a real notification.
- **SC-003**: Every entry in the workspace navigation opens a working area — zero
  permanently disabled entries — and the advertised keyboard shortcuts run contiguously
  with no dead keys.
- **SC-004**: Zero named storage areas hold no records; the count of storage areas falls
  from twenty-four to eleven.
- **SC-005**: Links shared from every supported item type resolve on both web and mobile
  exactly as they did before the change, with no regression in the share-and-open journey.
- **SC-006**: The full automated check suite passes, and the number of checks covering
  surviving behaviour does not fall.
- **SC-007**: Behaviour documentation contains no description of a value the system no
  longer permits, and the three open questions this work answers are marked resolved.
- **SC-008**: A contributor can determine the live value set for any of these entities by
  reading one place, without cross-checking whether a listed value is actually reachable.

## Assumptions

- [ASSUMPTION: The prune covers four named clusters plus the two that are the same
  placeholders expressed at another layer. The user named reserved channel kinds, empty
  storage areas, the biometric credential kind, and historical link normalisation. The
  unpublished notification categories (customers, people and HR, support, finance) and the
  permanently disabled navigation entries (CRM, Finance, HR) are placeholders for the same
  unbuilt modules and fall under the stated rationale, so they are in scope. The file
  contexts for CRM deals and support tickets are in scope for the same reason.]
- [ASSUMPTION: Removed values have no stored records, and this is to be verified rather
  than assumed. Nothing in the workspace creates a channel of the removed kinds, attaches
  a file in the removed contexts, issues a biometric credential, or publishes into the
  removed categories, so the expected record count is zero everywhere. The change must
  still check before tightening each constraint. If a record is found, the disposition is
  to delete it — these are records of a feature that was never built, so there is nothing
  to preserve. Saved mute lists are the one exception: those are real preferences set by
  real people, so the removed category names are stripped from them and the rest kept.]
- [ASSUMPTION: This is a breaking change to the published interface and is shipped as one
  coordinated change across backend, web and mobile. The project is in early development
  with no third-party consumers, so no compatibility path, deprecation window or
  transitional variant is provided. This is the project's standing position on breaking
  changes.]
- [ASSUMPTION: The upload-context set is out of scope. It is a separate set from the
  file-attachment-context set and its own unreachable value (`calendar`) is documented as
  a known gap with a different cause — the calendar area references files uploaded through
  other contexts rather than uploading its own. Removing it is a behaviour question about
  the calendar area, not a placeholder prune, so it is left for separate consideration.]
- [ASSUMPTION: The redundant historical-shape flag exposed on a resolved link is removed
  along with the shape itself. Nothing reads it, and keeping a flag for a condition that
  can no longer arise reintroduces the problem this change exists to solve.]
- [ASSUMPTION: The stale documentation claim that the compliance storage area is unused is
  corrected as part of this change. It holds records, so it is not a prune target, but the
  documentation that lists it among the unused areas is wrong and is in the immediate blast
  radius of the storage-area work.]
- [ASSUMPTION: Placeholder directories and prose in design notes that merely mention these
  modules as possible future work are left alone. The target is values the running system
  permits, not every aspirational mention; removing the aspiration is a product decision
  outside this change.]
- [ASSUMPTION: Historical change proposals are not rewritten. They record what was intended
  at the time and remain accurate as history; only the documentation of current behaviour
  is updated.]
