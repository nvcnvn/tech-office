# Quickstart: Notification Hub Backend

**Feature**: Notification Hub Backend  
**Date**: October 28, 2025  
**Purpose**: End-to-end testing scenarios for notification hub implementation

---

## Prerequisites

- Backend server running with NotificationService registered
- PostgreSQL database with `notification` schema created
- Test organization and employees created
- Auth tokens for test employees
- Backend service auth token (ROLE_SYSTEM) for publishing

---

## Test Scenario 1: Backend Service Publishes Individual Notification

**Goal**: Verify backend service can publish notification to specific employee and it's delivered via SSE.

### Setup
```bash
# Environment variables
BACKEND_URL="http://localhost:18080"
ORG_ID="test-org-uuid"
EMPLOYEE1_ID="employee-1-uuid"
EMPLOYEE1_TOKEN="employee-1-jwt-token"
SERVICE_TOKEN="backend-service-jwt-token"
```

### Steps

1. **Employee establishes SSE connection**
   ```bash
   # In terminal 1 (simulate employee browser)
   curl -N -H "Authorization: Bearer ${EMPLOYEE1_TOKEN}" \
        "${BACKEND_URL}/api/notifications/stream"
   # Expected: Connection established, receives "connection_established" event
   ```

2. **Backend service publishes notification**
   ```bash
   # In terminal 2 (simulate chat service publishing notification)
   curl -X POST "${BACKEND_URL}/api/notifications/publish" \
        -H "Authorization: Bearer ${SERVICE_TOKEN}" \
        -H "Content-Type: application/json" \
        -d '{
          "organization_id": "'${ORG_ID}'",
          "recipients": {
            "employee_ids": ["'${EMPLOYEE1_ID}'"]
          },
          "source_domain": "chat",
          "notification_type": "message",
          "title": "New message from Alice",
          "message": "Alice sent you a message in #general",
          "action_data": {
            "chatThreadId": "thread-123",
            "messageId": "msg-456"
          },
          "action_category": "message",
          "priority": 1,
          "publishing_service_id": "chat-service"
        }'
   # Expected: 200 OK, notification_id returned
   ```

3. **Verify SSE delivery**
   ```bash
   # In terminal 1 (SSE connection)
   # Expected output:
   # event: notification
   # id: event-uuid
   # data: {"event_id":"...","event_type":"notification","notification":{...},"timestamp":"..."}
   ```

4. **List notifications via API**
   ```bash
   curl -H "Authorization: Bearer ${EMPLOYEE1_TOKEN}" \
        "${BACKEND_URL}/api/notifications/list?unread_only=true"
   # Expected: 1 unread notification with title "New message from Alice"
   ```

5. **Mark as read**
   ```bash
   RECIPIENT_ID="..." # From list response
   curl -X POST "${BACKEND_URL}/api/notifications/mark-read" \
        -H "Authorization: Bearer ${EMPLOYEE1_TOKEN}" \
        -H "Content-Type: application/json" \
        -d '{"notification_recipient_ids": ["'${RECIPIENT_ID}'"]}'
   # Expected: 200 OK, updated_count: 1
   ```

6. **Verify unread count**
   ```bash
   curl -H "Authorization: Bearer ${EMPLOYEE1_TOKEN}" \
        "${BACKEND_URL}/api/notifications/unread-count"
   # Expected: unread_count: 0
   ```

### Success Criteria
- [x] SSE connection established successfully
- [x] Notification published by backend service (not blocked by ROLE_SYSTEM check)
- [x] Notification received via SSE within 60 seconds
- [x] Notification appears in list API with correct content
- [x] Mark as read operation succeeds
- [x] Unread count reflects correct state

---

## Test Scenario 2: Department-Based Notification Targeting

**Goal**: Verify notifications sent to departments are resolved to all department members.

### Setup
```bash
DEPT_ENG_ID="engineering-dept-uuid"
EMPLOYEE1_ID="employee-1-uuid" # Member of engineering
EMPLOYEE2_ID="employee-2-uuid" # Member of engineering
EMPLOYEE3_ID="employee-3-uuid" # NOT member of engineering
```

### Steps

