# Data Model: File Storage Security and Access Improvement

**Feature**: File Storage Security and Access Improvement  
**Date**: 2025-11-12  
**Schema**: `files` (primary), references `chat`, `organization`

## Overview

This data model extends the existing `files` schema with three new tables to support file type validation, context-based access control, PDF conversion, and full-text search. All tables follow Tech Office constitutional requirements: UUID v7 primary keys, organization_id for multi-tenant isolation, Citus-compatible composite keys, and CHECK constraints for enums.

**ARCHITECTURE NOTE - Domain-Owned Upload Pattern**:
This feature implements domain-owned file uploads to eliminate circular dependencies and improve security:
- **Domain services own upload flows**: ChatService.RequestChannelFileUpload (not FileService.RequestUploadUrl)
- **Server-side context verification**: Channel membership verified BEFORE upload URL generation
- **Access scope derivation**: Derived from channel.is_private (not client-controlled)
- **No circular dependency**: ChatService → FileLogic (logic layer), FileService → ChatLogic (logic layer) - different layers

See `ARCHITECTURE-REFACTOR.md` for full architectural rationale.

---

## Schema Extensions

### 1. files.file_access_rule

**Purpose**: Links files to their upload contexts and defines access scope

**Table Definition**:
```sql
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

SELECT create_distributed_table('files.file_access_rule', 'organization_id');

-- Indexes
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
```

**Constant Synchronization**:
```go
// backend/internal/files/constants.go
const (
    ContextTypeChatChannel   = "chat_channel"
    ContextTypeProject       = "project"
    ContextTypeDepartmentDocs = "department_docs"
    ContextTypeCalendarEvent = "calendar_event"
    ContextTypeSupportTicket = "support_ticket"
    ContextTypeCRMDeal       = "crm_deal"
    
    AccessScopePublic     = "public"
    AccessScopePrivate    = "private"
    AccessScopeDepartment = "department"
)
```

```typescript
// frontend/packages/apis/src/types.ts
export type FileContextType = 
    | 'chat_channel' 
    | 'project' 
    | 'department_docs' 
    | 'calendar_event'
    | 'support_ticket'
    | 'crm_deal';

export type FileAccessScope = 'public' | 'private' | 'department';
```

---

### 2. files.file_pdf_conversion

**Purpose**: Tracks PDF conversions of office documents for in-browser preview

**Table Definition**:
```sql
CREATE TABLE IF NOT EXISTS files.file_pdf_conversion (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    original_file_id UUID NOT NULL,
    
    -- Conversion metadata
    pdf_storage_key TEXT NOT NULL,  -- R2 object key for converted PDF
    pdf_size_bytes BIGINT NOT NULL CHECK (pdf_size_bytes > 0),
    
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

SELECT create_distributed_table('files.file_pdf_conversion', 'organization_id');

-- Indexes
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
```

**Constant Synchronization**:
```go
// backend/internal/files/constants.go
const (
    ConversionStatusPending    = "pending"
    ConversionStatusInProgress = "in_progress"
    ConversionStatusCompleted  = "completed"
    ConversionStatusFailed     = "failed"
)
```

```typescript
// frontend/packages/apis/src/types.ts
export type PDFConversionStatus = 'pending' | 'in_progress' | 'completed' | 'failed';
```

---

### 3. files.file_content_index

**Purpose**: Stores extracted text content for full-text search using PGroonga

**Table Definition**:
```sql
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

SELECT create_distributed_table('files.file_content_index', 'organization_id');

-- Indexes
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
```

**Constant Synchronization**:
```go
// backend/internal/files/constants.go
const (
    ExtractionMethodOfficeParser = "office_parser"
    ExtractionMethodPDFParser    = "pdf_parser"
    ExtractionMethodImageOCR     = "image_ocr"
    ExtractionMethodPlainText    = "plain_text"
    
    IndexingStatusPending    = "pending"
    IndexingStatusInProgress = "in_progress"
    IndexingStatusCompleted  = "completed"
    IndexingStatusFailed     = "failed"
)
```

