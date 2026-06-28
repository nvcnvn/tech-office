# Data Model: Unified Color Scheme System with Light/Dark Mode

**Feature**: 013-dark-mode-and-color-scheme  
**Date**: 2025-11-09  
**Status**: Complete

## Schema Overview

**Schema**: `iam` (Identity and Access Management)  
**New Tables**: 1 (`user_preference`)  
**Modified Tables**: None  
**Dependencies**: `public.organization`, `organization.employee`

---

## Table Definitions

### iam.user_preference

Stores user-specific application preferences including theme mode selection.

```sql
CREATE TABLE IF NOT EXISTS iam.user_preference (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL,
    
    -- Theme preferences
    theme_mode TEXT NOT NULL CHECK (theme_mode IN ('light', 'dark')),
    preference_source TEXT NOT NULL CHECK (preference_source IN ('manual', 'os_default')),
    
    -- Extensibility for future preferences (notifications, locale, timezone, etc.)
    additional_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
    
    -- Timestamps
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Composite primary key for Citus sharding (organization_id first)
    PRIMARY KEY (organization_id, id),
    
    -- Foreign key to employee
    CONSTRAINT fk_user_preference_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE CASCADE,
    
    -- One preference record per employee
    CONSTRAINT unique_employee_preference UNIQUE (organization_id, employee_id)
);

-- Citus distribution
SELECT create_distributed_table('iam.user_preference', 'organization_id');

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_preference_employee 
    ON iam.user_preference(organization_id, employee_id);

CREATE INDEX IF NOT EXISTS idx_user_preference_updated 
    ON iam.user_preference(organization_id, updated_at DESC);

-- Comments
COMMENT ON TABLE iam.user_preference IS 
'User-specific application preferences including theme mode, with extensibility for future preferences (notifications, locale, timezone). One record per employee.';

COMMENT ON COLUMN iam.user_preference.theme_mode IS 
'Active theme mode: light or dark. MUST align with backend constants in internal/preference/constants.go and frontend TypeScript type ThemeMode in packages/apis/src/types.ts';

COMMENT ON COLUMN iam.user_preference.preference_source IS 
'How theme was selected: manual (user clicked toggle) or os_default (detected from prefers-color-scheme). Determines whether OS preference changes should override theme (only if os_default).';

COMMENT ON COLUMN iam.user_preference.additional_preferences IS 
'JSONB field for future preference extensions (e.g., {"locale": "en-US", "timezone": "America/New_York", "notifications": {...}}). Enables schema evolution without migrations.';
```

**Rationale**:
- **Schema placement**: `iam` schema for user identity-related data (preferences are user-scoped)
- **Composite PK**: `(organization_id, id)` enables Citus sharding per Constitution Principle I
- **CHECK constraints**: Enforce valid theme modes per Constitution Principle VIII
- **`preference_source`**: Enables FR-017, FR-018 logic (detect OS preference on first visit, preserve manual selection)
- **`additional_preferences` JSONB**: Future-proof for locale, timezone, notification preferences without schema changes (YAGNI compliance)
- **`updated_at` only**: No `created_at` per Constitution standard (creation time is UUID v7 timestamp)

**Citus Sharding Compliance**:
- ✅ Primary key includes `organization_id` as first column
- ✅ Foreign keys reference composite keys `(organization_id, employee_id)`
- ✅ All indexes include `organization_id` as first column
- ✅ No triggers (Citus constraint)
- ✅ `ON DELETE CASCADE` supported (Citus-compatible FK action)

---

## Migration Strategy

**Migration Files** (golang-migrate):
- `backend/k8s/base/database/migrations/20251109120000_add_user_preference_table.up.sql`
- `backend/k8s/base/database/migrations/20251109120000_add_user_preference_table.down.sql`

