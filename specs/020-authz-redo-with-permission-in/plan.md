# Implementation Plan: Permission-Based Authorization System

**Branch**: `020-authz-redo-with-permission-in` | **Date**: 2026-03-02 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/020-authz-redo-with-permission-in/spec.md`

## Summary

Replace the hardcoded role-based authorization system (`allowed_roles: [ROLE_OWNER, ROLE_OPERATOR]`) with a permission-based system (`required_permissions: ["chat.createChannel"]`). Introduces ~80 granular permissions organized by domain, Citus reference tables for default roles/permissions (global templates), per-org distributed tables for mutable role-permission assignments, and new IAM RPCs for role management. The auth interceptor is rewritten to resolve permissions (union across all roles) from the database on each request. No backward compatibility — full cleanup of the old role system.

## Technical Context
**Project Type**: web (frontend + backend monorepo)

**Frontend Stack**:
- Language: TypeScript 5.x
- Framework: Next.js 15 (App Router)
- UI Library: Material-UI (MUI) v5
- Package Manager: pnpm workspace

**Backend Stack**:
- Language: Go 1.25+
- Database: PostgreSQL 18+ with Citus (multi-tenant, schema-per-domain)
- ORM: sqlc (type-safe SQL code generation)
- RPC: Protocol Buffers + ConnectRPC
- Auth: Internal JWT (DevJWTSigner for dev, RS256)
- Testing: Integration tests in `backend/integration/` using RPC clients

**Infrastructure**:
- Container: Docker
- Orchestration: Kubernetes (StackGres for PostgreSQL)
- Migration: golang-migrate (run via `backend/scripts/migrate.sh`)

**Constraints**: Multi-tenant isolation via `organization_id` on every query. No caching for permission resolution (per user directive). Full cleanup of old role system (no backward compatibility — early development).

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Backend Service Architecture Checks
- [x] Service implements two-layer architecture: Logic layer (business logic) + Connect layer (RPC handlers)
- [x] Logic layer has NO connection pools (only Queries and other logic dependencies)
- [x] Logic layer methods accept `tx database.DBTX` parameter for all database operations
- [x] Logic layer receives parsed auth context as parameters (employeeID, orgID) not raw request context
- [x] Logic layer implements complex business authorization rules (lockout prevention on Owner role)
- [x] Connect layer owns both `AdminPool database.AdminDatabaseConnector` and `TenantPool database.TenantDatabaseConnector`
- [x] Connect layer extracts auth context from request and passes to logic layer
- [x] Connect layer manages transactions using `txn.WithTxn` helper (no manual Begin/Commit/Rollback)
- [x] Connect layer chooses appropriate pool: TenantPool for role CRUD, AdminPool for permission seeding
- [x] Connect layer performs lightweight proto-level authorization verification
- [x] AdminPool usage documented: used for `ListPermissions` (reads global reference table) and org registration role seeding
- [x] All tenant-data queries include `organization_id` filters
- [x] ALL RPC methods declare `access_control` options in proto with explicit `required_permissions`
- [x] Proto authorization is declarative (proto options); logic authorization is imperative (business rules)

### Cross-Domain Integration Checks (Constitution Principle IV)
- [x] Avoid SQL-level cross-schema data access — permission resolution JOINs iam.employee_role → iam.role_permission (same schema)
- [x] Reuse existing logic layer methods rather than duplicating SQL queries
- [x] Services depend on other services' logic layer interfaces (IAM logic used by organization logic for role seeding)
- [x] Declare logic layer dependencies in constructor
- [x] Initialize logic layers first, then connect layers in `backend/cmd/server.go`
- [x] Cross-domain calls use direct Go method invocations on logic layer
- [x] User-scope calls pass request context through logic layers
- [x] Cross-domain logic methods accept `tx database.DBTX` parameter
- [x] Connect layer passes same transaction for atomic cross-domain operations (org registration + role seeding)
- [x] NEVER nest `txn.WithTxn` calls

### Codegen & Generated-Client Checks
- [x] SQL changes → `cd backend && sqlc generate`
- [x] Proto changes → `cd backend && buf generate`
- [x] Frontend package `frontend/packages/rpc` re-export + `pnpm -r build`

### Cross-Stack Constant & Type Synchronization Checks
- [x] Permission strings are defined in `public.permission` reference table (source of truth)
- [x] Backend reads from DB — no hardcoded permission constants needed
- [x] Proto files declare `required_permissions` strings matching DB entries
- [x] Frontend receives permission lists via `ListPermissions` RPC — no local constants
- [x] Integration tests validate permission resolution matches expected behavior
- [x] All changes in single PR (schema + backend + proto + tests)

### Distributed-First Architecture Checks
- [x] Backend logic is stateless (permission resolution from DB each request — no cache)
- [x] Database queries are shard-aware (`organization_id` in all JOINs, colocated tables)
- [x] Reference tables replicated to all nodes for efficient local JOINs
- [x] No assumptions about server affinity

## Project Structure

### Documentation (this feature)
```
specs/020-authz-redo-with-permission-in/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 research decisions
├── data-model.md        # Phase 1 database schema design
├── quickstart.md        # Phase 1 test scenarios
├── contracts/           # Phase 1 proto contracts
│   ├── README.md        # Full proto change documentation
│   └── rbac.proto       # New PermissionBasedAccessControl definition
└── tasks.md             # Phase 2 (/tasks command — NOT created by /plan)
```

### Source Code Changes

**Backend Structure**:
```
backend/
├── database/
│   └── scripts/
│       ├── schema.sql              # [MODIFY] Add 6 tables, remove 2, seed data
│       └── iam.query.sql           # [MODIFY] New permission/role queries, remove old role queries
├── internal/
│   ├── interceptor/
│   │   └── auth.go                 # [MODIFY] Replace role-based with permission-based
│   ├── iam/
│   │   ├── constants.go            # [MODIFY] Remove old role constants
│   │   ├── role_lookup.go          # [DELETE] Replaced by permission_lookup.go
│   │   ├── permission_lookup.go    # [CREATE] New PermissionLookup adapter
│   │   ├── logic.go                # [MODIFY] Add role management business logic
│   │   └── connect.go              # [MODIFY] Add role management RPC handlers
│   └── organization/
│       └── logic.go                # [MODIFY] Seed roles on org registration
├── rpc/v1/
│   ├── rbac.proto                  # [MODIFY] Replace RoleBasedAccessControl
│   ├── iam.proto                   # [MODIFY] Add RPCs, update access_control, remove OrganizationRole
│   ├── chat.proto                  # [MODIFY] Update access_control options
│   ├── collaboration.proto         # [MODIFY] Update access_control options
│   ├── document.proto              # [MODIFY] Update access_control options
│   ├── notification.proto          # [MODIFY] Update access_control options
│   ├── files.proto                 # [MODIFY] Update access_control options
│   ├── organization.proto          # [MODIFY] Update access_control options
│   ├── department.proto            # [MODIFY] Update access_control options
│   ├── preference.proto            # [MODIFY] Update access_control options
│   └── chat_files.proto            # [MODIFY] Update access_control options
├── cmd/
│   └── server.go                   # [MODIFY] Wire PermissionLookup instead of RoleLookup
├── k8s/base/database/migrations/
│   ├── 20260302000001_create_permission_ref_tables.up.sql    # [CREATE]
│   ├── 20260302000001_create_permission_ref_tables.down.sql  # [CREATE]
│   ├── 20260302000002_create_iam_role_tables.up.sql          # [CREATE]
│   ├── 20260302000002_create_iam_role_tables.down.sql        # [CREATE]
│   ├── 20260302000003_migrate_membership_to_roles.up.sql     # [CREATE]
│   └── 20260302000003_migrate_membership_to_roles.down.sql   # [CREATE]
└── integration/
    └── iam_permission_test.go      # [CREATE] Integration tests for permission system

