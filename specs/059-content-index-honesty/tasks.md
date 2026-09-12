---
description: "Task list for 059 — File content search that actually searches content"
---

# Tasks: File content search that actually searches content

**Input**: Design documents from `/specs/059-content-index-honesty/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [quickstart.md](./quickstart.md),
[contracts/](./contracts/)

**Tests**: **Included and mandatory.** FR-021 and FR-022 require them explicitly, SC-008
makes "the tests fail when the extractor is removed" a condition of done, and Constitution
principle II requires integration scenarios for behavioural change. The scenario names in
[quickstart.md](./quickstart.md) are the contract; test tasks below reference them rather
than re-listing every leaf.

**Organization**: Tasks are grouped by user story. US1 and US2 are both P1 — US1 makes
content search real for plain text, US2 extends the same step body to PDF and office
formats. Either can ship without the other, but the spec argues shipping US1 alone would
still mislead a searcher about their PDFs, so the MVP is US1 + US2 together.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

Multi-tenant web service. Backend Go at `backend/`, generated clients at
`frontend/packages/rpc/`, client wrappers at `frontend/packages/apis/`, living docs at
`docs/domain/`. Paths below are repository-relative.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Bring in the single new dependency and confirm the infrastructure this
feature depends on is actually running.

- [X] T001 Add `github.com/ledongthuc/pdf v0.0.0-20260907135840-6c8c28e0e8a0` to `backend/go.mod` with `cd backend && go get github.com/ledongthuc/pdf@v0.0.0-20260907135840-6c8c28e0e8a0 && go mod tidy`, then confirm `backend/go.sum` gained no transitive dependency beyond the module itself (research Decision 1 — pure Go, MIT, zero transitive deps; if the diff shows transitive additions, stop and re-read the decision before continuing)
- [X] T002 Bring up the infrastructure this feature cannot be tested without — `make infra-up` then `cd backend && ./scripts/migrate.sh up` — and verify the Gotenberg container is healthy, because the office path in US2 goes through it and a skipped container turns every office scenario into a false failure

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The contract, the schema and the generated code must move before any Go code
can compile, because removing `EXTRACTION_METHOD_IMAGE_OCR` breaks the generated enum that
`internal/files/service.go` currently references. The shared enqueue helper also lands here
because US3 scenario 1 ("queued, never unspecified") depends on a `pending` row being
written at upload time, and all three upload paths must write it the same way.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete and
`go build ./...` is green.

- [X] T003 [P] Edit `backend/rpc/v1/files.proto`: delete `EXTRACTION_METHOD_IMAGE_OCR = 3;` from `ExtractionMethod` and replace it with `reserved 3;`, and add `INDEXING_STATUS_NOT_APPLICABLE = 5;` and `INDEXING_STATUS_NEVER_INDEXED = 6;` to `IndexingStatus`, exactly as written in `specs/059-content-index-honesty/contracts/files-content-index.proto` (FR-005, FR-016)
- [X] T004 [P] Create the forward-only migration `backend/database/migrations/20260912000001_drop_image_ocr_extraction_method.up.sql` dropping and recreating `file_content_index_extraction_method_check` without `image_ocr` and rewriting the column `COMMENT`, plus the matching `.down.sql`, using the SQL in `specs/059-content-index-honesty/contracts/files-content-index.sql` (FR-005, SC-006)
- [X] T005 [P] In `backend/database/scripts/files_security.query.sql`, replace `InsertFileContentIndex`, `UpdateContentIndexStatus` and `GetFileContentIndexByID` with the single `UpsertFileContentIndex :one` from the contract SQL — `ON CONFLICT (organization_id, file_id) DO UPDATE` passing `indexing_error` through `EXCLUDED` so a success clears a prior failure's reason (FR-009). Leave `SearchFilesByNameAndContent`, `GetFileContentIndex` and `DeleteFileContentIndex` untouched
- [X] T006 Run `cd backend && ./scripts/migrate.sh up && ./scripts/regen-schema.sh && sqlc generate` to apply T004 and regenerate `backend/database/scripts/schema.sql` and `backend/database/*.go` from T005 — `schema.sql` is a generated snapshot and must never be hand-edited (depends on T004, T005)
- [X] T007 Run `cd backend && buf generate` to regenerate `backend/rpc/v1/files.pb.go` and `frontend/packages/rpc/rpc/v1/files_pb.ts` together from T003, and confirm `EXTRACTION_METHOD_IMAGE_OCR` is gone from both and the two new `IndexingStatus` values are present (depends on T003)
- [X] T008 [P] In `backend/internal/files/constants.go`, delete `ExtractionMethodImageOCR` and add the extraction bounds as named constants — `MaxExtractedTextBytes = 1 << 20`, `MaxSourceReadBytes = 64 << 20`, `ExtractionTimeout = 30 * time.Second` — with a comment naming the reason for the 30 s value (it matches `--api-timeout=30s` on the Gotenberg container, research Decision 7). Update the "MUST align with" comment block so it no longer lists a method that does not exist (FR-005, Constitution principle VIII)
- [X] T009 In `backend/internal/files/service.go`, delete the `case ExtractionMethodImageOCR:` arm of the extraction-method switch in `GetContentIndexStatus` so the package compiles against the regenerated enum (depends on T007, T008)
- [X] T010 Rewrite `backend/internal/files/index_logic.go` around the upsert: add `UpdatedAt time.Time` to the `ContentIndex` struct (FR-017 — the field the status RPC reports as always absent today), replace `CreateContentIndex` and `UpdateIndexStatus` in the `IndexLogic` interface with one `UpsertContentIndex(ctx, tx, orgID, fileID dbuuid.UUID, extractedText, extractionMethod, status, errorMsg string, durationMs int32) (*ContentIndex, error)` calling `UpsertFileContentIndex`, delete the now-dead update-then-refetch path, and populate `UpdatedAt` in both `GetContentIndexStatus` and the upsert result (depends on T006, T008)
- [X] T011 Create `backend/internal/files/enqueue.go` with `EnqueueFilePostProcessing(ctx, flowsClient, pgxTx, workflow, queries, indexLogic, input *FilePostProcessingWorkflowInput) error` — the one copy of the twenty lines currently duplicated at three call sites. It writes the `pending` content-index row through `UpsertContentIndex` when `indexLogic.IsIndexable(input.MimeType)` is true, then calls `flows.BeginTx` in the caller's transaction, logging an enqueue failure at warn without failing the upload, exactly as the three copies do today (research Decision 5, FR-016; depends on T010)
- [X] T012 [P] Replace the inline enqueue block at `backend/internal/chat/file_upload.go:242` with a call to `files.EnqueueFilePostProcessing`, deleting the duplicated `pgx.Tx` assertion, `flows.BeginTx` call and log lines (depends on T011)
- [X] T013 [P] Replace the inline enqueue block at `backend/internal/collaboration/file_upload.go:294` with a call to `files.EnqueueFilePostProcessing`, deleting the duplicated block (depends on T011)
- [X] T014 [P] Replace the inline enqueue block in `TriggerPDFConversion` at `backend/internal/files/service.go:1254` with a call to `EnqueueFilePostProcessing`, deleting the duplicated block (depends on T011)
- [X] T015 Run `cd backend && go build ./... && go vet ./...` and confirm both are clean before any story phase starts (depends on T009–T014)

**[ASSUMPTION: the migration is numbered `20260912000002_...` rather than `...000001_...`
because `20260912000001_composite_fk_set_null_columns.up.sql` already exists, and no
`.down.sql` was written because this repository has zero down migrations — migrations are
forward-only by convention.]**

**[ASSUMPTION: `EnqueueFilePostProcessing` takes `database.DBTX` rather than `pgx.Tx` and
omits the planned `queries` parameter. `flows.DBTX` is a strict subset of `database.DBTX`,
so the `pgx.Tx` type assertion could be deleted at all three call sites instead of moved
into the helper; and `indexLogic` already owns the only query the helper makes, so a
`queries` parameter would be unused. The helper returns the enqueue error rather than
swallowing it: the two upload paths log it at warn and carry on as before, while
`TriggerPDFConversion` surfaces it, because an explicit trigger reporting success for work
that was never queued is the kind of untruth this feature exists to remove.]**

**[ASSUMPTION: `IsIndexable`'s type list became a single `indexableTypes` map from MIME
type to extraction method, with `IsIndexable` derived from it and a new
`ExtractionMethodFor` exposed on the interface. The enqueue helper and the extraction
step both need the type-to-method mapping, and two copies of that table would be two
places to forget.]**

**Checkpoint**: Contract, schema and generated clients agree; `image_ocr` exists nowhere
outside `specs/`; every upload path writes a `pending` row through one helper; the tree
compiles. Extraction still does nothing — that is the next phase.

---

## Phase 3: User Story 1 - Find a document by a phrase inside it (Priority: P1) 🎯 MVP

**Goal**: A plain-text file uploaded with a filename that shares no word with its body is
returned when a searcher types a phrase from that body — and is returned to nobody who
could not already reach the file by its name.

**Independent Test**: Upload a `.txt` whose filename and body share no word. Search the
body phrase as the uploader (found), as a member of another organization (nothing), as an
org member outside the channel (nothing), and as an employee in no channel and no
department (nothing).

### Tests for User Story 1 ⚠️

> Write these first and watch them fail. They must fail against today's stub — that is the
> entire point of FR-021. If a new test passes before the extractor exists, the marker
> phrase has leaked into the filename and the test is worthless.

- [X] T016 [P] [US1] Add the settle-and-assert helpers to `backend/integration/helper_test.go`: `waitForContentIndex(actor testUser, fileID string, timeout time.Duration) *rpcv1.ContentIndexInfo` polling `getContentIndexStatus` until the status is terminal (completed or failed) rather than sleeping a fixed five seconds, and `uploadChannelFileNamed(actor, channelID, filename, mimeType string, content []byte) string` making the filename explicitly independent of the body. Replace the existing `time.Sleep(5 * time.Second)` calls in `files_content_index_test.go` with the poller
- [X] T017 [US1] Rewrite the US1 half of `backend/integration/files_content_index_test.go` against the quickstart scenario names, with `// FR-XXX` comments: body-phrase search returns the file, filename search still returns it, another organization gets nothing, an org member outside the channel gets nothing, an employee in no channel and no department gets nothing, a non-Latin-script phrase returns the file, and a soft-deleted file stops being returned by a content term. Every marker phrase goes in the body only — the filename must be a slug that appears nowhere in the content (FR-001, FR-011, FR-012, FR-013, FR-014, FR-021, FR-022, SC-001, SC-003)
- [X] T018 [P] [US1] Add to `backend/integration/files_search_test.go` the one-ranked-list scenario: upload one file matching only on filename and one matching only on content, search a term common to both, assert both are returned in a single result list with no field indicator in the response (FR-012, quickstart "when one file matches on filename and another on content")
- [X] T019 [P] [US1] Add the edge-case scenarios to `backend/integration/files_content_index_test.go`: a text file exceeding the 1 MiB cap completes rather than fails and is findable on a phrase inside the kept portion with `text_length` equal to what was stored (FR-007); a file declared `text/plain` but binary in fact follows the server-detected type (FR-006); a file with no access-rule row stays unfindable by a content term (FR-013, SC-003)

### Implementation for User Story 1

- [X] T020 [P] [US1] Create `backend/internal/files/content_extract.go` with the extraction surface: `extractPlainText(r io.Reader) (string, error)` reading through an `io.LimitReader` bounded by `MaxSourceReadBytes`; `collapseWhitespace(s string) string` folding runs of whitespace to single spaces (research Decision 7 — a LibreOffice-rendered page pads every line to the page width, 5,022 bytes raw against 88 collapsed); `truncateToBytes(s string, max int) (string, bool)` cutting on a rune boundary and reporting whether it truncated; and `callerSafeReason(err error) string` mapping an internal error to the short, infrastructure-free string stored in `indexing_error` — never a hostname, credential, storage key or stack trace (FR-007, FR-018)
- [X] T021 [US1] Write the `ExtractContent` step body in `backend/internal/files/postprocessing_workflow.go`, replacing the `supportedTypes` map, the "TODO: Implement actual content extraction" block and the `Skipped: true, Reason: "Content extraction pending implementation"` return: load the file with `GetFileByID` scoped by org, choose `detected_mime_type` when non-empty else `mime_type` (FR-006), return early with `Skipped: true` and a **debug**-level log when `IsIndexable` is false — deleting any stale `pending` row via `DeleteFileContentIndex` first so the status derives to `NOT_APPLICABLE` (research Decision 5) — otherwise upsert `in_progress`, extract under `context.WithTimeout(ctx, ExtractionTimeout)`, collapse and truncate, and upsert the terminal `completed`/`failed` state with the method, duration and caller-safe reason. Plain-text branch only in this task; PDF and office land in US2 (FR-001, FR-008, FR-010)
- [X] T022 [US1] Delete the `// TODO: Add ContentExtractor when implemented` line from `FilePostProcessingServices` in `backend/internal/files/postprocessing_workflow.go` and add whatever the step body actually needs (`IndexLogic`, and `Queries`/`AdminPool` if not already reachable), wiring the new field at the construction site in `backend/cmd/server.go` (depends on T021)
- [X] T023 [US1] Run `make test-backend-one TEST=TestContentIndexing` and `make test-backend-one TEST=TestFileSearch`, confirm the US1 scenarios are green, and confirm they were red before T021 — if T017's scenarios passed before the step body existed, fix the test, not the code (FR-021)

**Checkpoint**: Plain text, Markdown, CSV, HTML, XML and JSON files are searchable by their
contents, with access unchanged. PDFs and office documents still are not.

---

## Phase 4: User Story 2 - Find a PDF, and a Word document, by what is written in it (Priority: P1)

**Goal**: The same step body reads PDFs directly and office documents through the PDF that
step 1 of the same workflow has already produced, so a phrase inside a `.pdf`, a `.docx` or
an `.xlsx` finds the file.

**Independent Test**: Upload a generated PDF, a generated `.docx` and a generated `.xlsx`,
each carrying a marker phrase absent from its filename. Search each phrase; each file comes
back. Confirm the `.docx` records the office method, not the PDF method.

### Tests for User Story 2 ⚠️

- [X] T024 [P] [US2] Create `backend/integration/file_fixtures_test.go` with the four in-process fixture builders from quickstart, so no binary file is committed (`scripts/check-tracked-files.sh` allows tracked `pdf` but not `docx`/`xlsx`) and each scenario injects its own marker phrase: `pdfWithText(phrase string) []byte` building catalog → pages → page → content stream with a `Tj` operator, `pdfWithoutText() []byte` using the same builder with a `re f` rectangle and no text operator, `docxWithText(phrase string) []byte` zipping `[Content_Types].xml`, `_rels/.rels` and `word/document.xml`, and `xlsxWithText(phrase string) []byte` zipping the five parts with an `inlineStr` cell (research Decision 9)
- [X] T025 [US2] Add the US2 scenarios to `backend/integration/files_content_index_test.go`: a phrase inside a PDF returns it and its recorded method is the PDF reader; a phrase inside a `.docx` returns it and its recorded method is the **office** reader, not the PDF reader (the method names what was read, not the route — spec assumption); a phrase inside a spreadsheet cell returns the spreadsheet; a textless PDF completes with empty extracted text and stays findable by filename; and a file whose extraction fails reports failed with a short reason while staying findable by filename and still downloadable (FR-002, FR-003, FR-004, FR-008, FR-011, FR-018, SC-002)

### Implementation for User Story 2

- [X] T026 [US2] Add `extractPDF(data []byte) (string, error)` to `backend/internal/files/content_extract.go` using `pdf.NewReader(bytes.NewReader(data), int64(len(data)))` and `(*Reader).GetPlainText()`, with a `defer recover()` converting a library panic into a returned error — the package documents itself as incomplete and its Value API does not report errors, so a panic is a realistic input-driven outcome and FR-011 requires it to become a recorded `failed` rather than a lost worker (research Decision 1)
- [X] T027 [US2] Add `PDFStorageKey string` to `ExtractContentInput` in `backend/internal/files/postprocessing_workflow.go` and pass step 1's `pdfResult.PDFStorageKey` into step 2 in `filePostProcessingWorkflow.Run`, so the office branch consumes the conversion in memory rather than re-reading `files.file_pdf_conversion` (research Decision 2)
- [X] T028 [US2] Extend the `ExtractContent` branch dispatch in `backend/internal/files/postprocessing_workflow.go`: `text/*`, `application/json` and `application/xml` → `extractPlainText`, method `plain_text`; `application/pdf` → buffer the object through the `MaxSourceReadBytes` limit and call `extractPDF`, method `pdf_parser`; the nine office types → read `input.PDFStorageKey` from R2 and call `extractPDF`, method `office_parser`, recording `failed` with reason `office conversion unavailable` when that key is empty or the object is missing, rather than reporting success with no text (FR-003, FR-004; depends on T026, T027)
- [X] T029 [US2] Add the observability the step owes principle V to `backend/internal/files/postprocessing_workflow.go`, all with `slog.*Context` and `file_id`: `content extraction started` (detected MIME, chosen method), `content extraction completed` (method, stored length, whether truncated, duration), `content extraction skipped` at **debug** — not error, this is the SC-007 fix — and `content extraction failed` at error carrying the full internal error, which must never be the same string stored in `indexing_error` (FR-018, research "Observability")
- [X] T030 [US2] Run `make test-backend-one TEST=TestContentIndexing` with Gotenberg up and confirm the PDF, word-processor, spreadsheet, textless-PDF and extraction-failure scenarios are green (depends on T024–T029)

**Checkpoint**: All three format families are searchable by content. US1 and US2 together
are the MVP.

---

## Phase 5: User Story 3 - See honestly whether a file's content has been indexed (Priority: P2)

**Goal**: `GetContentIndexStatus` stops answering `UNSPECIFIED` to every question and
distinguishes queued, extracting, completed, failed, not-a-type-we-read and never-indexed.

**Independent Test**: Query status immediately after upload (queued or extracting), after
indexing settles (completed, with a real method, duration, length and last-changed time),
for a JPEG (not content-indexed), and for a file that predates the feature (never indexed).
Four distinct, correct answers.

### Tests for User Story 3 ⚠️

- [X] T031 [P] [US3] Add the US3 scenarios to `backend/integration/files_content_index_test.go`: status straight after upload reports queued or extracting and never unspecified; after settling it reports completed, names the method, reports duration, text length and a non-null last-changed time; a JPEG, a video and a ZIP each report not-content-indexed as a distinct answer that is neither unspecified nor an error; a file with no index row whose type *is* indexable reports never-indexed; and an unknown file id in the caller's organization returns `NOT_FOUND` (FR-016, FR-017, SC-005)

### Implementation for User Story 3

- [X] T032 [US3] Rewrite `GetContentIndexStatus` in `backend/internal/files/service.go` to load the file's metadata first — it does not today, which is why it cannot tell a missing file from an unindexed one: return `connect.CodeNotFound` for a file id that does not exist in the caller's organization, then map a present row's `indexing_status` as today, and with no row derive `INDEXING_STATUS_NOT_APPLICABLE` when the detected type is not indexable and `INDEXING_STATUS_NEVER_INDEXED` when it is (research Decision 4, FR-016)
- [X] T033 [US3] Populate the fields that are always empty today in the same handler: `ExtractionMethod` from the row, `UpdatedAt` from `ContentIndex.UpdatedAt` via `timestamppb.New`, `TextLength` from the stored text, `DurationMs` from the row, and `ErrorMessage` from `indexing_error` — the short caller-safe string, never the internal error (FR-017, FR-018; depends on T010, T032)
- [X] T034 [P] [US3] Widen `ContentIndexInfo` in `frontend/packages/apis/src/files-security.ts` to carry `method?: string`, `textLength?: number` and `updatedAt?: Date`, mapping them in `getContentIndexStatus` alongside the existing status, error and duration — the wrapper stays the only caller of the RPC, per Constitution principle VII
- [X] T035 [US3] Run `cd frontend && pnpm -w typecheck` and confirm the regenerated enum from T007 broke no client, including mobile, which consumes the contract and renders no content-index screen (depends on T007, T034)

**Checkpoint**: Asking the system what it did with a file returns a specific, true answer.

---

## Phase 6: User Story 4 - Re-running indexing does not corrupt or duplicate (Priority: P3)

**Goal**: A retry or a re-index replaces the single stored result instead of adding a
second one, and a success clears a previous failure's reason.

**Independent Test**: Trigger indexing twice for one file; exactly one row remains, the
later run's outcome wins, and the file appears exactly once in search results.

### Tests for User Story 4 ⚠️

- [X] T036 [P] [US4] Add the US4 scenarios to `backend/integration/files_content_index_test.go`: indexing the same file twice leaves exactly one stored result and the file appears exactly once in search results; a file whose first attempt failed and whose second succeeded reports completed with the previous failure reason cleared to empty; and a file deleted while indexing is in flight does not appear in search results when indexing finishes (FR-009, FR-014)

### Implementation for User Story 4

- [X] T037 [US4] Confirm by reading the code — and fix if not true — that both writes in the `ExtractContent` step body go through the single `UpsertContentIndex` from T010, that the terminal upsert passes an empty `indexing_error` on success so `EXCLUDED.indexing_error` writes NULL over a prior failure rather than preserving it, and that no path still calls a create-then-update pair. `COALESCE` anywhere in that column's update is the bug FR-009 is guarding against (`backend/internal/files/postprocessing_workflow.go`, `backend/internal/files/index_logic.go`)
- [X] T038 [US4] Run `make test-backend-one TEST=TestContentIndexing` and confirm the idempotency scenarios are green (depends on T036, T037)

**Checkpoint**: All four user stories are independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: The honest job outcome (which no single story owns but which every upload
exercises), the removal of the last untrue statements in the repository, the living
documentation, and the two verifications the spec makes conditions of done.

- [X] T039 Replace the outcome roll-up in `filePostProcessingWorkflow.Run` in `backend/internal/files/postprocessing_workflow.go`: track each step as ok / skipped / failed and report `completed` when no step failed — including when every step was legitimately skipped — `partial` when some failed and some did not, and `failed` only when every applicable step failed. Delete `if !pdfConverted && !contentIndexed { processingStatus = "failed" }`, which is what reports a JPEG behaving exactly as designed as a failure on every single upload (FR-019, SC-007)
- [X] T040 [P] Add the job-outcome scenario to `backend/integration/files_content_index_test.go`: uploading an image produces a post-processing outcome of completed, not failed, and no error-level line in the worker log (FR-019, SC-007)
- [X] T041 [P] Delete the `// Post-processing workflow is currently a skeleton (conversion/indexing pending),` comment and its continuation at `backend/cmd/server.go:339`, which stops being true the moment T021 lands (FR-020)
- [X] T042 Verify SC-006 by running `grep -rn "image_ocr\|IMAGE_OCR\|ImageOCR" . --exclude-dir=node_modules --exclude-dir=.git | grep -v "^./specs/"` from the repository root and confirming no output. Expect to have to clean `frontend/packages/rpc/dst/` (the built output) and the column comment in `backend/database/scripts/schema.sql` if T006 was run before T004 landed
- [X] T043 [P] Update `docs/domain/files.md` (FR-023): describe content indexing as it now behaves — which formats are read, that office documents are read through their converted PDF, the 1 MiB stored-text cap, the six status answers — **delete** the sentence recording the post-processing job as a skeleton, and remove `image_ocr` from the description of extraction methods. Deleting behaviour that no longer exists is part of the job, not a follow-up
- [X] T044 [P] Re-read `docs/domain/workspace-navigation.md` and confirm its statement that a search snippet is populated only by documents is still accurate (FR-024) — file snippets are explicitly out of scope for this feature, so this task is a verification that ends in no edit unless the sentence has drifted
- [X] T045 [P] Update `backend/docs/SYSTEM-ARCHITECTURE.md` to describe the two-step post-processing workflow as it now runs, including the step-2 dependency on step 1's converted PDF for office formats (Constitution principle XII)
- [X] T046 Run the whole suite — `make test-backend` — not just the feature's own file, and `cd frontend && pnpm -w typecheck`. Both must be green; a green `TestContentIndexing` beside a broken neighbour is not done
- [X] T047 Verify SC-008 by doing it once, as quickstart requires: stub the extraction entry point in `backend/internal/files/content_extract.go` to return empty text, run `make test-backend-one TEST=TestContentIndexing`, and confirm **every** "returned by a phrase from its body" scenario goes red. A suite that stays green with extraction removed is still matching filenames and FR-021 is not satisfied. Restore the extractor and confirm green before calling the feature done
- [X] T048 Walk the manual validation in `specs/059-content-index-honesty/quickstart.md`: upload a document whose body shares no word with its name and search the body; upload a JPEG and confirm one debug skip line and a completed job outcome with zero error lines

---

## Assumptions recorded during implementation

Decisions taken without asking, as an unattended run requires. Each is the option a
reviewer following the repository's existing conventions would most likely have chosen.

- **[ASSUMPTION: FR-006 is enforced with a bounded wait, not left to retry luck.** The
  extraction step waits up to 15 s (`detectionSettleTimeout`) for the concurrent
  validation workflow to move `validation_status` off `pending` before choosing a MIME
  type, then proceeds on whatever is recorded. Research Decision 3 said retry would
  self-correct the detection race, but nothing re-runs a workflow that completed
  successfully, so without a wait "eligibility follows the detected type" would have been
  true only when the scheduler happened to cooperate — and the scenario testing it would
  have been flaky rather than evidence.]**
- **[ASSUMPTION: the failure path records `failed` and returns success from the step,
  rather than returning an error.** A failed extraction is a terminal outcome the status
  RPC reports (FR-008, FR-018); returning an error would burn the retry budget rewriting
  the same reason, and the workflow roll-up already counts it as a failed step so the job
  reports `partial`.]**
- **[ASSUMPTION: `ExtractContentOutput` gained `Failed`, `TextLength` and `Truncated` and
  lost `ExtractedText`.** Carrying up to 1 MiB of extracted text through the workflow's
  persisted step output would store every indexed document twice, once in
  `file_content_index` and once in `flows.steps`.]**
- **[ASSUMPTION: `pnpm -w typecheck` from quickstart does not exist in this workspace.**
  The equivalent checks that do exist were run and are green: `tsc --noEmit` over
  `packages/apis`, `pnpm typecheck:mobile`, and `tsc --noEmit` over `apps/web`.]**
- **[ASSUMPTION: SC-006's grep leaves four intentional hits.** Two are in
  `20260310120000_init.up.sql`, which is immutable migration history; one is the comment in
  this feature's own migration explaining what it removes; one is `reserved 3; // was
  EXTRACTION_METHOD_IMAGE_OCR` in the proto, which the contract requires so the tag is
  never silently reused. Nothing *advertises* OCR any more, which is what SC-006 is
  protecting. `docs/domain/files.md` was the only live claim and it is gone.]**
- **[ASSUMPTION: `make test-backend-one` takes `T=`, not `TEST=`.** The Makefile target
  reads `$(T)`; the task text's `TEST=` would have run the whole package.]**

Two bugs were found and fixed in the test suite itself while writing these scenarios,
both of which had been producing green results for the wrong reason:

- `withUsersFromDifferentOrgs` reassigns `w.OrgID` to a newly registered organisation. Any
  `w.withEmployee()` called after it lands in a stranger's org, so
  "a member of the same organization outside the channel gets nothing" was passing because
  the employee was in a different organisation entirely. All actors are now built before
  any org-moving helper, with an explicit `require.Equal` on the org id.
- The same trap in `seedIndexedFileWithoutAccessRule`: it now seeds against
  `uploader.OrgID` rather than the world's current cursor.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — **blocks every user story**. The contract
  and schema must move first because the Go code will not compile against the old generated
  enum, and the shared enqueue helper must exist before any story can observe a `pending`
  row
- **US1 (Phase 3)**: Depends on Foundational. No dependency on any other story
- **US2 (Phase 4)**: Depends on Foundational and on T020/T021 from US1 — it extends the
  same `content_extract.go` and the same step body rather than duplicating them. This is
  deliberate: two extractors for one job is exactly the shape research Decision 2 rejected
- **US3 (Phase 5)**: Depends on Foundational only. Testable against US1's rows but the
  handler change is independent — a status of never-indexed or not-applicable is correct
  and verifiable whether or not extraction works
- **US4 (Phase 6)**: Depends on Foundational (T010's upsert) and on US1's step body for
  something to re-run
- **Polish (Phase 7)**: Depends on the stories being complete. T039/T041 could technically
  land earlier, but T041 deletes a comment that is still true until T021 ships

### Within Each User Story

- Tests are written and confirmed failing before the implementation that makes them pass
- `content_extract.go` (the pure functions) before the step body that calls them
- The step body before the status handler that reports on its rows
- Backend before the generated client before the client wrapper

### Parallel Opportunities

- **Phase 2**: T003, T004, T005 and T008 touch four different files and can run together;
  T006 and T007 are the two regeneration steps and can run together once their inputs land;
  T012, T013 and T014 are three different call sites of the same new helper
- **Phase 3**: T016, T018, T019 and T020 touch four different files
- **Phase 4**: T024 (new fixtures file) runs alongside T026 (extractor)
- **Phase 5**: T031 (test) and T034 (frontend wrapper) are independent of T032/T033
- **Phase 7**: T040, T041, T043, T044 and T045 are five different files
- Across stories: once Phase 2 closes, US3's handler work (T032–T034) can proceed in
  parallel with US1's extraction work by a second person — they meet only at the tests

---

## Parallel Example: Phase 2 Foundational

```bash
# Four independent files, one batch:
Task: "Edit backend/rpc/v1/files.proto — drop IMAGE_OCR, add NOT_APPLICABLE/NEVER_INDEXED"
Task: "Create backend/database/migrations/20260912000001_drop_image_ocr_extraction_method.up.sql"
Task: "Replace three content-index queries with UpsertFileContentIndex in backend/database/scripts/files_security.query.sql"
Task: "Drop ExtractionMethodImageOCR and add extraction bounds in backend/internal/files/constants.go"

# Then the two regenerations, then the three call sites:
Task: "Replace inline enqueue in backend/internal/chat/file_upload.go with the shared helper"
Task: "Replace inline enqueue in backend/internal/collaboration/file_upload.go with the shared helper"
Task: "Replace inline enqueue in backend/internal/files/service.go with the shared helper"
```

---

## Implementation Strategy

### MVP scope

**US1 + US2 together**, not US1 alone. The spec argues this directly: shipping plain-text
extraction on its own would leave a searcher reasonably believing their PDFs are searchable
when they are not — the same trust problem this feature exists to end, in a smaller box.
Both are P1 for that reason.

That means Phases 1–4, ending at T030. At that checkpoint every format family is searchable
by content and access is provably unchanged. The status endpoint still answers poorly and
a JPEG upload still logs a failure, but nothing the product says is untrue.

### Incremental delivery

1. Phases 1–2 → the contract is honest and the tree compiles; nothing behaves differently
2. Phase 3 → plain text searchable by content (US1)
3. Phase 4 → PDF and office searchable by content (US2) — **ship here**
4. Phase 5 → the status endpoint tells the truth (US3)
5. Phase 6 → retries provably do not duplicate (US4)
6. Phase 7 → the logs stop crying wolf, the docs match the code, and SC-006/SC-008 are
   verified rather than asserted

### Parallel team strategy

Two people after Phase 2 closes: one takes US1 then US2 (the extraction spine, T020–T030),
the other takes US3 (T031–T035) and the documentation tasks (T043–T045). They meet at T046.
US4 is small enough to fall to whoever finishes first.

---

## Notes

- `[P]` = different files, no dependency on an incomplete task
- `[Story]` maps a task to a user story for traceability; Setup, Foundational and Polish
  carry no story label by design
- The marker-phrase rule is the feature's whole test discipline: **a phrase used to prove
  content search must never appear in the filename it was uploaded under.** Today's tests
  break this rule, which is why they pass against a stub that indexes nothing
- `backend/database/scripts/schema.sql` is a generated snapshot — regenerate it with
  `./scripts/regen-schema.sh`, never hand-edit it
- Commit after each task or logical group; stop at any checkpoint to validate a story
- [ASSUMPTION: Tests are included without being asked for in the `/speckit-tasks` input,
  because FR-021/FR-022 require them by name, SC-008 makes their ability to fail a
  condition of done, and Constitution principle II mandates integration scenarios for
  behavioural change. Generating this task list without test tasks would contradict three
  parts of the spec at once.]
- [ASSUMPTION: US2 is sequenced after US1 rather than fully parallel to it, despite both
  being P1, because they share `content_extract.go` and the single `ExtractContent` step
  body. Making them independently parallel would mean two extractors or two step bodies —
  the duplication research Decision 2 explicitly rejects. They remain independently
  *testable*, which is what the story structure is for.]
- [ASSUMPTION: The third enqueue call site is `TriggerPDFConversion` in
  `backend/internal/files/service.go:1254`, not a file-service upload confirmation. Reading
  the code confirms only three `flows.BeginTx` calls carry a
  `FilePostProcessingWorkflowInput`, and this is the third. The research document describes
  all three as "upload paths"; the helper consolidation in T011–T014 is correct either way,
  since all three enqueue the same workflow and must write the same `pending` row.]
