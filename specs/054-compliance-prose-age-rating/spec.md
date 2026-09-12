# Feature Specification: Compliance prose describes the app that exists, and the age rating answers the questions now asked

**Feature Branch**: `054-compliance-prose-age-rating`

**Created**: 2026-09-12

**Status**: Draft

**Input**: User description: "Compliance documents describe the app that exists. reviewer-notes.md tells App Review the app asks for Face ID for optional faster sign-in, permission-justifications.md carries a written justification for it, and data-collection-inventory.md explains how the biometric never reaches the app, all for a capability with no implementation. Remove all three, and answer the social-media capability questions that became mandatory in the age-rating questionnaire this September, which a chat feed and person-to-person messaging make unavoidable. Pointing a reviewer at a feature they cannot find costs more than omitting it."

## Why this exists

Feature 053 stopped the app *asking* for a Face ID permission it never used. It
did not finish the sentence: the prose a reviewer actually reads still promises
the feature. Two problems remain, and they have opposite shapes.

**The prose over-promises.** `docs/compliance/reviewer-notes.md` is pasted
verbatim into App Store Connect's App Review Information and Play Console's
testing instructions. Its permissions paragraph tells the reviewer the app asks
for "Face ID (optional faster sign-in)". There is no such feature, no such
permission in the manifest since 053, and no biometric authentication library in
the dependency tree. A reviewer who reads that sentence goes looking for a
sign-in option that is not on any screen. That is worse than never mentioning
it: an absent capability is invisible, while a *described* absent capability is
a discrepancy between the app and its review materials, and the reviewer found
it by following our own instructions. `docs/compliance/data-collection-inventory.md`
makes a quieter version of the same claim — its "Not collected" list explains
that "Face ID and fingerprint sign-in are performed by the operating system; the
app receives only success or failure and never the biometric itself", which
describes the data flow of a feature that was never built.

**The prose under-answers.** The age-rating questionnaire on both stores gained
mandatory capability questions this September covering social-media style
behaviour: whether the app carries a feed of user-posted content, whether people
can message each other directly, whether they can find and contact each other,
whether any of it is moderated before it is visible. TechOffice has a chat feed
and person-to-person messaging and calling, so these questions cannot be skipped
and cannot honestly be answered "no". They can only be answered *precisely* —
which is the work, because the precise answer is what separates a closed
workplace tool from a social network. The one place the repository speaks to age
rating today is four sentences at the bottom of the data-collection inventory,
written before the capability questions existed.

Both failures come from the same gap: the automated store-manifest gate
cross-checks the manifest against `docs/compliance/permission-justifications.md`
and against nothing else. Every other compliance document is held true by
discipline alone, and discipline is what just lapsed — 053 updated the document
the gate reads and left the two it does not.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every capability the review materials name can be found in the app (Priority: P1)

A reviewer opens the notes we pasted into App Store Connect, works through the
permissions paragraph, and finds each permission being requested by the feature
the paragraph says requests it. Nothing in the notes sends them looking for a
screen that does not exist.

**Why this priority**: this is a live rejection risk on the next submission, and
it is the specific cost the request names. It is also the smallest of the three
stories — two documents, a handful of sentences — so it ships first and alone.

**Independent Test**: take the permissions paragraph of the reviewer notes and
the "Not collected" list of the data-collection inventory, and check every
capability word in them against the app's declared permissions and against the
code. Delivers a review packet with no unfindable feature in it, with no other
part of this feature built.

**Acceptance Scenarios**:

1. **Given** the reviewer notes as they will be pasted into App Store Connect,
   **When** a reader lists every permission the notes say the app requests,
   **Then** that list is exactly the set the app declares — microphone, camera,
   photos, location, notifications — and contains no biometric entry.
2. **Given** the data-collection inventory's "Not collected" section, **When** a
   reader reads the biometric line, **Then** it states that the app performs no
   biometric authentication at all, and does not describe how a biometric
   sign-in would handle data.
3. **Given** the permission justifications document, **When** a reader looks for
   an entry justifying a permission the app does not request, **Then** there is
   none; the biometric entries appear only in the "deliberately blocked" and
   "deliberately absent" tables, which record why the app does *not* ask.
4. **Given** any document under `docs/compliance/`, **When** a reader searches it
   for a named device capability, **Then** every occurrence is either a
   capability the app implements or an explicit statement that the app does not
   implement it — never a description of how an unimplemented one behaves.

---

### User Story 2 - The age-rating questionnaire can be answered from the repository (Priority: P2)

