# Data Model: User Status and Notification Popup

**Date**: November 4, 2025  
**Schema**: notification (primary), references organization schema

## Entity-Relationship Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  organization.employee (existing)                               │
│  - id (PK)                                                      │
│  - organization_id (FK → organization.organization)             │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 │ FK (employee_id, organization_id)
                 │
    ┌────────────┴──────────────┬──────────────────┬─────────────────┐
    │                           │                  │                 │
┌───┴──────────────────────┐ ┌──┴───────────────┐ │  ┌──────────────┴────────────┐
│ active_connection        │ │ push_token       │ │  │ presence_visibility       │
│ (EXTENDED)               │ │ (NEW)            │ │  │ (NEW)                     │
│                          │ │                  │ │  │                           │
│ - connection_id (PK)     │ │ - token_id (PK)  │ │  │ - employee_id (PK)        │
│ - employee_id (FK)       │ │ - employee_id    │ │  │ - organization_id (FK)    │
│ - organization_id (FK)   │ │ - organization_id│ │  │ - visibility_mode         │
│ - presence_status (NEW)  │ │ - device_id      │ │  │ - custom_status_text      │
│ - active_channel_id (NEW)│ │ - fcm_token      │ │  │ - custom_status_emoji     │
│ - last_interaction_at    │ │ - endpoint       │ │  │ - updated_at              │
│ - instance_id            │ │ - keys           │ │  └───────────────────────────┘
│ - last_heartbeat         │ │ - is_valid       │ │
│ - created_at             │ │ - registered_at  │ │
│                          │ │ - last_used_at   │ │
└──────────────────────────┘ └──────────────────┘ │
                 │                                 │
                 │ FK (active_channel_id)          │
                 ↓                                 │
┌──────────────────────────────────────────────────┴─┐
│  chat.channel (existing)                           │
│  - id (PK)                                         │
│  - organization_id (FK)                            │
└────────────────────────────────────────────────────┘
```

---

## Table Definitions

### 1. notification.active_connection (EXTENDED)

**Purpose**: Track active SSE connections with presence status and active channel context

**Citus Distribution**: Distributed table, sharded by `organization_id`

**Schema Changes**:
```sql
-- Extend existing table with presence tracking fields
ALTER TABLE notification.active_connection
    ADD COLUMN IF NOT EXISTS presence_status TEXT NOT NULL DEFAULT 'online'
        CHECK (presence_status IN ('online', 'online_hidden', 'idle', 'offline')),
    ADD COLUMN IF NOT EXISTS active_channel_id UUID NULL,
    ADD COLUMN IF NOT EXISTS last_interaction_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Add foreign key for active_channel_id (composite key for Citus)
ALTER TABLE notification.active_connection
    ADD CONSTRAINT fk_active_connection_channel
        FOREIGN KEY (organization_id, active_channel_id)
        REFERENCES chat.channel(organization_id, id)
        ON DELETE SET NULL;  -- If channel deleted, clear active_channel_id

-- Add index for presence queries (organization_id first for Citus)
CREATE INDEX IF NOT EXISTS idx_active_connection_org_presence
    ON notification.active_connection(organization_id, presence_status, last_heartbeat DESC);

-- Add index for active channel queries
CREATE INDEX IF NOT EXISTS idx_active_connection_org_channel
    ON notification.active_connection(organization_id, active_channel_id)
    WHERE active_channel_id IS NOT NULL;

-- Add comments
COMMENT ON COLUMN notification.active_connection.presence_status IS 
    'Employee presence status: online (tab focused), online_hidden (tab not focused), idle (no interaction 5+ min), offline (no heartbeat)';

COMMENT ON COLUMN notification.active_connection.active_channel_id IS 
    'UUID of chat channel currently being viewed by employee (NULL if not viewing chat)';

COMMENT ON COLUMN notification.active_connection.last_interaction_at IS 
    'Timestamp of last user interaction (mouse, keyboard, scroll) for idle detection';
