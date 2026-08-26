-- IAM Service Queries
-- Supports identity and access management operations

-- name: ListEmployees :many
-- Retrieve paginated, sorted, optionally filtered employee list
-- Joins organization.employee with iam.identity for email access
-- Supports:
-- - Exact email search (uses idx_iam_identity_org_email index)
-- - Sorting by hire_date or date_of_birth (ASC/DESC)
-- - UUID v7 secondary sort for deterministic ordering
-- - NULL date handling (sorts NULLs to end)
--
-- Performance:
-- - Email search: O(log n) via unique index
-- - Full list: O(n) sequential scan (acceptable for n ≤ 200)
-- - Sorting: O(n log n) in-memory (PostgreSQL efficient for 200 rows)
--
-- Parameters:
-- - $1 organization_id (UUID, required): Tenant isolation
-- - $2 email (text, optional via sqlc.narg): Exact email match filter
-- - $3 sort_by (text, optional via sqlc.narg): "hire_date" or "date_of_birth"
-- - $4 sort_direction (text, optional via sqlc.narg): "ASC" or "DESC"
-- - $5 page_size (int, required via sqlc.arg): Number of results (20, 50, 100, 200)
-- - $6 offset (int, required via sqlc.arg): Pagination offset
SELECT 
    e.id,
    e.organization_id,
    e.given_name,
    e.family_name,
    e.hire_date,
    e.date_of_birth,
    e.phone_number,
    e.home_address,
    e.is_active,
    e.updated_at,
    e.email
FROM organization.employee e
WHERE e.organization_id = $1
  -- Optional email filter: only apply if parameter provided
  AND (sqlc.narg('email')::text IS NULL OR LOWER(e.email) = LOWER(sqlc.narg('email')))
ORDER BY 
    -- Primary sort by hire_date (if specified)
    -- COALESCE replaces NULL with sentinel date to sort NULLs last
    CASE WHEN sqlc.narg('sort_by')::text = 'hire_date' AND sqlc.narg('sort_direction')::text = 'ASC' 
         THEN COALESCE(e.hire_date, '9999-12-31'::date) END ASC,
    CASE WHEN sqlc.narg('sort_by')::text = 'hire_date' AND sqlc.narg('sort_direction')::text = 'DESC' 
         THEN COALESCE(e.hire_date, '1000-01-01'::date) END DESC,
    
    -- Primary sort by date_of_birth (if specified)
    CASE WHEN sqlc.narg('sort_by')::text = 'date_of_birth' AND sqlc.narg('sort_direction')::text = 'ASC' 
         THEN COALESCE(e.date_of_birth, '9999-12-31'::date) END ASC,
    CASE WHEN sqlc.narg('sort_by')::text = 'date_of_birth' AND sqlc.narg('sort_direction')::text = 'DESC' 
         THEN COALESCE(e.date_of_birth, '1000-01-01'::date) END DESC,
    
    -- Secondary sort by UUID v7 (time-sortable) for deterministic ordering
    -- Ensures consistent results when primary sort values are identical
    e.id ASC
LIMIT sqlc.arg('page_size')::int
OFFSET sqlc.arg('offset')::int;

-- name: CountEmployees :one
-- Count total employees for pagination metadata
-- Supports same filtering as ListEmployees (email search)
--
-- Performance:
-- - Count with email filter: O(log n) via index
-- - Count all: O(n) sequential scan (acceptable for n ≤ 200)
--
-- Parameters:
-- - $1 organization_id (UUID, required): Tenant isolation
-- - $2 email (text, optional via sqlc.narg): Exact email match filter
SELECT COUNT(*) 
FROM organization.employee e
WHERE e.organization_id = $1
  -- Optional email filter: only apply if parameter provided
  AND (sqlc.narg('email')::text IS NULL OR LOWER(e.email) = LOWER(sqlc.narg('email')));

-- ===============================================
-- User Preference Queries
-- ===============================================

-- name: GetUserPreference :one
-- Retrieve user's preference settings (theme mode, etc.)
-- Used on page load for cross-device sync
-- Performance: O(1) via unique index on (organization_id, employee_id)
--
-- Parameters:
-- - $1 organization_id (UUID, required): Tenant isolation
-- - $2 employee_id (UUID, required): User identity
SELECT * FROM iam.user_preference
WHERE organization_id = $1 AND employee_id = $2
LIMIT 1;

