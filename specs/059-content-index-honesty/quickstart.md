# Quickstart & Validation: File content search that actually searches content

**Feature**: 059-content-index-honesty | **Date**: 2026-09-12

This is the run-and-verify guide, plus the scenario contract that Constitution principle II
requires to be agreed before tasks are written. It does not contain implementation code;
see [plan.md](./plan.md) for what gets built and [research.md](./research.md) for why.

## Prerequisites

```bash
make infra-up                 # postgres, clamav, gotenberg — gotenberg is not optional
                              # for this feature, the office path goes through it
cd backend && ./scripts/migrate.sh up
```

R2 credentials must be present in the backend environment (`R2_*`); extraction reads the
stored object, so a run with no object storage will record failures rather than text.

After changing the schema or the contract:

```bash
cd backend
./scripts/regen-schema.sh     # regenerates database/scripts/schema.sql — never hand-edit
sqlc generate
buf generate                  # rewrites rpc/v1/files.pb.go AND
                              # ../frontend/packages/rpc/rpc/v1/files_pb.ts together
go build ./...
```

## Running the suite

```bash
make test-backend                              # the whole suite must be green, not just the new file
make test-backend-one TEST=TestContentIndexing # the feature's own scenarios
cd frontend && pnpm -w typecheck               # the regenerated enum must not break a client
```

## The scenario contract

Scenario names are the behavioural contract. They live in
`backend/integration/files_content_index_test.go` (and the two noted cases in
`files_search_test.go`), follow the repository's `testWorld` and nested-`t.Run` pattern, and
carry `// FR-XXX` comments for traceability.

The rule that makes these tests evidence rather than decoration: **the marker phrase must
appear only in the file's body, never in the filename it is uploaded under.** Today's tests
put the same slug in both, which is why they pass against a stub that indexes nothing.

### `TestContentIndexing`

**User Story 1 — find a document by a phrase inside it**

- `when a text file's body shares no word with its filename`
  - `the file is returned by a phrase from its body` — FR-001, FR-012, SC-001, SC-002
  - `the file is also still returned by its filename` — FR-011
  - `a member of another organization searching that phrase gets nothing` — FR-013, SC-003
  - `a member of the same organization outside the file's channel gets nothing` — FR-013, SC-003
  - `an employee who belongs to no channel and no department gets nothing` — FR-013, SC-003
- `when a file's body is in a non-Latin script`
  - `a phrase in that script returns the file` — FR-012 (PGroonga, no language configuration)
- `when one file matches on filename and another on content`
  - `both appear in a single ranked list` — FR-012 *(in `files_search_test.go`)*
- `when a file matching by content is soft-deleted`
  - `it is no longer returned` — FR-014, Story 4 scenario 3

**User Story 2 — find a PDF, and a Word document, by what is written in it**

- `when a PDF containing selectable text is uploaded`
  - `a phrase from inside the PDF returns it` — FR-002, SC-002
  - `its recorded extraction method is the PDF reader` — FR-008
- `when a word-processor document is uploaded`
  - `a phrase from inside it returns the document` — FR-003, FR-004, SC-002
  - `its recorded extraction method is the office reader, not the PDF reader` — FR-008
- `when a spreadsheet is uploaded`
  - `a phrase from inside a cell returns the spreadsheet` — FR-003, SC-002
- `when a PDF has no selectable text`
  - `indexing completes with no extracted text` — FR-002, Story 2 scenario 5
  - `the file remains findable by its filename` — FR-011
- `when extraction fails for a file`
  - `its status reports failed with a short reason` — FR-008, FR-018
  - `the file is still returned by a filename search` — FR-011
  - `the file is still downloadable` — FR-011

**User Story 3 — see honestly whether a file's content has been indexed**

- `when a file's content index status is requested straight after upload`
  - `it reports queued or extracting, never unspecified` — FR-016, SC-005
- `when indexing has settled`
  - `it reports completed` — FR-016
  - `it names the extraction method used` — FR-017
  - `it reports the extraction duration and the stored text length` — FR-008
  - `it reports when the status last changed` — FR-017
- `when the file is an image, a video or an archive`
  - `it reports that this file type is not content-indexed` — FR-016
  - `and this is a distinct answer from unspecified and from an error` — FR-016, SC-005
