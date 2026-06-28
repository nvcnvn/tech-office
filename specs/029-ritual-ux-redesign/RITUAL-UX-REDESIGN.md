# Ritual UX Redesign Proposal

## Purpose

Ritual tasks should not feel like standard project tasks with a recurrence field attached.
They serve a different job:

- Standard tasks help teams manage one-off work.
- Ritual tasks help teams complete recurring operational work on time, with proof and review.

The product currently exposes ritual features, but the top-level UX still teaches users a generic kanban mental model first. That creates confusion for owners and employees, especially in ritual and mixed projects.

This document proposes a clearer information architecture and interaction model for ritual-first work.

## Current Problems

### 1. Wrong first impression

Users choose `standard`, `ritual`, or `mixed`, but the project still opens like a generic board-based PM tool. That contradicts the intended product model for ritual projects.

### 2. Mixed mode collapses two different task models into one mental model

Standard tasks and ritual instances have different purposes, states, and success criteria:

- Standard tasks move through project progress.
- Ritual instances move through operational compliance and proof verification.

When they are mixed into the same default board/status language, users must infer too much.

### 3. Worker entry points are not obvious enough

Employees should immediately understand:

- what is due now,
- what proof is missing,
- what needs resubmission,
- what is waiting on review.

The task detail surface supports this reasonably well, but the project-level navigation does not consistently guide users there first.

### 4. Owner and employee goals are different but presented too similarly

Owners need:

- operational health,
- overdue visibility,
- review backlog,
- template management.

Employees need:

- today’s assigned runs,
- proof checklist,
- one obvious next action.

These should not share the same default landing experience.

### 5. Ritual definition management is too close to live work in the user’s mental model

The instance page already separates template guidance from live proof and review, but the surrounding navigation still makes it too easy to think “rituals” means both template editing and run completion in the same place.

## Product Principles

### 1. Ritual is an operations workflow, not a board variant

Ritual UX should be designed around recurring execution, missed-work prevention, proof capture, and review.

### 2. The primary ritual question is not “what column is this in?”

The primary questions are:

- Is it due?
- Has it been started?
- Is proof complete?
- Is it verified?
- Is it overdue or missed?

### 3. Entry points must be role-appropriate

- Employees should land in task-first, today-first flows.
- Owners should land in health-first, exception-first flows.

### 4. Mixed mode should separate work types without hiding either

Mixed mode should be a combined workspace with clear lanes, not a single flattened list that makes users decode the task kind every time.

### 5. Template and instance should stay visibly separate

- Templates define recurring rules.
- Instances are the live runs people actually perform.

Changing one should never feel like editing the other.

### 6. Daily language should be task-first

For frontline workers, the clearest mental model is usually not:

- project,
- workspace,
- operation,
- work area.

It is:

- task,
- today,
- overdue,
- what do I need to do now?

The product should therefore use `Tasks` as the primary day-to-day language for all users, and treat the higher-level organizing container as a secondary concept.

### 7. Use one universal word where possible

`Tasks` works well across all target audiences:

- plumbers,
- field workers,
- retail staff,
- office staff,
- software engineers.

Engineers may still need richer planning layers such as board, milestone, or planning views, but that does not require replacing the core day-to-day word `Tasks`.

## Terminology Direction

### Primary user-facing term: Tasks

The primary user-facing module should remain `Tasks`.

Reasoning:

- It is the most universally understood word across your target users.
- It matches the real day-to-day question workers ask themselves.
- It still feels normal to software engineers.
- It avoids forcing users to understand a container model before they can act.

Recommended usage:

- top-level navigation: `Tasks`
- primary worker landing: `My Tasks` or `Today`
- urgency views: `Overdue`, `Needs Review`, `Upcoming`

### Organizing container: secondary concept only

The current `project` concept should not be the primary mental model for frontline users.

If the product still needs a user-facing label for that organizing container, it should be treated as a secondary management concept, used mostly when someone needs to browse, configure, or organize groups of tasks.

Candidate label:

- `Work Area`

This is acceptable as a secondary term, but it should not replace `Tasks` as the main frontline navigation concept.

### Routing direction

The main user-facing route should stay conceptually aligned with `Tasks`, not with an abstract container.

Recommended structure:

- `/tasks` = the main day-to-day work entry
- container detail routes remain a structural implementation detail and do not need to dominate the terminology shown to workers

## Target Mental Models

### Standard Project

"We track project work here."

Primary surfaces:

- Tasks
- Board
- List
- Gantt
- Calendar

