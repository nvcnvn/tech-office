# Implementation Plan: Document Management System (Notion/Confluence-style)

**Branch**: `016-docs-sys-basic-implementation` | **Date**: 2025-01-15 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/016-docs-sys-basic-implementation/spec.md`

## Summary

Build a document management system similar to Notion or Confluence with:
- **Nested pages** (max 10 levels, 3 in URL display)
- **Slug-based permanent URLs** with redirect on rename
- **TipTap WYSIWYG editor** with Markdown toggle (already in use for chat)
- **Version history** with git blame style attribution
- **Section linking and embedding** across documents
- **Permission inheritance** (children can only be more restrictive)
- **Real-time collaborative editing** (max 10 concurrent editors, merge-based conflict resolution)
- **Comments, notifications, document following**
- **Full-text search** using PGroonga (existing infrastructure)

**Technical Approach**: Yjs CRDT for real-time collaboration, SSE for document notifications (leveraging existing notification hub), new `docs` schema with 9 tables, TipTap collaboration extensions for cursor awareness.

## Technical Context

**Project Type**: web (frontend + backend monorepo)  

**Frontend Stack**: 
- Language: TypeScript 5.x
- Framework: Next.js 15 (App Router)
- UI Library: Material-UI (MUI) v7
- Editor: TipTap (already installed: @tiptap/extension-code-block-lowlight, @tiptap/suggestion)
- CRDT: Yjs (new) + y-prosemirror (new) for collaborative editing
- Package Manager: pnpm workspace

**Backend Stack**:
- Language: Go 1.25+
- Database: PostgreSQL 18+ (multi-tenant, Citus distributed)
- ORM: sqlc (type-safe SQL code generation)
- RPC: Protocol Buffers + ConnectRPC
- Auth: Zitadel integration
- Search: PGroonga for multilingual full-text search

**Infrastructure**:
- Container: Docker
- Orchestration: Kubernetes
- Migration: golang-migrate (run via `backend/scripts/migrate.sh`)
- Real-time: SSE for notifications, WebSocket for Yjs CRDT sync (future)

**Performance Goals**: 
- Document load: <200ms 
- Search (1000 docs): <200ms
- Real-time cursor update: <50ms
- Version diff computation: <500ms for 50 versions

**Constraints**: 
- Multi-tenant isolation via `organization_id`
- Max 10 concurrent editors per document
- Max 10 nesting levels
- Children can only have equal or more restrictive permissions

## Constitution Check
*GATE: All checks verified against Constitution v5.7.0*

### Backend Service Architecture Checks
- [x] Service implements two-layer architecture: Logic layer + Connect layer
- [x] Logic layer has NO connection pools (only Queries and logic dependencies)
- [x] Logic layer methods accept `tx database.DBTX` parameter
- [x] Logic layer receives parsed auth context as parameters
- [x] Logic layer implements complex authorization (owner check, permission inheritance)
- [x] Connect layer owns AdminPool and TenantPool
- [x] Connect layer extracts auth context and passes to logic layer
- [x] Connect layer manages transactions using `txn.WithTxn`
- [x] Connect layer chooses TenantPool for user operations
- [x] Connect layer performs proto-level authorization verification
- [x] All tenant-data queries include `organization_id` filters
- [x] ALL RPC methods declare `access_control` options with explicit `allowed_roles`
- [x] NO role inheritance assumed - all roles listed explicitly

### Cross-Domain Integration Checks
- [x] Avoid SQL-level cross-schema access (notification uses existing hub)
- [x] Reuse existing notification hub logic for document notifications
- [x] Services depend on logic layer interfaces (NotificationLogic for sending updates)
- [x] Cross-domain calls use direct Go method invocations
- [x] User-scope calls pass request context preserving organization_id
- [x] Logic layer methods accept `tx database.DBTX` for cross-domain atomicity

### Frontend UI & Type Safety Checks
- [x] ALL RPC calls wrapped in typed functions in `packages/apis`
- [x] Custom TypeScript interfaces for Document, Version, Comment, etc.
- [x] Protobuf Timestamp converted to JavaScript Date
- [x] ALL interactive elements have `data-testid` attributes
- [x] ALL colors use `useThemeColors()` hook
- [x] Theme system ensures Dark/Light mode support

### Codegen & Generated-Client Checks
- [x] SQL changes → `cd backend && sqlc generate`
- [x] Proto changes → `cd backend && buf generate`
- [x] Frontend package re-export from `frontend/packages/rpc/index.ts`
- [x] Frontend build step: `pnpm -r build`

### Cross-Stack Constant & Type Synchronization Checks
- [x] Document status: CHECK constraint + Go constants + TypeScript type
- [x] Access level: CHECK constraint + Go constants + TypeScript type
- [x] Grantee type: CHECK constraint + Go constants + TypeScript type
- [x] All constants documented in table/column comments

### Distributed-First Architecture Checks
- [x] Backend logic is stateless
- [x] Active editors tracked in UNLOGGED table (like notification.active_connection)
- [x] UNLOGGED tables documented with data loss acceptance
- [x] Database queries are shard-aware (organization_id first)
- [x] SSE reconnection handles instance failures
- [x] No local file storage (files in R2 via existing files schema)

## Project Structure

### Documentation (this feature)
```
specs/016-docs-sys-basic-implementation/
├── plan.md              # This file ✅
├── research.md          # Phase 0 output ✅
├── data-model.md        # Phase 1 output ✅
├── quickstart.md        # Phase 1 output ✅
├── contracts/           # Phase 1 output ✅
│   ├── document.proto   # Proto definitions ✅
│   └── docs.query.sql   # sqlc queries ✅
└── tasks.md             # Phase 2 output (NOT created by /plan)
```

### Source Code (Tech Office Monorepo)

**Backend Structure**:
```
backend/
├── database/
│   ├── scripts/
│   │   ├── schema.sql          # [MODIFY] Add docs schema tables
│   │   └── docs.query.sql      # [ADD] sqlc queries for docs
│   ├── docs.query.sql.go       # [GENERATED by sqlc]
│   └── models.go               # [GENERATED by sqlc]
├── internal/
│   └── docs/                   # [ADD] New service package
│       ├── logic.go            # Logic layer (business logic)
│       ├── connect.go          # Connect layer (RPC handlers)
│       ├── constants.go        # Domain constants
│       ├── access.go           # Permission computation
│       └── version.go          # Version history & blame
├── rpc/
│   └── v1/
│       ├── document.proto      # [ADD] Proto definitions
│       └── document.pb.go      # [GENERATED from proto]
└── k8s/
    └── base/
        └── database/
            └── migrations/     # [ADD] Migration files
                ├── YYYYMMDDHHMMSS_add_docs_schema.up.sql
                └── YYYYMMDDHHMMSS_add_docs_schema.down.sql
