-- Reverse migration: Org-Managed Worker Accounts with PIN-Based Login

-- Remove backfilled permission from existing owner roles
DELETE FROM iam.role_permission WHERE permission_id = 'iam.manageOrgAccounts';

-- Remove from default role permissions
DELETE FROM public.default_role_permission WHERE permission_id = 'iam.manageOrgAccounts';

-- Remove the permission entry
DELETE FROM public.permission WHERE id = 'iam.manageOrgAccounts';

-- Drop account_lockout table
DROP TABLE IF EXISTS iam.account_lockout;

-- Drop credential table
DROP TABLE IF EXISTS iam.credential;

-- Remove login_identifier from iam.identity
ALTER TABLE iam.identity DROP CONSTRAINT IF EXISTS identity_has_identifier;
DROP INDEX IF EXISTS iam.idx_identity_org_login_identifier;
ALTER TABLE iam.identity DROP COLUMN IF EXISTS login_identifier;

-- Restore email NOT NULL on iam.identity
-- NOTE: This will fail if there are rows with NULL email. Manual data cleanup required.
ALTER TABLE iam.identity ALTER COLUMN email SET NOT NULL;

-- Restore original email unique index
DROP INDEX IF EXISTS iam.idx_iam_identity_org_email;
CREATE UNIQUE INDEX IF NOT EXISTS idx_iam_identity_org_email ON iam.identity(organization_id, email);

-- Remove is_org_managed from iam.user
ALTER TABLE iam.user DROP COLUMN IF EXISTS is_org_managed;

-- Restore email NOT NULL on iam.user
-- NOTE: This will fail if there are rows with NULL email. Manual data cleanup required.
ALTER TABLE iam.user ALTER COLUMN email SET NOT NULL;

-- Restore original email index
DROP INDEX IF EXISTS idx_user_email;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_email ON iam.user(email);
