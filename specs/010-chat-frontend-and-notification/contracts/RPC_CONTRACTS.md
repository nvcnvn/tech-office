# RPC Contracts: Chat Frontend Extensions

**Feature**: 010-chat-frontend-and-notification  
**Date**: 2025-10-29  
**Status**: Design Complete

This document specifies the RPC contract extensions needed for chat frontend and notification integration. The base chat.proto from feature #009 is already implemented; this document captures only the **additions**.

---

## Proto Extensions to chat.proto

### New RPC Methods

Add the following methods to the existing `ChatService` in `backend/rpc/v1/chat.proto`:

```protobuf
service ChatService {
  // ... existing methods ...

  // Message Navigation (for notification deep linking)
  rpc GetMessageById(GetMessageByIdRequest) returns (GetMessageByIdResponse) {
    option (rpc.v1.access_control) = {
      allowed_roles: [ROLE_OWNER, ROLE_OPERATOR, ROLE_EMPLOYEE]
      allow_unauthenticated: false
    };
  }

  // Unread Tracking
  rpc MarkChannelAsRead(MarkChannelAsReadRequest) returns (MarkChannelAsReadResponse) {
    option (rpc.v1.access_control) = {
      allowed_roles: [ROLE_OWNER, ROLE_OPERATOR, ROLE_EMPLOYEE]
      allow_unauthenticated: false
    };
  }
}
```

### New Messages

```protobuf
// GetMessageById - Fetch message with channel context for navigation
message GetMessageByIdRequest {
  string message_id = 1; // UUID of message to fetch
}

message GetMessageByIdResponse {
  Message message = 1; // Full message details
  Channel channel = 2; // Channel context (for navigation)
  bool is_member = 3;  // Whether requesting employee is channel member
}

// MarkChannelAsRead - Update last viewed message for unread tracking
message MarkChannelAsReadRequest {
  string channel_id = 1;
  string last_read_message_id = 2; // Optional: specific message to mark as read up to
}

message MarkChannelAsReadResponse {
  int32 unread_count = 1; // Remaining unread count for this channel
  google.protobuf.Timestamp last_viewed_at = 2; // Timestamp of mark-as-read
}
```

### Extended Messages

Extend existing `ChannelMembership` message to include unread tracking fields:

```protobuf
message ChannelMembership {
  // ... existing fields ...
  
  string last_viewed_message_id = 15; // Last message viewed by this member
  google.protobuf.Timestamp last_viewed_at = 16; // When member last viewed channel
  int32 unread_count = 17; // Computed: messages since last_viewed_at
}
```

Extend existing `Message` message to include mention metadata:

```protobuf
message Message {
  // ... existing fields ...
  
  repeated string mentioned_employee_ids = 15; // UUIDs of @mentioned employees
  repeated string mentioned_usernames = 16;    // @usernames for display
}
```

---

## sqlc Query Contracts

Add the following queries to `backend/database/scripts/chat.query.sql`:

### GetMessageByIdWithChannel

```sql
-- name: GetMessageByIdWithChannel :one
-- Fetch message with channel context for notification navigation
-- Security: Caller MUST verify employee is channel member
SELECT 
  sqlc.embed(m),
  e.email as author_email,
  e.full_name as author_name,
  c.title_slug as channel_slug,
  c.display_name as channel_display_name,
  c.is_private as channel_is_private
FROM chat.message m
JOIN organization.employee e 
  ON e.id = m.author_employee_id 
  AND e.organization_id = m.organization_id
JOIN chat.channel c 
  ON c.id = m.channel_id 
  AND c.organization_id = m.organization_id
WHERE m.id = sqlc.arg(message_id)
  AND m.organization_id = sqlc.arg(organization_id)
  AND m.deleted_at IS NULL;
```

### UpdateChannelMembershipLastViewed

```sql
-- name: UpdateChannelMembershipLastViewed :exec
-- Update last viewed message and timestamp for unread tracking
UPDATE chat.channel_membership
SET 
  last_viewed_message_id = sqlc.arg(last_viewed_message_id),
  last_viewed_at = NOW()
WHERE employee_id = sqlc.arg(employee_id)
  AND channel_id = sqlc.arg(channel_id)
  AND organization_id = sqlc.arg(organization_id);
```

### GetEmployeesByUsernames

```sql
-- name: GetEmployeesByUsernames :many
-- Resolve usernames to employee IDs for @mention validation
SELECT 
  id,
  username,
  full_name,
  email,
  organization_id
FROM organization.employee
WHERE username = ANY(sqlc.arg(usernames)::text[])
  AND organization_id = sqlc.arg(organization_id)
  AND deleted_at IS NULL;
```

### CheckChannelMembership

```sql
-- name: CheckChannelMembership :one
-- Validate if employee is member of channel (security check)
SELECT EXISTS(
  SELECT 1 FROM chat.channel_membership
  WHERE employee_id = sqlc.arg(employee_id)
    AND channel_id = sqlc.arg(channel_id)
    AND organization_id = sqlc.arg(organization_id)
) as is_member;
```

### GetUnreadMessageCount

```sql
-- name: GetUnreadMessageCount :one
-- Calculate unread message count for channel sidebar badges
SELECT COUNT(*)::int as unread_count
FROM chat.message m
JOIN chat.channel_membership cm 
  ON cm.channel_id = m.channel_id 
  AND cm.organization_id = m.organization_id
WHERE cm.employee_id = sqlc.arg(employee_id)
  AND cm.channel_id = sqlc.arg(channel_id)
  AND cm.organization_id = sqlc.arg(organization_id)
  AND (
    cm.last_viewed_at IS NULL 
    OR m.created_at > cm.last_viewed_at
  )
  AND m.deleted_at IS NULL;
```

---

