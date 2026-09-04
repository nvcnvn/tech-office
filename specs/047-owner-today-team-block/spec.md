# Feature Specification: Team block on mobile Today

**Feature Branch**: `047-owner-today-team-block`

**Created**: 2026-09-05

**Status**: Draft

**Input**: User description: "Owner's Today on mobile shows the team, not just self. For anyone with review permission, add a team block listing rituals overdue or unassigned today across the workspace. The Today tab only reads the caller's own assigned work, so the owner's phone answers 'what do I owe' but not 'is the store OK'."

## Overview

The mobile **Today** tab is the one screen a person opens first in the morning. It currently
merges three answers — overdue work assigned to me, my events today, work due today — and
every one of them is scoped to the person holding the phone. That is the right screen for a
worker and the wrong screen for whoever runs the place. An owner opens Today, sees "Nothing
due today", and closes the app believing the store is fine while a closing checklist from
last night sits overdue and this morning's opening ritual has nobody rostered on it.

This feature adds one **team block** to Today, visible only to people who supervise work,
listing the ritual instances that are overdue or have nobody assigned today across every
project they supervise. It answers "is the store OK" in the same glance that already answers
"what do I owe".

The block is a read-only summary, not a second task list. It is deliberately bounded, it
never becomes a management console, and it disappears entirely for people who supervise
nothing.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The owner sees what the team is late on (Priority: P1)

An owner or store manager opens Today on their phone. Below their own late work, a **Team**
block lists every ritual instance across the projects they supervise that is past its
deadline and still open, showing what it is, which project it belongs to, and who is
responsible for it. Tapping a row opens that instance, from where they can chase, reassign,
or review it using the surfaces that already exist.

**Why this priority**: This is the whole point of the feature. Without it the owner's phone
cannot report a problem that is already known to the system. Overdue instances are the
larger and more common failure — every ritual that nobody did lands here regardless of how
it was assigned. Shipped alone, this is a viable MVP: it changes Today from a personal
worklist into a supervisory one.

**Independent Test**: Sign in as a project owner with a ritual instance recorded as overdue
in a project they supervise but assigned to somebody else, open Today, and confirm the Team
block lists it with the assignee's name and that tapping it opens the instance. Confirm a
second account that supervises nothing sees no Team block at all.

**Acceptance Scenarios**:

1. **Given** I supervise a project containing a ritual instance recorded as overdue and
   assigned to another employee, **When** I open Today, **Then** a Team block appears listing
   that instance with its title, its project, and the assignee's name.
2. **Given** the Team block is showing an overdue instance, **When** I tap the row, **Then**
   the ritual instance opens and the back path returns me to Today.
3. **Given** I supervise no project, **When** I open Today, **Then** no Team block, heading,
   placeholder or empty row is rendered and the screen is unchanged from today's behaviour.
4. **Given** an overdue instance is assigned to me, **When** I open Today, **Then** it appears
   in my own "Running late" section and **not** a second time in the Team block.
5. **Given** a ritual instance has reached a terminal, closed state, **When** I open Today,
   **Then** it is not listed in the Team block.

---

### User Story 2 - The owner sees what nobody is on today (Priority: P1)

The same block lists ritual instances scheduled for today that have nobody assigned — either
because a shift-based rota never resolved to a person, or because the instance was created
with no assignee at all. Each is labelled **Unassigned** rather than showing an empty name.

**Why this priority**: An unassigned instance is the failure the owner is least likely to
find any other way. A late instance has somebody to chase; an unassigned one has nobody, so
it produces no personal notification for anybody and is invisible on every existing personal
surface until it turns overdue hours later. Catching it in the morning is the difference
between a five-minute fix and a missed shift. It is P1 alongside story 1 because "is the
store OK" is not answered by lateness alone, but it is listed second because it depends on
the same block, feed and permission scope that story 1 establishes.

**Independent Test**: Create a ritual instance scheduled for today in a supervised project
with no assignee, open Today as the supervisor, and confirm it is listed under the Team block
labelled Unassigned. Resolve the assignment and confirm it leaves the block on refresh.

**Acceptance Scenarios**:

1. **Given** a ritual instance scheduled for today in a project I supervise has nobody
   assigned, **When** I open Today, **Then** the Team block lists it labelled "Unassigned".
2. **Given** a shift-based instance is still waiting for a rota to name somebody, **When** I
   open Today, **Then** it is listed as unassigned rather than shown with a blank assignee.
