# File Storage

Binary storage on Cloudflare R2 with per-org quota, virus scanning, MIME validation,
context-scoped access rules, PDF conversion and content indexing. Owned by
`internal/files`; contract in `rpc/v1/files.proto` (`FileService`, 15 RPCs).

**Status date: 2026-08-22.** Supersedes specs 014, 015.

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

- `context_type IN ('chat_channel','project','department_docs','calendar_event','support_ticket','crm_deal')`
- `access_scope IN ('public','private','department')`

`AccessLogic` resolves a download request by checking the caller's membership of that
context. `CheckFileAccess` exposes the decision; `SetFileAccessRule` changes it
(`files.manageAccess`).

Download URLs are presigned and short-lived — the access check happens at
`GetDownloadUrl` time, not at R2.

## Post-processing

`FilePostProcessing` (also `flows`), two non-blocking steps:

1. **`convert-file-to-pdf/v1`** — Office/other formats → PDF via **Gotenberg**
   (`GOTENBERG_URL`). Tracked in `files.file_pdf_conversion`; status `pending →
   processing → completed | failed`. `GetPDFConversionStatus`, `TriggerPDFConversion`.
2. **`extract-content/v1`** — text extraction into `files.file_content_index`
   (`extraction_method IN ('office_parser','pdf_parser','image_ocr','plain_text')`,
   `indexing_status`, `indexing_duration_ms`). `GetContentIndexStatus`.

The `cmd/server.go` comment notes the post-processing workflow is partly a skeleton; it is
registered so runs execute if enqueued.

## Search

`SearchFiles` (`files.search`) searches filenames and extracted content with access control
applied — `SearchLogic` filters by the caller's context membership before returning hits,
so a file you cannot download never appears in results.

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

**D1 — `upload_context` is out of sync across three layers.**

| Layer | Accepted values |
|---|---|
| DB CHECK (`schema.sql` and the init migration, never widened) | `chat`, `avatar`, `docs`, `project` |
| `internal/files/constants.go` (`IsValidUploadContext`) | `chat`, `avatar`, `docs`, `project`, **`calendar`** |
| actually written by code | the four, plus **`voice_transcript`** (`internal/voice/transcription.go:132`) |

Two consequences:

- Voice transcripts fail to persist — see [voice.md](voice.md#known-drift).
- A client passing `upload_context: "calendar"` to `FileService` passes application
  validation and then hits a constraint violation. `UploadContextCalendar` is otherwise
  dead: nothing in the repo writes it, and the calendar domain stores
  `evidence_file_ids` / `file_ids` referencing files uploaded through other contexts.

The fix is one migration widening the CHECK to match `ValidUploadContexts()` **plus**
`voice_transcript`, and a `files_validation_test.go` case asserting every value in
`ValidUploadContexts()` actually inserts. Note that `context_type` on
`files.file_access_rule` is a *different* enum and is already broader
(`calendar_event`, `support_ticket`, `crm_deal`) — do not conflate the two.
