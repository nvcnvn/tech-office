# Quickstart: Realtime Task Collaboration System

**Feature**: 017-realtime-task-collaboration-system  
**Date**: 2024-12-26  
**Status**: Ready for Implementation

## Overview

This quickstart guide provides test scenarios and example flows for the realtime task collaboration system.

---

## Prerequisites

1. Backend server running: `make run` or `go run ./cmd/main.go`
2. Database migrations applied: `./scripts/migrate.sh`
3. Test organization and employees seeded

---

## Test Scenarios

### 1. Project Creation with Default States

**Scenario**: Create a new project with Scrum-style states.

**RPC Call**:
```json
{
  "name": "Mobile App Development",
  "key": "MOBILE",
  "description": "iOS and Android app for Q1 release",
  "visibility": "PROJECT_VISIBILITY_PRIVATE",
  "default_states": [
    {"name": "Backlog", "color": "#6b7280", "category": "STATE_CATEGORY_TODO", "is_initial": true},
    {"name": "Selected for Development", "color": "#3b82f6", "category": "STATE_CATEGORY_TODO"},
    {"name": "In Progress", "color": "#f59e0b", "category": "STATE_CATEGORY_IN_PROGRESS"},
    {"name": "In Review", "color": "#8b5cf6", "category": "STATE_CATEGORY_IN_PROGRESS"},
    {"name": "Testing", "color": "#ec4899", "category": "STATE_CATEGORY_IN_PROGRESS"},
    {"name": "Done", "color": "#10b981", "category": "STATE_CATEGORY_DONE", "is_closed": true}
  ]
}
```

**Expected Response**:
- Project created with `key: "MOBILE"`
- 6 states created with correct positions
- Default task levels created: Epic, Story, Task, Subtask
- Creator automatically added as project owner

**Integration Test**:
```go
func TestCreateProject_WithDefaultStates(t *testing.T) {
    orgID, _, token := GetRandomTestIdentityAndKey(iam.IdentityRoleOwner)
    
    client := rpcv1connect.NewCollaborationServiceClient(
        http.DefaultClient,
        "http://localhost:18080",
    )
    
    req := connect.NewRequest(&rpcv1.CreateProjectRequest{
        Name: "Test Project",
        Key:  "TEST",
        DefaultStates: []*rpcv1.DefaultState{
            {Name: "Backlog", Color: "#6b7280", Category: rpcv1.StateCategory_STATE_CATEGORY_TODO, IsInitial: true},
            {Name: "Done", Color: "#10b981", Category: rpcv1.StateCategory_STATE_CATEGORY_DONE, IsClosed: true},
        },
    })
    req.Header().Set("Authorization", "Bearer "+token)
    
    resp, err := client.CreateProject(context.Background(), req)
    require.NoError(t, err)
    assert.Equal(t, "TEST", resp.Msg.Project.Key)
    assert.Len(t, resp.Msg.States, 2)
}
```

---

### 2. Task Creation with Chat Channel

**Scenario**: Create a task and verify chat channel is auto-created.

**RPC Call**:
```json
{
  "project_id": "<project_uuid>",
  "title": "Implement login screen",
  "level_id": "<story_level_uuid>",
  "assignee_employee_ids": ["<employee_uuid>"]
}
```

**Expected Response**:
- Task created with identifier `MOBILE-1`
- Chat channel created with `channel_type: project_ticket_thread`
- Reporter, assignees automatically added to channel membership
- Description document created (empty, ready for editing)

**Verification Steps**:
1. Check `collaboration.task.channel_id` is populated
2. Check `chat.channel` has matching channel with correct type
3. Check `chat.channel_membership` includes reporter and assignees
4. Check `docs.document` has linked description document

---

### 3. Task Movement with Workflow Rule Trigger

**Scenario**: Move task to "Done" state, triggering close workflow rule.

**Setup**:
```json
// Create workflow rule
{
  "project_id": "<project_uuid>",
  "name": "Auto-close on Done",
  "trigger_type": "WORKFLOW_TRIGGER_TYPE_STATE_ENTERED",
  "trigger_state_id": "<done_state_uuid>",
  "action_type": "WORKFLOW_ACTION_TYPE_CLOSE_TASK",
  "action_payload": {}
}
```

**RPC Call**:
```json
{
  "task_id": "<task_uuid>",
  "new_state_id": "<done_state_uuid>"
}
```

**Expected Response**:
- Task moved to "Done" state
- Workflow rule executed (returned in `rule_executions`)
- Task marked as closed internally
- Notification sent to watchers

---

### 4. Custom Field Configuration

**Scenario**: Add "Story Points" custom field and set values.

**Step 1: Create Field Definition**:
```json
{
  "project_id": "<project_uuid>",
  "name": "Story Points",
  "field_type": "CUSTOM_FIELD_TYPE_SINGLE_SELECT",
  "options": ["1", "2", "3", "5", "8", "13", "21"]
}
```

