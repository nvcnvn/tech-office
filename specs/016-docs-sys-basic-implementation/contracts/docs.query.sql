-- ============================================================================
-- Document Management System - sqlc Queries
-- Follows Citus sharding constraints: organization_id first in all keys
-- ============================================================================

-- ============================================================================
-- DOCUMENT CRUD OPERATIONS
-- ============================================================================

-- name: CreateDocument :one
INSERT INTO docs.document (
    id, organization_id, title, slug, parent_document_id, depth, 
    content_json, status, visibility, owner_employee_id, path
)
VALUES (
    @id, @organization_id, @title, @slug, sqlc.narg('parent_document_id'), 
    @depth, @content_json, @status, @visibility, @owner_employee_id, @path
)
RETURNING *;

-- name: GetDocumentByID :one
SELECT * FROM docs.document
WHERE organization_id = @organization_id AND id = @id AND is_deleted = FALSE;

-- name: GetDocumentBySlug :one
SELECT * FROM docs.document
WHERE organization_id = @organization_id AND slug = @slug AND is_deleted = FALSE;

-- name: UpdateDocument :one
UPDATE docs.document
SET 
    title = @title,
    slug = @slug,
    content_json = @content_json,
    search_text = @search_text,
    version_count = version_count + 1,
    updated_at = @updated_at
WHERE organization_id = @organization_id AND id = @id AND is_deleted = FALSE
RETURNING *;

-- name: UpdateDocumentStatus :one
UPDATE docs.document
SET status = @status, updated_at = @updated_at
WHERE organization_id = @organization_id AND id = @id AND is_deleted = FALSE
RETURNING *;

-- name: SoftDeleteDocument :exec
UPDATE docs.document
SET is_deleted = TRUE, updated_at = @updated_at
WHERE organization_id = @organization_id AND id = @id;

-- name: ListRootDocuments :many
SELECT * FROM docs.document
WHERE organization_id = @organization_id 
  AND parent_document_id IS NULL 
  AND is_deleted = FALSE
  AND (sqlc.narg('status')::text IS NULL OR status = sqlc.narg('status'))
  AND (sqlc.narg('cursor')::uuid IS NULL OR id < sqlc.narg('cursor'))
ORDER BY id DESC
LIMIT @doc_limit;

-- name: ListChildDocuments :many
SELECT * FROM docs.document
WHERE organization_id = @organization_id 
  AND parent_document_id = @parent_document_id
  AND is_deleted = FALSE
  AND (sqlc.narg('status')::text IS NULL OR status = sqlc.narg('status'))
  AND (sqlc.narg('cursor')::uuid IS NULL OR id < sqlc.narg('cursor'))
ORDER BY id DESC
LIMIT @doc_limit;

-- name: GetDocumentTree :many
-- Recursive CTE to fetch document tree up to max_depth
WITH RECURSIVE doc_tree AS (
    -- Base: root or specified root
    SELECT d.*, 0 AS tree_depth
    FROM docs.document d
    WHERE d.organization_id = @organization_id
      AND d.is_deleted = FALSE
      AND (
          (sqlc.narg('root_id')::uuid IS NULL AND d.parent_document_id IS NULL)
          OR d.id = sqlc.narg('root_id')
      )
    
    UNION ALL
    
    -- Recursive: children
    SELECT c.*, dt.tree_depth + 1
    FROM docs.document c
    JOIN doc_tree dt ON c.parent_document_id = dt.id 
        AND c.organization_id = dt.organization_id
    WHERE c.is_deleted = FALSE
      AND dt.tree_depth < @max_depth
)
SELECT * FROM doc_tree ORDER BY depth, title;

-- name: IncrementChildCount :exec
UPDATE docs.document
SET child_count = child_count + 1, updated_at = @updated_at
WHERE organization_id = @organization_id AND id = @id;

-- name: DecrementChildCount :exec
UPDATE docs.document
SET child_count = GREATEST(0, child_count - 1), updated_at = @updated_at
WHERE organization_id = @organization_id AND id = @id;

