# Feature Specification: A demo workspace a reviewer can finish

**Feature Branch**: `055-seed-demo-workspace`

**Created**: 2026-09-12

**Status**: Draft

**Input**: User description: "A demo workspace a reviewer can finish. seed-demo-org creates one owner and one employee, so the account the review notes nominate for in-app account deletion is the sole owner of a populated workspace and the sole-owner guard refuses it; no credential in the pack demonstrates deletion end to end, which is the one thing 5.1.1 asks to see. It also seeds no tasks and no ritual runs, so My Work and Today both read empty on the phone. Seed a second owner, a handful of tasks across two states, and one overdue and one unassigned ritual instance."

## Why this exists

The demo workspace handed to an App Store or Play reviewer has two holes that a reviewer
discovers before we do.

**The deletion demonstration cannot be completed.** The reviewer notes nominate the
self-registered owner as the account to use for in-app account deletion, because it is the
only kind of account whose settings screen shows the full deletion path. But that account is
the *only* owner of a workspace that also contains a worker, and the product deliberately
refuses to delete a sole owner who would strand somebody. So the reviewer follows the
instructions we wrote, reaches the confirmation screen, and is told no. Guideline 5.1.1(v)
asks to see account deletion work; the pack currently contains no credential that
demonstrates it end to end. The refusal is correct product behaviour — the demo workspace is
simply shaped so that the correct behaviour is the only behaviour on show.

**The phone reads empty.** The seed writes a chat conversation and one calendar event, but no
tasks and no ritual instances. A reviewer who opens the app on a phone — which is the main
way the product is used — lands on Today and My Work and sees empty states on both. Two of
the four tabs look like an unfinished app.

Both are fixed by seeding more of the workspace, not by changing product behaviour.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A reviewer deletes an account and sees it work (Priority: P1)

A store reviewer checking guideline 5.1.1(v) opens the reviewer notes, takes the credential
the notes nominate for the deletion check, signs into the mobile app, walks the path the
notes describe, types the confirmation phrase, and the deletion is accepted. They are signed
out. Signing in again with that credential fails. Nothing they did takes the rest of the
demo workspace away: the primary credential still signs in, and everything the notes told
them to look at is still there.

**Why this priority**: This is the one thing a rejection under 5.1.1(v) turns on, and it is
the thing that currently cannot be done at all. Everything else in this feature is presentation.

**Independent Test**: Seed a fresh workspace, request deletion as the nominated account, and
confirm the request is accepted rather than refused with a sole-owner precondition. Then sign
in with the primary credential and confirm the workspace is intact.

**Acceptance Scenarios**:

1. **Given** a freshly seeded demo workspace, **When** the account the notes nominate for
   deletion requests deletion of their own account, **Then** the request is accepted and no
   sole-owner refusal is returned.
2. **Given** that deletion has completed, **When** the primary owner credential signs in,
   **Then** the workspace, its conversation, its tasks and its ritual instances are all still
   present and the workspace still has at least one owner.
3. **Given** a freshly seeded demo workspace, **When** the reviewer signs in as the
   admin-provisioned worker and opens the account-ending screen, **Then** they are offered the
   in-app removal *request* path, unchanged by this feature, so both account-ending paths
   remain demonstrable.
4. **Given** a workspace where the deletion has already been demonstrated, **When** the seed
   is run again, **Then** the deleted credential is restored and the deletion can be
   demonstrated a second time.

---

### User Story 2 - A reviewer opens the phone and sees a workspace in use (Priority: P2)

A reviewer signs into the mobile app with either demo credential. My Work lists work items.
Today lists work that is late, work due today, and — for the owner — what the team is late on
or is holding nobody. The workspace reads like a business that is using it, not like a fresh
install.

**Why this priority**: Two empty tabs read as an incomplete app and invite questions we then
have to answer in the Resolution Center. It does not, on its own, block approval the way
story 1 does.

**Independent Test**: Seed a workspace, sign in on mobile as each credential in turn, and
confirm neither My Work nor Today shows an empty state.

**Acceptance Scenarios**:

1. **Given** a freshly seeded demo workspace, **When** the reviewer opens My Work as either
   demo account, **Then** at least one work item is listed and no empty state is shown.
2. **Given** a freshly seeded demo workspace, **When** the reviewer opens Today as either demo
   account, **Then** at least one section is populated and no whole-screen empty state is
   shown.
3. **Given** a freshly seeded demo workspace, **When** the reviewer opens Today as an owner,
   **Then** the Team section lists at least one recurring job the team is late on or that
   nobody is holding.
4. **Given** the seeded work items, **When** the reviewer opens any of them, **Then** each has
   a title that reads as real work for this business rather than placeholder text.

---

### User Story 3 - The seeded workspace still survives a re-run and the passage of time (Priority: P3)

Whoever prepares a resubmission runs the seed again the morning it goes out. The workspace is
refreshed, not duplicated: one workspace, one copy of the conversation, one copy of each
seeded work item, and the dated content moves forward so nothing reads as weeks stale.

