# Data Model: Chat Backend System

**Feature**: Chat Backend System  
**Date**: October 29, 2025  
**Status**: Design Phase

## Overview

The chat backend introduces a new `chat` schema with five core tables supporting channel-based messaging with threaded replies, reactions, and membership management. The design prioritizes performance for large channels (1000+ members), multi-tenant isolation, and reusability across other business domains (project comments, CRM notes, support tickets).

---

## Schema: `chat`

### Purpose
Contains all chat-related entities: channels (public/private communication spaces), messages (content with optional replies), channel memberships (access control and notification preferences), reactions (emoji responses), and typing indicators (ephemeral real-time state).

### Tables
1. `chat.channel` - Communication spaces
2. `chat.message` - Messages and replies
3. `chat.channel_membership` - Access control and notification preferences
4. `chat.reaction` - Emoji reactions to messages
5. `chat.typing_indicator` - Ephemeral typing state (optional, may use in-memory only)

---

## Entity Definitions

### 1. `chat.channel`

**Purpose**: Represents a communication space where employees can send messages. Supports public (discoverable/joinable) and private (invite-only) channels, as well as direct messages (2-person channels) and specialized types for reusability (project_ticket_thread, crm_deal_notes).

**Table Definition**:
```sql
CREATE TABLE IF NOT EXISTS chat.channel (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    
    -- Channel identity
    title_slug TEXT NOT NULL, -- URL-friendly slug (alphanumeric + hyphen, max 64 chars)
    display_name TEXT NOT NULL, -- Human-readable name
    description TEXT, -- Optional channel description
    
    -- Channel type and visibility
    channel_type TEXT NOT NULL DEFAULT 'chat', 
        -- Enum: 'chat', 'direct_message', 'project_ticket_thread', 'crm_deal_notes', 'support_ticket'
    is_private BOOLEAN NOT NULL DEFAULT false, -- Private (invite-only) or public (discoverable)
    
    -- Status
    is_archived BOOLEAN NOT NULL DEFAULT false, -- Archived channels prevent new messages/notifications
    
    -- Metadata
    created_by_employee_id UUID NOT NULL REFERENCES organization.employee(id) ON DELETE RESTRICT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Constraints
    CONSTRAINT unique_channel_slug_per_org UNIQUE (organization_id, title_slug),
    CONSTRAINT valid_channel_type CHECK (channel_type IN ('chat', 'direct_message', 'project_ticket_thread', 'crm_deal_notes', 'support_ticket')),
    CONSTRAINT slug_format CHECK (title_slug ~ '^[a-z0-9-]+$' AND length(title_slug) <= 64)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_channel_org_updated 
    ON chat.channel(organization_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_channel_org_type 
    ON chat.channel(organization_id, channel_type, is_archived);

CREATE INDEX IF NOT EXISTS idx_channel_visibility 
    ON chat.channel(organization_id, is_private, is_archived) 
    WHERE is_archived = false; -- Partial index for active channel discovery

COMMENT ON TABLE chat.channel IS 
'Communication spaces (channels) where employees can send messages. Supports public/private channels, direct messages, and specialized types for reusability (project comments, CRM notes).';
```

**Columns**:
- `id`: Primary key, UUID v7
- `organization_id`: Tenant isolation, REQUIRED for all queries
- `title_slug`: URL-friendly unique identifier within org (e.g., "general", "engineering-team")
- `display_name`: Human-readable name shown in UI (e.g., "General", "Engineering Team")
- `description`: Optional channel purpose description
- `channel_type`: Enables reusability (`chat`, `direct_message`, `project_ticket_thread`, etc.)
- `is_private`: Access control (private = invite-only, public = discoverable/joinable)
- `is_archived`: Prevents new messages and notifications without data deletion
- `created_by_employee_id`: Channel creator (becomes first admin via membership)
- `updated_at`: Last modification timestamp (no `created_at` per constitution)

