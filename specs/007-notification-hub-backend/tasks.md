# Tasks: Notification Hub Backend

**Input**: Design documents from `/Users/nvcnvn/Codes/tech-office/specs/007-notification-hub-backend/`
**Prerequisites**: plan.md (required), research.md, data-model.md, contracts/

## Execution Summary

This feature implements a centralized notification hub with real-time SSE delivery, horizontal scaling via PostgreSQL LISTEN/NOTIFY, and instance-level routing. Implementation follows Tech Office constitution v3.3.0+ requirements: schema-first design, multi-tenant isolation, AdminPool/TenantPool separation, post-verification testing, and transaction safety.

**Key Components**:
- New `notification` schema with 4 tables (notification, notification_recipient, active_connection UNLOGGED, notification_batch)
- NotificationService with 7 RPC methods (2 backend-only publishing, 5 employee-facing)
- SSE streaming with connection registry and PostgreSQL LISTEN/NOTIFY
- Department-based targeting with denormalized membership
- Deduplication via LRU cache with action category grouping

**Technical Approach**:
- Instance-level channels (`instance_{id}_notifications`) to avoid 10k+ channels per instance
- Connection registry (UNLOGGED) tracking user → instance mapping for targeted NOTIFY
- Denormalized department_ids[] in registry for single-query department → users → instances resolution
- TenantPool for employee operations, AdminPool for backend publishing (justified: system-scope cross-tenant)

## Format: `[ID] [P?] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- Include exact file paths in descriptions

## Phase 3.1: Setup & Schema

### Database Schema Setup
- [x] T001 Add `notification` schema to `backend/database/scripts/schema.sql`:
  - Create schema: `CREATE SCHEMA IF NOT EXISTS notification;`
  - Add `notification` table (id, organization_id, source_domain, notification_type, title, message, action_data JSONB, action_category, priority, publishing_service_id, updated_at)
  - Add `notification_recipient` table (id, notification_id FK, employee_id FK, organization_id FK, read_status, read_at, delivery_status, delivered_at, delivery_attempts, last_delivery_error, recipient_type, target_department_ids UUID[], updated_at)
  - Add `active_connection` UNLOGGED table (employee_id, instance_id, connection_id, organization_id, department_ids UUID[], connected_at, last_heartbeat, connection_status, user_agent, ip_address; PRIMARY KEY (employee_id, connection_id))
  - Add `notification_batch` table (id, organization_id, batch_key, notification_ids UUID[], target_employee_ids UUID[], processing_status, publishing_service_id, updated_at)
  - Include all indexes per data-model.md (organization_id, GIN for department_ids, delivery_status, read_status, heartbeat)
  - Add COMMENT statements documenting UNLOGGED rationale, department denormalization, priority levels

- [x] T002 Copy sqlc queries from `specs/007-notification-hub-backend/contracts/notification.query.sql` to `backend/database/scripts/notification.query.sql`:
  - Publishing queries: CreateNotification, CreateNotificationRecipient, CreateNotificationRecipientsBatch, CreateNotificationBatch
  - Employee queries: ListNotificationsByEmployee, CountNotificationsByEmployee, GetUnreadCountByEmployee, GetUnreadCountBySourceDomain
  - Mark as read: MarkNotificationAsRead, MarkNotificationsAsReadBatch, MarkAllBeforeTimestampAsRead
  - Delete: DeleteNotificationRecipient
  - Registry: InsertActiveConnection, UpdateConnectionHeartbeat, RemoveActiveConnection, GetActiveConnectionsByEmployeeIDs, GetActiveConnectionsByDepartmentIDs, CleanupStaleConnections

- [x] T003 Generate database models: `cd backend && sqlc generate`
  - Commit generated files: `backend/database/models.go`, `backend/database/notification.query.sql.go`
  - This task BLOCKS all service implementation tasks (T008-T025)

### RPC Service Definition
- [x] T004 Copy proto definition from `specs/007-notification-hub-backend/contracts/notification.proto` to `backend/rpc/v1/notification.proto`:
  - NotificationService with 7 methods: PublishNotification (ROLE_SYSTEM), PublishBatchNotification (ROLE_SYSTEM), ListNotifications, MarkAsRead, MarkAllBeforeTimestampAsRead, DeleteNotification, StreamNotifications (streaming response), GetUnreadCount
  - Request/response messages with access_control annotations
  - NotificationRecipients message supporting employee_ids and department_ids
  - NotificationSummary, NotificationEvent messages

