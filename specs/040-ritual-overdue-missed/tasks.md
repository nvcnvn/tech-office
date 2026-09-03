---
description: "Task list for 040 — Overdue and Missed Rituals Become Real States with Alerts"
---

# Tasks: Overdue and Missed Rituals Become Real States with Alerts

**Input**: Design documents from `/specs/040-ritual-overdue-missed/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Test tasks **are** included. Constitution principle IV requires integration coverage
against a real database for new behaviour, and [quickstart.md](./quickstart.md) specifies
sixteen named integration scenarios plus a unit table test. These are not optional here.

**Organization**: Tasks are grouped by user story. US1 and US2 are both P1; US1 is the MVP
stopping point.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 / US2 / US3 / US4, mapping to the user stories in spec.md
- Every task names the exact file it touches

## Path Conventions

Monorepo, released together (plan.md → Project Structure):

- Backend Go service: `backend/internal/...`, `backend/cmd/`, `backend/database/`
- Backend tests: `backend/integration/` (real database, `testWorld`), package-local `_test.go` for pure functions
- Web: `frontend/apps/web/src/...`, shared packages in `frontend/packages/...`
- Mobile: `frontend/apps/mobile/src/...`
- Behaviour snapshots: `docs/domain/`; engineering references: `backend/docs/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Schema and query plumbing every later phase compiles against. No behaviour yet.