-- name: CountOrphanedChildren :one
SELECT COUNT(*) FROM docs.document
WHERE organization_id = @organization_id 
  AND parent_document_id = @parent_document_id
  AND is_deleted = FALSE;

-- name: OrphanChildren :execrows
-- When parent is deleted, children become root documents
UPDATE docs.document
SET parent_document_id = NULL, depth = 0, path = ARRAY[]::uuid[], updated_at = @updated_at
WHERE organization_id = @organization_id AND parent_document_id = @parent_id AND is_deleted = FALSE;

-- ============================================================================
-- SLUG HISTORY (for redirects)
-- ============================================================================

-- name: CreateSlugHistory :exec
INSERT INTO docs.document_slug_history (id, organization_id, document_id, old_slug)
VALUES (@id, @organization_id, @document_id, @old_slug);

-- name: ResolveOldSlug :one
SELECT document_id FROM docs.document_slug_history
WHERE organization_id = @organization_id AND old_slug = @old_slug;

-- ============================================================================
-- VERSION HISTORY
-- ============================================================================

-- name: CreateVersion :one
INSERT INTO docs.document_version (
    id, organization_id, document_id, version_number, 
    content_json, author_employee_id, summary
)
VALUES (
    @id, @organization_id, @document_id, @version_number,
    @content_json, @author_employee_id, sqlc.narg('summary')
)
RETURNING *;

-- name: GetVersion :one
SELECT v.*, e.given_name || ' ' || e.family_name AS author_name
FROM docs.document_version v
JOIN organization.employee e ON (e.organization_id, e.id) = (v.organization_id, v.author_employee_id)
WHERE v.organization_id = @organization_id 
  AND v.document_id = @document_id 
  AND v.version_number = @version_number;

-- name: GetLatestVersionNumber :one
SELECT COALESCE(MAX(version_number), 0) AS latest_version
FROM docs.document_version
WHERE organization_id = @organization_id AND document_id = @document_id;

-- name: ListVersions :many
SELECT v.*, e.given_name || ' ' || e.family_name AS author_name
FROM docs.document_version v
JOIN organization.employee e ON (e.organization_id, e.id) = (v.organization_id, v.author_employee_id)
WHERE v.organization_id = @organization_id AND v.document_id = @document_id
  AND (sqlc.narg('cursor')::int IS NULL OR v.version_number < sqlc.narg('cursor'))
ORDER BY v.version_number DESC
LIMIT @version_limit;

-- name: GetVersionRange :many
-- For computing diffs between versions
SELECT v.*, e.given_name || ' ' || e.family_name AS author_name
FROM docs.document_version v
JOIN organization.employee e ON (e.organization_id, e.id) = (v.organization_id, v.author_employee_id)
WHERE v.organization_id = @organization_id 
  AND v.document_id = @document_id
  AND v.version_number >= @from_version
  AND v.version_number <= @to_version
ORDER BY v.version_number ASC;

-- ============================================================================
-- ACCESS CONTROL
-- ============================================================================

-- name: SetDocumentAccess :one
INSERT INTO docs.document_access (
    id, organization_id, document_id, grantee_type, 
    grantee_id, access_level, granted_by_employee_id
)
VALUES (
    @id, @organization_id, @document_id, @grantee_type,
    @grantee_id, @access_level, @granted_by_employee_id
)
ON CONFLICT (organization_id, document_id, grantee_type, grantee_id) 
DO UPDATE SET 
    access_level = EXCLUDED.access_level,
    granted_by_employee_id = EXCLUDED.granted_by_employee_id,
    updated_at = @updated_at
RETURNING *;

-- name: RemoveDocumentAccess :exec
DELETE FROM docs.document_access
WHERE organization_id = @organization_id 
  AND document_id = @document_id
  AND grantee_type = @grantee_type
  AND grantee_id = @grantee_id;

-- name: ListDocumentAccess :many
SELECT 
    a.*,
    CASE 
        WHEN a.grantee_type = 'employee' THEN e.given_name || ' ' || e.family_name
        WHEN a.grantee_type = 'department' THEN d.name
    END AS grantee_name,
    g.given_name || ' ' || g.family_name AS granted_by_name
