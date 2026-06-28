# Tasks: Realtime Task Collaboration System

**Feature**: 017-realtime-task-collaboration-system  
**Input**: Design documents from `/specs/017-realtime-task-collaboration-system/`  
**Prerequisites**: plan.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

---

## Phase 3.1: Setup & Schema

### Database Schema & Migrations
- [X] T001 Update `backend/database/scripts/schema.sql` with `collaboration` schema tables (12 tables from data-model.md)
- [X] T002 [P] Create migration `YYYYMMDDHHMMSS_collaboration_project.up.sql` with `collaboration.project` table
- [X] T003 [P] Create migration `YYYYMMDDHHMMSS_collaboration_project.down.sql` (drop table)
- [X] T004 [P] Create migration `YYYYMMDDHHMMSS_collaboration_states_levels.up.sql` with `project_state` and `task_level` tables
- [X] T005 [P] Create migration `YYYYMMDDHHMMSS_collaboration_states_levels.down.sql` (drop tables)
- [X] T006 [P] Create migration `YYYYMMDDHHMMSS_collaboration_task.up.sql` with `task`, `task_assignee`, `task_watcher` tables
- [X] T007 [P] Create migration `YYYYMMDDHHMMSS_collaboration_task.down.sql` (drop tables)
- [X] T008 [P] Create migration `YYYYMMDDHHMMSS_collaboration_custom_fields.up.sql` with `custom_field_definition`, `custom_field_value` tables
- [X] T009 [P] Create migration `YYYYMMDDHHMMSS_collaboration_custom_fields.down.sql` (drop tables)
- [X] T010 [P] Create migration `YYYYMMDDHHMMSS_collaboration_workflow.up.sql` with `workflow_rule`, `workflow_rule_execution` tables
- [X] T011 [P] Create migration `YYYYMMDDHHMMSS_collaboration_workflow.down.sql` (drop tables)
- [X] T012 [P] Create migration `YYYYMMDDHHMMSS_collaboration_membership_views.up.sql` with `project_membership`, `saved_view` tables
- [X] T013 [P] Create migration `YYYYMMDDHHMMSS_collaboration_membership_views.down.sql` (drop tables)
- [X] T014 [P] Create migration `YYYYMMDDHHMMSS_notification_projects_domain.up.sql` to add `'projects'` to notification CHECK constraint
- [X] T015 [P] Create migration `YYYYMMDDHHMMSS_notification_projects_domain.down.sql` (revert CHECK constraint)
- [X] T016 Apply migrations: `cd backend && ./scripts/migrate.sh`

### Code Generation
- [X] T017 Copy `contracts/collaboration.query.sql` to `backend/database/scripts/collaboration.query.sql`
- [X] T018 Run `cd backend && sqlc generate` and commit generated files (`collaboration.query.sql.go`, `models.go`)
- [X] T019 Copy `contracts/collaboration.proto` to `backend/rpc/v1/collaboration.proto`
- [X] T020 Run `cd backend && buf generate` and commit generated backend artifacts

### Constants & Types
- [X] T021 Create `backend/internal/collaboration/constants.go` with:
  - `ProjectVisibility*` constants (public, private)
  - `StateCategory*` constants (todo, in_progress, done, cancelled)
  - `CustomFieldType*` constants (text, number, single_select, multi_select, date, user, checkbox)
  - `WorkflowTriggerType*` constants (state_entered, state_exited, field_changed, task_created)
  - `WorkflowActionType*` constants (set_state, set_field, assign_user, notify, close_task)
  - `ProjectMemberRole*` constants (owner, admin, member, viewer)
  - `TaskAssigneeRole*` constants (assignee, reviewer, approver)
  - `ViewType*` constants (board, list, gantt, calendar)
  - `TaskWatchReason*` constants (manual, mentioned, assigned, reporter, commented)
  - `NotificationPreference*` constants (all, mentions, assigned, muted)

---

## Phase 3.2: Backend Logic Layer

### Logic Layer Interfaces & Structs
- [X] T022 Create `backend/internal/collaboration/logic.go` with:
  - `Logic` struct (Queries, ChatLogic, DocsLogic, NotificationLogic dependencies)
  - `NewLogic()` constructor
  - Interface definitions for cross-domain dependencies

