# Tasks: Chat Backend System

**Input**: Design documents from `/specs/009-chat-backend/`
**Prerequisites**: plan.md (required), research.md, data-model.md, contracts/

## Execution Flow (main)
```
1. Load plan.md from feature directory ✓
2. Load optional design documents ✓
   → data-model.md: 5 entities (channel, message, channel_membership, reaction, typing_indicator)
   → contracts/: chat.proto (23 RPC endpoints), chat.query.sql (sqlc queries)
   → research.md: Constitution v3.6.0 two-layer architecture, cross-domain integration
3. Generate tasks by category ✓
4. Apply task rules ✓
5. Number tasks sequentially (T001-T058) ✓
6. Generate dependency graph ✓
7. Create parallel execution examples ✓
8. Validate task completeness ✓
9. Return: SUCCESS (tasks ready for execution)
```

## Path Conventions
Tech Office is a web app monorepo:
- **Backend**: `backend/` (Go, sqlc, ConnectRPC)
- **Frontend**: `frontend/` (Next.js, TypeScript, pnpm workspace)
- **Database**: `backend/database/scripts/` (PostgreSQL schema, sqlc queries)
- **Protobuf**: `backend/rpc/v1/` (ConnectRPC contracts)

---

## Phase 3.1: Setup & Schema Foundation

### Database Schema
- [X] **T001** Add chat schema and tables to `backend/database/scripts/schema.sql`
  - Create `chat` schema with 5 tables: channel, message, channel_membership, reaction, typing_indicator
  - Follow data-model.md specifications exactly
  - Include all indexes, constraints, and comments
  - Ensure `organization_id` on all tables with FK to `public.organization(id)`
  - Add CHECK constraints for enum validation and business rules
  - **Files**: `backend/database/scripts/schema.sql`

- [X] **T002** Run sqlc codegen to generate DB models
  - Command: `cd backend && sqlc generate`
  - Verify generated files: `backend/database/models.go`, `backend/database/chat.query.sql.go`
  - Commit generated outputs (required for CI validation)
  - **Files**: `backend/database/models.go`, `backend/database/chat.query.sql.go` (generated)
  - **Dependencies**: Blocks all subsequent tasks (requires DB types)

### sqlc Queries
- [X] **T003** Add chat.query.sql to `backend/database/scripts/chat.query.sql`
  - Copy all queries from contracts/chat.query.sql
  - Verify organization_id filters in all tenant-aware queries
  - Follow sqlc naming conventions (-- name: QueryName :one/:many/:exec)
  - **Files**: `backend/database/scripts/chat.query.sql`

- [X] **T004** Regenerate sqlc to create query methods
  - Command: `cd backend && sqlc generate`
  - Verify generated methods in `backend/database/chat.query.sql.go`
  - Commit generated outputs
  - **Files**: `backend/database/chat.query.sql.go` (generated)
  - **Dependencies**: Requires T003, blocks T008-T012

### Protocol Buffers
- [X] **T005** Add chat.proto to `backend/rpc/v1/chat.proto`
  - Copy from contracts/chat.proto
  - Define ChatService with 23 RPC methods
  - Include all request/response messages, enums (ChannelType, NotificationPreference)
  - Add access_control annotations (ROLE_EMPLOYEE for all methods)
  - **Files**: `backend/rpc/v1/chat.proto`

- [X] **T006** Run buf generate to create Go protobuf code
  - Command: `cd backend && buf generate`
  - Verify generated files: `backend/rpc/v1/chat.pb.go`, `backend/rpc/v1/chatconnect/chat.connect.go`
  - Commit generated outputs
  - **Files**: `backend/rpc/v1/*.pb.go`, `backend/rpc/v1/chatconnect/*.connect.go` (generated)
  - **Dependencies**: Requires T005, blocks T013-T037

### Frontend RPC Client Setup
- [X] **T007** [P] Export chat service from `frontend/packages/rpc/index.ts`
  - Add re-export: `export * from './dst/rpc/v1/chat_connect'`
  - Ensure `dst/` contains generated types from buf
  - **Files**: `frontend/packages/rpc/index.ts`
  - **Dependencies**: Requires T006