```typescript
// frontend/packages/apis/src/types.ts
export type ExtractionMethod = 'office_parser' | 'pdf_parser' | 'image_ocr' | 'plain_text';
export type IndexingStatus = 'pending' | 'in_progress' | 'completed' | 'failed';
```

---

### 4. Extension to files.file_metadata (existing table)

**Purpose**: Add validation fields to existing file_metadata table

**ALTER TABLE Statement**:
```sql
-- Add validation fields to existing table
ALTER TABLE files.file_metadata 
    ADD COLUMN IF NOT EXISTS validation_status TEXT 
        CHECK (validation_status IN ('verified', 'warning', 'failed', 'skipped')) 
        DEFAULT 'skipped';

ALTER TABLE files.file_metadata 
    ADD COLUMN IF NOT EXISTS validation_message TEXT;

ALTER TABLE files.file_metadata 
    ADD COLUMN IF NOT EXISTS detected_mime_type TEXT;

-- Index for validation status queries
CREATE INDEX IF NOT EXISTS idx_file_metadata_validation 
    ON files.file_metadata(organization_id, validation_status, updated_at DESC)
    WHERE validation_status IN ('warning', 'failed');

COMMENT ON COLUMN files.file_metadata.validation_status IS 
'File type validation status: verified (type matches), warning (type mismatch but allowed), failed (validation error), skipped (no validation performed). MUST align with backend constants in internal/files/constants.go and frontend TypeScript types in packages/apis/src/files.ts';

COMMENT ON COLUMN files.file_metadata.validation_message IS 
'Human-readable validation message. Example: "File type mismatch: declared application/pdf, detected image/png"';

COMMENT ON COLUMN files.file_metadata.detected_mime_type IS 
'MIME type detected via magic byte analysis using filetype library. May differ from declared mime_type if validation fails.';
```

**Constant Synchronization**:
```go
// backend/internal/files/constants.go
const (
    ValidationStatusVerified = "verified"
    ValidationStatusWarning  = "warning"
    ValidationStatusFailed   = "failed"
    ValidationStatusSkipped  = "skipped"
)
```

```typescript
// frontend/packages/apis/src/types.ts
export type FileValidationStatus = 'verified' | 'warning' | 'failed' | 'skipped';
```

---

## Entity Relationships

```
┌─────────────────────────────┐
│  files.file_metadata        │  (EXISTING - extended with validation fields)
│  ─────────────────────────  │
│  id (PK)                    │
│  organization_id (FK)       │
│  original_filename          │
│  storage_key                │
│  size_bytes                 │
│  mime_type                  │
│  validation_status ◄────────┼──── NEW: Validation result
│  validation_message         │
│  detected_mime_type         │
│  upload_context             │
│  uploaded_by_employee_id    │
│  is_deleted                 │
│  updated_at                 │
└────────┬────────────────────┘
         │
         │ 1:1
         ├──────────────────────────────────┐
         │                                  │
         │                                  │
┌────────▼────────────────────┐    ┌───────▼──────────────────┐
│ files.file_access_rule      │    │ files.file_pdf_conversion│
│ ───────────────────────────│    │ ─────────────────────────│
│ id (PK)                     │    │ id (PK)                  │
│ organization_id (FK)        │    │ organization_id (FK)     │
│ file_id (FK) ◄──────────────┼────┼─ original_file_id (FK)  │
│ context_type                │    │ pdf_storage_key          │
│ context_id                  │    │ pdf_size_bytes           │
│ access_scope                │    │ conversion_status        │
│ updated_at                  │    │ conversion_error         │
└─────────────────────────────┘    │ conversion_duration_ms   │
                                   │ updated_at               │
         │                         └──────────────────────────┘
         │ 1:1
         │
┌────────▼────────────────────┐
│ files.file_content_index    │
│ ───────────────────────────│
│ id (PK)                     │
│ organization_id (FK)        │
│ file_id (FK) ◄──────────────┤
│ extracted_text              │ ◄──── PGroonga index
│ extraction_method           │
│ indexing_status             │
│ indexing_error              │
│ indexing_duration_ms        │
│ updated_at                  │
└─────────────────────────────┘
```