1. **Three employees establish SSE connections**
   ```bash
   # Terminal 1: Employee 1
   curl -N -H "Authorization: Bearer ${EMPLOYEE1_TOKEN}" \
        "${BACKEND_URL}/api/notifications/stream"
   
   # Terminal 2: Employee 2
   curl -N -H "Authorization: Bearer ${EMPLOYEE2_TOKEN}" \
        "${BACKEND_URL}/api/notifications/stream"
   
   # Terminal 3: Employee 3
   curl -N -H "Authorization: Bearer ${EMPLOYEE3_TOKEN}" \
        "${BACKEND_URL}/api/notifications/stream"
   ```

2. **Backend service publishes notification to Engineering department**
   ```bash
   curl -X POST "${BACKEND_URL}/api/notifications/publish" \
        -H "Authorization: Bearer ${SERVICE_TOKEN}" \
        -H "Content-Type: application/json" \
        -d '{
          "organization_id": "'${ORG_ID}'",
          "recipients": {
            "department_ids": ["'${DEPT_ENG_ID}'"]
          },
          "source_domain": "projects",
          "notification_type": "task_assigned",
          "title": "New project assigned to Engineering",
          "message": "Project Alpha has been assigned to your department",
          "action_data": {
            "projectId": "project-789"
          },
          "action_category": "assign",
          "priority": 1,
          "publishing_service_id": "project-service"
        }'
   # Expected: 200 OK, recipient_count: 2
   ```

3. **Verify SSE delivery**
   ```bash
   # Terminal 1 (Employee 1 - engineering): Receives notification
   # Terminal 2 (Employee 2 - engineering): Receives notification
   # Terminal 3 (Employee 3 - not engineering): Does NOT receive notification
   ```

4. **Verify connection registry query**
   ```sql
   -- Execute in PostgreSQL
   SELECT instance_id, array_agg(employee_id) 
   FROM notification.active_connection
   WHERE department_ids && ARRAY['${DEPT_ENG_ID}']::uuid[]
     AND organization_id = '${ORG_ID}'
     AND connection_status = 'active'
   GROUP BY instance_id;
   -- Expected: Returns employee1 and employee2, NOT employee3
   ```

### Success Criteria
- [x] Department membership resolved correctly (2 recipients)
- [x] Only department members receive notification via SSE
- [x] Non-members do not receive notification
- [x] Connection registry query uses GIN index efficiently (<10ms)
- [x] target_department_ids stored in notification_recipient for audit trail

---

## Test Scenario 3: Horizontal Scaling with Instance-Level Channels

**Goal**: Verify multi-instance routing works correctly.

### Setup
```bash
# Start 3 backend instances
INSTANCE_A="instance-a"
INSTANCE_B="instance-b"
INSTANCE_C="instance-c"

# Employees distributed across instances (via load balancer)
EMPLOYEE1_CONNECTS_TO="instance-a"
EMPLOYEE2_CONNECTS_TO="instance-b"
EMPLOYEE3_CONNECTS_TO="instance-a"
```

### Steps

1. **Employees connect to different instances**
   ```bash
   # Employee 1 connects to instance A
   curl -N -H "Authorization: Bearer ${EMPLOYEE1_TOKEN}" \
        "http://instance-a:8080/api/notifications/stream"
   
   # Employee 2 connects to instance B
   curl -N -H "Authorization: Bearer ${EMPLOYEE2_TOKEN}" \
        "http://instance-b:8080/api/notifications/stream"
   
   # Employee 3 connects to instance A
   curl -N -H "Authorization: Bearer ${EMPLOYEE3_TOKEN}" \
        "http://instance-a:8080/api/notifications/stream"
   ```

2. **Verify connection registry state**
   ```sql
   SELECT instance_id, COUNT(*) AS connection_count
   FROM notification.active_connection
   WHERE organization_id = '${ORG_ID}'
     AND connection_status = 'active'
   GROUP BY instance_id;
   -- Expected: instance-a: 2, instance-b: 1, instance-c: 0
   ```

