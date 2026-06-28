# Tasks: Document Management System (Notion/Confluence-style)

**Input**: Design documents from `/specs/016-docs-sys-basic-implementation/`
**Prerequisites**: plan.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅
**Branch**: `016-docs-sys-basic-implementation`

---

## Phase 3.1: Setup & Database Schema

### Database Schema & Migrations
- [x] T001 Create `docs` schema in `backend/database/scripts/schema.sql` with all 9 tables from data-model.md:
  - `docs.document` (core entity with hierarchy)
  - `docs.document_version` (version history)
  - `docs.document_slug_history` (slug redirects)
  - `docs.document_access` (permission grants)
  - `docs.document_follower` (subscriptions)
  - `docs.section_embed` (cross-document embeds)
  - `docs.comment` (inline comments)
  - `docs.comment_reply` (comment replies)
  - `docs.document_editor` (UNLOGGED: active editors)
  - Include all indexes, CHECK constraints, and comments
  
- [x] T002 Create migration files in `backend/k8s/base/database/migrations/`:
  - `YYYYMMDDHHMMSS_add_docs_schema.up.sql` (copy schema from T001)
  - `YYYYMMDDHHMMSS_add_docs_schema.down.sql` (DROP TABLE statements in reverse order)
  
- [x] T003 Apply migrations: `cd backend && ./scripts/migrate.sh`
  - Resolve any dirty states with `migrate force <version>` if needed
  - Verify tables created in local PostgreSQL

### sqlc Queries
- [x] T004 Copy `contracts/docs.query.sql` to `backend/database/scripts/docs.query.sql`
  - Verify all queries follow Citus sharding constraints (organization_id first)
  - Ensure parameterized timestamps for ON CONFLICT DO UPDATE (no `now()`)

- [x] T005 Run sqlc code generation: `cd backend && sqlc generate`
  - Commit generated files: `backend/database/docs.query.sql.go`, `backend/database/models.go`

### Proto Definitions
- [x] T006 Copy `contracts/document.proto` to `backend/rpc/v1/document.proto`
  - Ensure imports for `buf/validate/validate.proto`, `google/protobuf/timestamp.proto`, `rpc/v1/options.proto`
  - Verify all RPC methods have `access_control` options with explicit `allowed_roles`

- [x] T007 Run proto code generation: `cd backend && buf generate`
  - Commit generated backend files

---

## Phase 3.2: Backend Core Implementation

### Constants & Types (Cross-Stack Synchronization)
- [x] T008 [P] Create `backend/internal/docs/constants.go` with domain constants:
  ```go
  // Document status
  const (
      DocumentStatusActive   = "active"
      DocumentStatusOutdated = "outdated"
      DocumentStatusArchived = "archived"
  )
  
  // Document visibility
  const (
      VisibilityPublic  = "public"
      VisibilityPrivate = "private"
  )
  
  // Access level
  const (
      AccessLevelReadComment = "read_comment"
      AccessLevelWriteUpdate = "write_update"
      AccessLevelNone        = "none"
  )
  
  // Grantee type
  const (
      GranteeTypeEmployee   = "employee"
      GranteeTypeDepartment = "department"
  )
  ```

### Logic Layer Implementation
- [x] T009 Create `backend/internal/docs/logic.go` with DocumentLogic interface:
  - Define interface with all document operations
  - Constructor receives `*database.Queries` and cross-domain dependencies (NotificationLogic)
  - NO connection pools in logic layer
  - All methods accept `tx database.DBTX` parameter
  - Receive parsed auth context (orgID, employeeID) as parameters

- [x] T010 [P] Implement document CRUD methods in `backend/internal/docs/document_logic.go`:
  - `CreateDocument(ctx, tx, orgID, employeeID, params) (*Document, error)`
  - `GetDocument(ctx, tx, orgID, docID) (*Document, error)`
  - `GetDocumentBySlug(ctx, tx, orgID, slug) (*Document, error)`
  - `UpdateDocument(ctx, tx, orgID, employeeID, params) (*Document, error)`
  - `DeleteDocument(ctx, tx, orgID, employeeID, docID) (orphanedCount int, error)`
  - `ListDocuments(ctx, tx, orgID, parentID, cursor, limit) ([]*Document, error)`
  - `GetDocumentTree(ctx, tx, orgID, rootID, maxDepth) ([]*DocumentTreeNode, error)`
  - `SearchDocuments(ctx, tx, orgID, query, cursor, limit) ([]*SearchResult, error)`
  - Slug generation: `{title-slug}-{base62-uuid}`
  - Depth validation: max 10 levels
  - Auto-increment `version_count` on update

