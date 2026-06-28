# Implementation Notes - Document Management System

**Date**: 2025-12-23  
**Feature**: 016-docs-sys-basic-implementation  
**Purpose**: Document implementation decisions and fixes made during development

---

## Critical Fixes

### 1. Version Snapshot Behavior (Embed Content Fetching)

**Issue Identified**: Embeds were auto-updating when target document changed, defeating the purpose of version snapshots.

**Root Cause**:
- `GetEmbeddedContent` query was fetching content from `docs.document` table (current version)
- Should fetch from `docs.document_version` table using the snapshotted `target_version_number`

**Fix Applied** (2025-12-23):
```sql
-- OLD (INCORRECT):
SELECT content_json, content_text, status, version_count 
FROM docs.document
WHERE organization_id = @organization_id AND id = @id AND is_deleted = FALSE;

-- NEW (CORRECT):
SELECT v.content_json, v.content_text, d.status, d.version_count
FROM docs.document_version v
JOIN docs.document d ON (d.organization_id, d.id) = (v.organization_id, v.document_id)
WHERE v.organization_id = @organization_id 
  AND v.document_id = @id 
  AND v.version_number = @version_number
  AND d.is_deleted = FALSE;
```

**Impact**:
- ✅ Embeds now display the exact content from the snapshotted version
- ✅ Citation integrity maintained across document updates
- ✅ Users see exactly what they cited, not future edits

**Files Modified**:
- `backend/database/scripts/docs.query.sql` - Updated `GetEmbeddedContent` query
- `backend/internal/docs/embed_logic.go` - Pass `target_version_number` parameter
- `backend/database/docs.query.sql.go` - Regenerated via `sqlc generate`

---

## Feature: Citation Visualization

### CitationsPanel Component

**Purpose**: Show document owners which documents are citing/embedding their content

**Features**:
- **Expandable Line Ranges**: Groups citations by line range (e.g., "Lines 10-15: 3 citations")
- **Staleness Indicators**: Shows when citations reference older versions (e.g., "Cited at v3, current is v5")
- **Direct Links**: Click citation to jump to citing document with line highlighting
- **Citation Count**: Shows how many times each line range is cited
- **Empty State**: Helpful message when no citations exist

**Integration**:
- **Location**: Right panel in document view (tabs: Comments | History | Citations)
- **Trigger**: Click "Citations" button in document toolbar
- **Component Path**: `frontend/apps/web/src/app/workspace/docs/components/CitationsPanel.tsx`
- **API Call**: `listIncomingCitations(documentId)` from `packages/apis/src/docs.ts`

**Backend Support**:
- **Query**: `ListIncomingCitations` in `backend/database/scripts/docs.query.sql`
- **Logic**: `ListIncomingCitations()` in `backend/internal/docs/embed_logic.go`
- **Proto**: `ListIncomingCitationsRequest/Response` in `backend/rpc/v1/document.proto`

### Line Number Sidebar Citation Markers (NEW - December 2025)

**Purpose**: Show visual indicators directly in the line number sidebar for lines that are cited by other documents

**Features**:
- **Filled Circles**: Indigo-colored dots (●) appear next to line numbers for cited lines
- **Hover Tooltips**: Shows citation count (e.g., "Cited by 2 documents. Click to view citations.")
- **Click Behavior**: Clicking a citation marker opens the Citations Panel
- **Theme Colors**: Uses `#6366f1` (Indigo 500) for markers, `#818cf8` (Indigo 400) on hover
- **Scale Animation**: Marker scales up 1.2x on hover for better visibility

**Implementation**:
- **Component**: `LineNumberSidebar.tsx` - Added `citedLineRanges` and `onCitedLineClick` props
- **Data Flow**: 
  1. `DocumentView` fetches incoming citations via `useQuery(['docs', 'incoming-citations', documentId])`
  2. Extracts `citedLineRanges` from response
  3. Passes to `DocumentEditor` as prop
  4. `DocumentEditor` passes to `LineNumberSidebar` with click handler
- **Query**: Runs only in view mode (disabled during editing for performance)
- **Cache**: 60-second stale time to reduce API calls

