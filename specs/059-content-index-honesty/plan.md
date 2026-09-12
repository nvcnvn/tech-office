# Implementation Plan: File content search that actually searches content

**Branch**: `059-content-index-honesty` | **Date**: 2026-09-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/059-content-index-honesty/spec.md`

## Summary

Write the one missing step body so uploaded text, PDF and office documents actually have
their contents extracted and stored, and delete the OCR method nothing ever implemented.

Everything around the hole is already built and already correct: the table, the
multilingual PGroonga index, the access-controlled search query, the status RPC, the job
registration, the retry policy, the enqueue on all three upload paths, and the Gotenberg
office→PDF conversion that runs as step 1 of the very same job. `ExtractContent` — step 2 —
logs "pending implementation" and returns, so no file in the system has ever had a
character indexed and the status endpoint answers `UNSPECIFIED` to every question.

The approach is therefore small and has no new infrastructure in it:

1. **Extract** — plain text by direct read; PDFs with `github.com/ledongthuc/pdf` (pure Go,
   MIT, zero transitive dependencies); office documents by running that same PDF reader
   over the PDF step 1 has already produced. One extractor, three families, one new
   dependency.
2. **Store** — upsert into `files.file_content_index` on the unique constraint that already
   exists, so a retry replaces rather than duplicates and a success clears a prior failure.
3. **Tell the truth** — the status RPC loads the file's metadata and distinguishes queued,
   extracting, completed, failed, not-a-type-we-read and never-indexed; the workflow stops
   reporting "failed" for a JPEG behaving exactly as designed; the `cmd/server.go`
   "skeleton" comment and the `image_ocr` value are deleted everywhere they appear.
4. **Make the tests able to fail** — today's content tests search for a phrase that is also
   in the filename, so they pass against the stub. They are rewritten to search content
   that shares no word with the filename, and the suite gains PDF, office, scanned-PDF and
   access-isolation cases.

The three assumptions that could have sunk this approach were each verified by experiment
against the repository's own Gotenberg container before this plan was written; see
[research.md](./research.md), "Verified by experiment".

## Technical Context

**Language/Version**: Go 1.27 (backend); TypeScript 5.x (web + mobile clients, generated)

**Primary Dependencies**: `connectrpc.com/connect`, `jackc/pgx/v5`, `nvcnvn/flows` (durable
background workflows), `aws-sdk-go-v2/service/s3` (R2), Gotenberg 8 (already deployed),
PGroonga (already deployed). **One addition**: `github.com/ledongthuc/pdf`
`v0.0.0-20260907135840-6c8c28e0e8a0` — pure Go, MIT, no transitive dependencies.

**Storage**: PostgreSQL. `files.file_content_index` (exists, empty in every environment),
`files.file_metadata`, `files.file_access_rule`, `files.file_pdf_conversion`. Objects in
Cloudflare R2.

**Testing**: `backend/integration/` with the `testWorld` pattern against a running server,
Postgres, ClamAV and Gotenberg (`make infra-up`, `make test-backend`). No unit or snapshot
tests, per Constitution principle II.

**Target Platform**: Linux server (Docker Swarm/Compose under `deploy/`), plus web and
mobile clients that consume the regenerated contract.

**Project Type**: Multi-tenant web service with web and mobile clients.

**Performance Goals**: SC-004 — 95% of documents under 10 MB searchable by content within
one minute of upload completing. The job is already asynchronous with a 2-retry
exponential-backoff policy; extraction is bounded at 30 s per file.

**Constraints**: 1 MiB of stored text per file (truncate, never fail); 64 MiB source-object
read cap; 30 s extraction timeout, matching the `--api-timeout=30s` already configured on
the Gotenberg container. Extraction must never block upload, upload confirmation, or
download availability, and must never remove a file from filename search.

**Scale/Scope**: ~15 files changed across backend, generated clients and one client wrapper;
one forward-only migration; no new table, column, service or container.

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 design — see "Post-design re-check".*

| Principle | Verdict | Note |
|---|---|---|
| **I. Data Governance & Multi-Tenancy** | PASS | Every read and write is keyed `(organization_id, …)`. The step resolves the file through `GetFileByID` scoped by org, and the upsert conflicts on `unique_file_index (organization_id, file_id)`. Extraction reads the stored object under the organization's own storage prefix. No cross-tenant path exists because the workflow input carries the org id and nothing derives one. |
| **II. Scenario-First Integration & E2E Testing** | PASS | The behavioural contract is the scenario list in [quickstart.md](./quickstart.md), derived from the four User Stories with FR references. One documented exclusion: `.pptx` fixtures — justified in research Decision 9. **No web E2E tests**: this feature changes no UI. The files page already renders search results and the status view already exists; nothing about their markup or interaction changes, so principle II's E2E requirement ("features with user-facing UI") is not triggered. |
| **III. Two-Layer Service Architecture & Proto-Level Authorization** | PASS | Extraction logic goes in `internal/files/index_logic.go` (pool-agnostic, takes `tx database.DBTX`); the RPC handler keeps only auth extraction, transaction management and enum mapping. `GetContentIndexStatus` keeps its existing `access_control` option — no new RPC and no new permission id. |
| **IV. Cross-Domain Integration** | PASS | Chat and collaboration reach files only through the shared `EnqueueFilePostProcessing` helper in the files package — this replaces three copies of the same inline block, so cross-domain coupling goes down. Federated search already calls the single `SearchFiles` (`internal/search/sources.go:243`); FR-015 needs no code. |
| **V. Observability, Simplicity & YAGNI** | PASS | `slog.*Context` throughout with `file_id`; skip logged at **debug**, which is the SC-007 fix. Simplicity is the whole shape of the plan: one dependency instead of a Tika sidecar, one extractor instead of four format parsers, no new table, and a net deletion of three duplicated enqueue blocks and two now-redundant sqlc queries. |
| **VI. Versioning & Breaking Changes** | PASS (breaking, deliberate) | Removing `EXTRACTION_METHOD_IMAGE_OCR` breaks the wire contract, and narrowing the CHECK constraint breaks the schema. Both ship in one change set across backend, web and mobile, with no shim — the project's early-development stance. No data migration: nothing has ever written the value. |
| **VII. Frontend API Wrapper Pattern** | PASS | `getContentIndexStatus` in `frontend/packages/apis/src/files-security.ts` stays the only caller; its `ContentIndexInfo` type widens to carry `method`, `textLength` and `updatedAt`, which the server now populates. |
| **VIII. Cross-Stack Constant Synchronization** | PASS | `image_ocr` is removed from all five surfaces in the same change: DB constraint, `internal/files/constants.go`, `rpc/v1/files.proto`, the regenerated `files.pb.go`/`files_pb.ts`, and every comment. SC-006 is verified by grepping the repository and finding nothing outside `specs/`. |
| **IX. UUID v7 & Nullable Cursor Params** | PASS | No pagination change. `file_content_index.id` already defaults to `uuidv7()`. |
| **X. Structured Error Details** | PASS | No new error surface. `GetContentIndexStatus` gains `NOT_FOUND` for an unknown file, using the standard connect code; `indexing_error` is a short human string on a success response, not an error detail. |
| **XI. Distributed-First & Horizontal Scalability** | PASS | Work runs in the existing `flows` worker, so any instance can pick it up; the upsert makes re-execution after a lost lease safe, which is exactly the property principle XI asks for. No in-process state, no singleton, no local disk — the 64 MiB source cap is what keeps an instance's memory bounded. |
| **XII. Living Documentation** | PASS | `docs/domain/files.md` and `backend/docs/SYSTEM-ARCHITECTURE.md` are updated in the same change set (FR-023); `docs/domain/workspace-navigation.md` is re-read to confirm its "snippet is populated only by documents" sentence stays true (FR-024) — file snippets are explicitly out of scope. |
| **XIII. Mobile Design & Testing** | N/A | No mobile UI change. Mobile consumes the regenerated contract and must compile; it renders no content-index status screen today. |

**Violations requiring justification**: none. The Complexity Tracking table below is empty.

### Post-design re-check

Re-evaluated after Phase 1. No verdict moved. Two things the design deliberately did *not*
do are worth recording, because each was the tempting alternative:

- **`SearchFilesByNameAndContent` is not modified.** It already matches extracted text and
  already binds visibility unconditionally to the caller's contexts. Editing it is the one
  way this feature could widen access (FR-013, SC-003), so the design achieves FR-012 by
  putting rows in the table the query already joins, and leaves the query alone.
- **No `skipped` state is added to the database.** Not-applicable and never-indexed are
  derived at the RPC from the file's own MIME type, so no row is written for every avatar
  and video in the system to record that we do not read them.

## Project Structure

### Documentation (this feature)

```text
specs/059-content-index-honesty/
├── plan.md                          # This file
├── research.md                      # Phase 0 — library choice, bounds, experiments
├── data-model.md                    # Phase 1 — entities, lifecycle, value sets
├── quickstart.md                    # Phase 1 — validation guide + scenario contract
├── contracts/
│   ├── files-content-index.proto    # Wire-contract delta (enums, ContentIndexInfo)
│   └── files-content-index.sql      # Migration + sqlc query delta
└── tasks.md                         # Phase 2 — created by /speckit-tasks, not here
```

### Source Code (repository root)

```text
backend/
├── rpc/v1/
│   └── files.proto                          # CHANGED  drop IMAGE_OCR; add NOT_APPLICABLE,
│                                            #          NEVER_INDEXED to IndexingStatus
├── database/
│   ├── migrations/
│   │   └── 20260912000001_drop_image_ocr_extraction_method.up.sql   # NEW
│   └── scripts/
│       ├── files_security.query.sql         # CHANGED  UpsertFileContentIndex replaces
│       │                                    #          Insert/Update/GetByID
│       └── schema.sql                       # REGENERATED — never hand-edited
├── internal/files/
│   ├── content_extract.go                   # NEW      the extractors: plain text, PDF,
│   │                                        #          office-via-PDF; cap; whitespace
│   ├── postprocessing_workflow.go           # CHANGED  the step body; PDFStorageKey on
│   │                                        #          ExtractContentInput; honest
│   │                                        #          completed/partial/failed roll-up
│   ├── index_logic.go                       # CHANGED  upsert; drop update-then-refetch;
│   │                                        #          UpdatedAt on ContentIndex
│   ├── constants.go                         # CHANGED  drop ExtractionMethodImageOCR; add
│   │                                        #          extraction bounds
│   ├── enqueue.go                           # NEW      EnqueueFilePostProcessing — the one
│   │                                        #          copy of three duplicated blocks
│   └── service.go                           # CHANGED  truthful GetContentIndexStatus
├── internal/chat/file_upload.go             # CHANGED  call the shared helper
├── internal/collaboration/file_upload.go    # CHANGED  call the shared helper
├── cmd/server.go                            # CHANGED  delete the "skeleton" comment
├── integration/
│   ├── files_content_index_test.go          # REWRITTEN  tests that can fail
│   ├── files_search_test.go                 # CHANGED    filename-vs-content in one list
│   └── helper_test.go                       # CHANGED    fixture builders, upload+settle
└── go.mod / go.sum                          # CHANGED  + github.com/ledongthuc/pdf

