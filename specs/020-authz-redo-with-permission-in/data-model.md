# Data Model: Permission-Based Authorization System

**Feature Branch**: `020-authz-redo-with-permission-in`  
**Date**: 2026-03-02

---

## Schema Overview

This feature introduces **3 Citus reference tables** in the `public` schema (global template data) and **3 distributed tables** in the `iam` schema (org-scoped mutable data). It also **drops 1 table** (`iam.organization_membership`) and **cleans up** the stale `iam.identity_role` definition from schema.sql.

### Reference Tables (public schema — replicated to all nodes)

```sql
-- ============================================================================
-- public.permission: Canonical registry of all system permissions
-- Reference table — replicated to every Citus worker node for efficient JOINs
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.permission (
    id TEXT PRIMARY KEY,              -- e.g., 'chat.sendMessage'
    domain TEXT NOT NULL,             -- e.g., 'chat'
    description TEXT NOT NULL         -- Human-readable description
);

SELECT create_reference_table('public.permission');

COMMENT ON TABLE public.permission IS
'System-defined permission registry. Reference table replicated to all nodes. Permission IDs follow <domain>.<action> format. Rows are immutable at runtime — only modified by migrations.';

-- ============================================================================
-- public.default_role: Template roles copied to new organizations
-- Reference table — defines the baseline roles every org starts with
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.default_role (
    id TEXT PRIMARY KEY,              -- e.g., 'owner', 'operator', 'employee'
    display_name TEXT NOT NULL,       -- e.g., 'Owner'
    description TEXT NOT NULL,
    is_system BOOLEAN NOT NULL DEFAULT false  -- System roles cannot be deleted from orgs
);

SELECT create_reference_table('public.default_role');

COMMENT ON TABLE public.default_role IS
'Template roles that get copied to iam.role when a new organization is created. is_system=true roles cannot be deleted by org admins.';

-- ============================================================================
-- public.default_role_permission: Template role→permission mappings
-- Reference table — defines which permissions each default role has
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.default_role_permission (
    role_id TEXT NOT NULL REFERENCES public.default_role(id) ON DELETE CASCADE,
    permission_id TEXT NOT NULL REFERENCES public.permission(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

SELECT create_reference_table('public.default_role_permission');

COMMENT ON TABLE public.default_role_permission IS
'Maps default roles to permissions. Copied to iam.role_permission for new organizations.';
```

### Distributed Tables (iam schema — org-scoped)

```sql
-- ============================================================================
-- iam.role: Organization-specific roles (copied from defaults + custom-created)
-- Distributed on organization_id, colocated with public.organization
-- ============================================================================
CREATE TABLE IF NOT EXISTS iam.role (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    name TEXT NOT NULL,               -- Display name (e.g., 'Owner', 'Project Lead')
    description TEXT,
    is_system BOOLEAN NOT NULL DEFAULT false,  -- System roles can't be deleted
    source_default_role_id TEXT,      -- NULL for custom roles; references default_role.id for seeded roles
    PRIMARY KEY (organization_id, id),
    UNIQUE (organization_id, name)
);

SELECT create_distributed_table('iam.role', 'organization_id', colocate_with => 'public.organization');

CREATE INDEX IF NOT EXISTS idx_role_org_system ON iam.role(organization_id, is_system);

COMMENT ON TABLE iam.role IS
'Organization-specific roles. System roles are seeded from public.default_role on org creation and cannot be deleted. Custom roles have source_default_role_id = NULL.';
COMMENT ON COLUMN iam.role.source_default_role_id IS
'Links back to public.default_role.id for roles seeded during org creation. NULL for custom-created roles. NOT a foreign key since reference tables cannot be FK targets from distributed tables in all Citus versions.';

-- ============================================================================
-- iam.role_permission: Role→permission mappings per organization
-- Distributed on organization_id, colocated for efficient JOINs with iam.role
-- ============================================================================
CREATE TABLE IF NOT EXISTS iam.role_permission (
    organization_id UUID NOT NULL,
    role_id UUID NOT NULL,
    permission_id TEXT NOT NULL REFERENCES public.permission(id) ON DELETE CASCADE,
    PRIMARY KEY (organization_id, role_id, permission_id),
    CONSTRAINT fk_role_permission_role
        FOREIGN KEY (organization_id, role_id)
        REFERENCES iam.role(organization_id, id)
        ON DELETE CASCADE
);

SELECT create_distributed_table('iam.role_permission', 'organization_id', colocate_with => 'public.organization');

COMMENT ON TABLE iam.role_permission IS
'Maps organization roles to permissions. Seeded from public.default_role_permission on org creation. Mutable — owners can add/remove permissions from roles.';

-- ============================================================================
-- iam.employee_role: Employee→role assignments (replaces organization_membership.role)
-- Distributed on organization_id, colocated for efficient JOINs
-- ============================================================================
CREATE TABLE IF NOT EXISTS iam.employee_role (
    organization_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    role_id UUID NOT NULL,
    assigned_at TIMESTAMPTZ DEFAULT now(),
    assigned_by UUID,                 -- user_id of who assigned this role (NULL for system-assigned)
    PRIMARY KEY (organization_id, employee_id, role_id),
    CONSTRAINT fk_employee_role_role
        FOREIGN KEY (organization_id, role_id)
        REFERENCES iam.role(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_employee_role_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE CASCADE
);

SELECT create_distributed_table('iam.employee_role', 'organization_id', colocate_with => 'public.organization');

CREATE INDEX IF NOT EXISTS idx_employee_role_employee ON iam.employee_role(organization_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_role_role ON iam.employee_role(organization_id, role_id);

COMMENT ON TABLE iam.employee_role IS
'Many-to-many: employees can have multiple roles. Effective permissions = union of all assigned role permissions. Replaces iam.organization_membership.role column.';
```

