# Feature Specification: Permission-Based Authorization System

**Feature Branch**: `020-authz-redo-with-permission-in`  
**Created**: 2026-03-02  
**Status**: Draft  
**Input**: User description: "authz redo with permission in API"

---

## User Scenarios & Testing

### Primary User Story

An **organization owner** wants to control exactly what each team member can do within the platform. Instead of being limited to the fixed roles (owner, operator, employee), the owner can create **custom roles** (e.g., "Project Lead", "HR Manager", "Viewer") and assign specific permissions to each role. When an employee calls any API, the system checks whether their role(s) grant the required permission(s) for that action, rather than checking a hardcoded role list.

### Secondary User Stories

1. An **operator** (with permission) creates a "Department Manager" role that can manage department membership and view employee lists, but cannot invite new users or import employees.
2. An **employee** promoted to a custom "Senior Editor" role can now create and delete documents, but still cannot manage organization settings or import employees.
3. A **system administrator** reviewing the platform sees that every API endpoint declares its required permissions in the proto schema, making security audits straightforward.

### Acceptance Scenarios

1. **Given** an organization with default roles (owner, operator, employee), **When** the system is freshly deployed or migrated, **Then** each default role has pre-assigned permissions that exactly match the current behavior (no regression in access).
2. **Given** an owner creates a custom role "Auditor" with only `notification.list` and `collaboration.listProjects` permissions, **When** a user with only the "Auditor" role calls `CreateProject`, **Then** the request is denied with `PERMISSION_DENIED`.
3. **Given** a user has two roles ("Employee" + "Project Lead") where "Project Lead" has `collaboration.archiveProject` permission, **When** the user calls `ArchiveProject`, **Then** the request succeeds because the union of permissions across all roles is checked.
4. **Given** an owner updates a custom role to remove `chat.sendMessage` permission, **When** a user with that role next calls `SendMessage`, **Then** the request is denied immediately (no stale cache).
5. **Given** an API endpoint has `required_permissions: ["chat.createPublicChannel", "chat.createPrivateChannel"]` (OR semantics), **When** a user has only the `chat.createPublicChannel` permission, **Then** the request succeeds.
6. **Given** a user calls an endpoint that requires authentication but has no specific permission requirement, **When** the user is authenticated with any valid role, **Then** the request succeeds.
7. **Given** a proto RPC method has `allow_unauthenticated: true`, **When** an unauthenticated user calls it, **Then** the request still succeeds regardless of permissions.

### Edge Cases

- What happens when a role is deleted that users are currently assigned to? Users lose those permissions immediately; if they have no other roles, they retain only base authenticated access.
- What happens when a permission string in the proto schema doesn't match any known permission? The interceptor denies the request (fail-safe) and logs a warning.
- What happens if an owner accidentally removes all permissions from the "Owner" default role? The system prevents modification of immutable/system-level permissions on the Owner role to avoid lockout.

---

## Requirements

### Functional Requirements

#### Permission Declaration on APIs

- **FR-001**: Every RPC method in every proto service MUST declare its required permissions via the `access_control` method option, replacing the current `allowed_roles` field with a `required_permissions` field.
- **FR-002**: The `access_control` proto option MUST support a list of permission strings. If the user holds **any one** of the listed permissions (OR semantics), access is granted.
- **FR-003**: The `allow_unauthenticated` field MUST be preserved and continue to bypass all permission checks when set to `true`.
- **FR-004**: If an RPC method has no `access_control` option defined, the interceptor MUST deny the request by default (fail-safe, existing behavior preserved).

#### Permission Registry (Comprehensive Permission List)

