# Feature Specification: Ritual Submission Flow

**Feature Branch**: `028-ritual-submission-flow`  
**Created**: 2026-04-20  
**Status**: Draft  
**Input**: User description: "Design the frontend ritual submission flow for project owners and employees, including when and where evidence submissions and review surfaces should appear on both mobile app and web."

## Clarifications

### Session 2026-04-20

- Q: Where should review-related ritual notifications land? → A: Open the specific ritual instance and highlight the pending submission or rejected requirement.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Submit Ritual Evidence From an Active Task (Priority: P1)

An assigned employee opens a ritual instance that is due today, understands what proof is required, and submits the required evidence without needing to navigate through project settings or template management screens.

**Why this priority**: The feature fails if workers cannot complete ritual work quickly and confidently from the actual task they are responsible for.

**Independent Test**: Can be fully tested by assigning a ritual instance to an employee, opening the instance on web and mobile, and confirming the employee can identify missing proof, submit evidence for each requirement, and see updated submission status on the same instance.

**Acceptance Scenarios**:

1. **Given** an employee is assigned to an open ritual instance with required evidence, **When** the employee opens that instance, **Then** the task detail shows the checklist of required proof and the current status of each requirement.
2. **Given** an employee is viewing a required evidence item that is missing or rejected, **When** the employee chooses to submit proof, **Then** the system starts a submission flow for that specific requirement and returns the employee to the same ritual instance with refreshed status.
3. **Given** an employee opens a ritual definition rather than a specific ritual instance, **When** the employee looks for submission controls, **Then** the system does not present live submission actions there and instead directs the employee to a specific assigned instance.

---

### User Story 2 - Review Submitted Evidence as a Project Owner or Reviewer (Priority: P2)

A project owner or authorized reviewer sees submitted ritual evidence in the context of the ritual instance and in a review-oriented surface so they can quickly approve or reject submissions without searching through unrelated task content.

**Why this priority**: Submission alone is insufficient for compliance workflows that require review, approval, rejection, and follow-up action.

**Independent Test**: Can be fully tested by submitting ritual evidence for one or more instances, signing in as a reviewer, and confirming pending submissions are visible, reviewable, and clearly separated from template editing.

**Acceptance Scenarios**:

1. **Given** a ritual instance has evidence waiting for review, **When** an authorized reviewer opens that instance, **Then** the reviewer can see the submitted evidence, its current review state, and the available approval or rejection actions.
2. **Given** a reviewer has multiple pending ritual submissions across a project, **When** the reviewer opens the review-oriented surface, **Then** the reviewer can identify which instances need attention without opening every task one by one.
3. **Given** a reviewer rejects a submission, **When** the employee revisits the ritual instance, **Then** the rejected item is clearly marked for resubmission and the reviewer comment is visible.

---

### User Story 3 - Distinguish Template Management From Instance Work (Priority: P3)

A project owner can manage evidence requirements and ritual instructions at the ritual definition level without confusing those template settings with the live work and evidence attached to individual ritual runs.

**Why this priority**: Mixing template editing with live submissions creates role confusion, accidental changes, and a poor audit experience.

**Independent Test**: Can be fully tested by editing a ritual definition, then opening existing ritual instances to confirm template changes and live submissions appear in distinct places with distinct actions.

**Acceptance Scenarios**:

1. **Given** a project owner is editing a ritual definition, **When** the owner views evidence requirements, **Then** the owner can manage requirement rules and instructions but cannot alter already submitted instance evidence from that screen.
2. **Given** a project owner is also assigned to a ritual instance, **When** the owner opens that instance as a worker, **Then** the owner still sees the same submission actions available to any assigned employee.
3. **Given** a ritual instance was detached from its normal schedule or previously skipped, **When** a user opens the instance, **Then** the instance-specific context is shown without implying that template settings can retroactively change that completed or exceptional run.

---

### User Story 4 - Reach the Right Ritual Surface From Daily Worklists and Notifications (Priority: P3)

An employee or reviewer reaches the correct ritual instance or review queue from daily work views and notifications without needing to infer whether they should open a project page, a template page, or a task page.

**Why this priority**: Discoverability determines whether the workflow is used consistently, especially for mobile-first and low-tech workers.

**Independent Test**: Can be fully tested by entering from a today view and from a ritual-related notification and confirming each path lands on the correct task or review surface.

**Acceptance Scenarios**:

1. **Given** an employee sees a ritual item in a daily worklist, **When** the employee selects it, **Then** the destination is the ritual instance detail, not the ritual definition editor.
2. **Given** a reviewer receives a pending-review notification, **When** the reviewer opens it, **Then** the destination is the relevant ritual instance with the pending submission highlighted for immediate review.

