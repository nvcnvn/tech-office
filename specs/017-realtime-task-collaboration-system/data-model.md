# Data Model: Realtime Task Collaboration System

**Feature**: 017-realtime-task-collaboration-system  
**Date**: 2024-12-26  
**Status**: Complete

## Overview

This document defines the database schema for the realtime task collaboration system. The design follows Tech Office conventions for multi-tenancy (Citus sharding via `organization_id`), cross-domain integration, and schema-per-domain isolation.

---

## Schema: `collaboration`

The `collaboration` schema already exists in `schema.sql` (declared but empty). This feature populates it with task management tables.

---

## Tables

### 1. `collaboration.project`

Core project entity containing tasks.

```sql
-- collaboration.project: Task project container with state configuration
CREATE TABLE IF NOT EXISTS collaboration.project (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    
    -- Project identity
    name TEXT NOT NULL,
    key TEXT NOT NULL, -- Short identifier for task prefixes (e.g., "PROJ")
    description TEXT,
    
    -- Task numbering
    next_task_number INT NOT NULL DEFAULT 1 CHECK (next_task_number >= 1),
    
    -- Visibility
    visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
    
    -- Status
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    
    -- Metadata
    owner_employee_id UUID NOT NULL,
    
    -- Counters (denormalized for performance)
    member_count INT NOT NULL DEFAULT 0 CHECK (member_count >= 0),
    task_count INT NOT NULL DEFAULT 0 CHECK (task_count >= 0),
    
    -- Timestamps
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding (organization_id first)
    PRIMARY KEY (organization_id, id),
    
    -- Foreign keys
    CONSTRAINT fk_project_owner
        FOREIGN KEY (organization_id, owner_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT,
    
    -- Constraints
    CONSTRAINT unique_project_key UNIQUE (organization_id, key),
    CONSTRAINT valid_project_key CHECK (key ~ '^[A-Z][A-Z0-9_]{0,9}$') -- 1-10 uppercase alphanumeric
);

SELECT create_distributed_table('collaboration.project', 'organization_id', colocate_with => 'public.organization');

-- Indexes for project
CREATE INDEX IF NOT EXISTS idx_project_owner 
    ON collaboration.project(organization_id, owner_employee_id);

CREATE INDEX IF NOT EXISTS idx_project_visibility 
    ON collaboration.project(organization_id, visibility, is_archived)
    WHERE is_archived = FALSE;

-- Trigram index for fuzzy search on project name
CREATE INDEX IF NOT EXISTS idx_project_name_trgm 
    ON collaboration.project USING GIN(name gin_trgm_ops);

COMMENT ON TABLE collaboration.project IS 
'Task project container with configurable states and task levels. Projects group related tasks and define workflow.';

COMMENT ON COLUMN collaboration.project.key IS 
'Short uppercase identifier (1-10 chars) for task prefixes. Example: "PROJ" creates tasks PROJ-1, PROJ-2. MUST be unique per organization.';

COMMENT ON COLUMN collaboration.project.next_task_number IS 
'Atomic counter for task identifier generation. Incremented on each task creation.';

COMMENT ON COLUMN collaboration.project.visibility IS 
'Project visibility: public (all org members can view), private (explicit grants only). MUST align with backend constants in internal/collaboration/constants.go.';
```

---

### 2. `collaboration.project_state`

Customizable task states per project.

