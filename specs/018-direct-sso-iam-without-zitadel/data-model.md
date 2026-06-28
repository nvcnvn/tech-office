# Data Model: Direct SSO IAM Without Zitadel

**Feature**: Replace Zitadel with direct SSO + custom authentication  
**Date**: 2026-02-10  
**Status**: Complete

## Overview

This document defines the complete database schema for the new IAM system, including:
- Global user accounts (no organization_id)
- SSO identity linking (Google, Apple)
- Password credentials
- Organization memberships (many-to-many)
- Invitations
- Password reset tokens
- Session tracking

**Key Design Principles**:
1. **Global user scope**: Users NOT tied to single organization
2. **Flexible SSO**: Multiple SSO providers per user
3. **Optional password**: Users can have SSO-only, password-only, or both
4. **Role per org**: Same user has different roles in different organizations
5. **Citus-ready**: All org-scoped tables include organization_id for sharding

---

## Schema: iam

**Purpose**: Core authentication and authorization tables

### Table: iam.user

**Purpose**: Global user accounts (NOT organization-scoped)

```sql
CREATE SCHEMA IF NOT EXISTS iam;

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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_email ON iam.user(email);
CREATE INDEX IF NOT EXISTS idx_user_status ON iam.user(status) WHERE status = 'active';

-- Comments
COMMENT ON TABLE iam.user IS 
'Global user accounts. NOT organization-scoped - users can belong to multiple organizations with different roles.';
COMMENT ON COLUMN iam.user.status IS 'Valid values: active, suspended, deleted';
```

**Relationships**:
- Has many `iam.sso_identity` (SSO provider links)
- Has one `iam.password_credential` (optional)
- Has many `iam.organization_membership` (roles per org)
- Has many `iam.session` (active sessions)

**Query Patterns**:
```sql
-- name: GetUserByEmail :one
SELECT * FROM iam.user WHERE email = $1;

-- name: GetUserByID :one
SELECT * FROM iam.user WHERE id = $1;

-- name: CreateUser :one
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
```

---

### Table: iam.sso_identity

**Purpose**: Link SSO providers (Google, Apple) to users

```sql
CREATE TABLE IF NOT EXISTS iam.sso_identity (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    user_id UUID NOT NULL REFERENCES iam.user(id) ON DELETE CASCADE,
    provider TEXT NOT NULL 
        CHECK (provider IN ('google', 'apple')),
    provider_user_id TEXT NOT NULL, -- 'sub' claim from provider JWT
    email TEXT NOT NULL, -- Email from provider (may differ from iam.user.email)
    created_at TIMESTAMPTZ DEFAULT now(),
    last_used_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(provider, provider_user_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sso_user ON iam.sso_identity(user_id);
CREATE INDEX IF NOT EXISTS idx_sso_provider_id ON iam.sso_identity(provider, provider_user_id);

-- Comments
COMMENT ON TABLE iam.sso_identity IS 
'SSO provider identities linked to users. Users can have multiple providers (Google + Apple).';
COMMENT ON COLUMN iam.sso_identity.provider_user_id IS 
'Unique user ID from SSO provider (sub claim in JWT)';
```

**Relationships**:
- Belongs to `iam.user`

**Query Patterns**:
```sql
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

-- name: UnlinkSSOIdentity :exec
DELETE FROM iam.sso_identity 
WHERE id = $1 AND user_id = $2;
```

---

### Table: iam.password_credential

**Purpose**: Store bcrypt-hashed passwords for email/password authentication

```sql
CREATE TABLE IF NOT EXISTS iam.password_credential (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    user_id UUID NOT NULL UNIQUE REFERENCES iam.user(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_password_user ON iam.password_credential(user_id);

-- Comments
COMMENT ON TABLE iam.password_credential IS 
'Password credentials for email/password authentication. Optional - users can be SSO-only.';
COMMENT ON COLUMN iam.password_credential.password_hash IS 
'bcrypt-hashed password (cost factor 12)';
```

