# Research: Document Management System

**Date**: 2024-12-19  
**Feature**: Notion/Confluence-style document management with real-time collaboration

## Research Tasks

### 1. Real-Time Collaborative Editing Architecture

**Unknown**: How to implement real-time collaborative editing with merge support for up to 10 concurrent editors?

**Research Findings**:

**Decision**: Use CRDT-based approach with Yjs library (frontend) and leverage existing notification hub SSE infrastructure for cursor/presence sync.

**Approach**:
- **Frontend CRDT**: Use Yjs + TipTap collaboration extension (`@tiptap/extension-collaboration`)
- **Backend Sync Server**: Yjs Hocuspocus-style server for document state synchronization
- **Cursor Sync**: Use existing SSE ephemeral signal routing for cursor positions
- **Editor Limit Enforcement**: Track active editors in `docs.document_editor` UNLOGGED table (similar to `notification.active_connection`)
- **Persistence**: Store Yjs document state (Y.Doc) as binary blob in PostgreSQL; serialize on editor disconnect or periodic autosave

**CRDT Benefits**:
- Automatic conflict resolution without locking
- Works offline with eventual sync
- Industry standard (Notion, Figma, Linear use CRDTs)
- Yjs is battle-tested and has TipTap integration

**Yjs + TipTap Integration**:
```typescript
import * as Y from 'yjs';
import { TiptapCollabProvider } from '@hocuspocus/provider';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';

const ydoc = new Y.Doc();
const provider = new TiptapCollabProvider({
  name: 'document-slug',
  document: ydoc,
  url: 'wss://backend/collab', // WebSocket endpoint
});

const editor = new Editor({
  extensions: [
    StarterKit,
    Collaboration.configure({ document: ydoc }),
    CollaborationCursor.configure({ provider }),
  ],
});
```

**Alternative Considered**:
- **OT (Operational Transformation)**: More complex to implement; CRDT is preferred for new projects
- **Pure notification hub SSE**: Not suitable for high-frequency cursor updates; WebSocket needed for collab

**Rationale**:
- Yjs handles all merge complexity automatically
- Existing notification SSE can broadcast "document updated" notifications to followers
- WebSocket for real-time collab, SSE for notifications (separation of concerns)

**Existing Patterns to Leverage**:
- `notification.active_connection` pattern for tracking document editors
- Ephemeral signal routing for cursor sync (priority=4 signals)
- TipTap already in use for chat messages

---

### 2. Version History with Git Blame Attribution

**Unknown**: How to implement line-by-line attribution (git blame style) for version history?

**Research Findings**:

**Decision**: Store content as structured JSON with line-level metadata; compute blame attribution by walking version history.

**Approach**:
- **Content Structure**: Store TipTap/ProseMirror JSON (not raw HTML/Markdown) for structured access
- **Version Snapshots**: On each save, store complete document content + author + timestamp
- **Blame Computation**:
  * Walk versions chronologically
  * For each paragraph/block, track last author who modified it
  * Use diff algorithm to identify which blocks changed
- **Diff View**: Use `diff-match-patch` or `jsdiff` library for text comparison
- **On-Demand Computation**: Blame computed on request, not stored (versions are source of truth)

**Storage Format**:
```json
{
  "type": "doc",
  "content": [
    {
      "type": "paragraph",
      "content": [{"type": "text", "text": "Hello world"}]
    }
  ]
}
```

**Version Table Design**:
- `document_id`: Reference to parent document
- `version_number`: Sequential version (1, 2, 3...)
- `content_json`: TipTap JSON document
- `content_text`: Plain text extraction for full-text search
- `author_id`: Employee who made the change
- `created_at`: Version timestamp
- `summary`: Optional edit summary

**Alternatives Considered**:
- **Store diffs only**: Harder to reconstruct full document; full snapshots simpler
- **Git-style packfiles**: Overkill for document versioning
- **Pre-compute blame**: Storage-intensive; on-demand is acceptable for <100 versions

**Rationale**: Full JSON snapshots enable easy diff computation and are well-supported by TipTap.

---

### 3. Section Linking and Embedding

**Unknown**: How to implement line range selection, highlighting, and cross-document embedding?

**Research Findings**:

**Decision**: Use line-based section references with VERSION SNAPSHOTS for predictable embed behavior.

