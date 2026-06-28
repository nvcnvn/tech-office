# Task Collaboration System

**Feature**: 017-realtime-task-collaboration-system

## Overview

The Task Collaboration System provides Jira/Trello-style project and task management with customizable workflows, hierarchical task organization, and cross-domain integrations.

## Features

### Project Management
- **Project Creation**: Create projects with unique keys (e.g., "PROJ") for task identification
- **States Configuration**: Define custom workflow states with categories (Todo, In Progress, Done, Cancelled)
- **Task Levels**: Hierarchical task organization (Epic → Story → Task → Subtask → Checklist)
- **Members & Roles**: Role-based access control (Owner, Admin, Member, Viewer)
- **Workflow Rules**: Automated actions triggered by state transitions or field changes

### Task Management
- **CRUD Operations**: Create, read, update, delete tasks with validation
- **Hierarchy**: Support up to 5 levels of task nesting with parent-child relationships
- **Task Identifiers**: Auto-generated human-readable IDs (e.g., "PROJ-123")
- **States**: Move tasks between workflow states with drag-and-drop
- **Scheduling**: Start date, due date, and estimated hours tracking
- **Assignments**: Multi-assignee support with roles (Assignee, Reviewer, Approver)
- **Watchers**: Subscribe to task notifications (auto-subscribe on assignment/comment)

### Custom Fields
- **Field Types**: Text, Number, Single Select, Multi Select, Date, User (Employee), Checkbox
- **Validation**: Min/max values for numbers, required fields, option constraints
- **Default Values**: Pre-populate fields on task creation
- **Per-Project**: Custom fields are defined per project

### Cross-Domain Integrations
- **Chat Integration**: Each task has a linked chat channel (type: `project_ticket_thread`)
- **Docs Integration**: Rich task descriptions stored as documents with versioning
- **Files Integration**: Attach files to tasks via `file_ids[]` array

### Views
- **Board View**: Kanban-style board with drag-and-drop task cards
- **List View**: Tabular view with sorting, filtering, and inline editing
- **Gantt View**: Timeline view for scheduling and dependencies (future)
- **Calendar View**: Date-based calendar for tasks with due dates (future)
- **Analytics View**: Task distribution charts and CSV export

### Analytics & Reporting
- **Task Distribution**: Group tasks by state, level, assignee, custom fields
- **CSV Export**: Export filtered tasks with custom fields for external analysis
- **Counters**: Denormalized counters for performance (member_count, task_count, child_count)

## Architecture

### Frontend Structure

```
frontend/apps/web/src/app/workspace/projects/
├── page.tsx                    # Project listing page
├── [id]/
│   ├── page.tsx               # Project detail page (view selector)
│   └── components/
│       ├── BoardView.tsx      # Kanban board with DnD
│       ├── ListView.tsx       # Table view
│       ├── GanttView.tsx      # Timeline view
│       ├── CalendarView.tsx   # Calendar view
│       ├── AnalyticsView.tsx  # Charts and export
│       ├── SettingsView.tsx   # Project settings hub
│       ├── CreateTaskDialog.tsx
│       ├── TaskDetailDialog.tsx
│       ├── StatesSettings.tsx
│       ├── LevelsSettings.tsx
│       ├── CustomFieldsSettings.tsx
│       ├── MembersSettings.tsx
│       └── WorkflowRulesSettings.tsx
```

### Backend Structure

```
backend/internal/collaboration/
├── logic.go          # Business logic layer (pool-agnostic)
├── connect.go        # Connect RPC layer (handles auth, transactions)
├── constants.go      # String constants aligned with proto
├── errors.go         # Domain errors
├── analytics.go      # Analytics queries
└── validation.go     # Input validation
```

### Database Schema

**Core Tables** (12 tables in `collaboration` schema):
- `project` - Project containers with state configuration
- `project_state` - Customizable task states per project
- `task_level` - Task hierarchy level definitions
- `task` - Core task entity with hierarchy
- `task_assignee` - Task assignment tracking
- `task_watcher` - Task watch/subscription
- `custom_field_definition` - Custom field schemas per project
- `custom_field_value` - Custom field values per task
- `workflow_rule` - Workflow automation rules
- `workflow_rule_execution` - Audit log for rule executions
- `project_membership` - Project membership and roles
- `saved_view` - Saved view configurations

