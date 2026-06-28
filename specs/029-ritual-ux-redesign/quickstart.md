# Quickstart: Ritual UX Redesign

## Purpose

Validate that standard, ritual, and mixed collaboration modes open the correct default surfaces, keep workstreams legible, and send workers and reviewers into the correct live ritual context on both web and mobile.

## Preconditions

- Backend and both frontend clients can authenticate against the same environment.
- Test data includes:
  - one standard project with active planned work
  - one ritual project with overdue, due-today, pending-review, and rejected ritual runs
  - one mixed project with both standard tasks and ritual runs due today
- At least one project owner or reviewer and one assigned employee exist in the same organization.
- Notifications can be triggered for pending review and rejected proof.
- Mobile Maestro environment values are configured if mobile automation is executed.

## Manual Validation Flows

### 1. Standard Mode Default Landing

1. Sign in as any project member.
2. Open `/workspace/tasks` and select a standard project without specifying a view.
3. Confirm the initial surface is planning-oriented and consistent with standard work.
4. Confirm ritual-only navigation items such as `Review`, `Health`, or `Routine Operations` are not presented as the primary standard IA.
5. Open the equivalent legacy `/workspace/projects` URL and confirm it redirects to the same `/workspace/tasks` destination without losing the selected view.

### 2. Ritual Mode Worker Entry

1. Sign in as an assigned employee.
2. Open `/workspace/tasks` and choose a ritual project without specifying a view.
3. Confirm the initial surface is `Today`, not the generic board.
4. Confirm the page groups ritual runs in urgency-first or action-first sections such as overdue, today, upcoming, or resubmission-oriented states, while pending-review awareness remains a secondary cue rather than the primary worker action bucket.
5. Open a ritual run that is missing proof or needs resubmission.
6. Confirm the destination is the live ritual instance and the affected requirement is easy to identify.

### 3. Ritual Mode Owner and Reviewer Entry

1. Sign in as an owner or reviewer.
2. Open `/workspace/tasks` and enter a ritual project.
3. Confirm `Today`, `Review`, `Health`, `Calendar`, and `Worklist` are distinct surfaces, and that any board-like ritual view is not the default or first ritual call to action.
4. Open `Review` and confirm pending ritual submissions are visible without browsing unrelated task detail first.
5. Open `Health` and confirm it summarizes compliance or overdue risk instead of acting like a worker checklist.
6. Open ritual settings or definitions and confirm template management is separate from live execution.

### 4. Mixed Mode Overview and Today Separation

1. Sign in as a member of a mixed project.
2. Open `/workspace/tasks` and enter the mixed project without specifying a view.
3. Confirm the initial surface is `Overview`.
4. Confirm the overview summarizes both planned work risk and routine operational exceptions.
5. Open `Today` and confirm standard tasks and ritual runs appear in separate labeled sections.
6. Open `Planned Work` and confirm only standard-task planning views appear.
7. Open `Routine Operations` and confirm only ritual-oriented browsing and shortcuts appear.

### 5. Web Ritual Instance Separation

1. Open a ritual instance from `Today`, `Worklist`, `Review`, or a notification.
2. Confirm the URL resolves under `/workspace/tasks/...` rather than `/workspace/projects/...`.
3. Confirm the page presents:
   - what to do
   - proof checklist
   - reviewer decisions when relevant
   - template guidance as secondary context
4. Confirm workers do not see template editing as the main action.
5. Confirm reviewers can identify the affected requirement when arriving from review intent.
6. Open a skipped, detached, or already completed ritual instance and confirm the instance-specific exceptional context is preserved without implying the reusable template changed.

### 6. Mobile Worker Flow

1. Sign in as an assigned employee on mobile.
2. Open the Tasks tab in focus mode.
3. Confirm ritual work is grouped into obvious sections such as overdue, today, and upcoming.
4. Open a ritual run and confirm the destination is the live task detail, not the ritual definition page.
5. Trigger a common proof action and confirm the next step is phrased as a direct action instead of an abstract status.
6. Complete the action and confirm the user returns to the same ritual instance with refreshed state.

### 7. Mobile Manager Review Entry

1. Sign in as a reviewer or owner on mobile.
2. Open a pending-review alert.
3. Confirm the destination reaches the relevant ritual instance and highlights the pending proof.
4. If task-level mobile review is implemented, approve or reject the submission and verify the refreshed result.
5. Confirm backlog-heavy triage is not treated as the main mobile review pattern.

### 8. Notification Routing

1. Trigger a pending-review notification and a rejected-proof notification.
2. Open each notification on web and mobile.
3. Confirm the web routes land under `/workspace/tasks/...` and the mobile routes still land on the relevant live ritual context.
4. Confirm both routes land on the relevant ritual instance or review-focused context rather than on a ritual template editor or a generic project shell.