frontend/
├── packages/rpc/rpc/v1/files_pb.ts          # REGENERATED by buf
└── packages/apis/src/files-security.ts      # CHANGED  widen ContentIndexInfo

docs/domain/files.md                         # CHANGED  FR-023
backend/docs/SYSTEM-ARCHITECTURE.md          # CHANGED  principle XII
```

**Structure Decision**: the existing backend + frontend layout is kept exactly. This
feature adds two Go files to `internal/files/` and one migration; everything else is an
edit to a file that already exists. No new package, service, container or client app.

## Implementation notes that shape the tasks

These are the decisions a task list needs to be written against. Full reasoning lives in
[research.md](./research.md).

**The step body** (`ExtractContent`, `postprocessing_workflow.go`):

1. Load the file with `GetFileByID` scoped by org. Choose `detected_mime_type` if non-empty,
   else `mime_type` (FR-006).
2. Not indexable → delete any stale `pending` row, return `Skipped: true`, log at **debug**.
3. Indexable → upsert `in_progress`, then extract under a 30 s context:
   - text/\*, JSON, XML → read directly through an `io.LimitReader`, method `plain_text`
   - `application/pdf` → buffer (capped) and run the PDF reader, method `pdf_parser`
   - office → run the PDF reader over `input.PDFStorageKey`, method `office_parser`.
     Absent or failed conversion → `failed`, reason "office conversion unavailable" (FR-004)
4. Collapse whitespace, truncate to 1 MiB on a rune boundary, upsert the terminal state.
5. `defer recover()` around the PDF call; a panic becomes a recorded `failed`.

**Honest job outcome** (FR-019): track each step as ok / skipped / failed and roll up —
`completed` when no step failed (including all-skipped), `partial` when some failed and some
did not, `failed` only when every applicable step failed. The current
`if !pdfConverted && !contentIndexed { "failed" }` is what reports an image as a failure on
every upload; deleting it is SC-007.

**Two reasons, not one** (FR-018): `indexing_error` stores the short caller-safe string; the
full error with its hostnames and keys goes to `slog` only.

**Ordering**: the migration and `buf generate` land first, because the Go code will not
compile against the old generated enum.

## Test scenario contract

Constitution principle II requires the scenario stubs to be agreed before tasks are
created. They are listed in [quickstart.md](./quickstart.md) with their FR references and
are the behavioural contract for this feature.

[ASSUMPTION: This is an unattended run, so the scenario contract is recorded here and
treated as approved rather than waiting for a review reply. The scenarios are derived
mechanically from the four User Stories and the twenty-four FRs, and the single scope
exclusion (.pptx fixtures) is justified in research Decision 9 as principle II requires.
A reviewer who disagrees with a scenario should say so before /speckit-implement runs.]

## Complexity Tracking

No Constitution Check violation was found, so this table is empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
