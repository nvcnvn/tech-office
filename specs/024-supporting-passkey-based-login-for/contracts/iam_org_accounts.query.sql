-- sqlc Query Contract: Org-Managed Accounts
-- These queries go into backend/database/scripts/iam.query.sql

-- =============================================================================
-- Identity Lookup for PIN Login
-- =============================================================================

-- name: GetIdentityByOrgAndLoginIdentifier :one
-- Finds an org-scoped identity by login_identifier for PIN-based login.
SELECT i.id, i.organization_id, i.email, i.login_identifier, i.identity_type, i.updated_at
FROM iam.identity i
WHERE i.organization_id = @organization_id::uuid
  AND i.login_identifier = @login_identifier::text;

-- name: GetOrgBySubdomain :one
-- Resolves organization from subdomain for PIN login flow.
SELECT id, subdomain
FROM public.organization
WHERE subdomain = @subdomain::text;

-- =============================================================================
-- Credential Management
-- =============================================================================

-- name: CreateCredential :one
-- Creates a new credential record (PIN, biometric) for an org-managed identity.
INSERT INTO iam.credential (
    id, organization_id, identity_id, credential_type,
    credential_hash, state, expires_at, created_at, updated_at
) VALUES (
    @id::uuid, @organization_id::uuid, @identity_id::uuid, @credential_type::text,
    @credential_hash::text, @state::text, sqlc.narg('expires_at')::timestamptz,
    now(), now()
)
RETURNING *;

-- name: GetActiveCredential :one
-- Gets the active or temporary credential for an identity + type.
SELECT id, organization_id, identity_id, credential_type,
    credential_hash, state, expires_at, created_at, updated_at
FROM iam.credential
WHERE organization_id = @organization_id::uuid
  AND identity_id = @identity_id::uuid
  AND credential_type = @credential_type::text
  AND state IN ('active', 'temporary')
  AND (expires_at IS NULL OR expires_at > now());

-- name: RevokeCredentialsByIdentityAndType :exec
-- Revokes all credentials of a given type for an identity.
UPDATE iam.credential
SET state = 'revoked', updated_at = @updated_at::timestamptz
WHERE organization_id = @organization_id::uuid
  AND identity_id = @identity_id::uuid
  AND credential_type = @credential_type::text
  AND state IN ('active', 'temporary');

-- name: ActivateTemporaryCredential :exec
-- Transitions a temporary credential to active (after user sets new PIN).
-- Used by SetPIN to replace temp PIN hash with user-chosen PIN hash.
UPDATE iam.credential
SET credential_hash = @credential_hash::text,
    state = 'active',
    expires_at = NULL,
    updated_at = @updated_at::timestamptz
WHERE organization_id = @organization_id::uuid
  AND id = @id::uuid
  AND state = 'temporary';

-- =============================================================================
-- Account Lockout
-- =============================================================================

-- name: GetAccountLockout :one
-- Gets the lockout status for an identity.
SELECT organization_id, identity_id, failed_attempts, lockout_tier,
    lockout_until, last_failed_at, updated_at
FROM iam.account_lockout
WHERE organization_id = @organization_id::uuid
  AND identity_id = @identity_id::uuid;

-- name: UpsertAccountLockout :exec
-- Creates or updates the lockout record after a failed attempt.
INSERT INTO iam.account_lockout (
    organization_id, identity_id, failed_attempts, lockout_tier,
    lockout_until, last_failed_at, updated_at
) VALUES (
    @organization_id::uuid, @identity_id::uuid, @failed_attempts::int,
    @lockout_tier::int, sqlc.narg('lockout_until')::timestamptz,
    @last_failed_at::timestamptz, @updated_at::timestamptz
)
ON CONFLICT (organization_id, identity_id) DO UPDATE
SET failed_attempts = @failed_attempts::int,
    lockout_tier = @lockout_tier::int,
    lockout_until = sqlc.narg('lockout_until')::timestamptz,
    last_failed_at = @last_failed_at::timestamptz,
    updated_at = @updated_at::timestamptz;

-- name: ResetAccountLockout :exec
-- Resets lockout state on successful authentication or admin unlock.
UPDATE iam.account_lockout
SET failed_attempts = 0, lockout_tier = 0, lockout_until = NULL,
    last_failed_at = NULL, updated_at = @updated_at::timestamptz