-- name: UpsertUserPreference :one
-- Insert or update user preference (theme mode, preference source)
-- Handles first-time users and theme changes
-- Uses parameterized updated_at per Citus constraint (no now() in ON CONFLICT DO UPDATE)
--
-- Parameters:
-- - $1 id (UUID): Record ID (uuidv7)
-- - $2 organization_id (UUID, required): Tenant isolation
-- - $3 employee_id (UUID, required): User identity
-- - $4 theme_mode (text): "light" or "dark"
-- - $5 preference_source (text): "manual" or "os_default"
-- - $6 additional_preferences (jsonb): Future preferences extension
-- - $7 updated_at (timestamptz): Parameterized timestamp
INSERT INTO iam.user_preference (
    id,
    organization_id,
    employee_id,
    theme_mode,
    preference_source,
    additional_preferences,
    updated_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7
) ON CONFLICT (organization_id, employee_id) DO UPDATE SET
    theme_mode = EXCLUDED.theme_mode,
    preference_source = EXCLUDED.preference_source,
    additional_preferences = EXCLUDED.additional_preferences,
    updated_at = EXCLUDED.updated_at
RETURNING *;

-- name: DeleteUserPreference :exec
-- Reset user preference to defaults (delete record)
-- Used for admin operations or "Reset to OS Default" feature
--
-- Parameters:
-- - $1 organization_id (UUID, required): Tenant isolation
-- - $2 employee_id (UUID, required): User identity
DELETE FROM iam.user_preference
WHERE organization_id = $1 AND employee_id = $2;

-- ===============================================
-- IAM Authentication Queries (Feature 018)
-- Global user accounts, SSO, password, sessions
-- ===============================================

-- === User Queries ===

-- name: GetUserByID :one
SELECT * FROM iam.user WHERE id = $1;

-- name: GetUserByEmail :one
SELECT * FROM iam.user WHERE email = $1;

-- name: CreateIAMUser :one
INSERT INTO iam.user (
    id, email, display_name, profile_picture_url, status
) VALUES (
    $1, $2, $3, $4, $5
) RETURNING *;

-- name: UpdateUserProfile :one
UPDATE iam.user
SET display_name = $2,
    profile_picture_url = $3,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: UpdateUserLastLogin :exec
UPDATE iam.user
SET last_login_at = now()
WHERE id = $1;

-- name: GetSSOIdentity :one
SELECT * FROM iam.sso_identity
WHERE provider = $1 AND provider_user_id = $2;

-- name: GetUserSSOIdentities :many
SELECT * FROM iam.sso_identity
WHERE user_id = $1;

-- name: CreateSSOIdentity :one
INSERT INTO iam.sso_identity (
    id, user_id, provider, provider_user_id, email
) VALUES (
    $1, $2, $3, $4, $5
) RETURNING *;

-- name: UpdateSSOIdentityLastUsed :exec
UPDATE iam.sso_identity
SET last_used_at = now()
WHERE id = $1;

-- name: DeleteSSOIdentity :exec
DELETE FROM iam.sso_identity
WHERE id = $1 AND user_id = $2;

-- name: CountUserSSOIdentities :one
SELECT COUNT(*) FROM iam.sso_identity WHERE user_id = $1;

-- === Password Credential Queries ===

-- name: GetPasswordCredential :one
SELECT * FROM iam.password_credential
WHERE user_id = $1;

-- name: CreatePasswordCredential :one
INSERT INTO iam.password_credential (
    id, user_id, password_hash
) VALUES (
    $1, $2, $3
) RETURNING *;

-- name: UpdatePasswordCredential :exec
UPDATE iam.password_credential
SET password_hash = $2,
    updated_at = now()
WHERE user_id = $1;

-- name: GetUserOrganizations :many
SELECT
    e.id,
    e.organization_id,
    e.updated_at AS joined_at,
    o.company_name,
    o.subdomain,
  ARRAY(
    SELECT r.name
    FROM iam.employee_role er
    JOIN iam.role r
      ON (r.organization_id, r.id) = (er.organization_id, er.role_id)
    WHERE (er.organization_id, er.employee_id) = (e.organization_id, e.id)
    ORDER BY r.is_system DESC, r.name ASC
  )::text[] AS role_names