- [X] **T008** [P] Build frontend workspace to refresh artifacts
  - Command: `cd frontend && pnpm -r build`
  - Verify `packages/rpc/dst/` contains chat service types
  - Commit workspace build outputs if applicable
  - **Files**: `frontend/packages/rpc/dst/*` (generated)
  - **Dependencies**: Requires T007

- [X] **T009** [P] Create API wrapper in `frontend/packages/apis/src/chat.ts`
  - Follow `frontend/packages/apis/src/organization.ts` pattern
  - Wrap all 23 ChatService RPC methods with type assertions
  - Add JSDoc comments for each method
  - Export from `frontend/packages/apis/index.ts`
  - **Files**: `frontend/packages/apis/src/chat.ts`, `frontend/packages/apis/index.ts`
  - **Dependencies**: Requires T008

---

## Phase 3.2: Core Backend Implementation

### Backend Service Structure (Constitution v3.6.0)

- [X] **T010** Create chat logic layer interface in `backend/internal/chat/logic.go`
  - Define `ChatLogic` interface with methods for all business operations
  - All methods accept `ctx context.Context, tx database.DBTX` as first parameters
  - Methods receive parsed auth context (employeeID, orgID) as parameters (not raw request)
  - Return domain errors (not connect.Error)
  - Include cross-domain dependency: `notification.NotificationLogic` interface
  - **Files**: `backend/internal/chat/logic.go`
  - **Dependencies**: Requires T002, T004

- [X] **T011** Implement chat logic layer in `backend/internal/chat/logic.go`
  - Struct: `chatLogicImpl` with fields:
    * `Queries *database.Queries` (sqlc-generated methods)
    * `NotificationLogic notification.NotificationLogic` (interface dependency)
  - NO connection pools in logic layer (pool-agnostic)
  - All DB operations accept `tx database.DBTX` parameter
  - Implement business logic for all operations (channel CRUD, membership, messaging, reactions)
  - Cross-domain calls: Use `NotificationLogic.PublishBatchNotification()` directly (NOT RPC)
  - Context propagation: Pass user-scope context through all layers
  - **Files**: `backend/internal/chat/logic.go`
  - **Dependencies**: Requires T010

- [X] **T012** Create chat connect layer in `backend/internal/chat/connect.go`
  - Struct: `chatConnectImpl` with fields:
    * `Logic ChatLogic` (interface, not concrete type)
    * `TenantPool database.TenantDatabaseConnector` (for user operations)
  - Implement ConnectRPC handler interface for ChatService
  - Extract auth context from request (employeeID, orgID) and pass to logic layer
  - Manage transactions with `txn.WithTxn(ctx, TenantPool, func(ctx, tx) {...})`
  - Translate domain errors to `connect.Error` types
  - NO AdminPool usage (chat is user-scope only, no system operations)
  - **Files**: `backend/internal/chat/connect.go`
  - **Dependencies**: Requires T011, T006

### Channel Management Implementation

- [X] **T013** Implement CreateChannel in logic layer
  - Validate slug format (alphanumeric + hyphen, max 64 chars)
  - Create channel with uuidv7()
  - Auto-create membership for creator as admin (atomic operation)
  - Return channel with creator membership
  - **Files**: `backend/internal/chat/logic.go`
  - **Dependencies**: Requires T011

- [X] **T014** Implement GetChannel and ListChannels in logic layer
  - GetChannel: Verify user has access (membership or public channel)
  - ListChannels: Filter by membership + public channels
  - Support pagination with cursor (timestamp-based)
  - Include member_count in response
  - **Files**: `backend/internal/chat/logic.go`
  - **Dependencies**: Requires T011

