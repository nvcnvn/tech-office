# Feature Specification: Ritual UX Redesign

**Feature Branch**: `029-ritual-ux-redesign`  
**Created**: 2026-04-20  
**Status**: Draft  
**Input**: User description: "please help to write new spec based on docs/RITUAL-UX-REDESIGN.md"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Find Today’s Ritual Work Immediately (Priority: P1)

An assigned employee opens the tasks experience for a ritual-focused project and is taken directly to a today-first view that shows what is overdue, due now, or waiting on resubmission, without first interpreting a generic planning board.

**Why this priority**: Ritual work fails when frontline workers cannot immediately identify what needs action now. Reducing ambiguity for the day’s work is the highest-value behavior in the redesign.

**Independent Test**: Can be fully tested by entering a ritual-focused project with overdue, due-today, and rejected ritual runs and confirming the employee lands on a today-oriented surface where those runs are grouped by urgency and open into the live task instance.

**Acceptance Scenarios**:

1. **Given** an employee opens a ritual-focused project without a previously selected view, **When** the project loads, **Then** the first surface emphasizes today’s ritual work rather than a generic board.
2. **Given** the employee has overdue, due-today, and upcoming ritual runs, **When** the today-oriented surface appears, **Then** the runs are grouped in urgency-first sections that make the next action obvious.
3. **Given** a ritual run is missing proof or needs resubmission, **When** the employee opens that run from the daily view, **Then** the employee reaches the live ritual instance with the missing or rejected requirement clearly visible.

---

### User Story 2 - Review Operational Health Separately From Daily Work (Priority: P1)

A project owner, admin, or reviewer opens a ritual-focused project and can quickly distinguish between operational health, review backlog, live task execution, and reusable ritual template management.

**Why this priority**: Owners and reviewers need exception management and compliance visibility, not the same default surface that workers use. Without this separation, review and template management remain mentally mixed with live work.

**Independent Test**: Can be fully tested by entering a ritual-focused project as an owner or reviewer and confirming there are distinct entry points for daily work, health monitoring, review backlog, and ritual template management.

**Acceptance Scenarios**:

1. **Given** an owner opens a ritual-focused project, **When** the project navigation is shown, **Then** review, health, and live tasks are presented as distinct surfaces with non-overlapping purposes.
2. **Given** the project has pending ritual submissions awaiting approval, **When** the owner opens the review surface, **Then** the owner can identify items needing review without searching through unrelated task discussions.
3. **Given** the owner needs to inspect recurring setup rules, **When** the owner opens ritual template management, **Then** the owner can edit reusable ritual settings without that screen presenting live worker submission actions as the primary call to action.

---

### User Story 3 - Separate Planned Work From Routine Operations in Mixed Projects (Priority: P2)

A user working inside a mixed project can understand, from the project entry point onward, which work belongs to planned one-off tasks and which work belongs to recurring ritual operations, without decoding every item individually.

**Why this priority**: Mixed projects are the current failure point because two different work models are flattened into one mental model. Structural separation is the core correction.

**Independent Test**: Can be fully tested by opening a mixed project containing both standard tasks and ritual runs and confirming the default landing surface summarizes both workstreams, while navigation and today views keep them explicitly separated.

**Acceptance Scenarios**:

1. **Given** a user opens a mixed project without a previously selected view, **When** the project loads, **Then** the first surface is an overview that summarizes both planned work risk and routine operational exceptions.
2. **Given** a mixed project has both standard tasks and ritual runs due today, **When** the user opens the today-oriented surface, **Then** the two work types appear in clearly labeled sections rather than one blended list.
3. **Given** a user wants to browse standard work only, **When** the user opens the planned-work surface, **Then** the user sees only standard-task planning views.
4. **Given** a user wants to browse recurring operational work only, **When** the user opens the routine-operations surface, **Then** the user sees only ritual-run views and shortcuts relevant to ritual operations.

---

### User Story 4 - Complete Ritual Proof From a Mobile-First Task Flow (Priority: P2)

An employee using mobile can move from a task-first list into the live ritual run, see instructions and proof requirements, and complete the next missing proof action through obvious, capture-oriented actions.

