# Feature Specification: Evidence Review Queue

**Feature Branch**: `041-evidence-review-queue`

**Created**: 2026-09-03

**Status**: Draft

**Input**: User description: "Evidence review queue for managers. One 'needs your review' surface on web and mobile listing pending submissions across all rituals, with approve and reject inline. Approval is per task today and mobile cannot approve at all, so a manager on the floor cannot close the loop from the phone."

## Overview

Rituals produce evidence — a photo of a cleaned prep station, a signed checklist, a GPS check-in — and every piece of that evidence that is not auto-approved sits waiting for a human decision. Today the only way to make that decision is to already know which task to open: the reviewer navigates to a project, finds the ritual instance, opens the task, and reviews the submissions attached to it. There is no list of what is waiting, so a reviewer discovers pending work only through the notification they may have dismissed, and a submission nobody happens to open stays pending forever while the ritual instance it belongs to slides into `overdue` and then `missed`.

On mobile the loop cannot be closed at all: the app renders approval *status* on a task's evidence but offers no approve or reject action, so a manager standing on the floor with the work in front of them has to go find a laptop to say "yes, that's done".

This feature adds one queue — "Needs your review" — on web and mobile, listing every pending submission the viewer is entitled to decide on, across all rituals and projects, with approve and reject available inline without leaving the list. It also closes the authorization gap that the current per-task path leaves open.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A reviewer sees everything waiting on them in one place (Priority: P1)

A shift manager opens the review queue and sees every evidence submission across every ritual and project that is pending their decision, oldest first, each row carrying enough context to decide: which ritual, which task, who submitted it, when, and the evidence itself (the photo thumbnail, the note text, the link, the check-in location). No project hunting, no remembering which notification was about what.

**Why this priority**: Without the list there is no queue. Every other story in this feature operates on rows this story produces, and the discovery problem — "I don't know what's waiting on me" — is the larger half of the reported pain. A read-only queue with no inline actions still delivers value on its own: the reviewer can see the backlog and navigate to each task the existing way.

**Independent Test**: Seed three ritual instances in two projects with pending submissions, plus one already-approved and one auto-approved submission. Open the queue as the reviewer and verify exactly the three pending items appear, ordered oldest-submission-first, each showing ritual name, task identifier, submitter name, submission age, and a viewable rendering of the evidence.

**Acceptance Scenarios**:

1. **Given** a reviewer with pending submissions in three different projects, **When** they open the review queue, **Then** all pending submissions from all three projects appear in one list, ordered oldest first.
2. **Given** a submission that was auto-approved by geofence, **When** the reviewer opens the queue, **Then** that submission does not appear, because no decision is outstanding.
3. **Given** a submission already approved or rejected by anyone, **When** the reviewer opens the queue, **Then** it does not appear.
4. **Given** a reviewer with nothing waiting on them, **When** they open the queue, **Then** they see an explicit empty state confirming there is nothing to review, not a blank screen or an error.
5. **Given** a pending submission on a task in a project the viewer cannot access, **When** they open the queue, **Then** the submission is absent from the response entirely — not present-but-flagged — so no task title, ritual name or submitter identity leaks.
6. **Given** a photo submission, **When** the reviewer opens the queue, **Then** the photo is viewable from the row without navigating to the task, at a resolution sufficient to judge it.
7. **Given** more pending submissions than fit one page, **When** the reviewer scrolls to the end, **Then** the next page loads and no submission is duplicated or skipped across the page boundary.

---

### User Story 2 - A reviewer approves or rejects without leaving the queue (Priority: P1)

From a queue row the reviewer approves in one action, or rejects with a reason. The decided row leaves the queue immediately, the submitter is notified as they are today, and the ritual instance's state re-derives from the new evidence picture — so approving the last outstanding requirement moves the instance to `verified` without any further step.

**Why this priority**: This is the "close the loop" half of the request. A queue that lists work but sends the reviewer elsewhere to act on it re-introduces the navigation cost the feature exists to remove. Paired with Story 1 it forms the MVP.

**Independent Test**: With a pending submission in the queue, approve it inline; verify the row disappears, the submission's status is `approved` with the reviewer and timestamp recorded, the submitter receives the existing `evidence_approved` notification, and the ritual instance's state reflects the new evidence picture. Repeat for reject with a reason.

**Acceptance Scenarios**:

1. **Given** a pending submission in the queue, **When** the reviewer approves it, **Then** the row leaves the queue, the submission records the reviewer's identity and decision time, and the submitter is notified.
2. **Given** a pending submission in the queue, **When** the reviewer rejects it, **Then** they are required to supply a reason before the rejection is accepted, and that reason reaches the submitter with the rejection notification.
3. **Given** a ritual instance whose only outstanding requirement is this submission, **When** the reviewer approves it, **Then** the instance's state becomes `verified` without further action.
4. **Given** a ritual instance in `overdue`, **When** the reviewer rejects its submission, **Then** the instance's state re-derives from the new evidence picture using the same rules as the existing per-task path, and does not become terminal as a side effect of the review.
5. **Given** two reviewers with the same submission open, **When** both act on it, **Then** the first decision stands and the second reviewer is told the submission was already decided and by whom, rather than silently overwriting the first decision.
6. **Given** an approve or reject that fails (network loss, permission revoked mid-session), **When** the action returns, **Then** the row returns to the queue in its pending state with a message explaining the failure, and no partial decision is recorded.
7. **Given** the reviewer wants to add context to an approval, **When** they approve, **Then** they may optionally attach a comment, which is delivered with the approval.

---

### User Story 3 - The manager on the floor reviews from their phone (Priority: P1)

The same queue is a first-class mobile surface, purpose-built for a phone held one-handed on a shop floor: a full-screen list, large tap targets, the photo big enough to judge without pinching, and approve/reject as unambiguous primary actions rather than a menu buried behind a detail view.

**Why this priority**: The user's stated blocker is specifically that mobile cannot approve. Web-only delivery would leave the reported problem unsolved. It is separately testable — the mobile queue can be verified end-to-end on a device against the same backend as web.

**Independent Test**: On a 360–430 dp portrait device, open the review queue from the tasks area, approve one submission and reject another with a reason, and verify both decisions land on the server and both rows leave the list. Verify via a Maestro flow.

**Acceptance Scenarios**:

1. **Given** a manager signed in on a phone with pending submissions, **When** they open the review queue, **Then** they see the same set of items as they would on web, in the same order.
2. **Given** a photo submission on a phone, **When** the manager views the row, **Then** the photo is legible at the device's width and can be opened full-screen.
3. **Given** the manager rejects on mobile, **When** they are asked for a reason, **Then** the reason entry is reachable without the keyboard covering the confirm action.
4. **Given** the manager has no pending reviews, **When** they open the queue, **Then** the entry point communicates that plainly rather than presenting an empty list with no explanation.
5. **Given** a queue with pending items, **When** the manager looks at the tasks area entry point, **Then** the count of items awaiting their review is visible before they open the queue.

---

### User Story 4 - Only the right people can decide (Priority: P2)

A reviewer's queue contains only submissions on tasks in projects they can actually access, and the approve and reject actions refuse a submission outside that scope even if its identifier is known. The queue and the actions agree: nothing appears in the queue that the actions would refuse, and nothing the actions accept is hidden from the queue.

**Why this priority**: The current per-task approve and reject paths check only the org-wide `collab.reviewEvidence` permission and no project scoping, so any holder of that permission can decide any submission in the organization by identifier. Surfacing a cross-project queue makes that gap materially easier to exercise, so it is fixed as part of this feature rather than after it. It is P2 rather than P1 because the queue is useful before the scoping tightens, and the fix is independently testable.

**Independent Test**: As a reviewer who is not a member of a private project, call approve directly with a submission identifier from that project and verify it is refused; then confirm the same submission never appeared in that reviewer's queue.

**Acceptance Scenarios**:

1. **Given** a reviewer who cannot access the submission's project, **When** they attempt to approve or reject it by identifier, **Then** the attempt is refused and the submission's status is unchanged.
2. **Given** a reviewer whose only role on the project is `viewer`, **When** they open the queue, **Then** submissions from that project do not appear and decisions on them are refused.
3. **Given** a reviewer who is removed from a project while their queue is open, **When** they act on a row from that project, **Then** the action is refused and the row leaves the queue on refresh.
4. **Given** an employee without the evidence-review permission, **When** they open the queue, **Then** they see an empty queue rather than an error, and the entry point is not offered to them.

---

### User Story 5 - The queue reflects what is actually outstanding (Priority: P3)

The queue tells the reviewer not just what is pending but what is *urgent*: an item whose ritual instance is already overdue, or whose completion deadline is imminent, is marked as such and sorts ahead of the rest, so a reviewer working top-down clears the items that are actively costing compliance first.