- [X] **T015** Implement UpdateChannel and ArchiveChannel in logic layer
  - UpdateChannel: Verify user is admin or creator
  - ArchiveChannel: Prevent new messages/notifications
  - UnarchiveChannel: Restore full functionality
  - All operations validate organization_id
  - **Files**: `backend/internal/chat/logic.go`
  - **Dependencies**: Requires T011

### Membership Management Implementation

- [X] **T016** Implement JoinChannel and LeaveChannel in logic layer
  - JoinChannel: Only for public channels (private requires invite)
  - LeaveChannel: Prevent removing last admin (auto-promote oldest member)
  - Create membership with default notification preference ('all')
  - **Files**: `backend/internal/chat/logic.go`
  - **Dependencies**: Requires T011

- [X] **T017** Implement InviteMember and RemoveMember in logic layer
  - InviteMember: Verify inviter is admin, create membership, send notification
  - RemoveMember: Verify remover is admin, prevent removing last admin
  - Call `NotificationLogic.PublishBatchNotification()` for invite notifications
  - **Files**: `backend/internal/chat/logic.go`
  - **Dependencies**: Requires T011

- [X] **T018** Implement ListChannelMembers and UpdateMemberRole in logic layer
  - ListChannelMembers: Include employee details (name, email) via JOIN
  - UpdateMemberRole: Verify requester is admin, prevent removing last admin
  - UpdateNotificationPreference: Allow user to mute/unmute channels
  - **Files**: `backend/internal/chat/logic.go`
  - **Dependencies**: Requires T011

### Messaging Implementation

- [X] **T019** Implement SendMessage in logic layer (transaction-aware)
  - Validate content length (~10k chars)
  - Create message with uuidv7()
  - Fetch channel members with ListChannelMembersForNotification query
  - Call `NotificationLogic.PublishBatchNotification(ctx, tx, ...)` with same transaction
  - Atomic operation: message creation + notifications in single tx
  - NOTE: Notification integration deferred to future work (TODO comment added)
  - **Files**: `backend/internal/chat/logic.go`
  - **Dependencies**: Requires T011

- [X] **T020** Implement ReplyToMessage in logic layer
  - Validate parent_message_id exists and is NOT a reply (enforce 1-level threading)
  - Create reply message with parent_message_id
  - Notify parent author + channel members (respect notification preferences)
  - Use same transaction pattern as SendMessage
  - NOTE: Notification integration deferred to future work (TODO comment added)
  - **Files**: `backend/internal/chat/logic.go`
  - **Dependencies**: Requires T011

- [X] **T021** Implement EditMessage and DeleteMessage in logic layer
  - EditMessage: Verify author or admin, update content, set is_edited=true
  - DeleteMessage: Soft delete (is_deleted=true), preserve replies
  - Store edit_history in JSONB (array of {edited_at, previous_text})
  - **Files**: `backend/internal/chat/logic.go`
  - **Dependencies**: Requires T011

- [X] **T022** Implement ListMessages and GetMessage in logic layer
  - ListMessages: Cursor-based pagination (timestamp), exclude deleted
  - Include reply_count for top-level messages
  - ListReplies: Fetch all replies to a message (ordered by updated_at ASC)
  - Join with employee table for author details (name, email)
  - **Files**: `backend/internal/chat/logic.go`
  - **Dependencies**: Requires T011

### Reactions Implementation

- [X] **T023** Implement AddReaction and RemoveReaction in logic layer
  - AddReaction: Use ON CONFLICT DO NOTHING (idempotent)
  - RemoveReaction: Delete reaction record
  - Validate emoji_code format (e.g., ":thumbs_up:", ":heart:")
  - No notifications for reactions (per spec)
  - **Files**: `backend/internal/chat/logic.go`
  - **Dependencies**: Requires T011

- [X] **T024** Implement ListReactions in logic layer
  - Group reactions by emoji_code with COUNT
  - Return array of employee_ids for each emoji
  - Order by count DESC, emoji_code ASC
  - **Files**: `backend/internal/chat/logic.go`
  - **Dependencies**: Requires T011

### Typing Indicators (Ephemeral State)