3. **Given** an unassigned instance is given an assignee, **When** I pull to refresh Today,
   **Then** it leaves the unassigned list.
4. **Given** an instance scheduled for a future date has nobody assigned, **When** I open
   Today, **Then** it is not listed — the block reports today, not the backlog of the month.

---

### User Story 3 - The owner gets an explicit all-clear (Priority: P2)

When a supervisor has nothing overdue and nothing unassigned, the Team block still renders,
saying so — an explicit "All clear" naming how many projects were checked, rather than the
block silently vanishing.

**Why this priority**: A missing block and a healthy team look identical, and the whole
complaint being fixed is that a silent screen was read as good news. An affirmative all-clear
is what makes the owner trust the block on the mornings it *is* empty. It is P2 because the
block delivers its value without it, but the feature is not honest without it.

**Independent Test**: Sign in as a supervisor of a project whose rituals are all current and
assigned, open Today, and confirm the Team block renders an explicit all-clear rather than
disappearing. Confirm a non-supervisor still sees nothing.

**Acceptance Scenarios**:

1. **Given** I supervise projects and none of their ritual instances are overdue or
   unassigned today, **When** I open Today, **Then** the Team block renders an all-clear
   message naming how many projects it covered.
2. **Given** I supervise nothing, **When** I open Today, **Then** no all-clear is shown —
   absence of scope and absence of problems are visibly different outcomes.
3. **Given** every one of my own sections is also empty, **When** I open Today, **Then** the
   existing "Nothing due today" empty state still describes only my own work and does not
   contradict the Team block.

---

### User Story 4 - The list stays readable when the backlog is large (Priority: P3)

The block shows a short list by default with the true totals beside each category, and offers
to expand in place up to a fixed ceiling. Beyond that ceiling the counts say so rather than
the screen turning into an endless scroll.

**Why this priority**: A store with a bad week can have dozens of overdue instances. Showing
five with no total misrepresents the problem; showing all of them buries the rest of Today.
It is P3 because a correct count with a short list is already useful on day one, and
expansion is a refinement.

**Independent Test**: Seed more overdue instances than the default display limit in a
supervised project, open Today, and confirm the count reflects the true total, the list shows
the default number, and expanding shows up to the ceiling without the request slowing
noticeably.

**Acceptance Scenarios**:

1. **Given** more overdue instances exist than are displayed by default, **When** I open
   Today, **Then** the category shows the true total and offers to show more.
2. **Given** I expand the list, **When** the additional items load, **Then** no more than the
   ceiling number of items is rendered and the total remains visible.
3. **Given** the number of matching instances exceeds what the count can report exactly,
   **When** I open Today, **Then** the count is shown as a capped figure rather than an exact
   one, and the block still loads at the same speed.

---

### Edge Cases

- **Caller supervises nothing**: the block, its heading and its request are all absent. Not
  an error, not an empty card — the screen is byte-for-byte what a worker sees today.
- **Caller supervises a project but is only a viewer on another**: instances from the viewer
  project never appear. Scope is per project, not per person.
- **The team feed fails while the personal feeds succeed**: the caller's own day still renders
  in full and the Team block shows an inline, retryable error confined to itself. A
  supervisory extra must never be able to blank out the screen a worker depends on.
- **An instance has several assignees**: one name is shown with a "+N" indicator rather than a
  wrapped list of names.
- **The assignee has left the organisation or their record is archived**: the row still lists
  the instance, using whatever name is on record; a departed assignee is exactly the situation
  the owner needs to see, so the row must not be dropped for want of a live employee.
- **An instance is soft-deleted, its project archived, or it has been detached from its
  ritual**: it is excluded.
- **Day boundary**: "today" and "unassigned today" are evaluated against the date the device
  reports, so a supervisor travelling across a timezone sees their local day, matching how the
  caller's own due-today section already behaves.
- **The same instance is both overdue and unassigned**: it is listed once, under overdue,
  because lateness is the more urgent fact and duplication would inflate both counts.
- **A supervisor is also the assignee of an overdue instance**: it appears once, in their own
  "Running late" section.
- **Rapid state change between load and tap**: tapping an instance that has since been
  completed opens it normally and shows its current state; the block corrects itself on the
  next refresh rather than blocking the tap.

## Requirements *(mandatory)*

### Functional Requirements

**Visibility and scope**

- **FR-001**: The mobile Today screen MUST render a Team block for any caller who both holds
  the evidence-review permission and supervises at least one project, and MUST render nothing
  at all — no heading, no card, no placeholder — for every other caller.
