# Data Model: Employee Import Feature

**Date**: October 25, 2025  
**Feature**: Employee Import  
**Branch**: `003-feature-import-employees`  
**Implementation Strategy**: Individual goroutine-based processing (NOT batch transactions)

## Overview

The Employee Import feature **reuses existing database tables** without modifications. Each employee is processed independently in a goroutine with individual Zitadel API calls and database transactions. This approach provides better error granularity and supports partial success.

---

## Database Schema

### No Schema Changes Required ✅

The existing `iam` schema provides all necessary tables:

```sql
-- Existing table: iam.identity
-- Located in: backend/database/scripts/schema.sql
CREATE TABLE IF NOT EXISTS iam.identity (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    organization_id UUID REFERENCES public.organization(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    identity_type TEXT CHECK (identity_type IN ('human', 'service')) NOT NULL DEFAULT 'human',
    email_verified BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_iam_identity_org_email 
    ON iam.identity (organization_id, email);

-- Existing table: iam.identity_role
CREATE TABLE IF NOT EXISTS iam.identity_role (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    organization_id UUID REFERENCES public.organization(id) ON DELETE CASCADE,
    identity_id UUID REFERENCES iam.identity(id) ON DELETE CASCADE,
    role TEXT CHECK (role IN ('owner', 'employee')) NOT NULL DEFAULT 'employee',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (identity_id, organization_id, role)
);
```

**Key Design Notes**:
- **No batch inserts**: Each employee gets individual transaction
- **Unique constraint**: `idx_iam_identity_org_email` prevents duplicate emails per org
- **Cascade deletion**: If organization deleted, all identities and roles cascade
- **Default role**: 'employee' assigned to all imported users

---

## Entity Relationships

```
public.organization (existing)
      |
      | organization_id (FK)
      |
      v
iam.identity (existing - used for import)
      |
      | identity_id (FK)
      |
      v
iam.identity_role (existing - assigns 'employee' role)
```

### Multi-Tenant Isolation

**Critical constraint**: All queries MUST include `organization_id` filter:

```sql
-- CORRECT: Tenant-isolated query
SELECT id, email FROM iam.identity 
WHERE organization_id = $1 AND email = $2;

-- WRONG: Missing tenant filter (FORBIDDEN)
SELECT id, email FROM iam.identity 
WHERE email = $1;
```

---

## sqlc Query Definitions

**File**: `backend/database/scripts/iam.query.sql`

### 1. Check Duplicate Emails (Preview Phase)

```sql
-- name: CheckDuplicateEmailsBatch :many
-- Check if emails already exist for an organization (used in preview)
-- Returns existing identities to show user which emails are duplicates
SELECT 
    email,
    id as identity_id,
    email_verified,
    given_name,
    family_name
FROM iam.identity
WHERE organization_id = $1
  AND email = ANY($2::text[])
ORDER BY email;
```

**Usage in Preview**:
```go
// Preview phase - check all emails at once
emails := make([]string, len(employees))
for i, emp := range employees {
    emails[i] = emp.Email
}

duplicates, err := queries.CheckDuplicateEmailsBatch(ctx, db, CheckDuplicateEmailsBatchParams{
    OrganizationID: orgID,
    Emails:         emails,
})

// Build preview response with duplicate flags
for _, emp := range employees {
    isDuplicate := false
    for _, dup := range duplicates {
        if dup.Email == emp.Email {
            isDuplicate = true
            break
        }
    }
    // Add to preview...
}
```

### 2. Create Identity (Individual Transaction)

**Note**: Use single-row inserts, NOT batch inserts. Each employee processed in separate transaction.

```sql
-- name: CreateIdentity :one
-- Create a single identity record
-- Used within individual employee transaction
INSERT INTO iam.identity (
    id,
    organization_id,
    email,
    identity_type,
    email_verified
) VALUES (
    uuidv7(),
    $1,  -- organization_id
    $2,  -- email
    'human',
    false
) RETURNING id, email, organization_id, created_at;
```

**Usage in Individual Transaction**:
```go
// Each employee processed in separate goroutine
tx, err := db.Begin(ctx)
defer tx.Rollback(ctx)

// Create identity (single row)
identity, err := queries.CreateIdentity(ctx, tx, CreateIdentityParams{
    OrganizationID: orgID,
    Email:          employee.Email,
})
if err != nil {
    return err  // Rollback this employee's transaction
}

// Create role assignment...
```

### 3. Create Identity Role (Individual Transaction)