```

**Existing Columns** (for reference):
- `connection_id UUID PRIMARY KEY DEFAULT uuidv7()` - Unique connection identifier
- `employee_id UUID NOT NULL` - Employee owning this connection
- `organization_id UUID NOT NULL` - Organization (for multi-tenancy)
- `instance_id TEXT NOT NULL` - Backend server instance identifier
- `last_heartbeat TIMESTAMPTZ NOT NULL` - Last heartbeat timestamp
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()` - Connection establishment time

**New Columns**:
- `presence_status TEXT NOT NULL DEFAULT 'online'` - Current presence state
- `active_channel_id UUID NULL` - Channel being actively viewed (NULL if not in chat)
- `last_interaction_at TIMESTAMPTZ NOT NULL DEFAULT now()` - Last user interaction time

**Composite Primary Key**: `(organization_id, connection_id)` (Citus requirement)

**Foreign Keys**:
- `(organization_id, employee_id) → organization.employee(organization_id, id)` - Employee reference
- `(organization_id, active_channel_id) → chat.channel(organization_id, id)` - Channel reference (nullable)

**Indexes**:
- Primary: `(organization_id, connection_id)` - Citus distributed PK
- Presence queries: `(organization_id, presence_status, last_heartbeat DESC)` - Find online/idle connections
- Channel filtering: `(organization_id, active_channel_id)` WHERE not NULL - Route ephemeral signals

**CHECK Constraints**:
- `presence_status IN ('online', 'online_hidden', 'idle', 'offline')` - Valid status values only

**Lifecycle**:
- Created when SSE connection established (existing behavior)
- Updated every 30s via heartbeat (presence_status, active_channel_id, last_interaction_at)
- Deleted when SSE connection closes or timeout cleanup (60s stale heartbeat)

**Query Patterns**:
```sql
-- Find all online connections for routing in-app notifications
SELECT connection_id, employee_id, active_channel_id
FROM notification.active_connection
WHERE organization_id = $1
  AND presence_status IN ('online', 'online_hidden')
  AND last_heartbeat > now() - interval '60 seconds';

-- Find connections actively viewing specific channel (for ephemeral signals)
SELECT connection_id, employee_id
FROM notification.active_connection
WHERE organization_id = $1
  AND active_channel_id = $2
  AND presence_status = 'online'
  AND last_heartbeat > now() - interval '60 seconds';

-- Cleanup stale connections (background job, AdminPool)
DELETE FROM notification.active_connection
WHERE last_heartbeat < now() - interval '60 seconds';
```

---

### 2. notification.push_token (NEW)

**Purpose**: Store Firebase Cloud Messaging tokens for browser push notifications

**Citus Distribution**: Distributed table, sharded by `organization_id`

**Schema**:
```sql
CREATE TABLE IF NOT EXISTS notification.push_token (
    token_id UUID DEFAULT uuidv7(),
    employee_id UUID NOT NULL,
    organization_id UUID NOT NULL,
    device_identifier UUID NOT NULL,  -- Browser fingerprint or generated UUID
    fcm_token TEXT NOT NULL,          -- Firebase Cloud Messaging token
    endpoint TEXT NOT NULL,           -- Push service endpoint URL
    keys JSONB NOT NULL,              -- Encryption keys {p256dh, auth}
    is_valid BOOLEAN NOT NULL DEFAULT true,
    registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key (Citus requirement)
    CONSTRAINT pk_push_token PRIMARY KEY (organization_id, token_id),
    
    -- Foreign key to employee
    CONSTRAINT fk_push_token_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE CASCADE,
    
    -- Unique token per device
    CONSTRAINT uk_push_token_device
        UNIQUE (organization_id, employee_id, device_identifier)
);

-- Index for querying employee's active tokens (organization_id first for Citus)
CREATE INDEX IF NOT EXISTS idx_push_token_org_employee_valid
    ON notification.push_token(organization_id, employee_id)
    WHERE is_valid = true;

-- Index for cleanup queries (unused tokens)
CREATE INDEX IF NOT EXISTS idx_push_token_last_used
    ON notification.push_token(organization_id, last_used_at)
    WHERE is_valid = true;

-- Comments
COMMENT ON TABLE notification.push_token IS 
    'Firebase Cloud Messaging tokens for browser push notifications. Supports multiple devices per employee.';

COMMENT ON COLUMN notification.push_token.device_identifier IS 
    'Unique identifier for browser/device. Generated on first permission grant. Allows multiple tokens per employee.';

COMMENT ON COLUMN notification.push_token.fcm_token IS 
    'FCM registration token from Firebase SDK. Used to send push notifications.';

COMMENT ON COLUMN notification.push_token.keys IS 
    'VAPID encryption keys for push messages. JSON: {p256dh: string, auth: string}';

COMMENT ON COLUMN notification.push_token.is_valid IS 
    'Token validity status. Set to false when FCM send fails (expired/unregistered token).';
```

