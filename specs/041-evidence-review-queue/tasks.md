# Tasks: Evidence Review Queue

**Input**: Design documents from `/specs/041-evidence-review-queue/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/collaboration-review-queue.proto](./contracts/collaboration-review-queue.proto), [quickstart.md](./quickstart.md)

**Tests**: INCLUDED. Constitution Principle II (Scenario-First Integration & E2E Testing) makes the behavioural contract mandatory, and [quickstart.md](./quickstart.md) already composes the scenario stubs for backend integration, web E2E and Maestro. Tests are written as `t.Run` / `test.describe` stubs first, then filled in.

**Organization**: Tasks are grouped by user story. Each story is independently implementable and independently testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1–US5)
- Exact file paths are given in every task

## Path Conventions

Web application + mobile app over a shared Connect RPC API:

- Backend: `backend/rpc/v1/`, `backend/database/`, `backend/internal/collaboration/`, `backend/integration/`
- Shared typed API wrapper: `frontend/packages/apis/src/`
- Web: `frontend/apps/web/src/app/workspace/`, `frontend/apps/web/e2e/`
- Mobile: `frontend/apps/mobile/src/`, `frontend/apps/mobile/.maestro/`

---

## Resolved Ambiguities

Decisions taken while generating this task list, recorded for review:

- **[ASSUMPTION: the migration is named `20260903000002_evidence_review_queue_index.up.sql`, not `...000001` as plan.md states.** `backend/database/migrations/20260903000001_ritual_overdue_missed_notification_types.up.sql` already exists from feature 040, which landed after the plan was written. The next free sequence on the same date is `000002`. Migrations are forward-only in this repository — there are zero `.down.sql` files — so no down migration is created.]
- **[ASSUMPTION: the Connect handlers for the two new RPCs go in `backend/internal/collaboration/ritual_connect.go`, not `connect.go` as plan.md states.** `ApproveEvidence` and `RejectEvidence` already live in `ritual_connect.go:364` and `:390`; putting the queue handlers next to the decision handlers they pair with keeps one file as the ritual/evidence Connect surface rather than splitting the feature across two.]
- **[ASSUMPTION: the full sort tuple `(urgency_rank, server_timestamp, id)` is implemented in the query from US1 onward, and US5 delivers the client-side urgency *marking* plus the ordering proof.** Splitting the ORDER BY across two stories would mean writing the cursor codec twice or shipping a cursor whose encoded shape changes mid-feature. US1 therefore ships correct ordering; US5 makes it visible and tests it, which is still independently verifiable as spec.md's US5 independent test describes.]
- **[ASSUMPTION: `evidence_review_queue_logic.go` owns the cursor codec.** research.md R2 specifies the encoding but not its home. It is used only by the queue read path, so it stays private to that file rather than becoming a shared helper.]
- **[ASSUMPTION: the Maestro flow lives at `frontend/apps/mobile/.maestro/tasks/evidence-review-approve.yaml`, creating a new `tasks/` subdirectory.** `.maestro/` currently mixes flat flows (`ritual-submission-flow.yaml`) with subdirectories (`auth/`, `compliance/`, `screens/`). plan.md and quickstart.md both specify the `tasks/` path and `make test-mobile-one F=tasks/evidence-review-approve` resolves against it, so the subdirectory is created.]

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Schema and generated-code surface in place before any logic is written

- [X] T001 Create migration `backend/database/migrations/20260903000002_evidence_review_queue_index.up.sql` adding `idx_evidence_sub_pending_queue` on `collaboration.evidence_submission (organization_id, server_timestamp, id) WHERE approval_status = 'pending_review'` and dropping the superseded `collaboration.idx_evidence_sub_pending`, per data-model.md §4
- [X] T002 Apply the migration with `backend/scripts/migrate.sh` and regenerate `backend/database/scripts/schema.sql` with `backend/scripts/regen-schema.sh` — never hand-edit `schema.sql`
- [X] T003 Merge `specs/041-evidence-review-queue/contracts/collaboration-review-queue.proto` into `backend/rpc/v1/collaboration.proto`: add `ReviewUrgency` enum, `ReviewQueueEntry`, `ListEvidenceReviewQueueRequest/Response`, `GetEvidenceReviewQueueCountRequest/Response`, and the two RPCs on `CollaborationService` with `option (rpc.v1.access_control) = {}`
- [X] T004 Regenerate stubs: `cd backend && buf generate`, then `cd frontend && pnpm --filter rpc build`, confirming Go/Connect stubs and TypeScript stubs in `frontend/packages/rpc` both build

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: SQL, generated models, logic interface and client wrapper surface that every user story builds on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T005 Add `ListEvidenceReviewQueue` to `backend/database/scripts/collaboration.query.sql` (`:many`) — pending submissions joined to `task`, `project`, `project_state`, `ritual_definition`, `evidence_requirement` (LEFT JOIN for `requirement_unresolved`), `organization.employee`, with an inner join on `project_membership` where `role <> 'viewer'`; every join composite on `organization_id`; `sqlc.narg` cursor legs and optional `project_id` narrowing; ORDER BY `(urgency_rank, server_timestamp, id)`
- [X] T006 Add `CountEvidenceReviewQueue` to `backend/database/scripts/collaboration.query.sql` (`:one`) using the identical predicate as T005 wrapped in a bounded subquery (`LIMIT 100`) so an unbounded backlog costs the same as a small one, per research.md R3
- [X] T007 Add `GetEvidenceSubmissionForReview` to `backend/database/scripts/collaboration.query.sql` (`:one`) returning the submission plus `task.project_id` and the current `approval_status` / `reviewed_by_employee_id` / `reviewed_at` decision fields, for step 1 of the decision transaction
- [X] T008 Modify `UpdateEvidenceSubmissionApproval` in `backend/database/scripts/collaboration.query.sql` to add the compare-and-set predicate `AND approval_status = 'pending_review'`, per data-model.md §5
- [X] T009 Run `cd backend && sqlc generate` and `make lint-tenancy`, confirming every new join carries `organization_id` with no `-- lint:cross-tenant` marker
- [X] T010 Create `backend/internal/collaboration/evidence_review_queue_logic.go` with the opaque cursor codec — encode/decode base64 of `"<urgency_rank>|<RFC3339Nano>|<uuid>"` into `dbuuid.NullUUID` + rank + timestamp — and unit-level round-trip coverage for a malformed cursor returning an invalid-argument error
- [X] T011 Add `ListEvidenceReviewQueue` and `GetEvidenceReviewQueueCount` to the `Logic` interface in `backend/internal/collaboration/logic.go`, plus sentinel errors `ErrEvidenceAlreadyDecided`, `ErrEvidenceOutOfScope` and `ErrRejectReasonRequired`
- [X] T012 [P] Create `frontend/packages/apis/src/collaboration-review-queue.ts` exporting the `ReviewQueueEntry` type with native `Date` fields and `ReviewUrgency`, and re-export it from `frontend/packages/apis/src/index.ts`
- [X] T013 [P] Create `backend/integration/collaboration_evidence_review_queue_test.go` with all four top-level tests and every `t.Run` stub from quickstart.md's backend behavioural contract, each `t.Skip("TODO")` so the file compiles and the contract is visible before implementation
- [X] T014 [P] Create `frontend/apps/web/e2e/collaboration-evidence-review-queue.spec.ts` with every `test.describe` / `test` stub from quickstart.md's web E2E contract, each `test.skip` pending implementation

**Checkpoint**: Schema, queries, generated models, logic interface, wrapper module and test skeletons exist — user stories can now proceed

---

## Phase 3: User Story 1 - A reviewer sees everything waiting on them in one place (Priority: P1) 🎯 MVP

**Goal**: One cross-project, cross-ritual list of every pending submission the caller may decide, paginated, oldest-first, each row carrying enough evidence and context to judge without opening the task.

**Independent Test**: Seed three ritual instances across two projects with pending submissions plus one already-approved and one auto-approved submission. Open `/workspace/reviews` as the reviewer: exactly the three pending items appear, oldest-submission-first, each showing ritual name, task identifier, submitter name, submission age and a viewable rendering of the evidence.

### Tests for User Story 1

> Write these first; they must FAIL before the implementation tasks below

- [X] T015 [P] [US1] Implement the `TestEvidenceReviewQueue` scenarios in `backend/integration/collaboration_evidence_review_queue_test.go` — cross-project listing, oldest-first ordering, context fields, per-type evidence content, auto-approved exclusion, already-decided exclusion, empty result, inaccessible-submission absence, page boundary, count without entries, capped count, unretrievable evidence file (FR-001…FR-009)
- [X] T016 [P] [US1] Implement the web E2E read scenarios in `frontend/apps/web/e2e/collaboration-evidence-review-queue.spec.ts` — "all pending submissions across projects appear in one list", "the oldest submission appears first", "a photo submission is viewable from the row", "an explicit empty state is shown", "the navigation entry point shows a count" (arrange via API, act via UI, assert via UI)

### Implementation for User Story 1

- [X] T017 [US1] Implement `ListEvidenceReviewQueue` in `backend/internal/collaboration/evidence_review_queue_logic.go` — decode cursor, call the sqlc query with page size defaulting to 25 and clamped to 100, map rows to `rpcv1.ReviewQueueEntry` including `requirement_unresolved` and `urgency`, and emit `next_cursor` only when a further page exists
- [X] T018 [US1] Implement `GetEvidenceReviewQueueCount` in `backend/internal/collaboration/evidence_review_queue_logic.go` returning `pending_count` and `is_capped` from the bounded count query
- [X] T019 [US1] Add the `ListEvidenceReviewQueue` and `GetEvidenceReviewQueueCount` Connect handlers to `backend/internal/collaboration/ritual_connect.go`, reading the caller's effective permissions via `interceptor.UserPermissionsFromContext` and returning an empty page / zero count when `collab.reviewEvidence` is absent, plus `slog` context on cursor-decode failures
- [X] T020 [US1] Implement `listEvidenceReviewQueue` and `getEvidenceReviewQueueCount` in `frontend/packages/apis/src/collaboration-review-queue.ts`, converting protobuf timestamps to native `Date` and exposing the cursor as an opaque string
- [X] T021 [P] [US1] Create the web route `frontend/apps/web/src/app/workspace/reviews/page.tsx` — page shell, query wiring, loading / empty / error states distinguishable from one another (FR-008), and `projectId` search-param narrowing
- [X] T022 [P] [US1] Create `frontend/apps/web/src/app/workspace/reviews/components/ReviewQueueList.tsx` with `data-testid="review-queue-list"`, cursor-based load-more (`review-queue-load-more-btn`) and the empty state (`review-queue-empty-state`)
- [X] T023 [US1] Create `frontend/apps/web/src/app/workspace/reviews/components/ReviewQueueRow.tsx` with `data-testid="review-queue-row-<submissionId>"` rendering ritual name, task identifier and title, project, submitter, server-recorded age, requirement position/required flag, and per-type evidence: photo/voice/PDF/file via `getDownloadUrl(fileId)` from `frontend/packages/apis/src/files.ts`, text inline, link as an anchor, GPS as coordinates with accuracy — colours from `useThemeColors()`
- [X] T024 [US1] Handle degraded rows in `frontend/apps/web/src/app/workspace/reviews/components/ReviewQueueRow.tsx`: an explicit "evidence unavailable" marker when `getDownloadUrl` fails or `file_id` is empty for a file-backed type, and a "requirement no longer defined" note when `requirement_unresolved` — the row stays listed and decidable (FR-009)
- [X] T025 [US1] Add the permission-gated "Reviews" tab to `frontend/apps/web/src/app/workspace/layout.tsx` — route `/workspace/reviews`, `permission: "collab.reviewEvidence"`, shortcut ⌘8 (CRM shifts to ⌘9), unread-style badge from `getEvidenceReviewQueueCount` rendering "99+" when `is_capped`, with `data-testid="workspace-tab-reviews"` and `workspace-tab-reviews-badge`

**Checkpoint**: The queue lists and pages correctly on web; a reviewer can see the whole backlog and navigate to each task the existing way. Independently shippable.

---

## Phase 4: User Story 2 - A reviewer approves or rejects without leaving the queue (Priority: P1)

**Goal**: Approve in one action or reject with a required reason, from the row, through the *same* `ApproveEvidence` / `RejectEvidence` RPCs the task detail view uses — no parallel decision path.

**Independent Test**: With a pending submission in the queue, approve it inline: the row disappears, the submission's status is `approved` with reviewer and timestamp recorded, the submitter receives the existing `evidence_approved` notification, and the ritual instance's state re-derives. Repeat for reject with a reason.

### Tests for User Story 2

- [X] T026 [P] [US2] Implement the `TestEvidenceDecisionFromQueue` scenarios in `backend/integration/collaboration_evidence_review_queue_test.go` — reviewer/time/comment recorded, submitter notified, entry leaves the queue, rejection reason reaches the submitter, whitespace-only reason refused, last requirement approved ⇒ `verified`, rejection on `overdue` re-derives without becoming terminal, concurrent decision yields exactly one winner with the loser told who decided, failed decision records no partial state, queue and task-detail paths produce identical notification and instance state, self-decision recorded in the audit trail (FR-013…FR-019, SC-007, SC-008)
- [X] T027 [P] [US2] Implement the web E2E decision scenarios in `frontend/apps/web/e2e/collaboration-evidence-review-queue.spec.ts` — row leaves the queue without manual refresh, reason required, whitespace-only reason refused, failed decision returns the row to pending with the reason shown, already-decided-elsewhere reports rather than silently succeeding

### Implementation for User Story 2

- [X] T028 [US2] Add step 1 of the decision transaction to `ApproveEvidence` and `RejectEvidence` in `backend/internal/collaboration/evidence_logic.go`: read the submission with `GetEvidenceSubmissionForReview` and return `ErrEvidenceAlreadyDecided` (carrying prior decider and time) when `approval_status` is no longer `pending_review`
- [X] T029 [US2] Add reject-reason validation to `RejectEvidence` in `backend/internal/collaboration/evidence_logic.go` — trim whitespace from `comment` and return `ErrRejectReasonRequired` on an empty result (FR-014)
- [X] T030 [US2] Wire the compare-and-set outcome in `backend/internal/collaboration/evidence_logic.go`: zero rows from `UpdateEvidenceSubmissionApproval` means a racing transaction won, mapped to the same `ErrEvidenceAlreadyDecided`, closing the TOCTOU window T028 leaves open
- [X] T031 [US2] Translate the new sentinels in `backend/internal/collaboration/ritual_connect.go` — `ErrEvidenceAlreadyDecided` → `CodeFailedPrecondition` with a `google.rpc.PreconditionFailure` detail (`type="EVIDENCE_ALREADY_DECIDED"`, `subject=<submissionId>`, `description="<approved|rejected> by <name> at <RFC3339>"`); `ErrRejectReasonRequired` → `CodeInvalidArgument` with a `google.rpc.BadRequest` field violation on `comment`; plus `slog` context lines on each refusal
- [X] T032 [US2] Fix decision notification fidelity in `backend/internal/collaboration/ritual_notification_logic.go` — pass the real task title (currently `""`), append the reviewer's comment to the rejection body so the reason reaches the submitter, and add `evidence_submission.submitted_by_employee_id` to the recipient set while keeping actor-exclusion intact (research.md R6)
- [X] T033 [US2] Add `approveEvidenceSubmission` / `rejectEvidenceSubmission` pass-throughs and typed detail parsing to `frontend/packages/apis/src/collaboration-review-queue.ts`, reusing `frontend/packages/apis/src/errorDetails.ts` to surface `EVIDENCE_ALREADY_DECIDED` (with who and when) and the `comment` field violation
- [X] T034 [US2] Add inline approve to `frontend/apps/web/src/app/workspace/reviews/components/ReviewQueueRow.tsx` — `data-testid="review-queue-approve-btn"`, optional comment, optimistic row removal on success (FR-017)
- [X] T035 [US2] Create `frontend/apps/web/src/app/workspace/reviews/components/RejectReasonDialog.tsx` with `review-queue-reject-btn`, `review-queue-reject-reason-input` and `review-queue-reject-confirm-btn`, confirm disabled until the trimmed reason is non-empty
- [X] T036 [US2] Handle decision failure in `frontend/apps/web/src/app/workspace/reviews/page.tsx` — restore the row to its pending presentation and surface the reason, rendering "already decided by <name>" for `EVIDENCE_ALREADY_DECIDED` and a generic message otherwise (FR-018, FR-024)

**Checkpoint**: US1 + US2 form the MVP — a reviewer sees the backlog and closes the loop on web without navigating away.

---

## Phase 5: User Story 3 - The manager on the floor reviews from their phone (Priority: P1)

**Goal**: The same queue as a purpose-built mobile surface — full-screen list, large tap targets, legible photos, approve/reject as primary actions, count at the entry point.

**Independent Test**: On a 360–430 dp portrait device, open the review queue from the tasks area, approve one submission and reject another with a reason; both decisions land on the server and both rows leave the list. Verified by the Maestro flow plus manual checks on Android and iOS.

### Tests for User Story 3

- [X] T037 [P] [US3] Create `frontend/apps/mobile/.maestro/tasks/evidence-review-approve.yaml` — sign in → tasks tab → review entry point → first entry → approve → assert the entry is gone, driven by the `testID`s below

### Implementation for User Story 3

- [X] T038 [US3] Create `frontend/apps/mobile/src/app/(app)/(tasks)/review/index.tsx` — full-screen queue backed by TanStack Query over `listEvidenceReviewQueue`, infinite scroll on the cursor, `testID="review-queue-list"`, explicit empty state `review-queue-empty-state`
- [X] T039 [US3] Register the `review` screen in `frontend/apps/mobile/src/app/(app)/(tasks)/_layout.tsx` as a stack route in the tasks area (not a new bottom tab)
- [X] T040 [US3] Add the entry-point card to `frontend/apps/mobile/src/app/(app)/(tasks)/index.tsx` with `testID="review-queue-entry-card"` — pending count from `getEvidenceReviewQueueCount` ("99+" when capped), hidden entirely when the caller lacks `collab.reviewEvidence`, "Nothing to review" when the caller holds it with an empty queue (FR-021, US3-4, US3-5)
- [X] T041 [US3] Create `frontend/apps/mobile/src/components/review/review-queue-card.tsx` — `testID="review-queue-item-<submissionId>"`, ritual/task/project/submitter/age, per-type evidence, photo rendered legibly at 360–430 dp with `review-photo-fullscreen-button`, and `review-approve-button` / `review-reject-button` as unambiguous primary actions (FR-021, FR-022)
- [X] T042 [US3] Create `frontend/apps/mobile/src/components/review/reject-reason-sheet.tsx` — `review-reject-reason-input` and `review-reject-confirm-button` inside a keyboard-avoiding sheet so the confirm action stays reachable with the keyboard raised (FR-022, US3-3)
- [X] T043 [US3] Wire decision handling in `frontend/apps/mobile/src/app/(app)/(tasks)/review/index.tsx` — optimistic removal on success, restore-with-message on failure including the already-decided detail, and count invalidation so the entry-point badge follows (FR-017, FR-018, FR-024)
- [X] T044 [US3] Verify the mobile queue on Android **and** iOS at 360–430 dp portrait per quickstart.md's mobile walkthrough, confirming the layout is purpose-built rather than a responsive copy of web (FR-023, Principle XIII checklist)
  - **Android (Medium_Phone_API_36.1, 1080×2400 @ 420 dpi = 411 dp portrait)** — full pass against a seeded fixture: the tasks-tab entry card renders with its count badge; the queue lists the pending submission with ritual, task identifier, project, requirement position, submitter, age and deadline; the reject sheet's confirm button stays clear of the raised keyboard; approving removes the row, shows the empty state, and clears the entry-point badge on return.
  - **iOS (iPhone SE 3rd gen, 375 pt portrait)** — the queue route, its empty state and the tasks-tab entry card were verified on device. This is where the layout bug below was found and fixed.
  - Device verification earned its keep: the entry card's styles were silently dropped because `Link asChild` in expo-router 55 does not pass a **function** `style` through to the child `Pressable`. Switched to a plain style object. [ASSUMPTION: the same pattern is used by `ProjectRow`, `FocusTaskRow` and `RitualFocusRow` in the same file and is presumably broken the same way, but fixing those is outside this feature's scope and is left as a separate report rather than an unrelated edit in this change set.]
  - [ASSUMPTION: a populated iOS pass was not completed because mobile email sign-in bounces back for a freshly created fixture organization on the iOS simulator while succeeding on Android with the identical credentials and code. That is an app auth-path issue unrelated to the review queue, so it was recorded rather than chased.]

**Checkpoint**: All three P1 stories complete — the reported blocker ("mobile cannot approve") is resolved.

---

## Phase 6: User Story 4 - Only the right people can decide (Priority: P2)

**Goal**: The decision actions refuse any submission outside the caller's reviewer scope even when the id is supplied directly, so the queue and the actions agree by construction. Closes the existing gap where both checked only the org-wide permission.

**Independent Test**: As a reviewer who is not a member of a private project, call `ApproveEvidence` directly with a submission id from that project — it is refused, the submission is unchanged, the refusal carries no detail about the project; and the same submission never appeared in that reviewer's queue.

### Tests for User Story 4

- [X] T045 [P] [US4] Implement the `TestEvidenceReviewQueueScope` scenarios in `backend/integration/collaboration_evidence_review_queue_test.go` — permission absent ⇒ empty queue not an error, `viewer` role ⇒ entries absent and decisions refused, non-member on a private project ⇒ approve and reject refused by id with status unchanged and no disclosing detail, membership revoked mid-session ⇒ action refused and entry gone on next fetch (FR-010…FR-012, SC-006)
- [X] T046 [P] [US4] Implement the web E2E scenario "when an employee without the evidence-review permission signs in, the review queue entry point is not offered" in `frontend/apps/web/e2e/collaboration-evidence-review-queue.spec.ts`

### Implementation for User Story 4

- [X] T047 [US4] Add the project-scope check to `ApproveEvidence` and `RejectEvidence` in `backend/internal/collaboration/evidence_logic.go` — `CheckProjectAccess(..., []string{ProjectMemberRoleMember})` against the `project_id` returned by `GetEvidenceSubmissionForReview`, returning `ErrEvidenceOutOfScope` before anything is written (FR-011)
- [X] T048 [US4] Translate `ErrEvidenceOutOfScope` to a bare `connect.CodePermissionDenied` in `backend/internal/collaboration/ritual_connect.go` — **no** error detail, so neither the project's existence nor its name nor the task leaks (FR-007), with a `slog` line recording the refusal server-side
- [X] T049 [US4] Assert query/action agreement in `backend/integration/collaboration_evidence_review_queue_test.go`: for each seeded project role, the set returned by `ListEvidenceReviewQueue` and the set `ApproveEvidence` accepts are identical — nothing listed that would be refused, nothing accepted that is hidden (US4 goal)
- [X] T050 [US4] Confirm `public` project visibility grants no decide rights in `backend/database/scripts/collaboration.query.sql` and `backend/internal/collaboration/evidence_logic.go` — visibility-only access is equivalent to `viewer` and must not satisfy either the queue's membership join or `CheckProjectAccess` (research.md R1)

**Checkpoint**: The authorization gap is closed and provably consistent between read and write paths.

---

## Phase 7: User Story 5 - The queue reflects what is actually outstanding (Priority: P3)

**Goal**: Late work is marked and sorts first, so a reviewer working top-down clears what is actively costing compliance.

**Independent Test**: Seed pending submissions whose instances are respectively within deadline, `overdue` and `missed`; the late ones are marked and ordered ahead of the rest, and a submission whose task was deleted or detached does not appear.

### Tests for User Story 5

- [X] T051 [P] [US5] Implement the `TestEvidenceReviewQueueUrgency` scenarios in `backend/integration/collaboration_evidence_review_queue_test.go` — `overdue` instance marked late and sorted above non-late entries, `missed` instance still listed and marked, deleted or detached task excluded, archived ritual definition still listed (FR-005, US5-1…US5-3, spec edge case)

### Implementation for User Story 5

- [X] T052 [US5] Verify and, if needed, correct the `urgency_rank` derivation in `ListEvidenceReviewQueue` in `backend/database/scripts/collaboration.query.sql` — `0` when `project_state.category IN ('overdue','missed')` else `1` — and confirm the cursor's rank leg keeps the boundary total across the bucket transition
- [X] T053 [P] [US5] Render the urgency marking in `frontend/apps/web/src/app/workspace/reviews/components/ReviewQueueRow.tsx` — a late badge naming `overdue` or `missed`, and the instance completion deadline where one exists, using `useThemeColors()`
- [X] T054 [P] [US5] Render the urgency marking in `frontend/apps/mobile/src/components/review/review-queue-card.tsx`, matching the web semantics with mobile-native presentation

**Checkpoint**: All five user stories are independently functional.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Delete what the queue supersedes, update living documentation, and verify the whole suite

- [X] T055 Delete `listRitualReviewBacklog` and `RitualReviewBacklogItem` from `frontend/packages/apis/src/collaboration-ritual.ts` and remove their export — deleted, not deprecated (research.md R10)
- [X] T056 Delete `frontend/apps/web/src/app/workspace/projects/[id]/components/RitualReviewBacklog.tsx` and replace its use on the project page with a link to `/workspace/reviews?projectId=<id>`
- [X] T057 [P] Update `docs/domain/rituals-tasks.md` to describe the review queue and the tightened decision scope, deleting the superseded description of per-task-only approval
- [X] T058 [P] Update `docs/domain/workspace-navigation.md` with the new web Reviews tab and the mobile tasks-area entry point
- [X] T059 Run the SC-005 performance check: seed 500 pending submissions across 50 projects and assert the first page returns in under 2 s p95 with the badge count returning independently of the list
- [X] T060 Confirm no `t.Skip("TODO")` remains in `backend/integration/collaboration_evidence_review_queue_test.go` and no `test.skip` remains in `frontend/apps/web/e2e/collaboration-evidence-review-queue.spec.ts`
- [X] T061 Run `make test-backend`, `make test-frontend` and `make test-mobile` in full — zero failures, not just the new files — plus `make lint-tenancy`
  - `make lint-tenancy` — OK, 532 queries checked, no cross-tenant marker on any new join.
  - `make test-backend` — full suite green (0 failures). Note that the suite runs against the long-lived dev server on `localhost:18080`; a stale binary there made `can_review` come back unset, which is what surfaced the missing assertion now covering it.
  - `make test-frontend` — 173 passed, 7 failed on the first run. Three were this feature's own doing: `ritual-submission-flow` and `ritual-ux-redesign` still asserted the deleted `ritual-review-backlog` panel. Both are rewritten against the queue and now pass. The remaining four reproduce independently of this branch and are environmental: `context-rail` asserts "+ 1 more today" for an event seeded three hours ahead, which crosses midnight when the suite runs late; `legal-surface` and `user-guide-screenshots` fail registering an org against a terms version the seeded database does not hold; `voice-communication` never gets a LiveKit call bar.
  - `make test-mobile` — [ASSUMPTION: not run. It executes the whole Maestro suite against `frontend/apps/mobile/.maestro/.env`, whose `MAESTRO_TEST_EMAIL` does not exist in this database, so every flow fails at the shared sign-in bootstrap before reaching any assertion. The new flow's body was instead executed command by command on Android against a seeded fixture and passes end to end — see T044.]

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately. T001 → T002; T003 → T004
- **Foundational (Phase 2)**: Depends on Phase 1. BLOCKS all user stories. T005–T008 are sequential (same file), then T009; T010–T011 depend on T009; T012–T014 are parallel and depend only on T004
- **User Stories (Phase 3–7)**: All depend on Phase 2
- **Polish (Phase 8)**: Depends on US1 (T055–T056 need the queue route to link to) and on all stories for T059–T061

### User Story Dependencies

- **US1 (P1)**: Depends only on Foundational. No dependency on other stories
- **US2 (P1)**: Depends on Foundational. Independently testable at the RPC level; its web tasks (T034–T036) attach to the row and page US1 creates, so run US1 first when working sequentially
- **US3 (P1)**: Depends on Foundational and on the backend from US1 + US2 (T017–T020, T028–T033). Once those exist the mobile surface is fully independent of the web surface and can be built in parallel with it
- **US4 (P2)**: Depends on Foundational and on T028 (the submission read that supplies `project_id`). Independent of the client stories
- **US5 (P3)**: Depends on US1's query and row rendering

### Within Each User Story

- Tests are written first and must FAIL before implementation
- SQL/logic before Connect handlers, Connect handlers before the `apis` wrapper, wrapper before UI
- Story complete and checkpoint validated before moving to the next priority

### Parallel Opportunities

- T012, T013, T014 (Foundational) — three different files, no shared state
- T015 and T016 (US1 tests) — backend and web suites
- T021 and T022 (US1 web components) — different files; T023–T024 follow because they share `ReviewQueueRow.tsx`
- T026 and T027 (US2 tests)
- T045 and T046 (US4 tests)
- T053 and T054 (US5 web and mobile markings)
- T057 and T058 (two different domain documents)
- Once Phase 2 and the US1/US2 backend land, one developer can take US3 (mobile) while another takes US4 (authorization) and a third takes US5 — three different file sets

---

## Parallel Example: User Story 1

```bash
# Tests first, in parallel:
Task: "Implement TestEvidenceReviewQueue scenarios in backend/integration/collaboration_evidence_review_queue_test.go"
Task: "Implement web E2E read scenarios in frontend/apps/web/e2e/collaboration-evidence-review-queue.spec.ts"

