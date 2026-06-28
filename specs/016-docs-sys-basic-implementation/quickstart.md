# Document Management System - Quick Start Test Scenarios

> Test scenarios derived from FR requirements in spec.md
> Run integration tests via: `cd backend && go test -v ./integration/docs_*_test.go`

## Prerequisites

1. Backend running locally: `cd backend && go run cmd/*.go`
2. Test organization and employees seeded (via organization_onboarding)
3. Frontend dev server: `cd frontend && pnpm dev`

---

## Core Document CRUD (FR-001 to FR-006)

### Scenario 1: Create Root Document

```bash
# Using test JWT for employee role
TOKEN=$(./scripts/dev-jwt.sh employee)

# Create root document
grpcurl -H "Authorization: Bearer $TOKEN" \
  -d '{"title": "Company Handbook", "content_json": "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Welcome to our company!\"}]}]}", "visibility": "DOCUMENT_VISIBILITY_PUBLIC"}' \
  localhost:18080 rpc.v1.DocumentService/CreateDocument
```

**Expected**: Document created with auto-generated slug `company-handbook`, depth=0

### Scenario 2: Create Nested Document (max depth 10)

```bash
# Create child document
grpcurl -H "Authorization: Bearer $TOKEN" \
  -d '{"title": "Onboarding Guide", "parent_document_id": "<parent-uuid>", "content_json": "{}"}' \
  localhost:18080 rpc.v1.DocumentService/CreateDocument
```

**Expected**: Child document created with depth=1, inherits parent visibility

### Scenario 3: Update Document Title (slug change)

```bash
grpcurl -H "Authorization: Bearer $TOKEN" \
  -d '{"id": "<doc-uuid>", "title": "Employee Handbook", "content_json": "...", "version_summary": "Renamed for clarity"}' \
  localhost:18080 rpc.v1.DocumentService/UpdateDocument
```

**Expected**: 
- Slug changed to `employee-handbook`
- Old slug `company-handbook` redirects to new slug
- New version created (version_number incremented)

---

## Version History (FR-007 to FR-012)

### Scenario 4: View Version History

```bash
grpcurl -H "Authorization: Bearer $TOKEN" \
  -d '{"document_id": "<doc-uuid>", "limit": 10}' \
  localhost:18080 rpc.v1.DocumentVersionService/ListVersions
```

**Expected**: List of versions with author names and summaries

### Scenario 5: Compare Versions (Diff)

```bash
grpcurl -H "Authorization: Bearer $TOKEN" \
  -d '{"document_id": "<doc-uuid>", "from_version": 1, "to_version": 3}' \
  localhost:18080 rpc.v1.DocumentVersionService/GetVersionDiff
```

**Expected**: Array of DiffChange with add/remove/unchanged markers

### Scenario 6: Git Blame Style Attribution

```bash
grpcurl -H "Authorization: Bearer $TOKEN" \
  -d '{"document_id": "<doc-uuid>"}' \
  localhost:18080 rpc.v1.DocumentVersionService/GetBlame
```

**Expected**: Block-by-block attribution showing author and version for each block

---

## Section Linking & Embedding (FR-013 to FR-018)

### Scenario 7: Link to Section

```
In TipTap editor, user types: [[Company Handbook#benefits
Frontend displays: Link to "Benefits" section in Company Handbook
```

**Expected**: `#block-uuid` anchor link generated, navigates to section

### Scenario 8: Embed Section from Another Document

```bash
grpcurl -H "Authorization: Bearer $TOKEN" \
  -d '{"source_document_id": "<current-doc>", "source_block_id": "<embed-node>", "target_document_id": "<other-doc>", "target_start_block_id": "<start>", "target_end_block_id": "<end>"}' \
  localhost:18080 rpc.v1.SectionEmbedService/CreateEmbed
```

**Expected**: Embed created, renders live content from target document

### Scenario 9: Embedded Content Updates When Source Changes

```
1. Edit target document section
2. View source document with embed
```

**Expected**: Embedded section shows updated content immediately

---

## Permission System (FR-019 to FR-025)

### Scenario 10: Set Document Access

```bash
# Grant write access to specific employee
grpcurl -H "Authorization: Bearer $TOKEN" \
  -d '{"document_id": "<doc-uuid>", "grantee_type": "GRANTEE_TYPE_EMPLOYEE", "grantee_id": "<employee-uuid>", "access_level": "ACCESS_LEVEL_WRITE_UPDATE"}' \
  localhost:18080 rpc.v1.DocumentAccessService/SetAccess
```

**Expected**: Access grant created, employee can now edit

### Scenario 11: Permission Inheritance (Children More Restrictive)

```
1. Parent document: visibility=public
2. Create child document
3. Try to set child visibility=public (should work)
4. Try to grant child access to user who doesn't have parent access (should fail)
```

**Expected**: Child can only have equal or more restrictive permissions

### Scenario 12: Check Computed Access

```bash
grpcurl -H "Authorization: Bearer $TOKEN" \
  -d '{"document_id": "<doc-uuid>"}' \
  localhost:18080 rpc.v1.DocumentAccessService/CheckAccess
```

**Expected**: Returns effective access level considering inheritance

---

## Full-Text Search (FR-026 to FR-030)

### Scenario 13: Multilingual Search