### Project Logic
- [X] T023 Implement `CreateProject(ctx, tx, params)` in `backend/internal/collaboration/project_logic.go`:
  - Create project with atomic task number counter
  - Auto-create default states (Backlog, In Progress, Done) if none provided
  - Auto-create default task levels (Epic, Story, Task, Subtask)
  - Auto-add creator as project owner membership
  - Increment member_count
- [X] T024 Implement `GetProject(ctx, tx, orgID, projectID)` with membership role check
- [X] T025 Implement `UpdateProject(ctx, tx, params)` with owner/admin authorization
- [X] T026 Implement `ListProjects(ctx, tx, orgID, employeeID, cursor, limit)` filtered by membership
- [X] T027 Implement `ArchiveProject(ctx, tx, orgID, projectID, archive)` with owner authorization

### Project State Logic
- [X] T028 Implement `CreateProjectState(ctx, tx, params)` in `backend/internal/collaboration/state_logic.go`
- [X] T029 Implement `UpdateProjectState(ctx, tx, params)` with is_initial mutex enforcement
- [X] T030 Implement `DeleteProjectState(ctx, tx, stateID, migrateToStateID)` with task migration
- [X] T031 Implement `ReorderProjectStates(ctx, tx, projectID, stateIDs)` with position updates
- [X] T032 Implement `ListProjectStates(ctx, tx, orgID, projectID)`

### Task Level Logic
- [X] T033 Implement `CreateTaskLevel(ctx, tx, params)` in `backend/internal/collaboration/level_logic.go`
- [X] T034 Implement `UpdateTaskLevel(ctx, tx, params)`
- [X] T035 Implement `DeleteTaskLevel(ctx, tx, levelID, migrateToLevelID)` with task migration
- [X] T036 Implement `ListTaskLevels(ctx, tx, orgID, projectID)`

### Task Logic
- [X] T037 Implement `CreateTask(ctx, tx, params)` in `backend/internal/collaboration/task_logic.go`:
  - Generate identifier via atomic project counter (e.g., "PROJ-123")
  - Compute depth and path from parent
  - Auto-create chat channel via ChatLogic (channel_type=project_ticket_thread)
  - Auto-create description document via DocsLogic
  - Add reporter as watcher (watch_reason=reporter)
  - Add assignees as watchers (watch_reason=assigned)
  - Increment project task_count
  - Increment parent child_count (if parent exists)
- [X] T038 Implement `GetTask(ctx, tx, orgID, taskID, includeCustomFields)`
- [X] T039 Implement `GetTaskByIdentifier(ctx, tx, orgID, projectID, identifier)`
- [X] T040 Implement `UpdateTask(ctx, tx, params)` with path recalculation on parent change
- [X] T041 Implement `DeleteTask(ctx, tx, taskID, deleteChildren)` with cascade or restrict
- [X] T042 Implement `ListTasks(ctx, tx, params)` with filters (state, assignee, level, parent, root_only, search)
- [X] T043 Implement `MoveTask(ctx, tx, taskID, newStateID)`:
  - Update task state
  - Trigger workflow rules for `state_entered`
  - Publish notification to watchers
  - Return rule execution results

### Task Assignment Logic
- [X] T044 Implement `AssignTask(ctx, tx, taskID, employeeID, role)` in `backend/internal/collaboration/assignment_logic.go`:
  - Create task_assignee record
  - Add assignee as watcher (watch_reason=assigned)
  - Add assignee to chat channel membership
  - Publish notification to assignee
- [X] T045 Implement `UnassignTask(ctx, tx, taskID, employeeID, role)`
- [X] T046 Implement `WatchTask(ctx, tx, taskID, employeeID)` (watch_reason=manual)
- [X] T047 Implement `UnwatchTask(ctx, tx, taskID, employeeID)`

### Custom Field Logic
- [X] T048 Implement `CreateCustomField(ctx, tx, params)` in `backend/internal/collaboration/customfield_logic.go`
- [X] T049 Implement `UpdateCustomField(ctx, tx, params)`
- [X] T050 Implement `ArchiveCustomField(ctx, tx, fieldID, archive)`
- [X] T051 Implement `ListCustomFields(ctx, tx, orgID, projectID, includeArchived)`
- [X] T052 Implement `SetCustomFieldValue(ctx, tx, taskID, fieldID, value)`:
  - Validate value against field type and constraints
  - Upsert custom_field_value record
  - Trigger workflow rules for `field_changed` if applicable