### Tables to Drop

```sql
-- Drop iam.organization_membership (replaced by iam.employee_role)
-- Migration must first copy existing role assignments to iam.employee_role
DROP TABLE IF EXISTS iam.organization_membership;

-- iam.identity_role was already dropped by migration 20260223000001
-- Remove its definition from schema.sql (cleanup only)
```

---

## Seed Data (Reference Tables)

### Permissions (~80 entries)

```sql
INSERT INTO public.permission (id, domain, description) VALUES
-- IAM Domain
('iam.login', 'iam', 'Login and exchange tokens'),
('iam.changePassword', 'iam', 'Change own password'),
('iam.requestPasswordReset', 'iam', 'Request password reset'),
('iam.manageSessions', 'iam', 'Logout and manage active sessions'),
('iam.viewProfile', 'iam', 'View own profile'),
('iam.updateProfile', 'iam', 'Update own profile'),
('iam.linkSSO', 'iam', 'Link and unlink SSO identities'),
('iam.viewOrganizations', 'iam', 'View user organizations'),
('iam.switchOrganization', 'iam', 'Switch active organization'),
('iam.inviteUser', 'iam', 'Invite users to organization'),
('iam.cancelInvitation', 'iam', 'Cancel pending invitations'),
('iam.listInvitations', 'iam', 'List pending invitations'),
('iam.acceptInvitation', 'iam', 'Accept invitation to join organization'),
('iam.listEmployees', 'iam', 'List employees in organization'),
('iam.importEmployees', 'iam', 'Import employees via CSV/Excel'),
('iam.manageRoles', 'iam', 'Create, update, delete roles and assign/revoke roles'),
('iam.viewRoles', 'iam', 'View roles, permissions, and employee role assignments'),
-- Organization Domain
('org.viewOrganization', 'org', 'View organization details'),
('org.checkSubdomain', 'org', 'Check subdomain availability'),
('org.register', 'org', 'Register new organization'),
('org.searchEmployees', 'org', 'Search and autocomplete employees'),
('org.searchDepartments', 'org', 'Search and autocomplete departments'),
-- Department Domain
('dept.view', 'dept', 'View department tree, details, and members'),
('dept.create', 'dept', 'Create departments'),
('dept.update', 'dept', 'Update department details'),
('dept.move', 'dept', 'Move departments in hierarchy'),
('dept.delete', 'dept', 'Delete departments'),
('dept.assignEmployee', 'dept', 'Assign employees to departments'),
('dept.removeEmployee', 'dept', 'Remove employees from departments'),
('dept.setManager', 'dept', 'Set or clear department managers'),
-- Chat Domain
('chat.createChannel', 'chat', 'Create chat channels'),
('chat.viewChannel', 'chat', 'View channel details and list channels'),
('chat.updateChannel', 'chat', 'Update channel settings'),
('chat.archiveChannel', 'chat', 'Archive and unarchive channels'),
('chat.joinChannel', 'chat', 'Join and leave channels'),
('chat.manageMember', 'chat', 'Invite, remove, and update member roles in channels'),
('chat.listMembers', 'chat', 'List channel members'),
('chat.updateNotificationPref', 'chat', 'Update channel notification preferences'),
('chat.sendMessage', 'chat', 'Send and reply to messages'),
('chat.editMessage', 'chat', 'Edit own messages'),
('chat.deleteMessage', 'chat', 'Delete messages'),
('chat.viewMessages', 'chat', 'View and search messages'),
('chat.markRead', 'chat', 'Mark channels as read'),
('chat.react', 'chat', 'Add and remove reactions'),
('chat.typing', 'chat', 'Send typing indicators'),
('chat.search', 'chat', 'Search channels and messages'),
('chat.directMessage', 'chat', 'Create or get direct messages'),
('chat.viewConfig', 'chat', 'View chat configuration'),
('chat.updateConfig', 'chat', 'Update chat sidebar and category settings'),
('chat.filesUpload', 'chat', 'Upload files in chat channels'),
-- Files Domain
('files.upload', 'files', 'Upload files'),
('files.download', 'files', 'Download files'),
('files.viewMetadata', 'files', 'View file metadata'),
('files.list', 'files', 'List files'),
('files.delete', 'files', 'Delete files'),
('files.viewQuota', 'files', 'View storage quota'),
('files.updateQuota', 'files', 'Update storage quota'),
('files.validate', 'files', 'Validate files'),
('files.manageAccess', 'files', 'Manage file access rules'),
('files.search', 'files', 'Search files'),
('files.pdfConversion', 'files', 'View and trigger PDF conversions'),
('files.contentIndex', 'files', 'View content index status'),
-- Documents Domain
('docs.create', 'docs', 'Create documents'),
('docs.view', 'docs', 'View, list, and search documents'),
('docs.update', 'docs', 'Update documents and status'),
('docs.delete', 'docs', 'Delete documents'),
('docs.viewVersions', 'docs', 'View version history and diffs'),
('docs.manageAccess', 'docs', 'Manage document access rules'),
('docs.follow', 'docs', 'Follow and unfollow documents'),
('docs.comment', 'docs', 'Add, reply, resolve, and delete comments'),
('docs.embed', 'docs', 'Create and manage document embeds'),
('docs.collaborate', 'docs', 'Join collaborative editing sessions'),
('docs.react', 'docs', 'Add and remove document reactions'),
-- Collaboration Domain
('collab.createProject', 'collab', 'Create projects'),
('collab.viewProject', 'collab', 'View and list projects'),
('collab.updateProject', 'collab', 'Update project settings'),
('collab.archiveProject', 'collab', 'Archive projects'),
('collab.manageProjectState', 'collab', 'Manage project workflow states'),
('collab.manageTaskLevel', 'collab', 'Manage task priority levels'),
('collab.createTask', 'collab', 'Create tasks'),
('collab.viewTask', 'collab', 'View and list tasks'),
('collab.updateTask', 'collab', 'Update and move tasks'),
('collab.deleteTask', 'collab', 'Delete tasks'),
('collab.assignTask', 'collab', 'Assign and unassign tasks'),
('collab.watchTask', 'collab', 'Watch and unwatch tasks'),
('collab.manageCustomField', 'collab', 'Manage custom fields'),
('collab.setCustomFieldValue', 'collab', 'Set custom field values on tasks'),
('collab.manageWorkflowRule', 'collab', 'Manage workflow automation rules'),
('collab.manageProjectMember', 'collab', 'Manage project membership and roles'),
('collab.manageSavedView', 'collab', 'Create, update, delete saved views'),
('collab.viewAnalytics', 'collab', 'View task analytics'),
('collab.exportTasks', 'collab', 'Export tasks to CSV'),
('collab.taskFileUpload', 'collab', 'Upload files to tasks'),
-- Notification Domain
('notif.publish', 'notif', 'Publish notifications'),
('notif.view', 'notif', 'View notifications and unread counts'),
('notif.markRead', 'notif', 'Mark notifications as read'),
('notif.delete', 'notif', 'Delete notifications'),
('notif.stream', 'notif', 'Stream real-time notifications'),
('notif.updatePresence', 'notif', 'Update presence status'),
('notif.viewPresence', 'notif', 'View employee presence'),
('notif.managePushToken', 'notif', 'Register and manage push tokens'),
('notif.presenceSettings', 'notif', 'Manage presence visibility settings'),
-- Preference Domain
('pref.view', 'pref', 'View user preferences'),
('pref.update', 'pref', 'Update user preferences'),
('pref.reset', 'pref', 'Reset user preferences')
ON CONFLICT (id) DO NOTHING;
```