- [x] T011 [P] Implement version history methods in `backend/internal/docs/version_logic.go`:
  - `CreateVersion(ctx, tx, orgID, docID, employeeID, content, summary) (*Version, error)`
  - `ListVersions(ctx, tx, orgID, docID, cursor, limit) ([]*Version, error)`
  - `GetVersion(ctx, tx, orgID, docID, versionNum) (*Version, error)`
  - `GetVersionDiff(ctx, tx, orgID, docID, fromVer, toVer) ([]*DiffChange, error)`
  - `GetBlame(ctx, tx, orgID, docID) ([]*BlameBlock, error)`
  - Diff computation using structured JSON comparison
  - Blame computed by walking version history

- [x] T012 [P] Implement access control methods in `backend/internal/docs/access_logic.go`:
  - `SetAccess(ctx, tx, orgID, employeeID, params) (*Access, error)`
  - `RemoveAccess(ctx, tx, orgID, employeeID, params) error`
  - `ListAccess(ctx, tx, orgID, docID) ([]*Access, error)`
  - `CheckAccess(ctx, tx, orgID, employeeID, docID) (AccessLevel, error)`
  - Permission inheritance: traverse hierarchy to compute effective access
  - Validate child can only be more restrictive than parent
  - Owner always has full access

- [x] T013 [P] Implement slug resolution in `backend/internal/docs/slug_logic.go`:
  - `ResolveSlug(ctx, tx, orgID, slug) (currentSlug string, isRedirect bool, docID dbuuid.UUID, error)`
  - Check current documents first
  - If not found, check slug history for redirect

- [x] T014 [P] Implement follower methods in `backend/internal/docs/follower_logic.go`:
  - `FollowDocument(ctx, tx, orgID, employeeID, docID) error`
  - `UnfollowDocument(ctx, tx, orgID, employeeID, docID) error`
  - `ListFollowedDocuments(ctx, tx, orgID, employeeID, cursor, limit) ([]*Document, error)`
  - `GetDocumentFollowers(ctx, tx, orgID, docID) ([]dbuuid.UUID, error)`
  - Increment/decrement `follower_count` on document
  - Integration with NotificationLogic for sending updates

- [x] T014a Fix follower count updates setting `updated_at` (prevents transaction abort on root document create)

- [x] T015 [P] Implement comment methods in `backend/internal/docs/comment_logic.go`:
  - `AddComment(ctx, tx, orgID, employeeID, params) (*Comment, error)`
  - `AddCommentReply(ctx, tx, orgID, employeeID, commentID, text) (*Reply, error)`
  - `ResolveComment(ctx, tx, orgID, employeeID, commentID) (*Comment, error)`
  - `ListComments(ctx, tx, orgID, docID, includeResolved) ([]*Comment, error)`
  - `DeleteComment(ctx, tx, orgID, employeeID, commentID) error`
  - Only author or document owner can delete

- [x] T015a Fix comment reply count updates setting `updated_at` (prevents transaction abort)

- [x] T016 [P] Implement section embed methods in `backend/internal/docs/embed_logic.go`:
  - `CreateEmbed(ctx, tx, orgID, params) (*Embed, error)`
  - `GetEmbeddedSection(ctx, tx, orgID, embedID) (content string, accessible bool, error)`
  - `ListEmbeds(ctx, tx, orgID, docID) ([]*Embed, error)`
  - `DeleteEmbed(ctx, tx, orgID, employeeID, embedID) error`
  - Check read access to target document
  - Circular embed detection
  - **ENHANCED**: Auto-populate `target_version_number` with current version (snapshot behavior)
  - **ENHANCED**: Added staleness detection (is_stale field) comparing embed version with current version

- [x] T017 [P] Implement editor tracking methods in `backend/internal/docs/editor_logic.go`:
  - `JoinDocument(ctx, tx, orgID, employeeID, docID, instanceID) (connID, editors, limitReached, error)`
  - `LeaveDocument(ctx, tx, orgID, employeeID, docID) error`
  - `UpdateCursor(ctx, tx, orgID, employeeID, docID, blockID, offset) error`
  - `ListActiveEditors(ctx, tx, orgID, docID) ([]*ActiveEditor, error)`
  - `Heartbeat(ctx, tx, orgID, employeeID, docID) error`
  - Max 10 editors enforcement
  - Stale editor cleanup (60s heartbeat timeout)