- [x] T005 Generate proto code: `cd backend && buf generate`
  - Commit generated files: `backend/rpc/v1/notification.pb.go`, `backend/rpc/v1/rpcv1connect/notification.connect.go`
  - This task BLOCKS all service implementation tasks (T008-T025)

## Phase 3.2: Core Implementation

### Backend Service Structure (Constitution v3.3.0 Requirements)
- [x] T006 Create service struct in `backend/internal/notification/notification.go`:
  - Struct fields:
    - `rpcv1connect.UnimplementedNotificationServiceHandler` (embedded)
    - `AdminPool database.AdminDatabaseConnector` (for backend publishing - system scope justified: cross-tenant notification creation)
    - `TenantPool database.TenantDatabaseConnector` (for employee operations - tenant-aware)
    - `Queries *database.Queries` (sqlc-generated methods)
    - `InstanceID string` (backend instance identifier for LISTEN/NOTIFY channels)
    - `ListenConn *pgx.Conn` (dedicated connection for PostgreSQL LISTEN)
  - Constructor: `NewNotificationService(adminPool, tenantPool, queries, instanceID string) (*NotificationService, error)`
  - Document pool selection: AdminPool for PublishNotification (backend services creating notifications across orgs), TenantPool for all employee-facing methods (scoped to auth token organization_id)

- [x] T007 Implement publishing methods in `backend/internal/notification/publisher.go`:
  - `PublishNotification(ctx, req *connect.Request[v1.PublishNotificationRequest]) (*connect.Response[v1.PublishNotificationResponse], error)`:
    - Validate ROLE_SYSTEM from auth context
    - Use AdminPool (cross-tenant system operation)
    - Decompose into private methods:
      - `validatePublishRequest(req)` - check required fields
      - `resolveRecipients(ctx, tx, organizationID, recipients)` - resolve employee_ids and department_ids to final employee list
      - `createNotificationWithRecipients(ctx, tx, req, employeeIDs)` - create notification + recipient rows using sqlc queries
      - `publishToInstances(ctx, tx, employeeIDs, notificationID, priority)` - query active_connection registry, group by instance_id, NOTIFY each instance channel
    - Use `txn.WithTxn(ctx, s.AdminPool, func(ctx, tx) error {...})` for atomicity
    - Return notification_id, recipient_count, recipient_employee_ids
  - `PublishBatchNotification(ctx, req)` - similar structure but loop through batch and use CreateNotificationRecipientsBatch
  - Private helper: `queryInstancesForEmployees(ctx, tx, employeeIDs, organizationID) (map[string][]dbuuid.UUID, error)` - returns instance_id → employee_ids mapping from active_connection table

- [x] T008 Implement connection registry operations in `backend/internal/notification/registry.go`:
  - `registerConnection(ctx, employeeID dbuuid.UUID, connectionID dbuuid.UUID, orgID dbuuid.UUID, userAgent, ipAddress string) error`:
    - Query employee's department membership from `organization.department_member` table
    - Call `s.Queries.InsertActiveConnection(ctx, s.AdminPool, ...)` with denormalized department_ids array
    - Use AdminPool (writes to registry are system-scope, not tenant-specific queries)
  - `unregisterConnection(ctx, employeeID, connectionID) error` - calls RemoveActiveConnection
  - `updateHeartbeat(ctx, employeeID, connectionID) error` - calls UpdateConnectionHeartbeat
  - Background cleanup goroutine: `startCleanupWorker()` - runs CleanupStaleConnections every 5 minutes (delete entries with last_heartbeat > 2 minutes old)

- [x] T009 Implement SSE streaming in `backend/internal/notification/sse.go`:
  - `StreamNotifications(ctx, req *connect.Request[v1.StreamNotificationsRequest], stream *connect.ServerStream[v1.NotificationEvent]) error`:
    - Validate auth context (ROLE_EMPLOYEE+)
    - Extract employeeID and organizationID from auth token
    - Use TenantPool for employee-facing operations
    - Decompose into private methods:
      - `validateStreamRequest(ctx, req)` - auth validation
      - `setupConnection(ctx, employeeID, orgID) (connectionID dbuuid.UUID, cleanup func(), error)` - register in registry, return cleanup function
      - `sendMissedNotifications(ctx, stream, employeeID, orgID, lastEventID)` - query undelivered notifications since lastEventID, send via stream
      - `listenForNewNotifications(ctx, stream, connectionID)` - subscribe to PostgreSQL LISTEN channel `instance_{s.InstanceID}_notifications`, forward payloads to SSE stream
    - Defer cleanup (unregister connection, close listener)
    - Heartbeat ticker (30 seconds): send keep-alive event, call updateHeartbeat
    - Handle context cancellation gracefully

