# Feature Specification: People Directory on Mobile

**Feature Branch**: `048-people-directory-mobile`

**Created**: 2026-09-05

**Status**: Draft

**Input**: User description: "People directory on mobile. Read-only list of colleagues with department, role and phone, with tap-to-message and tap-to-call. Department search results are inert on mobile because there is no screen to open, and the owner cannot look up a worker's number."

## Problem

Two gaps meet in the same missing screen.

A person's phone number is already held in the workspace — it is collected at employee
import and at account creation — but on a phone there is nowhere to read it. An owner
standing on the shop floor who needs to reach a worker who is off-shift, offline, or not
answering chat has to open a laptop, or ask somebody. The mobile app can start a
conversation with a colleague but cannot tell you their number.

And department rows in mobile search are dead ends. A search for "Kitchen" returns the
department, the row renders with its badge, and tapping it does nothing, because there is
no screen for a department to open. The row looks like every other result and behaves
unlike all of them, which reads as a broken app rather than a missing screen.

Both are the same absence: mobile has no surface that answers "who works here, and how do
I reach them?"

**Constitution Principle XIII justification.** Principle XIII limits mobile to
employee-facing day-to-day features and keeps administration on the web. A read-only
people directory is not administration and does not need the workspace-shaping carve-out:
it creates, edits and deletes nothing. It is the phone-book equivalent of the chat member
lists, task assignee rows and search results that mobile already shows, gathered into one
screen and given the contact details a phone is uniquely good at acting on. Every
administrative act on a person — role editing, department assignment, deactivation,
credential reset, bulk import — stays web-only and is explicitly out of scope below.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Look up a colleague and call their phone (Priority: P1)

An owner needs to reach a worker who is not answering in the app. They open People from
the mobile app, find the person by name (or by scrolling the roster), see the person's
phone number, and tap it to place a normal phone call through the device's dialer.

**Why this priority**: This is the stated pain — the number exists in the workspace and is
unreachable from a phone. It delivers value on its own with no other story shipped, and it
is the only story that removes a "go find a laptop" step from an urgent moment.

**Independent Test**: Sign in on a device as any member, open the People directory, search
for a colleague who has a phone number recorded, and confirm the number is displayed and
that tapping it hands off to the device dialer pre-filled with that number. Fully testable
without departments or messaging.

**Acceptance Scenarios**:

1. **Given** a workspace with several active colleagues, **When** the member opens the
   People directory, **Then** they see a scrollable list of active colleagues, each row
   showing display name, department and role.
2. **Given** the directory is open, **When** the member types part of a colleague's name,
   **Then** the list narrows to matching people, and matching tolerates a misspelling or a
   partial name the same way workspace search does.
3. **Given** a colleague with a recorded phone number, **When** the member opens that
   person, **Then** the phone number is shown as a tappable contact row.
4. **Given** that phone row, **When** the member taps it, **Then** the device's phone
   dialer opens with the number filled in, and the member confirms the call themselves —
   the app never places a call without a second deliberate act.
5. **Given** a colleague with no phone number recorded, **When** the member opens that
   person, **Then** no phone row and no call affordance is shown at all — no greyed-out
   button and no "not provided" placeholder that invites a tap.
6. **Given** a colleague's entry, **When** the member views it, **Then** date of birth,
   home address and hire date are absent from every mobile surface.

---

### User Story 2 - Message a colleague from the directory (Priority: P2)

Having found the right person, the member starts a conversation with them without going
back to Chat and hunting for the person again.

**Why this priority**: It converts the directory from a lookup table into the place you go
to reach somebody, and it reuses the direct-message behaviour mobile search already has. It
is second because chat already has its own path to a colleague; the phone number does not.

**Independent Test**: Open a colleague in the directory, tap Message, and confirm the
direct-message conversation with that person opens — creating it if this is the first
message between them, reusing it if not.

**Acceptance Scenarios**:

1. **Given** a colleague other than the signed-in member, **When** the member taps Message,
   **Then** the direct-message conversation with that colleague opens.
2. **Given** the two have never spoken, **When** the member taps Message, **Then** the
   conversation is created and opened in the same action, with no intermediate step.
3. **Given** the conversation cannot be opened, **When** the attempt fails, **Then** the
   member is told plainly and left on the directory with the person still selected, rather
   than being dropped onto an empty screen.
4. **Given** the signed-in member's own entry, **When** they view it, **Then** neither
   Message nor Call is offered, and their own entry instead leads to their existing profile
   screen.

---

### User Story 3 - Open a department and see its people (Priority: P3)

A department result in mobile search — or a department shown on a person's entry — opens
the list of people in that department, so the row behaves like every other search result.

**Why this priority**: It closes the inert-row defect and makes the directory browsable by
team, which is how an owner actually thinks about the roster ("who is on Kitchen today").
It is third because it depends on the directory list existing, and because it fixes a
cosmetic-feeling defect rather than an urgent one.

**Independent Test**: Search for a department by name on mobile, tap the result, and confirm
a screen opens listing the members of that department; then tap a person in that list and
confirm their entry opens.