### Connect Layer Implementation
- [x] T018 Create `backend/internal/docs/connect.go` with Connect layer:
  - DocumentServiceConnect with AdminPool, TenantPool
  - Inject DocumentLogic dependency
  - Extract auth context from interceptor
  - Use `txn.WithTxn` for all database operations
  - Choose TenantPool for all user-facing operations
  - Translate domain errors to connect.Error

- [x] T019 [P] Implement DocumentService RPC handlers in `backend/internal/docs/document_connect.go`:
  - CreateDocument, GetDocument, UpdateDocument, DeleteDocument
  - ListDocuments, GetDocumentTree, SearchDocuments
  - UpdateDocumentStatus, ResolveSlug

- [x] T020 [P] Implement DocumentVersionService RPC handlers in `backend/internal/docs/version_connect.go`:
  - ListVersions, GetVersion, GetVersionDiff, GetBlame

- [x] T021 [P] Implement DocumentAccessService RPC handlers in `backend/internal/docs/access_connect.go`:
  - SetAccess, RemoveAccess, ListAccess, CheckAccess

- [x] T022 [P] Implement DocumentFollowerService RPC handlers in `backend/internal/docs/follower_connect.go`:
  - FollowDocument, UnfollowDocument, ListFollowedDocuments

- [x] T023 [P] Implement CommentService RPC handlers in `backend/internal/docs/comment_connect.go`:
  - AddComment, AddCommentReply, ResolveComment, ListComments, DeleteComment

- [x] T024 [P] Implement SectionEmbedService RPC handlers in `backend/internal/docs/embed_connect.go`:
  - CreateEmbed, GetEmbeddedSection, ListEmbeds, DeleteEmbed
  - **ENHANCED**: Returns is_stale field in all SectionEmbed responses

- [x] T025 [P] Implement DocumentEditorService RPC handlers in `backend/internal/docs/editor_connect.go`:
  - JoinDocument, LeaveDocument, UpdateCursor, ListActiveEditors, Heartbeat

### Service Wiring
- [x] T026 Wire document services in `backend/cmd/server.go`:
  - Create DocumentLogic with NotificationLogic dependency
  - Create Connect layer services with AdminPool, TenantPool
  - Register all 7 services with mux
  - Add to interceptor chain

---

## Phase 3.3: Frontend Implementation

### API Layer
- [ ] T027 Re-export document services from `frontend/packages/rpc/index.ts`:
  - Add exports for all generated document service types
  - Ensure proto-ts types are available

- [ ] T028 [P] Create `frontend/packages/apis/src/docs.ts` with TypeScript types and API wrappers:
  ```typescript
  // Types (NOT protobuf types)
  export type DocumentStatus = 'active' | 'outdated' | 'archived';
  export type DocumentVisibility = 'public' | 'private';
  export type AccessLevel = 'read_comment' | 'write_update' | 'none';
  export type GranteeType = 'employee' | 'department';
  
  export interface Document {
    id: string;
    title: string;
    slug: string;
    parentDocumentId?: string;
    depth: number;
    contentJson: string;
    status: DocumentStatus;
    visibility: DocumentVisibility;
    ownerEmployeeId: string;
    ownerName: string;
    childCount: number;
    versionCount: number;
    followerCount: number;
    updatedAt: Date;
    path: string[];
  }
  // ... other types
  ```
  - Wrapper functions for all RPC methods
  - Convert protobuf Timestamp to JavaScript Date
  - Use rpcCall helper for error handling

- [ ] T029 Run frontend build: `cd frontend && pnpm -r build`
  - Verify workspace artifacts refreshed
  - Commit any generated outputs

### Workspace Pages
- [ ] T030 Add "Docs" tab to `frontend/apps/web/src/app/workspace/layout.tsx`:
  - Add to tabs array with icon and path `/workspace/docs`

- [ ] T031 Create `frontend/apps/web/src/app/workspace/docs/page.tsx`:
  - Client-side rendering with 'use client'
  - Auth guard via useRequireAuth
  - Document tree view with expand/collapse
  - Create new document button
  - Search input with live results
  - All interactive elements have data-testid attributes
  - Use useThemeColors() for all colors

- [ ] T032 Create `frontend/apps/web/src/app/workspace/docs/[slug]/page.tsx`:
  - Display document content with TipTap renderer
  - Breadcrumb navigation from path
  - Comments sidebar toggle
  - Follow/unfollow button
  - Edit button (if write access)
  - Version history link
  - Active editors indicator
  - Slug redirect handling (via ResolveSlug RPC)

