# Data Model: File Storage System

**Feature**: 014-file-storage-system-an-integration  
**Date**: 2025-11-09

## Schema Overview

This feature introduces a new `files` schema for cross-domain file storage functionality. The schema contains three main tables for file metadata, quota management, and deletion auditing.

## Schema: `files`

### Rationale for New Schema

Files are a cross-cutting concern used by multiple business domains (chat, organization avatars, documentation, projects). Creating a dedicated `files` schema:
- Separates file storage concerns from domain-specific logic
- Enables reuse across all business domains
- Follows Tech Office schema-per-domain pattern
- Simplifies migration management

---

## Table: `files.file_metadata`

**Purpose**: Stores metadata for all uploaded files across the organization

### Schema Definition

```sql
CREATE SCHEMA IF NOT EXISTS files;

CREATE TABLE files.file_metadata (
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

-- Citus distribution
SELECT create_distributed_table('files.file_metadata', 'organization_id');

-- Indexes
CREATE INDEX IF NOT EXISTS idx_file_metadata_context 
    ON files.file_metadata(organization_id, upload_context, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_file_metadata_uploader 
    ON files.file_metadata(organization_id, uploaded_by_employee_id);

CREATE INDEX IF NOT EXISTS idx_file_metadata_active 
    ON files.file_metadata(organization_id, updated_at DESC)
    WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_file_metadata_storage_key
    ON files.file_metadata(organization_id, storage_key);

COMMENT ON TABLE files.file_metadata IS 
'Stores metadata for all uploaded files. Actual binary data stored in Cloudflare R2 using storage_key.';

COMMENT ON COLUMN files.file_metadata.storage_key IS 
'R2 object key format: org-{organization_id}/{upload_context}/{file_id}. Used to construct presigned URLs.';

COMMENT ON COLUMN files.file_metadata.upload_context IS 
'Upload source context: chat, avatar, docs, project. MUST align with backend constants in internal/files/constants.go and frontend TypeScript types in packages/apis/src/files.ts';

COMMENT ON COLUMN files.file_metadata.is_deleted IS 
'Soft delete flag. When true, file is deleted from R2 but metadata preserved for audit trail.';
```

### Field Descriptions

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | UUID | PK, Default uuidv7() | Unique file identifier, time-sortable |
| `organization_id` | UUID | FK → organization(id), NOT NULL | Tenant isolation |
| `original_filename` | TEXT | NOT NULL | User-provided filename (e.g., "report.pdf") |
| `storage_key` | TEXT | NOT NULL | R2 object key for retrieval |
| `size_bytes` | BIGINT | CHECK > 0 | File size in bytes |
| `mime_type` | TEXT | NOT NULL | MIME type (e.g., "application/pdf") |
| `upload_context` | TEXT | CHECK IN (...), NOT NULL | Where file was uploaded |
| `uploaded_by_employee_id` | UUID | FK → employee(organization_id, id), NOT NULL | Uploader identity |
| `is_deleted` | BOOLEAN | DEFAULT FALSE | Soft delete flag |
| `updated_at` | TIMESTAMPTZ | DEFAULT now() | Last modification timestamp |

### Indexes

1. **idx_file_metadata_context**: (organization_id, upload_context, updated_at DESC)
   - Use case: List files by context (e.g., all chat attachments)
   - Query pattern: `WHERE organization_id = ? AND upload_context = ? ORDER BY updated_at DESC`

2. **idx_file_metadata_uploader**: (organization_id, uploaded_by_employee_id)
   - Use case: List files uploaded by specific employee
   - Query pattern: `WHERE organization_id = ? AND uploaded_by_employee_id = ?`

3. **idx_file_metadata_active**: (organization_id, updated_at DESC) WHERE is_deleted = FALSE
   - Use case: List active files (file management interface)
   - Query pattern: `WHERE organization_id = ? AND is_deleted = FALSE ORDER BY updated_at DESC`
   - Partial index: Only indexes active files for efficiency

4. **idx_file_metadata_storage_key**: (organization_id, storage_key)
   - Use case: Lookup file metadata by R2 storage key
   - Query pattern: `WHERE organization_id = ? AND storage_key = ?`

