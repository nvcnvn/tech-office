---
description: "Task list for feature 044 — Create Projects And Rituals On Mobile"
---

# Tasks: Create Projects And Rituals On Mobile

**Input**: Design documents from `/specs/044-mobile-project-ritual-creation/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [quickstart.md](./quickstart.md),
[contracts/mobile-surfaces.md](./contracts/mobile-surfaces.md),
[contracts/api-wrapper-changes.md](./contracts/api-wrapper-changes.md),
[contracts/tour-content-delta.md](./contracts/tour-content-delta.md)

**Tests**: Included and mandatory. Constitution principle II (scenario-first testing) and
FR-025 both require them: every added interactive element is Maestro-addressable and each of
project creation and ritual creation carries at least one happy-path flow in the standing
suite. Maestro flows and Go integration cases are written before the code that satisfies them
and are expected to fail until it lands.

**Organization**: Grouped by user story so each story is independently implementable and
testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 (define a ritual), US2 (create a project), US3 (tour stops), US4 (archive a ritual)
- Every task names exact file paths.

## Path Conventions

Existing monorepo layout, unchanged by this feature:

- **Backend**: `backend/` — Go 1.24, Connect RPC, sqlc, PostgreSQL 17
- **Mobile**: `frontend/apps/mobile/` — Expo Router 55, React Native 0.83, TanStack Query v5
- **Web**: `frontend/apps/web/` — Next.js 15, React 19, MUI v7
- **Shared packages**: `frontend/packages/apis/src/`, `frontend/packages/validations/src/`
- **Blackbox flows**: `frontend/apps/mobile/.maestro/`

---

## Assumptions recorded during task generation

> [ASSUMPTION: The plan lists `backend/internal/collaboration/errors.go` as the home for
> `ErrProjectKeyTaken` and `ErrProjectKeyInvalid`. No `errors.go` exists in that package;
> project-scoped sentinels live in `backend/internal/collaboration/logic.go` (`ErrProjectNotFound`,
> `ErrAccessDenied`, …) and ritual-scoped ones in `constants.go`. The two new sentinels are added
> to `logic.go` beside `ErrProjectNotFound`, which is the closest existing home, rather than
> creating a new file for two lines.]

> [ASSUMPTION: `frontend/packages/validations/` has no test runner and no self-check convention;
> its existing modules (`subdomain.ts`, `password.ts`) ship with none. `project-key.ts` therefore
> gets no separate unit test — it is exercised by both create forms and by the `tsc` run, and the
> database CHECK constraint remains the authority. `device-timezone.ts` does get a self-check,
> because `apps/mobile/src/lib/` has an established `*.check.ts` convention the plan cites.]

> [ASSUMPTION: The three new Maestro flows go in `.maestro/projects/` and `.maestro/rituals/`
> per the plan's file listing, even though existing ritual flows sit at `.maestro/` top level
> (`ritual-submission-flow.yaml`, `ritual-procedure-doc.yaml`). The plan's layout is followed
> because `.maestro/config.yaml` documents per-area subdirectories as the convention and
> `tasks/`, `compliance/`, `feature-tour/` already follow it.]

> [ASSUMPTION: FR-025's "standing mobile suite" means the `flows` array in
> `frontend/apps/mobile/scripts/run-maestro-suite.sh`, which is what `make test-mobile` runs.
> A flow file that is not listed there is run on demand only, so adding the file is not by
> itself enough to satisfy FR-025.]

> [ASSUMPTION: `frontend/apps/mobile/src/app/(app)/(tasks)/[projectId]/create.tsx` exists but is
> not registered in the `(tasks)` `Stack`. The two new modal screens are registered explicitly,
> matching how `[projectId]/settings` and `rituals/[definitionId]` are registered, so their
> titles and modal presentation are declared rather than inferred.]

> [ASSUMPTION: Mobile reads permissions through
> `useQuery({ queryKey: ["employee-permissions", auth.employeeId], queryFn: () => getEmployeePermissions(...) })`,
> the pattern already used in `[projectId]/task/[taskId].tsx:1214` for `collab.reviewEvidence`.
> Both new affordance gates reuse that exact query key so they share one cache entry, rather than
> introducing a `usePermissions` hook for two call sites (Principle V).]

> [ASSUMPTION: The constitution amendment (T001) is sequenced first, as plan.md's Constitution
> Check calls it "task zero of implementation". Every later task is written against the amended
> text; landing code before it would leave the repository contradicting itself at every
> intermediate commit.]

---

## Phase 1: Setup (Shared Foundations)

**Purpose**: The governance amendment that unblocks the feature, plus the two shared modules
both create surfaces consume.

- [ ] T001 Amend Constitution Principle XIII in `.specify/memory/constitution.md` per FR-027: widen the Feature Scope carve-out to admit project creation and ritual-definition creation as mobile capabilities, narrowly — role and permission editing, department management, bulk member import, account deactivation, credential reset for others, billing and quota management stay web-only. Bump `**Version**` from 5.19.0 to 5.20.0 (MINOR — a principle's scope widens), set `Last Amended` to 2026-09-04, and add the amendment to the versioning history list with its rationale and the feature it unblocks, matching the v5.17.0 entry's shape. Update the sync impact report at the top of the file.
- [ ] T002 [P] Create `frontend/packages/validations/src/project-key.ts` exporting `PROJECT_KEY_PATTERN` (`/^[A-Z][A-Z0-9_]{0,9}$/`), `PROJECT_KEY_RULE_TEXT`, `projectKeySchema` (zod) and `deriveProjectKey(name)`, verbatim per [contracts/api-wrapper-changes.md](./contracts/api-wrapper-changes.md) §2, including the doc comments recording that the DB `valid_project_key` CHECK is the authority and that the derivation is deliberately lossier than the rule.
- [ ] T003 Re-export `PROJECT_KEY_PATTERN`, `PROJECT_KEY_RULE_TEXT`, `projectKeySchema` and `deriveProjectKey` from `frontend/packages/validations/src/index.ts`, in a `// Project key validation` block matching the existing email/password/subdomain block style (depends on T002).
- [ ] T004 [P] Create `frontend/apps/mobile/src/lib/device-timezone.ts` with `getDeviceTimezone()` returning `Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"` inside a try/catch falling back to `"UTC"`, carrying the comment from [contracts/api-wrapper-changes.md](./contracts/api-wrapper-changes.md) §8 explaining why an IANA name and not a UTC offset.
- [ ] T005 Create `frontend/apps/mobile/src/lib/device-timezone.check.ts` as an assert-based self-check in the style of `src/lib/doc-rows.check.ts` (non-empty string returned, `"UTC"` on a throwing `Intl`), and register `"check:device-timezone": "node --experimental-strip-types src/lib/device-timezone.check.ts"` in `frontend/apps/mobile/package.json` beside `check:doc-rows` (depends on T004).