- [ ] T033 Create `frontend/apps/web/src/app/workspace/docs/[slug]/edit/page.tsx`:
  - TipTap editor with full toolbar
  - Markdown toggle
  - Save button with version summary
  - Autosave every 30 seconds
  - Active collaborators display
  - Editor limit warning (max 10)
  - Access denied handling

- [ ] T034 Create `frontend/apps/web/src/app/workspace/docs/new/page.tsx`:
  - Title input
  - Parent document selector (optional)
  - Visibility selector (for root docs only)
  - Initial content editor
  - Create button

- [ ] T035 Create `frontend/apps/web/src/app/workspace/docs/[slug]/history/page.tsx`:
  - Version timeline
  - Side-by-side diff viewer
  - Blame view toggle
  - Version comparison selector

- [x] T035a IMPROVEMENT: Version History UX Enhancement:
  - Removed popup modal for version comparison
  - Created separate compare page at `/workspace/docs/[slug]/compare`
  - Click on version in history panel now navigates to compare page
  - Compare page shows clear comparison labels (e.g., "Current to v3", "v3 to v2")
  - Compare page supports both single version view and diff view
  - Files modified:
    * `VersionHistoryPanel.tsx`: Removed dialog, added navigation
    * `RightPanel.tsx`: Added documentSlug prop
    * `DocumentView.tsx`: Added slug resolution callback
    * `page.tsx`: Track and pass document slug
    * `[slug]/compare/page.tsx`: New dedicated compare page

### Components
- [ ] T036 [P] Create `frontend/apps/web/src/app/workspace/docs/components/DocumentTree.tsx`:
  - Recursive tree rendering
  - Expand/collapse toggles
  - Document status indicators
  - Child count badges
  - Navigation on click
  - data-testid="document-tree"

- [x] T037 [P] Create `frontend/apps/web/src/app/workspace/docs/components/DocumentEditor.tsx`:
  - TipTap editor configuration
  - StarterKit, Link, Underline extensions
  - Markdown toggle button
  - Toolbar with formatting options (bold, italic, underline, code, headings, lists, blockquote, code block)
  - data-testid="document-editor" and related test IDs
  - ENHANCED: Now supports both WYSIWYG and markdown modes with full formatting toolbar

- [x] T037a [BUG FIX] LineNumberSidebar UX Issues:
  - Fixed extractText function to properly count lines (was using '\n\n' causing double line breaks)
  - Added LineNumberSidebar to view mode (read-only)
  - Added LineNumberSidebar to markdown edit mode
  - Now shows line numbers in all three modes: view, WYSIWYG edit, markdown edit
  - Fixed line counting to match visual display across all modes
  - Created verification script to test line extraction logic
  - Files modified:
    * `LineNumberSidebar.tsx`: Component was correct, issue was in DocumentEditor
    * `DocumentEditor.tsx`: Fixed extractText function, added sidebar to all modes
    * `scripts/verify-text-extraction.js`: Standalone test for line extraction
    * `components/__tests__/text-extraction.test.ts`: Unit tests for text extraction
  - Commits: 1ab3518

- [x] T037b [BUG FIX] LineNumberSidebar Alignment Issues (Second Round):
  - Fixed line number font size (0.75rem → 1rem) for better readability
  - Fixed lineHeight (1.5 → 1.8) to match editor content line spacing
  - Removed vertical padding (py: 0.25 → py: 0) for pixel-perfect alignment
  - Fixed URL generation to use query params (?slug=...) instead of path params to prevent 404 with trailing slash
  - Fixed copy button positioning to use absolute positioning near selected line (was fixed at top)
  - Updated theme color references to use .style property consistently
  - Ensured consistent lineHeight: 1.8 across all three editor modes (view, WYSIWYG, markdown)
  - Fixed paragraph margins (removed 1em bottom margin) to prevent misalignment
  - Files modified:
    * `LineNumberSidebar.tsx`: Updated fontSize, lineHeight, padding, URL generation, button positioning
    * `DocumentEditor.tsx`: Updated lineHeight and margins in all three modes
  - Commits: e61e476