```sql
-- collaboration.project_state: Customizable task states per project
CREATE TABLE IF NOT EXISTS collaboration.project_state (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    project_id UUID NOT NULL,
    
    -- State identity
    name TEXT NOT NULL, -- Display name (e.g., "In Progress")
    color TEXT NOT NULL DEFAULT '#3b82f6', -- Hex color for UI
    
    -- State category for reporting
    category TEXT NOT NULL DEFAULT 'todo' CHECK (category IN ('todo', 'in_progress', 'done', 'cancelled')),
    
    -- Position for ordering in board view
    position INT NOT NULL DEFAULT 0,
    
    -- Default state flags
    is_initial BOOLEAN NOT NULL DEFAULT FALSE, -- New tasks start here
    is_closed BOOLEAN NOT NULL DEFAULT FALSE, -- Tasks in this state are considered closed
    
    -- Timestamps
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding
    PRIMARY KEY (organization_id, id),
    
    -- Foreign keys
    CONSTRAINT fk_state_project
        FOREIGN KEY (organization_id, project_id)
        REFERENCES collaboration.project(organization_id, id)
        ON DELETE CASCADE,
    
    -- Constraints
    CONSTRAINT unique_state_name UNIQUE (organization_id, project_id, name),
    CONSTRAINT unique_state_position UNIQUE (organization_id, project_id, position)
);

SELECT create_distributed_table('collaboration.project_state', 'organization_id', colocate_with => 'public.organization');

-- Indexes for project_state
CREATE INDEX IF NOT EXISTS idx_state_project 
    ON collaboration.project_state(organization_id, project_id, position);

CREATE INDEX IF NOT EXISTS idx_state_initial 
    ON collaboration.project_state(organization_id, project_id)
    WHERE is_initial = TRUE;

COMMENT ON TABLE collaboration.project_state IS 
'Customizable task states per project. Projects can have unlimited states organized into categories for reporting.';

COMMENT ON COLUMN collaboration.project_state.category IS 
'State category for reporting: todo (not started), in_progress (active work), done (completed), cancelled. MUST align with backend constants.';

COMMENT ON COLUMN collaboration.project_state.is_initial IS 
'If true, new tasks start in this state. Only one state per project should be initial.';

COMMENT ON COLUMN collaboration.project_state.is_closed IS 
'If true, tasks in this state are considered closed/resolved. Used for metrics and analytics.';
```

---

### 3. `collaboration.task_level`

Task hierarchy level definitions per project.

```sql
-- collaboration.task_level: Task hierarchy levels per project (Epic → Story → Task → Subtask)
CREATE TABLE IF NOT EXISTS collaboration.task_level (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    project_id UUID NOT NULL,
    
    -- Level identity
    name TEXT NOT NULL, -- Display name (e.g., "Epic", "Story", "Task")
    icon TEXT, -- Icon identifier for UI
    color TEXT NOT NULL DEFAULT '#6b7280', -- Hex color
    
    -- Hierarchy position (0 = top level, higher = deeper)
    depth INT NOT NULL CHECK (depth >= 0 AND depth <= 4),
    
    -- Timestamps
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding
    PRIMARY KEY (organization_id, id),
    
    -- Foreign keys
    CONSTRAINT fk_level_project
        FOREIGN KEY (organization_id, project_id)
        REFERENCES collaboration.project(organization_id, id)
        ON DELETE CASCADE,
    
    -- Constraints
    CONSTRAINT unique_level_name UNIQUE (organization_id, project_id, name),
    CONSTRAINT unique_level_depth UNIQUE (organization_id, project_id, depth)
);

SELECT create_distributed_table('collaboration.task_level', 'organization_id', colocate_with => 'public.organization');

-- Indexes for task_level
CREATE INDEX IF NOT EXISTS idx_level_project 
    ON collaboration.task_level(organization_id, project_id, depth);

COMMENT ON TABLE collaboration.task_level IS 
'Task hierarchy level definitions per project. Defines which levels exist (Epic, Story, Task, Subtask) and their nesting rules.';

COMMENT ON COLUMN collaboration.task_level.depth IS 
'Hierarchy position: 0=Epic, 1=Story, 2=Task, 3=Subtask, 4=Checklist. Enforces parent-child level ordering.';
```

---

### 4. `collaboration.task`

Core task entity with hierarchy and cross-domain integration.