### Ritual Project

"I check my tasks, complete them, and submit proof when needed."

Primary surfaces:

- Today
- Tasks
- Health
- Review
- Calendar

Secondary surfaces:

- Standard task list or board for occasional ad-hoc work
- Ritual template settings

### Mixed Project

"I have tasks from planned work and routine operations, and the app should make both easy to find."

Primary surfaces:

- Overview
- Today
- Tasks
- Planned Work
- Routine Operations
- Review
- Health

## Proposed Information Architecture

## Web

### A. Default landing by collaboration mode

- `standard` opens `Board`
- `ritual` opens `Today`
- `mixed` opens `Overview`

If the URL already specifies a view, respect it. The change only applies when users enter the project without a selected view.

At the product-navigation level, users should still think of the module as `Tasks`, not `Projects`.

### B. Replace flat tab thinking with mode-appropriate top-level navigation

#### Standard

- Tasks
- Board
- List
- Gantt
- Calendar
- Analytics
- Settings

#### Ritual

- Today
- Tasks
- Health
- Review
- Calendar
- Worklist
- Settings

`Worklist` is the place for all ritual instances in sortable/filterable list form. It is not a kanban-first surface.

#### Mixed

- Overview
- Today
- Tasks
- Planned Work
- Routine Operations
- Review
- Health
- Settings

Where:

- `Planned Work` contains standard-task views such as Board and List.
- `Routine Operations` contains ritual-instance views such as Worklist, Calendar, and definition access.

### C. Add an Overview surface for mixed projects

This is the missing bridge between the project setup choice and the day-to-day experience.

The mixed Overview should answer, in one screen:

- What needs action today?
- What is overdue?
- What is waiting for review?
- What standard project work is at risk?

Suggested sections:

- `Needs attention now`
  - overdue ritual runs
  - pending reviews
  - blocked or overdue standard tasks
- `Today`
  - ritual runs due today
  - optionally top 3 standard tasks due today
- `Routine operations`
  - compliance snapshot
  - health trend
- `Planned work`
  - standard task progress snapshot

This becomes the orientation layer mixed projects currently lack.

### D. Stop using the generic board as the primary ritual surface

For ritual work:

- Do not default to the current 3-column kanban board.
- Do not treat ritual instances as just another card in the same column model.

If a ritual board exists at all, it should be a specialized compliance board using ritual-specific statuses such as:

- Open
- In Progress
- Submitted
- Verified
- Overdue
- Missed

Even then, this should be secondary to Today, Worklist, and Health.

### E. Make mixed separation explicit everywhere

In mixed surfaces, replace subtle badges with structural separation.

Examples:

- Separate sections for `Standard tasks` and `Ritual runs`
- Separate filters with clear labels, not only color chips
- Different empty states and call-to-actions per work type

Users should not need to scan every row just to discover what kind of item it is.

## Web Ritual Instance Design

The current task detail direction is mostly correct and should be preserved.

Recommended instance layout:

1. `What to do`
   - ritual title
   - clear instructions
   - due window
   - assignee context

2. `Proof checklist`
   - one row per requirement
   - clear state per item: Needed, Awaiting review, Needs resubmission, Approved
   - one obvious action per row

3. `Reviewer decisions`
   - visible when relevant
   - placed after checklist for workers
   - more prominent when opened from review intent

4. `Template guidance`
   - read-only for most users
   - clearly framed as reusable template settings

5. `Task discussion and attachments`
   - secondary to the ritual execution flow

### Instance rules

- Proof submission actions appear only on the live instance.
- Template editing never appears as the primary action for a worker.
- Review actions should highlight the affected requirement when arriving from notifications.
- Detached and skipped instances should keep their exceptional context visible.

## Mobile

Mobile should be even more task-first than web.

### A. Keep mobile employee flow centered on Focus and task detail

The mobile tasks tab already points in the right direction with a `focus` mode. That should become the canonical ritual-worker experience.

Mobile employee journey:

1. Open `Tasks`
2. See grouped `Overdue`, `Today`, `Upcoming`
3. Tap the ritual run
4. See instructions and proof checklist
5. Complete the next missing requirement
6. Return to the same instance with updated status

### B. Keep ritual definition screens out of the everyday worker path

The route for ritual definition detail should remain a deliberate management path, not a likely destination from day-to-day task lists or alerts.

Workers should rarely, if ever, open a ritual definition directly.

### C. Mobile should favor one-step capture actions

