# Feature Specification: Ritual Tasks — Lazy Resource Creation & Schedule Change Handling

**Feature Branch**: `023-ritual-tasks-improvement-lazy-resource`  
**Created**: 2026-03-13  
**Status**: Draft  
**Input**: User description: "Ritual tasks improvement: lazy resource creation for instances and clean-slate-forward schedule change handling"

## Execution Flow (main)
```
1. Parse user description from Input
   → If empty: ERROR "No feature description provided"
2. Extract key concepts from description
   → Identify: actors, actions, data, constraints
3. For each unclear aspect:
   → Mark with [NEEDS CLARIFICATION: specific question]
4. Fill User Scenarios & Testing section
   → If no clear user flow: ERROR "Cannot determine user scenarios"
5. Generate Functional Requirements
   → Each requirement must be testable
   → Mark ambiguous requirements
6. Identify Key Entities (if data involved)
7. Run Review Checklist
   → If any [NEEDS CLARIFICATION]: WARN "Spec has uncertainties"
   → If implementation details found: ERROR "Remove tech details"
8. Return: SUCCESS (spec ready for planning)
```

---

## Clarifications

### Session 2026-03-13

- Q: Whose "today" determines whether an instance is historical (protected) vs. future (eligible for cleanup)? → A: The ritual definition's configured `timezone` determines "today".
- Q: Should detached tasks be visible to the worker with any special indicator? → A: Yes — add a `detached_from_ritual` flag so the UI can show a subtle "was part of ritual X" label.
- Q: Who should be permitted to modify a ritual definition's recurrence pattern? → A: The ritual definition creator OR any project admin.
- Q: Should the detached task's deadline still be enforced (trigger overdue transitions), or become advisory-only? → A: Advisory-only — the deadline is displayed but no automatic state transitions occur.
- Q: Should soft-deleted ritual instances be purged after a retention period, or kept indefinitely? → A: Keep indefinitely — soft-deleted rows stay forever (simplest, no data loss risk).

---

## User Scenarios & Testing

### Primary User Story

A team lead creates a daily ritual definition (e.g., "Morning Site Checkin") which generates 30 projected instances. Days later, the lead opens one of the instances, notices the schedule needs adjustment, and edits the recurrence pattern directly from the instance detail view — just like editing a recurring calendar entry. The system shows an impact preview before applying, cleanly removes unstarted future instances, preserves any in-progress work, and regenerates instances using the new pattern — without wasting resources on chat channels and documents that were never used.

### Acceptance Scenarios

#### Lazy Resource Creation

1. **Given** a ritual definition exists and instances are generated, **When** an instance is created, **Then** no chat channel or description document is created for that instance.

2. **Given** a ritual instance has no chat channel, **When** a user opens the task detail view, **Then** the system creates the chat channel and description document on demand and persists them on the task.

3. **Given** a ritual instance has no chat channel, **When** a user posts a comment on the task, **Then** the system creates the chat channel first, then sends the comment.

4. **Given** a standard (non-ritual) task is created, **When** the task is saved, **Then** the chat channel and description document are created eagerly as before (no behavior change).

#### Schedule Change — Untouched Instances

5. **Given** a daily ritual definition with 25 future instances in "scheduled" state (no channel, no evidence, no comments), **When** the lead changes the schedule to weekly, **Then** all 25 future untouched instances are soft-deleted and new weekly instances are generated.

6. **Given** future instances were soft-deleted due to a schedule change, **When** the system generates new instances for the same dates, **Then** no unique constraint violation occurs (the unique index excludes soft-deleted rows).

#### Schedule Change — Touched Instances

7. **Given** a future ritual instance has been moved to "in_progress" state or has evidence submitted, **When** the lead changes the schedule, **Then** that instance is detached: `ritual_definition_id` set to NULL, `task_kind` changed to `'standard'`, a `detached_from_ritual` flag is set to true, and the task remains accessible as a standalone task with a subtle origin label.

8. **Given** a future ritual instance has a chat channel created (someone opened it), **When** the schedule changes, **Then** that instance is detached as a standalone task, preserving the channel and any comments.