- [x] T010 Implement PostgreSQL LISTEN/NOTIFY setup in `backend/internal/notification/listener.go`:
  - `initListener(ctx context.Context) error`:
    - Create dedicated connection: `s.ListenConn = s.AdminPool.Acquire(ctx)` (or direct pgx.Connect)
    - Execute: `LISTEN instance_{s.InstanceID}_notifications`
    - Store connection in service struct
    - Start background goroutine to consume notifications and route to active SSE connections
  - `notifyInstances(ctx, tx database.DBTX, instanceEmployeeMap map[string][]dbuuid.UUID, notificationID dbuuid.UUID, priority int) error`:
    - For each instance_id in map:
      - Build payload: `{"notification_id":"...","employee_ids":["..."],"priority":1}`
      - Execute: `NOTIFY instance_{instance_id}_notifications, '{payload}'`
    - Execute within transaction context (NOTIFY sent after COMMIT)

- [x] T011 Implement deduplication cache in `backend/internal/notification/deduplication.go`:
  - Use `github.com/hashicorp/golang-lru` package for LRU cache
  - Cache key: `{organization_id}:{action_category}:{source_user_id}:{resource_id}`
  - Cache value: `{notification_id, timestamp}`
  - `checkDuplicate(ctx, orgID, actionCategory, sourceUser, resource string) (bool, dbuuid.UUID)` - returns (isDuplicate, existingNotificationID)
  - `recordNotification(ctx, orgID, actionCategory, sourceUser, resource string, notificationID dbuuid.UUID)` - adds to cache
  - TTL: 5 minutes (sufficient for react/comment deduplication)

### Employee-Facing Methods (TenantPool)
- [x] T012 Implement `ListNotifications` in `backend/internal/notification/notification.go`:
  - Validate auth context (ROLE_EMPLOYEE+), extract employeeID and organizationID
  - Use TenantPool (tenant-aware employee operation)
  - Call `s.Queries.ListNotificationsByEmployee(ctx, s.TenantPool, ...)` with pagination
  - Call `s.Queries.CountNotificationsByEmployee(ctx, s.TenantPool, ...)` for total count
  - Convert sqlc results to proto NotificationSummary
  - Generate next_page_token using cursor-based pagination (last notification updated_at)
  - Return ListNotificationsResponse with notifications, next_page_token, total_unread_count

- [x] T013 Implement `MarkAsRead` in `backend/internal/notification/notification.go`:
  - Validate auth context, extract employeeID and organizationID
  - Use TenantPool
  - Call `s.Queries.MarkNotificationsAsReadBatch(ctx, s.TenantPool, recipientIDs, employeeID, organizationID)`
  - Verify organization_id ownership of recipient_ids (sqlc query WHERE includes organization_id filter)
  - Return updated_count

- [x] T014 Implement `MarkAllBeforeTimestampAsRead` in `backend/internal/notification/notification.go`:
  - Validate auth, extract employeeID and organizationID
  - Use TenantPool
  - Call `s.Queries.MarkAllBeforeTimestampAsRead(ctx, s.TenantPool, employeeID, organizationID, timestamp)`
  - Return updated_count

- [x] T015 Implement `DeleteNotification` in `backend/internal/notification/notification.go`:
  - Validate auth, extract employeeID and organizationID
  - Use TenantPool
  - Call `s.Queries.DeleteNotificationRecipient(ctx, s.TenantPool, recipientID, employeeID, organizationID)`
  - Return DeleteNotificationResponse

- [x] T016 Implement `GetUnreadCount` in `backend/internal/notification/notification.go`:
  - Validate auth, extract employeeID and organizationID
  - Use TenantPool
  - Call `s.Queries.GetUnreadCountByEmployee(ctx, s.TenantPool, employeeID, organizationID)`
  - Optionally call `s.Queries.GetUnreadCountBySourceDomain(ctx, s.TenantPool, ...)` for breakdown
  - Return GetUnreadCountResponse with unread_count