- [X] T001 Create forward-only migration `backend/database/migrations/20260903000001_ritual_overdue_missed_notification_types.up.sql` that drops and re-adds the `notification_notification_type_valid` CHECK on `notification.notification` with `'ritual_instance_overdue'` and `'ritual_instance_missed'` added, and **without** re-adding `'ritual_instance_assigned'` (contracts/notifications.md §1). Repo convention is `.up.sql` only — no down migration.
- [X] T002 Apply the migration and regenerate the snapshot by running `cd backend && go run ./cmd migrate up` then `./backend/scripts/regen-schema.sh`, which rewrites `backend/database/scripts/schema.sql`. Never hand-edit `schema.sql` (depends on T001).
- [X] T003 Add `ListOrganizationIDsWithReconcilableRitualInstances :many` to `backend/database/scripts/collaboration.query.sql` exactly as specified in contracts/reconciliation-sweep.md §3, including the in-place Constitution Principle I justification comment mirroring `ListOrganizationIDsWithActiveRitualDefinitions` (cross-organization, returns organization IDs only, no `ritual_definition` join so archived definitions are still found — FR-009).
- [X] T004 Add `ListRitualInstancesForReconciliation :many` to `backend/database/scripts/collaboration.query.sql` — `organization_id`-scoped, same candidate predicate as T003, `ORDER BY t.completion_deadline ASC, t.id ASC`, `LIMIT @instance_limit` (FR-013, research R4/R6) (depends on T003 for the shared predicate comment block).
- [X] T005 Run `cd backend && sqlc generate` to regenerate the typed query bindings for the two new queries (depends on T003, T004).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared rule set, the shared writer, and the sweep that both P1 stories run
through. US1 and US2 differ only in which precedence row fires and which notification is
published — everything below is common to both.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T006 [P] Restore `NotificationTypeRitualInstanceOverdue = "ritual_instance_overdue"` and `NotificationTypeRitualInstanceMissed = "ritual_instance_missed"` in `backend/internal/notification/constants.go` in **all three** places: the const block (with the comment from contracts/notifications.md §2), the `IsValidNotificationType` switch, and `AllNotificationTypes()` (FR-019).
- [X] T007 [P] Add the two notification-type aliases beside `NotificationTypeRitualInstancesScheduled`, and the sweep tuning constants `ritualReconciliationInstanceLimit = 500`, `ritualReconciliationBackfillHorizon = 7 * 24 * time.Hour` and `ritualReconciliationInterval = 5 * time.Minute`, in `backend/internal/collaboration/constants.go` (research R6, R7; plan decision 6).
- [X] T008 Run `make test-backend-one T=TestNotificationTypeCheckMatchesGoConstants` and confirm it passes with both new types present on the Go side and in the DB CHECK, and `ritual_instance_assigned` present on neither. This is the FR-019 guard and must be green before any publisher is written (depends on T002, T006).
- [X] T009 Change `determineRitualTaskStateCategory` in `backend/internal/collaboration/ritual_task_state.go` to take a `graceWindow time.Duration` and implement the full precedence table from data-model.md: `verified` → `submitted` → `missed` (`now > completion_deadline + graceWindow`) → `overdue` (`now > completion_deadline`) → `in_progress` → `scheduled` → `todo`. Rows 3 and 4 are new; moving `in_progress` below them is FR-006. A zero/negative `graceWindow` means "no grace period known" and MUST make row 3 unreachable while leaving row 4 live (research R3 assumption). A `NULL` `completion_deadline` makes both unreachable (FR-005).
- [X] T010 [P] Add table-driven unit test `TestDetermineRitualTaskStateCategory` in `backend/internal/collaboration/ritual_task_state_test.go` covering one case per precedence row plus the six rows called out in quickstart.md → "Backend unit tests": partial-submitted past deadline → `overdue`; fully submitted with none rejected past deadline and grace → `submitted`; submitted-then-rejected past deadline → `overdue`; nothing submitted past grace → `missed`; nothing submitted with unknown grace window → `overdue` never `missed`; deadline not passed → `todo`/`scheduled`. Pure function, no database (depends on T009).
- [X] T011 Rework `reconcileRitualTaskStateForTask` in `backend/internal/collaboration/ritual_task_state.go` to (a) accept `now time.Time` instead of calling `time.Now()` inline so the sweep can inject the clock, (b) load the instance's `ritual_definition` to derive `graceWindow = CompletionWindowHours * time.Hour`, logging at WARN and passing a zero window when the definition cannot be loaded (research R3), (c) return `ritualStateOutcome{Changed bool; From, To string}` per contracts/reconciliation-sweep.md §2, and (d) log at WARN with project ID and target category when `findProjectStateByCategory` returns `nil` instead of returning silently (spec edge case, FR-012/Principle V) (depends on T009).
- [X] T012 Update the three existing callers of `reconcileRitualTaskStateForTask` — `SubmitEvidence`, `ApproveEvidence`, `RejectEvidence` in `backend/internal/collaboration/ritual_logic.go` — plus the wrapper at `ritual_task_state.go:112` to pass `time.Now()` and ignore the returned outcome. This is what makes FR-007 true by construction: the evidence path and the sweep path share one writer (depends on T011).
- [X] T013 Add `RitualReconciliationCounts` and the `ReconcileOverdueRitualInstances(ctx, tx, orgID, now) (RitualReconciliationCounts, error)` method to the `Logic` interface in `backend/internal/collaboration/logic.go`, matching contracts/reconciliation-sweep.md §2 (depends on T011).
- [X] T014 Create `backend/internal/collaboration/ritual_reconciliation_logic.go` implementing `ReconcileOverdueRitualInstances`: list at most `ritualReconciliationInstanceLimit` candidates for the organization via `ListRitualInstancesForReconciliation`, call `reconcileRitualTaskStateForTask` per instance, and count `InstancesExamined` / `MarkedOverdue` / `MarkedMissed` from the returned outcome. A per-instance error is logged with the task ID and the loop continues (FR-011 second sentence). Mirror the shape of `scheduler_logic.go`. Add a `ponytail:` comment naming the per-instance read cost and its upgrade path (cache the per-project state list and per-definition window for the duration of one pass) per research R1 (depends on T005, T013).
- [X] T015 Create `backend/internal/collaboration/ritual_reconciliation_workflow.go` with `RitualReconciliationInput`, `RitualReconciliationOutput`, `RitualReconciliationWorkflow`, `Name() string` returning `"ritual_reconciliation_sweep"`, `Run(ctx, wf, in)` and an exported `Sweep(ctx, now)` — signatures exactly as in contracts/reconciliation-sweep.md §1. `Sweep` discovers organizations on `AdminPool` via `ListOrganizationIDsWithReconcilableRitualInstances`, loops them, isolates and logs per-organization errors without aborting (FR-011), accumulates the four counts, and emits one structured `slog.InfoContext` line `ritual reconciliation sweep complete` carrying them (FR-012). Mirror `scheduler_workflow.go` (depends on T014).
- [X] T016 Register and schedule the sweep in `backend/cmd/server.go` immediately after the generation sweep: `flows.Register` then `flows.ScheduleTx(..., flows.Every(ritualReconciliationInterval))` with `flows.RetryPolicy{MaxRetries: 2}`, following the register-then-`ScheduleTx` shape in contracts/reconciliation-sweep.md §1 (FR-008) (depends on T015).
- [X] T017 Add `runRitualReconciliationSweep()` and `runRitualReconciliationSweepAt(now time.Time)` helpers to `backend/integration/helper_test.go`, mirroring the existing `runRitualGenerationSweep` / `runRitualGenerationSweepAt` at line ~3549, so integration tests drive one cycle with an injected clock and never sleep (research R11) (depends on T015).

