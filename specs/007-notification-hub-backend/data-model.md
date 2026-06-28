# Data Model: Notification Hub Backend

**Feature**: Notification Hub Backend  
**Date**: October 28, 2025  
**Schema**: `notification` (new domain schema)

## Overview

The notification hub data model supports:
- Multi-tenant notification storage with organization_id isolation
- Real-time delivery tracking via SSE with connection registry
- Department-based targeting with denormalized membership
- Batch notification support with deduplication
- Priority-based delivery (4 levels: 0=always, 1=not offline, 2=online only, 4=silent)
- Horizontal scaling with instance-level routing
- Indefinite retention with partitioning for scale

---

## Schema: `notification`

### Tables

#### 1. `notification`
Core notification data published by backend services.

```sql
CREATE SCHEMA IF NOT EXISTS notification;

CREATE TABLE IF NOT EXISTS notification.notification (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    
    -- Source information
    source_domain TEXT NOT NULL, -- chat, crm, projects, hr, support, finance, system
    notification_type TEXT NOT NULL, -- message, mention, task_assigned, deal_updated, etc.
    publishing_service_id TEXT, -- Backend service identifier
    
    -- Content
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    
    -- Action data for deep linking
    action_data JSONB, -- {chatThreadId: "...", projectId: "...", etc.}
    action_category TEXT, -- For deduplication: react, comment, update, assign
    
    -- Delivery configuration
    priority SMALLINT NOT NULL DEFAULT 1 CHECK (priority IN (0, 1, 2, 4)),
    -- 0 = deliver always (even if offline)
    -- 1 = deliver when not offline (default)
    -- 2 = deliver when online only
    -- 4 = silent (no delivery, log only)
    
    -- Timestamps
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_notification_org_updated 
    ON notification.notification(organization_id, updated_at DESC);
    
CREATE INDEX IF NOT EXISTS idx_notification_source 
    ON notification.notification(organization_id, source_domain, updated_at DESC);
    
CREATE INDEX IF NOT EXISTS idx_notification_action_data 
    ON notification.notification USING GIN (action_data);

-- Comments
COMMENT ON TABLE notification.notification IS 
    'Core notification data published by backend business domain services';
    
COMMENT ON COLUMN notification.notification.source_domain IS 
    'Backend service that published notification: chat, crm, projects, hr, support, finance, system';
    
COMMENT ON COLUMN notification.notification.action_data IS 
    'Flexible metadata for deep linking to source resource. Example: {"chatThreadId": "uuid", "messageId": "uuid"}';
    
COMMENT ON COLUMN notification.notification.action_category IS 
    'Category for deduplication grouping. Example: react:like and react:unlike both map to "react"';
    
COMMENT ON COLUMN notification.notification.priority IS 
    'Delivery priority: 0=always deliver even if offline, 1=deliver when not offline (default), 2=deliver when online only, 4=silent (no delivery)';
```

#### 2. `notification_recipient`
Links notifications to employees with per-recipient delivery tracking.

```sql
CREATE TABLE IF NOT EXISTS notification.notification_recipient (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    notification_id UUID NOT NULL REFERENCES notification.notification(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES organization.employee(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    
    -- Read status
    read_status BOOLEAN DEFAULT false,
    read_at TIMESTAMPTZ,
    
    -- Delivery tracking
    delivery_status TEXT DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'delivered', 'failed')),
    delivered_at TIMESTAMPTZ,
    delivery_attempts SMALLINT DEFAULT 0,
    last_delivery_error TEXT,
    
    -- Recipient targeting
    recipient_type TEXT NOT NULL DEFAULT 'individual' CHECK (recipient_type IN ('individual', 'department')),
    target_department_ids UUID[], -- If sent to department, store resolved department IDs
    
    -- Timestamps
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_recipient_employee_org 
    ON notification.notification_recipient(employee_id, organization_id, read_status);
    
CREATE INDEX IF NOT EXISTS idx_recipient_notification 
    ON notification.notification_recipient(notification_id);
    
CREATE INDEX IF NOT EXISTS idx_recipient_delivery_status 
    ON notification.notification_recipient(delivery_status, updated_at) 
    WHERE delivery_status = 'pending';
    
CREATE INDEX IF NOT EXISTS idx_recipient_read_status 
    ON notification.notification_recipient(employee_id, organization_id, updated_at DESC) 
    WHERE read_status = false;

-- Comments
COMMENT ON TABLE notification.notification_recipient IS 
    'Links notifications to employees with delivery and read tracking';
    
COMMENT ON COLUMN notification.notification_recipient.recipient_type IS 
    'How recipient was targeted: individual (direct to employee_id) or department (resolved from department membership)';
    
COMMENT ON COLUMN notification.notification_recipient.target_department_ids IS 
    'If sent to department, stores resolved department IDs for audit trail';
    
COMMENT ON COLUMN notification.notification_recipient.delivery_status IS 
    'pending = awaiting delivery, delivered = sent via SSE or fallback, failed = all delivery attempts failed';
```

