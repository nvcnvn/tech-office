# Research: Permission-Based Authorization System

**Feature Branch**: `020-authz-redo-with-permission-in`  
**Date**: 2026-03-02

---

## Decision 1: Permission Storage — Citus Reference Tables in `public` Schema

**Decision**: Define default permissions, default roles, and default role-permission mappings as **Citus reference tables** in the `public` schema. When a new organization registers, copy these defaults into per-org distributed tables in the `iam` schema.

**Rationale**:
- User explicitly requested: "the list of default roles and permission link can be defined as a Citus ref table in public schema. When new org registered we copy the data in that ref table to org's permission."
- Reference tables are replicated to every worker node, allowing efficient JOINs with distributed tables without network round-trips.
- No existing Citus reference tables in the codebase — this introduces the pattern (using `SELECT create_reference_table('table_name')`).
- Permissions are system-defined and immutable — perfect fit for reference tables.
- Default roles serve as templates that get copied per-org, not live references.

**Alternatives Considered**:
- Go constants only (no DB): Rejected — roles need to be org-customizable, and permission resolution must happen in SQL for efficiency.
- Distributed tables for defaults: Rejected — defaults are global, not org-scoped. Reference tables are the correct Citus pattern for global lookup data.

**Existing Patterns**: `public.organization` is the only existing public-schema table. All other tables use schema-per-domain. Reference tables are a new pattern.

---

## Decision 2: New Table Design

**Decision**: Create the following tables:

### Reference Tables (public schema — global, immutable system data)

1. **`public.permission`** — Canonical permission registry
   - `id TEXT PRIMARY KEY` (e.g., `chat.sendMessage`)
   - `domain TEXT NOT NULL` (e.g., `chat`)
   - `description TEXT NOT NULL`
   - Uses `SELECT create_reference_table('public.permission')`

2. **`public.default_role`** — Template roles for new organizations
   - `id TEXT PRIMARY KEY` (e.g., `owner`, `operator`, `employee`)
   - `display_name TEXT NOT NULL`
   - `description TEXT NOT NULL`
   - `is_system BOOLEAN NOT NULL DEFAULT false` — system roles can't be deleted from orgs
   - Uses `SELECT create_reference_table('public.default_role')`

3. **`public.default_role_permission`** — Template role→permission mappings
   - `role_id TEXT NOT NULL REFERENCES public.default_role(id)`
   - `permission_id TEXT NOT NULL REFERENCES public.permission(id)`
   - `PRIMARY KEY (role_id, permission_id)`
   - Uses `SELECT create_reference_table('public.default_role_permission')`

### Distributed Tables (iam schema — org-scoped, mutable)

4. **`iam.role`** — Organization-specific roles (copied from defaults + custom)
   - `id UUID DEFAULT uuidv7()`
   - `organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE`
   - `name TEXT NOT NULL` — Display name
   - `description TEXT`
   - `is_system BOOLEAN NOT NULL DEFAULT false` — system roles can't be deleted
   - `source_default_role_id TEXT` — NULL for custom roles, references default_role.id for system-created roles
   - `PRIMARY KEY (organization_id, id)`
   - `UNIQUE (organization_id, name)`
   - Distributed on `organization_id`, colocated with `public.organization`

5. **`iam.role_permission`** — Role→permission mappings per organization
   - `organization_id UUID NOT NULL`
   - `role_id UUID NOT NULL`
   - `permission_id TEXT NOT NULL REFERENCES public.permission(id)`
   - `PRIMARY KEY (organization_id, role_id, permission_id)`
   - `FOREIGN KEY (organization_id, role_id) REFERENCES iam.role(organization_id, id) ON DELETE CASCADE`
   - Distributed on `organization_id`, colocated

