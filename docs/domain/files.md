# File Storage

Binary storage on Cloudflare R2 with per-org quota, virus scanning, MIME validation,
context-scoped access rules, PDF conversion and content indexing. Owned by
`internal/files`; contract in `rpc/v1/files.proto` (`FileService`, 15 RPCs).

**Status date: 2026-09-12.** Supersedes specs 014, 015, 045, 059, 062.

## Upload flow

Uploads are **domain-owned**, not generic. Feature 015 moved the security boundary into
the owning domain so the server — never the client — decides who may attach a file where.

```
1. <Domain>Service.Request*FileUpload
     ├─ verify membership/permission IN the transaction
     ├─ derive access_scope from the context (channel privacy, project visibility)
     ├─ reserve quota
     └─ return presigned R2 PUT URL + file_id
2. client PUTs bytes directly to R2
3. <Domain>Service.Confirm*FileUpload
     ├─ re-verify membership (closes the race)
     ├─ write files.file_access_rule
     ├─ enqueue FileValidation workflow
     └─ enqueue FilePostProcessing workflow
```

The domain-specific entry points:

| Domain | Request | Confirm |
|---|---|---|
| Chat | `ChatFileService.RequestChannelFileUpload` | `ConfirmChannelFileUpload` |
| Tasks | `CollaborationService.RequestTaskFileUpload` | `ConfirmTaskFileUpload` |
| Evidence | `CollaborationService.RequestEvidenceFileUpload` | `ConfirmEvidenceFileUpload` |

Each calls `files.FileLogic` **in process**, not over RPC — that keeps the dependency
Chat → Files rather than Files → Chat → Files, which would be a cycle.

`FileService` itself retains the read/manage surface: `GetDownloadUrl`, `GetFileMetadata`,
`GetFileMetadataBatch`, `ListFiles`, `DeleteFile`, `BatchDeleteFiles`, `SearchFiles`, and
the quota/access/conversion endpoints.

## Metadata and storage keys

`files.file_metadata` — `original_filename`, `storage_key`, `size_bytes`, `mime_type`,
`upload_context`, `uploaded_by_employee_id`, `validation_status`, `detected_mime_type`,
`is_deleted`.

Storage key format: `org-{organization_id}/{upload_context}/{file_id}` — the tenant prefix
is structural, so a misrouted key is visible in the object path.

Deletion is soft (`is_deleted = true`) with the object removed from R2;
`files.file_deletion_log` is an immutable audit trail that deliberately has **no FK** to
`file_metadata` so it survives a hard metadata delete.

Because the delete is soft, `GetFileByID` and therefore `GetFileMetadata` still **succeed**
for a deleted file and return `IsDeleted: true` — a caller that treats a successful lookup
as "this file exists" is wrong. Content reporting learned this the hard way and now checks
the flag explicitly; see [compliance-safety.md](compliance-safety.md).

A file is reportable from the mobile file list row, the mobile file detail screen and the
web files table. Reporting is the compliance domain's; what files owns is the metadata and
the uploader identity it resolves for the report's snapshot.

## Quota

`files.file_quota`, one row per organization:

- `quota_bytes` — NULL means unlimited
- `max_file_size_bytes` — default 100 MB
- `current_usage_bytes` — incremented on upload, decremented on delete, updated atomically
  with row-level locking, so concurrent uploads cannot both slip under the limit

`GetQuota` (`files.viewQuota`) / `UpdateQuota` (`files.updateQuota` — owners only; neither
`operator` nor `employee` has it).

## Validation workflow

`FileValidation` runs on `flows` with concurrency 9:

1. **`validate-file-type/v1`** — downloads the object and checks magic bytes against the
   client-declared MIME type, recording `detected_mime_type`.
2. **`scan-file/v1`** — ClamAV scan over TCP (`internal/files/clamav.go`). **Every file is
   scanned regardless of the type-validation outcome.** A scan *failure* (not a detection)
   is treated as a critical error and fails validation — fail-closed.
3. **`update-validation-status/v1`** — writes the final status.

`validation_status`: `pending`, `verified` (declared type matches), `warning` (mismatch but
allowed), `failed` (validation error), `skipped`, `dangerous` (virus detected).

## Access rules

`files.file_access_rule` binds a file to the context it was uploaded into:

- `context_type IN ('chat_channel','project','department_docs','calendar_event')`
- `access_scope IN ('public','private','department')`

`AccessLogic` resolves a download request by checking the caller's membership of that
context. `CheckFileAccess` exposes the decision; `SetFileAccessRule` changes it
(`files.manageAccess`).

Download URLs are short-lived — the access check happens at `GetDownloadUrl` time, not
at the edge. See *Serving* below for the URL form.

## Serving