- **FR-005**: The system MUST define a comprehensive, canonical list of all permissions organized by domain. Each permission string follows the format `<domain>.<action>` (e.g., `chat.createChannel`, `iam.inviteUser`).
- **FR-006**: The complete permission list MUST cover every RPC across all services. The following domains and their permissions are required:

  **IAM Domain** (`iam.*`)
  - `iam.login` — Login, ExchangeToken (also allow_unauthenticated)
  - `iam.changePassword` — ChangePassword
  - `iam.requestPasswordReset` — RequestPasswordReset, ResetPassword (also allow_unauthenticated)
  - `iam.manageSessions` — Logout, LogoutAllSessions, GetActiveSessions
  - `iam.viewProfile` — GetProfile
  - `iam.updateProfile` — UpdateProfile
  - `iam.linkSSO` — LinkSSOIdentity, UnlinkSSOIdentity
  - `iam.viewOrganizations` — GetUserOrganizations
  - `iam.switchOrganization` — SwitchOrganization
  - `iam.inviteUser` — InviteUser
  - `iam.cancelInvitation` — CancelInvitation
  - `iam.listInvitations` — ListInvitations
  - `iam.acceptInvitation` — AcceptInvitation (also allow_unauthenticated)
  - `iam.listEmployees` — ListEmployees
  - `iam.importEmployees` — PreviewEmployeeImport, ExecuteEmployeeImport

  **Organization Domain** (`org.*`)
  - `org.viewOrganization` — GetActiveOrganizationByID, GetOrganizationBySubdomain
  - `org.checkSubdomain` — CheckOrganizationSubdomainAvailable (also allow_unauthenticated)
  - `org.register` — RegisterOrganizationWithAdminPassword (also allow_unauthenticated)
  - `org.searchEmployees` — SearchEmployees, AutocompleteEmployees
  - `org.searchDepartments` — SearchDepartments, AutocompleteDepartments

  **Department Domain** (`dept.*`)
  - `dept.view` — GetDepartmentTree, GetDepartment, GetDepartmentMembers, GetUnassignedEmployees
  - `dept.create` — CreateDepartment
  - `dept.update` — UpdateDepartment
  - `dept.move` — MoveDepartment
  - `dept.delete` — DeleteDepartment
  - `dept.assignEmployee` — AssignEmployeeToDepartment
  - `dept.removeEmployee` — RemoveEmployeeFromDepartment
  - `dept.setManager` — SetDepartmentManager, ClearDepartmentManager

  **Chat Domain** (`chat.*`)
  - `chat.createChannel` — CreateChannel
  - `chat.viewChannel` — GetChannel, ListChannels
  - `chat.updateChannel` — UpdateChannel
  - `chat.archiveChannel` — ArchiveChannel, UnarchiveChannel
  - `chat.joinChannel` — JoinChannel, LeaveChannel
  - `chat.manageMember` — InviteMember, RemoveMember, UpdateMemberRole
  - `chat.listMembers` — ListChannelMembers
  - `chat.updateNotificationPref` — UpdateNotificationPreference
  - `chat.sendMessage` — SendMessage, ReplyToMessage
  - `chat.editMessage` — EditMessage
  - `chat.deleteMessage` — DeleteMessage
  - `chat.viewMessages` — ListMessages, GetMessage, ListReplies, GetMessageById
  - `chat.markRead` — MarkChannelAsRead
  - `chat.react` — AddReaction, RemoveReaction, ListReactions
  - `chat.typing` — StartTyping, StopTyping
  - `chat.search` — SearchChannels, SearchMessages, AutocompleteChannels
  - `chat.directMessage` — CreateOrGetDirectMessage
  - `chat.viewConfig` — GetUserChatConfig, ListRecentChannels
  - `chat.updateConfig` — UpdateRecentChannels, AddChannelToCategory, UpdateChannelCategories, UpdateCategoryLimits, UpdatePinnedChannels, UpdateSidebarCategoryCollapsed
  - `chat.filesUpload` — RequestChannelFileUpload, ConfirmChannelFileUpload

  **Files Domain** (`files.*`)
  - `files.upload` — RequestUploadUrl, ConfirmUpload
  - `files.download` — GetDownloadUrl
  - `files.viewMetadata` — GetFileMetadata, GetFileMetadataBatch
  - `files.list` — ListFiles
  - `files.delete` — DeleteFile, BatchDeleteFiles
  - `files.viewQuota` — GetQuota
  - `files.updateQuota` — UpdateQuota
  - `files.validate` — ValidateFile
  - `files.manageAccess` — SetFileAccessRule, CheckFileAccess
  - `files.search` — SearchFiles
  - `files.pdfConversion` — GetPDFConversionStatus, TriggerPDFConversion
  - `files.contentIndex` — GetContentIndexStatus

  **Documents Domain** (`docs.*`)
  - `docs.create` — CreateDocument
  - `docs.view` — GetDocument, ListDocuments, GetDocumentTree, SearchDocuments, ResolveSlug
  - `docs.update` — UpdateDocument, UpdateDocumentStatus
  - `docs.delete` — DeleteDocument
  - `docs.viewVersions` — ListVersions, GetVersion, GetVersionDiff, GetBlame
  - `docs.manageAccess` — SetAccess, RemoveAccess, ListAccess, CheckAccess
  - `docs.follow` — FollowDocument, UnfollowDocument, ListFollowedDocuments
  - `docs.comment` — AddComment, AddCommentReply, ResolveComment, ListComments, DeleteComment
  - `docs.embed` — CreateEmbed, GetEmbeddedSection, ListEmbeds, ListIncomingCitations, DeleteEmbed
  - `docs.collaborate` — JoinDocument, LeaveDocument, UpdateCursor, ListActiveEditors, Heartbeat
  - `docs.react` — AddReaction, RemoveReaction, GetReactionStats, ListReactions

  **Collaboration Domain** (`collab.*`)
  - `collab.createProject` — CreateProject
  - `collab.viewProject` — GetProject, ListProjects
  - `collab.updateProject` — UpdateProject
  - `collab.archiveProject` — ArchiveProject
  - `collab.manageProjectState` — CreateProjectState, UpdateProjectState, DeleteProjectState, ReorderProjectStates, ListProjectStates
  - `collab.manageTaskLevel` — CreateTaskLevel, UpdateTaskLevel, DeleteTaskLevel, ListTaskLevels
  - `collab.createTask` — CreateTask
  - `collab.viewTask` — GetTask, ListTasks, GetTaskByIdentifier
  - `collab.updateTask` — UpdateTask, MoveTask
  - `collab.deleteTask` — DeleteTask
  - `collab.assignTask` — AssignTask, UnassignTask
  - `collab.watchTask` — WatchTask, UnwatchTask
  - `collab.manageCustomField` — CreateCustomField, UpdateCustomField, ArchiveCustomField, ListCustomFields
  - `collab.setCustomFieldValue` — SetCustomFieldValue
  - `collab.manageWorkflowRule` — CreateWorkflowRule, UpdateWorkflowRule, DeleteWorkflowRule, ListWorkflowRules
  - `collab.manageProjectMember` — AddProjectMember, RemoveProjectMember, UpdateProjectMemberRole, ListProjectMembers
  - `collab.manageSavedView` — CreateSavedView, UpdateSavedView, DeleteSavedView, ListSavedViews
  - `collab.viewAnalytics` — GetTaskAnalytics
  - `collab.exportTasks` — ExportTasksCSV
  - `collab.taskFileUpload` — RequestTaskFileUpload, ConfirmTaskFileUpload

  **Notification Domain** (`notif.*`)
  - `notif.publish` — PublishNotification, PublishBatchNotification
  - `notif.view` — ListNotifications, GetUnreadCount
  - `notif.markRead` — MarkAsRead, MarkAllBeforeTimestampAsRead
  - `notif.delete` — DeleteNotification
  - `notif.stream` — StreamNotifications
  - `notif.updatePresence` — UpdatePresenceStatus
  - `notif.viewPresence` — GetEmployeePresence, GetBatchEmployeePresence
  - `notif.managePushToken` — RegisterPushToken, RevokePushToken, ListPushTokens
  - `notif.presenceSettings` — SetPresenceVisibility, GetPresenceSettings

  **Preference Domain** (`pref.*`)
  - `pref.view` — GetUserPreference
  - `pref.update` — UpdateUserPreference
  - `pref.reset` — ResetUserPreference

