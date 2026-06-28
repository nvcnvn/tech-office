# Research: Realtime Task Collaboration System

**Feature**: 017-realtime-task-collaboration-system  
**Date**: 2024-12-26  
**Status**: Complete

## Overview

This document captures research decisions for the realtime task collaboration system, analyzing existing Tech Office patterns and determining the best approaches for implementation.

---

## Research Topics

### 1. Schema Placement and Domain Design

**Decision**: Create new `collaboration` schema for task collaboration system.

**Rationale**: 
- The `collaboration` schema already exists in schema.sql (declared but empty)
- Task management is a distinct business domain from chat, docs, files
- Follows Tech Office pattern: one schema per business domain
- Enables clean separation of concerns and future extensibility

**Alternatives Considered**:
- Extend `chat` schema: Rejected - tasks are not chat messages; different lifecycle
- Create `tasks` schema: Rejected - `collaboration` already reserved for this purpose
- Use `projects` schema: Rejected - not declared; `collaboration` fits better

**Existing Pattern**: See `docs` schema for hierarchical entities, `chat` schema for integration patterns.

---

### 2. Integration with Chat System (Task Comments)

**Decision**: Auto-create chat channel with `channel_type='project_ticket_thread'` per task.

**Rationale**:
- `project_ticket_thread` already supported in `chat.channel.channel_type` CHECK constraint
- Reuses entire chat infrastructure: messages, replies, reactions, mentions, notifications
- Channel is auto-created on task creation, linked via `channel_id` on task table
- Channel members auto-include: reporter, assignees, watchers
- Channel archival tied to task closure (configurable via workflow rules)

**Implementation Pattern** (from chat spec):
```go
// Task logic layer creates channel via chat logic layer
channel, err := s.ChatLogic.CreateChannel(ctx, tx, chat.CreateChannelParams{
    OrganizationID: orgID,
    TitleSlug:      fmt.Sprintf("task-%s", taskIdentifier),
    DisplayName:    fmt.Sprintf("Task: %s", taskTitle),
    ChannelType:    chat.ChannelTypeProjectTicketThread,
    IsPrivate:      true, // Task channels are always private
    CreatedByEmployeeID: reporterID,
})
```

**Cross-Domain Integration**: Task logic → Chat logic (direct method call, not RPC).

---

### 3. Integration with Docs System (Task Description)

**Decision**: Auto-create document linked to task for rich description editing.

