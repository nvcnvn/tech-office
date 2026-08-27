# Feature Specification: App Store & Google Play Compliance Sweep

**Feature Branch**: `036-store-compliance-sweep`

**Created**: 2026-08-27

**Status**: Draft

**Input**: User description: "I think we should do a full Apple-Google store compliance sweep epic"

## Context

Tech Office has never been submitted to a public app store. The mobile app lets people
message each other, upload files, comment on documents and place voice calls, and it lets
anyone create a workspace from the phone. Both Apple and Google treat that combination as
"an app with user-generated content and user accounts", which triggers a specific,
non-negotiable set of store obligations regardless of the app being a workplace tool for a
closed organization.

An audit of the current build found none of those obligations met. This epic closes the gap
so that a first submission to App Store Review and Google Play Review can be expected to
pass rather than bounce.

The audit findings that motivate this epic:

| Area | Current state |
|---|---|
| Account deletion | No self-serve deletion anywhere in mobile, web, or the backend |
| Privacy policy | No published page; no URL to give either store |
| Terms of service / EULA | No published page; no acceptance at signup |
| Report content | No reporting path for any message, file, document or call |
| Block a person | No blocking; the only "mute" is a per-channel notification setting |
| Abuse contact | No published contact for abuse reports |
| Permission explanations | Generic or internal-jargon wording; some are the untouched framework defaults |
| Declared-but-unused permissions | Background location, local-network/Bonjour, screen-overlay, legacy broad storage |
| Missing permission | Android notification permission, without which push is silently dropped on modern Android |
| Reviewer access | No demo workspace or reviewer instructions |
| Store privacy disclosures | No inventory of what data the app collects, so neither store's privacy form can be filled in |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A person can delete their own account (Priority: P1)

Someone who signed themselves up for Tech Office decides they no longer want an account.
From inside the app, they find a clearly labelled way to delete it, are told plainly what
will be removed and what will be kept, confirm the decision, and their account and personal
data are gone. They are not sent to a support email, a web form on another site, or told to
contact an administrator.

**Why this priority**: Both stores refuse to publish an app that allows account creation
but not account deletion. Nothing else in this epic can ship without it. It is also the
single largest piece of work here.

**Independent Test**: Create an account, use the app, delete the account from within the
app, and confirm that signing in with those credentials fails and that the person's
personal data is no longer retrievable.

**Acceptance Scenarios**:

1. **Given** a self-registered person signed in on mobile, **When** they open account
   settings, **Then** an option to delete their account is visible without leaving the app.
2. **Given** they choose to delete their account, **When** the confirmation step is shown,
   **Then** it states in plain language exactly what is deleted, what is retained, and that
   the action cannot be undone.
3. **Given** they confirm deletion, **When** the operation completes, **Then** they are
   signed out on every device and their credentials no longer work anywhere.
4. **Given** they were the sole owner of a workspace that still contains other people,
   **When** they attempt deletion, **Then** they are told the workspace must first be
   transferred or closed, and are given the path to do so.
5. **Given** they were a member of workspaces they do not own, **When** deletion completes,
   **Then** their memberships end and their authored content is handled per the retention
   rule stated at confirmation.
6. **Given** an account was created for a worker by their employer rather than by
   themselves, **When** that worker opens account settings, **Then** they are told plainly
   that their account is managed by their employer, are shown who to contact, and are given
   an in-app control that sends a removal request to an administrator — rather than a
   deletion control that would erase the employer's records.
7. **Given** such a worker's removal request is granted by an administrator, **When** the
   worker no longer belongs to any organization, **Then** the personal identity data Tech
   Office holds about them independently of any employer is deleted.

---

### User Story 2 - The legal and safety surface is published and accepted (Priority: P1)

A prospective user reads what Tech Office does with their data before creating an account,
agrees to the terms as part of signing up, and can find those documents again later from
inside the app. Anyone — including someone who does not have an account — can find a way to
report abuse.

**Why this priority**: A published privacy policy URL is a hard field in both stores'
submission forms; the app literally cannot be submitted without one. Terms acceptance at
signup and a published abuse contact are both required parts of the user-generated-content
rules. This work is small and unblocks submission.

**Independent Test**: Visit the published policy and terms pages in a browser, then create
a new account and confirm the flow requires acknowledging them and links to them.

**Acceptance Scenarios**:

1. **Given** the marketing site, **When** a visitor requests the privacy policy or the
   terms of service, **Then** each is served at a stable public address that requires no
   sign-in.
2. **Given** the signup flow on mobile or web, **When** someone completes registration,
   **Then** they must have acknowledged the terms and privacy policy, and both are reachable
   as links from that screen.
3. **Given** a signed-in person, **When** they open settings, **Then** the privacy policy,
   the terms, and a way to report abuse are all reachable from within the app.
4. **Given** the published terms, **When** they are read, **Then** they state that abusive
   or objectionable content is prohibited and describe what happens to people who post it.
5. **Given** the published pages, **When** a reviewer looks for a contact method for abuse
   reports, **Then** a monitored address is stated on the page.

---

### User Story 3 - People can report content and block other people (Priority: P1)

Someone receives a message, file, document comment or call that they find abusive. They
report it in a couple of taps and get confirmation that it was received. They can also block
the person, after which that person can no longer start direct conversations with them and
their existing content is hidden from the reporter's view. Someone responsible for the
workspace can see the reports that were filed and act on them.

**Why this priority**: This is the substance of both stores' user-generated-content rules.
Apple's Guideline 1.2 and Play's user-generated-content policy each require a reporting
mechanism, a blocking mechanism and a stated moderation commitment. Missing them is the most
commonly cited rejection reason for apps with chat.

**Independent Test**: With two accounts in one workspace, have one report a message from the
other and block them, then confirm the report is visible to a workspace owner and the
blocked person's content and direct-message access are gone from the reporter's view.

**Acceptance Scenarios**:

1. **Given** any message, file, document comment or call record authored by another person,
   **When** the viewer opens its actions, **Then** a report option is present.
2. **Given** the viewer reports content, **When** they submit, **Then** they choose a reason,
   may add a note, and receive an on-screen confirmation that it was received.
3. **Given** a reported item, **When** a person responsible for the workspace reviews
   reports, **Then** they can see what was reported, by whom, against whom, and when, and can
   record an outcome.
4. **Given** the viewer blocks another person, **When** the block takes effect, **Then** the
   blocked person cannot start a new direct conversation with them and cannot call them.
5. **Given** an active block, **When** the viewer opens a shared workplace channel, **Then**
   the blocked person's messages remain visible, because hiding a colleague's contributions
   to shared work would let someone silently conceal instructions addressed to them.
6. **Given** an active block, **When** the viewer chooses to unblock, **Then** normal
   visibility and contact are restored.
7. **Given** a report is filed, **When** it is not acted on, **Then** it remains visible as
   outstanding rather than disappearing, so that the workspace can demonstrate its reports
   are actually reviewed.

---

### User Story 4 - The app asks only for what it uses, and explains why (Priority: P2)

When the app asks for the camera, the microphone, photos, location or notifications, the
person reading the prompt understands, in ordinary language, what the app will do with it and
why it helps them. The app does not ask for, or declare, anything it does not actually use.

**Why this priority**: Vague or boilerplate permission wording is an explicit rejection
reason, and declaring capabilities the app never exercises — background location especially —
invites reviewer questions that stall a submission for days. Separately, the missing
notification permission means push notifications are silently dropped on modern Android
devices, which is a real functional defect, not only a compliance one.

**Independent Test**: Install a release build on a fresh device, trigger each permission
prompt, and read the wording; then inspect the shipped build's declared capabilities and
confirm every one is exercised by a real feature.

**Acceptance Scenarios**:

1. **Given** a first-time permission prompt, **When** it is displayed, **Then** its text
   names the specific feature it enables and avoids internal product vocabulary.
2. **Given** a release build, **When** its declared capabilities are inventoried, **Then**
   every declared capability is used by a shipping feature, and each has a written
   justification recorded for the submission form.
3. **Given** the app requests a person's location, **When** the prompt appears, **Then** it
   requests only while-in-use access, because the app never needs location in the background.
4. **Given** a person on a recent Android device, **When** they first reach a point where
   notifications matter, **Then** they are asked for notification permission and, on
   granting it, subsequently receive push notifications.
5. **Given** a release build, **When** it is inspected, **Then** it contains no capability or
   explanatory text that exists only to support local development.

---

### User Story 5 - A store reviewer can actually use the app (Priority: P2)

A reviewer who has never seen Tech Office opens the submission, follows the notes, signs in
within a minute, and can reach chat, tasks, calendar, documents and the reporting and
blocking features without needing an invitation from us.