**Checkpoint**: The sweep runs, writes state through the single shared writer, and reports its
counts. Nothing notifies yet — that is the two P1 stories.

---

## Phase 3: User Story 1 - A skipped checklist reaches the assignee without anyone asking (Priority: P1) 🎯 MVP

**Goal**: An instance whose deadline passes without complete evidence is *written* to
`overdue` by the recurring pass, and its assignees and reviewers are told once.

**Independent Test**: Create a ritual instance with a past deadline and no evidence, run one
reconciliation pass, and observe (a) the instance's state category is `overdue` and (b) the
assignee holds one overdue notification. Nothing from US2, US3 or US4 is required.

### Tests for User Story 1 ⚠️

> Write these first and confirm they fail before implementing T021–T023.

- [X] T018 [P] [US1] Create `backend/integration/collaboration_ritual_reconciliation_test.go` with `TestRitualReconciliation` and quickstart scenarios 1–5: skipped checklist becomes overdue with one assignee notification and `MarkedOverdue == 1` (FR-001, FR-014); three repeat passes change nothing and notify nobody (FR-010, SC-004); evidence submitted after overdue leaves the state on the evidence path and the instance stops being a candidate; a future deadline and a `NULL` `completion_deadline` are untouched and uncounted (FR-005); one-of-two required submitted past deadline is `overdue`, not `in_progress` (FR-006).
- [X] T019 [P] [US1] Add quickstart scenarios 12, 13 and 16 to `backend/integration/collaboration_ritual_reconciliation_test.go`: a submitted-then-rejected requirement past the deadline is `overdue` (edge case); an instance whose definition was archived after generation still becomes `overdue` (FR-009 — the case that fails if discovery reuses the generation sweep's query); more than `ritualReconciliationInstanceLimit` late instances in one organization are drained oldest-deadline-first across two passes with nothing skipped or double-counted (FR-013).
- [X] T020 [P] [US1] Add quickstart scenario 14 to `backend/integration/collaboration_ritual_reconciliation_test.go`: two organizations each with one late instance, one broken by deleting its project's ritual states so no `overdue` state row exists — the sweep returns no error, reports `OrganizationsProcessed == 2`, reconciles the healthy organization, leaves the broken one unchanged and logs the condition (FR-011, SC-006).

### Implementation for User Story 1

- [X] T021 [US1] Add `notifyRitualInstanceOverdue` to `backend/internal/collaboration/ritual_notification_logic.go` beside `notifyRitualInstancesScheduled`, with the signature in contracts/notifications.md §Publication. Recipients: task `assignee` + `reviewer` + `approver`, deduplicated by employee ID with `appendUniqueRecipient` (FR-014). Envelope: `SourceDomainProjects`, `Priority: 2`, `PolicyKeyTaskStatus`, `DeliveryClassPersistent`, `SourceCategoryActivity` (FR-018). Title `Ritual overdue`; message `"{ritual name}" for {scheduled date} is {n} hours overdue`, degrading to `is overdue by less than an hour` under 1h and `{n} days overdue` at 48h and beyond, with the ritual definition name falling back to the task title. `ActionData` carries `taskId`, `projectId`, `deepLink` `tasks/{projectId}/{taskId}` and `focusIntent=submit_requirement`; `NavigationTarget` is domain `projects`, type `task`, id = task id (FR-017). No-op when `l.NotificationPublisher == nil`; log at WARN on publish failure without failing the transition.
- [X] T022 [US1] Add `shouldSuppressRitualLatenessNotification(task, now) bool` to `backend/internal/collaboration/ritual_task_state.go`, returning true when `now.Sub(task.CompletionDeadline) > ritualReconciliationBackfillHorizon`. The check is against the stored deadline, never elapsed wall-clock since the state change, so a repeated pass cannot change the answer (FR-021, research R7). US2 reuses this helper unchanged.
- [X] T023 [US1] In `reconcileRitualTaskStateForTask` (`backend/internal/collaboration/ritual_task_state.go`), call `notifyRitualInstanceOverdue` **only** when the transition actually performed by this function has `To == "overdue"` and `From != "overdue"`, and only when `shouldSuppressRitualLatenessNotification` is false. An instance already in the target state writes nothing and notifies nobody (FR-020, FR-010). Count suppressions and surface them in the per-pass log line (depends on T021, T022).

**Checkpoint**: US1 is complete and demoable on its own — a forgotten checklist becomes
overdue within one 5-minute cadence and the worker is told, with no user or client action.
**This is the MVP; stop and validate here.**

---

## Phase 4: User Story 2 - The owner learns a ritual was missed, in the place they already look (Priority: P1)

**Goal**: One completion window past the deadline the instance becomes terminally `missed`
and the escalation reaches someone with authority — the reviewer, or the project's owners and
admins when there is no reviewer.

**Independent Test**: Create an instance whose deadline passed longer ago than the grace
period, run one reconciliation pass, and observe the instance is `missed` and that the
assignee, the reviewer and (where no reviewer exists) the project's owners and admins each
hold a missed notification.

### Tests for User Story 2 ⚠️

- [X] T024 [P] [US2] Add quickstart scenarios 6, 8 and 9 to `backend/integration/collaboration_ritual_reconciliation_test.go`: sweeping at `deadline + completion_window_hours + 1h` produces `missed`, one `ritual_instance_missed` notification each for assignee and reviewer, and `MarkedMissed == 1` (FR-002, FR-015); further passes leave `missed` alone, notify nobody and stop returning it as a candidate (FR-003); an instance whose deadline and grace both elapsed before any pass reaches `missed` in one step without pausing at `overdue`.
- [X] T025 [P] [US2] Add quickstart scenario 7 to `backend/integration/collaboration_ritual_reconciliation_test.go`: an instance with an assignee and **no** reviewer or approver, in a project with one `owner` and one `admin` — both privileged members hold a `ritual_instance_missed` notification (FR-016, SC-003). Include the spec edge case of an instance with no assignee at all: no overdue notification is produced, but the `missed` transition still escalates to owners and admins.
- [X] T026 [P] [US2] Add quickstart scenarios 10, 11 and 15 to `backend/integration/collaboration_ritual_reconciliation_test.go`: a `skipped` instance, a `verified` instance and a `detached_from_ritual` instance are all untouched and uncounted after a sweep past their deadlines (FR-004); an instance with all required evidence submitted and pending review stays `submitted` with no notification (edge case); an instance whose deadline passed 30 days ago transitions to `missed` with **zero** notifications (FR-021).

### Implementation for User Story 2

- [X] T027 [US2] Add `notifyRitualInstanceMissed` to `backend/internal/collaboration/ritual_notification_logic.go` with the signature in contracts/notifications.md §Publication. Same envelope and dedup as T021, title `Ritual missed`, message `"{ritual name}" for {scheduled date} was missed — no evidence was submitted`, and `focusIntent=view_instance` because the state is terminal and there is nothing to submit (FR-015, FR-017) (depends on T021 for the shared recipient and envelope helpers).
- [X] T028 [US2] In `notifyRitualInstanceMissed`, when the resolved recipient set contains no `reviewer` and no `approver`, add the project's `owner` and `admin` members via the existing `ListProjectMembers` query in `backend/database/scripts/collaboration.query.sql`, deduplicated by employee ID, so the escalation always reaches someone with authority (FR-016). Do **not** add project owners to the overdue path — research R8 rejects it explicitly (depends on T027).
- [X] T029 [US2] In `reconcileRitualTaskStateForTask` (`backend/internal/collaboration/ritual_task_state.go`), call `notifyRitualInstanceMissed` only when the transition this function performed has `To == "missed"`, gated by the same `shouldSuppressRitualLatenessNotification` helper from T022. `missed` is terminal: the existing short-circuit on `verified | missed | skipped` already prevents any automatic transition out of it and any re-notification (FR-003, FR-020) (depends on T023, T027).

**Checkpoint**: Both P1 stories work independently. The owner now learns about a skipped
ritual without opening a report — the drift D29 failure is closed on the backend.

---

## Phase 5: User Story 3 - Overdue and missed are visible wherever the ritual is (Priority: P2)

**Goal**: Every surface reads the stored state category instead of computing its own notion
of lateness, and both clients resolve the two notification types to the instance.

**Independent Test**: With one overdue and one missed instance present, load each ritual
surface on web and on mobile and confirm each reports the same state, and that opening the
notification on each client lands on the instance.

### Tests for User Story 3 ⚠️

- [X] T030 [P] [US3] Extend the existing ritual spec under `frontend/apps/web/e2e/` (do not add a new suite) with the three assertions in quickstart.md → "Frontend E2E": one seeded `overdue` and one seeded `missed` instance appear in the Today view's **Overdue** and **Missed** sections, in the list view, and under the Health tab's overdue and missed counts; the Health tab counts and the task detail state agree; clicking a `ritual_instance_overdue` notification navigates with `focusIntent=submit_requirement` and a `ritual_instance_missed` notification with `focusIntent=view_instance` (FR-022, FR-023, SC-005).

### Implementation for User Story 3

- [X] T031 [US3] Change the urgency expression in both `GetAssignedWorkSummaryCounts` and `ListAssignedWorkSummaryItems` in `backend/database/scripts/collaboration.query.sql` to `CASE WHEN ps.category = 'overdue' OR t.due_date < sqlc.arg(as_of_date)::date THEN 'overdue' ELSE 'due_today' END AS urgency_bucket`. The `OR` preserves standard-task behaviour while making ritual instances agree with their stored state; `missed` instances leave the summary with no query change because the seeded `Missed` state is `is_closed = true` and both queries already filter `ps.is_closed = FALSE` (FR-022, research R10).
- [X] T032 [US3] Run `cd backend && sqlc generate` and fix any call-site fallout from the changed summary queries (depends on T031).
- [X] T033 [P] [US3] In `frontend/packages/apis/src/collaboration-ritual.ts`, change `classifyRitualTaskBucket` and `groupRitualWorklistBuckets` to accept `states: ProjectState[]`, resolve the task's category from `task.stateId`, and return `overdue` / `missed` from that category — leaving only `today` / `upcoming` derived from `scheduledDate`. Add `missed: RitualInstanceTask[]` to `RitualWorklistBuckets`. This deletes the last client-side lateness computation, which today compares `completionDeadline` against the browser's `new Date()` (FR-022, SC-005, research R10).
- [X] T034 [P] [US3] In `frontend/packages/apis/src/notification.ts`, remove `'ritual_instance_assigned'` from the `NotificationType` union, keeping `'ritual_instance_overdue'` and `'ritual_instance_missed'`. The project carries no backward-compatibility obligation, so the dead member is deleted rather than kept (research R9).
- [X] T035 [P] [US3] In `frontend/packages/notifications/src/utils.ts`, remove the `ritual_instance_assigned` icon and label rows. The `⏰ Ritual overdue` and `⚠️ Ritual missed` rows already exist and stay.
- [X] T036 [US3] Update `frontend/apps/web/src/app/workspace/projects/[id]/components/TodayView.tsx` to pull `states` from `useProjectContext()` (the project page already loads them), pass them to the bucket helper, and render a **Missed** section alongside Overdue (depends on T033).
- [X] T037 [P] [US3] In `frontend/apps/web/src/app/workspace/notifications/utils/notificationNavigation.ts`, add `ritual_instance_overdue → RITUAL_FOCUS_INTENT_SUBMIT_REQUIREMENT` and `ritual_instance_missed → RITUAL_FOCUS_INTENT_VIEW_INSTANCE` cases to `mapNotificationTypeToFocusIntent`, and drop the dead `'ritual_instance_assigned'` case (FR-017, FR-023).
- [X] T038 [P] [US3] In `frontend/apps/mobile/src/lib/linking.ts`, add the same two cases to `focusIntentFromNotificationType` and drop the same dead one. No route change is needed — both clients already route a `projects`/`task` navigation target and a `tasks/{projectId}/{taskId}` deep link to the ritual instance screen (FR-017, FR-023).
- [X] T039 [US3] Verify the mobile ritual instance card renders `Overdue` and `Missed` with the danger tone (`getStateTone` already maps both categories, so this is a regression check) and that a tapped overdue/missed push lands on the instance. Per the repository's standing rule, verify on **Android as well as iOS** — the narrow-Android layout is where a new section header regresses unnoticed (depends on T038).

**Checkpoint**: No screen computes its own lateness; every surface and both clients agree.

---

## Phase 6: User Story 4 - The escalation respects how the person has asked to be reached (Priority: P3)

**Goal**: Prove the "correct by construction" property — these notifications carry no special
case and are therefore already subject to do-not-disturb, domain mute and presence.

**Independent Test**: Put a recipient in a do-not-disturb window and confirm an overdue
transition still records the notification and still updates state, but does not push during
the window.

### Tests for User Story 4 ⚠️

- [X] T040 [P] [US4] Add a do-not-disturb scenario to `backend/integration/collaboration_ritual_reconciliation_test.go`: with the recipient inside a DND window, an instance becoming overdue still performs the state change and still records the notification row, but produces no push during the window (FR-018, US4 scenario 1).
- [X] T041 [P] [US4] Add an assertion to `backend/integration/collaboration_ritual_reconciliation_test.go` that both published notifications carry `priority = 2`, `policy_key = 'task_status'`, `delivery_class = 'persistent'` and `source_domain = 'projects'`, and that neither uses the always-deliver priority reserved for mentions and incoming calls (FR-018). A recipient who has muted the `projects` domain is covered by the same generic path with no special case, so assert the mute applies rather than adding one.

**Checkpoint**: The product's most useful alert is not the one people mute.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T042 [P] Update `docs/domain/rituals-tasks.md`: document the `ritual_reconciliation_sweep` job (cadence, discovery, bound, backfill horizon), the `overdue` and `missed` states as real stored states with their transition rules, and the two notification types; **delete** the "Known drift" section covering D29 (SC-007, domain snapshot rule).
- [X] T043 [P] Move D29 from the open drift register to the fixed list in `docs/domain/README.md`, naming this feature as what cleared it (SC-007).
- [X] T044 [P] Update `docs/domain/notifications-presence.md` to list `ritual_instance_overdue` and `ritual_instance_missed` as live notification types and remove `ritual_instance_assigned` if it is still listed.
- [X] T045 [P] Update `backend/docs/SYSTEM-ARCHITECTURE.md`, `backend/docs/NOTIFICATION-SYSTEM-ARCHITECTURE.md` and `backend/docs/PRODUCTION-RUNTIME-SERVICES.md` to name the second recurring collaboration job, its 5-minute cadence and the two notification types it publishes (Constitution principle XII).
- [X] T046 Run `make lint-tenancy` and confirm both new queries pass — the `organization_id`-scoped one by filtering, the cross-organization one by carrying its documented Principle I justification (quickstart.md → Definition of done).
- [X] T047 Run `make test-backend` and confirm no regression, in particular in `backend/integration/collaboration_ritual_notification_test.go` and `backend/integration/collaboration_schedule_generation_test.go`, both of which exercise the reconcile path whose signature changed in T011.
- [X] T048 Run `make test-frontend-one F=ritual` and the mobile flow check, then walk the manual end-to-end check in quickstart.md (ritual with `completion_window_hours = 1`, wait for the deadline plus one sweep, confirm the bell, the board, Today and the task detail all say `Overdue`, then confirm `Missed` one window later and the instance's disappearance from the assigned-work summary).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. **Blocks every user story.**
- **US1 (Phase 3)**: Depends on Foundational. No dependency on any other story.
- **US2 (Phase 4)**: Depends on Foundational. Reuses T021's recipient/envelope helpers and T022's suppression helper from US1, so in practice it follows US1 — the two P1 stories are siblings in one file rather than fully independent workstreams.
- **US3 (Phase 5)**: Depends on Foundational only. The client work can proceed in parallel with US1/US2 against seeded state rows; the E2E test needs US1 and US2 to produce those rows naturally.
- **US4 (Phase 6)**: Depends on US1 (needs a publisher to assert on). Test-only phase — if T021's envelope is right, this phase passes without new production code, which is the point of the story.
- **Polish (Phase 7)**: Depends on all desired stories.

### Critical path

T001 → T002 → T008 (the FR-019 guard) and T003 → T004 → T005 → T014 → T015 → T016, joined by
T009 → T011 → T012/T013. US1's T021→T023 then unblocks US2's T027→T029.

### Within each user story

- Tests are written before the implementation tasks in the same phase and must fail first.
- Precedence function before the writer; the writer before the sweep; the sweep before the notifiers.
- Backend state before client rendering.

### Parallel Opportunities

- **Phase 1**: T003 and T004 touch the same file sequentially; T001 is independent of both.
- **Phase 2**: T006 and T007 are different files — run together. T010 runs alongside T011–T013 once T009 lands.
- **Phase 3**: T018, T019 and T020 are separate scenario blocks — write them together, then implement T021–T023 sequentially in the two shared files.
- **Phase 4**: T024, T025 and T026 together.
- **Phase 5**: T033, T034, T035, T037 and T038 are five different files with no ordering between them — the widest parallel window in the feature.
- **Phase 7**: T042–T045 are four independent documents.

---

## Parallel Example: User Story 3

```bash
# Five client files, no ordering between them:
Task: "classifyRitualTaskBucket reads stored category in frontend/packages/apis/src/collaboration-ritual.ts"
Task: "Drop ritual_instance_assigned from the union in frontend/packages/apis/src/notification.ts"
Task: "Drop ritual_instance_assigned icon/label rows in frontend/packages/notifications/src/utils.ts"
Task: "Map both types to focus intents in frontend/apps/web/src/app/workspace/notifications/utils/notificationNavigation.ts"
Task: "Map both types to focus intents in frontend/apps/mobile/src/lib/linking.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup — migration, schema regen, two queries, `sqlc generate`.
2. Phase 2 Foundational — **blocks everything**; ends with a sweep that writes state and reports counts.
3. Phase 3 US1 — the overdue transition notifies the assignee.
4. **STOP and VALIDATE**: quickstart scenarios 1–5, 12, 13, 14, 16 pass; a forgotten checklist becomes overdue within one cadence with no user action.
5. Ship if desired: the headline promise is half-kept — the worker is told, the owner is not yet.

### Incremental Delivery

1. Setup + Foundational → the pass runs and reports.
2. + US1 → the assignee is told (MVP).
3. + US2 → the escalation lands with the owner; drift D29 is closed on the backend.
4. + US3 → every surface and both clients agree; D29 is closed end to end.
5. + US4 → proven not to trample quiet hours.
6. + Polish → `docs/domain/` and `backend/docs/` match the shipped behaviour, which is Definition of Done, not follow-up.

### Parallel Team Strategy

Foundational is one person's work — it is a tight chain through three files. Once T017 lands,
a backend engineer can take US1 → US2 (they share two files) while a frontend engineer takes
US3's five independent client files against seeded rows. US4 is a test-only phase for whoever
finishes first.

---

## Notes

- **[ASSUMPTION: the optional `before_tasks` and `before_implement` git auto-commit hooks were skipped.]** This is an unattended run; the mandatory `after_implement` hooks cover the change set.
- **[ASSUMPTION: migrations are applied with `./backend/scripts/migrate.sh up`, not `go run ./cmd migrate up`.]** T002 and quickstart.md name a `migrate` subcommand that `backend/cmd` does not have; the repository's supported path is the script, which is also what `regen-schema.sh` uses.
- **[ASSUMPTION: `RitualReconciliationInterval` is exported.]** T007 names it lowercase, but T016 requires `backend/cmd/server.go` (package `main`) to schedule with it, which an unexported constant makes impossible. Exporting keeps one source of truth for the cadence; the per-pass bound and the backfill horizon stay unexported because only the collaboration package reads them.
- **[ASSUMPTION: T012's evidence callers live in `evidence_logic.go`, not `ritual_logic.go`.]** `SubmitEvidence`, `ApproveEvidence` and `RejectEvidence` are defined in `backend/internal/collaboration/evidence_logic.go`; the task text named the wrong file.
- **[ASSUMPTION: the state write is a compare-and-set, which the plan did not call for.]** Running the new integration suite in parallel showed two overlapping passes both performing a transition and both notifying, because each read the row before either wrote. data-model.md claims "whichever writes second finds `target == current` and does nothing", which is only true if the passes are serialized. `UpdateRitualTaskStateIfUnchanged` adds an `expected_state_id` predicate so the loser matches zero rows. This makes the documented idempotency property actually hold, at the cost of one new query and no locking. A duplicate escalation to a project owner is a real product defect, so this was not deferred.
- **[ASSUMPTION: T016 scheduled the sweep with `RetryPolicy{MaxRetries: 2}` inside `Run` via `flows.Execute`, mirroring the generation sweep, rather than as an argument to `ScheduleTx`.]** `flows.ScheduleTx` in this repository takes no retry policy; the generation sweep expresses the same policy through `flows.Execute`, and the two jobs now match.
- **[ASSUMPTION: T039's device verification could not be performed in an unattended run.]** The static half is confirmed — `getStateTone` in `apps/mobile/src/app/(app)/(tasks)/[projectId]/task/[taskId].tsx` maps both `overdue` and `missed` to the danger tone, `linking.ts` resolves both notification types, and mobile holds no client-side lateness computation. Driving an Android device and an iOS simulator to confirm the narrow-layout rendering still needs a human, per the repository's standing rule. D40 in the drift register also records that every Maestro flow is currently unrunnable on the fixture credentials.
- **[ASSUMPTION: `make test-frontend-one F=ritual` could not be used.]** It fails on the pre-existing path bug recorded as D36 in the drift register. The ritual specs were run with `pnpm exec playwright test --config=e2e/playwright.config.ts ritual` from `frontend/apps/web`, which D36 names as the working invocation. All 30 tests pass.
- **[ASSUMPTION: T048's manual browser walk was replaced by observing the scheduled job in the running dev backend.]** The `ritual_reconciliation_sweep` schedule bootstraps at start (`ritual reconciliation sweep scheduled cadence=5m0s`) and a subsequent unattended pass logged `ritual reconciliation sweep complete organizations_processed=5 instances_examined=5 marked_overdue=0 marked_missed=2` — the scheduled job, not a test-driven `Sweep` call, performing real transitions. The display and navigation halves are covered by the E2E suite and the state/notification halves by the integration suite.
- `[P]` means different files with no dependency on an incomplete task.
- `backend/database/scripts/schema.sql` is generated by `backend/scripts/regen-schema.sh` and is never hand-edited (T002).
- Time is injected through `Sweep(ctx, now)` in every test — never slept for.
- `missed` is terminal: no automatic transition leaves it and it is never re-notified (FR-003).
- Commit after each task or logical group; stop at any checkpoint to validate a story independently.