3. **Backend service publishes notification to all 3 employees**
   ```bash
   curl -X POST "http://instance-c:8080/api/notifications/publish" \
        -H "Authorization: Bearer ${SERVICE_TOKEN}" \
        -H "Content-Type: application/json" \
        -d '{
          "organization_id": "'${ORG_ID}'",
          "recipients": {
            "employee_ids": ["'${EMPLOYEE1_ID}'", "'${EMPLOYEE2_ID}'", "'${EMPLOYEE3_ID}'"]
          },
          "source_domain": "system",
          "notification_type": "announcement",
          "title": "System maintenance scheduled",
          "message": "Scheduled maintenance on Sunday at 2 AM",
          "priority": 0,
          "publishing_service_id": "system-service"
        }'
   # Expected: 200 OK, recipient_count: 3
   ```

4. **Verify NOTIFY routing**
   ```bash
   # Backend logs should show:
   # Instance C: Publishing to channels: ["instance_a_notifications", "instance_b_notifications"]
   # Instance A: Received NOTIFY on "instance_a_notifications", routing to 2 connected users
   # Instance B: Received NOTIFY on "instance_b_notifications", routing to 1 connected user
   # Instance C: No NOTIFY received (no users connected)
   ```

5. **Verify all employees receive notification**
   ```bash
   # All 3 SSE connections should receive notification event
   # Employee 1 (instance A): Receives notification
   # Employee 2 (instance B): Receives notification
   # Employee 3 (instance A): Receives notification
   ```

### Success Criteria
- [x] Connection registry correctly tracks which instance each user is on
- [x] Publishing logic queries registry and finds target instances
- [x] Only 2 NOTIFY calls sent (instance-a, instance-b), NOT 3 employees = 3 NOTIFY
- [x] Instance C (publisher) does not receive NOTIFY (no connected users)
- [x] Each instance delivers only to its connected users (in-memory filtering)
- [x] All 3 employees receive notification despite being on different instances

---

## Test Scenario 4: Deduplication with Action Categories

**Goal**: Verify LRU cache deduplication prevents notification spam.

### Setup
```bash
USER_ALICE_ID="alice-uuid"
COMMENT_ID="comment-123"
```

### Steps

1. **Employee establishes SSE connection**
   ```bash
   curl -N -H "Authorization: Bearer ${EMPLOYEE1_TOKEN}" \
        "${BACKEND_URL}/api/notifications/stream"
   ```

2. **Alice rapidly likes and unlikes a comment 5 times (10 events)**
   ```bash
   # Simulate 10 rapid events within 5 seconds
   for i in {1..5}; do
     # Like event
     curl -X POST "${BACKEND_URL}/api/notifications/publish" \
          -H "Authorization: Bearer ${SERVICE_TOKEN}" \
          -H "Content-Type: application/json" \
          -d '{
            "organization_id": "'${ORG_ID}'",
            "recipients": {"employee_ids": ["'${EMPLOYEE1_ID}'"]},
            "source_domain": "crm",
            "notification_type": "react",
            "title": "Alice liked your comment",
            "message": "Alice reacted to your comment",
            "action_data": {"commentId": "'${COMMENT_ID}'"},
            "action_category": "react",
            "priority": 2,
            "publishing_service_id": "crm-service"
          }'
     
     # Unlike event (same action_category)
     curl -X POST "${BACKEND_URL}/api/notifications/publish" \
          -H "Authorization: Bearer ${SERVICE_TOKEN}" \
          -H "Content-Type: application/json" \
          -d '{
            "organization_id": "'${ORG_ID}'",
            "recipients": {"employee_ids": ["'${EMPLOYEE1_ID}'"]},
            "source_domain": "crm",
            "notification_type": "react",
            "title": "Alice unliked your comment",
            "message": "Alice unreacted to your comment",
            "action_data": {"commentId": "'${COMMENT_ID}'"},
            "action_category": "react",
            "priority": 2,
            "publishing_service_id": "crm-service"
          }'
     
     sleep 0.5
   done
   ```

3. **Verify deduplication**
   ```bash
   # Check SSE connection: Should receive 1-2 notifications, NOT 10
   # Check database:
   SELECT COUNT(*) FROM notification.notification_recipient
   WHERE employee_id = '${EMPLOYEE1_ID}'
     AND updated_at > now() - INTERVAL '1 minute';
   -- Expected: 1-2 rows, NOT 10 (deduplicated by action_category + source_user)
   ```

