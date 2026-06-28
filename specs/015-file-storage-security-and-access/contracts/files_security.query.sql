-- File Security and Access Control Queries
-- These queries extend files.query.sql with new operations for validation, access control, search, and conversions

-- ========== File Validation Queries ==========

-- name: UpdateFileValidation :one
UPDATE files.file_metadata
SET 
    validation_status = $3,
    validation_message = $4,
    detected_mime_type = $5,
    updated_at = $6
WHERE organization_id = $1
  AND id = $2
RETURNING *;

-- name: GetFilesWithValidationWarnings :many
SELECT 
    id,
    organization_id,
    original_filename,
    mime_type,
    detected_mime_type,
    validation_status,
    validation_message,
    uploaded_by_employee_id,
    updated_at
FROM files.file_metadata
WHERE organization_id = $1
  AND validation_status IN ('warning', 'failed')
  AND is_deleted = FALSE
ORDER BY updated_at DESC
LIMIT $2
OFFSET $3;

-- ========== Access Control Queries ==========

-- name: InsertFileAccessRule :one
INSERT INTO files.file_access_rule (
    id,
    organization_id,
    file_id,
    context_type,
    context_id,
    access_scope,
    updated_at
) VALUES (
    uuidv7(), $1, $2, $3, $4, $5, $6
)
ON CONFLICT (organization_id, file_id) DO UPDATE
SET 
    context_type = EXCLUDED.context_type,
    context_id = EXCLUDED.context_id,
    access_scope = EXCLUDED.access_scope,
    updated_at = $6
RETURNING *;

-- name: GetFileAccessRule :one
SELECT *
FROM files.file_access_rule
WHERE organization_id = $1
  AND file_id = $2;

-- name: CheckFileAccessWithContext :one
SELECT 
    far.id,
    far.access_scope,
    far.context_type,
    far.context_id,
    fm.uploaded_by_employee_id,
    fm.original_filename
FROM files.file_metadata fm
INNER JOIN files.file_access_rule far ON (fm.organization_id, fm.id) = (far.organization_id, far.file_id)
WHERE fm.organization_id = $1
  AND fm.id = $2
  AND fm.is_deleted = FALSE;

-- name: GetFilesByContext :many
SELECT 
    fm.id,
    fm.original_filename,
    fm.size_bytes,
    fm.mime_type,
    fm.validation_status,
    fm.upload_context,
    fm.uploaded_by_employee_id,
    fm.updated_at,
    far.access_scope
FROM files.file_metadata fm
INNER JOIN files.file_access_rule far ON (fm.organization_id, fm.id) = (far.organization_id, far.file_id)
WHERE fm.organization_id = $1
  AND far.context_type = $2
  AND far.context_id = $3
  AND fm.is_deleted = FALSE
ORDER BY fm.updated_at DESC
LIMIT $4
OFFSET $5;

-- ========== File Search Queries ==========

-- name: SearchFilesByNameAndContent :many
SELECT 
    fm.id,
    fm.original_filename,
    fm.size_bytes,
    fm.mime_type,
    fm.validation_status,
    fm.upload_context,
    fm.uploaded_by_employee_id,
    fm.updated_at,
    far.context_type,
    far.context_id,
    far.access_scope,
    fci.extracted_text,
    -- PGroonga relevance score
    pgroonga_score(fci.extracted_text) AS relevance_score
FROM files.file_metadata fm
LEFT JOIN files.file_content_index fci ON (fm.organization_id, fm.id) = (fci.organization_id, fci.file_id)
LEFT JOIN files.file_access_rule far ON (fm.organization_id, fm.id) = (far.organization_id, far.file_id)
WHERE fm.organization_id = $1
  AND fm.is_deleted = FALSE
  AND (
    -- Filename match (PGroonga fuzzy search)
    fm.original_filename &@~ $2
    -- Content match (only if indexed)
    OR (fci.indexing_status = 'completed' AND fci.extracted_text &@~ $2)
  )
  -- Access control filter (passed as array of context IDs user can access)
  AND (
    -- Public files
    far.access_scope = 'public'
    -- Files in contexts user is member of
    OR far.context_id = ANY(sqlc.arg('accessible_context_ids')::uuid[])
    -- Files uploaded by this user
    OR fm.uploaded_by_employee_id = $3
  )