**Visual Design**:
```
   1 │ # Introduction
   2 │ This document explains...
●  3 │ Important concept here   ← Cited by 2 documents (hover to see)
●  4 │ And continuation        
   5 │ 
   6 │ ## Details
●  7 │ Critical technical info  ← Cited by 1 document
```

**Files Modified**:
- `frontend/apps/web/src/app/workspace/docs/components/LineNumberSidebar.tsx` - Added citation marker rendering
- `frontend/apps/web/src/app/workspace/docs/components/DocumentView.tsx` - Added citation data fetching
- `frontend/apps/web/src/app/workspace/docs/components/DocumentEditor.tsx` - Wired up props

**Design Alignment**: Implements Layer 2 from `CITATION-VISIBILITY-DESIGN.md`

---

## Feature: Line Number Sidebar

### Implementation Details

**Purpose**: Show line numbers next to document content for easy referencing

**Component**: `LineNumberSidebar.tsx`

**Modes**:
1. **View Mode**: Read-only, click line to copy link
2. **WYSIWYG Edit Mode**: Interactive, DOM-measured positioning for variable-height content
3. **Markdown Edit Mode**: Simple fixed spacing (1.8rem per line)

**Challenges Solved**:
1. **Variable-Height Content**: Embeds, headers, code blocks have different heights
   - **Solution**: MutationObserver + ResizeObserver measure actual DOM positions
   - **Implementation**: Query block elements (p, h1-h3, pre, blockquote, ul, ol, embed)
   - **Result**: Line numbers align pixel-perfect with content

2. **Version-Pinned Links**: Line links must include version parameter
   - **Format**: `/workspace/docs?slug={slug}&v={version}#L{start}-L{end}`
   - **Example**: `/workspace/docs?slug=project-guide-3xK9mN&v=3#L10-L15`
   - **Result**: Embeds created from line links are version-pinned by default

**Files**:
- `frontend/apps/web/src/app/workspace/docs/components/LineNumberSidebar.tsx`
- `frontend/apps/web/src/app/workspace/docs/components/DocumentEditor.tsx`

---

## Feature: Embed/Citation Flow

### Complete Workflow

1. **User copies line link**:
   - Click line number in sidebar
   - Link copied: `/workspace/docs?slug=xyz&v=3#L10-L15`

2. **User pastes link in editor**:
   - DocumentEditor detects `#L...` pattern
   - Creates pending embed node with `citationUrl` attribute

3. **User saves document**:
   - `saveMutation` processes pending embeds
   - Calls `createEmbed()` API to create `section_embed` record
   - Embed node updated with `embedId` and `targetDocumentId`

4. **Embed renders**:
   - `EmbeddedSection.tsx` fetches content via `getEmbeddedSection(embedId)`
   - Backend fetches from `document_version` table (snapshotted content)
   - Shows version badge, staleness warning if applicable

5. **Citation tracking**:
   - Target document owner sees citation in CitationsPanel
   - Shows which documents cite which lines, with staleness indicators

### Markdown Round-Trip

**Embed Token Format**: `{{embed:/workspace/docs?slug=xyz&v=3#L10-L15}}`

**WYSIWYG → Markdown**:
- TipTap embed node converts to markdown token
- Preserves `citationUrl`, `embedId`, `targetDocumentId` in token

**Markdown → WYSIWYG**:
- Parser detects `{{embed:...}}` pattern
- Creates TipTap embed node with attributes
- Rehydrates `embedId` from `embedIdByUrl` map if available

---

## Design Decisions

### Why Version Snapshots?

**Problem**: Original design had optional `target_version_number` (NULL = track latest)

**Issue**: Unpredictable UX - when user embeds lines 10-20, they expect to cite what they SEE now, not what might change later

**Solution**: Make `target_version_number` NOT NULL, auto-populate with current version

**Result**: Embeds are snapshots by default, maintaining citation integrity

### Why Line-Based Sections?

**Alternative Considered**: Block IDs (TipTap UniqueId extension)

**Reasons for Line-Based**:
1. **Simpler Implementation**: No need for TipTap UniqueId extension
2. **User-Friendly**: `#L10-L15` in URL is intuitive
3. **Version-Compatible**: Line numbers are stable within a version
4. **GitHub-Style**: Familiar pattern from code hosting platforms

### Orphaned Embed Cleanup (December 2025)