#### Schedule Change — Historical Instances

9. **Given** ritual instances exist for past dates (verified, missed, skipped), **When** the lead changes the schedule, **Then** those past instances are never modified — their state, resources, and link to the ritual definition remain intact.

#### Confirmation UX

10. **Given** the lead initiates a schedule change, **When** the system calculates impact, **Then** a confirmation dialog shows: count of instances to be removed, count of instances to be detached as standalone tasks, and count of new instances to be generated.

11. **Given** the lead sees the confirmation dialog, **When** they click "Cancel", **Then** no changes are made.

#### Inline Definition Editing from Instance View

12. **Given** an authorized user (creator or project admin) views a ritual instance's detail, **When** they interact with the ritual definition section, **Then** the recurrence pattern fields become editable inline — without navigating away from the instance.

13. **Given** an authorized user edits the recurrence pattern inline and saves, **When** the save is triggered, **Then** the system presents the same impact confirmation dialog as any other schedule change (FR-013, FR-014) before applying.

14. **Given** a worker (non-admin, non-creator) views a ritual instance's detail, **When** they view the ritual definition section, **Then** the recurrence pattern fields are displayed as read-only — no edit controls are shown.

### Edge Cases

- **Rapid schedule changes** (daily → weekly → bi-weekly): Each change applies the same "Clean Slate Forward" logic. Previously regenerated untouched instances get soft-deleted again, touched ones detach. Idempotent by design.

- **Today's instance is in "scheduled" state**: Not affected — the cutoff is strictly "after today." The user can still complete today's task.

- **New pattern overlaps with dates that have detached instances**: New instances are created for those dates. Detached tasks (now standard) don't conflict because they no longer have a ritual definition link.

- **Ritual definition is archived (paused)**: All future untouched instances are soft-deleted, touched instances are detached. The definition is marked archived. No new instances are generated.

- **Concurrent access to EnsureTaskResources**: Two users opening the same task simultaneously must not create duplicate channels. The operation must be idempotent — the second call sees the channel already exists and skips creation.

- **Non-admin worker opens instance detail**: The ritual definition section is visible (name, recurrence pattern, assignees) but entirely read-only. No edit affordances are rendered.

- **User wants schedule change effective at a future date**: System supports an optional "effective date" parameter, defaulting to tomorrow.

---

## Requirements

### Functional Requirements

#### Lazy Resource Creation

- **FR-001**: System MUST NOT create a chat channel when generating a ritual instance task.
- **FR-002**: System MUST NOT create a description document when generating a ritual instance task.
- **FR-003**: System MUST create (or ensure existence of) the chat channel and description document when a user first accesses a ritual instance's detail view.
- **FR-004**: System MUST create (or ensure existence of) the chat channel before accepting a comment on a ritual instance that lacks one.
- **FR-005**: Lazy resource creation MUST be idempotent — concurrent requests for the same task produce exactly one channel and one document.
- **FR-006**: Standard tasks (`task_kind = 'standard'`) MUST continue to create channels and documents eagerly at task creation time (no behavior change).

#### Schedule Change Handling

- **FR-007**: When the recurrence pattern of a ritual definition changes, the system MUST soft-delete all future untouched instances (instances where: scheduled date is after today, state category is "scheduled", no chat channel exists, and no evidence submissions exist).
- **FR-008**: When the recurrence pattern changes, the system MUST detach all future touched instances by clearing their ritual definition link and changing their kind to standard.
- **FR-009**: The system MUST NOT modify any instance with a scheduled date on or before "today" during a schedule change. "Today" is evaluated in the ritual definition's configured `timezone`.
- **FR-010**: After cleaning up future instances, the system MUST regenerate new instances using the updated recurrence rule, starting from the day after the change.
- **FR-011**: The system MUST update the "last generated date" on the ritual definition after regeneration.
- **FR-012**: The entire schedule change operation (soft-delete, detach, update rule, regenerate) MUST execute atomically — either all succeed or none.