6. **`iam.employee_role`** — Employee→role assignments (replaces `organization_membership.role`)
   - `organization_id UUID NOT NULL`
   - `employee_id UUID NOT NULL`
   - `role_id UUID NOT NULL`
   - `assigned_at TIMESTAMPTZ DEFAULT now()`
   - `assigned_by UUID` — who assigned this role
   - `PRIMARY KEY (organization_id, employee_id, role_id)`
   - `FOREIGN KEY (organization_id, role_id) REFERENCES iam.role(organization_id, id) ON DELETE CASCADE`
   - `FOREIGN KEY (organization_id, employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE`
   - Distributed on `organization_id`, colocated

**Rationale**:
- `public.permission` as reference table means permission lookups can be JOINed efficiently on any shard.
- `iam.role` + `iam.role_permission` + `iam.employee_role` are all colocated on `organization_id` enabling efficient local JOINs for permission resolution.
- `iam.employee_role` supports many-to-many (one employee can have multiple roles), enabling the union-of-permissions model from the spec.
- Using TEXT primary key for `public.permission` and `public.default_role` keeps them human-readable and avoids UUID lookups for static data.

---

## Decision 3: Cleanup of Old Role System

**Decision**: Remove the following completely (no backward compatibility needed — user explicitly stated "early development, cleanup as much as possible"):

1. **Drop `iam.organization_membership` table** — Replaced by `iam.employee_role` for role assignments. The `joined_at` and `invited_by` metadata should be preserved on `organization.employee` or `iam.invitation` if not already there.
2. **Drop `iam.identity_role` table** — Already dropped by migration `20260223000001`. Remove from `schema.sql` if still present.
3. **Remove `enum Role` from `rbac.proto`** — Replaced entirely by permission strings.
4. **Remove `RoleBasedAccessControl` message** — Replaced by `PermissionBasedAccessControl`.
5. **Remove `GetUserRolesInOrg` sqlc query** — Replaced by new permission resolution query.
6. **Remove `role_lookup.go`** — Replaced by new permission lookup adapter.
7. **Remove `dbRoleToProtoRole` mapping** — No longer needed.
8. **Remove `hasRequiredRole` from auth interceptor** — Replaced by `hasRequiredPermission`.
9. **Remove `role` column CHECK constraint** on `iam.organization_membership` — Table itself is dropped.
10. **Remove `UserRolesFromContext`** — Replaced by `UserPermissionsFromContext`.
11. **Clean up `iam/constants.go`** — Remove `RoleAdmin`, `RoleOwner`, `RoleOperator`, `RoleEmployee` constants; they become `public.default_role` rows instead.

**Rationale**: User said "don't need to keep any backward compatibility in early development, cleanup as much as possible." Clean removal prevents confusion and dead code.

**Risk Mitigation**: 
- `organization_membership` has `joined_at`/`invited_by` — verify these are captured elsewhere (invitation table has this). The `user_id` → `organization_id` mapping is also needed for basic "which org does this user belong to" queries — this is already on `organization.employee`.
- The `organization_membership` also tracks the basic "user belongs to org" relationship. After removal, the `organization.employee` table + `iam.employee_role` together represent this: an employee exists in the org, and their roles are in `employee_role`.

---

## Decision 4: organization_membership Data Preservation

**Decision**: Before dropping `iam.organization_membership`, migrate existing role assignments into the new `iam.employee_role` table. The migration must:

1. For each row in `organization_membership`, look up the corresponding `employee_id` from `organization.employee` (matching on `user_id` + `organization_id`).
2. Look up the `iam.role` that was created from the matching `public.default_role` for that org.
3. Insert into `iam.employee_role`.

**Alternatives Considered**:
- Keep `organization_membership` alongside new tables: Rejected — user wants maximum cleanup.
- Drop without migration: Possible in dev, but migration is good practice.

---

## Decision 5: Proto Schema Changes

**Decision**: Replace `RoleBasedAccessControl` with `PermissionBasedAccessControl` in `rbac.proto`.

**New Proto Structure**:
```protobuf
message PermissionBasedAccessControl {
  repeated string required_permissions = 1;
  bool allow_unauthenticated = 2;
}

extend google.protobuf.MethodOptions {
  optional PermissionBasedAccessControl access_control = 90000;
}
```