- [X] **T025** Implement StartTyping and StopTyping in connect layer
  - In-memory state only (no DB persistence per spec)
  - Use sync.Map or similar for concurrent access
  - TTL: 3 seconds (auto-expire)
  - Broadcast via notification hub (optional future enhancement)
  - **Files**: `backend/internal/chat/connect.go`
  - **Dependencies**: Requires T012

### Connect Layer RPC Handlers

- [X] **T026** Implement all RPC handlers in connect layer
  - Extract auth context from request (employeeID, orgID)
  - Call corresponding logic layer methods with parsed context
  - Use `txn.WithTxn(ctx, TenantPool, func(ctx, tx) {...})` for transactional operations
  - Translate domain errors to connect.Error (e.g., NotFound, PermissionDenied, InvalidArgument)
  - Add structured logging with slog (source=chat, operation=<method>)
  - **Files**: `backend/internal/chat/connect.go`
  - **Dependencies**: Requires T012, T013-T024

---

## Phase 3.3: Integration

- [X] **T027** Register chat service in `backend/cmd/server.go`
  - Initialize notification logic layer (dependency)
  - Create chat logic layer with `NewChatLogic(queries, notificationLogic)`
  - Wrap with connect layer `NewChatConnect(logic, tenantPool)`
  - Register with ConnectRPC mux
  - Follow existing service registration pattern
  - **Files**: `backend/cmd/server.go`
  - **Dependencies**: Requires T026

- [X] **T028** Add structured logging to all chat operations
  - Use `log/slog` with structured fields (operation, channel_id, employee_id)
  - Log entry/exit for all RPC methods
  - Log cross-domain calls (notification.PublishBatchNotification)
  - Include error context for debugging
  - **Files**: `backend/internal/chat/logic.go`, `backend/internal/chat/connect.go`
  - **Dependencies**: Requires T026

- [X] **T029** Verify tenant isolation in all queries
  - Audit all sqlc queries for organization_id filters
  - Ensure TenantPool enforces context from auth token
  - Test cross-tenant data leakage scenarios (manual verification)
  - **Files**: `backend/database/scripts/chat.query.sql`
  - **Dependencies**: Requires T003

---

## Phase 3.4: Manual Verification ⚠️ REQUIRED BEFORE TESTS

**Human developer MUST verify behavior is correct before adding tests**

- [ ] **T030** Manual test: Create public channel and verify creator becomes admin
  - Use quickstart.md Scenario 1 steps
  - Verify in database: channel created, membership with is_admin=true
  - Test: Alice creates "General Discussion" channel
  - **Verification**: Database check + UI observation

- [ ] **T031** Manual test: Invite member and verify notification delivery
  - Continue Scenario 1: Alice invites Bob
  - Verify: Bob receives notification in notification hub
  - Check: notification.notification table has invite record
  - **Verification**: Database check + notification badge in UI

- [ ] **T032** Manual test: Send message and verify real-time notification
  - Use quickstart.md Scenario 2 steps
  - Bob sends message "Hello team! 👋"
  - Alice receives SSE notification within 1-2 seconds
  - Verify: Batched notification insert (<100ms for multiple members)
  - **Verification**: Browser DevTools Network tab + database timing

- [ ] **T033** Manual test: Reply to message (1-level threading)
  - Use Scenario 3: Alice replies to Bob's message
  - Verify: reply has parent_message_id set correctly
  - Test: Cannot reply to a reply (enforce CHECK constraint)
  - **Verification**: Database check + UI thread view

- [ ] **T034** Manual test: Edit and delete message
  - Use Scenario 4: Bob edits message, then deletes it
  - Verify: is_edited flag set, edit_history JSONB populated
  - Verify: Soft delete preserves message with is_deleted=true
  - **Verification**: Database check + UI placeholders

- [ ] **T035** Manual test: Add reaction and verify aggregation
  - Use Scenario 5: Multiple users react with emojis
  - Verify: Reactions grouped by emoji_code
  - Test: Same user cannot react twice with same emoji (unique constraint)
  - **Verification**: Database check + UI reaction counters

