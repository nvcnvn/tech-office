# Feature Specification: File content search that actually searches content

**Feature Branch**: `059-content-index-honesty`

**Created**: 2026-09-12

**Status**: Draft

**Input**: User description: "Finish or cut file content indexing. Post-processing is partly a skeleton while file search advertises content matching. Either make text and PDF extraction work end to end and drop OCR, or remove the content index and search by filename only. A half-working feature costs more trust than an honestly absent one."

## The choice, made

The description offers two exits. This spec takes **finish**, not **cut**, and the rest of
the document assumes that decision.

The reason is that everything except the extraction itself is already built and already
correct. The storage table exists with a multilingual full-text index over the extracted
text. The search query already joins it and already applies the access rule that keeps a
file out of results for someone who cannot download it. The status endpoint exists. The
background job is registered, is enqueued on every upload from all three upload paths, and
already has a retry policy. The first step of that same job already converts office
documents to PDF through a converter that is deployed and running in production today.

What is missing is one step body. It logs that extraction "was requested", returns
"pending implementation", and exits — so **no file in the system has ever had a single
character of its content indexed**, and no row has ever been written to the content table.
Every "search matched the content of this file" claim the product makes is, today,
a filename match wearing a content match's clothes.

Cutting would mean deleting a table, an index, a migration, an endpoint, a permission, two
enums, a set of constants across three languages, and a working access-control-correct
query — in order to deliver *less* than the product already promises. Finishing means
writing the step body that was always meant to be there, plus removing one extraction
method that was never more than an aspiration.

**OCR is dropped**, as the description directs. It exists today only as the string
`image_ocr` in a database constraint, a backend constant, a wire-contract enum value, and three
comments that call it "(future)". Nothing produces it and nothing consumes it. It is
removed rather than left as a promise the system has no plan to keep.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Find a document by a phrase inside it (Priority: P1)

An operations lead remembers that somebody shared the new supplier's payment terms, but
not who shared it, not which channel, and not what the file was called. They remember one
phrase from inside it: "net sixty on receipt". They type that phrase into file search and
the document comes back.

**Why this priority**: This is the entire promise of the feature and the only reason the
content table exists. Without it, file search is filename search with extra machinery and
the product is claiming something untrue. Every other story in this spec is a refinement
of, or an honest failure mode for, this one.

**Independent Test**: Upload a plain-text file whose filename shares no word with its
body. Search for a distinctive phrase that appears only in the body. The file is returned.
Search for the same phrase as a member of a different organization, and as a member of the
same organization who does not belong to the file's channel — neither gets a result.

**Acceptance Scenarios**:

1. **Given** a text file named `q3-notes.txt` containing the phrase "net sixty on
   receipt", uploaded to a channel the searcher belongs to, **When** the searcher searches
   for "net sixty on receipt", **Then** the file appears in the results, and it appears
   even though no search term occurs in its filename.
2. **Given** the same file, **When** a member of a different organization searches for the
   same phrase, **Then** no result is returned.
3. **Given** the same file, **When** a member of the same organization who does not belong
   to that channel searches for the same phrase, **Then** no result is returned.
4. **Given** a file whose content is in a non-Latin script, **When** a searcher enters a
   phrase from that content in the same script, **Then** the file is returned, because
   content matching uses the same multilingual matcher the rest of search already uses.
5. **Given** a file that matches on its filename only and another that matches on its
   content only, **When** both are within the searcher's access, **Then** both appear in
   one ranked list with no indication to the caller of which field produced the match.

---

### User Story 2 - Find a PDF, and a Word document, by what is written in it (Priority: P1)

A site supervisor needs the method statement that mentions "confined space entry". It was
attached to a work item as a PDF. A second one was attached as a `.docx`. Both come back.

**Why this priority**: PDFs and office documents are the formats that actually carry an
SMB's written knowledge; plain text alone would make the feature technically true and
practically useless. It is P1 alongside Story 1 rather than P2 because shipping plain-text
extraction on its own would still leave a searcher reasonably believing their PDFs are
searchable when they are not — the same trust problem in a smaller box.

**Independent Test**: Upload a PDF and a `.docx`, each containing a distinctive phrase not
present in its filename. Search for each phrase. Both files are returned. Confirm the
recorded extraction method distinguishes the PDF-sourced text from the office-sourced
text.

**Acceptance Scenarios**:

1. **Given** a PDF containing selectable text including "confined space entry", **When** a
   permitted searcher searches that phrase, **Then** the PDF is returned.
2. **Given** a `.docx` containing "confined space entry", **When** a permitted searcher
   searches that phrase, **Then** the document is returned.
3. **Given** a spreadsheet and a presentation each containing a distinctive phrase in their
   cells or slides, **When** a permitted searcher searches that phrase, **Then** each is
   returned.