Whoever submits the app opens the age-rating questionnaire on either store,
finds a mandatory group of social-media capability questions, and answers every
one of them by reading a document in this repository rather than by guessing or
by asking an engineer. Each answer carries the evidence behind it, so the same
answer is given next submission and by the next person.

**Why this priority**: the questions are mandatory, so submission is blocked
until they are answered — but a blocked submission is visible and recoverable in
the console, whereas the US1 discrepancy is invisible until a reviewer finds it.
This is the larger piece of work and the one that outlives this submission.

**Independent Test**: hand the document to someone who has never seen the
codebase, with both stores' questionnaires open, and see whether they can
complete the social-media capability section without a follow-up question.

**Acceptance Scenarios**:

1. **Given** the age-rating questions about user-generated content and a content
   feed, **When** the submitter looks them up, **Then** the answer is yes with
   the feed named (the workspace chat channels, including "Site updates") and the
   absence of any public or cross-workspace surface stated alongside it.
2. **Given** the questions about person-to-person messaging and contact between
   users, **When** the submitter looks them up, **Then** the answer is yes,
   scoped to colleagues inside one workspace, with direct messages and voice
   calls both named.
3. **Given** the questions about discovery, public profiles, follower or friend
   relationships, and contact with strangers, **When** the submitter looks them
   up, **Then** each is answered no, with the reason: a workspace is closed,
   membership is created by an invitation or by an administrator, and there is
   no surface anywhere that reaches a person in another workspace.
4. **Given** the question about whether user content is moderated before it is
   visible, **When** the submitter looks it up, **Then** the answer states that
   it is not pre-moderated, and lists the after-the-fact safeguards: in-app
   reporting, the owner-side report queue, blocking of direct contact, terms
   prohibiting objectionable content, and the monitored abuse address.
5. **Given** a question whose honest answer raises the resulting age rating,
   **When** the submitter reads the document, **Then** it gives the honest
   answer and records the rating that follows, rather than a softened answer.
6. **Given** the question of whether the app shares a person's location with
   other users, **When** the submitter looks it up, **Then** the answer is
   derived from what the app actually does with a check-in coordinate and a
   task-evidence coordinate, and names who can see it.
7. **Given** both stores' questionnaires, **When** the submitter works through
   either, **Then** the document covers that store's questions specifically,
   rather than one merged answer set that has to be reinterpreted per store.

---

### User Story 3 - The next permission removal cannot leave the prose behind (Priority: P3)

An engineer removes a permission, updates the manifest and the justifications,
and forgets the reviewer notes — exactly what happened here. The build fails and
names the document and the stale sentence.

**Why this priority**: it prevents the recurrence rather than the instance, and
the instance is already fixed by US1. It is also the only part of this feature
that touches executable code.

**Independent Test**: put the Face ID sentence back into the reviewer notes on a
scratch branch and run the mobile test target; the gate must fail and name it.

**Acceptance Scenarios**:

1. **Given** a compliance document that names a device capability the app's
   manifest does not declare, **When** the store-manifest gate runs, **Then** it
   fails, and the failure names the document, the line, and the term.
2. **Given** a compliance document that names a capability in a table of
   deliberately blocked permissions or deliberately absent keys, **When** the
   gate runs, **Then** it passes — a recorded absence is the opposite of a false
   promise and must not be punished as one.
3. **Given** the repository at the end of this feature, **When** the mobile test
   target runs, **Then** the gate passes and the suite runs, with no step
   requiring the gate to be bypassed.

### Edge Cases

- A compliance document mentions a capability historically, in a sentence about
  why it was removed. The gate must distinguish this from a live claim, which is
  why the recorded-absence tables are the sanctioned place for such mentions and
  the rule is scoped to them rather than to a general prose parse.
- A permission is *added* later. The same gate now requires the reviewer notes to
  gain a sentence, not only the justifications — which is the intent, and makes
  the reviewer notes part of the Definition of Done for any permission change.
- The two stores word the same capability question differently, or one asks a
  question the other does not. Answers are recorded per store, so a divergence
  is expressible rather than averaged away.
- A questionnaire answer and the data-collection inventory imply different things
  about the same behaviour — for example location visibility. The code decides,
  and both documents are corrected to match it.
- The stores change the questionnaire again. The document carries the date its
  answers were last checked against the live forms, so a stale answer set is
  visible rather than silently assumed current.
- An answer honestly given pushes the rating above what the product expects. The
  rating is recorded as an outcome, not treated as a constraint to work back from.

## Requirements *(mandatory)*

### Functional Requirements

**Removing the description of an absent capability**

