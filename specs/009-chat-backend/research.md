# Research: Chat Backend System

**Feature**: Chat Backend System  
**Date**: October 29, 2025  
**Status**: Complete (Updated for Constitution v3.6.0)

## Executive Summary

All technical unknowns have been resolved. The chat backend will use a new `chat` schema with tables for channels, messages, memberships, and reactions. Integration with the existing notification hub (#007) provides real-time message delivery via **direct logic layer method calls** (Constitution v3.6.0 pattern). Performance optimizations for large channels (1000+ members) include batched notification inserts and efficient database indexing.

**Constitution v3.6.0 Compliance**: Chat service follows two-layer architecture (logic + connect layers) with cross-domain integration via logic layer interfaces. Chat logic layer depends on `notification.NotificationLogic` interface for atomic message creation + notification publishing in single transaction.

---

## Constitution v3.6.0 Updates Applied

### Two-Layer Service Architecture
**Change**: Split service into logic layer (business logic) and connect layer (RPC handlers).

**Impact on Chat Service**:
- **Logic Layer** (`internal/chat/logic.go`):
  * Pure business logic, NO connection pools
  * Methods accept `tx database.DBTX` parameter
  * Receives parsed auth context (employeeID, orgID) as parameters
  * Implements `ChatLogic` interface for testability
  * Depends on `notification.NotificationLogic` interface

- **Connect Layer** (`internal/chat/connect.go`):
  * Owns `TenantPool database.TenantDatabaseConnector`
  * Extracts auth from request context
  * Manages transactions with `txn.WithTxn`
  * Translates domain errors to connect.Error

**Benefits**:
- Logic layer reusable across services without RPC overhead
- Testability via interface mocking
- Clear separation of concerns (infrastructure vs business logic)

### Cross-Domain Integration via Logic Layer Interfaces
**Change**: Services depend on other services' **logic layer interfaces** instead of RPC clients for internal calls.

**Impact on Chat ↔ Notification Integration**:
- **Before (v3.5.0)**: Chat service calls notification service via RPC (PublishBatchNotification)
- **After (v3.6.0)**: Chat logic layer calls `notification.NotificationLogic.PublishBatchNotification()` directly

**Benefits**:
- No RPC marshaling/unmarshaling overhead for internal calls
- Transaction sharing for atomicity (message + notification in single tx)
- Context propagation for security (user-scope context flows through)
- Compile-time type safety (interface contracts)
- Simpler testing (mock logic interfaces)

### Transaction-Aware Cross-Domain Methods
**Change**: Logic layer methods accept `tx database.DBTX` parameter to support atomic cross-domain operations.

**Impact on Chat Service**:
```go
// Connect layer creates transaction
err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
    // Both operations use same transaction
    return s.Logic.SendMessage(ctx, tx, orgID, employeeID, req.Msg)
})

// Inside chat logic layer
func (s *chatLogicImpl) SendMessage(ctx context.Context, tx database.DBTX, ...) error {
    // Create message with tx
    message, err := s.Queries.CreateMessage(ctx, tx, params)
    
    // Call notification logic with same tx
    _, err = s.NotificationLogic.PublishBatchNotification(ctx, tx, orgID, req)
    // If notification fails, message creation rolls back
}
```

**Benefits**:
- Atomic operations (message creation + notification publishing)
- No nested transactions
- Automatic rollback on failure

### Context Propagation Rules
**Change**: Explicit user-scope vs system-scope context propagation.

**Impact on Chat Service**:
- **User-scope**: Pass request context through all logic layers
- Preserves organization_id, user identity, auth claims
- Enables audit logging and tenant isolation

```go
// Connect layer: ctx from RPC request
err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
    // ctx preserves user context
    return s.Logic.SendMessage(ctx, tx, orgID, employeeID, req.Msg)
})

// Logic layer: ctx propagates to cross-domain calls
_, err = s.NotificationLogic.PublishBatchNotification(ctx, tx, orgID, req)
```

**Security**: Prevents privilege escalation and cross-tenant data leaks.

---

## Database Schema Design

### Decision
Create new `chat` schema alongside existing `notification`, `organization`, and `iam` schemas.

### Rationale
- Chat is a distinct business domain warranting its own schema namespace
- Enables clear separation of concerns and independent migration history
- Facilitates reusability in other contexts (project ticket comments, CRM deal notes, support threads)
- Follows Tech Office pattern: domain-specific schemas (`iam`, `organization`, `crm`, `finance`, etc.)

### Alternatives Considered
1. **Extend `communication` schema**: Rejected because communication schema is for one-way announcements/newsletters, not bidirectional conversation threads
2. **Place in `collaboration` schema**: Rejected because collaboration focuses on tasks/projects, not general chat infrastructure
3. **Use `notification` schema**: Rejected because notification is for delivery infrastructure, not chat content storage

### Existing Patterns
- `notification` schema: Cross-domain integration for event delivery
- `organization` schema: Multi-entity business data with employee references
- `iam` schema: Identity management separate from business logic

---

## Multi-Tenant Isolation Strategy

### Decision
All chat tables include `organization_id UUID NOT NULL` with foreign key to `public.organization(id)`. Every query MUST filter by `organization_id`.

### Rationale
- Constitutional requirement (Constitution v3.5.0, Principle I)
- Prevents cross-tenant data leakage
- Enables org-level analytics and data export
- Standard pattern across all Tech Office business domains

### Enforcement Mechanisms
1. **Database Level**: Foreign key constraints on `organization_id`
2. **Application Level**: Use `TenantPool` for all user operations (enforces org context from auth token)
3. **Query Level**: sqlc queries include `organization_id` in WHERE clauses
4. **Index Level**: Composite indexes start with `organization_id` for partition pruning

### Existing Pattern
See `organization.employee`, `iam.employee`, `notification.notification` for reference implementations.

---

## Cross-Schema References

### Decision
Reference `organization.employee` for:
- Channel creators (`channel.created_by_employee_id`)
- Message authors (`message.author_employee_id`)
- Channel members (`channel_membership.employee_id`)
- Reaction authors (`reaction.employee_id`)

### Rationale
- `organization.employee` is the central employee entity used across all Tech Office domains
- Provides rich employee context (name, email, department, role) via JOINs
- Consistent with notification hub pattern (`notification.notification.target_user_id`)
- Avoids direct `iam.identity` references which are lower-level auth primitives

### Alternatives Considered
1. **Reference `iam.identity`**: Rejected because `iam.identity` is for authentication, not business context
2. **Duplicate employee data in chat schema**: Rejected to avoid data inconsistency and synchronization issues
3. **Store only employee UUID without FK**: Rejected because FK ensures referential integrity

### Existing Patterns
- `notification.notification.target_user_id` references `organization.employee(id)`
- `organization.department.manager_id` references `organization.employee(id)`
- All HR/org features use `organization.employee` as central employee entity

---

## Notification Hub Integration

### Decision
Chat service logic layer depends on `notification.NotificationLogic` interface. Use direct Go method calls (NOT RPC) to `PublishBatchNotification` for internal cross-domain communication. Notification hub backend (#007) handles delivery optimization, cross-instance routing, and SSE connections.

### Rationale (Updated for Constitution v3.6.0)
- **Two-Layer Service Architecture**: Chat logic layer depends on notification logic layer interface (not RPC client or connect layer)
- **Delegation of Responsibility**: Notification domain owns performance optimizations (batching, UNNEST inserts, delivery tracking)
- **Decoupled Architecture**: Chat service focuses on chat logic, not notification infrastructure
- **Atomic Operations**: Share same transaction (`tx database.DBTX`) for message creation + notification publishing
- **Context Propagation**: Pass user-scope context (request context) through logic layers to preserve organization_id and auth claims
- **No RPC Overhead Internally**: Direct Go method invocation avoids marshaling/unmarshaling for internal service calls
- **Testability**: Mock `NotificationLogic` interface for chat logic layer tests
- **Performance**: Notification logic layer already implements batched PostgreSQL UNNEST inserts (<100ms for 1000+ recipients)
- **Future-Proof**: Notification domain can evolve delivery strategies (WebSocket, push notifications) without chat service changes

### Integration Architecture

**Two-Layer Service Pattern**:

**Chat Logic Layer** (`internal/chat/logic.go`):
```go
// Define interface
type ChatLogic interface {
    SendMessage(ctx context.Context, tx database.DBTX, orgID, authorID dbuuid.UUID, req *proto.SendMessageRequest) (*proto.SendMessageResponse, error)
    // ... other methods
}

// Implementation depends on notification logic interface
type chatLogicImpl struct {
    Queries           *database.Queries
    NotificationLogic notification.NotificationLogic // Cross-domain dependency
}

func NewChatLogic(queries *database.Queries, notifLogic notification.NotificationLogic) ChatLogic {
    return &chatLogicImpl{
        Queries:           queries,
        NotificationLogic: notifLogic,
    }
}

func (s *chatLogicImpl) SendMessage(
    ctx context.Context,
    tx database.DBTX, // Receives transaction from connect layer
    orgID, authorID dbuuid.UUID,
    req *proto.SendMessageRequest,
) (*proto.SendMessageResponse, error) {
    // 1. Create message in database
    message, err := s.Queries.CreateMessage(ctx, tx, database.CreateMessageParams{
        OrganizationID:   orgID,
        ChannelID:        uuid.MustParse(req.ChannelId),
        AuthorEmployeeID: authorID,
        Content:          req.Content,
        // ...
    })
    if err != nil {
        return nil, fmt.Errorf("failed to create message: %w", err)
    }

    // 2. Fetch channel members with notification preferences
    members, err := s.Queries.GetNotifiableChannelMembers(ctx, tx, database.GetNotifiableChannelMembersParams{
        ChannelID:      message.ChannelID,
        OrganizationID: orgID,
        // Filter by notification preferences
    })
    if err != nil {
        return nil, fmt.Errorf("failed to fetch members: %w", err)
    }

    // 3. Call notification logic layer directly (NOT RPC)
    // Pass same transaction for atomicity
    _, err = s.NotificationLogic.PublishBatchNotification(ctx, tx, orgID, &notification.BatchNotificationRequest{
        Notifications: buildNotifications(members, message, orgID),
    })
    if err != nil {
        return nil, fmt.Errorf("failed to publish notifications: %w", err)
    }

    return &proto.SendMessageResponse{Message: convertMessage(message)}, nil
}
```

**Chat Connect Layer** (`internal/chat/connect.go`):
```go
type ChatServiceConnect struct {
    rpcv1connect.UnimplementedChatServiceHandler
    Logic      ChatLogic                        // Logic layer interface
    TenantPool database.TenantDatabaseConnector // Owns pool
}

func NewChatServiceConnect(logic ChatLogic, tenantPool database.TenantDatabaseConnector) *ChatServiceConnect {
    return &ChatServiceConnect{
        Logic:      logic,
        TenantPool: tenantPool,
    }
}

func (s *ChatServiceConnect) SendMessage(
    ctx context.Context,
    req *connect.Request[proto.SendMessageRequest],
) (*connect.Response[proto.SendMessageResponse], error) {
    // 1. Extract auth context (Connect layer responsibility)
    employeeID, orgID, err := extractAuthContext(ctx)
    if err != nil {
        return nil, connect.NewError(connect.CodeUnauthenticated, err)
    }

    // 2. Manage transaction (Connect layer chooses pool)
    var resp *proto.SendMessageResponse
    err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
        var txErr error
        // Pass user context, transaction, and parsed auth to logic layer
        resp, txErr = s.Logic.SendMessage(ctx, tx, orgID, employeeID, req.Msg)
        return txErr
    })

    // 3. Translate to connect response
    if err != nil {
        return nil, connect.NewError(connect.CodeInternal, err)
    }
    return connect.NewResponse(resp), nil
}
```

**Initialization in `backend/cmd/server.go`**:
```go
// 1. Create logic layers first (no pools in constructors)
notifLogic := notification.NewNotificationLogic(queries, instanceID)
chatLogic := chat.NewChatLogic(queries, notifLogic) // Inject notification logic

// 2. Wrap with connect layers (pools here)
notifConnect := notification.NewNotificationServiceConnect(notifLogic, adminPool, tenantPool)
chatConnect := chat.NewChatServiceConnect(chatLogic, tenantPool)

// 3. Register connect layers with RPC
mux.Handle(rpcv1connect.NewNotificationServiceHandler(notifConnect, interceptors))
mux.Handle(rpcv1connect.NewChatServiceHandler(chatConnect, interceptors))
```

### Integration Points

**1. Cross-Domain Method Signature**:

Notification logic layer method that chat will call:
```go
// notification/logic.go
type NotificationLogic interface {
    PublishBatchNotification(
        ctx context.Context,
        tx database.DBTX, // Can accept transaction from caller
        orgID dbuuid.UUID,
        req *BatchNotificationRequest,
    ) (*BatchNotificationResponse, error)
}

type BatchNotificationRequest struct {
    Notifications []*NotificationParams
}

type NotificationParams struct {
    Recipients       []dbuuid.UUID // employee IDs
    SourceDomain     string      // "chat"
    NotificationType string      // "message", "mention", "reply", "invite"
    Title            string
    Message          string
    ActionData       map[string]string
    Priority         int32
}
```

**2. Transaction Sharing for Atomicity**:

Connect layer creates transaction, both logic layers use same tx:
```go
// Chat connect layer
err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
    // Both operations use same transaction
    resp, err := s.Logic.SendMessage(ctx, tx, orgID, employeeID, req.Msg)
    // Inside SendMessage, notification logic is called with same tx
    return err
})
```

Inside chat logic layer:
```go
// Create message with tx
message, err := s.Queries.CreateMessage(ctx, tx, params)

// Call notification logic with same tx for atomicity
_, err = s.NotificationLogic.PublishBatchNotification(ctx, tx, orgID, notificationReq)
// If this fails, message creation rolls back automatically
```

**3. Context Propagation (CRITICAL)**:

- **User-scope context**: Pass request context from connect layer through all logic layer calls
- Preserves organization_id, user identity, and auth claims
- Enables audit logging and tenant isolation enforcement
```go
// Connect layer: ctx comes from RPC request
err = txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
    // ctx preserves user context through logic layers
    return s.Logic.SendMessage(ctx, tx, orgID, employeeID, req.Msg)
})

// Logic layer: ctx propagates to cross-domain calls
_, err = s.NotificationLogic.PublishBatchNotification(ctx, tx, orgID, req)
```

**4. Notification Filtering by Preferences**:

Chat logic layer filters members before calling notification logic:
```sql
-- Get members who should receive notification
SELECT employee_id 
FROM chat.channel_membership
WHERE channel_id = $1
  AND organization_id = $2
  AND (
      notification_preference = 'all' OR
      (notification_preference = 'mentions' AND $3) -- $3 = message_contains_mention
      OR notification_preference IS NULL -- Default to 'all'
  )
  AND notification_preference != 'muted'
;
```

**5. Structured Logging for Observability**:

Both layers log cross-domain interactions:
```go
// Chat logic layer
slog.DebugContext(ctx, "calling notification logic for message",
    "function", "SendMessage",
    "source_domain", "chat",
    "target_domain", "notification",
    "operation", "PublishBatchNotification",
    "recipient_count", len(members),
)

_, err = s.NotificationLogic.PublishBatchNotification(ctx, tx, orgID, req)
if err != nil {
    slog.ErrorContext(ctx, "failed to publish notifications",
        "function", "SendMessage",
        "error", err,
    )
    return nil, fmt.Errorf("failed to publish notifications: %w", err)
}
```

**6. Performance Strategy**:
- **Notification logic optimization**: PublishBatchNotification uses PostgreSQL UNNEST for 1000+ inserts (<100ms)
- **Preference filtering**: Chat logic filters members before cross-domain call to minimize notification volume
- **Transaction sharing**: Single transaction commit for both message creation and notification publishing
- **Delivery tracking**: Notification hub tracks delivery status, retries, and acknowledgments

### Existing Pattern
See `backend/internal/notification/logic.go` for `PublishBatchNotification` implementation with batched UNNEST inserts and instance-level NOTIFY broadcasting.

**Cross-Domain Integration Reference**:
- Constitution v3.6.0, Principle VI: Cross-Domain Integration & Service Dependencies
- Logic layer interfaces for cross-domain dependencies
- Transaction-aware methods (`tx database.DBTX` parameter)
- User-scope context propagation for security
- Direct Go method invocations (not RPC for internal calls)

---

## RPC Contract Design

### Decision
Create new `backend/rpc/v1/chat.proto` with `ChatService` containing methods for:
- Channel management (create, join, leave, archive, list)
- Messaging (send, edit, delete, list with pagination)
- Replies (reply to message, list replies)
- Reactions (add, remove, list)
- Typing indicators (start typing, stop typing)

### Rationale
- Chat is a new business domain requiring its own service definition
- Separation of concerns: chat logic independent of organization, notification, or other services
- Enables versioning and evolution of chat API without affecting other services

### Access Control
Use proto-level `access_control` annotations for declarative RBAC:
```protobuf
service ChatService {
  rpc CreateChannel(CreateChannelRequest) returns (CreateChannelResponse) {
    option (rpc.v1.access_control) = {
      allowed_roles: [ROLE_OWNER, ROLE_OPERATOR, ROLE_EMPLOYEE]
      allow_unauthenticated: false
    };
  }
  // All chat methods require ROLE_EMPLOYEE
}
```

### Message Structure
Follow existing Tech Office proto patterns:
- Request/Response message pairs for each RPC
- Pagination with `page_size` and `page_token` (cursor-based)
- Timestamps as `google.protobuf.Timestamp`
- Enums for channel types, notification preferences

### Existing Pattern
- `backend/rpc/v1/organization.proto`: Organization service structure
- `backend/rpc/v1/department.proto`: Department service structure
- Access control annotations from `backend/rpc/v1/access_control.proto`

---

## Performance Optimization for Large Channels

### Problem Statement
Channels with 1000+ members require efficient notification delivery without blocking message creation. User requirement: "ensure performance way to notify a channel with a lot of user".

### Solution Architecture

**1. Batched Notification Inserts**

Instead of 1000 individual INSERTs, use single batch INSERT with UNNEST:

```sql
-- Efficient: Single INSERT for all members
INSERT INTO notification.notification (organization_id, target_user_id, ...)
SELECT $1, unnest($2::uuid[]), ...;
```

**Performance**: 1000 notifications in <100ms vs 1000 individual INSERTs taking seconds.

**2. Efficient Member Queries**

Composite index on `chat.channel_membership`:
```sql
CREATE INDEX idx_channel_membership_lookup 
ON chat.channel_membership(channel_id, organization_id, notification_preference);
```

Query optimization: Filter members at database level based on notification preferences:
```sql
-- Only fetch members who should be notified
SELECT employee_id, notification_preference
FROM chat.channel_membership
WHERE channel_id = $1 
  AND organization_id = $2
  AND notification_preference != 'muted'
;
```

**Performance**: <50ms for 10,000 members with indexed query.

**3. Message Pagination**

Cursor-based pagination for efficient message loading:
```sql
-- Load 50 messages after last seen message
SELECT * FROM chat.message
WHERE channel_id = $1 
  AND organization_id = $2
  AND updated_at < $3 -- Cursor (last message timestamp)
ORDER BY updated_at DESC
LIMIT 50;
```

Index: `chat.message(channel_id, organization_id, updated_at DESC)`

**Performance**: <200ms for loading 50 messages with replies, even in channels with millions of messages.

**4. Async Notification Publishing**

Decouple notification publishing from message creation:
```go
// Main transaction: Create message
err := txn.WithTxn(ctx, s.TenantPool, func(ctx context.Context, tx database.DBTX) error {
    return s.Queries.CreateMessage(ctx, tx, messageParams)
})

// Async: Publish notifications (doesn't block response)
go s.publishChannelNotifications(ctx, channel, message)
```

**Benefit**: User receives message creation response immediately (<100ms), while notification delivery happens asynchronously.

**5. Typing Indicators (Ephemeral State)**

Typing indicators are NOT persisted to database:
- In-memory tracking in notification hub
- Broadcast via existing SSE connections
- Auto-expire after 5 seconds of inactivity

**Benefit**: Avoids high-frequency DB writes for transient state.

### Database Partitioning (Future Optimization)

For orgs with extremely high message volume, consider table partitioning:
```sql
-- Partition by month for message archival
CREATE TABLE chat.message_2025_10 PARTITION OF chat.message
FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');
```

**Benefit**: Older messages can be moved to cheaper storage; recent messages remain in hot partition.

**Decision**: Defer partitioning until proven necessary (post-MVP optimization).

### Monitoring & Observability

Track performance metrics:
- `chat_notification_batch_size`: Distribution of notification batch sizes
- `chat_notification_publish_duration`: Time to publish notifications for a message
- `chat_message_create_duration`: End-to-end message creation latency
- `chat_channel_member_query_duration`: Time to fetch channel members

**Alerts**: Trigger alert if notification publish duration exceeds 500ms for channels >100 members.

---

## Frontend Real-Time Integration

### Decision
Subscribe to notification hub SSE endpoint for incoming chat notifications. Handle notifications via `packages/notifications` with chat-specific handler.

### Implementation Pattern

**1. Notification Subscription**:
Frontend maintains SSE connection to notification hub:
```typescript
// packages/notifications/src/client.ts
const eventSource = new EventSource('/api/notifications/stream');
eventSource.onmessage = (event) => {
  const notification = JSON.parse(event.data);
  handleNotification(notification);
};
```

**2. Chat Notification Handler**:
```typescript
// packages/notifications/src/handlers/chatHandler.ts
export function handleChatNotification(notification: Notification) {
  const { channelId, messageId, replyId } = notification.action_data;
  
  switch (notification.notification_type) {
    case 'message':
      // Update message list for active channel
      break;
    case 'mention':
      // Highlight mention in message thread
      break;
    case 'reply':
      // Update reply count on parent message
      break;
  }
}
```

**3. Optimistic UI Updates**:
- Message composer sends message → optimistic insert into local state
- If RPC fails → remove optimistic message and show error
- When notification arrives → deduplicate with optimistic message (match by temporary ID)

### Existing Pattern
- `packages/notifications/src/client.ts`: SSE connection management
- Notification routing by `source_domain` to appropriate handlers

---

## Typing Indicators Implementation

### Decision
Ephemeral state transmitted via SSE, not persisted to database.

### Rationale
- High-frequency low-value data: Persisting creates unnecessary DB load
- Short-lived state: Typing stops after seconds of inactivity
- Real-time requirement: Database round-trip adds latency

### Architecture

**Backend**:
1. Client calls `ChatService.StartTyping(channel_id)` RPC (lightweight, no DB write)
2. Chat service broadcasts typing event to notification hub's in-memory registry
3. Notification hub maintains map: `channel_id -> set of typing user_ids`
4. Notification hub broadcasts typing state to all connected channel members via SSE
5. Auto-expire after 5 seconds if no heartbeat received

**Frontend**:
1. User types in message composer → debounced `StartTyping()` call every 3 seconds
2. User stops typing → `StopTyping()` call
3. Receive typing events via SSE → display "Alice is typing..." in channel header

### Performance
- No database writes for typing events
- In-memory state in notification hub
- SSE broadcast to channel members: <50ms

### Existing Pattern
Similar to presence indicators (online/offline status) in collaboration tools.

---

## Zitadel Integration

### Decision
No new roles or permissions needed. Use existing `ROLE_EMPLOYEE` for all chat operations.

### Rationale
- All employees can create channels, send messages, and react
- Channel-level access control handled in database (`channel_membership` table)
- RBAC at application level: Proto-level `access_control` enforces `ROLE_EMPLOYEE` requirement

### Channel Admin Permissions
Admin status stored in `chat.channel_membership.is_admin` column, not in Zitadel:
- Admins can archive channels, remove members, promote other admins
- Checked at service method level, not Zitadel level

### Existing Pattern
Organization, department, and employee features use `ROLE_EMPLOYEE`, `ROLE_OPERATOR`, `ROLE_OWNER` from Zitadel with additional fine-grained permissions in database.

---

## Summary of Key Decisions

| Area | Decision | Rationale |
|------|----------|-----------|
| **Schema** | New `chat` schema | Domain separation, reusability |
| **Multi-Tenancy** | `organization_id` on all tables | Constitutional requirement |
| **Employee Reference** | `organization.employee` FK | Central employee entity |
| **Service Architecture** | Two-layer (logic + connect) | Constitution v3.6.0, testability, reusability |
| **Cross-Domain Integration** | Logic layer interface dependencies | No RPC overhead, transaction sharing, type safety |
| **Notification Publishing** | Direct `NotificationLogic` method call | Atomic operations, context propagation, performance |
| **Transaction Management** | `txn.WithTxn` in connect layer, `DBTX` in logic | Atomic cross-domain operations, no nested transactions |
| **Context Propagation** | User-scope context through logic layers | Security, audit, tenant isolation |
| **Performance** | Batched inserts + indexed queries | Support 1000+ member channels |
| **Typing Indicators** | Ephemeral in-memory state | Avoid DB load for transient data |
| **RPC** | New `chat.proto` service | Clean separation of concerns |
| **RBAC** | `ROLE_EMPLOYEE` + channel membership | Simple auth model |
| **Frontend** | Workspace integration + SSE | Consistent UX and real-time updates |

---

## Architecture Comparison: v3.5.0 → v3.6.0

### Before (Constitution v3.5.0)
```
Chat Service (single layer)
  ↓ RPC call
Notification Service (single layer)
  ↓
notification.notification table
```

**Issues**:
- RPC overhead for internal calls (marshaling/unmarshaling)
- No transaction sharing (message creation ≠ atomic with notifications)
- Harder to test (need to mock RPC clients)
- Context boundaries unclear

### After (Constitution v3.6.0)
```
Chat Connect Layer
  ↓ extracts auth, manages tx
Chat Logic Layer
  ↓ direct method call (same tx)
Notification Logic Layer
  ↓
notification.notification table
```

**Benefits**:
- ✅ No RPC overhead internally
- ✅ Transaction sharing (atomic operations)
- ✅ Easy to test (mock logic interfaces)
- ✅ Clear context propagation (user-scope)
- ✅ Type-safe compile-time contracts
- ✅ Logic layer reusable without RPC

---

## Next Steps

Proceed to Phase 1: Design & Contracts
- ✅ data-model.md complete with Constitution v3.6.0 integration patterns
- Create contracts/chat.proto with RPC definitions
- Create contracts/chat.query.sql with sqlc queries
- Generate quickstart.md with test scenarios
