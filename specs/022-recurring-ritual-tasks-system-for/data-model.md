# Data Model — Ritual Tasks Unification

**Phase 1 Output** | **Branch**: `022-recurring-ritual-tasks-system-for`

---

## Design Principles

1. **Unified task entity** — Ritual instances ARE tasks. One table, one set of queries.
2. **Additive schema changes** — Extend existing tables with new columns; add new tables for ritual-specific concepts.
3. **Citus-compliant** — All new tables distributed on `organization_id`, colocated with `public.organization`.
4. **Backward compatible** — All existing queries continue to work. New columns have defaults.

---

## Schema Modifications

### 1. ALTER `collaboration.project` — Add Collaboration Mode

```sql
-- Add collaboration mode column (UI display hint, not strict gate)
ALTER TABLE collaboration.project
    ADD COLUMN IF NOT EXISTS collaboration_mode TEXT NOT NULL DEFAULT 'standard'
    CHECK (collaboration_mode IN ('standard', 'ritual', 'mixed'));

-- Index for filtering projects by mode
CREATE INDEX IF NOT EXISTS idx_project_collab_mode
    ON collaboration.project(organization_id, collaboration_mode)
    WHERE is_archived = FALSE;
```

**Impact**: None on existing data. All current projects default to `'standard'`.

---

### 2. ALTER `collaboration.project_state` — Extend Categories

```sql
-- Drop and recreate CHECK constraint to include ritual lifecycle categories
ALTER TABLE collaboration.project_state
    DROP CONSTRAINT IF EXISTS project_state_category_check;
ALTER TABLE collaboration.project_state
    ADD CONSTRAINT project_state_category_check
    CHECK (category IN (
        'todo', 'in_progress', 'done', 'cancelled',  -- existing standard categories
        'scheduled', 'submitted', 'verified',          -- ritual success path
        'overdue', 'missed', 'skipped'                 -- ritual failure/skip path
    ));
```

**New category semantics (ritual-specific)**:
| Category | Meaning | Terminal? |
|----------|---------|-----------|
| `scheduled` | Instance generated, window not open | No |
| `submitted` | All evidence submitted, awaiting review | No |
| `verified` | All evidence approved — complete | Yes |
| `overdue` | Window passed without completion | No (can still be completed late) |
| `missed` | Grace period expired — permanent gap | Yes |
| `skipped` | Intentionally skipped with reason | Yes |

**Impact**: Existing states (`todo`, `in_progress`, `done`, `cancelled`) unaffected. New categories only used in projects with `ritual` or `mixed` mode.

---

### 3. ALTER `collaboration.task` — Add Ritual Columns

```sql
-- Add ritual-specific columns to task
ALTER TABLE collaboration.task
    ADD COLUMN IF NOT EXISTS task_kind TEXT NOT NULL DEFAULT 'standard'
        CHECK (task_kind IN ('standard', 'ritual_instance')),
    ADD COLUMN IF NOT EXISTS ritual_definition_id UUID,
    ADD COLUMN IF NOT EXISTS scheduled_date DATE,
    ADD COLUMN IF NOT EXISTS completion_deadline TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS skip_reason TEXT;

-- Foreign key to ritual definition (composite, Citus-compliant)
ALTER TABLE collaboration.task
    ADD CONSTRAINT fk_task_ritual_definition
    FOREIGN KEY (organization_id, ritual_definition_id)
    REFERENCES collaboration.ritual_definition(organization_id, id)
    ON DELETE RESTRICT;

-- Unique constraint: one instance per definition per scheduled date (idempotency)
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_ritual_instance_unique
    ON collaboration.task(organization_id, ritual_definition_id, scheduled_date)
    WHERE task_kind = 'ritual_instance' AND ritual_definition_id IS NOT NULL AND is_deleted = FALSE;

-- Index for listing ritual instances by definition
CREATE INDEX IF NOT EXISTS idx_task_ritual_definition
    ON collaboration.task(organization_id, ritual_definition_id, scheduled_date DESC)
    WHERE task_kind = 'ritual_instance' AND is_deleted = FALSE;

-- Index for "Today" view: my ritual instances due today
CREATE INDEX IF NOT EXISTS idx_task_ritual_today
    ON collaboration.task(organization_id, task_kind, completion_deadline)
    WHERE task_kind = 'ritual_instance' AND is_deleted = FALSE;
```