- [ ] **T036** Manual test: Mute channel and verify no notifications
  - Update notification preference to 'muted'
  - Send message in muted channel
  - Verify: User does NOT receive notification
  - **Verification**: notification.notification table check

- [ ] **T037** Manual test: Private channel access control
  - Create private channel, verify non-members cannot access
  - Invite member, verify access granted
  - Test: ListChannels excludes private channels unless member
  - **Verification**: RPC error responses + database filtering

- [ ] **T038** Manual test: Archive channel and verify no new messages
  - Archive channel, attempt to send message
  - Verify: RPC returns error (channel archived)
  - Verify: No notifications sent for archived channels
  - **Verification**: RPC error + database state

- [ ] **T039** Manual test: Multi-tenant isolation (CRITICAL SECURITY)
  - Create channels in Org A and Org B
  - Verify: Employee from Org A cannot see/access Org B channels
  - Test: Direct SQL injection attempts with different organization_id
  - **Verification**: Database query filtering + error responses

- [ ] **T040** Manual test: Transaction rollback on notification failure
  - Simulate notification service failure (stop service temporarily)
  - Send message, verify: Message NOT created (transaction rolled back)
  - Restart notification service, retry
  - **Verification**: Database consistency + logs

- [ ] **T041** Document verified behavior in test plan
  - Record all manual test results
  - Note any edge cases discovered
  - Update quickstart.md with additional scenarios if needed
  - **Files**: `specs/009-chat-backend/quickstart.md`

---

## Phase 3.5: Tests (After Verification)

**Add tests ONLY after T030-T041 confirm correct behavior**

### Contract Tests (RPC Surface)

- [ ] **T042** [P] Contract test: CreateChannel endpoint
  - Test valid channel creation with all fields
  - Test slug uniqueness constraint
  - Test invalid slug format (special characters)
  - Test creator becomes admin member
  - **Files**: `backend/integration/chat_test.go` (new file)

- [ ] **T043** [P] Contract test: Channel membership endpoints
  - Test JoinChannel (public only)
  - Test InviteMember (admin required)
  - Test RemoveMember (prevent last admin removal)
  - Test UpdateMemberRole (admin promotion/demotion)
  - **Files**: `backend/integration/chat_test.go`

- [ ] **T044** [P] Contract test: Messaging endpoints
  - Test SendMessage with notification delivery
  - Test ReplyToMessage (1-level threading enforcement)
  - Test EditMessage (verify is_edited flag)
  - Test DeleteMessage (soft delete, preserve replies)
  - **Files**: `backend/integration/chat_test.go`

- [ ] **T045** [P] Contract test: Reaction endpoints
  - Test AddReaction (idempotent, unique constraint)
  - Test RemoveReaction
  - Test ListReactions (aggregation by emoji)
  - **Files**: `backend/integration/chat_test.go`

### Integration Tests (End-to-End)

- [ ] **T046** [P] Integration test: Full message flow with notifications
  - Create channel → Add members → Send message → Verify notifications delivered
  - Test batched notification insert performance (<100ms for 100 members)
  - Verify transaction atomicity (message + notifications commit together)
  - **Files**: `backend/integration/chat_notification_test.go` (new file)

- [ ] **T047** [P] Integration test: Multi-tenant isolation
  - Create channels in multiple organizations
  - Verify cross-tenant queries return empty results
  - Test direct database access with wrong organization_id
  - **Files**: `backend/integration/chat_isolation_test.go` (new file)

- [ ] **T048** [P] Integration test: Channel archival workflow
  - Archive channel → Verify no new messages → Unarchive → Resume messaging
  - Test notification suppression for archived channels
  - **Files**: `backend/integration/chat_archival_test.go` (new file)

- [ ] **T049** [P] Integration test: Transaction rollback scenarios
  - Simulate notification service failure during SendMessage
  - Verify message NOT created (transaction rolled back)
  - Verify database consistency (no orphaned records)
  - **Files**: `backend/integration/chat_txn_test.go` (new file)