**Relationships**:
- Belongs to `iam.user` (one-to-one)

**Query Patterns**:
```sql
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

-- name: DeletePasswordCredential :exec
DELETE FROM iam.password_credential 
WHERE user_id = $1;
```

---

### Table: iam.organization_membership

**Purpose**: Many-to-many relationship between users and organizations with roles

**IMPORTANT**: This table HAS `organization_id` as it represents org-scoped data

```sql
CREATE TABLE IF NOT EXISTS iam.organization_membership (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    user_id UUID NOT NULL REFERENCES iam.user(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    role TEXT NOT NULL 
        CHECK (role IN ('admin', 'owner', 'operator', 'employee')),
    joined_at TIMESTAMPTZ DEFAULT now(),
    invited_by UUID REFERENCES iam.user(id),
    UNIQUE(user_id, organization_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_membership_user ON iam.organization_membership(user_id);
CREATE INDEX IF NOT EXISTS idx_membership_org ON iam.organization_membership(organization_id);
CREATE INDEX IF NOT EXISTS idx_membership_org_role ON iam.organization_membership(organization_id, role);

-- Comments
COMMENT ON TABLE iam.organization_membership IS 
'Many-to-many: users can belong to multiple organizations with different roles.';
COMMENT ON COLUMN iam.organization_membership.role IS 
'Valid values: admin, owner, operator, employee';
```

**Relationships**:
- Belongs to `iam.user`
- Belongs to `public.organization`

**Query Patterns**:
```sql
-- name: GetUserOrganizations :many
SELECT 
    m.id,
    m.user_id,
    m.organization_id,
    m.role,
    m.joined_at,
    o.company_name,
    o.subdomain
FROM iam.organization_membership m
INNER JOIN public.organization o ON m.organization_id = o.id
WHERE m.user_id = $1;

-- name: GetUserRolesInOrg :many
SELECT role 
FROM iam.organization_membership
WHERE user_id = $1 AND organization_id = $2;

-- name: GetOrgMembers :many
SELECT 
    m.id,
    m.user_id,
    m.role,
    m.joined_at,
    u.email,
    u.display_name
FROM iam.organization_membership m
INNER JOIN iam.user u ON m.user_id = u.id
WHERE m.organization_id = $1
ORDER BY m.joined_at DESC;

-- name: CreateOrganizationMembership :one
INSERT INTO iam.organization_membership (
    id, user_id, organization_id, role, invited_by
) VALUES (
    $1, $2, $3, $4, $5
) RETURNING *;

-- name: UpdateMembershipRole :exec
UPDATE iam.organization_membership 
SET role = $3
WHERE user_id = $1 AND organization_id = $2;

-- name: DeleteOrganizationMembership :exec
DELETE FROM iam.organization_membership 
WHERE user_id = $1 AND organization_id = $2;
```

---

### Table: iam.invitation

**Purpose**: Track pending invitations to join organizations

```sql
CREATE TABLE IF NOT EXISTS iam.invitation (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL 
        CHECK (role IN ('admin', 'owner', 'operator', 'employee')),
    token TEXT NOT NULL UNIQUE,
    invited_by UUID NOT NULL REFERENCES iam.user(id),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'cancelled', 'expired')),
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_invitation_token ON iam.invitation(token) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_invitation_email ON iam.invitation(email, status);
CREATE INDEX IF NOT EXISTS idx_invitation_org ON iam.invitation(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_invitation_expiry ON iam.invitation(expires_at) WHERE status = 'pending';

-- Comments
COMMENT ON TABLE iam.invitation IS 
'Pending invitations to join organizations. Account created on first login if not exists.';
COMMENT ON COLUMN iam.invitation.token IS 
'Secure random token (32 bytes base64-encoded) for invitation link';
COMMENT ON COLUMN iam.invitation.status IS 
'Valid values: pending, accepted, cancelled, expired';
```

**Relationships**:
- Belongs to `public.organization`
- Belongs to `iam.user` (invited_by)

