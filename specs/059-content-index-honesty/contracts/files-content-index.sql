-- Contract delta for feature 059-content-index-honesty: database and sqlc surface.
-- NOT applied from this file. See plan.md for where each piece lands.

-- ===========================================================================
-- MIGRATION (new, forward-only)
-- backend/database/migrations/20260912000001_drop_image_ocr_extraction_method.up.sql
--
-- FR-005 / SC-006. Safe without a data migration: no row has ever been written to
-- files.file_content_index, so nothing can violate the narrower constraint.
-- ===========================================================================

ALTER TABLE files.file_content_index
    DROP CONSTRAINT file_content_index_extraction_method_check;

ALTER TABLE files.file_content_index
    ADD CONSTRAINT file_content_index_extraction_method_check
    CHECK (extraction_method IN ('office_parser', 'pdf_parser', 'plain_text'));

COMMENT ON COLUMN files.file_content_index.extraction_method IS
'Method used to extract text: office_parser (word processor, spreadsheet and presentation
formats, read via their Gotenberg-converted PDF), pdf_parser (PDF), plain_text (text/*,
JSON, XML). MUST align with backend constants in internal/files/constants.go.';

-- Then: backend/scripts/regen-schema.sh && sqlc generate

-- ===========================================================================
-- QUERY CHANGE
-- backend/database/scripts/files_security.query.sql
--
-- FR-009: one row per file under retry, and a success clears a previous failure's
-- reason. Same reasoning as InsertPDFConversion three queries above: DO UPDATE rather
-- than DO NOTHING, because a :one query must return a row.
-- ===========================================================================

-- name: UpsertFileContentIndex :one
INSERT INTO files.file_content_index (
    organization_id, file_id, extracted_text,
    extraction_method, indexing_status, indexing_error, indexing_duration_ms
) VALUES ($1, $2, $3, $4, $5, sqlc.narg('indexing_error'), sqlc.narg('indexing_duration_ms'))
ON CONFLICT (organization_id, file_id) DO UPDATE
    SET extracted_text       = EXCLUDED.extracted_text,
        extraction_method    = EXCLUDED.extraction_method,
        indexing_status      = EXCLUDED.indexing_status,
        indexing_error       = EXCLUDED.indexing_error,
        indexing_duration_ms = EXCLUDED.indexing_duration_ms,
        updated_at           = now()
RETURNING *;

-- Replaces InsertFileContentIndex and UpdateContentIndexStatus, both of which are
-- deleted: the step only ever needs "write the current state of this file's index".
-- GetFileContentIndexByID goes with them — nothing reads a content index by its own id
-- once the update-then-refetch dance is gone.
--
-- UNCHANGED and deliberately so: SearchFilesByNameAndContent. It already matches
-- fci.extracted_text with &@~ and already binds visibility to
-- far.context_id = ANY(@context_ids::uuid[]) with no "unfiltered if null" escape.
-- FR-012, FR-013 and FR-014 are satisfied by that query the moment rows exist.
-- Touching it is how this feature would leak access, so it is not touched.