**Approach**:
- **Line-Based Selection**: Store `target_line_start` and `target_line_end` (1-indexed) instead of block IDs
- **URL Format**: `/workspace/docs?doc={slug}#L{start}-L{end}` for direct line highlighting
- **Highlighting**: On page load, scroll to line range and apply highlight CSS
- **Embedding**: Store `SectionEmbed` record with source_document_id, target_document_id, and line ranges
- **Version Snapshots (REQUIRED)**: `target_version_number` is NOT NULL and auto-populated with current version at embed creation time
  * User embeds the content they SEE at that moment (e.g., v3)
  * Embedded content remains stable even if target document is updated to v4, v5, etc.
  * Prevents unexpected changes in citing documents
  * Staleness detection: compare `target_version_number` with current `version_count`
- **Live Content**: Embedded sections render by fetching source document lines at view time (from snapshotted version)
- **Future Enhancement**: "Update to latest" button for stale embeds (requires UpdateEmbed RPC)

**Why Line-Based Sections over Block IDs**:
- Simpler implementation: no need for TipTap UniqueId extension
- Line numbers are stable within a version
- Easier for users to understand (#L10-L15 in URL)
- Combined with version snapshots, provides stable embed references

**Circular Embedding Detection**:
- On embed creation, check if target document embeds source (direct cycle)
- Store embedding graph in `docs.section_embed` table
- Query for cycles before allowing new embeds

**Alternatives Considered**:
- **Block IDs (TipTap UniqueId)**: More complex, requires extension; line-based is simpler
- **Live-tracking embeds (NULL version)**: Unpredictable content changes; snapshot is better UX

**Rationale**: Version snapshots align with user expectations - when you cite a document, you're citing what you read NOW, not what it might become later.

---

### 4. Permission Inheritance Model

**Unknown**: How to implement permission inheritance where children can only be MORE restrictive?

**Research Findings**:

**Decision**: Effective permissions computed at read time by traversing up hierarchy.

**Approach**:
- **Access Levels**: `read_comment`, `write_update`, `none`
- **Root Document**: Explicit visibility (`public` or `private`) and explicit access list
- **Child Documents**: Can add `DocumentAccess` records that DENY or RESTRICT (never GRANT broader)
- **Permission Resolution**:
  1. Start at document, check explicit access
  2. If not found, traverse to parent
  3. Continue until root or explicit grant/deny found
  4. Child restriction overrides parent grant

**Permission Priority**:
1. Explicit child restriction (DENY) → blocks access
2. Explicit child grant → uses child level (must be <= parent level)
3. No explicit child record → inherit from parent
4. Root public → organization-wide read+comment
5. Root private → explicit grants only

**Database Design**:
```sql
-- Permission grant/restriction for document
CREATE TABLE docs.document_access (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL,
    document_id UUID NOT NULL,
    grantee_type TEXT NOT NULL, -- 'employee', 'department', 'all_org'
    grantee_id UUID, -- NULL if grantee_type='all_org'
    access_level TEXT NOT NULL, -- 'read_comment', 'write_update', 'none'
    inherited BOOLEAN DEFAULT FALSE, -- TRUE if copied from parent
    ...
);
```

**Performance Optimization**:
- Cache effective permissions in application layer
- Invalidate cache on permission change (propagate to children)
- Denormalize root visibility to avoid hierarchy traversal for public docs

---

### 5. Leveraging Notification Hub for Collaboration

**Unknown**: Can we leverage the existing notification hub backend for real-time collaboration features?

**Research Findings**:

**Decision**: YES - Use notification hub for document-level events; add dedicated WebSocket for real-time CRDT sync.

**Leverage Notification Hub For**:
1. **Document Update Notifications**: Notify followers when document is saved
2. **Mention Notifications**: Notify users when @mentioned in document
3. **Comment Notifications**: Notify when comments added to followed documents
4. **Presence Awareness**: Show who is currently viewing/editing (extend `active_connection` pattern)

**Do NOT Use Notification Hub For**:
- **CRDT Sync**: Too high frequency; needs dedicated WebSocket
- **Cursor Positions**: Real-time cursor sync needs <100ms latency; SSE is 30s heartbeat

**Integration Points**:
1. **Active Document Editors**: Create `docs.document_editor` UNLOGGED table mirroring `notification.active_connection`:
   ```sql
   CREATE UNLOGGED TABLE docs.document_editor (
       organization_id UUID NOT NULL,
       document_id UUID NOT NULL,
       employee_id UUID NOT NULL,
       connection_id UUID NOT NULL,
       instance_id TEXT NOT NULL,
       connected_at TIMESTAMPTZ,
       last_heartbeat TIMESTAMPTZ,
       cursor_position JSONB, -- {block_id, offset}
       PRIMARY KEY (organization_id, document_id, employee_id)
   );
   ```

2. **Reuse Notification Logic Layer**: Inject `NotificationLogic` into `DocsLogic` for publishing:
   ```go
   // When document saved:
   notifLogic.PublishNotification(ctx, tx, PublishParams{
       OrganizationID: orgID,
       SourceDomain:   "docs",
       NotificationType: "document_updated",
       Title: fmt.Sprintf("%s updated a document", authorName),
       Recipients: followerEmployeeIDs,
   })
   ```

3. **Ephemeral Signals for Cursor Sync**: Can optionally use SSE ephemeral routing for viewer awareness (not editor cursors).

**Rationale**:
- Notification hub is optimized for persistent notifications, not high-frequency sync
- Separation: WebSocket for CRDT, SSE for notifications
- Existing patterns (active_connection, ephemeral signals) transfer well to document editors

---

### 6. Full-Text Search with PGroonga

**Unknown**: How to implement search with original content ranked higher than embedded?

**Research Findings**:

**Decision**: Use PGroonga with weighted scoring; boost original content, demote embedded references.

**Approach**:
- **Content Indexing**: Store `content_text` (plain text extraction) alongside TipTap JSON
- **PGroonga Index**: Create index on `content_text` column
- **Embedded Content Tracking**: Separate table `docs.section_embed` tracks embedding relationships
- **Search Ranking**:
  ```sql
  SELECT d.id, d.title,
         pgroonga_score(tableoid, ctid) * 
         CASE WHEN se.id IS NULL THEN 1.0 ELSE 0.5 END AS score
  FROM docs.document d
  LEFT JOIN docs.section_embed se ON se.document_id = d.id
  WHERE d.content_text &@~ $query
    AND d.organization_id = $org_id
  ORDER BY score DESC;
  ```

**Access Control in Search**:
- Pre-filter by accessible document IDs
- Or use post-filter with LIMIT + offset pagination

**Existing Pattern**: 
- `chat.message` uses PGroonga for multilingual search
- `idx_message_pgroonga` pattern can be replicated

---

### 7. URL Slug Design with Redirect

**Unknown**: How to implement permanent links with slug-based routing?

**Research Findings**:

**Decision**: Store slug history table for redirect; generate slug from title + base62(uuid).

**Approach**:
- **Slug Format**: `{title-slug}-{base62-uuid-suffix}`
  * Example: `project-planning-guide-3xK9mN`
- **Base62 Encoding**: Use first 6-8 chars of UUID v7 encoded in base62
- **Slug History**: Track previous slugs in `docs.document_slug_history`
- **Redirect Logic**: 
  1. Query current slug first
  2. If not found, query slug history
  3. Return 301 redirect to current slug

**Slug History Table**:
```sql
CREATE TABLE docs.document_slug_history (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL,
    document_id UUID NOT NULL,
    old_slug TEXT NOT NULL,
    new_slug TEXT NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, old_slug)
);
```

**URL Path for Nested Docs** (max 3 levels shown):
- Level 1: `/docs/project-guide-3xK9mN`
- Level 2: `/docs/project-guide-3xK9mN/setup-instructions-7yL2pQ`
- Level 3+: `/docs/3xK9mN/7yL2pQ/...` (shortened base62 format)

---

### 8. TipTap Extensions Required

**Research Findings**:

**Required TipTap Extensions**:
1. `@tiptap/starter-kit` - Already installed
2. `@tiptap/extension-collaboration` - For Yjs CRDT sync
3. `@tiptap/extension-collaboration-cursor` - For cursor awareness
4. `@tiptap/extension-unique-id` - For block-level IDs (section linking)
5. `@tiptap/extension-mention` - For @mentions (already used in chat)
6. `@tiptap/extension-link` - For hyperlinks
7. `@tiptap/extension-image` - For embedded images
8. `@tiptap/extension-table` - For table support

**Backend Dependencies**:
- `y-protocols` - Yjs sync protocols for Go
- Alternative: Use `hocuspocus-server` Node.js sidecar for WebSocket

**Decision**: Start with server-side Yjs storage without real-time sync; add Hocuspocus server for real-time in Phase 2.

---

## Summary

| Question | Decision |
|----------|----------|
| Real-time editing | Yjs CRDT + TipTap collaboration extensions |
| Version history | Full JSON snapshots; compute blame on-demand |
| Section linking | Block IDs (UUID) instead of line numbers |
| Permission inheritance | Compute at read time; children restrict only |
| Notification hub | Use for document notifications, NOT CRDT sync |
| Full-text search | PGroonga with boost for original content |
| URL slugs | title-slug-base62uuid with redirect history |
| Concurrent editing | UNLOGGED table for active editors (max 10) |