**Why this priority**: A flat oldest-first list is correct and shippable. Urgency signalling makes the queue better but is not what unblocks the reported workflow, and it depends on Story 1 existing.

**Independent Test**: Seed pending submissions whose instances are respectively `verified`-blocked, `overdue`, and comfortably within deadline; verify the overdue one is marked and ordered first.

**Acceptance Scenarios**:

1. **Given** a pending submission on a ritual instance in `overdue`, **When** the reviewer opens the queue, **Then** that item is visually marked as overdue and appears above items whose instances are not late.
2. **Given** a pending submission on an instance that has since become `missed`, **When** the reviewer opens the queue, **Then** the item still appears — the evidence was submitted and still deserves a decision — and is marked as belonging to a missed instance.
3. **Given** a submission whose task has been deleted or detached from its ritual, **When** the reviewer opens the queue, **Then** the item does not appear.

---

### Edge Cases

- **A submission decided elsewhere while the queue is open.** The queue is a snapshot. A row acted on from the task detail page, or by another reviewer, must not silently succeed a second time — see Story 2 scenario 5. The second actor is told the item was already decided.
- **A submission whose ritual definition has been archived.** The instance and its evidence outlive the definition's archival (as reconciliation already assumes). Such submissions remain in the queue; archiving a definition is not a way to make outstanding review disappear.
- **A submission whose ritual definition or evidence requirement has been deleted.** The row degrades gracefully: it names the task and the evidence, and states that the requirement is no longer defined, rather than failing the whole page.
- **A task with no reviewer and no approver assigned.** Its submissions still need deciding. They appear for project owners and admins, mirroring the escalation the `ritual_instance_missed` notification already performs.
- **A very large backlog.** A reviewer returning from leave may face hundreds of items. The queue pages rather than attempting to render everything, and the count shown at the entry point is capped in presentation ("99+") rather than requiring an exact count of an unbounded set.
- **An evidence file that has gone missing.** The row still renders with its metadata and an explicit "evidence unavailable" indication; the reviewer can reject it on that basis. It is not silently omitted, because omission would let a broken upload quietly clear the queue.
- **A submitter reviewing their own submission.** Permitted only if they hold the review permission and project access; the queue does not special-case it, but the decision records who made it, so self-approval is visible in the audit trail rather than prevented invisibly.
- **Rejecting with an empty or whitespace-only reason.** Refused. A rejection with no reason gives the submitter nothing to act on, which is the exact failure the `evidence_rejected` notification exists to prevent.
- **Clock skew on submission timestamps.** Ordering uses the server's record of when the submission arrived, not the device's, so a phone with a wrong clock cannot jump or sink in the queue.

## Requirements *(mandatory)*

### Functional Requirements

#### The queue

- **FR-001**: The system MUST provide a single query returning every evidence submission awaiting review that the calling employee is entitled to decide, spanning all ritual definitions and all projects in the organization, without the caller naming a task or project.
- **FR-002**: The queue MUST include a submission if and only if its approval status is pending review, its task is a ritual instance that is not deleted and not detached from its ritual, and the caller is entitled to decide it per FR-010.
- **FR-003**: Each queue entry MUST carry enough context to decide without a further request: the ritual definition name, the task identifier and title, the project name, the evidence requirement's position and whether it is required, the evidence type, the submitting employee's display name, the server-recorded submission time, the ritual instance's current state category, and the instance's completion deadline where one exists.
- **FR-004**: Each queue entry MUST carry the evidence content appropriate to its type — a viewable reference for photo, voice memo, PDF and file; the text for a text note; the URL for a link; the coordinates and accuracy for a GPS check-in — such that a reviewer can judge the submission from the queue.
- **FR-005**: The queue MUST be paginated with a stable, non-duplicating page boundary, and MUST default to ordering oldest submission first by server-recorded submission time, with entries whose ritual instance is `overdue` or `missed` ordered ahead of the rest.
- **FR-006**: The system MUST provide the count of submissions awaiting the caller's review, obtainable without fetching the entries themselves, for display on an entry point badge.
- **FR-007**: The queue MUST omit entries the caller may not see rather than returning them in a redacted or flagged form, so the existence of inaccessible work is not disclosed.
- **FR-008**: The queue MUST render an explicit empty state distinguishable from a loading state and from a failure state.
- **FR-009**: An entry whose underlying evidence file is unretrievable MUST still be listed, marked as unavailable, and remain decidable.

#### Authorization