```

Database Schemas Involved: `docs` (new), `organization` (reference), `notification` (integration)

**Frontend Structure**:
```
frontend/
├── apps/
│   └── web/
│       └── src/
│           └── app/
│               └── workspace/
│                   └── docs/               # [ADD] New business domain
│                       ├── page.tsx        # Document list/tree view
│                       ├── README.md       # Feature documentation
│                       ├── components/
│                       │   ├── DocumentTree.tsx
│                       │   ├── DocumentEditor.tsx
│                       │   ├── VersionHistory.tsx
│                       │   ├── CommentsSidebar.tsx
│                       │   └── PermissionsDialog.tsx
│                       ├── [slug]/
│                       │   ├── page.tsx    # View document
│                       │   └── edit/
│                       │       └── page.tsx # Edit document
│                       ├── new/
│                       │   └── page.tsx    # Create document
│                       └── search/
│                           └── page.tsx    # Search results
└── packages/
    ├── apis/
    │   └── src/
    │       └── docs.ts                     # [ADD] API client utilities
    └── rpc/                                # [GENERATED from backend protos]
```

## Phase 0: Research - Complete ✅

See [research.md](./research.md) for detailed findings on:
1. Real-time collaboration architecture (Yjs CRDT decision)
2. Version history implementation (full JSON snapshots)
3. Section linking via block IDs (TipTap UniqueId extension)
4. Permission inheritance (compute-at-read-time)
5. Notification hub integration (SSE for doc notifications, not CRDT)
6. PGroonga search with weighted scoring
7. URL slug management with redirect history
8. TipTap extension requirements

All NEEDS CLARIFICATION items resolved.

## Phase 1: Design & Contracts - Complete ✅

### Artifacts Created:

1. **[data-model.md](./data-model.md)**: Complete database schema with 9 tables:
   - `docs.document` - Core document entity with nested structure
   - `docs.document_version` - Full JSON snapshots for version history
   - `docs.document_slug_history` - Slug redirect tracking
   - `docs.document_access` - Per-document ACL grants
   - `docs.document_follower` - Subscription for notifications
   - `docs.section_embed` - Cross-document section embedding
   - `docs.comment` - Inline comments on document blocks
   - `docs.comment_reply` - Threaded comment replies
   - `docs.document_editor` - UNLOGGED table for active editor tracking

2. **[contracts/document.proto](./contracts/document.proto)**: Complete RPC definitions:
   - `DocumentService` - CRUD, tree, search, status
   - `DocumentVersionService` - History, diff, blame
   - `DocumentAccessService` - Permission management
   - `DocumentFollowerService` - Follow/unfollow
   - `CommentService` - Comments and replies
   - `SectionEmbedService` - Cross-document embedding
   - `DocumentEditorService` - Collaborative editing management

3. **[contracts/docs.query.sql](./contracts/docs.query.sql)**: Complete sqlc queries:
   - Document CRUD with slug management
   - Version history and diff support
   - Permission checks with inheritance
   - Follower management
   - Comment threading
   - PGroonga full-text search
   - Active editor tracking

4. **[quickstart.md](./quickstart.md)**: Test scenarios covering:
   - Core CRUD operations
   - Version history and diff
   - Section linking and embedding
   - Permission inheritance
   - Full-text search
   - Real-time collaboration
   - Comments and notifications

## Phase 2: Task Planning Approach

**Task Generation Strategy** (to be executed by /tasks command):

### Backend Tasks (estimated 20-25 tasks):

**Database Layer**:
1. Update `schema.sql` with docs schema tables (copy from data-model.md)
2. Create migration files (`YYYYMMDDHHMMSS_add_docs_schema.up.sql/.down.sql`)
3. Apply migrations: `./scripts/migrate.sh`
4. Add sqlc queries to `backend/database/scripts/docs.query.sql`
5. Generate sqlc code: `sqlc generate`

**Proto & RPC Layer**:
6. Add `document.proto` to `backend/rpc/v1/`
7. Generate proto code: `buf generate`

**Service Layer**:
8. Create `internal/docs/constants.go` with domain constants
9. Create `internal/docs/logic.go` with DocumentLogic interface
10. Implement document CRUD methods
11. Implement version history methods
12. Implement access control with permission inheritance
13. Implement follower logic with notification integration
14. Create `internal/docs/connect.go` with Connect layer
15. Wire services in `cmd/server.go`

**Testing**:
16. Add integration tests: `backend/integration/docs_crud_test.go`
17. Add permission tests: `backend/integration/docs_permission_test.go`
18. Add search tests: `backend/integration/docs_search_test.go`
19. Add collaboration tests: `backend/integration/docs_editor_test.go`

### Frontend Tasks (estimated 15-20 tasks):

**API Layer**:
1. Add docs types to `packages/apis/src/docs.ts`
2. Add API wrapper functions
3. Re-export from `packages/rpc/index.ts`

**Pages**:
4. Create `workspace/docs/page.tsx` with document tree
5. Create `workspace/docs/[slug]/page.tsx` for viewing
6. Create `workspace/docs/[slug]/edit/page.tsx` for editing
7. Create `workspace/docs/new/page.tsx` for creation
8. Create `workspace/docs/search/page.tsx` for search results

**Components**:
9. Create `DocumentTree.tsx` with expand/collapse
10. Create `DocumentEditor.tsx` with TipTap integration
11. Create `VersionHistory.tsx` with diff viewer
12. Create `CommentsSidebar.tsx` for inline comments
13. Create `PermissionsDialog.tsx` for access management
14. Add TipTap collaboration extensions (UniqueId, mention)

**Integration**:
15. Integrate with notification hub for document updates
16. Add to workspace navigation tabs
17. Theme integration with `useThemeColors()`

### Infrastructure Tasks (3-5 tasks):
1. Update Kubernetes configmaps if needed
2. Add environment variables for collaboration settings
3. Update deployment manifests

**Ordering Strategy**:
- Backend before Frontend (RPC contracts must exist)
- Database → Models → Services → Tests → UI
- Generated code tasks always follow definition tasks
- Mark [P] for parallel execution where possible

**Estimated Total**: 40-50 tasks in tasks.md

## Complexity Tracking

| Deviation | Why Needed | Alternative Rejected |
|-----------|------------|---------------------|
| Yjs CRDT library | Real-time collaboration with <100ms latency | SSE: Too slow for keystroke sync |
| UNLOGGED table for editors | 2-3x faster writes, crash recovery acceptable | Regular table: Unnecessary durability |
| Full JSON snapshots for versions | Fast retrieval, no reconstruction needed | Incremental diffs: Complex reconstruction |

## Progress Tracking

**Phase Status**:
- [x] Phase 0: Research complete (/plan command)
- [x] Phase 1: Design complete (/plan command)
- [x] Phase 2: Task planning described (/plan command)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS
- [x] Post-Design Constitution Check: PASS
- [x] All NEEDS CLARIFICATION resolved
- [x] Complexity deviations documented

---
*Based on Constitution v5.7.0 - See `.specify/memory/constitution.md`*