**Step 2: Set Field Value on Task**:
```json
{
  "task_id": "<task_uuid>",
  "field_id": "<story_points_field_uuid>",
  "value": "5"
}
```

**Verification**:
- Field value stored in `collaboration.custom_field_value`
- Task response includes `custom_field_values` when `include_custom_fields: true`

---

### 5. Task Hierarchy (Epic → Story → Subtask)

**Scenario**: Create parent-child task hierarchy.

**Step 1: Create Epic**:
```json
{
  "project_id": "<project_uuid>",
  "title": "User Authentication",
  "level_id": "<epic_level_uuid>"  // depth=0
}
```

**Step 2: Create Story under Epic**:
```json
{
  "project_id": "<project_uuid>",
  "title": "Login with email/password",
  "level_id": "<story_level_uuid>",  // depth=1
  "parent_task_id": "<epic_uuid>"
}
```

**Step 3: Create Subtask under Story**:
```json
{
  "project_id": "<project_uuid>",
  "title": "Validate email format",
  "level_id": "<subtask_level_uuid>",  // depth=3
  "parent_task_id": "<story_uuid>"
}
```

**Expected**:
- Subtask has `depth: 2`, `path: [epic_uuid, story_uuid]`
- Epic `child_count` incremented
- Story `child_count` incremented

---

### 6. Board View (Kanban) Data Fetching

**Scenario**: Fetch all tasks grouped by state for board view.

**RPC Call**:
```json
{
  "project_id": "<project_uuid>",
  "root_only": true,
  "include_custom_fields": true
}
```

**Frontend Processing**:
1. Fetch all states via `ListProjectStates`
2. Fetch tasks via `ListTasks` with filters
3. Group tasks by `state_id` client-side
4. Render columns with draggable task cards

---

### 7. Gantt Chart Data Fetching

**Scenario**: Fetch tasks with dates for Gantt timeline.

**SQL Query** (executed by backend):
```sql
SELECT * FROM collaboration.task
WHERE organization_id = $1 
  AND project_id = $2
  AND is_deleted = FALSE
  AND (start_date IS NOT NULL OR due_date IS NOT NULL)
ORDER BY COALESCE(start_date, due_date) ASC;
```

**Response Fields for Gantt**:
- `id`, `identifier`, `title`
- `start_date`, `due_date`
- `parent_task_id` (for hierarchy bars)
- `state_id` (for color coding)
- `assignees` (for resource view)

---

### 8. Analytics Query

**Scenario**: Get story points by assignee for sprint planning.

**RPC Call**:
```json
{
  "project_id": "<project_uuid>",
  "group_by": ["assignee"],
  "aggregations": [
    {"field": "count", "function": "count", "alias": "task_count"},
    {"field": "custom_field:<story_points_field_id>", "function": "sum", "alias": "total_points"}
  ],
  "filters": [
    {"field": "state.category", "operator": "ne", "value": "done"}
  ]
}
```

**Expected Response**:
```json
{
  "rows": [
    {"dimensions": {"assignee": "uuid1"}, "metrics": {"task_count": 5, "total_points": 21}},
    {"dimensions": {"assignee": "uuid2"}, "metrics": {"task_count": 3, "total_points": 13}}
  ],
  "summary": {
    "total_tasks": 8,
    "completed_tasks": 0,
    "open_tasks": 8,
    "completion_rate": 0.0
  }
}
```

---

### 9. Real-time Board Update Flow

**Scenario**: User A moves task, User B sees update in real-time.

**Flow**:
1. User A calls `MoveTask` RPC
2. Backend updates task state in transaction
3. Backend publishes notification:
   ```json
   {
     "source_domain": "projects",
     "notification_type": "task_updated",
     "action_data": {
       "projectId": "<uuid>",
       "taskId": "<uuid>",
       "changeType": "state_changed",
       "previousStateId": "<uuid>",
       "newStateId": "<uuid>"
     }
   }
   ```
4. User B receives SSE event via notification hub
5. Frontend moves task card to new column

---

### 10. Project Access Control

**Scenario**: Verify private project access enforcement.

**Test Cases**:

| Actor | Role | Action | Expected |
|-------|------|--------|----------|
| Owner | owner | Create project | ✅ Allowed |
| Owner | owner | Add member | ✅ Allowed |
| Member | member | Create task | ✅ Allowed |
| Member | member | Add member | ❌ Denied (PermissionDenied) |
| Viewer | viewer | Create task | ❌ Denied (PermissionDenied) |
| Viewer | viewer | View tasks | ✅ Allowed |
| Non-member | - | View project | ❌ Denied (NotFound for private) |

---

## Database Verification Queries