- **FR-001**: The reviewer notes MUST describe exactly the permissions the app
  declares, and no others. The biometric entry MUST be removed rather than
  reworded.
- **FR-002**: The data-collection inventory MUST state that the app performs no
  biometric authentication, and MUST NOT describe the data flow of a biometric
  sign-in.
- **FR-003**: The permission justifications document MUST be verified to contain
  no justification for a permission the app does not request. Its entries
  recording why the biometric permissions are blocked and why the biometric key
  is absent MUST be kept — they are the record that the absence is deliberate.
- **FR-004**: No document under `docs/compliance/` may describe the behaviour of
  a capability the app does not implement. Each capability named in those
  documents MUST be either implemented or explicitly recorded as absent.
- **FR-005**: The living domain snapshot for compliance MUST be updated in the
  same change set to reflect the corrected review materials.

**Answering the age-rating questionnaire**

- **FR-006**: The repository MUST carry a single document that answers both
  stores' age-rating questionnaires, holding one entry per question with the
  answer and the evidence for it.
- **FR-007**: That document MUST answer the mandatory social-media capability
  questions, covering at least: a feed of user-posted content, person-to-person
  messaging, person-to-person calling, discovery of and contact with other
  users, public profiles, follower or friend relationships, contact with people
  outside the workspace, and pre-publication moderation.
- **FR-008**: Every answer MUST cite where it can be verified — a screen in the
  app, a behaviour a reviewer can reproduce, or a named place in the code.
- **FR-009**: The document MUST state the closed-workspace boundary explicitly:
  membership arises only from an invitation or an administrator, and no surface
  reaches a person outside the workspace. This is the fact that distinguishes
  the app's honest "yes, there is messaging" from a social network.
- **FR-010**: The document MUST record the after-the-fact safeguards that
  accompany unmoderated content: in-app reporting, the owner-side report queue
  with its content snapshot, blocking of direct contact, terms prohibiting
  objectionable content, and the monitored abuse address.
- **FR-011**: The document MUST answer whether a person's location is shared
  with other users, from what the app does with a check-in coordinate and a
  task-evidence coordinate, naming who can see each.
- **FR-012**: The document MUST record the age rating each store's questionnaire
  produces from these answers, as an outcome of answering honestly.
- **FR-013**: The document MUST cover each store separately where the two ask
  different questions, rather than merging them into one answer set.
- **FR-014**: The document MUST carry the date its answers were last checked
  against the live questionnaires, and a standing obligation that a change which
  adds, removes, or reshapes a communication or content-sharing capability
  updates it in the same change set.
- **FR-015**: The age-rating material MUST live in exactly one place. The
  existing age-rating paragraphs in the data-collection inventory MUST be
  removed and replaced by a pointer, so the two cannot drift apart.

**Preventing the recurrence**

- **FR-016**: The store-manifest gate MUST fail when a document under
  `docs/compliance/` names a device permission or capability the app's manifest
  does not declare.
- **FR-017**: That check MUST NOT fire on a mention inside the recorded-absence
  material — the deliberately-blocked permissions table and the
  deliberately-absent keys table — so that documenting an absence stays possible.
- **FR-018**: A failure MUST name the document, the line, and the term, so the
  fix is obvious without reading the gate's source.
- **FR-019**: The gate MUST continue to pass at the end of this feature, and the
  mobile test target MUST run without bypassing it.

### Key Entities

- **Age-rating answer**: one questionnaire question, the store that asks it, the
  answer given, the evidence for that answer, and any qualifier the form allows.
- **Recorded absence**: a capability the app deliberately does not implement or
  request, with the reason. Distinct from an undocumented absence, and the only
  sanctioned way for compliance prose to name an unimplemented capability.
- **Review materials**: the text pasted into each store's console at submission —
  reviewer notes, permission justifications, privacy answers, age-rating answers.
  Their defining property is that a reviewer reads them as claims about the app.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero sentences across `docs/compliance/` describe the behaviour of
  a capability the app does not implement, verified by checking every capability
  term in those documents against the app's declared permissions and the code.
- **SC-002**: The set of permissions named in the reviewer notes and the set the
  app declares are identical: five named, zero extra, zero missing.
- **SC-003**: A person with both stores' questionnaires open completes the
  social-media capability section from the repository alone, with zero questions
  left unanswered and zero escalations to an engineer.
- **SC-004**: Every yes/no answer in the age-rating document cites evidence a
  reviewer or an engineer can check independently; the count of uncited answers
  is zero.
- **SC-005**: The age rating produced by each store's questionnaire is recorded,
  for both stores.