```sql
-- name: CreateIdentityRole :one
-- Create a single identity role assignment
-- Used within individual employee transaction
INSERT INTO iam.identity_role (
    id,
    organization_id,
    identity_id,
    role
) VALUES (
    uuidv7(),
    $1,  -- organization_id
    $2,  -- identity_id
    'employee'
) RETURNING id, identity_id, role, organization_id, created_at;
```

**Usage in Individual Transaction**:
```go
// Within same transaction as CreateIdentity
role, err := queries.CreateIdentityRole(ctx, tx, CreateIdentityRoleParams{
    OrganizationID: orgID,
    IdentityID:     identity.ID,
})
if err != nil {
    return err  // Rollback this employee's transaction
}

// Commit individual transaction
err = tx.Commit(ctx)
```

### 4. Get Role By Name (Helper Query)

```sql
-- name: GetRoleByName :one
-- Get role ID by role name (if using role_id FK)
-- May not be needed if role is TEXT enum
SELECT id, name
FROM iam.role
WHERE name = $1;
```

**Note**: Current schema uses TEXT enum for role, so this query may not be needed.

---

## Transaction Flow (Per Employee)

**Critical**: Each employee processed in individual transaction with compensation:

### Execution Flow (ExecuteEmployeeImport)

```go
// Goroutine per employee (max 10 concurrent)
func processEmployee(ctx context.Context, emp *EmployeeData, orgID dbuuid.UUID) *EmployeeImportResult {
    result := &EmployeeImportResult{Employee: emp}
    
    // Step 1: Create Zitadel user FIRST
    zUser, err := zitadelClient.CreateUser(ctx, &zitadel.CreateUserRequest{
        Email:      emp.Email,
        GivenName:  emp.GivenName,
        FamilyName: emp.FamilyName,
        OrgID:      orgID.String(),
    })
    if err != nil {
        result.Error = fmt.Errorf("zitadel create failed: %w", err)
        return result
    }
    result.ZitadelID = zUser.UserID
    
    // Step 2: Database transaction (single employee)
    tx, err := db.Begin(ctx)
    if err != nil {
        // Compensate: delete Zitadel user
        zitadelClient.DeleteUser(ctx, zUser.UserID)
        result.Error = fmt.Errorf("db transaction start failed: %w", err)
        return result
    }
    defer tx.Rollback(ctx)
    
    // Step 3: Insert identity
    identity, err := queries.CreateIdentity(ctx, tx, CreateIdentityParams{
        OrganizationID: orgID,
        Email:          emp.Email,
    })
    if err != nil {
        zitadelClient.DeleteUser(ctx, zUser.UserID)  // Compensate
        result.Error = fmt.Errorf("db insert failed: %w", err)
        return result
    }
    result.IdentityID = identity.ID
    
    // Step 4: Insert role
    _, err = queries.CreateIdentityRole(ctx, tx, CreateIdentityRoleParams{
        OrganizationID: orgID,
        IdentityID:     identity.ID,
    })
    if err != nil {
        zitadelClient.DeleteUser(ctx, zUser.UserID)  // Compensate
        result.Error = fmt.Errorf("role assignment failed: %w", err)
        return result
    }
    
    // Step 5: Commit
    if err := tx.Commit(ctx); err != nil {
        zitadelClient.DeleteUser(ctx, zUser.UserID)  // Compensate
        result.Error = fmt.Errorf("commit failed: %w", err)
        return result
    }
    
    result.Success = true
    return result
}
```

### Rollback Scenarios

| Failure Point | Database State | Zitadel State | Compensation |
|--------------|----------------|---------------|--------------|
| Zitadel CreateUser fails | Clean (no writes) | No user created | None needed |
| DB tx.Begin() fails | Clean | User created | Delete Zitadel user |
| CreateIdentity fails | Rolled back | User created | Delete Zitadel user |
| CreateIdentityRole fails | Rolled back | User created | Delete Zitadel user |
| tx.Commit() fails | Rolled back | User created | Delete Zitadel user |

**Key Principle**: Zitadel user always deleted if DB transaction fails (compensation pattern).

---

## Performance Analysis

### Individual Transaction Approach

**Per Employee**:
- Zitadel CreateUser API: ~100-200ms
- DB transaction (insert identity + role): ~10-20ms
- Total per employee: ~110-220ms

**100 Employees**:
- Sequential: ~11-22 seconds (unacceptable)
- With 10 goroutines: ~1.1-2.2 seconds (acceptable)