**Why this priority**: "We could not access the app's content" is a first-round rejection
that costs a full review cycle. Tech Office has an unusual sign-in model — workspace address
plus identifier plus PIN for one class of user — that a reviewer will not guess.

**Independent Test**: Hand the reviewer notes and credentials to someone unfamiliar with the
product and time how long it takes them to reach a conversation containing content.

**Acceptance Scenarios**:

1. **Given** the reviewer notes, **When** a first-time reader follows them, **Then** they can
   sign in to a populated demo workspace without contacting anyone.
2. **Given** the demo workspace, **When** the reviewer explores it, **Then** it contains
   enough realistic content that the report and block features can be exercised.
3. **Given** the demo credentials, **When** a review cycle takes several weeks, **Then** the
   credentials still work and the workspace still has content.
4. **Given** the app offers more than one way to sign in, **When** the notes are read, **Then**
   each distinct path a reviewer might encounter is explained.

---

### User Story 6 - Both stores' privacy disclosures are accurate (Priority: P3)

The data-collection disclosures shown on each store listing match what the app actually
collects, why, and whether it is linked to a person.

**Why this priority**: Both stores require these forms and both audit them after publication.
Getting them wrong is not usually a first-round rejection, but a mismatch discovered later can
pull a published app down, which is worse. It depends on the permission inventory from story
four, so it comes after.

**Independent Test**: Compare each declared data category against the places in the product
where that data is actually collected, and confirm no category is collected without being
declared.

**Acceptance Scenarios**:

1. **Given** the product as shipped, **When** its data collection is inventoried, **Then**
   every category of personal data collected is recorded with its purpose, whether it is tied
   to an identity, and whether it is shared with any third party.
2. **Given** that inventory, **When** each store's privacy form is completed, **Then** the two
   forms agree with each other and with the published privacy policy.
3. **Given** a later change that collects a new category of data, **When** it ships, **Then**
   the inventory and both store forms are updated as part of that change.

---

### Edge Cases

- Someone deletes their account while they are the only owner of a workspace containing other
  people, files and history.
- Someone deletes their account while their content is referenced elsewhere — a task they
  created, a document they wrote, a message others replied to.
- A person blocks someone and then both are added to the same new group conversation.
- A person blocks the only workspace owner, and then needs to receive an announcement.
- An employer-provisioned worker submits a removal request and no administrator ever acts on it.
- An administrator removes a worker who had a removal request outstanding, by the ordinary
  offboarding route rather than through the request.
- Someone files a report against a workspace owner — the person who would normally review it.
- Someone files reports repeatedly against the same person to harass them.
- A person is blocked mid-call.
- A worker signed in with an employer-issued credential, who never agreed to anything at
  signup because an administrator created the account, must still be bound by the terms.
- Deletion is requested and the request fails partway through.
- A reported item is deleted by its author before the report is reviewed.

## Requirements *(mandatory)*

### Functional Requirements

**Account deletion**

- **FR-001**: A person who created their own account MUST be able to delete it entirely from
  within the mobile app and from the web app, without contacting support.
- **FR-001a**: The system MUST distinguish accounts a person created for themselves from
  accounts an administrator provisioned for them, and MUST route each to its own deletion
  path.
- **FR-002**: Before deletion, the system MUST state which data is erased, which data is
  retained and why, and that the action is irreversible.
- **FR-003**: Deletion MUST end every active session for that person on every device.
- **FR-004**: After deletion, the person's credentials MUST no longer authenticate, and their
  personal profile data MUST no longer be retrievable through any part of the product.
- **FR-005**: The system MUST refuse to delete an account that is the sole owner of a
  workspace still containing other members, and MUST tell the person what to do instead.
- **FR-006**: Content authored by a deleted person in workspaces they did not own MUST remain
  legible to those workspaces while ceasing to identify the deleted person, and the
  confirmation copy in FR-002 MUST describe this accurately.
- **FR-007**: Deleting an individual account MUST NOT delete a workspace and its data; closing
  a workspace MUST remain a separate, administrator-only action.

**Deletion of employer-provisioned accounts**

- **FR-007a**: A person whose account was provisioned by an administrator MUST NOT be able to
  delete the workplace content they authored, because that content is the employing
  organization's record rather than their personal property.
- **FR-007b**: Account settings for such a person MUST state plainly that their account is
  managed by their employer and MUST name the organization.
