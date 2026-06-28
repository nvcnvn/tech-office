# Research: Notification Hub Backend

**Feature**: Notification Hub Backend  
**Date**: October 28, 2025  
**Status**: Complete

## Research Objectives

1. Database schema design for notification domain
2. Real-time delivery mechanism evaluation (SSE vs WebSocket vs polling)
3. Horizontal scaling architecture (per-user channels vs instance-level channels vs org-wide channels)
4. Connection registry design for instance routing
5. Department-based notification targeting
6. Deduplication strategy
7. PostgreSQL LISTEN/NOTIFY best practices
8. Existing Tech Office patterns to follow

---

## 1. Database Schema Design

### Decision: New `notification` domain schema

**Rationale**:
- Notifications are a cross-cutting concern used by multiple business domains (chat, CRM, projects, HR, support)
- Separate schema provides clear ownership and isolation from business domain schemas
- Follows Tech Office's schema-per-domain pattern (consistent with `iam`, `organization`, `crm`, etc.)

**Schema Components**:
1. **notification table**: Core notification data
   - `id UUID PRIMARY KEY DEFAULT uuidv7()`
   - `organization_id UUID NOT NULL` (FK to public.organization) - tenant isolation
   - `source_domain TEXT NOT NULL` (chat, crm, projects, hr, support, finance, system)
   - `notification_type TEXT NOT NULL` (message, mention, task_assigned, deal_updated, etc.)
   - `title TEXT NOT NULL`
   - `message TEXT NOT NULL`
   - `action_data JSONB` (flexible metadata for deep linking)
   - `action_category TEXT` (for deduplication grouping: react, comment, update, etc.)
   - `priority SMALLINT NOT NULL DEFAULT 1` (0=always, 1=not offline, 2=online only, 4=silent)
   - `publishing_service_id TEXT` (identifier of backend service that created notification)
   - `updated_at TIMESTAMPTZ DEFAULT now()`

2. **notification_recipient table**: Links notifications to employees with delivery tracking
   - `id UUID PRIMARY KEY DEFAULT uuidv7()`
   - `notification_id UUID NOT NULL` (FK to notification)
   - `employee_id UUID NOT NULL` (FK to organization.employee)
   - `organization_id UUID NOT NULL` (FK to public.organization) - denormalized for query performance
   - `read_status BOOLEAN DEFAULT false`
   - `read_at TIMESTAMPTZ`
   - `delivery_status TEXT DEFAULT 'pending'` (pending, delivered, failed)
   - `delivered_at TIMESTAMPTZ`
   - `updated_at TIMESTAMPTZ DEFAULT now()`
   - Composite index on (employee_id, organization_id, read_status)

3. **active_connection table** (UNLOGGED): Connection registry for instance routing
   - `employee_id UUID NOT NULL` (FK to organization.employee)
   - `instance_id TEXT NOT NULL` (backend instance hostname/ID)
   - `connection_id UUID NOT NULL` (unique per SSE connection)
   - `organization_id UUID NOT NULL` (FK to public.organization)
   - `department_ids UUID[]` (denormalized for fast department queries)
   - `connected_at TIMESTAMPTZ DEFAULT now()`
   - `last_heartbeat TIMESTAMPTZ DEFAULT now()`
   - `connection_status TEXT DEFAULT 'active'` (active, stale)
   - PRIMARY KEY (employee_id, connection_id)
   - GIN index on department_ids for array overlap queries
   - Index on last_heartbeat for cleanup queries
   - **UNLOGGED table**: 2-3x faster writes (no WAL), acceptable data loss on crash (users reconnect)

4. **notification_batch table**: Groups related notifications
   - `id UUID PRIMARY KEY DEFAULT uuidv7()`
   - `organization_id UUID NOT NULL`
   - `batch_key TEXT NOT NULL` (for deduplication)
   - `notification_ids UUID[]`
   - `target_employee_ids UUID[]`
   - `processing_status TEXT DEFAULT 'pending'`
   - `publishing_service_id TEXT`
   - `updated_at TIMESTAMPTZ DEFAULT now()`

**Partitioning Strategy**:
- Partition `notification` and `notification_recipient` tables by `updated_at` (monthly partitions)
- Enables efficient archival and query performance at scale (100k notifications/day per org)
- Initial implementation: single table, add partitioning when approaching limits

**Alternatives Considered**:
- **Extend organization schema**: Rejected - notification is a separate domain concern
- **Separate table per domain**: Rejected - creates maintenance burden and complicates querying
- **NoSQL document store**: Rejected - requires PostgreSQL for LISTEN/NOTIFY anyway; multi-tenant isolation simpler in RDBMS

