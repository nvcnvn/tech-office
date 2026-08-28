-- WARNING: Database migrations are managed by backend/scripts/migrate.sh.
-- DO NOT apply this file directly in production. Use `backend/scripts/migrate.sh`,
-- which runs timestamped `.up.sql` files under `backend/database/migrations`
-- with `psql` and records progress in `public.schema_migrations`.
-- This file is kept as a canonical schema reference for developers and documentation.

-- TechOffice uses schema to separate business domains
CREATE EXTENSION IF NOT EXISTS citus;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgroonga;

-- "iam" schema for Identity and Access Management (IAM)
-- This schema contains tables related to user authentication and authorization.
-- Created FIRST to allow other schemas to reference iam.identity
CREATE SCHEMA IF NOT EXISTS iam;

-- "organization" schema for organizational data
-- This schema contains tables related to the organizational structure, employees, departments, and roles.
CREATE SCHEMA IF NOT EXISTS organization;

-- external integrations and webhooks
-- "notification" schema for centralized notification hub
-- This schema contains tables for real-time notification delivery, connection registry, and delivery tracking
CREATE SCHEMA IF NOT EXISTS notification;

-- detailed inventory and equipment management
-- "chat" schema for channel-based messaging with threaded replies
-- This schema contains tables for channels (public/private communication spaces), messages (content with optional replies),
-- channel memberships (access control and notification preferences), reactions (emoji responses), and typing indicators.
CREATE SCHEMA IF NOT EXISTS chat;

-- Extended business domains for comprehensive SME management
CREATE SCHEMA IF NOT EXISTS timekeeping;

-- time tracking, schedules, leave management
CREATE SCHEMA IF NOT EXISTS learning;

-- training, courses, skills tracking
CREATE SCHEMA IF NOT EXISTS compliance;

-- policies, certifications, acknowledgments
CREATE SCHEMA IF NOT EXISTS payroll;

-- compensation, benefits management
CREATE SCHEMA IF NOT EXISTS inventory;

-- "hiring" schema for hiring and recruitment
-- This schema contains tables related to job postings, applications, candidates, interviews scheduling and interviews recording, offers, and onboarding.
CREATE SCHEMA IF NOT EXISTS hiring;

-- "retention" schema for employee retention and engagement
-- This schema contains tables related to performance reviews, goals, feedback, surveys, and recognition.
CREATE SCHEMA IF NOT EXISTS retention;

-- "communication" schema for internal communications
-- This schema contains tables related to announcements, newsletters, and messaging.
CREATE SCHEMA IF NOT EXISTS communication;

-- "collaboration" schema for task and project management
-- This schema contains tables related to tasks, projects, deadlines, collaboration, and real-time communication during work.
CREATE SCHEMA IF NOT EXISTS collaboration;

-- "calendar" schema for calendar and scheduling
-- This schema contains tables related to events, meetings, and reminders.
CREATE SCHEMA IF NOT EXISTS calendar;

-- Additional business domains and reusable schemas
CREATE SCHEMA IF NOT EXISTS files;

-- file storage metadata (attachments used by many domains)
CREATE SCHEMA IF NOT EXISTS finance;

-- invoicing, billing, payments
CREATE SCHEMA IF NOT EXISTS procurement;

-- purchase orders, suppliers
CREATE SCHEMA IF NOT EXISTS assets;

-- company assets, assignments
CREATE SCHEMA IF NOT EXISTS crm;

-- customers, contacts, deals
CREATE SCHEMA IF NOT EXISTS support;

-- tickets, SLAs
CREATE SCHEMA IF NOT EXISTS integrations;

-- flows workflow
CREATE SCHEMA IF NOT EXISTS flows;

-- "docs" schema for document management (Notion/Confluence-style)
-- This schema contains tables for hierarchical documents, version history, access control, 
-- comments, section embeds, and real-time collaboration tracking.
CREATE SCHEMA IF NOT EXISTS docs;


-- Trigram fuzzy matching for multilingual search
-- Note: Search queries use set_limit(0.1) for better short query matching (default is 0.3)
-- "public" schema is for shared data accessible by the application, but not specific to any organization.
-- The organizations table is the master list of your customers.
-- All other tables in other schemas will have a organization_id column to link back to this table
CREATE TABLE IF NOT EXISTS public.organization(
    id uuid PRIMARY KEY DEFAULT uuidv7(),
    company_name text NOT NULL,
    subdomain varchar(63) NOT NULL, -- e.g., 'acme' for acme.your-hr-app.com
    project_id uuid NOT NULL, -- Link to legacy external auth project (deprecated)
    app_id uuid NOT NULL, -- Link to legacy external application record (deprecated)
    client_id text NULL, -- OAuth2 client ID for this organization
    status text CHECK (status IN ('active', 'suspended', 'deleted')) NOT NULL DEFAULT 'active',
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, subdomain),
    UNIQUE (id, company_name),
    UNIQUE (id, project_id),
    UNIQUE (id, app_id),
    UNIQUE (id, client_id)
);

SELECT create_distributed_table('public.organization', 'id');

COMMENT ON COLUMN public.organization.status IS 'Organization lifecycle status: active, suspended, deleted. MUST align with backend constants in internal/organization/constants.go and frontend TypeScript types in packages/apis/src/organization.ts';

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

-- ============================================================================
-- Seed Data: Permissions (~80 entries)
-- ============================================================================
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

-- ============================================================================
-- Seed Data: Default Roles
-- ============================================================================
INSERT INTO public.default_role (id, display_name, description, is_system) VALUES
('owner', 'Owner', 'Full access to all features. Cannot have role management permissions removed.', true),
('operator', 'Operator', 'Administrative access to most features except employee import and quota management.', true),
('employee', 'Employee', 'Standard access to day-to-day features.', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- Seed Data: Default Role→Permission Mappings
-- ============================================================================

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
    'dept.create',
    'dept.update',
    'dept.move',
    'dept.delete',
    'dept.setManager',
    'files.updateQuota'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- iam.identity: Core identity table for all users (humans and service accounts)
-- This is the master identity table - all users must have a record here
CREATE TABLE IF NOT EXISTS iam.identity(
    id uuid DEFAULT uuidv7(),
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    email varchar(255) NOT NULL,
    identity_type text CHECK (identity_type IN ('human', 'service')) NOT NULL DEFAULT 'human',
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- Composite primary key for Citus sharding (organization_id first)
    PRIMARY KEY (organization_id, id)
);

SELECT create_distributed_table('iam.identity', 'organization_id', colocate_with => 'public.organization');

CREATE UNIQUE INDEX IF NOT EXISTS idx_iam_identity_org_email ON iam.identity(organization_id, email);

-- Trigram index for fuzzy search on email addresses
CREATE INDEX IF NOT EXISTS idx_identity_email_trgm ON iam.identity USING GIN(email gin_trgm_ops);

COMMENT ON INDEX iam.idx_identity_email_trgm IS 'Trigram index for fuzzy search on email addresses. Supports typo-tolerant email search for employee lookup.';

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
    permission_id TEXT NOT NULL,
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
        ON DELETE CASCADE
);

SELECT create_distributed_table('iam.employee_role', 'organization_id', colocate_with => 'public.organization');

CREATE INDEX IF NOT EXISTS idx_employee_role_employee ON iam.employee_role(organization_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_role_role ON iam.employee_role(organization_id, role_id);

COMMENT ON TABLE iam.employee_role IS
'Many-to-many: employees can have multiple roles. Effective permissions = union of all assigned role permissions. Replaces iam.organization_membership.role column.';

-- iam.user_preference: User-specific application preferences including theme mode
CREATE TABLE IF NOT EXISTS iam.user_preference (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL,
    
    -- Theme preferences
    theme_mode TEXT NOT NULL CHECK (theme_mode IN ('light', 'dark')) DEFAULT 'light',
    preference_source TEXT NOT NULL CHECK (preference_source IN ('manual', 'os_default')) DEFAULT 'os_default',
    
    -- Extensibility for future preferences (notifications, locale, timezone, etc.)
    additional_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
    
    -- Timestamps
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding (organization_id first)
    PRIMARY KEY (organization_id, id),
    
    -- One preference record per employee
    CONSTRAINT unique_employee_preference UNIQUE (organization_id, employee_id)
);

SELECT create_distributed_table('iam.user_preference', 'organization_id', colocate_with => 'public.organization');

-- Indexes for user_preference
CREATE INDEX IF NOT EXISTS idx_user_preference_employee 
    ON iam.user_preference(organization_id, employee_id);

CREATE INDEX IF NOT EXISTS idx_user_preference_updated 
    ON iam.user_preference(organization_id, updated_at DESC);

COMMENT ON TABLE iam.user_preference IS 
'User-specific application preferences including theme mode, with extensibility for future preferences (notifications, locale, timezone). One record per employee.';

COMMENT ON COLUMN iam.user_preference.theme_mode IS 
'Active theme mode: light or dark. MUST align with backend constants in internal/preference/constants.go and frontend TypeScript type ThemeMode in packages/apis/src/types.ts';

COMMENT ON COLUMN iam.user_preference.preference_source IS 
'How theme was selected: manual (user clicked toggle) or os_default (detected from prefers-color-scheme). Determines whether OS preference changes should override theme (only if os_default).';

COMMENT ON COLUMN iam.user_preference.additional_preferences IS 
'JSONB field for future preference extensions (e.g., {"locale": "en-US", "timezone": "America/New_York", "notifications": {...}}). Enables schema evolution without migrations.';

-- =============================================================================
-- IAM: Global User Accounts & Authentication (Feature 018)
-- =============================================================================
-- These tables are GLOBAL (no organization_id in PK) - users can belong to
-- multiple organizations with different roles. NOT Citus-distributed.

-- iam.user: Global user accounts (NOT organization-scoped)
CREATE TABLE IF NOT EXISTS iam.user (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    email TEXT NOT NULL UNIQUE,
    display_name TEXT,
    profile_picture_url TEXT,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'deleted')),
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_email ON iam.user(email);
CREATE INDEX IF NOT EXISTS idx_user_status ON iam.user(status) WHERE status = 'active';

COMMENT ON TABLE iam.user IS
'Global user accounts. NOT organization-scoped - users can belong to multiple organizations with different roles. Status MUST align with backend constants in internal/iam/constants.go and proto enum rpc.v1.UserStatus.';

