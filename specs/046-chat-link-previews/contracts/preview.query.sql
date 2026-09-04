-- Feature 046 — link preview reads, exactly as they will land in the per-domain
-- .query.sql files. Six batched queries, no writes, no schema change.
--
-- Every one of them:
--   * pins organization_id as its first predicate (Principle I);
--   * takes an id array so the request costs one query per resource type, never one per
--     link (FR-020, SC-005);
--   * carries its access predicate in SQL, copied from the query that already owns that
--     rule, so a row the reader may not see is never loaded (FR-009, FR-010);
--   * joins only inside its own schema (Principle IV).


-- ===========================================================================
-- backend/database/scripts/collaboration.query.sql
-- ===========================================================================

-- name: ListTaskPreviews :many
-- Task cards for a page of chat link previews (feature 046, FR-001).
--
-- The access predicate is the one ListTasksBySourceMessages and SearchTasks already
-- share, so "which tasks may this reader see" keeps a single definition. A task the
-- reader cannot see is absent from the result rather than flagged — that absence is what
-- makes access_denied and not_found indistinguishable to the caller (FR-010).
--
-- The assignee is read as two correlated sub-selects rather than a join, so a task with
-- three assignees still produces exactly one row.
SELECT
    t.id,
    t.identifier,
    t.title,
    t.project_id,
    ps.name     AS state_name,
    ps.category AS state_category,
    (SELECT ta.employee_id
       FROM collaboration.task_assignee ta
      WHERE ta.organization_id = t.organization_id
        AND ta.task_id         = t.id
        AND ta.role            = 'assignee'
      ORDER BY ta.assigned_at, ta.id
      LIMIT 1) AS primary_assignee_id,
    (SELECT count(*)
       FROM collaboration.task_assignee ta
      WHERE ta.organization_id = t.organization_id
        AND ta.task_id         = t.id
        AND ta.role            = 'assignee') AS assignee_count
FROM collaboration.task t
JOIN collaboration.project p
    ON (p.organization_id, p.id) = (t.organization_id, t.project_id)
JOIN collaboration.project_state ps
    ON (ps.organization_id, ps.id) = (t.organization_id, t.state_id)
WHERE t.organization_id = @organization_id
  AND t.id = ANY(@task_ids::uuid[])
  AND t.is_deleted = FALSE
  -- Project access — same predicate as ListTasksBySourceMessages.
  AND (
      p.visibility = 'public'
      OR EXISTS (
          SELECT 1 FROM collaboration.project_membership pm
           WHERE pm.organization_id = t.organization_id
             AND pm.project_id      = t.project_id
             AND pm.employee_id     = @employee_id
      )
  );

-- name: ListProjectPreviews :many
-- Project cards (feature 046, FR-004). The predicate mirrors
-- Service.resolveProjectStatus: a private project is visible to its owner and its members.
-- An archived project still previews — it exists and the reader may open it.
SELECT
    p.id,
    p.name,
    p.key,
    p.is_archived
FROM collaboration.project p
WHERE p.organization_id = @organization_id
  AND p.id = ANY(@project_ids::uuid[])
  AND (
      p.visibility <> 'private'
      OR p.owner_employee_id = @employee_id
      OR EXISTS (
          SELECT 1 FROM collaboration.project_membership pm
           WHERE pm.organization_id = p.organization_id
             AND pm.project_id      = p.id
             AND pm.employee_id     = @employee_id
      )
  );


-- ===========================================================================
-- backend/database/scripts/docs.query.sql
-- ===========================================================================

-- name: ListDocumentPreviews :many
-- Document cards (feature 046, FR-002): the document's own title, plus the parent it
-- lives under as the supporting line.
--
-- The access predicate is copied verbatim from SearchDocuments INCLUDING ITS PRECEDENCE,
-- which is the part that is easy to get wrong: an explicit employee grant of 'none' is a
-- deny that stops the chain, so it must be a COALESCE over scalar sub-selects and not an
-- OR-chain. It is evaluated on the linked document only; the parent contributes a name,
-- never access.
SELECT
    d.id,
    d.title,
    d.parent_document_id,
    parent.title AS parent_title