- **SC-006**: Age rating is documented in exactly one file; searching the
  repository for the answers returns one location, not two.
- **SC-007**: Reintroducing the removed biometric claim into any compliance
  document causes the gate to fail and to name it, verified once per document.
- **SC-008**: A mention of an absent capability inside a recorded-absence table
  does not fail the gate, verified against the entries that exist today.
- **SC-009**: The mobile test target passes at the end of the feature with the
  gate enabled, and no new drift is opened in the register.

## Assumptions

- [ASSUMPTION: The request's second premise is already partly satisfied and the
  scope narrows accordingly. `docs/compliance/permission-justifications.md` no
  longer carries a written justification for Face ID — feature 053 removed that
  section in commit 764e18e and replaced it with entries recording the biometric
  permissions as deliberately blocked and the biometric key as deliberately
  absent. Verified by reading the file at HEAD and diffing against 053's parent.
  So "remove all three" resolves to: remove two live claims (reviewer notes,
  data-collection inventory) and verify the third rather than re-remove it. The
  verification is kept as a requirement because the premise asserted otherwise,
  and an assertion that turns out false once is worth confirming rather than
  assuming.]
- [ASSUMPTION: The recorded-absence entries in the permission justifications are
  kept, not deleted along with the claims. They read "there is no biometric
  sign-in anywhere in the app" — which is the truth, not a promise, and it is
  what tells the next engineer that the absence is a decision rather than an
  oversight. Deleting them would re-open the question 053 closed. This is the
  reason FR-017 exempts them from the new gate check rather than forcing them
  out.]
- [ASSUMPTION: The age-rating answers get their own file under
  `docs/compliance/` rather than staying a section of the data-collection
  inventory. The inventory's own opening sentence scopes it to the two stores'
  *privacy* disclosures; age rating is a different form with a different
  audience, and the capability questions make it substantially longer than the
  four sentences it occupies today. The directory already runs one file per
  store-form family, so a fourth follows the existing convention rather than
  inventing one. FR-015 removes the old section so there is one answer, not two.]
- [ASSUMPTION: Answers are given honestly even where an honest answer raises the
  rating, and the resulting rating is recorded as an outcome. The alternative —
  choosing answers to reach a target rating — is the failure mode this whole
  feature exists to correct, one form over.]
- [ASSUMPTION: The new gate check is scoped to a fixed list of device-capability
  terms the project already enumerates in its allow-lists, not to a general
  parse of English prose. A capability word appearing outside a recorded-absence
  table is the signal; anything cleverer would be a natural-language problem
  dressed as a build step. The existing gate already reads these documents and
  the manifest, so the addition is a rule inside a script that runs, not new
  infrastructure.]
- [ASSUMPTION: Nothing the app does changes. This feature edits documents and one
  build check. If answering a questionnaire question honestly reveals a
  behaviour the product does not want — for example a location visibility nobody
  intended — that is recorded as drift and specified separately, not fixed here
  under cover of a documentation change.]
- [ASSUMPTION: The specific wording and grouping of each store's capability
  questions is read off the live consoles during implementation rather than
  reproduced here from memory. The questionnaires changed this September and
  will change again; this spec fixes what must be answered and how the answer
  must be evidenced, and leaves the transcription of question text to the person
  looking at the form. FR-014's date stamp exists for exactly this reason.]

## Out of Scope

- Adding a biometric sign-in. If one is wanted later it arrives with its own
  permission, purpose string, justification entry, allow-list entry, and
  reviewer-notes sentence — in one change set, which is the rule this feature
  enforces from the other direction.
- Removing the unused `biometric` credential type from the backend data model and
  its migration `CHECK` constraint. Still the last biometric residue in the
  repository, still part of a separate cleanup of reserved-but-unused values, and
  invisible to a reviewer.
- Changing any safety behaviour to improve an answer: blocking stays scoped to
  direct contact, reporting stays after-the-fact, report review stays web-only.
  The questionnaire is answered about the app as it is.
- Adding pre-publication moderation.
- Filling in the questionnaires in the store consoles. That is a manual
  submission step outside this repository, as the data-collection inventory
  already records for the privacy forms; this feature supplies what is typed
  into it.
- The privacy questionnaire and Data safety form answers themselves, beyond
  removing the biometric sentence and correcting anything the location question
  proves wrong.
- Generalised prose linting across the repository. The new check covers
  `docs/compliance/` and a fixed capability vocabulary.
- The unrelated drift in the register — the failing lint run, the search
  threshold leak, the sign-out cache residue.