4. **Verify LRU cache stats**
   ```bash
   # Backend metrics endpoint
   curl "${BACKEND_URL}/metrics" | grep notification_dedup_cache
   # Expected: cache hits > 8, cache misses ~ 1-2
   ```

### Success Criteria
- [x] 10 rapid events with same action_category deduplicated to 1-2 notifications
- [x] LRU cache prevents spam
- [x] Employee does not receive 10 SSE events
- [x] Deduplication key: employee_id + action_category + source_user_id

---

## Test Scenario 5: Priority-Based Delivery

**Goal**: Verify priority levels control delivery behavior.

### Setup
```bash
EMPLOYEE1_STATUS="online" # SSE connected
EMPLOYEE2_STATUS="offline" # No SSE connection
```

### Steps

1. **Employee 1 online, Employee 2 offline**
   ```bash
   # Employee 1 establishes SSE
   curl -N -H "Authorization: Bearer ${EMPLOYEE1_TOKEN}" \
        "${BACKEND_URL}/api/notifications/stream"
   
   # Employee 2: No connection
   ```

2. **Publish priority 0 (always deliver, even if offline)**
   ```bash
   curl -X POST "${BACKEND_URL}/api/notifications/publish" \
        -H "Authorization: Bearer ${SERVICE_TOKEN}" \
        -H "Content-Type: application/json" \
        -d '{
          "organization_id": "'${ORG_ID}'",
          "recipients": {"employee_ids": ["'${EMPLOYEE1_ID}'", "'${EMPLOYEE2_ID}'"]},
          "source_domain": "system",
          "notification_type": "critical_alert",
          "title": "Critical system alert",
          "message": "Database backup failed",
          "priority": 0,
          "publishing_service_id": "system-service"
        }'
   # Expected: Both receive notification in database
   # Employee 1: Delivered via SSE immediately
   # Employee 2: Stored, will trigger fallback (email/push) after 5 minutes
   ```

3. **Publish priority 2 (online only)**
   ```bash
   curl -X POST "${BACKEND_URL}/api/notifications/publish" \
        -H "Authorization: Bearer ${SERVICE_TOKEN}" \
        -H "Content-Type: application/json" \
        -d '{
          "organization_id": "'${ORG_ID}'",
          "recipients": {"employee_ids": ["'${EMPLOYEE1_ID}'", "'${EMPLOYEE2_ID}'"]},
          "source_domain": "chat",
          "notification_type": "typing_indicator",
          "title": "Alice is typing",
          "message": "Alice is typing in #general",
          "priority": 2,
          "publishing_service_id": "chat-service"
        }'
   # Expected: 
   # Employee 1: Delivered via SSE
   # Employee 2: NOT stored in database (priority 2 = online only)
   ```

4. **Publish priority 4 (silent, no delivery)**
   ```bash
   curl -X POST "${BACKEND_URL}/api/notifications/publish" \
        -H "Authorization: Bearer ${SERVICE_TOKEN}" \
        -H "Content-Type: application/json" \
        -d '{
          "organization_id": "'${ORG_ID}'",
          "recipients": {"employee_ids": ["'${EMPLOYEE1_ID}'"]},
          "source_domain": "system",
          "notification_type": "audit_log",
          "title": "Audit log entry",
          "message": "User action logged",
          "priority": 4,
          "publishing_service_id": "system-service"
        }'
   # Expected: Stored in database, NOT delivered via SSE, no fallback
   ```

### Success Criteria
- [x] Priority 0: Delivered to both online and offline users, triggers fallback for offline
- [x] Priority 1 (default): Delivered to online, stored for offline (no immediate fallback)
- [x] Priority 2: Delivered to online only, NOT stored for offline
- [x] Priority 4: Stored but never delivered (silent logging)

---

## Test Scenario 6: Bulk Mark As Read

**Goal**: Verify bulk operations for marking notifications as read.

### Setup
```bash
# Employee has 1000 unread notifications accumulated
```

### Steps

1. **Create 1000 notifications** (simulate old notifications)
   ```bash
   # Use batch API or loop (for testing)
   curl -X POST "${BACKEND_URL}/api/notifications/publish-batch" \
        -H "Authorization: Bearer ${SERVICE_TOKEN}" \
        -H "Content-Type: application/json" \
        -d '{
          "organization_id": "'${ORG_ID}'",
          "notifications": [/* 1000 notification objects */],
          "batch_key": "test-bulk-notifications"
        }'
   ```

