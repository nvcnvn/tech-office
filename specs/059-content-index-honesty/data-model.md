# Phase 1 Data Model: File content search that actually searches content

**Feature**: 059-content-index-honesty | **Date**: 2026-09-12

This feature adds **no table and no column**. Every entity below already exists; what
changes is a narrowed constraint, an upsert, and the fact that rows are written at all.

## Entities

### `files.file_content_index` — the file content index

One row per file, keyed `(organization_id, file_id)` by `unique_file_index`. Today the
table is empty in every environment because nothing has ever written to it.

| Column | Type | Change | Notes |
|---|---|---|---|
| `id` | `UUID` default `uuidv7()` | — | part of `PRIMARY KEY (organization_id, id)` |
| `organization_id` | `UUID` NOT NULL | — | tenancy first, per principle I |
| `file_id` | `UUID` NOT NULL | — | composite FK to `files.file_metadata`, `ON DELETE CASCADE` |
| `extracted_text` | `TEXT` NOT NULL | — | now actually populated; capped at 1 MiB; whitespace-collapsed |
| `extraction_method` | `TEXT` NOT NULL | **CHECK narrowed** | `('office_parser','pdf_parser','plain_text')` — `image_ocr` removed |
| `indexing_status` | `TEXT` NOT NULL | — | `('pending','in_progress','completed','failed')`, unchanged |
| `indexing_error` | `TEXT` NULL | — | short, caller-safe reason; cleared to NULL on a later success |
| `indexing_duration_ms` | `INTEGER` NULL | — | extraction wall clock |
| `updated_at` | `TIMESTAMPTZ` NOT NULL default `now()` | — | the "last changed" time FR-017 says is currently always absent |

Indexes are unchanged: `idx_file_content_file`, the partial
`idx_file_content_status` on in-flight rows, and `idx_file_content_pgroonga` over
`extracted_text`, which is the multilingual matcher FR-012 reuses.

**Lifecycle.**

```
            upload confirmed, declared type indexable
                          │
                          ▼
                      pending ─────────────────────────────┐ detected type
                          │ step starts                    │ NOT indexable
                          ▼                                ▼
                    in_progress ──── extraction ok ──► completed   row deleted
                          │                                        (status derives
                          └──────── extraction failed ──► failed     to NOT_APPLICABLE)
```

`completed` with `extracted_text = ''` is a legitimate terminal state: an empty document,
a blank PDF, or a scanned PDF with no selectable text. It is not `failed`.

Re-running the job re-enters `in_progress` and re-terminates. Because every write is the
same upsert on `unique_file_index`, a retry replaces the row rather than adding one, and a
success writes `indexing_error = NULL` over a previous failure's reason (FR-009).

### `files.file_metadata` — read-only here

The extraction step reads `detected_mime_type` (falling back to `mime_type`), `storage_key`
and `is_deleted`. It never writes to this table. `GetFileByID` already returns everything
needed.

### `files.file_access_rule` — untouched, and sole authority on visibility

Content matching adds no route to a file. The search query's
`AND far.context_id = ANY(@context_ids::uuid[])` is unconditional and stays that way; a
file with no access-rule row stays unreachable no matter what its content says (FR-013).

### `files.file_pdf_conversion` — read as an input

Step 2 consumes step 1's `pdf_storage_key` in-memory from the step output rather than
re-reading this table. The table remains step 1's record.

## Value sets changed

### Extraction method

| Value | Meaning | Status |
|---|---|---|
| `plain_text` | direct read of a text/\*, JSON or XML object | kept |
| `pdf_parser` | PDF read with `ledongthuc/pdf` | kept |
| `office_parser` | office document read *via* its converted PDF | kept — the name describes the file that was read, not the route |
| `image_ocr` | — | **removed** from constraint, constants, proto, clients and comments |

### Indexing status, as reported on the wire

The four stored values are unchanged. Two wire-only values are added, derived at the RPC
from the presence of a row and the file's own MIME type (see research Decision 4):

| Wire value | Stored? | When |
|---|---|---|
| `INDEXING_STATUS_PENDING` | yes | row `pending` — queued |
| `INDEXING_STATUS_IN_PROGRESS` | yes | row `in_progress` — extracting |
| `INDEXING_STATUS_COMPLETED` | yes | row `completed` |
| `INDEXING_STATUS_FAILED` | yes | row `failed` |
| `INDEXING_STATUS_NOT_APPLICABLE` | **derived** | no row, file type is never content-indexed |
| `INDEXING_STATUS_NEVER_INDEXED` | **derived** | no row, file type is indexable — e.g. uploaded before this feature shipped |
| `INDEXING_STATUS_UNSPECIFIED` | — | now unreachable; today it is the answer 100% of the time |

## Migration

One forward-only migration, `20260912000001_drop_image_ocr_extraction_method.up.sql`:
drop and recreate the CHECK constraint without `image_ocr`, and rewrite the column comment
so it stops naming a method the system does not perform (SC-006). No data migration — no
row has ever been written, so nothing can violate the narrower constraint.

Followed by `backend/scripts/regen-schema.sh` and `sqlc generate`; `schema.sql` is a
generated snapshot and is never hand-edited.

## Bounds

| Bound | Value | Enforced where |
|---|---|---|
| Stored text | 1 MiB, truncated at a rune boundary | extraction step, before the upsert |
| Source object read | 64 MiB | `io.LimitReader` around the R2 body |
| Extraction wall clock | 30 s | `context.WithTimeout` inside the step |

Truncation is not a failure: the row is `completed`, `text_length` reports what was stored,
and the file stays findable on the portion kept (FR-007).