FROM organization.employee e
INNER JOIN public.organization o ON e.organization_id = o.id
WHERE e.id = $1;

-- name: GetUserPermissionsInOrg :many
-- Returns the effective (union) permission set for a user in an organization.
-- Joins through employee → employee_role → role_permission to collect all permissions
-- from all assigned roles. All tables colocated on organization_id for local JOINs.
SELECT DISTINCT rp.permission_id
FROM iam.employee_role er
JOIN iam.role_permission rp
    ON (er.organization_id, er.role_id) = (rp.organization_id, rp.role_id)
WHERE er.employee_id = sqlc.arg('user_id')::uuid
  AND er.organization_id = sqlc.arg('organization_id')::uuid;

-- name: GetUserRoleNamesInOrg :many
-- Returns role names for a user in an organization (for display in SwitchOrg/GetProfile).
SELECT r.name
FROM iam.employee_role er
JOIN iam.role r ON (er.organization_id, er.role_id) = (r.organization_id, r.id)
WHERE er.employee_id = sqlc.arg('user_id')::uuid
  AND er.organization_id = sqlc.arg('organization_id')::uuid
ORDER BY r.is_system DESC, r.name ASC;

-- === Invitation Queries ===

-- name: GetInvitationByToken :one
SELECT * FROM iam.invitation
WHERE token = $1 AND status = 'pending';

-- name: GetPendingInvitationByEmailAndOrg :one
SELECT * FROM iam.invitation
WHERE lower(email) = lower(@email::text)
  AND organization_id = @organization_id
  AND status = 'pending'
  AND expires_at > now()
LIMIT 1;

-- name: GetOrgInvitations :many
SELECT * FROM iam.invitation
WHERE organization_id = $1 AND status = $2
ORDER BY created_at DESC;

-- name: CreateInvitation :one
INSERT INTO iam.invitation (
    id, organization_id, email, role_id, token, invited_by, expires_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7
) RETURNING *;

-- name: UpdateInvitationStatus :exec
UPDATE iam.invitation
SET status = $2,
    accepted_at = $3
WHERE id = $1;

-- name: CancelInvitation :exec
UPDATE iam.invitation
SET status = 'cancelled'
WHERE id = $1 AND organization_id = $2;

-- name: GetPasswordResetToken :one
SELECT * FROM iam.password_reset_token
WHERE token = $1 AND used_at IS NULL;

-- name: CreatePasswordResetToken :one
INSERT INTO iam.password_reset_token (
    id, user_id, token, expires_at
) VALUES (
    $1, $2, $3, $4
) RETURNING *;

-- name: MarkPasswordResetTokenUsed :exec
UPDATE iam.password_reset_token
SET used_at = now()
WHERE id = $1;

-- name: CreateSession :one
INSERT INTO iam.session (
    id, user_id, token_jti, issued_at, expires_at, ip_address, user_agent
) VALUES (
    $1, $2, $3, $4, $5, $6, $7
) RETURNING *;

-- name: GetActiveSessions :many
SELECT * FROM iam.session
WHERE user_id = $1 AND invalidated_at IS NULL
ORDER BY issued_at DESC;

-- name: GetMostRecentSession :one
SELECT * FROM iam.session
WHERE user_id = $1 AND invalidated_at IS NULL
ORDER BY issued_at DESC
LIMIT 1;

-- name: InvalidateSession :exec
UPDATE iam.session
SET invalidated_at = now()
WHERE id = $1;

-- name: InvalidateUserSessions :exec
UPDATE iam.session
SET invalidated_at = now()
WHERE user_id = $1 AND invalidated_at IS NULL;

-- name: GetEmployeeByOrgEmail :one
-- Find an existing employee by email within an organization.
-- Used by AcceptInvitationWithToken to reuse a pre-created employee record's
-- UUID as the shared ID for the new iam.user, preserving the design contract
-- where iam.user.id == organization.employee.id.
SELECT id, organization_id, given_name, family_name, email, hire_date, date_of_birth,
       phone_number, home_address, is_active, updated_at
FROM organization.employee
WHERE organization_id = $1 AND LOWER(email) = LOWER($2)
LIMIT 1;