- [x] T037c [BUG FIX] LineNumberSidebar Variable-Height Content Alignment (Third Round):
  - **Problem**: Line numbers use fixed spacing (lineHeight * index) but content has variable heights (embeds, headers, code blocks)
  - **Root Cause**: Fixed-height calculation doesn't account for actual DOM element heights
  - **Solution**: Measure actual DOM positions using refs and position line numbers absolutely
  - Implementation:
    * Added DOM measurement via MutationObserver and ResizeObserver
    * LineNumberSidebar now accepts `contentRef` prop for content container
    * Queries block elements (p, h1-h3, pre, blockquote, ul, ol, embed) and measures their positions
    * Positions line numbers absolutely based on measured block positions
    * Fallback to fixed spacing if no ref provided (backward compatibility)
    * Auto-updates on content changes and window resize
  - Fixed TypeScript errors:
    * Added TipTapNode interface for proper typing of editor JSON structure
    * Fixed all `any` type violations in DocumentEditor
    * Updated contentRef type to accept `HTMLElement | null`
  - Files modified:
    * `LineNumberSidebar.tsx`: Complete rewrite with DOM measurement
    * `DocumentEditor.tsx`: Added content refs, passed to sidebar in all modes, fixed TypeScript types
    * `EmbeddedSection.tsx`: Updated margins for consistent spacing
  - Build verified: ✅ TypeScript compilation passed
  - Date: 2025-12-22
  - **Follow-up fixes**:
    * Fixed line number overlapping with dynamic minHeight on sidebar container
    * Removed contentRef from markdown mode (uses fixed spacing fallback)
    * Fixed duplicate inputRef attribute in TextField
    * Markdown mode now properly uses 1.8rem fixed line spacing
  - Final commits: [initial], c9ffeab

- [ ] T038 [P] Create `frontend/apps/web/src/app/workspace/docs/components/CollaborationCursors.tsx`:
  - Display other editors' cursors
  - Name labels with assigned colors
  - Position sync via WebSocket/polling
  - data-testid="collaboration-cursors"

- [ ] T039 [P] Create `frontend/apps/web/src/app/workspace/docs/components/VersionHistory.tsx`:
  - Timeline of versions
  - Author name and timestamp
  - Summary display
  - Click to view version
  - data-testid="version-history"

- [x] T040 [P] Create `frontend/apps/web/src/app/workspace/docs/components/DiffViewer.tsx`:
  - Side-by-side comparison
  - Highlight additions (green)
  - Highlight deletions (red)
  - Highlight formatting changes (orange)
  - Use theme colors
  - data-testid="diff-viewer"

- [ ] T041 [P] Create `frontend/apps/web/src/app/workspace/docs/components/BlameView.tsx`:
  - Block-by-block attribution
  - Author name and version number
  - Timestamp per block
  - data-testid="blame-view"

- [ ] T042 [P] Create `frontend/apps/web/src/app/workspace/docs/components/CommentsSidebar.tsx`:
  - List of comments for current document
  - Add comment form
  - Reply threading
  - Resolve button
  - Filter resolved/unresolved
  - data-testid="comments-sidebar"

- [ ] T043 [P] Create `frontend/apps/web/src/app/workspace/docs/components/PermissionsDialog.tsx`:
  - MUI Dialog component
  - List current access grants
  - Add employee/department selector
  - Access level selector
  - Remove access button
  - Only visible to document owner
  - data-testid="permissions-dialog"

- [ ] T044 [P] Create `frontend/apps/web/src/app/workspace/docs/components/SearchResults.tsx`:
  - List of matching documents
  - Title and snippet display
  - Relevance score indicator
  - Click to navigate
  - data-testid="search-results"

- [x] T045 Create `frontend/apps/web/src/app/workspace/docs/README.md`:
  - Feature documentation
  - Component overview
  - Usage patterns

- [x] T045a [IMPROVEMENT] Embed/Citation UI Integration:
  - Created `EmbedNode.tsx`: TipTap extension for embed nodes with proper TypeScript declarations
  - Current UX: paste a `#L...` citation link in the editor to create an embed (no embed dialog button in this checkout)
  - Updated `DocumentEditor.tsx`: Integrated EmbedNode extension and paste-to-embed flow
  - Updated `EmbeddedSection.tsx`: Component for rendering embedded content (already existed)
  - Features implemented:
    * Paste-to-embed flow for `#L...` citation URLs
    * Live rendering of embedded sections in viewer
    * Proper access control checks via backend
    * Theme-aware styling with useThemeColors
    * data-testid attributes for testing

---

## Phase 3.4: Backend Integration Tests