### Workflow Rule Logic
- [X] T053 Implement `CreateWorkflowRule(ctx, tx, params)` in `backend/internal/collaboration/workflow_logic.go`
- [X] T054 Implement `UpdateWorkflowRule(ctx, tx, params)`
- [X] T055 Implement `DeleteWorkflowRule(ctx, tx, ruleID)`
- [X] T056 Implement `ListWorkflowRules(ctx, tx, orgID, projectID, includeDisabled)`
- [X] T057 Implement `ExecuteRulesForStateTrigger(ctx, tx, projectID, stateID, task, triggeredBy)`:
  - Fetch enabled rules for state_entered trigger
  - Execute actions (set_state, set_field, assign_user, notify, close_task)
  - Log execution in workflow_rule_execution table
  - Return execution results

### Project Membership Logic
- [X] T058 Implement `AddProjectMember(ctx, tx, projectID, employeeID, role)` in `backend/internal/collaboration/membership_logic.go`:
  - Create membership record
  - Increment project member_count
- [X] T059 Implement `RemoveProjectMember(ctx, tx, projectID, employeeID)`:
  - Delete membership record
  - Decrement project member_count
- [X] T060 Implement `UpdateProjectMemberRole(ctx, tx, projectID, employeeID, role)`
- [X] T061 Implement `ListProjectMembers(ctx, tx, orgID, projectID)`
- [X] T062 Implement `GetProjectMemberRole(ctx, tx, orgID, projectID, employeeID)` for authorization checks
- [X] T063 Implement `CheckProjectAccess(ctx, tx, orgID, projectID, employeeID, requiredRoles)`:
  - Return true if member has one of required roles
  - Support public project access for non-members

### Saved View Logic
- [X] T064 Implement `CreateSavedView(ctx, tx, params)` in `backend/internal/collaboration/view_logic.go`
- [X] T065 Implement `UpdateSavedView(ctx, tx, params)` with is_default mutex per user
- [X] T066 Implement `DeleteSavedView(ctx, tx, viewID)` with ownership check
- [X] T067 Implement `ListSavedViews(ctx, tx, orgID, projectID, employeeID)` (shared + personal)

### Analytics Logic
- [X] T068 Implement `GetTaskAnalytics(ctx, tx, params)` in `backend/internal/collaboration/analytics_logic.go`:
  - Build dynamic query based on groupBy, aggregations, filters
  - Execute query and aggregate results
  - Return structured rows and summary
- [X] T069 Implement `ExportTasksCSV(ctx, tx, params)`:
  - Fetch tasks with filters
  - Generate CSV with requested columns
  - Return CSV bytes

---

## Phase 3.3: Backend Connect Layer

### Connect Service Implementation
- [X] T070 Create `backend/internal/collaboration/connect.go` with:
  - `CollaborationServiceServer` struct
  - `TenantPool`, `AdminPool`, `Logic` dependencies
  - Constructor `NewCollaborationServiceServer()`

### Project RPC Handlers
- [X] T071 Implement `CreateProject(ctx, req)` in `backend/internal/collaboration/connect.go`
- [X] T072 Implement `GetProject(ctx, req)` with membership role in response
- [X] T073 Implement `UpdateProject(ctx, req)`
- [X] T074 Implement `ListProjects(ctx, req)`
- [X] T075 Implement `ArchiveProject(ctx, req)`

### Project State RPC Handlers
- [X] T076 Implement `CreateProjectState(ctx, req)`
- [X] T077 Implement `UpdateProjectState(ctx, req)`
- [X] T078 Implement `DeleteProjectState(ctx, req)` with task migration
- [X] T079 Implement `ReorderProjectStates(ctx, req)`
- [X] T080 Implement `ListProjectStates(ctx, req)`

### Task Level RPC Handlers
- [X] T081 Implement `CreateTaskLevel(ctx, req)`
- [X] T082 Implement `UpdateTaskLevel(ctx, req)`
- [X] T083 Implement `DeleteTaskLevel(ctx, req)` with task migration
- [X] T084 Implement `ListTaskLevels(ctx, req)`

