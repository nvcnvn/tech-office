
# Implementation Plan: Unified Notification Routing for Chat, Documents, and Tasks

**Branch**: `019-unified-notification-routing-for-chat` | **Date**: 2026-02-28 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/019-unified-notification-routing-for-chat/spec.md`

## Execution Flow (/plan command scope)
```
1. Load feature spec from Input path
   → If not found: ERROR "No feature spec at {path}"
2. Fill Technical Context (scan for NEEDS CLARIFICATION)
   → Detect Project Type from file system structure or context (web=frontend+backend, mobile=app+api)
   → Set Structure Decision based on project type
3. Fill the Constitution Check section based on the content of the constitution document.
4. Evaluate Constitution Check section below
   → If violations exist: Document in Complexity Tracking
   → If no justification possible: ERROR "Simplify approach first"
   → Update Progress Tracking: Initial Constitution Check
5. Execute Phase 0 → research.md
   → If NEEDS CLARIFICATION remain: ERROR "Resolve unknowns"
6. Execute Phase 1 → contracts, data-model.md, quickstart.md, agent-specific template file (e.g., `CLAUDE.md` for Claude Code, `.github/copilot-instructions.md` for GitHub Copilot, `GEMINI.md` for Gemini CLI, `QWEN.md` for Qwen Code, or `AGENTS.md` for all other agents).
7. Re-evaluate Constitution Check section
   → If new violations: Refactor design, return to Phase 1
   → Update Progress Tracking: Post-Design Constitution Check
8. Plan Phase 2 → Describe task generation approach (DO NOT create tasks.md)
9. STOP - Ready for /tasks command
```

**IMPORTANT**: The /plan command STOPS at step 7. Phases 2-4 are executed by other commands:
- Phase 2: /tasks command creates tasks.md
- Phase 3-4: Implementation execution (manual or via tools)

## Summary
Unify notification routing across chat, documents, and tasks by: (1) enforcing the preference model (`all`/`mentions`/`muted`) that already exists but is ignored during task notification publishing, (2) wiring document operations to publish notifications to followers, (3) adding missing auto-follow triggers (mention→auto-watch, comment→auto-watch, create→auto-follow), (4) enriching task notification types from generic `message` to specific types (`task_assigned`, `task_status_changed`, etc.), and (5) adding a global personal notification preference table for DND/push toggle/domain mutes.

**User directive**: Integration tests MUST be written FIRST to lock down current working behavior before any refactoring begins. This is a test-first approach to avoid regressions.

## Technical Context
**Project Type**: web (frontend + backend monorepo)  
**Frontend Stack**: 
- Language: TypeScript 5.x
- Framework: Next.js 15 (App Router)
- UI Library: Material-UI (MUI) v5
- Package Manager: pnpm workspace
- Testing: Not in scope for this phase (backend-only changes)

**Backend Stack**:
- Language: Go 1.25+
- Database: PostgreSQL 18+ (multi-tenant, schema-per-domain, Citus sharding)
- ORM: sqlc (type-safe SQL code generation)
- RPC: Protocol Buffers + ConnectRPC
- Auth: Custom JWT (DevJWTSigner for tests)
- Testing: Go testing + testify, testWorld pattern in backend/integration/

**Infrastructure**:
- Container: Docker (docker-compose for local dev — postgres, backend)
- Orchestration: Kubernetes (StackGres for PostgreSQL)
- Migration: golang-migrate (run via `backend/scripts/migrate.sh`)

**Performance Goals**: Notification delivery <200ms SSE, <500ms push  
**Constraints**: Multi-tenant isolation (organization_id on ALL queries), Citus sharding compliance, no triggers, no cross-schema SQL joins  
**Scale/Scope**: Hundreds of concurrent employees per org, subscribed to dozens of channels/tasks/documents each

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Backend Service Architecture Checks
- [x] Service implements two-layer architecture: Logic layer + Connect layer — existing notification, chat, collaboration, docs services all follow this
- [x] Logic layer has NO connection pools — confirmed in all services
- [x] Logic layer methods accept `tx database.DBTX` parameter — confirmed
- [x] Logic layer receives parsed auth context as parameters (employeeID, orgID) — confirmed
- [x] Logic layer implements complex business authorization rules — notification filtering is business logic
- [x] Connect layer owns AdminPool and TenantPool — confirmed
- [x] Connect layer extracts auth context and passes to logic layer — confirmed
- [x] Connect layer manages transactions using `txn.WithTxn` — confirmed
- [x] Connect layer chooses appropriate pool: TenantPool for user operations — confirmed
- [x] Connect layer performs lightweight proto-level authorization verification — confirmed (access_control options)
- [x] AdminPool usage documented with justification — notification publishing uses AdminPool for system-scope batch delivery
- [x] All tenant-data queries include organization_id — confirmed across all notification queries
- [x] ALL RPC methods declare access_control with explicit allowed_roles — confirmed in notification.proto, collaboration.proto, document.proto
- [x] NO role inheritance assumed — all roles listed explicitly in proto definitions
- [x] Proto authorization is declarative; logic authorization is imperative — confirmed

### Cross-Domain Integration Checks (Constitution Principle IV)
- [x] Avoid SQL-level cross-schema data access — notification, chat, collaboration, docs each query own schema only
- [x] Reuse existing logic layer methods — docs will gain NotificationPublisher dependency (same as chat/collaboration)
- [x] Services depend on other services' logic layer interfaces — confirmed (e.g., collaboration depends on chatLogic, docsLogic, notificationService)
- [x] Declare logic layer dependencies in constructor — confirmed pattern in server.go
- [x] Initialize logic layers first, then wrap with connect layers — confirmed in server.go
- [x] Cross-domain calls use Go method invocations, not RPC internally — confirmed
- [x] User-scope calls pass request context through logic layers — confirmed
- [x] Logic layer methods accept tx database.DBTX for atomic cross-domain — confirmed
- [x] Connect layer passes same transaction to multiple logic layers when needed — confirmed
- [x] NEVER nest txn.WithTxn calls — confirmed

### Frontend UI & Type Safety Checks (Constitution Principle VII)
Not applicable for this phase — backend-only changes. Frontend notification UI already exists and consumes the existing NotificationSummary proto type. New notification types will be delivered through the same pipeline.

### Cross-Stack Constant & Type Synchronization Checks (Constitution Principle VIII)
- [ ] New notification type constants (`task_assigned`, `task_status_changed`, etc.) MUST be defined in backend constants AND database CHECK constraints
- [ ] New notification type constants MUST be added to frontend TypeScript union types
- [ ] Integration tests MUST validate constant values match across layers
- [ ] All changes submitted atomically in single PR

### Distributed-First Architecture Checks (Constitution Principle XI)
- [x] Backend logic is stateless — confirmed (connection state in UNLOGGED tables)
- [x] No local file storage — not applicable
- [x] No in-memory connection registries — using notification.active_connection UNLOGGED table
- [x] Ephemeral state in PostgreSQL UNLOGGED tables — confirmed
- [x] SSE reconnection handles instance failures — confirmed via PG NOTIFY per-instance routing

**Example Theme Usage Pattern**:
```typescript
import { useThemeColors } from '@/theme/useThemeColors';