**Checkpoint**: The constitution permits the feature, the key rule has one home, and the phone can name its own timezone.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The wire and error-mapping work both create surfaces rest on. **No user story can
be completed until this phase is done** — US1 cannot save requirements atomically without T008,
and US2 cannot show a field-named duplicate-key refusal without T010–T012.

**⚠️ CRITICAL**: Blocks Phase 3 and Phase 4.

### Tests first (Constitution II)

- [ ] T006 [P] Add a duplicate-project-key case to `backend/integration/collaboration_project_test.go`: create a project with key `STORE`, create a second with the same key in the same organization, assert the error is `CodeInvalidArgument` carrying a `BadRequest.FieldViolation` on field `key`, and assert a project keyed `STORE` in a *different* organization still succeeds (the constraint is per-organization). Expected to fail until T010–T011.
- [ ] T007 [P] Add an atomic inline-`evidence_requirements` case to `backend/integration/collaboration_ritual_test.go`: call `CreateRitualDefinition` with two `evidence_requirements` in the same request, assert both rows exist with the sent names, types, `is_required` values and `position` assigned from array index; then assert a request whose second requirement is invalid creates neither the definition nor any requirement (FR-013 atomicity).

### Implementation

- [ ] T008 Extend `frontend/packages/apis/src/collaboration-ritual.ts`: add the exported `CreateRitualDefinitionEvidenceRequirementInput` interface and the optional `evidenceRequirements` field on `CreateRitualDefinitionParams`, and map it in the `createRitualDefinition` body using the existing `stringToProtoEvidenceType`, `stringToProtoApprovalMode` and auto-approve mappers, per [contracts/api-wrapper-changes.md](./contracts/api-wrapper-changes.md) §1. Additive and optional — every existing caller must still compile unchanged.
- [ ] T009 [P] Migrate `frontend/apps/web/src/app/workspace/projects/page.tsx` off its two inline copies of the key rule — the `useEffect` derivation and the `/^[A-Z][A-Z0-9_]{0,9}$/` test — onto `deriveProjectKey`, `projectKeySchema` and `PROJECT_KEY_RULE_TEXT` from `@tech-office/validations`, so web and mobile state the rule identically (Constitution VIII) (depends on T003).
- [ ] T010 Add `ErrProjectKeyTaken` and `ErrProjectKeyInvalid` to the sentinel block in `backend/internal/collaboration/logic.go` beside `ErrProjectNotFound`, with the doc comments from [contracts/api-wrapper-changes.md](./contracts/api-wrapper-changes.md) §3 recording that the key is permanent so a taken key is a refusal, not something to auto-correct.
- [ ] T011 Classify the create error in `backend/internal/collaboration/project_logic.go`: on the `l.Queries.CreateProject` failure path, `errors.As` into `*pgconn.PgError` and map `ConstraintName` `unique_project_key` → `ErrProjectKeyTaken` and `valid_project_key` → `ErrProjectKeyInvalid`, falling through to the existing log-and-wrap for anything else (depends on T010).
- [ ] T012 Map both sentinels in the `handleError` switch in `backend/internal/collaboration/connect.go` to `fieldViolation(connect.CodeInvalidArgument, err, "key", err.Error())`, placed beside the existing `procedure_document_id` and `title` field-violation cases (depends on T010).

