# Implementation Plan: Procedure Document On A Ritual Definition

**Branch**: `043-attach-procedure-doc` | **Date**: 2026-09-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/043-attach-procedure-doc/spec.md`

## Summary

A ritual definition gains **one nullable column** — `procedure_document_id` — pointing at an
existing `docs.document` of type `workspace_doc` in the same organization. Everything else
follows from that column:

- **Reading the procedure** is served by a new `CollaborationService.GetRitualProcedure`
  RPC, never by `DocumentService`. Collaboration checks that the caller can see the
  definition's project, then reads the document through the existing `DocsLogic` interface,
  which does **not** apply per-document access grants. That is FR-018 ("the attachment is
  the grant") implemented as a *path*, not as a written grant row: nothing is inserted into
  `docs.document_access`, so the implicit read cannot leak into the docs tree, search,
  followed-document lists, comments, versions or reactions (FR-019, FR-021), and it
  disappears the instant the column is cleared (FR-020) because there is nothing to revoke.
- **The label** (FR-012) rides on `RitualDefinition.procedure`, a small resolved struct
  (`document_id`, `title`, `status`, `is_available`). Every ritual instance detail surface on
  both clients already fetches the definition via `hydrateRitualTask`
  (`packages/apis/src/collaboration-ritual.ts`), so the entry point costs **zero new client
  requests** on Story 1's surfaces.
- **Rendering** happens in an overlay (MUI `Dialog` on web, full-screen modal on mobile) over
  the surface the reader came from. Not navigating is what satisfies FR-013 and FR-014
  literally rather than by careful state preservation: captured evidence and a typed
  rejection reason cannot be discarded by a component that was never unmounted.
- **Writing** rides on the existing `CreateRitualDefinition` / `UpdateRitualDefinition` RPCs.
  Neither regenerates instances, bumps `schedule_version` or notifies anyone today, so FR-010
  and SC-006 hold by construction — no new "does this count as a schedule change" branch
  exists to get wrong.

The one non-additive change: `UpdateRitualDefinition` currently performs **no** project
owner/admin resource check (the logic signature takes `defID` where `CreateRitualDefinition`
takes `employeeID`, and the parameter is unused). Story 2 AC5 and FR-006 require the refusal,
so the check is added there. It is a pre-existing authorization gap this feature closes
rather than works around.

## Technical Context

**Language/Version**: Go 1.24 (backend), TypeScript 5.x / React 19 / Next.js 15 (web),
TypeScript / React Native / Expo Router (mobile)

**Primary Dependencies**: Connect RPC + protobuf (`buf`), `sqlc`, `pgx`, PostgreSQL 17,
MUI v7 + TipTap (web), Expo + TanStack Query (mobile)

**Storage**: PostgreSQL — one new nullable column on `collaboration.ritual_definition`, one
composite foreign key into `docs.document`. No new table, no new index.

**Testing**: `backend/integration/` (Go, `testWorld` pattern), `frontend/apps/web/e2e/`
(Playwright), `frontend/apps/mobile/.maestro/` (Maestro)

**Target Platform**: Linux server (Docker Swarm), modern browsers, iOS + Android

**Project Type**: Multi-tenant web service with web and mobile clients

**Performance Goals**: `GetRitualDefinition` gains at most one point read of
`docs.document` by primary key. `GetRitualProcedure` is two point reads (definition,
document) plus one project-access check. `ListEvidenceReviewQueue` gains **no** query — the
procedure document id comes from the `ritual_definition` join the queue already performs.

**Constraints**: Cross-schema SQL joins are forbidden (Constitution IV), so the document is
read through `DocsLogic`, never joined. The dependency direction is collaboration → docs and
must stay that way: docs must not learn what a ritual is.

**Scale/Scope**: One column, one RPC, one proto field on three messages, one new
`DocsLogic` method, one new `Document` proto field, two client overlay components, four
client surfaces touched.

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 design — see the re-check at the end.*

| Principle | Verdict | How |
|---|---|---|
| **I. Data governance & multi-tenancy** | PASS | New column on an existing tenant table. FK is composite and organization-leading: `FOREIGN KEY (organization_id, procedure_document_id) REFERENCES docs.document(organization_id, id)`, matching the existing `fk_task_description`. No new unique index. Every query pins `organization_id`. `schema.sql` regenerated with `regen-schema.sh`, never hand-edited. `make lint-tenancy` must be green. |
| **II. Scenario-first testing** | PASS | Scenario stubs for every user story and every user-observable FR are enumerated below and in [quickstart.md](./quickstart.md); they are the behavioural contract and are written before implementation. Backend in `backend/integration/collaboration_ritual_procedure_test.go`, web E2E in `frontend/apps/web/e2e/ritual-procedure-doc.spec.ts`, mobile in `frontend/apps/mobile/.maestro/ritual-procedure-doc.yaml`. |
| **III. Two-layer service & proto-level authz** | PASS | `GetRitualProcedure` declares `required_permissions: ["collab.viewTask"]` on the RPC; the connect layer extracts auth context and opens the transaction; the logic layer performs the *resource* check (`CheckProjectAccess` with no required roles, so a viewer and a public-project reader both pass — the same bar as seeing the instance). Attach/replace/remove keep `collab.manageRitualDefinition` on the RPC and gain the project owner/admin resource check in the logic layer. |
| **IV. Cross-domain integration** | PASS | Collaboration calls `DocsLogic.GetDocument`, an interface it declares and `internal/docs` implements. No cross-schema SQL join is introduced. The cross-schema **foreign key** follows the existing `collaboration.task.description_document_id` precedent. Docs gains no knowledge of rituals. |
| **V. Observability, simplicity, YAGNI** | PASS | No new table, no snapshot, no cache, no notification type, no background job. The "unavailable" state is derived from a failed point read, not stored. |
| **VI. Versioning & breaking changes** | PASS | Proto changes are additive. The `Logic.UpdateRitualDefinition` signature change is internal to the backend. Per the project's stance, breaking changes ship atomically across backend/web/mobile in this change set. |
| **VII. Frontend API wrapper & type safety** | PASS | All new calls go through `packages/apis/src/collaboration-ritual.ts`; no client constructs a Connect client directly. |
| **VIII. Cross-stack constant sync** | PASS | Status is carried by the **existing** `rpc.v1.DocumentStatus` enum (`collaboration.proto` already imports `chat.proto` and `files.proto`, so importing `document.proto` follows precedent). Availability is a `bool`. No new cross-stack string. |
| **IX. UUID v7 & nullable cursor params** | PASS | The referenced id is an existing uuidv7 document id. No pagination added. |
| **X. Structured error details** | PASS | Wrong document type or wrong organization → `InvalidArgument` + `google.rpc.BadRequest` field violation on `procedure_document_id`. Non-manager attach → bare `PermissionDenied` (naming the project would disclose it). Reading a procedure on a project the caller cannot see → bare `PermissionDenied`. |
| **XI. Distributed-first** | PASS | Stateless reads. No in-memory state, no affinity, no lock. |
| **XII. Living documentation** | PASS | `docs/domain/rituals-tasks.md` and `docs/domain/docs-knowledge.md` are updated in this change set; `backend/docs/SYSTEM-ARCHITECTURE.md` gains the `DocsLogic.GetDocument` edge on the existing collaboration → docs arrow. Part of the Definition of Done, not a follow-up. |
| **XIII. Mobile design & testing** | PASS | Configuring the attachment is web-only (FR-011); mobile reads only. One Maestro flow covers the mobile read path on the instance and inside evidence capture. Verified on Android as well as iOS. |

No violations. **Complexity Tracking is intentionally empty.**

## Project Structure

### Documentation (this feature)

```text
specs/043-attach-procedure-doc/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── ritual-procedure.proto   # Phase 1 output — the delta, not the whole file
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
backend/
├── database/
│   ├── migrations/20260904000002_ritual_procedure_document.up.sql   # NEW
│   └── scripts/
│       ├── schema.sql                    # REGENERATED (never hand-edited)
│       └── collaboration.query.sql       # MODIFIED — definition select/insert/update
├── rpc/v1/
│   ├── collaboration.proto               # MODIFIED — RitualProcedure, GetRitualProcedure,
│   │                                     #   procedure fields, import document.proto
│   └── document.proto                    # MODIFIED — Document.document_type
└── internal/
    ├── collaboration/
    │   ├── logic.go                      # MODIFIED — DocsLogic gains GetDocument;
    │   │                                 #   Logic gains GetRitualProcedure; Update signature
    │   ├── ritual_logic.go               # MODIFIED — attach validation, owner/admin check,
    │   │                                 #   procedure resolution, GetRitualProcedure
    │   ├── ritual_connect.go             # MODIFIED — GetRitualProcedure handler
    │   └── evidence_review_queue_logic.go # MODIFIED — carry procedure_document_id
    └── docs/logic.go                     # MODIFIED — document_type on the proto mapping