## Frontend API Client Contract

Add to `frontend/packages/apis/src/chat.ts`:

```typescript
import { createClient } from 'rpc'
import type { ChatService } from 'rpc'
import type {
  GetMessageByIdRequest,
  GetMessageByIdResponse,
  MarkChannelAsReadRequest,
  MarkChannelAsReadResponse,
} from 'rpc/rpc/v1/chat_pb'

const client = createClient<ChatService>(transport)

// Get message by ID with channel context (for notification navigation)
export async function getMessageById(
  messageId: string
): Promise<GetMessageByIdResponse> {
  const response = await client.getMessageById({
    messageId,
  } as GetMessageByIdRequest)
  
  return response as GetMessageByIdResponse
}

// Mark channel as read (for unread tracking)
export async function markChannelAsRead(
  channelId: string,
  lastReadMessageId?: string
): Promise<MarkChannelAsReadResponse> {
  const response = await client.markChannelAsRead({
    channelId,
    lastReadMessageId,
  } as MarkChannelAsReadRequest)
  
  return response as MarkChannelAsReadResponse
}
```

---

## Notification Event Contract Extensions

Extend existing `NotificationEvent` (from notification.proto) with chat-specific payloads in `action_data` map:

### Message Notification

```json
{
  "event_type": "notification",
  "notification": {
    "source_domain": "chat",
    "notification_type": "message",
    "title": "New message in #general",
    "message": "Alice: Hey team, check this out...",
    "action_data": {
      "channelId": "01234567-89ab-cdef-0123-456789abcdef",
      "messageId": "98765432-10fe-dcba-9876-543210fedcba",
      "action": "view_message"
    }
  }
}
```

### Mention Notification

```json
{
  "event_type": "notification",
  "notification": {
    "source_domain": "chat",
    "notification_type": "mention",
    "title": "Alice mentioned you in #general",
    "message": "@bob can you review this?",
    "action_data": {
      "channelId": "01234567-89ab-cdef-0123-456789abcdef",
      "messageId": "98765432-10fe-dcba-9876-543210fedcba",
      "action": "view_message",
      "mentionedBy": "Alice Smith"
    }
  }
}
```

### Reply Notification

```json
{
  "event_type": "notification",
  "notification": {
    "source_domain": "chat",
    "notification_type": "reply",
    "title": "Alice replied to your message",
    "message": "Good point! Let's discuss...",
    "action_data": {
      "channelId": "01234567-89ab-cdef-0123-456789abcdef",
      "messageId": "98765432-10fe-dcba-9876-543210fedcba",
      "parentMessageId": "11111111-2222-3333-4444-555555555555",
      "action": "view_message"
    }
  }
}
```

### Typing Indicator Event (Ephemeral)

```json
{
  "event_type": "typing_indicator",
  "action_data": {
    "channelId": "01234567-89ab-cdef-0123-456789abcdef",
    "employeeId": "22222222-3333-4444-5555-666666666666",
    "employeeName": "Alice Smith"
  },
  "timestamp": "2025-10-29T10:30:00Z"
}
```

**Note**: Typing indicators use SSE's built-in `event_type` field, not `notification` payload (ephemeral, not persisted)

---

## Contract Testing

### Backend Contract Tests

```go
func TestGetMessageByIdContract(t *testing.T) {
  // Test: Valid message ID returns message + channel
  // Test: Non-member cannot access private channel message
  // Test: Invalid message ID returns error
  // Test: Deleted message returns not found
  // Test: Organization isolation enforced
}

func TestMarkChannelAsReadContract(t *testing.T) {
  // Test: Updates last_viewed timestamp
  // Test: Returns unread count
  // Test: Idempotent (calling twice with same ID doesn't error)
  // Test: Organization isolation enforced
}
```

### Frontend Contract Tests

```typescript
describe('Chat API Client', () => {
  it('getMessageById returns message with channel context', async () => {
    const response = await getMessageById('test-message-id')
    expect(response.message).toBeDefined()
    expect(response.channel).toBeDefined()
    expect(response.is_member).toBe(true)
  })

  it('markChannelAsRead updates unread count', async () => {
    const response = await markChannelAsRead('test-channel-id', 'last-message-id')
    expect(response.unread_count).toBe(0)
    expect(response.last_viewed_at).toBeDefined()
  })
})
```

---

## API Versioning & Compatibility

**Version**: v1 (extends existing chat.proto v1)  
**Breaking Changes**: None - all additions are backward compatible  
**Deprecations**: None

**Forward Compatibility**:
- Old clients can ignore new fields (proto3 default behavior)
- New fields have sensible defaults (empty strings, null timestamps)
- New methods are opt-in (old clients don't need to call them)

**Rollback Strategy**:
- Proto changes can be reverted without data loss
- New columns in DB have defaults (safe to remove)
- Old backend versions will ignore new fields

---

## Code Generation Commands

After updating proto files:

```bash
# Backend
cd backend
buf generate  # Regenerates Go code from proto
sqlc generate # Regenerates DB models from SQL queries

# Frontend
cd frontend
pnpm -r build  # Rebuilds packages including rpc package
```

**CI/CD Integration**:
- PR checks verify generated code is committed
- Breaking changes detected via buf breaking change detection
- Contract tests run on every PR

---

## Summary

**Proto Additions**: 2 new RPC methods, 2 new messages, 2 extended messages  
**SQL Queries**: 5 new queries for unread tracking and message navigation  
**Frontend Client**: 2 new API functions with type safety  
**Notification Events**: 3 new event types (message, mention, reply) + typing indicator  
**Backward Compatible**: ✅ All changes are additive, no breaking changes  
**Code Generation**: ✅ All artifacts generated via buf and sqlc

**Ready for Phase 2 Task Planning**