### Unit Tests

- [ ] **T050** [P] Unit test: Message validation logic
  - Test content length validation (~10k chars)
  - Test emoji_code format validation
  - Test slug format validation (alphanumeric + hyphen)
  - **Files**: `backend/internal/chat/logic_test.go` (new file)

- [ ] **T051** [P] Unit test: Admin removal prevention logic
  - Test CountChannelAdmins query
  - Test auto-promotion of oldest member when last admin leaves
  - Mock database queries with testify/mock
  - **Files**: `backend/internal/chat/logic_test.go`

- [ ] **T052** [P] Unit test: Notification preference filtering
  - Test ListChannelMembersForNotification query logic
  - Verify 'muted' members excluded
  - Verify 'mentions' members included only on @mention
  - **Files**: `backend/internal/chat/logic_test.go`

---

## Phase 3.6: Frontend (Optional - Future Work)

**Note**: Frontend implementation is out of scope for this backend-focused feature. Tasks below are placeholders for future frontend integration.

- [ ] **T053** [P] Create workspace chat page layout
  - Path: `frontend/apps/web/src/app/workspace/chat/page.tsx`
  - Client-side rendering with `useRequireAuth` hook
  - Tab navigation (Channels, Direct Messages, Search)
  - **Files**: `frontend/apps/web/src/app/workspace/chat/page.tsx`

- [ ] **T054** [P] Implement channel list component
  - Display channels with unread indicators
  - Filter by channel_type and is_archived
  - Use TanStack Query for data fetching
  - **Files**: `frontend/apps/web/src/app/workspace/chat/components/ChannelList.tsx`

- [ ] **T055** [P] Implement message thread component
  - Display messages with replies (1-level threading)
  - Show reactions with aggregation
  - Real-time updates via SSE (notification hub)
  - **Files**: `frontend/apps/web/src/app/workspace/chat/components/MessageThread.tsx`

---

## Phase 3.7: Polish

- [ ] **T056** Performance optimization: Index tuning
  - Analyze slow queries with EXPLAIN ANALYZE
  - Add missing indexes if needed (e.g., frequently filtered columns)
  - Verify partial indexes for is_deleted and is_archived
  - **Files**: `backend/database/scripts/schema.sql`

- [ ] **T057** [P] Update documentation
  - Add chat service to API reference docs
  - Document cross-domain integration pattern with notification service
  - Update README with chat feature overview
  - **Files**: `backend/README.md`, `specs/009-chat-backend/README.md`

- [ ] **T058** Final smoke test
  - Run full quickstart.md scenario end-to-end
  - Verify all RPC endpoints respond correctly
  - Check logs for errors or warnings
  - Validate CI pipeline passes (build, lint, tests)
  - **Files**: N/A (manual verification)

---

## Dependencies

### Critical Path
1. **T001-T004** (Schema + sqlc) → Blocks ALL implementation
2. **T005-T006** (Proto + buf) → Blocks connect layer (T012, T026)
3. **T007-T009** (Frontend RPC) → Independent, can run parallel with backend
4. **T010-T011** (Logic layer) → Blocks all business logic (T013-T025)
5. **T012** (Connect layer setup) → Blocks RPC handlers (T026)
6. **T013-T025** (Business logic impl) → Blocks T026 (RPC handlers)
7. **T026** (RPC handlers) → Blocks T027 (service registration)
8. **T027-T029** (Integration) → Blocks manual verification (T030-T041)
9. **T030-T041** (Manual verification) → **GATES** T042-T052 (tests)
10. **T042-T052** (Tests) → Before polish (T056-T058)

### Parallel Execution Groups
- **Group 1** (Schema): T001 → T002 (sequential)
- **Group 2** (Queries): T003 → T004 (sequential, after T002)
- **Group 3** (Proto): T005 → T006 (sequential)
- **Group 4** (Frontend): T007 → T008 → T009 (sequential, after T006)
- **Group 5** (Logic impl): T013-T015 (channel), T016-T018 (membership), T019-T022 (messaging), T023-T024 (reactions) can run parallel after T011
- **Group 6** (Tests): T042-T052 can run parallel after T041
- **Group 7** (Polish): T056-T057 can run parallel

