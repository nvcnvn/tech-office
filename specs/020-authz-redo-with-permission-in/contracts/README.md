# Contracts: Permission-Based Authorization — Proto Changes

**Feature Branch**: `020-authz-redo-with-permission-in`  
**Date**: 2026-03-02

This document describes all proto contract changes. Actual `.proto` files in this directory
show the NEW definitions. During implementation, these replace the corresponding sections
in `backend/rpc/v1/`.

---

## 1. rbac.proto — Full Replacement

See [contracts/rbac.proto](rbac.proto).

**Changes**:
- Removed `enum Role` entirely
- Replaced `RoleBasedAccessControl` with `PermissionBasedAccessControl`
- Extension field number `90000` preserved (same wire format position)
- `required_permissions` uses OR semantics (user needs any one)
- `allow_unauthenticated` preserved with identical behavior

---

## 2. iam.proto — New Role Management RPCs

The following RPCs are **added** to `IAMService`:

```protobuf
  // === Permission & Role Management ===

  // ListPermissions: Returns all system-defined permissions grouped by domain.
  // Reads from public.permission reference table (global data).
  rpc ListPermissions(ListPermissionsRequest) returns (ListPermissionsResponse) {
    option (rpc.v1.access_control) = {
      required_permissions: ["iam.viewRoles"]
    };
  }

  // CreateRole: Create a custom role with selected permissions.
  rpc CreateRole(CreateRoleRequest) returns (CreateRoleResponse) {
    option (rpc.v1.access_control) = {
      required_permissions: ["iam.manageRoles"]
    };
  }

  // UpdateRole: Modify a role's name, description, or permissions.
  // Cannot remove lockout-prevention permissions from the Owner system role.
  rpc UpdateRole(UpdateRoleRequest) returns (UpdateRoleResponse) {
    option (rpc.v1.access_control) = {
      required_permissions: ["iam.manageRoles"]
    };
  }

  // DeleteRole: Delete a custom role (system roles cannot be deleted).
  // Cascades: removes all employee assignments and permission mappings.
  rpc DeleteRole(DeleteRoleRequest) returns (DeleteRoleResponse) {
    option (rpc.v1.access_control) = {
      required_permissions: ["iam.manageRoles"]
    };
  }

  // ListRoles: List all roles for the organization (system + custom).
  rpc ListRoles(ListRolesRequest) returns (ListRolesResponse) {
    option (rpc.v1.access_control) = {
      required_permissions: ["iam.viewRoles"]
    };
  }

  // GetRole: Get a single role with its permissions.
  rpc GetRole(GetRoleRequest) returns (GetRoleResponse) {
    option (rpc.v1.access_control) = {
      required_permissions: ["iam.viewRoles"]
    };
  }

  // AssignRole: Assign a role to an employee.
  rpc AssignRole(AssignRoleRequest) returns (AssignRoleResponse) {
    option (rpc.v1.access_control) = {
      required_permissions: ["iam.manageRoles"]
    };
  }

  // RevokeRole: Remove a role from an employee.
  rpc RevokeRole(RevokeRoleRequest) returns (RevokeRoleResponse) {
    option (rpc.v1.access_control) = {
      required_permissions: ["iam.manageRoles"]
    };
  }

  // ListEmployeeRoles: List all roles assigned to a specific employee.
  rpc ListEmployeeRoles(ListEmployeeRolesRequest) returns (ListEmployeeRolesResponse) {
    option (rpc.v1.access_control) = {
      required_permissions: ["iam.viewRoles"]
    };
  }

  // GetEmployeePermissions: Returns the effective permission set for an employee.
  // Computes the union of permissions from all assigned roles.
  rpc GetEmployeePermissions(GetEmployeePermissionsRequest) returns (GetEmployeePermissionsResponse) {
    option (rpc.v1.access_control) = {
      required_permissions: ["iam.viewRoles"]
    };
  }
```

### New Messages (added to iam.proto)

