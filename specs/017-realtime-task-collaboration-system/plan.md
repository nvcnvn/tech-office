# Implementation Plan: Realtime Task Collaboration System

**Branch**: `017-realtime-task-collaboration-system` | **Date**: 2024-12-26 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/017-realtime-task-collaboration-system/spec.md`

## Summary

Build a Trello/Jira-style task collaboration system with:
- **Projects** containing **tasks** with customizable workflow states (Backlog → In Progress → Testing → Done)
- **Task hierarchy**: Epic → Story → Task → Subtask (max 5 levels)
- **Dynamic custom fields**: Story points, t-shirt sizes, hours, etc. stored as JSONB
- **Cross-domain integration**: Task comments via Chat (#009), descriptions via Docs (#016), attachments via Files (#014)
- **Workflow automation**: State-triggered rules (e.g., "when task enters Done, mark as closed")
- **Real-time updates**: Board changes broadcast via Notification Hub SSE
- **Analytics**: Grouping, filtering, aggregations with CSV export
- **Views**: Board (Kanban), List, Gantt, Calendar

**Technical Approach**: 
- New `collaboration` schema with 12 tables following Citus sharding pattern
- Two-layer service architecture (Logic + Connect layers)
- Cross-domain integration via logic layer interfaces (Chat, Docs, Notification)
- Custom fields using EAV pattern with JSONB values for flexibility

---

## Technical Context

**Project Type**: web (frontend + backend monorepo)  

**Frontend Stack**: 
- Language: TypeScript 5.x
- Framework: Next.js 15 (App Router)
- UI Library: Material-UI (MUI) v5
- Package Manager: pnpm workspace
- Testing: Vitest, React Testing Library

**Backend Stack**:
- Language: Go 1.25+
- Database: PostgreSQL 18+ with Citus (multi-tenant, schema-per-domain)
- ORM: sqlc (type-safe SQL code generation)
- RPC: Protocol Buffers + ConnectRPC
- Auth: Zitadel integration
- Workflow: https://github.com/nvcnvn/flows

**Infrastructure**:
- Container: Docker
- Orchestration: Kubernetes (StackGres for PostgreSQL)
- Migration: golang-migrate (run via `backend/scripts/migrate.sh`)
- Object Storage: Cloudflare R2 for file attachments

**Performance Goals**: 
- <200ms API response p95
- 50+ concurrent users per project
- 10,000+ tasks per project
- Real-time updates <1 second E2E

**Constraints**: 
- Multi-tenant isolation via `organization_id`
- Citus sharding with composite primary keys
- RBAC enforcement at proto level

**Scale/Scope**: 
- 10k organizations
- 100k users
- Integrates with 4 existing domains (Chat, Docs, Files, Notification)

---

## Constitution Check

### Backend Service Architecture Checks ✅
- [x] Service implements two-layer architecture: Logic layer (business logic) + Connect layer (RPC handlers)
- [x] Logic layer has NO connection pools (only Queries and other logic dependencies)
- [x] Logic layer methods accept `tx database.DBTX` parameter for all database operations
- [x] Logic layer receives parsed auth context as parameters (employeeID, orgID) not raw request context
- [x] Logic layer implements complex business authorization rules (project membership, task ownership)
- [x] Connect layer owns both `AdminPool` and `TenantPool`
- [x] Connect layer extracts auth context from request and passes to logic layer
- [x] Connect layer manages transactions using `txn.WithTxn` helper
- [x] Connect layer chooses appropriate pool: TenantPool for user operations
- [x] Connect layer performs lightweight proto-level authorization verification
- [x] All tenant-data queries include `organization_id` filters
- [x] ALL RPC methods declare `access_control` options in proto with explicit `allowed_roles`
- [x] NO role inheritance assumed - all required roles listed explicitly

### Cross-Domain Integration Checks ✅
- [x] Services depend on other services' **logic layer interfaces** (Chat, Docs, Notification)
- [x] Cross-domain calls use direct Go method invocations on logic layer
- [x] User-scope calls pass request context through logic layers
- [x] Logic layer methods accept `tx database.DBTX` for atomic cross-domain operations
- [x] Connect layer passes same transaction to multiple logic layer calls

### Cross-Stack Constant & Type Synchronization Checks ✅
- [x] Prefer protobuf enums when possible (StateCategory, CustomFieldType, WorkflowTriggerType, etc.)
- [x] Database: CHECK constraints for string values (visibility, category, role, status)
- [x] Database: Document allowed values in table/column comments
- [x] Backend: Constants defined in domain package (`internal/collaboration/constants.go`)
- [x] Frontend: TypeScript union types matching backend constants
- [x] Integration tests validate constant synchronization

### Distributed-First Architecture Checks ✅
- [x] Backend logic is stateless (NO process-local caches)
- [x] File storage uses Cloudflare R2 (existing Files service)
- [x] Database queries are shard-aware (include `organization_id`)
- [x] SSE/WebSocket leverages existing Notification Hub infrastructure

---

## Phase 0: Research ✅ COMPLETE

**Output**: [research.md](./research.md)

Research topics resolved:
1. Schema placement: New `collaboration` schema
2. Chat integration: Auto-create `project_ticket_thread` channel per task
3. Docs integration: Auto-create document for task description
4. Files integration: Use existing `upload_context='project'`
5. Custom fields: EAV pattern with JSONB values
6. Task identifiers: Project-scoped sequential counter (PROJ-123)
7. Task hierarchy: Parent-child with level enforcement, max 5 depth
8. Workflow rules: State-triggered actions with atomic execution
9. Analytics: Dynamic query building with JSONB operators
10. Real-time: Notification hub SSE with `source_domain='projects'`
11. Saved views: JSONB config per user/project
12. Gantt: Client-side rendering from task dates

---

## Phase 1: Design & Contracts ✅ COMPLETE

### Outputs

| File | Description |
|------|-------------|
| [data-model.md](./data-model.md) | 12 tables with Citus sharding pattern |
| [contracts/collaboration.proto](./contracts/collaboration.proto) | 40+ RPC methods with access control |
| [contracts/collaboration.query.sql](./contracts/collaboration.query.sql) | 80+ sqlc queries |
| [quickstart.md](./quickstart.md) | 10 test scenarios with examples |

### Database Schema Summary

| Table | Purpose | Key FKs |
|-------|---------|---------|
| `collaboration.project` | Project container | owner_employee |
| `collaboration.project_state` | Workflow states | project |
| `collaboration.task_level` | Hierarchy levels | project |
| `collaboration.task` | Core task entity | project, state, level, channel, document |
| `collaboration.task_assignee` | Task assignments | task, employee |
| `collaboration.task_watcher` | Subscriptions | task, employee |
| `collaboration.custom_field_definition` | Field definitions | project |
| `collaboration.custom_field_value` | Field values | task, field_definition |
| `collaboration.workflow_rule` | Automation rules | project, trigger_state |
| `collaboration.workflow_rule_execution` | Rule audit log | rule, task |
| `collaboration.project_membership` | Project access | project, employee |
| `collaboration.saved_view` | View configs | project, employee |

### Cross-Domain Integration Points

| Integration | Mechanism |
|-------------|-----------|
| Task → Chat | `task.channel_id` → `chat.channel` (auto-created) |
| Task → Docs | `task.description_document_id` → `docs.document` (auto-created) |
| Task → Files | `task.file_ids[]` → `files.file_metadata` |
| Task → Notifications | `notification.notification.source_domain='projects'` |

---

## Phase 2: Task Planning Approach

*This section describes what the /tasks command will do*

### Task Generation Strategy

**Migration Files** (7 pairs):
1. `collaboration_project.up.sql` / `.down.sql` - Project table
2. `collaboration_states_levels.up.sql` / `.down.sql` - States and levels
3. `collaboration_task.up.sql` / `.down.sql` - Task table
4. `collaboration_custom_fields.up.sql` / `.down.sql` - Custom fields
5. `collaboration_workflow.up.sql` / `.down.sql` - Workflow rules
6. `collaboration_membership_views.up.sql` / `.down.sql` - Membership and views
7. `notification_projects_domain.up.sql` / `.down.sql` - Update notification CHECK

**Backend Tasks** (~25 tasks):
1. Schema changes → schema.sql update
2. Migration files → 7 pairs
3. Apply migrations → `./scripts/migrate.sh`
4. sqlc queries → `collaboration.query.sql`
5. sqlc generation → `sqlc generate`
6. Proto definitions → `collaboration.proto`
7. Proto generation → `buf generate`
8. Constants package → `internal/collaboration/constants.go`
9. Logic layer interfaces
10. Logic layer implementations (Project, Task, CustomField, Workflow, etc.)
11. Connect layer implementations
12. Service registration in `cmd/server.go`
13. Integration tests

**Frontend Tasks** (~15 tasks):
1. API wrapper types → `packages/apis/src/collaboration.ts`
2. Proto re-export → `packages/rpc/index.ts`
3. Project list page → `workspace/projects/page.tsx`
4. Project detail page → `workspace/projects/[id]/page.tsx`
5. Board view component
6. List view component
7. Gantt view component
8. Task detail dialog
9. Custom field editor
10. Workflow rule editor
11. Project settings page
12. Analytics dashboard

**Ordering Strategy**:
- Backend before Frontend (RPC contracts must exist)
- Schema → Migrations → sqlc → Proto → Logic → Connect → Frontend
- Mark [P] for parallel execution (independent files)

**Estimated Total**: ~40 numbered, ordered tasks

---

## Progress Tracking

**Phase Status**:
- [x] Phase 0: Research complete ✅
- [x] Phase 1: Design complete ✅
- [x] Phase 2: Task planning described ✅
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS
- [x] Post-Design Constitution Check: PASS
- [x] All NEEDS CLARIFICATION resolved
- [x] Complexity deviations: None

---

## Ready for /tasks

All design artifacts complete:
- ✅ [research.md](./research.md) - 12 design decisions documented
- ✅ [data-model.md](./data-model.md) - 12 tables with Citus sharding
- ✅ [contracts/collaboration.proto](./contracts/collaboration.proto) - 40+ RPC methods
- ✅ [contracts/collaboration.query.sql](./contracts/collaboration.query.sql) - 80+ sqlc queries
- ✅ [quickstart.md](./quickstart.md) - 10 test scenarios

Run `/tasks` to generate implementation task breakdown.

---
*Based on Constitution v5.8.0 - See `.specify/memory/constitution.md`*
