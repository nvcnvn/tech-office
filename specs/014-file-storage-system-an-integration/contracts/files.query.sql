-- File Storage System: sqlc Queries
-- Schema: files
-- Feature: 014-file-storage-system-an-integration

-- ============================================================================
-- File Metadata Queries
-- ============================================================================

-- name: CreateFileMetadata :one
INSERT INTO files.file_metadata (
    id, organization_id, original_filename, storage_key,
    size_bytes, mime_type, upload_context, uploaded_by_employee_id
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: GetFileByID :one
SELECT * FROM files.file_metadata
WHERE organization_id = $1 AND id = $2;

-- name: GetActiveFileByID :one
SELECT * FROM files.file_metadata
WHERE organization_id = $1 AND id = $2 AND is_deleted = FALSE;

-- name: ListFilesByContext :many
SELECT * FROM files.file_metadata
WHERE organization_id = $1 
  AND upload_context = sqlc.narg('context')
  AND is_deleted = FALSE
ORDER BY 
  CASE WHEN sqlc.narg('sort_by') = 'size' THEN size_bytes END DESC,
  CASE WHEN sqlc.narg('sort_by') = 'size' THEN size_bytes END ASC,
  updated_at DESC
LIMIT $2 OFFSET $3;

-- name: CountFilesByContext :one
SELECT COUNT(*) FROM files.file_metadata
WHERE organization_id = $1 
  AND (sqlc.narg('context')::text IS NULL OR upload_context = sqlc.narg('context'))
  AND is_deleted = FALSE;

-- name: ListFilesByUploader :many
SELECT * FROM files.file_metadata
WHERE organization_id = $1 
  AND uploaded_by_employee_id = $2 
  AND is_deleted = FALSE
ORDER BY updated_at DESC
LIMIT $3 OFFSET $4;

-- name: SoftDeleteFile :exec
UPDATE files.file_metadata
SET is_deleted = TRUE, updated_at = now()
WHERE organization_id = $1 AND id = $2;

-- name: BatchSoftDeleteFiles :exec
UPDATE files.file_metadata
SET is_deleted = TRUE, updated_at = now()
WHERE organization_id = $1 AND id = ANY($2::uuid[]);

-- name: GetFileSizeByID :one
SELECT size_bytes FROM files.file_metadata
WHERE organization_id = $1 AND id = $2;

-- name: GetFileSizesByIDs :many
SELECT id, size_bytes FROM files.file_metadata
WHERE organization_id = $1 AND id = ANY($2::uuid[]);

-- ============================================================================
-- Quota Queries
-- ============================================================================

-- name: GetOrCreateQuota :one
INSERT INTO files.file_quota (organization_id)
VALUES ($1)
ON CONFLICT (organization_id) DO UPDATE
SET updated_at = now()
RETURNING *;

-- name: GetQuota :one
SELECT * FROM files.file_quota
WHERE organization_id = $1;

-- name: GetQuotaForUpdate :one
-- Locks quota row for atomic check-and-increment
SELECT * FROM files.file_quota
WHERE organization_id = $1
FOR UPDATE;

-- name: IncrementQuotaUsage :exec
UPDATE files.file_quota
SET current_usage_bytes = current_usage_bytes + $2,
    updated_at = now()
WHERE organization_id = $1;

-- name: DecrementQuotaUsage :exec
UPDATE files.file_quota
SET current_usage_bytes = GREATEST(current_usage_bytes - $2, 0),
    updated_at = now()
WHERE organization_id = $1;

-- name: UpdateQuotaLimits :exec
UPDATE files.file_quota
SET quota_bytes = sqlc.narg('quota_bytes'),
    max_file_size_bytes = sqlc.narg('max_file_size_bytes'),
    updated_at = now()
WHERE organization_id = $1;

-- ============================================================================
-- Deletion Log Queries
-- ============================================================================

-- name: CreateDeletionLog :one
INSERT INTO files.file_deletion_log (
    organization_id, file_id, original_filename,
    deleted_by_employee_id, deletion_reason
) VALUES ($1, $2, $3, $4, sqlc.narg('deletion_reason'))
RETURNING *;

-- name: GetDeletionLogByFileID :one
SELECT * FROM files.file_deletion_log
WHERE organization_id = $1 AND file_id = $2
ORDER BY deleted_at DESC
LIMIT 1;

-- name: ListDeletionsByDeleter :many
SELECT * FROM files.file_deletion_log
WHERE organization_id = $1 AND deleted_by_employee_id = $2
ORDER BY deleted_at DESC
LIMIT $3 OFFSET $4;

-- name: GetDeletionLogWithDeleterName :one
SELECT 
    fdl.*,
    e.given_name || ' ' || e.family_name AS deleter_name
FROM files.file_deletion_log fdl
JOIN organization.employee e ON (fdl.organization_id, fdl.deleted_by_employee_id) = (e.organization_id, e.id)
WHERE fdl.organization_id = $1 AND fdl.file_id = $2
ORDER BY fdl.deleted_at DESC
LIMIT 1;