#### Default Roles and Permission Mapping

- **FR-007**: The system MUST provide the following default roles that are created automatically for every organization, with permissions that exactly replicate the current behavior:
  - **Owner**: All permissions (full access).
  - **Operator**: All permissions except `iam.importEmployees`, `files.updateQuota`, and role/permission management APIs.
  - **Employee**: All non-administrative permissions. Excludes: `iam.inviteUser`, `iam.cancelInvitation`, `iam.importEmployees`, `dept.create`, `dept.update`, `dept.move`, `dept.delete`, `dept.setManager`, `files.updateQuota`, and any role/permission management APIs.
- **FR-008**: Default roles MUST NOT be deletable. Their permissions MAY be modified by an owner, except for a set of immutable "lockout prevention" permissions on the Owner role (e.g., role management permissions cannot be removed from Owner).

#### Custom Role Management

- **FR-009**: An organization owner (or user with `iam.manageRoles` permission) MUST be able to create custom roles with a name, description, and a selected set of permissions.
- **FR-010**: Custom roles MUST be assignable to employees alongside or instead of default roles.
- **FR-011**: A user's effective permissions MUST be the **union** of all permissions from all their assigned roles.
- **FR-012**: Custom roles MUST be editable and deletable. When a role is deleted, all users assigned to it lose those permissions immediately.
- **FR-013**: The system MUST provide APIs to list all available permissions (for building the IAM/role management UI).