- `when the file predates content indexing`
  - `it reports never indexed rather than indexed-and-empty` — FR-016

**User Story 4 — re-running indexing does not corrupt or duplicate**

- `when indexing runs twice for the same file`
  - `exactly one stored result remains` — FR-009
  - `the file appears exactly once in search results` — FR-009
- `when a failed file is indexed again successfully`
  - `the status becomes completed` — FR-009
  - `the previous failure reason is cleared` — FR-009

**Edge cases**

- `when a text file exceeds the stored-text cap`
  - `indexing completes rather than failing` — FR-007
  - `the file is findable on a phrase within the kept portion` — FR-007
  - `the reported text length equals what was stored` — FR-007
- `when a file is declared as text but is binary in fact`
  - `eligibility follows the server-detected type, not the client's claim` — FR-006
- `when a file has no access-rule row`
  - `indexing its content does not make it findable` — FR-013, SC-003
- `when an image is uploaded`
  - `the post-processing job reports completed, not failed` — FR-019, SC-007

**Documented exclusion.** Presentation formats (`.pptx`) have no scenario. Justified in
[research.md](./research.md) Decision 9: a minimal valid `.pptx` needs a
`presentation.xml → slideMaster → slideLayout → slide` relationship chain, several times
the fixture code of the other formats, to exercise the identical code path that `.xlsx`
already covers — same MIME branch, same Gotenberg call, same PDF extractor.

## Fixtures

Built in the test process, so each scenario injects its own marker phrase and no binary
file is committed (`scripts/check-tracked-files.sh` allows tracked `pdf` but not
`docx`/`xlsx`). See [research.md](./research.md) Decision 9.

| Helper | Produces | Used by |
|---|---|---|
| `pdfWithText(phrase)` | one-page PDF, catalog→pages→page→content stream with a `Tj` operator | PDF scenarios |
| `pdfWithoutText()` | the same builder with a rectangle and no text operator | the "scanned PDF" scenario |
| `docxWithText(phrase)` | 3-part OOXML zip: `[Content_Types].xml`, `_rels/.rels`, `word/document.xml` | word-processor scenarios |
| `xlsxWithText(phrase)` | 5-part OOXML zip with an `inlineStr` cell | spreadsheet scenarios |

All four were built and round-tripped through the repository's own Gotenberg container and
the chosen PDF reader before this plan was written; see research, "Verified by experiment".

## Manual validation

```bash
# 1. Upload a document whose body shares no word with its name, then search the body.
#    Expected: the file comes back, and its content-index status names a real method,
#    a duration, a text length and a last-changed time — not "unspecified".

# 2. Upload a JPEG and watch the worker log.
#    Expected: one debug line saying extraction was skipped, and a job outcome of
#    "completed". SC-007: zero error lines, where today there is one per upload.

# 3. Confirm nothing advertises OCR any more (SC-006):
grep -rn "image_ocr\|IMAGE_OCR\|ImageOCR" . --exclude-dir=node_modules | grep -v "^./specs/"
#    Expected: no output.
```

## The proof that the tests are evidence (SC-008)

This is a required, verified-once step, not a formality — it is the whole reason the feature
exists in this shape.

```bash
# Stub the extractor back out: make the extraction entry point return empty text.
make test-backend-one TEST=TestContentIndexing
```

**Expected: failures.** Every "returned by a phrase from its body" scenario must go red.
If the suite stays green with extraction removed, the tests are still matching on filenames
and have not been fixed. Restore the extractor and confirm green before the feature is
considered done.

## Definition of done

- [ ] `make test-backend` green — the entire suite, not only the new file
- [ ] `pnpm -w typecheck` green in `frontend/` against the regenerated enum
- [ ] SC-008 verified by removing the extractor and watching the content tests fail
- [ ] SC-006 verified by the grep above returning nothing outside `specs/`
- [ ] `docs/domain/files.md` updated: content indexing described as it then behaves, the
      "skeleton" sentence deleted, `image_ocr` gone (FR-023)
- [ ] `docs/domain/workspace-navigation.md` re-read and confirmed still accurate — files
      still produce no snippet, and it still says so (FR-024)
- [ ] `backend/docs/SYSTEM-ARCHITECTURE.md` updated (Constitution principle XII)