**Acceptance Scenarios**:

1. **Given** a department search result on mobile, **When** the member taps it, **Then** a
   screen opens naming the department and listing its members, each row acting exactly like
   a directory row.
2. **Given** a department with no members, **When** it is opened, **Then** the screen names
   the department and says plainly that nobody is assigned to it yet.
3. **Given** a person who belongs to a department, **When** the member taps the department
   shown on that person's entry, **Then** the same department screen opens.
4. **Given** a department that has been deleted since the search result was stored as a
   recent item, **When** the member taps the recent, **Then** they are told the item is no
   longer available and the recent removes itself, consistent with every other kind of
   stale recent.

---

### Edge Cases

- **A person with no department**: the row shows the role alone; no empty label or dash
  where the department would be.
- **A person in several departments**: the row shows one department and indicates there are
  more; the person's own entry lists all of them.
- **Deactivated colleagues and deletion tombstones**: excluded from the directory. A
  deleted account leaves a de-identified employee row behind so historical messages and
  tasks still resolve; those rows must never appear in the directory, which would list
  "Deleted user" as somebody you can call.
- **Org-managed worker with no email**: the entry renders without an email row. Email is
  not required for a directory entry; a name is.
- **A phone number the device cannot dial** (malformed, or a device with no telephony —
  a tablet or a simulator): the app reports that the call could not be started and leaves
  the number visible so it can be read or copied by hand.
- **A very large roster** (hundreds of people): the list loads and scrolls without the
  member waiting on the whole roster, and search narrows against the whole roster, not only
  the part already loaded.
- **Offline**: a previously loaded directory remains readable, and the phone number of
  someone already looked at is still there — a number is most needed when connectivity is
  poor. Calling works offline because it is a device action, not a network one.
- **A person whose phone number changes on the web**: the mobile entry reflects the new
  number the next time the directory is loaded; there is no stale copy that can be dialled
  indefinitely.
- **Narrow screens**: name, department and role stay legible at 360 dp width without
  truncating the name to make room for the role.

## Requirements *(mandatory)*

### Functional Requirements

**The directory**

- **FR-001**: The mobile app MUST provide a People directory screen listing the active
  colleagues of the signed-in member's workspace.
- **FR-002**: Each directory row MUST show display name, department and role, and MUST
  indicate the person's presence where presence is already known to the app.
- **FR-003**: The directory MUST be reachable from the mobile navigation as a named
  destination, and MUST NOT require the member to run a search first.
- **FR-004**: The directory MUST support narrowing by name using the same fuzzy,
  multilingual person matching the workspace already applies to people, so a partial or
  misspelled name still finds the person.
- **FR-005**: The directory MUST exclude deactivated employees and de-identified deletion
  tombstones.
- **FR-006**: The directory MUST load and scroll a roster of at least 500 people without the
  member waiting on the full roster before the first rows are usable.

**The person entry**

- **FR-007**: Opening a person MUST show their display name, every department they belong
  to, their role, their phone number when one is recorded, and their email when one is
  recorded.
- **FR-008**: The person entry MUST NOT show date of birth, home address, or hire date on
  any mobile surface. Date of birth and phone number both constrain PIN validity, and home
  address and hire date are HR records with no day-to-day use; the directory is a way to
  reach a colleague, not an HR file.
- **FR-009**: Every mobile people surface MUST be read-only. It MUST NOT offer editing of
  another person's details, role changes, department assignment, deactivation, credential
  reset, or invitation.
- **FR-010**: The signed-in member's own entry MUST NOT offer Message or Call, and MUST lead
  to their existing editable profile screen instead.

**Reaching a person**

- **FR-011**: A recorded phone number MUST be presented as a single-tap action that hands
  the number to the device's telephone dialer, with the member confirming the call in the
  dialer.
- **FR-012**: When no phone number is recorded, no call affordance MUST be rendered — not a
  disabled one and not a placeholder.
- **FR-013**: Tapping Message MUST open the direct-message conversation with that
  colleague, creating it if it does not yet exist, using the workspace's existing
  direct-message behaviour.
- **FR-014**: When a call cannot be handed off or a conversation cannot be opened, the
  member MUST be told in plain language and left where they were, with the details still
  on screen.

**Departments**

- **FR-015**: A department search result on mobile MUST open a screen listing that
  department's members. Department rows MUST no longer be inert.
- **FR-016**: A department shown on a person's entry MUST open the same department screen.
- **FR-017**: A department screen MUST name the department and, when it has no members, say
  so plainly rather than showing an unexplained empty list.
- **FR-018**: Rows on a department screen MUST behave identically to directory rows.

**Access and privacy**

- **FR-019**: The directory MUST be available to every authenticated member whose role
  permits listing colleagues, which by default includes the employee role — a directory
  only owners can read does not solve the problem it exists for.
- **FR-020**: A member whose role does not permit listing colleagues MUST NOT see the
  directory destination at all, rather than seeing it and receiving an error on tap.