- **FR-002**: A caller who lacks the permission or supervises nothing MUST receive an empty
  result rather than an authorization failure, so that "you do not supervise anything" is
  never surfaced to a worker as an error.
- **FR-003**: The block MUST cover every project in the caller's supervisory scope in a single
  request, without the caller choosing a project and without the client issuing one request
  per project.
- **FR-004**: Instances from projects outside the caller's supervisory scope MUST be omitted
  from both the listed items and the counts. A count the caller cannot substantiate by opening
  the rows is worse than no count.
- **FR-005**: All results MUST be confined to the caller's organization.

**What is listed**

- **FR-006**: The block MUST list ritual instances in two categories: **overdue** — still open
  and past their deadline — and **unassigned** — scheduled for the caller's current date with
  nobody holding the assignee role.
- **FR-007**: Whether an instance is overdue MUST be taken from the state the system has
  already recorded for it, not from a date comparison performed for this block, so the Team
  block can never disagree with the ritual surfaces, the notifications or the context rail
  about which instances are late.
- **FR-008**: Instances in a closed or terminal state MUST be excluded from both categories
  and both counts.
- **FR-009**: Instances assigned to the caller MUST be excluded from the Team block, because
  the caller's own "Running late" and "Due today" sections already list them on the same
  screen.
- **FR-010**: An instance that satisfies both categories MUST be listed and counted once,
  under overdue.
- **FR-011**: Each listed row MUST identify the ritual instance's title, the project it
  belongs to, and its responsibility: the assignee's human-readable name for overdue rows, or
  an explicit "Unassigned" label for unassigned rows. A row MUST NOT display an identifier
  fragment in place of a person's name.
- **FR-012**: Rows MUST be ordered with overdue before unassigned, and within overdue by how
  long they have been late, longest first.

**Size and cost**

- **FR-013**: The block MUST report the true total for each category alongside a shortened
  list, and MUST allow expanding the list in place up to a fixed ceiling.
- **FR-014**: The counts MUST be bounded server-side, so that a workspace with a very large
  backlog costs no more to summarise than a healthy one, and MUST indicate when a count has
  been capped rather than presenting a capped figure as exact.
- **FR-015**: The block MUST be filled by a single additional fetch that begins at the same
  moment as the screen's existing fetches, so a supervisor's Today is never slower than a
  worker's by more than the slowest single feed.

**Behaviour on the screen**

- **FR-016**: When the caller supervises at least one project and both categories are empty,
  the block MUST render an explicit all-clear that states how many projects were covered.
- **FR-017**: The block MUST refresh with the rest of Today — on pull-to-refresh, on the
  screen's existing recovery path after a dropped connection, and on returning to the tab —
  without a separate gesture.
- **FR-018**: A failure of the team feed MUST NOT prevent the caller's own overdue work,
  events and due-today work from rendering; the block MUST show its own retryable error in
  place.
- **FR-019**: Tapping a row MUST open the ritual instance, and returning MUST land back on
  Today with scroll position preserved.
- **FR-020**: The caller's existing empty state for a day with nothing of their own MUST
  continue to describe only their own work, so it cannot be read as asserting that the team is
  clear.

**Platform quality**

- **FR-021**: Every interactive element in the block MUST carry a screen-reader label and meet
  the project's minimum touch-target size, and the block MUST lay out correctly on a narrow
  Android device and on the smallest supported iPhone without truncating the responsibility
  label or the counts.
- **FR-022**: The block MUST render a loading state consistent with the rest of Today rather
  than causing the screen to shift once the team data arrives.

### Key Entities

- **Team attention summary**: what one supervisor's Today block needs in one answer — whether
  the caller supervises anything at all, how many projects were covered, the overdue count,
  the unassigned count, whether either count was capped, and the shortened item lists.
- **Team attention item**: one ritual instance needing attention — its title, its project, the
  date it was due or scheduled, its category (overdue or unassigned), the responsible person's
  display name where one exists together with a count of any additional assignees, and enough
  identity to open the instance.
- **Supervisory scope**: the set of projects a caller's Team block covers, derived from the
  caller's project membership. Not a new stored object and not a new permission.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A supervisor can determine whether any ritual is overdue or unassigned across
  every project they supervise within 10 seconds of opening the app, without navigating away
  from the first screen and without selecting a project.
- **SC-002**: 100% of ritual instances that the system has recorded as overdue and open in a
  supervised project, and that are not assigned to the caller, appear in the caller's Team
  block; no instance from a project outside that scope ever appears.
