-- ===============================================
-- Feature Tour Queries (Feature 039)
--
-- Every query pins organization_id to a parameter. None is cross-tenant, so none carries
-- a -- lint:cross-tenant marker.
-- ===============================================

-- name: GetTourProgress :one
-- Read one person's progress in one tour.
-- Performance: O(1) via the unique index on (organization_id, employee_id, tour_id).
--
-- Parameters:
-- - $1 organization_id (UUID, required): Tenant isolation
-- - $2 employee_id (UUID, required): The person
-- - $3 tour_id (text, required): "administrator" or "worker"
SELECT * FROM iam.tour_progress
WHERE organization_id = $1 AND employee_id = $2 AND tour_id = $3
LIMIT 1;

-- name: UpsertTourProgress :one
-- Insert or update progress on the natural key. Re-sending the same stop index is a
-- no-op beyond updated_at, which matters because both clients may write on navigation
-- and again on unmount.
-- Takes updated_at as a parameter so the caller controls the timestamp.
--
-- Parameters:
-- - $1 id (UUID): Record ID (uuidv7); ignored on conflict
-- - $2 organization_id (UUID, required): Tenant isolation
-- - $3 employee_id (UUID, required): The person
-- - $4 tour_id (text, required): "administrator" or "worker"
-- - $5 status (text, required): "in_progress", "completed" or "dismissed"
-- - $6 current_stop (int, required): Zero-based index into the filtered stop list
-- - $7 content_version (text, required): The content version this person saw
-- - $8 updated_at (timestamptz): Parameterized timestamp
INSERT INTO iam.tour_progress (
    id,
    organization_id,
    employee_id,
    tour_id,
    status,
    current_stop,
    content_version,
    updated_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8
) ON CONFLICT (organization_id, employee_id, tour_id) DO UPDATE SET
    status = EXCLUDED.status,
    current_stop = EXCLUDED.current_stop,
    content_version = EXCLUDED.content_version,
    updated_at = EXCLUDED.updated_at
RETURNING *;

-- name: DeleteTourProgressForOrganization :exec
-- Remove a person's tour progress within one organization. Called from the account
-- deletion sweep in internal/iam/logic_account_deletion.go, alongside the equivalent
-- user-preference delete: the sweep is explicit rather than cascade-dependent so it
-- stays idempotent on a retry.
--
-- Parameters:
-- - $1 organization_id (UUID, required): Tenant isolation
-- - $2 employee_id (UUID, required): The person
DELETE FROM iam.tour_progress
WHERE organization_id = $1 AND employee_id = $2;