**Relationships**:
- One file_metadata → Zero or one file_access_rule (access control)
- One file_metadata → Zero or one file_pdf_conversion (if office doc)
- One file_metadata → Zero or one file_content_index (if indexable)

**Cascade Behavior**:
- Deleting file_metadata cascades to all related tables (access_rule, pdf_conversion, content_index)
- Deleting organization cascades to all files in that organization
- Citus-compatible: All foreign keys include organization_id

---

## Sample Queries

### Query 1: File Upload with Validation

```sql
-- name: InsertFileMetadataWithValidation :one
INSERT INTO files.file_metadata (
    id,
    organization_id,
    original_filename,
    storage_key,
    size_bytes,
    mime_type,
    validation_status,
    validation_message,
    detected_mime_type,
    upload_context,
    uploaded_by_employee_id,
    updated_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now()
)
RETURNING *;
```

### Query 2: Check File Access

```sql
-- name: CheckFileAccess :one
SELECT 
    far.access_scope,
    far.context_type,
    far.context_id,
    fm.uploaded_by_employee_id
FROM files.file_metadata fm
INNER JOIN files.file_access_rule far ON (fm.organization_id, fm.id) = (far.organization_id, far.file_id)
WHERE fm.organization_id = $1
  AND fm.id = $2
  AND fm.is_deleted = FALSE;
```

### Query 3: Search Files with Access Filter

```sql
-- name: SearchFiles :many
SELECT 
    fm.id,
    fm.original_filename,
    fm.upload_context,
    fm.size_bytes,
    fm.mime_type,
    fm.validation_status,
    fm.uploaded_by_employee_id,
    fm.updated_at,
    fci.extracted_text,
    pgroonga_score(fci.extracted_text) AS relevance_score
FROM files.file_metadata fm
LEFT JOIN files.file_content_index fci ON (fm.organization_id, fm.id) = (fci.organization_id, fci.file_id)
LEFT JOIN files.file_access_rule far ON (fm.organization_id, fm.id) = (far.organization_id, far.file_id)
WHERE fm.organization_id = $1
  AND fm.is_deleted = FALSE
  AND (
    -- Filename match (trigram fuzzy)
    fm.original_filename &@~ $2
    -- Content match (PGroonga full-text search, only if indexed)
    OR (fci.indexing_status = 'completed' AND fci.extracted_text &@~ $2)
  )
  AND (
    -- Access control: public files
    far.access_scope = 'public'
    -- OR private files where user is member
    OR (far.access_scope = 'private' AND far.context_id = ANY($3::uuid[]))
    -- OR files uploaded by this user
    OR fm.uploaded_by_employee_id = $4
  )
ORDER BY 
    -- Relevance score from PGroonga
    COALESCE(pgroonga_score(fci.extracted_text), 0) DESC,
    -- Fallback to updated_at for filename-only matches
    fm.updated_at DESC
LIMIT $5
OFFSET $6;
```

### Query 4: Get PDF Conversion Status

```sql
-- name: GetPDFConversionStatus :one
SELECT 
    id,
    pdf_storage_key,
    pdf_size_bytes,
    conversion_status,
    conversion_error,
    conversion_duration_ms,
    updated_at
FROM files.file_pdf_conversion
WHERE organization_id = $1
  AND original_file_id = $2;
```

### Query 5: Update PDF Conversion Status