2. **Verify unread count**
   ```bash
   curl -H "Authorization: Bearer ${EMPLOYEE1_TOKEN}" \
        "${BACKEND_URL}/api/notifications/unread-count"
   # Expected: unread_count: 1000
   ```

3. **Mark all before timestamp as read**
   ```bash
   TIMESTAMP=$(date -u -d "1 hour ago" +"%Y-%m-%dT%H:%M:%SZ")
   curl -X POST "${BACKEND_URL}/api/notifications/mark-all-before-timestamp-read" \
        -H "Authorization: Bearer ${EMPLOYEE1_TOKEN}" \
        -H "Content-Type: application/json" \
        -d '{"before_timestamp": "'${TIMESTAMP}'"}'
   # Expected: 200 OK, updated_count: 1000
   ```

4. **Verify unread count**
   ```bash
   curl -H "Authorization: Bearer ${EMPLOYEE1_TOKEN}" \
        "${BACKEND_URL}/api/notifications/unread-count"
   # Expected: unread_count: 0
   ```

5. **Verify database state**
   ```sql
   SELECT COUNT(*) FROM notification.notification_recipient
   WHERE employee_id = '${EMPLOYEE1_ID}'
     AND read_status = true
     AND read_at IS NOT NULL;
   -- Expected: 1000
   ```

### Success Criteria
- [x] Bulk mark as read operation completes in <2 seconds for 1000 notifications
- [x] All notifications marked with read_status = true and read_at timestamp
- [x] Unread count reflects correct state after bulk operation

---

## Test Scenario 7: Connection Registry Cleanup

**Goal**: Verify stale connection cleanup works correctly.

### Setup
```bash
# Simulate connection heartbeat failure
```

### Steps

1. **Employee establishes SSE connection**
   ```bash
   curl -N -H "Authorization: Bearer ${EMPLOYEE1_TOKEN}" \
        "${BACKEND_URL}/api/notifications/stream"
   # Connection established, heartbeat starts every 30s
   ```

2. **Verify connection in registry**
   ```sql
   SELECT * FROM notification.active_connection
   WHERE employee_id = '${EMPLOYEE1_ID}'
     AND connection_status = 'active';
   -- Expected: 1 row with recent last_heartbeat
   ```

3. **Simulate heartbeat failure** (kill SSE connection without cleanup)
   ```bash
   # Force kill curl process (simulate network failure)
   killall -9 curl
   ```

4. **Wait 90 seconds** (heartbeat timeout + cleanup grace period)
   ```bash
   sleep 90
   ```

5. **Run cleanup job**
   ```bash
   curl -X POST "${BACKEND_URL}/internal/notifications/cleanup-stale-connections" \
        -H "Authorization: Bearer ${SERVICE_TOKEN}"
   # Expected: Cleanup job marks connection as stale, then deletes
   ```

6. **Verify connection removed**
   ```sql
   SELECT * FROM notification.active_connection
   WHERE employee_id = '${EMPLOYEE1_ID}';
   -- Expected: 0 rows (connection cleaned up)
   ```

7. **Verify notifications still stored**
   ```sql
   SELECT COUNT(*) FROM notification.notification_recipient
   WHERE employee_id = '${EMPLOYEE1_ID}';
   -- Expected: Previous count unchanged (cleanup doesn't affect notifications)
   ```

### Success Criteria
- [x] Heartbeat updates every 30 seconds while connection active
- [x] Connections with last_heartbeat > 60s old marked as stale
- [x] Stale connections removed after 5 minutes
- [x] Cleanup job runs periodically (every 5 minutes)
- [x] UNLOGGED table allows fast cleanup without WAL overhead

---

## Test Scenario 8: Multi-Device Support

**Goal**: Verify same employee can have multiple SSE connections (desktop + mobile).

### Setup
```bash
# Employee 1 has 2 devices
```

### Steps

