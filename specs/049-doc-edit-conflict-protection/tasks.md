---
description: "Task list for feature 049 — Document Edit Conflict Protection"
---

# Tasks: Document Edit Conflict Protection

**Input**: Design documents from `/specs/049-doc-edit-conflict-protection/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: **Required.** Constitution principle II (Scenario-First Integration & E2E
Testing) mandates them, and the behavioural contract is already written and agreed in
[contracts/test-scenarios.md](./contracts/test-scenarios.md). Test tasks below author
exactly those scenarios — no new scenarios are invented here, and no unit or snapshot
tests are added.

**Organization**: Tasks are grouped by user story. User Story 3 is excluded from scope
with justification recorded in `plan.md`; it has no tasks here.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2)
- Every task names the exact file it touches

## Path Conventions

Web application layout, used unchanged: `backend/` (Go, schema-first, two-layer
services) and `frontend/` (pnpm workspace; `packages/rpc` is generated from
`backend/rpc/v1`, `packages/apis` is the only place components call RPCs from).
Nothing under `frontend/apps/mobile` changes — documents are read-only there and it
never constructs an `UpdateDocumentRequest`.

---

## Phase 1: Setup — Contract & Code Generation

**Purpose**: Land the schema-first contract change and regenerate both languages from
it, so every later task compiles against the real generated types rather than a
hand-mirrored copy (Constitution VIII).

- [ ] T001 Add `int32 base_version = 5;` to `UpdateDocumentRequest` in `backend/rpc/v1/document.proto`, with the comment from `contracts/document-update.md` stating it is required and that omitting it sends `0`, which never matches; and add a comment to `Document.version_count` (field 12) recording that it is the document's current version number because versions are never pruned and never renumbered
- [ ] T002 [P] Create `backend/rpc/v1/docs_error_details.proto` with `message DocumentVersionConflict { int32 current_version_number = 1; string conflicting_author_name = 2; google.protobuf.Timestamp conflicting_changed_at = 3; }`, verbatim from `contracts/docs_error_details.proto` including its doc comments, following the existing `backend/rpc/v1/iam_error_details.proto` for package, `go_package` and file layout
- [ ] T003 [P] Add `AND version_count = @base_version` to the `WHERE` clause of `-- name: UpdateDocument :one` in `backend/database/scripts/docs.query.sql` (line 40), keeping `organization_id` as the leading predicate and adding no join
- [ ] T004 Run `cd backend && buf generate` to regenerate `backend/rpc/v1/document.pb.go`, `backend/rpc/v1/docs_error_details.pb.go` and the TypeScript in `frontend/packages/rpc/rpc/v1/` from T001 and T002
- [ ] T005 Run `cd backend && sqlc generate` to regenerate `backend/database/docs.query.sql.go` so `UpdateDocumentParams` carries `BaseVersion` from T003
- [ ] T006 Run `make lint-tenancy` and confirm the changed `UpdateDocument` query is still tenancy-clean; do **not** touch `backend/database/scripts/schema.sql`, which is a generated snapshot and ships no DDL for this feature

**Checkpoint**: The contract exists in both languages and the SQL is a compare-and-swap. The tree does not compile yet — the call sites in Phase 2 have not been migrated.

---

## Phase 2: Foundational — Migrate Existing Call Sites

**Purpose**: The base version is required by design (no compatibility shim — the
project ships all clients together), so every existing caller must carry one before
either user story can be tested. Until this phase completes, neither `go build` nor the
existing suites compile.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T007 Change `testWorld.updateDocument` in `backend/integration/helper_test.go` (line ~2138) to read the document's current `version_count` and pass it as `BaseVersion`, and add a sibling helper that takes an explicit base version and returns the error rather than asserting success, so conflict scenarios can assert on the refusal
- [ ] T008 [P] Update the direct `rpcv1.UpdateDocumentRequest{...}` construction in `backend/integration/collaboration_ritual_procedure_test.go` (line ~776) to carry the document's current version as `BaseVersion`
- [ ] T009 [P] Add a required `baseVersion` argument to the `updateDocument` helper in `frontend/apps/web/e2e/helpers/api.ts` (line ~1020) and update its three call sites in `frontend/apps/web/e2e/document-collab.spec.ts` (lines ~115, ~199, ~207) to pass the version they read
- [ ] T010 Run `make test-backend-one T='TestDocumentCRUD|TestDocumentVersion|TestDocumentDiff|TestWorkflowDocumentCollab|TestRitualProcedure'` and confirm the pre-existing suites compile and pass against the new predicate

**Checkpoint**: Backend builds, existing backend suites are green, and the solo-save path already carries a base version. Conflicts currently surface as an opaque `INTERNAL` — Phase 3 gives them their outcome.

---

## Phase 3: User Story 1 — A stale save is refused instead of overwriting (Priority: P1) 🎯 MVP

**Goal**: `UpdateDocument` refuses a save whose base version is not the document's
current version, changes nothing when it does, and reports the refusal as `ABORTED`
carrying the current version number, the conflicting author's name and when they
saved. This alone removes the data loss.

**Independent Test**: `make test-backend-one T=TestDocumentEditConflict` — load a
document, save as person A, then save as person B carrying the version A started from,
and confirm the second save is refused and the stored document still holds A's content.

### Tests for User Story 1 ⚠️

> Write this file first and confirm the conflict scenarios FAIL before T012–T016.

- [ ] T011 [US1] Author `backend/integration/docs_conflict_test.go` as `TestDocumentEditConflict`, using the testWorld pattern and reproducing every `t.Run` group and leaf from the Backend section of `contracts/test-scenarios.md` with real arrange/act/assert bodies: the common path, a stale save, a stale save that also renamed, a base version ahead of current, an omitted base version, the error-detail round trip, a person's own second session, two saves racing from the same base version in concurrent goroutines, a long gap with no other save, a permission failure that must stay a permission failure, reload-then-save, no notification on a refusal, and the unaffected reading surfaces

### Implementation for User Story 1

- [ ] T012 [US1] Add `ErrVersionConflict` beside the existing sentinels (line ~25) and a `VersionConflictError` struct carrying the current version number, the conflicting author's display name and the change timestamp, with `Error()` producing the message from `contracts/document-update.md` and `Is`/`Unwrap` matching `ErrVersionConflict`, in `backend/internal/docs/logic.go`
- [ ] T013 [US1] In `documentLogicImpl.UpdateDocument` in `backend/internal/docs/logic.go`, compare `req.BaseVersion` against `currentDoc.VersionCount` immediately after the `GetDocumentByID` (line ~544) and **before** the `CreateSlugHistory` call, returning a populated `VersionConflictError` on mismatch so a refusal never speculatively writes
- [ ] T014 [US1] In the same function, map `pgx.ErrNoRows` from `Queries.UpdateDocument` (line ~580) to the same `VersionConflictError` — the rare lost race where the Go check passed on an older snapshot — populating it by re-reading the document and calling `Queries.GetVersion` for `author_name` and `created_at`; extract the population into one helper both T013 and this path call, in `backend/internal/docs/logic.go`
- [ ] T015 [US1] Log the refusal once at INFO with the document id, the base version and the current version, in `backend/internal/docs/logic.go` (Constitution V — no new metric, no new counter)
- [ ] T016 [US1] Add a `VersionConflictError` case to `DocumentServiceConnect.handleError` in `backend/internal/docs/connect.go` (line ~509) returning `connect.CodeAborted` with exactly one `connect.NewErrorDetail(&rpcv1.DocumentVersionConflict{...})`, placed so the pre-existing `ErrAccessDenied` → `PERMISSION_DENIED` case still wins for a caller who may not edit
- [ ] T017 [US1] Run `make test-backend-one T=TestDocumentEditConflict` until every scenario passes
- [ ] T018 [US1] Re-run the pre-existing suites from T010 and confirm they are still green — the common save path must be unchanged apart from carrying a base version (FR-008, SC-005)

**Checkpoint**: The data loss is gone at the service boundary. A stale save is refused, nothing is written, and the refusal names who got there first. The web editor still reports it as a generic save error — that is User Story 2.

---

## Phase 4: User Story 2 — The editor tells the person and keeps their work (Priority: P1)

**Goal**: The web editor sends the base version it loaded, and on a conflict shows a
distinct banner naming the conflicting author and time, keeps the person's typed text
in the editor, and offers "copy my changes" and "load the current version" so their
next save succeeds.

**Independent Test**: `make test-frontend-one F=document-conflict` — open the same
document in two sessions, save in one, then save in the other and confirm the second
session shows a conflict notice, still holds its unsaved text, and can recover to the
current version through the offered action.

### Tests for User Story 2 ⚠️

- [ ] T019 [P] [US2] Author `frontend/apps/web/e2e/document-conflict.spec.ts` reproducing every `test.describe` group and leaf from the Web E2E section of `contracts/test-scenarios.md` — the conflict notice, declining to reload, loading the current version, the same person's two tabs, the tab-switch refetch guard, and the solo save — arranging via `helpers/api.ts` and asserting through the UI

### Implementation for User Story 2

- [ ] T020 [P] [US2] Add `DocumentVersionConflictDetail` and `extractDocumentVersionConflict(error: unknown): DocumentVersionConflictDetail | null` to `frontend/packages/apis/src/errorDetails.ts`, following `extractPinAuthErrorDetail` (line ~151) for the generated-type lookup and returning `null` when the error is not a conflict
- [ ] T021 [US2] Make `baseVersion: number` a required field of `UpdateDocumentParams` and pass it through to `documentClient.updateDocument` in `frontend/packages/apis/src/docs.ts` (lines ~560–584)
- [ ] T022 [US2] Hold the base version in `DocumentEditor` state seeded from `document.versionCount`, send it from `saveMutation.mutationFn`, and advance it from the response's `newVersionNumber` in `onSuccess`, in `frontend/apps/web/src/app/workspace/docs/components/DocumentEditor.tsx` (lines ~627–635, ~934–1010)
- [ ] T023 [US2] Guard the "Reset when document changes" effect (line ~850) and the enter-edit-mode re-apply effect (line ~890) in `frontend/apps/web/src/app/workspace/docs/components/DocumentEditor.tsx` so neither calls `applyEditorContent` while `hasChanges` is true — this closes the pre-existing hole where the 30-second `staleTime` refetch on window focus silently replaces unsaved text (research D7, FR-010)
- [ ] T024 [US2] Replace the generic `saveMutation.error` `Alert` (line ~1143) in `frontend/apps/web/src/app/workspace/docs/components/DocumentEditor.tsx` with a branch that renders a distinct `warning` conflict banner when `extractDocumentVersionConflict` returns a detail — naming the conflicting author and formatting the timestamp — and keeps the existing `error` alert otherwise, so a conflict reads differently from a lost connection or a permission failure (FR-004, FR-011)
- [ ] T025 [US2] Add two actions to that banner in `frontend/apps/web/src/app/workspace/docs/components/DocumentEditor.tsx`: "Copy my changes", writing `jsonToMarkdown(JSON.stringify(editor.getJSON()))` to `navigator.clipboard`; and "Load the current version", labelled so its effect on the unsaved draft is obvious, which refetches the document, applies the returned content and sets the base version to the version just loaded (FR-011, FR-012, SC-003)
- [ ] T026 [US2] Clear the conflict banner on a successful save and on "Load the current version" in `frontend/apps/web/src/app/workspace/docs/components/DocumentEditor.tsx`, so the notice does not outlive the conflict
- [ ] T027 [US2] Run `make test-frontend-one F=document-conflict` until every scenario passes
- [ ] T028 [US2] Run `make test-frontend-one F=document-collab` and `make test-frontend-one F=task-lifecycle` — the two surfaces that embed the same editor, reached through `TaskDetailSidePanel.tsx` and `projects/[id]/tasks/[taskId]/page.tsx`

**Checkpoint**: The full feature works as a person experiences it. A refused save keeps their text, tells them who saved first, and gets them to a successful re-save without leaving the document.

---

## Phase 5: Polish & Cross-Cutting Concerns

- [ ] T029 [P] Rewrite the sentence in `docs/domain/docs-knowledge.md` stating that concurrent edits are resolved last-write-wins — it is false after this change — and describe the base-version refusal, the `ABORTED` outcome and the `DocumentVersionConflict` detail instead, deleting the behaviour that no longer exists (Constitution XII)
- [ ] T030 [P] Add the concurrency-control note to `backend/docs/SYSTEM-ARCHITECTURE.md`: `UpdateDocument` is a compare-and-swap on `docs.document.version_count`, serialized by the PostgreSQL row lock rather than by any in-process lock, so it is correct across backend instances (Constitution XI, XII)
- [ ] T031 [P] Record the entry in the drift register in `docs/domain/README.md` if the last-write-wins statement was listed there, and remove it if the drift it recorded is now resolved
- [ ] T032 [P] Confirm `frontend/apps/mobile` still typechecks and its read-only document screens still open — it never constructs an `UpdateDocumentRequest`, so this is a verification, not a change (Constitution XIII)
- [ ] T033 Run `make test-backend`, `make test-frontend` and `make lint-tenancy` and confirm all three are green
- [ ] T034 Walk the manual scenario in `quickstart.md` §3 in two browser profiles, including the solo-save, two-tabs and tab-switching checks, and tick off the Definition of Done at the foot of `quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — starts immediately. T004 depends on T001 and T002; T005 depends on T003; T006 depends on T005.
- **Foundational (Phase 2)**: Depends on Phase 1 (the generated `BaseVersion` field must exist). **Blocks both user stories** — the tree does not compile until it is done.
- **User Story 1 (Phase 3)**: Depends on Phase 2. No dependency on User Story 2.
- **User Story 2 (Phase 4)**: Depends on Phase 2 to compile. Its E2E scenarios (T027) additionally require User Story 1, because there is no conflict to render until the backend produces one — T019 through T026 can be written and typechecked in parallel with Phase 3, but T027 cannot pass before T017.
- **Polish (Phase 5)**: Depends on both user stories.