```sql
-- name: UpdatePDFConversionStatus :exec
UPDATE files.file_pdf_conversion
SET 
    conversion_status = $3,
    conversion_error = $4,
    conversion_duration_ms = $5,
    updated_at = now()
WHERE organization_id = $1
  AND original_file_id = $2;
```

### Query 6: Insert Content Index

```sql
-- name: InsertFileContentIndex :one
INSERT INTO files.file_content_index (
    id,
    organization_id,
    file_id,
    extracted_text,
    extraction_method,
    indexing_status,
    indexing_error,
    indexing_duration_ms,
    updated_at
) VALUES (
    uuidv7(), $1, $2, $3, $4, $5, $6, $7, now()
)
ON CONFLICT (organization_id, file_id) DO UPDATE
SET 
    extracted_text = EXCLUDED.extracted_text,
    extraction_method = EXCLUDED.extraction_method,
    indexing_status = EXCLUDED.indexing_status,
    indexing_error = EXCLUDED.indexing_error,
    indexing_duration_ms = EXCLUDED.indexing_duration_ms,
    updated_at = now()
RETURNING *;
```

### Query 7: Cleanup on File Deletion

```sql
-- name: DeleteFileAndRelated :exec
-- When file is deleted, cascade will handle cleanup automatically
-- But we can also manually clean up for explicit control
DELETE FROM files.file_metadata
WHERE organization_id = $1
  AND id = $2;

-- Cascade deletes from:
-- - files.file_access_rule
-- - files.file_pdf_conversion
-- - files.file_content_index
```

---

## Migration Strategy

### Migration Files

Create paired `.up.sql` and `.down.sql` files in `backend/k8s/base/database/migrations/`:

**File**: `20251112100000_add_file_security_and_search.up.sql`
```sql
-- Add validation fields to existing file_metadata table
ALTER TABLE files.file_metadata 
    ADD COLUMN IF NOT EXISTS validation_status TEXT 
        CHECK (validation_status IN ('verified', 'warning', 'failed', 'skipped')) 
        DEFAULT 'skipped';

ALTER TABLE files.file_metadata 
    ADD COLUMN IF NOT EXISTS validation_message TEXT;

ALTER TABLE files.file_metadata 
    ADD COLUMN IF NOT EXISTS detected_mime_type TEXT;

CREATE INDEX IF NOT EXISTS idx_file_metadata_validation 
    ON files.file_metadata(organization_id, validation_status, updated_at DESC)
    WHERE validation_status IN ('warning', 'failed');

-- Create file_access_rule table
CREATE TABLE IF NOT EXISTS files.file_access_rule (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    file_id UUID NOT NULL,
    context_type TEXT NOT NULL CHECK (context_type IN ('chat_channel', 'project', 'department_docs', 'calendar_event', 'support_ticket', 'crm_deal')),
    context_id UUID NOT NULL,
    access_scope TEXT NOT NULL CHECK (access_scope IN ('public', 'private', 'department')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_file_access_file 
        FOREIGN KEY (organization_id, file_id)
        REFERENCES files.file_metadata(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT unique_file_access UNIQUE (organization_id, file_id)
);

SELECT create_distributed_table('files.file_access_rule', 'organization_id');

CREATE INDEX IF NOT EXISTS idx_file_access_context 
    ON files.file_access_rule(organization_id, context_type, context_id);

CREATE INDEX IF NOT EXISTS idx_file_access_file 
    ON files.file_access_rule(organization_id, file_id);

-- Create file_pdf_conversion table
CREATE TABLE IF NOT EXISTS files.file_pdf_conversion (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    original_file_id UUID NOT NULL,
    pdf_storage_key TEXT NOT NULL,
    pdf_size_bytes BIGINT NOT NULL CHECK (pdf_size_bytes > 0),
    conversion_status TEXT NOT NULL CHECK (conversion_status IN ('pending', 'in_progress', 'completed', 'failed')) DEFAULT 'pending',
    conversion_error TEXT,
    conversion_duration_ms INTEGER,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_pdf_conversion_file 
        FOREIGN KEY (organization_id, original_file_id)
        REFERENCES files.file_metadata(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT unique_file_conversion UNIQUE (organization_id, original_file_id)
);

SELECT create_distributed_table('files.file_pdf_conversion', 'organization_id');

CREATE INDEX IF NOT EXISTS idx_pdf_conversion_original 
    ON files.file_pdf_conversion(organization_id, original_file_id);

CREATE INDEX IF NOT EXISTS idx_pdf_conversion_status 
    ON files.file_pdf_conversion(organization_id, conversion_status, updated_at DESC)
    WHERE conversion_status IN ('pending', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_pdf_conversion_storage_key 
    ON files.file_pdf_conversion(organization_id, pdf_storage_key);

-- Create file_content_index table
CREATE TABLE IF NOT EXISTS files.file_content_index (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    file_id UUID NOT NULL,
    extracted_text TEXT NOT NULL,
    extraction_method TEXT NOT NULL CHECK (extraction_method IN ('office_parser', 'pdf_parser', 'image_ocr', 'plain_text')) DEFAULT 'plain_text',
    indexing_status TEXT NOT NULL CHECK (indexing_status IN ('pending', 'in_progress', 'completed', 'failed')) DEFAULT 'pending',
    indexing_error TEXT,
    indexing_duration_ms INTEGER,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_file_content_file 
        FOREIGN KEY (organization_id, file_id)
        REFERENCES files.file_metadata(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT unique_file_index UNIQUE (organization_id, file_id)
);

SELECT create_distributed_table('files.file_content_index', 'organization_id');

CREATE INDEX IF NOT EXISTS idx_file_content_file 
    ON files.file_content_index(organization_id, file_id);

CREATE INDEX IF NOT EXISTS idx_file_content_status 
    ON files.file_content_index(organization_id, indexing_status, updated_at DESC)
    WHERE indexing_status IN ('pending', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_file_content_pgroonga 
    ON files.file_content_index USING pgroonga(extracted_text);
```

