# Data Model: Unified Notification Routing

## Schema Changes Overview

| Change | Type | Schema | Table |
|--------|------|--------|-------|
| Add personal_preference table | CREATE TABLE | notification | personal_preference |
| Add notification_preference column | ALTER TABLE | docs | document_follower |
| Update notification_type CHECK | ALTER TABLE | notification | notification |

## New Table: notification.personal_preference

```sql
CREATE TABLE IF NOT EXISTS notification.personal_preference(
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    employee_id uuid NOT NULL,
    dnd_enabled boolean NOT NULL DEFAULT false,
    dnd_start time, -- NULL when dnd_enabled=false
    dnd_end time,   -- NULL when dnd_enabled=false
    muted_domains text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, employee_id),
    FOREIGN KEY (organization_id, employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT muted_domains_valid CHECK (
        muted_domains <@ ARRAY['chat', 'projects', 'docs', 'crm', 'hr', 'support', 'finance', 'system']::text[]
    )
);

COMMENT ON TABLE notification.personal_preference IS 
'Global notification preferences per employee. Controls DND schedule and domain-level muting.';

COMMENT ON COLUMN notification.personal_preference.muted_domains IS 
'Domains for which the employee will not receive push notifications. SSE delivery still occurs for real-time UI updates.';

COMMENT ON COLUMN notification.personal_preference.dnd_enabled IS 
'When true, push notifications are suppressed during dnd_start..dnd_end window. SSE still delivered.';
```

### Citus Sharding Compliance
- Primary key starts with `organization_id` ✓
- Foreign key references include `organization_id` ✓
- No triggers ✓
- No volatile functions in constraints ✓
- Simple CHECK constraint with `<@` array containment ✓

## Altered Table: docs.document_follower

```sql
ALTER TABLE docs.document_follower 
ADD COLUMN notification_preference text NOT NULL DEFAULT 'all'
CONSTRAINT document_follower_notification_preference_valid 
CHECK (notification_preference IN ('all', 'mentions', 'muted'));

COMMENT ON COLUMN docs.document_follower.notification_preference IS 
'Controls which notifications the follower receives: all=everything, mentions=only @mentions, muted=no notifications (still following for UI display).';
```

### Consistency with Existing Patterns
- Same values as `chat.channel_membership.notification_preference`: `'all'`, `'mentions'`, `'muted'`
- Same column name as `collaboration.project_membership.notification_preference`
- DEFAULT `'all'` matches chat behavior (new membership gets all notifications)

## Updated CHECK Constraint: notification.notification

```sql
-- Drop existing constraint and recreate with new types
ALTER TABLE notification.notification 
DROP CONSTRAINT IF EXISTS notification_type_valid;

ALTER TABLE notification.notification
ADD CONSTRAINT notification_type_valid 
CHECK (notification_type IN (
    -- Chat types (existing)
    'message', 'mention', 'reply', 'typing', 'reaction',
    -- Task types (new)
    'task_assigned', 'task_status_changed', 'task_commented', 'task_mentioned',
    -- Document types (new)
    'doc_updated', 'doc_commented', 'doc_mentioned'
));
```

## Entity Relationship Diagram

```
notification.personal_preference
├── organization_id ──FK──> public.organization(id)
└── employee_id ──FK──> organization.employee(organization_id, id)

docs.document_follower (existing, modified)
├── organization_id
├── document_id
├── employee_id
└── notification_preference (NEW: 'all'|'mentions'|'muted')

notification.notification (existing, constraint updated)
└── notification_type CHECK updated with new values

-- Unchanged but referenced:
chat.channel_membership.notification_preference  -- 'all'|'mentions'|'muted'
collaboration.project_membership.notification_preference  -- 'all'|'mentions'|'assigned'|'muted'
collaboration.task_watcher.watch_reason  -- 'manual'|'mentioned'|'assigned'|'reporter'|'commented'
```

## Migration Files

### Up Migration
```sql
-- YYYYMMDDHHMMSS_add_unified_notification_preferences.up.sql

-- 1. Personal preference table
CREATE TABLE IF NOT EXISTS notification.personal_preference(
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    employee_id uuid NOT NULL,
    dnd_enabled boolean NOT NULL DEFAULT false,
    dnd_start time,
    dnd_end time,
    muted_domains text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, employee_id),
    FOREIGN KEY (organization_id, employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE,
    CONSTRAINT muted_domains_valid CHECK (
        muted_domains <@ ARRAY['chat', 'projects', 'docs', 'crm', 'hr', 'support', 'finance', 'system']::text[]
    )
);

-- 2. Document follower preference
ALTER TABLE docs.document_follower 
ADD COLUMN IF NOT EXISTS notification_preference text NOT NULL DEFAULT 'all'
CONSTRAINT document_follower_notification_preference_valid 
CHECK (notification_preference IN ('all', 'mentions', 'muted'));

-- 3. Extended notification types
ALTER TABLE notification.notification 
DROP CONSTRAINT IF EXISTS notification_type_valid;

ALTER TABLE notification.notification
ADD CONSTRAINT notification_type_valid 
CHECK (notification_type IN (
    'message', 'mention', 'reply', 'typing', 'reaction',
    'task_assigned', 'task_status_changed', 'task_commented', 'task_mentioned',
    'doc_updated', 'doc_commented', 'doc_mentioned'
));
```

### Down Migration
```sql
-- YYYYMMDDHHMMSS_add_unified_notification_preferences.down.sql

-- 3. Revert notification types
ALTER TABLE notification.notification 
DROP CONSTRAINT IF EXISTS notification_type_valid;

ALTER TABLE notification.notification
ADD CONSTRAINT notification_type_valid 
CHECK (notification_type IN (
    'message', 'mention', 'reply', 'typing', 'reaction'
));

-- 2. Remove document follower preference
ALTER TABLE docs.document_follower 
DROP COLUMN IF EXISTS notification_preference;

-- 1. Drop personal preference table
DROP TABLE IF EXISTS notification.personal_preference;
```

## Query Impact

### New Queries Needed
1. `GetPersonalPreference` — fetch employee's global preferences
2. `UpsertPersonalPreference` — create or update global preferences
3. `ListDocumentFollowersForNotification` — followers filtered by preference (like chat's `ListChannelMembersForNotification`)
4. `ListTaskWatchersForNotification` — watchers joined with project_membership preference

### Modified Queries
1. `ListChannelMembersForNotification` — unchanged (already works correctly)
2. Any existing follower/watcher queries that need preference column in result

See [contracts/notification.query.sql](contracts/notification.query.sql) for full query definitions.