ORDER BY 
    -- Relevance score for content matches
    COALESCE(pgroonga_score(fci.extracted_text), 0) DESC,
    -- Fallback to updated_at for filename-only matches
    fm.updated_at DESC
LIMIT $4
OFFSET $5;

-- name: CountSearchResults :one
SELECT COUNT(*) AS total
FROM files.file_metadata fm
LEFT JOIN files.file_content_index fci ON (fm.organization_id, fm.id) = (fci.organization_id, fci.file_id)
LEFT JOIN files.file_access_rule far ON (fm.organization_id, fm.id) = (far.organization_id, far.file_id)
WHERE fm.organization_id = $1
  AND fm.is_deleted = FALSE
  AND (
    fm.original_filename &@~ $2
    OR (fci.indexing_status = 'completed' AND fci.extracted_text &@~ $2)
  )
  AND (
    far.access_scope = 'public'
    OR far.context_id = ANY(sqlc.arg('accessible_context_ids')::uuid[])
    OR fm.uploaded_by_employee_id = $3
  );

-- ========== PDF Conversion Queries ==========

-- name: InsertPDFConversion :one
INSERT INTO files.file_pdf_conversion (
    id,
    organization_id,
    original_file_id,
    pdf_storage_key,
    pdf_size_bytes,
    conversion_status,
    conversion_error,
    conversion_duration_ms,
    updated_at
) VALUES (
    uuidv7(), $1, $2, $3, $4, $5, $6, $7, $8
)
ON CONFLICT (organization_id, original_file_id) DO UPDATE
SET 
    pdf_storage_key = EXCLUDED.pdf_storage_key,
    pdf_size_bytes = EXCLUDED.pdf_size_bytes,
    conversion_status = EXCLUDED.conversion_status,
    conversion_error = EXCLUDED.conversion_error,
    conversion_duration_ms = EXCLUDED.conversion_duration_ms,
    updated_at = $8
RETURNING *;

-- name: GetPDFConversion :one
SELECT *
FROM files.file_pdf_conversion
WHERE organization_id = $1
  AND original_file_id = $2;

-- name: UpdatePDFConversionStatus :one
UPDATE files.file_pdf_conversion
SET 
    conversion_status = $3,
    conversion_error = $4,
    conversion_duration_ms = $5,
    updated_at = $6
WHERE organization_id = $1
  AND original_file_id = $2
RETURNING *;

-- name: GetPendingPDFConversions :many
SELECT *
FROM files.file_pdf_conversion
WHERE organization_id = $1
  AND conversion_status IN ('pending', 'in_progress')
ORDER BY updated_at ASC
LIMIT $2;

-- name: GetFailedPDFConversions :many
SELECT 
    fpc.*,
    fm.original_filename,
    fm.mime_type,
    fm.size_bytes
FROM files.file_pdf_conversion fpc
INNER JOIN files.file_metadata fm ON (fpc.organization_id, fpc.original_file_id) = (fm.organization_id, fm.id)
WHERE fpc.organization_id = $1
  AND fpc.conversion_status = 'failed'
ORDER BY fpc.updated_at DESC
LIMIT $2
OFFSET $3;

-- ========== Content Indexing Queries ==========

-- name: InsertFileContentIndex :one
INSERT INTO files.file_content_index (
    id,
    organization_id,
    file_id,
    extracted_text,
    extraction_method,
    indexing_status,
    indexing_error,
    indexing_duration_ms,
    updated_at
) VALUES (
    uuidv7(), $1, $2, $3, $4, $5, $6, $7, $8
)
ON CONFLICT (organization_id, file_id) DO UPDATE
SET 
    extracted_text = EXCLUDED.extracted_text,
    extraction_method = EXCLUDED.extraction_method,
    indexing_status = EXCLUDED.indexing_status,
    indexing_error = EXCLUDED.indexing_error,
    indexing_duration_ms = EXCLUDED.indexing_duration_ms,
    updated_at = $8