#### 3. `active_connection` (UNLOGGED)
Connection registry tracking which employees are connected to which backend instances. UNLOGGED for 2-3x write performance; data lost on crash is acceptable (users reconnect).

```sql
CREATE UNLOGGED TABLE IF NOT EXISTS notification.active_connection (
    employee_id UUID NOT NULL REFERENCES organization.employee(id) ON DELETE CASCADE,
    instance_id TEXT NOT NULL, -- Backend instance hostname/ID
    connection_id UUID NOT NULL, -- Unique per SSE connection
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    
    -- Denormalized department membership for fast queries
    department_ids UUID[], -- Populated on connect from organization.department_member
    
    -- Connection tracking
    connected_at TIMESTAMPTZ DEFAULT now(),
    last_heartbeat TIMESTAMPTZ DEFAULT now(),
    connection_status TEXT DEFAULT 'active' CHECK (connection_status IN ('active', 'stale')),
    
    -- Additional metadata
    user_agent TEXT,
    ip_address INET,
    
    PRIMARY KEY (employee_id, connection_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_active_connection_employee 
    ON notification.active_connection(employee_id, connection_status);
    
CREATE INDEX IF NOT EXISTS idx_active_connection_instance 
    ON notification.active_connection(instance_id, connection_status);
    
CREATE INDEX IF NOT EXISTS idx_active_connection_org 
    ON notification.active_connection(organization_id, connection_status);
    
-- GIN index for array overlap queries (department-based targeting)
CREATE INDEX IF NOT EXISTS idx_active_connection_departments 
    ON notification.active_connection USING GIN (department_ids);
    
CREATE INDEX IF NOT EXISTS idx_active_connection_heartbeat 
    ON notification.active_connection(last_heartbeat) 
    WHERE connection_status = 'active';

-- Comments
COMMENT ON TABLE notification.active_connection IS 
    'UNLOGGED table tracking active SSE connections across backend instances. Data lost on crash is acceptable (users reconnect). 2-3x faster writes than regular table.';
    
COMMENT ON COLUMN notification.active_connection.instance_id IS 
    'Backend instance hosting this SSE connection. Example: "backend-pod-abc123" or "instance-1.example.com"';
    
COMMENT ON COLUMN notification.active_connection.department_ids IS 
    'Denormalized department membership for single-query department → users → instances resolution. Updated only on reconnect.';
    
COMMENT ON COLUMN notification.active_connection.last_heartbeat IS 
    'Updated every 30 seconds by SSE connection. Entries with last_heartbeat > 60s old are considered stale and cleaned up.';
```

#### 4. `notification_batch`
Groups related notifications for efficient batching and deduplication.

```sql
CREATE TABLE IF NOT EXISTS notification.notification_batch (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    
    -- Batch identification
    batch_key TEXT NOT NULL, -- For deduplication: "action_category:source_user:resource"
    publishing_service_id TEXT,
    
    -- Batch contents
    notification_ids UUID[],
    target_employee_ids UUID[],
    
    -- Processing
    processing_status TEXT DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
    processed_at TIMESTAMPTZ,
    
    -- Timestamps
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_batch_org_status 
    ON notification.notification_batch(organization_id, processing_status, updated_at);
    
CREATE INDEX IF NOT EXISTS idx_batch_key 
    ON notification.notification_batch(batch_key, organization_id) 
    WHERE processing_status = 'pending';

-- Comments
COMMENT ON TABLE notification.notification_batch IS 
    'Groups related notifications within time window for efficient batching and deduplication';
    
COMMENT ON COLUMN notification.notification_batch.batch_key IS 
    'Deduplication key: "action_category:source_user_id:resource_id". Example: "react:user-123:comment-456"';
```