**File**: `20251112100000_add_file_security_and_search.down.sql`
```sql
-- Drop tables in reverse order
DROP INDEX IF EXISTS files.idx_file_content_pgroonga;
DROP INDEX IF EXISTS files.idx_file_content_status;
DROP INDEX IF EXISTS files.idx_file_content_file;
DROP TABLE IF EXISTS files.file_content_index;

DROP INDEX IF EXISTS files.idx_pdf_conversion_storage_key;
DROP INDEX IF EXISTS files.idx_pdf_conversion_status;
DROP INDEX IF EXISTS files.idx_pdf_conversion_original;
DROP TABLE IF EXISTS files.file_pdf_conversion;

DROP INDEX IF EXISTS files.idx_file_access_file;
DROP INDEX IF EXISTS files.idx_file_access_context;
DROP TABLE IF EXISTS files.file_access_rule;

DROP INDEX IF EXISTS files.idx_file_metadata_validation;
ALTER TABLE files.file_metadata DROP COLUMN IF EXISTS detected_mime_type;
ALTER TABLE files.file_metadata DROP COLUMN IF EXISTS validation_message;
ALTER TABLE files.file_metadata DROP COLUMN IF EXISTS validation_status;
```

### Migration Execution

```bash
# Apply migrations
cd backend
./scripts/migrate.sh

# Verify migration
psql -U postgres -d tech_office_db -c "\d files.file_access_rule"
psql -U postgres -d tech_office_db -c "\d files.file_pdf_conversion"
psql -U postgres -d tech_office_db -c "\d files.file_content_index"
```

### Backward Compatibility

- **No breaking changes**: Existing file_metadata table extends with nullable columns
- **Default values**: validation_status defaults to 'skipped' for existing files
- **Gradual rollout**: New tables only populated for new uploads
- **No data migration**: Existing files continue working without validation/indexing