- **SC-003**: The Team block and the caller's own late-work section never disagree about
  whether a given instance is late, and never show the same instance twice on one screen.
- **SC-004**: Today's first meaningful render is no slower than it is today for a caller with
  no supervisory scope, and no more than 20% slower for a supervisor with a backlog of 500
  overdue instances.
- **SC-005**: A workspace with 5,000 matching instances produces the block in the same time as
  one with 50, within measurement noise.
- **SC-006**: A failure of the team feed leaves 100% of the caller's own Today content
  rendered and readable.
- **SC-007**: An owner opening Today on a morning with an unassigned opening ritual identifies
  it before the ritual's deadline in a walkthrough test, where the current screen surfaces it
  only after it has already turned overdue.
- **SC-008**: Callers with no supervisory scope see a screen indistinguishable from the
  current one, verified by an automated check that no team heading, card or request occurs.

## Assumptions

- **[ASSUMPTION: "review permission" is interpreted as the existing evidence-review permission
  *combined with* owner/admin project membership, rather than the permission alone.]** The
  evidence-review permission is granted to all three default roles including plain employees,
  so gating on it alone would show every worker the entire team's late work — the noise that
  gets an alert muted, and the opposite of the "owner's phone" framing in the request. Project
  owner/admin membership is already the escalation audience the system uses for unassigned
  instances and for missed instances with no reviewer, so the block shows a supervisor exactly
  the class of problem they are already being paged about. The combination honours the literal
  request (the permission is checked) while producing the intended audience.
- **[ASSUMPTION: no new permission and no new role are introduced.]** A `collab.superviseTeam`
  permission would need a migration, a back-fill across every existing organization and a
  place in the role editor, to express something two existing signals already express
  together. Reusing the existing signals keeps the change to a read path.
- **[ASSUMPTION: the block is mobile-only in this feature.]** The request is explicitly about
  the owner's phone, and the web app already answers the supervisory question through the
  Reviews tab, the project Health tab and the context rail. The underlying feed is
  platform-neutral, so a web surface can be added later without redesigning it.
- **[ASSUMPTION: the block is placed immediately after the caller's own "Running late" section
  and before "Today's schedule".]** Both sections say "something is wrong" and belong together
  at the top; the caller's own lateness stays first because Today's stated purpose is still
  "what do I need to do right now", and chasing the team while personally late is the wrong
  reading order.
- **[ASSUMPTION: "unassigned" means no assignee of any kind, covering both a shift rota that
  has not resolved and an instance created with no assignee.]** From the supervisor's seat the
  two are the same problem — nobody is on it — and distinguishing them in the summary would
  add a column that changes no decision. The instance detail already explains which case it is.
- **[ASSUMPTION: "missed" and other terminal instances are excluded.]** They are closed, they
  already escalate by notification, and a supervisory block listing work nobody can act on
  turns into a graveyard that gets ignored. Every other read surface in the system already
  filters closed states out, and diverging here would create exactly the disagreement FR-007
  exists to prevent.
- **[ASSUMPTION: overdue is not limited to today.]** An instance that went overdue three days
  ago is still the store's problem this morning. Only the *unassigned* category is scoped to
  the current date, because an unassigned instance for next Tuesday is not yet a failure.
- **[ASSUMPTION: default list length is 5 per category with a ceiling of 20 when expanded, and
  counts are capped at 100.]** These match the limits already used by the assigned-work summary
  and the evidence review queue count, so the block behaves like its neighbours and needs no
  new tuning story.
- **[ASSUMPTION: the day boundary comes from the device date.]** The caller's own due-today
  section already works this way, and a supervisor comparing the two sections on one screen
  must not see them disagree about what "today" means.
- **[ASSUMPTION: no assignment or bulk action is offered from the block.]** Tapping through to
  the instance reaches the existing assignment and review controls. Adding actions here would
  make the block the second task list the context rail was explicitly designed not to become;
  if supervisors ask for it after using this, it is a separate change.
- **[ASSUMPTION: standard tasks are out of scope — the block covers ritual instances only.]**
  The request names rituals, rituals are the operational heartbeat the "is the store OK"
  question is about, and every project's ad-hoc task backlog would swamp the signal.
- The existing ritual reconciliation sweep continues to be the authority on which instances are
  overdue; this feature reads that state and never computes lateness of its own.
- Employee display names are already available on the read path used for the evidence review
  queue, so no new source of names is required.