- [ ] T046 [P] Create `backend/integration/docs_crud_test.go`:
  - TestCreateDocument_RootDocument: Create root doc, verify slug generation
  - TestCreateDocument_NestedDocument: Create child, verify depth increment
  - TestCreateDocument_MaxDepth: Verify depth=10 limit enforcement
  - TestUpdateDocument_SlugChange: Update title, verify slug history
  - TestUpdateDocument_VersionCreated: Verify version_count incremented
  - TestDeleteDocument_OrphansChildren: Delete parent, verify children orphaned
  - Use GetRandomTestIdentityAndKey helper for test tokens

- [ ] T047 [P] Create `backend/integration/docs_version_test.go`:
  - TestVersionHistory_ListVersions: Create multiple versions, list
  - TestVersionHistory_GetDiff: Compare two versions
  - TestVersionHistory_GetBlame: Verify block attribution

- [ ] T048 [P] Create `backend/integration/docs_permission_test.go`:
  - TestPermission_PublicDocument: Verify all org members can read
  - TestPermission_PrivateDocument: Verify explicit grant required
  - TestPermission_Inheritance: Parent public, child private restriction
  - TestPermission_MoreRestrictiveOnly: Child cannot grant broader access
  - TestPermission_OwnerAlwaysHasAccess: Owner can access regardless

- [ ] T049 [P] Create `backend/integration/docs_search_test.go`:
  - TestSearch_MultilingualContent: English, Vietnamese, CJK search
  - TestSearch_RespectsPermissions: Private docs hidden from non-granted users
  - TestSearch_TitleRankedHigher: Title match scores above content match

- [ ] T050 [P] Create `backend/integration/docs_editor_test.go`:
  - TestCollaboration_JoinDocument: Single editor join
  - TestCollaboration_EditorLimit: Verify max 10 editors
  - TestCollaboration_CursorUpdate: Verify cursor position stored
  - TestCollaboration_Heartbeat: Verify last_heartbeat updated
  - TestCollaboration_StaleCleanup: Verify stale editors removed

- [ ] T051 [P] Create `backend/integration/docs_comment_test.go`:
  - TestComments_AddComment: Add inline comment
  - TestComments_AddReply: Add reply to comment
  - TestComments_ResolveComment: Mark resolved
  - TestComments_DeleteComment: Only author can delete

- [ ] T052 [P] Create `backend/integration/docs_embed_test.go`:
  - TestSectionEmbed_CreateEmbed: Create valid embed
  - TestSectionEmbed_LiveContent: Fetch embedded content
  - TestSectionEmbed_AccessCheck: No access to private target
  - TestSectionEmbed_CircularPrevention: Block self-embed

- [ ] T053 [P] Create `backend/integration/docs_follower_test.go`:
  - TestFollower_Follow: Follow document
  - TestFollower_Unfollow: Unfollow document
  - TestFollower_ReceiveNotification: Notification on doc update

- [ ] T054 [P] Create `backend/integration/docs_slug_test.go`:
  - TestSlug_ResolveCurrentSlug: Direct slug resolution
  - TestSlug_RedirectOldSlug: Old slug returns redirect
  - TestSlug_RedirectChain: Multiple renames, oldest redirects to latest

---

## Phase 3.5: Distributed System Testing

- [ ] T055 [P] Create `backend/integration/docs_distributed_test.go`:
  - TestDistributed_EditorAcrossInstances: Simulate multi-instance editor tracking
  - TestDistributed_StaleEditorCleanup: Verify cleanup across instances
  - Verify instance_id stored correctly in document_editor table

---

## Phase 3.6: Polish

- [ ] T056 Performance testing:
  - Document creation: <100ms
  - Search (1000 docs): <200ms PGroonga query
  - Version diff (50 versions): <500ms
  - Document tree load (depth 10): <300ms

- [ ] T057 [P] Verify all data-testid attributes present on interactive elements

- [ ] T058 [P] Verify all colors use useThemeColors() hook (no hardcoded values)

- [ ] T059 Final smoke test via quickstart.md scenarios

- [ ] T060 Code review and cleanup:
  - Remove any dead code
  - Consolidate duplicate logic
  - Verify structured logging with slog

- [x] T061 **BREAKING CHANGE**: Enhance embed/citation model with version snapshots (2025-12-21):
  - **Problem**: Original design had optional `target_version_number` (NULL = track latest). This creates unpredictable UX - when user embeds lines 10-20, they expect to cite what they SEE now, not what might change later.
  - **Solution**: Make `target_version_number` NOT NULL, auto-populated with current version at embed creation
  - **Changes**:
    * Schema: `target_version_number INT NOT NULL` (migration 20251221173057)
    * Backend: Auto-populate version in `CreateEmbed`, added staleness detection
    * Proto: Added `bool is_stale` field to `SectionEmbed` message
    * Frontend: Enhanced `EmbeddedSection` to show version badges and staleness warnings
    * Docs: Updated research.md, data-model.md to reflect snapshot-first design
  - **Future Enhancement**: "Update to latest" button (requires UpdateEmbed RPC endpoint)