---

## Performance Considerations

### Index Strategy

1. **file_access_rule**: Index on (organization_id, context_type, context_id) for access checks
2. **file_pdf_conversion**: Index on (organization_id, original_file_id) for conversion lookups
3. **file_content_index**: PGroonga index on extracted_text for full-text search
4. **Partial indexes**: Only index incomplete conversions/indexing to reduce index size

### Query Optimization

- **Access control**: Precompute context membership in application logic (reduce JOIN complexity)
- **Search**: Use PGroonga's relevance scoring to return best matches first
- **Pagination**: Cursor-based pagination using UUID v7 (time-sortable IDs)

### Storage Impact

- **file_content_index**: Extracted text may be large (up to 10MB per document)
- **Mitigation**: Compression, retention policy for old indexes, archival strategy

---

## Security Considerations

### Multi-Tenant Isolation

- **All queries filter by organization_id**: Enforced at query level, interceptor extracts from auth token
- **Foreign keys include organization_id**: Prevents cross-tenant data leakage
- **Citus sharding**: Data physically partitioned by organization_id

### Access Control Defense in Depth

1. **Database level**: Foreign keys enforce referential integrity
2. **Logic layer**: Access check algorithm validates context membership
3. **Connect layer**: Lightweight proto-level authorization
4. **Audit logging**: All access checks logged for forensics

---

## Testing Data

### Sample Test Data

```sql
-- Test organization
INSERT INTO public.organization (id, company_name, subdomain, project_id, app_id)
VALUES ('01234567-89ab-cdef-0123-456789abcdef', 'Acme Corp', 'acme', '...', '...');

-- Test file with validation warning
INSERT INTO files.file_metadata (
    id, organization_id, original_filename, storage_key, size_bytes, mime_type,
    validation_status, validation_message, detected_mime_type,
    upload_context, uploaded_by_employee_id
) VALUES (
    uuidv7(), '01234567-89ab-cdef-0123-456789abcdef', 'malicious.pdf',
    'org-01234567/chat/malicious.pdf', 1024000, 'application/pdf',
    'warning', 'File type mismatch: declared application/pdf, detected image/png', 'image/png',
    'chat', 'employee-uuid-here'
);

-- Test file access rule
INSERT INTO files.file_access_rule (
    id, organization_id, file_id, context_type, context_id, access_scope
) VALUES (
    uuidv7(), '01234567-89ab-cdef-0123-456789abcdef', 'file-uuid-here',
    'chat_channel', 'channel-uuid-here', 'private'
);

-- Test PDF conversion
INSERT INTO files.file_pdf_conversion (
    id, organization_id, original_file_id, pdf_storage_key, pdf_size_bytes,
    conversion_status, conversion_duration_ms
) VALUES (
    uuidv7(), '01234567-89ab-cdef-0123-456789abcdef', 'file-uuid-here',
    'org-01234567/conversions/file-uuid-here.pdf', 2048000,
    'completed', 45000
);

-- Test content index
INSERT INTO files.file_content_index (
    id, organization_id, file_id, extracted_text, extraction_method,
    indexing_status, indexing_duration_ms
) VALUES (
    uuidv7(), '01234567-89ab-cdef-0123-456789abcdef', 'file-uuid-here',
    'This is extracted text from the document. It contains searchable content.',
    'office_parser', 'completed', 15000
);
```

---

## Conclusion

This data model extends the existing files schema with minimal changes to existing tables and follows all constitutional requirements:
- ✅ UUID v7 primary keys
- ✅ organization_id for multi-tenant isolation
- ✅ Citus-compatible composite keys and foreign keys
- ✅ CHECK constraints for enums
- ✅ Proper indexes for query performance
- ✅ Column comments documenting allowed values
- ✅ Cascade delete behavior for cleanup

**Status**: ✅ Data model design complete