**Problem**: When users delete embed nodes from their documents, the corresponding `section_embed` table rows were not being deleted, causing:
- Stale citations appearing in CitationsPanel
- Incorrect citation counts
- Database bloat from orphaned records

**Solution**: Synchronize embed table on every document update (Option 1: Sync on Save)

**Implementation**:
1. **`extractEmbedIds(contentJSON)`**: Parses TipTap JSON to extract all `embedId` attributes from embed nodes
2. **`ListEmbedsBySource` query**: Fetches existing embed records for the source document
3. **`syncEmbeds()` method**: Compares current embeds vs. content, deletes orphaned records
4. **Integration**: Called in `UpdateDocument()` within the same transaction (atomic operation)

**Benefits**:
- ✅ Immediate consistency - citations disappear when embed removed
- ✅ Transaction safety - embed cleanup rolls back if document update fails
- ✅ Simple logic - no background jobs or soft deletes
- ✅ Minimal overhead - content parsing already happens for plain text extraction

**Code Flow**:
```go
UpdateDocument() {
    // ... update document content ...
    // ... create new version ...
    
    // Sync embed table with content
    syncEmbeds(ctx, tx, orgID, docID, newContentJSON) {
        currentIDs := extractEmbedIds(newContentJSON)  // Parse JSON
        existingEmbeds := ListEmbedsBySource(docID)    // Query DB
        
        for each existing {
            if !contains(currentIDs, existing.ID) {
                DeleteSectionEmbed(existing.ID)  // Remove orphan
            }
        }
    }
}
```

**Query Added**:
```sql
-- name: ListEmbedsBySource :many
SELECT id, organization_id, source_document_id, target_document_id
FROM docs.section_embed
WHERE organization_id = @organization_id AND source_document_id = @source_document_id;
```

---

## Testing Recommendations

### Backend Integration Tests

Already exist in `backend/integration/docs_embed_test.go`:
- ✅ `TestSectionEmbed_CreateEmbed`: Creates valid embed with version
- ✅ `TestSectionEmbed_LiveContent`: Fetches embedded content (now version-specific)
- ✅ `TestSectionEmbed_AccessCheck`: No access to private target

**Add New Test**:
```go
// Verify embed fetches snapshotted content, not current
func TestSectionEmbed_VersionSnapshot(t *testing.T) {
    // 1. Create document v1 with content "Original"
    // 2. Create embed referencing v1, lines 1-1
    // 3. Update document to v2 with content "Modified"
    // 4. Fetch embed content
    // 5. Assert: Should return "Original" (v1), not "Modified" (v2)
}
```

### Frontend Manual Testing

1. **Create Embed**:
   - Open doc A, copy line link (should include version)
   - Paste in doc B
   - Save → should create embed record
   - Refresh → embed should render with content

2. **Version Staleness**:
   - Edit doc A again (create v2)
   - Check doc B embed → should show staleness warning
   - Check doc A citations panel → should show "cited at v1, current v2"

3. **Citation Panel**:
   - Open doc A (target)
   - Click "Citations" button
   - Should show list of documents citing doc A
   - Click citation → should navigate to citing document with line highlight

---

## Future Enhancements

### "Update to Latest" Button

**Status**: Documented in research.md, not yet implemented

**Design**:
- Show button on stale embeds: "Update to latest version"
- Calls new RPC: `UpdateEmbed(embedId, newVersionNumber)`
- Updates `target_version_number` in `section_embed` table
- Triggers re-render with new content

**Implementation Requirement**:
- New RPC endpoint: `SectionEmbedService.UpdateEmbed`
- SQL query: `UPDATE section_embed SET target_version_number = $1 WHERE id = $2`
- Frontend button in `EmbeddedSection.tsx` (conditional on `isStale`)

---

## References

- **Constitution**: `.specify/memory/constitution.md` - Principle VIII (Cross-Stack Constant Synchronization)
- **Research**: `specs/016-docs-sys-basic-implementation/research.md` - Design decisions
- **Data Model**: `specs/016-docs-sys-basic-implementation/data-model.md` - Schema definitions
- **Tasks**: `specs/016-docs-sys-basic-implementation/tasks.md` - Implementation checklist (T061, T061a)