1. **Establish 2 SSE connections for same employee**
   ```bash
   # Terminal 1: Desktop browser
   curl -N -H "Authorization: Bearer ${EMPLOYEE1_TOKEN}" \
        -H "User-Agent: Desktop-Chrome" \
        "${BACKEND_URL}/api/notifications/stream"
   
   # Terminal 2: Mobile app
   curl -N -H "Authorization: Bearer ${EMPLOYEE1_TOKEN}" \
        -H "User-Agent: Mobile-iOS" \
        "${BACKEND_URL}/api/notifications/stream"
   ```

2. **Verify connection registry**
   ```sql
   SELECT employee_id, instance_id, connection_id, user_agent
   FROM notification.active_connection
   WHERE employee_id = '${EMPLOYEE1_ID}'
     AND connection_status = 'active';
   -- Expected: 2 rows (different connection_id, same employee_id)
   ```

3. **Publish notification to employee**
   ```bash
   curl -X POST "${BACKEND_URL}/api/notifications/publish" \
        -H "Authorization: Bearer ${SERVICE_TOKEN}" \
        -H "Content-Type: application/json" \
        -d '{
          "organization_id": "'${ORG_ID}'",
          "recipients": {"employee_ids": ["'${EMPLOYEE1_ID}'"]},
          "source_domain": "chat",
          "notification_type": "message",
          "title": "New message",
          "message": "Alice sent you a message",
          "priority": 1,
          "publishing_service_id": "chat-service"
        }'
   ```

4. **Verify both connections receive notification**
   ```bash
   # Terminal 1 (Desktop): Receives notification event
   # Terminal 2 (Mobile): Receives notification event
   ```

5. **Mark as read on desktop**
   ```bash
   curl -X POST "${BACKEND_URL}/api/notifications/mark-read" \
        -H "Authorization: Bearer ${EMPLOYEE1_TOKEN}" \
        -H "Content-Type: application/json" \
        -d '{"notification_recipient_ids": ["'${RECIPIENT_ID}'"]}'
   ```

6. **Verify read status synced across devices**
   ```bash
   # Both SSE connections should receive "notification_read" event
   # Mobile app shows notification as read (synced state)
   ```

### Success Criteria
- [x] Same employee can have multiple active SSE connections
- [x] Connection registry tracks each connection separately (different connection_id)
- [x] Publisher finds all instances with user connections
- [x] Notification delivered to all connections (all devices)
- [x] Read status changes synced across all connections

---

## Performance Benchmarks

### Registry Query Performance
```sql
-- Individual employee lookup
EXPLAIN ANALYZE
SELECT instance_id FROM notification.active_connection
WHERE employee_id = '${EMPLOYEE1_ID}'
  AND connection_status = 'active';
-- Target: <5ms with index

-- Department-based lookup with GIN index
EXPLAIN ANALYZE
SELECT instance_id, array_agg(employee_id)
FROM notification.active_connection
WHERE department_ids && ARRAY['${DEPT_ENG_ID}']::uuid[]
  AND organization_id = '${ORG_ID}'
  AND connection_status = 'active'
GROUP BY instance_id;
-- Target: <10ms with GIN index on department_ids
```

### SSE Delivery Latency
```bash
# Measure time from NOTIFY to SSE delivery
# Target: <60 seconds (SLA), typical: <5ms
```

### Bulk Notification Performance
```bash
# Publish 1000 notifications in batch
# Target: <2 seconds for storage + routing
```

---

## Success Criteria Summary

✅ **Publishing**: Backend services can publish notifications (ROLE_SYSTEM enforced)  
✅ **Real-Time Delivery**: SSE delivers within 60 seconds SLA  
✅ **Department Targeting**: GIN index resolves departments in <10ms  
✅ **Horizontal Scaling**: Instance-level routing works correctly  
✅ **Deduplication**: LRU cache prevents notification spam  
✅ **Priority Levels**: 0=always, 1=not offline, 2=online, 4=silent  
✅ **Bulk Operations**: Mark all before timestamp in <2s for 1000 notifications  
✅ **Connection Cleanup**: Stale connections removed within 5 minutes  
✅ **Multi-Device**: Multiple SSE connections per employee supported  
✅ **Tenant Isolation**: All queries filter by organization_id  

---

**Status**: Quickstart scenarios complete. Ready for implementation phase.