FROM docs.document_access a
LEFT JOIN organization.employee e ON a.grantee_type = 'employee' 
    AND (e.organization_id, e.id) = (a.organization_id, a.grantee_id)
LEFT JOIN organization.department d ON a.grantee_type = 'department'
    AND (d.organization_id, d.id) = (a.organization_id, a.grantee_id)
JOIN organization.employee g ON (g.organization_id, g.id) = (a.organization_id, a.granted_by_employee_id)
WHERE a.organization_id = @organization_id AND a.document_id = @document_id;

-- name: GetEmployeeDocumentAccess :one
-- Check direct employee access
SELECT access_level FROM docs.document_access
WHERE organization_id = @organization_id 
  AND document_id = @document_id
  AND grantee_type = 'employee'
  AND grantee_id = @employee_id;

-- name: GetDepartmentDocumentAccess :many
-- Check department-based access for an employee
SELECT a.access_level
FROM docs.document_access a
JOIN organization.department_member dm ON (dm.organization_id, dm.department_id) = (a.organization_id, a.grantee_id)
WHERE a.organization_id = @organization_id
  AND a.document_id = @document_id
  AND a.grantee_type = 'department'
  AND dm.employee_id = @employee_id;

-- name: GetDocumentWithAncestors :many
-- Get document and all ancestors for permission inheritance check
SELECT d.id, d.visibility, d.owner_employee_id, d.parent_document_id
FROM docs.document d
WHERE d.organization_id = @organization_id 
  AND (d.id = @document_id OR d.id = ANY(@ancestor_ids::uuid[]))
  AND d.is_deleted = FALSE;

-- ============================================================================
-- FOLLOWERS
-- ============================================================================

-- name: FollowDocument :exec
INSERT INTO docs.document_follower (id, organization_id, document_id, employee_id)
VALUES (@id, @organization_id, @document_id, @employee_id)
ON CONFLICT (organization_id, document_id, employee_id) DO NOTHING;

-- name: UnfollowDocument :exec
DELETE FROM docs.document_follower
WHERE organization_id = @organization_id 
  AND document_id = @document_id 
  AND employee_id = @employee_id;

-- name: IncrementFollowerCount :exec
UPDATE docs.document
SET follower_count = follower_count + 1, updated_at = @updated_at
WHERE organization_id = @organization_id AND id = @id;

-- name: DecrementFollowerCount :exec
UPDATE docs.document
SET follower_count = GREATEST(0, follower_count - 1), updated_at = @updated_at
WHERE organization_id = @organization_id AND id = @id;

-- name: IsFollowing :one
SELECT EXISTS(
    SELECT 1 FROM docs.document_follower
    WHERE organization_id = @organization_id 
      AND document_id = @document_id 
      AND employee_id = @employee_id
) AS is_following;

-- name: ListFollowedDocuments :many
SELECT d.*
FROM docs.document d
JOIN docs.document_follower f ON (d.organization_id, d.id) = (f.organization_id, f.document_id)
WHERE f.organization_id = @organization_id 
  AND f.employee_id = @employee_id
  AND d.is_deleted = FALSE
  AND (sqlc.narg('cursor')::uuid IS NULL OR d.id < sqlc.narg('cursor'))
ORDER BY d.id DESC
LIMIT @doc_limit;

-- name: GetDocumentFollowers :many
-- Get all followers for notification delivery
SELECT f.employee_id
FROM docs.document_follower f
WHERE f.organization_id = @organization_id AND f.document_id = @document_id;

-- ============================================================================
-- COMMENTS
-- ============================================================================

-- name: CreateComment :one
INSERT INTO docs.comment (
    id, organization_id, document_id, block_id,
    text_selection_start, text_selection_end, 
    comment_text, author_employee_id
)
VALUES (
    @id, @organization_id, @document_id, @block_id,
    sqlc.narg('text_selection_start'), sqlc.narg('text_selection_end'),
    @comment_text, @author_employee_id
)
RETURNING *;