**Why this priority**: Mobile is the frontline execution path for many workers. If the redesign does not keep mobile task-first and action-first, the broader navigation changes will not solve day-to-day ritual completion.

**Independent Test**: Can be fully tested by opening the mobile tasks experience with ritual runs in different proof states and confirming the employee can identify the next required action and complete it without entering ritual definition management.

**Acceptance Scenarios**:

1. **Given** an employee opens mobile tasks, **When** ritual work is due or overdue, **Then** the employee sees grouped sections such as overdue, today, and upcoming instead of a definition-management entry point.
2. **Given** an employee opens a ritual run on mobile, **When** proof is missing for one requirement, **Then** the task detail presents one obvious next action for that requirement.
3. **Given** a manager receives a ritual review alert on mobile, **When** the manager opens it, **Then** the manager reaches the specific ritual instance with the pending submission highlighted rather than a large backlog-style queue.

### Edge Cases

- A user enters a standard project, ritual-focused project, or mixed project from a generic tasks entry point and expects the first surface to match that project’s collaboration mode.
- A user opens a bookmarked or shared legacy `/workspace/projects` URL and expects to land on the equivalent `Tasks` destination without losing view state, focus intent, or query parameters.
- A mixed project has no ritual runs due today but does have blocked standard tasks, or the reverse, and the overview still needs to remain useful instead of appearing empty or misleading.
- A worker opens a ritual template directly from management settings and expects to submit live proof there.
- A user holds both worker and reviewer roles on the same ritual instance and must see their own proof state and separate review actions without the two being merged into one ambiguous panel.
- A ritual instance is skipped, detached, or already completed when reached from a notification and still needs to preserve its exceptional context.
- A ritual-focused project still contains occasional ad hoc standard tasks and should not hide that work even though ritual execution remains the default experience.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST choose the default project landing surface according to collaboration mode when a user enters without a preselected view.
- **FR-002**: The default landing surface for a standard project MUST emphasize standard-task planning work.
- **FR-003**: The default landing surface for a ritual-focused project MUST emphasize today’s live ritual work rather than a generic planning board.
- **FR-004**: The default landing surface for a mixed project MUST provide an overview that summarizes both planned work and routine operations.
- **FR-005**: The ritual-focused daily work surface MUST group ritual runs by urgency and action state, including overdue work, due-now work, work needing resubmission, and pending-review awareness presented as a distinct secondary cue or section rather than replacing worker action groups.
- **FR-006**: Selecting a ritual run from a daily work surface or alert MUST open the live ritual instance, not ritual template management.
- **FR-007**: The live ritual instance MUST present task instructions, due context, proof requirements, current proof state, and reviewer outcomes in a task-first order.
- **FR-008**: The system MUST keep ritual template management visually and behaviorally separate from live ritual execution so users do not confuse editing recurring rules with completing an assigned run.
- **FR-009**: Ritual-focused project navigation MUST provide distinct surfaces for daily work, review backlog, operational health, a ritual-specific calendar visibility surface, and worklist browsing.
- **FR-010**: The ritual worklist MUST present ritual instances in a sortable and filterable list-oriented surface rather than treating a generic board as the primary ritual view.
- **FR-011**: If the product offers a board-like ritual view, it MUST use ritual-specific operational states and MUST remain secondary to daily work, worklist, and health surfaces by never being the default landing surface, never being the first ritual navigation destination, and never being presented as the primary ritual call to action.
- **FR-012**: Mixed-project navigation MUST separate standard-task planning surfaces from ritual-operation surfaces through explicit top-level labels and destinations.
- **FR-013**: The mixed-project overview MUST summarize what needs attention now, what is due today, what is waiting for ritual review, how routine operations are performing, and whether standard project work is at risk.
- **FR-014**: The mixed-project today-oriented surface MUST show standard tasks and ritual runs in separate labeled sections instead of an interleaved stream.
- **FR-015**: Mixed-project surfaces MUST use structural separation for work type, such as dedicated sections, filters, and empty states, instead of relying only on subtle badges or color treatment.
- **FR-016**: Mobile worker flows MUST remain task-first, leading from grouped work sections into the live ritual instance rather than into ritual definition detail.
- **FR-017**: Mobile ritual instance views MUST present proof requirements with obvious next actions for common submission types so workers can act before interpreting abstract status labels.
- **FR-018**: Mobile review flows MUST support opening and acting on a specific ritual submission from an alert, while the primary backlog-style review queue remains optimized for larger-screen use.
- **FR-019**: Users who can both submit and review on the same ritual instance MUST see separate sections for their own proof and their review actions.
- **FR-020**: Exceptional ritual runs, including skipped, detached, or otherwise nonstandard instances, MUST preserve context that explains why the run differs from the reusable ritual template.
- **FR-021**: User-facing navigation and labeling for day-to-day work MUST prioritize task-first language and avoid requiring frontline workers to understand an abstract organizing container before acting.
- **FR-022**: The primary web workspace route for day-to-day task work MUST use `/workspace/tasks` rather than `/workspace/projects` so route naming reinforces `Tasks` as the main user-facing module term.
- **FR-023**: User-facing project detail and live task detail URLs reached from daily work, review, health, calendar, worklist, notifications, or copied links MUST resolve under the `/workspace/tasks` route family.
- **FR-024**: Legacy `/workspace/projects` routes MUST redirect to the equivalent `/workspace/tasks` destination while preserving query parameters, selected views, and ritual focus intents.