**Rationale**:
- Docs system (#016) provides rich editing, versioning, comments on description
- Task has `description_document_id` foreign key to `docs.document`
- Document visibility inherits from project visibility
- Description document is a child of project's root doc (if project has one) or standalone

**Implementation Pattern**:
```go
// Task logic layer creates document via docs logic layer
doc, err := s.DocsLogic.CreateDocument(ctx, tx, docs.CreateDocumentParams{
    OrganizationID: orgID,
    Title:          fmt.Sprintf("Description: %s", taskTitle),
    OwnerEmployeeID: reporterID,
    Visibility:     docs.VisibilityPrivate, // Inherited from project
})
// Link to task
task.DescriptionDocumentID = dbuuid.UUIDToNullUUID(doc.ID)
```

---

### 4. Integration with Files System (Task Attachments)

**Decision**: Use existing files infrastructure with `upload_context='project'`.

**Rationale**:
- Files system (#014/#015) already supports `upload_context` including 'project'
- `files.file_access_rule` links files to tasks via `context_type='project'` and `context_id=task_id`
- Access scope derived from project visibility
- No schema changes needed in files schema

**Implementation Pattern**:
- Upload API includes `taskId` parameter
- Files service creates access rule with `context_type='project'`, `context_id=taskId`
- Task table has `file_ids UUID[]` array (matches chat.message pattern)

---

### 5. Custom Fields Storage Strategy

**Decision**: Separate tables for definitions and values with JSONB storage for value.

**Rationale**:
- Project-level field definitions in `collaboration.custom_field_definition`
- Per-task values in `collaboration.custom_field_value` with `value JSONB`
- JSONB enables flexible type storage (text, number, array for multi-select, UUID for user)
- Enables analytics queries: `WHERE value->>'story_points' > 5`
- Follows EAV pattern used successfully in many task systems (Jira, Linear)

**Schema Design**:
```sql
-- Definitions at project level
CREATE TABLE collaboration.custom_field_definition (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL,
    project_id UUID NOT NULL,
    name TEXT NOT NULL,
    field_type TEXT NOT NULL CHECK (field_type IN ('text', 'number', 'single_select', 'multi_select', 'date', 'user')),
    options JSONB, -- For select types: ["XS", "S", "M", "L", "XL"]
    default_value JSONB,
    position INT NOT NULL DEFAULT 0,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, id)
);

-- Values per task
CREATE TABLE collaboration.custom_field_value (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL,
    task_id UUID NOT NULL,
    field_definition_id UUID NOT NULL,
    value JSONB NOT NULL, -- Flexible storage for any type
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, id),
    CONSTRAINT unique_task_field UNIQUE (organization_id, task_id, field_definition_id)
);
```

**Alternatives Considered**:
- JSONB column on task table: Rejected - no type enforcement, no foreign key to definitions
- Separate column per field type: Rejected - schema bloat, inflexible
- PostgreSQL HSTORE: Rejected - less powerful than JSONB, no nesting

---

### 6. Task Identifier Generation Strategy

**Decision**: Project-scoped sequential counter with project key prefix.

**Rationale**:
- Human-readable identifiers: PROJ-1, PROJ-2, PROJ-123
- Project table has `key TEXT` (e.g., "PROJ") and `next_task_number INT`
- Atomic increment using `UPDATE ... RETURNING next_task_number`
- Stored on task as `identifier TEXT` (not computed at query time)

**Implementation Pattern**:
```go
// Atomic task number generation
func (l *TaskLogic) generateTaskIdentifier(ctx context.Context, tx database.DBTX, projectID dbuuid.UUID) (string, error) {
    // Atomically increment and return next number
    row, err := l.queries.IncrementProjectTaskNumber(ctx, tx, projectID)
    if err != nil {
        return "", err
    }
    return fmt.Sprintf("%s-%d", row.Key, row.NextTaskNumber-1), nil
}
```

**Concurrency Safety**: `UPDATE ... SET next_task_number = next_task_number + 1 RETURNING next_task_number` is atomic.

---

### 7. Task Hierarchy Implementation

**Decision**: Parent-child with level enforcement and depth limit of 5.

**Rationale**:
- Task has `parent_task_id UUID` and `depth INT` (similar to docs.document)
- Level stored as `level_id UUID` referencing `collaboration.task_level`
- Level hierarchy enforced: Epic(0) → Story(1) → Task(2) → Subtask(3) → Checklist(4)
- Depth enforced via CHECK constraint: `depth <= 5`
- Path materialized for efficient subtree queries: `path UUID[]`

**Schema Design**:
```sql
CREATE TABLE collaboration.task (
    -- ...
    parent_task_id UUID,
    depth SMALLINT NOT NULL DEFAULT 0 CHECK (depth >= 0 AND depth <= 5),
    path UUID[] NOT NULL DEFAULT '{}', -- Ancestor IDs
    level_id UUID NOT NULL,
    -- ...
    CONSTRAINT fk_task_parent
        FOREIGN KEY (organization_id, parent_task_id)
        REFERENCES collaboration.task(organization_id, id)
        ON DELETE RESTRICT
);
```

**Cycle Prevention**: Application-level validation before creating parent-child relationship.

---

### 8. Workflow Rules Engine

**Decision**: Simple rule table with state-based triggers and atomic execution.

**Rationale**:
- Rules stored in `collaboration.workflow_rule`
- Trigger: "when task enters state X"
- Actions: set status, set custom field value (extensible via action_type enum)
- Rules execute synchronously within task update transaction
- Execution logged in `collaboration.workflow_rule_execution`

**Schema Design**:
```sql
CREATE TABLE collaboration.workflow_rule (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL,
    project_id UUID NOT NULL,
    name TEXT NOT NULL,
    trigger_type TEXT NOT NULL DEFAULT 'state_entered' CHECK (trigger_type IN ('state_entered', 'status_changed')),
    trigger_state_id UUID, -- State that triggers this rule
    action_type TEXT NOT NULL CHECK (action_type IN ('set_status', 'set_field')),
    action_payload JSONB NOT NULL, -- {status: "closed"} or {field_id: "uuid", value: "value"}
    position INT NOT NULL DEFAULT 0, -- Execution order
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, id)
);
```

**Execution Pattern**:
```go
// Within task update transaction
rules, err := s.queries.GetActiveRulesForState(ctx, tx, newStateID)
for _, rule := range rules {
    if err := s.executeRule(ctx, tx, task, rule); err != nil {
        return err // Rollback transaction
    }
}
```

---

### 9. Analytics Query Strategy

**Decision**: Dynamic query building with JSONB operators for custom fields.

**Rationale**:
- Backend API accepts groupBy, filters, aggregations as structured request
- Query builder constructs SQL dynamically based on request
- Custom field filters use JSONB operators: `value->>'field_id' = 'value'`
- Aggregations: COUNT(*), SUM(value::numeric), AVG(value::numeric)
- Results returned as structured JSON for frontend table rendering

**Query Pattern**:
```sql
-- Example: Group by state, filter by assignee, sum story points
SELECT 
    s.name AS state_name,
    COUNT(*) AS task_count,
    SUM((cfv.value->>'story_points')::numeric) AS total_points
FROM collaboration.task t
JOIN collaboration.project_state s ON s.id = t.state_id
LEFT JOIN collaboration.custom_field_value cfv ON cfv.task_id = t.id
WHERE t.project_id = $1
  AND t.organization_id = $2
  AND $3 = ANY(t.assignee_ids)
GROUP BY s.id, s.name
ORDER BY s.position;
```

**Performance**: Index on `custom_field_value(organization_id, task_id)` enables efficient joins.

---

### 10. Real-time Updates Architecture

**Decision**: Leverage notification hub SSE with `source_domain='projects'`.

**Rationale**:
- Notification hub (#007) provides SSE infrastructure for real-time delivery
- Add `source_domain='projects'` to notification.notification CHECK constraint
- Board updates broadcast as notifications with `action_data={projectId, taskId, changeType}`
- Ephemeral signals (typing, viewing) use `notification.ephemeral_signal`

**Notification Types**:
- `task_created`: New task added
- `task_updated`: Field change, state change, assignment change
- `task_commented`: New message in task channel
- `task_assigned`: User assigned/unassigned

**Broadcast Pattern**:
```go
// Notify all project members viewing the board
err = s.NotificationLogic.PublishNotification(ctx, tx, &notification.PublishRequest{
    OrganizationID: orgID,
    SourceDomain:   notification.SourceDomainProjects,
    NotificationType: notification.TypeTaskUpdated,
    Title:          fmt.Sprintf("Task %s updated", task.Identifier),
    Message:        fmt.Sprintf("%s moved to %s", task.Title, newState.Name),
    ActionData:     map[string]any{"projectId": projectID, "taskId": taskID, "stateId": newStateID},
    RecipientEmployeeIDs: projectMemberIDs,
})
```

---

### 11. Saved Views Storage

**Decision**: Per-user view configurations stored in `collaboration.saved_view`.

**Rationale**:
- Users can save filter/grouping/column configurations
- Stored as JSONB for flexibility
- Supports board, list, and Gantt views
- Can be shared (project-level) or personal (employee-level)

**Schema Design**:
```sql
CREATE TABLE collaboration.saved_view (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL,
    project_id UUID NOT NULL,
    employee_id UUID, -- NULL = shared view, non-NULL = personal view
    name TEXT NOT NULL,
    view_type TEXT NOT NULL CHECK (view_type IN ('board', 'list', 'gantt')),
    config JSONB NOT NULL, -- {filters: [...], groupBy: [...], columns: [...], sortBy: [...]}
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, id)
);
```

---

### 12. Gantt Chart Data Requirements

**Decision**: Tasks with start/due dates rendered client-side from task list API.

**Rationale**:
- No special backend support needed beyond task dates
- Frontend Gantt library (e.g., Frappe Gantt, DHTMLX) renders from task data
- Parent task bars auto-computed from children's date range
- Drag-to-resize calls task update API with new dates

**API Response Shape**:
```json
{
  "tasks": [
    {
      "id": "uuid",
      "identifier": "PROJ-123",
      "title": "Implement feature",
      "startDate": "2024-12-26",
      "dueDate": "2024-12-30",
      "parentTaskId": "uuid",
      "stateId": "uuid",
      "assigneeIds": ["uuid"],
      "progress": 50
    }
  ]
}
```

**Progress Calculation**: Based on child task completion ratio or explicit custom field.

---

## Summary

All research topics resolved. Key decisions:
1. **Schema**: New `collaboration` schema
2. **Chat Integration**: Auto-create `project_ticket_thread` channel
3. **Docs Integration**: Auto-create document for task description
4. **Files Integration**: Use existing files with `upload_context='project'`
5. **Custom Fields**: EAV pattern with JSONB values
6. **Task IDs**: Project-scoped sequential counter (PROJ-123)
7. **Hierarchy**: Parent-child with level enforcement, max 5 depth
8. **Workflow Rules**: State-triggered actions with atomic execution
9. **Analytics**: Dynamic query building with JSONB operators
10. **Real-time**: Notification hub SSE with `source_domain='projects'`
11. **Saved Views**: JSONB config per user/project
12. **Gantt**: Client-side rendering from task dates

**Ready for Phase 1: Design & Contracts**