**Query Patterns**:
```sql
-- name: GetInvitationByToken :one
SELECT * FROM iam.invitation 
WHERE token = $1 AND status = 'pending';

-- name: GetOrgInvitations :many
SELECT * FROM iam.invitation 
WHERE organization_id = $1 AND status = $2
ORDER BY created_at DESC;

-- name: CreateInvitation :one
INSERT INTO iam.invitation (
    id, organization_id, email, role, token, invited_by, expires_at
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

-- name: ExpireOldInvitations :exec
UPDATE iam.invitation 
SET status = 'expired'
WHERE status = 'pending' AND expires_at < now();
```

---

### Table: iam.password_reset_token

**Purpose**: Time-limited, single-use tokens for password reset

```sql
CREATE TABLE IF NOT EXISTS iam.password_reset_token (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    user_id UUID NOT NULL REFERENCES iam.user(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_reset_token ON iam.password_reset_token(token) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reset_user ON iam.password_reset_token(user_id);
CREATE INDEX IF NOT EXISTS idx_reset_expiry ON iam.password_reset_token(expires_at) WHERE used_at IS NULL;

-- Comments
COMMENT ON TABLE iam.password_reset_token IS 
'Time-limited (1 hour), single-use tokens for password reset flow.';
COMMENT ON COLUMN iam.password_reset_token.token IS 
'Secure random token (32 bytes base64-encoded) for reset link';
```

**Relationships**:
- Belongs to `iam.user`

**Query Patterns**:
```sql
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

-- name: CleanupExpiredResetTokens :exec
DELETE FROM iam.password_reset_token 
WHERE expires_at < now() - interval '7 days';
```

---

### Table: iam.session

**Purpose**: Track active sessions for audit, re-auth prompts, and session management

```sql
CREATE TABLE IF NOT EXISTS iam.session (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    user_id UUID NOT NULL REFERENCES iam.user(id) ON DELETE CASCADE,
    token_jti TEXT NOT NULL UNIQUE, -- JWT ID from token
    issued_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    last_activity_at TIMESTAMPTZ DEFAULT now(),
    ip_address INET,
    user_agent TEXT,
    invalidated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_session_user ON iam.session(user_id) WHERE invalidated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_session_token ON iam.session(token_jti) WHERE invalidated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_session_expiry ON iam.session(expires_at) WHERE invalidated_at IS NULL;

-- Comments
COMMENT ON TABLE iam.session IS 
'Active sessions for tracking, re-auth prompts, and audit. Regular table (not UNLOGGED) - sessions must persist across crashes.';
COMMENT ON COLUMN iam.session.token_jti IS 
'JWT ID (jti claim) for unique session identification';
```

**Relationships**:
- Belongs to `iam.user`

**Query Patterns**:
```sql
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

-- name: CleanupExpiredSessions :exec
DELETE FROM iam.session 
WHERE expires_at < now() - interval '30 days';
```

---

## Entity Relationship Diagram