#### 5. `notification_delivery_log`
Tracks delivery attempts and failures for debugging and fallback triggers.

```sql
CREATE TABLE IF NOT EXISTS notification.notification_delivery_log (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    notification_recipient_id UUID NOT NULL REFERENCES notification.notification_recipient(id) ON DELETE CASCADE,
    
    -- Delivery attempt
    delivery_method TEXT NOT NULL CHECK (delivery_method IN ('sse', 'push', 'email')),
    attempt_number SMALLINT NOT NULL,
    
    -- Result
    delivery_result TEXT NOT NULL CHECK (delivery_result IN ('success', 'failed', 'timeout')),
    error_message TEXT,
    
    -- Timing
    attempted_at TIMESTAMPTZ DEFAULT now(),
    latency_ms INTEGER -- Time from notification creation to delivery
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_delivery_log_recipient 
    ON notification.notification_delivery_log(notification_recipient_id, attempted_at DESC);
    
CREATE INDEX IF NOT EXISTS idx_delivery_log_result 
    ON notification.notification_delivery_log(delivery_result, attempted_at DESC) 
    WHERE delivery_result = 'failed';

-- Comments
COMMENT ON TABLE notification.notification_delivery_log IS 
    'Tracks all delivery attempts for debugging and fallback trigger determination';
    
COMMENT ON COLUMN notification.notification_delivery_log.delivery_method IS 
    'sse = Server-Sent Events (primary), push = mobile push notification, email = email fallback';
```

---

## Entity Relationships

```
notification.notification (1) ──< notification.notification_recipient (N)
    ↑
    └── organization_id → public.organization(id)
    
notification.notification_recipient (N) ──> organization.employee(id)
notification.notification_recipient (1) ──< notification.notification_delivery_log (N)

notification.active_connection (N) ──> organization.employee(id)
notification.active_connection ──> public.organization(id)

notification.notification_batch ──> public.organization(id)
```

---

## Cross-Schema References

| From Schema | To Schema | Reference | Purpose |
|-------------|-----------|-----------|---------|
| notification.notification | public.organization | organization_id | Tenant isolation |
| notification.notification_recipient | organization.employee | employee_id | Recipient employee |
| notification.notification_recipient | public.organization | organization_id | Tenant isolation (denormalized) |
| notification.active_connection | organization.employee | employee_id | Connected employee |
| notification.active_connection | public.organization | organization_id | Tenant isolation |

**Note**: `department_ids` in `active_connection` is denormalized from `organization.department_member`. NO foreign key constraint to allow stale data (updated on reconnect only).

---

## Data Volume Estimates

| Table | Rows per Org per Day | Rows per Org per Month | Storage per Row | Total Storage (1 year, 1k orgs) |
|-------|---------------------|----------------------|-----------------|--------------------------------|
| notification | 100,000 | 3,000,000 | ~500 bytes | ~18 TB |
| notification_recipient | 300,000 | 9,000,000 | ~200 bytes | ~22 TB |
| active_connection | 1,000 (peak) | N/A (ephemeral) | ~150 bytes | ~150 MB |
| notification_batch | 10,000 | 300,000 | ~300 bytes | ~1 TB |
| notification_delivery_log | 350,000 | 10,500,000 | ~150 bytes | ~19 TB |

**Total**: ~60 TB for 1 year with 1,000 organizations at 100k notifications/day each.

**Partitioning Strategy**:
- Partition `notification` and `notification_recipient` by `updated_at` (monthly partitions)
- Drop old partitions after retention period (indefinite for now, but infrastructure ready)
- `active_connection` is UNLOGGED and ephemeral (no partitioning needed)

---

## Constraints & Validation

### NOT NULL Constraints
- All `id`, `organization_id`, `employee_id` fields are NOT NULL
- `notification.title`, `notification.message` are NOT NULL
- `notification_recipient.delivery_status` has default 'pending'

