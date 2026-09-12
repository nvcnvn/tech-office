# Phase 0 Research: File content search that actually searches content

**Feature**: 059-content-index-honesty | **Date**: 2026-09-12

Every open question in the Technical Context was closed by reading the code that already
exists and by running the three experiments in "Verified by experiment" below. Nothing in
this document is left as NEEDS CLARIFICATION.

## What is already built (and therefore not researched)

Reading `backend/internal/files/` and `docs/domain/files.md` confirms the spec's premise
in full:

| Piece | Where | State |
|---|---|---|
| Storage table + multilingual index | `files.file_content_index`, `idx_file_content_pgroonga` | built |
| Access-controlled search query | `SearchFilesByNameAndContent` in `database/scripts/files_security.query.sql` | built, already joins `fci.extracted_text` and already matches it with `&@~` |
| Search logic | `internal/files/search_logic.go` | built |
| Federated `FILE` source | `internal/search/sources.go:243` calls the same `SearchFiles` | built — FR-015 needs no code |
| Status RPC | `FileServiceServer.GetContentIndexStatus`, `internal/files/service.go:1283` | built, answers `UNSPECIFIED` |
| Job registration + retry | `cmd/server.go:350`, `postProcessRetryPolicy()` | built |
| Enqueue on all three upload paths | `internal/files/service.go:1254`, `internal/chat/file_upload.go:242`, `internal/collaboration/file_upload.go:294` | built |
| Office → PDF conversion (step 1) | `ConvertFileToPDF` + `GotenbergClient`, Gotenberg 8 in `backend/docker-compose.yml` | built and deployed |
| Eligibility predicate | `indexLogic.IsIndexable` — 16 MIME types across text/PDF/office | built |
| **Text extraction (step 2 body)** | `ExtractContent` in `postprocessing_workflow.go:245` | **returns `Skipped: true, Reason: "Content extraction pending implementation"`** |

So the research question is narrow: *how does one Go process turn a stored object into
plain text for those three format families, with no new infrastructure?*

## Decision 1 — PDF text extraction library

**Decision**: `github.com/ledongthuc/pdf`, pinned at `v0.0.0-20260907135840-6c8c28e0e8a0`.

**Rationale**:
- Pure Go, MIT, **zero transitive dependencies** — it adds one line to `go.mod` and
  nothing to `go.sum`'s dependency graph, so it cannot drag in cgo or a licence problem.
- Actively maintained (head commit 2026-09-07, five days before this plan).
- Exposes exactly the two calls needed: `pdf.NewReader(io.ReaderAt, size)` and
  `(*Reader).GetPlainText() (io.Reader, error)`.
- Verified end to end against a real LibreOffice-produced PDF (see below), which is the
  only PDF shape the office path will ever hand it.

**Alternatives considered**:
- `github.com/dslipak/pdf` — a tagged (v0.0.2) fork of the same code. Rejected: the
  upstream is more recently maintained, and a fork's value is only in fixes upstream has
  not taken, which is not the case here.
- `github.com/gen2brain/go-fitz` (MuPDF) — best extraction quality by a distance, but cgo
  plus an AGPL/commercial licence. Rejected on both counts; the backend image is currently
  cgo-free.
- `github.com/pdfcpu/pdfcpu` — Apache-2.0 and pure Go, but its extraction surface yields
  content streams, not readable text, so the tokenising work would land here anyway.
- **Apache Tika as a sidecar container** — would extract every format directly and delete
  the need for the office→PDF hop. Rejected: it adds a JVM service to `deploy/`,
  `docker-compose.yml`, the health checks and the operational surface, for a capability two
  hundred lines of Go and an already-running container cover. The owner's standing
  preference is to weigh operational simplicity heavily and avoid adopting infrastructure
  where discipline will do.

**Known limitation, accepted**: the package's own docs say "the package is incomplete" and
the Value API does not report errors. Mitigation is a `defer recover()` around the
extraction call, converting a library panic into a recorded `failed` status — which FR-011
already requires to leave filename search intact.

## Decision 2 — How office documents become text

**Decision**: read the PDF that `convert-file-to-pdf/v1` has *already* produced in step 1
of the same workflow, and run the same PDF extractor over it. No second office reader.