**Existing Patterns to Follow**:
- Reference `backend/database/scripts/schema.sql` for organization and iam schemas
- Use `organization.employee` as central employee entity (same as CRM, HR domains)
- Follow `organization.customer` pattern for central entity references

---

## 2. Real-Time Delivery Mechanism

### Decision: Server-Sent Events (SSE) with PostgreSQL LISTEN/NOTIFY

**Rationale**:
- **SSE chosen over WebSocket**:
  - Simpler implementation (unidirectional, HTTP-based)
  - Native browser reconnection support
  - No need for bidirectional communication (notifications are server → client only)
  - Lower protocol overhead
  - Better firewall/proxy compatibility
  
- **PostgreSQL LISTEN/NOTIFY chosen as event bus**:
  - Already using PostgreSQL - no additional infrastructure
  - Lightweight pub/sub mechanism
  - Low latency (<5ms typical)
  - Scales to thousands of channels per database
  - Transactional guarantees (NOTIFY after COMMIT)

**SSE Implementation Pattern**:
```go
func (s *NotificationService) StreamNotifications(ctx context.Context, req *connect.Request[v1.StreamNotificationsRequest]) (*connect.ServerStreamingHandlerConn, error) {
    // 1. Validate auth & organization context
    // 2. Register connection in active_connection table
    // 3. Query missed notifications since last_event_id
    // 4. Send existing notifications
    // 5. Keep connection open, listen for new events
    // 6. Send events as SSE data: {id, event, data}
    // 7. Update last_heartbeat every 30s
    // 8. Clean up registry on disconnect
}
```

**LISTEN/NOTIFY Setup**:
- Each backend instance subscribes to its own channel: `LISTEN instance_{instance_id}_notifications`
- Dedicated PostgreSQL connection per instance for LISTEN (separate from query pool)
- Publishers NOTIFY target instance channels after storing notification in database
- Payload includes: notification_id, recipient_employee_ids, priority, action_data

**Performance Characteristics**:
- SSE connection overhead: ~50KB memory per connection
- 10,000 connections per instance = ~500MB memory
- NOTIFY latency: <5ms to delivery
- Registry query latency: <5ms with proper indexing

**Fallback Strategy**:
- Track delivery attempts in `notification_recipient.delivery_status`
- If SSE fails for >5 minutes, trigger fallback (push notification, email)
- Retry logic for transient failures

**Alternatives Considered**:
- **WebSocket**: Rejected - unnecessary bidirectional complexity
- **Long polling**: Rejected - higher latency, more resource intensive
- **Redis Pub/Sub**: Rejected - adds external dependency, no transactional guarantees
- **Message queue (RabbitMQ, Kafka)**: Rejected - overkill for this use case, adds operational complexity

**Existing Patterns to Follow**:
- Similar pattern in https://github.com/nvcnvn/flows workers: long-lived connections with heartbeat
- Database connection management patterns from `backend/database/pool.go`

---

## 3. Horizontal Scaling Architecture

### Decision: Instance-level channels with PostgreSQL connection registry

**Rationale**:
- **Instance-level channels chosen over per-user channels**:
  - 10,000 users/instance → 3 LISTEN statements (one per instance) vs 10,000 LISTEN statements
  - Bulk notifications: 3 NOTIFY calls vs 10,000 NOTIFY calls
  - Reduced NOTIFY overhead: single call per instance vs thousands per notification
  - No subscribe/unsubscribe churn on user connect/disconnect
  
- **Instance-level channels chosen over org-wide channels**:
  - Prevents broadcast to all instances (org channels would deliver ALL notifications to ALL instances)
  - True sharding: instances only receive events for their connected users
  - Network efficiency: no wasted bandwidth on events for users not on that instance
  
- **Connection registry provides instance routing**:
  - Query registry to find which instance(s) have target user(s)
  - Publish NOTIFY to those specific instance channels
  - Each instance filters payload for its connected users

**Scaling Architecture**:
```
Publisher Flow:
1. Backend service (e.g., chat) calls PublishNotification API
2. NotificationService stores notification in database (with transaction)
3. Query active_connection registry: SELECT instance_id, array_agg(employee_id) 
   FROM active_connection WHERE employee_id = ANY($1) GROUP BY instance_id
4. For each instance_id, NOTIFY "instance_{id}_notifications" with recipient list
5. Only instances with target users receive event

Receiver Flow:
1. Backend instance LISTENs on "instance_{instance_id}_notifications"
2. Receives NOTIFY event with notification_id and recipient_employee_ids
3. Filters recipients: only users actually connected to this instance
4. Queries notification details from database
5. Sends SSE events to filtered user connections
```

