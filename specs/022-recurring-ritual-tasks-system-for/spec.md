# Feature Specification: Ritual Tasks — Recurring Operational Tasks with Evidence & Health Visibility

**Feature Branch**: `022-recurring-ritual-tasks-system-for`  
**Created**: 2026-03-11  
**Status**: Draft  
**Input**: User description: "Build a recurring tasks system called ritual tasks alongside existing project tasks. Support three collaboration models (dev-only, ritual-only, mixed). Ritual tasks are recurring schedules with evidence requirements and operational health visibility for managers."

---

## Context & Motivation

The existing collaboration system is built around one-off project tasks (Trello/Jira-style) with hierarchical levels, custom states, and kanban/gantt/calendar views. This model serves software development well, where each task is unique.

However, many businesses rely on **recurring operational tasks** — repetitive activities that must happen on a schedule and whose completion (or non-completion) has direct business consequences. We call these **Ritual Tasks**.

**Examples by industry:**
- **DevSecOps**: Access audit (quarterly), permission audit (monthly), backup & restore drill (monthly)
- **Retail & F&B**: Open/close store handover (daily), cold chain temperature check (twice daily), safety walk (weekly)
- **Field Services**: Electrician scheduled maintenance at customer sites (monthly/quarterly), plumber preventive checks
- **Corporate**: Client catch-up meetings (weekly/monthly), compliance reviews

**The core problem**: When a recurring operational task is missed or done late, there are real consequences — compliance violations, spoiled inventory, safety incidents, customer churn. Managers currently have no systematic way to see if these critical repeating activities are being done on time and correctly.

**Three collaboration models**: The system must support organizations that:
1. **Standard** — Ad-hoc project tasks only (current behavior). Works for any team with one-off work items: software development, R&D, marketing campaigns, creative projects, consulting engagements, etc.
2. **Ritual** — Only recurring operational tasks (e.g., retail store operations, field service crews, compliance teams)
3. **Mixed** — Both ad-hoc tasks and ritual tasks in the same project (e.g., DevSecOps teams doing both feature work and BAU security audits, or facility management teams handling both maintenance schedules and one-off repair requests)

---

## User Scenarios & Testing *(mandatory)*

### Primary User Stories

**Story 1 — Manager defines a ritual**
A DevSecOps team lead creates a "Permission Audit" ritual that recurs every month. They define what evidence is required: an exported PDF of the access list and a text note summarizing findings. They set it to auto-assign to the security engineer on the team. They set a deadline of the 5th business day of each month.

**Story 2 — Worker completes a ritual instance**
An electrician opens their "Today" view every morning. They see they have an AC maintenance visit at Customer A by 10:00 AM. They arrive, take a GPS-tagged photo as arrival check-in, photograph the AC unit before maintenance, perform the work, photograph the result after, and get the customer to record an approval voice memo. Each piece of evidence is submitted against the ritual's checklist. Some evidence (GPS location) is auto-verified by the system; the customer photos are submitted for manager review.

