# Research: Ritual Submission Flow

## Decision 1: Use Ritual Instance Tasks as the Only Live Submission Surface

- **Decision**: Evidence submission actions will only appear from a specific ritual instance task, never from the ritual definition editor.
- **Rationale**: Evidence submissions are attached to `task_id`, while evidence requirements belong to the ritual definition. Keeping submissions instance-scoped prevents users from confusing template setup with live work and aligns with the current backend data model.
- **Alternatives considered**:
  - Allow submission from the ritual definition screen: rejected because it breaks the instance-specific audit trail and confuses workers.
  - Allow submission directly from list cards: rejected because it hides task context such as deadline, state, prior submissions, and reviewer feedback.

## Decision 2: Preserve Platform-Specific Interaction Patterns

- **Decision**: Web keeps inline task-detail submission and review context, while mobile keeps a dedicated requirement-focused capture screen launched from task detail.
- **Rationale**: Web is better for side-by-side checklist, history, and review actions. Mobile is better for camera, GPS, and quick field capture in a focused screen. The intent stays the same even though the interaction pattern differs.
- **Alternatives considered**:
  - Force both platforms into the same screen structure: rejected because it would either overload mobile or underuse web workspace affordances.
  - Move web submission to a full-page flow: rejected because the current task-detail composition already matches reviewer and worker workflows well.

## Decision 3: Add a Web-First Reviewer Backlog Surface

- **Decision**: Reviewers will have a web-first backlog surface for pending ritual evidence across task instances, while keeping per-task review actions in task detail.
- **Rationale**: The current web review panel is task-local. The spec requires reviewers to identify pending work without opening every task individually. Web is the appropriate place for multi-instance review triage.
- **Alternatives considered**:
  - Keep only task-local review panels: rejected because it does not satisfy the need for backlog visibility.
  - Build a full mobile backlog review queue in the first iteration: rejected because mobile review is expected to be urgent/task-focused rather than backlog-heavy.

## Decision 4: Support Task-Level Urgent Review on Mobile but Keep Backlog Management Web-First

- **Decision**: Mobile will support task-level review context for authorized managers on a ritual instance, but project-wide backlog review remains web-first.
- **Rationale**: The original request explicitly includes both app and web. Managers on mobile need a way to act when arriving from a notification or directly opening a task, but mobile should not carry the primary backlog management workload.
- **Alternatives considered**:
  - No mobile review support at all: rejected because it leaves managers with no app-side action path.
  - Full parity with a mobile backlog queue: rejected for MVP because it increases scope without matching the strongest use case.

## Decision 5: Route All Daily Work and Notification Entry Points to Task Instances

- **Decision**: Today views, task lists, and ritual-related notifications will open ritual instance detail views, optionally focused on a specific requirement or review intent.
- **Rationale**: Workers and reviewers should arrive in the place where the action happens. This reduces navigation ambiguity and supports both submission and review flows from upstream surfaces.
- **Alternatives considered**:
  - Route some links to the ritual definition page: rejected because definitions are not the place for live evidence work.
  - Route notifications only to generic project pages: rejected because users would need extra navigation to find the affected instance.

## Decision 6: Reuse Existing Collaboration Ritual APIs Before Adding New Backend Contracts

- **Decision**: Implementation should first reuse `getTask`, `listTasks`, `getRitualDefinition`, `listEvidenceSubmissions`, `submitEvidence`, `approveEvidence`, and `rejectEvidence` through `frontend/packages/apis`. Only add an additive collaboration read API if the pending-review backlog cannot be built from current task/evidence projections.
- **Rationale**: The repo already has typed ritual/task wrappers and instance-level review APIs. Reusing them reduces risk and avoids unnecessary schema/proto churn.
- **Alternatives considered**:
  - Add a new review-queue backend endpoint immediately: rejected because current task evidence progress may already be sufficient.
  - Build the review queue from raw frontend data joins without wrappers: rejected because the constitution requires typed wrapper usage and discourages ad hoc coupling.

## Decision 7: Treat Evidence Submissions as Historical Records, Not Mutable Drafts

- **Decision**: Approved or rejected evidence remains visible as submission history; workers resubmit rather than editing a historical submission in place.
- **Rationale**: This matches ritual compliance expectations, supports reviewer feedback, and aligns with the current `pending_review` / `approved` / `rejected` model.
- **Alternatives considered**:
  - Allow in-place editing of prior submissions: rejected because it weakens audit clarity and makes reviewer decisions harder to reason about.
  - Hide rejected submissions after resubmission: rejected because workers and reviewers still need the prior context.

## Decision 8: Preserve Stable Test Hooks on Review and Routing Surfaces

- **Decision**: The project review tab, review backlog actions, and routing-focused review controls must expose stable `data-testid` hooks as part of release readiness.
- **Rationale**: This feature depends heavily on route intent and cross-surface entry behavior. Stable selectors reduce flakiness in Playwright coverage and make it easier to prove that review and notification paths still land on the correct ritual instance context.
- **Alternatives considered**:
  - Rely only on visible text and generic button selectors: rejected because copy is more likely to change during UX refinement and does not uniquely identify routing actions.
  - Limit selectors to task-detail surfaces only: rejected because the new backlog and project review tab are also part of the user-facing contract.

## Release Validation Focus

- Validation must cover backend notification and review-state contracts, web route-focus behavior, and the seeded mobile worker smoke path.
- Release notes should explicitly call out any environment dependency that blocks Maestro execution so the mobile path is not silently skipped.