```sql
-- collaboration.task: Core task entity with hierarchy and integrations
CREATE TABLE IF NOT EXISTS collaboration.task (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    project_id UUID NOT NULL,
    
    -- Task identity
    identifier TEXT NOT NULL, -- Human-readable ID (e.g., "PROJ-123")
    title TEXT NOT NULL,
    
    -- Hierarchy (max 5 levels)
    parent_task_id UUID,
    depth SMALLINT NOT NULL DEFAULT 0 CHECK (depth >= 0 AND depth <= 5),
    path UUID[] NOT NULL DEFAULT '{}', -- Materialized path for ancestor queries
    level_id UUID NOT NULL,
    
    -- Workflow
    state_id UUID NOT NULL,
    
    -- Scheduling
    start_date DATE,
    due_date DATE,
    estimated_hours DECIMAL(8,2), -- For time tracking integration
    
    -- Cross-domain integrations
    channel_id UUID, -- Chat channel for task comments (chat.channel)
    description_document_id UUID, -- Rich description document (docs.document)
    file_ids UUID[] NOT NULL DEFAULT '{}', -- Attached files (files.file_metadata)
    
    -- Assignment
    reporter_employee_id UUID NOT NULL,
    
    -- Counters
    child_count INT NOT NULL DEFAULT 0 CHECK (child_count >= 0),
    comment_count INT NOT NULL DEFAULT 0 CHECK (comment_count >= 0),
    
    -- Soft delete
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    
    -- Timestamps
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding
    PRIMARY KEY (organization_id, id),
    
    -- Foreign keys
    CONSTRAINT fk_task_project
        FOREIGN KEY (organization_id, project_id)
        REFERENCES collaboration.project(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_task_parent
        FOREIGN KEY (organization_id, parent_task_id)
        REFERENCES collaboration.task(organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_task_level
        FOREIGN KEY (organization_id, level_id)
        REFERENCES collaboration.task_level(organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_task_state
        FOREIGN KEY (organization_id, state_id)
        REFERENCES collaboration.project_state(organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_task_reporter
        FOREIGN KEY (organization_id, reporter_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_task_channel
        FOREIGN KEY (organization_id, channel_id)
        REFERENCES chat.channel(organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_task_description
        FOREIGN KEY (organization_id, description_document_id)
        REFERENCES docs.document(organization_id, id)
        ON DELETE RESTRICT,
    
    -- Constraints
    CONSTRAINT unique_task_identifier UNIQUE (organization_id, project_id, identifier),
    CONSTRAINT no_self_parent CHECK (parent_task_id IS NULL OR parent_task_id != id),
    CONSTRAINT valid_date_range CHECK (start_date IS NULL OR due_date IS NULL OR start_date <= due_date)
);

SELECT create_distributed_table('collaboration.task', 'organization_id', colocate_with => 'public.organization');

-- Indexes for task
CREATE INDEX IF NOT EXISTS idx_task_project_state 
    ON collaboration.task(organization_id, project_id, state_id, updated_at DESC)
    WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_task_parent 
    ON collaboration.task(organization_id, parent_task_id)
    WHERE parent_task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_reporter 
    ON collaboration.task(organization_id, reporter_employee_id);

CREATE INDEX IF NOT EXISTS idx_task_channel 
    ON collaboration.task(organization_id, channel_id)
    WHERE channel_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_dates 
    ON collaboration.task(organization_id, project_id, start_date, due_date)
    WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS idx_task_path 
    ON collaboration.task USING GIN(path);

-- PGroonga full-text search on task title
CREATE INDEX IF NOT EXISTS idx_task_title_pgroonga 
    ON collaboration.task USING pgroonga(title);

-- Trigram index for fuzzy title search
CREATE INDEX IF NOT EXISTS idx_task_title_trgm 
    ON collaboration.task USING GIN(title gin_trgm_ops);

COMMENT ON TABLE collaboration.task IS 
'Core task entity with hierarchical nesting, workflow states, and cross-domain integrations to chat (comments), docs (description), and files (attachments).';

COMMENT ON COLUMN collaboration.task.identifier IS 
'Human-readable task identifier: {project_key}-{number}. Example: PROJ-123. Unique within project.';

COMMENT ON COLUMN collaboration.task.path IS 
'Materialized path array of ancestor task IDs from root to parent. Enables efficient subtree queries.';

COMMENT ON COLUMN collaboration.task.channel_id IS 
'Chat channel for task comments and discussion. Auto-created on task creation with channel_type=project_ticket_thread.';

COMMENT ON COLUMN collaboration.task.description_document_id IS 
'Linked document for rich task description with versioning and comments. Auto-created on task creation.';

COMMENT ON COLUMN collaboration.task.file_ids IS 
'Array of file UUIDs from files.file_metadata. Managed via Files API with upload_context=project.';
```