**Up Migration**:
```sql
-- Create user_preference table
CREATE TABLE IF NOT EXISTS iam.user_preference (
    id UUID DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL,
    theme_mode TEXT NOT NULL CHECK (theme_mode IN ('light', 'dark')) DEFAULT 'light',
    preference_source TEXT NOT NULL CHECK (preference_source IN ('manual', 'os_default')) DEFAULT 'os_default',
    additional_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, id),
    CONSTRAINT fk_user_preference_employee
        FOREIGN KEY (organization_id, employee_id)
        REFERENCES organization.employee(organization_id, id)
        ON DELETE CASCADE,
    CONSTRAINT unique_employee_preference UNIQUE (organization_id, employee_id)
);

SELECT create_distributed_table('iam.user_preference', 'organization_id');

CREATE INDEX IF NOT EXISTS idx_user_preference_employee 
    ON iam.user_preference(organization_id, employee_id);

CREATE INDEX IF NOT EXISTS idx_user_preference_updated 
    ON iam.user_preference(organization_id, updated_at DESC);

COMMENT ON TABLE iam.user_preference IS 
'User-specific application preferences including theme mode, with extensibility for future preferences.';
```

**Down Migration**:
```sql
DROP TABLE IF EXISTS iam.user_preference;
```

**Migration Workflow**:
1. Update `backend/database/scripts/schema.sql` (authoritative)
2. Create paired `.up.sql` and `.down.sql` migration files
3. Run locally: `cd backend && ./scripts/migrate.sh`
4. Verify schema with `docker compose exec postgres psql -U postgres -d tech_office_db -c "\d iam.user_preference"`
5. Commit schema.sql + migration files in same PR

---

## sqlc Query Definitions

**File**: `backend/database/scripts/iam.query.sql`

```sql
-- name: GetUserPreference :one
SELECT * FROM iam.user_preference
WHERE organization_id = $1 AND employee_id = $2
LIMIT 1;

-- name: UpsertUserPreference :one
INSERT INTO iam.user_preference (
    id,
    organization_id,
    employee_id,
    theme_mode,
    preference_source,
    additional_preferences,
    updated_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7
) ON CONFLICT (organization_id, employee_id) DO UPDATE SET
    theme_mode = EXCLUDED.theme_mode,
    preference_source = EXCLUDED.preference_source,
    additional_preferences = EXCLUDED.additional_preferences,
    updated_at = EXCLUDED.updated_at
RETURNING *;

-- name: DeleteUserPreference :exec
DELETE FROM iam.user_preference
WHERE organization_id = $1 AND employee_id = $2;

-- name: ListRecentPreferenceChanges :many
SELECT * FROM iam.user_preference
WHERE organization_id = $1 AND updated_at > $2
ORDER BY updated_at DESC
LIMIT $3;
```

**Query Rationale**:
- **GetUserPreference**: Read user's current theme preference (used on page load, cross-device sync polling)
- **UpsertUserPreference**: Insert or update preference (handles first-time users and theme changes with parameterized `updated_at` per Citus constraint)
- **DeleteUserPreference**: Reset to default (admin operations, user account cleanup)
- **ListRecentPreferenceChanges**: Optional audit query for debugging sync issues

**Citus Compliance**:
- ✅ All queries filter by `organization_id` (tenant isolation)
- ✅ ON CONFLICT uses parameterized `updated_at` (no `now()` in UPDATE clause per Citus constraint)
- ✅ No volatile functions in conflict handlers

---

## Generated Code

**Backend** (generated by `sqlc generate`):
- `backend/database/models.go`: `UserPreference` struct
- `backend/database/iam.query.sql.go`: Type-safe query methods
  - `GetUserPreference(ctx, orgID, employeeID)`
  - `UpsertUserPreference(ctx, params)`
  - `DeleteUserPreference(ctx, orgID, employeeID)`
  - `ListRecentPreferenceChanges(ctx, params)`

**Frontend** (generated by `buf generate`):
- `frontend/packages/rpc/rpc/v1/preference_pb.ts`: TypeScript message types
- `frontend/packages/rpc/rpc/v1/preference_connect.ts`: ConnectRPC client

---

## Data Flow

### 1. First Visit (No Preference)
```
User loads app
  → Frontend detects OS preference (prefers-color-scheme)
  → Apply detected theme
  → RPC: UpsertUserPreference(theme_mode: "dark", preference_source: "os_default")
  → Save to localStorage
```

### 2. Manual Theme Selection
```
User clicks theme toggle
  → Frontend updates theme immediately
  → Save to localStorage
  → RPC: UpsertUserPreference(theme_mode: "light", preference_source: "manual")
  → Server updates database
  → Other devices poll and sync
```

