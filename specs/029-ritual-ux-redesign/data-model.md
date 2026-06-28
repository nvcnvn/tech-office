# Data Model: Ritual UX Redesign

## Overview

This feature does not require a new persistence model for rituals. It reorganizes existing collaboration, ritual, evidence, and notification entities into clearer interaction models for project entry, project navigation, and role-based task execution.

## Core Interaction Entities

### 1. Collaboration Mode Entry Policy

- **Purpose**: Determines the default landing surface when a user opens a project without an explicit view.
- **Source of truth**: Existing `CollaborationMode` on the project.
- **Key fields**:
  - `projectId`
  - `collaborationMode`
  - `defaultSurface`
- **Behavioral rules**:
  - `standard` maps to a planning-first surface.
  - `ritual` maps to a today-first surface.
  - `mixed` maps to an overview surface.
  - An explicit URL/view selection overrides the default policy.

### 2. Project Navigation Surface

- **Purpose**: Represents a top-level destination visible inside a project workspace.
- **Examples**:
  - `Board`
  - `List`
  - `Today`
  - `Overview`
  - `Planned Work`
  - `Routine Operations`
  - `Review`
  - `Health`
  - `Calendar`
  - `Settings`
- **Key fields**:
  - `surfaceId`
  - `label`
  - `modeAvailability[]`
  - `primaryAudience`
  - `workstream`
- **Behavioral rules**:
  - Surface availability depends on collaboration mode.
  - Surfaces must have distinct jobs so review, execution, and template management do not overlap.

### 3. Mixed Overview

- **Purpose**: A cross-stream summary for mixed projects.
- **Source of truth**: Derived from existing standard tasks, ritual instances, review state, and compliance summaries.
- **Key fields**:
  - `projectId`
  - `needsAttentionNow[]`
  - `todayStandardTasks[]`
  - `todayRitualRuns[]`
  - `plannedWorkSummary`
  - `routineOperationsSummary`
  - `pendingReviewCount`
- **Behavioral rules**:
  - Must summarize both workstreams in one orientation layer.
  - Must remain useful when only one workstream currently has urgent items.
  - Must link into the correct downstream surface rather than hosting the whole workflow inline.

### 4. Today Section Group

- **Purpose**: Groups day-to-day work by urgency or workstream.
- **Examples**:
  - `Overdue`
  - `Today`
  - `Upcoming`
  - `Needs Resubmission`
  - `Standard Tasks Due Today`
  - `Ritual Runs Due Today`
- **Key fields**:
  - `sectionId`
  - `label`
  - `items[]`
  - `sortRule`
  - `emptyState`
- **Behavioral rules**:
  - Ritual-first today views group by urgency and action state.
  - Mixed-mode today views separate standard tasks from ritual runs into distinct labeled sections.

### 5. Ritual Worklist Item

- **Purpose**: Represents one ritual instance in a sortable, filterable ritual-specific list surface.
- **Source of truth**: Existing ritual instance task projections.
- **Key fields**:
  - `taskId`
  - `identifier`
  - `title`
  - `ritualDefinitionId`
  - `scheduledDate`
  - `completionDeadline`
  - `urgencyState`
  - `proofStateSummary`
  - `reviewStateSummary`
  - `assigneeSummary`
- **Behavioral rules**:
  - Worklist exists for ritual browsing and operational filtering, not for standard-task planning.
  - It must expose work and review status more clearly than a generic board card.

### 6. Operational Health Snapshot

- **Purpose**: Summarizes ritual compliance and exception trends.
- **Source of truth**: Existing compliance summary and ritual analytics projections.
- **Key fields**:
  - `overdueRunCount`
  - `pendingReviewCount`
  - `verifiedRate`
  - `missedRunCount`
  - `trendWindow`
- **Behavioral rules**:
  - Health is an owner/reviewer surface, not a worker execution surface.
  - Health summarizes exceptions and trends rather than hosting individual proof actions.

### 7. Review Queue Item

- **Purpose**: Represents pending ritual proof needing review.
- **Source of truth**: Existing task and evidence submission state.
- **Key fields**:
  - `taskId`
  - `ritualDefinitionId`
  - `taskTitle`
  - `pendingRequirementIds[]`
  - `pendingReviewCount`
  - `assigneeSummary`
  - `completionDeadline`
  - `navigationTarget`
- **Behavioral rules**:
  - Review queue items must link back to the ritual instance or a review-focused surface.
  - Review backlog remains web-first, while mobile focuses on task-targeted review entry.

### 8. Ritual Instance Surface

- **Purpose**: The live execution and review context for one ritual run.
- **Source of truth**: Existing ritual task detail composition.
- **Key fields**:
  - `taskId`
  - `whatToDoSection`
  - `proofChecklist`
  - `reviewerDecisions`
  - `templateGuidance`
  - `discussionAndAttachments`
  - `focusIntent`
- **Behavioral rules**:
  - Submission and resubmission actions belong here.
  - Review actions belong here or in a linked review backlog context.
  - Template guidance is secondary, read-only context for most users.

### 9. Ritual Template Surface

- **Purpose**: Manage reusable recurrence, instruction, and requirement settings.
- **Source of truth**: Existing ritual definition editor and settings surfaces.
- **Key fields**:
  - `definitionId`
  - `name`
  - `recurrenceRule`
  - `completionWindowHours`
  - `evidenceRequirements[]`
  - `assignmentDefaults`
- **Behavioral rules**:
  - Template editing must never be the primary worker action.
  - Template changes must not appear to modify a specific live run directly.

### 10. Mobile Focus Group

- **Purpose**: Organize assigned work in the mobile Tasks experience.
- **Source of truth**: Existing mobile focus-mode loaders and ritual task hydration.
- **Key fields**:
  - `groupId`
  - `label`
  - `taskIds[]`
  - `priority`
  - `actionHint`
- **Behavioral rules**:
  - Mobile groups should be obvious to low-tech workers.
  - Common proof actions should be represented by action-oriented labels such as `Take photo` or `Add note`.

## Relationships

- A `Collaboration Mode Entry Policy` selects the initial `Project Navigation Surface`.
- A `Mixed Overview` summarizes both `Planned Work` and `Routine Operations` without replacing either one.
- A `Today Section Group` contains standard tasks or ritual runs, depending on mode and workstream.
- A `Ritual Worklist Item` links to a `Ritual Instance Surface`.
- A `Review Queue Item` links to a `Ritual Instance Surface` with review intent.
- A `Ritual Template Surface` describes the reusable rules that inform, but do not replace, a `Ritual Instance Surface`.
- A `Mobile Focus Group` links to the same `Ritual Instance Surface`, but with a mobile-specific presentation model.

## Validation Rules

- The same project must not present conflicting default surfaces for the same collaboration mode.
- Mixed-mode surfaces must identify work type structurally, not only cosmetically.
- Worker-first flows must resolve to live tasks, not to ritual templates.
- Review and template management must remain distinct from each other and from live worker submission.
- Dual-role users may see both proof and review sections, but those sections must remain clearly labeled.
- Exceptional ritual instances such as skipped or detached runs must preserve instance-specific context.

## State Transitions

### Project Entry State

`project_opened_without_view` → `default_surface_selected_by_mode`

`project_opened_with_view` → `explicit_surface_respected`

### Ritual Daily Work State

`overdue` → `today` → `upcoming`

`missing_proof` → `pending_review` → `approved`

`pending_review` → `rejected` → `resubmitted`

### Mixed Workstream Navigation State

`overview` → `planned_work`

`overview` → `routine_operations`

`today` → `standard_tasks_section`

`today` → `ritual_runs_section`