4. **Given** an office document whose conversion to a page-rendered form fails, **When**
   indexing runs, **Then** the file's indexing status is recorded as failed with the reason,
   and the file remains findable by filename — a failure to read the inside of a file never
   removes the outside of it from search.
5. **Given** a PDF that contains only scanned page images and no selectable text, **When**
   indexing runs, **Then** indexing completes with no extracted text and the file remains
   findable by filename. This is the honest outcome now that OCR is dropped: the system
   read the file, found no text, and says so, rather than reporting failure or silently
   pretending.

---

### User Story 3 - See honestly whether a file's content has been indexed (Priority: P2)

Someone who has just uploaded a large document, or who is troubleshooting why a search
missed, asks the system what it did with that file. They get a truthful answer: queued,
extracting, done, failed with a reason, or not the kind of file we read inside.

**Why this priority**: The status endpoint already exists and is already reachable, so
today it answers every question with "unspecified" — which is indistinguishable from
"something is broken". Making it truthful is what converts the feature from "seems to work
when it works" into something a person can reason about. It is P2 because search itself
delivers value without anyone ever opening the status view.

**Independent Test**: Query the status of a file immediately after upload, again after
indexing settles, and for a file type that is never indexed. The three answers differ and
each is correct.

**Acceptance Scenarios**:

1. **Given** a text file uploaded moments ago, **When** its content index status is
   requested, **Then** it reports queued or extracting, not "unspecified".
2. **Given** the same file after indexing has settled, **When** its status is requested,
   **Then** it reports completed, names the extraction method used, reports how long
   extraction took, reports the length of the text extracted, and reports when that status
   was last changed.
3. **Given** a file whose extraction failed, **When** its status is requested, **Then** it
   reports failed together with a short reason that does not disclose internal
   infrastructure detail.
4. **Given** a JPEG, a video, or a ZIP archive, **When** its status is requested, **Then**
   it reports that this file type is not content-indexed — a distinct, deliberate answer,
   not an error and not "unspecified".
5. **Given** a file uploaded before this feature shipped, **When** its status is requested,
   **Then** it reports that it has not been indexed, rather than implying it was indexed
   and found empty.

---

### User Story 4 - Re-running indexing does not corrupt or duplicate (Priority: P3)

A transient infrastructure hiccup causes the background job to be retried, or an
administrator asks for a file to be re-indexed after a failure.

**Why this priority**: Correctness under retry, not new user-visible capability. The job
already carries a retry policy, so this behaviour will be exercised in production whether
or not it is specified. P3 because it is invisible when it works.

**Independent Test**: Trigger indexing twice for the same file and confirm exactly one
stored result, with the later run's outcome winning.

**Acceptance Scenarios**:

1. **Given** a file that has already been indexed, **When** indexing runs again for it,
   **Then** the stored text and status are replaced, not duplicated, and the file appears
   exactly once in search results.
2. **Given** a file whose first indexing attempt failed, **When** a later attempt
   succeeds, **Then** the status becomes completed and the recorded failure reason is
   cleared.
3. **Given** a file that is deleted while its indexing is in flight, **When** indexing
   finishes, **Then** the file does not appear in search results, because search already
   excludes deleted files regardless of what the content table holds.

---

### Edge Cases

- **A very large text file.** Extraction must not read an unbounded amount of a file into
  memory or store an unbounded amount of text. Text beyond a defined cap is truncated, the
  file is still indexed and findable on the portion that was kept, and the status reflects
  the length actually stored. The cap is a stated product limit, not an accident of
  whatever the infrastructure tolerates.
- **A file that is text by declaration but binary in fact.** The upload path already
  detects the real type. Extraction reads the detected type, not the client's claim, so a
  renamed binary does not get a page of control characters indexed as if it were prose.
- **A file with no readable text at all** — an empty document, a PDF of blank pages.
  Indexing completes; extracted text is empty; the file remains findable by filename.
- **An office document whose conversion succeeds but produces an empty page-rendered
  form.** Treated as "completed, no text", not as failure.
- **A searcher who belongs to no channel and no department.** Already returns nothing, and
  must continue to return nothing once content matching is live — content is not a second
  door into a file whose context door is closed.
- **A file with no access-rule row.** Unreachable by search today and must stay
  unreachable; indexing its content must not make it findable.
- **Search terms that match a file's content but the file is soft-deleted.** Excluded.
- **Both conversion and extraction legitimately skip** — for instance a JPEG, which is
  neither converted to a page-rendered form nor read for text. The job's overall outcome
  must be reported as completed-with-nothing-to-do, not as failure. Today it is reported
  as failure, which will fill the operational logs with alarms about images behaving
  exactly as designed.
- **A term that appears in one file's filename and a different file's content.** Both
  returned, ranked in one list.

## Requirements *(mandatory)*

### Functional Requirements

#### Extraction