Uploads always go straight to the R2 S3 endpoint as presigned PUTs. Downloads have two
shapes, chosen by whether `R2_PUBLIC_URL` is set (`R2Client.GenerateDownloadURL`,
`internal/files/r2client.go`) — both call sites, `GetDownloadUrl` and
`GetPDFDownloadUrl`, sign for one hour:

- **Custom domain (production).** `R2_PUBLIC_URL=https://transformar.file.devguards.com`,
  the domain bound to the `tech-office-prod` bucket. R2 presigned URLs only validate
  against the S3 API host and are ignored by a custom domain, so the domain is guarded by
  Cloudflare WAF token authentication instead. The backend emits
  `https://transformar.file.devguards.com/{storage_key}?verify={unix_ts}-{mac}` where
  `mac = base64(HMAC-SHA256(R2_PUBLIC_URL_HMAC_SECRET, path + unix_ts))`, URL-encoded, and
  a WAF custom rule on the zone blocks anything the same secret does not reproduce:

  ```
  (http.host eq "transformar.file.devguards.com" and not
   is_timed_hmac_valid_v0("<secret>", http.request.uri, 3600, http.request.timestamp.sec, 8))
  ```

  `3600` is the token lifetime and must stay in step with the hour the backend signs for;
  `8` is `len("?verify=")`. `is_timed_hmac_valid_v0()` needs a Cloudflare Pro plan or
  above. The secret is generated by `deploy/scripts/bootstrap.sh` and must be pasted into
  the rule by hand — the backend refuses to start if `R2_PUBLIC_URL` is set without it.

- **No custom domain (default, local dev).** Presigned GET against `R2_ENDPOINT`, as
  before.

Neither form is a bearer token for the whole bucket: the URL is per-object and expires,
and access is still decided by `AccessLogic` before one is minted.

Both hosts are cross-origin to the web app, so the **bucket's CORS policy** is what makes
browser uploads and XHR downloads work at all — a missing policy shows up as a preflight
failure on the presigned PUT (`No 'Access-Control-Allow-Origin' header`), not as a server
error. It is bucket-level configuration in the Cloudflare dashboard, not something this
repository deploys: `AllowedOrigins` the web origins, `AllowedMethods` `GET`/`PUT`/`HEAD`,
`AllowedHeaders` `content-type`, `ExposeHeaders` `ETag`. One policy covers the S3 endpoint
and the custom domain.

## Post-processing

`FilePostProcessing` (also `flows`), two non-blocking steps:

1. **`convert-file-to-pdf/v1`** — Office/other formats → PDF via **Gotenberg**
   (`GOTENBERG_URL`). Tracked in `files.file_pdf_conversion`; status `pending →
   processing → completed | failed`. `GetPDFConversionStatus`, `TriggerPDFConversion`.
2. **`extract-file-content/v1`** — text extraction into `files.file_content_index`
   (`extraction_method IN ('office_parser','pdf_parser','plain_text')`,
   `indexing_status`, `indexing_error`, `indexing_duration_ms`).
   `GetContentIndexStatus`.

### What is read, and how

The step re-reads the file's `detected_mime_type` (falling back to `mime_type`) at
execution time, so eligibility follows what the server found in the bytes rather than what
the client declared at upload. Detection runs in the concurrent validation workflow, so the
step waits up to 15 s for `validation_status` to leave `pending` before deciding, and falls
back to the declared type if it does not.

| Family | Types | Method | How |
|---|---|---|---|
| Plain text | `text/*`, `application/json`, `application/xml` | `plain_text` | read directly |
| PDF | `application/pdf` | `pdf_parser` | `ledongthuc/pdf`, wrapped in a `recover` because the library can panic on malformed input |
| Office | the nine OOXML, legacy binary Office and OpenDocument types | `office_parser` | read from the PDF **step 1 produced**, passed in memory as `ExtractContentInput.PDFStorageKey` |

`office_parser` names the file that was read, not the route it took. Office extraction
therefore inherits conversion's availability: when step 1 skipped or failed, step 2 records
`failed` with reason `office conversion unavailable` rather than reporting success with no
text. Anything not in the table — images, video, audio, archives — is not content-indexed,
and no row is written for it.

Bounds, all in `internal/files/constants.go`: extracted text is whitespace-collapsed and
capped at **1 MiB** (`MaxExtractedTextBytes`, truncated on a rune boundary — a truncated
file is `completed`, not `failed`, and stays findable on the portion kept); the source
object read is capped at **64 MiB** (`MaxSourceReadBytes`, because the PDF reader needs an
`io.ReaderAt` and so the object is buffered); extraction wall clock is capped at **30 s**
(`ExtractionTimeout`, matching `--api-timeout=30s` on the Gotenberg container).

