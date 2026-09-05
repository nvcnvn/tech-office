# Implementation Plan: Document Edit Conflict Protection

**Branch**: `049-doc-edit-conflict-protection` | **Date**: 2026-09-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/049-doc-edit-conflict-protection/spec.md`

## Summary

A document save carries the version number the editing session loaded. The backend
turns the existing `UpdateDocument` SQL statement into a compare-and-swap by adding
`AND version_count = @base_version` to its `WHERE` clause: zero rows updated means
somebody else saved first, and the whole transaction is refused with a distinct
`ABORTED` outcome carrying the current version number, the conflicting author's
name and when they saved. The web editor sends the base version it loaded, and on a
conflict shows a distinct banner that keeps the person's typed text in the editor
and offers "copy my changes" and "load the current version".

No new table and no migration: `docs.document.version_count` is already incremented
in the same statement that writes the content, and is already exposed to clients as
`Document.version_count`, so the token the client must echo back already travels
both ways. The whole guarantee is one SQL predicate, one proto field, one error
detail message and one banner.

Character-level merging (CRDT / OT) is explicitly out of scope, per the spec.

## Technical Context

**Language/Version**: Go 1.24 (backend), TypeScript 5.x / React 19 / Next.js (web),
Expo React Native (mobile, read-only for documents — untouched)

**Primary Dependencies**: ConnectRPC, pgx v5, sqlc, `google.golang.org/genproto` error
details, TanStack Query v5, MUI v7, TipTap

**Storage**: PostgreSQL — `docs.document`, `docs.document_version`. **No schema
change.** The optimistic-concurrency token is the existing
`docs.document.version_count` column.

**Testing**: `backend/integration/` (testWorld pattern, `make test-backend-one`),
`frontend/apps/web/e2e/` (Playwright, `make test-frontend-one`)

**Target Platform**: Linux server + browser. Mobile documents are read-only and do
not call `UpdateDocument`; the mobile app needs no change.

**Project Type**: Web application (Go backend + Next.js web + Expo mobile)

**Performance Goals**: The solo-save path (SC-005) adds **zero** round trips and zero
queries — the predicate rides on the `UPDATE` that already ran. A conflict costs one
extra `GetVersion` read, on the rare path only.

**Constraints**: The check and the write must be atomic across backend instances
(FR-007, Constitution XI) — no in-process lock is acceptable. The web editor must
never replace a person's unsaved text without their action (FR-010), which also
requires closing a pre-existing hole where a background refetch clobbers the editor.

**Scale/Scope**: One RPC surface (`DocumentService.UpdateDocument`), one SQL
statement, one new error-detail message, one editor component. Roughly 10 files.

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1 design. Result: PASS,
no violations, Complexity Tracking table empty.*

| Principle | Verdict | How this feature satisfies it |
|---|---|---|
| **I. Data Governance & Multi-Tenancy** | PASS | No DDL, no migration, no new table. The changed `UpdateDocument` query keeps `organization_id = @organization_id` as its leading predicate and adds only `AND version_count = @base_version`. No new join. `make lint-tenancy` unaffected. `schema.sql` is not touched (and must never be hand-edited). |
| **II. Scenario-First Integration & E2E Testing** | PASS | Behavioural contract written first as `t.Run` stubs in [contracts/test-scenarios.md](./contracts/test-scenarios.md), traced FR-by-FR. Backend scenarios land in `backend/integration/docs_conflict_test.go`; browser scenarios in `frontend/apps/web/e2e/document-conflict.spec.ts`. User Story 3 is **excluded from implementation scope with justification** — see "Scope exclusion" below. No unit or snapshot tests. |
| **III. Two-Layer Service Architecture & Proto-Level Authorization** | PASS | Business rule lives in `documentLogicImpl.UpdateDocument` (logic layer); the Connect layer only maps the typed error to a code plus detail. Authorization is unchanged: `docs.update` at the interceptor, `CheckAccess` inside the transaction, and the access check runs **before** the version check so a permission failure is still reported as a permission failure (spec edge case). |
| **IV. Cross-Domain Integration** | PASS | No cross-schema access added. `collaboration` reaches documents through `DocsLogic` as it already does. |
| **V. Observability, Simplicity & YAGNI** | PASS | No new column, no new table, no revision-token abstraction, no lock manager, no merge engine. The refusal is logged at INFO with document id, base and current version. |
| **VI. Versioning, Breaking Changes & Review** | PASS (breaking, by design) | `UpdateDocumentRequest.base_version` is required; a caller that omits it is refused. This is a breaking contract change, shipped atomically across backend, generated TS, the `apis` wrapper, the web editor and both test suites in one change set. Per the project's standing position, no optional-field compatibility shim is added — an optional base version would silently preserve last-write-wins, which is the bug. |
| **VII. Frontend API Wrapper Pattern & Type Safety** | PASS | `updateDocument` in `frontend/packages/apis/src/docs.ts` gains a required `baseVersion` and a documented conflict extraction path; no component calls a generated client directly. |
| **VIII. Cross-Stack Constant & Type Synchronization** | PASS | Nothing hand-mirrored: the shared contract is the generated `DocumentVersionConflict` message, produced by one `buf generate` for both Go and TS. |
| **IX. UUID v7 & Nullable Cursor Params** | N/A | No new identifiers, no new pagination. |
| **X. Structured Error Details** | PASS | A bare `ABORTED` cannot say which version to reload or who to talk to, which is exactly the "guides client behaviour" bar. A new `rpc.v1.DocumentVersionConflict` detail carries the three facts FR-005/FR-006 require, extracted type-safely by `extractDocumentVersionConflict` in `frontend/packages/apis/src/errorDetails.ts` alongside the existing extractors. Round-trip is covered by an integration scenario. |
| **XI. Distributed-First Architecture** | PASS | The compare-and-swap is a single `UPDATE ... WHERE version_count = $n`. Two racing writers serialize on the PostgreSQL row lock, so correctness does not depend on both requests reaching the same backend instance. No in-process mutex, no sticky routing. |
| **XII. Living Documentation** | PASS | `docs/domain/docs-knowledge.md` currently states "concurrent edits are resolved last-write-wins at the version level" — that sentence becomes false with this change and must be rewritten in the same change set, along with the drift register entry if one is opened. `backend/docs/SYSTEM-ARCHITECTURE.md` gains the concurrency-control note. |
| **XIII. Mobile Application Design & Testing** | PASS (no mobile change) | Mobile documents are read-only; nothing under `frontend/apps/mobile` calls `UpdateDocument` (verified by search). The mobile app is in scope only to the extent that it must still typecheck and run against the changed contract, which it does because it never constructs an `UpdateDocumentRequest`. No Maestro flow is added. |

### Scope exclusion (Constitution II requires this be recorded)

**User Story 3 — live "a newer version exists" notice — is not implemented.** It is
marked P3 in the spec, explicitly framed there as "not part of the minimum fix", and
is backed by **no functional requirement** (FR-001…FR-013 say nothing about it).
Implementing it would mean adding presence polling to the web docs surface, which
today does not poll at all: `DocumentView` uses static `staleTime` queries and never
calls `heartbeat` or `listActiveEditors`. That is new background infrastructure for a
nice-to-have, and P1 and P2 already remove the data loss on their own. It is left for
a later feature that can carry it on the existing `DocumentEditorService` presence
loop.

[ASSUMPTION: User Story 3 deferred. Justified above under Constitution II's
documented-exclusion clause rather than silently dropped.]

## Project Structure

### Documentation (this feature)

```text
specs/049-doc-edit-conflict-protection/
├── plan.md              # This file
├── research.md          # Phase 0 output — decisions and rejected alternatives
├── data-model.md        # Phase 1 output — entities, invariants, state transitions
├── quickstart.md        # Phase 1 output — how to run and validate the feature
├── contracts/
│   ├── document-update.md   # RPC contract: request field, error code, error detail
│   ├── docs_error_details.proto  # New error-detail message (proposed, verbatim)
│   └── test-scenarios.md    # Behavioural contract — t.Run / Playwright stubs
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
backend/
├── rpc/v1/
│   ├── document.proto                  # + UpdateDocumentRequest.base_version = 5
│   └── docs_error_details.proto        # NEW — DocumentVersionConflict
├── database/scripts/docs.query.sql     # UpdateDocument gains AND version_count = @base_version
├── database/docs.query.sql.go          # regenerated by sqlc
├── internal/docs/
│   ├── logic.go                        # ErrVersionConflict + VersionConflictError; base-version check
│   └── connect.go                      # handleError maps the conflict to ABORTED + detail
└── integration/
    ├── docs_conflict_test.go           # NEW — the backend behavioural contract
    └── helper_test.go                  # updateDocument helper carries a base version

frontend/
├── packages/rpc/rpc/v1/                # regenerated TS by the same buf generate
├── packages/apis/src/
│   ├── docs.ts                         # updateDocument takes a required baseVersion
│   └── errorDetails.ts                 # extractDocumentVersionConflict
└── apps/web/
    ├── src/app/workspace/docs/components/DocumentEditor.tsx  # base version, conflict banner, reload
    └── e2e/
        ├── document-conflict.spec.ts   # NEW — the browser behavioural contract
        └── helpers/api.ts              # updateDocument helper carries a base version

docs/domain/docs-knowledge.md           # last-write-wins sentence rewritten
backend/docs/SYSTEM-ARCHITECTURE.md     # concurrency-control note
```

**Structure Decision**: The existing web-application layout is used unchanged —
`backend/` (Go, schema-first, two-layer services) plus `frontend/` (a pnpm workspace
whose `packages/rpc` is generated from `backend/rpc/v1` by one `buf generate` run in
`backend/`, and whose `packages/apis` is the only place components call RPCs from).
The feature adds exactly one new backend proto file, one new backend integration test
file and one new E2E spec file; everything else is an edit to a file that already
owns the behaviour.

## Complexity Tracking

*No Constitution violations. Table intentionally empty.*