### CHECK Constraints
- `notification.priority` must be IN (0, 1, 2, 4)
- `notification_recipient.delivery_status` must be IN ('pending', 'delivered', 'failed')
- `notification_recipient.recipient_type` must be IN ('individual', 'department')
- `active_connection.connection_status` must be IN ('active', 'stale')
- `notification_batch.processing_status` must be IN ('pending', 'processing', 'completed', 'failed')
- `notification_delivery_log.delivery_method` must be IN ('sse', 'push', 'email')
- `notification_delivery_log.delivery_result` must be IN ('success', 'failed', 'timeout')

### Foreign Key Constraints
- All `organization_id` → `public.organization(id)` with CASCADE delete
- All `employee_id` → `organization.employee(id)` with CASCADE delete
- `notification_recipient.notification_id` → `notification.notification(id)` with CASCADE delete
- `notification_delivery_log.notification_recipient_id` → `notification.notification_recipient(id)` with CASCADE delete

**Exception**: `active_connection.department_ids` has NO foreign key constraint (denormalized, stale allowed)

---

## Indexes Strategy

### Performance-Critical Indexes
1. **Employee notification list**: `(employee_id, organization_id, read_status)` on `notification_recipient`
2. **Department targeting**: GIN index on `department_ids` in `active_connection`
3. **Connection registry lookup**: `(employee_id, connection_status)` on `active_connection`
4. **Instance routing**: `(instance_id, connection_status)` on `active_connection`
5. **Heartbeat cleanup**: `(last_heartbeat)` on `active_connection` WHERE `connection_status = 'active'`
6. **Pending deliveries**: `(delivery_status, updated_at)` on `notification_recipient` WHERE `delivery_status = 'pending'`

### Query Patterns
```sql
-- Employee list notifications (most common query)
SELECT nr.*, n.* 
FROM notification.notification_recipient nr
JOIN notification.notification n ON nr.notification_id = n.id
WHERE nr.employee_id = $1 
  AND nr.organization_id = $2
ORDER BY n.updated_at DESC
LIMIT 50;
-- Uses: idx_recipient_employee_org

-- Department-based targeting (registry query for publishing)
SELECT instance_id, array_agg(employee_id) 
FROM notification.active_connection
WHERE department_ids && ARRAY[$1, $2]::uuid[]
  AND organization_id = $3
  AND connection_status = 'active'
GROUP BY instance_id;
-- Uses: idx_active_connection_departments (GIN index)

-- Connection registry cleanup (background job)
UPDATE notification.active_connection
SET connection_status = 'stale'
WHERE last_heartbeat < now() - INTERVAL '60 seconds'
  AND connection_status = 'active';
-- Uses: idx_active_connection_heartbeat

-- Mark all before timestamp as read (bulk operation)
UPDATE notification.notification_recipient
SET read_status = true, read_at = now()
WHERE employee_id = $1
  AND organization_id = $2
  AND updated_at < $3
  AND read_status = false;
-- Uses: idx_recipient_employee_org
```

---

## Migration Strategy

### Atlas Migration
```bash
# Generate migration from schema.sql changes
source .env
cd backend
./scripts/atlas/01_migration_create.sh add_notification_system
./scripts/atlas/02_migrate_apply.sh
```

### Rollback Plan
```sql
-- Rollback: Drop notification schema (CASCADE will handle all tables)
DROP SCHEMA IF EXISTS notification CASCADE;
```

**Note**: New schema, no existing data to migrate. Safe to create.

---

## Security & Compliance

### Tenant Isolation
- All tables include `organization_id` with foreign key to `public.organization`
- All employee-facing queries MUST filter by `organization_id`
- Connection registry queries MUST validate organization context
- Publishing API (AdminPool) creates notifications but recipients are validated against organization

### Data Retention
- Indefinite retention for audit trail
- Partitioning enables future archival without schema changes
- `active_connection` is ephemeral (UNLOGGED) - no retention needed

### PII Considerations
- `notification.message` may contain employee names, customer names
- `active_connection.ip_address` is PII
- Consider GDPR right to deletion: CASCADE delete via `employee_id` FK

---

## Future Enhancements

**Deferred to v2**:
- Employee notification preferences table (opt-in/opt-out by notification_type)
- Organization-level notification configuration table
- Notification templates table for consistent messaging
- Notification analytics table (open rate, click rate, engagement)
- Full-text search indexes on `notification.message`
- Time-series partitioning automation
- Read replica routing for notification list queries

---

**Status**: Data model complete. Ready for contract generation (Phase 1 continued).