### Default Roles

```sql
INSERT INTO public.default_role (id, display_name, description, is_system) VALUES
('owner', 'Owner', 'Full access to all features. Cannot have role management permissions removed.', true),
('operator', 'Operator', 'Administrative access to most features except employee import and quota management.', true),
('employee', 'Employee', 'Standard access to day-to-day features.', true)
ON CONFLICT (id) DO NOTHING;
```

### Default Role→Permission Mappings

```sql
-- Owner: ALL permissions
INSERT INTO public.default_role_permission (role_id, permission_id)
SELECT 'owner', id FROM public.permission
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Operator: All except importEmployees, updateQuota, and role management
INSERT INTO public.default_role_permission (role_id, permission_id)
SELECT 'operator', id FROM public.permission
WHERE id NOT IN ('iam.importEmployees', 'files.updateQuota', 'iam.manageRoles')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Employee: Non-administrative permissions
INSERT INTO public.default_role_permission (role_id, permission_id)
SELECT 'employee', id FROM public.permission
WHERE id NOT IN (
    'iam.inviteUser',
    'iam.cancelInvitation',
    'iam.importEmployees',
    'iam.manageRoles',
    'iam.viewRoles',
    'dept.create',
    'dept.update',
    'dept.move',
    'dept.delete',
    'dept.setManager',
    'files.updateQuota'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;
```

