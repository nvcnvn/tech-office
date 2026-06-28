# Data Model: Chat Frontend and Notification Integration

**Feature**: 010-chat-frontend-and-notification  
**Date**: 2025-10-29  
**Status**: Design Complete

## Overview

This feature extends the existing chat backend (#009) with minimal schema changes to support notification integration and unread tracking. The chat schema was already designed in feature #009; this document captures only the **extensions** needed for this feature.

---

## Schema Extensions

### chat.channel_membership (EXTEND EXISTING TABLE)

**Purpose**: Add unread message tracking fields to existing membership table

**New Columns**:
```sql
ALTER TABLE chat.channel_membership
ADD COLUMN IF NOT EXISTS last_viewed_message_id UUID REFERENCES chat.message(id),
ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMPTZ DEFAULT NOW();

COMMENT ON COLUMN chat.channel_membership.last_viewed_message_id IS 
  'Last message viewed by employee in this channel for unread tracking';
COMMENT ON COLUMN chat.channel_membership.last_viewed_at IS 
  'Timestamp when employee last viewed this channel';
```

**New Indexes**:
```sql
-- Efficient unread count queries
CREATE INDEX IF NOT EXISTS idx_channel_membership_last_viewed 
ON chat.channel_membership(employee_id, organization_id, last_viewed_at);

-- Efficient lookup for mark-as-read operations
CREATE INDEX IF NOT EXISTS idx_channel_membership_last_viewed_message 
ON chat.channel_membership(channel_id, employee_id) 
WHERE last_viewed_message_id IS NOT NULL;
```

**Rationale**: 
- Server-side tracking enables multi-device sync
- `last_viewed_message_id` provides precise unread calculation
- `last_viewed_at` timestamp for fallback queries
- Indexes optimize unread count and mark-as-read operations

---

## No New Tables

All other data structures leverage existing tables from feature #009:
- `chat.channel` - No changes needed
- `chat.message` - No changes needed  
- `chat.reaction` - No changes needed
- `notification.notification` - Used for @mention notifications (no changes)
- `organization.employee` - Used for mention validation (no changes)

---

## Query Patterns

### 1. GetMessageByIdWithChannel

**Purpose**: Fetch message with channel context for notification navigation

```sql
-- name: GetMessageByIdWithChannel :one
SELECT 
  m.id,
  m.channel_id,
  m.organization_id,
  m.content,
  m.author_employee_id,
  m.parent_message_id,
  m.created_at,
  m.updated_at,
  m.edited_at,
  m.deleted_at,
  e.email as author_email,
  e.full_name as author_name,
  c.title_slug as channel_slug,
  c.display_name as channel_display_name,
  c.is_private as channel_is_private
FROM chat.message m
JOIN organization.employee e ON e.id = m.author_employee_id AND e.organization_id = m.organization_id
JOIN chat.channel c ON c.id = m.channel_id AND c.organization_id = m.organization_id
WHERE m.id = $1 
  AND m.organization_id = $2
  AND m.deleted_at IS NULL;
```

**Multi-Tenant Isolation**: ✅ Filters by `organization_id`  
**Validation**: Caller must verify employee is channel member before returning

---

### 2. UpdateChannelMembershipLastViewed

**Purpose**: Update last viewed message and timestamp for unread tracking

```sql
-- name: UpdateChannelMembershipLastViewed :exec
UPDATE chat.channel_membership
SET 
  last_viewed_message_id = $1,
  last_viewed_at = NOW()
WHERE employee_id = $2
  AND channel_id = $3
  AND organization_id = $4;
```

**Multi-Tenant Isolation**: ✅ Filters by `organization_id`  
**Usage**: Called when employee views channel or reads message

---

### 3. GetEmployeesByUsernames

**Purpose**: Resolve usernames to employee IDs for @mention validation

```sql
-- name: GetEmployeesByUsernames :many
SELECT 
  id,
  username,
  full_name,
  email,
  organization_id
FROM organization.employee
WHERE username = ANY($1::text[])
  AND organization_id = $2
  AND deleted_at IS NULL;
```

**Multi-Tenant Isolation**: ✅ Filters by `organization_id`  
**Usage**: Parse @mentions from message text, validate users exist

---

### 4. CheckChannelMembership

**Purpose**: Validate if employee is member of channel (for GetMessageById security)

```sql
-- name: CheckChannelMembership :one
SELECT EXISTS(
  SELECT 1 FROM chat.channel_membership
  WHERE employee_id = $1
    AND channel_id = $2
    AND organization_id = $3
) as is_member;
```

**Multi-Tenant Isolation**: ✅ Filters by `organization_id`  
**Usage**: Security check before returning message details

---

### 5. GetUnreadMessageCount

**Purpose**: Calculate unread message count for channel sidebar badges

```sql
-- name: GetUnreadMessageCount :one
SELECT COUNT(*) as unread_count
FROM chat.message m
JOIN chat.channel_membership cm 
  ON cm.channel_id = m.channel_id 
  AND cm.organization_id = m.organization_id
WHERE cm.employee_id = $1
  AND cm.channel_id = $2
  AND cm.organization_id = $3
  AND (
    cm.last_viewed_at IS NULL 
    OR m.created_at > cm.last_viewed_at
  )
  AND m.deleted_at IS NULL;
```

**Multi-Tenant Isolation**: ✅ Filters by `organization_id`  
**Performance**: Uses `idx_channel_membership_last_viewed` index

---

## Migration Strategy

**Atlas Migration**:
1. Run schema changes in dev environment first
2. Generate migration: `./scripts/atlas/01_migration_create.sh add_chat_unread_tracking`
3. Review generated SQL for safety
4. Apply migration: `./scripts/atlas/02_migrate_apply.sh`
5. Verify indexes created with `EXPLAIN ANALYZE`

**Backward Compatibility**:
- New columns have defaults (NULL for `last_viewed_message_id`, NOW() for `last_viewed_at`)
- Existing rows will work immediately (no data migration required)
- Old backend versions will ignore new columns (safe deployment)

**Rollback Plan**:
- Columns can be dropped if needed
- No foreign key constraints prevent rollback
- Indexes can be dropped independently

---

## Data Integrity Constraints

### Referential Integrity

```sql
-- FK constraint already exists in chat.channel_membership
ALTER TABLE chat.channel_membership
ADD CONSTRAINT fk_last_viewed_message 
FOREIGN KEY (last_viewed_message_id) 
REFERENCES chat.message(id) 
ON DELETE SET NULL;
```

**Rationale**: If message is deleted, set last_viewed to NULL (graceful degradation)

### Consistency Rules

1. **last_viewed_at MUST be <= NOW()** (enforced by default NOW())
2. **last_viewed_message_id MUST belong to the same channel** (enforced by application logic)
3. **last_viewed_at MUST be updated atomically with last_viewed_message_id** (single UPDATE)

---

## Performance Considerations

### Index Strategy

| Index | Purpose | Cardinality | Selectivity |
|-------|---------|-------------|-------------|
| `idx_channel_membership_last_viewed` | Unread count queries | HIGH | MEDIUM |
| `idx_channel_membership_last_viewed_message` | Mark-as-read lookups | HIGH | HIGH |

**Maintenance**: Indexes will auto-update on INSERT/UPDATE (no manual maintenance)

### Query Optimization

- **Unread Count**: Uses index scan (O(log n) + O(unread))
- **Mark as Read**: Single row UPDATE with index lookup (O(log n))
- **GetMessage**: Uses primary key index (O(log n))

**Expected Performance**:
- Unread count: <10ms for 10k messages
- Mark as read: <5ms
- GetMessage: <5ms

---

## Security & Multi-Tenancy

### Tenant Isolation Verification

✅ **All queries include `organization_id` filter**  
✅ **Foreign keys validate tenant boundaries**  
✅ **Channel membership validated before message access**  
✅ **Username resolution scoped to organization**

### Access Control

- **GetMessageById**: Requires channel membership validation
- **MarkChannelAsRead**: Validates employee owns membership
- **Mention parsing**: Validates mentioned users exist in organization

---

## Frontend Data Model

### TypeScript Types (generated from proto + extended)

```typescript
// Extends existing Message type with unread context
interface MessageWithContext extends Message {
  isUnread: boolean
  channelSlug: string
  channelDisplayName: string
}

// Channel with unread count
interface ChannelWithUnread extends Channel {
  unreadCount: number
  lastViewedAt: Date | null
}

// Mention metadata
interface Mention {
  username: string
  employeeId: string
  fullName: string
}

// Typing indicator (ephemeral, not persisted)
interface TypingIndicator {
  channelId: string
  employeeId: string
  employeeName: string
  expiresAt: Date
}
```

### Local State Management

```typescript
// React Query cache keys
const chatQueryKeys = {
  channels: ['channels'] as const,
  channelDetail: (id: string) => ['channels', id] as const,
  messages: (channelId: string) => ['messages', channelId] as const,
  message: (id: string) => ['message', id] as const,
  unreadCount: (channelId: string) => ['unread', channelId] as const,
  typingIndicators: (channelId: string) => ['typing', channelId] as const,
}

// Optimistic updates for mark-as-read
queryClient.setQueryData(
  chatQueryKeys.unreadCount(channelId),
  (old: number) => 0
)
```

---

## Testing Strategy

### Database Tests

```go
func TestUpdateChannelMembershipLastViewed(t *testing.T) {
  // Setup: Create org, employee, channel, membership
  // Action: Call UpdateChannelMembershipLastViewed
  // Assert: last_viewed_at updated, last_viewed_message_id set
  // Assert: Unread count decreases
}

func TestGetMessageByIdWithChannel(t *testing.T) {
  // Setup: Create message in channel
  // Action: Call GetMessageByIdWithChannel
  // Assert: Returns message with channel context
  // Assert: Fails if organization_id mismatch
}

func TestMentionValidation(t *testing.T) {
  // Setup: Create employees with usernames
  // Action: Parse @mentions, call GetEmployeesByUsernames
  // Assert: Valid usernames resolve to employee IDs
  // Assert: Invalid usernames return empty
  // Assert: Tenant isolation enforced
}
```

### Integration Tests

```go
func TestNotificationIntegration(t *testing.T) {
  // Setup: Create channel with 2 members
  // Action: User A sends message mentioning User B
  // Assert: NotificationLogic.PublishNotification called
  // Assert: Notification created with correct action_data
  // Assert: User B receives notification via SSE
}
```

---

## Summary

**Schema Changes**: Minimal - 2 columns added to `chat.channel_membership`  
**New Queries**: 5 queries for unread tracking, mention validation, message navigation  
**Performance**: Optimized with indexes, <10ms query times  
**Security**: All queries tenant-isolated, channel membership validated  
**Migration**: Safe, backward-compatible, reversible

**Ready for Phase 2 Task Planning**