**Why this priority**: The existing seed already guarantees this for the content it writes.
The new content must not be the thing that breaks it — but nothing in this story is visible to
a reviewer on a first run.

**Independent Test**: Run the seed twice against the same workspace address and compare row
counts and dates between the runs.

**Acceptance Scenarios**:

1. **Given** an already-seeded workspace, **When** the seed runs again, **Then** the number of
   seeded work items and recurring-job instances is the same as after the first run.
2. **Given** a workspace seeded some days ago, **When** the seed runs again, **Then** the
   instance that should read as unassigned-for-today is dated for the current day, and the
   instance that should read as late is dated so that it is still late rather than written off.
3. **Given** the background sweeps that maintain recurring-job state run after the seed,
   **When** a reviewer opens the workspace, **Then** the late instance is still shown as late
   rather than having moved to a closed or written-off state.

---

### Edge Cases

- **The reviewer deletes the primary credential instead of the nominated one.** Both are now
  owners, so neither is a sole owner and either deletion is accepted. The workspace survives
  either way, keeping one owner and all its content. The notes must make clear which
  credential is the disposable one, but the workspace must not depend on the reviewer reading
  that carefully.
- **The reviewer deletes both owner accounts.** The second deletion is refused by the existing
  sole-owner guard, because the worker is still in the workspace. That refusal is correct and
  is not a regression; the notes tell the reviewer they only need to do this once.
- **The reviewer's local date is not the server's date.** The "nobody is holding this" section
  matches on the viewer's own local date, so a reviewer many hours from the server's timezone
  may be on a different calendar day from the seeded instance. The late instance has no date
  bound and is unaffected, so Today is never wholly empty for an owner; re-running the seed
  close to submission narrows the window further.
- **The background generation sweep runs against the seeded recurring job.** It must not
  produce a second copy of the seeded instances or leave the workspace with dozens of
  generated ones a reviewer has to scroll past.
- **The seed runs against a workspace where a reviewer has already changed things** — reported
  a message, deleted a task, submitted evidence. The re-run restores the seeded shape without
  failing on what the reviewer did.
- **A seeded work item's project has no state in the category the seed wants.** The seed must
  fail loudly at preparation time rather than quietly leaving a work item in the wrong column
  for a reviewer to find.

## Requirements *(mandatory)*

### Functional Requirements

#### The deletion demonstration

- **FR-001**: The demo workspace MUST contain two self-registered owner accounts, so that
  neither is the sole owner and the sole-owner guard does not refuse either one's deletion.
- **FR-002**: One of the two owner accounts MUST be designated in the reviewer notes as the
  account to use for the account-deletion check, and described there as disposable — deleting
  it leaves the rest of the workspace, including the primary credential, usable.
- **FR-003**: Both owner accounts MUST be of the self-registered kind, so that both show the
  full in-app deletion path rather than the removal-request path.
- **FR-004**: Requesting deletion of the nominated account MUST be accepted — not refused with
  a sole-owner precondition — on a workspace in the state the seed leaves it.
- **FR-005**: After the nominated account has been deleted, the workspace MUST still have at
  least one owner, and every other seeded credential MUST still sign in.
- **FR-006**: Re-running the seed MUST restore the nominated account after it has been
  deleted, so the demonstration can be repeated for a resubmission.
- **FR-007**: The admin-provisioned worker account and its in-app removal-request path MUST be
  unchanged by this feature, so the reviewer notes can continue to show both account-ending
  paths.
- **FR-008**: The reviewer notes MUST list all three credentials, state plainly what each one
  is for, and name exactly one of them as the account to delete.

#### A workspace that is not empty on the phone

- **FR-009**: The seed MUST create a handful of ordinary work items in the demo workspace,
  distributed across two workflow states, so that a work board shows movement rather than a
  single column.
- **FR-010**: Work items MUST be assigned such that **every** seeded sign-in credential has at
  least one item assigned to it, so My Work is populated whichever credential the reviewer
  uses.
- **FR-011**: At least one assigned work item MUST be late and at least one MUST be due on the
  current day, so that both the late section and the due-today section of Today are populated.
- **FR-012**: Work item titles and descriptions MUST read as plausible work for the demo
  business rather than placeholder text.

#### Recurring jobs

- **FR-013**: The seed MUST create one recurring-job definition with two instances: one that
  is **late**, and one that is **scheduled for the current day with nobody assigned to it**.
- **FR-014**: The late instance MUST be assigned to somebody other than an owner, so that an
  owner signed in on the phone sees it in the team section rather than only in their own list.
- **FR-015**: The late instance MUST be dated so that, after the background state-maintenance
  sweep next runs, it is still classified as late rather than written off as missed.
- **FR-016**: The unassigned instance MUST be dated and scheduled such that it is classified
  as neither late nor closed, since the "nobody is holding this" category excludes both.