**Columns**:
- `token_id UUID` - Primary key (UUID v7)
- `employee_id UUID NOT NULL` - Employee owning this token
- `organization_id UUID NOT NULL` - Organization (for multi-tenancy)
- `device_identifier UUID NOT NULL` - Unique device/browser ID (allows multiple tokens per employee)
- `fcm_token TEXT NOT NULL` - Firebase Cloud Messaging registration token
- `endpoint TEXT NOT NULL` - Push service endpoint URL (FCM endpoint)
- `keys JSONB NOT NULL` - Encryption keys for VAPID (p256dh and auth keys)
- `is_valid BOOLEAN NOT NULL DEFAULT true` - Token validity (false if send failures)
- `registered_at TIMESTAMPTZ NOT NULL` - Token registration timestamp
- `last_used_at TIMESTAMPTZ NOT NULL` - Last successful push send timestamp
- `updated_at TIMESTAMPTZ NOT NULL` - Last record update

**Composite Primary Key**: `(organization_id, token_id)` (Citus requirement)

**Foreign Keys**:
- `(organization_id, employee_id) → organization.employee(organization_id, id)` - Employee reference (CASCADE delete when employee deleted)

**Unique Constraints**:
- `(organization_id, employee_id, device_identifier)` - One token per device per employee

**Indexes**:
- Primary: `(organization_id, token_id)` - Citus distributed PK
- Employee tokens: `(organization_id, employee_id)` WHERE is_valid - Find active tokens for sending
- Cleanup: `(organization_id, last_used_at)` WHERE is_valid - Find unused tokens for cleanup

**Lifecycle**:
- Created when employee grants browser notification permissions
- Updated with last_used_at on each push send
- Marked invalid (is_valid=false) when FCM send fails
- Deleted when employee revokes permissions or token unused for 90+ days

**Query Patterns**:
```sql
-- Get all valid tokens for employee (send push to all devices)
-- name: GetEmployeePushTokens :many
SELECT token_id, fcm_token, endpoint, keys
FROM notification.push_token
WHERE organization_id = $1
  AND employee_id = $2
  AND is_valid = true;

-- Register new push token
-- name: UpsertPushToken :one
INSERT INTO notification.push_token (
    token_id, employee_id, organization_id, device_identifier,
    fcm_token, endpoint, keys, registered_at, last_used_at, updated_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT (organization_id, employee_id, device_identifier) DO UPDATE
SET fcm_token = EXCLUDED.fcm_token,
    endpoint = EXCLUDED.endpoint,
    keys = EXCLUDED.keys,
    is_valid = true,
    updated_at = $10
RETURNING *;

-- Mark token invalid after send failure
-- name: InvalidatePushToken :exec
UPDATE notification.push_token
SET is_valid = false, updated_at = $3
WHERE organization_id = $1
  AND token_id = $2;

-- Update last_used_at after successful send
-- name: UpdatePushTokenLastUsed :exec
UPDATE notification.push_token
SET last_used_at = $3, updated_at = $3
WHERE organization_id = $1
  AND token_id = $2;

-- Cleanup unused tokens (AdminPool, background job)
DELETE FROM notification.push_token
WHERE is_valid = true
  AND last_used_at < now() - interval '90 days';
```

---

### 3. notification.presence_visibility (NEW)

**Purpose**: Store employee presence visibility settings and custom status

**Citus Distribution**: Distributed table, sharded by `organization_id`