- **FR-010**: A caller is entitled to decide a submission when they hold the evidence-review permission **and** hold access to the submission's project other than `viewer`. Project access follows the existing project visibility and membership rules.
- **FR-011**: Approving and rejecting a submission MUST enforce FR-010 at the point of decision, refusing a submission outside the caller's scope even when its identifier is supplied directly. This closes an existing gap where these actions checked only the organization-wide permission.
- **FR-012**: A caller who lacks the evidence-review permission MUST receive an empty queue rather than an authorization failure, and clients MUST NOT present the queue entry point to them.

#### Deciding

- **FR-013**: A reviewer MUST be able to approve a submission from the queue without navigating to the task, optionally attaching a comment.
- **FR-014**: A reviewer MUST be able to reject a submission from the queue, and rejection MUST require a non-empty reason after trimming whitespace.
- **FR-015**: A decision MUST be refused if the submission is no longer pending review, and the refusal MUST identify that the submission was already decided. Refusal MUST NOT overwrite the existing decision.
- **FR-016**: A decision made from the queue MUST be indistinguishable in its effects from the same decision made from the task detail view: it records the same reviewer, timestamp and comment fields, publishes the same `evidence_approved` / `evidence_rejected` notification to the submitter, and re-derives the ritual instance's state through the same single writer. No parallel decision path may exist.
- **FR-017**: A decided entry MUST leave the caller's queue immediately on success, without requiring a manual refresh.
- **FR-018**: A failed decision MUST restore the entry to its pending presentation and surface the reason for failure; no partial state may be recorded.
- **FR-019**: The system MUST record which employee made each decision and when, so a self-approval or an unusual decision is traceable after the fact.

#### Client surfaces

- **FR-020**: The web application MUST provide the review queue as a dedicated surface reachable from the workspace navigation, with an unread-style count when items are waiting.
- **FR-021**: The mobile application MUST provide the review queue as a purpose-built full-screen surface reachable from the tasks area, with approve and reject as primary actions on each entry and a count visible at the entry point.
- **FR-022**: The mobile queue MUST render photo evidence legibly at 360–430 dp portrait width and allow opening it full-screen; the reject-reason entry MUST remain usable with the keyboard raised.
- **FR-023**: The mobile queue MUST NOT be a responsive copy of the web layout, per the mobile layout-independence rule.
- **FR-024**: Both clients MUST reflect a decision made on the other surface on the queue's next load, and MUST NOT present a stale entry as actionable after the server has refused it as already decided.
- **FR-025**: All interactive elements on the web queue MUST carry test identifiers, and all interactive elements on the mobile queue MUST carry `testID` props, per the existing testing rules.

### Key Entities