-- name: CreateCommentReply :one
INSERT INTO docs.comment_reply (
    id, organization_id, comment_id, reply_text, author_employee_id
)
VALUES (@id, @organization_id, @comment_id, @reply_text, @author_employee_id)
RETURNING *;

-- name: IncrementCommentReplyCount :exec
UPDATE docs.comment
SET reply_count = reply_count + 1, updated_at = @updated_at
WHERE organization_id = @organization_id AND id = @id;

-- name: ResolveComment :one
UPDATE docs.comment
SET is_resolved = TRUE, resolved_by_employee_id = @resolved_by, resolved_at = @resolved_at, updated_at = @updated_at
WHERE organization_id = @organization_id AND id = @id
RETURNING *;

-- name: DeleteComment :exec
UPDATE docs.comment
SET is_deleted = TRUE, updated_at = @updated_at
WHERE organization_id = @organization_id AND id = @id;

-- name: ListDocumentComments :many
SELECT 
    c.*,
    e.given_name || ' ' || e.family_name AS author_name,
    r.given_name || ' ' || r.family_name AS resolved_by_name
FROM docs.comment c
JOIN organization.employee e ON (e.organization_id, e.id) = (c.organization_id, c.author_employee_id)
LEFT JOIN organization.employee r ON c.is_resolved AND (r.organization_id, r.id) = (c.organization_id, c.resolved_by_employee_id)
WHERE c.organization_id = @organization_id 
  AND c.document_id = @document_id
  AND c.is_deleted = FALSE
  AND (@include_resolved OR c.is_resolved = FALSE)
ORDER BY c.updated_at DESC;

-- name: ListCommentReplies :many
SELECT 
    r.*,
    e.given_name || ' ' || e.family_name AS author_name
FROM docs.comment_reply r
JOIN organization.employee e ON (e.organization_id, e.id) = (r.organization_id, r.author_employee_id)
WHERE r.organization_id = @organization_id AND r.comment_id = @comment_id
ORDER BY r.updated_at ASC;

-- name: GetCommentDocumentID :one
SELECT document_id FROM docs.comment
WHERE organization_id = @organization_id AND id = @id;

-- ============================================================================
-- SECTION EMBEDS
-- ============================================================================

-- name: CreateSectionEmbed :one
INSERT INTO docs.section_embed (
    id, organization_id, source_document_id, source_block_id,
    target_document_id, target_start_block_id, target_end_block_id
)
VALUES (
    @id, @organization_id, @source_document_id, @source_block_id,
    @target_document_id, @target_start_block_id, @target_end_block_id
)
RETURNING *;

-- name: GetSectionEmbed :one
SELECT e.*, d.title AS target_document_title, d.status AS target_status
FROM docs.section_embed e
JOIN docs.document d ON (d.organization_id, d.id) = (e.organization_id, e.target_document_id)
WHERE e.organization_id = @organization_id AND e.id = @id;

-- name: ListDocumentEmbeds :many
SELECT e.*, d.title AS target_document_title, d.status AS target_status
FROM docs.section_embed e
JOIN docs.document d ON (d.organization_id, d.id) = (e.organization_id, e.target_document_id)
WHERE e.organization_id = @organization_id AND e.source_document_id = @source_document_id;

-- name: DeleteSectionEmbed :exec
DELETE FROM docs.section_embed
WHERE organization_id = @organization_id AND id = @id;

-- name: GetEmbeddedContent :one
-- Get the target document's content for rendering embedded section
SELECT content_json, status FROM docs.document
WHERE organization_id = @organization_id AND id = @id AND is_deleted = FALSE;

-- ============================================================================
-- ACTIVE EDITORS (UNLOGGED table for collaborative editing)
-- ============================================================================