function MyComponent() {
  const colors = useThemeColors();
  
  return (
    <div 
      style={colors.bg.paper.style} 
      className={colors.border.default.className}
      data-testid="my-component"
    >
      <h1 style={colors.text.primary.style}>Title</h1>
      <Button style={colors.bg.primary.style} data-testid="action-btn">
        Action
      </Button>
    </div>
  );
}
```

Rationale: Centralized theme system prevents hardcoded color drift and ensures consistent Dark/Light mode support. Type-safe API wrappers prevent protobuf type leakage into applications.

### Codegen & Generated-Client Checks
This feature modifies:
- SQL schema → `cd backend && sqlc generate` (commit generated outputs)
- No new proto definitions needed for the core notification routing changes
- If adding new RPC for global personal preferences → `cd backend && buf generate` + re-export from `frontend/packages/rpc/index.ts` + `pnpm -r build`

### Structured Error Details Checks (Constitution Principle X)
Not applicable — this feature does not introduce new error detail contracts. Existing error handling is sufficient.

## Project Structure

### Documentation (this feature)
```
specs/019-unified-notification-routing-for-chat/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output — integration test scenarios
├── contracts/           # Phase 1 output
│   └── notification.query.sql  # New/modified sqlc queries
└── tasks.md             # Phase 2 output (/tasks command)
```

### Source Code (Tech Office Monorepo)
```
backend/
├── database/
│   └── scripts/
│       ├── schema.sql                    # [MODIFY] Add notification.personal_preference table, add notification_preference to docs.document_follower
│       ├── notification.query.sql        # [MODIFY] Add preference-aware notification queries
│       └── docs.query.sql               # [MODIFY] Add follower queries with preference filtering
├── internal/
│   ├── notification/
│   │   ├── constants.go                  # [MODIFY] Add new notification type constants
│   │   ├── publisher.go                  # [MODIFY] Add preference filtering helper
│   │   └── routing_logic.go             # [MODIFY] Add DND/global preference checks
│   ├── collaboration/
│   │   ├── task_logic.go                 # [MODIFY] Enforce preferences, auto-watch on mention/comment, enriched types
│   │   └── constants.go                  # [MODIFY] Add new task notification types
│   ├── docs/
│   │   ├── logic.go                      # [MODIFY] Add NotificationPublisher dependency
│   │   ├── follower_logic.go             # [MODIFY] Auto-follow on create, publish notifications
│   │   ├── comment_logic.go              # [MODIFY] Auto-follow on comment/mention, publish notifications
│   │   └── constants.go                  # Already has notification types defined
│   └── chat/
│       └── logic.go                      # No changes needed — already works correctly
├── cmd/
│   └── server.go                         # [MODIFY] Wire NotificationPublisher into docs service
├── integration/
│   ├── notification_preference_test.go   # [ADD] Test preference enforcement across domains
│   ├── notification_task_test.go         # [ADD] Test task notification specifics
│   ├── notification_docs_test.go         # [ADD] Test document notification specifics
│   └── helper_test.go                    # [MODIFY] Add preference/mute test helpers
└── k8s/base/database/migrations/
    ├── YYYYMMDDHHMMSS_add_personal_notification_preference.up.sql
    └── YYYYMMDDHHMMSS_add_personal_notification_preference.down.sql