**Schema**:
```sql
CREATE TABLE IF NOT EXISTS notification.presence_visibility (
    employee_id UUID NOT NULL,
    organization_id UUID NOT NULL,
    visibility_mode TEXT NOT NULL DEFAULT 'everyone'
        CHECK (visibility_mode IN ('everyone', 'departments', 'offline')),
    custom_status_text TEXT NULL,
    custom_status_emoji TEXT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key (Citus requirement)
    CONSTRAINT pk_presence_visibility PRIMARY KEY (organization_id, employee_id),
    
    -- Foreign key to employee
    CONSTRAINT fk_presence_visibility_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE CASCADE
);

-- Index for visibility queries (organization_id first for Citus)
CREATE INDEX IF NOT EXISTS idx_presence_visibility_org_mode
    ON notification.presence_visibility(organization_id, visibility_mode);

-- Comments
COMMENT ON TABLE notification.presence_visibility IS 
    'Employee presence visibility settings. Controls who can see real presence status (online/idle/offline).';

COMMENT ON COLUMN notification.presence_visibility.visibility_mode IS 
    'Visibility mode: everyone (all org members), departments (same departments only), offline (always appear offline)';

COMMENT ON COLUMN notification.presence_visibility.custom_status_text IS 
    'Custom status message displayed alongside presence indicator (e.g., "In meeting", "On vacation")';

COMMENT ON COLUMN notification.presence_visibility.custom_status_emoji IS 
    'Optional emoji for custom status (e.g., "📅", "🏖️")';
```

**Columns**:
- `employee_id UUID NOT NULL` - Employee ID (composite PK with organization_id)
- `organization_id UUID NOT NULL` - Organization (for multi-tenancy)
- `visibility_mode TEXT NOT NULL DEFAULT 'everyone'` - Who can see real presence
- `custom_status_text TEXT NULL` - Custom status message (e.g., "In meeting")
- `custom_status_emoji TEXT NULL` - Optional emoji for status
- `updated_at TIMESTAMPTZ NOT NULL` - Last settings update

**Composite Primary Key**: `(organization_id, employee_id)` (Citus requirement, one record per employee)

**Foreign Keys**:
- `(organization_id, employee_id) → organization.employee(organization_id, id)` - Employee reference (CASCADE delete)

**CHECK Constraints**:
- `visibility_mode IN ('everyone', 'departments', 'offline')` - Valid visibility modes only

**Indexes**:
- Primary: `(organization_id, employee_id)` - Citus distributed PK
- Mode queries: `(organization_id, visibility_mode)` - Filter employees by visibility mode

**Defaults**:
- New employees default to `visibility_mode='everyone'` (transparent by default)
- No custom status text/emoji initially

**Lifecycle**:
- Created when employee first changes visibility settings (or defaults on first presence query)
- Updated when employee modifies settings
- Deleted when employee deleted (CASCADE)

**Query Patterns**:
```sql
-- Get employee visibility settings
-- name: GetPresenceVisibility :one
SELECT visibility_mode, custom_status_text, custom_status_emoji
FROM notification.presence_visibility
WHERE organization_id = $1
  AND employee_id = $2;

-- Upsert visibility settings
-- name: UpsertPresenceVisibility :one
INSERT INTO notification.presence_visibility (
    employee_id, organization_id, visibility_mode,
    custom_status_text, custom_status_emoji, updated_at
)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (organization_id, employee_id) DO UPDATE
SET visibility_mode = EXCLUDED.visibility_mode,
    custom_status_text = EXCLUDED.custom_status_text,
    custom_status_emoji = EXCLUDED.custom_status_emoji,
    updated_at = $6
RETURNING *;

-- Check if two employees share departments (for "departments" visibility mode)
-- name: SharesDepartment :one
SELECT EXISTS (
    SELECT 1
    FROM organization.department_member dm1
    INNER JOIN organization.department_member dm2
        ON dm1.organization_id = dm2.organization_id
        AND dm1.department_id = dm2.department_id
    WHERE dm1.organization_id = $1
      AND dm1.employee_id = $2
      AND dm2.employee_id = $3
) AS shares_department;
```

---

