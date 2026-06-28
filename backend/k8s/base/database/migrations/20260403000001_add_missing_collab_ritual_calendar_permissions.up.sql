-- =============================================================================
-- Migration: Add missing ritual, evidence, and calendar permissions
-- =============================================================================
-- These permissions were defined in schema.sql but not yet applied via
-- a migration, so they are absent from the live public.permission table
-- and from existing organizations' iam.role_permission tables.
--
-- Affected roles (all three default roles should receive all of these):
--   - owner:    full access (all permissions)
--   - operator: all except importEmployees, updateQuota, manageRoles, manageOrgAccounts
--   - employee: all except admin/management permissions (same exclusion list as init)

-- =============================================================================
-- 1. Insert missing permissions into the reference table
-- =============================================================================
INSERT INTO public.permission (id, domain, description) VALUES
('collab.manageRitualDefinition',   'collab',    'Create, update, and archive ritual definitions'),
('collab.viewRitualDefinition',     'collab',    'View and list ritual definitions'),
('collab.manageEvidenceRequirement','collab',    'Create and manage evidence requirements'),
('collab.viewEvidenceRequirement',  'collab',    'View and list evidence requirements'),
('collab.submitEvidence',           'collab',    'Submit evidence for ritual tasks'),
('collab.reviewEvidence',           'collab',    'Approve or reject submitted evidence'),
('calendar.manageResources',        'calendar',  'Create, update, delete, and manage ACL on calendar resources')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 2. Update default_role_permission reference table (for future org creation)
-- =============================================================================

-- Owner: ALL permissions
INSERT INTO public.default_role_permission (role_id, permission_id)
SELECT 'owner', id FROM public.permission
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Operator: All except importEmployees, updateQuota, and role management
INSERT INTO public.default_role_permission (role_id, permission_id)
SELECT 'operator', id FROM public.permission
WHERE id NOT IN ('iam.importEmployees', 'files.updateQuota', 'iam.manageRoles', 'iam.manageOrgAccounts')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Employee: Non-administrative permissions
INSERT INTO public.default_role_permission (role_id, permission_id)
SELECT 'employee', id FROM public.permission
WHERE id NOT IN (
    'iam.inviteUser',
    'iam.cancelInvitation',
    'iam.importEmployees',
    'iam.manageRoles',
    'iam.manageOrgAccounts',
    'dept.create',
    'dept.update',
    'dept.move',
    'dept.delete',
    'dept.setManager',
    'files.updateQuota'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- =============================================================================
-- 3. Back-fill existing organization role permissions
-- =============================================================================

-- Owner roles in all orgs: get all new permissions
INSERT INTO iam.role_permission (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM iam.role r, (VALUES
    ('collab.manageRitualDefinition'),
    ('collab.viewRitualDefinition'),
    ('collab.manageEvidenceRequirement'),
    ('collab.viewEvidenceRequirement'),
    ('collab.submitEvidence'),
    ('collab.reviewEvidence'),
    ('calendar.manageResources')
) AS p(id)
WHERE r.source_default_role_id = 'owner'
ON CONFLICT (organization_id, role_id, permission_id) DO NOTHING;

-- Operator roles in all orgs: get all new permissions (none of them are excluded)
INSERT INTO iam.role_permission (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM iam.role r, (VALUES
    ('collab.manageRitualDefinition'),
    ('collab.viewRitualDefinition'),
    ('collab.manageEvidenceRequirement'),
    ('collab.viewEvidenceRequirement'),
    ('collab.submitEvidence'),
    ('collab.reviewEvidence'),
    ('calendar.manageResources')
) AS p(id)
WHERE r.source_default_role_id = 'operator'
ON CONFLICT (organization_id, role_id, permission_id) DO NOTHING;

-- Employee roles in all orgs: get all new permissions (none are in the exclusion list)
INSERT INTO iam.role_permission (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM iam.role r, (VALUES
    ('iam.viewRoles'),
    ('collab.manageRitualDefinition'),
    ('collab.viewRitualDefinition'),
    ('collab.manageEvidenceRequirement'),
    ('collab.viewEvidenceRequirement'),
    ('collab.submitEvidence'),
    ('collab.reviewEvidence'),
    ('calendar.manageResources')
) AS p(id)
WHERE r.source_default_role_id = 'employee'
ON CONFLICT (organization_id, role_id, permission_id) DO NOTHING;
