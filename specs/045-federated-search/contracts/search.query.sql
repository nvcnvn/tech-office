-- =============================================================================
-- Feature 045: Server-Side Federated Search — SQL contract
--
-- Three changed queries and one new one, written as they will land in
-- backend/database/scripts/*.query.sql. Two new indexes ship as a forward-only
-- migration. backend/database/scripts/schema.sql is a generated snapshot and is
-- regenerated from the migrations, never hand-edited.
-- =============================================================================


-- =============================================================================
-- docs.query.sql — CHANGED: SearchDocuments becomes access-scoped (FR-007)
--
-- Closes the search half of drift D49 for every caller, not just for federated
-- search: DocumentService.SearchDocuments gets the same fix, so the feature-043
-- procedure chooser stops offering documents the manager cannot open.
--
-- The predicate mirrors documentLogicImpl.CheckAccess exactly, INCLUDING ITS
-- PRECEDENCE, which is the part that is easy to get wrong:
--
--   1. owner                        -> access
--   2. else explicit employee grant -> that level, INCLUDING an explicit 'none',
--                                      which is a deny that stops the chain
--   3. else highest department grant among the caller's departments
--   4. else visibility = 'public'   -> access
--   5. else                         -> no access
--
-- Steps 2 and 3 must short-circuit. Written as COALESCE over scalar sub-selects
-- rather than an OR-chain, because an OR-chain silently loses the deny: a caller
-- with an employee grant of 'none' on a public document would still match
-- `d.visibility = 'public'` and get the hit.
-- =============================================================================

-- name: SearchDocuments :many
-- PGroonga full-text search over title and body, scoped to what the caller may read.
SELECT
    d.*,
    pgroonga_score(tableoid, ctid) AS score,
    pgroonga_snippet_html(
        d.content_text,
        pgroonga_query_extract_keywords(@query),
        200  -- snippet length
    ) AS snippet
FROM docs.document d
WHERE d.organization_id = @organization_id
  AND d.is_deleted = FALSE
  AND (sqlc.narg('status')::text IS NULL OR d.status = sqlc.narg('status'))
  -- Title as well as body. A document search that cannot find a document by its own
  -- name is not a search; the ritual procedure picker (feature 043) is title-driven and
  -- found nothing at all until this matched titles too.
  AND (d.title &@~ @query OR d.content_text &@~ @query)
  -- Access scoping (feature 045, FR-007). Precedence-preserving; see the header.
  AND (
    d.owner_employee_id = @employee_id
    OR COALESCE(
         -- 2. explicit employee grant, if any — 'none' included, and it wins
         (SELECT a.access_level
            FROM docs.document_access a
           WHERE a.organization_id = d.organization_id
             AND a.document_id     = d.id
             AND a.grantee_type    = 'employee'
             AND a.grantee_id      = @employee_id),
         -- 3. else the highest department grant the caller inherits
         (SELECT a.access_level
            FROM docs.document_access a
            JOIN organization.department_member dm
              ON (dm.organization_id, dm.department_id) = (a.organization_id, a.grantee_id)
           WHERE a.organization_id = d.organization_id
             AND a.document_id     = d.id
             AND a.grantee_type    = 'department'
             AND dm.employee_id    = @employee_id
           ORDER BY CASE a.access_level
                      WHEN 'write_update' THEN 2
                      WHEN 'read_comment' THEN 1
                      ELSE 0
                    END DESC
           LIMIT 1),
         -- 4. else visibility
         CASE WHEN d.visibility = 'public' THEN 'write_update' ELSE 'none' END
       ) <> 'none'
  )
  AND (sqlc.narg('cursor')::uuid IS NULL OR d.id < sqlc.narg('cursor'))
ORDER BY score DESC, d.id DESC
LIMIT @search_limit;

-- NOTE. docs.document_access joins organization.department_member across schemas here.
-- Constitution IV forbids cross-schema joins that carry *domain data*; this one carries
-- only the caller's own department membership, which is the same join
-- GetDepartmentDocumentAccess already performs in this same file to answer the same
-- question. Keeping it inline is what makes the rule a predicate instead of a post-filter
-- (see the spec's second assumption). Both sides pin organization_id.


-- =============================================================================
-- calendar.query.sql — CHANGED: SearchEvents honours visibility (FR-008) and
-- moves to the house matcher.
--
-- Two changes, both correctness:
--
--   * the visibility predicate is byte-for-byte the rule ListEventsForEmployee and
--     ListEventsForOrg already ship between them, so the `visibility` column has one
--     interpretation rather than two. `personal_shared` is deliberately outside the
--     third arm: it means organiser-and-attendees-only.
--   * to_tsvector('simple') -> PGroonga &@~. The old matcher had NO index behind it, so
--     every calendar search was a sequential scan over every event in the database, and
--     it segments Vietnamese worse than the matcher already installed for the other
--     seven sources (SC-004, SC-008).
--
-- Cancelled events are already excluded and stay excluded.
-- =============================================================================

-- name: SearchEvents :many
SELECT e.* FROM calendar.event e
WHERE e.organization_id = @organization_id
  AND e.cancelled_at IS NULL
  AND (e.title &@~ @query OR e.description &@~ @query)
  -- Visibility scoping (feature 045, FR-008).
  AND (
    e.organizer_id = @employee_id
    OR EXISTS (
      SELECT 1 FROM calendar.attendee a
       WHERE a.organization_id = e.organization_id
         AND a.event_id        = e.id
         AND a.employee_id     = @employee_id
    )
    OR e.visibility IN ('team', 'org_wide')
  )
  AND (sqlc.narg('event_type')::text IS NULL OR e.event_type = sqlc.narg('event_type'))
  AND (sqlc.narg('from_time')::timestamptz IS NULL OR e.start_time >= sqlc.narg('from_time'))
  AND (sqlc.narg('until_time')::timestamptz IS NULL OR e.end_time <= sqlc.narg('until_time'))
  AND (sqlc.narg('cursor')::uuid IS NULL OR e.id < sqlc.narg('cursor'))
ORDER BY pgroonga_score(e.tableoid, e.ctid) DESC, e.updated_at DESC, e.id DESC
LIMIT @search_limit;


-- =============================================================================
-- collaboration.query.sql — NEW: SearchTasks (FR-009)
--
-- The one genuinely new query in the feature. Nothing existed to reuse:
-- ListTasksRequest has a `search_query` field, but no query in this file reads it,
-- and ListTasks is single-project anyway.
--
-- The project-access predicate is copied from ListTasksBySourceMessages so the
-- project visibility rule stays single-sourced even though the query is new.
-- =============================================================================

-- name: SearchTasks :many
-- Cross-project work-item search: ordinary tasks and ritual instances alike, scoped to
-- projects the caller may read. Uses idx_task_title_pgroonga, which already exists.
SELECT
    t.id,
    t.organization_id,
    t.project_id,
    t.identifier,
    t.title,
    t.task_kind,
    t.due_date,
    t.updated_at,
    p.name AS project_name,
    p.key  AS project_key,
    ps.name     AS state_name,
    ps.category AS state_category,
    pgroonga_score(t.tableoid, t.ctid)::real AS relevance_score
FROM collaboration.task t
JOIN collaboration.project p
    ON (p.organization_id, p.id) = (t.organization_id, t.project_id)
JOIN collaboration.project_state ps
    ON (ps.organization_id, ps.id) = (t.organization_id, t.state_id)
WHERE t.organization_id = @organization_id
  AND t.is_deleted  = FALSE
  -- An archived project's work is not findable (spec edge case).
  AND p.is_archived = FALSE
  AND t.title &@~ @query
  -- Project access (feature 045, FR-009) — same predicate as ListTasksBySourceMessages.
  AND (
      p.visibility = 'public'
      OR EXISTS (
          SELECT 1 FROM collaboration.project_membership pm
           WHERE pm.organization_id = t.organization_id
             AND pm.project_id      = t.project_id
             AND pm.employee_id     = @employee_id
      )
  )
  AND (sqlc.narg('cursor')::uuid IS NULL OR t.id < sqlc.narg('cursor'))
ORDER BY relevance_score DESC, t.updated_at DESC, t.id DESC
LIMIT @search_limit;


-- =============================================================================
-- migrations/20260905000001_search_indexes.up.sql — NEW
--
-- Two of the eight sources match full text with no index behind them, which is the
-- most likely single cause of missing SC-004. The other two full-text sources this
-- feature touches are already covered: collaboration.task has idx_task_title_pgroonga
-- and docs.document has idx_document_title_pgroonga + idx_document_pgroonga, so no
-- index is added for them.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_event_pgroonga
    ON calendar.event USING pgroonga (title, description);

COMMENT ON INDEX calendar.idx_event_pgroonga IS
    'PGroonga index for multilingual full-text search on event title and description. '
    'Added by feature 045: SearchEvents previously used an unindexed to_tsvector(''simple'') '
    'match and scanned every event in the database on every search.';

CREATE INDEX IF NOT EXISTS idx_file_metadata_filename_pgroonga
    ON files.file_metadata USING pgroonga (original_filename);

COMMENT ON INDEX files.idx_file_metadata_filename_pgroonga IS
    'PGroonga index for multilingual full-text search on uploaded file names. '
    'SearchFilesByNameAndContent has always matched original_filename with &@~; only the '
    'extracted content side was indexed.';

-- migrations/20260905000001_search_indexes.down.sql
--   DROP INDEX IF EXISTS files.idx_file_metadata_filename_pgroonga;
--   DROP INDEX IF EXISTS calendar.idx_event_pgroonga;