```
┌─────────────────┐
│   iam.user      │ (GLOBAL - no organization_id)
│  - id (PK)      │
│  - email (UQ)   │
│  - display_name │
│  - status       │
└────────┬────────┘
         │
         ├───────────────────────────────────┐
         │                                   │
         │ 1:N                          1:1 (optional)
         ▼                                   ▼
┌─────────────────────┐         ┌──────────────────────┐
│ iam.sso_identity    │         │ iam.password_        │
│  - id (PK)          │         │   credential         │
│  - user_id (FK)     │         │  - id (PK)           │
│  - provider         │         │  - user_id (FK, UQ)  │
│  - provider_user_id │         │  - password_hash     │
│  - email            │         └──────────────────────┘
└─────────────────────┘
         
         │ 1:N (from iam.user)
         ▼
┌──────────────────────────┐
│ iam.organization_        │
│   membership             │ (HAS organization_id - org-scoped)
│  - id (PK)               │
│  - user_id (FK)          │
│  - organization_id (FK)  │──→ public.organization
│  - role                  │
│  - invited_by (FK)       │
└──────────────────────────┘

┌──────────────────────┐
│ iam.invitation       │ (HAS organization_id - org-scoped)
│  - id (PK)           │
│  - organization_id   │──→ public.organization
│  - email             │
│  - role              │
│  - token (UQ)        │
│  - invited_by (FK)   │──→ iam.user
│  - status            │
│  - expires_at        │
└──────────────────────┘

┌───────────────────────┐
│ iam.password_reset_   │
│   token               │
│  - id (PK)            │
│  - user_id (FK)       │──→ iam.user
│  - token (UQ)         │
│  - expires_at         │
│  - used_at            │
└───────────────────────┘

┌──────────────────┐
│ iam.session      │
│  - id (PK)       │
│  - user_id (FK)  │──→ iam.user
│  - token_jti (UQ)│
│  - issued_at     │
│  - expires_at    │
│  - invalidated_at│
└──────────────────┘
```

---

## Constants & Enums

### User Status
```go
// internal/iam/constants.go
const (
    UserStatusActive    = "active"
    UserStatusSuspended = "suspended"
    UserStatusDeleted   = "deleted"
)
```

```typescript
// packages/apis/src/types.ts
type UserStatus = 'active' | 'suspended' | 'deleted';
```

### SSO Provider (Proto Enum - preferred)
```protobuf
// backend/rpc/v1/iam.proto
enum SSOProvider {
  SSO_PROVIDER_UNSPECIFIED = 0;
  SSO_PROVIDER_GOOGLE = 1;
  SSO_PROVIDER_APPLE = 2;
}
```

### Organization Role
```go
// internal/iam/constants.go
const (
    RoleAdmin    = "admin"
    RoleOwner    = "owner"
    RoleOperator = "operator"
    RoleEmployee = "employee"
)
```

```typescript
// packages/apis/src/types.ts
type OrganizationRole = 'admin' | 'owner' | 'operator' | 'employee';
```

### Invitation Status
```go
// internal/iam/constants.go
const (
    InvitationStatusPending   = "pending"
    InvitationStatusAccepted  = "accepted"
    InvitationStatusCancelled = "cancelled"
    InvitationStatusExpired   = "expired"
)
```

---

## Migration Scripts

### Migration 1: Create IAM Schema

**File**: `backend/k8s/base/database/migrations/YYYYMMDDHHMMSS_create_iam_schema.up.sql`

```sql
-- Create iam schema
CREATE SCHEMA IF NOT EXISTS iam;
```

**File**: `backend/k8s/base/database/migrations/YYYYMMDDHHMMSS_create_iam_schema.down.sql`

```sql
-- Drop iam schema (WARNING: destroys all data)
DROP SCHEMA IF NOT EXISTS iam CASCADE;
```

### Migration 2: Create Core User Tables

**File**: `backend/k8s/base/database/migrations/YYYYMMDDHHMMSS_create_iam_user_tables.up.sql`

```sql
-- iam.user table
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
'Global user accounts. NOT organization-scoped - users can belong to multiple organizations with different roles.';

-- iam.sso_identity table
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

-- iam.password_credential table
CREATE TABLE IF NOT EXISTS iam.password_credential (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    user_id UUID NOT NULL UNIQUE REFERENCES iam.user(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_user ON iam.password_credential(user_id);
```

**File**: `backend/k8s/base/database/migrations/YYYYMMDDHHMMSS_create_iam_user_tables.down.sql`

```sql
DROP TABLE IF EXISTS iam.password_credential CASCADE;
DROP TABLE IF EXISTS iam.sso_identity CASCADE;
DROP TABLE IF EXISTS iam.user CASCADE;
```

### Migration 3: Create Membership & Invitation Tables

**File**: `backend/k8s/base/database/migrations/YYYYMMDDHHMMSS_create_iam_membership_tables.up.sql`