---

## Parallel Execution Examples

### Backend Core Implementation (After T011)
```bash
# Terminal 1: Channel management
Task: "Implement CreateChannel, GetChannel, ListChannels in logic layer"

# Terminal 2: Membership management
Task: "Implement JoinChannel, LeaveChannel, InviteMember in logic layer"

# Terminal 3: Messaging
Task: "Implement SendMessage, ReplyToMessage in logic layer"

# Terminal 4: Reactions
Task: "Implement AddReaction, RemoveReaction, ListReactions in logic layer"
```

### Frontend RPC Setup (After T006)
```bash
# All can run in parallel
Task: "Export chat service from frontend/packages/rpc/index.ts"
Task: "Build frontend workspace to refresh artifacts"
Task: "Create API wrapper in frontend/packages/apis/src/chat.ts"
```

### Contract Tests (After T041 manual verification)
```bash
# Terminal 1:
Task: "Contract test CreateChannel endpoint"

# Terminal 2:
Task: "Contract test Channel membership endpoints"

# Terminal 3:
Task: "Contract test Messaging endpoints"

# Terminal 4:
Task: "Contract test Reaction endpoints"

# Terminal 5:
Task: "Integration test Full message flow with notifications"

# Terminal 6:
Task: "Integration test Multi-tenant isolation"
```

---

## Validation Checklist

*GATE: Checked before executing*

- [x] All proto endpoints have corresponding implementations (23 RPC methods)
- [x] All entities have model tasks (5 tables: channel, message, membership, reaction, typing_indicator)
- [x] Manual verification phase present before tests (T030-T041)
- [x] All implementations have corresponding tests after verification (T042-T052)
- [x] Parallel tasks truly independent (different files, marked [P])
- [x] Each task specifies exact file path
- [x] No task modifies same file as another [P] task
- [x] sqlc generate and buf generate tasks present (T002, T004, T006)
- [x] Frontend workspace build included (T007-T009)
- [x] Constitution v3.6.0 two-layer architecture enforced (T010-T012)
- [x] Cross-domain integration via logic layer interface (T019, T020)
- [x] Transaction-aware cross-domain methods (T019, T020)
- [x] Context propagation documented (user-scope throughout)
- [x] Tenant isolation verified (T029, T039, T047)

---

## Notes

- **Constitution v3.6.0 Compliance**: All backend tasks follow two-layer service architecture (logic + connect layers) with cross-domain integration via logic layer interfaces
- **Transaction Safety**: Message creation + notification publishing in single atomic transaction (T019, T020)
- **Performance**: Batched notification inserts target <100ms for 1000+ members (delegated to notification service)
- **Multi-Tenant Isolation**: All queries filter by organization_id, enforced with TenantPool
- **Real-Time Delivery**: SSE via notification hub (Feature #007) handles message delivery
- **Reusability**: channel_type enum enables reuse for project comments, CRM notes, support tickets
- **Testing Philosophy**: Implement → Human Verify → Then Test (Constitution v3.3.0)
- **Generated Code**: Always commit sqlc and buf generated outputs (CI validates match)
- **Frontend Integration**: API wrappers in `packages/apis` (NOT direct imports from `packages/rpc`)

---

## Success Criteria

- [ ] Chat backend service operational with 23 RPC endpoints
- [ ] All manual verification scenarios pass (T030-T041)
- [ ] Integration tests pass with >80% coverage
- [ ] Multi-tenant isolation verified (no cross-tenant data leaks)
- [ ] Message + notification atomic transactions working
- [ ] Performance target: <100ms for batched notifications (100 members)
- [ ] CI pipeline green (build, lint, tests)
- [ ] Documentation updated with chat service API reference
- [ ] Ready for frontend integration (RPC client exported and wrapped)