## Scenario Contract Targets

- Backend integration: `backend/integration/collaboration_ritual_ux_redesign_test.go`
- Web E2E: `frontend/apps/web/e2e/ritual-ux-redesign.spec.ts`
- Mobile Maestro: `frontend/apps/mobile/.maestro/ritual-ux-redesign.yaml`

## Cross-Platform Validation Checklist

- [ ] Backend integration suite passes.
- [ ] Web E2E suite passes.
- [ ] Mobile TypeScript preflight passes.
- [ ] Mobile Maestro ritual UX flow passes.
- [ ] Manual ritual worker entry flow matches the Today-first contract.
- [ ] Manual owner or reviewer separation across Review, Health, Calendar, and Worklist is verified.
- [ ] Manual mixed-project Overview, Today, Planned Work, and Routine Operations separation is verified.
- [ ] Notification routing opens the live ritual instance with the correct focus context on web and mobile.
- [ ] Stable web `data-testid` hooks exist for new navigation and overview controls.
- [ ] `SC-006` baseline and rollout label are recorded before launch.

## Rollout Measurement

- Tag support tickets, in-product feedback, or release-review notes related to ritual entry confusion under a shared label such as `ritual-navigation-confusion`.
- Capture the count for the release cycle immediately before launch as the SC-006 baseline.
- During the first release cycle after launch, compare the tagged count against that baseline.
- Success for `SC-006` is a reduction of at least 30% in confusion reports tied to finding today’s ritual work, ritual review, or ritual template editing.

## SC-006 Baseline Record

- Baseline audit date: 2026-04-21
- Repository audit result: no existing `ritual-navigation-confusion` records were found in repository-tracked docs, notes, or spec artifacts.
- Source of truth for the metric: support tracker, in-product feedback queue, or release-review log for the immediately previous release cycle.
- Shared rollout label: `ritual-navigation-confusion`
- Previous release cycle confusion count: `REQUIRED BEFORE SHIP`
- Baseline owner: release manager or product operations owner for the rollout
- Launch gate: do not mark this feature release-ready until the numeric previous-cycle count is entered here.
- Zero-baseline handling: if the external baseline count is `0`, raise it to the release owner because the percentage-reduction target in `SC-006` becomes undefined without an explicit waiver or alternate measurement note.

### Metric Collection Procedure

1. Apply the shared `ritual-navigation-confusion` label to support tickets, in-product feedback, and release-review notes that mention finding today’s ritual work, ritual review, or ritual template editing.
2. Before shipping, export the count for the immediately previous release cycle and record that number in the baseline field above.
3. During the first release cycle after launch, export the post-launch count using the same label and the same release-window boundaries.
4. Compute the reduction with $reduction = \frac{baseline - postLaunch}{baseline} \times 100\%$ and compare it against the `SC-006` target.

## Execution Targets During Implementation

- Backend integration suite: `cd backend && go test ./integration/...`
- Web E2E suite: `cd frontend/apps/web && pnpm e2e`
- Mobile TypeScript preflight: `cd frontend && pnpm run typecheck:mobile`
- Mobile Maestro coverage: `cd frontend/apps/mobile && ./scripts/run-maestro-coverage.sh`

## Execution Notes

1. Run the backend integration suite first so routing, read-model, and notification regressions are caught before browser or device validation.
2. Run web E2E second. The Playwright config starts the web app on `127.0.0.1:3100`, so the backend and auth dependencies must already be reachable.
3. Run mobile TypeScript preflight before Maestro so broken native route or linking changes fail fast.
4. Run Maestro last after setting the required mobile environment variables documented in the scenario scaffold.
5. Record each command outcome with pass or fail status, the date, and any blocking environment issue in the release notes or validation log.
6. Include explicit verification that legacy `/workspace/projects` links redirect to `/workspace/tasks` while preserving query state and ritual focus intents.

## Release-Readiness Checks

1. Confirm default landing behavior is stable for all three collaboration modes.
2. Confirm mixed-mode workstream separation is visible in entry surfaces, not only after filtering.
3. Confirm ritual alerts and today/worklist rows still route to ritual instances with the correct focus context under the `/workspace/tasks` route family.
4. Confirm web controls added for overview, review, or worklist interactions expose stable `data-testid` hooks.
5. Confirm mobile copy and action labels remain task-first and understandable for low-tech workers.
6. Confirm the SC-006 rollout measurement label and baseline are in place before launch.
7. Confirm bookmarked or shared legacy `/workspace/projects` links redirect cleanly to their `/workspace/tasks` equivalents.