Database Schemas Involved: public (reference tables), iam (roles, permissions, assignments)
```

**Frontend Structure** (minimal for this feature):
```
frontend/
├── packages/
│   ├── apis/src/iam.ts             # [MODIFY] Add role management API wrappers
│   └── rpc/                        # [GENERATED] Updated proto types
└── apps/web/src/app/workspace/
    └── organization/
        └── roles/                  # [CREATE] Role management UI (future)
```

## Phase 0: Research — Complete

**Output**: [research.md](research.md) — 11 decisions covering:
1. Citus reference tables in `public` schema for default permissions/roles
2. New table design (3 reference + 3 distributed)
3. Full cleanup of old role system (no backward compatibility)
4. Data migration from `organization_membership` to `employee_role`
5. Proto schema changes (`PermissionBasedAccessControl` replaces `RoleBasedAccessControl`)
6. Interceptor rewrite approach (in-place modification)
7. Organization registration flow (seed roles from defaults)
8. Role management RPCs (10 new RPCs)
9. Lockout prevention (protected permissions on Owner role)
10. Frontend impact (minimal — API wrappers + future role management UI)
11. `AuthenticateHTTPRequest` migration

All NEEDS CLARIFICATION: **Resolved**.

## Phase 1: Design & Contracts — Complete

**Outputs**:
- [data-model.md](data-model.md) — Complete schema with 3 reference tables + 3 distributed tables, seed data for ~80 permissions and 3 default roles, all sqlc query designs, migration strategy
- [contracts/](contracts/) — New `rbac.proto`, 10 new IAM RPCs with request/response messages, permission mapping for all ~180 existing RPCs across 11 proto files
- [quickstart.md](quickstart.md) — 12 test scenarios covering: default roles, permission denied, union semantics, immediate effect, OR semantics, unauthenticated endpoints, cascade deletion, lockout prevention, full CRUD lifecycle, performance

## Phase 2: Task Planning Approach
*Describes what the /tasks command will do — NOT executed during /plan.*

**Task Generation Strategy**: Load the plan's Phase 1 artifacts and generate ordered, dependency-aware tasks following the Tech Office development workflow.

**Backend Task Ordering**:
1. **Schema & Migrations** (sequential):
   - Update `schema.sql` with new tables (reference + distributed) and seed data
   - Write 3 migration pairs (`.up.sql` + `.down.sql`) under `backend/k8s/base/database/migrations/`
   - Apply migrations: `cd backend && ./scripts/migrate.sh`

2. **Proto & Codegen** (sequential, depends on 1):
   - Update `rbac.proto` (replace `RoleBasedAccessControl` with `PermissionBasedAccessControl`)
   - Add new RPCs and messages to `iam.proto`
   - Update `access_control` options in all 11 proto files
   - Remove `OrganizationRole` enum from `iam.proto`
   - Run `buf generate`
   - Add new sqlc queries to `iam.query.sql`
   - Run `sqlc generate`

3. **Backend Logic** (sequential, depends on 2):
   - Create `permission_lookup.go` (new `PermissionLookup` adapter)
   - Rewrite `auth.go` interceptor (role-based → permission-based)
   - Add role management business logic to IAM logic layer
   - Add role management RPC handlers to IAM connect layer
   - Add role seeding to organization registration flow
   - Wire `PermissionLookup` in `server.go`
   - Cleanup: remove `role_lookup.go`, old constants, old `OrganizationRole` references

4. **Integration Tests** (depends on 3):
   - Write integration tests in `backend/integration/iam_permission_test.go`
   - Cover all 12 quickstart scenarios

5. **Frontend** (parallel with 4):
   - Update `packages/apis/src/iam.ts` with role management wrappers
   - Re-export from `frontend/packages/rpc/index.ts`
   - `pnpm -r build` to refresh workspace artifacts

**Estimated Output**: ~25-30 ordered tasks in tasks.md
**Parallelization**: Proto updates and sqlc query updates can be done in parallel. Frontend tasks independent of integration tests.

## Complexity Tracking

No constitution violations requiring justification. The design follows all constitutional principles:
- Two-layer architecture with proper pool management
- Citus-compliant schema (composite PKs, colocated JOINs, reference tables)
- No cross-schema SQL access
- Integration-first testing
- Stateless design (no caching)

## Progress Tracking

**Phase Status**:
- [x] Phase 0: Research complete (/plan command)
- [x] Phase 1: Design complete (/plan command)
- [x] Phase 2: Task planning complete (/plan command — approach described)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS
- [x] Post-Design Constitution Check: PASS
- [x] All NEEDS CLARIFICATION resolved
- [x] Complexity deviations documented (none)

---
*Based on Constitution v5.8.0 — See `.specify/memory/constitution.md`*