**Story 3 — Manager monitors operational health**
A retail operations manager opens their operational health dashboard. They see a summary across all stores: 3 out of 10 stores have not completed the morning cold chain check (it's 11 AM). They drill into one store and see the assigned worker has not started. They send a reminder notification. At the end of the week, they view a compliance summary showing 95% on-time completion rate for cold chain checks, and 80% for safety walks.

**Story 4 — Future: Auto-approval via external system** *(deferred to workflow automation system)*
In the future, a company will be able to integrate their monitoring system via the workflow automation platform. When the backup & restore drill passes automated tests, the automation workflow marks the "Backup drill completed" evidence as verified. No manual approval needed. For v1, such evidence requires manual approval by a reviewer.

### Acceptance Scenarios

1. **Given** a project with any collaboration mode, **When** a manager creates a ritual definition with a recurrence schedule (e.g., "every Monday at 9:00 AM"), **Then** the system generates ritual task instances automatically according to the schedule. (The collaboration mode is a UI hint that optimizes the default display, not a hard restriction.)

2. **Given** a ritual task instance is generated for a worker, **When** the worker opens their "Today" view, **Then** they see all ritual instances due today with their evidence requirements and deadlines listed.

3. **Given** a ritual task instance with evidence requirements, **When** the worker submits all required evidence and all evidence passes approval (manual or automatic), **Then** the ritual instance transitions to "verified" state.

4. **Given** a ritual task instance whose deadline has passed without completion, **When** the system evaluates overdue status, **Then** the instance is marked "overdue" and the manager receives a notification.

5. **Given** a ritual task instance fully missed (entire completion window expired), **When** the manager views the operational health dashboard, **Then** the missed instance is visible as a compliance gap with the responsible assignee identified.

6. **Given** an evidence item with an auto-approval rule (e.g., GPS location within geofence), **When** the worker submits a GPS-tagged photo within the expected location and time window, **Then** that evidence item is automatically marked as verified without manual intervention.

7. **Given** an evidence item submitted for manual review, **When** the reviewer (project admin/owner) approves or rejects it with a comment, **Then** the approval status is recorded and the worker is notified of the outcome.

8. **Given** a ritual definition in a "mixed" project, **When** viewing the project, **Then** both regular tasks and ritual instances are visible (but ritual instances are distinguished visually and may appear in separate views).

9. **Given** a project configured as "standard", **When** the user creates a ritual definition, **Then** the system allows it (mode is a UI display hint, not a strict gate). The UI may show a prompt suggesting to switch mode for better experience.

10. **Given** a worker submits evidence for a ritual they are not directly assigned to (e.g., covering a shift), **When** the evidence is submitted, **Then** it is accepted and recorded with the actual submitter's identity, and routed for manual approval regardless of the evidence requirement's normal approval mode.

### Edge Cases (Resolved)

- **Assignee leaves/reassigned**: The system warns the manager via notification. Open ritual instances for that assignee remain visible in the dashboard as needing reassignment. The manager must manually reassign.
- **Recurrence schedule modified**: Follow the calendar-event pattern — regenerate future unstarted instances according to the new schedule. Instances already in progress or completed are not affected. Alternatively, managers can retire the old ritual definition and create a new one.
- **Evidence submitted after deadline but within completion window**: Marked as "late but completed". The submission deadline acts as an early warning. If evidence is late but ultimately approved by a reviewer, the instance is considered completed (not missed). The lateness is recorded for analytics.
- **Ritual definition archived/deleted with open instances**: System warns the manager. If the manager confirms, all open (non-terminal) instances are closed/cancelled. Completed and missed historical instances are preserved.
- **Instance generation window**: Follow calendar-system conventions — generate instances using a rolling window proportional to the recurrence interval. For daily rituals, generate ~30 days ahead; for weekly, ~8 weeks; for monthly, ~3 months; for quarterly+, at least 2 upcoming instances. This ensures long-interval rituals always have visibility without over-generating.
- **Worker submits evidence for unassigned ritual**: Accepted. The actual submitter's identity is clearly recorded. Evidence from non-assigned workers is routed for manual approval regardless of the requirement's normal approval mode. This supports common patterns like shift coverage in F&B and field services.
- **GPS/time metadata from unreliable devices**: Best-effort approach. The system records both device-reported timestamps/coordinates and server-received timestamps. Server-side timestamps are the authoritative reference for deadline enforcement. GPS spoofing is outside system scope — if detected through other means, it is an HR/legal matter.
- **Auto-approval system fails** *(future, via workflow automation)*: If the external automation fails to approve evidence, it remains in "pending review" for manual fallback. Managers receive a warning notification. The failure is logged in audit history.

---

## Requirements *(mandatory)*

### Functional Requirements — Project & Collaboration Model

- **FR-001**: System MUST support three project collaboration modes: "standard" (current ad-hoc task behavior), "ritual" (recurring operational tasks), and "mixed" (both). The mode is set per project.
- **FR-002**: The collaboration mode is a **UI display hint** that determines the default views and interface emphasis — not a strict enforcement gate. Users are not prevented from creating either task type regardless of mode.
- **FR-003**: In "standard" mode, the UI defaults to kanban/list/gantt views optimized for ad-hoc tasks. Ritual features are available but not prominently displayed.
- **FR-004**: In "ritual" mode, the UI defaults to the "Today" view, operational health dashboard, and calendar. Ad-hoc task creation is available but not prominently displayed.
- **FR-005**: In "mixed" mode, the UI provides balanced access to both ad-hoc task views and ritual views.
- **FR-006**: The collaboration mode MUST be set at project creation and MAY be changed by project owners/admins at any time. Changing the mode only affects UI layout and defaults — no data migration is needed.

### Functional Requirements — Ritual Definitions

- **FR-010**: Authorized users (project owner/admin) MUST be able to create a **ritual definition** — a template that describes a recurring task.
- **FR-011**: A ritual definition MUST include: name, description, recurrence schedule, and default assignee(s).
- **FR-012**: Recurrence schedule MUST support: daily, weekly (specific days), monthly (specific day-of-month or Nth weekday), and custom interval (every N days/weeks/months). A structured recurrence builder UI is sufficient for v1 — no cron-like expressions needed.
- **FR-013**: A ritual definition MUST be able to specify a **completion window** — the time range within which the ritual instance should be completed (e.g., "due by 10:00 AM on the recurrence day" or "within 3 days of the recurrence date").
- **FR-014**: A ritual definition MAY specify a **timezone** for schedule evaluation (critical for multi-timezone organizations).
- **FR-015**: A ritual definition MUST be able to specify one or more **evidence requirements** (see Evidence section below).
- **FR-016**: A ritual definition MUST support assignment to one employee, multiple employees, or a role/department (all members of that department get assigned).
- **FR-017**: A ritual definition MUST be archivable (stops generating new instances) without deleting historical data.
- **FR-018**: *(Deferred)* Seasonal/conditional activation (e.g., only active during certain months, paused during holidays) is not required for v1. Managers can manually archive and re-create ritual definitions for seasonal needs.

### Functional Requirements — Ritual Task Instances

- **FR-020**: The system MUST automatically generate **ritual task instances** from active ritual definitions according to their recurrence schedule.
- **FR-021**: Each ritual task instance is a concrete occurrence of a ritual for a specific date/time window.
- **FR-022**: Ritual task instances MUST have the following lifecycle states:
  - **Scheduled**: Generated but the completion window has not opened yet
  - **Open**: Completion window is active; assignee should be working on it
  - **In Progress**: Assignee has started submitting evidence
  - **Submitted**: All evidence submitted, awaiting review/approval
  - **Verified**: All evidence approved — instance complete
  - **Overdue**: Completion window passed without all evidence being submitted/approved
  - **Missed**: Entire grace period expired without completion (permanent failure record)
  - **Skipped**: Intentionally skipped by an authorized user with a documented reason
- **FR-023**: State transitions MUST be enforced (e.g., cannot go from "Verified" back to "Open").
- **FR-024**: When a ritual instance becomes overdue, the system MUST notify the assignee and their manager.
- **FR-025**: When a ritual instance is marked "missed", it MUST remain as a permanent compliance gap record.
- **FR-026**: A ritual instance MAY be manually created outside the normal schedule (ad-hoc run) by an authorized user.
- **FR-027**: Ritual instances MUST support the existing task features where applicable: comments (via linked chat channel), file attachments, and assignment changes.

### Functional Requirements — Evidence & Checklist

- **FR-030**: A ritual definition MUST be able to define an ordered list of **evidence requirements** (a checklist for each instance).
- **FR-031**: Each evidence requirement specifies: name, description, evidence type(s) accepted, whether it is required or optional, and an optional deadline (time-of-day or relative to instance start).
- **FR-032**: Supported evidence types MUST include:
  - **Photo/Image** — with captured-at timestamp and GPS coordinates embedded in metadata
  - **Voice memo** — audio recording with timestamp
  - **PDF / Document** — uploaded file
  - **File** — any file type (reuses existing file storage system)
  - **Link** — URL reference
  - **Text note** — free-form text entry
  - **GPS check-in** — location coordinates with timestamp (no photo required)
- **FR-033**: Photo evidence MUST capture and store the device timestamp and GPS location at the moment of capture (not upload time). The system MUST record both device-reported and server-received timestamps. On mobile, the app MUST enforce in-app camera capture (no gallery selection) to ensure metadata authenticity. On web, file upload is allowed with a note that metadata may be less reliable.
- **FR-034**: Each evidence submission MUST be associated with exactly one evidence requirement on the ritual instance.
- **FR-035**: Each evidence requirement MUST have an **approval mode**:
  - **Manual** — requires explicit approval by an authorized reviewer (project admin/owner or designated approver)
  - **Auto-approve** — system automatically approves based on configurable rules (e.g., GPS within geofence, timestamp within window)
  - *(Future)* **External automation** — will be supported via the upcoming workflow automation system, allowing third-party integrations to approve/reject evidence programmatically
- **FR-036**: For v1 auto-approve evidence, the system MUST validate against two criteria:
  - GPS: submitted within a defined radius of a target location
  - Time: submitted before a specific deadline
  - Additional auto-approval criteria may be added in future versions via the workflow automation system.
- **FR-037**: Manual evidence review MUST support: approve, reject (with required comment), and request re-submission.
- **FR-038**: When evidence is rejected, the assignee MUST be notified and the ritual instance MUST return to "In Progress" state for re-submission.
- **FR-039**: Each evidence submission MUST track: who submitted it, when, approval status, who approved/rejected, approval timestamp, and any reviewer comments.
- **FR-040**: *(Deferred)* Webhook/external-system evidence submission is not included in v1. This will be supported via the upcoming workflow automation system, which will provide a unified integration layer for external apps to interact with rituals (including evidence submission and approval).

### Functional Requirements — Operational Health & Visibility

- **FR-050**: The system MUST provide an **operational health dashboard** for managers showing compliance status across ritual definitions.
- **FR-051**: The dashboard MUST display: on-time completion rate, overdue instances, missed instances, and pending reviews — filterable by time range, ritual definition, assignee, and department.
- **FR-052**: Managers MUST be able to see a per-employee compliance summary showing each employee's ritual completion rate and any outstanding items.
- **FR-053**: The system MUST calculate and display a **health score** per ritual definition (percentage of on-time, verified completions over a configurable time window). Default threshold: 80% on-time completion = green (healthy). Below 80% = yellow (at risk). The threshold is configurable per project by owners/admins.
- **FR-054**: The system MUST send proactive notifications to managers when:
  - A ritual instance becomes overdue
  - An instance is about to become overdue (warning threshold, e.g., 80% of window elapsed)
  - A pattern of missed rituals is detected (e.g., same ritual missed 3+ times)
- **FR-055**: Employees MUST have a **"Today" view** (Quick Info sidebar) showing all ritual instances due today, their deadlines, and completion status. This is the primary interface for field workers and operational staff.
- **FR-056**: The "Today" view MUST prioritize and sort by: overdue items first, then items closest to deadline, then upcoming items.

### Functional Requirements — Compliance & Audit Readiness

- **FR-060**: All evidence submissions, approvals, rejections, and state changes MUST be immutably logged for audit purposes.
- **FR-061**: The audit log MUST include: who, what, when, and the before/after state of each change.
- **FR-062**: Evidence files and metadata MUST NOT be deletable by regular users once submitted. Only system administrators may purge data per retention policies.
- **FR-063**: The system SHOULD structure ritual data in a way that supports future compliance framework mapping (e.g., linking rituals to ISO 27001 controls or SOC 2 criteria) without adding compliance-specific features now. This means: each ritual definition SHOULD support tagging/categorization and external reference identifiers.
- **FR-064**: The system MUST support exporting ritual completion history and evidence for external audit purposes in CSV format.

### Functional Requirements — Notifications & Alerts

- **FR-070**: Ritual-related events MUST integrate with the existing notification system.
- **FR-071**: Notification events MUST include: ritual instance assigned, evidence submitted for review, evidence approved/rejected, instance overdue, instance missed, upcoming deadline reminder.
- **FR-072**: Notification preferences MUST be configurable per-project (reuse existing `notification_preference` on project membership).

### Key Entities

- **Project (extended)**: Existing project entity, extended with a collaboration mode (standard / ritual / mixed) as a UI display hint. All existing project features (membership, roles, visibility) apply to ritual operations.
- **Ritual Definition**: A template for a recurring task. Belongs to a project. Contains: name, description, recurrence schedule, completion window, timezone, default assignee(s), active/archived status, optional tags/categories. One ritual definition produces many ritual task instances over time.
- **Ritual Task Instance**: A single occurrence of a ritual for a specific date/time. Lifecycle: Scheduled → Open → In Progress → Submitted → Verified (or → Overdue → Missed, or → Skipped). Linked to its parent ritual definition. Can have a chat channel for comments, file attachments, and assigned employees.
- **Evidence Requirement**: Defined on a ritual definition. Specifies: name, accepted evidence types, required/optional, deadline within the window, and approval mode (manual / auto-approve). Each ritual instance inherits these requirements as a checklist.
- **Evidence Submission**: An actual piece of evidence submitted by a worker against a specific evidence requirement on a specific ritual instance. Contains: the file/text/link/GPS data, device metadata (timestamp, location), approval status (pending / approved / rejected), reviewer info, reviewer comments.
- **Operational Health Snapshot**: Aggregated metrics per ritual definition and per employee over a time period. Used for the health dashboard. Contains: total instances, on-time count, overdue count, missed count, completion rate.
- **Audit Log Entry**: Immutable record of every state change, evidence submission, and approval action. Contains: actor, action, timestamp, before/after state, ritual instance reference.

### Relationship to Existing Entities

- **Ritual Task Instance ↔ Task**: Ritual instances share many properties with existing tasks (assignees, states, comments, files) but have distinct lifecycle states and are generated automatically rather than created manually. The relationship model (specialized task type vs. separate entity) is an implementation decision to be resolved during planning.
- **Evidence Submission ↔ Files**: Evidence files reuse the existing `files.file_metadata` system with a new upload context (e.g., "ritual_evidence"). GPS and timestamp metadata are stored alongside the file reference in the evidence submission record.
- **Notifications**: Ritual events produce notifications via the existing `notification.notification` system with `source_domain = 'projects'` and new `notification_type` values for ritual-specific events.
- **Project State Categories**: Existing project states use categories: `todo`, `in_progress`, `done`, `cancelled`. Ritual instances introduce new state categories to represent the evidence-driven lifecycle (`submitted`, `verified`, `overdue`, `missed`, `skipped`). These will be defined as a separate state model for ritual instances — not mixed into the existing project_state enum.

### Scale & Distribution Considerations

- **Instance generation volume**: A single ritual definition recurring daily across 100 employees generates ~36,500 instances/year. Organizations with 50 ritual definitions could see ~1.8M instances/year. The system must handle this volume for queries, aggregations, and retention.
- **Evidence storage**: Each instance may have 3-5 evidence items (photos, files). With 1.8M instances/year, that's 5-9M files/year per large organization. Evidence files use the existing file storage system (R2) and quota management.
- **State lifecycle**: Ritual instances follow a defined lifecycle. Once an instance reaches a terminal state (Verified, Missed, Skipped), it becomes immutable and is retained for audit.
- **Data retention**: Retention period for completed ritual instances and evidence is **configurable per organization** (potential premium feature). Default: keep indefinitely. Evidence files are subject to the organization's existing file storage quota — organizations can purchase additional storage to retain evidence long-term. Ritual metadata (instance records, audit logs) is lightweight and retained indefinitely by default.
- **Real-time updates**: The "Today" view and health dashboard should reflect state changes within seconds (reuse existing notification/SSE infrastructure).
- **Multi-instance resilience**: Ritual instance generation (the scheduler) must be idempotent — if the scheduler runs twice, it should not create duplicate instances.

---

## Review & Acceptance Checklist

### Content Quality
- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

### Requirement Completeness
- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

---

## Execution Status

- [x] User description parsed
- [x] Key concepts extracted
- [x] Ambiguities marked (14 resolved, 2 remaining)
- [x] User scenarios defined
- [x] Requirements generated
- [x] Entities identified
- [x] Review checklist passed

---

## Resolved Clarifications

| # | Area | Resolution |
|---|------|------------|
| 1 | Project mode | Mode is a UI display hint, changeable anytime. No strict enforcement — users can create any task type. |
| 2 | Recurrence | Structured recurrence builder is sufficient for v1. No cron expressions. |
| 3 | Seasonal activation | Deferred. Not in v1. |
| 4 | Photo capture | Mobile: enforce in-app camera. Web: allow file upload. |
| 5 | Auto-approval criteria | GPS geofence + time window only for v1. Future criteria via workflow automation. |
| 6 | Webhook auth | Deferred. Webhooks will come via workflow automation system. |
| 7 | Health score | Default 80% on-time = healthy, configurable per project. |
| 8 | Export formats | CSV for v1. |
| 9 | Assignee departure | Warn managers via notification. Manager must manually reassign. |
| 10 | Schedule changes | Regenerate future unstarted instances (calendar-event pattern). Or retire + recreate. |
| 11 | Ritual ↔ Task relation | Implementation decision — deferred to planning phase. |
| 12 | State categories | Separate state model for ritual instances (not mixed into existing enum). |
| 13 | Data retention | Configurable per org (potential premium feature). Default: keep indefinitely. Files follow org quota. |
| 14 | Instance generation window | Rolling window proportional to interval (daily→30d, weekly→8w, monthly→3mo, quarterly+→2 upcoming). |

## Open Clarifications Summary

All clarifications resolved. Spec is ready for planning.

---