- **Review queue entry** — a projection, not a stored row: one pending evidence submission joined to the context a reviewer needs (its evidence requirement, its ritual instance task, that task's ritual definition, its project, and the submitting employee). It exists only in the read path; deciding an entry writes to the evidence submission it projects.
- **Evidence submission** — existing. The queue reads submissions whose approval status is pending review and writes the reviewer, decision time, comment and resulting status. No new columns are required by the queue itself.
- **Ritual instance task** — existing. Supplies the identifier, title, current state category and completion deadline shown on each entry, and is the thing whose state re-derives when a decision lands.
- **Reviewer scope** — the derived set of projects a given employee may decide submissions in: those where they hold non-`viewer` access, given the evidence-review permission. It governs both what the queue returns and what the decision actions accept.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reviewer can go from opening the application to having approved a pending submission in under 15 seconds and no more than three taps or clicks, on both web and mobile, without knowing in advance which ritual or project the submission belongs to.
- **SC-002**: A manager can complete the full review loop — see what is waiting, judge the evidence, approve or reject with a reason — entirely from a phone, with no step requiring a desktop browser.
- **SC-003**: The median time between an evidence submission arriving and a reviewer deciding it falls by at least 50% compared with the pre-feature baseline.
- **SC-004**: The proportion of ritual instances that reach `missed` while holding fully submitted, undecided evidence falls to under 2% of instances with submissions.
- **SC-005**: The queue's first page renders in under 2 seconds for a reviewer with 500 pending submissions across 50 projects, and the pending count at the entry point appears without waiting for the list.
- **SC-006**: 100% of attempts to decide a submission outside the caller's project scope are refused, verified by test.
- **SC-007**: 100% of decisions made from the queue produce the same submitter notification and the same resulting ritual instance state as the equivalent decision made from the task detail view, verified by test against both paths.
- **SC-008**: No reviewer can cause a second decision to overwrite a first: in a concurrent-decision test, exactly one decision is recorded and the loser is told why.
- **SC-009**: Nine out of ten reviewers in usability testing correctly identify what a queue entry is asking them to judge without opening the underlying task.

## Assumptions

- **[ASSUMPTION: "Manager" means an employee holding the existing `collab.reviewEvidence` permission with non-`viewer` project access, not a new role.** The description says "managers" without naming a role. The repository already has a permission that gates approval, and introducing a role would duplicate it. The queue therefore adds no new permission id and no new role.]
- **[ASSUMPTION: Scope is ritual evidence only.** The description says "pending submissions across all rituals". Standard tasks carry `approver` assignees but no evidence submissions, so there is nothing pending on them to queue. A general task-approval inbox is a different feature and is out of scope.]
- **[ASSUMPTION: The queue lists submissions, not tasks.** A ritual instance may carry several evidence requirements, each with its own pending submission, and they may be judged differently — one photo good, one note inadequate. Grouping to the task would force an all-or-nothing decision the underlying model does not have. Entries from the same task appear adjacent so a reviewer can still work task-by-task.]
- **[ASSUMPTION: Project scoping is added to approve and reject as part of this feature.** The current implementation checks only the org-wide permission, which is a real authorization gap that a cross-project queue makes easier to exercise. Shipping the queue on top of an unscoped decision path would be knowingly widening it. Per the project's stance that early-development breaking changes are acceptable, the existing actions are tightened in place rather than duplicated behind a new scoped variant.]
- **[ASSUMPTION: The queue is a read-only projection with no new stored state.** No `reviewed_at` marker table, no per-reviewer assignment of items, no claim/lock. The cursor is the submission's own approval status, following the same "the pass holds no state between runs" principle the reconciliation sweep already uses.]
- **[ASSUMPTION: Concurrency is handled by a compare-and-set on approval status, not by locking.** A decision writes only if the submission is still pending review, mirroring the compare-and-set the ritual state writer already uses. This is why FR-015 refuses rather than overwrites.]
- **[ASSUMPTION: A submission on a `missed` instance still appears in the queue.** `missed` is terminal for the instance's state machine, but the evidence was submitted in good faith and the submitter is waiting on an answer. Hiding it would leave a permanently pending row invisible. Deciding it does not resurrect the instance from `missed`.]
- **[ASSUMPTION: Auto-approved submissions never enter the queue.** They are recorded as approved at submission time by geofence evaluation, so no decision is outstanding.]
- **[ASSUMPTION: No new notification type is introduced.** The existing `evidence_submitted` notification already tells reviewers work has arrived; the queue is the durable surface that notification points at. Adding a digest would be a second, competing alert for the same event.]
- **[ASSUMPTION: Mobile inclusion is justified under the mobile feature-scope rule.** Judging a shift's evidence is day-to-day operational work performed where the work happens, not IAM or configuration administration, which is what the rule reserves for web. The rule's own test — "clearly part of an employee's day-to-day workflow" — is met for a supervising employee, and the user's stated blocker is precisely that this workflow cannot be completed on a phone.]
- **[ASSUMPTION: Bulk approval is out of scope for this feature.** "Approve all from this task" and "approve everything from this ritual today" are plausible follow-ons, but a bulk action that skims past individual evidence defeats the purpose of requiring evidence at all. Single-item decisions ship first; bulk is revisited once real queue depths are observed.]
- **[ASSUMPTION: Retention and history are unchanged.** Decided submissions leave the queue but are not deleted or archived; the existing per-task evidence history remains the record.]

## Out of Scope

- Bulk approve or bulk reject across multiple submissions.
- Reassigning or delegating a review to another employee.
- A review queue for standard (non-ritual) task approvers.
- Changing which employees are notified when evidence is submitted.
- Changes to auto-approval rules, geofencing, or evidence capture.
- Any change to how ritual instance state is derived; the queue calls the existing writer unchanged.
- Offline queueing of decisions made without connectivity.

## Dependencies

- The existing evidence submission model, its approval status values, and the `collab.reviewEvidence` permission.
- The existing single writer for ritual instance state, which the queue's decisions must route through rather than duplicate.
- The existing `evidence_approved` and `evidence_rejected` notifications and their delivery pipeline.
- Project visibility and membership rules, which define reviewer scope.
- The existing evidence file retrieval path used by the task detail view.