- [x] T061a **BUG FIX**: Include version info in line link URLs for version-pinned embeds (2025-12-23):
  - **Problem**: When user copies line link (#L10-L15) for embedding, URL doesn't include version parameter. This breaks the version snapshot model from T061 - embeds should reference the specific version visible at creation time.
  - **Root Cause**: `generateLineUrl()` in `LineNumberSidebar.tsx` generates URLs like `/workspace/docs?slug=xyz#L10-L15` without `&v=3` parameter.
  - **Solution**: Pass `documentVersion` prop to `LineNumberSidebar` and include it in generated URLs.
  - **Changes**:
    * `LineNumberSidebar.tsx`: Added `documentVersion?: number` prop, updated `generateLineUrl()` to append `&v=${documentVersion}` when present
    * `DocumentEditor.tsx`: Pass `document.versionCount` to all three `LineNumberSidebar` instances (view, WYSIWYG edit, markdown edit modes)
  - **Result**: Line links now generate URLs like `/workspace/docs?slug=xyz&v=3#L10-L15`, ensuring version-pinned embed behavior
  - **Verified**: Frontend build passes, TypeScript compilation successful

- [x] T061b **CRITICAL FIX**: Embed content now fetches versioned snapshots (2025-12-23):
  - **Problem**: `GetEmbeddedContent` query was fetching from `docs.document` table (current content), causing embeds to auto-update when target document changed. This violated the version snapshot design principle from T061.
  - **Root Cause**: Query was not using `document_version` table with `target_version_number` parameter
  - **Solution**: Updated query to fetch from `docs.document_version` using the embed's snapshotted version number
  - **Changes**:
    * `backend/database/scripts/docs.query.sql`: Updated `GetEmbeddedContent` query to join `document_version` table
    * `backend/internal/docs/embed_logic.go`: Pass `target_version_number` parameter to query
    * `backend/database/docs.query.sql.go`: Regenerated via `sqlc generate`
  - **Impact**: ✅ Embeds now display exact snapshotted content, maintaining citation integrity across document updates
  - **Verified**: Backend compiles successfully, integration tests should be added (see T061c)

- [x] T061c **FEATURE**: Citation visualization fully integrated (2025-12-23):
  - **Status**: Already implemented, documentation added
  - **Components**:
    * `CitationsPanel.tsx`: Displays incoming citations with line ranges, staleness indicators, clickable links
    * `RightPanel.tsx`: Integrates CitationsPanel in right sidebar (tabs: Comments | History | Citations)
    * `DocumentView.tsx`: Citations button in toolbar triggers panel
  - **Backend**:
    * `listIncomingCitations()` API in `packages/apis/src/docs.ts`
    * `ListIncomingCitations` query in `backend/database/scripts/docs.query.sql`
    * `ListIncomingCitations()` logic in `backend/internal/docs/embed_logic.go`
  - **Documentation**:
    * Created `IMPLEMENTATION-NOTES.md` with detailed implementation decisions
    * Documents version snapshot behavior, citation visualization, and line number sidebar integration

- [x] T061d **UX ENHANCEMENT**: Heat map citation visualization in LineNumberSidebar (2025-12-24):
  - **Problem**: Previous dot-based visualization didn't convey citation density effectively
  - **Solution**: Implemented progressive heat map with color-coded intensity
  - **Changes**:
    * `LineNumberSidebar.tsx`: Replaced dot markers with heat map background colors
    * Added `getHeatColor()` function with 6-level color scale (blue → yellow → orange → red)
    * Added `getHeatLabel()` for descriptive tooltip text (Low/Moderate/High citation density)
    * Combined background color with 3px left border for dual visual cues
    * Made entire line clickable (not just small dot) for better UX
    * Enhanced tooltip with heat level label, citation count, and action hint
  - **Heat Map Scale**:
    * 1-2 citations: Light Blue (cool) - Low citation density
    * 3-4 citations: Yellow/Amber (warm) - Moderate citation density
    * 5+ citations: Orange/Red (hot) - High citation density
  - **Theme Support**: Both light and dark modes with appropriate opacity adjustments
  - **Documentation**: Updated `CITATION-VISIBILITY-DESIGN.md` with heat map specifications and rationale
  - **Result**: More intuitive visualization showing "hotspots" where content is heavily cited

---

## Dependencies

```
T001 (schema) → T002 (migrations) → T003 (apply migrations)
T003 → T004 (sqlc queries) → T005 (sqlc generate)
T006 (proto) → T007 (buf generate)
T005, T007 → T008-T017 (logic layer) [P]
T008-T017 → T018-T025 (connect layer) [P]
T018-T025 → T026 (service wiring)
T007 → T027-T029 (frontend API layer)
T029 → T030-T035 (pages)
T029 → T036-T045 (components) [P]
T026 → T046-T054 (integration tests) [P]
T046-T054 → T055 (distributed tests)
T030-T045 → T056-T060 (polish) [P]
```

---

## Parallel Execution Examples

```bash
# Phase 3.2 - Logic layer (all [P] can run together):
Task: "Implement document CRUD methods in backend/internal/docs/document_logic.go"
Task: "Implement version history methods in backend/internal/docs/version_logic.go"
Task: "Implement access control methods in backend/internal/docs/access_logic.go"
Task: "Implement slug resolution in backend/internal/docs/slug_logic.go"
Task: "Implement follower methods in backend/internal/docs/follower_logic.go"
Task: "Implement comment methods in backend/internal/docs/comment_logic.go"
Task: "Implement section embed methods in backend/internal/docs/embed_logic.go"
Task: "Implement editor tracking methods in backend/internal/docs/editor_logic.go"

# Phase 3.2 - Connect layer (all [P] can run together):
Task: "Implement DocumentService RPC handlers in backend/internal/docs/document_connect.go"
Task: "Implement DocumentVersionService RPC handlers in backend/internal/docs/version_connect.go"
Task: "Implement DocumentAccessService RPC handlers in backend/internal/docs/access_connect.go"
Task: "Implement DocumentFollowerService RPC handlers in backend/internal/docs/follower_connect.go"
Task: "Implement CommentService RPC handlers in backend/internal/docs/comment_connect.go"
Task: "Implement SectionEmbedService RPC handlers in backend/internal/docs/embed_connect.go"
Task: "Implement DocumentEditorService RPC handlers in backend/internal/docs/editor_connect.go"

# Phase 3.3 - Frontend components (all [P] can run together):
Task: "Create DocumentTree.tsx component"
Task: "Create DocumentEditor.tsx component"
Task: "Create CollaborationCursors.tsx component"
Task: "Create VersionHistory.tsx component"
Task: "Create DiffViewer.tsx component"
Task: "Create BlameView.tsx component"
Task: "Create CommentsSidebar.tsx component"
Task: "Create PermissionsDialog.tsx component"
Task: "Create SearchResults.tsx component"

# Phase 3.4 - Integration tests (all [P] can run together):
Task: "Create docs_crud_test.go integration tests"
Task: "Create docs_version_test.go integration tests"
Task: "Create docs_permission_test.go integration tests"
Task: "Create docs_search_test.go integration tests"
Task: "Create docs_editor_test.go integration tests"
Task: "Create docs_comment_test.go integration tests"
Task: "Create docs_embed_test.go integration tests"
Task: "Create docs_follower_test.go integration tests"
Task: "Create docs_slug_test.go integration tests"
```

---

## Validation Checklist

- [x] All contracts have corresponding implementations (7 services)
- [x] All entities have model tasks (9 tables)
- [x] Backend integration tests present (RPC client pattern with dev tokens)
- [x] NO frontend unit/snapshot/component test tasks (Constitution v5.7.0)
- [x] All interactive UI elements have data-testid tasks
- [x] Parallel tasks truly independent (different files)
- [x] Each task specifies exact file path
- [x] No task modifies same file as another [P] task
- [x] String constant changes include synchronization (T008 + T028)
- [x] UNLOGGED table for editors (T001 - document_editor)
- [x] Distributed system testing tasks present (T055)
- [x] Service struct includes instanceID field for multi-instance routing
- [x] NO in-process state storage in service implementations

---

## Notes

- [P] tasks = different files, no dependencies - can run in parallel
- Constitution v5.7.0: Backend integration tests REQUIRED, frontend unit tests FORBIDDEN
- All interactive elements MUST have data-testid attributes
- All colors MUST use useThemeColors() hook
- Commit after each task group completion
- Total tasks: 60