---

## Table: `files.file_quota`

**Purpose**: Per-organization storage quota configuration and usage tracking

### Schema Definition

```sql
CREATE TABLE files.file_quota (
    organization_id UUID PRIMARY KEY REFERENCES public.organization(id) ON DELETE CASCADE,
    
    -- Quota limits
    quota_bytes BIGINT NULL, -- NULL = unlimited
    max_file_size_bytes BIGINT NOT NULL DEFAULT 104857600, -- 100MB default
    
    -- Current usage
    current_usage_bytes BIGINT NOT NULL DEFAULT 0 CHECK (current_usage_bytes >= 0),
    
    -- Metadata
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Citus distribution
SELECT create_distributed_table('files.file_quota', 'organization_id');

COMMENT ON TABLE files.file_quota IS 
'Per-organization storage quota configuration and real-time usage tracking. One row per organization.';

COMMENT ON COLUMN files.file_quota.quota_bytes IS 
'Maximum storage quota in bytes. NULL means unlimited quota. Enforced atomically during upload.';

COMMENT ON COLUMN files.file_quota.max_file_size_bytes IS 
'Maximum individual file size in bytes. Default 100MB (104857600 bytes). Configurable per organization.';

COMMENT ON COLUMN files.file_quota.current_usage_bytes IS 
'Real-time cumulative storage usage in bytes. Incremented on upload, decremented on deletion. Updated atomically with row-level locking.';
```

### Field Descriptions

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `organization_id` | UUID | PK, FK → organization(id) | Tenant identifier |
| `quota_bytes` | BIGINT | NULL = unlimited | Maximum storage quota |
| `max_file_size_bytes` | BIGINT | DEFAULT 104857600 | Max individual file size (100MB default) |
| `current_usage_bytes` | BIGINT | CHECK >= 0, DEFAULT 0 | Real-time usage |
| `updated_at` | TIMESTAMPTZ | DEFAULT now() | Last update timestamp |

### Quota Enforcement Pattern

```sql
-- name: GetQuotaForUpdate :one
-- Locks quota row for atomic check-and-increment
SELECT * FROM files.file_quota
WHERE organization_id = $1
FOR UPDATE;

-- name: IncrementQuotaUsage :exec
-- Atomically increment usage (called after upload confirmation)
UPDATE files.file_quota
SET current_usage_bytes = current_usage_bytes + $2,
    updated_at = now()
WHERE organization_id = $1;

-- name: DecrementQuotaUsage :exec
-- Atomically decrement usage (called after file deletion)
UPDATE files.file_quota
SET current_usage_bytes = GREATEST(current_usage_bytes - $2, 0),
    updated_at = now()
WHERE organization_id = $1;
```

**Transaction Workflow**:
1. Begin transaction
2. `SELECT FOR UPDATE` on quota row (locks row)
3. Validate: `current_usage_bytes + file_size <= quota_bytes`
4. If valid: Generate presigned URL, return to client
5. Client uploads directly to R2
6. Client confirms upload via RPC
7. `UPDATE` increment usage, insert file_metadata
8. Commit transaction

---

## Table: `files.file_deletion_log`

**Purpose**: Immutable audit log for file deletions

### Schema Definition

```sql
CREATE TABLE files.file_deletion_log (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    
    -- Deleted file reference
    file_id UUID NOT NULL,
    original_filename TEXT NOT NULL,
    
    -- Deletion metadata
    deleted_by_employee_id UUID NOT NULL,
    deletion_reason TEXT,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding (organization_id first)
    PRIMARY KEY (organization_id, id),
    
    CONSTRAINT fk_file_deletion_deleter 
        FOREIGN KEY (organization_id, deleted_by_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT
);

-- Citus distribution
SELECT create_distributed_table('files.file_deletion_log', 'organization_id');

-- Indexes
CREATE INDEX IF NOT EXISTS idx_file_deletion_log_file 
    ON files.file_deletion_log(organization_id, file_id);

CREATE INDEX IF NOT EXISTS idx_file_deletion_log_deleter 
    ON files.file_deletion_log(organization_id, deleted_by_employee_id, deleted_at DESC);

COMMENT ON TABLE files.file_deletion_log IS 
'Immutable audit log for file deletions. Preserves deletion context even after file_metadata is soft-deleted.';

COMMENT ON COLUMN files.file_deletion_log.deletion_reason IS 
'Optional human-readable reason for deletion (e.g., "Outdated marketing materials", "Contains sensitive data").';
```

