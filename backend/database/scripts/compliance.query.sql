-- Compliance Service Queries (Feature 036)
-- Content reports, blocks, removal requests and account deletion records.
-- Every query filters organization_id explicitly (Constitution Principle I).

-- ============================================================================
-- Content reports
-- ============================================================================

-- name: CreateContentReport :one
-- Files a report. The reported author and the content snapshot are resolved
-- server-side by calling the owning domain's service, never supplied by the client.
INSERT INTO compliance.content_report (
    organization_id,
    reporter_employee_id,
    reported_employee_id,
    target_kind,
    target_id,
    content_snapshot,
    reason,
    note
) VALUES ($1, $2, $3, $4, $5, $6, $7, sqlc.narg('note'))
RETURNING *;

-- name: GetOutstandingReportByReporterAndTarget :one
-- Duplicate detection: one outstanding report per reporter per target. Enforced at
-- the logic layer rather than by a unique constraint so the rejection can carry a
-- useful message instead of a constraint violation.
SELECT *
FROM compliance.content_report
WHERE organization_id = $1
  AND reporter_employee_id = $2
  AND target_kind = $3
  AND target_id = $4
  AND status = 'outstanding'
LIMIT 1;

-- name: GetContentReport :one
SELECT
    r.*,
    (reporter.given_name || ' ' || reporter.family_name)::text AS reporter_name,
    (reported.given_name || ' ' || reported.family_name)::text AS reported_name
FROM compliance.content_report r
JOIN organization.employee reporter
    ON (r.organization_id, r.reporter_employee_id) = (reporter.organization_id, reporter.id)
JOIN organization.employee reported
    ON (r.organization_id, r.reported_employee_id) = (reported.organization_id, reported.id)
WHERE r.organization_id = $1
  AND r.id = $2;

-- name: ListContentReports :many
-- The review queue. Newest first, paged on the UUID v7 id (Principle IX): a NULL
-- cursor starts at the newest report, a non-NULL cursor continues before it.
SELECT
    r.*,
    (reporter.given_name || ' ' || reporter.family_name)::text AS reporter_name,
    (reported.given_name || ' ' || reported.family_name)::text AS reported_name
FROM compliance.content_report r
JOIN organization.employee reporter
    ON (r.organization_id, r.reporter_employee_id) = (reporter.organization_id, reporter.id)
JOIN organization.employee reported
    ON (r.organization_id, r.reported_employee_id) = (reported.organization_id, reported.id)
WHERE r.organization_id = $1
  AND (sqlc.narg('status_filter')::text IS NULL OR r.status = sqlc.narg('status_filter')::text)
  AND (sqlc.narg('cursor')::uuid IS NULL OR r.id < sqlc.narg('cursor')::uuid)
ORDER BY r.id DESC
LIMIT sqlc.arg('limit');

-- name: ResolveContentReport :one
-- Records an outcome. The status predicate makes re-resolution a no-op at the SQL
-- layer as well as the logic layer: an already-resolved report returns no row.
UPDATE compliance.content_report
SET status = $3,
    outcome_note = $4,
    reviewed_by_employee_id = $5,
    reviewed_at = $6
WHERE organization_id = $1
  AND id = $2
  AND status = 'outstanding'
RETURNING *;

-- ============================================================================
-- Blocks
-- ============================================================================

-- name: CreateBlock :one
-- Idempotent: blocking someone already blocked returns the existing row rather
-- than creating a duplicate.
INSERT INTO compliance.block (organization_id, blocker_employee_id, blocked_employee_id)
VALUES ($1, $2, $3)
ON CONFLICT (organization_id, blocker_employee_id, blocked_employee_id) DO UPDATE
SET blocker_employee_id = EXCLUDED.blocker_employee_id
RETURNING *;

-- name: DeleteBlock :exec
-- Idempotent: unblocking someone who is not blocked succeeds.
DELETE FROM compliance.block
WHERE organization_id = $1
  AND blocker_employee_id = $2
  AND blocked_employee_id = $3;

-- name: ListBlockedPeople :many
-- The caller's own block list only. There is deliberately no query that answers
-- "who has blocked me" (FR-022).
SELECT
    b.*,
    (blocked.given_name || ' ' || blocked.family_name)::text AS blocked_name,
    blocked.email AS blocked_email
FROM compliance.block b
JOIN organization.employee blocked
    ON (b.organization_id, b.blocked_employee_id) = (blocked.organization_id, blocked.id)