### Delivery Tracking & Fallback
- [x] T017 Implement delivery tracking in `backend/internal/notification/delivery.go`:
  - `trackDelivery(ctx, recipientID dbuuid.UUID, deliveryStatus string, error string) error`:
    - Update notification_recipient: `UPDATE notification_recipient SET delivery_status = $1, delivered_at = now(), delivery_attempts = delivery_attempts + 1, last_delivery_error = $2 WHERE id = $3`
    - Use AdminPool (system operation tracking delivery across tenants)
  - `retryFailedDeliveries(ctx)` - background job querying pending deliveries > 5 minutes old, retry or trigger fallback (push notification, email)
  - Fallback integration placeholder: document integration points for push/email services

## Phase 3.3: Integration

- [x] T018 Register NotificationService in `backend/cmd/server.go`:
  - Import `github.com/nvcnvn/tech-office/backend/internal/notification`
  - Initialize service: `notificationService, err := notification.NewNotificationService(adminPool, tenantPool, queries, instanceID)`
  - Call `notificationService.initListener(ctx)` to start PostgreSQL LISTEN
  - Register with Connect mux: `mux.Handle(rpcv1connect.NewNotificationServiceHandler(notificationService))`

- [x] T019 Add structured logging to all service methods:
  - Log publishing events: `log.Info("notification_published", "notification_id", id, "organization_id", orgID, "recipient_count", count, "source_domain", domain)`
  - Log SSE connections: `log.Info("sse_connection_established", "employee_id", empID, "connection_id", connID, "instance_id", instanceID)`
  - Log registry operations: `log.Debug("connection_registered", "employee_id", empID, "department_ids", deptIDs)`
  - Log NOTIFY operations: `log.Debug("notify_sent", "instance_id", instanceID, "employee_count", len(employees), "notification_id", id)`
  - Log errors with context: `log.Error("sse_stream_error", "error", err, "employee_id", empID, "connection_id", connID)`

- [ ] T020 Add metrics collection:
  - Counter: `notification_published_total{organization_id, source_domain}`
  - Counter: `notification_delivered_total{organization_id, delivery_status}`
  - Gauge: `active_sse_connections{instance_id}`
  - Histogram: `notification_delivery_latency_seconds{priority}` (time from publish to delivery)
  - Histogram: `registry_query_latency_seconds` (GetActiveConnectionsByEmployeeIDs duration)
  - Histogram: `notify_latency_seconds` (NOTIFY execution time)
  - NOTE: Metrics collection deferred - logging in place provides observability for MVP

- [x] T021 Add database migration script (optional - schema already in schema.sql):
  - Schema already added to schema.sql in T001
  - Migration not needed since schema is committed directly

## Phase 3.4: Manual Verification ⚠️ REQUIRED BEFORE TESTS

**Human developer MUST verify behavior is correct before adding tests**

- [ ] T022 Manual test: Backend service publishes individual notification
  - Follow quickstart.md Test Scenario 1
  - Verify notification created in database
  - Verify connection registered in active_connection
  - Verify SSE delivery within 60 seconds
  - Verify ListNotifications returns notification
  - Verify MarkAsRead updates read_status
  - Verify GetUnreadCount reflects state
  - Document: Expected vs actual behavior

- [ ] T023 Manual test: Department-based notification targeting
  - Follow quickstart.md Test Scenario 2
  - Create test departments and assign employees
  - Publish notification to department_ids
  - Verify recipients resolved to all department members
  - Verify non-members do NOT receive notification
  - Verify active_connection.department_ids denormalization works
  - Document: Resolution logic correctness

- [ ] T024 Manual test: Multi-tenant isolation
  - Create two organizations with employees
  - Publish notification to org1 employee
  - Verify org2 employee does NOT see notification via ListNotifications
  - Verify active_connection registry queries filter by organization_id
  - Attempt cross-org MarkAsRead (should fail ownership check)
  - Document: All queries include organization_id filters

- [ ] T025 Manual test: Horizontal scaling with multiple instances
  - Start 2+ backend instances with different instance_ids
  - Connect employees to different instances (check active_connection.instance_id)
  - Publish notification to employees spread across instances
  - Verify NOTIFY sent only to relevant instance channels (not broadcast)
  - Verify each instance delivers to its connected employees
  - Document: Instance-level routing works correctly

- [ ] T026 Manual test: SSE connection lifecycle
  - Establish SSE connection
  - Verify connection registered (query active_connection table)
  - Wait 30+ seconds, verify heartbeat updates
  - Disconnect client, verify connection removed from registry
  - Reconnect, verify missed notifications delivered
  - Document: Lifecycle state transitions