### Task RPC Handlers
- [X] T085 Implement `CreateTask(ctx, req)` with cross-domain integrations
- [X] T086 Implement `GetTask(ctx, req)` with custom fields and watchers
- [X] T087 Implement `UpdateTask(ctx, req)` with workflow rule execution
- [X] T088 Implement `DeleteTask(ctx, req)` with cascade option
- [X] T089 Implement `ListTasks(ctx, req)` with filters and pagination
- [X] T090 Implement `MoveTask(ctx, req)` with workflow rule execution
- [X] T091 Implement `GetTaskByIdentifier(ctx, req)`

### Task Assignment RPC Handlers
- [X] T092 Implement `AssignTask(ctx, req)`
- [X] T093 Implement `UnassignTask(ctx, req)`
- [X] T094 Implement `WatchTask(ctx, req)`
- [X] T095 Implement `UnwatchTask(ctx, req)`

### Custom Field RPC Handlers
- [X] T096 Implement `CreateCustomField(ctx, req)`
- [X] T097 Implement `UpdateCustomField(ctx, req)`
- [X] T098 Implement `ArchiveCustomField(ctx, req)`
- [X] T099 Implement `ListCustomFields(ctx, req)`
- [X] T100 Implement `SetCustomFieldValue(ctx, req)`

### Workflow Rule RPC Handlers
- [X] T101 Implement `CreateWorkflowRule(ctx, req)`
- [X] T102 Implement `UpdateWorkflowRule(ctx, req)`
- [X] T103 Implement `DeleteWorkflowRule(ctx, req)`
- [X] T104 Implement `ListWorkflowRules(ctx, req)`

### Project Membership RPC Handlers
- [X] T105 Implement `AddProjectMember(ctx, req)`
- [X] T106 Implement `RemoveProjectMember(ctx, req)`
- [X] T107 Implement `UpdateProjectMemberRole(ctx, req)`
- [X] T108 Implement `ListProjectMembers(ctx, req)`

### Saved View RPC Handlers
- [X] T109 Implement `CreateSavedView(ctx, req)`
- [X] T110 Implement `UpdateSavedView(ctx, req)`
- [X] T111 Implement `DeleteSavedView(ctx, req)`
- [X] T112 Implement `ListSavedViews(ctx, req)`

### Analytics RPC Handlers
- [X] T113 Implement `GetTaskAnalytics(ctx, req)`
- [X] T114 Implement `ExportTasksCSV(ctx, req)`

### Service Registration
- [X] T115 Register `CollaborationServiceServer` in `backend/cmd/server.go`:
  - Inject TenantPool, AdminPool, Queries
  - Inject ChatLogic, DocsLogic, NotificationLogic dependencies
  - Add to ConnectRPC router

---

## Phase 3.4: Frontend Integration

### API Wrappers & Types
- [X] T116 Re-export collaboration service from `frontend/packages/rpc/index.ts`
- [X] T117 Run `cd frontend && pnpm -r build` to refresh workspace artifacts
- [X] T118 Create `frontend/packages/apis/src/collaboration.ts` with:
  - TypeScript interfaces: `Project`, `Task`, `ProjectState`, `TaskLevel`, `CustomFieldDefinition`, `CustomFieldValue`, `WorkflowRule`, `ProjectMember`, `SavedView`
  - Enum types: `ProjectVisibility`, `StateCategory`, `CustomFieldType`, `ProjectMemberRole`, `ViewType`
  - Wrapper functions for all 40+ RPC methods
  - Proto-to-native type conversions (Timestamp → Date)
- [X] T119 Export `collaboration` module from `frontend/packages/apis/src/index.ts`

### Workspace Navigation
- [X] T120 Add "Projects" tab to `frontend/apps/web/src/app/workspace/layout.tsx` tabs array

### Project List Page
- [X] T121 Create `frontend/apps/web/src/app/workspace/projects/page.tsx`:
  - Client-side rendering with `'use client'`
  - Auth guard via `useRequireAuth` hook
  - Fetch projects via `listProjects()` API
  - Display project cards with name, key, task count, member count
  - "New Project" button → create dialog
  - Search/filter functionality

### Project Detail Page
- [X] T122 Create `frontend/apps/web/src/app/workspace/projects/[id]/page.tsx`:
  - Tab navigation: Board, List, Gantt, Calendar, Analytics, Settings
  - Fetch project, states, levels, membership on mount
  - Context provider for project data