```bash
grpcurl -H "Authorization: Bearer $TOKEN" \
  -d '{"query": "employee benefits vacation", "limit": 20}' \
  localhost:18080 rpc.v1.DocumentService/SearchDocuments
```

**Expected**: 
- Results ranked by relevance (title matches higher)
- Snippets with highlighted keywords
- Works for English, Vietnamese, CJK

### Scenario 14: Search Respects Permissions

```
1. Create private document as User A
2. Search as User B (no access)
```

**Expected**: Private document not in User B's search results

---

## Real-Time Collaboration (FR-031 to FR-036)

### Scenario 15: Join Document (10 Editor Limit)

```bash
grpcurl -H "Authorization: Bearer $TOKEN" \
  -d '{"document_id": "<doc-uuid>"}' \
  localhost:18080 rpc.v1.DocumentEditorService/JoinDocument
```

**Expected**: 
- Success with connection_id and list of current editors
- If 10 editors already present: `editor_limit_reached: true`

### Scenario 16: Cursor Position Updates

```bash
grpcurl -H "Authorization: Bearer $TOKEN" \
  -d '{"document_id": "<doc-uuid>", "block_id": "<block-uuid>", "offset": 15}' \
  localhost:18080 rpc.v1.DocumentEditorService/UpdateCursor
```

**Expected**: Other editors see cursor position update via SSE

### Scenario 17: Merge Conflict Resolution

```
1. User A and User B edit same paragraph simultaneously
2. Both save
```

**Expected**: 
- Yjs CRDT merges changes automatically
- No data loss, both edits preserved
- UI shows "Changes merged" if needed

---

## Comments & Notifications (FR-037 to FR-042)

### Scenario 18: Add Inline Comment

```bash
grpcurl -H "Authorization: Bearer $TOKEN" \
  -d '{"document_id": "<doc-uuid>", "block_id": "<block-uuid>", "text_selection_start": 10, "text_selection_end": 25, "comment_text": "Should we update this policy?"}' \
  localhost:18080 rpc.v1.CommentService/AddComment
```

**Expected**: Comment created, linked to specific text selection

### Scenario 19: Follow Document for Notifications

```bash
grpcurl -H "Authorization: Bearer $TOKEN" \
  -d '{"document_id": "<doc-uuid>"}' \
  localhost:18080 rpc.v1.DocumentFollowerService/FollowDocument

# Edit document as another user
# Check SSE stream for notification
```

**Expected**: Follower receives notification via SSE when document updated

### Scenario 20: @Mention in Document

```
In TipTap editor, user types: @john.smith
Frontend shows autocomplete, selects user
```

**Expected**: Mentioned user receives notification even if not following

---

## Edge Cases

### Scenario 21: Slug Redirect Chain

```
1. Create document "Alpha" → slug: alpha
2. Rename to "Beta" → slug: beta (alpha redirects)
3. Rename to "Gamma" → slug: gamma (alpha and beta redirect)
4. Access /docs/alpha
```

**Expected**: Redirect to /docs/gamma (current slug)

### Scenario 22: Delete Document with Children

```bash
grpcurl -H "Authorization: Bearer $TOKEN" \
  -d '{"id": "<parent-doc-uuid>"}' \
  localhost:18080 rpc.v1.DocumentService/DeleteDocument
```

**Expected**: 
- Parent soft-deleted
- Children become orphaned (depth=0, no parent)
- Response includes `orphaned_children_count`

### Scenario 23: Stale Editor Cleanup

```
1. Join document as editor
2. Stop sending heartbeats for 60+ seconds
```

**Expected**: Editor removed from active list by cleanup job

---

## Frontend UI Verification

| Feature | URL | Expected Behavior |
|---------|-----|-------------------|
| Document list | `/docs` | Tree view with expand/collapse |
| Create document | `/docs/new` | TipTap editor, Markdown toggle |
| View document | `/docs/{slug}` | Rendered content, comments sidebar |
| Edit document | `/docs/{slug}/edit` | Live collaboration indicators |
| Version history | `/docs/{slug}/history` | Timeline with diff viewer |
| Search | `/docs?q=...` | Results with snippets |

---

## Performance Benchmarks

| Operation | Target | Measurement |
|-----------|--------|-------------|
| Create document | < 100ms | End-to-end RPC |
| Search (1000 docs) | < 200ms | PGroonga query time |
| Version diff | < 500ms | For 50 versions |
| Load document tree (depth 10) | < 300ms | Recursive CTE |
| Real-time cursor update | < 50ms | SSE delivery |

---

## Integration Test Coverage

```go
// backend/integration/docs_*_test.go
TestCreateDocument_RootDocument
TestCreateDocument_NestedDocument
TestCreateDocument_MaxDepth
TestUpdateDocument_SlugChange
TestUpdateDocument_VersionCreated
TestDeleteDocument_OrphansChildren
TestVersionHistory_ListVersions
TestVersionHistory_GetDiff
TestVersionHistory_GetBlame
TestSectionEmbed_CreateEmbed
TestSectionEmbed_LiveContent
TestPermission_Inheritance
TestPermission_MoreRestrictiveOnly
TestSearch_MultilingualContent
TestSearch_RespectsPermissions
TestCollaboration_JoinDocument
TestCollaboration_EditorLimit
TestCollaboration_CursorSync
TestComments_AddComment
TestComments_ResolveComment
TestFollower_ReceiveNotification
```