---

### 5. `collaboration.task_assignee`

Task assignment tracking (many-to-many).

```sql
-- collaboration.task_assignee: Task assignment tracking
CREATE TABLE IF NOT EXISTS collaboration.task_assignee (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    task_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    
    -- Assignment role
    role TEXT NOT NULL DEFAULT 'assignee' CHECK (role IN ('assignee', 'reviewer', 'approver')),
    
    -- Timestamps
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    assigned_by_employee_id UUID NOT NULL,
    
    -- Composite primary key for Citus sharding
    PRIMARY KEY (organization_id, id),
    
    -- Foreign keys
    CONSTRAINT fk_assignee_task
        FOREIGN KEY (organization_id, task_id)
        REFERENCES collaboration.task(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_assignee_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_assignee_assigned_by
        FOREIGN KEY (organization_id, assigned_by_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT,
    
    -- Constraints
    CONSTRAINT unique_task_assignee UNIQUE (organization_id, task_id, employee_id, role)
);

SELECT create_distributed_table('collaboration.task_assignee', 'organization_id', colocate_with => 'public.organization');

-- Indexes for task_assignee
CREATE INDEX IF NOT EXISTS idx_assignee_task 
    ON collaboration.task_assignee(organization_id, task_id);

CREATE INDEX IF NOT EXISTS idx_assignee_employee 
    ON collaboration.task_assignee(organization_id, employee_id);

COMMENT ON TABLE collaboration.task_assignee IS 
'Task assignment tracking with support for multiple assignees per task and different roles (assignee, reviewer, approver).';

COMMENT ON COLUMN collaboration.task_assignee.role IS 
'Assignment role: assignee (responsible for work), reviewer (reviews work), approver (approves completion). MUST align with backend constants.';
```

---

### 6. `collaboration.task_watcher`

Task watch/subscription for notifications.

```sql
-- collaboration.task_watcher: Task watch/subscription for notifications
CREATE TABLE IF NOT EXISTS collaboration.task_watcher (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    task_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    
    -- Watch source
    watch_reason TEXT NOT NULL DEFAULT 'manual' CHECK (watch_reason IN ('manual', 'mentioned', 'assigned', 'reporter', 'commented')),
    
    -- Timestamps
    watched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding
    PRIMARY KEY (organization_id, id),
    
    -- Foreign keys
    CONSTRAINT fk_watcher_task
        FOREIGN KEY (organization_id, task_id)
        REFERENCES collaboration.task(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_watcher_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE CASCADE,
    
    -- Constraints
    CONSTRAINT unique_task_watcher UNIQUE (organization_id, task_id, employee_id)
);

SELECT create_distributed_table('collaboration.task_watcher', 'organization_id', colocate_with => 'public.organization');

-- Indexes for task_watcher
CREATE INDEX IF NOT EXISTS idx_watcher_task 
    ON collaboration.task_watcher(organization_id, task_id);

CREATE INDEX IF NOT EXISTS idx_watcher_employee 
    ON collaboration.task_watcher(organization_id, employee_id);

COMMENT ON TABLE collaboration.task_watcher IS 
'Task watch/subscription tracking. Watchers receive notifications on task updates. Auto-created for reporters, assignees, commenters.';

COMMENT ON COLUMN collaboration.task_watcher.watch_reason IS 
'How user became a watcher: manual (explicit subscribe), mentioned, assigned, reporter, commented. MUST align with backend constants.';
```

---

### 7. `collaboration.custom_field_definition`

Custom field definitions at project level.