**Connection Registry Design**:
- UNLOGGED table for 2-3x write performance (no WAL overhead)
- Acceptable data loss on crash: users reconnect and repopulate
- Heartbeat mechanism: update last_heartbeat every 30s
- Cleanup job: remove entries with last_heartbeat > 60s old
- Department membership denormalized: populated on connect via query

**Scalability Metrics**:
- Registry query latency: <5ms with proper indexing
- NOTIFY calls per bulk notification: O(instances) vs O(users)
- Memory per instance: ~1MB per 10k users for registry subset
- PostgreSQL channels: 3 total (3 instances) vs 30,000+ (per-user approach)

**Alternatives Considered**:
- **Per-user channels**: Rejected - doesn't scale well (10k LISTEN per instance, 10k NOTIFY per bulk notification)
- **Org-wide channels**: Rejected - broadcasts to all instances, defeats sharding
- **Redis for registry**: Deferred - PostgreSQL sufficient for v1, can add Redis caching later
- **gRPC instance-to-instance**: Rejected - requires service discovery, more complex than NOTIFY

**Existing Patterns to Follow**:
- Kubernetes instance identification from pod name/hostname
- Database connection pooling from `backend/database/pool.go`
- Background cleanup jobs similar to https://github.com/nvcnvn/flows workflows

---

## 4. Department-Based Notification Targeting

### Decision: Denormalized department_ids[] array in connection registry with GIN index

**Rationale**:
- **Denormalize department membership in connection registry**:
  - Eliminates JOINs for department → users → instances resolution
  - Single query: `SELECT instance_id, array_agg(employee_id) FROM active_connection WHERE department_ids && ARRAY[target_depts] GROUP BY instance_id`
  - Department membership changes are rare; acceptable staleness until reconnect
  
- **GIN index on department_ids[] array**:
  - Enables efficient array overlap queries: `department_ids && ARRAY[...]`
  - O(log n) lookup performance
  - PostgreSQL array operators optimized for this use case

**Implementation**:
```sql
-- Connection registry with department denormalization
CREATE TABLE notification.active_connection (
    employee_id UUID NOT NULL,
    instance_id TEXT NOT NULL,
    connection_id UUID NOT NULL,
    organization_id UUID NOT NULL,
    department_ids UUID[], -- Denormalized from organization.department_member
    connected_at TIMESTAMPTZ DEFAULT now(),
    last_heartbeat TIMESTAMPTZ DEFAULT now(),
    connection_status TEXT DEFAULT 'active',
    PRIMARY KEY (employee_id, connection_id)
);

-- GIN index for array overlap queries
CREATE INDEX idx_active_connection_departments 
ON notification.active_connection USING GIN (department_ids);

-- Query for department-based notification
SELECT instance_id, array_agg(employee_id) 
FROM notification.active_connection 
WHERE department_ids && ARRAY['dept-uuid-1', 'dept-uuid-2']::uuid[]
  AND organization_id = $1
  AND connection_status = 'active'
GROUP BY instance_id;
```

**Populate on Connect**:
```go
// When SSE connection established
func (s *NotificationService) registerConnection(ctx context.Context, employeeID, instanceID, connID dbuuid.UUID) error {
    // Query employee's departments
    deptIDs, err := s.Queries.GetEmployeeDepartments(ctx, s.TenantPool, employeeID)
    if err != nil {
        return err
    }
    
    // Insert into active_connection with department_ids
    return s.Queries.InsertActiveConnection(ctx, s.AdminPool, database.InsertActiveConnectionParams{
        EmployeeID:    employeeID,
        InstanceID:    instanceID,
        ConnectionID:  connID,
        OrganizationID: orgID,
        DepartmentIds: deptIDs, // Denormalized array
    })
}
```

**Staleness Handling**:
- Department changes not reflected until SSE reconnection
- Acceptable: department membership changes are rare (hours/days between changes)
- Session duration: max 24h before forced reconnect
- For critical changes: admin can force SSE reconnection (close existing connections)

**Performance**:
- Array storage overhead: ~16 bytes per department_id
- Typical user: 1-3 departments = ~48 bytes
- GIN index overhead: ~2x table size
- Query performance: <10ms for 10k user registry with proper index

**Alternatives Considered**:
- **JOINs to organization.department_member**: Rejected - adds query latency, complicates batching
- **Separate mapping table**: Rejected - requires additional JOIN, defeats denormalization purpose
- **Real-time department updates**: Rejected - adds complexity, rare use case doesn't justify