### Assumptions

- Existing collaboration modes remain standard, ritual-focused, and mixed.
- Ritual review, ritual health, and ritual template management already exist conceptually and are being reorganized into clearer entry points rather than invented from scratch.
- Standard-task planning views remain available for standard and mixed projects even when ritual-first navigation changes are introduced.
- Workers primarily need urgency-first task entry, while owners and reviewers primarily need exception-first operational entry.
- Mobile remains optimized for focused execution and targeted review actions rather than scanning large management backlogs.
- Existing internal and shared links to `/workspace/projects` may still exist during rollout, so backward-compatible redirects are required until callers are updated.

### Key Entities *(include if feature involves data)*

- **Collaboration Mode**: The project-level work model that determines whether users should primarily experience standard planning work, ritual operations, or both together.
- **Tasks Surface**: The primary day-to-day entry point where users reach current work without first navigating through management structures.
- **Ritual Instance**: A live recurring work run assigned to users, with due context, proof requirements, submission history, and review state.
- **Ritual Template**: The reusable definition that controls recurring rules, instructions, and proof expectations but is distinct from any one live run.
- **Mixed Overview**: A summary surface for mixed projects that shows cross-stream exceptions, today’s work, operational health, and planned-work risk in one place.
- **Routine Operations Surface**: The set of ritual-specific browsing and monitoring views used to inspect recurring work, including list-style browsing, review, and operational health.
- **Planned Work Surface**: The set of standard-task planning views used to manage one-off or project-style work.
- **Entry Surface**: Any upstream destination, such as a today view, task list, alert, calendar view, or project landing, that links users into live work.

## Iterations

### Iteration 2026-04-21: Task-First Route Rename

**Change**: Apply the missing route-level part of the redesign so the web workspace uses `Tasks`-aligned URLs instead of `Projects`-aligned URLs.
**Scope**: Feature-wide
**Artifacts updated**: spec.md, plan.md, tasks.md, quickstart.md, research.md, contracts/navigation-contract.md
**Tasks added**: T047, T048, T049, T050
**Tasks removed**: —
**Tasks marked complete**: —

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In first-use validation, at least 90% of employees opening a ritual-focused project can identify where today’s ritual work lives within 10 seconds of entry.
- **SC-002**: In first-use validation, at least 90% of employees opening a ritual run from daily work reach the live instance, not template management, on their first attempt.
- **SC-003**: In first-use validation, at least 85% of employees can identify the next proof action for a ritual run within 15 seconds of opening the instance on mobile.
- **SC-004**: In first-use validation, at least 90% of owners or reviewers can distinguish daily work, review backlog, operational health, and ritual template management without training.
- **SC-005**: In first-use validation, at least 90% of users in mixed projects can correctly identify whether an item belongs to planned work or routine operations from the overview and today-oriented surfaces.
- **SC-006**: After rollout, support or product-feedback items tagged to ritual navigation confusion for finding today’s ritual work, ritual review, or ritual template editing decrease by at least 30% versus the baseline from the immediately previous release cycle, measured across the first release cycle after launch.