```sql
-- collaboration.custom_field_definition: Custom field definitions per project
CREATE TABLE IF NOT EXISTS collaboration.custom_field_definition (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    project_id UUID NOT NULL,
    
    -- Field identity
    name TEXT NOT NULL, -- Display name (e.g., "Story Points")
    description TEXT,
    
    -- Field type
    field_type TEXT NOT NULL CHECK (field_type IN ('text', 'number', 'single_select', 'multi_select', 'date', 'user', 'checkbox')),
    
    -- Type-specific options
    options JSONB, -- For select types: ["XS", "S", "M", "L", "XL"]
    default_value JSONB, -- Default value for new tasks
    
    -- Constraints
    is_required BOOLEAN NOT NULL DEFAULT FALSE,
    min_value DECIMAL(10,2), -- For number type
    max_value DECIMAL(10,2), -- For number type
    
    -- Display
    position INT NOT NULL DEFAULT 0, -- Order in field list
    
    -- Status
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    
    -- Timestamps
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding
    PRIMARY KEY (organization_id, id),
    
    -- Foreign keys
    CONSTRAINT fk_field_def_project
        FOREIGN KEY (organization_id, project_id)
        REFERENCES collaboration.project(organization_id, id)
        ON DELETE CASCADE,
    
    -- Constraints
    CONSTRAINT unique_field_name UNIQUE (organization_id, project_id, name)
);

SELECT create_distributed_table('collaboration.custom_field_definition', 'organization_id', colocate_with => 'public.organization');

-- Indexes for custom_field_definition
CREATE INDEX IF NOT EXISTS idx_field_def_project 
    ON collaboration.custom_field_definition(organization_id, project_id, position)
    WHERE is_archived = FALSE;

COMMENT ON TABLE collaboration.custom_field_definition IS 
'Custom field definitions per project. Supports text, number, single/multi select, date, user, checkbox field types.';

COMMENT ON COLUMN collaboration.custom_field_definition.field_type IS 
'Field type: text, number, single_select, multi_select, date, user (employee picker), checkbox. MUST align with backend constants.';

COMMENT ON COLUMN collaboration.custom_field_definition.options IS 
'For select types: array of option values. Example: ["XS", "S", "M", "L", "XL"] for t-shirt sizes.';
```

---

### 8. `collaboration.custom_field_value`

Custom field values per task.

```sql
-- collaboration.custom_field_value: Custom field values per task
CREATE TABLE IF NOT EXISTS collaboration.custom_field_value (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    task_id UUID NOT NULL,
    field_definition_id UUID NOT NULL,
    
    -- Value (flexible JSONB storage)
    value JSONB NOT NULL, -- Type depends on field_type
    
    -- Timestamps
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding
    PRIMARY KEY (organization_id, id),
    
    -- Foreign keys
    CONSTRAINT fk_field_value_task
        FOREIGN KEY (organization_id, task_id)
        REFERENCES collaboration.task(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_field_value_definition
        FOREIGN KEY (organization_id, field_definition_id)
        REFERENCES collaboration.custom_field_definition(organization_id, id)
        ON DELETE CASCADE,
    
    -- Constraints
    CONSTRAINT unique_task_field UNIQUE (organization_id, task_id, field_definition_id)
);

SELECT create_distributed_table('collaboration.custom_field_value', 'organization_id', colocate_with => 'public.organization');

-- Indexes for custom_field_value
CREATE INDEX IF NOT EXISTS idx_field_value_task 
    ON collaboration.custom_field_value(organization_id, task_id);

CREATE INDEX IF NOT EXISTS idx_field_value_definition 
    ON collaboration.custom_field_value(organization_id, field_definition_id);

-- GIN index for JSONB queries on value
CREATE INDEX IF NOT EXISTS idx_field_value_json 
    ON collaboration.custom_field_value USING GIN(value);

COMMENT ON TABLE collaboration.custom_field_value IS 
'Custom field values per task. JSONB storage enables flexible value types while maintaining queryability for analytics.';

COMMENT ON COLUMN collaboration.custom_field_value.value IS 
'Field value as JSONB. Examples: "value text" for text, 5 for number, ["M"] for single_select, ["A","B"] for multi_select, "2024-12-26" for date, "uuid" for user.';
```

