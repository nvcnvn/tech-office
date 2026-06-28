-- File Storage Security: sqlc Queries
-- Schema: files
-- Feature: 015-file-storage-security-and-access

-- ============================================================================
-- File Access Rule Queries
-- ============================================================================

-- name: InsertFileAccessRule :one
INSERT INTO files.file_access_rule (
    organization_id, file_id, context_type, context_id, access_scope
) VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetFileAccessRule :one
SELECT * FROM files.file_access_rule
WHERE organization_id = $1 AND file_id = $2;

-- name: GetFilesByContext :many
-- Get all files for a specific context (e.g., all files in a chat channel)
SELECT fm.* FROM files.file_metadata fm
JOIN files.file_access_rule far ON (fm.organization_id, fm.id) = (far.organization_id, far.file_id)
WHERE fm.organization_id = $1 
  AND far.context_type = $2
  AND far.context_id = $3
  AND fm.is_deleted = FALSE
ORDER BY fm.updated_at DESC
LIMIT $4 OFFSET $5;

-- name: InsertPDFConversion :one
INSERT INTO files.file_pdf_conversion (
    organization_id, original_file_id, pdf_storage_key,
    pdf_size_bytes, conversion_status
) VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetPDFConversion :one
SELECT * FROM files.file_pdf_conversion
WHERE organization_id = $1 AND original_file_id = $2;

-- name: GetPDFConversionByID :one
SELECT * FROM files.file_pdf_conversion
WHERE organization_id = $1 AND id = $2;

-- name: UpdatePDFConversionStatus :exec
UPDATE files.file_pdf_conversion
SET conversion_status = $3,
  pdf_size_bytes = COALESCE(sqlc.narg('pdf_size_bytes'), pdf_size_bytes),
  conversion_error = sqlc.narg('conversion_error'),
  conversion_duration_ms = sqlc.narg('conversion_duration_ms'),
    updated_at = now()
WHERE organization_id = $1 AND id = $2;

-- name: DeletePDFConversion :exec
DELETE FROM files.file_pdf_conversion
WHERE organization_id = $1 AND original_file_id = $2;

-- ============================================================================
-- Content Indexing Queries
-- ============================================================================

-- name: InsertFileContentIndex :one
INSERT INTO files.file_content_index (
    organization_id, file_id, extracted_text,
    extraction_method, indexing_status
) VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetFileContentIndex :one
SELECT * FROM files.file_content_index
WHERE organization_id = $1 AND file_id = $2;

-- name: GetFileContentIndexByID :one
SELECT * FROM files.file_content_index
WHERE organization_id = $1 AND id = $2;

-- name: UpdateContentIndexStatus :exec
UPDATE files.file_content_index
SET indexing_status = $3,
    indexing_error = sqlc.narg('indexing_error'),
    indexing_duration_ms = sqlc.narg('indexing_duration_ms'),
    updated_at = now()
WHERE organization_id = $1 AND id = $2;

-- name: DeleteFileContentIndex :exec
DELETE FROM files.file_content_index
WHERE organization_id = $1 AND file_id = $2;

-- ============================================================================
-- Full-Text Search Queries (PGroonga)
-- ============================================================================

-- name: SearchFilesByNameAndContent :many
-- Full-text search across file names and indexed content using PGroonga
-- Includes access control filtering via context membership
SELECT 
    fm.id,
    fm.organization_id,
    fm.original_filename,
    fm.storage_key,
    fm.size_bytes,
    fm.mime_type,
    fm.upload_context,
    fm.uploaded_by_employee_id,
    fm.validation_status,
    fm.updated_at,
    far.context_type,
    far.context_id,
    far.access_scope,
    fci.extracted_text,
    -- PGroonga similarity score for ranking
    pgroonga_score(fci.tableoid, fci.ctid) AS relevance_score
FROM files.file_metadata fm
LEFT JOIN files.file_access_rule far ON (fm.organization_id, fm.id) = (far.organization_id, far.file_id)
LEFT JOIN files.file_content_index fci ON (fm.organization_id, fm.id) = (fci.organization_id, fci.file_id)
WHERE fm.organization_id = $1
  AND fm.is_deleted = FALSE
  AND (
    -- Search in filename using PGroonga
    fm.original_filename &@~ $2
    OR
    -- Search in indexed content using PGroonga
    (fci.extracted_text IS NOT NULL AND fci.extracted_text &@~ $2)
  )
  -- Access control: filter by context_ids if provided
  AND (
    sqlc.narg('context_ids')::uuid[] IS NULL 
    OR far.context_id = ANY(sqlc.narg('context_ids')::uuid[])
  )
ORDER BY relevance_score DESC, fm.updated_at DESC
LIMIT $3 OFFSET $4;

-- name: GetEmployeeChannelMemberships :many
SELECT channel_id 
FROM chat.channel_membership
WHERE organization_id = $1 AND employee_id = $2;

-- name: GetEmployeeDepartmentMemberships :many
SELECT department_id
FROM organization.department_member
WHERE organization_id = $1 AND employee_id = $2;