`completed` with empty text is a legitimate terminal state — an empty document, a blank
page, or a scan with no selectable text. There is no OCR; a scanned page yields nothing and
says so. `image_ocr` was removed from the constraint, the constants, the proto enum and the
clients in feature 059, because nothing ever performed it.

### Status, and what it is allowed to say

`GetContentIndexStatus` returns six distinct answers. Four are stored in
`indexing_status`; two are derived at the RPC from the absence of a row and the file's own
type, so no row is written per JPEG:

| Answer | Stored | When |
|---|---|---|
| `PENDING` | yes | queued — written at upload time by `files.EnqueueFilePostProcessing` |
| `IN_PROGRESS` | yes | extracting |
| `COMPLETED` | yes | done; the text may legitimately be empty |
| `FAILED` | yes | `error_message` carries a short, caller-safe reason |
| `NOT_APPLICABLE` | derived | no row, and the detected type is not one we read |
| `NEVER_INDEXED` | derived | no row, but the type is indexable — e.g. uploaded before feature 059 |

`UNSPECIFIED` is unreachable. An unknown `file_id` in the caller's organization returns
`NOT_FOUND`, because the handler loads the file's metadata to answer at all. The response
carries the extraction method, the stored text length, the duration and the last-changed
time; before feature 059 the method and the timestamp were absent from every response.

The reason stored in `indexing_error` is a short mapped phrase — "file too large to
index", "office conversion unavailable", "the document could not be read" — never a
hostname, a credential, a storage key or a stack trace. The full internal error goes to the
worker log only.

### Writes and job outcome

Every write to `files.file_content_index` goes through one `UpsertFileContentIndex` on
`unique_file_index (organization_id, file_id)`. A retry replaces the stored result rather
than adding a second one, and because `indexing_error` passes through `EXCLUDED` rather
than `COALESCE`, a later success clears a previous failure's reason.

All three upload paths — chat, project task and the explicit `TriggerPDFConversion` RPC —
enqueue through `files.EnqueueFilePostProcessing`, which writes the `pending` row and
begins the workflow in the caller's transaction. An upload logs an enqueue failure and
carries on; the explicit trigger surfaces it.

The workflow's `processing_status` is `completed` when no step failed — **including when
every step was legitimately skipped** — `partial` when some failed, and `failed` only when
every applicable step failed. A JPEG that is neither convertible nor indexable is a
completed job. Before feature 059 it was reported as a failed one, on every image upload
in the system.

## Search

`SearchFiles` (`files.search`) matches `original_filename` and extracted content with
PGroonga, backed by `idx_file_metadata_filename_pgroonga` and the content index.
`SearchLogic` resolves the caller's accessible context ids — their chat channels and
department docs contexts — and the query requires the file's `file_access_rule.context_id`
to be one of them, so a file you cannot download never appears in results.

The predicate is unconditional: `far.context_id = ANY(@context_ids)`, with no "unfiltered
if the list is null" escape. It used to have one, and a caller who belonged to no context
at all sent an empty array, which arrives as SQL `NULL` and disabled the filter entirely —
so the person with the least access saw every file in the organization. A caller with no
contexts must match nothing, and a file with no access-rule row has no context and is
likewise unreachable. Found and closed by feature 045's "nothing in the list is a door I
cannot open" scenarios.

The same `SearchFiles` is the `FILE` source of `SearchService.Search`; there is one
implementation of this rule, not two.

## Client surfaces

- Web: `/workspace/files`.
- Mobile: `app/(app)/(more)/files/index.tsx`; evidence capture in
  `src/lib/evidence-media.ts`.
- Clients: `packages/apis/src/files.ts`, `files-security.ts`, `chat-files.ts`.

## Tests

`integration/files_validation_test.go`, `files_access_control_test.go`,
`files_batch_test.go`, `files_search_test.go`, `files_pdf_conversion_test.go`,
`files_content_index_test.go`, `workflow_chat_files_test.go`.

## Known drift

`upload_context` was widened by
`20260830000001_drift_register_fixes.up.sql` to the six values
`internal/files/constants.go` and the code actually write — `chat`, `avatar`, `docs`,
`project`, `calendar`, `voice_transcript`. `voice_transcript` is written by
`internal/voice/transcription.go`; `calendar` is accepted by `IsValidUploadContext` but
nothing in the repo writes it, because the calendar domain stores `evidence_file_ids` /
`file_ids` referencing files uploaded through other contexts.

Note that `context_type` on `files.file_access_rule` is a *different* enum with its own
value set (`chat_channel`, `project`, `department_docs`, `calendar_event`) — do not
conflate the two.

`testWorld.seedFile` in the integration suite seeds against the world's *current*
organisation rather than the uploader's own, so a seed taken after a helper that registers
a new org writes a row the actor does not own. The content-indexing helpers key off
`uploader.OrgID` instead; `seedFile` has not been changed. See D83 in the drift register.