---

### 9. `collaboration.workflow_rule`

Workflow automation rules per project.

```sql
-- collaboration.workflow_rule: Workflow automation rules
CREATE TABLE IF NOT EXISTS collaboration.workflow_rule (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    project_id UUID NOT NULL,
    
    -- Rule identity
    name TEXT NOT NULL,
    description TEXT,
    
    -- Trigger
    trigger_type TEXT NOT NULL DEFAULT 'state_entered' CHECK (trigger_type IN ('state_entered', 'state_exited', 'field_changed', 'task_created')),
    trigger_state_id UUID, -- For state triggers
    trigger_field_id UUID, -- For field triggers
    trigger_condition JSONB, -- Additional conditions: {"field_id": "...", "operator": "equals", "value": "..."}
    
    -- Action
    action_type TEXT NOT NULL CHECK (action_type IN ('set_state', 'set_field', 'assign_user', 'notify', 'close_task')),
    action_payload JSONB NOT NULL, -- Action-specific data
    
    -- Execution
    position INT NOT NULL DEFAULT 0, -- Execution order when multiple rules match
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    
    -- Timestamps
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding
    PRIMARY KEY (organization_id, id),
    
    -- Foreign keys
    CONSTRAINT fk_rule_project
        FOREIGN KEY (organization_id, project_id)
        REFERENCES collaboration.project(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_rule_trigger_state
        FOREIGN KEY (organization_id, trigger_state_id)
        REFERENCES collaboration.project_state(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_rule_trigger_field
        FOREIGN KEY (organization_id, trigger_field_id)
        REFERENCES collaboration.custom_field_definition(organization_id, id)
        ON DELETE CASCADE
);

SELECT create_distributed_table('collaboration.workflow_rule', 'organization_id', colocate_with => 'public.organization');

-- Indexes for workflow_rule
CREATE INDEX IF NOT EXISTS idx_rule_project 
    ON collaboration.workflow_rule(organization_id, project_id, position)
    WHERE is_enabled = TRUE;

CREATE INDEX IF NOT EXISTS idx_rule_trigger_state 
    ON collaboration.workflow_rule(organization_id, trigger_state_id)
    WHERE trigger_state_id IS NOT NULL AND is_enabled = TRUE;

COMMENT ON TABLE collaboration.workflow_rule IS 
'Workflow automation rules. Triggers execute actions within task update transaction for atomicity.';

COMMENT ON COLUMN collaboration.workflow_rule.trigger_type IS 
'Trigger type: state_entered, state_exited, field_changed, task_created. MUST align with backend constants.';

COMMENT ON COLUMN collaboration.workflow_rule.action_type IS 
'Action type: set_state, set_field, assign_user, notify, close_task. MUST align with backend constants.';

COMMENT ON COLUMN collaboration.workflow_rule.action_payload IS 
'Action payload: {"stateId": "..."} for set_state, {"fieldId": "...", "value": ...} for set_field, {"employeeId": "..."} for assign_user.';
```

---

### 10. `collaboration.workflow_rule_execution`

Audit log for workflow rule executions.

```sql
-- collaboration.workflow_rule_execution: Audit log for rule executions
CREATE TABLE IF NOT EXISTS collaboration.workflow_rule_execution (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    rule_id UUID NOT NULL,
    task_id UUID NOT NULL,
    
    -- Execution result
    status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
    error_message TEXT, -- If failed
    
    -- Context
    triggered_by_employee_id UUID NOT NULL, -- Who caused the trigger
    execution_context JSONB, -- Trigger details: {"previousState": "...", "newState": "..."}
    
    -- Timing
    executed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    duration_ms INT, -- Execution time
    
    -- Composite primary key for Citus sharding
    PRIMARY KEY (organization_id, id),
    
    -- Foreign keys
    CONSTRAINT fk_execution_rule
        FOREIGN KEY (organization_id, rule_id)
        REFERENCES collaboration.workflow_rule(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_execution_task
        FOREIGN KEY (organization_id, task_id)
        REFERENCES collaboration.task(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_execution_triggered_by
        FOREIGN KEY (organization_id, triggered_by_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT
);

SELECT create_distributed_table('collaboration.workflow_rule_execution', 'organization_id', colocate_with => 'public.organization');

-- Indexes for workflow_rule_execution
CREATE INDEX IF NOT EXISTS idx_execution_rule 
    ON collaboration.workflow_rule_execution(organization_id, rule_id, executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_execution_task 
    ON collaboration.workflow_rule_execution(organization_id, task_id, executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_execution_status 
    ON collaboration.workflow_rule_execution(organization_id, status, executed_at DESC)
    WHERE status = 'failed';

COMMENT ON TABLE collaboration.workflow_rule_execution IS 
'Audit log tracking workflow rule executions. Used for debugging and analytics.';
```