```

Database Schemas Involved: `notification`, `docs`, `collaboration`, `chat`

## Phase 0: Research — Complete

All research was completed during the previous analysis session. Key findings documented in [research.md](research.md).

**Output**: [research.md](research.md) — all unknowns resolved

## Phase 1: Design & Contracts — Complete

Design documents:
- [data-model.md](data-model.md) — schema changes
- [contracts/notification.query.sql](contracts/notification.query.sql) — new/modified sqlc queries
- [quickstart.md](quickstart.md) — integration test scenarios (test-first approach)

**Output**: All Phase 1 artifacts generated

## Phase 2: Task Planning Approach
*This section describes what the /tasks command will do — DO NOT execute during /plan*

**Task Generation Strategy — TEST-FIRST APPROACH**:
The user explicitly requested integration tests first to lock down existing behavior before making changes. This inverts the normal task order.

**Phase 2.1: Baseline Integration Tests (FIRST)**
Write integration tests that capture current working behavior:
1. Test chat notification delivery with preference filtering (already works — lock it down)
2. Test task watcher notification delivery (works, but no preference filtering — document current behavior)
3. Test task watch/unwatch lifecycle
4. Test document follow/unfollow lifecycle
5. Test notification routing with presence status (online/offline/hidden)
6. Test notification lifecycle (publish → list → mark-read → delete)

**Phase 2.2: Schema Changes**
7. Add `notification_preference` column to `docs.document_follower` table
8. Create `notification.personal_preference` table for global settings
9. Update CHECK constraint on `notification.notification.notification_type` for new types
10. Write migrations (up + down)
11. Apply migrations: `cd backend && ./scripts/migrate.sh`
12. Update schema.sql + `sqlc generate`

**Phase 2.3: Constant & Type Updates**
13. Add new notification type constants to `notification/constants.go`
14. Add new task notification type constants to `collaboration/constants.go`
15. Update database CHECK constraints for new types

**Phase 2.4: Core Logic Changes**
16. Wire `NotificationPublisher` into docs service (`server.go` + docs logic constructor)
17. Implement preference filtering helper in `notification/publisher.go`
18. Enforce `project_membership.notification_preference` in `notifyTaskWatchers()`
19. Add auto-watch on mention in task comments
20. Add auto-watch on comment in task logic
21. Enrich task notification types (`task_assigned`, `task_status_changed`, `task_commented`)
22. Implement document notification publishing (version save → followers, comment → followers)
23. Implement document auto-follow on create
24. Implement document auto-follow on mention in comments
25. Add global personal preference CRUD logic
26. Add DND/domain-mute checks in routing logic

**Phase 2.5: New Integration Tests**
27. Test preference enforcement: muted users don't receive task notifications
28. Test preference enforcement: mentions-only users receive only mentions
29. Test document notifications: followers receive version/comment notifications
30. Test auto-follow: creator auto-follows document
31. Test auto-watch: mention auto-watches task
32. Test enriched notification types for tasks
33. Test global DND suppresses push but not SSE
34. Test critical priority bypasses mute/DND
35. Test deduplication (watcher + mention → single notification)
36. Multi-tenancy: cross-org notification isolation

**Phase 2.6: Constant Synchronization**
37. Update frontend TypeScript types for new notification types
38. Write constant validation integration test

**Ordering Strategy**:
- **Tests FIRST** for existing behavior (Phase 2.1)
- Then schema → codegen → logic → new tests
- Backend-only in this phase (no frontend UI changes)
- Mark [P] for parallel where files are independent

**Estimated Output**: ~38 numbered, ordered tasks in tasks.md

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan

## Phase 3+: Future Implementation
*Beyond scope of /plan*

**Phase 3**: Task execution (/tasks command creates tasks.md)  
**Phase 4**: Implementation (execute tasks following constitutional principles)  
**Phase 5**: Validation (run tests, execute quickstart.md)

## Complexity Tracking
*No constitution violations identified — all changes follow existing patterns.*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | — | — |

## Progress Tracking

**Phase Status**:
- [x] Phase 0: Research complete
- [x] Phase 1: Design complete
- [x] Phase 2: Task planning complete (approach described)
- [x] Phase 3: Tasks generated (/tasks command → tasks.md)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS
- [x] Post-Design Constitution Check: PASS
- [x] All NEEDS CLARIFICATION resolved
- [x] Complexity deviations documented (none)
