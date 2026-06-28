# Implementation Plan: Notification Delivery Consistency and Coverage

**Branch**: `021-build-checklist-to-close-notification` | **Date**: 2026-03-09 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/021-build-checklist-to-close-notification/spec.md`

## Summary

Close notification consistency gaps by introducing an explicit notification policy model, separating acknowledgement from delivery, unifying recipient resolution across chat/docs/tasks, generalizing shared-context realtime routing beyond precomputed recipient lists, and aligning frontend navigation plus unread behavior with backend delivery state. The implementation adds auditable delivery and fallback outcomes, domain-specific recipient resolvers, typed navigation targets, and end-to-end integration coverage for SSE, offline fallback, unread counts, and deep-link acknowledgement.

## Technical Context
**Project Type**: web (frontend + backend monorepo)

**Frontend Stack**:
- Language: TypeScript 5.x
- Framework: Next.js 15 (App Router)
- UI Library: Material-UI (MUI) v5
- Package Manager: pnpm workspace
- Testing: Manual/E2E for UI, backend integration tests for end-to-end contract verification

**Backend Stack**:
- Language: Go 1.25+
- Database: PostgreSQL 18+ with Citus sharding and schema-per-domain design
- ORM: sqlc
- RPC: Protocol Buffers + ConnectRPC
- Auth: JWT-based auth with interceptor-scoped organization context
- Testing: Go integration tests in `backend/integration/` using the existing `testWorld` helpers

**Infrastructure**:
- Container: Docker / docker compose
- Orchestration: Kubernetes (StackGres for PostgreSQL)
- Migration: golang-migrate via `backend/scripts/migrate.sh`
- Realtime transport: SSE backed by PostgreSQL LISTEN/NOTIFY plus shared active connection state

**Performance Goals**:
- Realtime notification and unread propagation within 2 seconds under normal operating conditions
- Support up to 500 connected users and 200 active notification recipients per organization
- Offline fallback decisioning performed within the same publication transaction window

**Constraints**:
- Preserve multi-tenant isolation with `organization_id` filters on all tenant data access
- Keep backend logic stateless and distributed-safe; no single-instance assumptions for realtime state
- Use explicit constants across DB, Go, proto, and TypeScript; no new string literals without aligned definitions
- Popup display must not acknowledge notifications; acknowledgement occurs only when the linked destination is opened or an explicit acknowledge action is invoked

**Scale/Scope**:
- Affects backend notification infrastructure, chat/docs/collaboration domain publishers, proto contracts, generated clients, frontend notification center, popup handling, and navigation resolution
- Covers persistent notifications and live-only signals for chat, docs, and tasks

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Backend Service Architecture Checks
- [x] Service implements two-layer architecture: notification, chat, docs, and collaboration services already separate Connect handlers from logic/infrastructure layers
- [x] Logic layer has NO connection pools; all new business rules stay on `Queries` + injected logic dependencies
- [x] Logic layer methods accept `tx database.DBTX` for database work; recipient resolution and acknowledgement logic will follow this pattern
- [x] Logic layer receives parsed auth context as parameters; frontend-facing acknowledgement/read APIs remain tenant-scoped
- [x] Logic layer implements complex business authorization rules; recipient eligibility is domain business logic, not proto-only validation
- [x] Connect layer owns `AdminPool` and `TenantPool` and remains responsible for transaction boundaries via `txn.WithTxn`
- [x] Connect layer extracts auth context and passes identifiers to logic layer
- [x] AdminPool usage is documented: system-scope publication and cross-instance listener infrastructure only
- [x] All tenant queries will include `organization_id`, including new recipient resolution, acknowledgement, active context, and audit queries
- [x] RPC methods will declare explicit `access_control` options; new acknowledgement contract will follow existing notification permissions model
- [x] Proto authorization remains declarative; notification policy decisions remain imperative in logic code

### Cross-Domain Integration Checks (Constitution Principle IV)
- [x] Avoid SQL-level cross-schema joins for business logic; docs and collaboration compute recipients through domain-owned queries, then call notification publisher
- [x] Reuse existing domain logic methods where possible; extend docs/collaboration notification helper seams instead of duplicating publication code
- [x] Cross-domain dependencies stay at logic layer interfaces; no internal RPC calls
- [x] `backend/cmd/server.go` will continue wiring logic layers first, then connect layers
- [x] Atomic multi-step publication keeps the same transaction when domain mutations and notification creation must commit together
- [x] No nested `txn.WithTxn` calls; notification publishing remains transaction-aware from the caller

### Frontend UI & Type Safety Checks (Constitution Principle VII)
- [x] All frontend notification calls will stay wrapped in `frontend/packages/apis`
- [x] New notification summary fields and navigation targets will be mapped to custom TypeScript types in shared packages
- [x] Protobuf timestamps and enums will continue to be normalized to native frontend types
- [x] Interactive notification UI changes must add or preserve `data-testid` attributes on destination-opening and acknowledge actions
- [x] Existing theme system (`useThemeColors`) remains the required styling path for notification center and popup parity updates
- [x] No direct protobuf imports in app components; wrapper and shared package layers remain the boundary

### Codegen & Generated-Client Checks
- [x] SQL changes will require `cd /Volumes/T5/Codes/tech-office/backend && sqlc generate`
- [x] Proto changes will require `cd /Volumes/T5/Codes/tech-office/backend && buf generate`
- [x] Frontend generated client refresh will require updating exports in `frontend/packages/rpc/index.ts` if needed and then `cd /Volumes/T5/Codes/tech-office/frontend && pnpm -r build`

### Cross-Stack Constant & Type Synchronization Checks (Constitution Principle VIII)
- [x] Delivery policy keys, acknowledgement actions, fallback reasons, source domains, and notification types will be documented and aligned across schema, Go constants, proto, and TypeScript
- [x] New CHECK constraints and comments will be added for persisted string values
- [x] Backend and frontend runtime validators must be updated together in a single PR
- [x] Integration tests will verify constant alignment for new domains and lifecycle states

### Structured Error Details Checks (Constitution Principle X)
- [x] No new structured error detail contracts are required for the first implementation slice; generic Connect errors remain sufficient for notification acknowledgement and listing flows

### Distributed-First Architecture Checks (Constitution Principle XI)
- [x] Realtime routing design remains stateless at the process layer; shared connection and active-context state stays in PostgreSQL UNLOGGED tables
- [x] The current single-purpose `active_channel_id` pattern will be generalized to support shared activity context without assuming instance affinity
- [x] Listener and SSE reconnection logic remain multi-instance safe via shared registry + NOTIFY routing
- [x] No sticky-session assumptions; unread and acknowledgement state persist centrally

## Project Structure

### Documentation (this feature)
```
specs/021-build-checklist-to-close-notification/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── README.md
│   └── notification-lifecycle.md
└── tasks.md
```

### Expected Source Changes
```
backend/
├── database/
│   └── scripts/
│       ├── schema.sql                         # [MODIFY] lifecycle, fallback, active-context schema updates
│       ├── notification.query.sql            # [MODIFY] acknowledgement, unread, fallback, active context queries
│       ├── docs.query.sql                    # [MODIFY] document recipient eligibility queries
│       └── collaboration.query.sql           # [MODIFY] task recipient eligibility queries
├── internal/
│   ├── notification/
│   │   ├── constants.go                      # [MODIFY] policy keys, fallback reasons, ack actions, domain constants
│   │   ├── publisher.go                      # [MODIFY] policy enforcement + delivery outcome recording
│   │   ├── routing_logic.go                  # [MODIFY] fallback decisions and shared-context delivery
│   │   ├── logic.go                          # [MODIFY] acknowledgement-aware listing and unread logic
│   │   ├── connect.go                        # [MODIFY] new acknowledge contract and listing updates
│   │   ├── listener.go                       # [MODIFY] shared-context routing payload handling
│   │   └── sse.go                            # [MODIFY] replay and acknowledgement-safe stream behavior
│   ├── docs/
│   │   ├── follower_logic.go                 # [MODIFY] recipient expansion beyond followers
│   │   ├── comment_logic.go                  # [MODIFY] author/commenter/mention routing
│   │   └── version_logic.go                  # [MODIFY] document update notification policy usage
│   ├── collaboration/
│   │   ├── task_logic.go                     # [MODIFY] assignee/reporter/commenter/mention recipient rules
│   │   └── assignment_logic.go               # [MODIFY] direct assignment policy usage
│   └── chat/
│       └── logic.go                          # [MODIFY] align policy registry and delivery metadata without regressing chat realtime
├── rpc/v1/
│   └── notification.proto                    # [MODIFY] acknowledgement and navigation contract updates
├── cmd/
│   └── server.go                             # [MODIFY] wire any new notification logic dependencies
├── integration/
│   ├── notification_delivery_consistency_test.go
│   ├── notification_document_coverage_test.go
│   ├── notification_task_coverage_test.go
│   └── notification_frontend_parity_test.go
└── k8s/base/database/migrations/
    ├── YYYYMMDDHHMMSS_notification_policy_audit.up.sql
    └── YYYYMMDDHHMMSS_notification_policy_audit.down.sql

