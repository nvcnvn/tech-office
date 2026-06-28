# Tasks: Permission-Based Authorization System

**Input**: Design documents from `/specs/020-authz-redo-with-permission-in/`
**Prerequisites**: plan.md (required), research.md, data-model.md, contracts/, quickstart.md

---

## Phase 3.1: Schema & Migrations

- [X] T001 Update `backend/database/scripts/schema.sql` — Add 3 reference tables (`public.permission`, `public.default_role`, `public.default_role_permission`) with `create_reference_table` calls and seed data (~80 permissions, 3 default roles, role-permission mappings). Add 3 distributed tables (`iam.role`, `iam.role_permission`, `iam.employee_role`) with composite PKs, indexes, and `create_distributed_table` calls colocated with `public.organization`. Remove `iam.organization_membership` table definition and clean up stale `iam.identity_role` definition. Add all table/column comments. See `data-model.md` for exact DDL and seed INSERT statements.

- [X] T002 Create migration `backend/k8s/base/database/migrations/20260302000001_create_permission_ref_tables.up.sql` — Create `public.permission`, `public.default_role`, `public.default_role_permission` with reference table declarations and seed data. Create corresponding `.down.sql` that drops tables in reverse order.

- [X] T003 Create migration `backend/k8s/base/database/migrations/20260302000002_create_iam_role_tables.up.sql` — Create `iam.role`, `iam.role_permission`, `iam.employee_role` with distributed table declarations, indexes, and foreign keys. Create corresponding `.down.sql` that drops tables in reverse order.

- [X] T004 Create migration `backend/k8s/base/database/migrations/20260302000003_migrate_membership_to_roles.up.sql` — Seed `iam.role` and `iam.role_permission` for each existing organization from default tables. Migrate `iam.organization_membership` role assignments into `iam.employee_role` by matching `user_id`→`employee_id` via `organization.employee`. Drop `iam.organization_membership`. Create corresponding `.down.sql` that recreates `organization_membership` and reverses the migration.

- [X] T005 Apply migrations: run `cd backend && ./scripts/migrate.sh` and verify tables exist with `docker compose exec postgres psql -U postgres -d tech_office_db -c "\dt iam.*"` and `docker compose exec postgres psql -U postgres -d tech_office_db -c "\dt public.permission"`.

## Phase 3.2: Proto & Codegen

- [X] T006 Rewrite `backend/rpc/v1/rbac.proto` — Remove `enum Role` and `message RoleBasedAccessControl` entirely. Add `message PermissionBasedAccessControl` with `repeated string required_permissions = 1` and `bool allow_unauthenticated = 2`. Keep extension field number `90000`. See `contracts/rbac.proto` for exact definition.

- [X] T007 Update `backend/rpc/v1/iam.proto` — Add 10 new RPCs to `IAMService` (ListPermissions, CreateRole, UpdateRole, DeleteRole, ListRoles, GetRole, AssignRole, RevokeRole, ListEmployeeRoles, GetEmployeePermissions) with `access_control` options. Add all new messages (Permission, PermissionGroup, OrgRole, all request/response types). Remove `enum OrganizationRole`. Update entity messages: `OrganizationMembership` (`role`→`repeated string role_names`), `Invitation` (`role`→`role_id`+`role_name`), `SwitchOrganizationResponse` (`role`→`repeated string role_names`), `InviteUserRequest` (`role`→`string role_id`). Migrate all existing IAM RPC `access_control` options from `allowed_roles` to `required_permissions` per mapping table in `contracts/README.md` §3.

- [X] T008 [P] Update `backend/rpc/v1/chat.proto` and `backend/rpc/v1/chat_files.proto` — Replace all `allowed_roles` in `access_control` options with `required_permissions` using `chat.*` permission strings per `contracts/README.md` §3. Remove any imports of the old `Role` enum.

- [X] T009 [P] Update `backend/rpc/v1/collaboration.proto` — Replace all `allowed_roles` in `access_control` options with `required_permissions` using `collab.*` permission strings per `contracts/README.md` §3.

- [X] T010 [P] Update `backend/rpc/v1/document.proto` and `backend/rpc/v1/files.proto` — Replace all `allowed_roles` with `required_permissions` using `docs.*` and `files.*` permission strings respectively.

- [X] T011 [P] Update `backend/rpc/v1/notification.proto`, `backend/rpc/v1/organization.proto`, `backend/rpc/v1/department.proto`, and `backend/rpc/v1/preference.proto` — Replace all `allowed_roles` with `required_permissions` using `notif.*`, `org.*`, `dept.*`, and `pref.*` permission strings respectively.

- [X] T012 Run `cd backend && buf generate` to regenerate Go code from updated proto definitions. Verify no `buf lint` errors.