**New columns**:
| Column | Type | Purpose |
|--------|------|---------|
| `task_kind` | TEXT | Discriminator: `'standard'` or `'ritual_instance'` |
| `ritual_definition_id` | UUID (nullable) | FK to ritual definition (NULL for standard tasks) |
| `scheduled_date` | DATE (nullable) | The date this instance is scheduled for |
| `completion_deadline` | TIMESTAMPTZ (nullable) | Absolute deadline for completing this instance |
| `skip_reason` | TEXT (nullable) | Documented reason when instance is skipped |

**Impact**: All existing tasks get `task_kind = 'standard'`, other columns NULL. Existing queries unaffected (no filter on `task_kind`).

---

## New Tables

### 4. NEW `collaboration.ritual_definition`

```sql
CREATE TABLE IF NOT EXISTS collaboration.ritual_definition (
    id UUID NOT NULL DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id),
    project_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    recurrence_rule JSONB NOT NULL,  -- structured recurrence schedule
    completion_window_hours INT NOT NULL DEFAULT 24 CHECK (completion_window_hours > 0),
    timezone TEXT NOT NULL DEFAULT 'UTC',
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_by_employee_id UUID NOT NULL,
    last_generated_date DATE,  -- tracks last date instances were generated up to
    generation_window_days INT NOT NULL DEFAULT 30,  -- how far ahead to generate
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_ritual_def_project
        FOREIGN KEY (organization_id, project_id)
        REFERENCES collaboration.project(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_ritual_def_creator
        FOREIGN KEY (organization_id, created_by_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT
);

SELECT create_distributed_table('collaboration.ritual_definition', 'organization_id', colocate_with => 'public.organization');

CREATE INDEX IF NOT EXISTS idx_ritual_def_project
    ON collaboration.ritual_definition(organization_id, project_id)
    WHERE is_archived = FALSE;

CREATE INDEX IF NOT EXISTS idx_ritual_def_generation
    ON collaboration.ritual_definition(organization_id, is_archived, last_generated_date)
    WHERE is_archived = FALSE;
```

**`recurrence_rule` JSONB schema**:
```json
{
  "type": "daily|weekly|monthly|custom_interval",
  "interval": 1,
  "days_of_week": [1, 3, 5],
  "day_of_month": 5,
  "nth_weekday": {"week": 2, "day": 1},
  "time_of_day": "09:00",
  "timezone": "Asia/Ho_Chi_Minh"
}
```

---

### 5. NEW `collaboration.ritual_definition_assignee`

```sql
CREATE TABLE IF NOT EXISTS collaboration.ritual_definition_assignee (
    id UUID NOT NULL DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id),
    ritual_definition_id UUID NOT NULL,
    employee_id UUID NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_rda_ritual_def
        FOREIGN KEY (organization_id, ritual_definition_id)
        REFERENCES collaboration.ritual_definition(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_rda_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT uq_rda_unique_assignment
        UNIQUE (organization_id, ritual_definition_id, employee_id)
);

SELECT create_distributed_table('collaboration.ritual_definition_assignee', 'organization_id', colocate_with => 'public.organization');

CREATE INDEX IF NOT EXISTS idx_rda_definition
    ON collaboration.ritual_definition_assignee(organization_id, ritual_definition_id);
```

---

### 6. NEW `collaboration.evidence_requirement`