#### Confirmation UX

- **FR-013**: Before applying a schedule change, the system MUST provide an impact preview containing: (a) count of instances to be removed, (b) count of instances to be kept as standalone tasks, and (c) count of new instances to be created.
- **FR-014**: The user MUST explicitly confirm the schedule change before it is applied.

#### Audit & Tracking

- **FR-015**: The ritual definition MUST track a schedule version counter that increments on each recurrence pattern change.
- **FR-016**: Detached tasks MUST retain their original scheduled date and completion deadline as advisory-only metadata. The system MUST NOT trigger automatic state transitions (e.g., overdue) based on these dates after detachment.
- **FR-017**: Detached tasks MUST carry a `detached_from_ritual` flag (set to true) so the UI can display a read-only label indicating the ritual the task originally belonged to.

#### Access Control

- **FR-018**: Only the ritual definition's original creator OR a project admin may modify the recurrence pattern of a ritual definition. All other project members MUST be denied schedule change operations.

#### Inline Definition Editing

- **FR-020**: The ritual instance detail view MUST display the ritual definition's recurrence pattern and name as a distinct, identifiable section.
- **FR-021**: For authorized users (creator or project admin), the definition section MUST render inline edit controls — fields become editable in place without navigating to a separate definition management screen.
- **FR-022**: Saving edits from the inline definition section MUST trigger the same impact preview and confirmation flow as any other schedule change (FR-013, FR-014).
- **FR-023**: For non-authorized users, the definition section MUST be read-only. No edit controls, buttons, or affordances that suggest mutability SHALL be displayed.

#### Data Retention

- **FR-019**: Soft-deleted ritual instances MUST be retained indefinitely. The system MUST NOT automatically purge soft-deleted task rows.

### Key Entities

- **Ritual Instance (lightweight)**: A task generated from a ritual definition that exists without a chat channel or description document. Resources are created lazily on first user interaction. This is the primary state of projected future instances.

- **Ritual Instance (materialized)**: A ritual instance where a user has triggered resource creation — it now has a chat channel and/or description document. This instance is considered "touched."

- **Detached Task**: A former ritual instance that was in-progress or interacted with when a schedule change occurred. Becomes a standard task with a `detached_from_ritual` flag set to true. The UI displays a subtle "was part of [ritual name]" label so the worker understands the task's origin, but the task no longer appears in the ritual timeline. Deadlines on detached tasks are advisory-only — no automatic overdue transitions.

- **Schedule Version**: A monotonically increasing counter on the ritual definition that tracks how many times the recurrence pattern has been modified. Used for audit and to distinguish "missed because pattern changed" from "missed because nobody did the work."

### Instance Classification Logic

All date comparisons ("today", "after today") are evaluated in the ritual definition's configured `timezone`.

An instance is considered **"untouched"** when ALL of the following are true:
- Scheduled date is after today (in the definition's timezone)
- State category is "scheduled"
- No chat channel exists on the task
- No evidence submission rows exist for the task
- Task is not soft-deleted

An instance is considered **"touched"** when:
- Scheduled date is after today
- Any of the "untouched" conditions are false (state changed, channel exists, evidence exists)
- Task is not soft-deleted

---

## Review & Acceptance Checklist
*GATE: Automated checks run during main() execution*

### Content Quality
- [ ] No implementation details (languages, frameworks, APIs)
- [ ] Focused on user value and business needs
- [ ] Written for non-technical stakeholders
- [ ] All mandatory sections completed

### Requirement Completeness
- [ ] No [NEEDS CLARIFICATION] markers remain
- [ ] Requirements are testable and unambiguous  
- [ ] Success criteria are measurable
- [ ] Scope is clearly bounded
- [ ] Dependencies and assumptions identified

---

## Execution Status
*Updated by main() during processing*

- [ ] User description parsed
- [ ] Key concepts extracted
- [ ] Ambiguities marked
- [ ] User scenarios defined
- [ ] Requirements generated
- [ ] Entities identified
- [ ] Review checklist passed

---