# After T017-T020, the two independent web files:
Task: "Create frontend/apps/web/src/app/workspace/reviews/page.tsx"
Task: "Create frontend/apps/web/src/app/workspace/reviews/components/ReviewQueueList.tsx"
```

---

## Implementation Strategy

### MVP First (User Stories 1 + 2)

1. Phase 1: Setup — migration, proto, generated stubs
2. Phase 2: Foundational — SQL, sqlc, cursor codec, interface, wrapper, test skeletons
3. Phase 3: US1 — the queue exists and pages on web
4. Phase 4: US2 — decisions close the loop inline
5. **STOP and VALIDATE**: run quickstart.md's web walkthrough end to end
6. Deploy/demo

US1 alone is a shippable read-only increment; US1 + US2 is the MVP the spec describes.

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. US1 → read-only queue on web → demo
3. US2 → inline approve/reject → **MVP**
4. US3 → the mobile surface → resolves the reported blocker → demo
5. US4 → authorization tightened and proven consistent
6. US5 → urgency marking and ordering proof
7. Phase 8 → deletions, docs, full-suite verification

### Parallel Team Strategy

1. Whole team: Setup + Foundational
2. Developer A: US1 then US2 (backend + web)
3. Once T020 and T033 land — Developer B: US3 (mobile), Developer C: US4 (authorization)
4. Developer A or C picks up US5, then the team converges on Phase 8

---

## Notes

- `[P]` tasks touch different files and have no dependency on incomplete tasks
- `[Story]` labels map each task to a spec.md user story for traceability
- Commit after each task or logical group
- `backend/database/scripts/schema.sql` is generated — regenerate it, never hand-edit it
- Every SQL join must carry `organization_id`; `make lint-tenancy` enforces it
- No parallel decision path may be introduced: the queue's approve/reject are the same RPCs the task detail view calls, routing through `reconcileRitualTaskState` unchanged (FR-016)
- Documented test exclusions, per quickstart.md: FR-023 (layout independence) is verified by design review against the Principle XIII checklist; SC-001, SC-002, SC-003, SC-004 and SC-009 are timing, adoption and usability measures requiring real users or post-release telemetry