**Constraints**:
- `unique_channel_slug_per_org`: Slug uniqueness within organization
- `valid_channel_type`: Enum enforcement for channel types
- `slug_format`: Alphanumeric + hyphen only, max 64 characters

**Indexes**:
- `idx_channel_org_updated`: List channels sorted by recency
- `idx_channel_org_type`: Filter channels by type (e.g., all project ticket threads)
- `idx_channel_visibility`: Efficient public channel discovery (partial index excludes archived)

**Relationships**:
- `organization_id` → `public.organization(id)`: Multi-tenant isolation
- `created_by_employee_id` → `organization.employee(id)`: Channel creator

---

### 2. `chat.message`

**Purpose**: Stores message content, including top-level messages and replies (1-level threading). Messages can be edited, soft-deleted, and have associated reactions.

**Table Definition**:
```sql
CREATE TABLE IF NOT EXISTS chat.message (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES chat.channel(id) ON DELETE CASCADE,
    
    -- Message content
    content TEXT NOT NULL, -- Max ~10k characters (enforced at application level)
    author_employee_id UUID NOT NULL REFERENCES organization.employee(id) ON DELETE RESTRICT,
    
    -- Threading (1-level only)
    parent_message_id UUID REFERENCES chat.message(id) ON DELETE SET NULL,
        -- NULL = top-level message, non-NULL = reply to parent
    
    -- Status flags
    is_deleted BOOLEAN NOT NULL DEFAULT false, -- Soft delete (preserve with placeholder text)
    is_edited BOOLEAN NOT NULL DEFAULT false, -- Track if message was edited
    
    -- Metadata
    edit_history JSONB, -- Array of {edited_at: timestamp, previous_text: string}
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Constraints
    CONSTRAINT no_reply_to_reply CHECK (
        parent_message_id IS NULL OR 
        NOT EXISTS (
            SELECT 1 FROM chat.message AS parent 
            WHERE parent.id = parent_message_id 
            AND parent.parent_message_id IS NOT NULL
        )
    ) -- Enforce single-layer reply depth
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_message_channel_updated 
    ON chat.message(channel_id, organization_id, updated_at DESC) 
    WHERE is_deleted = false; -- Exclude deleted messages from pagination

CREATE INDEX IF NOT EXISTS idx_message_parent 
    ON chat.message(parent_message_id, organization_id) 
    WHERE parent_message_id IS NOT NULL; -- Efficient reply lookups

CREATE INDEX IF NOT EXISTS idx_message_author 
    ON chat.message(author_employee_id, organization_id, updated_at DESC);

COMMENT ON TABLE chat.message IS 
'Messages and replies within channels. Supports 1-level threading (replies to messages only, no replies to replies), editing, and soft deletion.';
```

**Columns**:
- `id`: Primary key, UUID v7
- `organization_id`: Tenant isolation
- `channel_id`: Channel containing this message
- `content`: Message content (max ~10k chars, enforced at app level)
- `author_employee_id`: Message author
- `parent_message_id`: NULL for top-level messages, references parent for replies
- `is_deleted`: Soft delete flag (preserves message with "deleted" placeholder)
- `is_edited`: Track if message has been edited (for transparency)
- `edit_history`: JSONB array of previous versions with timestamps
- `updated_at`: Last modification timestamp (used for pagination cursor)

**Constraints**:
- `no_reply_to_reply`: CHECK constraint enforcing single-layer reply depth (constitutional requirement)

**Indexes**:
- `idx_message_channel_updated`: Paginate messages within channel (excludes deleted via partial index)
- `idx_message_parent`: Fetch all replies to a message efficiently
- `idx_message_author`: List messages by author

**Relationships**:
- `organization_id` → `public.organization(id)`
- `channel_id` → `chat.channel(id)`: CASCADE delete when channel deleted
- `author_employee_id` → `organization.employee(id)`: RESTRICT (preserve authorship)
- `parent_message_id` → `chat.message(id)`: SET NULL when parent deleted (keep replies)