frontend/
├── packages/apis/src/
│   ├── collaboration-ritual.ts           # MODIFIED — procedure on RitualDefinition,
│   │                                     #   getRitualProcedure(), attach/detach params
│   └── docs.ts                           # unchanged — the chooser reuses searchDocuments
└── apps/
    ├── web/src/app/workspace/
    │   ├── projects/[id]/rituals/[definitionId]/page.tsx        # MODIFIED — chooser + warning
    │   ├── projects/[id]/tasks/[taskId]/page.tsx                # MODIFIED — entry point
    │   ├── projects/[id]/tasks/[taskId]/components/
    │   │   └── EvidenceSubmitForm.tsx                           # MODIFIED — entry point
    │   ├── components/TaskDetailSidePanel.tsx                   # MODIFIED — entry point
    │   ├── reviews/components/ReviewQueueEvidence.tsx           # MODIFIED — entry point
    │   └── components/ProcedureDialog.tsx                       # NEW — read-only overlay
    ├── web/e2e/ritual-procedure-doc.spec.ts                     # NEW
    └── mobile/
        ├── src/components/docs/document-content.tsx             # NEW — extracted renderer
        ├── src/components/rituals/procedure-sheet.tsx           # NEW — read-only overlay
        ├── src/app/(app)/(more)/docs/[slug].tsx                 # MODIFIED — use the extract
        ├── src/app/(app)/(tasks)/[projectId]/task/[taskId].tsx  # MODIFIED — entry point
        ├── src/app/(app)/(tasks)/review/index.tsx               # MODIFIED — entry point
        └── .maestro/ritual-procedure-doc.yaml                   # NEW