#### New IAM RPCs (Role & Permission Management)

- **FR-014**: The system MUST expose the following new RPCs for role and permission management:
  - `ListPermissions` — Returns the full registry of available permissions grouped by domain.
  - `CreateRole` — Creates a custom role with selected permissions.
  - `UpdateRole` — Modifies a role's name, description, or permissions.
  - `DeleteRole` — Deletes a custom role (not default roles).
  - `ListRoles` — Lists all roles for the organization (default + custom).
  - `GetRole` — Gets a single role with its permissions.
  - `AssignRole` — Assigns a role to an employee.
  - `RevokeRole` — Removes a role from an employee.
  - `ListEmployeeRoles` — Lists all roles assigned to a specific employee.
  - `GetEmployeePermissions` — Returns the effective (union) permission set for an employee.

#### Interceptor Changes

- **FR-015**: The auth interceptor MUST be updated to read `required_permissions` from the proto method options instead of `allowed_roles`.
- **FR-016**: The interceptor MUST resolve the authenticated user's effective permissions (union of all assigned role permissions) and check whether any required permission is present.
- **FR-017**: Permission resolution MUST query the user's effective permissions from the database. No caching required at this stage.
- **FR-018**: The interceptor MUST continue to support `allow_unauthenticated: true` with the same semantics as today.
- **FR-019**: If a method declares `required_permissions` as an empty list but `allow_unauthenticated` is false, the method requires authentication but no specific permission (any authenticated user may call it).

#### Proto Schema Changes

- **FR-020**: The `rbac.proto` MUST be updated to define a new `PermissionBasedAccessControl` message (or modify the existing `RoleBasedAccessControl`) that includes `repeated string required_permissions` and `bool allow_unauthenticated`.
- **FR-021**: Every proto service file MUST be updated to use the new permission-based `access_control` option on all RPC methods.
- **FR-022**: The existing `Role` enum in `rbac.proto` MUST be replaced. No backward compatibility needed (early development).



### Key Entities

- **Permission**: A named capability (e.g., `chat.sendMessage`) that represents a single action or group of closely related actions. Permissions are system-defined and immutable (not user-created).
- **Role**: A named bundle of permissions. Roles can be **default** (system-provided, non-deletable) or **custom** (organization-created). Each role belongs to one organization.
- **Role-Permission Mapping**: Associates a role with the set of permissions it grants. Many-to-many relationship.
- **Employee-Role Assignment**: Associates an employee with one or more roles within their organization. Replaces the current `iam.identity_role.role` text column.

### Scale & Distribution Considerations

- **Expected role count per organization**: Typically 5-20 roles (3 default + custom). Not a scalability concern.
- **Permission set size**: ~80-120 permission strings total. Static, loaded once.
- **Permission resolution frequency**: Once per API request. Must be fast (<5ms additional latency).
- **Citus distribution**: New tables (roles, role_permissions, employee_roles) MUST be distributed on `organization_id` and colocated with existing tables for efficient JOINs.
- **Permission resolution**: No caching required at this stage. Permissions are resolved from the database on each request. Can be optimized later if needed.

---

## Review & Acceptance Checklist

### Content Quality
- [x] No implementation details (languages, frameworks, APIs) — focuses on capabilities
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

### Requirement Completeness
- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

---

## Execution Status

- [x] User description parsed
- [x] Key concepts extracted
- [x] Ambiguities marked
- [x] User scenarios defined
- [x] Requirements generated
- [x] Entities identified
- [x] Review checklist passed