## Migration Strategy

### Migration Files (golang-migrate)

**File 1**: `YYYYMMDDHHMMSS_extend_active_connection_presence.up.sql`
```sql
-- Add presence tracking fields to active_connection
ALTER TABLE notification.active_connection
    ADD COLUMN IF NOT EXISTS presence_status TEXT NOT NULL DEFAULT 'online'
        CHECK (presence_status IN ('online', 'online_hidden', 'idle', 'offline')),
    ADD COLUMN IF NOT EXISTS active_channel_id UUID NULL,
    ADD COLUMN IF NOT EXISTS last_interaction_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Add foreign key for active_channel_id (Citus composite key)
ALTER TABLE notification.active_connection
    ADD CONSTRAINT fk_active_connection_channel
        FOREIGN KEY (organization_id, active_channel_id)
        REFERENCES chat.channel(organization_id, id)
        ON DELETE SET NULL;

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_active_connection_org_presence
    ON notification.active_connection(organization_id, presence_status, last_heartbeat DESC);

CREATE INDEX IF NOT EXISTS idx_active_connection_org_channel
    ON notification.active_connection(organization_id, active_channel_id)
    WHERE active_channel_id IS NOT NULL;

-- Add comments
COMMENT ON COLUMN notification.active_connection.presence_status IS 
    'Employee presence status: online (tab focused), online_hidden (tab not focused), idle (no interaction 5+ min), offline (no heartbeat)';

COMMENT ON COLUMN notification.active_connection.active_channel_id IS 
    'UUID of chat channel currently being viewed by employee (NULL if not viewing chat)';

COMMENT ON COLUMN notification.active_connection.last_interaction_at IS 
    'Timestamp of last user interaction (mouse, keyboard, scroll) for idle detection';
```

**File 2**: `YYYYMMDDHHMMSS_extend_active_connection_presence.down.sql`
```sql
-- Remove indexes
DROP INDEX IF EXISTS notification.idx_active_connection_org_channel;
DROP INDEX IF EXISTS notification.idx_active_connection_org_presence;

-- Remove foreign key
ALTER TABLE notification.active_connection
    DROP CONSTRAINT IF EXISTS fk_active_connection_channel;

-- Remove columns
ALTER TABLE notification.active_connection
    DROP COLUMN IF EXISTS last_interaction_at,
    DROP COLUMN IF EXISTS active_channel_id,
    DROP COLUMN IF EXISTS presence_status;
```

**File 3**: `YYYYMMDDHHMMSS_create_push_token_table.up.sql`
```sql
CREATE TABLE IF NOT EXISTS notification.push_token (
    token_id UUID DEFAULT uuidv7(),
    employee_id UUID NOT NULL,
    organization_id UUID NOT NULL,
    device_identifier UUID NOT NULL,
    fcm_token TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    keys JSONB NOT NULL,
    is_valid BOOLEAN NOT NULL DEFAULT true,
    registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT pk_push_token PRIMARY KEY (organization_id, token_id),
    
    CONSTRAINT fk_push_token_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE CASCADE,
    
    CONSTRAINT uk_push_token_device
        UNIQUE (organization_id, employee_id, device_identifier)
);

CREATE INDEX IF NOT EXISTS idx_push_token_org_employee_valid
    ON notification.push_token(organization_id, employee_id)
    WHERE is_valid = true;

CREATE INDEX IF NOT EXISTS idx_push_token_last_used
    ON notification.push_token(organization_id, last_used_at)
    WHERE is_valid = true;

COMMENT ON TABLE notification.push_token IS 
    'Firebase Cloud Messaging tokens for browser push notifications. Supports multiple devices per employee.';

-- Distribute table (Citus)
SELECT create_distributed_table('notification.push_token', 'organization_id');
```

**File 4**: `YYYYMMDDHHMMSS_create_push_token_table.down.sql`
```sql
DROP TABLE IF EXISTS notification.push_token;
```