---

## Key SQL Queries (sqlc definitions)

### Permission Resolution (replaces GetUserRolesInOrg)

```sql
-- name: GetUserPermissionsInOrg :many
-- Returns the effective (union) permission set for a user in an organization.
-- Joins through employee → employee_role → role_permission to collect all permissions
-- from all assigned roles. All tables colocated on organization_id for local JOINs.
SELECT DISTINCT rp.permission_id
FROM iam.employee_role er
JOIN iam.role_permission rp
    ON (er.organization_id, er.role_id) = (rp.organization_id, rp.role_id)
JOIN organization.employee e
    ON (er.organization_id, er.employee_id) = (e.organization_id, e.id)
WHERE e.user_id = sqlc.arg('user_id')::uuid
  AND er.organization_id = sqlc.arg('organization_id')::uuid;
```

### Role CRUD

```sql
-- name: CreateRole :one
INSERT INTO iam.role (organization_id, name, description, is_system, source_default_role_id)
VALUES (sqlc.arg('organization_id')::uuid, sqlc.arg('name'), sqlc.arg('description'), sqlc.arg('is_system')::boolean, sqlc.arg('source_default_role_id'))
RETURNING *;

-- name: GetRole :one
SELECT * FROM iam.role
WHERE organization_id = sqlc.arg('organization_id')::uuid AND id = sqlc.arg('id')::uuid;

-- name: ListRoles :many
SELECT * FROM iam.role
WHERE organization_id = sqlc.arg('organization_id')::uuid
ORDER BY is_system DESC, name ASC;

-- name: UpdateRole :one
UPDATE iam.role
SET name = sqlc.arg('name'), description = sqlc.arg('description')
WHERE organization_id = sqlc.arg('organization_id')::uuid AND id = sqlc.arg('id')::uuid
RETURNING *;

-- name: DeleteRole :exec
DELETE FROM iam.role
WHERE organization_id = sqlc.arg('organization_id')::uuid
  AND id = sqlc.arg('id')::uuid
  AND is_system = false;

-- name: GetRolePermissions :many
SELECT permission_id FROM iam.role_permission
WHERE organization_id = sqlc.arg('organization_id')::uuid AND role_id = sqlc.arg('role_id')::uuid;

-- name: SetRolePermissions :exec
-- Used after clearing existing permissions for a role
INSERT INTO iam.role_permission (organization_id, role_id, permission_id)
SELECT sqlc.arg('organization_id')::uuid, sqlc.arg('role_id')::uuid, unnest(sqlc.arg('permission_ids')::text[])
ON CONFLICT (organization_id, role_id, permission_id) DO NOTHING;

-- name: ClearRolePermissions :exec
DELETE FROM iam.role_permission
WHERE organization_id = sqlc.arg('organization_id')::uuid AND role_id = sqlc.arg('role_id')::uuid;
```