- [ ] T027 Manual test: Priority-based delivery
  - Test priority 0 (always deliver): offline employee, verify notification stored
  - Test priority 1 (default): online employee, verify SSE delivery
  - Test priority 2 (online only): offline employee, verify no delivery attempt
  - Test priority 4 (silent): verify no SSE delivery but stored in DB
  - Document: Priority handling logic

- [ ] T028 Manual test: Deduplication
  - Publish 3 "react:like" notifications rapidly (same action_category, user, resource)
  - Verify only 1 notification created (or updates existing)
  - Publish "react:unlike" (same category "react") - verify deduplication
  - Publish "comment" (different category) - verify separate notification
  - Document: Cache key logic and TTL behavior

- [ ] T029 Manual test: Transaction rollback
  - Simulate failure after CreateNotification but before CreateNotificationRecipient
  - Verify txn.WithTxn rolls back both operations
  - Verify no orphaned notification rows
  - Verify NOTIFY not sent on rollback
  - Document: Atomicity guarantees

- [ ] T030 Manual test: UNLOGGED table behavior
  - Verify active_connection write performance (compare with regular table)
  - Simulate database restart (kill postgres process)
  - Verify active_connection data lost (acceptable - users reconnect)
  - Verify users reconnect and re-register successfully
  - Document: Performance gain vs data loss trade-off

- [ ] T031 Manual test: Stale connection cleanup
  - Establish SSE connection, stop heartbeat (simulate network issue)
  - Wait 5+ minutes for cleanup worker
  - Verify stale connection removed from registry
  - Verify cleanup worker logs
  - Document: Cleanup threshold and frequency

- [ ] T032 Manual test: Batch notification publishing
  - Use PublishBatchNotification with 10 notifications
  - Verify all 10 created with correct recipients
  - Verify batch_id stored in notification_batch table
  - Verify deduplication works across batch
  - Document: Batch processing correctness

- [ ] T033 Verify AdminPool vs TenantPool usage:
  - Review all service methods
  - Confirm PublishNotification uses AdminPool (justified: system-scope cross-tenant)
  - Confirm ListNotifications, MarkAsRead, StreamNotifications use TenantPool
  - Confirm registry operations use appropriate pool
  - Document: Pool selection rationale in code comments

- [ ] T034 Run all quickstart.md scenarios:
  - Execute Test Scenario 1: Individual notification
  - Execute Test Scenario 2: Department targeting
  - Execute Test Scenario 3 (if exists): Additional edge cases
  - Verify all success criteria met
  - Document: Quickstart validation results

## Phase 3.5: Tests (After Verification)

**Add tests ONLY after T022-T034 confirm correct behavior**

### Contract Tests
- [ ] T035 [P] Contract test `PublishNotification` in `backend/internal/notification/notification_test.go`:
  - Mock AdminPool and Queries
  - Test: Valid request with employee_ids → notification created, recipients resolved, NOTIFY sent
  - Test: Valid request with department_ids → department members resolved, notification created
  - Test: Invalid request (missing required fields) → error returned
  - Test: ROLE_SYSTEM authorization check → unauthorized without ROLE_SYSTEM
  - Assert: sqlc queries called with correct parameters
  - Assert: txn.WithTxn used for transaction

- [ ] T036 [P] Contract test `StreamNotifications` in `backend/internal/notification/sse_test.go`:
  - Mock TenantPool, Queries, and LISTEN connection
  - Test: Valid auth → SSE connection established, connection registered in registry
  - Test: Missed notifications sent on connection
  - Test: New notification arrives via NOTIFY → forwarded to SSE stream
  - Test: Heartbeat updates registry
  - Test: Disconnect → connection removed from registry
  - Assert: Registry operations called correctly
  - Assert: TenantPool used for employee operations

- [ ] T037 [P] Contract test `ListNotifications` in `backend/internal/notification/notification_test.go`:
  - Mock TenantPool and Queries
  - Test: Valid request → calls ListNotificationsByEmployee with correct filters
  - Test: unread_only=true → passes read_status filter
  - Test: source_domains filter → passes to sqlc query
  - Test: Pagination → cursor-based token generation
  - Test: Organization isolation → employee from org1 cannot see org2 notifications
  - Assert: TenantPool used, organization_id validated

- [ ] T038 [P] Contract test `MarkAsRead` in `backend/internal/notification/notification_test.go`:
  - Mock TenantPool and Queries
  - Test: Valid recipient_ids → calls MarkNotificationsAsReadBatch
  - Test: Cross-org attempt → fails ownership check (organization_id mismatch)
  - Test: Already read notification → no-op (sqlc WHERE read_status = false)
  - Assert: updated_count matches affected rows