For common requirement types, the list row should make the next action obvious:

- `Take photo`
- `Check in now`
- `Add note`
- `Fix proof`

Avoid forcing workers to interpret abstract statuses before acting.

### D. Mobile review should be lightweight, not backlog-heavy

Managers can review on mobile, but the main review backlog remains a web-first experience.

On mobile:

- allow opening a specific pending item from an alert,
- show the pending proof clearly,
- support approve/reject when needed,
- avoid making mobile the primary place for scanning large review queues.

## Role-Based Entry Points

### Employee

Primary questions:

- What do I need to do now?
- What proof is still missing?
- What got rejected?

Default ritual entry points:

- Today
- Alerts deep-linking into the exact ritual instance
- Assigned work sections in mobile Focus mode

### Owner / Admin / Reviewer

Primary questions:

- What is overdue?
- What is unverified?
- Who is falling behind?
- Which ritual definitions are unhealthy?

Default ritual entry points:

- Health
- Review
- Definition settings

### Dual-role users

If a user is both submitter and reviewer, keep both capabilities visible on the instance page, but preserve section boundaries:

- `Your proof`
- `Review actions`

Do not collapse them into a single ambiguous panel.

## Mixed Mode Interaction Model

Mixed mode is where the current UX breaks hardest.

The fix is not to hide either task type. The fix is to make both work streams legible.

### Recommended mixed model

#### Overview

Cross-stream summary and exceptions.

#### Today

Urgency-first daily work with two clearly labeled sections:

- Ritual runs due today
- Standard tasks due today

Do not interleave them into one undifferentiated list.

#### Planned Work

Standard-task views only.

Contains:

- Board
- List
- Gantt

#### Routine Operations

Ritual-specific views only.

Contains:

- Worklist
- Calendar
- Definitions shortcut

#### Review

Pending ritual proof across the project.

#### Health

Operational compliance and trend visibility.

## Specific UX Changes To Prioritize

### P0

- Change default project landing by collaboration mode.
- Add mixed `Overview` surface.
- Stop using the generic board as the ritual-first landing experience.
- Separate `Planned Work` and `Routine Operations` in mixed mode.

### P1

- Rework Today for mixed projects into two explicit sections instead of a blended stream.
- Rename ritual-facing navigation labels to operational language, not generic PM language.
- Keep review and health surfaces visible and first-class in ritual and mixed modes.

### P2

- Evaluate whether ritual needs a specialized board at all.
- Add stronger progressive disclosure around template editing versus live instance action.
- Improve owner onboarding copy when a ritual or mixed project is first created.

## Naming Recommendations

Avoid overly abstract labels.

Prefer:

- `Tasks`
- `Today`
- `Review`
- `Health`
- `Planned Work`
- `Routine Operations`
- `Ritual Templates`

Avoid relying only on:

- `Board`
- `Rituals`

Those labels are too broad on their own in mixed contexts.

Clarification:

- `Tasks` should remain the primary top-level daily-work term.
- The warning above applies to using a single broad label as the only name for every mixed-mode sub-surface.
- Inside mixed mode, pair `Tasks` with clearer secondary labels like `Planned Work` and `Routine Operations`.

Also avoid making these the primary frontline term:

- `Project`
- `Workspace`
- `Operation`
- `Work Area`

These can be useful as secondary organizational language, but they are weaker than `Tasks` for everyday worker navigation.

## Success Criteria

The redesign is successful when:

- A first-time employee can open a project and immediately know where today’s ritual work lives.
- A first-time owner can tell the difference between ritual health, ritual review, and ritual template management without training.
- Mixed projects no longer feel like a broken compromise between two incompatible task systems.
- Users stop interpreting ritual work through the generic kanban lens by default.

## Suggested Implementation Sequence

### Phase 1: Navigation correction

- Mode-aware default landing
- Mixed Overview page
- Separate mixed top-level navigation labels

### Phase 2: Today and workstream separation

- Split mixed Today into standard versus ritual sections
- Add Routine Operations worklist
- Reduce ritual dependence on the generic board

### Phase 3: Refinement

- Improve onboarding and empty states
- Clarify template management entry points
- Tune mobile manager review and mobile worker capture flow

## Summary

The ritual UX should be treated as one of the product’s signature workflows.

The right goal is not to make ritual fit better inside a generic PM shell.
The right goal is to make the product clearly express that it supports two different kinds of work:

- project execution,
- recurring operations.

When the interface makes that distinction obvious, the current ritual features become much easier to understand and use.