### Edge Cases

- An employee opens a ritual definition from a settings area without an active assigned instance and expects to submit evidence.
- A ritual instance has some requirements approved, some still missing, and at least one rejected submission.
- A reviewer and submitter are the same person because the project owner is also assigned to that ritual instance.
- A notification links to a ritual instance that has already been completed, skipped, or detached from the template schedule.
- A required submission type is not practical on one surface, such as mobile capture-heavy evidence on web or a large review backlog on mobile.
- A ritual instance has no evidence requirements configured and should not mislead users into looking for missing submission controls.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST present ritual evidence submission actions only in the context of a specific ritual instance, not in ritual definition management screens.
- **FR-002**: The system MUST show the current evidence requirement checklist, submission state, and outstanding items whenever a user opens a ritual instance.
- **FR-003**: The system MUST let an assigned employee submit or resubmit evidence for each eligible requirement directly from the ritual instance workflow.
- **FR-004**: The system MUST keep the employee submission flow focused on the specific requirement being fulfilled and return the employee to the same ritual instance after completion.
- **FR-005**: The system MUST show reviewer actions only to users authorized to review ritual evidence.
- **FR-006**: The system MUST provide a reviewer-oriented surface that helps authorized users identify pending submissions across ritual instances without relying solely on per-task navigation.
- **FR-007**: The system MUST show reviewer outcomes, including rejection reasons, on the ritual instance so employees understand what must be resubmitted.
- **FR-008**: The system MUST distinguish between template-level evidence requirement management and instance-level evidence submission history through separate screens or clearly separated sections.
- **FR-009**: The system MUST allow a user who holds both worker and manager capabilities to access the relevant submission and review actions without hiding one role because of the other.
- **FR-010**: The system MUST route entry points from daily worklists to ritual instance details rather than to ritual definition management.
- **FR-011**: The system MUST route review-related notifications to the relevant ritual instance and highlight the pending submission or rejected requirement that needs action.
- **FR-012**: The system MUST show summary status on list, board, today, and notification surfaces without requiring the full submission form to appear there.
- **FR-013**: The system MUST support web and mobile journeys that are consistent in intent while allowing each platform to use different interaction patterns suited to its form factor.
- **FR-014**: The system MUST favor fast capture-oriented actions for workers on mobile and review-oriented visibility for managers on web when both platforms serve the same underlying ritual workflow.
- **FR-015**: The system MUST preserve visibility of exceptional instance states, such as skipped or detached runs, so users do not confuse them with editable ritual templates.

### Assumptions

- Ritual evidence requirements are defined at the ritual template level, while evidence submissions belong to a specific ritual instance.
- Daily worker entry points are task-first, not settings-first.
- Review-related notifications are task-instance-first, not backlog-first.
- Bulk or backlog review is more important on web than on mobile, while fast evidence capture is more important on mobile than on web.
- Approved submissions are treated as historical records rather than mutable draft content.

### Key Entities *(include if feature involves data)*

- **Ritual Definition**: The reusable ritual template that contains instructions, evidence requirement rules, assignment logic, and recurrence settings.
- **Ritual Instance**: A scheduled run of a ritual assigned to one or more employees, with its own state, deadline, and task-level context.
- **Evidence Requirement**: A specific proof expectation attached to the ritual definition, such as a photo, note, file, link, or location-based check.
- **Evidence Submission**: The proof submitted for one evidence requirement on one ritual instance, including current review status and reviewer feedback.
- **Review Queue**: A filtered view of ritual submissions awaiting action by authorized reviewers.
- **Entry Surface**: Any upstream place that links into the ritual flow, such as a today view, board card, task list, or notification.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In usability validation, at least 90% of assigned employees reach the correct ritual instance submission surface on their first attempt from a daily worklist.
- **SC-002**: In usability validation, at least 90% of employees can identify what proof is still missing for a ritual instance within 10 seconds of opening the task.
- **SC-003**: In usability validation, at least 85% of employees can complete a single ritual evidence submission without entering a template management screen.
- **SC-004**: In usability validation, at least 90% of reviewers can identify pending ritual submissions that need action within 30 seconds of opening the review-oriented surface.
- **SC-005**: In usability validation, at least 90% of users correctly distinguish between editing a ritual template and acting on a live ritual instance.
- **SC-006**: Support requests or reported confusion about where to submit ritual evidence or where to review it decrease measurably during the first release cycle after rollout.