### Integration Tests
- [ ] T039 [P] Integration test: End-to-end notification flow in `backend/integration/notification_flow_test.go`:
  - Setup: Start backend with real PostgreSQL, create test organization and employees
  - Publish notification via PublishNotification RPC
  - Establish SSE connection via StreamNotifications RPC
  - Verify notification received via SSE within 5 seconds
  - Call ListNotifications, verify notification present
  - Call MarkAsRead, verify read_status updated
  - Call GetUnreadCount, verify count=0
  - Cleanup: Remove test data

- [ ] T040 [P] Integration test: Department targeting in `backend/integration/notification_department_test.go`:
  - Setup: Create test departments (Engineering, Sales) and assign employees
  - Register SSE connections for employees from both departments
  - Publish notification to Engineering department
  - Verify only Engineering members receive notification
  - Verify Sales members do NOT receive notification
  - Verify active_connection.department_ids populated correctly
  - Cleanup: Remove test data

- [ ] T041 [P] Integration test: Multi-tenant isolation in `backend/integration/notification_isolation_test.go`:
  - Setup: Create two organizations (org1, org2) with employees
  - Publish notification to org1 employee
  - Employee from org2 calls ListNotifications → empty result
  - Employee from org2 attempts MarkAsRead on org1 notification → error
  - Verify database queries include organization_id filters
  - Cleanup: Remove test data

- [ ] T042 [P] Integration test: Transaction rollback in `backend/integration/notification_txn_test.go`:
  - Setup: Create test organization and employee
  - Inject failure after CreateNotification (mock Queries.CreateNotificationRecipient to return error)
  - Attempt PublishNotification → should return error
  - Verify notification NOT created in database (rollback)
  - Verify NOTIFY NOT sent (transaction aborted)
  - Verify txn.WithTxn handled rollback correctly

- [ ] T043 [P] Integration test: SSE connection lifecycle in `backend/integration/notification_sse_test.go`:
  - Establish SSE connection
  - Verify connection in active_connection table
  - Publish notification → verify received via SSE
  - Disconnect and immediately reconnect
  - Verify missed notifications delivered on reconnect
  - Simulate stale connection (stop heartbeat) → verify cleanup worker removes entry
  - Cleanup: Close connections

- [ ] T044 [P] Integration test: Horizontal scaling simulation in `backend/integration/notification_scaling_test.go`:
  - Start 2 backend instances with different instance_ids (simulate via separate service structs)
  - Connect employee1 to instance1, employee2 to instance2
  - Verify active_connection shows correct instance_id mapping
  - Publish notification to both employees
  - Verify NOTIFY sent to both instance channels (not broadcast)
  - Verify instance1 delivers to employee1, instance2 to employee2
  - Cleanup: Stop instances, remove test data

### Unit Tests
- [ ] T045 [P] Unit test: Registry operations in `backend/internal/notification/registry_test.go`:
  - Test: registerConnection → InsertActiveConnection called with department_ids
  - Test: unregisterConnection → RemoveActiveConnection called
  - Test: updateHeartbeat → UpdateConnectionHeartbeat called
  - Test: queryInstancesForEmployees → returns instance_id → employee_ids map
  - Mock Queries, assert correct parameters

- [ ] T046 [P] Unit test: Deduplication cache in `backend/internal/notification/deduplication_test.go`:
  - Test: checkDuplicate on empty cache → returns false
  - Test: recordNotification then checkDuplicate → returns true with notification_id
  - Test: Cache key format → `{org}:{category}:{user}:{resource}`
  - Test: TTL expiration (mock time) → cache miss after 5 minutes
  - Test: Action category grouping → "react:like" and "react:unlike" map to "react"

- [ ] T047 [P] Unit test: Recipient resolution in `backend/internal/notification/publisher_test.go`:
  - Test: resolveRecipients with employee_ids → returns employee_ids as-is
  - Test: resolveRecipients with department_ids → queries department_member, returns members
  - Test: Mixed employee_ids and department_ids → combines and deduplicates
  - Mock Queries for department_member queries

- [ ] T048 [P] Unit test: Payload parsing in `backend/internal/notification/listener_test.go`:
  - Test: NOTIFY payload parsing → extracts notification_id, employee_ids, priority
  - Test: Invalid JSON payload → logs error, skips notification
  - Test: Missing required fields → logs warning, skips