- [X] T013 Update `backend/database/scripts/iam.query.sql` — Add all new sqlc queries: `GetUserPermissionsInOrg`, `CreateRole`, `GetRole`, `ListRoles`, `UpdateRole`, `DeleteRole`, `GetRolePermissions`, `SetRolePermissions`, `ClearRolePermissions`, `AssignRoleToEmployee`, `RevokeRoleFromEmployee`, `ListEmployeeRoles`, `GetEmployeePermissions`, `SeedOrgRolesFromDefaults`, `SeedOrgRolePermissionsFromDefaults`, `ListPermissions`, `ListPermissionsByDomain`. Remove old queries: `GetUserRolesInOrg` and any legacy role-related queries. See `data-model.md` §Key SQL Queries for exact SQL.

- [X] T014 Run `cd backend && sqlc generate` to regenerate Go query code. Verify no sqlc compilation errors.

## Phase 3.3: Backend Logic

- [X] T015 Create `backend/internal/iam/permission_lookup.go` — Define `PermissionLookup` interface with `GetPermissionsForUserInOrg(ctx context.Context, userID, orgID string) ([]string, error)`. Implement using `database.Queries.GetUserPermissionsInOrg`. This adapter is injected into the auth interceptor. Follow the pattern from the current `role_lookup.go` but for permissions.

- [X] T016 Rewrite `backend/internal/interceptor/auth.go` — Replace `RoleLookup` with `PermissionLookup` interface. Update `extractAccessControl` to parse `PermissionBasedAccessControl` instead of `RoleBasedAccessControl`. Replace `hasRequiredRole` with `hasRequiredPermission(userPermissions map[string]struct{}, requiredPermissions []string) bool` (OR semantics — any one permission suffices). Replace `UserRolesFromContext`/`userRolesKey` with `UserPermissionsFromContext`/`userPermissionsKey`. Update `AuthenticateHTTPRequest` signature to accept `requiredPermissions []string` instead of `requiredRoles`. See `research.md` Decision 6 for full change list.

- [X] T017 Update `backend/internal/iam/logic.go` — Add role management business logic methods to the IAM logic layer. Each method accepts `tx database.DBTX` and parsed auth context (employeeID, orgID). Methods: `CreateRole`, `UpdateRole` (with lockout prevention — cannot remove `iam.manageRoles` from Owner system role), `DeleteRole` (prevent deletion of system roles), `ListRoles`, `GetRole` (include permissions and employee count), `AssignRole`, `RevokeRole`, `ListEmployeeRoles`, `GetEmployeePermissions`, `ListPermissions`. Also add `SeedOrgRoles(tx, orgID)` and `AssignOwnerRole(tx, orgID, employeeID)` for org registration.

- [X] T018 Update `backend/internal/iam/connect.go` — Add RPC handlers for all 10 new RPCs. Each handler: extracts auth context, obtains TenantPool connection (or AdminPool for ListPermissions), calls `txn.WithTxn` wrapping the logic layer method, maps result to proto response. Follow existing handler patterns in the file.

- [X] T019 Update `backend/internal/iam/constants.go` — Remove old role constants (`RoleAdmin`, `RoleOwner`, `RoleOperator`, `RoleEmployee`) and any helper functions mapping old role enums. These are replaced by `public.default_role` database rows.

- [X] T020 Update `backend/internal/organization/logic.go` — In the organization registration flow (after creating org + employee), call IAM logic layer's `SeedOrgRoles` to copy default roles/permissions, then `AssignOwnerRole` to assign the registering user the Owner role. Both calls must share the same transaction. Declare IAM logic layer as a dependency in the organization logic constructor.

- [X] T021 Update `backend/cmd/server.go` — Wire `PermissionLookup` (from `permission_lookup.go`) into the auth interceptor instead of `RoleLookup`. Update IAM logic/connect layer initialization to include new dependencies. Remove `RoleLookup` wiring.

- [X] T022 Delete `backend/internal/iam/role_lookup.go`. Grep codebase for any remaining references to `RoleLookup`, `UserRolesFromContext`, `GetUserRolesInOrg`, `OrganizationRole`, `dbRoleToProtoRole`, `hasRequiredRole`, or old role constants and fix all compilation errors.

## Phase 3.4: Integration Tests

<!-- Constitution v5.7.0: Integration tests using RPC clients + dev tokens — mimic real frontend calls -->

- [X] T023 Create `backend/integration/iam_permission_test.go` — Set up test scaffolding using the project's `testWorld` pattern. Implement **Scenario 1** (Default roles exist for new organizations: register org → ListRoles → assert 3 system roles with correct permission sets) and **Scenario 11** (Custom role CRUD lifecycle: ListPermissions → CreateRole → ListRoles → UpdateRole → GetRole → AssignRole → ListEmployeeRoles → GetEmployeePermissions → RevokeRole → DeleteRole → verify cleanup). These form the baseline tests.

- [X] T024 [P] Add tests for **Scenario 2** (Permission denied for missing permission: employee calls CreateDepartment → assert PERMISSION_DENIED), **Scenario 5** (OR semantics: employee with `chat.createChannel` calls CreateChannel → success), and **Scenario 7** (Unauthenticated endpoints: call Login without auth header → success).