**Rationale**: this is FR-004, and it is also the cheapest correct thing. Gotenberg is
deployed, runs on every office upload today, and its output is a normal PDF. One extractor
therefore covers PDF, DOCX, XLSX, PPTX, DOC, XLS, PPT, ODT, ODS and ODP.

**Consequence, made explicit**: office extraction inherits conversion's availability. When
step 1 skipped or failed, step 2 records `failed` with reason `office conversion
unavailable` rather than reporting success with empty text. The workflow already runs the
two steps in order, so step 2 receives step 1's `PDFStorageKey` directly — one new field on
`ExtractContentInput`, no second lookup.

**Alternatives considered**: unzipping OOXML and reading `word/document.xml` etc. directly.
Rejected: three parsers (WordprocessingML, SpreadsheetML, PresentationML), no coverage at
all for the legacy binary `.doc`/`.xls`/`.ppt` family, and it duplicates a conversion the
system already pays for.

## Decision 3 — Which MIME type decides eligibility

**Decision**: the extraction step re-reads `files.file_metadata` and uses
`detected_mime_type` when it is present and non-empty, falling back to `mime_type`.

**Rationale**: FR-006. The workflow input carries the *client-declared* `MimeType`
captured at upload confirmation, because the validation workflow that writes
`detected_mime_type` runs concurrently. Re-reading at step-execution time rather than
threading a value through the input is what makes the eligibility decision self-correcting
on retry — which is exactly the behaviour the spec's assumption about detection races asks
for, and it costs one query the step needs anyway.

## Decision 4 — Representing "not indexed" and "not indexable"

**Decision**: derive them at the RPC rather than storing them. No row is ever written for
an ineligible file.

- row present → map `indexing_status` as today
- no row, detected type **not** indexable → `INDEXING_STATUS_NOT_APPLICABLE`
- no row, detected type indexable → `INDEXING_STATUS_NEVER_INDEXED`

**Rationale**: FR-016 wants six answers; the table has four states and there is no reason
to write a row for every JPEG in the system just to say "we do not read these". The status
RPC must load the file's metadata anyway — it currently does not, which is why it cannot
distinguish a missing file from an unindexed one.

**Alternatives considered**: a fifth `skipped` value in the CHECK constraint with a row per
ineligible file. Rejected — it writes a row per avatar, per screenshot, per video, to carry
information already derivable from the file's own MIME type.

## Decision 5 — Who writes the `pending` ("queued") row

**Decision**: one shared helper, `files.EnqueueFilePostProcessing`, called from all three
upload paths. It writes the `pending` content-index row (when the declared type is
indexable) and enqueues the workflow, in the caller's transaction.

**Rationale**: Story 3 scenario 1 requires a file queried immediately after upload to read
*queued or extracting*, never "unspecified". Only the enqueue site knows the moment the
attempt began. The three call sites today are the same twenty lines copied three times
(`internal/files/service.go:1254`, `internal/chat/file_upload.go:242`,
`internal/collaboration/file_upload.go:294`), down to the same log messages, so folding
them into one helper is a net deletion and puts the new write in exactly one place. This
also matches the owner's standing preference to consolidate a surface behind one owner
rather than patch each copy again.

**Race handled**: the declared type may be wrong. If the declared type is indexable but the
detected type is not, the step deletes the stale `pending` row (`DeleteFileContentIndex`
already exists) so the status derives to `NOT_APPLICABLE`. If the declared type is not
indexable but the detected type is, no `pending` row exists and the step's upsert creates
one.

## Decision 6 — Idempotency

**Decision**: make `InsertFileContentIndex` an upsert on the existing
`unique_file_index (organization_id, file_id)` constraint, with
`DO UPDATE SET extracted_text, extraction_method, indexing_status,
indexing_error = EXCLUDED.indexing_error, indexing_duration_ms, updated_at = now()`.

**Rationale**: FR-009 in one statement, and it collapses the "create then update" dance in
`indexLogic` into a single call the step makes twice (once `in_progress`, once terminal).
The precedent is three queries up in the same file: `InsertPDFConversion` was made
`ON CONFLICT ... DO UPDATE` for the same reason, and its comment explains why `DO NOTHING`
is wrong for a `:one` query. Passing `indexing_error` through `EXCLUDED` — rather than
`COALESCE` — is what clears a previous failure's reason on a later success.

## Decision 7 — Bounds