---

### 11. `collaboration.project_membership`

Project membership and role assignment.

```sql
-- collaboration.project_membership: Project membership and roles
CREATE TABLE IF NOT EXISTS collaboration.project_membership (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    project_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    
    -- Role
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
    
    -- Notification preferences
    notification_preference TEXT NOT NULL DEFAULT 'all' CHECK (notification_preference IN ('all', 'mentions', 'assigned', 'muted')),
    
    -- Timestamps
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    invited_by_employee_id UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding
    PRIMARY KEY (organization_id, id),
    
    -- Foreign keys
    CONSTRAINT fk_membership_project
        FOREIGN KEY (organization_id, project_id)
        REFERENCES collaboration.project(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_membership_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_membership_invited_by
        FOREIGN KEY (organization_id, invited_by_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT,
    
    -- Constraints
    CONSTRAINT unique_project_member UNIQUE (organization_id, project_id, employee_id)
);

SELECT create_distributed_table('collaboration.project_membership', 'organization_id', colocate_with => 'public.organization');

-- Indexes for project_membership
CREATE INDEX IF NOT EXISTS idx_membership_project 
    ON collaboration.project_membership(organization_id, project_id, role);

CREATE INDEX IF NOT EXISTS idx_membership_employee 
    ON collaboration.project_membership(organization_id, employee_id);

COMMENT ON TABLE collaboration.project_membership IS 
'Project membership with role-based access control. Roles determine permissions for viewing, editing, and managing projects.';

COMMENT ON COLUMN collaboration.project_membership.role IS 
'Member role: owner (full control), admin (manage members), member (edit tasks), viewer (read only). MUST align with backend constants.';

COMMENT ON COLUMN collaboration.project_membership.notification_preference IS 
'Notification preference: all, mentions (only @mentions), assigned (only when assigned), muted. MUST align with backend constants.';
```

---

### 12. `collaboration.saved_view`

Saved view configurations for filtering and display.

```sql
-- collaboration.saved_view: Saved view configurations
CREATE TABLE IF NOT EXISTS collaboration.saved_view (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    project_id UUID NOT NULL,
    
    -- Owner (NULL = shared view)
    employee_id UUID,
    
    -- View identity
    name TEXT NOT NULL,
    
    -- View type
    view_type TEXT NOT NULL CHECK (view_type IN ('board', 'list', 'gantt', 'calendar')),
    
    -- Configuration
    config JSONB NOT NULL DEFAULT '{}', -- {filters: [...], groupBy: [...], columns: [...], sortBy: [...]}
    
    -- Display
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    position INT NOT NULL DEFAULT 0,
    
    -- Timestamps
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding
    PRIMARY KEY (organization_id, id),
    
    -- Foreign keys
    CONSTRAINT fk_view_project
        FOREIGN KEY (organization_id, project_id)
        REFERENCES collaboration.project(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_view_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE CASCADE
);

SELECT create_distributed_table('collaboration.saved_view', 'organization_id', colocate_with => 'public.organization');

-- Indexes for saved_view
CREATE INDEX IF NOT EXISTS idx_view_project 
    ON collaboration.saved_view(organization_id, project_id, position);

CREATE INDEX IF NOT EXISTS idx_view_employee 
    ON collaboration.saved_view(organization_id, employee_id)
    WHERE employee_id IS NOT NULL;

COMMENT ON TABLE collaboration.saved_view IS 
'Saved view configurations for personalized or shared filtering and display settings.';

COMMENT ON COLUMN collaboration.saved_view.employee_id IS 
'View owner. NULL indicates a shared project-level view visible to all members.';

COMMENT ON COLUMN collaboration.saved_view.view_type IS 
'View type: board (kanban), list (table), gantt (timeline), calendar. MUST align with backend constants.';

COMMENT ON COLUMN collaboration.saved_view.config IS 
'View configuration: {filters: [{fieldId, operator, value}], groupBy: ["stateId"], columns: ["title", "assignees"], sortBy: [{field, direction}]}';
```