docs/domain/
├── rituals-tasks.md      # MODIFIED — attachment, access path, degradation
└── docs-knowledge.md     # MODIFIED — the ritual read path into documents
```

**Structure Decision**: the existing three-part layout — `backend/` (Go Connect services,
schema-first), `frontend/apps/web` (Next.js), `frontend/apps/mobile` (Expo), with shared
clients in `frontend/packages/apis`. No new top-level directory. The feature adds one file to
each client for the read-only overlay and otherwise edits surfaces that already exist.

## The behavioural contract (Constitution II)

These scenario names are the contract. They are written as `t.Run` stubs before any
implementation. FR references are traceability comments in the test file.

### `backend/integration/collaboration_ritual_procedure_test.go`

**Attaching, replacing, removing** (US2 — FR-001…FR-010)

1. `manager attaches a workspace document and the definition reports it as its procedure`
2. `attaching a second document replaces the first rather than accumulating`
3. `removing the attachment leaves the document intact in the workspace`
4. `attaching a document from another organization is refused with a field violation`
5. `attaching a task_description document is refused with a field violation`
6. `attaching a project_brief document is refused with a field violation`
7. `a project member who is not owner or admin cannot attach, replace or remove`
8. `attaching a procedure creates, deletes and detaches no instances and bumps no schedule version`
9. `attaching a procedure notifies nobody`
10. `one document can be the procedure of several definitions across several projects`
11. `an update that omits procedure_document_id leaves the existing attachment alone`

**Reading the procedure** (US1 — FR-012, FR-015, FR-016, FR-018…FR-021)

12. `an assigned worker with no document access grant can read the attached procedure`
13. `a project viewer who can see the instance can read the attached procedure`
14. `an employee outside the definition's project cannot read the procedure`
15. `the definition reports the document's current title after the document is renamed`
16. `editing the procedure document changes what an open instance resolves, with no snapshot`
17. `the implicit read does not put the document in the reader's document tree`
18. `the implicit read does not put the document in the reader's search results`
19. `the implicit read does not let the reader comment on, react to or update the document`
20. `the implicit read does not extend to the attached document's child pages`
21. `removing the attachment immediately ends the implicit read`
22. `deleting the definition immediately ends the implicit read`
23. `a definition with no procedure reports none and GetRitualProcedure returns none`