WHERE b.organization_id = $1
  AND b.blocker_employee_id = $2
ORDER BY b.id DESC;

-- name: IsContactBlocked :one
-- The guard used by CreateOrGetDirectMessage and voice call initiation. Direct
-- contact is refused if either side has blocked the other: the initiator must not
-- learn which direction the block runs in.
SELECT EXISTS (
    SELECT 1 FROM compliance.block
    WHERE organization_id = $1
      AND ((blocker_employee_id = $2 AND blocked_employee_id = $3)
        OR (blocker_employee_id = $3 AND blocked_employee_id = $2))
) AS blocked;

-- name: ListBlockedEmployeeIDs :many
-- Every employee the caller has blocked, for hiding direct history in their view.
SELECT blocked_employee_id
FROM compliance.block
WHERE organization_id = $1
  AND blocker_employee_id = $2;

-- ============================================================================
-- Removal requests
-- ============================================================================

-- name: CreateRemovalRequest :one
INSERT INTO compliance.removal_request (organization_id, employee_id, note)
VALUES ($1, $2, sqlc.narg('note'))
RETURNING *;

-- name: GetOutstandingRemovalRequest :one
SELECT *
FROM compliance.removal_request
WHERE organization_id = $1
  AND employee_id = $2
  AND status = 'outstanding'
LIMIT 1;

-- name: GetLatestRemovalRequestForEmployee :one
-- The most recent request whatever its status, so a declined worker can see the
-- decision rather than an empty screen.
SELECT *
FROM compliance.removal_request
WHERE organization_id = $1
  AND employee_id = $2
ORDER BY id DESC
LIMIT 1;

-- name: GetRemovalRequest :one
SELECT
    rr.*,
    (e.given_name || ' ' || e.family_name)::text AS employee_name
FROM compliance.removal_request rr
JOIN organization.employee e
    ON (rr.organization_id, rr.employee_id) = (e.organization_id, e.id)
WHERE rr.organization_id = $1
  AND rr.id = $2;

-- name: ListRemovalRequests :many
SELECT
    rr.*,
    (e.given_name || ' ' || e.family_name)::text AS employee_name
FROM compliance.removal_request rr
JOIN organization.employee e
    ON (rr.organization_id, rr.employee_id) = (e.organization_id, e.id)
WHERE rr.organization_id = $1
  AND (sqlc.narg('status_filter')::text IS NULL OR rr.status = sqlc.narg('status_filter')::text)
  AND (sqlc.narg('cursor')::uuid IS NULL OR rr.id < sqlc.narg('cursor')::uuid)
ORDER BY rr.id DESC
LIMIT sqlc.arg('limit');

-- name: DecideRemovalRequest :one
UPDATE compliance.removal_request
SET status = $3,
    decided_by_employee_id = $4,
    decided_at = $5
WHERE organization_id = $1
  AND id = $2
  AND status = 'outstanding'
RETURNING *;

-- name: ResolveOutstandingRemovalRequestsForEmployee :exec
-- An administrator offboarding a worker the ordinary way resolves any outstanding
-- request as a side effect, so it does not linger in the owner queue.
UPDATE compliance.removal_request
SET status = 'granted',
    decided_by_employee_id = sqlc.narg('decided_by_employee_id'),
    decided_at = $3
WHERE organization_id = $1
  AND employee_id = $2
  AND status = 'outstanding';

-- ============================================================================
-- Account deletion records
-- ============================================================================

-- name: CreateAccountDeletion :one
INSERT INTO compliance.account_deletion (organization_id, user_id, trigger, created_at, updated_at)
VALUES ($1, $2, $3, $4, $4)
RETURNING *;

-- name: GetAccountDeletion :one
SELECT *
FROM compliance.account_deletion
WHERE organization_id = $1
  AND id = $2;

-- name: ListAccountDeletionsForUser :many
SELECT *
FROM compliance.account_deletion
WHERE organization_id = $1
  AND user_id = $2
ORDER BY id DESC;

-- name: AdvanceAccountDeletionState :one
-- The worker moves one record forward a state at a time. updated_at is passed as a
-- parameter so the caller controls the timestamp and the write is reproducible in tests.
UPDATE compliance.account_deletion
SET state = $3,
    attempts = attempts + 1,
    failure_reason = sqlc.narg('failure_reason'),
    updated_at = $4
WHERE organization_id = $1
  AND id = $2
RETURNING *;