### Within User Story 1

- T011 (tests) first, and must fail
- T012 (error type) → T013, T014 (the two paths that raise it) → T015 (logging) → T016 (Connect mapping)
- T013, T014, T015 all edit `backend/internal/docs/logic.go` and are therefore strictly sequential
- T017, T018 (test runs) last

### Within User Story 2

- T019 (tests) and T020 (extractor) are independent of everything else in the phase
- T021 (`docs.ts`) → T022 (editor sends the base version)
- T022 → T024 → T025 → T026 all edit `DocumentEditor.tsx` and are strictly sequential; T023 edits the same file and must be sequenced with them
- T027, T028 (test runs) last

### Parallel Opportunities

- **Phase 1**: T002 and T003 in parallel (a proto file and a SQL file); T001 alongside either.
- **Phase 2**: T008 and T009 in parallel with each other and with T007 — three different files.
- **Phase 3**: no parallelism inside the implementation — five of the six tasks edit `logic.go` or `connect.go` in a required order.
- **Phase 4**: T019 (E2E spec) and T020 (extractor) in parallel; everything after them serializes on `DocumentEditor.tsx`.
- **Phase 5**: T029, T030, T031 and T032 all in parallel — four different files, none of them code.
- **Across stories**: after Phase 2, a backend developer can take Phase 3 while a frontend developer takes T019–T026, converging at T027.