- **FR-001**: The system MUST extract readable text from uploaded plain-text formats
  (including plain text, Markdown, comma-separated values, HTML, XML and JSON) and store
  it for search.
- **FR-002**: The system MUST extract readable text from PDF documents that contain
  selectable text and store it for search.
- **FR-003**: The system MUST extract readable text from office documents — word
  processor, spreadsheet and presentation formats in both the modern and legacy families,
  and the OpenDocument equivalents — and store it for search.
- **FR-004**: The system MUST extract office-document text by reading the page-rendered
  form that the existing conversion step of the same background job already produces,
  rather than adding a second, independent office-format reader. Where conversion has not
  produced that form, office extraction MUST record a failure with the reason rather than
  reporting success with no text.
- **FR-005**: The system MUST NOT attempt optical character recognition. The
  `image_ocr` extraction method MUST be removed from the database constraint, the backend
  constants, the wire contract, the generated clients, and every comment that describes the
  set of extraction methods, so that no surface advertises a capability the system does not
  have.
- **FR-006**: The system MUST decide whether a file is eligible for extraction using the
  server-detected content type established during validation, not the type declared by the
  uploading client.
- **FR-007**: The system MUST cap the volume of text stored per file, truncate beyond that
  cap rather than failing, and record the length actually stored.
- **FR-008**: The system MUST record, for every file it attempts to index, a durable result
  comprising: the extracted text, the extraction method used, a status of queued,
  extracting, completed or failed, a failure reason when failed, the time taken, and the
  time the status last changed.
- **FR-009**: Re-indexing a file MUST replace that file's single stored result rather than
  creating a second one, and MUST clear a previously recorded failure reason on success.
- **FR-010**: Extraction MUST run within a bounded time and MUST NOT block the upload, the
  upload confirmation, or the file becoming downloadable.
- **FR-011**: A failure to extract a file's content MUST NOT remove that file from
  filename search, delete the file, or affect its download availability.

#### Search

- **FR-012**: File search MUST match against stored extracted text as well as filenames,
  returning one ranked list, with matching in content using the same multilingual matcher
  already used for filenames.
- **FR-013**: Content matching MUST NOT widen access by any route. A file MUST remain
  invisible to a searcher who could not already reach it by filename: the access rule
  binding a file to a context the searcher belongs to is unconditional, and a file with no
  such binding remains unreachable.
- **FR-014**: Soft-deleted files MUST NOT be returned by content matches.
- **FR-015**: The federated search surface MUST inherit this behaviour through the single
  existing file-search implementation; there MUST NOT be a second content-matching path.

#### Status reporting

- **FR-016**: The content index status endpoint MUST report the true state of a file's
  indexing, distinguishing queued, extracting, completed, failed, not-eligible-for-
  indexing, and never-indexed from one another.
- **FR-017**: The status endpoint MUST populate the last-changed time, which is currently
  always absent, and the extraction method, which is currently always unspecified.
- **FR-018**: A failure reason surfaced to a caller MUST be short and MUST NOT disclose
  internal hostnames, credentials, storage keys or stack traces.

#### Job outcome reporting

- **FR-019**: The post-processing job MUST report its overall outcome honestly: completed
  when every applicable step succeeded or was legitimately not applicable, partial when
  some succeeded and some failed, failed only when a step that should have run did fail.
  A file for which neither conversion nor extraction applies MUST NOT be reported as a
  failure.
- **FR-020**: The comment in the server wiring describing the post-processing job as a
  skeleton MUST be removed once it is no longer true.

#### Honesty of the test suite

- **FR-021**: The integration tests asserting that a file is "findable by content" MUST be
  written so that they fail if content indexing does nothing. The current tests pass today
  against a stub, because the phrase they search for also appears in the filename they
  uploaded under; a test that cannot fail is not evidence.
- **FR-022**: There MUST be a test for each of: plain-text extraction, PDF extraction,
  office-document extraction, a scanned PDF yielding no text, an extraction failure leaving
  filename search intact, cross-organization isolation of content matches, and a searcher
  without the file's context being unable to reach it by a content term.

#### Documentation

- **FR-023**: The file-storage domain document MUST be updated to describe content
  indexing as it then behaves, MUST delete the sentence recording the job as a skeleton,
  and MUST remove `image_ocr` from its description of extraction methods.
- **FR-024**: Where the search domain document states which sources produce a text snippet,
  it MUST remain accurate. Producing snippets for file content is explicitly out of scope
  for this feature, so files MUST continue to return no snippet and the document MUST
  continue to say so.

### Key Entities

- **File content index**: One record per file, holding the text extracted from that file,
  which method produced it, whether extraction is queued, running, done or failed, why it
  failed, how long it took, and when that last changed. Exactly one record per file.
- **File metadata**: The existing record of a file's name, size, declared and detected
  type, uploader, validation outcome and deletion flag. Content indexing reads the detected
  type from here and never modifies this record.