### Board View (Kanban)
- [X] T123 Create `frontend/apps/web/src/app/workspace/projects/[id]/components/BoardView.tsx`:
  - Columns for each state
  - Draggable task cards (react-dnd or dnd-kit)
  - Drag-to-move calls `moveTask()` API
  - "Add task" button per column

### List View
- [X] T124 Create `frontend/apps/web/src/app/workspace/projects/[id]/components/ListView.tsx`:
  - MUI DataGrid with task rows
  - Columns: identifier, title, state, assignees, due_date, custom fields
  - Sortable, filterable headers
  - Row click → task detail dialog

### Gantt View
- [X] T125 Create `frontend/apps/web/src/app/workspace/projects/[id]/components/GanttView.tsx`:
  - Placeholder implementation ready for library integration
  - Fetch tasks with dates via `listTasks()` with date filter
  - Render timeline bars
  - Drag-to-resize updates task dates

### Calendar View
- [X] T126 Create `frontend/apps/web/src/app/workspace/projects/[id]/components/CalendarView.tsx`:
  - Placeholder implementation ready for calendar library
  - Tasks displayed on due_date
  - Click date to create task

### Task Detail Dialog
- [X] T127 Create `frontend/apps/web/src/app/workspace/projects/[id]/components/TaskDetailDialog.tsx`:
  - Title editable inline
  - State selector dropdown
  - Assignee picker (multi-select)
  - Custom field editors (dynamic based on field_type)
  - Description link to docs document
  - Comments section (link to chat channel)
  - File attachments upload
  - Subtask list with add button
  - Watchers list

### Settings Components
- [X] T128 Create `frontend/apps/web/src/app/workspace/projects/[id]/components/StatesSettings.tsx`:
  - List states with color, category, position
  - Add/edit/delete state dialogs with validation
  - Set initial state toggle
  - Set closed state toggle

### Task Level Settings Component
- [X] T129 Create `frontend/apps/web/src/app/workspace/projects/[id]/components/LevelsSettings.tsx`:
  - List levels with icon, color, depth
  - Add/edit/delete level dialogs with validation
  - Depth hierarchy management (0-4)

### Project Members Settings Component
- [X] T130 Create `frontend/apps/web/src/app/workspace/projects/[id]/components/MembersSettings.tsx`:
  - List members with role and notification preferences
  - Add member dialog (employee picker)
  - Change role dropdown (owner, admin, member, viewer)
  - Update notification preferences
  - Remove member button with confirmation

### Custom Field Settings Component
- [X] T131 Create `frontend/apps/web/src/app/workspace/projects/[id]/components/CustomFieldsSettings.tsx`:
  - List custom field definitions with type, options
  - Add/edit field dialogs with type-specific configuration
  - Archive/unarchive fields (soft delete)
  - Show archived toggle
  - Validation for duplicate names, required options
  - Support all 7 field types: text, number, single_select, multi_select, date, user, checkbox

### Workflow Rules Settings Component
- [X] T132 Create `frontend/apps/web/src/app/workspace/projects/[id]/components/WorkflowRulesSettings.tsx`:
  - List automation rules with trigger, action, enabled status
  - Add/edit/delete rule dialogs
  - Toggle enable/disable
  - Support 4 trigger types: state_entered, state_exited, field_changed, task_created
  - Support 5 action types: set_state, set_field, assign_user, notify, close_task
  - Dynamic form fields based on trigger/action types

### Analytics View Component
- [X] T133 Create `frontend/apps/web/src/app/workspace/projects/[id]/components/AnalyticsView.tsx`:
  - Project metrics dashboard with 4 metric cards (total tasks, completed, in progress, team members)
  - Overall completion progress bar
  - Task distribution by state with color-coded progress bars and percentages
  - Task distribution by level with color-coded progress bars and percentages
  - Responsive grid layout

### Create Task Dialog Component
- [X] T134 Create `frontend/apps/web/src/app/workspace/projects/[id]/components/CreateTaskDialog.tsx`:
  - Dialog for creating new tasks with validation
  - Required fields: title, level
  - Optional fields: state (defaults to initial state), parent task, start/due dates, estimated hours, assignees
  - Date range validation (start ≤ due)
  - Native HTML5 date inputs
  - Parent task depth limit (max depth 3)
  - Creates task via API and refreshes task list