## Phase 3.6: Polish

- [ ] T049 Performance benchmark: Notification publishing throughput
  - Benchmark: Publish 1000 notifications/second per organization
  - Measure: Database insert latency, NOTIFY latency, registry query time
  - Target: <10ms p95 for publishing, <5ms p95 for registry query
  - Document: Bottlenecks and optimization opportunities

- [ ] T050 Performance benchmark: SSE connection scalability
  - Benchmark: 10,000 concurrent SSE connections per instance
  - Measure: Memory usage (~50KB per connection = ~500MB), CPU usage
  - Target: <1% CPU for idle connections, <2% CPU for active notification delivery
  - Document: Instance resource limits

- [ ] T051 [P] Update API documentation in `backend/rpc/v1/notification.proto`:
  - Add detailed method comments with examples
  - Document access control rationale (ROLE_SYSTEM for publishing)
  - Document action_data JSONB schema examples for each source_domain
  - Document priority levels with use cases

- [ ] T052 [P] Add feature documentation in `specs/007-notification-hub-backend/README.md`:
  - Architecture overview with diagrams (instance-level routing, connection registry)
  - Developer guide: How to publish notifications from backend services
  - Observability guide: Key metrics, logs, debugging tips
  - Scaling considerations: Partitioning strategy, connection limits
  - Security review: Multi-tenant isolation, AdminPool justification

- [ ] T053 Code cleanup: Remove duplication
  - Review validation logic across methods → extract to shared helper
  - Review auth context extraction → extract to middleware or shared function
  - Review error handling patterns → standardize error responses

- [ ] T054 Final smoke test: Run all quickstart scenarios
  - Execute quickstart.md Test Scenario 1
  - Execute quickstart.md Test Scenario 2
  - Verify all success criteria met
  - Verify logs and metrics collection working
  - Verify no errors in integration test suite
  - Document: Final validation results

## Dependencies

**Phase Order**:
- Phase 3.1 (Setup & Schema) → Phase 3.2 (Core Implementation)
- Phase 3.2 (Core) → Phase 3.3 (Integration)
- Phase 3.3 (Integration) → Phase 3.4 (Manual Verification) ⚠️ REQUIRED GATE
- Phase 3.4 (Verification) → Phase 3.5 (Tests) ⚠️ Tests ONLY after verification
- Phase 3.5 (Tests) → Phase 3.6 (Polish)

**Critical Blockers**:
- T003 (sqlc generate) BLOCKS T006-T016 (all service implementation)
- T005 (buf generate) BLOCKS T006-T016 (all service implementation)
- T006-T017 (service implementation) BLOCK T018-T021 (integration)
- T018-T021 (integration) BLOCK T022-T034 (manual verification)
- T022-T034 (verification) BLOCK T035-T048 (tests) ⚠️ CONSTITUTION REQUIREMENT
- T035-T048 (tests) BLOCK T049-T054 (polish)

**Within-Phase Dependencies**:
- T001 (schema.sql) before T002 (query.sql) before T003 (sqlc generate)
- T004 (notification.proto) before T005 (buf generate)
- T006 (service struct) before T007-T016 (method implementations)
- T007 (publisher) depends on T008 (registry) and T010 (listener)
- T009 (SSE) depends on T008 (registry) and T010 (listener)

## Parallel Execution Examples

**Phase 3.1 Codegen** (cannot parallelize - sequential codegen):
```bash
# T001 → T002 → T003 (schema → queries → generate)
Task: "Add notification schema to backend/database/scripts/schema.sql"
Task: "Copy queries to backend/database/scripts/notification.query.sql"
Task: "Run sqlc generate and commit generated files"

# T004 → T005 (proto → generate)
Task: "Copy notification.proto to backend/rpc/v1/notification.proto"
Task: "Run buf generate and commit generated files"
```

**Phase 3.2 Core Implementation** (after T003 and T005 complete):
```bash
# Launch T006-T011 together (different files):
Task: "Create service struct in internal/notification/notification.go"
Task: "Implement publishing in internal/notification/publisher.go"
Task: "Implement registry in internal/notification/registry.go"
Task: "Implement SSE in internal/notification/sse.go"
Task: "Implement LISTEN/NOTIFY in internal/notification/listener.go"
Task: "Implement deduplication in internal/notification/deduplication.go"

# Launch T012-T017 together (employee-facing methods, different sections of notification.go):
Task: "Implement ListNotifications method"
Task: "Implement MarkAsRead method"
Task: "Implement MarkAllBeforeTimestampAsRead method"
Task: "Implement DeleteNotification method"
Task: "Implement GetUnreadCount method"
Task: "Implement delivery tracking in internal/notification/delivery.go"
```

