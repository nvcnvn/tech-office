---
description: "Task list for feature 043 — Procedure Document On A Ritual Definition"
---

# Tasks: Procedure Document On A Ritual Definition

**Input**: Design documents from `/specs/043-attach-procedure-doc/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/ritual-procedure.proto](./contracts/ritual-procedure.proto),
[quickstart.md](./quickstart.md)

**Tests**: Included and mandatory. Constitution principle II (scenario-first testing) makes the
scenario list in [plan.md](./plan.md#the-behavioural-contract-constitution-ii) the behavioural
contract; the stubs are written and failing before the implementation that satisfies them.

**Organization**: Grouped by user story so each story is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 (read the procedure), US2 (attach/replace/remove), US3 (decide evidence against it)
- Every task names exact file paths.

## Path Conventions

Three-part repository layout, unchanged by this feature:

- **Backend**: `backend/` — Go 1.24, Connect RPC, sqlc, PostgreSQL 17
- **Web**: `frontend/apps/web/` — Next.js 15, React 19, MUI v7, TipTap
- **Mobile**: `frontend/apps/mobile/` — Expo Router, React Native, TanStack Query
- **Shared clients**: `frontend/packages/apis/src/`

> [ASSUMPTION: The plan lists `TaskDetailSidePanel.tsx` under
> `frontend/apps/web/src/app/workspace/components/`. It actually lives at
> `frontend/apps/web/src/app/workspace/projects/[id]/components/TaskDetailSidePanel.tsx`; the
> real path is used throughout this task list.]

> [ASSUMPTION: The plan does not mention the canonical-resource-link instance surfaces
> (`frontend/apps/mobile/src/app/(shared)/resource/tasks/[projectId]/task/[taskId].tsx`). FR-012
> says *every* surface that shows a ritual instance must show the entry point, so it is included
> as a task rather than left as a gap.]

> [ASSUMPTION: Review-queue client changes go in `frontend/packages/apis/src/collaboration-review-queue.ts`,
> which is the existing wrapper for that surface, rather than in `collaboration-ritual.ts` as the
> plan's file listing implies.]

> [ASSUMPTION: T043 places the "Procedure" control in
> `frontend/apps/web/src/app/workspace/reviews/components/ReviewQueueRow.tsx` rather than in
> `ReviewQueueEvidence.tsx` as the task names. `ReviewQueueEvidence` renders only the evidence
> body and early-returns on every branch (text, link, GPS, loading, unavailable, photo, file),
> so a control added there would appear in some evidence types and not others. The row is also
> where `entry.ritualDefinitionId` and the decision actions already live. Intent is unchanged —
> the overlay still portals over a row that is never unmounted.]

> [ASSUMPTION: T036 needs no separate edit.
> `frontend/apps/mobile/src/app/(shared)/resource/tasks/[projectId]/task/[taskId].tsx` is a
> one-line re-export of the instance screen changed in T035, so the canonical-resource-link
> surface carries the entry point automatically. Verified by reading the file.]

> [ASSUMPTION: T034's entry point is rendered inside `EvidenceSubmitForm.tsx` but the dialog
> itself is owned by the instance page and threaded down through `EvidenceChecklist` as an
> `onOpenProcedure` callback. Mounting the dialog inside the form would put the overlay's own
> lifetime inside the component whose state it exists to protect; hoisting it is what makes
> "never unmounted" structurally true rather than incidental.]

> [ASSUMPTION: T033's `TaskDetailSidePanel.tsx` did not previously load the ritual definition
> at all, so the task also adds a `getRitualDefinition` fetch, guarded on
> `taskKind === 'ritual_instance'`. A plain task issues no extra request.]

> [ASSUMPTION: T038's third Maestro step asserts a typed evidence *note* survives rather than
> an attached photo. Mobile photo evidence uploads and submits in one action — there is no
> attached-but-unsubmitted photo state to lose — so the text composer draft is the in-progress
> capture state that actually exists there. A `testID` was added to that composer input to make
> it assertable.]

> [ASSUMPTION: FR-007 was not enforced anywhere as built. `DocsLogic.GetDocument` takes no
> employee id and applies no `docs.document_access` check — correctly, because the read path
> depends on that — so the attachment validation in T013 accepted any document in the
> organization. `DocsLogic` now also exposes `CheckAccess`, which `validateProcedureDocument`
> calls on the **write** path only, and a thirty-third backend scenario was added:
> `attaching a document the manager cannot read themselves is refused with a field violation`.
> The fixture now grants the project admin read access on the procedure documents, because a
> manager who has not been given the procedure could not have attached it; the worker is still
> deliberately left with no grant at all.]

> [ASSUMPTION: `SearchDocuments` matched `content_text` only, so the title-driven procedure
> chooser found nothing. The query now matches `d.title` as well, with a PGroonga index on
> `docs.document.title` added in the same migration. This is a change to an existing docs
> query rather than to feature 043's own surface, made because a document search that cannot
> find a document by its name is not usable by the chooser T020 specifies.]

> [ASSUMPTION: T022's second scenario was renamed from `the chooser lists only documents the
> manager can already read` to `a document the manager cannot read themselves cannot become
> the procedure`. Search and the docs tree are organization-scoped rather than access-scoped
> (recorded as drift D49), so the chooser can offer a document the manager cannot open; what
> FR-007 actually guarantees is that attaching it is refused. The original name would have
> described behaviour the system does not have, and the absence assertion behind it passed
> vacuously whenever the search returned nothing.]

> [ASSUMPTION: T043's "Procedure" control is repeated inside
> `workspace/reviews/components/RejectReasonDialog.tsx` as well as on the queue row. The
> reject dialog is modal, so the row's control is behind it exactly when the reviewer is
> writing a rejection reason and most needs the written standard. The dialog is never
> unmounted, so the typed reason survives — which is what FR-014 asks for.]

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Bring the schema and generated code to the shape the rest of the work assumes.

- [X] T001 Create the forward migration `backend/database/migrations/20260904000002_ritual_procedure_document.up.sql` adding `procedure_document_id uuid NULL` to `collaboration.ritual_definition` and the composite constraint `fk_ritual_definition_procedure FOREIGN KEY (organization_id, procedure_document_id) REFERENCES docs.document(organization_id, id) ON DELETE RESTRICT`, written idempotently (`ADD COLUMN IF NOT EXISTS`, constraint guarded) per [data-model.md](./data-model.md)
- [X] T002 Apply the migration with `backend/scripts/migrate.sh` and regenerate the snapshot with `backend/scripts/regen-schema.sh`, so `backend/database/scripts/schema.sql` is updated by generation and never by hand
- [X] T003 Run `make lint-tenancy` and confirm the new foreign key is organization-leading and composite in `backend/database/scripts/schema.sql`; no index and no unique key is added

**Checkpoint**: The column exists, the snapshot is regenerated, tenancy lint is green.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The contract, the generated types and the docs read path that both writing (US2) and
reading (US1, US3) depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 [P] Add `DocumentType` enum (`UNSPECIFIED`, `WORKSPACE_DOC`, `TASK_DESCRIPTION`, `PROJECT_BRIEF`) and `DocumentType document_type = 16` on `Document` in `backend/rpc/v1/document.proto`, mirroring the existing CHECK constraint on `docs.document.document_type`
- [X] T005 Add to `backend/rpc/v1/collaboration.proto`: the `import "rpc/v1/document.proto"`, the `RitualProcedure` message (fields 1-5), `optional RitualProcedure procedure = 15` on `RitualDefinition`, `optional string procedure_document_id = 10` on `CreateRitualDefinitionRequest`, `optional string procedure_document_id = 9` on `UpdateRitualDefinitionRequest`, `string procedure_document_id = 26` on `ReviewQueueEntry`, and the `GetRitualProcedure` RPC with `required_permissions: ["collab.viewTask"]` — exactly as specified in [contracts/ritual-procedure.proto](./contracts/ritual-procedure.proto)
- [X] T006 Run `cd backend && buf generate` and confirm `RitualProcedure`, `GetRitualProcedureRequest/Response`, `Document.document_type` and `DocumentType` appear in `backend/rpc/v1/*.pb.go` and in the generated TypeScript the `apis` package consumes; edit no generated file by hand
- [X] T007 [P] Populate `document_type` in the `documentToProto` mapping in `backend/internal/docs/logic.go` so the type reaches the wire (D8)
- [X] T008 Extend the `DocsLogic` interface in `backend/internal/collaboration/logic.go` with `GetDocument(ctx, tx, orgID, employeeID dbuuid.UUID, documentID dbuuid.UUID) (*rpcv1.Document, error)` and add `GetRitualProcedure` to the `Logic` interface; verify `internal/docs` already satisfies the new method or adapt the wiring in the service constructor
- [X] T009 Update `collaboration.query.sql` in `backend/database/scripts/` — `CreateRitualDefinition`, `GetRitualDefinition`, `UpdateRitualDefinition` and `ListRitualDefinitions` must write and read `procedure_document_id` (the update using `COALESCE`/`sqlc.narg` so an absent field leaves the column alone, per D11) — then run `cd backend && sqlc generate`
- [X] T010 Add the shared procedure resolver in `backend/internal/collaboration/ritual_logic.go`: given a nullable `procedure_document_id`, return `nil` when the column is null, a fully populated `RitualProcedure` when `DocsLogic.GetDocument` succeeds, and `{document_id, is_available: false}` with empty title and unspecified status when it fails. It must never return an error to its caller — a docs failure degrades one entry point, it does not fail `GetRitualDefinition` (D7, FR-022)

**Checkpoint**: Contract generated, column readable and writable, resolver available. User stories can start.

---

## Phase 3: User Story 2 - Attach, Replace And Remove The Procedure (Priority: P1) 🎯 MVP

**Goal**: A manager can attach one workspace document to a ritual definition as its procedure,
replace it, and detach it, with the document itself never modified and no instance churn.

**Independent Test**: As a project owner or admin, attach a document to a definition via
`CreateRitualDefinition`/`UpdateRitualDefinition`, confirm the definition reports it; attach a
second and confirm replacement; detach and confirm the document still exists in the workspace.

> US2 is sequenced first despite US1 sharing its P1 priority: US1 has nothing to display until an
> attachment can be written, and US2 is the story that carries the authorization change.

### Tests for User Story 2 ⚠️

> Write these first as failing `t.Run` stubs. Scenario names are copied verbatim from
> [plan.md](./plan.md#the-behavioural-contract-constitution-ii) — they are the contract, not a paraphrase.

- [X] T011 [US2] Create `backend/integration/collaboration_ritual_procedure_test.go` with the `testWorld` fixture for this feature (an org, a project, an owner, an admin, a plain member, an assigned worker with no `docs.document_access` row, a private `workspace_doc`, a `task_description` document, a `project_brief` document, a second-organization document, and a ritual definition with instances)
- [X] T012 [US2] Add failing scenarios 1-11 (attach/replace/remove) to `backend/integration/collaboration_ritual_procedure_test.go`, with FR numbers as traceability comments: `manager attaches a workspace document and the definition reports it as its procedure`, `attaching a second document replaces the first rather than accumulating`, `removing the attachment leaves the document intact in the workspace`, `attaching a document from another organization is refused with a field violation`, `attaching a task_description document is refused with a field violation`, `attaching a project_brief document is refused with a field violation`, `a project member who is not owner or admin cannot attach, replace or remove`, `attaching a procedure creates, deletes and detaches no instances and bumps no schedule version`, `attaching a procedure notifies nobody`, `one document can be the procedure of several definitions across several projects`, `an update that omits procedure_document_id leaves the existing attachment alone`

### Implementation for User Story 2

- [X] T013 [US2] Add the attachment validation helper to `backend/internal/collaboration/ritual_logic.go`: resolve the candidate through `DocsLogic.GetDocument`, and refuse with `InvalidArgument` + a `google.rpc.BadRequest` field violation on `procedure_document_id` when it does not resolve (wrong organization, soft-deleted, or nonexistent — indistinguishable by design) or when `document_type != WORKSPACE_DOC`. Any `status`, `archived` included, is accepted (D8, FR-003, FR-024)
- [X] T014 [US2] Wire the validation and the column write into `CreateRitualDefinition` in `backend/internal/collaboration/ritual_logic.go`
- [X] T015 [US2] Change the `UpdateRitualDefinition` logic signature from `(orgID, defID, req)` to `(orgID, employeeID, defID, req)` in `backend/internal/collaboration/logic.go` and `backend/internal/collaboration/ritual_logic.go`, and add the project owner/admin resource check via `GetProjectMemberRole`, matching what `CreateRitualDefinition` already enforces (D9, FR-006). Refusal is a bare `PermissionDenied` with no error detail
- [X] T016 [US2] Update the `UpdateRitualDefinition` handler in `backend/internal/collaboration/ritual_connect.go` to pass the authenticated employee id into the logic call, and update every other caller the compiler flags
- [X] T017 [US2] Implement the three-valued `procedure_document_id` handling in `UpdateRitualDefinition` in `backend/internal/collaboration/ritual_logic.go`: absent leaves the column alone, present-and-empty detaches without touching the document, present-and-non-empty attaches or replaces after validation (D11, FR-001, FR-009)
- [X] T018 [US2] Populate `RitualDefinition.procedure` from the resolver (T010) in `GetRitualDefinition` and `ListRitualDefinitions` in `backend/internal/collaboration/ritual_logic.go`
- [X] T019 [P] [US2] Add `procedure` to the `RitualDefinition` type and `procedureDocumentId` to the create/update parameters in `frontend/packages/apis/src/collaboration-ritual.ts`, including the empty-string-detaches convention, per Constitution VII (no client constructs a Connect client directly)
- [X] T020 [US2] Add the procedure chooser to `frontend/apps/web/src/app/workspace/projects/[id]/rituals/[definitionId]/page.tsx`: a picker backed by the existing `searchDocuments` in `frontend/packages/apis/src/docs.ts` so only documents the manager can already read are offered (FR-007), showing the current attachment, a replace action and a remove action. The free-text description field stays and stays shown (FR-005)
- [X] T021 [US2] Add the access warning to the chooser in `frontend/apps/web/src/app/workspace/projects/[id]/rituals/[definitionId]/page.tsx` — a confirmation step stating that everyone who can see an instance of this ritual will be able to read the chosen document, shown *before* the write, client-side with no server involvement and no persisted acknowledgement (D12, FR-008)
- [X] T022 [US2] Create `frontend/apps/web/e2e/ritual-procedure-doc.spec.ts` with scenarios 1-2 failing first, then passing: `manager attaches a procedure from the ritual definition editor and is warned about the access it grants first` (assert the warning appears before the write, not merely that it exists on the page) and `the chooser lists only documents the manager can already read`
- [X] T023 [US2] Run `make test-backend-one T=TestRitualProcedureDocument` and `make test-backend-one T='TestRitual|TestEvidence|TestDocs'`; any existing ritual test that breaks on the new owner/admin check was relying on a project `member` editing a definition, which is the behaviour being corrected — fix the test's fixture, not the check

**Checkpoint**: Attachment is writable, authorized, validated and visible on the definition. US1 has something to display.

---

## Phase 4: User Story 1 - Read The Procedure While Doing The Ritual (Priority: P1)

**Goal**: A worker opens a ritual instance on web or mobile and the written procedure is one action
away, from the instance and from inside evidence capture, with no captured evidence lost.

**Independent Test**: With a procedure attached (US2), open an instance as an assigned worker who
has no grant on the document, on web and on mobile: the entry point is present and labelled with the
document's current title, the procedure renders read-only, and returning leaves an in-progress
capture intact.

### Tests for User Story 1 ⚠️

- [X] T024 [US1] Add failing scenarios 12-23 (reading) to `backend/integration/collaboration_ritual_procedure_test.go`: `an assigned worker with no document access grant can read the attached procedure` (the worker must have *no* `docs.document_access` row and the document must be `private`, or the scenario proves nothing), `a project viewer who can see the instance can read the attached procedure`, `an employee outside the definition's project cannot read the procedure`, `the definition reports the document's current title after the document is renamed`, `editing the procedure document changes what an open instance resolves, with no snapshot`, `the implicit read does not put the document in the reader's document tree`, `the implicit read does not put the document in the reader's search results`, `the implicit read does not let the reader comment on, react to or update the document`, `the implicit read does not extend to the attached document's child pages`, `removing the attachment immediately ends the implicit read`, `deleting the definition immediately ends the implicit read`, `a definition with no procedure reports none and GetRitualProcedure returns none`
- [X] T025 [US1] Add failing scenarios 24-29 (degradation) to `backend/integration/collaboration_ritual_procedure_test.go`: `a deleted procedure document reports unavailable rather than disappearing`, `evidence can still be submitted, approved and rejected when the procedure is unavailable`, `an instance whose procedure is unavailable still reaches verified`, `an archived procedure document is still readable and reports its archived status`, `an instance detached from its ritual reports no procedure`, `an archived definition keeps its attachment and reports it again on unarchive`

### Implementation for User Story 1

- [X] T026 [US1] Implement `GetRitualProcedure` in `backend/internal/collaboration/ritual_logic.go`: load the definition, run `CheckProjectAccess` with no required roles (a `viewer` and a public-project reader both pass — the same bar as seeing the instance), refuse a caller outside the project with a bare `PermissionDenied` and no detail, then return the resolved `RitualProcedure` plus the document's current `content_json`. Content is empty when the procedure is absent or unavailable (FR-015, FR-016, FR-018)
- [X] T027 [US1] Add the `GetRitualProcedure` handler to `backend/internal/collaboration/ritual_connect.go`, following the two-layer split: the connect layer extracts auth context and opens the transaction, the logic layer performs the resource check (Constitution III)
- [X] T028 [P] [US1] Add `getRitualProcedure()` to `frontend/packages/apis/src/collaboration-ritual.ts`, returning the resolved procedure and content
- [X] T029 [P] [US1] Create `frontend/apps/web/src/app/workspace/components/ProcedureDialog.tsx` — a MUI `Dialog` rendering `content_json` with `useEditor({ editable: false })` and the same `StarterKit`/`Underline`/`Link` extensions the docs editor uses. It deliberately does **not** reuse `DocumentEditor.tsx` (save mutations, embeds, markdown mode, version history and a `getDocument` call are all either forbidden here or re-enter the docs access path). It renders the archived status when present, and an explicit unavailable state when `is_available` is false (D6, FR-019, FR-022, FR-024)
- [X] T030 [P] [US1] Extract the read-only TipTap-JSON renderer that currently lives inline in `frontend/apps/mobile/src/app/(app)/(more)/docs/[slug].tsx` into `frontend/apps/mobile/src/components/docs/document-content.tsx`, and change `[slug].tsx` to consume the extract — extraction, not duplication (D6)
- [X] T031 [US1] Create `frontend/apps/mobile/src/components/rituals/procedure-sheet.tsx` — a full-screen modal over the surface it was opened from (never a navigation), using the extracted renderer, with a close control, the archived status, and the explicit unavailable state. Verified on Android as well as iOS (Constitution XIII)
- [X] T032 [P] [US1] Add the procedure entry point to the web ritual instance detail page `frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/page.tsx`, labelled with `procedure.title`, opening `ProcedureDialog`. Absent procedure renders nothing at all — no empty entry point, no placeholder, no layout shift (FR-017)
- [X] T033 [P] [US1] Add the same entry point to `frontend/apps/web/src/app/workspace/projects/[id]/components/TaskDetailSidePanel.tsx`
- [X] T034 [US1] Add the entry point to the evidence capture flow in `frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/components/EvidenceSubmitForm.tsx`, as an overlay over the form so the component is never unmounted and there is no captured file or typed note to preserve (D5, FR-013)
- [X] T035 [P] [US1] Add the entry point and `procedure-sheet` to the mobile ritual instance screen and its evidence capture flow in `frontend/apps/mobile/src/app/(app)/(tasks)/[projectId]/task/[taskId].tsx`
- [X] T036 [P] [US1] Add the entry point to the canonical-resource-link instance surface `frontend/apps/mobile/src/app/(shared)/resource/tasks/[projectId]/task/[taskId].tsx`, so every surface showing a ritual instance carries it (FR-012)
- [X] T037 [US1] Add web E2E scenarios 3, 4, 6 and 7 to `frontend/apps/web/e2e/ritual-procedure-doc.spec.ts`: `a worker opens a ritual instance and the procedure entry point carries the document title`, `opening the procedure from the evidence capture form keeps the already-attached file and typed note`, `an instance whose ritual has no procedure shows no entry point and no placeholder`, `a deleted procedure document shows an unavailable state and evidence submission still works`
- [X] T038 [US1] Create `frontend/apps/mobile/.maestro/ritual-procedure-doc.yaml` covering the four steps: entry point visible and labelled with the title on the instance screen; tap renders read-only and closing returns the instance unchanged; a photo attached before opening the procedure is still attached after closing; an instance with no procedure shows no entry point
- [X] T039 [US1] Confirm by inspection that no attachment control exists anywhere in the mobile app, including `frontend/apps/mobile/src/app/(app)/(tasks)/rituals/[definitionId].tsx` — mobile reads the procedure and never configures it (FR-011)

**Checkpoint**: The feature's promise is delivered. A worker can read the procedure from the instance and from evidence capture on both clients.

---

## Phase 5: User Story 3 - Decide Evidence Against The Procedure (Priority: P2)

**Goal**: A reviewer can open the procedure from the evidence decision surface without losing a
typed rejection reason or their place in the queue.

**Independent Test**: Submit evidence against a ritual whose definition has a procedure, open the
review queue as a reviewer, open the procedure from the decision surface, close it, and confirm the
queue position and any typed rejection reason survived.

### Tests for User Story 3 ⚠️

- [X] T040 [US3] Add failing scenarios 30-32 (review queue) to `backend/integration/collaboration_ritual_procedure_test.go`: `a queue entry for a ritual with a procedure carries the procedure document id`, `a queue entry for a ritual without a procedure carries none`, `a reviewer can read the procedure for a submission they may decide`

### Implementation for User Story 3

- [X] T041 [US3] Carry `procedure_document_id` on `ReviewQueueEntry` in `backend/internal/collaboration/evidence_review_queue_logic.go`, sourced from the `ritual_definition` join the queue projection already performs for `ritual_name` — zero additional queries per page. It is the id only, deliberately not a resolved `RitualProcedure` (D4). Empty for an entry whose definition could not be resolved; such an entry stays listed and stays decidable
- [X] T042 [P] [US3] Surface `procedureDocumentId` on the queue entry type in `frontend/packages/apis/src/collaboration-review-queue.ts`
- [X] T043 [US3] Add the "Procedure" control to `frontend/apps/web/src/app/workspace/reviews/components/ReviewQueueEvidence.tsx`, opening `ProcedureDialog` as an overlay so the entry is never unmounted and a typed rejection reason in `RejectReasonDialog.tsx` and the queue position both survive (D5, FR-014). The control is labelled "Procedure" and fetches title and content from `getRitualProcedure` only when opened
- [X] T044 [P] [US3] Add the same control to the mobile review surface `frontend/apps/mobile/src/app/(app)/(tasks)/review/index.tsx` (and `src/components/review/review-queue-card.tsx` if that is where the decision controls live), opening `procedure-sheet` over the card so `reject-reason-sheet.tsx` state is untouched
- [X] T045 [US3] Add web E2E scenario 5 to `frontend/apps/web/e2e/ritual-procedure-doc.spec.ts`: `a reviewer opens the procedure from the review queue and returns to the same entry with the rejection reason still typed`

**Checkpoint**: All three user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T046 [P] Update `docs/domain/rituals-tasks.md` — the attachment, the read path, the access rule, the unavailable state, and the corrected `UpdateRitualDefinition` authorization. Delete any behaviour statement this feature made untrue (Constitution XII, Definition of Done)
- [X] T047 [P] Update `docs/domain/docs-knowledge.md` to record that documents are now readable through a ritual by a path that does not touch `docs.document_access`, and that the implicit read never reaches the tree, search, followers, comments, versions or reactions
- [X] T048 [P] Add `DocsLogic.GetDocument` to the existing collaboration → docs edge in `backend/docs/SYSTEM-ARCHITECTURE.md`
- [X] T049 [P] Record in the drift register in `docs/domain/README.md` that the procedure entry point does **not** use canonical resource links (feature 030) and why: canonical links resolve to a route, and no route can render this document for a reader without a docs grant (D5). The spec expected it to; recording the disagreement is how that stays honest
- [X] T050 Run the neighbouring suites and confirm no regression: `make test-frontend-one F=ritual-submission-flow`, `make test-frontend-one F=collaboration-evidence-review-queue`, `make test-mobile-one F=ritual-submission-flow`. A ritual with no procedure must render exactly as before — no empty entry point, no placeholder, no layout shift (FR-017, SC-007)
- [ ] T051 Run the mobile flow on **both** an Android emulator and an iOS simulator: `make test-mobile-one F=ritual-procedure-doc`. The habitual test device is an iPhone SE, so a narrow-Android regression or an iOS-only prop goes unnoticed if only one is checked (Constitution XIII)

  > **BLOCKED, not skipped.** Every Maestro flow in the repository fails in the shared
  > `auth/signin.yaml` bootstrap against the checked-in fixture credentials — the run stops at
  > `Assertion is false: "Chat" is visible` before reaching a single step of this flow. That is
  > drift D40, it predates feature 043, and it blocks the existing ritual flows identically. No
  > Android device or emulator is attached to this machine either, so the Android half could not
  > have run regardless. `frontend/apps/mobile/.maestro/ritual-procedure-doc.yaml` is written and
  > its four fixture variables are documented in its `env` block; running it needs a working
  > fixture account and a booted Android emulator.
- [X] T052 Run the full gates green: `make lint-tenancy`, `make test-backend`, `make test-frontend`; `make test-mobile` is blocked by drift D40 (see T051)
- [X] T053 (automated equivalents; see note) Walk through [quickstart.md](./quickstart.md) §6 by hand end to end — attach and time it against SC-002, read it on mobile as an ungranted worker (SC-001), correct the document and see it reach the open instance (SC-003), reassign to a fresh worker (SC-004), delete the document and still complete the instance (SC-005), attach the same document to a second project (FR-004)

  > Steps 1, 3, 4, 5 and 6 of the walkthrough have direct automated equivalents that all pass:
  > `manager attaches a procedure ... and is warned about the access it grants first` (step 1),
  > `editing the procedure document changes what an open instance resolves, with no snapshot`
  > (step 3), `an assigned worker with no document access grant can read the attached procedure`
  > (step 4), `a deleted procedure document shows an unavailable state and evidence submission
  > still works` (step 5) and `one document can be the procedure of several definitions across
  > several projects` (step 6). Two things are genuinely not covered: the mobile leg of step 2,
  > blocked with T051; and SC-002's "under a minute" timing claim, which is a human observation
  > no assertion makes.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately.
- **Foundational (Phase 2)**: depends on Setup. **Blocks every user story.**
- **US2 (Phase 3)**: depends on Phase 2. Sequenced before US1 because US1 has nothing to display
  until an attachment can be written, and because US2 carries the authorization change that the
  surrounding ritual tests react to.
- **US1 (Phase 4)**: depends on Phase 2. Its *tests* need US2's write path to set up a fixture, so
  in practice it follows US2; its implementation touches disjoint files and could be built in
  parallel by a second developer using a seeded column.
- **US3 (Phase 5)**: depends on Phase 2 and reuses US1's `ProcedureDialog` (T029) and
  `procedure-sheet` (T031). Otherwise independent of US1's surfaces.
- **Polish (Phase 6)**: depends on all three stories.

### Within Phase 2

T004 and T007 are parallel with each other. T005 depends on T004 (it imports the enum's file);
T006 depends on both; T008, T009 and T010 depend on T006. T009 also depends on T001-T002 (the
column must exist before sqlc reads it).

### Within Each User Story

Tests are written and failing before the implementation that satisfies them. Backend logic before
connect handlers, connect handlers before the `apis` wrapper, the wrapper before client surfaces.

### Parallel Opportunities

- **Phase 2**: T004 ∥ T007.
- **US2**: T019 (apis) is parallel with the backend tasks T013-T018 once T006 lands.
- **US1**: T029 (web dialog) ∥ T030 (mobile extract) ∥ T028 (apis). Then T032 ∥ T033 ∥ T035 ∥ T036
  — four different client surfaces, no shared file.
- **US3**: T042 ∥ T044.
- **Phase 6**: T046 ∥ T047 ∥ T048 ∥ T049 — four different documents.
- Once Phase 2 is complete, a second developer can take US3's backend (T041) while the first is in
  US1's client work.

---

## Parallel Example: User Story 1

```bash
# The three read-path building blocks, no shared file:
Task: "Add getRitualProcedure() to frontend/packages/apis/src/collaboration-ritual.ts"
Task: "Create frontend/apps/web/src/app/workspace/components/ProcedureDialog.tsx"
Task: "Extract the mobile TipTap renderer to frontend/apps/mobile/src/components/docs/document-content.tsx"

# Then the four instance surfaces, still no shared file:
Task: "Entry point on frontend/apps/web/src/app/workspace/projects/[id]/tasks/[taskId]/page.tsx"
Task: "Entry point on frontend/apps/web/src/app/workspace/projects/[id]/components/TaskDetailSidePanel.tsx"
Task: "Entry point on frontend/apps/mobile/src/app/(app)/(tasks)/[projectId]/task/[taskId].tsx"
Task: "Entry point on frontend/apps/mobile/src/app/(shared)/resource/tasks/[projectId]/task/[taskId].tsx"
```

---

## Implementation Strategy

### MVP First

1. Phase 1 (Setup) → Phase 2 (Foundational).
2. Phase 3 (US2) → **stop and validate**: a manager can attach, replace and remove, the document is
   never modified, and zero instances change.
3. Phase 4 (US1) → **stop and validate**: this is the point the feature's promise is actually kept —
   a worker reads the procedure next to the checklist item, on both clients.

US2 + US1 together are the shippable MVP. US2 alone writes a column nobody can see; US1 alone has
nothing to show. Neither is a useful release on its own, which is why both carry P1.

### Incremental Delivery

1. Setup + Foundational → contract and column in place.
2. + US2 → managers can configure. Demo on web.
3. + US1 → workers can read. **This is the release.**
4. + US3 → reviewers decide against the written standard. Additive, no change to US1 or US2 surfaces.
5. Polish → living documentation, drift register, full gates.

### Parallel Team Strategy

After Phase 2: developer A takes US2's backend and web editor, developer B takes US1's client
components (T029-T031) against a hand-seeded column, developer C takes US3's queue projection
(T041). They converge at T037/T045.

---

## Notes

- **The scenario names are the contract**, not a summary of it. Copy them verbatim from
  [plan.md](./plan.md#the-behavioural-contract-constitution-ii); `go test -v` output must read like
  the spec, matchable line by line to a user story or an FR by a non-technical reader.
- **Absent and unavailable are different states.** Column null → render nothing (FR-017). Column set
  but unresolvable → render an explicit unavailable state (FR-022). Collapsing them tells a worker
  there was never a procedure for a ritual that has one. Never test `content_json` for emptiness to
  tell them apart — use `is_available`.
- **The overlay is load-bearing.** FR-013 and FR-014 are satisfied because the surface underneath is
  never unmounted. Converting an entry point to a route later reintroduces exactly the state loss
  this design removes, which is why T037 and T045 assert survival rather than assume it.
- **`schema.sql` is generated.** Regenerate with `backend/scripts/regen-schema.sh`; a hand-edit is
  discarded on the next regeneration.
- **`make lint-tenancy` before anything else.** A foreign key that is not organization-leading is a
  schema change to undo, not a bug to patch.
- Commit after each task or logical group. Stop at any checkpoint to validate a story independently.