```sql
CREATE TABLE IF NOT EXISTS collaboration.evidence_requirement (
    id UUID NOT NULL DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id),
    ritual_definition_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    evidence_types TEXT[] NOT NULL DEFAULT '{}',  -- allowed types: 'photo', 'voice_memo', 'pdf', 'file', 'link', 'text_note', 'gps_checkin'
    is_required BOOLEAN NOT NULL DEFAULT TRUE,
    approval_mode TEXT NOT NULL DEFAULT 'manual' CHECK (approval_mode IN ('manual', 'auto_approve')),
    auto_approve_config JSONB,  -- for auto_approve: {"gps_target": {"lat": ..., "lng": ...}, "gps_radius_meters": 100, "deadline_time": "10:00"}
    position INT NOT NULL DEFAULT 0,
    deadline_offset_hours INT,  -- optional: hours after instance start when this evidence is due
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_evidence_req_ritual_def
        FOREIGN KEY (organization_id, ritual_definition_id)
        REFERENCES collaboration.ritual_definition(organization_id, id)
        ON DELETE CASCADE
);

SELECT create_distributed_table('collaboration.evidence_requirement', 'organization_id', colocate_with => 'public.organization');

CREATE INDEX IF NOT EXISTS idx_evidence_req_definition
    ON collaboration.evidence_requirement(organization_id, ritual_definition_id, position);
```

**`evidence_types` values**:
| Value | Description |
|-------|-------------|
| `photo` | Photo with GPS+timestamp metadata |
| `voice_memo` | Audio recording |
| `pdf` | PDF document |
| `file` | Any file type |
| `link` | URL reference |
| `text_note` | Free-form text |
| `gps_checkin` | Location only (no file) |

---

### 7. NEW `collaboration.evidence_submission`

```sql
CREATE TABLE IF NOT EXISTS collaboration.evidence_submission (
    id UUID NOT NULL DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id),
    task_id UUID NOT NULL,
    evidence_requirement_id UUID NOT NULL,
    submitted_by_employee_id UUID NOT NULL,
    evidence_type TEXT NOT NULL CHECK (evidence_type IN ('photo', 'voice_memo', 'pdf', 'file', 'link', 'text_note', 'gps_checkin')),

    -- Content (exactly one of these populated depending on evidence_type)
    file_id UUID,  -- FK to files.file_metadata for file-based evidence
    text_content TEXT,  -- for text_note type
    link_url TEXT,  -- for link type

    -- Device metadata
    device_timestamp TIMESTAMPTZ,  -- timestamp from device
    server_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- authoritative
    gps_latitude DECIMAL(10, 7),
    gps_longitude DECIMAL(10, 7),
    gps_accuracy_meters DECIMAL(8, 2),

    -- Approval workflow
    approval_status TEXT NOT NULL DEFAULT 'pending_review' CHECK (approval_status IN ('pending_review', 'approved', 'rejected')),
    reviewed_by_employee_id UUID,
    reviewed_at TIMESTAMPTZ,
    reviewer_comment TEXT,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_es_task
        FOREIGN KEY (organization_id, task_id)
        REFERENCES collaboration.task(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_es_evidence_req
        FOREIGN KEY (organization_id, evidence_requirement_id)
        REFERENCES collaboration.evidence_requirement(organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_es_submitter
        FOREIGN KEY (organization_id, submitted_by_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_es_reviewer
        FOREIGN KEY (organization_id, reviewed_by_employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE RESTRICT
);

SELECT create_distributed_table('collaboration.evidence_submission', 'organization_id', colocate_with => 'public.organization');

-- Index for listing evidence per task
CREATE INDEX IF NOT EXISTS idx_evidence_sub_task
    ON collaboration.evidence_submission(organization_id, task_id);

-- Index for listing evidence by requirement
CREATE INDEX IF NOT EXISTS idx_evidence_sub_requirement
    ON collaboration.evidence_submission(organization_id, evidence_requirement_id);

-- Index for pending reviews (reviewer dashboard)
CREATE INDEX IF NOT EXISTS idx_evidence_sub_pending
    ON collaboration.evidence_submission(organization_id, approval_status)
    WHERE approval_status = 'pending_review';

-- Index for audit: submissions by employee
CREATE INDEX IF NOT EXISTS idx_evidence_sub_submitter
    ON collaboration.evidence_submission(organization_id, submitted_by_employee_id, server_timestamp DESC);
```