frontend/
├── packages/
│   ├── apis/src/notification.ts              # [MODIFY] acknowledgement API + new summary fields
│   ├── notifications/src/types.ts            # [MODIFY] lifecycle + navigation models
│   ├── notifications/src/useNotifications.ts # [MODIFY] unread logic and destination-open acknowledgement
│   └── notifications/src/useSSEConnection.ts # [MODIFY] stream payload normalization for new fields
└── apps/web/src/app/workspace/notifications/
    ├── page.tsx                              # [MODIFY] parity wiring
    └── components/
        ├── NotificationItem.tsx              # [MODIFY] destination-first acknowledgement behavior
        ├── NotificationList.tsx              # [MODIFY] parity and testing hooks
        └── NotificationFilters.tsx           # [MODIFY] aligned source-domain coverage
```

## Phase 0: Research — Complete

**Output**: [research.md](research.md)

Research resolved the core design choices for:
1. Business delivery policy ownership and alignment across domains
2. Separate acknowledgement lifecycle versus delivery lifecycle
3. Recipient eligibility rules for docs and tasks
4. Shared-context realtime routing beyond explicit recipient lists
5. Offline fallback auditability without duplicate retries
6. Frontend navigation parity and acknowledgement timing

## Phase 1: Design & Contracts — Complete

**Outputs**:
- [data-model.md](data-model.md)
- [contracts/README.md](contracts/README.md)
- [contracts/notification-lifecycle.md](contracts/notification-lifecycle.md)
- [quickstart.md](quickstart.md)

These artifacts define the schema changes, lifecycle contracts, implementation seams, and verification scenarios for backend and frontend parity.

## Phase 2: Task Planning — Complete

**Output**: [tasks.md](tasks.md)

Tasks are generated and ordered around six execution streams:
1. Schema and codegen prerequisites
2. Notification infrastructure and lifecycle separation
3. Document recipient coverage
4. Task recipient coverage
5. Frontend parity and acknowledgement behavior
6. Integration verification and build validation

## Complexity Tracking

No constitution violation requires a waiver.

Notable implementation complexity to manage:
- Shared-context realtime routing must extend existing channel-scoped state without breaking chat typing/reaction delivery
- Acknowledgement must remain backward-compatible long enough for frontend and backend to land atomically
- Recipient expansion for docs/tasks must not create duplicate notifications when users qualify through multiple relationships

## Progress Tracking

**Planning Phase Status**:
- [x] Initial Constitution Check
- [x] Phase 0: Research complete
- [x] Phase 1: Design and contracts complete
- [x] Post-Design Constitution Check
- [x] Phase 2: Task planning complete
- [x] Required planning artifacts generated

**Generated Artifacts**:
- [x] `plan.md`
- [x] `research.md`
- [x] `data-model.md`
- [x] `contracts/README.md`
- [x] `contracts/notification-lifecycle.md`
- [x] `quickstart.md`
- [x] `tasks.md`

---
*Based on Constitution v5.9.0 — See `.specify/memory/constitution.md`*