**Degradation** (FR-022…FR-024)

24. `a deleted procedure document reports unavailable rather than disappearing`
25. `evidence can still be submitted, approved and rejected when the procedure is unavailable`
26. `an instance whose procedure is unavailable still reaches verified`
27. `an archived procedure document is still readable and reports its archived status`
28. `an instance detached from its ritual reports no procedure`
29. `an archived definition keeps its attachment and reports it again on unarchive`

**Review queue** (US3 — FR-014)

30. `a queue entry for a ritual with a procedure carries the procedure document id`
31. `a queue entry for a ritual without a procedure carries none`
32. `a reviewer can read the procedure for a submission they may decide`

### `frontend/apps/web/e2e/ritual-procedure-doc.spec.ts`

1. `manager attaches a procedure from the ritual definition editor and is warned about the access it grants first`
2. `the chooser lists only documents the manager can already read`
3. `a worker opens a ritual instance and the procedure entry point carries the document title`
4. `opening the procedure from the evidence capture form keeps the already-attached file and typed note`
5. `a reviewer opens the procedure from the review queue and returns to the same entry with the rejection reason still typed`
6. `an instance whose ritual has no procedure shows no entry point and no placeholder`
7. `a deleted procedure document shows an unavailable state and evidence submission still works`

### `frontend/apps/mobile/.maestro/ritual-procedure-doc.yaml`

1. Open a ritual instance → the procedure entry point is visible and labelled with the title
2. Tap it → the procedure renders read-only → close → the instance is where it was
3. Start evidence capture, attach a photo, open the procedure, close → the photo is still attached
4. An instance with no procedure shows no entry point

**Nothing is excluded from testing scope.** FR-011's "web only" half is verified by the
absence of any attachment control in the mobile flow; the read half is covered above.

## Constitution Re-Check (post-Phase 1 design)

Re-run against the artifacts now that the contract, data model and quickstart exist. The
design produced no new gates and no violations.

- **I** — the design settled on one nullable column and one composite, organization-leading
  foreign key with **no index and no unique key**. The one rule that cannot be retrofitted
  (uniqueness leading with `organization_id`) is not engaged at all, because FR-004 requires
  the reference to be non-unique. Verified in [data-model.md](./data-model.md).
- **II** — 32 backend scenarios, 7 web scenarios and 4 mobile steps are enumerated above and
  keyed to FR numbers. Nothing is excluded from testing scope.
- **III / IV** — Phase 1 confirmed the read is served by `CollaborationService`, not
  `DocumentService`, so the collaboration → docs direction is preserved and no cross-schema
  join appears. The two-layer split is explicit in the contract's RPC comment: permission on
  the RPC option, resource check in the logic layer.
- **VIII** — the design reuses the existing `DocumentStatus` enum and adds one new enum,
  `DocumentType`, which mirrors an existing database CHECK constraint rather than inventing a
  vocabulary. No cross-stack bare string is introduced.
- **X** — the failure modes settled during design are exactly two shapes: a `BadRequest`
  field violation on `procedure_document_id` for an unattachable document, and a bare
  `PermissionDenied` (no detail) for both the non-manager write and the out-of-project read.
- **XII** — the documentation obligation is written into the quickstart's Definition of Done,
  including the drift-register entry recording that this feature does **not** use canonical
  resource links despite the spec expecting it to.

One design decision is worth flagging to a reviewer even though it passes: adding the
owner/admin resource check to `UpdateRitualDefinition` makes an existing RPC **stricter**, so
an org-wide `collab.manageRitualDefinition` holder who is only a project `member` loses the
ability to edit a definition. That is the rule `docs/domain/rituals-tasks.md` already
documents and `CreateRitualDefinition` already enforces; the code was the outlier. It ships in
this change set rather than as a follow-up because guarding one field of a request while
leaving the rest open is not a security boundary.

## Complexity Tracking

*No Constitution Check violations. This section is intentionally empty.*