```protobuf
// =============================================================================
// Messages - Permission & Role Management
// =============================================================================

// Permission represents a single system-defined capability.
message Permission {
  // Permission ID (format: "<domain>.<action>")
  string id = 1;

  // Domain grouping (e.g., "chat", "iam", "docs")
  string domain = 2;

  // Human-readable description
  string description = 3;
}

// PermissionGroup represents permissions grouped by domain.
message PermissionGroup {
  // Domain name
  string domain = 1;

  // Permissions in this domain
  repeated Permission permissions = 2;
}

message ListPermissionsRequest {
  // Optional domain filter (e.g., "chat" to list only chat permissions)
  optional string domain = 1;
}

message ListPermissionsResponse {
  // Permissions grouped by domain
  repeated PermissionGroup groups = 1;

  // Total permission count
  int32 total_count = 2;
}

// OrgRole represents an organization-specific role (system or custom).
message OrgRole {
  // Role ID (UUID)
  string id = 1;

  // Display name
  string name = 2;

  // Description
  string description = 3;

  // Whether this is a system role (cannot be deleted)
  bool is_system = 4;

  // Permission IDs assigned to this role
  repeated string permission_ids = 5;

  // Number of employees assigned to this role
  int32 employee_count = 6;
}

message CreateRoleRequest {
  // Display name for the role
  string name = 1;

  // Description of the role
  string description = 2;

  // Permission IDs to assign to the role
  repeated string permission_ids = 3;
}

message CreateRoleResponse {
  // Created role
  OrgRole role = 1;
}

message UpdateRoleRequest {
  // Role ID to update
  string role_id = 1;

  // Updated display name (optional)
  optional string name = 2;

  // Updated description (optional)
  optional string description = 3;

  // Full list of permission IDs (replaces existing set)
  repeated string permission_ids = 4;
}

message UpdateRoleResponse {
  // Updated role
  OrgRole role = 1;
}

message DeleteRoleRequest {
  // Role ID to delete (must not be a system role)
  string role_id = 1;
}

message DeleteRoleResponse {
  // Success message
  string message = 1;
}

message ListRolesRequest {
  // Empty — organization derived from auth context
}

message ListRolesResponse {
  // All roles for the organization (system first, then custom, alphabetical)
  repeated OrgRole roles = 1;
}

message GetRoleRequest {
  // Role ID (UUID)
  string role_id = 1;
}

message GetRoleResponse {
  // Role with permissions
  OrgRole role = 1;
}

message AssignRoleRequest {
  // Employee ID to assign the role to
  string employee_id = 1;

  // Role ID to assign
  string role_id = 2;
}

message AssignRoleResponse {
  // Success message
  string message = 1;
}

message RevokeRoleRequest {
  // Employee ID to revoke the role from
  string employee_id = 1;

  // Role ID to revoke
  string role_id = 2;
}

message RevokeRoleResponse {
  // Success message
  string message = 1;
}

message ListEmployeeRolesRequest {
  // Employee ID (UUID)
  string employee_id = 1;
}

message ListEmployeeRolesResponse {
  // Roles assigned to the employee
  repeated OrgRole roles = 1;
}

message GetEmployeePermissionsRequest {
  // Employee ID (UUID)
  string employee_id = 1;
}

message GetEmployeePermissionsResponse {
  // Effective permissions (union of all assigned roles)
  repeated string permission_ids = 1;

  // Permissions grouped by domain (for UI display)
  repeated PermissionGroup groups = 2;
}
```

---

## 3. All Proto Service Files — access_control Migration

Every RPC in every `.proto` file must change from:
```protobuf
option (rpc.v1.access_control) = {
  allowed_roles: [ROLE_OWNER, ROLE_OPERATOR, ROLE_EMPLOYEE]
  allow_unauthenticated: false
};
```

To the permission-based format:
```protobuf
option (rpc.v1.access_control) = {
  required_permissions: ["<permission_string>"]
};
```

### Existing IAM RPCs — Permission Mapping