---

## Cross-Domain Integration Points

### 1. Chat Integration
- Task → Channel: `collaboration.task.channel_id` references `chat.channel.id`
- Channel type: `project_ticket_thread`
- Channel members auto-managed: reporter, assignees, watchers

### 2. Docs Integration
- Task → Document: `collaboration.task.description_document_id` references `docs.document.id`
- Document visibility inherits from project

### 3. Files Integration
- Task → Files: `collaboration.task.file_ids` array of `files.file_metadata.id`
- Access rules via `files.file_access_rule` with `context_type='project'`

### 4. Notification Integration
- Add to `notification.notification.source_domain` CHECK: `'projects'`
- Notification types: `task_created`, `task_updated`, `task_assigned`, `task_commented`

---

## Schema Update for Notification

```sql
-- Update notification.notification CHECK constraint to add 'projects' domain
ALTER TABLE notification.notification 
DROP CONSTRAINT IF EXISTS notification_source_domain_check;

ALTER TABLE notification.notification 
ADD CONSTRAINT notification_source_domain_check 
CHECK (source_domain IN ('chat', 'crm', 'projects', 'hr', 'support', 'finance', 'system'));
```

---

## Migration File Structure

```
backend/k8s/base/database/migrations/
├── YYYYMMDDHHMMSS_collaboration_project.up.sql
├── YYYYMMDDHHMMSS_collaboration_project.down.sql
├── YYYYMMDDHHMMSS_collaboration_states_levels.up.sql
├── YYYYMMDDHHMMSS_collaboration_states_levels.down.sql
├── YYYYMMDDHHMMSS_collaboration_task.up.sql
├── YYYYMMDDHHMMSS_collaboration_task.down.sql
├── YYYYMMDDHHMMSS_collaboration_custom_fields.up.sql
├── YYYYMMDDHHMMSS_collaboration_custom_fields.down.sql
├── YYYYMMDDHHMMSS_collaboration_workflow.up.sql
├── YYYYMMDDHHMMSS_collaboration_workflow.down.sql
├── YYYYMMDDHHMMSS_collaboration_membership_views.up.sql
├── YYYYMMDDHHMMSS_collaboration_membership_views.down.sql
└── YYYYMMDDHHMMSS_notification_projects_domain.up.sql
└── YYYYMMDDHHMMSS_notification_projects_domain.down.sql
```

---

## Summary

| Table | Purpose | Key Foreign Keys |
|-------|---------|-----------------|
| `collaboration.project` | Project container | organization, owner_employee |
| `collaboration.project_state` | Workflow states | project |
| `collaboration.task_level` | Hierarchy levels | project |
| `collaboration.task` | Core task entity | project, parent_task, state, level, channel, document, reporter |
| `collaboration.task_assignee` | Task assignments | task, employee |
| `collaboration.task_watcher` | Task subscriptions | task, employee |
| `collaboration.custom_field_definition` | Field definitions | project |
| `collaboration.custom_field_value` | Field values | task, field_definition |
| `collaboration.workflow_rule` | Automation rules | project, trigger_state |
| `collaboration.workflow_rule_execution` | Rule audit log | rule, task |
| `collaboration.project_membership` | Project access | project, employee |
| `collaboration.saved_view` | View configs | project, employee |

**Total: 12 tables** all following Citus sharding pattern with `(organization_id, id)` composite primary keys.