### Settings Container
- [X] T135 Create `frontend/apps/web/src/app/workspace/projects/[id]/components/SettingsView.tsx`:
  - Vertical tab navigation: States, Levels, Members, Custom Fields, Workflow Rules
  - Each tab renders corresponding settings component
  - Theme-aware styling

---

## Phase 3.5: Integration & Verification

### Backend Integration Tests
- [X] T136 Create `backend/integration/collaboration_project_test.go`:
  - `TestCreateProject_WithDefaultStates` - create project, verify states and levels created
  - `TestListProjects_FilterByMembership` - verify private project visibility
  - `TestArchiveProject_OwnerOnly` - verify authorization
- [X] T137 [P] Create `backend/integration/collaboration_task_test.go`:
  - `TestCreateTask_WithIntegrations` - verify chat channel and doc created
  - `TestCreateTask_HierarchyValidation` - verify depth/path computation
  - `TestMoveTask_TriggerWorkflowRules` - verify rule execution
  - `TestListTasks_FilterByState` - verify state filtering
  - `TestSearchTasks_FullText` - verify PGroonga search
  - **Bug Fix (2024-12-26)**: Fixed slug validation (uppercase→lowercase) and Citus immutable function constraint (CreateTaskWatcher with parameterized timestamp)
- [X] T138 [P] Create `backend/integration/collaboration_customfield_test.go`:
  - `TestCreateCustomField_AllTypes` - test all 7 field types
  - `TestSetCustomFieldValue_Validation` - test constraints
- [X] T139 [P] Create `backend/integration/collaboration_membership_test.go`:
  - `TestAddProjectMember_IncrementCount` - verify counter update
  - `TestProjectAccess_RoleEnforcement` - verify RBAC
- [X] T140 [P] Create `backend/integration/collaboration_analytics_test.go`:
  - `TestGetTaskAnalytics_GroupByState` - verify aggregation
  - `TestExportTasksCSV_WithFilters` - verify CSV generation

### Cross-Stack Constant Synchronization Tests
- [X] T141 Create `backend/integration/collaboration_constants_test.go`:
  - `TestProjectVisibilityConstants` - verify DB CHECK matches Go constants
  - `TestStateCategoryConstants` - verify alignment
  - `TestCustomFieldTypeConstants` - verify alignment
  - `TestWorkflowTriggerTypeConstants` - verify alignment
  - `TestWorkflowActionTypeConstants` - verify alignment
  - `TestProjectMemberRoleConstants` - verify alignment

### Multi-Tenant Isolation Tests
- [X] T142 [P] Add multi-tenant isolation tests in `backend/integration/collaboration_tenant_test.go`:
  - Verify projects from org A not visible to org B
  - Verify tasks isolated by organization_id
  - Verify membership isolation
  - **FIXED (2024-12-26)**: Systematic bug where entity IDs were not set, causing duplicate key errors on zero-UUID
  - Fixed entities: `task_watcher` (2 locations), `saved_view`, `project_state`, `custom_field_definition`, `workflow_rule`
  - Root cause: CreateParams structs missing `ID: dbuuid.Must()` field
  - All Create* calls now generate UUID v7 before insertion

### Bug Fixes
- [X] T143 Fix task creation duplicate key error (2024-12-26):
  - Root cause: CreateTask query requires ID parameter, but task_logic.go was not providing it
  - Fix: Generate UUID v7 using `dbuuid.Must()` before calling CreateTask
  - Added ID field to CreateTaskParams struct
  - This ensures each task gets a unique ID instead of using zero UUID

---

## Phase 3.6: Polish

### Performance & Documentation
- [X] T144 Integrate DocumentEditor component into TaskDetailDialog for task description editing
  - Reuse DocumentEditor from workspace/docs/components
  - Fetch descriptionDocumentId when task dialog opens
  - Show loading state while fetching document
  - Display description in read-only mode by default with "Edit" button
  - Enable editing mode when Edit button clicked
  - Handle document save and refresh after save
  - Add proper data-testid attributes for testing
