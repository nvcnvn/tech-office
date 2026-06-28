# Quickstart: Ritual Submission Flow

## Purpose

Validate that workers and reviewers can reach the correct ritual surfaces on web and mobile, complete the main submission/review flows, and distinguish instance work from template management.

## Preconditions

- Backend is running with ritual/task data available.
- Web app and mobile app can authenticate against the same environment.
- Mobile Maestro env file is populated at `frontend/apps/mobile/.maestro/.env`.
- Test users exist for:
  - an assigned employee
  - a project owner or reviewer
  - a project owner who is also assigned to a ritual instance
- At least one ritual instance exists with:
  - one missing requirement
  - one pending-review submission
  - one rejected submission
- The seeded happy-path ritual instance used for Maestro has:
  - a stable task row label visible in the Tasks tab
  - at least one requirement label visible in the task detail screen
  - a submission flow that ends with a stable success message or approved-state label

## Manual Validation Flows

### 1. Web Worker Submission Flow

1. Sign in as an assigned employee.
2. Open a ritual item from a project list or today view.
3. Confirm the destination is the ritual instance task, not the definition editor.
4. Confirm the task shows:
   - ritual instructions context
   - proof checklist
   - current status for each requirement
5. Submit proof for a missing requirement.
6. Confirm the UI returns to the same task instance and refreshes the checklist state.

### 2. Web Reviewer Backlog and Task Review Flow

1. Sign in as a project reviewer.
2. Open the reviewer-oriented pending ritual submissions surface.
3. Confirm multiple pending items can be identified without opening every task first.
4. Open one pending item.
5. Approve or reject the evidence from the review context.
6. Confirm the ritual instance reflects the updated outcome.

### 3. Web Template Management Separation

1. Sign in as a project owner.
2. Open the ritual definition editor from settings or a definition-management route.
3. Confirm requirement editing and ritual settings are available.
4. Confirm there is no live submission control for a specific instance from the definition editor.

### 4. Mobile Worker Flow

1. Sign in as an assigned employee.
2. Open a ritual item from the Tasks focus view or a notification.
3. Confirm the destination is the ritual instance task detail.
4. Tap a requirement that needs proof.
5. Confirm the dedicated mobile submission flow opens with the selected requirement context.
6. Submit evidence and confirm the app returns to the ritual instance with refreshed status.

### 4a. Mobile Maestro Happy Path Seed

1. Set `MAESTRO_RITUAL_TASK_LABEL` to the exact ritual task row label visible in the Tasks tab.
2. Set `MAESTRO_RITUAL_REQUIREMENT_LABEL` to the exact requirement action or row label used to open submission.
3. Set `MAESTRO_RITUAL_SUCCESS_TEXT` to the success copy shown after submission, such as `Proof sent` or `Proof accepted`.
4. Run `maestro test frontend/apps/mobile/.maestro/ritual-submission-flow.yaml`.
5. Confirm the flow signs in, opens the ritual task from Tasks, enters the selected requirement flow, and returns to the ritual checklist.

### 5. Mobile Manager Urgent Review Flow

1. Sign in as a reviewer or owner.
2. Open a task instance that contains a pending submission.
3. Confirm pending review context is visible on the task.
4. If task-level mobile review is enabled, approve or reject the submission and verify the status refresh.
5. If task-level mobile review is deferred, confirm the task clearly indicates that backlog review is web-first.

### 6. Notification Entry Flow

1. Trigger a pending-review notification and a rejection notification.
2. Open each notification on web and mobile.
3. Confirm the destination lands on the relevant ritual instance or review-focused surface.

## Scenario Contract Files

- Backend integration: `backend/integration/ritual_submission_flow_test.go`
- Web E2E: `frontend/apps/web/e2e/ritual-submission-flow.spec.ts`
- Mobile Maestro: `frontend/apps/mobile/.maestro/ritual-submission-flow.yaml`

## Execution Targets During Implementation

- Backend integration suite: `cd backend && go test ./integration/...`
- Web E2E suite: `cd frontend/apps/web && pnpm e2e`
- Mobile Maestro happy path: `maestro test frontend/apps/mobile/.maestro/ritual-submission-flow.yaml`
- Mobile Maestro coverage suite: `cd frontend/apps/mobile && make test-mobile`

## Release-Readiness Checks

1. Confirm the web review tab, backlog refresh action, and backlog open-review buttons expose stable `data-testid` selectors for regression coverage.
2. Confirm today-view, list-view, and notification entry paths still land on ritual instance routes that carry the expected `focusIntent` values.
3. Confirm reviewer backlog copy still describes instance-level review rather than template management.
4. Confirm rejected-evidence paths still expose reviewer feedback and a resubmit action on the same ritual instance.
5. Confirm the Maestro seed values still match a real ritual task label, requirement label, and success message in the target environment.

## Validation Notes

- Treat the backend integration suite as the contract source for cross-role behavior and notification payload expectations.
- Treat the web Playwright suite as the source of truth for route-focus and selector stability on review and notification entry points.
- Treat the Maestro flow as a seeded smoke test for the mobile worker path; if it cannot run in CI or locally, record the missing app or simulator prerequisite before release.