**Existing Patterns to Follow**:
- JSONB metadata fields in other schemas (flexible data storage)
- GIN indexes on JSONB columns in existing tables
- Department references in `organization.department_member` table

---

## 5. Deduplication Strategy

### Decision: LRU cache with action category grouping

**Rationale**:
- **LRU cache chosen over database deduplication**:
  - In-memory cache provides <1ms lookup
  - Database queries would add latency to notification publishing
  - LRU eviction handles memory bounds automatically
  
- **Action category grouping**:
  - Group related actions: react:like + react:unlike → 'react' category
  - Prevents notification spam from rapid repeated actions
  - Example: User repeatedly likes/unlikes same item → single "User reacted" notification

**Implementation**:
```go
type DeduplicationKey struct {
    EmployeeID      dbuuid.UUID
    ActionCategory  string  // 'react', 'comment', 'update', 'assign'
    SourceUserID    dbuuid.UUID
    ResourceID      string  // Optional: dedupe per resource
}

// LRU cache: 10,000 entries = ~1MB memory
cache, _ := lru.New(10000)

func (s *NotificationService) shouldDedupe(key DeduplicationKey) bool {
    if _, found := cache.Get(key); found {
        return true // Skip duplicate
    }
    cache.Add(key, time.Now())
    return false
}
```

**Batch Window Integration**:
- Buffer notifications for 5 seconds before deduplication
- Within batch window: deduplicate by action category + source user
- Example: 10 "User liked comment" events in 5s → single notification
- Frontend decides whether to play sound (based on batch or individual)

**Cache Configuration**:
- Size: 10,000 entries (configurable per instance)
- TTL: 5 minutes (implicit via LRU eviction)
- Memory: ~1MB per instance
- Per-instance cache (no cross-instance coordination needed)

**Alternatives Considered**:
- **Database-based deduplication**: Rejected - adds latency to publishing path
- **Distributed cache (Redis)**: Rejected - adds external dependency, not needed for v1
- **Bloom filter**: Rejected - false positives unacceptable, LRU simpler
- **Time-window only (no cache)**: Rejected - doesn't handle repeated spam across windows

**Existing Patterns to Follow**:
- In-memory caching patterns similar to auth token cache
- Time-based batch processing similar to https://github.com/nvcnvn/flows workflows

---

## 6. PostgreSQL LISTEN/NOTIFY Best Practices

### Research Findings

**Connection Management**:
- Use dedicated connection for LISTEN/NOTIFY (separate from query pool)
- Long-lived connection with reconnection logic
- Each instance maintains one LISTEN connection per instance channel
- Connection health check: send test NOTIFY every 30s

**Payload Limits**:
- NOTIFY payload limit: 8000 bytes
- For bulk notifications: send array of employee IDs (UUIDs = 36 bytes each)
- ~200 recipients per NOTIFY (with metadata overhead)
- If more than 200 recipients: split into multiple NOTIFY calls

**Error Handling**:
- NOTIFY is fire-and-forget (no ACK)
- Listeners must be actively subscribed to receive events
- If connection drops, listener misses events during downtime
- Solution: Query missed notifications on reconnect using last_event_id

**Performance Considerations**:
- LISTEN creates no overhead (passive subscription)
- NOTIFY is asynchronous (non-blocking for publisher)
- All LISTENing connections receive NOTIFY instantly (<5ms)
- No persistence: events lost if no active listeners

**Transaction Safety**:
- NOTIFY only sent after transaction COMMIT
- If transaction rolls back, NOTIFY not sent
- Ensures notification data exists before delivery

**Implementation Pattern**:
```go
// Dedicated LISTEN connection per instance
func (s *NotificationService) startListening(ctx context.Context) error {
    conn, err := pgx.Connect(ctx, s.DatabaseURL)
    if err != nil {
        return err
    }
    s.ListenerConn = conn
    
    channelName := fmt.Sprintf("instance_%s_notifications", s.InstanceID)
    _, err = conn.Exec(ctx, fmt.Sprintf("LISTEN %s", channelName))
    if err != nil {
        return err
    }
    
    go s.receiveNotifications(ctx)
    return nil
}

func (s *NotificationService) receiveNotifications(ctx context.Context) {
    for {
        notification, err := s.ListenerConn.WaitForNotification(ctx)
        if err != nil {
            // Reconnect logic
            continue
        }
        
        // Parse payload and route to connected users
        s.handleNotification(ctx, notification.Payload)
    }
}
```

**Existing Patterns to Follow**:
- Database connection management from `backend/database/pool.go`
- Long-lived connection patterns from https://github.com/nvcnvn/flows workers
- Error handling and retry logic from existing services