- [X] T025 [P] Add tests for **Scenario 3** (Union of permissions across multiple roles: create custom role with `collab.archiveProject` → assign to employee alongside Employee role → call ArchiveProject → success) and **Scenario 4** (Permission removal takes immediate effect: create role → assign → verify access → remove permission → verify denied).

- [X] T026 [P] Add tests for **Scenario 8** (Role deletion cascades: create role → assign to 3 employees → delete role → verify permissions removed), **Scenario 9** (System roles cannot be deleted: attempt DeleteRole on Owner → assert error), and **Scenario 10** (Lockout prevention: attempt UpdateRole on Owner removing `iam.manageRoles` → assert error).

- [X] T027 Add **Scenario 12** instrumentation — Add `slog.Info` timing around the `GetPermissionsForUserInOrg` call in the auth interceptor (`backend/internal/interceptor/auth.go`). Verify in test logs that permission resolution completes within acceptable latency. This is observability, not a pass/fail test.

## Phase 3.5: Frontend & Polish

- [X] T028 [P] Update `frontend/packages/apis/src/iam.ts` — Add API wrappers for all 10 new IAM RPCs: `listPermissions`, `createRole`, `updateRole`, `deleteRole`, `listRoles`, `getRole`, `assignRole`, `revokeRole`, `listEmployeeRoles`, `getEmployeePermissions`. Follow existing wrapper patterns in the file. Re-export new types from `frontend/packages/rpc/` if needed.

- [X] T029 Run `cd frontend && pnpm -r build` to verify the frontend workspace builds with updated proto types and API wrappers. Fix any TypeScript compilation errors from removed `OrganizationRole` enum or changed entity message shapes.

- [X] T030 Build `frontend/apps/web/src/app/workspace/organization/components/PermissionsTab.tsx` — Replace the placeholder with a working role-management workspace that lists roles, shows role-permission relationships by domain, supports custom role create/update/delete, and allows assigning or revoking roles for employees while displaying each employee's effective permissions.

- [X] T031 Update `frontend/apps/web/src/app/workspace/profile/page.tsx` — Replace the invitation dialog's raw role UUID input with a live role picker backed by `ListRoles`, defaulting to the Employee role when available.

- [X] T032 Run `cd frontend && pnpm -r build` to verify the new role-management UI and invitation picker compile cleanly.

---

## Dependencies

```
T001 → T002 → T003 → T004 → T005  (schema before migrations, migrations in order)
T005 → T006                         (DB ready before proto changes)
T006 → T007                         (rbac.proto before iam.proto uses it)
T006 → T008, T009, T010, T011       (rbac.proto before other protos import it)
T007..T011 → T012                   (all proto files updated before buf generate)
T005 → T013                         (DB tables exist before writing queries)
T012, T013 → T014                   (proto + queries ready before sqlc generate)
T014 → T015                         (generated code ready for permission_lookup)
T014 → T016                         (generated code ready for interceptor rewrite)
T015 → T016                         (PermissionLookup interface defined before interceptor uses it)
T014, T016 → T017                   (generated code + interceptor ready for logic layer)
T017 → T018                         (logic layer before connect layer)
T014 → T019                         (generated code ready, can remove old constants)
T017 → T020                         (IAM logic ready for org registration integration)
T015, T018, T020 → T021             (all components ready for server wiring)
T021 → T022                         (server compiles before deleting old files)
T022 → T023..T027                   (clean build before integration tests)
T023 → T024, T025, T026             (test scaffolding before parallel test scenarios)
T012 → T028                         (proto types generated before frontend wrappers)
T028 → T029                         (wrappers written before build verification)
```

## Parallel Execution Examples

```
# After T006 completes — launch proto file updates together:
Task T008: "Update chat.proto + chat_files.proto access_control"
Task T009: "Update collaboration.proto access_control"
Task T010: "Update document.proto + files.proto access_control"
Task T011: "Update notification.proto + organization.proto + department.proto + preference.proto access_control"

# After T023 completes — launch test scenarios together:
Task T024: "Permission denied + OR semantics + unauthenticated tests"
Task T025: "Union of permissions + immediate effect tests"
Task T026: "Cascade deletion + system role protection + lockout tests"

# Frontend independent of integration tests — run in parallel:
Task T028: "Update frontend IAM API wrappers"     (parallel with T023..T027)
```

## Notes

- [P] tasks = different files or independent test functions, no dependencies
- All proto `access_control` changes use permission strings from spec §FR-006 and `contracts/README.md` §3
- No caching for permission resolution — per user directive
- No backward compatibility — clean removal of all old role constructs
- Lockout prevention: Owner system role must always retain `iam.manageRoles` and `iam.viewRoles`
- `dbuuid` package for all UUID operations (not `github.com/google/uuid` directly)
- Integration tests use `devjwt.NewDevJWTSigner` + RPC clients per project conventions
- Frontend unit/snapshot tests FORBIDDEN — manual testing only (Constitution v5.7.0)
- Commit after each task