**File 5**: `YYYYMMDDHHMMSS_create_presence_visibility_table.up.sql`
```sql
CREATE TABLE IF NOT EXISTS notification.presence_visibility (
    employee_id UUID NOT NULL,
    organization_id UUID NOT NULL,
    visibility_mode TEXT NOT NULL DEFAULT 'everyone'
        CHECK (visibility_mode IN ('everyone', 'departments', 'offline')),
    custom_status_text TEXT NULL,
    custom_status_emoji TEXT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT pk_presence_visibility PRIMARY KEY (organization_id, employee_id),
    
    CONSTRAINT fk_presence_visibility_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_presence_visibility_org_mode
    ON notification.presence_visibility(organization_id, visibility_mode);

COMMENT ON TABLE notification.presence_visibility IS 
    'Employee presence visibility settings. Controls who can see real presence status (online/idle/offline).';

-- Distribute table (Citus)
SELECT create_distributed_table('notification.presence_visibility', 'organization_id');
```

**File 6**: `YYYYMMDDHHMMSS_create_presence_visibility_table.down.sql`
```sql
DROP TABLE IF EXISTS notification.presence_visibility;
```

### Migration Application Workflow

1. Update canonical schema: `backend/database/scripts/schema.sql`
2. Author migration files above in `backend/k8s/base/database/migrations/`
3. Apply locally: `cd backend && ./scripts/migrate.sh`
4. Resolve dirty states if needed: `migrate force <version>`, then rerun migrate.sh
5. Commit schema + migrations + generated code in same PR

---

## Data Validation Rules

### Presence Status Transitions
- `online` → `online_hidden`: Tab loses focus
- `online_hidden` → `online`: Tab regains focus
- `online` → `idle`: 5+ minutes no interaction
- `idle` → `online`: User interaction detected
- Any → `offline`: Heartbeat stale > 60s OR SSE connection closes

### Push Token Validation
- `fcm_token` must match FCM token format (validated by FCM SDK)
- `device_identifier` must be UUID v4 or v7
- `keys` must contain `{p256dh: string, auth: string}` (validated by JSON schema in application)
- `is_valid` set to false only after FCM send failure (not user action)

### Visibility Mode Rules
- Default to `everyone` for new employees
- `departments` mode requires querying `organization.department_member` for shared departments
- `offline` mode overrides real presence, always returns "offline" to viewers
- Custom status shown regardless of visibility mode (always visible)

---

## Indexing Strategy

### Performance-Critical Queries

1. **Routing In-App Notifications**:
   - Query: Find online/online_hidden connections for organization
   - Index: `(organization_id, presence_status, last_heartbeat DESC)`
   - Cardinality: High (thousands of connections)

2. **Ephemeral Signal Routing**:
   - Query: Find connections viewing specific channel with online status
   - Index: `(organization_id, active_channel_id)` WHERE not NULL
   - Cardinality: Medium (10-100 viewers per channel)

3. **Push Token Retrieval**:
   - Query: Get all valid tokens for employee
   - Index: `(organization_id, employee_id)` WHERE is_valid
   - Cardinality: Low (1-5 tokens per employee)

4. **Presence Visibility Check**:
   - Query: Get visibility settings for employee
   - Index: Primary key `(organization_id, employee_id)` (automatic)

### Index Maintenance
- Cleanup stale connections removes records (no index bloat)
- Push token cleanup deletes unused records (auto-VACUUM)
- Presence visibility is mostly updates (no growth)

---

## Multi-Tenancy Compliance

### All Tables Follow Citus Requirements:
- ✅ Composite primary keys include `organization_id` first
- ✅ All foreign keys reference composite keys `(organization_id, id)`
- ✅ All indexes start with `organization_id`
- ✅ All queries filter by `organization_id` explicitly
- ✅ Distributed tables sharded by `organization_id`

### Foreign Key Patterns:
- `push_token` → `employee`: `(organization_id, employee_id)` composite FK
- `presence_visibility` → `employee`: `(organization_id, employee_id)` composite FK
- `active_connection` → `channel`: `(organization_id, active_channel_id)` composite FK (nullable)

### Tenant Isolation:
- All queries include `WHERE organization_id = $1`
- TenantPool enforces organization context at connection level
- AdminPool used only for cross-tenant cleanup (documented justification)