- [X] T145 Redesign TaskDetailDialog for compact layout
  - Move task metadata to header (identifier, level chip, watch/unwatch, close)
  - Combine title and status in single row (inline editable title + status dropdown)
  - Use compact date pickers side-by-side
  - Replace "Assignees" and "Watching" sections with icon buttons in header
  - Remove wasted vertical space for better information density
  - Keep description editor and metadata footer compact
  - Ensure all interactive elements have data-testid attributes
- [X] T146 Create dedicated task detail page `/workspace/projects/[projectId]/tasks/[taskId]`
  - Create `frontend/apps/web/src/app/workspace/projects/[projectId]/tasks/[taskId]/page.tsx`
  - Share components with TaskDetailDialog (extract common parts)
  - Full-width layout for viewing all task information
  - Sidebar with task metadata, assignees, watchers, custom fields
  - Main area with description, comments, attachments, subtasks
  - Support deep linking from notifications and search results
  - Add breadcrumb navigation (Projects > Project Name > Task Identifier)
- [X] T147 Create `frontend/apps/web/src/app/workspace/projects/README.md` with feature documentation
- [X] T148 Verify all RPC methods have proper error handling and logging
- [X] T149 Optimize TaskDetailSidePanel horizontal space usage (2024-12-27):
  - Redesign layout to use horizontal space efficiently like TaskDetailDialog
  - Combine Status + Assignees in single row (60%/40% split)
  - Place date pickers side-by-side instead of stacked
  - Reduce vertical spacing and font sizes for compact display
  - Improve information density without sacrificing readability
  - Metadata fields in horizontal row instead of vertical stack
- [X] T150 Integrate chat components into task detail page
  - Replace "Comments" placeholder with MessageList component (reused from chat)
  - Replace "Attachments" placeholder with file attachment list from task.fileIds
  - Use FileAttachment component from chat for previewing files with FilePreviewModal
  - Fetch file metadata using getFileMetadataBatch API for proper filename display
  - TaskDetailSidePanel shows first 3 attachments with "View more" link to full page
  - Task detail page shows all attachments in responsive 2-column grid layout
  - Support file preview (PDF, images, office documents) via existing FilePreviewModal
  - All file features work identically to regular chat file attachments
- [X] T150.1 Fix subtasks not displaying on task detail page (2024-12-28):
  - Fixed ListItemButton using wrong Link component (MUI Link → NextLink)
  - Fixed subtask list not refreshing after creation (now calls loadSubtasks())
  - Added debug logging for troubleshooting subtask load issues
  - Subtasks now display correctly and are clickable/navigable
- [X] T151 Add custom field editing to task detail page (2024-12-28):
  - Created CustomFieldEditor component supporting all 7 field types (text, number, single_select, multi_select, date, user, checkbox)
  - Integrated custom field editor into task detail page sidebar
  - Load custom field definitions on page load
  - Display custom field values with inline editing
  - Auto-save custom field value changes via setCustomFieldValue API
  - Update local state optimistically after save
  - Show loading state during save operations
  - Support field constraints (min/max for numbers, options for selects, required fields)
  - **Bug Fix (2024-12-28)**: Fixed custom field rendering and input issues:
    * Single/multi-select fields now correctly validate and display values from options array
    * Text and number fields now use debouncing (500ms) to prevent keystroke interruption
    * Local state management for text/number inputs ensures smooth typing experience
    * Proper cleanup of debounce timers on component unmount
  - **Bug Fix (2024-12-28)**: Fixed custom field value persistence:
    * Root cause: setCustomFieldValue API was incorrectly wrapping all values as stringValue in proto
    * Fixed to pass raw JavaScript values and let protobuf library handle type conversion
    * Now correctly handles string, number, boolean, array (multi_select), and null values
    * Custom field values now save and persist correctly across page reloads
- [ ] T152 Performance test: List 500 tasks in board view < 200ms
- [ ] T152 Performance test: Create task with integrations < 100ms
- [ ] T153 Final smoke test: E2E project → task → move → workflow rule flow

---

## Dependencies