-- name: CheckDuplicateEmployeeEmailsBatch :many
-- Check which emails already have an employee record in this organization.
-- Used in the import preview step to detect duplicates.
SELECT email, id AS employee_id, updated_at
FROM organization.employee
WHERE organization_id = $1
  AND email = ANY($2::text[])
ORDER BY email;

-- ===============================================
-- Role Management Queries (Feature 020)
-- ===============================================

-- name: CreateIAMRole :one
INSERT INTO iam.role (organization_id, name, description, is_system, source_default_role_id)
VALUES (sqlc.arg('organization_id')::uuid, sqlc.arg('name'), sqlc.arg('description'), sqlc.arg('is_system')::boolean, sqlc.arg('source_default_role_id'))
RETURNING *;

-- name: GetIAMRole :one
SELECT * FROM iam.role
WHERE organization_id = sqlc.arg('organization_id')::uuid AND id = sqlc.arg('id')::uuid;

-- name: ListIAMRoles :many
SELECT * FROM iam.role
WHERE organization_id = sqlc.arg('organization_id')::uuid
ORDER BY is_system DESC, name ASC;

-- name: UpdateIAMRole :one
UPDATE iam.role
SET name = sqlc.arg('name'), description = sqlc.arg('description')
WHERE organization_id = sqlc.arg('organization_id')::uuid AND id = sqlc.arg('id')::uuid
RETURNING *;

-- name: DeleteIAMRole :exec
DELETE FROM iam.role
WHERE organization_id = sqlc.arg('organization_id')::uuid
  AND id = sqlc.arg('id')::uuid
  AND is_system = false;

-- name: GetRolePermissions :many
SELECT permission_id FROM iam.role_permission
WHERE organization_id = sqlc.arg('organization_id')::uuid AND role_id = sqlc.arg('role_id')::uuid;

-- name: SetRolePermissions :exec
-- Used after clearing existing permissions for a role.
INSERT INTO iam.role_permission (organization_id, role_id, permission_id)
SELECT sqlc.arg('organization_id')::uuid, sqlc.arg('role_id')::uuid, unnest(sqlc.arg('permission_ids')::text[])
ON CONFLICT (organization_id, role_id, permission_id) DO NOTHING;

-- name: ClearRolePermissions :exec
DELETE FROM iam.role_permission
WHERE organization_id = sqlc.arg('organization_id')::uuid AND role_id = sqlc.arg('role_id')::uuid;

-- name: CountRoleEmployees :one
-- Count employees assigned to a given role.
SELECT COUNT(*) FROM iam.employee_role
WHERE organization_id = sqlc.arg('organization_id')::uuid AND role_id = sqlc.arg('role_id')::uuid;

-- ===============================================
-- Employee Role Assignment Queries
-- ===============================================

-- name: AssignRoleToEmployee :exec
INSERT INTO iam.employee_role (organization_id, employee_id, role_id, assigned_by)
VALUES (sqlc.arg('organization_id')::uuid, sqlc.arg('employee_id')::uuid, sqlc.arg('role_id')::uuid, sqlc.arg('assigned_by')::uuid)
ON CONFLICT (organization_id, employee_id, role_id) DO NOTHING;

-- name: RevokeRoleFromEmployee :exec
DELETE FROM iam.employee_role
WHERE organization_id = sqlc.arg('organization_id')::uuid
  AND employee_id = sqlc.arg('employee_id')::uuid
  AND role_id = sqlc.arg('role_id')::uuid;

-- name: ListEmployeeRoles :many
SELECT r.* FROM iam.role r
JOIN iam.employee_role er ON (r.organization_id, r.id) = (er.organization_id, er.role_id)
WHERE er.organization_id = sqlc.arg('organization_id')::uuid
  AND er.employee_id = sqlc.arg('employee_id')::uuid
ORDER BY r.is_system DESC, r.name ASC;

-- name: GetEmployeePermissions :many
-- Returns the effective permission set for a specific employee (union of all roles).
SELECT DISTINCT rp.permission_id
FROM iam.employee_role er
JOIN iam.role_permission rp
    ON (er.organization_id, er.role_id) = (rp.organization_id, rp.role_id)
