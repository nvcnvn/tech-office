# Data Model: Organization SignUp

**Feature**: Organization SignUp on Web  
**Date**: October 25, 2025  
**Status**: No Changes Required - Using Existing Schema

## Executive Summary

The organization signup feature uses **existing database schema** with no modifications required. All necessary tables, relationships, constraints, and indexes are already defined in `backend/database/scripts/schema.sql`. This document provides a reference for the data model used during signup.

---

## Schema Overview

### Schemas Involved
1. **`iam`** - Identity and Access Management
2. **`public`** - Shared organization data

---

## Entity Definitions

### 1. iam.identity

**Purpose**: Core identity table for all users (humans and service accounts)

**Existing Definition**:
```sql
CREATE TABLE IF NOT EXISTS iam.identity (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    email VARCHAR(255) UNIQUE NOT NULL,
    email_verified BOOLEAN NOT NULL DEFAULT false,
    identity_type TEXT CHECK (identity_type IN ('human', 'service')) NOT NULL DEFAULT 'human',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Attributes**:
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, DEFAULT uuidv7() | Unique identity identifier (UUID v7 for sortable IDs) |
| `email` | VARCHAR(255) | UNIQUE, NOT NULL | User email address (globally unique across all identities) |
| `email_verified` | BOOLEAN | NOT NULL, DEFAULT false | Email verification status (set to false on signup) |
| `identity_type` | TEXT | CHECK IN ('human', 'service'), NOT NULL, DEFAULT 'human' | Type of identity: human user or service account |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Last update timestamp (auto-updated) |

**Indexes**:
- Primary key index on `id` (automatic)
- Unique index on `email` (automatic from UNIQUE constraint)

**Signup Behavior**:
- Created during `RegisterOrganizationWithAdminPassword`
- `email_verified` = `false` initially
- `identity_type` = `'human'`
- Email must be globally unique (enforced by database)

---

### 2. public.organization

**Purpose**: Master list of customer organizations (tenants)

**Existing Definition**:
```sql
CREATE TABLE IF NOT EXISTS public.organization (
    id UUID PRIMARY KEY,
    company_name TEXT NOT NULL,
    subdomain VARCHAR(63) UNIQUE NOT NULL,
    application_id UUID UNIQUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Attributes**:
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY | Organization unique identifier (generated in backend) |
| `company_name` | TEXT | NOT NULL | Organization's display name (e.g., "Acme Corporation") |
| `subdomain` | VARCHAR(63) | UNIQUE, NOT NULL | Subdomain for tenant-specific URLs (e.g., "acme" → acme.tech-office.com) |
| `application_id` | UUID | UNIQUE | Optional link to Zitadel application record (set during signup) |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Last update timestamp |

**Indexes**:
- Primary key index on `id`
- Unique index on `subdomain` (critical for signup subdomain availability check)
- Unique index on `application_id`

**Validation Rules**:
- **Subdomain Format**: DNS-compliant (alphanumeric, hyphens, no spaces)
- **Subdomain Length**: Maximum 32 characters (validated in frontend)
- **Subdomain Uniqueness**: Enforced by database UNIQUE constraint

**Signup Behavior**:
- Created first in the transaction
- `id` generated using `uuid.MustUUID()` (UUID v7)
- `application_id` generated during signup (Zitadel application ID)
- `subdomain` must be available (checked via `CheckOrganizationSubdomainAvailable` query)

---

### 3. public.organization_owner

**Purpose**: Many-to-many relationship mapping identities to organizations they own

**Existing Definition**:
```sql
CREATE TABLE IF NOT EXISTS public.organization_owner (
    organization_id UUID REFERENCES public.organization(id) ON DELETE CASCADE,
    identity_id UUID REFERENCES iam.identity(id) ON DELETE CASCADE,
    PRIMARY KEY (organization_id, identity_id)
);
```

**Attributes**:
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `organization_id` | UUID | FK → public.organization(id), ON DELETE CASCADE | Organization reference |
| `identity_id` | UUID | FK → iam.identity(id), ON DELETE CASCADE | Identity reference |

**Composite Primary Key**: (`organization_id`, `identity_id`)

**Relationships**:
- One identity can own multiple organizations
- One organization can have multiple owners

**Signup Behavior**:
- Created immediately after identity creation
- Links the admin user (identity) to the new organization
- Cascade delete: if organization deleted, ownership record removed

---

### 4. iam.identity_role

**Purpose**: Maps identities to organizations with role assignments (RBAC)

**Existing Definition**:
```sql
CREATE TABLE IF NOT EXISTS iam.identity_role (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    organization_id UUID REFERENCES public.organization(id) ON DELETE CASCADE,
    identity_id UUID REFERENCES iam.identity(id) ON DELETE CASCADE,
    role TEXT CHECK (role IN ('owner', 'employee')) NOT NULL DEFAULT 'employee',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (identity_id, organization_id, role)
);
```

**Attributes**:
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, DEFAULT uuidv7() | Unique role assignment identifier |
| `organization_id` | UUID | FK → public.organization(id), ON DELETE CASCADE | Organization context |
| `identity_id` | UUID | FK → iam.identity(id), ON DELETE CASCADE | Identity being assigned role |
| `role` | TEXT | CHECK IN ('owner', 'employee'), NOT NULL, DEFAULT 'employee' | Role type for RBAC |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Last update timestamp |

**Unique Constraint**: (`identity_id`, `organization_id`, `role`) - One identity can't have duplicate roles in same org

**Roles**:
- **`owner`**: Full administrative access (assigned during signup)
- **`employee`**: Standard user access

**Signup Behavior**:
- Created for admin user with `role` = `'owner'`
- Used for authorization checks in the application
- Cascade delete: if organization or identity deleted, role assignment removed

---

## Relationships Diagram

```
┌────────────────────┐
│  iam.identity      │
│  ─────────────────  │
│  id (PK)           │
│  email (UNIQUE)    │◄────────┐
│  email_verified    │         │
│  identity_type     │         │
│  updated_at        │         │
└────────────────────┘         │
         │                     │
         │                     │
         │                     │
         │                     │
         ▼                     │
┌────────────────────┐         │
│  iam.identity_role │         │
│  ─────────────────  │         │
│  id (PK)           │         │
│  organization_id (FK) ◄──────┼────────┐
│  identity_id (FK)  │◄────────┘        │
│  role              │                  │
│  updated_at        │                  │
└────────────────────┘                  │
                                        │
┌────────────────────┐                  │
│ public.organization│                  │
│  ─────────────────  │                  │
│  id (PK)           │◄─────────────────┘
│  company_name      │
│  subdomain (UNIQUE)│
│  application_id    │
│  updated_at        │
└────────────────────┘
         ▲
         │
         │
┌────────────────────────┐
│ public.organization_   │
│       _owner           │
│  ────────────────────   │
│  organization_id (FK)  │
│  identity_id (FK)      │
│  PRIMARY KEY: composite│
└────────────────────────┘
```

**Legend**:
- `◄──` Foreign Key relationship
- `(PK)` Primary Key
- `(FK)` Foreign Key
- `(UNIQUE)` Unique constraint

---

## Queries Used During Signup

### 1. CheckOrganizationSubdomainAvailable
**File**: `backend/database/scripts/public.query.sql`  
**Purpose**: Real-time subdomain availability check

```sql
-- name: CheckOrganizationSubdomainAvailable :one
SELECT EXISTS(SELECT 1 FROM public.organization WHERE subdomain = $1) AS "available";
```

**Returns**: Boolean (`true` if subdomain exists, `false` if available)

**Frontend Usage**: Debounced call during form input (500ms delay)

---

### 2. CreateOrganization
**File**: `backend/database/scripts/public.query.sql`  
**Purpose**: Insert new organization record

```sql
-- name: CreateOrganization :one
INSERT INTO public.organization (id, company_name, subdomain) 
VALUES ($1, $2, $3) 
RETURNING id;
```

**Backend Usage**: Called first in transaction within `RegisterOrganizationWithAdminPassword`

---

### 3. CreateIdentity
**File**: `backend/database/scripts/public.query.sql` (assumed) or `iam.query.sql`  
**Purpose**: Insert new identity record

```sql
-- name: CreateIdentity :one
INSERT INTO iam.identity (id, email, identity_type) 
VALUES ($1, $2, $3) 
RETURNING id;
```

**Backend Usage**: Called second in transaction

---

### 4. CreateOrganizationOwner
**File**: `backend/database/scripts/public.query.sql`  
**Purpose**: Link identity as owner of organization

```sql
-- name: CreateOrganizationOwner :exec
INSERT INTO public.organization_owner (organization_id, identity_id) 
VALUES ($1, $2);
```

**Backend Usage**: Called third in transaction

---

## Transaction Flow

The signup process is wrapped in a **database transaction** ensuring atomicity:

```
BEGIN TRANSACTION
  1. INSERT INTO public.organization (...)
  2. INSERT INTO iam.identity (...)
  3. INSERT INTO public.organization_owner (...)
  4. INSERT INTO iam.identity_role (...) [via dbcrud.Create]
  5. Zitadel API: CreateOrganization(...)
  6. Zitadel API: CreateUser(...)
  7. Zitadel API: CreateProject(...)
  8. Zitadel API: CreateApplication(...)
  9. Zitadel API: AddUserToOrg(...)
COMMIT (or ROLLBACK on any error)
```

**Atomicity Guarantee**: If any step fails (including Zitadel API calls), entire transaction rolls back. No partial organizations are left in the database.

**Implementation**: `backend/database/txn/txn.go` provides `WithTxn()` helper

---

## Multi-Tenant Isolation

### Organization ID Enforcement
While signup creates the initial organization, **all business data** in other schemas (finance, crm, support, etc.) will require `organization_id` foreign keys:

```sql
-- Example pattern (not in signup, but for reference)
CREATE TABLE some_schema.some_table (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    -- other columns
    ...
);
```

**Signup Impact**: The `organization.id` created during signup becomes the tenant isolation key for all future data.

---

## Data Constraints Summary

| Constraint | Table | Enforcement | Error Handling |
|------------|-------|-------------|----------------|
| Email uniqueness | `iam.identity` | Database UNIQUE | Backend returns error, frontend shows "Email already registered" |
| Subdomain uniqueness | `public.organization` | Database UNIQUE | Backend returns error, frontend shows "Subdomain taken" |
| Subdomain format | `public.organization` | Frontend + Backend validation | Zod schema + backend input validation |
| Password strength | N/A (not stored) | Frontend validation only | Zod schema enforces min 16 chars + numbers/letters |
| Email format | `iam.identity` | Frontend + Backend validation | Zod schema + backend input validation |

---

## No Schema Changes Required

✅ **All tables exist**  
✅ **All queries exist**  
✅ **All indexes exist**  
✅ **All constraints exist**  
✅ **Transaction logic exists**

**Action Required**: None - proceed with frontend implementation using existing backend services.

---

## References

- **Schema Definition**: `backend/database/scripts/schema.sql`
- **Query Definitions**: `backend/database/scripts/public.query.sql`, `backend/database/scripts/iam.query.sql`
- **Service Implementation**: `backend/internal/organization/organization.go`
- **Transaction Helper**: `backend/database/txn/txn.go`
- **Generated Models**: `backend/database/models.go` (from sqlc)

---

**Status**: ✅ Data model confirmed, no changes required