- **FR-017**: The seeded recurring job MUST NOT cause the background generation sweep to
  create further instances that would bury the seeded two.
- **FR-018**: The seed MUST fail with a clear message, rather than silently producing a
  half-shaped workspace, if the project it is seeding into lacks a workflow state in a
  category the seeded content requires.

#### Re-running the seed

- **FR-019**: Running the seed a second time MUST leave exactly one copy of each seeded work
  item and each seeded recurring-job instance, in the same way the existing conversation and
  calendar content are refreshed rather than appended.
- **FR-020**: Every date the seed writes MUST be relative to the moment the seed runs, so a
  re-run before a resubmission produces content that reads as current.
- **FR-021**: The seed MUST continue to print every credential it created, primary first,
  with the account nominated for deletion clearly marked.

### Key Entities

- **Demo workspace**: the single organization a reviewer signs into. Identified by its
  workspace address; one per address, refreshed rather than duplicated on re-run.
- **Primary owner**: the self-registered account a reviewer is told to review the app with.
  Survives the deletion demonstration.
- **Spare owner**: a second self-registered owner account, existing so the primary owner is not
  a sole owner and so there is an account the reviewer can safely destroy. This is the account
  the notes nominate for the deletion check.
- **Demo worker**: the existing admin-provisioned account with a permanent PIN. Demonstrates
  the removal-request path. Unchanged.
- **Work item**: an ordinary task in the demo project, with a title, a state, an assignee and
  optionally a due date.
- **Recurring job definition**: the schedule a repeating operational job is generated from.
- **Recurring job instance**: one occurrence of that job on a date, which may be late, may be
  assigned to somebody, or may be held by nobody.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reviewer following the reviewer notes can complete an account deletion end to
  end — from opening the app to being signed out — without hitting a refusal, in under two
  minutes.
- **SC-002**: After that deletion, 100% of the remaining demo credentials still sign in and
  every other check described in the reviewer notes still works.
- **SC-003**: Signing into the mobile app with any demo credential, zero of the four tabs show
  a whole-screen empty state.
- **SC-004**: Signing in as an owner, Today shows at least one item in the late section, at
  least one in the due-today section, and at least one in the team section.
- **SC-005**: Running the seed twice in a row produces identical counts of workspaces, work
  items and recurring-job instances.
- **SC-006**: Preparing a workspace for a resubmission takes one command and under a minute,
  unchanged from today.
- **SC-007**: Zero store-review rejections citing 5.1.1(v) account deletion on the grounds that
  the demonstration could not be completed with the credentials provided.

## Assumptions

- [ASSUMPTION: The account nominated for deletion is a **second, spare owner**, not the
  primary credential. The alternative — telling the reviewer to delete the primary owner — also
  clears the sole-owner guard once a second owner exists, but destroys the credential the notes
  tell them to review the whole app with, so a reviewer who checks deletion first would then be
  locked out of every other check. A disposable spare is the reading a careful colleague would
  pick.]
- [ASSUMPTION: "A handful of tasks" is taken to mean six work items, enough that a board shows
  a distribution across two columns and each of the three credentials has work, and few enough
  that a reviewer can see all of them without scrolling far.]
- [ASSUMPTION: "Two states" is taken to mean one not-started state and one in-progress state
  from the demo project's ordinary workflow, because those are the two that read as "work is
  happening here". Seeding a done state as well was considered and rejected as beyond
  "two states".]
- [ASSUMPTION: The seeded content goes into the demo workspace's existing default project
  rather than a new one, because a reviewer opening the projects list should see the ordinary
  shape of a new workspace, not a fixture-specific project.]
- [ASSUMPTION: Both owners are given the same kind of credential — email and password — since
  self-registration is what makes the full deletion path visible, and a second sign-in method
  would add a step to the notes without adding anything a reviewer is asked to check.]
- [ASSUMPTION: The reviewer's device timezone may differ from the server's, which can move the
  "nobody is holding this" instance off the reviewer's current day by one. This is accepted
  rather than worked around by seeding a range of dates, because the late instance has no date
  bound and keeps Today populated regardless, and seeding several days of instances would make
  the workspace read as a backlog.]
- [ASSUMPTION: This feature changes only the demo fixture and the reviewer notes. No product
  behaviour changes — in particular the sole-owner deletion guard stays exactly as it is,
  because it is correct, and the fix is to shape the demo workspace so the guard is not the
  thing on show.]
- [ASSUMPTION: The existing guarantees of the seed — idempotency, the permanent worker PIN, the
  reportable message — are preserved, and the new content is held to the same standard.]

## Out of Scope

- Changing the sole-owner deletion guard, or adding any way to bypass it.
- Any change to how account deletion, removal requests, tasks or recurring jobs behave for
  real customers.
- Seeding files, documents, voice calls or additional channels.
- Localising the seeded content.
- Automating the seed's execution as part of a release pipeline.