---

## Entity Relationship Summary

```
collaboration.project (extended)
├── collaboration_mode: standard | ritual | mixed
├── collaboration.project_state (extended categories)
├── collaboration.task_level (unchanged)
├── collaboration.ritual_definition (NEW)
│   ├── collaboration.ritual_definition_assignee (NEW)
│   └── collaboration.evidence_requirement (NEW)
├── collaboration.task (extended)
│   ├── task_kind: standard | ritual_instance
│   ├── ritual_definition_id → ritual_definition (for ritual instances)
│   ├── channel_id → chat.channel (unchanged)
│   ├── description_document_id → docs.document (unchanged)
│   ├── collaboration.task_assignee (unchanged)
│   ├── collaboration.custom_field_value (unchanged)
│   └── collaboration.evidence_submission (NEW)
│       └── file_id → files.file_metadata
├── collaboration.workflow_rule (unchanged)
├── collaboration.project_membership (unchanged)
└── collaboration.saved_view (extended with new view types)
```

---

## Default Ritual Project States

When a project is created with `collaboration_mode = 'ritual'` or `'mixed'`, auto-create these additional states:

| Name | Category | Color | Position | Is Initial | Is Closed |
|------|----------|-------|----------|------------|-----------|
| Scheduled | scheduled | #94a3b8 | 10 | false | false |
| Open | todo | #3b82f6 | 20 | true (for ritual) | false |
| In Progress | in_progress | #f59e0b | 30 | false | false |
| Submitted | submitted | #8b5cf6 | 40 | false | false |
| Verified | verified | #22c55e | 50 | false | true |
| Overdue | overdue | #ef4444 | 60 | false | false |
| Missed | missed | #dc2626 | 70 | false | true |
| Skipped | skipped | #6b7280 | 80 | false | true |

For `'mixed'` mode projects, both standard states (Backlog, In Progress, Review, Done) and ritual states are created.

---

## Migration Strategy

1. **Migration 1**: Add `collaboration_mode` to `collaboration.project`
2. **Migration 2**: Extend `project_state.category` CHECK constraint  
3. **Migration 3**: Add ritual columns to `collaboration.task` (task_kind, ritual_definition_id, scheduled_date, completion_deadline, skip_reason)
4. **Migration 4**: Create `collaboration.ritual_definition` table + distribute
5. **Migration 5**: Create `collaboration.ritual_definition_assignee` table + distribute
6. **Migration 6**: Create `collaboration.evidence_requirement` table + distribute
7. **Migration 7**: Create `collaboration.evidence_submission` table + distribute
8. **Migration 8**: Add FK from task to ritual_definition + unique index for idempotency

All migrations are additive (no data changes, no column drops). Rollback is safe — drop new tables/columns.

---

## Query Impact Analysis

| Existing Query | Impact | Changes Needed |
|----------------|--------|----------------|
| `CreateTask` | Extend to accept `task_kind`, `ritual_definition_id`, `scheduled_date`, `completion_deadline` | Add optional params |
| `ListTasks` | Add optional `task_kind` filter | Add `sqlc.narg('task_kind')` COALESCE |
| `GetTask` | Returns new columns automatically | Update proto mapping |
| `UpdateTask` | Add `skip_reason` to COALESCE update | Add optional param |
| `GetTaskCountsByState` | No change needed (already groups by state) | None |
| `SearchTasks` | No change needed (searches title which exists on ritual instances too) | None |
| All other queries | Unaffected — new columns have defaults | None |

---

## Saved View Extension

Add new view type for ritual-specific views:

```sql
ALTER TABLE collaboration.saved_view
    DROP CONSTRAINT IF EXISTS saved_view_view_type_check;
ALTER TABLE collaboration.saved_view
    ADD CONSTRAINT saved_view_view_type_check
    CHECK (view_type IN ('board', 'list', 'gantt', 'calendar', 'today', 'health'));
```

| View Type | Purpose |
|-----------|---------|
| `today` | Worker's ritual instances due today |
| `health` | Manager's operational health dashboard |