**Phase 3.3 Integration** (sequential due to dependencies):
```bash
# T018 → T019 → T020 (register → logging → metrics)
Task: "Register NotificationService in backend/cmd/server.go"
Task: "Add structured logging to all service methods"
Task: "Add metrics collection"
```

**Phase 3.4 Manual Verification** (can partially parallelize with multiple developers):
```bash
# T022-T028 can be tested concurrently by different team members
Task: "Manual test: Backend service publishes individual notification"
Task: "Manual test: Department-based targeting"
Task: "Manual test: Multi-tenant isolation"
Task: "Manual test: Horizontal scaling"
Task: "Manual test: SSE connection lifecycle"
Task: "Manual test: Priority-based delivery"
Task: "Manual test: Deduplication"

# T029-T034 (verification tasks, can run in parallel)
Task: "Manual test: Transaction rollback"
Task: "Manual test: UNLOGGED table behavior"
Task: "Manual test: Stale connection cleanup"
Task: "Manual test: Batch notification publishing"
Task: "Verify AdminPool vs TenantPool usage"
Task: "Run all quickstart.md scenarios"
```

**Phase 3.5 Tests** (after verification complete, highly parallel):
```bash
# Contract tests (T035-T038) - different test files:
Task: "Contract test PublishNotification in notification_test.go"
Task: "Contract test StreamNotifications in sse_test.go"
Task: "Contract test ListNotifications in notification_test.go"
Task: "Contract test MarkAsRead in notification_test.go"

# Integration tests (T039-T044) - different test files:
Task: "Integration test: End-to-end flow in notification_flow_test.go"
Task: "Integration test: Department targeting in notification_department_test.go"
Task: "Integration test: Multi-tenant isolation in notification_isolation_test.go"
Task: "Integration test: Transaction rollback in notification_txn_test.go"
Task: "Integration test: SSE connection lifecycle in notification_sse_test.go"
Task: "Integration test: Horizontal scaling in notification_scaling_test.go"

# Unit tests (T045-T048) - different test files:
Task: "Unit test: Registry operations in registry_test.go"
Task: "Unit test: Deduplication cache in deduplication_test.go"
Task: "Unit test: Recipient resolution in publisher_test.go"
Task: "Unit test: Payload parsing in listener_test.go"
```

**Phase 3.6 Polish** (parallel polish tasks):
```bash
# T049-T054 can run in parallel (different concerns):
Task: "Performance benchmark: Publishing throughput"
Task: "Performance benchmark: SSE connection scalability"
Task: "Update API documentation in notification.proto"
Task: "Add feature documentation in README.md"
Task: "Code cleanup: Remove duplication"
Task: "Final smoke test: Run all quickstart scenarios"
```

## Notes

- **[P] tasks** = different files, no dependencies, safe to parallelize
- **Constitution v3.3.0+**: Post-verification testing is MANDATORY - verify behavior manually (T022-T034) before adding tests (T035-T048)
- **Multi-tenant isolation**: All employee-facing queries MUST include organization_id filters, enforced by TenantPool
- **AdminPool justification**: Publishing operations use AdminPool because backend services create notifications across organizations (system-scope, not tenant-specific)
- **Transaction safety**: All multi-statement operations MUST use `txn.WithTxn` helper (T007, T029)
- **UNLOGGED rationale**: active_connection uses UNLOGGED table for 2-3x write performance; data loss on crash is acceptable (users reconnect)
- **Codegen prerequisites**: T003 (sqlc) and T005 (buf) BLOCK all service implementation (T006-T016)
- **Commit strategy**: Commit after each completed task for atomic progress tracking
- **Avoid**: Vague tasks, same-file conflicts (sequential tasks editing notification.go should not be parallelized)

## Generated Artifacts & Codegen Checklist

- [x] T003: `cd backend && sqlc generate` → commit `models.go`, `notification.query.sql.go`
- [x] T005: `cd backend && buf generate` → commit `notification.pb.go`, `notification.connect.go`
- [ ] Frontend RPC update (if UI added later): `cd frontend && pnpm -r build` → commit `packages/rpc/dst/*`
- [ ] Frontend API wrapper (if UI added later): Add methods in `frontend/packages/apis/src/notification.ts`