**Citus Distribution**: All tables distributed by `organization_id` for tenant isolation and query performance.

## API Contracts

### Proto Services

**CollaborationService** (`rpc.v1.CollaborationService`):

#### Project Operations
- `CreateProject` - Create new project with default states/levels
- `GetProject` - Retrieve project with states, levels, members
- `UpdateProject` - Update project name/description (key immutable)
- `ArchiveProject` - Soft archive project
- `ListProjects` - List projects with filtering by visibility and membership

#### State Operations
- `CreateProjectState` - Add custom state to project
- `UpdateProjectState` - Modify state name, category, color
- `DeleteProjectState` - Remove state (move tasks to replacement state)
- `ReorderProjectStates` - Update state positions for board ordering
- `ListProjectStates` - Get all states for project

#### Level Operations
- `CreateTaskLevel` - Add task level (Epic, Story, Task, Subtask)
- `UpdateTaskLevel` - Modify level name, icon, color
- `DeleteTaskLevel` - Remove level (disallow if tasks exist)
- `ListTaskLevels` - Get all levels for project

#### Task Operations
- `CreateTask` - Create task with optional integrations (channel, description doc)
- `GetTask` - Retrieve task with all relations
- `UpdateTask` - Modify task fields
- `DeleteTask` - Soft delete task
- `MoveTask` - Move task to different state (triggers workflow rules)
- `AssignTask` - Add assignee with role
- `UnassignTask` - Remove assignee
- `WatchTask` - Subscribe to notifications
- `UnwatchTask` - Unsubscribe from notifications
- `ListTasks` - List tasks with filters (state, level, assignee, parent)

#### Custom Field Operations
- `CreateCustomField` - Define new custom field
- `UpdateCustomField` - Modify field definition
- `ArchiveCustomField` - Soft archive field
- `SetCustomFieldValue` - Set/update field value for task
- `ClearCustomFieldValue` - Remove field value
- `ListCustomFields` - Get all fields for project

#### Workflow Operations
- `CreateWorkflowRule` - Define automation rule
- `UpdateWorkflowRule` - Modify rule conditions/actions
- `DeleteWorkflowRule` - Remove rule
- `EnableWorkflowRule` - Activate rule
- `DisableWorkflowRule` - Deactivate rule
- `ListWorkflowRules` - Get all rules for project
- `ListWorkflowRuleExecutions` - Audit log for rule executions

#### Membership Operations
- `AddProjectMember` - Add employee to project with role
- `UpdateProjectMemberRole` - Change member role
- `RemoveProjectMember` - Remove member (prevent orphan project)
- `ListProjectMembers` - Get all members with roles

#### Analytics Operations
- `GetTaskAnalytics` - Task distribution with grouping and filters
- `ExportTasksCSV` - Export filtered tasks with custom fields

### Authorization

All RPC methods declare `access_control` at proto level:
- **Project CRUD**: `ROLE_ADMIN`, `ROLE_OWNER`, `ROLE_OPERATOR`
- **Task CRUD**: `ROLE_ADMIN`, `ROLE_OWNER`, `ROLE_OPERATOR`, `ROLE_EMPLOYEE`
- **Settings**: Role-based (Owner/Admin for states/levels, Member for custom fields)

## Multi-Tenancy

All data is isolated by `organization_id`:
- Composite primary keys: `(organization_id, id)`
- All queries filter by `organization_id` extracted from auth context
- Cross-tenant access returns `CodeNotFound` (not `CodePermissionDenied`)

## Performance Considerations

### Denormalized Counters
- `project.member_count` - Incremented on AddProjectMember
- `project.task_count` - Incremented on CreateTask
- `department.child_count` - Incremented on CreateDepartment (hierarchy)

**Why?**: Avoid expensive COUNT(*) queries for UI badges and analytics.

### Materialized Path
- `task.path` - Array of ancestor UUIDs from root to parent
- Enables efficient subtree queries: `WHERE $ancestorID = ANY(path)`