### Check Project Setup
```sql
-- Verify project creation
SELECT * FROM collaboration.project WHERE organization_id = '<org_id>';

-- Verify states created
SELECT * FROM collaboration.project_state 
WHERE organization_id = '<org_id>' AND project_id = '<project_id>'
ORDER BY position;

-- Verify default levels
SELECT * FROM collaboration.task_level
WHERE organization_id = '<org_id>' AND project_id = '<project_id>'
ORDER BY depth;
```

### Check Task with Integrations
```sql
-- Task with channel and document
SELECT 
    t.identifier, t.title, t.state_id,
    c.title_slug AS channel_slug,
    d.title AS doc_title
FROM collaboration.task t
LEFT JOIN chat.channel c ON c.organization_id = t.organization_id AND c.id = t.channel_id
LEFT JOIN docs.document d ON d.organization_id = t.organization_id AND d.id = t.description_document_id
WHERE t.organization_id = '<org_id>' AND t.id = '<task_id>';
```

### Check Custom Field Values
```sql
-- All custom field values for a task
SELECT 
    cfd.name AS field_name,
    cfd.field_type,
    cfv.value
FROM collaboration.custom_field_value cfv
JOIN collaboration.custom_field_definition cfd 
    ON cfd.organization_id = cfv.organization_id AND cfd.id = cfv.field_definition_id
WHERE cfv.organization_id = '<org_id>' AND cfv.task_id = '<task_id>'
ORDER BY cfd.position;
```

---

## Integration Test Template

```go
func TestCollaboration_EndToEnd(t *testing.T) {
    ctx := context.Background()
    orgID, employeeID, token := GetRandomTestIdentityAndKey(iam.IdentityRoleOwner)
    
    client := rpcv1connect.NewCollaborationServiceClient(
        http.DefaultClient,
        "http://localhost:18080",
    )
    
    // 1. Create project
    projectResp, err := client.CreateProject(ctx, connect.NewRequest(&rpcv1.CreateProjectRequest{
        Name: "E2E Test Project",
        Key:  "E2E",
    }).WithHeader("Authorization", "Bearer "+token))
    require.NoError(t, err)
    projectID := projectResp.Msg.Project.Id
    
    // 2. Get initial state
    statesResp, _ := client.ListProjectStates(ctx, connect.NewRequest(&rpcv1.ListProjectStatesRequest{
        ProjectId: projectID,
    }).WithHeader("Authorization", "Bearer "+token))
    initialStateID := statesResp.Msg.States[0].Id
    
    // 3. Get task level
    levelsResp, _ := client.ListTaskLevels(ctx, connect.NewRequest(&rpcv1.ListTaskLevelsRequest{
        ProjectId: projectID,
    }).WithHeader("Authorization", "Bearer "+token))
    taskLevelID := levelsResp.Msg.Levels[2].Id // "Task" level
    
    // 4. Create task
    taskResp, err := client.CreateTask(ctx, connect.NewRequest(&rpcv1.CreateTaskRequest{
        ProjectId: projectID,
        Title:     "Test Task",
        LevelId:   taskLevelID,
    }).WithHeader("Authorization", "Bearer "+token))
    require.NoError(t, err)
    assert.Equal(t, "E2E-1", taskResp.Msg.Task.Identifier)
    
    // 5. Verify chat channel created
    assert.NotEmpty(t, taskResp.Msg.Task.ChannelId)
    
    // 6. Move task to done
    doneStateID := statesResp.Msg.States[len(statesResp.Msg.States)-1].Id
    moveResp, err := client.MoveTask(ctx, connect.NewRequest(&rpcv1.MoveTaskRequest{
        TaskId:     taskResp.Msg.Task.Id,
        NewStateId: doneStateID,
    }).WithHeader("Authorization", "Bearer "+token))
    require.NoError(t, err)
    assert.Equal(t, doneStateID, moveResp.Msg.Task.StateId)
}
```

---

## Performance Benchmarks

| Operation | Target Latency | Notes |
|-----------|----------------|-------|
| Create task | < 100ms | Includes channel + doc creation |
| List tasks (100 items) | < 50ms | With custom fields |
| Move task | < 50ms | With workflow rules |
| Board load (500 tasks) | < 200ms | Initial fetch |
| Real-time update | < 500ms | E2E from move to SSE |
| Analytics query | < 500ms | Complex aggregations |

---

## Ready for /tasks

All design artifacts complete:
- ✅ research.md - Design decisions documented
- ✅ data-model.md - 12 tables with Citus sharding
- ✅ contracts/collaboration.proto - 40+ RPC methods
- ✅ contracts/collaboration.query.sql - 80+ sqlc queries
- ✅ quickstart.md - Test scenarios and examples

Run `/tasks` to generate implementation task breakdown.