### Why NOT Batch?

❌ **Batch disadvantages**:
- All-or-nothing (one failure loses everything)
- Poor error messaging (which employee failed?)
- Complex retry (must re-submit all 100)
- No partial progress tracking

✅ **Individual transaction advantages**:
- Partial success supported
- Clear per-employee error messages
- Easy retry (only failed employees)
- Better user experience
- Goroutines provide parallelism

---

## Query Performance Estimates

### CheckDuplicateEmailsBatch (Preview)
INSERT INTO iam.identity_role (
    id,
    organization_id,
    identity_id,
    role
) VALUES (
    $1, $2, $3, $4
);
```

**Usage**:
```go
rows := []db.CreateIdentityRoleBatchParams{
    {
        ID: uuid.New(),
        OrganizationID: orgID,
        IdentityID: identityID1,
        Role: "employee",
    },
    // ... more rows
}
err := queries.CreateIdentityRoleBatch(ctx, rows)
```

### 4. Get Identity by ID (for verification)

```sql
-- name: GetIdentityByID :one
-- Retrieve identity for verification after import
SELECT 
    id,
    organization_id,
    email,
    identity_type,
    email_verified,
    updated_at
FROM iam.identity
WHERE id = $1 AND organization_id = $2;
```

---

## Data Flow

### Import Transaction Flow

```
1. Begin Transaction
   ↓
2. Validate Input Data
   - Email format validation
   - Required fields check
   - Batch size limit (100 max)
   ↓
3. Check Duplicates (Query: CheckDuplicateEmailsBatch)
   - Filter out duplicates
   - Return non-duplicate subset
   ↓
4. Generate UUIDs for new identities
   ↓
5. Batch Insert Identities (Query: CreateIdentityBatch)
   - Insert iam.identity records
   - Set email_verified = false
   ↓
6. Batch Insert Identity Roles (Query: CreateIdentityRoleBatch)
   - Insert iam.identity_role records
   - Assign role = 'employee'
   ↓
7. Create Zitadel Users (External API call)
   - For each identity: zitadelClient.CreateUser(...)
   - Zitadel sends verification emails
   - On failure: Rollback transaction
   ↓
8. Commit Transaction
   ↓
9. Return Success Response
```

### Rollback Scenarios

| Failure Point | Action | Result |
|---------------|--------|--------|
| Validation error | Don't start transaction | No data created |
| Duplicate identity insert | Unique constraint violation | Transaction rollback |
| Identity role insert fails | SQL error | Transaction rollback |
| Zitadel CreateUser fails | External API error | Transaction rollback |
| Network timeout | Context deadline exceeded | Transaction rollback |

---

## Index Usage

### Existing Indexes (Performance-Critical)

1. **Primary Key Index**: `iam.identity.id`
   - Used for: Identity lookup after creation
   - Type: B-tree (UUID v7)

2. **Unique Composite Index**: `idx_iam_identity_org_email`
   - Columns: `(organization_id, email)`
   - Used for: Duplicate detection query
   - Prevents: Duplicate emails within organization
   - Query performance: O(log n) lookup

3. **Foreign Key Index**: `iam.identity.organization_id`
   - Used for: Multi-tenant filtering
   - Ensures: Efficient organization-scoped queries

4. **Primary Key Index**: `iam.identity_role.id`
   - Used for: Role lookup
   - Type: B-tree (UUID v7)

### Query Performance Estimates

| Query | Rows Scanned | Index Used | Est. Time |
|-------|--------------|------------|-----------|
| CheckDuplicateEmailsBatch (100 emails) | ~100-200 | idx_iam_identity_org_email | <50ms |
| CreateIdentityBatch (100 rows) | N/A | Primary key | <100ms |
| CreateIdentityRoleBatch (100 rows) | N/A | Primary key | <100ms |

**Total DB operation time for 100-employee import**: ~200-300ms

---

## Data Constraints

### Enforced by Database

1. **Email uniqueness per organization**:
   ```sql
   UNIQUE INDEX idx_iam_identity_org_email (organization_id, email)
   ```

2. **Identity type validation**:
   ```sql
   CHECK (identity_type IN ('human', 'service'))
   ```

3. **Role validation**:
   ```sql
   CHECK (role IN ('owner', 'employee'))
   ```

4. **Required fields**:
   - `organization_id` NOT NULL (enforced by FK)
   - `email` NOT NULL
   - `identity_type` NOT NULL (default: 'human')
   - `role` NOT NULL (default: 'employee')

5. **Cascading deletes**:
   - Delete organization → deletes all identities
   - Delete identity → deletes all identity_roles

### Enforced by Application

1. **Email format validation**:
   - Regex: `^[^\s@]+@[^\s@]+\.[^\s@]+$`
   - Max length: 255 characters

2. **Batch size limit**:
   - Maximum 100 employees per import

3. **Required fields validation**:
   - `email`, `given_name`, `family_name` must be non-empty

4. **Permission validation**:
   - User must have 'owner' role in organization

---

## Concurrency & Race Conditions

### Duplicate Email Race Condition

**Scenario**: Two admins import same email simultaneously

```
Time  Admin A                  Admin B
----  ----------------------   ----------------------
T0    Check duplicates         Check duplicates
      (email not found)        (email not found)
