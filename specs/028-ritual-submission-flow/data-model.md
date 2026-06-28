# Data Model: Ritual Submission Flow

## Overview

This feature does not introduce a new persistence model for rituals. It organizes existing collaboration ritual entities into clearer frontend interaction models and derives a reviewer backlog view from current task and evidence data.

## Core Entities

### 1. Ritual Definition

- **Purpose**: Template-level ritual configuration and instructions.
- **Source of truth**: Existing ritual definition APIs and definition editor surface.
- **Key fields**:
  - `id`
  - `projectId`
  - `name`
  - `description`
  - `recurrenceRule`
  - `completionWindowHours`
  - `timezone`
  - `evidenceRequirements[]`
  - `scheduleVersion`
- **Behavioral rules**:
  - Contains requirement rules, not live submissions.
  - May be visible inside a task detail as read-only context.
  - Editing permissions are separate from submission/review permissions.

### 2. Ritual Instance Task

- **Purpose**: The live work item for one scheduled ritual run.
- **Source of truth**: Collaboration task APIs.
- **Key fields**:
  - `id`
  - `projectId`
  - `identifier`
  - `title`
  - `taskKind`
  - `ritualDefinitionId`
  - `stateId` / state category
  - `scheduledDate`
  - `completionDeadline`
  - `assignees[]`
  - `skipReason`
  - `detachedFromRitual`
  - `evidenceProgress`
- **Behavioral rules**:
  - Submission and review actions attach to this entity.
  - Today/list/notification entry points should land here.
  - Exceptional states such as `skipped` and detached runs remain visible as instance-specific context.

### 3. Evidence Requirement

- **Purpose**: One proof obligation on the ritual definition.
- **Source of truth**: Ritual definition evidence requirements.
- **Key fields**:
  - `id`
  - `name`
  - `description`
  - `evidenceTypes[]`
  - `isRequired`
  - `approvalMode`
  - `autoApproveConfig`
  - `position`
- **Behavioral rules**:
  - Displayed as a checklist on the ritual instance.
  - Requirement order matters for worker scanning.
  - Requirement management belongs to template editing, not live submission history.

### 4. Evidence Submission

- **Purpose**: The proof artifact submitted against one requirement on one ritual instance.
- **Source of truth**: Ritual evidence submission APIs.
- **Key fields**:
  - `id`
  - `taskId`
  - `evidenceRequirementId`
  - `submittedByEmployeeId`
  - `evidenceType`
  - `fileId`
  - `textContent`
  - `linkUrl`
  - `gpsCoordinates`
  - `deviceTimestamp`
  - `serverTimestamp`
  - `approvalStatus`
  - `reviewedByEmployeeId`
  - `reviewedAt`
  - `reviewerComment`
- **Behavioral rules**:
  - Belongs to a ritual instance, not a definition.
  - Historical submissions remain visible after rejection or approval.
  - Rejected requirements can accept a new submission without erasing reviewer context.

### 5. Review Queue Item (Derived View)

- **Purpose**: Reviewer-facing aggregate of pending ritual work across task instances.
- **Source of truth**: Derived from existing task and evidence projections.
- **Key fields**:
  - `taskId`
  - `taskIdentifier`
  - `taskTitle`
  - `ritualDefinitionId`
  - `ritualName`
  - `pendingReviewCount`
  - `assigneeSummary`
  - `completionDeadline`
  - `projectId`
  - `navigationTarget`
- **Behavioral rules**:
  - Exists for reviewer triage, not as a new business entity.
  - Should be linkable back to the ritual instance.
  - Web-first for backlog management; mobile may surface a task-level subset only.

### 6. Entry Intent (Derived Navigation Context)

- **Purpose**: Describes why the user entered the ritual flow and which section should be focused.
- **Potential values**:
  - `submit_requirement`
  - `review_pending`
  - `view_instance`
- **Behavioral rules**:
  - Should never change which entity is opened; it only changes initial focus inside the ritual instance experience.

## Relationships

- A `Ritual Definition` has many `Evidence Requirements`.
- A `Ritual Definition` generates many `Ritual Instance Tasks` over time.
- A `Ritual Instance Task` can have zero or many `Evidence Submissions`.
- Each `Evidence Submission` fulfills one `Evidence Requirement` for one `Ritual Instance Task`.
- A `Review Queue Item` is a reviewer-facing projection derived from `Ritual Instance Task` plus pending `Evidence Submission` state.

## Validation Rules

- Submission actions must only render when a specific ritual instance exists.
- Definition-edit actions must not modify evidence submission history.
- Reviewer actions must only appear to users with review capability.
- A user may hold both submit and review capabilities, and the interface must not suppress one because of the other.
- Entry points from today/list/notifications must resolve to a ritual instance, not to the ritual definition editor.
- Summary surfaces may expose counts and status, but must not replace the full ritual instance workflow.

## State Transitions

### Requirement-Level Interaction State

`missing` → `pending_review` → `approved`

`missing` → `approved` (auto-approval path)

`pending_review` → `rejected` → `pending_review` (resubmission path)

### User-Facing Flow State

- **Worker flow**:
  - enters from today/list/notification
  - opens ritual instance
  - identifies one requirement needing action
  - submits or resubmits evidence
  - returns to the same ritual instance with refreshed checklist state

- **Reviewer flow**:
  - enters from reviewer backlog, notification, or task instance
  - opens ritual instance or review backlog item
  - reviews pending evidence
  - approves or rejects with optional feedback
  - sees the instance update without leaving review context