```
T001 → T002-T015 (schema before migrations)
T002-T015 → T016 (migrations before apply)
T016 → T017 (apply migrations before sqlc)
T017 → T018 (copy queries before generate)
T018 → T019 (sqlc before proto)
T019 → T020 (copy proto before generate)
T020 → T021 (proto generate before constants)
T021 → T022-T069 (constants before logic)
T022 → T023-T069 (logic struct before implementations)
T037 (task logic) depends on T023 (project logic) for task number generation
T037 depends on Chat and Docs logic for cross-domain integrations
T023-T069 → T070-T115 (logic before connect)
T115 → T116-T119 (register before frontend API)
T116-T119 → T120-T135 (API before UI)
T070-T115 → T136-T142 (connect before integration tests)
T120-T135 → T143-T148 (UI before polish)
```

---

## Parallel Execution Examples

### Schema & Migrations (T002-T015)
```bash
# All migration files can be created in parallel (different files)
Task: "Create migration YYYYMMDDHHMMSS_collaboration_project.up.sql"
Task: "Create migration YYYYMMDDHHMMSS_collaboration_states_levels.up.sql"
Task: "Create migration YYYYMMDDHHMMSS_collaboration_task.up.sql"
Task: "Create migration YYYYMMDDHHMMSS_collaboration_custom_fields.up.sql"
Task: "Create migration YYYYMMDDHHMMSS_collaboration_workflow.up.sql"
Task: "Create migration YYYYMMDDHHMMSS_collaboration_membership_views.up.sql"
Task: "Create migration YYYYMMDDHHMMSS_notification_projects_domain.up.sql"
```

### Backend Logic Layer (T023-T069)
```bash
# Logic implementations in separate files can run in parallel
Task: "Implement CreateProject in backend/internal/collaboration/project_logic.go"
Task: "Implement CreateProjectState in backend/internal/collaboration/state_logic.go"
Task: "Implement CreateTaskLevel in backend/internal/collaboration/level_logic.go"
Task: "Implement CreateCustomField in backend/internal/collaboration/customfield_logic.go"
Task: "Implement CreateWorkflowRule in backend/internal/collaboration/workflow_logic.go"
Task: "Implement AddProjectMember in backend/internal/collaboration/membership_logic.go"
Task: "Implement CreateSavedView in backend/internal/collaboration/view_logic.go"
```

### Frontend Components (T120-T135)
```bash
# UI components in different files can run in parallel
Task: "Create BoardView.tsx in workspace/projects/[id]/components/"
Task: "Create ListView.tsx in workspace/projects/[id]/components/"
Task: "Create GanttView.tsx in workspace/projects/[id]/components/"
Task: "Create TaskDetailDialog.tsx in workspace/projects/[id]/components/"
Task: "Create CustomFieldEditor.tsx in workspace/projects/[id]/components/"
```

### Integration Tests (T136-T142)
```bash
# All integration test files can run in parallel
Task: "Create collaboration_project_test.go"
Task: "Create collaboration_task_test.go"
Task: "Create collaboration_customfield_test.go"
Task: "Create collaboration_membership_test.go"
Task: "Create collaboration_analytics_test.go"
Task: "Create collaboration_constants_test.go"
Task: "Create collaboration_tenant_test.go"
```

---

## Validation Checklist

- [x] All 40+ proto RPC methods have corresponding implementations (T071-T114)
- [x] All 12 entities have model tasks via sqlc generation (T018)
- [x] Backend integration tests present (T136-T142)
- [x] NO frontend unit/snapshot/component test tasks (Constitution v5.7.0)
- [x] All interactive UI elements have data-testid task (T143)
- [x] Parallel tasks truly independent (different files)
- [x] Each task specifies exact file path
- [x] String constant changes include synchronization tasks (T141)
- [x] Cross-domain integrations handled (Chat, Docs, Notification in T037, T044)
- [x] Service struct includes dependencies for cross-domain logic (T022, T115)

---

## Notes

- **Cross-Domain Integration**: Task creation (T037) requires ChatLogic and DocsLogic injected in T022 and T115
- **Workflow Rules**: Executed atomically within task state update transaction (T043, T057)
- **Custom Fields**: EAV pattern with JSONB values enables flexible analytics queries (T068)
- **Real-time Updates**: Use existing Notification Hub SSE with `source_domain='projects'` (T014)
- **Constitution Compliance**: Two-layer architecture, explicit authorization, tenant isolation

**Total Tasks**: 149  
**Estimated Effort**: ~3-4 weeks with parallel execution

---
*Based on Constitution v5.8.0 - See `.specify/memory/constitution.md`*