-- iam.sso_identity: SSO provider identities linked to users
CREATE TABLE IF NOT EXISTS iam.sso_identity (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    user_id UUID NOT NULL REFERENCES iam.user(id) ON DELETE CASCADE,
    provider TEXT NOT NULL
        CHECK (provider IN ('google', 'apple')),
    provider_user_id TEXT NOT NULL,
    email TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    last_used_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_sso_user ON iam.sso_identity(user_id);
CREATE INDEX IF NOT EXISTS idx_sso_provider_id ON iam.sso_identity(provider, provider_user_id);

COMMENT ON TABLE iam.sso_identity IS
'SSO provider identities linked to users. Users can have multiple providers (Google + Apple). Provider MUST align with proto enum rpc.v1.SSOProvider.';
COMMENT ON COLUMN iam.sso_identity.provider_user_id IS
'Unique user ID from SSO provider (sub claim in JWT)';

-- iam.password_credential: Password storage for email/password authentication
CREATE TABLE IF NOT EXISTS iam.password_credential (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    user_id UUID NOT NULL UNIQUE REFERENCES iam.user(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_user ON iam.password_credential(user_id);

COMMENT ON TABLE iam.password_credential IS
'Password credentials for email/password authentication. Optional - users can be SSO-only. password_hash is bcrypt (cost 12).';

-- iam.invitation: Pending invitations to join organizations
-- HAS organization_id - this is org-scoped data
CREATE TABLE IF NOT EXISTS iam.invitation (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role_id UUID NOT NULL,
    token TEXT NOT NULL UNIQUE,
    invited_by UUID NOT NULL REFERENCES iam.user(id),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'cancelled', 'expired')),
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invitation_token ON iam.invitation(token) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_invitation_email ON iam.invitation(email, status);
CREATE INDEX IF NOT EXISTS idx_invitation_org ON iam.invitation(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_invitation_expiry ON iam.invitation(expires_at) WHERE status = 'pending';

COMMENT ON TABLE iam.invitation IS
'Pending invitations to join organizations. 7-day expiration. Status MUST align with backend constants in internal/iam/constants.go and proto enum rpc.v1.InvitationStatus.';
COMMENT ON COLUMN iam.invitation.token IS
'Secure random token (32 bytes base64url-encoded) for invitation link';

-- iam.password_reset_token: Time-limited, single-use tokens for password reset
CREATE TABLE IF NOT EXISTS iam.password_reset_token (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    user_id UUID NOT NULL REFERENCES iam.user(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reset_token ON iam.password_reset_token(token) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reset_user ON iam.password_reset_token(user_id);
CREATE INDEX IF NOT EXISTS idx_reset_expiry ON iam.password_reset_token(expires_at) WHERE used_at IS NULL;

COMMENT ON TABLE iam.password_reset_token IS
'Time-limited (1 hour), single-use tokens for password reset flow.';
COMMENT ON COLUMN iam.password_reset_token.token IS
'Secure random token (32 bytes base64url-encoded) for reset link';

-- iam.session: Active session tracking for audit and session management
CREATE TABLE IF NOT EXISTS iam.session (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    user_id UUID NOT NULL REFERENCES iam.user(id) ON DELETE CASCADE,
    token_jti TEXT NOT NULL UNIQUE,
    issued_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    last_activity_at TIMESTAMPTZ DEFAULT now(),
    ip_address INET,
    user_agent TEXT,
    invalidated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_user ON iam.session(user_id) WHERE invalidated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_session_token ON iam.session(token_jti) WHERE invalidated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_session_expiry ON iam.session(expires_at) WHERE invalidated_at IS NULL;

COMMENT ON TABLE iam.session IS
'Active sessions for tracking, re-auth prompts, and audit. Regular table (not UNLOGGED) - sessions must persist across crashes.';
COMMENT ON COLUMN iam.session.token_jti IS
'JWT ID (jti claim) for unique session identification';

CREATE TABLE IF NOT EXISTS organization.employee(
    id uuid NOT NULL,
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    given_name text NOT NULL,
    family_name text NOT NULL,
    email text NOT NULL DEFAULT '',
    hire_date date,
    date_of_birth date,
    phone_number text,
    home_address text,
    additional_info jsonb,
    is_active boolean NOT NULL DEFAULT TRUE,
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- Composite primary key for Citus sharding (organization_id first)
    PRIMARY KEY (organization_id, id)
);

SELECT create_distributed_table('organization.employee', 'organization_id', colocate_with => 'public.organization');

-- Separate trigram indexes for efficient fuzzy search on individual fields
-- Strategy: Search each field independently and merge results in application layer
CREATE INDEX IF NOT EXISTS idx_employee_given_name_trgm ON organization.employee USING GIN(given_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_employee_family_name_trgm ON organization.employee USING GIN(family_name gin_trgm_ops);

COMMENT ON INDEX organization.idx_employee_given_name_trgm IS 'Trigram index for fuzzy search on employee given names. Smaller index size than concatenated fields.';

COMMENT ON INDEX organization.idx_employee_family_name_trgm IS 'Trigram index for fuzzy search on employee family names. Smaller index size than concatenated fields.';

CREATE TABLE IF NOT EXISTS organization.department(
    id uuid DEFAULT uuidv7(),
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    name text NOT NULL,
    description text,
    parent_department_id uuid,
    member_count int NOT NULL DEFAULT 0 CHECK (member_count >= 0),
    manager_count int NOT NULL DEFAULT 0 CHECK (manager_count >= 0),
    child_count int NOT NULL DEFAULT 0 CHECK (child_count >= 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- Composite primary key for Citus sharding (organization_id first)
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_department_parent
        FOREIGN KEY (organization_id, parent_department_id)
        REFERENCES organization.department(organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT no_self_reference CHECK (parent_department_id IS NULL OR parent_department_id != id)
);

SELECT create_distributed_table('organization.department', 'organization_id', colocate_with => 'public.organization');

-- Indexes for department tree traversal
CREATE INDEX IF NOT EXISTS idx_department_parent ON organization.department(organization_id, parent_department_id)
WHERE
    parent_department_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_department_org_parent ON organization.department(organization_id, parent_department_id);

-- Trigram index for fuzzy search on department name and description
CREATE INDEX IF NOT EXISTS idx_department_search_trgm ON organization.department USING GIN((name || ' ' || COALESCE(description, '')) gin_trgm_ops);

COMMENT ON INDEX organization.idx_department_search_trgm IS 'Trigram index for fuzzy search on department name and description. Supports multilingual queries.';

CREATE TABLE IF NOT EXISTS organization.department_member(
    id uuid DEFAULT uuidv7(),
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    department_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    role TEXT CHECK (ROLE IN ('member', 'manager')) NOT NULL DEFAULT 'member',
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- Composite primary key for Citus sharding (organization_id first)
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_department_member_department
        FOREIGN KEY (organization_id, department_id)
        REFERENCES organization.department(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_department_member_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE CASCADE,
    -- Unique constraint must include organization_id for Citus
    CONSTRAINT unique_dept_member UNIQUE (organization_id, department_id, employee_id)
);

SELECT create_distributed_table('organization.department_member', 'organization_id', colocate_with => 'public.organization');

COMMENT ON COLUMN organization.department_member.role IS 'Department membership role: member, manager. MUST align with backend constants in internal/department/constants.go and frontend TypeScript types in packages/apis/src/department.ts';

-- Enforce single department membership per employee
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_department_per_employee ON organization.department_member(organization_id, employee_id);

-- Indexes for department member queries
CREATE INDEX IF NOT EXISTS idx_department_member_employee ON organization.department_member(organization_id, employee_id);

CREATE INDEX IF NOT EXISTS idx_department_member_dept ON organization.department_member(organization_id, department_id, ROLE);

-- chat.channel: Communication spaces where employees can send messages
CREATE TABLE IF NOT EXISTS chat.channel(
    id uuid DEFAULT uuidv7(),
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    -- Channel identity
    title_slug text NOT NULL, -- URL-friendly slug (alphanumeric + hyphen, max 64 chars)
    display_name text NOT NULL, -- Human-readable name
    description text, -- Optional channel description
    -- Channel type and visibility
    channel_type text NOT NULL DEFAULT 'chat',
    -- Enum: 'chat', 'direct_message', 'project_ticket_thread', 'crm_deal_notes', 'support_ticket'
    is_private boolean NOT NULL DEFAULT FALSE, -- Private (invite-only) or public (discoverable)
    -- Status
    is_archived boolean NOT NULL DEFAULT FALSE, -- Archived channels prevent new messages/notifications
    -- Metadata
    created_by_employee_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- Composite primary key for Citus sharding (organization_id first)
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_channel_creator
        FOREIGN KEY (organization_id, created_by_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT,
    -- Constraints
    CONSTRAINT unique_channel_slug_per_org UNIQUE (organization_id, title_slug),
    CONSTRAINT valid_channel_type CHECK (channel_type IN ('chat', 'direct_message', 'project_ticket_thread', 'crm_deal_notes', 'support_ticket')),
    CONSTRAINT slug_format CHECK (title_slug ~ '^[a-z0-9-]+$' AND length(title_slug) <= 64)
);

SELECT create_distributed_table('chat.channel', 'organization_id', colocate_with => 'public.organization');

COMMENT ON COLUMN chat.channel.channel_type IS 'Channel type: chat, direct_message, project_ticket_thread, crm_deal_notes, support_ticket. MUST align with backend constants in internal/chat/constants.go, proto enum rpc.v1.ChannelType, and frontend TypeScript types in packages/apis/src/chat.ts';

-- Indexes for channel
CREATE INDEX IF NOT EXISTS idx_channel_org_updated ON chat.channel(organization_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_channel_org_type ON chat.channel(organization_id, channel_type, is_archived);

CREATE INDEX IF NOT EXISTS idx_channel_visibility ON chat.channel(organization_id, is_private, is_archived)
WHERE
    is_archived = FALSE;

-- Partial index for active channel discovery
-- Trigram index for fuzzy search on channel display_name and description
CREATE INDEX IF NOT EXISTS idx_channel_search_trgm ON chat.channel USING GIN((display_name) gin_trgm_ops);

COMMENT ON INDEX chat.idx_channel_search_trgm IS 'Trigram index for fuzzy search on channel display_name. Supports multilingual queries.';

COMMENT ON TABLE chat.channel IS 'Communication spaces (channels) where employees can send messages. Supports public/private channels, direct messages, and specialized types for reusability (project comments, CRM notes).';

-- chat.message: Messages and replies within channels
CREATE TABLE IF NOT EXISTS chat.message(
    id uuid DEFAULT uuidv7(),
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    channel_id uuid NOT NULL,
    -- Message content (stores sanitized HTML; plaintext is valid HTML)
    message_text text NOT NULL, -- Sanitized HTML with allowed tags: <b>, <strong>, <i>, <em>, <u>, <code>, <pre>, <a>, <ul>, <ol>, <li>, <p>, <br>
    author_employee_id uuid NOT NULL,
    -- Threading (1-level only)
    parent_message_id uuid,
    -- NULL = top-level message, non-NULL = reply to parent
    -- Status flags
    is_deleted boolean NOT NULL DEFAULT FALSE, -- Soft delete (preserve with placeholder text)
    is_edited boolean NOT NULL DEFAULT FALSE, -- Track if message was edited
    -- Metadata
    edit_history jsonb, -- Array of {edited_at: timestamp, previous_text: string}
    mentions jsonb, -- Array of {type: "employee"|"department", id: "uuid", label: "Display Name"}
    file_ids uuid[], -- Array of file UUIDs from files.file_metadata table (e.g., ["uuid1", "uuid2"])
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- Composite primary key for Citus sharding (organization_id first)
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_message_channel
        FOREIGN KEY (organization_id, channel_id)
        REFERENCES chat.channel(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_message_author
        FOREIGN KEY (organization_id, author_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_message_parent
        FOREIGN KEY (organization_id, parent_message_id)
        REFERENCES chat.message(organization_id, id)
        ON DELETE CASCADE
);

SELECT create_distributed_table('chat.message', 'organization_id', colocate_with => 'public.organization');

-- Indexes for message
-- Optimized pagination using UUID v7 as cursor (UUID v7 contains millisecond timestamp in first 48 bits)
CREATE INDEX IF NOT EXISTS idx_message_channel_id ON chat.message(organization_id, channel_id, id DESC)
WHERE
    is_deleted = FALSE AND parent_message_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_message_parent ON chat.message(organization_id, parent_message_id)
WHERE
    parent_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_author ON chat.message(organization_id, author_employee_id, id DESC);

-- PGroonga index for multilingual full-text search (Feature 011: Multilingual Search)
-- PGroonga automatically handles all languages (Latin, CJK, etc.) without language detection
CREATE INDEX IF NOT EXISTS idx_message_pgroonga ON chat.message USING pgroonga(message_text);

COMMENT ON INDEX chat.idx_message_pgroonga IS 'PGroonga index for multilingual full-text search on message content. Automatically handles all languages including CJK (Chinese, Japanese, Korean) and Latin scripts without requiring language detection or configuration.';

COMMENT ON TABLE chat.message IS 'Messages and replies within channels. Supports 1-level threading (replies to messages only, no replies to replies), editing, soft deletion, rich text HTML formatting (server-side sanitized), and multilingual full-text search via PGroonga (no language detection required).';

COMMENT ON COLUMN chat.message.message_text IS 'Message content as server-sanitized HTML. Allowed tags: <b>, <strong>, <i>, <em>, <u>, <code>, <pre>, <a href="">, <ul>, <ol>, <li>, <p>, <br>. Plaintext messages (no HTML tags) are valid HTML and render correctly. PGroonga automatically strips HTML tags during indexing for full-text search.';

-- chat.channel_membership: Channel memberships, admin roles, and per-channel notification preferences
CREATE TABLE IF NOT EXISTS chat.channel_membership(
    id uuid DEFAULT uuidv7(),
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    channel_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    -- Role
    is_admin boolean NOT NULL DEFAULT FALSE, -- Channel admin privileges
    -- Notification preferences
    notification_preference text NOT NULL DEFAULT 'all',
    -- Enum: 'all' (notify on all messages), 'mentions' (only @mentions), 'muted' (no notifications)
    -- Unread tracking (for unread badges and marking channels as read)
    last_viewed_message_id uuid NULL,
    -- Last message viewed by employee in this channel for unread tracking
    last_viewed_at timestamptz DEFAULT now(),
    -- Timestamp when employee last viewed this channel
    -- Timestamps
    joined_at timestamptz NOT NULL DEFAULT now(), -- When member joined channel
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- Composite primary key for Citus sharding (organization_id first)
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_channel_membership_channel
        FOREIGN KEY (organization_id, channel_id)
        REFERENCES chat.channel(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_channel_membership_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_channel_membership_last_viewed_message
        FOREIGN KEY (organization_id, last_viewed_message_id)
        REFERENCES chat.message(organization_id, id)
        ON DELETE RESTRICT,
    -- Constraints - unique constraint must have organization_id for Citus
    CONSTRAINT unique_membership UNIQUE (organization_id, channel_id, employee_id),
    CONSTRAINT valid_notification_pref CHECK (notification_preference IN ('all', 'mentions', 'muted'))
);

SELECT create_distributed_table('chat.channel_membership', 'organization_id', colocate_with => 'public.organization');

COMMENT ON COLUMN chat.channel_membership.notification_preference IS 'Per-channel notification preference: all, mentions, muted. MUST align with backend constants in internal/chat/constants.go, proto enum rpc.v1.NotificationPreference, and frontend TypeScript types in packages/apis/src/chat.ts';

-- Indexes for channel_membership
CREATE INDEX IF NOT EXISTS idx_membership_channel ON chat.channel_membership(organization_id, channel_id, notification_preference);

CREATE INDEX IF NOT EXISTS idx_membership_employee ON chat.channel_membership(organization_id, employee_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_membership_admins ON chat.channel_membership(organization_id, channel_id)
WHERE
    is_admin = TRUE;

-- Partial index for admin lookups
-- Efficient unread count queries
CREATE INDEX IF NOT EXISTS idx_membership_last_viewed ON chat.channel_membership(organization_id, employee_id, last_viewed_at);

CREATE INDEX IF NOT EXISTS idx_membership_last_viewed_message ON chat.channel_membership(organization_id, channel_id, employee_id)
WHERE
    last_viewed_message_id IS NOT NULL;

COMMENT ON TABLE chat.channel_membership IS 'Tracks channel memberships, admin roles, and per-channel notification preferences. Used for access control and notification filtering.';

-- chat.reaction: Emoji reactions to messages
CREATE TABLE IF NOT EXISTS chat.reaction(
    id uuid DEFAULT uuidv7(),
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    message_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    -- Reaction data
    emoji_code text NOT NULL, -- Unicode emoji or shortcode (e.g., "👍", ":thumbs_up:")
    -- Timestamp
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- Composite primary key for Citus sharding (organization_id first)
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_reaction_message
        FOREIGN KEY (organization_id, message_id)
        REFERENCES chat.message(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_reaction_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE CASCADE,
    -- Constraints - unique constraint must have organization_id for Citus
    CONSTRAINT unique_reaction UNIQUE (organization_id, message_id, employee_id, emoji_code)
    -- One reaction per employee-message-emoji combination (toggle behavior)
);

SELECT create_distributed_table('chat.reaction', 'organization_id', colocate_with => 'public.organization');

-- Indexes for reaction
CREATE INDEX IF NOT EXISTS idx_reaction_message ON chat.reaction(organization_id, message_id, emoji_code);

CREATE INDEX IF NOT EXISTS idx_reaction_employee ON chat.reaction(organization_id, employee_id, updated_at DESC);

COMMENT ON TABLE chat.reaction IS 'Emoji reactions to messages. Multiple employees can react with the same emoji (aggregated as counts). Duplicate reactions from same employee toggle (remove existing).';

-- chat.typing_indicator: Ephemeral typing state (may use in-memory only in production)
CREATE TABLE IF NOT EXISTS chat.typing_indicator(
    id uuid DEFAULT uuidv7(),
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    channel_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    -- Timestamp
    updated_at timestamptz NOT NULL DEFAULT now(), -- Last typing heartbeat
    -- Composite primary key for Citus sharding (organization_id first)
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_typing_indicator_channel
        FOREIGN KEY (organization_id, channel_id)
        REFERENCES chat.channel(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_typing_indicator_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE CASCADE,
    -- Constraints - unique constraint must have organization_id for Citus
    CONSTRAINT unique_typing UNIQUE (organization_id, channel_id, employee_id)
);

SELECT create_distributed_table('chat.typing_indicator', 'organization_id', colocate_with => 'public.organization');

-- Index for typing_indicator
CREATE INDEX IF NOT EXISTS idx_typing_channel ON chat.typing_indicator(organization_id, channel_id, updated_at DESC);

COMMENT ON TABLE chat.typing_indicator IS 'Tracks which employees are currently typing in channels. Ephemeral state with auto-cleanup. May use in-memory implementation in production to reduce database load.';

-- chat.user_chat_config: User-specific chat preferences and visible channels
CREATE TABLE IF NOT EXISTS chat.user_chat_config(
    id uuid DEFAULT uuidv7(),
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    employee_id uuid NOT NULL,
    -- Channel visibility and categorization
    -- Only channels present in this map are visible in sidebar
    -- Value is the category: "channels" | "direct_messages" | "archived"
    channel_categories jsonb NOT NULL DEFAULT '{}', -- {channel_id: "channels"}
    -- Category limits: max visible channels per category
    category_limits jsonb NOT NULL DEFAULT '{"channels": 30, "direct_messages": 20, "archived": 10}',
    -- Pinned channels (subset of channel_categories keys)
    pinned_channel_ids uuid[] NOT NULL DEFAULT '{}', -- Pinned channels appear at top within their category
    -- Display preferences
    sidebar_category_collapsed jsonb NOT NULL DEFAULT '{}', -- {channels: false, direct_messages: false}
    -- Timestamps
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- Composite primary key for Citus sharding (organization_id first)
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_user_chat_config_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE CASCADE,
    -- Constraints - unique constraint must have organization_id for Citus
    CONSTRAINT unique_user_chat_config UNIQUE (organization_id, employee_id)
);

SELECT create_distributed_table('chat.user_chat_config', 'organization_id', colocate_with => 'public.organization');

-- Indexes for user_chat_config
CREATE INDEX IF NOT EXISTS idx_user_chat_config_employee ON chat.user_chat_config(organization_id, employee_id);

-- GIN index for querying channel categories
CREATE INDEX IF NOT EXISTS idx_user_chat_config_categories ON chat.user_chat_config USING GIN(channel_categories);

COMMENT ON TABLE chat.user_chat_config IS 'Per-user chat preferences including visible channels (via channel_categories), pinned channels, per-category limits, and sidebar display state. Only channels present in channel_categories are visible in sidebar. Order is derived from channel.updated_at (most recent first).';

COMMENT ON COLUMN chat.user_chat_config.channel_categories IS 'JSONB mapping of channel_id to category. Presence in this map makes channel visible in sidebar. Example: {"uuid-1": "channels", "uuid-2": "direct_messages"}. Categories: channels (public/private channels), direct_messages (1-on-1 DMs), archived (archived channels). Order within category determined by channel.updated_at DESC.';

COMMENT ON COLUMN chat.user_chat_config.category_limits IS 'JSONB object defining max visible channels per category. Example: {"channels": 30, "direct_messages": 20, "archived": 10}. When category exceeds limit, oldest channels (by updated_at) are automatically removed from channel_categories.';

COMMENT ON COLUMN chat.user_chat_config.pinned_channel_ids IS 'Array of pinned channel IDs (subset of channel_categories keys). Pinned channels appear at top within their category, ordered by position in this array. Non-pinned channels follow, ordered by updated_at DESC.';

COMMENT ON COLUMN chat.user_chat_config.sidebar_category_collapsed IS 'JSONB object tracking collapsed state of sidebar categories. Example: {"channels": false, "direct_messages": false}.';




-- notification.notification: Core notification data published by backend services
CREATE TABLE IF NOT EXISTS notification.notification(
    id uuid DEFAULT uuidv7(),
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    -- Source information
    source_domain text NOT NULL CHECK (source_domain IN ('chat', 'crm', 'projects', 'hr', 'support', 'finance', 'docs', 'system')),
    notification_type text NOT NULL CHECK (notification_type IN ('message', 'mention', 'reply', 'typing', 'reaction', 'task_assigned', 'task_status_changed', 'task_commented', 'task_mentioned', 'task_description_modified', 'task_updated', 'doc_updated', 'doc_commented', 'doc_mentioned')),
    publishing_service_id text, -- Backend service identifier
    -- Content
    title text NOT NULL,
    message text NOT NULL,
    -- Action data for deep linking
    action_data jsonb, -- {chatThreadId: "...", projectId: "...", etc.}
    action_category text, -- For deduplication: react, comment, update, assign
    -- Delivery configuration
    priority smallint NOT NULL DEFAULT 1 CHECK (priority IN (0, 1, 2, 4)),
    -- 0 = deliver always (even if offline)
    -- 1 = deliver when not offline (default)
    -- 2 = deliver when online only
    -- 4 = silent (no delivery, log only)
    -- Notification lifecycle policy
    policy_key text NOT NULL DEFAULT 'persistent_default',
    delivery_class text NOT NULL DEFAULT 'persistent',
    navigation_target jsonb NOT NULL DEFAULT '{}'::jsonb,
    source_category text NOT NULL DEFAULT 'activity',
    -- Timestamps
    updated_at timestamptz DEFAULT now(),
    -- Composite primary key for Citus sharding (organization_id first)
    PRIMARY KEY (organization_id, id),
    CONSTRAINT notification_policy_key_valid CHECK (
        policy_key IN (
            'persistent_default',
            'chat_message',
            'chat_mention',
            'chat_reply',
            'chat_typing_live',
            'chat_reaction_live',
            'task_assignment',
            'task_comment',
            'task_mention',
            'task_status',
            'task_description_modified',
            'task_update',
            'document_update',
            'document_comment',
            'document_mention'
        )
    ),
    CONSTRAINT notification_delivery_class_valid CHECK (
        delivery_class IN ('persistent', 'live_only')
    ),
    CONSTRAINT notification_source_category_valid CHECK (
        source_category IN ('activity', 'mention', 'system')
    )
);

SELECT create_distributed_table('notification.notification', 'organization_id', colocate_with => 'public.organization');

-- Indexes for notification
CREATE INDEX IF NOT EXISTS idx_notification_org_updated ON notification.notification(organization_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_source ON notification.notification(organization_id, source_domain, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_action_data ON notification.notification USING GIN(action_data);

COMMENT ON TABLE notification.notification IS 'Core notification data published by backend business domain services';

COMMENT ON COLUMN notification.notification.source_domain IS 'Backend service that published notification: chat, crm, projects, hr, support, finance, system. MUST align with backend constants in internal/notification/constants.go and frontend TypeScript types in packages/apis/src/notifications.ts';

COMMENT ON COLUMN notification.notification.notification_type IS 'Type of notification. Allowed values: message, mention, reply, typing, reaction. MUST align with backend constants in internal/notification/constants.go and frontend TypeScript types in packages/apis/src/notifications.ts';

COMMENT ON COLUMN notification.notification.action_data IS 'Flexible metadata for deep linking to source resource. Example: {"chatThreadId": "uuid", "messageId": "uuid"}';

COMMENT ON COLUMN notification.notification.action_category IS 'Category for deduplication grouping. Example: react:like and react:unlike both map to "react"';

COMMENT ON COLUMN notification.notification.priority IS 'Delivery priority: 0=always deliver even if offline, 1=deliver when not offline (default), 2=deliver when online only, 4=silent (no delivery)';

COMMENT ON COLUMN notification.notification.policy_key IS 'Evaluated business delivery policy applied at publication time. MUST align with backend constants in internal/notification/constants.go and proto fields.';

COMMENT ON COLUMN notification.notification.delivery_class IS 'Distinguishes persistent notifications (stored in notification center) from live_only transient signals (typing, reactions). live_only notifications do not create recipient rows.';

COMMENT ON COLUMN notification.notification.navigation_target IS 'Structured deep-link payload. Example: {"domain":"projects","resourceType":"task","resourceId":"uuid","action":"open_comment"}';

COMMENT ON COLUMN notification.notification.source_category IS 'Frontend grouping axis: activity (general updates), mention (explicit mentions), system (automated/system events).';

-- notification.notification_recipient: Links notifications to employees with delivery tracking
CREATE TABLE IF NOT EXISTS notification.notification_recipient(
    id uuid DEFAULT uuidv7(),
    notification_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    -- Read status
    read_status boolean DEFAULT FALSE,
    read_at timestamptz,
    -- Delivery tracking
    delivery_status text DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'delivered', 'failed')),
    delivered_at timestamptz,
    delivery_attempts smallint DEFAULT 0 CHECK (delivery_attempts >= 0),
    last_delivery_error text,
    -- Recipient targeting
    recipient_type text NOT NULL DEFAULT 'individual' CHECK (recipient_type IN ('individual', 'department')),
    target_department_ids uuid[], -- If sent to department, store resolved department IDs
    -- Acknowledgement lifecycle (authoritative unread signal)
    acknowledgement_status text NOT NULL DEFAULT 'pending',
    acknowledged_at timestamptz,
    acknowledgement_action text,
    -- Fallback delivery summary
    fallback_status text NOT NULL DEFAULT 'not_applicable',
    fallback_reason text,
    fallback_updated_at timestamptz,
    -- Timestamps
    updated_at timestamptz DEFAULT now(),
    -- Composite primary key for Citus sharding (organization_id first)
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_notification_recipient_notification
        FOREIGN KEY (organization_id, notification_id)
        REFERENCES notification.notification(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_notification_recipient_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT notification_recipient_ack_status_valid CHECK (
        acknowledgement_status IN ('pending', 'acknowledged')
    ),
    CONSTRAINT notification_recipient_ack_action_valid CHECK (
        acknowledgement_action IS NULL OR acknowledgement_action IN (
            'destination_open',
            'explicit_ack'
        )
    ),
    CONSTRAINT notification_recipient_fallback_status_valid CHECK (
        fallback_status IN (
            'not_applicable',
            'queued',
            'sent',
            'skipped',
            'failed'
        )
    ),
    CONSTRAINT notification_recipient_fallback_reason_valid CHECK (
        fallback_reason IS NULL OR fallback_reason IN (
            'live_only_policy',
            'no_push_target',
            'recipient_ineligible',
            'recipient_online',
            'suppressed_by_preference',
            'delivery_error'
        )
    )
);

SELECT create_distributed_table('notification.notification_recipient', 'organization_id', colocate_with => 'public.organization');

-- Indexes for notification_recipient
CREATE INDEX IF NOT EXISTS idx_recipient_employee_org ON notification.notification_recipient(organization_id, employee_id, read_status);

CREATE INDEX IF NOT EXISTS idx_recipient_notification ON notification.notification_recipient(organization_id, notification_id);

CREATE INDEX IF NOT EXISTS idx_recipient_delivery_status ON notification.notification_recipient(organization_id, delivery_status, updated_at)
WHERE
    delivery_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_recipient_read_status ON notification.notification_recipient(organization_id, employee_id, updated_at DESC)
WHERE
    read_status = FALSE;

COMMENT ON TABLE notification.notification_recipient IS 'Links notifications to employees with delivery and read tracking';

COMMENT ON COLUMN notification.notification_recipient.recipient_type IS 'How recipient was targeted: individual (direct to employee_id) or department (resolved from department membership)';

COMMENT ON COLUMN notification.notification_recipient.target_department_ids IS 'If sent to department, stores resolved department IDs for audit trail';

COMMENT ON COLUMN notification.notification_recipient.delivery_status IS 'pending = awaiting delivery, delivered = sent via SSE or fallback, failed = all delivery attempts failed. Auto-updated to delivered when notification is marked as read.';

COMMENT ON COLUMN notification.notification_recipient.read_status IS 'Whether the notification has been read by the employee. When set to true, delivery_status is automatically updated to delivered.';

COMMENT ON COLUMN notification.notification_recipient.acknowledgement_status IS 'Authoritative unread signal. pending = not yet acknowledged, acknowledged = destination opened or explicitly acknowledged. Frontend unread counts MUST derive from this field.';

COMMENT ON COLUMN notification.notification_recipient.acknowledgement_action IS 'How the notification was acknowledged: destination_open (user navigated to the linked resource) or explicit_ack (user dismissed via explicit action). Popup display alone does NOT acknowledge.';

COMMENT ON COLUMN notification.notification_recipient.fallback_status IS 'Latest offline delivery outcome summary: not_applicable, queued, sent, skipped, failed.';

COMMENT ON COLUMN notification.notification_recipient.fallback_reason IS 'Why fallback was skipped or failed. Values: live_only_policy, no_push_target, recipient_ineligible, recipient_online, suppressed_by_preference, delivery_error.';

-- notification.resource_subscription: V2 parent-resource subscription state owned by notification domain
CREATE TABLE IF NOT EXISTS notification.resource_subscription(
    id uuid DEFAULT uuidv7(),
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    employee_id uuid NOT NULL,
    resource_domain text NOT NULL,
    resource_id uuid NOT NULL,
    subscription_state text NOT NULL DEFAULT 'active',
    preference_level text NOT NULL DEFAULT 'all',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_resource_subscription_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT resource_subscription_domain_valid CHECK (
        resource_domain IN ('task', 'document', 'channel')
    ),
    CONSTRAINT resource_subscription_state_valid CHECK (
        subscription_state IN ('active', 'unfollowed')
    ),
    CONSTRAINT resource_subscription_preference_valid CHECK (
        preference_level IN ('all', 'mentions', 'muted')
    ),
    CONSTRAINT resource_subscription_unique
        UNIQUE (organization_id, employee_id, resource_domain, resource_id)
);

SELECT create_distributed_table('notification.resource_subscription', 'organization_id', colocate_with => 'public.organization');

CREATE INDEX IF NOT EXISTS idx_resource_subscription_resource
    ON notification.resource_subscription(organization_id, resource_domain, resource_id, subscription_state);

CREATE INDEX IF NOT EXISTS idx_resource_subscription_employee
    ON notification.resource_subscription(organization_id, employee_id, updated_at DESC);

COMMENT ON TABLE notification.resource_subscription IS 'Notification-owned V2 subscription state for parent resources such as tasks, documents, and channels.';

COMMENT ON COLUMN notification.resource_subscription.subscription_state IS 'active means routine subscription eligibility exists; unfollowed explicitly suppresses routine parent-resource subscription eligibility.';

COMMENT ON COLUMN notification.resource_subscription.preference_level IS 'Routine delivery preference for subscribed activity on the parent resource. direct-targeted events may still bypass muted according to V2 policy.';

-- notification.resource_subscription_reason: Why a parent-resource subscription exists
CREATE TABLE IF NOT EXISTS notification.resource_subscription_reason(
    id uuid DEFAULT uuidv7(),
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    subscription_id uuid NOT NULL,
    reason_type text NOT NULL,
    reason_ref_type text,
    reason_ref_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_resource_subscription_reason_subscription
        FOREIGN KEY (organization_id, subscription_id)
        REFERENCES notification.resource_subscription(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT resource_subscription_reason_type_valid CHECK (
        reason_type IN (
            'creator',
            'reporter',
            'assignee',
            'manual_follow',
            'commented',
            'mentioned_auto',
            'system'
        )
    )
);

SELECT create_distributed_table('notification.resource_subscription_reason', 'organization_id', colocate_with => 'public.organization');

CREATE INDEX IF NOT EXISTS idx_resource_subscription_reason_subscription
    ON notification.resource_subscription_reason(organization_id, subscription_id, created_at ASC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_resource_subscription_reason_unique
    ON notification.resource_subscription_reason(
        organization_id,
        subscription_id,
        reason_type,
        COALESCE(reason_ref_type, ''),
        COALESCE(reason_ref_id, '00000000-0000-0000-0000-000000000000'::uuid)
    );

COMMENT ON TABLE notification.resource_subscription_reason IS 'Explains why a V2 parent-resource subscription exists without collapsing multiple independent reasons into one field.';

COMMENT ON COLUMN notification.resource_subscription_reason.reason_ref_type IS 'Optional discriminator for the referenced cause, such as comment, assignment, or system job.';

COMMENT ON COLUMN notification.resource_subscription_reason.reason_ref_id IS 'Optional ID of the entity that caused the subscription reason. NULL when the reason has no concrete backing row.';

-- notification.resource_surface: Maps attached resources back to their parent subscription target
CREATE TABLE IF NOT EXISTS notification.resource_surface(
    id uuid DEFAULT uuidv7(),
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    parent_domain text NOT NULL,
    parent_resource_id uuid NOT NULL,
    surface_type text NOT NULL,
    surface_domain text NOT NULL,
    surface_resource_id uuid NOT NULL,
    inherits_subscription boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, id),
    CONSTRAINT resource_surface_parent_domain_valid CHECK (
        parent_domain IN ('task', 'document')
    ),
    CONSTRAINT resource_surface_type_valid CHECK (
        surface_type IN ('task_discussion', 'task_description', 'document_comments')
    ),
    CONSTRAINT resource_surface_domain_valid CHECK (
        surface_domain IN ('chat_channel', 'document', 'document_comment_thread')
    ),
    CONSTRAINT resource_surface_parent_unique
        UNIQUE (organization_id, parent_domain, parent_resource_id, surface_type),
    CONSTRAINT resource_surface_surface_unique
        UNIQUE (organization_id, surface_domain, surface_resource_id)
);

SELECT create_distributed_table('notification.resource_surface', 'organization_id', colocate_with => 'public.organization');

CREATE INDEX IF NOT EXISTS idx_resource_surface_parent
    ON notification.resource_surface(organization_id, parent_domain, parent_resource_id, inherits_subscription);

COMMENT ON TABLE notification.resource_surface IS 'Maps task/document child collaboration surfaces back to their parent resource for V2 subscription inheritance.';

COMMENT ON COLUMN notification.resource_surface.inherits_subscription IS 'Future-proofing flag that allows a mapped surface to opt out of parent subscription inheritance. V2 defaults to true.';

-- notification.active_connection: UNLOGGED table for connection registry (2-3x faster writes)
-- Data lost on crash is acceptable - users reconnect
CREATE UNLOGGED TABLE IF NOT EXISTS notification.active_connection(
    employee_id uuid NOT NULL,
    instance_id text NOT NULL, -- Backend instance hostname/ID
    connection_id uuid NOT NULL, -- Unique per SSE connection
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    -- Denormalized department membership for fast queries
    department_ids uuid[], -- Populated on connect from organization.department_member
    -- Connection tracking
    connected_at timestamptz DEFAULT now(),
    last_heartbeat timestamptz DEFAULT now(),
    connection_status text DEFAULT 'active' CHECK (connection_status IN ('active', 'stale')),
    presence_status text NOT NULL DEFAULT 'online',
    active_channel_id uuid NULL,
    last_interaction_at timestamptz NOT NULL DEFAULT now(),
    device_identifier text NOT NULL DEFAULT '',
    -- Additional metadata
    user_agent text,
    ip_address inet,
    PRIMARY KEY (organization_id, employee_id, connection_id),
    CONSTRAINT fk_active_connection_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT presence_status_valid CHECK (presence_status IN ('online', 'online_hidden', 'idle', 'offline')),
    CONSTRAINT active_connection_active_channel_fk
        FOREIGN KEY (organization_id, active_channel_id)
        REFERENCES chat.channel(organization_id, id)
        ON DELETE CASCADE
);

SELECT create_distributed_table('notification.active_connection', 'organization_id', colocate_with => 'public.organization');

-- Indexes for active_connection
CREATE INDEX IF NOT EXISTS idx_active_connection_employee ON notification.active_connection(organization_id, employee_id, connection_status);

CREATE INDEX IF NOT EXISTS idx_active_connection_instance ON notification.active_connection(organization_id, instance_id, connection_status);

CREATE INDEX IF NOT EXISTS idx_active_connection_org ON notification.active_connection(organization_id, connection_status);

CREATE INDEX IF NOT EXISTS idx_active_connection_org_presence
    ON notification.active_connection(organization_id, presence_status, last_heartbeat DESC);

-- GIN index for array overlap queries (department-based targeting)
CREATE INDEX IF NOT EXISTS idx_active_connection_departments ON notification.active_connection USING GIN(department_ids);

CREATE INDEX IF NOT EXISTS idx_active_connection_heartbeat ON notification.active_connection(organization_id, last_heartbeat)
WHERE
    connection_status = 'active';

CREATE INDEX IF NOT EXISTS idx_active_connection_active_channel
    ON notification.active_connection(organization_id, active_channel_id)
    WHERE active_channel_id IS NOT NULL;

COMMENT ON TABLE notification.active_connection IS 'UNLOGGED table tracking active SSE connections across backend instances. Data lost on crash is acceptable (users reconnect). 2-3x faster writes than regular table.';

COMMENT ON COLUMN notification.active_connection.instance_id IS 'Backend instance hosting this SSE connection. Example: "backend-pod-abc123" or "instance-1.example.com"';

COMMENT ON COLUMN notification.active_connection.department_ids IS 'Denormalized department membership for single-query department → users → instances resolution. Updated only on reconnect.';

COMMENT ON COLUMN notification.active_connection.last_heartbeat IS 'Updated every 30 seconds by SSE connection. Entries with last_heartbeat > 60s old are considered stale and cleaned up.';

COMMENT ON COLUMN notification.active_connection.presence_status IS 'Real-time presence indicator. Allowed values: online, online_hidden, idle, offline. Aligned with rpc.v1.PresenceStatus enum.';

COMMENT ON COLUMN notification.active_connection.active_channel_id IS 'Channel currently viewed by the connection. Nullable: may be NULL when the connection is not viewing any channel. Used for targeted ephemeral signal routing.';

COMMENT ON COLUMN notification.active_connection.last_interaction_at IS 'Updated on user interactions (typing, clicks) to support idle detection and presence freshness.';

COMMENT ON COLUMN notification.active_connection.device_identifier IS 'Hashed browser/device fingerprint used to distinguish multiple devices per employee.';

-- notification.push_token: Stores FCM push tokens per device/browser with tenant isolation
CREATE TABLE IF NOT EXISTS notification.push_token (
    token_id uuid NOT NULL DEFAULT uuidv7(),
    organization_id uuid NOT NULL REFERENCES public.organization(id),
    employee_id uuid NOT NULL,
    device_identifier text NOT NULL,
    fcm_token text NOT NULL,
    permission_state text NOT NULL DEFAULT 'prompt',
    endpoint text NOT NULL,
    keys jsonb NOT NULL,
    user_agent text NOT NULL,
    registered_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    is_valid boolean NOT NULL DEFAULT true,
    token_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (organization_id, token_id),
    CONSTRAINT push_token_token_id_unique UNIQUE (organization_id, token_id),
    CONSTRAINT push_token_unique UNIQUE (organization_id, employee_id, device_identifier),
    CONSTRAINT permission_state_valid CHECK (permission_state IN ('granted', 'denied', 'prompt')),
    CONSTRAINT fk_push_token_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE CASCADE
);

SELECT create_distributed_table('notification.push_token', 'organization_id', colocate_with => 'public.organization');

CREATE INDEX IF NOT EXISTS idx_push_token_employee
    ON notification.push_token(organization_id, employee_id)
    WHERE is_valid = true;

CREATE INDEX IF NOT EXISTS idx_push_token_last_used
    ON notification.push_token(organization_id, last_used_at)
    WHERE is_valid = true;

COMMENT ON TABLE notification.push_token IS 'Stores FCM push tokens for browser and device notifications. One employee can register multiple devices.';

COMMENT ON COLUMN notification.push_token.permission_state IS 'Browser notification permission state. Allowed values: granted, denied, prompt. Mirrors rpc.v1.PermissionState enum.';

COMMENT ON COLUMN notification.push_token.keys IS 'Web push subscription keys (p256dh, auth) stored as JSONB for encrypted payload delivery.';

COMMENT ON COLUMN notification.push_token.token_metadata IS 'Additional device metadata (browser, OS) stored as JSONB for debugging and analytics.';

-- notification.presence_visibility: Privacy controls for presence visibility per employee
CREATE TABLE IF NOT EXISTS notification.presence_visibility (
    organization_id uuid NOT NULL REFERENCES public.organization(id),
    employee_id uuid NOT NULL,
    visibility_mode text NOT NULL DEFAULT 'everyone',
    custom_status_text text,
    custom_status_emoji text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, employee_id),
    CONSTRAINT visibility_mode_valid CHECK (visibility_mode IN ('everyone', 'departments', 'offline')),
    CONSTRAINT fk_presence_visibility_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE CASCADE
);

SELECT create_distributed_table('notification.presence_visibility', 'organization_id', colocate_with => 'public.organization');

CREATE INDEX IF NOT EXISTS idx_presence_visibility_org_mode
    ON notification.presence_visibility(organization_id, visibility_mode);

COMMENT ON TABLE notification.presence_visibility IS 'Per-employee presence privacy controls determining who can view status and custom presence messaging.';

COMMENT ON COLUMN notification.presence_visibility.visibility_mode IS 'Visibility mode. Allowed values: everyone, departments, offline. Mirrors rpc.v1.VisibilityMode enum.';

COMMENT ON COLUMN notification.presence_visibility.custom_status_text IS 'Optional custom status message (e.g., "Heads down coding until 3pm").';

COMMENT ON COLUMN notification.presence_visibility.custom_status_emoji IS 'Optional single emoji associated with custom status.';

-- notification.delivery_attempt: Auditable per-channel delivery and fallback outcomes
CREATE TABLE IF NOT EXISTS notification.delivery_attempt (
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    id uuid NOT NULL DEFAULT uuidv7(),
    notification_recipient_id uuid NOT NULL,
    channel text NOT NULL,
    attempt_status text NOT NULL,
    reason text,
    attempted_at timestamptz NOT NULL,
    instance_id text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (organization_id, id),
    CONSTRAINT delivery_attempt_channel_valid CHECK (
        channel IN ('sse', 'push', 'replay')
    ),
    CONSTRAINT delivery_attempt_status_valid CHECK (
        attempt_status IN ('queued', 'sent', 'skipped', 'failed')
    ),
    CONSTRAINT delivery_attempt_reason_valid CHECK (
        reason IS NULL OR reason IN (
            'live_only_policy',
            'no_active_context_match',
            'no_push_target',
            'recipient_ineligible',
            'suppressed_by_preference',
            'provider_error',
            'delivery_error'
        )
    ),
    CONSTRAINT delivery_attempt_recipient_fk FOREIGN KEY (organization_id, notification_recipient_id)
        REFERENCES notification.notification_recipient (organization_id, id)
        ON DELETE CASCADE
);

SELECT create_distributed_table('notification.delivery_attempt', 'organization_id', colocate_with => 'public.organization');

CREATE INDEX IF NOT EXISTS idx_delivery_attempt_org_recipient_attempted
    ON notification.delivery_attempt (organization_id, notification_recipient_id, attempted_at DESC);

COMMENT ON TABLE notification.delivery_attempt IS 'Auditable per-channel delivery and fallback outcomes. Supports debugging of why a recipient never saw a notification. Separates canonical recipient summary from detailed attempt history.';

COMMENT ON COLUMN notification.delivery_attempt.channel IS 'Delivery channel: sse (realtime), push (FCM offline), replay (reconnect replay).';

COMMENT ON COLUMN notification.delivery_attempt.attempt_status IS 'Outcome of this delivery attempt: queued, sent, skipped, failed.';

COMMENT ON COLUMN notification.delivery_attempt.reason IS 'Why delivery was skipped or failed. NULL when attempt_status is sent or queued.';

COMMENT ON COLUMN notification.delivery_attempt.instance_id IS 'Backend instance that recorded this attempt. Supports multi-instance debugging.';

-- notification.active_context: UNLOGGED table for shared realtime presence context beyond chat channels
-- Generalizes the single active_channel_id in active_connection to support docs and tasks
CREATE UNLOGGED TABLE IF NOT EXISTS notification.active_context (
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    connection_id uuid NOT NULL,
    context_type text NOT NULL,
    context_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    last_seen_at timestamptz NOT NULL,
    PRIMARY KEY (organization_id, connection_id, context_type, context_id),
    CONSTRAINT active_context_type_valid CHECK (
        context_type IN ('channel', 'document', 'task')
    )
);

SELECT create_distributed_table('notification.active_context', 'organization_id', colocate_with => 'public.organization');

CREATE INDEX IF NOT EXISTS idx_active_context_org_lookup
    ON notification.active_context (organization_id, context_type, context_id, last_seen_at DESC);

COMMENT ON TABLE notification.active_context IS 'UNLOGGED table tracking active realtime context (channel, document, task) per SSE connection. Allows live-only or context-scoped notifications to resolve recipients from current activity context. Data loss on crash is acceptable — clients reconnect and repopulate.';

COMMENT ON COLUMN notification.active_context.context_type IS 'Type of resource actively viewed: channel (chat), document (docs), task (projects).';

COMMENT ON COLUMN notification.active_context.context_id IS 'UUID of the actively viewed resource (channel_id, document_id, or task_id).';

COMMENT ON COLUMN notification.active_context.last_seen_at IS 'Updated on heartbeat or activity. Stale entries indicate the user is no longer viewing the resource.';

-- notification.ephemeral_signal: Temporary routing table for ephemeral events (typing, reactions)
CREATE TABLE IF NOT EXISTS notification.ephemeral_signal (
    signal_id uuid NOT NULL DEFAULT uuidv7(),
    organization_id uuid NOT NULL REFERENCES public.organization(id),
    channel_id uuid NOT NULL,
    sender_employee_id uuid NOT NULL,
    signal_type text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, signal_id),
    CONSTRAINT ephemeral_signal_id_unique UNIQUE (organization_id, signal_id),
    CONSTRAINT signal_type_valid CHECK (signal_type IN ('typing', 'reaction', 'presence')),
    CONSTRAINT fk_ephemeral_signal_channel
        FOREIGN KEY (organization_id, channel_id)
        REFERENCES chat.channel(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_ephemeral_signal_sender
        FOREIGN KEY (organization_id, sender_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT
)
WITH (autovacuum_vacuum_scale_factor = 0.0, autovacuum_vacuum_threshold = 1000);

SELECT create_distributed_table('notification.ephemeral_signal', 'organization_id', colocate_with => 'public.organization');

CREATE INDEX IF NOT EXISTS idx_ephemeral_signal_channel
    ON notification.ephemeral_signal(organization_id, channel_id, created_at DESC);

COMMENT ON TABLE notification.ephemeral_signal IS 'Temporary storage for ephemeral events (typing indicators, reactions) following write-then-delete pattern for targeted streaming.';

COMMENT ON COLUMN notification.ephemeral_signal.signal_type IS 'Ephemeral event type. Allowed values: typing, reaction, presence. Mirrors rpc.v1.EphemeralSignalType enum.';

-- notification.notification_batch: Groups related notifications for batching and deduplication
CREATE TABLE IF NOT EXISTS notification.notification_batch(
    id uuid DEFAULT uuidv7(),
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    -- Batch identification
    batch_key text NOT NULL, -- For deduplication: "action_category:source_user:resource"
    publishing_service_id text,
    -- Batch contents
    notification_ids uuid[],
    target_employee_ids uuid[],
    -- Processing
    processing_status text DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
    processed_at timestamptz,
    -- Timestamps
    updated_at timestamptz DEFAULT now(),
    -- Composite primary key for Citus sharding (organization_id first)
    PRIMARY KEY (organization_id, id)
);

SELECT create_distributed_table('notification.notification_batch', 'organization_id', colocate_with => 'public.organization');

-- Indexes for notification_batch
CREATE INDEX IF NOT EXISTS idx_batch_org_status ON notification.notification_batch(organization_id, processing_status, updated_at);

CREATE INDEX IF NOT EXISTS idx_batch_key ON notification.notification_batch(organization_id, batch_key)
WHERE
    processing_status = 'pending';

COMMENT ON TABLE notification.notification_batch IS 'Groups related notifications within time window for efficient batching and deduplication';

COMMENT ON COLUMN notification.notification_batch.batch_key IS 'Deduplication key: "action_category:source_user_id:resource_id". Example: "react:user-123:comment-456"';

-- notification.notification_delivery_log: Tracks delivery attempts and failures
-- Note: notification_delivery_log doesn't have organization_id in current schema
-- This is acceptable for UNLOGGED/logging tables that don't require sharding
-- If needed for sharding, add organization_id column and composite PK
CREATE TABLE IF NOT EXISTS notification.notification_delivery_log(
    id uuid DEFAULT uuidv7(),
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    notification_recipient_id uuid NOT NULL,
    -- Delivery attempt
    delivery_method text NOT NULL CHECK (delivery_method IN ('sse', 'push', 'email')),
    attempt_number smallint NOT NULL CHECK (attempt_number > 0),
    -- Result
    delivery_result text NOT NULL CHECK (delivery_result IN ('success', 'failed', 'timeout')),
    error_message text,
    -- Timing
    attempted_at timestamptz DEFAULT now(),
    latency_ms integer CHECK (latency_ms >= 0), -- Time from notification creation to delivery
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_delivery_log_recipient
        FOREIGN KEY (organization_id, notification_recipient_id)
        REFERENCES notification.notification_recipient(organization_id, id)
        ON DELETE CASCADE
);

SELECT create_distributed_table('notification.notification_delivery_log', 'organization_id', colocate_with => 'public.organization');

-- Indexes for notification_delivery_log
CREATE INDEX IF NOT EXISTS idx_delivery_log_recipient ON notification.notification_delivery_log(organization_id, notification_recipient_id, attempted_at DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_log_result ON notification.notification_delivery_log(organization_id, delivery_result, attempted_at DESC)
WHERE
    delivery_result = 'failed';

COMMENT ON TABLE notification.notification_delivery_log IS 'Tracks all delivery attempts for debugging and fallback trigger determination';

COMMENT ON COLUMN notification.notification_delivery_log.delivery_method IS 'sse = Server-Sent Events (primary), push = mobile push notification, email = email fallback';

-- notification.personal_preference: Global per-employee notification settings (DND, domain mutes)
CREATE TABLE IF NOT EXISTS notification.personal_preference(
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    employee_id uuid NOT NULL,
    dnd_enabled boolean NOT NULL DEFAULT false,
    dnd_start time,
    dnd_end time,
    muted_domains text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, employee_id),
    FOREIGN KEY (organization_id, employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT muted_domains_valid CHECK (
        muted_domains <@ ARRAY['chat', 'projects', 'docs', 'crm', 'hr', 'support', 'finance', 'system']::text[]
    )
);

SELECT create_distributed_table('notification.personal_preference', 'organization_id', colocate_with => 'public.organization');

COMMENT ON TABLE notification.personal_preference IS 
'Global notification preferences per employee. Controls DND schedule and domain-level muting.';

COMMENT ON COLUMN notification.personal_preference.muted_domains IS 
'Domains for which the employee will not receive push notifications. SSE delivery still occurs for real-time UI updates.';

COMMENT ON COLUMN notification.personal_preference.dnd_enabled IS 
'When true, push notifications are suppressed during dnd_start..dnd_end window. SSE still delivered.';

-- ============================================================================
-- FILES SCHEMA: Cross-domain file storage with quota management
-- ============================================================================

-- files.file_metadata: Stores metadata for all uploaded files across the organization
CREATE TABLE IF NOT EXISTS files.file_metadata (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    
    -- File identification
    original_filename TEXT NOT NULL,
    storage_key TEXT NOT NULL, -- R2 object key: org-{uuid}/context/{id}
    
    -- File properties
    size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
    mime_type TEXT NOT NULL,
    
    -- Upload context
    upload_context TEXT NOT NULL CHECK (upload_context IN ('chat', 'avatar', 'docs', 'project')),
    uploaded_by_employee_id UUID NOT NULL,
    
    -- File validation (Feature 015)
    validation_status TEXT CHECK (validation_status IN ('pending', 'verified', 'warning', 'failed', 'skipped', 'dangerous')) DEFAULT 'pending',
    validation_message TEXT,
    detected_mime_type TEXT,
    
    -- Lifecycle
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding (organization_id first)
    PRIMARY KEY (organization_id, id),
    
    CONSTRAINT fk_file_uploader 
        FOREIGN KEY (organization_id, uploaded_by_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT
);

SELECT create_distributed_table('files.file_metadata', 'organization_id', colocate_with => 'public.organization');

-- Indexes for file_metadata
CREATE INDEX IF NOT EXISTS idx_file_metadata_context 
    ON files.file_metadata(organization_id, upload_context, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_file_metadata_uploader 
    ON files.file_metadata(organization_id, uploaded_by_employee_id);

CREATE INDEX IF NOT EXISTS idx_file_metadata_active 
    ON files.file_metadata(organization_id, updated_at DESC)
    WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_file_metadata_storage_key
    ON files.file_metadata(organization_id, storage_key);

CREATE INDEX IF NOT EXISTS idx_file_metadata_validation 
    ON files.file_metadata(organization_id, validation_status, updated_at DESC)
    WHERE validation_status IN ('warning', 'failed', 'dangerous');

COMMENT ON TABLE files.file_metadata IS 
'Stores metadata for all uploaded files. Actual binary data stored in Cloudflare R2 using storage_key.';

COMMENT ON COLUMN files.file_metadata.storage_key IS 
'R2 object key format: org-{organization_id}/{upload_context}/{file_id}. Used to construct presigned URLs.';

COMMENT ON COLUMN files.file_metadata.upload_context IS 
'Upload source context: chat, avatar, docs, project. MUST align with backend constants in internal/files/constants.go and frontend TypeScript types in packages/apis/src/files.ts';

COMMENT ON COLUMN files.file_metadata.is_deleted IS 
'Soft delete flag. When true, file is deleted from R2 but metadata preserved for audit trail.';

COMMENT ON COLUMN files.file_metadata.validation_status IS 
'File type validation status: pending (not yet validated), verified (type matches), warning (type mismatch but allowed), failed (validation error), skipped (no validation performed), dangerous (virus detected). MUST align with backend constants in internal/files/constants.go and frontend TypeScript types in packages/apis/src/files.ts';

-- files.file_quota: Per-organization storage quota configuration and usage tracking
CREATE TABLE IF NOT EXISTS files.file_quota (
    organization_id UUID PRIMARY KEY REFERENCES public.organization(id) ON DELETE CASCADE,
    
    -- Quota limits
    quota_bytes BIGINT NULL, -- NULL = unlimited
    max_file_size_bytes BIGINT NOT NULL DEFAULT 104857600, -- 100MB default
    
    -- Current usage
    current_usage_bytes BIGINT NOT NULL DEFAULT 0 CHECK (current_usage_bytes >= 0),
    
    -- Metadata
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

SELECT create_distributed_table('files.file_quota', 'organization_id', colocate_with => 'public.organization');

COMMENT ON TABLE files.file_quota IS 
'Per-organization storage quota configuration and real-time usage tracking. One row per organization.';

COMMENT ON COLUMN files.file_quota.quota_bytes IS 
'Maximum storage quota in bytes. NULL means unlimited quota. Enforced atomically during upload.';

COMMENT ON COLUMN files.file_quota.max_file_size_bytes IS 
'Maximum individual file size in bytes. Default 100MB (104857600 bytes). Configurable per organization.';

COMMENT ON COLUMN files.file_quota.current_usage_bytes IS 
'Real-time cumulative storage usage in bytes. Incremented on upload, decremented on deletion. Updated atomically with row-level locking.';

-- files.file_deletion_log: Immutable audit trail for file deletions
CREATE TABLE IF NOT EXISTS files.file_deletion_log (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    file_id UUID NOT NULL,
    original_filename TEXT NOT NULL,
    deleted_by_employee_id UUID NOT NULL,
    deletion_reason TEXT,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    PRIMARY KEY (organization_id, id),
    
    CONSTRAINT fk_file_deletion_deleter 
        FOREIGN KEY (organization_id, deleted_by_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT
);

SELECT create_distributed_table('files.file_deletion_log', 'organization_id', colocate_with => 'public.organization');

-- Indexes for file_deletion_log
CREATE INDEX IF NOT EXISTS idx_deletion_log_file_id
    ON files.file_deletion_log(organization_id, file_id, deleted_at DESC);

CREATE INDEX IF NOT EXISTS idx_deletion_log_deleter
    ON files.file_deletion_log(organization_id, deleted_by_employee_id, deleted_at DESC);

COMMENT ON TABLE files.file_deletion_log IS 
'Immutable audit trail for file deletions with reason tracking. Preserves deletion context even after file metadata removed.';

COMMENT ON COLUMN files.file_deletion_log.deletion_reason IS 
'Optional human-readable reason for deletion (e.g., "Policy violation", "User request", "Cleanup").';

COMMENT ON COLUMN files.file_deletion_log.file_id IS 
'Reference to deleted file. Does NOT have foreign key constraint to allow deletion log to persist after file_metadata removal.';

-- files.file_access_rule: Links files to their upload contexts and defines access scope (Feature 015)
CREATE TABLE IF NOT EXISTS files.file_access_rule (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    file_id UUID NOT NULL,
    
    -- Context identification
    context_type TEXT NOT NULL CHECK (context_type IN ('chat_channel', 'project', 'department_docs', 'calendar_event', 'support_ticket', 'crm_deal')),
    context_id UUID NOT NULL,
    
    -- Access scope
    access_scope TEXT NOT NULL CHECK (access_scope IN ('public', 'private', 'department')),
    
    -- Timestamps
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding (organization_id first)
    PRIMARY KEY (organization_id, id),
    
    CONSTRAINT fk_file_access_file 
        FOREIGN KEY (organization_id, file_id)
        REFERENCES files.file_metadata(organization_id, id)
        ON DELETE CASCADE,
    
    -- Unique constraint: one access rule per file
    CONSTRAINT unique_file_access UNIQUE (organization_id, file_id)
);

SELECT create_distributed_table('files.file_access_rule', 'organization_id', colocate_with => 'public.organization');

-- Indexes for file_access_rule
CREATE INDEX IF NOT EXISTS idx_file_access_context 
    ON files.file_access_rule(organization_id, context_type, context_id);

CREATE INDEX IF NOT EXISTS idx_file_access_file 
    ON files.file_access_rule(organization_id, file_id);

COMMENT ON TABLE files.file_access_rule IS 
'Links files to their upload contexts (channel, project, docs) and defines access scope (public, private, department). One row per file. Created by domain services (ChatService, DocsService) during upload flow, NOT by client.';

COMMENT ON COLUMN files.file_access_rule.context_type IS 
'Upload context type: chat_channel, project, department_docs, calendar_event, support_ticket, crm_deal. MUST align with backend constants in internal/files/constants.go and frontend TypeScript types in packages/apis/src/files.ts. Set by domain service (e.g., ChatService for chat_channel), NOT client-controlled.';

COMMENT ON COLUMN files.file_access_rule.access_scope IS 
'Access scope: public (all organization members), private (context members only), department (department members only). MUST align with backend constants in internal/files/constants.go. Derived from context properties (e.g., channel.is_private), NOT client-controlled.';

-- files.file_pdf_conversion: Tracks PDF conversions of office documents (Feature 015)
CREATE TABLE IF NOT EXISTS files.file_pdf_conversion (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    original_file_id UUID NOT NULL,
    
    -- Conversion metadata
    pdf_storage_key TEXT NOT NULL,  -- R2 object key for converted PDF
    pdf_size_bytes BIGINT NOT NULL CHECK (pdf_size_bytes >= 0),
    
    -- Conversion status
    conversion_status TEXT NOT NULL CHECK (conversion_status IN ('pending', 'in_progress', 'completed', 'failed')) DEFAULT 'pending',
    conversion_error TEXT,  -- Error message if conversion failed
    conversion_duration_ms INTEGER,  -- How long conversion took
    
    -- Timestamps
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding (organization_id first)
    PRIMARY KEY (organization_id, id),
    
    CONSTRAINT fk_pdf_conversion_file 
        FOREIGN KEY (organization_id, original_file_id)
        REFERENCES files.file_metadata(organization_id, id)
        ON DELETE CASCADE,
    
    -- Unique constraint: one conversion per original file
    CONSTRAINT unique_file_conversion UNIQUE (organization_id, original_file_id)
);

SELECT create_distributed_table('files.file_pdf_conversion', 'organization_id', colocate_with => 'public.organization');

-- Indexes for file_pdf_conversion
CREATE INDEX IF NOT EXISTS idx_pdf_conversion_original 
    ON files.file_pdf_conversion(organization_id, original_file_id);

CREATE INDEX IF NOT EXISTS idx_pdf_conversion_status 
    ON files.file_pdf_conversion(organization_id, conversion_status, updated_at DESC)
    WHERE conversion_status IN ('pending', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_pdf_conversion_storage_key 
    ON files.file_pdf_conversion(organization_id, pdf_storage_key);

COMMENT ON TABLE files.file_pdf_conversion IS 
'Tracks PDF conversions of office documents for in-browser preview. One row per converted file.';

COMMENT ON COLUMN files.file_pdf_conversion.conversion_status IS 
'Conversion status: pending (queued), in_progress (converting), completed (done), failed (error). MUST align with backend constants in internal/files/constants.go and frontend TypeScript types in packages/apis/src/files.ts';

COMMENT ON COLUMN files.file_pdf_conversion.pdf_storage_key IS 
'R2 object key for converted PDF. Format: org-{organization_id}/conversions/{original_file_id}.pdf';

COMMENT ON COLUMN files.file_pdf_conversion.conversion_duration_ms IS 
'Time taken for conversion in milliseconds. Used for performance monitoring and SLO tracking.';

-- files.file_content_index: Stores extracted text content for full-text search (Feature 015)
CREATE TABLE IF NOT EXISTS files.file_content_index (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    file_id UUID NOT NULL,
    
    -- Extracted content
    extracted_text TEXT NOT NULL,
    extraction_method TEXT NOT NULL CHECK (extraction_method IN ('office_parser', 'pdf_parser', 'image_ocr', 'plain_text')) DEFAULT 'plain_text',
    
    -- Indexing metadata
    indexing_status TEXT NOT NULL CHECK (indexing_status IN ('pending', 'in_progress', 'completed', 'failed')) DEFAULT 'pending',
    indexing_error TEXT,  -- Error message if indexing failed
    indexing_duration_ms INTEGER,  -- How long indexing took
    
    -- Timestamps
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding (organization_id first)
    PRIMARY KEY (organization_id, id),
    
    CONSTRAINT fk_file_content_file 
        FOREIGN KEY (organization_id, file_id)
        REFERENCES files.file_metadata(organization_id, id)
        ON DELETE CASCADE,
    
    -- Unique constraint: one index per file
    CONSTRAINT unique_file_index UNIQUE (organization_id, file_id)
);

SELECT create_distributed_table('files.file_content_index', 'organization_id', colocate_with => 'public.organization');

-- Indexes for file_content_index
CREATE INDEX IF NOT EXISTS idx_file_content_file 
    ON files.file_content_index(organization_id, file_id);

CREATE INDEX IF NOT EXISTS idx_file_content_status 
    ON files.file_content_index(organization_id, indexing_status, updated_at DESC)
    WHERE indexing_status IN ('pending', 'in_progress');

-- PGroonga full-text search index (already available, used for chat.message)
CREATE INDEX IF NOT EXISTS idx_file_content_pgroonga 
    ON files.file_content_index USING pgroonga(extracted_text);

COMMENT ON TABLE files.file_content_index IS 
'Stores extracted text content from files for full-text search using PGroonga. One row per indexed file. PGroonga automatically handles multilingual content without language detection.';

COMMENT ON COLUMN files.file_content_index.extracted_text IS 
'Plain text content extracted from file. PGroonga automatically tokenizes and indexes for multilingual full-text search (handles Latin, CJK, and all other scripts).';

COMMENT ON COLUMN files.file_content_index.extraction_method IS 
'Method used to extract text: office_parser (DOCX/XLSX/PPTX), pdf_parser (PDF), image_ocr (future), plain_text. MUST align with backend constants in internal/files/constants.go';

COMMENT ON COLUMN files.file_content_index.indexing_status IS 
'Indexing status: pending (queued), in_progress (extracting), completed (done), failed (error). MUST align with backend constants in internal/files/constants.go and frontend TypeScript types in packages/apis/src/files.ts';

COMMENT ON INDEX files.idx_file_content_pgroonga IS 
'PGroonga index for multilingual full-text search on extracted file content. Automatically handles all languages including CJK (Chinese, Japanese, Korean) and Latin scripts without requiring language detection or configuration. Used for file search across organization.';

-- Workflows: Main workflow state
CREATE TABLE IF NOT EXISTS "flows"."runs" (
        workflow_name_shard text NOT NULL,
        run_id             uuid NOT NULL,
        workflow_name      text NOT NULL,
        status        text NOT NULL,
        input_json    jsonb NOT NULL,
        output_json   jsonb,
        error_text    text,
        next_wake_at  timestamptz,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workflow_name_shard, run_id)
);

CREATE INDEX IF NOT EXISTS runs_runnable_idx
        ON "flows"."runs" (workflow_name_shard, status, next_wake_at, created_at);

CREATE TABLE IF NOT EXISTS "flows"."steps" (
        workflow_name_shard text NOT NULL,
        run_id              uuid NOT NULL,
        step_key    text NOT NULL,
        status      text NOT NULL,
        input_json  jsonb,
        output_json jsonb,
        error_text  text,
        attempts    int NOT NULL DEFAULT 0,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workflow_name_shard, run_id, step_key),
        FOREIGN KEY (workflow_name_shard, run_id)
                REFERENCES "flows"."runs"(workflow_name_shard, run_id)
                ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "flows"."waits" (
        workflow_name_shard text NOT NULL,
        run_id              uuid NOT NULL,
        wait_key     text NOT NULL,
        wait_type    text NOT NULL,
        event_name   text,
        wake_at      timestamptz,
        payload_json jsonb,
        satisfied_at timestamptz,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workflow_name_shard, run_id, wait_key),
        FOREIGN KEY (workflow_name_shard, run_id)
                REFERENCES "flows"."runs"(workflow_name_shard, run_id)
                ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS waits_event_idx
        ON "flows"."waits" (workflow_name_shard, event_name, satisfied_at);

-- One event per (run,event_name). If you need multiple events, add an event_id and remove this PK.
CREATE TABLE IF NOT EXISTS "flows"."events" (
        workflow_name_shard text NOT NULL,
        run_id              uuid NOT NULL,
        event_name   text NOT NULL,
        payload_json jsonb NOT NULL,
        created_at   timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workflow_name_shard, run_id, event_name),
        FOREIGN KEY (workflow_name_shard, run_id)
                REFERENCES "flows"."runs"(workflow_name_shard, run_id)
                ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "flows"."random" (
        workflow_name_shard text NOT NULL,
        run_id              uuid NOT NULL,
        rand_key     text NOT NULL,
        kind         text NOT NULL,
        value_text   text,
        value_bigint bigint,
        created_at   timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workflow_name_shard, run_id, rand_key),
        FOREIGN KEY (workflow_name_shard, run_id)
                REFERENCES "flows"."runs"(workflow_name_shard, run_id)
                ON DELETE CASCADE
);

-- Distribute the runs table by workflow_name_shard
SELECT create_distributed_table('flows.runs', 'workflow_name_shard');

-- Distribute child tables colocated with runs for foreign key support
SELECT create_distributed_table('flows.steps', 'workflow_name_shard', colocate_with => 'flows.runs');
SELECT create_distributed_table('flows.waits', 'workflow_name_shard', colocate_with => 'flows.runs');
SELECT create_distributed_table('flows.events', 'workflow_name_shard', colocate_with => 'flows.runs');
SELECT create_distributed_table('flows.random', 'workflow_name_shard', colocate_with => 'flows.runs');
-- ============================================================================
-- DOCS SCHEMA: Document Management System (Notion/Confluence-style)
-- ============================================================================

-- docs.document: Core document entity supporting hierarchical organization (max 10 levels)
CREATE TABLE IF NOT EXISTS docs.document (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    
    -- Document identity
    title TEXT NOT NULL,
    slug TEXT NOT NULL, -- Format: {title-slug}-{base62-uuid}
    document_type TEXT NOT NULL DEFAULT 'workspace_doc' CHECK (document_type IN ('workspace_doc', 'task_description', 'project_brief')),
    
    -- Hierarchy (max 10 levels enforced in application)
    parent_document_id UUID,
    depth SMALLINT NOT NULL DEFAULT 0 CHECK (depth >= 0 AND depth <= 10),
    path UUID[] NOT NULL DEFAULT '{}', -- Materialized path for efficient ancestor queries
    
    -- Content
    content_json JSONB NOT NULL DEFAULT '{}', -- TipTap/ProseMirror JSON
    content_text TEXT NOT NULL DEFAULT '', -- Plain text for full-text search
    
    -- Status
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'outdated', 'archived')),
    
    -- Visibility (root documents only)
    visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
    
    -- Ownership
    owner_employee_id UUID NOT NULL,
    
    -- Counters (denormalized for performance)
    child_count INT NOT NULL DEFAULT 0 CHECK (child_count >= 0),
    version_count INT NOT NULL DEFAULT 1 CHECK (version_count >= 1),
    follower_count INT NOT NULL DEFAULT 0 CHECK (follower_count >= 0),
    
    -- Soft delete
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    
    -- Timestamps
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding
    PRIMARY KEY (organization_id, id),
    
    -- Foreign keys
    CONSTRAINT fk_document_parent
        FOREIGN KEY (organization_id, parent_document_id)
        REFERENCES docs.document(organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_document_owner
        FOREIGN KEY (organization_id, owner_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT,
    
    -- Constraints
    CONSTRAINT unique_document_slug UNIQUE (organization_id, slug),
    CONSTRAINT root_visibility CHECK (
        (parent_document_id IS NULL) OR 
        (parent_document_id IS NOT NULL AND depth > 0)
    )
);

SELECT create_distributed_table('docs.document', 'organization_id', colocate_with => 'public.organization');

-- Indexes for docs.document
CREATE INDEX IF NOT EXISTS idx_document_parent 
    ON docs.document(organization_id, parent_document_id)
    WHERE parent_document_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_document_owner 
    ON docs.document(organization_id, owner_employee_id);

CREATE INDEX IF NOT EXISTS idx_document_status 
    ON docs.document(organization_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_document_path 
    ON docs.document USING GIN(path);

-- PGroonga full-text search index
CREATE INDEX IF NOT EXISTS idx_document_pgroonga 
    ON docs.document USING pgroonga(content_text);

-- Trigram index for title search
CREATE INDEX IF NOT EXISTS idx_document_title_trgm 
    ON docs.document USING GIN(title gin_trgm_ops);

COMMENT ON TABLE docs.document IS 
'Core document entity for Notion/Confluence-style documentation. Supports hierarchical nesting (max 10 levels), 
full-text search, and permanent slug-based URLs.';

COMMENT ON COLUMN docs.document.slug IS 
'URL-friendly identifier: {title-slug}-{base62-uuid}. Permanent across renames via slug_history redirect.';

COMMENT ON COLUMN docs.document.path IS 
'Materialized path array of ancestor document IDs from root to parent. Enables efficient subtree queries.';

COMMENT ON COLUMN docs.document.content_json IS 
'TipTap/ProseMirror document JSON with block IDs for section linking. Yjs-compatible for real-time collaboration.';

COMMENT ON COLUMN docs.document.content_text IS 
'Plain text extraction for PGroonga full-text search. Updated on every save.';

COMMENT ON COLUMN docs.document.status IS 
'Document lifecycle status: active, outdated, archived. MUST align with backend constants in internal/docs/constants.go and frontend types in packages/apis/src/docs.ts.';

COMMENT ON COLUMN docs.document.document_type IS 
'Document type: workspace_doc (regular docs in workspace), task_description (linked to tasks), project_brief (linked to projects). MUST align with backend constants in internal/docs/constants.go and frontend TypeScript types in packages/apis/src/docs.ts. Task descriptions and project briefs should NOT appear in workspace docs list.';

COMMENT ON COLUMN docs.document.visibility IS 
'Root document visibility: public (organization-wide), private (explicit grants only). Children inherit.';

-- docs.document_version: Version history with full content snapshots for diff and blame
CREATE TABLE IF NOT EXISTS docs.document_version (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    document_id UUID NOT NULL,
    
    -- Version identity
    version_number INT NOT NULL CHECK (version_number >= 1),
    
    -- Content snapshot
    content_json JSONB NOT NULL, -- Full TipTap JSON at this version
    content_text TEXT NOT NULL, -- Plain text extraction
    
    -- Author
    author_employee_id UUID NOT NULL,
    
    -- Edit metadata
    summary TEXT, -- Optional commit message
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding
    PRIMARY KEY (organization_id, id),
    
    -- Foreign keys
    CONSTRAINT fk_version_document
        FOREIGN KEY (organization_id, document_id)
        REFERENCES docs.document(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_version_author
        FOREIGN KEY (organization_id, author_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT,
    
    -- Constraints
    CONSTRAINT unique_version_number UNIQUE (organization_id, document_id, version_number)
);

SELECT create_distributed_table('docs.document_version', 'organization_id', colocate_with => 'public.organization');

-- Indexes for docs.document_version
CREATE INDEX IF NOT EXISTS idx_version_document 
    ON docs.document_version(organization_id, document_id, version_number DESC);

CREATE INDEX IF NOT EXISTS idx_version_author 
    ON docs.document_version(organization_id, author_employee_id, created_at DESC);

COMMENT ON TABLE docs.document_version IS 
'Version history with full content snapshots. Enables git blame attribution and diff comparison. No version pruning.';

COMMENT ON COLUMN docs.document_version.content_json IS 
'Complete TipTap JSON document at this version. Enables exact reconstruction and diff computation.';

-- docs.document_slug_history: Slug redirect history for permanent links
CREATE TABLE IF NOT EXISTS docs.document_slug_history (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    document_id UUID NOT NULL,
    
    -- Slug change
    old_slug TEXT NOT NULL,
    
    -- Timestamps
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding
    PRIMARY KEY (organization_id, id),
    
    -- Foreign keys
    CONSTRAINT fk_slug_history_document
        FOREIGN KEY (organization_id, document_id)
        REFERENCES docs.document(organization_id, id)
        ON DELETE CASCADE,
    
    -- Constraints
    CONSTRAINT unique_old_slug UNIQUE (organization_id, old_slug)
);

SELECT create_distributed_table('docs.document_slug_history', 'organization_id', colocate_with => 'public.organization');

-- Indexes for docs.document_slug_history
CREATE INDEX IF NOT EXISTS idx_slug_history_document 
    ON docs.document_slug_history(organization_id, document_id, changed_at DESC);

COMMENT ON TABLE docs.document_slug_history IS 
'Tracks slug changes for 301 redirect support. Old slugs permanently redirect to current slug.';

-- docs.document_access: Permission grants for private documents
CREATE TABLE IF NOT EXISTS docs.document_access (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    document_id UUID NOT NULL,
    
    -- Grantee
    grantee_type TEXT NOT NULL CHECK (grantee_type IN ('employee', 'department')),
    grantee_id UUID NOT NULL, -- employee_id or department_id
    
    -- Access level
    access_level TEXT NOT NULL CHECK (access_level IN ('read_comment', 'write_update', 'none')),
    
    -- Metadata
    granted_by_employee_id UUID NOT NULL,
    
    -- Timestamps
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding
    PRIMARY KEY (organization_id, id),
    
    -- Foreign keys
    CONSTRAINT fk_access_document
        FOREIGN KEY (organization_id, document_id)
        REFERENCES docs.document(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_access_grantor
        FOREIGN KEY (organization_id, granted_by_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT,
    
    -- Constraints
    CONSTRAINT unique_grantee UNIQUE (organization_id, document_id, grantee_type, grantee_id)
);

SELECT create_distributed_table('docs.document_access', 'organization_id', colocate_with => 'public.organization');

-- Indexes for docs.document_access
CREATE INDEX IF NOT EXISTS idx_access_document 
    ON docs.document_access(organization_id, document_id, access_level);

CREATE INDEX IF NOT EXISTS idx_access_employee 
    ON docs.document_access(organization_id, grantee_id, grantee_type)
    WHERE grantee_type = 'employee';

CREATE INDEX IF NOT EXISTS idx_access_department 
    ON docs.document_access(organization_id, grantee_id, grantee_type)
    WHERE grantee_type = 'department';

COMMENT ON TABLE docs.document_access IS 
'Permission grants for private documents. Grantees can be employees or departments. Children inherit but can only restrict.';

COMMENT ON COLUMN docs.document_access.access_level IS 
'Permission level: read_comment (view+comment), write_update (edit), none (explicit deny). MUST align with backend constants in internal/docs/constants.go.';

COMMENT ON COLUMN docs.document_access.grantee_type IS 
'Type of grantee: employee (individual), department (team grant). MUST align with backend constants in internal/docs/constants.go.';


-- docs.section_embed: Cross-document section citations/embeds (line-based with version snapshots)
CREATE TABLE IF NOT EXISTS docs.section_embed (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    
    -- Source (the document containing the embed)
    source_document_id UUID NOT NULL,
    source_line_start INT NOT NULL CHECK (source_line_start > 0), -- Line where embed is placed
    source_line_end INT NOT NULL CHECK (source_line_end >= source_line_start), -- End of embed block
    
    -- Target (the document being embedded)
    target_document_id UUID NOT NULL,
    target_line_start INT NOT NULL CHECK (target_line_start > 0), -- First line of embedded content
    target_line_end INT NOT NULL CHECK (target_line_end >= target_line_start), -- Last line of embedded content
    
    -- Version tracking (REQUIRED for snapshot behavior)
    target_version_number INT NOT NULL, -- Version of target document at embed creation time (snapshot, NOT live-tracking)
    
    -- Timestamps
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding
    PRIMARY KEY (organization_id, id),
    
    -- Foreign keys
    CONSTRAINT fk_embed_source_document
        FOREIGN KEY (organization_id, source_document_id)
        REFERENCES docs.document(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_embed_target_document
        FOREIGN KEY (organization_id, target_document_id)
        REFERENCES docs.document(organization_id, id)
        ON DELETE CASCADE,
    
    -- Constraints
    CONSTRAINT no_self_embed CHECK (source_document_id != target_document_id)
);

SELECT create_distributed_table('docs.section_embed', 'organization_id', colocate_with => 'public.organization');

-- Indexes for docs.section_embed
CREATE INDEX IF NOT EXISTS idx_embed_source 
    ON docs.section_embed(organization_id, source_document_id);

CREATE INDEX IF NOT EXISTS idx_embed_target 
    ON docs.section_embed(organization_id, target_document_id);

CREATE INDEX IF NOT EXISTS idx_embed_target_lines 
    ON docs.section_embed(organization_id, target_document_id, target_line_start, target_line_end);

COMMENT ON TABLE docs.section_embed IS 
'Cross-document section citations using line-based selection. Embeds create VERSION SNAPSHOTS at creation time - they reference the specific version of the target document that was visible when the embed was created. This prevents embedded content from changing unexpectedly when the source document is updated. Version tracking enables staleness detection and optional "update to latest" functionality.';

COMMENT ON COLUMN docs.section_embed.target_line_start IS 
'First line number (1-indexed) of embedded content from target document. Used for URL generation (#L10-L15) and content extraction.';

COMMENT ON COLUMN docs.section_embed.target_version_number IS 
'REQUIRED: Version of target document at embed creation time. Embeds are snapshots, NOT live-tracking. This ensures embedded content remains stable even if target document is updated. Backend auto-populates with current version if not explicitly provided. Staleness detection compares this with target document current version.';

-- docs.comment: Inline comments on text blocks
CREATE TABLE IF NOT EXISTS docs.comment (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    document_id UUID NOT NULL,
    
    -- Comment location
    block_id UUID, -- TipTap block where comment is anchored (NULL for document-level comments)
    text_selection_start INT, -- Character offset within block (optional)
    text_selection_end INT, -- Character offset within block (optional)
    
    -- Comment content
    comment_text TEXT NOT NULL,
    
    -- Author
    author_employee_id UUID NOT NULL,
    
    -- Status
    is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_by_employee_id UUID,
    resolved_at TIMESTAMPTZ,
    
    -- Counters
    reply_count INT NOT NULL DEFAULT 0 CHECK (reply_count >= 0),
    
    -- Timestamps
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding
    PRIMARY KEY (organization_id, id),
    
    -- Foreign keys
    CONSTRAINT fk_comment_document
        FOREIGN KEY (organization_id, document_id)
        REFERENCES docs.document(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_comment_author
        FOREIGN KEY (organization_id, author_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_comment_resolver
        FOREIGN KEY (organization_id, resolved_by_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT
);

SELECT create_distributed_table('docs.comment', 'organization_id', colocate_with => 'public.organization');

-- Indexes for docs.comment
CREATE INDEX IF NOT EXISTS idx_comment_document 
    ON docs.comment(organization_id, document_id, is_resolved, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_comment_author 
    ON docs.comment(organization_id, author_employee_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_comment_block 
    ON docs.comment(organization_id, document_id, block_id);

COMMENT ON TABLE docs.comment IS 
'Inline comments anchored to document blocks. Supports text selection ranges and threaded replies.';

-- docs.comment_reply: Replies to inline comments
CREATE TABLE IF NOT EXISTS docs.comment_reply (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    comment_id UUID NOT NULL,
    
    -- Reply content
    reply_text TEXT NOT NULL,
    
    -- Author
    author_employee_id UUID NOT NULL,
    
    -- Timestamps
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding
    PRIMARY KEY (organization_id, id),
    
    -- Foreign keys
    CONSTRAINT fk_reply_comment
        FOREIGN KEY (organization_id, comment_id)
        REFERENCES docs.comment(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_reply_author
        FOREIGN KEY (organization_id, author_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT
);

SELECT create_distributed_table('docs.comment_reply', 'organization_id', colocate_with => 'public.organization');

-- Indexes for docs.comment_reply
CREATE INDEX IF NOT EXISTS idx_reply_comment 
    ON docs.comment_reply(organization_id, comment_id, updated_at ASC);

COMMENT ON TABLE docs.comment_reply IS 
'Replies to inline comments. One level of threading only (no nested replies).';

-- docs.document_editor: UNLOGGED table for active editor tracking (max 10 per document)
CREATE UNLOGGED TABLE IF NOT EXISTS docs.document_editor (
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    document_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    
    -- Connection tracking
    connection_id UUID NOT NULL,
    instance_id TEXT NOT NULL, -- Backend instance identifier
    
    -- Editor state
    cursor_position JSONB, -- {block_id, offset}
    
    -- Timestamps
    connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding
    PRIMARY KEY (organization_id, document_id, employee_id),
    
    -- Foreign keys (Note: UNLOGGED tables don't enforce FK constraints as strictly)
    CONSTRAINT fk_editor_document
        FOREIGN KEY (organization_id, document_id)
        REFERENCES docs.document(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_editor_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE CASCADE
);

SELECT create_distributed_table('docs.document_editor', 'organization_id', colocate_with => 'public.organization');

-- Indexes for docs.document_editor
CREATE INDEX IF NOT EXISTS idx_editor_document 
    ON docs.document_editor(organization_id, document_id);

CREATE INDEX IF NOT EXISTS idx_editor_instance 
    ON docs.document_editor(organization_id, instance_id);

CREATE INDEX IF NOT EXISTS idx_editor_heartbeat 
    ON docs.document_editor(organization_id, last_heartbeat);

COMMENT ON TABLE docs.document_editor IS 
'UNLOGGED table tracking active document editors. Max 10 per document. Data lost on crash is acceptable (editors reconnect). 2-3x faster writes.';

COMMENT ON COLUMN docs.document_editor.cursor_position IS 
'Current cursor position: {block_id: "uuid", offset: 123}. Used for cursor awareness display.';

COMMENT ON COLUMN docs.document_editor.instance_id IS 
'Backend instance hosting WebSocket connection. Used for routing real-time sync messages.';

-- docs.document_reaction: Document reactions (thumbs up/down for feedback)
CREATE TABLE IF NOT EXISTS docs.document_reaction (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    document_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    
    -- Reaction type
    reaction_type TEXT NOT NULL CHECK (reaction_type IN ('thumbs_up', 'thumbs_down')),
    
    -- Timestamps
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding
    PRIMARY KEY (organization_id, id),
    
    -- Foreign keys
    CONSTRAINT fk_reaction_document
        FOREIGN KEY (organization_id, document_id)
        REFERENCES docs.document(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_reaction_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE CASCADE,
    
    -- Constraints - one reaction per employee-document (toggle behavior)
    CONSTRAINT unique_employee_reaction UNIQUE (organization_id, document_id, employee_id)
);

SELECT create_distributed_table('docs.document_reaction', 'organization_id', colocate_with => 'public.organization');

-- Indexes for docs.document_reaction
CREATE INDEX IF NOT EXISTS idx_reaction_document 
    ON docs.document_reaction(organization_id, document_id, reaction_type);

CREATE INDEX IF NOT EXISTS idx_reaction_employee 
    ON docs.document_reaction(organization_id, employee_id, updated_at DESC);

COMMENT ON TABLE docs.document_reaction IS 
'Document reactions for feedback (thumbs up/down). One reaction per employee per document (can change vote).';

COMMENT ON COLUMN docs.document_reaction.reaction_type IS 
'Reaction type: thumbs_up, thumbs_down. MUST align with backend constants in internal/docs/constants.go and frontend TypeScript types in packages/apis/src/docs.ts';

-- ============================================================================
-- COLLABORATION SCHEMA: Task Management System (Trello/Jira-style)
-- ============================================================================

-- collaboration.project: Task project container with state configuration
CREATE TABLE IF NOT EXISTS collaboration.project (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    
    -- Project identity
    name TEXT NOT NULL,
    key TEXT NOT NULL, -- Short identifier for task prefixes (e.g., "PROJ")
    description TEXT,
    
    -- Task numbering
    next_task_number INT NOT NULL DEFAULT 1 CHECK (next_task_number >= 1),
    
    -- Visibility
    visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
    
    -- Status
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    
    -- Metadata
    owner_employee_id UUID NOT NULL,
    
    -- Counters (denormalized for performance)
    member_count INT NOT NULL DEFAULT 0 CHECK (member_count >= 0),
    task_count INT NOT NULL DEFAULT 0 CHECK (task_count >= 0),
    
    -- Timestamps
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding (organization_id first)
    PRIMARY KEY (organization_id, id),
    
    -- Foreign keys
    CONSTRAINT fk_project_owner
        FOREIGN KEY (organization_id, owner_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT,
    
    -- Constraints
    CONSTRAINT unique_project_key UNIQUE (organization_id, key),
    CONSTRAINT valid_project_key CHECK (key ~ '^[A-Z][A-Z0-9_]{0,9}$') -- 1-10 uppercase alphanumeric
);

SELECT create_distributed_table('collaboration.project', 'organization_id', colocate_with => 'public.organization');

-- Indexes for project
CREATE INDEX IF NOT EXISTS idx_project_owner 
    ON collaboration.project(organization_id, owner_employee_id);

CREATE INDEX IF NOT EXISTS idx_project_visibility 
    ON collaboration.project(organization_id, visibility, is_archived)
    WHERE is_archived = FALSE;

-- Trigram index for fuzzy search on project name
CREATE INDEX IF NOT EXISTS idx_project_name_trgm 
    ON collaboration.project USING GIN(name gin_trgm_ops);

COMMENT ON TABLE collaboration.project IS 
'Task project container with configurable states and task levels. Projects group related tasks and define workflow.';

COMMENT ON COLUMN collaboration.project.key IS 
'Short uppercase identifier (1-10 chars) for task prefixes. Example: "PROJ" creates tasks PROJ-1, PROJ-2. MUST be unique per organization.';

COMMENT ON COLUMN collaboration.project.next_task_number IS 
'Atomic counter for task identifier generation. Incremented on each task creation.';

COMMENT ON COLUMN collaboration.project.visibility IS 
'Project visibility: public (all org members can view), private (explicit grants only). MUST align with backend constants in internal/collaboration/constants.go.';

-- collaboration.project_state: Customizable task states per project
CREATE TABLE IF NOT EXISTS collaboration.project_state (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    project_id UUID NOT NULL,
    
    -- State identity
    name TEXT NOT NULL, -- Display name (e.g., "In Progress")
    color TEXT NOT NULL DEFAULT '#3b82f6', -- Hex color for UI
    
    -- State category for reporting
    category TEXT NOT NULL DEFAULT 'todo' CHECK (category IN ('todo', 'in_progress', 'done', 'cancelled')),
    
    -- Position for ordering in board view
    position INT NOT NULL DEFAULT 0,
    
    -- Default state flags
    is_initial BOOLEAN NOT NULL DEFAULT FALSE, -- New tasks start here
    is_closed BOOLEAN NOT NULL DEFAULT FALSE, -- Tasks in this state are considered closed
    
    -- Timestamps
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding
    PRIMARY KEY (organization_id, id),
    
    -- Foreign keys
    CONSTRAINT fk_state_project
        FOREIGN KEY (organization_id, project_id)
        REFERENCES collaboration.project(organization_id, id)
        ON DELETE CASCADE,
    
    -- Constraints
    CONSTRAINT unique_state_name UNIQUE (organization_id, project_id, name),
    CONSTRAINT unique_state_position UNIQUE (organization_id, project_id, position)
);

SELECT create_distributed_table('collaboration.project_state', 'organization_id', colocate_with => 'public.organization');

-- Indexes for project_state
CREATE INDEX IF NOT EXISTS idx_state_project 
    ON collaboration.project_state(organization_id, project_id, position);

CREATE INDEX IF NOT EXISTS idx_state_initial 
    ON collaboration.project_state(organization_id, project_id)
    WHERE is_initial = TRUE;

COMMENT ON TABLE collaboration.project_state IS 
'Customizable task states per project. Projects can have unlimited states organized into categories for reporting.';

COMMENT ON COLUMN collaboration.project_state.category IS 
'State category for reporting: todo (not started), in_progress (active work), done (completed), cancelled. MUST align with backend constants.';

COMMENT ON COLUMN collaboration.project_state.is_initial IS 
'If true, new tasks start in this state. Only one state per project should be initial.';

COMMENT ON COLUMN collaboration.project_state.is_closed IS 
'If true, tasks in this state are considered closed/resolved. Used for metrics and analytics.';

-- collaboration.task_level: Task hierarchy levels per project (Epic → Story → Task → Subtask)
CREATE TABLE IF NOT EXISTS collaboration.task_level (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    project_id UUID NOT NULL,
    
    -- Level identity
    name TEXT NOT NULL, -- Display name (e.g., "Epic", "Story", "Task")
    icon TEXT, -- Icon identifier for UI
    color TEXT NOT NULL DEFAULT '#6b7280', -- Hex color
    
    -- Hierarchy position (0 = top level, higher = deeper)
    depth INT NOT NULL CHECK (depth >= 0 AND depth <= 4),
    
    -- Timestamps
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding
    PRIMARY KEY (organization_id, id),
    
    -- Foreign keys
    CONSTRAINT fk_level_project
        FOREIGN KEY (organization_id, project_id)
        REFERENCES collaboration.project(organization_id, id)
        ON DELETE CASCADE,
    
    -- Constraints
    CONSTRAINT unique_level_name UNIQUE (organization_id, project_id, name),
    CONSTRAINT unique_level_depth UNIQUE (organization_id, project_id, depth)
);

SELECT create_distributed_table('collaboration.task_level', 'organization_id', colocate_with => 'public.organization');

-- Indexes for task_level
CREATE INDEX IF NOT EXISTS idx_level_project 
    ON collaboration.task_level(organization_id, project_id, depth);

COMMENT ON TABLE collaboration.task_level IS 
'Task hierarchy level definitions per project. Defines which levels exist (Epic, Story, Task, Subtask) and their nesting rules.';

COMMENT ON COLUMN collaboration.task_level.depth IS 
'Hierarchy position: 0=Epic, 1=Story, 2=Task, 3=Subtask, 4=Checklist. Enforces parent-child level ordering.';

-- collaboration.task: Core task entity with hierarchy and integrations
CREATE TABLE IF NOT EXISTS collaboration.task (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    project_id UUID NOT NULL,
    
    -- Task identity
    identifier TEXT NOT NULL, -- Human-readable ID (e.g., "PROJ-123")
    title TEXT NOT NULL,
    
    -- Hierarchy (max 5 levels)
    parent_task_id UUID,
    depth SMALLINT NOT NULL DEFAULT 0 CHECK (depth >= 0 AND depth <= 5),
    path UUID[] NOT NULL DEFAULT '{}', -- Materialized path for ancestor queries
    level_id UUID NOT NULL,
    
    -- Workflow
    state_id UUID NOT NULL,
    
    -- Scheduling
    start_date DATE,
    due_date DATE,
    estimated_hours DECIMAL(8,2), -- For time tracking integration
    
    -- Cross-domain integrations
    channel_id UUID, -- Chat channel for task comments (chat.channel)
    description_document_id UUID, -- Rich description document (docs.document)
    file_ids UUID[] NOT NULL DEFAULT '{}', -- Attached files (files.file_metadata)
    
    -- Assignment
    reporter_employee_id UUID NOT NULL,
    
    -- Counters
    child_count INT NOT NULL DEFAULT 0 CHECK (child_count >= 0),
    comment_count INT NOT NULL DEFAULT 0 CHECK (comment_count >= 0),
    
    -- Soft delete
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    
    -- Timestamps
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding
    PRIMARY KEY (organization_id, id),
    
    -- Foreign keys
    CONSTRAINT fk_task_project
        FOREIGN KEY (organization_id, project_id)
        REFERENCES collaboration.project(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_task_parent
        FOREIGN KEY (organization_id, parent_task_id)
        REFERENCES collaboration.task(organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_task_level
        FOREIGN KEY (organization_id, level_id)
        REFERENCES collaboration.task_level(organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_task_state
        FOREIGN KEY (organization_id, state_id)
        REFERENCES collaboration.project_state(organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_task_reporter
        FOREIGN KEY (organization_id, reporter_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_task_channel
        FOREIGN KEY (organization_id, channel_id)
        REFERENCES chat.channel(organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_task_description
        FOREIGN KEY (organization_id, description_document_id)
        REFERENCES docs.document(organization_id, id)
        ON DELETE RESTRICT,
    
    -- Constraints
    CONSTRAINT unique_task_identifier UNIQUE (organization_id, project_id, identifier),
    CONSTRAINT no_self_parent CHECK (parent_task_id IS NULL OR parent_task_id != id),
    CONSTRAINT valid_date_range CHECK (start_date IS NULL OR due_date IS NULL OR start_date <= due_date)
);

SELECT create_distributed_table('collaboration.task', 'organization_id', colocate_with => 'public.organization');

-- Indexes for task
CREATE INDEX IF NOT EXISTS idx_task_project_state 
    ON collaboration.task(organization_id, project_id, state_id, updated_at DESC)
    WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_task_parent 
    ON collaboration.task(organization_id, parent_task_id)
    WHERE parent_task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_reporter 
    ON collaboration.task(organization_id, reporter_employee_id);

CREATE INDEX IF NOT EXISTS idx_task_channel 
    ON collaboration.task(organization_id, channel_id)
    WHERE channel_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_dates 
    ON collaboration.task(organization_id, project_id, start_date, due_date)
    WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_task_path 
    ON collaboration.task USING GIN(path);

-- PGroonga full-text search on task title
CREATE INDEX IF NOT EXISTS idx_task_title_pgroonga 
    ON collaboration.task USING pgroonga(title);

-- Trigram index for fuzzy title search
CREATE INDEX IF NOT EXISTS idx_task_title_trgm 
    ON collaboration.task USING GIN(title gin_trgm_ops);

COMMENT ON TABLE collaboration.task IS 
'Core task entity with hierarchical nesting, workflow states, and cross-domain integrations to chat (comments), docs (description), and files (attachments).';

COMMENT ON COLUMN collaboration.task.identifier IS 
'Human-readable task identifier: {project_key}-{number}. Example: PROJ-123. Unique within project.';

COMMENT ON COLUMN collaboration.task.path IS 
'Materialized path array of ancestor task IDs from root to parent. Enables efficient subtree queries.';

COMMENT ON COLUMN collaboration.task.channel_id IS 
'Chat channel for task comments and discussion. Auto-created on task creation with channel_type=project_ticket_thread.';

COMMENT ON COLUMN collaboration.task.description_document_id IS 
'Linked document for rich task description with versioning and comments. Auto-created on task creation with document_type=task_description. These documents should NOT appear in workspace docs list.';

COMMENT ON COLUMN collaboration.task.file_ids IS 
'Array of file UUIDs from files.file_metadata. Managed via Files API with upload_context=project.';

-- collaboration.task_assignee: Task assignment tracking
CREATE TABLE IF NOT EXISTS collaboration.task_assignee (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    task_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    
    -- Assignment role
    role TEXT NOT NULL DEFAULT 'assignee' CHECK (role IN ('assignee', 'reviewer', 'approver')),
    
    -- Timestamps
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    assigned_by_employee_id UUID NOT NULL,
    
    -- Composite primary key for Citus sharding
    PRIMARY KEY (organization_id, id),
    
    -- Foreign keys
    CONSTRAINT fk_assignee_task
        FOREIGN KEY (organization_id, task_id)
        REFERENCES collaboration.task(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_assignee_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_assignee_assigned_by
        FOREIGN KEY (organization_id, assigned_by_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT,
    
    -- Constraints
    CONSTRAINT unique_task_assignee UNIQUE (organization_id, task_id, employee_id, role)
);

SELECT create_distributed_table('collaboration.task_assignee', 'organization_id', colocate_with => 'public.organization');

-- Indexes for task_assignee
CREATE INDEX IF NOT EXISTS idx_assignee_task 
    ON collaboration.task_assignee(organization_id, task_id);

CREATE INDEX IF NOT EXISTS idx_assignee_employee 
    ON collaboration.task_assignee(organization_id, employee_id);

COMMENT ON TABLE collaboration.task_assignee IS 
'Task assignment tracking with support for multiple assignees per task and different roles (assignee, reviewer, approver).';

COMMENT ON COLUMN collaboration.task_assignee.role IS 
'Assignment role: assignee (responsible for work), reviewer (reviews work), approver (approves completion). MUST align with backend constants.';

-- collaboration.custom_field_definition: Custom field definitions per project
CREATE TABLE IF NOT EXISTS collaboration.custom_field_definition (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    project_id UUID NOT NULL,
    
    -- Field identity
    name TEXT NOT NULL, -- Display name (e.g., "Story Points")
    description TEXT,
    
    -- Field type
    field_type TEXT NOT NULL CHECK (field_type IN ('text', 'number', 'single_select', 'multi_select', 'date', 'user', 'checkbox')),
    
    -- Type-specific options
    options JSONB, -- For select types: ["XS", "S", "M", "L", "XL"]
    default_value JSONB, -- Default value for new tasks
    
    -- Constraints
    is_required BOOLEAN NOT NULL DEFAULT FALSE,
    min_value DECIMAL(10,2), -- For number type
    max_value DECIMAL(10,2), -- For number type
    
    -- Display
    position INT NOT NULL DEFAULT 0, -- Order in field list
    
    -- Status
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    
    -- Timestamps
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding
    PRIMARY KEY (organization_id, id),
    
    -- Foreign keys
    CONSTRAINT fk_field_def_project
        FOREIGN KEY (organization_id, project_id)
        REFERENCES collaboration.project(organization_id, id)
        ON DELETE CASCADE,
    
    -- Constraints
    CONSTRAINT unique_field_name UNIQUE (organization_id, project_id, name)
);

SELECT create_distributed_table('collaboration.custom_field_definition', 'organization_id', colocate_with => 'public.organization');

-- Indexes for custom_field_definition
CREATE INDEX IF NOT EXISTS idx_field_def_project 
    ON collaboration.custom_field_definition(organization_id, project_id, position)
    WHERE is_archived = FALSE;

COMMENT ON TABLE collaboration.custom_field_definition IS 
'Custom field definitions per project. Supports text, number, single/multi select, date, user, checkbox field types.';

COMMENT ON COLUMN collaboration.custom_field_definition.field_type IS 
'Field type: text, number, single_select, multi_select, date, user (employee picker), checkbox. MUST align with backend constants.';

COMMENT ON COLUMN collaboration.custom_field_definition.options IS 
'For select types: array of option values. Example: ["XS", "S", "M", "L", "XL"] for t-shirt sizes.';

-- collaboration.custom_field_value: Custom field values per task
CREATE TABLE IF NOT EXISTS collaboration.custom_field_value (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    task_id UUID NOT NULL,
    field_definition_id UUID NOT NULL,
    
    -- Value (flexible JSONB storage)
    value JSONB NOT NULL, -- Type depends on field_type
    
    -- Timestamps
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding
    PRIMARY KEY (organization_id, id),
    
    -- Foreign keys
    CONSTRAINT fk_field_value_task
        FOREIGN KEY (organization_id, task_id)
        REFERENCES collaboration.task(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_field_value_definition
        FOREIGN KEY (organization_id, field_definition_id)
        REFERENCES collaboration.custom_field_definition(organization_id, id)
        ON DELETE CASCADE,
    
    -- Constraints
    CONSTRAINT unique_task_field UNIQUE (organization_id, task_id, field_definition_id)
);

SELECT create_distributed_table('collaboration.custom_field_value', 'organization_id', colocate_with => 'public.organization');

-- Indexes for custom_field_value
CREATE INDEX IF NOT EXISTS idx_field_value_task 
    ON collaboration.custom_field_value(organization_id, task_id);

CREATE INDEX IF NOT EXISTS idx_field_value_definition 
    ON collaboration.custom_field_value(organization_id, field_definition_id);

-- GIN index for JSONB queries on value
CREATE INDEX IF NOT EXISTS idx_field_value_json 
    ON collaboration.custom_field_value USING GIN(value);

COMMENT ON TABLE collaboration.custom_field_value IS 
'Custom field values per task. JSONB storage enables flexible value types while maintaining queryability for analytics.';

COMMENT ON COLUMN collaboration.custom_field_value.value IS 
'Field value as JSONB. Examples: "value text" for text, 5 for number, ["M"] for single_select, ["A","B"] for multi_select, "2024-12-26" for date, "uuid" for user.';

-- collaboration.workflow_rule: Workflow automation rules
CREATE TABLE IF NOT EXISTS collaboration.workflow_rule (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    project_id UUID NOT NULL,
    
    -- Rule identity
    name TEXT NOT NULL,
    description TEXT,
    
    -- Trigger
    trigger_type TEXT NOT NULL DEFAULT 'state_entered' CHECK (trigger_type IN ('state_entered', 'state_exited', 'field_changed', 'task_created')),
    trigger_state_id UUID, -- For state triggers
    trigger_field_id UUID, -- For field triggers
    trigger_condition JSONB, -- Additional conditions: {"field_id": "...", "operator": "equals", "value": "..."}
    
    -- Action
    action_type TEXT NOT NULL CHECK (action_type IN ('set_state', 'set_field', 'assign_user', 'notify', 'close_task')),
    action_payload JSONB NOT NULL, -- Action-specific data
    
    -- Execution
    position INT NOT NULL DEFAULT 0, -- Execution order when multiple rules match
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    
    -- Timestamps
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding
    PRIMARY KEY (organization_id, id),
    
    -- Foreign keys
    CONSTRAINT fk_rule_project
        FOREIGN KEY (organization_id, project_id)
        REFERENCES collaboration.project(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_rule_trigger_state
        FOREIGN KEY (organization_id, trigger_state_id)
        REFERENCES collaboration.project_state(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_rule_trigger_field
        FOREIGN KEY (organization_id, trigger_field_id)
        REFERENCES collaboration.custom_field_definition(organization_id, id)
        ON DELETE CASCADE
);

SELECT create_distributed_table('collaboration.workflow_rule', 'organization_id', colocate_with => 'public.organization');

-- Indexes for workflow_rule
CREATE INDEX IF NOT EXISTS idx_rule_project 
    ON collaboration.workflow_rule(organization_id, project_id, position)
    WHERE is_enabled = TRUE;

CREATE INDEX IF NOT EXISTS idx_rule_trigger_state 
    ON collaboration.workflow_rule(organization_id, trigger_state_id)
    WHERE trigger_state_id IS NOT NULL AND is_enabled = TRUE;

COMMENT ON TABLE collaboration.workflow_rule IS 
'Workflow automation rules. Triggers execute actions within task update transaction for atomicity.';

COMMENT ON COLUMN collaboration.workflow_rule.trigger_type IS 
'Trigger type: state_entered, state_exited, field_changed, task_created. MUST align with backend constants.';

COMMENT ON COLUMN collaboration.workflow_rule.action_type IS 
'Action type: set_state, set_field, assign_user, notify, close_task. MUST align with backend constants.';

COMMENT ON COLUMN collaboration.workflow_rule.action_payload IS 
'Action payload: {"stateId": "..."} for set_state, {"fieldId": "...", "value": ...} for set_field, {"employeeId": "..."} for assign_user.';

-- collaboration.workflow_rule_execution: Audit log for rule executions
CREATE TABLE IF NOT EXISTS collaboration.workflow_rule_execution (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    rule_id UUID NOT NULL,
    task_id UUID NOT NULL,
    
    -- Execution result
    status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
    error_message TEXT, -- If failed
    
    -- Context
    triggered_by_employee_id UUID NOT NULL, -- Who caused the trigger
    execution_context JSONB, -- Trigger details: {"previousState": "...", "newState": "..."}
    
    -- Timing
    executed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    duration_ms INT, -- Execution time
    
    -- Composite primary key for Citus sharding
    PRIMARY KEY (organization_id, id),
    
    -- Foreign keys
    CONSTRAINT fk_execution_rule
        FOREIGN KEY (organization_id, rule_id)
        REFERENCES collaboration.workflow_rule(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_execution_task
        FOREIGN KEY (organization_id, task_id)
        REFERENCES collaboration.task(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_execution_triggered_by
        FOREIGN KEY (organization_id, triggered_by_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT
);

SELECT create_distributed_table('collaboration.workflow_rule_execution', 'organization_id', colocate_with => 'public.organization');

-- Indexes for workflow_rule_execution
CREATE INDEX IF NOT EXISTS idx_execution_rule 
    ON collaboration.workflow_rule_execution(organization_id, rule_id, executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_execution_task 
    ON collaboration.workflow_rule_execution(organization_id, task_id, executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_execution_status 
    ON collaboration.workflow_rule_execution(organization_id, status, executed_at DESC)
    WHERE status = 'failed';

COMMENT ON TABLE collaboration.workflow_rule_execution IS 
'Audit log tracking workflow rule executions. Used for debugging and analytics.';

-- collaboration.project_membership: Project membership and roles
CREATE TABLE IF NOT EXISTS collaboration.project_membership (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    project_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    
    -- Role
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
    
    -- Notification preferences
    notification_preference TEXT NOT NULL DEFAULT 'all' CHECK (notification_preference IN ('all', 'mentions', 'assigned', 'muted')),
    
    -- Timestamps
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(), -- When member joined project
    invited_by_employee_id UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding
    PRIMARY KEY (organization_id, id),
    
    -- Foreign keys
    CONSTRAINT fk_membership_project
        FOREIGN KEY (organization_id, project_id)
        REFERENCES collaboration.project(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_membership_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_membership_invited_by
        FOREIGN KEY (organization_id, invited_by_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT,
    
    -- Constraints
    CONSTRAINT unique_project_member UNIQUE (organization_id, project_id, employee_id)
);

SELECT create_distributed_table('collaboration.project_membership', 'organization_id', colocate_with => 'public.organization');

-- Indexes for project_membership
CREATE INDEX IF NOT EXISTS idx_membership_project 
    ON collaboration.project_membership(organization_id, project_id, role);

CREATE INDEX IF NOT EXISTS idx_membership_employee 
    ON collaboration.project_membership(organization_id, employee_id);

COMMENT ON TABLE collaboration.project_membership IS 
'Project membership with role-based access control. Roles determine permissions for viewing, editing, and managing projects.';

COMMENT ON COLUMN collaboration.project_membership.role IS 
'Member role: owner (full control), admin (manage members), member (edit tasks), viewer (read only). MUST align with backend constants.';

COMMENT ON COLUMN collaboration.project_membership.notification_preference IS 
'Notification preference: all, mentions (only @mentions), assigned (only when assigned), muted. MUST align with backend constants.';

-- collaboration.saved_view: Saved view configurations
CREATE TABLE IF NOT EXISTS collaboration.saved_view (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    project_id UUID NOT NULL,
    
    -- Owner (NULL = shared view)
    employee_id UUID,
    
    -- View identity
    name TEXT NOT NULL,
    
    -- View type
    view_type TEXT NOT NULL CHECK (view_type IN ('board', 'list', 'gantt', 'calendar')),
    
    -- Configuration
    config JSONB NOT NULL DEFAULT '{}', -- {filters: [...], groupBy: [...], columns: [...], sortBy: [...]}
    
    -- Display
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    position INT NOT NULL DEFAULT 0,
    
    -- Timestamps
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding
    PRIMARY KEY (organization_id, id),
    
    -- Foreign keys
    CONSTRAINT fk_view_project
        FOREIGN KEY (organization_id, project_id)
        REFERENCES collaboration.project(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_view_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE CASCADE
);

SELECT create_distributed_table('collaboration.saved_view', 'organization_id', colocate_with => 'public.organization');

-- Indexes for saved_view
CREATE INDEX IF NOT EXISTS idx_view_project 
    ON collaboration.saved_view(organization_id, project_id, position);

CREATE INDEX IF NOT EXISTS idx_view_employee 
    ON collaboration.saved_view(organization_id, employee_id)
    WHERE employee_id IS NOT NULL;

COMMENT ON TABLE collaboration.saved_view IS 
'Saved view configurations for personalized or shared filtering and display settings.';

COMMENT ON COLUMN collaboration.saved_view.employee_id IS 
'View owner. NULL indicates a shared project-level view visible to all members.';

COMMENT ON COLUMN collaboration.saved_view.view_type IS 
'View type: board (kanban), list (table), gantt (timeline), calendar. MUST align with backend constants.';

COMMENT ON COLUMN collaboration.saved_view.config IS 
'View configuration: {filters: [{fieldId, operator, value}], groupBy: ["stateId"], columns: ["title", "assignees"], sortBy: [{field, direction}]}';