-- name: JoinDocumentAsEditor :exec
INSERT INTO docs.document_editor (
    organization_id, document_id, employee_id, connection_id, 
    cursor_block_id, cursor_offset, color
)
VALUES (
    @organization_id, @document_id, @employee_id, @connection_id,
    sqlc.narg('cursor_block_id'), 0, @color
)
ON CONFLICT (organization_id, document_id, employee_id) 
DO UPDATE SET 
    connection_id = EXCLUDED.connection_id,
    connected_at = now(),
    last_heartbeat = now();

-- name: LeaveDocument :exec
DELETE FROM docs.document_editor
WHERE organization_id = @organization_id 
  AND document_id = @document_id 
  AND employee_id = @employee_id;

-- name: UpdateEditorCursor :exec
UPDATE docs.document_editor
SET cursor_block_id = @cursor_block_id, cursor_offset = @cursor_offset, last_heartbeat = now()
WHERE organization_id = @organization_id 
  AND document_id = @document_id 
  AND employee_id = @employee_id;

-- name: EditorHeartbeat :exec
UPDATE docs.document_editor
SET last_heartbeat = now()
WHERE organization_id = @organization_id 
  AND document_id = @document_id 
  AND employee_id = @employee_id;

-- name: ListActiveEditors :many
SELECT 
    e.*,
    emp.given_name || ' ' || emp.family_name AS employee_name
FROM docs.document_editor e
JOIN organization.employee emp ON (emp.organization_id, emp.id) = (e.organization_id, e.employee_id)
WHERE e.organization_id = @organization_id 
  AND e.document_id = @document_id
  AND e.last_heartbeat > now() - interval '60 seconds';

-- name: CountActiveEditors :one
SELECT COUNT(*) AS editor_count
FROM docs.document_editor
WHERE organization_id = @organization_id 
  AND document_id = @document_id
  AND last_heartbeat > now() - interval '60 seconds';

-- name: CleanupStaleEditors :execrows
-- Called periodically to remove stale editor registrations
DELETE FROM docs.document_editor
WHERE last_heartbeat < now() - interval '60 seconds';

-- ============================================================================
-- FULL-TEXT SEARCH (PGroonga)
-- ============================================================================

-- name: SearchDocuments :many
-- PGroonga full-text search with weighted scoring
-- Title matches score higher (2x) than content matches
SELECT 
    d.*,
    pgroonga_score(tableoid, ctid) AS score,
    pgroonga_snippet_html(
        d.search_text, 
        pgroonga_query_extract_keywords(@query),
        200  -- snippet length
    ) AS snippet
FROM docs.document d
WHERE d.organization_id = @organization_id
  AND d.is_deleted = FALSE
  AND (sqlc.narg('status')::text IS NULL OR d.status = sqlc.narg('status'))
  AND d.search_text &@~ @query
  AND (sqlc.narg('cursor')::uuid IS NULL OR d.id < sqlc.narg('cursor'))
ORDER BY score DESC, d.id DESC
LIMIT @search_limit;

-- name: SearchDocumentsWithEmbeds :many
-- Search including embedded content
SELECT 
    d.*,
    pgroonga_score(tableoid, ctid) AS score,
    pgroonga_snippet_html(
        d.search_text, 
        pgroonga_query_extract_keywords(@query),
        200
    ) AS snippet,
    FALSE AS is_embedded_match
FROM docs.document d
WHERE d.organization_id = @organization_id
  AND d.is_deleted = FALSE
  AND d.search_text &@~ @query

UNION ALL

-- Also search in source documents where this content is embedded
SELECT 
    source_d.*,
    pgroonga_score(tableoid, ctid) AS score,
    pgroonga_snippet_html(
        target_d.search_text, 
        pgroonga_query_extract_keywords(@query),
        200
    ) AS snippet,
    TRUE AS is_embedded_match
FROM docs.section_embed e
JOIN docs.document source_d ON (source_d.organization_id, source_d.id) = (e.organization_id, e.source_document_id)
JOIN docs.document target_d ON (target_d.organization_id, target_d.id) = (e.organization_id, e.target_document_id)
WHERE e.organization_id = @organization_id
  AND source_d.is_deleted = FALSE
  AND target_d.search_text &@~ @query

ORDER BY score DESC
LIMIT @search_limit;