- Keep the same extension field number (90000) — just change the message type.
- Remove the `enum Role` entirely.
- All 11 proto service files must be updated to use `required_permissions` instead of `allowed_roles`.

**Semantics**: `required_permissions` uses OR semantics — user needs ANY ONE of the listed permissions. Empty list + `allow_unauthenticated: false` means "authenticated but no specific permission required."

**Existing Pattern**: Current usage like `allowed_roles: [ROLE_OWNER, ROLE_OPERATOR, ROLE_EMPLOYEE]` becomes `required_permissions: ["chat.createChannel"]` — much more granular.

---

## Decision 6: Interceptor Rewrite Approach

**Decision**: Modify the existing `AuthInterceptor` in-place rather than creating a new interceptor.

**Changes**:
1. Replace `RoleLookup` interface with `PermissionLookup` interface:
   ```go
   type PermissionLookup interface {
       GetPermissionsForUserInOrg(ctx context.Context, userID, orgID string) ([]string, error)
   }
   ```
2. `extractAccessControl` returns `*rpc.PermissionBasedAccessControl` instead of `*rpc.RoleBasedAccessControl`.
3. Replace `hasRequiredRole` with `hasRequiredPermission(userPermissions map[string]struct{}, requiredPermissions []string) bool`.
4. `extractUserInfo` returns `userPermissions` instead of `userRoles`.
5. Context keys: Replace `userRolesKey` with `userPermissionsKey`. Add `UserPermissionsFromContext`.
6. `AuthenticateHTTPRequest` signature changes to accept `requiredPermissions []string` instead of `requiredRoles []rpc.Role`.

**Permission Resolution SQL** (new query to replace `GetUserRolesInOrg`):
```sql
-- name: GetUserPermissionsInOrg :many
SELECT DISTINCT rp.permission_id
FROM iam.employee_role er
JOIN iam.role_permission rp ON (er.organization_id, er.role_id) = (rp.organization_id, rp.role_id)
JOIN organization.employee e ON (er.organization_id, er.employee_id) = (e.organization_id, e.id)
WHERE e.user_id = sqlc.arg('user_id')::uuid
  AND er.organization_id = sqlc.arg('organization_id')::uuid;
```

All JOINs include `organization_id` — Citus-compliant. All tables colocated on `organization_id`.

**Rationale**: 
- Single query resolves all permissions for a user (union across all roles) directly in DB.
- No caching needed (per user requirement — "no caching at this stage").
- JOINs are local (same shard) since all tables are colocated.

---

## Decision 7: Organization Registration Flow

**Decision**: When a new organization registers, automatically copy default roles and permissions:

1. After inserting into `public.organization`, copy all rows from `public.default_role` into `iam.role` for the new org.
2. Copy all rows from `public.default_role_permission` into `iam.role_permission` for the new org.
3. Assign the registering user the "owner" role in the new org.

This happens in the existing organization registration logic (which already creates the org, identity, and employee records).

**Existing Pattern**: `backend/internal/organization/logic.go` likely has `RegisterOrganization` or similar. The role seeding should be added to this flow as part of the same transaction.

---

## Decision 8: Role Management RPCs

**Decision**: Add new RPCs to `IAMService` in `iam.proto`:

- `ListPermissions` — Returns all permissions from `public.permission` reference table (no org filter needed, global data).
- `CreateRole` — Creates custom role in `iam.role` for the caller's org. Requires `iam.manageRoles`.
- `UpdateRole` — Updates role name/description/permissions. Prevents modification of lockout-prevention permissions on owner role. Requires `iam.manageRoles`.
- `DeleteRole` — Deletes non-system custom role. Cascades to `iam.role_permission` and `iam.employee_role`. Requires `iam.manageRoles`.
- `ListRoles` — Lists all roles for the org (system + custom). Requires `iam.viewRoles`.
- `GetRole` — Gets single role with permissions. Requires `iam.viewRoles`.
- `AssignRole` — Assigns role to employee. Requires `iam.manageRoles`.
- `RevokeRole` — Removes role from employee. Requires `iam.manageRoles`.
- `ListEmployeeRoles` — Lists roles for a specific employee. Requires `iam.viewRoles`.
- `GetEmployeePermissions` — Returns effective permission set (union of all roles). Requires `iam.viewRoles`.