**Checkpoint**: `make test-backend-one T=TestProject` and `T=TestRitualDefinition` pass; `cd frontend && pnpm typecheck` is clean across web, mobile and packages. User stories can now start.

---

## Phase 3: User Story 1 — Define Tomorrow's Ritual From The Shop Floor (Priority: P1) 🎯 MVP

**Goal**: An owner or project admin defines a recurring checklist from the phone — name,
recurrence, evidence requirements, optional assignees — and its upcoming runs are visible
immediately.

**Independent Test**: In a workspace that already has a project, sign in on a phone as an
owner, define a daily ritual with one required photo requirement, save, and confirm the
upcoming runs list on the phone with no wait, and that an assigned worker can open tomorrow's
run and submit against the requirement.

### Tests for User Story 1

- [ ] T013 [P] [US1] Write the Maestro flow `frontend/apps/mobile/.maestro/rituals/create-ritual.yaml`: sign in via `auth/signin-known-device.yaml`, open the tasks tab → projects → the seeded project, tap `project-create-ritual-button`, fill `ritual-name-input`, tap `ritual-recurrence-daily`, assert `ritual-timezone-line` visible, fill `ritual-requirement-name-0`, tap `ritual-requirement-type-0-photo`, tap `create-ritual-submit`, assert the ritual template screen and its upcoming runs. Expected to fail until T014–T019.

### Implementation for User Story 1