### Employee Role Assignment

```sql
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
-- Returns the effective permission set for a specific employee (union of all roles)
SELECT DISTINCT rp.permission_id
FROM iam.employee_role er
JOIN iam.role_permission rp
    ON (er.organization_id, er.role_id) = (rp.organization_id, rp.role_id)
WHERE er.organization_id = sqlc.arg('organization_id')::uuid
  AND er.employee_id = sqlc.arg('employee_id')::uuid;
```

### Organization Role Seeding (used during org registration)

```sql
-- name: SeedOrgRolesFromDefaults :exec
-- Copies default roles to a new organization
INSERT INTO iam.role (organization_id, name, description, is_system, source_default_role_id)
SELECT sqlc.arg('organization_id')::uuid, display_name, description, is_system, id
FROM public.default_role;

-- name: SeedOrgRolePermissionsFromDefaults :exec
-- Copies default role permissions to a new organization's roles
INSERT INTO iam.role_permission (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, drp.permission_id
FROM iam.role r
JOIN public.default_role_permission drp ON r.source_default_role_id = drp.role_id
WHERE r.organization_id = sqlc.arg('organization_id')::uuid;
```

### List Permissions (global reference data)

```sql
-- name: ListPermissions :many
SELECT * FROM public.permission
ORDER BY domain, id;

-- name: ListPermissionsByDomain :many
SELECT * FROM public.permission
WHERE domain = sqlc.arg('domain')
ORDER BY id;
```

---

## Entity Relationship Diagram

```
public.permission (ref)          public.default_role (ref)
       |                                |
       |                    public.default_role_permission (ref)
       |                         |              |
       |    [seed on org create] |              | [seed on org create]
       v                         v              v
iam.role_permission  <---  iam.role  --->  iam.employee_role  --->  organization.employee
       |                     |                    |
       +-- organization_id --+--- organization_id +--- organization_id (all colocated)
```

---

## Migration Strategy

**Migration Sequence** (next timestamp: `20260302000001`):

1. **`20260302000001_create_permission_ref_tables.up.sql`**:
   - Create `public.permission`, `public.default_role`, `public.default_role_permission` reference tables
   - Seed all permission and default role data

2. **`20260302000002_create_iam_role_tables.up.sql`**:
   - Create `iam.role`, `iam.role_permission`, `iam.employee_role` distributed tables
   - Create indexes

3. **`20260302000003_migrate_membership_to_roles.up.sql`**:
   - Seed `iam.role` and `iam.role_permission` for all existing organizations from default templates
   - Migrate existing `iam.organization_membership` role assignments to `iam.employee_role`
   - Drop `iam.organization_membership`

**Down migrations** reverse each step (recreate `organization_membership`, drop new tables, drop reference tables).

---

## Citus Compliance Checklist

- [x] All tenant tables have composite primary key `(organization_id, id)` or `(organization_id, ...)`
- [x] All unique indexes start with `organization_id`
- [x] All foreign keys reference composite keys including `organization_id`
- [x] No triggers defined on distributed tables
- [x] No `ON DELETE SET NULL` or `ON DELETE SET DEFAULT` in foreign keys
- [x] No `now()` in `ON CONFLICT DO UPDATE` clauses (only `ON CONFLICT DO NOTHING` used)
- [x] All JOINs include `organization_id` in the join condition
- [x] Reference tables use `create_reference_table()` (not `create_distributed_table()`)
- [x] Distributed tables colocated with `public.organization` via `colocate_with`