- **FR-007c**: Such a person MUST be able to submit a removal request from inside the app,
  which notifies an administrator of the organization; they MUST NOT be told merely to
  contact someone by other means.
- **FR-007d**: An administrator MUST be able to see outstanding removal requests and act on
  them, and the requesting person MUST be able to see that their request is outstanding.
- **FR-007e**: When a person ceases to belong to any organization, the system MUST delete the
  personal identity data it holds about them independently of any employer — their global
  user record, credentials and personal profile.
- **FR-007f**: A person who both self-registered and was later provisioned into another
  organization MUST retain the full self-deletion path for their own account, with the
  employer-managed membership handled under FR-007a through FR-007e.

**Legal surface**

- **FR-008**: The system MUST publish a privacy policy and terms of service at stable public
  addresses reachable without signing in.
- **FR-009**: The terms MUST prohibit abusive and objectionable content and state the
  consequences of posting it.
- **FR-010**: Every signup path MUST require acknowledgement of the terms and privacy policy
  and MUST link to both from the signup screen.
- **FR-011**: The system MUST record, per person, that the terms were accepted and when.
- **FR-012**: Workers whose accounts were created by an administrator MUST be presented with
  the terms and MUST accept them before first use.
- **FR-013**: The privacy policy, the terms and a monitored contact address for abuse reports
  MUST all be reachable from within the signed-in app.

**Reporting and blocking**

- **FR-014**: A person MUST be able to report any item of content authored by someone else —
  including chat messages, direct messages, uploaded files, document comments and call
  records.
- **FR-015**: Reporting MUST require selecting a reason, MUST allow an optional note, and MUST
  confirm receipt on screen.
- **FR-016**: The system MUST retain each report with what was reported, its content at the
  time of reporting, who reported it, who authored it, and when.
- **FR-017**: A person with responsibility for the workspace MUST be able to list outstanding
  reports, view each one, and record an outcome.
- **FR-018**: A report MUST remain listed as outstanding until an outcome is recorded, even if
  the underlying content is deleted.
- **FR-019**: A person MUST be able to block another person in the same workspace, and to
  unblock them later.
- **FR-020**: While a block is in effect, the blocked person MUST NOT be able to start a new
  direct conversation with, or place a call to, the person who blocked them.
- **FR-021**: While a block is in effect, existing direct conversation history and call
  records involving the blocked person MUST be hidden from the blocker's view, with the
  ability to reveal an individual item.
- **FR-021a**: A block MUST NOT hide the blocked person's messages in shared workplace
  channels, so that nobody can silently conceal work instructions addressed to them.
- **FR-022**: Blocking MUST NOT notify the blocked person that they have been blocked.
- **FR-023**: A block MUST NOT prevent the blocked person from participating in the workspace
  generally, MUST NOT hide the blocker's content from anyone other than the blocker, and MUST
  NOT remove either person from channels they share.
- **FR-024**: A person MUST be able to see and manage their current list of blocked people.

**Permissions and build hygiene**

- **FR-025**: Every permission prompt MUST explain, in plain language, the specific feature it
  enables, without internal product vocabulary.
- **FR-026**: The shipped app MUST declare only capabilities that a shipping feature actually
  uses.
- **FR-027**: The app MUST request location only for the duration of use, never in the
  background.
- **FR-028**: The app MUST request permission to show notifications on platforms that require
  it, and MUST behave sensibly when that permission is refused.
- **FR-029**: The shipped app MUST NOT declare capabilities or display text that exists only
  for local development.
- **FR-030**: Each declared capability MUST have a recorded justification suitable for pasting
  into a store submission form.

**Reviewer access**

- **FR-031**: The team MUST maintain a demo workspace with populated, realistic content that
  exercises chat, tasks, calendar, documents, reporting and blocking.
- **FR-032**: The team MUST maintain reviewer notes covering every sign-in path the app
  offers, with working credentials. The primary credentials given to a reviewer MUST be a
  self-registered account, so that the reviewer exercises the full self-deletion path; an
  employer-provisioned account MUST be offered as a secondary credential with the reason for
  its different deletion path explained in the notes.
- **FR-033**: Demo credentials MUST remain valid across a multi-week review cycle without
  manual intervention.

**Store disclosures**

- **FR-034**: The team MUST maintain an inventory of every category of personal data the
  product collects, its purpose, whether it identifies a person, and any third party it is
  shared with.