FROM docs.document d
LEFT JOIN docs.document parent
    ON (parent.organization_id, parent.id) = (d.organization_id, d.parent_document_id)
   AND parent.is_deleted = FALSE
WHERE d.organization_id = @organization_id
  AND d.id = ANY(@document_ids::uuid[])
  AND d.is_deleted = FALSE
  AND (
    d.owner_employee_id = @employee_id
    OR COALESCE(
         (SELECT a.access_level
            FROM docs.document_access a
           WHERE a.organization_id = d.organization_id
             AND a.document_id     = d.id
             AND a.grantee_type    = 'employee'
             AND a.grantee_id      = @employee_id),
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
         CASE WHEN d.visibility = 'public' THEN 'write_update' ELSE 'none' END
       ) <> 'none'
  );


-- ===========================================================================
-- backend/database/scripts/calendar.query.sql
-- ===========================================================================

-- name: ListEventPreviews :many
-- Event cards (feature 046, FR-003). start_time goes to the client as an instant and is
-- formatted in the reader's own zone there; the server never renders a wall clock.
--
-- The visibility predicate is the one SearchEvents uses: organiser, attendee, or a
-- team/org_wide event. 'personal_shared' is deliberately outside the third arm — it means
-- organiser-and-attendees-only. A cancelled event has nothing to preview.
SELECT
    e.id,
    e.title,
    e.start_time,
    e.all_day
FROM calendar.event e
WHERE e.organization_id = @organization_id
  AND e.id = ANY(@event_ids::uuid[])
  AND e.cancelled_at IS NULL
  AND (
    e.organizer_id = @employee_id
    OR EXISTS (
      SELECT 1 FROM calendar.attendee a
       WHERE a.organization_id = e.organization_id
         AND a.event_id        = e.id
         AND a.employee_id     = @employee_id
    )
    OR e.visibility IN ('team', 'org_wide')
  );


-- ===========================================================================
-- backend/database/scripts/chat.query.sql
-- ===========================================================================

-- name: ListChannelPreviews :many
-- Channel cards (feature 046, FR-005). The permission predicate is the one SearchChannels
-- uses: a public channel, or one the reader is a member of. It covers direct messages
-- without a special case — a DM is private and its members are its membership rows.
SELECT
    c.id,
    c.display_name,
    c.title_slug,
    c.channel_type
FROM chat.channel c
WHERE c.organization_id = @organization_id
  AND c.id = ANY(@channel_ids::uuid[])
  AND c.is_archived = FALSE
  AND (
    c.is_private = FALSE
    OR EXISTS (
      SELECT 1 FROM chat.channel_membership cm
       WHERE cm.organization_id = c.organization_id
         AND cm.channel_id      = c.id
         AND cm.employee_id     = @employee_id
    )
  );

-- name: ListThreadPreviews :many
-- Thread cards (feature 046, FR-005). A thread's canonical resource id is its root
-- message id — the same id MessageItem's copy-link puts in the URL — so the lookup starts
-- at the message and names the channel it lives in.
--
-- Only the channel's name is read. Nothing from the message body is returned, so
-- previewing a thread cannot render the conversation it points at.
SELECT
    m.id AS root_message_id,
    c.id AS channel_id,
    c.display_name,
    c.title_slug
FROM chat.message m
JOIN chat.channel c
    ON (c.organization_id, c.id) = (m.organization_id, m.channel_id)
WHERE m.organization_id = @organization_id
  AND m.id = ANY(@root_message_ids::uuid[])
  AND m.is_deleted = FALSE
  AND c.is_archived = FALSE
  AND (
    c.is_private = FALSE
    OR EXISTS (
      SELECT 1 FROM chat.channel_membership cm
       WHERE cm.organization_id = c.organization_id
         AND cm.channel_id      = c.id
         AND cm.employee_id     = @employee_id
    )
  );