WHERE organization_id = @organization_id::uuid
  AND identity_id = @identity_id::uuid;

-- name: DeleteAccountLockout :exec
-- Deletes lockout record entirely (admin full reset).
DELETE FROM iam.account_lockout
WHERE organization_id = @organization_id::uuid
  AND identity_id = @identity_id::uuid;

-- =============================================================================
-- Org Account Management (Admin)
-- =============================================================================

-- name: CreateIdentityWithLoginIdentifier :one
-- Creates an iam.identity with login_identifier (no email) for org-managed worker.
INSERT INTO iam.identity (id, organization_id, login_identifier, identity_type, updated_at)
VALUES (@id::uuid, @organization_id::uuid, @login_identifier::text, 'human', now())
RETURNING *;

-- name: CreateOrgManagedUser :one
-- Creates an iam.user with nullable email and is_org_managed=true.
INSERT INTO iam.user (id, email, display_name, status, is_org_managed, created_at, updated_at)
VALUES (@id::uuid, NULL, @display_name::text, 'active', true, now(), now())
RETURNING *;

-- name: DeactivateUser :exec
-- Sets user status to 'suspended' for deactivation.
UPDATE iam.user
SET status = 'suspended', updated_at = @updated_at::timestamptz
WHERE id = @id::uuid;

-- name: ReactivateUser :exec
-- Sets user status back to 'active'.
UPDATE iam.user
SET status = 'active', updated_at = @updated_at::timestamptz
WHERE id = @id::uuid;

-- name: ListOrgManagedAccounts :many
-- Lists org-managed worker accounts with pagination.
SELECT
    u.id,
    i.login_identifier,
    u.display_name,
    e.given_name,
    e.family_name,
    u.status AS user_status,
    u.last_login_at,
    u.created_at,
    CASE
        WHEN al.lockout_tier = 4 THEN 'locked'
        WHEN u.status = 'suspended' THEN 'deactivated'
        ELSE 'active'
    END AS account_status,
    EXISTS(
        SELECT 1 FROM iam.credential c
        WHERE (c.organization_id, c.identity_id) = (i.organization_id, i.id)
          AND c.credential_type = 'pin'
          AND c.state = 'active'
    ) AS pin_configured
FROM iam.user u
JOIN iam.identity i ON i.id = u.id AND i.organization_id = @organization_id::uuid
JOIN organization.employee e ON (e.organization_id, e.id) = (i.organization_id, i.id)
LEFT JOIN iam.account_lockout al ON (al.organization_id, al.identity_id) = (i.organization_id, i.id)
WHERE u.is_org_managed = true
  AND i.organization_id = @organization_id::uuid
  AND (sqlc.narg('status_filter')::text IS NULL OR
       CASE
           WHEN al.lockout_tier = 4 THEN 'locked'
           WHEN u.status = 'suspended' THEN 'deactivated'
           ELSE 'active'
       END = sqlc.narg('status_filter')::text)
  AND (sqlc.narg('cursor_id')::uuid IS NULL OR u.id > sqlc.narg('cursor_id')::uuid)
ORDER BY u.id
LIMIT @result_limit::int;

-- name: GetOrgManagedAccountCount :one
-- Gets total count of org-managed accounts for an org.
SELECT COUNT(*)::int
FROM iam.user u
JOIN iam.identity i ON i.id = u.id AND i.organization_id = @organization_id::uuid
WHERE u.is_org_managed = true
  AND i.organization_id = @organization_id::uuid;

-- name: InvalidateAllUserSessionsForDeactivation :exec
-- Invalidates all active sessions for a user (used on deactivation and credential reset).
UPDATE iam.session
SET invalidated_at = @invalidated_at::timestamptz
WHERE user_id = @user_id::uuid
  AND invalidated_at IS NULL;

-- =============================================================================
-- Employee Lookup Extensions
-- =============================================================================

-- name: GetEmployeePersonalInfo :one
-- Gets date_of_birth and phone_number for PIN validation (reject PINs matching personal data).
SELECT date_of_birth, phone_number
FROM organization.employee
WHERE organization_id = @organization_id::uuid
  AND id = @id::uuid;