- [ ] T014 [P] [US1] Create `frontend/apps/mobile/src/components/rituals/recurrence-picker.tsx`: three segments (`ritual-recurrence-daily` / `-weekly` / `-monthly`); weekly reveals a seven-segment row `ritual-weekday-1`…`-7` with two-letter labels (`1`=Mon … `7`=Sun, matching the proto), `flexShrink` per segment and a 44dp minimum tap target; monthly reveals a wrapped grid of chips `ritual-day-of-month-1`…`-31`. No dropdown, no picker wheel, no `Dimensions` branching, no iOS-only props. Renders its validation message at `ritual-recurrence-error`.
- [ ] T015 [P] [US1] Create `frontend/apps/mobile/src/components/rituals/evidence-requirement-editor.tsx`: a list of requirement rows (`ritual-requirement-{index}`), each with a name input (`ritual-requirement-name-{index}`), a `flexWrap` chip row of the seven proof types (`ritual-requirement-type-{index}-{type}` for `photo`, `voice_memo`, `pdf`, `file`, `link`, `text_note`, `gps_checkin`), a Required/Optional toggle defaulting to Required (`ritual-requirement-required-{index}`) and a remove action (`ritual-requirement-remove-{index}`) disabled while one row remains; plus `ritual-add-requirement` beneath. Rows are keyed by the client-only `localId` from [data-model.md](./data-model.md#evidencerequirementdraft).
- [ ] T016 [P] [US1] Create `frontend/apps/mobile/src/components/rituals/assignee-picker.tsx`: a search field (`ritual-assignee-search`) over the project's members via `listProjectMembers(projectId)` resolved to names with `getEmployeeCards(employeeIds)` from `apis` (not `autocompleteEmployees` — see [research.md](./research.md) §6), results as `ritual-assignee-option-{employeeId}`, selections as removable chips `ritual-assignee-chip-{employeeId}`, and a helper line stating that leaving it empty starts each run unassigned.
- [ ] T017 [US1] Create `frontend/apps/mobile/src/app/(app)/(tasks)/[projectId]/create-ritual.tsx`: a single-column `ScrollView` (`create-ritual-screen`) laying out name → description (plain text, 3 lines) → recurrence → the read-only timezone line (`ritual-timezone-line`, from `getDeviceTimezone()`) → requirements → assignees → `create-ritual-submit`, with a header Cancel (`create-ritual-cancel-button`). Holds the `RitualDraft` state from [data-model.md](./data-model.md#ritualdraft); runs the six client-side submit-time validations, each anchored to the control that is wrong; submits one `createRitualDefinition` call carrying `evidenceRequirements` inline with `completionWindowHours: 24`, empty `defaultDepartmentPools`, no `procedureDocumentId` and `interval: 1`; renders a server refusal at `create-ritual-error` while keeping every field and every requirement row; on success invalidates `["ritualDefinitions", projectId]` and the project's task queries then `router.replace`s to `/(app)/(tasks)/rituals/{definitionId}` (depends on T008, T014, T015, T016).
- [ ] T018 [US1] Register `[projectId]/create-ritual` as a modal `Stack.Screen` titled "New Ritual" in `frontend/apps/mobile/src/app/(app)/(tasks)/_layout.tsx`, matching the modal presentation used by `(chat)/new-channel.tsx` and `(calendar)/create.tsx` (depends on T017).
- [ ] T019 [US1] Add the `project-create-ritual-button` affordance to `frontend/apps/mobile/src/app/(app)/(tasks)/[projectId]/index.tsx`, rendered only when the `["employee-permissions", auth.employeeId]` query contains `collab.manageRitualDefinition` **and** `getProject(projectId).currentUserRole` is `owner` or `admin`. The screen does not fetch `getProject` today and must; absent, never disabled (FR-015, US1 scenario 4) (depends on T018).
- [ ] T020 [US1] Add `$APP_DIR/.maestro/rituals/create-ritual.yaml` to the `flows` array in `frontend/apps/mobile/scripts/run-maestro-suite.sh`, after the compliance flows, so `make test-mobile` covers it (FR-025) (depends on T013, T019).

**Checkpoint**: `make test-mobile-one F=rituals/create-ritual` passes. A ritual can be defined from a phone inside an existing project and its runs are there immediately. Independently demoable.

---

## Phase 4: User Story 2 — Start A Project From The Phone (Priority: P1)

**Goal**: An owner creates a project from the phone — name, key, description, visibility,
collaboration mode — and lands on it.

**Independent Test**: On a phone, create a project with a name and a mode; confirm it appears
in the mobile project list and on the web with the same name, identifier and mode.

### Tests for User Story 2

- [ ] T021 [P] [US2] Write the Maestro flow `frontend/apps/mobile/.maestro/projects/create-project.yaml`: sign in, open the tasks tab → projects, tap `projects-create-button`, fill `project-name-input`, assert `project-key-input` carries the derived key, tap `project-mode-ritual`, tap `create-project-submit`, assert arrival on the new project screen. Use `MAESTRO_RUN_ID` in the project name so a second run does not collide on the key. Expected to fail until T022–T024.

### Implementation for User Story 2

- [ ] T022 [US2] Create `frontend/apps/mobile/src/app/(app)/(tasks)/create-project.tsx`: a single-column `ScrollView` (`create-project-screen`) with header Cancel (`create-project-cancel-button`), laying out name (autofocus, `project-name-input`) → key (`project-key-input`, uppercase-forced, helper line carrying `PROJECT_KEY_RULE_TEXT`, error line `project-key-error`) → description (`project-description-input`) → two visibility segments (`project-visibility-private` / `-public`) → three mode segments (`project-mode-standard` / `-ritual` / `-mixed`) with the web's one-line explanations in plain language → `create-project-submit`. Holds the `ProjectDraft` state from [data-model.md](./data-model.md#projectdraft) with the explicit `keyTouched` flag; derives the key with `deriveProjectKey` while untouched and stops on first edit; tests `projectKeySchema` before sending anything; on a server refusal renders `fieldViolation(error, 'key')` on the key input and anything else at `create-project-error`, keeping every field's value; on success invalidates `["projects"]` and `router.replace`s to `/(app)/(tasks)/{id}` (depends on T003, T012).
- [ ] T023 [US2] Register `create-project` as a modal `Stack.Screen` titled "New Project" in `frontend/apps/mobile/src/app/(app)/(tasks)/_layout.tsx` (same file as T018 — sequence them, do not parallelise) (depends on T022).
- [ ] T024 [US2] Add the `projects-create-button` affordance to the projects mode of `frontend/apps/mobile/src/app/(app)/(tasks)/index.tsx`, rendered only when the `["employee-permissions", auth.employeeId]` query contains `collab.createProject`; absent, never disabled (FR-004, SC-005). It sits with the projects list, not on the focus view (depends on T023).
- [ ] T025 [US2] Add `$APP_DIR/.maestro/projects/create-project.yaml` to the `flows` array in `frontend/apps/mobile/scripts/run-maestro-suite.sh` (FR-025) (depends on T021, T024).

**Checkpoint**: `make test-mobile-one F=projects/create-project` passes. US1 and US2 both work independently.

---

## Phase 5: User Story 3 — The Tour Stops Point Somewhere On Mobile (Priority: P2)

**Goal**: The administrator tour's `project` and `ritual` stops carry their full web body copy
and a working action on mobile; `people` stays web-only.

**Independent Test**: Take the administrator tour on a phone; both stops show full copy with an
action button, each lands on the matching create surface, the ritual stop falls back to project
creation with a visible note in a workspace with no project, and the people stop still shows its
web-only note.

**Depends on**: Phases 3 and 4 — an actionable stop pointing at a screen that does not exist is
the empty-screen failure the tour's own spec forbids.

### Tests for User Story 3

- [ ] T026 [P] [US3] Update `backend/integration/feature_tour_test.go`: narrow the hard-coded `webOnly := map[string]bool{"people": true, "project": true, "ritual": true}` at ~line 113 to `{"people": true}`, and add a sub-test asserting that on `PLATFORM_MOBILE` the `project` and `ritual` stops arrive with their web body copy, their action label and their target intact (not `TOUR_TARGET_NONE`). Expected to fail until T028.
- [ ] T027 [P] [US3] Update `frontend/apps/mobile/.maestro/feature-tour/owner-tour.yaml`: move `assertNotVisible: feature-tour-action` to stop 1 (`people`) only, and assert on stops 2 and 3 that `feature-tour-action` **is** visible and that tapping it lands on `create-project-screen` and `create-ritual-screen` respectively.

### Implementation for User Story 3

- [ ] T028 [US3] In `backend/internal/tour/content.go`, set `WebOnly: false` on the `project` and `ritual` administrator stops and **delete** their `MobileNote` fields (a retained note is unreachable text asserting something false); leave the `people` stop untouched (FR-020); bump `ContentVersion` from `"2026-09-02.1"` to `"2026-09-04.1"`. `logic.go` is not touched — the substitution rule is correct, only its inputs move.
- [ ] T029 [P] [US3] In `frontend/apps/mobile/src/lib/tour-routes.ts`, route `projects` to `/(app)/(tasks)/create-project` and `rituals` to the same as its no-project fallback; add the `context.firstProjectId` branch in `resolveTourRoute` returning `/(app)/(tasks)/{firstProjectId}/create-ritual`; export `ritualRouteFallsBackToProject(target, context)`. Keep `people: null` and its comment. Mirror `apps/web/src/lib/tour-routes.ts` structurally — only the route strings differ.
- [ ] T030 [US3] In `frontend/apps/mobile/src/hooks/use-feature-tour.ts`, fetch the first project with `listProjects()` under the existing `queryKey: ["projects"]` (sharing the tasks tab's cache), build `routeContext = { firstProjectId: projects?.[0]?.id }`, pass it from `act()` into `resolveTourRoute`, and expose `actionFallsBackToProjectCreation` computed with `ritualRouteFallsBackToProject`. Leave `start`, `next`, `previous`, `dismiss`, `restart`, every `writeProgress` call, the offer rules, the `homeRoute`/`away` suppression and `act()`'s advance-to-next-stop behaviour untouched (FR-022) (depends on T029).
- [ ] T031 [US3] In `frontend/apps/mobile/src/components/feature-tour.tsx`, render the fallback note under the body when `actionFallsBackToProjectCreation`, at `testID="feature-tour-ritual-fallback-note"`, with the copy verbatim from [contracts/api-wrapper-changes.md](./contracts/api-wrapper-changes.md) §7 so it matches the web card word for word (depends on T030).
- [ ] T032 [P] [US3] Rewrite stops 2 and 3 in `specs/039-feature-tour/contracts/tour-content.md` per [contracts/tour-content-delta.md](./contracts/tour-content-delta.md): replace both **Web-only** blocks and their mobile notes with the "Available on both platforms (feature 044)" text and the mobile routes, bump the stated `content_version`, and replace the review-note paragraph beginning "**Three stops are web-only**" with the one-stop replacement paragraph given in the delta. Body copy of both stops is unchanged, so the word-count table needs no re-measuring.

**Checkpoint**: `make test-backend-one T=TestFeatureTour` and `make test-mobile-one F=feature-tour/owner-tour` pass. The tour is actionable on mobile for every administrator stop except `people`.

---

## Phase 6: User Story 4 — Undo A Ritual Created By Mistake (Priority: P3)

**Goal**: A project owner or admin archives and unarchives a ritual definition from the phone,
behind a confirmation, with no other edit offered.

**Independent Test**: Create a ritual on the phone, archive it from the phone, confirm no
further runs are generated and existing future runs behave exactly as they do when a ritual is
archived on the web; then restore it.

**Depends on**: Phase 3 (there is nothing to archive until a ritual can be created from the phone).

### Tests for User Story 4

- [ ] T033 [P] [US4] Write the Maestro flow `frontend/apps/mobile/.maestro/rituals/archive-ritual.yaml`: open a ritual template, tap `ritual-archive-button`, confirm the alert, assert `ritual-archived-badge` and `ritual-unarchive-button` are visible, tap `ritual-unarchive-button`, assert the badge is gone. Expected to fail until T034.

### Implementation for User Story 4

- [ ] T034 [US4] Add archive and unarchive to `frontend/apps/mobile/src/app/(app)/(tasks)/rituals/[definitionId].tsx`: fetch `getProject(projectId).currentUserRole` (the screen does not today) and show the action only to `owner` or `admin` (US4 scenario 3); `ritual-archive-button` opens an `Alert.alert` confirmation stating that no new runs will be created, then calls `archiveRitualDefinition(id, true)`; an archived definition renders `ritual-archived-badge` in place of the existing "Reference only" badge and offers `ritual-unarchive-button` → `archiveRitualDefinition(id, false)` with no confirmation (restore is not the destructive direction); invalidate `["ritual-definition", id]` and `["ritualDefinitions", projectId]` on success. Add nothing else — no rename, no schedule change, no requirement editing (FR-018).
- [ ] T035 [US4] Add `$APP_DIR/.maestro/rituals/archive-ritual.yaml` to the `flows` array in `frontend/apps/mobile/scripts/run-maestro-suite.sh` (same file as T020 and T025 — sequence them) (depends on T033, T034).

**Checkpoint**: All four user stories are independently functional.

---

## Phase 7: Polish, Documentation & Cross-Cutting Concerns

**Purpose**: FR-023 and SC-008 — the feature is not done while any document still claims mobile
cannot do this — plus the sizing and type-safety gates.

- [ ] T036 [P] Close drift **D38** in the drift register in `docs/domain/README.md` (line ~74, "The mobile app can list projects and rituals but creates neither"), recording that feature 044 resolved it rather than deleting the row silently, per the register's existing convention for closed entries.
- [ ] T037 [P] Update `docs/domain/workspace-navigation.md` (~line 196): "Three administrator stops are web-only: `people`, `project` and `ritual`…" becomes one web-only stop (`people`), and record the two mobile create routes the tour now points at.
- [ ] T038 [P] Update `docs/domain/rituals-tasks.md`: add mobile ritual-definition creation (the collected subset and the defaults it sends) and mobile archive/unarchive to the definition section; keep the existing true statements that mobile has no ritual pool configuration (~line 743) and reads but never configures the procedure document (~line 774), and add that auto-approval, completion/generation windows, custom intervals and nth-weekday recurrences remain web-only.
- [ ] T039 [P] Correct the framing around the "Screens NOT Built for Mobile (Web-Only)" table in `specs/mobile-ui-design.md` §9 (line ~936): its rationale sentence cites Principle XIII, whose scope T001 widens. Project and ritual creation were never rows in the table, so this is a correction to the surrounding prose, not a row deletion.
- [ ] T040 Verify both new screens at 360dp width on an Android emulator (`adb shell wm size 360x800 && adb shell wm density 160`) **and** on an iPhone SE, per [quickstart.md](./quickstart.md) §8 and the standing rule that the habitual iOS device hides narrow-Android regressions. The three controls to check hardest: the seven-segment weekday row, the 31-chip day-of-month grid, and the seven proof-type chips. Nothing clipped, nothing overlapping, every tap target at least 44dp. Reset the emulator afterwards (FR-024, SC-007).
- [ ] T041 Run the drift sweep from [quickstart.md](./quickstart.md) §9 — `rg -n "no create surface|creates neither|has no create surface" docs/ specs/` — and confirm it returns nothing that still asserts the absence (SC-008) (depends on T036–T039).
- [ ] T042 Run the cross-stack gates: `cd frontend && pnpm typecheck:mobile && pnpm --filter web exec tsc --noEmit`, `pnpm --filter mobile check:device-timezone`, `make test-backend`, and the full `make test-mobile`. `TOUR_ROUTES` being a `Record<TourTarget, …>` and the shared `projectKeySchema` are what make the `tsc` run a real drift guard rather than a formality (Constitution VIII).
- [ ] T043 Walk [quickstart.md](./quickstart.md) §§1–6 end to end on a device with the two accounts it specifies, confirming SC-001 (under 2 minutes to a visible run), SC-002 (under 60 seconds to a project), SC-003 (phone and web produce identical runs from identical inputs), SC-005 (no affordance the plain member cannot complete) and SC-006 (nothing lost on a refusal, and a retry after an ambiguous network failure creates exactly one ritual).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: no dependencies. T001 is task zero — land it before any code.
- **Phase 2 (Foundational)**: depends on Phase 1 (T009 needs T003). **Blocks Phases 3 and 4.**
- **Phase 3 (US1, P1)**: depends on Phase 2 (T017 needs T008).
- **Phase 4 (US2, P1)**: depends on Phase 2 (T022 needs T003 and T012). Independent of Phase 3 except for the shared `_layout.tsx` edit (T018/T023) and the shared suite-runner edit (T020/T025/T035).
- **Phase 5 (US3, P2)**: depends on Phases 3 **and** 4 — both routes must exist before the tour points at them.
- **Phase 6 (US4, P3)**: depends on Phase 3.
- **Phase 7 (Polish)**: depends on every story phase that is being shipped.

### User Story Dependencies

- **US1 (P1)**: needs only Foundational. Every registered workspace already has a project, which is what makes it deliverable without US2.
- **US2 (P1)**: needs only Foundational. Independent of US1.
- **US3 (P2)**: needs US1 and US2 shipped — its two actions land on their screens.
- **US4 (P3)**: needs US1 — nothing to archive otherwise.

### Serialized files (do not parallelise across these)

| File | Tasks |
|---|---|
| `frontend/apps/mobile/src/app/(app)/(tasks)/_layout.tsx` | T018, T023 |
| `frontend/apps/mobile/scripts/run-maestro-suite.sh` | T020, T025, T035 |
| `backend/internal/collaboration/logic.go` → `project_logic.go` → `connect.go` | T010 → T011, T012 |

### Parallel Opportunities

- **Phase 1**: T002 and T004 in parallel; T003 after T002, T005 after T004. T001 can run alongside all of them.
- **Phase 2**: T006 and T007 (different test files) in parallel; T008 and T009 in parallel with each other and with the backend chain T010→T011/T012.
- **Phase 3**: T013, T014, T015 and T016 all in parallel — one flow file and three new component files with no imports between them. T017 joins them.
- **Phase 5**: T026, T027, T029 and T032 in parallel — a Go test, a Maestro flow, a mobile lib file and a spec document.
- **Phase 7**: T036, T037, T038 and T039 in parallel — four different documents.
- **Across stories**: once Phase 2 is done, one developer can take US1 (Phase 3) and another US2 (Phase 4), coordinating only on `_layout.tsx` and the suite runner.

---

## Parallel Example: User Story 1

```bash
# Launch the flow and all three new components together — four files, no shared imports:
Task: "Write .maestro/rituals/create-ritual.yaml"                         # T013
Task: "Create src/components/rituals/recurrence-picker.tsx"               # T014
Task: "Create src/components/rituals/evidence-requirement-editor.tsx"     # T015
Task: "Create src/components/rituals/assignee-picker.tsx"                 # T016
```

## Parallel Example: Phase 7 documentation

```bash
Task: "Close D38 in docs/domain/README.md"                    # T036
Task: "One web-only stop in docs/domain/workspace-navigation.md"  # T037
Task: "Mobile create + archive in docs/domain/rituals-tasks.md"   # T038
Task: "Correct §9 framing in specs/mobile-ui-design.md"           # T039
```

---

## Implementation Strategy

### MVP (User Story 1 only)

1. Phase 1 — the constitution amendment and the two shared modules.
2. Phase 2 — the wrapper field and the key error mapping. (T009/T010–T012 are only strictly
   needed by US2; ship them anyway, they are three small edits and Principle VIII will not
   tolerate the regex sitting in two clients while US2 waits.)
3. Phase 3 — ritual creation.
4. **STOP and VALIDATE**: quickstart §1 on a device. An owner can define tomorrow's checklist
   from the shop floor. That is the whole request.

### Incremental delivery

1. Setup + Foundational → foundation ready.
2. + US1 → the headline capability. Demo it.
3. + US2 → a second project can be started from the phone.
4. + US3 → the tour finds both of them. Only now is D38 fully closeable.
5. + US4 → a mistake can be undone from the phone rather than nagging every morning.
6. + Phase 7 → documentation matches behaviour and the feature is done.

Do not ship US1–US4 without Phase 7: FR-023 and SC-008 make the documentation part of the
change set, not a follow-up.

---

## Notes

- [P] = different files, no dependencies. Three files are touched by more than one task and are
  called out in the serialized-files table above.
- Every added interactive element carries a `testID` (Constitution XIII); the complete list is
  in [contracts/mobile-surfaces.md](./contracts/mobile-surfaces.md) so the flows and the screens
  are written against the same names rather than discovering them during implementation.
- No mobile file may import from `rpc` (Constitution VII) — every call goes through `apis`.
- No new RPC, proto message, table, migration, permission or dependency is introduced by any
  task in this list. If a task appears to need one, the task is wrong.
- Commit after each task or logical group; stop at any checkpoint to validate a story on its own.