### 3. Subsequent Visits
```
User loads app
  → Read from localStorage (immediate)
  → Apply theme (no FOUT)
  → RPC: GetUserPreference()
  → If server value differs: Update localStorage, apply new theme
  → Start polling for changes (30s interval)
```

### 4. Cross-Device Sync
```
Device A: User changes theme
  → Device A: RPC UpsertUserPreference
  → Server: Update database
  → Device B: Polling detects change (30s later)
  → Device B: Apply new theme
```

---

## Index Strategy

**Primary Index**: `PRIMARY KEY (organization_id, id)`
- Citus distribution key
- Unique record per employee (via UNIQUE constraint on `organization_id, employee_id`)

**Employee Lookup**: `idx_user_preference_employee (organization_id, employee_id)`
- Fast lookup by employee for GET operations
- Supports multi-tenant isolation

**Audit Query**: `idx_user_preference_updated (organization_id, updated_at DESC)`
- Optional: List recent changes for debugging
- Supports time-based queries

**No Additional Indexes Needed**:
- Single preference per employee (no pagination)
- Simple lookup patterns (no complex JOINs)
- Follows YAGNI principle (Principle V)

---

## Constraints & Validation

**Database Level**:
- `CHECK (theme_mode IN ('light', 'dark'))`: Valid theme modes only
- `CHECK (preference_source IN ('manual', 'os_default'))`: Valid sources only
- `UNIQUE (organization_id, employee_id)`: One preference per employee
- `NOT NULL` on critical fields: `organization_id`, `employee_id`, `theme_mode`

**Backend Level** (Go constants in `internal/preference/constants.go`):
```go
const (
    ThemeModeLig = "light"
    ThemeModeDark = "dark"
    
    PreferenceSourceManual = "manual"
    PreferenceSourceOSDefault = "os_default"
)
```

**Frontend Level** (TypeScript types in `packages/apis/src/types.ts`):
```typescript
export type ThemeMode = 'light' | 'dark';
export type PreferenceSource = 'manual' | 'os_default';
```

**Cross-Stack Alignment** (Constitution Principle VIII):
- Database CHECK constraints define valid values
- Backend constants match CHECK constraint values
- Frontend types match backend constants
- All changes coordinated in single PR
- Comments document alignment requirement

---

## Rollback Strategy

**Safe Rollback**:
1. Revert backend service deployment (remove RPC handlers)
2. Run down migration: `./scripts/migrate.sh down`
3. Revert frontend changes (theme provider, toggle components)
4. Users revert to default light theme

**Data Preservation** (if needed):
1. Export preference data: `COPY iam.user_preference TO '/tmp/preferences_backup.csv' CSV HEADER;`
2. Drop table
3. Users temporarily lose preferences (non-critical)
4. Can restore from backup after bug fix

**No Data Loss Risk**:
- Preferences are non-critical (cosmetic)
- Users can re-select theme after rollback
- No cascade deletes to other tables

---

## Testing Strategy

**Database Tests**:
- Constraint validation: Insert invalid theme modes (should fail)
- Multi-tenant isolation: Query without `organization_id` filter (should return wrong data - test in integration)
- Upsert logic: Insert new, update existing (should work correctly)
- Foreign key cascade: Delete employee, verify preference deleted

**Integration Tests** (`backend/integration/theme_preference_test.go`):
```go
func TestUserPreference_CRUD(t *testing.T) {
    // Use GetRandomTestIdentityAndKey() for test employee
    orgID, employeeID, token := GetRandomTestIdentityAndKey(iam.IdentityRoleEmployee)
    
    // Test: Create preference
    // Test: Read preference
    // Test: Update preference (manual selection)
    // Test: Cross-device sync simulation
}
```

**Frontend Tests**:
- Manual testing preferred (per Constitution Principle II)
- Test scenarios:
  1. First visit (OS preference detection)
  2. Manual toggle (light ↔ dark)
  3. Page reload (persistence)
  4. Cross-device sync (open in two tabs)

---

## Summary

**Schema Changes**: 1 new table (`iam.user_preference`)  
**Migration Complexity**: Low (single table, no data migration)  
**Citus Compliance**: ✅ Full compliance (sharding, indexes, constraints)  
**Constitution Compliance**: ✅ All principles followed  
**Rollback Risk**: Low (non-critical data, clean rollback path)

Ready for Phase 1 contract generation.