WHERE er.organization_id = sqlc.arg('organization_id')::uuid
  AND er.employee_id = sqlc.arg('employee_id')::uuid;

-- ===============================================
-- Organization Role Seeding Queries
-- ===============================================

-- name: SeedOrgRolesFromDefaults :exec
-- Copies default roles to a new organization.
INSERT INTO iam.role (organization_id, name, description, is_system, source_default_role_id)
SELECT sqlc.arg('organization_id')::uuid, display_name, description, is_system, id
FROM public.default_role;

-- name: SeedOrgRolePermissionsFromDefaults :exec
-- Copies default role permissions to a new organization's roles.
INSERT INTO iam.role_permission (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, drp.permission_id
FROM iam.role r
JOIN public.default_role_permission drp ON r.source_default_role_id = drp.role_id
WHERE r.organization_id = sqlc.arg('organization_id')::uuid;

-- name: GetOrgRoleBySourceDefault :one
-- Find the org-specific role that was seeded from a default role.
SELECT * FROM iam.role
WHERE organization_id = sqlc.arg('organization_id')::uuid
  AND source_default_role_id = sqlc.arg('source_default_role_id');

-- ===============================================
-- Permission Reference Data Queries
-- ===============================================

-- name: ListPermissions :many
SELECT * FROM public.permission
ORDER BY domain, id;

-- name: ListPermissionsByDomain :many
SELECT * FROM public.permission
WHERE domain = sqlc.arg('domain')
ORDER BY id;

-- ===============================================
-- Employee Cards — lightweight batch lookup for UI
-- ===============================================

-- name: GetEmployeeCardsByIDs :many
-- Fetch display data for a batch of employees by ID.
-- Joins department for team name only.
-- Used by the GetEmployeeCards RPC to back UserCard components.
SELECT
    e.id,
    e.given_name,
    e.family_name,
    e.email,
    e.is_active,
    d.name AS department_name
FROM organization.employee e
LEFT JOIN organization.department_member dm
  ON dm.organization_id = e.organization_id
   AND dm.employee_id = e.id
LEFT JOIN organization.department d
  ON d.organization_id = dm.organization_id
   AND d.id = dm.department_id
WHERE e.id = ANY($1::uuid[])
  AND e.organization_id = $2;

-- name: GetLatestEmployeePresenceByIDs :many
-- Fetch latest live presence for a batch of employees.
-- Reads only notification.active_connection to stay Citus-friendly.
SELECT DISTINCT ON (ac.employee_id)
    ac.employee_id,
    CASE
        WHEN ac.presence_status = 'online_hidden' THEN 'offline'
        ELSE ac.presence_status
    END AS presence_status
FROM notification.active_connection ac
WHERE ac.organization_id = @organization_id
  AND ac.employee_id = ANY(@employee_ids::uuid[])
  AND ac.last_pong_at >= NOW() - make_interval(secs => @responsive_window_seconds::int)
ORDER BY ac.employee_id, ac.last_pong_at DESC;

-- =============================================================================
-- Org-Managed Accounts: Identity Lookup for PIN Login
-- =============================================================================

-- name: GetIdentityByOrgAndLoginIdentifier :one
-- Finds an org-scoped identity for PIN-based login by login_identifier OR email.
-- Org-managed workers are keyed on login_identifier; owners registered by email have a
-- NULL login_identifier, so the email fallback is what lets an owner hold a PIN.
-- Both columns are unique per organization but their union is not, so an exact
-- login_identifier match is ordered first to make the result deterministic.
-- CreateOrgAccount rejects '@' in login_identifier, which keeps the namespaces disjoint.
SELECT i.id, i.organization_id, i.email, i.login_identifier, i.identity_type, i.updated_at
FROM iam.identity i
WHERE i.organization_id = @organization_id::uuid
  AND (i.login_identifier = @identifier::text
       OR lower(i.email) = lower(@identifier::text))
-- NULLS LAST matters: an owner's login_identifier is NULL, and Postgres orders NULLs
-- first under DESC, which would rank a non-matching owner above an exact worker match.
ORDER BY (i.login_identifier = @identifier::text) DESC NULLS LAST
LIMIT 1;

-- name: GetOrgBySubdomain :one
-- Resolves organization from subdomain for PIN login flow.
SELECT id, subdomain
FROM public.organization
WHERE subdomain = @subdomain::text;

-- =============================================================================
-- Org-Managed Accounts: Credential Management
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
-- Org-Managed Accounts: Account Lockout
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
-- Org-Managed Accounts: Admin Operations
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

-- name: ListOrgManagedAccounts :many
-- Lists org-managed worker accounts with pagination.
-- Uses only distributed tables (co-located on organization_id) for Citus compatibility.
SELECT
    i.id,
    i.login_identifier,
    e.given_name,
    e.family_name,
    COALESCE(al.lockout_tier, 0)::int AS lockout_tier
FROM iam.identity i
JOIN organization.employee e ON (e.organization_id, e.id) = (i.organization_id, i.id)
LEFT JOIN iam.account_lockout al ON (al.organization_id, al.identity_id) = (i.organization_id, i.id)
WHERE i.organization_id = @organization_id::uuid
  AND i.login_identifier IS NOT NULL
  AND (sqlc.narg('cursor_id')::uuid IS NULL OR i.id > sqlc.narg('cursor_id')::uuid)
ORDER BY i.id
LIMIT @result_limit::int;

-- name: GetOrgManagedAccountCount :one
-- Gets total count of org-managed accounts for an org.
SELECT COUNT(*)::int
FROM iam.identity i
WHERE i.organization_id = @organization_id::uuid
  AND i.login_identifier IS NOT NULL;

-- name: GetUserStatusBatch :many
-- Returns user status info for a batch of user IDs (from iam.user local table).
SELECT id, status, last_login_at, created_at
FROM iam."user"
WHERE id = ANY(@ids::uuid[]);

-- name: CheckActivePINCredentialBatch :many
-- Returns identity IDs that have an active PIN credential.
SELECT DISTINCT identity_id
FROM iam.credential
WHERE organization_id = @organization_id::uuid
  AND identity_id = ANY(@identity_ids::uuid[])
  AND credential_type = 'pin'
  AND state = 'active';

-- name: InvalidateAllUserSessionsForDeactivation :exec
-- Invalidates all active sessions for a user (used on deactivation and credential reset).
UPDATE iam.session
SET invalidated_at = @invalidated_at::timestamptz
WHERE user_id = @user_id::uuid
  AND invalidated_at IS NULL;

-- =============================================================================
-- Org-Managed Accounts: Employee Lookup Extensions
-- =============================================================================

-- name: GetEmployeePersonalInfo :one
-- Gets date_of_birth and phone_number for PIN validation (reject PINs matching personal data).
SELECT date_of_birth, phone_number
FROM organization.employee
WHERE organization_id = @organization_id::uuid
  AND id = @id::uuid;

-- =============================================================================
-- Employee Listing Enrichment Queries (Feature 024: show roles + org-managed flag)
-- =============================================================================

-- name: GetRoleNamesForEmployeeBatch :many
-- Batch-fetch role names for a list of employees.
-- Returns (employee_id, role_name) pairs for enriching the employee listing.
SELECT er.employee_id, r.name AS role_name
FROM iam.employee_role er
JOIN iam.role r ON (r.organization_id, r.id) = (er.organization_id, er.role_id)
WHERE er.organization_id = @organization_id::uuid
  AND er.employee_id = ANY(@employee_ids::uuid[])
ORDER BY er.employee_id, r.is_system DESC, r.name ASC;

-- name: GetIsOrgManagedForBatch :many
-- Batch-fetch is_org_managed flag and user email for a list of user IDs.
-- Uses iam.user table (global, not org-scoped).
-- Returns email so the employee listing can show user account email alongside org email.
SELECT u.id, u.is_org_managed, u.email AS user_email
FROM iam.user u
WHERE u.id = ANY(@user_ids::uuid[]);

-- name: GetLoginIdentifierBatch :many
-- Batch-fetch login_identifier from iam.identity for a list of employee IDs.
-- Used to enrich the employee listing with the login handle for org-managed workers.
-- Distributed on organization_id for Citus compatibility.
SELECT i.id, i.login_identifier
FROM iam.identity i
WHERE i.organization_id = @organization_id::uuid
  AND i.id = ANY(@identity_ids::uuid[])
  AND i.login_identifier IS NOT NULL;