### Field Descriptions

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | UUID | PK, Default uuidv7() | Log entry identifier |
| `organization_id` | UUID | FK → organization(id), NOT NULL | Tenant isolation |
| `file_id` | UUID | NOT NULL | Reference to deleted file |
| `original_filename` | TEXT | NOT NULL | Snapshot of filename at deletion |
| `deleted_by_employee_id` | UUID | FK → employee(organization_id, id), NOT NULL | Who deleted the file |
| `deletion_reason` | TEXT | NULL | Optional deletion reason |
| `deleted_at` | TIMESTAMPTZ | DEFAULT now() | Deletion timestamp |

### Indexes

1. **idx_file_deletion_log_file**: (organization_id, file_id)
   - Use case: Lookup deletion history for specific file
   - Query pattern: `WHERE organization_id = ? AND file_id = ?`

2. **idx_file_deletion_log_deleter**: (organization_id, deleted_by_employee_id, deleted_at DESC)
   - Use case: Audit trail of deletions by employee
   - Query pattern: `WHERE organization_id = ? AND deleted_by_employee_id = ? ORDER BY deleted_at DESC`

---

## Cross-Schema Relationships

### Files → Organization
- `files.file_metadata.organization_id` → `public.organization.id`
- `files.file_quota.organization_id` → `public.organization.id`
- `files.file_deletion_log.organization_id` → `public.organization.id`

### Files → Employee
- `files.file_metadata.uploaded_by_employee_id` → `organization.employee(organization_id, id)`
- `files.file_deletion_log.deleted_by_employee_id` → `organization.employee(organization_id, id)`

### Files ← Chat (JSONB Reference)
- `chat.message.mentions` JSONB can contain file attachment references:
  ```json
  {
    "type": "file",
    "file_id": "uuid",
    "filename": "report.pdf"
  }
  ```
- Loose coupling: Chat doesn't have foreign key, just stores file_id

### Files ← Employee Avatar (JSONB Reference)
- `organization.employee.additional_info` JSONB can store avatar file reference:
  ```json
  {
    "avatar_file_id": "uuid"
  }
  ```
- Loose coupling: Employee table doesn't have foreign key

---

## Multi-Tenant Isolation

### Citus Sharding
All tables are distributed on `organization_id`:
```sql
SELECT create_distributed_table('files.file_metadata', 'organization_id');
SELECT create_distributed_table('files.file_quota', 'organization_id');
SELECT create_distributed_table('files.file_deletion_log', 'organization_id');
```

### Primary Key Patterns
All tables include `organization_id` in composite primary keys:
- `files.file_metadata`: PRIMARY KEY (organization_id, id)
- `files.file_quota`: PRIMARY KEY (organization_id) -- single row per org
- `files.file_deletion_log`: PRIMARY KEY (organization_id, id)

### Composite Foreign Keys
All foreign keys reference composite keys including `organization_id`:
```sql
CONSTRAINT fk_file_uploader 
    FOREIGN KEY (organization_id, uploaded_by_employee_id)
    REFERENCES organization.employee(organization_id, id)
```

---

## Migration Strategy

### Migration Files
1. **Up Migration** (`<timestamp>_add_files_schema.up.sql`):
   - Create `files` schema
   - Create `files.file_metadata` table with indexes
   - Create `files.file_quota` table
   - Create `files.file_deletion_log` table with indexes
   - Create Citus distributed tables

2. **Down Migration** (`<timestamp>_add_files_schema.down.sql`):
   - Drop tables in reverse order
   - Drop `files` schema

### Schema.sql Update
Update `backend/database/scripts/schema.sql` with new schema definition.

### Codegen
After migration:
```bash
cd backend
sqlc generate  # Generate Go types and query methods
```

---

## sqlc Query Patterns