```sql
-- iam.organization_membership table
CREATE TABLE IF NOT EXISTS iam.organization_membership (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    user_id UUID NOT NULL REFERENCES iam.user(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    role TEXT NOT NULL 
        CHECK (role IN ('admin', 'owner', 'operator', 'employee')),
    joined_at TIMESTAMPTZ DEFAULT now(),
    invited_by UUID REFERENCES iam.user(id),
    UNIQUE(user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_membership_user ON iam.organization_membership(user_id);
CREATE INDEX IF NOT EXISTS idx_membership_org ON iam.organization_membership(organization_id);
CREATE INDEX IF NOT EXISTS idx_membership_org_role ON iam.organization_membership(organization_id, role);

-- iam.invitation table
CREATE TABLE IF NOT EXISTS iam.invitation (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL 
        CHECK (role IN ('admin', 'owner', 'operator', 'employee')),
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
```

**File**: `backend/k8s/base/database/migrations/YYYYMMDDHHMMSS_create_iam_membership_tables.down.sql`

```sql
DROP TABLE IF EXISTS iam.invitation CASCADE;
DROP TABLE IF EXISTS iam.organization_membership CASCADE;
```

### Migration 4: Create Token & Session Tables

**File**: `backend/k8s/base/database/migrations/YYYYMMDDHHMMSS_create_iam_token_tables.up.sql`

```sql
-- iam.password_reset_token table
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

-- iam.session table
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
```

**File**: `backend/k8s/base/database/migrations/YYYYMMDDHHMMSS_create_iam_token_tables.down.sql`

```sql
DROP TABLE IF EXISTS iam.session CASCADE;
DROP TABLE IF EXISTS iam.password_reset_token CASCADE;
```

---

## Data Validation Rules

### Email Validation
- Format: RFC 5322 compliant
- Case-insensitive uniqueness
- Max length: 254 characters

### Password Requirements
- Minimum 8 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one number
- No maximum length (bcrypt handles up to 72 bytes)

### Token Generation
- Password reset tokens: 32 bytes random, base64-encoded
- Invitation tokens: 32 bytes random, base64-encoded
- Session JTI: UUID v7

### Expiration Policies
- Password reset tokens: 1 hour
- Invitations: 7 days
- Sessions: 30 days (inactivity)

---

## Security Considerations

### Password Storage
- ✅ bcrypt hashing (cost factor 12)
- ✅ No plaintext passwords stored
- ✅ Salt included in bcrypt hash
- ✅ Rehash on password change

### Token Security
- ✅ Cryptographically secure random generation
- ✅ Single-use reset tokens
- ✅ Time-limited expiration
- ✅ Database-backed (can be invalidated)

### User Enumeration Prevention
- ⚠️ Same response for valid/invalid emails during password reset
- ⚠️ Generic error messages ("Invalid email or password")
- ⚠️ Rate limiting on login attempts (5 attempts per 15 minutes)

### Multi-Tenant Isolation
- ✅ Global user table (no organization_id)
- ✅ Organization membership enforces access
- ✅ Middleware queries roles per org
- ✅ All org-scoped queries include organization_id filter

---

## Summary

**Database Changes**: ✅ New `iam` schema with 7 tables  
**Schema Changes**: ✅ New domain for authentication/authorization  
**Existing Data Modified**: ❌ None - clean implementation (no Zitadel migration)  
**Multi-Tenant**: ✅ Global users + org-specific roles  
**Citus-Ready**: ✅ Org-scoped tables include organization_id  

**Tables Created**:
1. `iam.user` - Global user accounts
2. `iam.sso_identity` - SSO provider links
3. `iam.password_credential` - Password storage
4. `iam.organization_membership` - User-org-role relationships
5. `iam.invitation` - Pending invitations
6. `iam.password_reset_token` - Password reset flow
7. `iam.session` - Session tracking

**Ready for Phase 1 Contracts**: RPC definitions, sqlc queries, service implementation
