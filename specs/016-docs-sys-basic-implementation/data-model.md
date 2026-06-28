# Data Model: Document Management System

**Date**: 2024-12-19  
**Schema**: `docs`  
**Multi-Tenant**: Yes (all tables include `organization_id` as part of composite primary key)

## Schema Overview

```
docs
├── document              # Core document entity with hierarchy
├── document_version      # Version history with full content snapshots
├── document_slug_history # Slug redirect history for permanent links
├── document_access       # Permission grants (users/departments)
├── document_follower     # Subscription for notifications
├── section_embed         # Cross-document section citations
├── comment               # Inline comments on text blocks
├── comment_reply         # Replies to comments
└── document_editor       # UNLOGGED: Active editor tracking
```

---

## Tables

### 1. `docs.document`

Core document entity supporting hierarchical organization (max 10 levels).

```sql
CREATE TABLE IF NOT EXISTS docs.document (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    
    -- Document identity
    title TEXT NOT NULL,
    slug TEXT NOT NULL, -- Format: {title-slug}-{base62-uuid}
    
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

-- Indexes
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
'Document lifecycle status: active, outdated, archived. MUST align with backend constants and frontend types.';

COMMENT ON COLUMN docs.document.visibility IS 
'Root document visibility: public (organization-wide), private (explicit grants only). Children inherit.';
```

---

### 2. `docs.document_version`

Version history with full content snapshots for diff and blame.

```sql
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_version_document 
    ON docs.document_version(organization_id, document_id, version_number DESC);

CREATE INDEX IF NOT EXISTS idx_version_author 
    ON docs.document_version(organization_id, author_employee_id, created_at DESC);

COMMENT ON TABLE docs.document_version IS 
'Version history with full content snapshots. Enables git blame attribution and diff comparison. No version pruning.';

COMMENT ON COLUMN docs.document_version.content_json IS 
'Complete TipTap JSON document at this version. Enables exact reconstruction and diff computation.';
```

---

### 3. `docs.document_slug_history`

Slug redirect history for permanent links.

```sql
CREATE TABLE IF NOT EXISTS docs.document_slug_history (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    document_id UUID NOT NULL,
    
    -- Slug change
    old_slug TEXT NOT NULL,
    new_slug TEXT NOT NULL,
    
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_slug_history_document 
    ON docs.document_slug_history(organization_id, document_id, changed_at DESC);

COMMENT ON TABLE docs.document_slug_history IS 
'Tracks slug changes for 301 redirect support. Old slugs permanently redirect to current slug.';
```

---

### 4. `docs.document_access`

Permission grants for private documents.

```sql
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

-- Indexes
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
'Permission level: read_comment (view+comment), write_update (edit), none (explicit deny). MUST align with constants.';

COMMENT ON COLUMN docs.document_access.grantee_type IS 
'Type of grantee: employee (individual), department (team grant).';
```

---

### 5. `docs.document_follower`

Subscription for update notifications.

```sql
CREATE TABLE IF NOT EXISTS docs.document_follower (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    document_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    
    -- Timestamps
    followed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding
    PRIMARY KEY (organization_id, id),
    
    -- Foreign keys
    CONSTRAINT fk_follower_document
        FOREIGN KEY (organization_id, document_id)
        REFERENCES docs.document(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_follower_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE CASCADE,
    
    -- Constraints
    CONSTRAINT unique_follower UNIQUE (organization_id, document_id, employee_id)
);

SELECT create_distributed_table('docs.document_follower', 'organization_id', colocate_with => 'public.organization');

-- Indexes
CREATE INDEX IF NOT EXISTS idx_follower_document 
    ON docs.document_follower(organization_id, document_id);

CREATE INDEX IF NOT EXISTS idx_follower_employee 
    ON docs.document_follower(organization_id, employee_id, followed_at DESC);

COMMENT ON TABLE docs.document_follower IS 
'Subscriptions for document update notifications. Followers receive notifications on edits, status changes.';
```

---

### 6. `docs.section_embed`

Cross-document section citations/embeds (line-based with version snapshots).

```sql
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

-- Indexes
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
```

**Lifecycle Management**:
- ✅ **Auto-cleanup**: When user saves document with embed removed, backend automatically deletes corresponding `section_embed` row
- ✅ **Atomic operation**: Cleanup happens within same transaction as document update (rollback-safe)
- ✅ **Implementation**: `UpdateDocument()` parses content JSON, compares with existing embeds, deletes orphaned records
- ✅ **Result**: CitationsPanel immediately reflects current embed state (no stale citations)

---

### 7. `docs.comment`

Inline comments on text blocks.

```sql
CREATE TABLE IF NOT EXISTS docs.comment (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    document_id UUID NOT NULL,
    
    -- Comment location
    block_id UUID NOT NULL, -- TipTap block where comment is anchored
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_comment_document 
    ON docs.comment(organization_id, document_id, is_resolved, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_comment_author 
    ON docs.comment(organization_id, author_employee_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_comment_block 
    ON docs.comment(organization_id, document_id, block_id);

COMMENT ON TABLE docs.comment IS 
'Inline comments anchored to document blocks. Supports text selection ranges and threaded replies.';
```

---

### 8. `docs.comment_reply`

Replies to inline comments.

```sql
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_reply_comment 
    ON docs.comment_reply(organization_id, comment_id, updated_at ASC);

COMMENT ON TABLE docs.comment_reply IS 
'Replies to inline comments. One level of threading only (no nested replies).';
```

---

### 9. `docs.document_editor` (UNLOGGED)

Active editor tracking for concurrent edit limit (max 10).

```sql
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

-- Indexes
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
```

---

## Entity Relationships

```
organization (public)
    │
    └──▶ docs.document (1:N)
           │
           ├──▶ docs.document (parent-child, max 10 levels)
           ├──▶ docs.document_version (1:N)
           ├──▶ docs.document_slug_history (1:N)
           ├──▶ docs.document_access (1:N)
           ├──▶ docs.document_follower (1:N)
           ├──▶ docs.section_embed (source, 1:N)
           ├──▶ docs.section_embed (target, 1:N)
           ├──▶ docs.comment (1:N)
           │      └──▶ docs.comment_reply (1:N)
           └──▶ docs.document_editor (UNLOGGED, 1:N, max 10)

organization.employee ──▶ author/owner references
organization.department ──▶ grantee references
```

---

## Constants Synchronization

| Constant | Database CHECK | Backend Constant | Frontend Type |
|----------|----------------|------------------|---------------|
| Document status | `('active', 'outdated', 'archived')` | `internal/docs/constants.go` | `packages/apis/src/docs.ts` |
| Visibility | `('public', 'private')` | `internal/docs/constants.go` | `packages/apis/src/docs.ts` |
| Access level | `('read_comment', 'write_update', 'none')` | `internal/docs/constants.go` | `packages/apis/src/docs.ts` |
| Grantee type | `('employee', 'department')` | `internal/docs/constants.go` | `packages/apis/src/docs.ts` |

---

## Migration Strategy

1. Create `docs` schema: `CREATE SCHEMA IF NOT EXISTS docs;`
2. Create tables in dependency order: document → version/slug_history/access/follower → section_embed → comment → comment_reply → document_editor
3. Distribute tables with Citus (colocate with organization)
4. Create indexes after table creation
5. Add comments for documentation
