-- Migration: Org-Managed Worker Accounts with PIN-Based Login
-- Feature 024: Supporting passkey-based login for org-managed accounts

-- =============================================================================
-- 1. ALTER iam.user: Make email nullable, add is_org_managed flag
-- =============================================================================
ALTER TABLE iam.user ALTER COLUMN email DROP NOT NULL;

ALTER TABLE iam.user ADD COLUMN is_org_managed BOOLEAN NOT NULL DEFAULT FALSE;

-- Replace existing unique index with partial unique index (allows multiple NULLs)
DROP INDEX IF EXISTS iam.idx_user_email;
DROP INDEX IF EXISTS idx_user_email;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_email ON iam.user(email) WHERE email IS NOT NULL;

COMMENT ON COLUMN iam.user.is_org_managed IS
'TRUE for workers created by org admins (PIN-based, no email required). FALSE for self-registered users (email-based).';

-- =============================================================================
-- 2. ALTER iam.identity: Make email nullable, add login_identifier
-- =============================================================================
ALTER TABLE iam.identity ALTER COLUMN email DROP NOT NULL;

ALTER TABLE iam.identity ADD COLUMN login_identifier TEXT;

-- At least one of email or login_identifier must be set
ALTER TABLE iam.identity ADD CONSTRAINT identity_has_identifier
    CHECK (email IS NOT NULL OR login_identifier IS NOT NULL);

-- Unique login_identifier per organization (only for non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS idx_identity_org_login_identifier
    ON iam.identity(organization_id, login_identifier) WHERE login_identifier IS NOT NULL;

-- Update the existing email unique index to handle nulls
DROP INDEX IF EXISTS iam.idx_iam_identity_org_email;
CREATE UNIQUE INDEX IF NOT EXISTS idx_iam_identity_org_email
    ON iam.identity(organization_id, email) WHERE email IS NOT NULL;

COMMENT ON COLUMN iam.identity.login_identifier IS
'Organization-scoped login handle for workers without email (e.g., badge number, username). Unique within org. NULL for email-based users.';

-- =============================================================================
-- 3. NEW TABLE: iam.credential — Unified org-scoped credential table
-- =============================================================================
CREATE TABLE IF NOT EXISTS iam.credential (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    identity_id UUID NOT NULL,
    credential_type TEXT NOT NULL
        CHECK (credential_type IN ('pin', 'biometric')),
    credential_hash TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'active'
        CHECK (state IN ('active', 'temporary', 'revoked')),
    expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '3 days'),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_credential_identity
        FOREIGN KEY (organization_id, identity_id)
        REFERENCES iam.identity(organization_id, id)
        ON DELETE CASCADE
);

SELECT create_distributed_table('iam.credential', 'organization_id', colocate_with => 'public.organization');

-- One active credential per type per identity
CREATE UNIQUE INDEX IF NOT EXISTS idx_credential_identity_type_active
    ON iam.credential(organization_id, identity_id, credential_type)
    WHERE state IN ('active', 'temporary');

CREATE INDEX IF NOT EXISTS idx_credential_identity
    ON iam.credential(organization_id, identity_id);

CREATE INDEX IF NOT EXISTS idx_credential_expires
    ON iam.credential(organization_id, expires_at)
    WHERE state = 'temporary';

COMMENT ON TABLE iam.credential IS
'Org-scoped credentials for PIN and biometric authentication. Supports temporary (admin-generated) and active (user-set) states. One active credential per type per identity. Temporary PINs default to 3-day expiry (configurable via column default). credential_type and state MUST align with backend constants.';

COMMENT ON COLUMN iam.credential.expires_at IS
'Expiry timestamp for temporary credentials. Default 3 days from creation (configurable by updating column default). NULL or past = expired. Only meaningful for state=temporary.';

COMMENT ON COLUMN iam.credential.credential_hash IS
'Bcrypt hash of the credential value (PIN digits, biometric key). Never stored in plaintext after initial generation.';

-- =============================================================================
-- 4. NEW TABLE: iam.account_lockout — Failed attempt tracking
-- =============================================================================
CREATE TABLE IF NOT EXISTS iam.account_lockout (
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    identity_id UUID NOT NULL,
    failed_attempts INT NOT NULL DEFAULT 0,
    lockout_tier INT NOT NULL DEFAULT 0
        CHECK (lockout_tier BETWEEN 0 AND 4),
    lockout_until TIMESTAMPTZ,
    last_failed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (organization_id, identity_id),
    CONSTRAINT fk_lockout_identity
        FOREIGN KEY (organization_id, identity_id)
        REFERENCES iam.identity(organization_id, id)
        ON DELETE CASCADE
);

SELECT create_distributed_table('iam.account_lockout', 'organization_id', colocate_with => 'public.organization');

COMMENT ON TABLE iam.account_lockout IS
'Tracks consecutive failed PIN authentication attempts per identity. Enforces escalating lockouts: tier 1 (3 fails, 1 min), tier 2 (4 fails, 5 min), tier 3 (5 fails, 15 min), tier 4 (6 fails, full lock requiring admin reset). Reset to tier 0 on successful auth. lockout_tier MUST align with backend constants.';

COMMENT ON COLUMN iam.account_lockout.lockout_tier IS
'Current lockout escalation tier: 0=no lockout, 1=1min, 2=5min, 3=15min, 4=full lock (admin reset required).';

-- =============================================================================
-- 5. SEED: Add iam.manageOrgAccounts permission
-- =============================================================================
INSERT INTO public.permission (id, domain, description) VALUES
('iam.manageOrgAccounts', 'iam', 'Create, manage, unlock, and deactivate org-managed worker accounts')
ON CONFLICT (id) DO NOTHING;

-- Add to default owner role permissions
INSERT INTO public.default_role_permission (role_id, permission_id)
VALUES ('owner', 'iam.manageOrgAccounts')
ON CONFLICT DO NOTHING;

-- Backfill: add permission to all existing owner roles
INSERT INTO iam.role_permission (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, 'iam.manageOrgAccounts'
FROM iam.role r
WHERE r.source_default_role_id = 'owner'
ON CONFLICT DO NOTHING;