**Additional Permissions Needed** (for role management itself):
- `iam.manageRoles` — CreateRole, UpdateRole, DeleteRole, AssignRole, RevokeRole
- `iam.viewRoles` — ListRoles, GetRole, ListEmployeeRoles, GetEmployeePermissions, ListPermissions

These permissions are NOT granted to the default Employee role (only Owner and Operator).

---

## Decision 9: Lockout Prevention

**Decision**: The Owner system role cannot have the following permissions removed:
- `iam.manageRoles`
- `iam.viewRoles`

This prevents lockout where no one can manage roles. Enforced in the `UpdateRole` logic layer — if the role being updated is the owner system role and the update attempts to remove these protected permissions, return an error.

---

## Decision 10: Frontend Impact

**Decision**: Frontend changes are minimal for this feature:
- **API wrappers**: Add new role management functions in `packages/apis/src/iam.ts`.
- **Role Management UI**: New page at `workspace/organization/roles/` (or as a tab under Organization settings).
- **Permission display**: New component showing permission groups by domain.
- **No auth flow changes**: Frontend continues to send JWT in Authorization header. The interceptor handles everything server-side.

---

## Decision 11: AuthenticateHTTPRequest Migration

**Decision**: The `AuthenticateHTTPRequest` method (used for SSE endpoints) must also switch from role-based to permission-based. Current callers pass `[]rpc.Role`; they will instead pass `[]string` of required permission strings.

**Callers to update**: Search for `AuthenticateHTTPRequest` usage across the codebase and update the role list to permission strings.

---

## Key Files to Modify

| File | Change |
|------|--------|
| `backend/rpc/v1/rbac.proto` | Replace `RoleBasedAccessControl` with `PermissionBasedAccessControl`, remove `enum Role` |
| `backend/rpc/v1/iam.proto` | Add new role management RPCs, update all `access_control` to use `required_permissions` |
| `backend/rpc/v1/chat.proto` | Update all `access_control` to use `required_permissions` |
| `backend/rpc/v1/collaboration.proto` | Update all `access_control` to use `required_permissions` |
| `backend/rpc/v1/document.proto` | Update all `access_control` to use `required_permissions` |
| `backend/rpc/v1/notification.proto` | Update all `access_control` to use `required_permissions` |
| `backend/rpc/v1/files.proto` | Update all `access_control` to use `required_permissions` |
| `backend/rpc/v1/organization.proto` | Update all `access_control` to use `required_permissions` |
| `backend/rpc/v1/department.proto` | Update all `access_control` to use `required_permissions` |
| `backend/rpc/v1/preference.proto` | Update all `access_control` to use `required_permissions` |
| `backend/rpc/v1/chat_files.proto` | Update all `access_control` to use `required_permissions` |
| `backend/database/scripts/schema.sql` | Add new tables, remove `identity_role`, drop `organization_membership` |
| `backend/database/scripts/iam.query.sql` | New permission resolution queries, role CRUD queries |
| `backend/internal/interceptor/auth.go` | Replace role-based logic with permission-based |
| `backend/internal/iam/role_lookup.go` | Replace with permission_lookup.go |
| `backend/internal/iam/constants.go` | Remove old role constants |
| `backend/internal/iam/logic.go` | Add role management business logic |
| `backend/internal/iam/connect.go` | Add role management RPC handlers |
| `backend/internal/organization/logic.go` | Seed roles on org registration |
| `backend/cmd/server.go` | Wire `PermissionLookup` instead of `RoleLookup` |
| `backend/k8s/base/database/migrations/` | New migration files |

---

## All NEEDS CLARIFICATION: Resolved

No open questions remain. All decisions are grounded in existing codebase patterns and user directives.