T1    Begin transaction        Begin transaction
T2    Insert identity          Insert identity ❌
      (SUCCESS)                (UNIQUE VIOLATION)
T3    Commit                   Rollback
```

**Resolution**: Database unique constraint prevents duplicates. Later transaction fails with clear error message.

### Handling Strategy

```go
err := tx.Commit()
if err != nil {
    if isUniqueViolation(err) {
        return status.Errorf(codes.AlreadyExists, 
            "One or more emails were imported by another user. Please retry.")
    }
    return status.Errorf(codes.Internal, "Import failed: %v", err)
}
```

---

## Migration Strategy

### No Migration Needed ✅

- All required tables exist
- No schema modifications required
- No data migration needed
- Atlas migration: **SKIPPED**

### Future Schema Extensions (Deferred)

If import audit trail needed in future:

```sql
-- Future table (NOT implemented in this feature)
CREATE TABLE IF NOT EXISTS iam.identity_import_audit (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    organization_id UUID REFERENCES public.organization(id) ON DELETE CASCADE,
    imported_by UUID REFERENCES iam.identity(id),
    import_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
    total_count INT NOT NULL,
    imported_count INT NOT NULL,
    skipped_count INT NOT NULL,
    import_data JSONB,  -- Store original import data
    UNIQUE (organization_id, import_timestamp)
);
```

---

## Code Generation

### sqlc Configuration

**File**: `backend/sqlc.yaml`

```yaml
version: "2"
sql:
  - schema: "database/scripts/schema.sql"
    queries: "database/scripts/iam.query.sql"
    engine: "postgresql"
    gen:
      go:
        package: "db"
        out: "database"
        sql_package: "pgx/v5"
        emit_json_tags: true
        emit_interface: true
        emit_empty_slices: true
```

### Generated Go Types

**File**: `backend/database/models.go` (existing, no changes)

```go
type Identity struct {
    ID             dbuuid.UUID `json:"id"`
    OrganizationID dbuuid.UUID `json:"organization_id"`
    Email          string    `json:"email"`
    IdentityType   string    `json:"identity_type"`
    EmailVerified  bool      `json:"email_verified"`
    UpdatedAt      time.Time `json:"updated_at"`
}

type IdentityRole struct {
    ID             dbuuid.UUID `json:"id"`
    OrganizationID dbuuid.UUID `json:"organization_id"`
    IdentityID     dbuuid.UUID `json:"identity_id"`
    Role           string    `json:"role"`
    UpdatedAt      time.Time `json:"updated_at"`
}
```

### Regeneration Command

```bash
cd backend
sqlc generate
```

**When to regenerate**: After adding new queries to `iam.query.sql`

---

## External System Integration

### Zitadel User Entity

**Not stored in our database**. Managed by Zitadel with these attributes:

```
Zitadel User {
    id: UUID (matches iam.identity.id)
    organization_id: UUID (matches public.organization.id)
    username: string (matches iam.identity.email)
    email: string
    given_name: string
    family_name: string
    email_verified: boolean (initially false)
    password: null (not set during import)
}
```

**Synchronization**:
- Our system is source of truth for identity existence
- Zitadel is source of truth for authentication and email verification
- Identity IDs are shared between systems

---

## Summary

✅ **No database schema changes required**  
✅ **Reuses existing IAM tables with proper indexes**  
✅ **Multi-tenant isolation enforced via organization_id**  
✅ **Atomic transactions ensure data consistency**  
✅ **Batch operations optimize performance**  
✅ **Ready for sqlc code generation**

**Status**: Ready for RPC contract design (Phase 1)