---

## Parallel Example: Phase 1

```bash
# After T001, launch the two independent contract edits together:
Task: "Create backend/rpc/v1/docs_error_details.proto with DocumentVersionConflict"
Task: "Add AND version_count = @base_version to UpdateDocument in backend/database/scripts/docs.query.sql"

# Then the two generators, each depending on a different one of the above:
cd backend && buf generate     # needs T001 + T002
cd backend && sqlc generate    # needs T003
```

## Parallel Example: Phase 5

```bash
Task: "Rewrite the last-write-wins sentence in docs/domain/docs-knowledge.md"
Task: "Add the concurrency-control note to backend/docs/SYSTEM-ARCHITECTURE.md"
Task: "Update the drift register in docs/domain/README.md"
Task: "Verify frontend/apps/mobile still typechecks and read-only doc screens open"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 — the contract exists in Go, TypeScript and SQL
2. Phase 2 — every existing caller carries a base version and the suites are green
3. Phase 3 — the refusal, its error detail and its backend scenarios
4. **STOP and VALIDATE**: `make test-backend-one T=TestDocumentEditConflict`. At this point concurrent edits can no longer silently overwrite each other, which is the whole reason the feature exists. The web editor reports the refusal as a generic save error and keeps the person's text (TanStack Query leaves the editor untouched on a mutation error), so even the MVP alone is a strict improvement, not a regression.
5. Deploy if desired — the backend and the web app ship together, and the web app is functional at this point.

### Incremental Delivery

1. Setup + Foundational → the contract is live and nothing is broken
2. Add User Story 1 → the data loss is gone → validate → deploy
3. Add User Story 2 → the person can act on the refusal → validate → deploy
4. Polish → the living documentation matches the shipped behaviour

### Parallel Team Strategy

Two developers, after Phase 2 completes:

- Developer A: Phase 3 (backend refusal and its scenarios)
- Developer B: T019–T026 (E2E spec, extractor, apis wrapper, editor banner)
- Converge at T027, which needs both halves

---

## Out of Scope

**User Story 3 — a live "a newer version exists" notice while typing** — is excluded,
with the justification recorded in `plan.md` under Constitution II's documented-exclusion
clause: it is P3, framed in the spec as "not part of the minimum fix", backed by no
functional requirement, and would require adding presence polling to a docs surface
that does not poll at all today. It has no tasks in this file.

**Character-level merging (CRDT / operational transform)** is excluded by FR-013 and by
the spec's own scope statement.

---

## Assumptions Resolved While Generating These Tasks

- [ASSUMPTION: Test tasks are included and are ordered before implementation within each
  story. Constitution principle II mandates scenario-first integration and E2E testing,
  and the scenarios were already written and agreed in `contracts/test-scenarios.md`
  before this file was generated, so the task list authors those scenarios rather than
  treating tests as optional.]
- [ASSUMPTION: The existing call-site migration (backend test helpers, the ritual-procedure
  test, the E2E API helper) is placed in the Foundational phase rather than inside User
  Story 1. Those files belong to neither story, and until they carry a base version the
  repository does not compile, which would block both stories equally.]
- [ASSUMPTION: `frontend/packages/apis/src/docs.ts` and `DocumentEditor.tsx` are both
  placed in User Story 2 rather than splitting the required-`baseVersion` change into
  Foundational. Splitting them would leave the web app failing to typecheck between two
  phases; keeping them together means the frontend goes from compiling to compiling in
  one step, consistent with the plan's "shipped atomically across the stack" position.]
- [ASSUMPTION: The `pgx.ErrNoRows` path (T014) is given its own task rather than being
  folded into T013. It is a genuinely separate code path with a different way of
  populating the error — it must re-read the document because the one in hand is stale —
  and research D3 requires both paths to converge on one error value.]
- [ASSUMPTION: The refetch-on-focus guard (T023) is scoped to User Story 2 rather than
  being filed as a separate defect. Research D7 identifies it as a pre-existing hole in
  the same component that FR-010 forbids, reachable by the very two-tab scenario this
  feature exists for, so it is fixed at its root here rather than worked around.]

---

## Notes

- `[P]` tasks touch different files and have no dependency on an incomplete task
- `backend/database/scripts/schema.sql` is a generated snapshot and must never be
  hand-edited; this feature ships no DDL and no migration
- Commit after each task or logical group
- Stop at either checkpoint to validate the story independently