---

## 7. Multi-Tenant Isolation

### Existing Patterns

**Organization Context Validation**:
```go
// From backend/internal/organization/organization.go
func (s *OrganizationService) validateOrganizationContext(ctx context.Context, orgID dbuuid.UUID) error {
    authOrgID := zitadeljwt.GetOrganizationID(ctx)
    if authOrgID != orgID {
        return connect.NewError(connect.CodePermissionDenied, errors.New("organization mismatch"))
    }
    return nil
}
```

**TenantPool Usage**:
- All employee-facing queries use TenantPool
- TenantPool enforces organization_id context from auth token
- Prevents cross-tenant data access

**AdminPool Usage**:
- Publishing API uses AdminPool (backend services publish across tenants)
- System operations (cleanup jobs, monitoring)
- Always document why AdminPool is required

**SQL Query Patterns**:
```sql
-- All employee-facing queries MUST include organization_id filter
-- name: ListNotifications :many
SELECT * FROM notification.notification_recipient nr
JOIN notification.notification n ON nr.notification_id = n.id
WHERE nr.employee_id = $1 
  AND nr.organization_id = $2  -- REQUIRED for tenant isolation
ORDER BY n.updated_at DESC
LIMIT $3 OFFSET $4;
```

**Existing Patterns to Follow**:
- Organization context extraction from `backend/internal/interceptor/auth.go`
- Pool usage patterns from `backend/internal/organization/organization.go`
- SQL query patterns with organization_id from existing query files

---

## 8. Frontend Real-Time Patterns

### SSE Client Implementation

**Custom Hook Pattern**:
```typescript
// hooks/useSSE.ts
export function useSSE(url: string, onMessage: (data: any) => void) {
    useEffect(() => {
        const eventSource = new EventSource(url);
        
        eventSource.onmessage = (event) => {
            onMessage(JSON.parse(event.data));
        };
        
        eventSource.onerror = () => {
            // Automatic reconnection by browser
        };
        
        return () => eventSource.close();
    }, [url, onMessage]);
}
```

**Notification Provider Pattern**:
```typescript
// components/notifications/NotificationProvider.tsx
export function NotificationProvider({ children }: { children: React.ReactNode }) {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const authToken = useAuth(); // From existing auth context
    
    useSSE(`/api/notifications/stream`, (notification) => {
        setNotifications(prev => [notification, ...prev]);
        // Play notification sound
        // Show toast notification
    });
    
    return (
        <NotificationContext.Provider value={{ notifications }}>
            {children}
        </NotificationContext.Provider>
    );
}
```

**Existing Patterns to Follow**:
- Auth context from `frontend/apps/web/src/context/AuthContext.tsx` (if exists)
- TanStack Query patterns for data fetching
- MUI theme and component patterns from existing pages
- Workspace layout integration from `frontend/apps/web/src/app/workspace/layout.tsx`

---

## Summary of Decisions

| Area | Decision | Rationale |
|------|----------|-----------|
| **Schema** | New `notification` domain schema | Cross-cutting concern, follows schema-per-domain pattern |
| **Real-Time** | SSE with PostgreSQL LISTEN/NOTIFY | Simple, native browser support, already using PostgreSQL |
| **Scaling** | Instance-level channels + connection registry | Avoids 10k channels/instance, prevents broadcast to all instances |
| **Department Targeting** | Denormalized department_ids[] with GIN index | Single-query resolution, no JOINs, acceptable staleness |
| **Deduplication** | LRU cache with action category grouping | <1ms lookup, handles spam, batching-friendly |
| **Connection Registry** | UNLOGGED table with heartbeat cleanup | 2-3x write performance, acceptable data loss on crash |
| **Tenant Isolation** | organization_id in all queries, TenantPool for employees, AdminPool for publishing | Follows existing patterns, prevents cross-tenant access |
| **Frontend** | Custom SSE hook with NotificationProvider | Reusable, follows React context patterns |

---

## Open Questions / Future Enhancements

**Deferred to v2**:
- Per-employee notification preferences (opt-in/opt-out by type)
- Organization-level notification configuration
- Push notification integration (APNS, FCM)
- Email notification fallback
- Redis caching layer for connection registry
- Advanced analytics (notification engagement, read rates)

**Performance Monitoring**:
- Registry query latency (target: <5ms)
- NOTIFY delivery latency (target: <5ms)
- SSE connection count per instance
- Notification delivery success rate (target: >99%)
- Department query performance with GIN index

---

**Status**: Research complete. All unknowns from Technical Context resolved. Ready for Phase 1 (Design & Contracts).