| Bound | Value | Why |
|---|---|---|
| Stored text | 1 MiB, truncated on a rune boundary | spec assumption; ≈ a few hundred pages |
| Source bytes read | 64 MiB | the PDF reader needs `io.ReaderAt`, so the object is buffered; beyond this the file records `failed` / "file too large to index" rather than consuming the worker |
| Extraction wall clock | 30 s | matches `--api-timeout=30s` already set on the Gotenberg container, so the two limits cannot disagree |

Extracted text is whitespace-collapsed before storage. This is not cosmetic: a
LibreOffice-rendered page pads every line to the page width, and the raw text of a
one-line PDF measured 5,022 bytes against 88 bytes collapsed in the experiment below.

## Decision 8 — Removing `image_ocr`

**Decision**: delete it from the CHECK constraint (forward-only migration), the backend
constant, the proto enum, the regenerated Go/TS clients and every comment. The proto keeps
`reserved 3;` so the tag is never silently reused for something else.

No data migration is needed: nothing has ever written a content-index row, so no stored
value can violate the narrowed constraint. This is a breaking wire change shipped as one
coordinated change set across backend and clients, per the project's early-development
stance; there is no compatibility shim.

## Decision 9 — Test fixtures for PDF and office formats

**Decision**: generate fixtures in the test process. No binary files are committed.

- **PDF with selectable text**: a handcrafted minimal PDF built in ~25 lines
  (`catalog → pages → page → content stream` with a `Tj` text-showing operator).
- **Textless "scanned" PDF**: the same builder with a `re f` rectangle and no text operator.
  Behaviourally identical to a page image as far as the extractor is concerned.
- **DOCX and XLSX**: built with `archive/zip` from three and five small XML parts
  respectively — `[Content_Types].xml`, `_rels/.rels`, and the document/workbook parts.

**Rationale**: `scripts/check-tracked-files.sh` allows `pdf` but not `docx`/`xlsx`/`pptx`
among tracked binary extensions, so committed office fixtures would fail the repository's
own guard. More importantly, a generator lets each test inject its own unique marker
phrase, which a static fixture cannot — and a unique phrase in the *content* but not the
*filename* is precisely what FR-021 says the current tests lack.

**Presentation formats (.pptx) are excluded from the test suite**, and this is the one
scope exclusion Constitution principle II requires to be justified in the plan: a minimal
valid `.pptx` needs a `presentation.xml` → `slideMaster` → `slideLayout` → `slide`
relationship chain, several times the fixture code of the other two, to exercise a code
path that is byte-for-byte the one `.xlsx` already covers (same MIME branch, same
Gotenberg call, same PDF extractor). Spreadsheet and word-processor coverage proves the
office family; presentations differ only in what LibreOffice does inside its own container.

## Verified by experiment

Run against the repository's own `gotenberg/gotenberg:8` container on 2026-09-12. These
are the three assumptions whose failure would have invalidated the whole approach.

1. **Real LibreOffice PDF → text.** A `.docx` converted through
   `POST /forms/libreoffice/convert` and read by `ledongthuc/pdf` returned
   `"Method statement for confined space entry procedures.\nFOXTROT9911 unique marker
   phrase."` — embedded subset fonts and their ToUnicode CMaps decode correctly, which was
   the single biggest risk in Decision 1.
2. **Minimal generated OOXML is accepted by LibreOffice.** The three-part `.docx` and
   five-part `.xlsx` from Decision 9 both converted (HTTP 200) and both round-tripped their
   marker phrase out of the resulting PDF. Decision 9 is therefore buildable.
3. **Malformed and textless input degrade honestly.** Random bytes produce
   `not a PDF file: invalid header` — an error, not a panic. A textless one-page PDF
   produces `pages=1, len=0` — no error, empty text, which is exactly the outcome Story 2
   scenario 5 calls for now that OCR is dropped.

## Observability (Constitution principle V)

The step logs, with `slog.*Context` and the `file_id`:
`content extraction started` (detected MIME, extraction method), `content extraction
completed` (method, stored length, whether truncated, duration), `content extraction
skipped` at **debug** (not error — this is the fix for SC-007), and `content extraction
failed` at error with the internal reason. The short, infrastructure-free reason required
by FR-018 is a separate mapped string stored in `indexing_error`; the full error goes to
the log only.