RETURNING *;

-- name: GetFileContentIndex :one
SELECT *
FROM files.file_content_index
WHERE organization_id = $1
  AND file_id = $2;

-- name: UpdateContentIndexStatus :one
UPDATE files.file_content_index
SET 
    indexing_status = $3,
    indexing_error = $4,
    indexing_duration_ms = $5,
    updated_at = $6
WHERE organization_id = $1
  AND file_id = $2
RETURNING *;

-- name: GetPendingContentIndexes :many
SELECT 
    fci.*,
    fm.original_filename,
    fm.mime_type,
    fm.size_bytes,
    fm.storage_key
FROM files.file_content_index fci
INNER JOIN files.file_metadata fm ON (fci.organization_id, fci.file_id) = (fm.organization_id, fm.id)
WHERE fci.organization_id = $1
  AND fci.indexing_status IN ('pending', 'in_progress')
ORDER BY fci.updated_at ASC
LIMIT $2;

-- name: GetFailedContentIndexes :many
SELECT 
    fci.*,
    fm.original_filename,
    fm.mime_type,
    fm.size_bytes
FROM files.file_content_index fci
INNER JOIN files.file_metadata fm ON (fci.organization_id, fci.file_id) = (fm.organization_id, fm.id)
WHERE fci.organization_id = $1
  AND fci.indexing_status = 'failed'
ORDER BY fci.updated_at DESC
LIMIT $2
OFFSET $3;

-- ========== Cleanup Queries ==========

-- name: DeleteFileAccessRule :exec
DELETE FROM files.file_access_rule
WHERE organization_id = $1
  AND file_id = $2;

-- name: DeletePDFConversion :exec
DELETE FROM files.file_pdf_conversion
WHERE organization_id = $1
  AND original_file_id = $2;

-- name: DeleteContentIndex :exec
DELETE FROM files.file_content_index
WHERE organization_id = $1
  AND file_id = $2;

-- ========== Statistics Queries ==========

-- name: GetFileValidationStats :one
SELECT 
    COUNT(*) AS total_files,
    COUNT(*) FILTER (WHERE validation_status = 'verified') AS verified_count,
    COUNT(*) FILTER (WHERE validation_status = 'warning') AS warning_count,
    COUNT(*) FILTER (WHERE validation_status = 'failed') AS failed_count,
    COUNT(*) FILTER (WHERE validation_status = 'skipped') AS skipped_count
FROM files.file_metadata
WHERE organization_id = $1
  AND is_deleted = FALSE;

-- name: GetPDFConversionStats :one
SELECT 
    COUNT(*) AS total_conversions,
    COUNT(*) FILTER (WHERE conversion_status = 'completed') AS completed_count,
    COUNT(*) FILTER (WHERE conversion_status = 'failed') AS failed_count,
    COUNT(*) FILTER (WHERE conversion_status = 'pending') AS pending_count,
    AVG(conversion_duration_ms) FILTER (WHERE conversion_status = 'completed') AS avg_duration_ms
FROM files.file_pdf_conversion
WHERE organization_id = $1;

-- name: GetContentIndexStats :one
SELECT 
    COUNT(*) AS total_indexes,
    COUNT(*) FILTER (WHERE indexing_status = 'completed') AS completed_count,
    COUNT(*) FILTER (WHERE indexing_status = 'failed') AS failed_count,
    COUNT(*) FILTER (WHERE indexing_status = 'pending') AS pending_count,
    AVG(indexing_duration_ms) FILTER (WHERE indexing_status = 'completed') AS avg_duration_ms,
    SUM(LENGTH(extracted_text)) FILTER (WHERE indexing_status = 'completed') AS total_indexed_bytes
FROM files.file_content_index
WHERE organization_id = $1;