- **FR-021**: The directory MUST show only people in the signed-in member's own workspace.
- **FR-022**: Contact details MUST NOT be written to the device beyond what is needed to
  render the screen; the feature MUST NOT add colleagues to the device's own address book.

**Coverage**

- **FR-023**: The feature MUST be covered by at least one blackbox device flow exercising
  open directory → find a person → see the number → hand off to the dialer, and one
  exercising a department result opening its member list.
- **FR-024**: The feature MUST be verified at 360 dp width on Android as well as on iOS.

### Key Entities

- **Colleague (directory entry)**: a person in the signed-in member's workspace, presented
  as display name, department memberships, role, presence, and the contact details needed
  to reach them — phone number and email. Derived from the existing employee record;
  deliberately a narrower view of it than the web roster shows.
- **Department (as a directory grouping)**: a named team with a set of members. On mobile a
  department is a way to filter the directory, not an editable organisational object; the
  tree, the org chart and every mutation stay on the web.
- **Contact action**: the pairing of a colleague with a way to reach them — dial the phone
  number through the device, or open the direct-message conversation in the app.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A member who knows a colleague's name can go from opening the app to seeing
  that colleague's phone number in under 15 seconds and no more than four taps.
- **SC-002**: A member can go from seeing the number to a ringing phone in one tap plus the
  dialer's own confirmation.
- **SC-003**: 100% of department results on mobile open a screen; no result kind on mobile
  is inert.
- **SC-004**: Zero mobile surfaces expose date of birth, home address, or hire date, and
  zero mobile surfaces allow modifying another person's record.
- **SC-005**: In a workspace of 500 people the directory's first screen of rows is usable
  within two seconds on a mid-range device, and narrowing by name returns matches within a
  second of the member pausing typing.
- **SC-006**: A previously viewed colleague's name and number remain readable with the
  device offline.
- **SC-007**: The stated task — "reach a worker whose number I do not know, from my phone" —
  is completable on the first attempt without leaving the mobile app to find the number.

## Out of Scope

- Any edit to another person's record: name, phone, role, department, activation state,
  credentials, invitations. All remain web-only per Constitution Principle XIII.
- Department management on mobile: creating, renaming, moving, deleting a department,
  assigning or removing members, setting managers. The department screen is a filtered
  people list, not an editor.
- The department tree or org chart. Mobile shows a department's people, not the hierarchy.
- Employee import.
- Placing an in-app voice call from the directory. In-app calling is anchored to a
  conversation and is already reachable one step further on, from the direct message the
  Message action opens.
- Writing colleagues into the device's native contacts.
- Any new person-facing field. The directory shows what the workspace already records.

## Assumptions

- [ASSUMPTION: "Tap-to-call" means handing the recorded phone number to the device's
  telephone dialer, not starting an in-app voice call. The stated pain is that "the owner
  cannot look up a worker's number", which is only solved by a real phone number that
  reaches a person who may be off-shift, offline, or not carrying the app open; in-app
  calling already exists and reaches only someone connected. The app hands off to the
  dialer rather than dialing, so the member confirms the call — an accidental tap must not
  ring somebody.]
- [ASSUMPTION: The directory lists only active people, excluding deactivated employees and
  the de-identified tombstone rows left behind by account deletion. Those rows exist so
  historical messages and tasks still resolve, and listing them would offer "Deleted user"
  as a person to call.]
- [ASSUMPTION: The directory is visible to every role that already holds the
  list-colleagues permission, which by default includes the employee role. Restricting it
  to owners would defeat the point — an employee needing a colleague's number has the same
  problem the owner does — and no new permission is introduced.]
- [ASSUMPTION: Date of birth, home address and hire date are withheld from mobile even
  though the existing roster listing carries them. Date of birth and phone number both
  constrain what PINs are acceptable, so widening their audience widens a credential-guessing
  surface; and neither address nor hire date has a day-to-day use on a phone. The mobile
  view is deliberately narrower than the web roster.]
- [ASSUMPTION: A department on mobile opens a filtered list of its members rather than a
  department detail screen with the hierarchy. It resolves the inert row with the screen
  that already had to exist, and keeps the org chart — which needs width — on the web.]
- [ASSUMPTION: The directory is reached from the More tab rather than promoted to a
  top-level tab. Looking up a colleague is frequent but not continuous, the tab bar is
  full, and the existing search entry point remains a second way in.]
- [ASSUMPTION: Presence is shown on directory rows because the app already resolves it for
  people elsewhere, and it tells the member whether Message is likely to get a fast reply
  or whether the phone is the better bet.]
- [ASSUMPTION: Offline readability means the last successfully loaded directory data stays
  visible, on the same terms as other cached mobile lists. No new offline store is
  introduced for this feature.]

## Dependencies

- The existing employee roster and employee-card lookups, which already hold name, email,
  department, presence and phone number.
- The existing department membership records.
- The existing direct-message creation behaviour that mobile search already uses for person
  results.
- The existing fuzzy multilingual person and department matching used by workspace search.
- The device's telephone dialer, via the platform's standard link handling.