### Indexes
- Composite indexes start with `organization_id` for Citus sharding
- Partial indexes for common filters (e.g., `WHERE is_archived = FALSE`)
- GIN indexes for JSONB fields (custom field values, workflow rule conditions)

## Testing

### Integration Tests

**Backend** (`backend/integration/`):
- `collaboration_project_test.go` - Project CRUD and access control
- `collaboration_task_test.go` - Task operations and hierarchy
- `collaboration_customfield_test.go` - Custom field types and validation
- `collaboration_membership_test.go` - Membership RBAC
- `collaboration_analytics_test.go` - Analytics queries and CSV export
- `collaboration_constants_test.go` - Cross-stack constant synchronization
- `collaboration_tenant_test.go` - Multi-tenant isolation

**Test Pattern**:
```go
// Use helper to get test identity
orgID, employeeID, token := GetRandomTestIdentityAndKey(iam.IdentityRoleOwner)

// Create RPC client
client := rpcv1connect.NewCollaborationServiceClient(
    http.DefaultClient,
    "http://localhost:18080",
)

// Make request with Bearer token
req := connect.NewRequest(&rpcv1.CreateProjectRequest{
    Name: "Test Project",
    Key:  "TEST",
})
req.Header().Set("Authorization", "Bearer "+token)

resp, err := client.CreateProject(context.Background(), req)
require.NoError(t, err)
```

### Frontend (Manual Testing)

**E2E Scenarios** (see `specs/017-realtime-task-collaboration-system/quickstart.md`):
1. Create project → Add custom field → Create task → Set field value
2. Drag task to different state → Verify workflow rule execution
3. Add member → Verify role permissions
4. Export tasks to CSV → Verify custom fields included

## Debugging

### Common Issues

**1. Task creation fails with "level not found"**
- Cause: Passing incorrect `level_id` or level from different project
- Fix: Use level IDs from `GetProject` response

**2. Custom field validation fails**
- Cause: Value outside min/max range or invalid option
- Fix: Check field definition constraints in `ListCustomFields`

**3. Workflow rule not executing**
- Cause: Rule disabled or condition not matching
- Fix: Check `workflow_rule.is_enabled` and `trigger_condition`

**4. Member count not incrementing**
- Cause: Transaction rollback or missing counter update
- Fix: Check `AddProjectMember` implementation updates denormalized counter

### Logging

Backend logs at debug level:
```
slog.DebugContext(ctx, "CollaborationLogic.CreateTask",
    "project_id", params.ProjectID,
    "title", params.Title)
```

Frontend logs state changes:
```typescript
console.log('[BoardView] Task moved:', { taskId, fromState, toState });
```

## Configuration

### Environment Variables

**Backend**:
- `DATABASE_URL` - PostgreSQL connection string (requires Citus extension)
- `PORT` - HTTP server port (default: 8080)

**Frontend**:
- `NEXT_PUBLIC_API_URL` - Backend API URL (default: http://localhost:18080)

## Deployment

### Database Migrations

Migrations managed by **golang-migrate**:
```bash
cd backend
./scripts/migrate.sh
```

Migration files location: `backend/k8s/base/database/migrations/`

**Critical**: Always update `backend/database/scripts/schema.sql` BEFORE creating migration files.

### Docker Compose (Local Development)

```bash
cd backend
docker compose up -d postgres
```

Includes:
- PostgreSQL 18 with Citus extension
- PGroonga for multilingual full-text search
- pgTrgm for fuzzy search

## Future Enhancements

**Phase 4 Features** (not yet implemented):
- **Dependencies**: Task blocking relationships and dependency graphs
- **Time Tracking**: Log time spent on tasks with start/stop timers
- **Saved Views**: Persist filter and sort preferences per user
- **Real-time Collaboration**: WebSocket-based live updates for multi-user editing
- **Advanced Analytics**: Burndown charts, velocity tracking, custom reports

## Support

For questions or issues:
1. Check `specs/017-realtime-task-collaboration-system/quickstart.md` for test scenarios
2. Review integration tests for expected behavior
3. Consult `.specify/memory/constitution.md` for architectural principles