| RPC | Old Roles | New Permission | Notes |
|-----|-----------|----------------|-------|
| ExchangeToken | allow_unauthenticated | allow_unauthenticated | No change |
| Login | allow_unauthenticated | allow_unauthenticated | No change |
| ChangePassword | ALL roles | `iam.changePassword` | |
| RequestPasswordReset | allow_unauthenticated | allow_unauthenticated | No change |
| ResetPassword | allow_unauthenticated | allow_unauthenticated | No change |
| Logout | ALL roles | `iam.manageSessions` | |
| LogoutAllSessions | ALL roles | `iam.manageSessions` | |
| GetActiveSessions | ALL roles | `iam.manageSessions` | |
| GetProfile | ALL roles | `iam.viewProfile` | |
| UpdateProfile | ALL roles | `iam.updateProfile` | |
| LinkSSOIdentity | ALL roles | `iam.linkSSO` | |
| UnlinkSSOIdentity | ALL roles | `iam.linkSSO` | |
| GetUserOrganizations | ALL roles | `iam.viewOrganizations` | |
| SwitchOrganization | ALL roles | `iam.switchOrganization` | |
| InviteUser | ADMIN, OWNER | `iam.inviteUser` | |
| CancelInvitation | ADMIN, OWNER | `iam.cancelInvitation` | |
| ListInvitations | ADMIN, OWNER | `iam.listInvitations` | |
| AcceptInvitation | allow_unauthenticated | allow_unauthenticated | No change |
| ListEmployees | ALL roles | `iam.listEmployees` | |
| PreviewEmployeeImport | ADMIN, OWNER | `iam.importEmployees` | |
| ExecuteEmployeeImport | ADMIN, OWNER | `iam.importEmployees` | |

### Other Proto Files — Permission Mapping Summary

**chat.proto**: All RPCs → corresponding `chat.*` permission from spec FR-006.
**collaboration.proto**: All RPCs → corresponding `collab.*` permission.
**document.proto**: All RPCs → corresponding `docs.*` permission.
**notification.proto**: All RPCs → corresponding `notif.*` permission.
**files.proto**: All RPCs → corresponding `files.*` permission.
**organization.proto**: All RPCs → corresponding `org.*` permission.
**department.proto**: All RPCs → corresponding `dept.*` permission.
**preference.proto**: All RPCs → corresponding `pref.*` permission.
**chat_files.proto**: All RPCs → `chat.filesUpload` permission.

The full permission-to-RPC mapping is defined in the spec (FR-006).

---

## 4. Removed Proto Constructs

- `enum Role` (rbac.proto) — removed entirely
- `message RoleBasedAccessControl` (rbac.proto) — replaced by `PermissionBasedAccessControl`
- `enum OrganizationRole` (iam.proto) — removed (roles are now dynamic strings, not a fixed enum)
- `OrganizationRole role` field in `OrganizationMembership` message — replaced by `repeated OrgRole roles`
- `OrganizationRole role` field in `SwitchOrganizationResponse` — replaced by `repeated string permissions`
- `OrganizationRole role` field in `InviteUserRequest` — replaced by `string role_id` (UUID of org role to assign)
- `OrganizationRole role` field in `Invitation` message — replaced by `string role_name`

---

## 5. Modified Entity Messages

### OrganizationMembership (updated)
```protobuf
message OrganizationMembership {
  string id = 1;                        // Membership ID (UUID) — now derived from employee ID
  string organization_id = 2;
  string organization_name = 3;
  string organization_subdomain = 4;
  repeated string role_names = 5;       // CHANGED: was OrganizationRole role
  google.protobuf.Timestamp joined_at = 6;
}
```

### Invitation (updated)
```protobuf
message Invitation {
  string id = 1;
  string email = 2;
  string role_id = 3;                   // CHANGED: was OrganizationRole role — now UUID of the role to assign
  string role_name = 4;                 // NEW: human-readable role name for display
  InvitationStatus status = 5;          // was field 4
  google.protobuf.Timestamp expires_at = 6;  // was field 5
  google.protobuf.Timestamp created_at = 7;  // was field 6
  string invited_by_id = 8;            // was field 7
  string invited_by_name = 9;          // was field 8
}
```

### SwitchOrganizationResponse (updated)
```protobuf
message SwitchOrganizationResponse {
  string access_token = 1;
  int64 expires_at = 2;
  repeated string role_names = 3;       // CHANGED: was OrganizationRole role
}
```

### InviteUserRequest (updated)
```protobuf
message InviteUserRequest {
  string organization_id = 1;
  string email = 2;
  string role_id = 3;                   // CHANGED: was OrganizationRole role — now UUID of org role
}
```