### File Metadata Queries

```sql
-- name: CreateFileMetadata :one
INSERT INTO files.file_metadata (
    id, organization_id, original_filename, storage_key,
    size_bytes, mime_type, upload_context, uploaded_by_employee_id
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: GetFileByID :one
SELECT * FROM files.file_metadata
WHERE organization_id = $1 AND id = $2 AND is_deleted = FALSE;

-- name: ListFilesByContext :many
SELECT * FROM files.file_metadata
WHERE organization_id = $1 
  AND upload_context = $2 
  AND is_deleted = FALSE
ORDER BY updated_at DESC
LIMIT $3 OFFSET $4;

-- name: ListFilesByUploader :many
SELECT * FROM files.file_metadata
WHERE organization_id = $1 
  AND uploaded_by_employee_id = $2 
  AND is_deleted = FALSE
ORDER BY updated_at DESC
LIMIT $3 OFFSET $4;

-- name: SoftDeleteFile :exec
UPDATE files.file_metadata
SET is_deleted = TRUE, updated_at = now()
WHERE organization_id = $1 AND id = $2;

-- name: BatchSoftDeleteFiles :exec
UPDATE files.file_metadata
SET is_deleted = TRUE, updated_at = now()
WHERE organization_id = $1 AND id = ANY($2::uuid[]);
```

### Quota Queries

```sql
-- name: GetOrCreateQuota :one
INSERT INTO files.file_quota (organization_id)
VALUES ($1)
ON CONFLICT (organization_id) DO UPDATE
SET updated_at = now()
RETURNING *;

-- name: GetQuotaForUpdate :one
SELECT * FROM files.file_quota
WHERE organization_id = $1
FOR UPDATE;

-- name: IncrementQuotaUsage :exec
UPDATE files.file_quota
SET current_usage_bytes = current_usage_bytes + $2,
    updated_at = now()
WHERE organization_id = $1;

-- name: DecrementQuotaUsage :exec
UPDATE files.file_quota
SET current_usage_bytes = GREATEST(current_usage_bytes - $2, 0),
    updated_at = now()
WHERE organization_id = $1;

-- name: UpdateQuotaLimits :exec
UPDATE files.file_quota
SET quota_bytes = $2,
    max_file_size_bytes = $3,
    updated_at = now()
WHERE organization_id = $1;
```

### Deletion Log Queries

```sql
-- name: CreateDeletionLog :one
INSERT INTO files.file_deletion_log (
    organization_id, file_id, original_filename,
    deleted_by_employee_id, deletion_reason
) VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetDeletionLogByFileID :one
SELECT * FROM files.file_deletion_log
WHERE organization_id = $1 AND file_id = $2
ORDER BY deleted_at DESC
LIMIT 1;

-- name: ListDeletionsByDeleter :many
SELECT * FROM files.file_deletion_log
WHERE organization_id = $1 AND deleted_by_employee_id = $2
ORDER BY deleted_at DESC
LIMIT $3 OFFSET $4;
```

---

## Constant Alignment (Cross-Stack)

### Upload Context Values

**Database CHECK Constraint**:
```sql
CHECK (upload_context IN ('chat', 'avatar', 'docs', 'project'))
```

**Backend Constants** (`internal/files/constants.go`):
```go
const (
    UploadContextChat    = "chat"
    UploadContextAvatar  = "avatar"
    UploadContextDocs    = "docs"
    UploadContextProject = "project"
)
```

**Frontend Types** (`packages/apis/src/files.ts`):
```typescript
export type UploadContext = 'chat' | 'avatar' | 'docs' | 'project';
```

**Coordination**: All three layers MUST be updated atomically in single PR when adding/removing upload contexts.

---

## Summary

This data model provides:
- ✅ Multi-tenant isolation via Citus sharding and composite keys
- ✅ Atomic quota enforcement with row-level locking
- ✅ Immutable audit trail for deletions
- ✅ Loose coupling with domain tables (JSONB references)
- ✅ Efficient indexing for common query patterns
- ✅ Constitution-compliant foreign key patterns
- ✅ Cross-stack constant synchronization

Next Phase: RPC contract design in `/contracts/`