**Soft Delete Strategy**:
When `is_deleted = true`:
- Display placeholder text: "This message was deleted"
- Preserve replies (don't cascade delete)
- Preserve reactions (or delete, depending on requirements)
- Exclude from pagination partial index

---

### 3. `chat.channel_membership`

**Purpose**: Tracks which employees are members of which channels, their admin status, join timestamps, and per-channel notification preferences.

**Table Definition**:
```sql
CREATE TABLE IF NOT EXISTS chat.channel_membership (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES chat.channel(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES organization.employee(id) ON DELETE CASCADE,
    
    -- Role
    is_admin BOOLEAN NOT NULL DEFAULT false, -- Channel admin privileges
    
    -- Notification preferences
    notification_preference TEXT NOT NULL DEFAULT 'all',
        -- Enum: 'all' (notify on all messages), 'mentions' (only @mentions), 'muted' (no notifications)
    
    -- Timestamps
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(), -- When member joined channel
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Constraints
    CONSTRAINT unique_membership UNIQUE (channel_id, employee_id, organization_id),
    CONSTRAINT valid_notification_pref CHECK (notification_preference IN ('all', 'mentions', 'muted'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_membership_channel 
    ON chat.channel_membership(channel_id, organization_id, notification_preference);

CREATE INDEX IF NOT EXISTS idx_membership_employee 
    ON chat.channel_membership(employee_id, organization_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_membership_admins 
    ON chat.channel_membership(channel_id, organization_id) 
    WHERE is_admin = true; -- Partial index for admin lookups

COMMENT ON TABLE chat.channel_membership IS 
'Tracks channel memberships, admin roles, and per-channel notification preferences. Used for access control and notification filtering.';
```

**Columns**:
- `id`: Primary key, UUID v7
- `organization_id`: Tenant isolation
- `channel_id`: Channel this membership belongs to
- `employee_id`: Employee who is a member
- `is_admin`: Admin privileges (archive channel, remove members, promote admins)
- `notification_preference`: Per-channel notification setting (all/mentions/muted)
- `joined_at`: Membership creation timestamp
- `updated_at`: Last modification (for preference changes)

**Constraints**:
- `unique_membership`: One membership record per employee-channel pair
- `valid_notification_pref`: Enum enforcement

**Indexes**:
- `idx_membership_channel`: Efficiently fetch channel members with notification preferences (used for filtering eligible recipients before RPC call to notification service)
- `idx_membership_employee`: List channels for employee
- `idx_membership_admins`: Quickly find channel admins (partial index)

**Relationships**:
- `organization_id` → `public.organization(id)`
- `channel_id` → `chat.channel(id)`: CASCADE delete when channel deleted
- `employee_id` → `organization.employee(id)`: CASCADE delete when employee deleted

**Business Rules**:
- At least one admin required per channel (enforced at application level)
- If last admin leaves, auto-promote oldest remaining member
- Creator becomes first admin upon channel creation

---

### 4. `chat.reaction`

**Purpose**: Stores emoji reactions to messages. Multiple employees can use the same emoji on one message (aggregated as counts in UI).

**Table Definition**:
```sql
CREATE TABLE IF NOT EXISTS chat.reaction (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES chat.message(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES organization.employee(id) ON DELETE CASCADE,
    
    -- Reaction data
    emoji_code TEXT NOT NULL, -- Unicode emoji or shortcode (e.g., "👍", ":thumbs_up:")
    
    -- Timestamp
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Constraints
    CONSTRAINT unique_reaction UNIQUE (message_id, employee_id, emoji_code, organization_id)
        -- One reaction per employee-message-emoji combination (toggle behavior)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_reaction_message 
    ON chat.reaction(message_id, organization_id, emoji_code);

CREATE INDEX IF NOT EXISTS idx_reaction_employee 
    ON chat.reaction(employee_id, organization_id, updated_at DESC);

COMMENT ON TABLE chat.reaction IS 
'Emoji reactions to messages. Multiple employees can react with the same emoji (aggregated as counts). Duplicate reactions from same employee toggle (remove existing).';
```

**Columns**:
- `id`: Primary key, UUID v7
- `organization_id`: Tenant isolation
- `message_id`: Message being reacted to
- `employee_id`: Employee who reacted
- `emoji_code`: Unicode emoji or shortcode
- `updated_at`: Reaction creation timestamp

**Constraints**:
- `unique_reaction`: One reaction per employee-message-emoji combo (toggle behavior: adding same emoji removes it)

**Indexes**:
- `idx_reaction_message`: Efficiently fetch all reactions for a message grouped by emoji
- `idx_reaction_employee`: List reactions by employee (for activity tracking)

**Relationships**:
- `organization_id` → `public.organization(id)`
- `message_id` → `chat.message(id)`: CASCADE delete when message deleted
- `employee_id` → `organization.employee(id)`: CASCADE delete when employee deleted

**Business Rules**:
- Reactions DO NOT trigger notifications (avoid notification fatigue)
- Same emoji from multiple employees aggregated: "👍 5" (5 employees used thumbs-up)
- Adding duplicate emoji toggles (removes existing reaction)

---

### 5. `chat.typing_indicator` (Optional - May Use In-Memory)

**Purpose**: Tracks which employees are currently typing in which channels. Ephemeral state, may not need database persistence.

**Decision**: Likely implement as in-memory state in notification hub rather than database table to avoid high-frequency writes.

**If Persisted (for reference)**:
```sql
CREATE TABLE IF NOT EXISTS chat.typing_indicator (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    organization_id UUID NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES chat.channel(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES organization.employee(id) ON DELETE CASCADE,
    
    -- Timestamp
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), -- Last typing heartbeat
    
    -- Constraints
    CONSTRAINT unique_typing UNIQUE (channel_id, employee_id, organization_id)
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_typing_channel 
    ON chat.typing_indicator(channel_id, organization_id, updated_at DESC);

-- Auto-cleanup: Cron job or trigger deletes entries older than 5 seconds
```

**Preferred Implementation**: In-memory map in notification hub:
```
channel_id -> {employee_id: last_heartbeat_timestamp}
```
- Broadcast typing events via SSE to channel members
- Auto-expire entries after 5 seconds of no heartbeat
- No database writes, significantly reduces load

---

## Cross-Schema References

### Referenced External Entities

**1. `public.organization`**:
- All chat tables have `organization_id` foreign key
- Tenant isolation enforcement

**2. `organization.employee`**:
- `chat.channel.created_by_employee_id`: Channel creator
- `chat.message.author_employee_id`: Message author
- `chat.channel_membership.employee_id`: Channel member
- `chat.reaction.employee_id`: Reaction author

**3. `notification.notification`** (integration via logic layer method calls, not SQL):
- Chat logic layer calls `notification.NotificationLogic.PublishBatchNotification()` directly (NOT RPC)
- Notification logic layer inserts into `notification.notification` table with:
  * `source_domain = 'chat'`
  * `notification_type` (message/mention/reply/invite)
  * `action_data` contains `{channelId, messageId, replyId}`
- **Constitution v3.6.0 Pattern**: Cross-domain integration via logic layer interfaces
- **Transaction Sharing**: Both chat and notification operations use same `tx database.DBTX` for atomicity
- **Context Propagation**: User-scope context (request context) passed through logic layers
- Decouples chat service from notification delivery optimization while maintaining data consistency

### Integration Architecture (Constitution v3.6.0)

**Two-Layer Service Dependencies**:
```
Chat Connect Layer (RPC handlers)
  ↓ depends on
Chat Logic Layer (business logic)
  ↓ depends on
Notification Logic Layer (cross-domain)
  ↓ writes to
notification.notification table
```

**Transaction Flow**:
1. Chat connect layer creates transaction with `txn.WithTxn(ctx, TenantPool, ...)`
2. Chat logic layer receives `tx database.DBTX` parameter
3. Chat logic creates message using `tx`
4. Chat logic calls notification logic with same `tx` (atomic)
5. Both operations commit/rollback together

**No SQL-level Cross-Schema Access**:
- Chat queries NEVER directly SELECT/INSERT from `notification` schema
- All notification operations go through `notification.NotificationLogic` interface
- Prevents tight coupling and maintains domain boundaries

### Referential Integrity
- `ON DELETE CASCADE`: Cleanup when organization/channel deleted
- `ON DELETE RESTRICT`: Preserve authorship when employee record deleted (messages/channels remain with attribution)
- `ON DELETE SET NULL`: Keep replies when parent message deleted

---

## Migration Strategy

### Atlas Migration Workflow
1. **Edit Schema**: Add chat schema and tables to `backend/database/scripts/schema.sql`
2. **Generate Migration**: Run `source .env && cd backend && ./scripts/atlas/01_migration_create.sh "add-chat-schema"`
3. **Review Migration**: Inspect generated migration SQL in `backend/database/migrations/`
4. **Apply Migration**: Run `./scripts/atlas/02_migrate_apply.sh` (applies to dev database)
5. **Commit**: Commit both `schema.sql` and generated migration files

### sqlc Code Generation
After schema changes:
```bash
cd backend
sqlc generate  # Generates Go models and query methods
```

Commit generated files:
- `backend/database/models.go`: Struct definitions for chat tables
- `backend/database/chat.query.sql.go`: Type-safe query methods

---

## Performance Optimization

### 1. Indexes for Large Channels
- **Channel membership query**: `idx_membership_channel` enables <50ms lookup for 10k members
- **Message pagination**: `idx_message_channel_updated` with partial index (excludes deleted) for fast scrolling
- **Reply lookups**: `idx_message_parent` for efficient threaded view

### 2. Batched Notification Publishing via Logic Layer Method

**Constitution v3.6.0 Pattern**: Direct logic layer method invocation instead of RPC.

Query to fetch eligible members:
```sql
SELECT employee_id, notification_preference
FROM chat.channel_membership
WHERE channel_id = $1 
  AND organization_id = $2
  AND notification_preference != 'muted'
;
```

Call notification logic layer method with same transaction:
```go
// Chat logic layer calls notification logic layer
_, err = s.NotificationLogic.PublishBatchNotification(
    ctx,                    // User-scope context from request
    tx,                     // Same transaction for atomicity
    orgID,
    &notification.BatchNotificationRequest{
        Notifications: buildNotifications(members, message, channel),
    },
)
if err != nil {
    return nil, fmt.Errorf("failed to publish notifications: %w", err)
    // Transaction will rollback, message not persisted
}
```

**Benefits of Logic Layer Integration**:
- **Atomic Operations**: Message creation and notification publishing in single transaction
- **No RPC Overhead**: Direct Go method call avoids marshaling/unmarshaling
- **Context Preservation**: User context flows through logic layers for audit and security
- **Testability**: Mock `NotificationLogic` interface for chat logic tests
- **Type Safety**: Compile-time checking of method signatures

**Performance**: 
- Chat logic: Member query <50ms, logic layer call <200ms
- Notification logic: Batched UNNEST insert 1000 rows in <100ms
- Total end-to-end: <250ms for 1000-member channel
- Single transaction commit reduces database round-trips

### 3. Pagination Strategy
Cursor-based pagination for messages:
```sql
SELECT * FROM chat.message
WHERE channel_id = $1 
  AND organization_id = $2
  AND updated_at < $3 -- Cursor (last message updated_at)
  AND is_deleted = false
ORDER BY updated_at DESC
LIMIT 50;
```

Index `idx_message_channel_updated` enables efficient cursor pagination without OFFSET.

### 4. Future Partitioning
For high-volume orgs, consider partitioning `chat.message` by month:
```sql
CREATE TABLE chat.message_2025_10 PARTITION OF chat.message
FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');
```

Defer until proven necessary (post-MVP).

---

## Data Consistency Rules

### 1. Channel Admin Constraints
- **At least one admin required**: Enforced at application level
- **Last admin leaves**: Auto-promote oldest member (by `joined_at`) to admin
- **Creator privilege**: Channel creator becomes first admin on creation

### 2. Reply Depth Enforcement
- **CHECK constraint**: `no_reply_to_reply` prevents replies to replies at database level
- **Application validation**: Frontend disables "reply" button on reply messages
- **Error handling**: RPC returns `INVALID_ARGUMENT` if reply depth exceeded

### 3. Soft Delete Preservation
- **Parent message deleted**: Replies remain with placeholder "Original message was deleted"
- **Reactions on deleted messages**: Delete reactions when message deleted (CASCADE)
- **Membership retention**: Deleted employees' messages remain with attribution (RESTRICT FK)

### 4. Notification Preference Overrides
- **@mentions always notify**: Override channel mute settings for explicit mentions (RPC call includes mention flag)
- **Archived channels**: No notifications sent regardless of preferences (filter archived channels before RPC)
- **Channel-level overrides global**: User's channel mute setting overrides global notification settings (filtered in membership query)

---

## Test Data Requirements

### Seed Data for Development
- 5 organizations with 10-100 employees each
- 10-20 channels per org (mix of public/private, archived/active)
- 100-1000 messages per channel (with 10-20% having replies)
- 50-200 reactions distributed across messages
- 5-10 memberships per channel (vary notification preferences)

### Load Testing Scenarios
1. **Large channel**: 5000 members, measure `PublishBatchNotification` RPC call time and notification service insert performance
2. **High-volume channel**: 10k messages, measure pagination performance
3. **Reply threading**: 1k messages with replies, measure thread rendering
4. **Concurrent typing**: 50 employees typing simultaneously

---

## Summary

The `chat` schema provides a complete foundation for Slack-like channel-based communication with performance optimizations for large-scale deployments. Key design decisions:

- **Reusability**: `channel_type` enables reuse for project comments, CRM notes, support tickets
- **Performance**: Batched notifications via logic layer, indexed queries, cursor-based pagination for 1000+ member channels
- **Multi-tenancy**: `organization_id` on all tables with proper foreign key constraints
- **1-level threading**: CHECK constraint enforces single-layer reply depth
- **Flexible notifications**: Per-channel preferences (all/mentions/muted) with @mention override
- **Soft deletes**: Preserve conversation context when messages deleted
- **Admin model**: Multiple admins per channel, auto-promotion when last admin leaves

**Constitution v3.6.0 Compliance**:
- **Two-Layer Service Architecture**: Logic layer (pure business logic) + Connect layer (RPC handlers)
- **Cross-Domain Integration**: Chat logic depends on `notification.NotificationLogic` interface
- **Transaction Sharing**: Message creation + notification publishing in single atomic transaction
- **Context Propagation**: User-scope context flows through logic layers for security
- **No SQL Cross-Schema Access**: All notification operations via logic layer methods
- **Pool Management**: Connect layer owns TenantPool, logic layer is pool-agnostic
- **Transaction Management**: Connect layer uses `txn.WithTxn`, logic layer receives `tx database.DBTX`

**Architecture Pattern**:
```
Chat Connect Layer (RPC, auth, transactions)
  ↓
Chat Logic Layer (business logic, pool-agnostic)
  ↓ direct method call
Notification Logic Layer (cross-domain)
  ↓
notification.notification table (database)
```

**Next Steps**: Generate sqlc queries in `contracts/chat.query.sql` following two-layer architecture requirements.