- **FR-035**: Both stores' privacy disclosure forms MUST agree with that inventory and with
  the published privacy policy.
- **FR-036**: The inventory MUST be updated in the same change that introduces collection of a
  new category of data.

### Key Entities

- **Content report**: One person's assertion that a specific item is abusive. Records the
  reporting person, the authoring person, the item and a copy of its content at the time,
  the reason, an optional note, the time, and the outcome once recorded.
- **Block**: A one-directional relationship from the person who blocked to the person blocked,
  scoped to a workspace, with the time it was created.
- **Terms acceptance**: A record that a specific person accepted a specific version of the
  terms and privacy policy at a specific time.
- **Account deletion request**: The record of a deletion having been requested and its
  progress, so that a partial failure is detectable and resumable.
- **Data collection inventory**: The maintained list of personal data categories the product
  collects, kept in the repository as the source for both stores' disclosure forms.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The app is accepted by both App Store Review and Google Play Review without a
  rejection citing account deletion, user-generated content, privacy disclosure, permissions,
  or reviewer access.
- **SC-002**: A person can find and complete account deletion, from opening the app to final
  confirmation, in under two minutes and without external help.
- **SC-003**: A person can report an abusive message in three taps or fewer from seeing it.
- **SC-004**: A person can block someone in three taps or fewer from seeing their content.
- **SC-005**: 100% of capabilities declared by the shipped app are exercised by a shipping
  feature.
- **SC-006**: 100% of permission prompts state a specific feature, verified by reading each
  one on a device.
- **SC-007**: Push notifications are delivered on a fresh install of a recent Android device
  after the person grants notification permission.
- **SC-008**: A person unfamiliar with the product, given only the reviewer notes, reaches a
  conversation containing content in under five minutes.
- **SC-009**: Every category of personal data the product collects appears in both stores'
  privacy disclosures, with no category collected but undeclared.
- **SC-010**: Every outstanding content report is visible to a workspace owner within one
  minute of being filed.
- **SC-011**: An employer-provisioned worker can find out how their account is removed, and
  submit the request, without leaving the app.
- **SC-012**: No personal identity data remains for any person who belongs to no organization.

## Assumptions

- The published privacy policy and terms are drafted by, or reviewed by, someone qualified to
  write them. This epic delivers the places they are published, linked and accepted; it does
  not draft their legal content.
- The abuse contact address is a real monitored mailbox that the team commits to answering.
  Store reviewers do test it.
- Content moderation is performed manually by the people responsible for each workspace.
  Automated content filtering and an appeals process are out of scope; they become necessary
  at a scale this product has not reached.
- Reviewing reports and acting on removal requests are workspace-administration activities and
  therefore belong on web, per the constitution's mobile feature-scope rule. Reporting,
  blocking, and requesting one's own removal are personal actions and belong on mobile as well
  as web.
- Deleting one's own account is a personal action, not workspace administration, so it belongs
  on mobile as well as web. Closing an entire workspace remains web-only.
- Workplace content created by an employer-provisioned worker belongs to the employing
  organization, not to the worker. The organization is the controller of that content and Tech
  Office is the processor. Both stores' account-deletion rules are keyed to accounts the person
  *created*, which is why the two paths in FR-001a are compliant rather than an evasion; the
  reviewer notes state this explicitly so it is not mistaken for an off-app deletion path.
- Blocking is scoped to direct contact rather than shared channels because Tech Office is a
  closed workplace tool where the blocked person is a colleague. The reviewer notes state this
  reasoning, since a reviewer testing a block inside a shared channel will otherwise expect
  the messages to disappear.
- Feature-gating any of this work so that it is visible only to store reviewers was considered
  and rejected: the app has open self-registration, so a reviewer who creates their own
  workspace would find the features missing, and behaving differently under review is
  independently prohibited by both stores.
- Both platforms are addressed in one sweep because the two stores' requirements overlap
  heavily; splitting them would mean building the same reporting and deletion features twice
  against two review calendars.
- The app is submitted as a workplace productivity tool. The audience-appropriateness rating
  answers must reflect that the app contains unmoderated person-to-person messaging, which
  raises the rating above the lowest band.
- The existing workspace-scoped data model means a block and a report are both scoped to a
  workspace rather than global.
- The framework versions currently in use already satisfy each store's minimum platform
  targeting requirement; this is verified during the sweep rather than assumed indefinitely.