- **File access rule**: The existing binding of a file to the context it was uploaded into.
  It is the sole authority on who may see a file in search results; the content index has
  no say in visibility.
- **Extraction method**: The named way a file's text was obtained — direct read for plain
  text, PDF reading for PDFs, office-document reading for office formats. Optical character
  recognition is removed from this set by this feature.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person who remembers a distinctive phrase from inside a document, but not
  its name, its author or where it was shared, finds that document in one search. This is
  possible for zero of the formats today and must be possible for plain text, PDF and
  office documents afterwards.
- **SC-002**: Across a suite covering plain text, PDF, and the word-processor, spreadsheet
  and presentation formats, 100% of files containing a distinctive phrase that does not
  appear in their filename are returned when that phrase is searched.
- **SC-003**: Content matching grants no one access they did not already have: for every
  access scenario in the suite — another organization, a non-member of the file's context,
  a person belonging to no context, and a file with no context binding — the number of
  files reachable by a content term is zero.
- **SC-004**: 95% of uploaded documents under ten megabytes are searchable by their content
  within one minute of upload completing.
- **SC-005**: Asking the system about a file's indexing state returns a specific, true
  answer in 100% of cases, where today it returns "unspecified" in 100% of cases.
- **SC-006**: No surface of the product — contract, database constraint, client type,
  status response or written documentation — names an extraction capability the system does
  not perform. Verified by searching the repository for the removed method and finding no
  occurrences outside historical specification folders.
- **SC-007**: Uploading an image, a video or an archive produces no failure in operational
  logs, where today it produces one per upload.
- **SC-008**: Removing the content-extraction implementation causes the content-indexing
  tests to fail. Verified once, by doing it, before the feature is considered done.

## Assumptions

- [ASSUMPTION: The feature is finished rather than cut. The description explicitly permits
  either, and offers no preference. Finishing is chosen because the storage, the index, the
  access-controlled query, the status endpoint, the job registration, the enqueue on all
  three upload paths and the retry policy are already built and correct — only the step
  body is absent — and because the office-document path can reuse the PDF conversion that
  already runs as step one of the same job, which makes the remaining work small. Cutting
  would require deleting more code than finishing requires writing, in order to ship less
  capability than is already advertised.]
- [ASSUMPTION: Office-document text is obtained by reading the converted PDF that the same
  job's first step already produces, rather than by adding a separate reader for each
  office format. The converter is already deployed and already runs on every office upload,
  so this adds no new moving part. The trade-off is that office extraction inherits the
  conversion's availability — if conversion fails, extraction fails — which FR-004 makes
  explicit and reports honestly rather than hiding.]
- [ASSUMPTION: The extraction method recorded for an office document remains the
  office-document method, not the PDF method, because the method names describe what kind
  of file was read, which is what a person reading the status wants to know. That the
  reading happens by way of a PDF rendering is an implementation route, not a different
  answer to "what was this file".]
- [ASSUMPTION: The stored-text cap is one megabyte of extracted text per file, which holds
  roughly a few hundred pages of prose — well beyond any document whose body someone
  searches by phrase — while bounding worst-case memory and storage for a hundred-megabyte
  upload. The cap truncates rather than fails, so a very long document stays findable on
  its opening hundreds of pages.]
- [ASSUMPTION: Extraction is bounded at thirty seconds per file, matching the timeout
  already configured for the document converter this feature depends on, so the two limits
  do not disagree with each other.]
- [ASSUMPTION: Files uploaded before this feature ships are not retroactively indexed. They
  report as never-indexed and remain findable by filename. Backfilling existing files is a
  separate operational decision with a cost proportional to stored volume, and nothing in
  the description asks for it.]
- [ASSUMPTION: Removing the optical-character-recognition method is a breaking change to
  the wire contract and the database constraint, and ships as one coordinated change across
  backend, web and mobile with no compatibility shim, per the project's stance during early
  development. No stored record uses the value, because nothing has ever written one, so no
  data migration is needed beyond narrowing the constraint.]
- [ASSUMPTION: Producing a text snippet for a file search result is out of scope. Documents
  and messages produce snippets today and files do not; adding file snippets would change a
  cross-domain contract and the shape of a result row on both clients, which is a larger
  and separable change than making content matching work at all.]
- [ASSUMPTION: The detected content type recorded during validation is available to the
  extraction step. Both run in the same background job family against the same file record,
  and validation is enqueued alongside post-processing at upload confirmation. If detection
  has not completed when extraction runs, extraction uses the declared type and the
  eligibility decision is re-derived on retry.]
- [ASSUMPTION: Extraction reads the stored object rather than any client-supplied copy, and
  runs under the organization's tenant scoping like every other step in the job, so a file's
  text cannot be written into another organization's index.]
