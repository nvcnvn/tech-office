# Tasks: Chat Frontend and Notification Integration

**Input**: Design documents from `/specs/010-chat-frontend-and-notification/`
**Prerequisites**: plan.md (required), research.md, data-model.md, contracts/

## Execution Flow (main)
```
1. Load plan.md from feature directory
   → Extract: Next.js 15, TipTap editor, react-virtuoso, Connect-Web, Go backend extensions
2. Load optional design documents:
   → data-model.md: Schema extensions for unread tracking
   → contracts/RPC_CONTRACTS.md: GetMessageById, MarkChannelAsRead methods
   → research.md: WYSIWYG editor selection, virtual scrolling, SSE event schema
   → quickstart.md: 6 test scenarios (navigation, messages, mentions, replies, reactions, unread)
3. Generate tasks by category:
   → Setup: Dependencies (TipTap, react-virtuoso), DB schema migration, proto extensions
   → Backend: GetMessageById, MarkChannelAsRead, mention parsing, notification integration
   → Frontend: 3-column layout, message list, composer, reactions, thread view
   → Integration: SSE event handling, deep linking, unread tracking
   → Verification: 6 quickstart scenarios (manual testing REQUIRED gate)
   → Tests: Unit, contract, integration tests (after verification)
   → Polish: Performance optimization, documentation
4. Apply task rules:
   → Different files = mark [P] for parallel
   → Same file = sequential (no [P])
   → Schema/proto changes → codegen tasks → block implementation
   → Implementation before verification, verification before tests
5. Number tasks sequentially (T001-T067)
6. Dependencies: Setup blocks Core, Core blocks Integration, Integration blocks Verification, Verification blocks Tests
```

## Format: `[ID] [P?] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- Include exact file paths in descriptions

## Phase 3.1: Setup & Schema Changes

### Database Schema Extensions
- [X] T001 Add unread tracking columns to `chat.channel_membership` in `backend/database/scripts/schema.sql`:
  - `last_viewed_message_id UUID REFERENCES chat.message(id)`
  - `last_viewed_at TIMESTAMPTZ DEFAULT NOW()`
  - Add indexes for efficient unread queries
- [X] T002 Generate Atlas migration script: `cd backend && ./scripts/atlas/01_migration_create.sh add_chat_unread_tracking`
- [X] T003 Apply migration to dev database: `cd backend && ./scripts/atlas/02_migrate_apply.sh`
- [X] T004 Verify schema changes with `EXPLAIN ANALYZE` on unread count query

### SQL Query Definitions
- [X] T005 Add `GetMessageByIdWithChannel` query to `backend/database/scripts/chat.query.sql`
- [X] T006 [P] Add `UpdateChannelMembershipLastViewed` query to `backend/database/scripts/chat.query.sql`
- [X] T007 [P] Add `GetEmployeesByEmails` query to `backend/database/scripts/chat.query.sql` (renamed from GetEmployeesByUsernames)
- [X] T008 [P] Add `CheckChannelMembership` query to `backend/database/scripts/chat.query.sql`
- [X] T009 [P] Add `GetUnreadMessageCount` query to `backend/database/scripts/chat.query.sql`
- [X] T010 Generate sqlc models: `cd backend && sqlc generate` (commit generated files)

### Proto Extensions
- [X] T011 Add `GetMessageById` RPC method to `backend/rpc/v1/chat.proto` with request/response messages
- [X] T012 Add `MarkChannelAsRead` RPC method to `backend/rpc/v1/chat.proto` with request/response messages
- [X] T013 Extend `ChannelMembership` message with unread tracking fields: `last_viewed_message_id`, `last_viewed_at`, `unread_count`
- [X] T014 Extend `Message` message with mention metadata: `mentioned_employee_ids`, `mentioned_emails`
- [X] T015 Generate proto code: `cd backend && buf generate` (commit generated backend files)

### Frontend Dependencies
- [X] T016 [P] Install TipTap editor packages in `frontend/package.json`:
  - `@tiptap/react@^2.1.13`
  - `@tiptap/starter-kit@^2.1.13`
  - `@tiptap/extension-mention@^2.1.13`
- [X] T017 [P] Install `react-virtuoso@^4.6.2` for message list virtual scrolling
- [X] T018 Build frontend packages: `cd frontend && pnpm -r build` (regenerate RPC client after proto changes)
- [X] T019 Re-export new chat methods in `frontend/packages/rpc/index.ts` (already exported)
- [X] T020 Add API wrappers in `frontend/packages/apis/src/chat.ts` for `getMessageById` and `markChannelAsRead`

## Phase 3.2: Backend Extensions

### Mention Parsing & Validation (Pure Logic)
- [X] T021 Create `parseMentions` helper function in `backend/internal/chat/helpers.go`:
  - Parse @email patterns from message text
  - Return unique list of emails
  - Handle edge cases (escaped @, @mentions in code blocks)
- [X] T022 Create `validateAndResolveMentions` logic method in `backend/internal/chat/logic.go`:
  - Accepts `tx database.DBTX`, `orgID`, `emails []string`
  - Call `GetEmployeesByEmails` query
  - Return map of email → employee_id
  - Log warnings for invalid mentions

### GetMessageById Implementation (Logic Layer)
- [X] T023 Implement `GetMessageByIdLogic` method in `backend/internal/chat/logic.go`:
  - Accepts `ctx context.Context`, `tx database.DBTX`, `orgID dbuuid.UUID`, `employeeID dbuuid.UUID`, `messageID dbuuid.UUID`
  - Call `GetMessageByIdWithChannel` query (with `organization_id` filter)
  - Call `CheckChannelMembership` query to validate employee access
  - Return message + channel details or permission error
  - Add structured logging with `log/slog`

### GetMessageById Implementation (Connect Layer)
- [X] T024 Implement `GetMessageById` RPC handler in `backend/internal/chat/connect.go`:
  - Extract auth context from request (employeeID, orgID)
  - Read-only operation: pass pool directly (no transaction needed)
  - Call `s.Logic.GetMessageById(ctx, pool, orgID, employeeID, messageID)`
  - Translate domain errors to `connect.Error`
  - Return `GetMessageByIdResponse`

### MarkChannelAsRead Implementation (Logic Layer)
- [X] T025 Implement `MarkChannelAsReadLogic` method in `backend/internal/chat/logic.go`:
  - Accepts `ctx context.Context`, `tx database.DBTX`, `orgID dbuuid.UUID`, `employeeID dbuuid.UUID`, `channelID dbuuid.UUID`, `lastReadMessageID *dbuuid.UUID`
  - Call `CheckChannelMembership` query (security check)
  - Call `UpdateChannelMembershipLastViewed` query
  - Call `GetUnreadMessageCount` query (return remaining unread)
  - Add structured logging

### MarkChannelAsRead Implementation (Connect Layer)
- [X] T026 Implement `MarkChannelAsRead` RPC handler in `backend/internal/chat/connect.go`:
  - Extract auth context from request
  - Create transaction with `txn.WithTxn(ctx, s.TenantPool, ...)`
  - Call `s.Logic.MarkChannelAsRead(ctx, tx, ...)`
  - Return `MarkChannelAsReadResponse` with unread count
  - Add structured logging with `log/slog`

### Notification Integration in SendMessage
- [X] T027 Update `SendMessage` logic in `backend/internal/chat/logic.go`:
  - After message insert, call `parseMentions(req.MessageText)`
  - Call `validateAndResolveMentions(ctx, tx, orgID, mentions)`
  - For each valid mention, call `s.NotificationLogic.PublishNotification(ctx, tx, ...)` with:
    - `source_domain = "chat"`
    - `notification_type = "mention"`
    - `action_data = {"channelId": ..., "messageId": ..., "action": "view_message"}`
  - Add structured logging for notification publish

### Notification Integration in SendReply
- [X] T028 Update `SendReply` logic in `backend/internal/chat/logic.go`:
  - After reply insert, call `s.NotificationLogic.PublishNotification(ctx, tx, ...)` for parent message author:
    - `notification_type = "reply"`
    - `action_data = {"channelId": ..., "messageId": ..., "parentMessageId": ...}`
  - Skip notification if reply author is same as parent author
  - Add structured logging

## Phase 3.3: Frontend Chat UI

### Chat Layout & Routing
- [X] T029 Add "Chat" tab to workspace layout in `frontend/apps/web/src/app/workspace/layout.tsx`:
  - Add `TabLink` with href="/workspace/chat" and icon
  - Position after other tabs (Cmd+5 shortcut)
- [X] T030 Create chat page `frontend/apps/web/src/app/workspace/chat/page.tsx`:
  - Client component with `'use client'`
  - Auth guard via `useRequireAuth` hook
  - Read `?channel=` query param for active channel
  - 3-column layout: channels sidebar (left), messages (center), thread view (right)

### Channel Sidebar Component
- [X] T031 Create `ChannelSidebar` component in `frontend/apps/web/src/app/workspace/chat/components/ChannelSidebar.tsx`:
  - Fetch channels with `useQuery(['channels'])`
  - Display channel list with Material-UI List/ListItem
  - Show unread count badges per channel
  - Handle channel selection (update `?channel=` query param)
  - Height: full viewport minus top nav (`h-[calc(100vh-56px)]`)
  - Width: `w-56` (224px)
- [X] T031a Create `CreateChannelDialog` component in `frontend/apps/web/src/app/workspace/chat/components/CreateChannelDialog.tsx`:
  - Material-UI Dialog with form for channel creation
  - Auto-generate slug from channel name
  - Support manual slug editing
  - Channel description textarea (optional)
  - Private channel toggle switch
  - Form validation (name and slug required)
  - Call `createChannel` mutation on submit
  - Invalidate channels query and navigate to new channel on success
  - Integrate with ChannelSidebar "+" button to open dialog

### Message List Component with Virtual Scrolling
- [X] T032 Create `MessageList` component in `frontend/apps/web/src/app/workspace/chat/components/MessageList.tsx`:
  - Use `react-virtuoso` for virtual scrolling
  - Fetch messages with `useInfiniteQuery(['messages', channelId])`
  - Configure reverse scroll (start at bottom)
  - Implement "load more" on scroll up with `startReached` callback
  - Auto-scroll to bottom on new messages with `followOutput="smooth"`
  - Render individual message items with `MessageItem` component

### Message Item Component
- [X] T033 Create `MessageItem` component in `frontend/apps/web/src/app/workspace/chat/components/MessageItem.tsx`:
  - Display author avatar, name, timestamp
  - Render message text with Markdown formatting (basic rendering, not TipTap)
  - Show reactions below message (emoji + count)
  - Add hover menu with "Reply", "React", "More" buttons
  - Highlight mentioned usernames in blue
  - Show reply count badge if message has replies
  - Support message highlight effect for deep linking (yellow fade out)

### Message Composer with TipTap
- [X] T034 Create `MessageComposer` component in `frontend/apps/web/src/app/workspace/chat/components/MessageComposer.tsx`:
  - Initialize TipTap editor with StarterKit, Markdown, Mention extensions
  - Configure @mention autocomplete with channel members
  - Extract Markdown output on submit
  - Send message via `sendMessage` mutation
  - Implement Cmd+Enter shortcut to send
  - Support Enter to send (single-line mode) or Enter for newline (multi-line mode toggle)
  - Fixed height: `h-24` (96px) with expand button for long-form

### Reaction Picker Component
- [X] T035 Create `ReactionPicker` component in `frontend/apps/web/src/app/workspace/chat/components/ReactionPicker.tsx`:
  - Render native emoji picker (OS-dependent) or fallback to emoji list
  - Position as popover below message on "React" button click
  - Call `addReaction` mutation on emoji select
  - Implement toggle behavior (remove reaction if already reacted)

### Thread View Component
- [X] T036 Create `ThreadView` component in `frontend/apps/web/src/app/workspace/chat/components/ThreadView.tsx`:
  - Display parent message at top
  - List replies below with `MessageList` pattern (no virtual scrolling, smaller dataset)
  - Show reply composer at bottom
  - Close on Escape key or close button
  - Width: `w-80` (320px) when open, collapsed when closed
  - Slide-in animation from right

## Phase 3.4: SSE Integration & Real-Time Updates

### SSE Event Handling for Chat
- [X] T037 Extend `useSSEConnection` hook in `frontend/packages/notifications/src/hooks/useSSEConnection.ts`:
  - Add chat event handler for `source_domain === "chat"`
  - Handle `notification_type === "message"`: invalidate message queries
  - Handle `notification_type === "mention"`: show notification + invalidate
  - Handle `notification_type === "reply"`: show notification + invalidate
  - Handle `notification_type === "typing"`: update typing indicator state (ephemeral)
  - Handle `notification_type === "reaction"`: invalidate message query
  - **Implementation Note**: Created dedicated `useChatSSE` hook in `frontend/apps/web/src/app/workspace/chat/hooks/useChatSSE.ts` that wraps `useSSEConnection` and filters for chat events. Integrated into `chat/page.tsx` with typing event state management.

### Chat Notification Actions (Deep Linking)
- [X] T038 Create `handleChatNotificationAction` utility in `frontend/apps/web/src/app/workspace/chat/utils/notificationActions.ts`:
  - Parse `action_data.channelId` and `action_data.messageId`
  - Navigate to `/workspace/chat?channel={channelId}&message={messageId}`
  - Scroll message into view and apply highlight effect
  - Mark channel as read after navigation
  - **Implementation Note**: Uses Next.js router.push for navigation, calls `markAsRead` API after navigation, handles parentMessageId for reply notifications.
- [X] T039 Register chat notification action handler in workspace layout `frontend/apps/web/src/app/workspace/layout.tsx`:
  - Listen for notification clicks with `source_domain === "chat"`
  - Call `handleChatNotificationAction(notification.action_data)`
  - **Implementation Note**: Added useEffect with custom 'notification-click' event listener, routes to appropriate handler based on source domain.

### Typing Indicator Implementation
- [X] T040 Create `TypingIndicator` component in `frontend/apps/web/src/app/workspace/chat/components/TypingIndicator.tsx`:
  - Display "Alice and Bob are typing..." below message list
  - Manage ephemeral state (auto-clear after 5s)
  - Subscribe to SSE typing events for active channel
  - **Implementation Note**: Receives typing state from parent (chat/page.tsx), displays formatted text based on user count, parent manages 5s expiration via interval.
- [ ] T041 Send typing indicator events from `MessageComposer`:
  - Debounce typing events (send max once per 3s)
  - Call backend method (if implemented) or skip for MVP
  - **DEFERRED**: Backend RPC methods exist (StartTyping/StopTyping in chat.proto) but not yet verified. Will implement after backend verification or skip for MVP.

## Phase 3.5: Unread Tracking & Badges

### Unread Count Display
- [ ] T042 Add unread count badges to `ChannelSidebar`:
  - Fetch unread counts with `useQuery(['unreadCounts'])`
  - Display badge next to channel name (Material-UI Badge component)
  - Update on message receive via SSE event
- [ ] T043 Implement auto-mark-as-read on channel view:
  - Call `markChannelAsRead` mutation when user views channel
  - Trigger on channel switch or on visibility change (tab focus)
  - Debounce calls (max once per 5s)

## Phase 3.6: Manual Verification ⚠️ REQUIRED BEFORE TESTS
**Human developer MUST verify behavior is correct before adding tests**

### Quickstart Scenario Testing
- [ ] T044 **Scenario 1**: Manual test basic chat navigation (3-column layout, channel switching)
  - Follow steps in `quickstart.md` Scenario 1
  - Verify layout renders correctly on 13-inch laptop
  - Verify channel switch updates URL query param
  - Document verified behavior
- [ ] T045 **Scenario 2**: Manual test send and receive messages
  - Open two browser tabs/windows as different users
  - Send message from Alice, verify Bob receives via SSE
  - Verify optimistic UI for sender
  - Verify real-time delivery <60s SLA
  - Document verified behavior
- [ ] T046 **Scenario 3**: Manual test @mention notification and navigation
  - Bob mentions @charlie in message
  - Verify Charlie receives notification
  - Click notification and verify navigation to message
  - Verify message highlight effect
  - Document verified behavior
- [ ] T047 **Scenario 4**: Manual test reply to message (threading)
  - Alice clicks "Reply" on Bob's message
  - Verify thread view opens with parent message
  - Send reply and verify Bob receives notification
  - Verify reply count badge updates
  - Document verified behavior
- [ ] T048 **Scenario 5**: Manual test reactions
  - Alice reacts to Bob's message with 👍
  - Charlie also reacts with 👍
  - Verify reaction count updates in real-time via SSE
  - Verify toggle behavior (click same emoji to remove)
  - Document verified behavior
- [ ] T049 **Scenario 6**: Manual test unread message tracking
  - Bob sends message to channel Alice is not viewing
  - Verify unread badge appears on channel in Alice's sidebar
  - Alice switches to channel
  - Verify unread badge clears
  - Document verified behavior

### Multi-Tenant & Security Verification
- [ ] T050 Verify tenant isolation:
  - Create two test organizations
  - Attempt to access other org's messages via API
  - Verify 403/404 errors
  - Document security behavior
- [ ] T051 Verify channel membership security:
  - Create private channel
  - Attempt `GetMessageById` as non-member
  - Verify access denied error
  - Document security behavior

## Phase 3.7: Tests (After Verification)
**Add tests ONLY after T044-T051 confirm correct behavior**

### Backend Unit Tests
- [ ] T052 [P] Unit test `parseMentions` function in `backend/internal/chat/helpers_test.go`:
  - Test valid @mentions extraction
  - Test edge cases (escaped @, code blocks, duplicates)
- [ ] T053 [P] Unit test `validateAndResolveMentions` logic in `backend/internal/chat/logic_test.go`:
  - Mock `GetEmployeesByUsernames` query
  - Verify username → employee_id mapping
  - Verify invalid mention handling

### Backend Integration Tests
- [ ] T054 [P] Integration test `GetMessageById` RPC in `backend/internal/chat/connect_test.go`:
  - Setup: Create channel, message, membership
  - Call `GetMessageById` as member
  - Verify message + channel details returned
  - Verify non-member receives access denied
- [ ] T055 [P] Integration test `MarkChannelAsRead` RPC in `backend/internal/chat/connect_test.go`:
  - Setup: Create channel with messages
  - Call `MarkChannelAsRead`
  - Verify `last_viewed_at` updated in DB
  - Verify unread count returned correctly
- [ ] T056 [P] Integration test mention notification in `backend/internal/chat/connect_test.go`:
  - Setup: Create channel with members
  - Send message with @mention
  - Verify notification published via `NotificationLogic`
  - Verify `action_data` contains correct channelId and messageId

### Frontend Component Tests
- [ ] T057 [P] Component test `ChannelSidebar` in `frontend/apps/web/src/app/workspace/chat/components/ChannelSidebar.test.tsx`:
  - Mock channel list query
  - Verify channel list renders
  - Verify unread badges display
  - Verify channel selection updates query param
- [ ] T058 [P] Component test `MessageList` in `frontend/apps/web/src/app/workspace/chat/components/MessageList.test.tsx`:
  - Mock message infinite query
  - Verify virtuoso renders messages
  - Verify "load more" callback fires on scroll up
- [ ] T059 [P] Component test `MessageComposer` with TipTap in `frontend/apps/web/src/app/workspace/chat/components/MessageComposer.test.tsx`:
  - Verify TipTap editor initializes
  - Verify Markdown extraction on submit
  - Verify @mention autocomplete renders
- [ ] T060 [P] Component test `ThreadView` in `frontend/apps/web/src/app/workspace/chat/components/ThreadView.test.tsx`:
  - Mock parent message and replies
  - Verify parent message displays at top
  - Verify reply composer renders
  - Verify close on Escape key

### Frontend Integration Tests
- [ ] T061 [P] Integration test notification deep linking in `frontend/apps/web/src/app/workspace/chat/__tests__/deepLinking.test.tsx`:
  - Mock notification with `action_data.messageId`
  - Call `handleChatNotificationAction`
  - Verify navigation to correct URL
  - Verify message highlight effect applied
- [ ] T062 [P] Integration test SSE chat event handling in `frontend/apps/web/src/app/workspace/chat/__tests__/sseIntegration.test.tsx`:
  - Mock SSE event with `source_domain: "chat"`
  - Verify message query invalidated
  - Verify typing indicator state updated

## Phase 3.8: Polish & Documentation

### Performance Optimization
- [ ] T063 Verify message load time <300ms p95:
  - Add performance logging in backend
  - Test with 1000+ message channel
  - Optimize query indexes if needed
- [ ] T064 Verify virtual scrolling performance:
  - Test smooth scrolling with 1000+ messages
  - Monitor memory usage
  - Optimize render performance if needed

### Documentation & Cleanup
- [ ] T065 [P] Create chat feature README in `frontend/apps/web/src/app/workspace/chat/README.md`:
  - Document component structure
  - Document SSE integration pattern
  - Document deep linking flow
- [ ] T066 [P] Update backend API documentation in `backend/docs/CHAT_API.md`:
  - Document new RPC methods
  - Document notification integration
  - Document mention parsing behavior
- [ ] T067 Final smoke test: Run all 6 quickstart scenarios end-to-end

## Phase 3.9: Bug Fixes & Regression Follow-Up

- [X] T068 Resolve reaction conflict error by updating `backend/database/scripts/chat.query.sql` AddReaction query to return existing rows and regenerate sqlc outputs.
- [X] T069 Enhance hover reaction UX in `frontend/apps/web/src/app/workspace/chat/components/MessageItem.tsx` with quick emoji shortcuts and EmojiEmotions icon trigger.
- [X] T070 Expand emoji code mappings in `frontend/apps/web/src/app/workspace/chat/utils/emoji.ts` to cover the full default reaction set for Slack-style shortcodes.
- [X] T071 Ensure deep-link navigation loads historical messages by fetching older pages in `frontend/apps/web/src/app/workspace/chat/components/MessageList.tsx`.
- [X] T072 Open thread view automatically for reply links by synchronizing URL params in `frontend/apps/web/src/app/workspace/chat/page.tsx` and highlight replies in `ThreadView`.

## Dependencies

### Setup Phase Blocks Core
- T001-T004 (schema migration) block T005-T009 (SQL query definitions)
- T005-T010 (SQL queries + sqlc) block T021-T028 (backend logic using queries)
- T011-T015 (proto extensions + buf) block T024, T026 (RPC handlers)
- T016-T020 (frontend dependencies + RPC client) block T029-T043 (frontend components)

### Backend Extensions Sequential
- T021-T022 (mention parsing) block T027 (notification integration in SendMessage)
- T023 (GetMessageById logic) blocks T024 (GetMessageById RPC)
- T025 (MarkChannelAsRead logic) blocks T026 (MarkChannelAsRead RPC)
- T027-T028 (notification integration) block T046-T047 (manual mention/reply testing)

### Frontend Components Sequential  
- T029-T030 (chat layout) block T031-T036 (individual components)
- T031 (ChannelSidebar) blocks T042 (unread badges)
- T032-T033 (MessageList + MessageItem) block T034 (MessageComposer)
- T034 (MessageComposer) blocks T041 (typing indicator sender)
- T036 (ThreadView) blocks T047 (manual reply testing)

### Integration Dependencies
- T037-T039 (SSE event handling) block T040 (TypingIndicator), T042-T043 (unread tracking)
- T037-T039 (SSE + deep linking) block T045-T046 (manual message/mention testing)

### Verification Blocks Tests
- ALL implementation (T001-T043) before verification (T044-T051)
- ALL verification (T044-T051) before tests (T052-T062)

### Polish Last
- Tests (T052-T062) before polish (T063-T067)

## Parallel Execution Examples

### Setup Phase (T005-T009, T016-T017)
```bash
# SQL queries (different sections of chat.query.sql, can parallelize with care)
Task T005: "Add GetMessageByIdWithChannel query"
Task T006: "Add UpdateChannelMembershipLastViewed query"
Task T007: "Add GetEmployeesByUsernames query"

# Frontend dependencies (independent)
Task T016: "Install TipTap packages"
Task T017: "Install react-virtuoso"
```

### Backend Logic Layer (T021-T022, T052-T053)
```bash
# Different files, pure logic functions
Task T021: "Create parseMentions helper in helpers.go"
Task T022: "Create validateAndResolveMentions in logic.go"

# Tests after verification
Task T052: "Unit test parseMentions"
Task T053: "Unit test validateAndResolveMentions"
```

### Backend Integration Tests (T054-T056)
```bash
# Different test scenarios, independent
Task T054: "Integration test GetMessageById RPC"
Task T055: "Integration test MarkChannelAsRead RPC"
Task T056: "Integration test mention notification"
```

### Frontend Components (T031-T036)
```bash
# Different component files after layout created
Task T031: "Create ChannelSidebar component"
Task T032: "Create MessageList component"
Task T033: "Create MessageItem component"
Task T034: "Create MessageComposer component"
Task T035: "Create ReactionPicker component"
Task T036: "Create ThreadView component"
```

### Frontend Component Tests (T057-T060)
```bash
# Different test files
Task T057: "Component test ChannelSidebar"
Task T058: "Component test MessageList"
Task T059: "Component test MessageComposer"
Task T060: "Component test ThreadView"
```

### Polish Phase (T065-T066)
```bash
# Independent documentation files
Task T065: "Create chat README"
Task T066: "Update backend API docs"
```

## Bug Fixes

### Sidebar Category Collapsed State Not Persisting
- [X] BUG-001: Fix `UpdateSidebarCategoryCollapsed`, `AddChannelToCategory`, and `UpdatePinnedChannels` queries to use UPSERT pattern
  - **Issue**: UPDATE queries fail silently when user_chat_config row doesn't exist yet (new users)
  - **Fix**: Convert all three queries to INSERT ... ON CONFLICT UPDATE pattern
  - **Files**: `backend/database/scripts/chat.query.sql`
  - **Regenerate**: `cd backend && sqlc generate`
  - **Impact**: Sidebar collapsed state now persists correctly for new users

### Channel Categories Only Storing One Channel
- [X] BUG-002: Fix `AddChannelToCategory` UPSERT to properly reference existing row in UPDATE clause
  - **Issue**: `jsonb_set()` was referencing wrong table name, causing it to use EXCLUDED (inserted) values instead of existing row
  - **Root Cause**: In PostgreSQL UPSERT's DO UPDATE clause, unqualified table name references the existing row, but schema-qualified names may cause ambiguity
  - **Fix**: Use `user_chat_config.channel_categories` (without schema prefix) and wrap with `COALESCE(..., '{}'::jsonb)` for safety
  - **Files**: `backend/database/scripts/chat.query.sql`
  - **Regenerate**: `cd backend && sqlc generate`
  - **Impact**: Multiple channels can now be added to categories correctly
  - **Required**: Users must clear existing corrupted data or test with fresh user account

### UnifiedChannelSearch Not Adding Channels to Categories
- [X] BUG-003: Fix `UnifiedChannelSearch` to pass `channelType` when selecting channels
  - **Issue**: When selecting a channel from search results, it wasn't being added to categories
  - **Root Cause**: `onChannelSelect` callback wasn't passing `channelType` parameter, so `addChannelToCategory` was never called
  - **Fix**: Update callback signature to accept `channelType` and pass it from search results
  - **Files**: 
    - `frontend/apps/web/src/app/workspace/chat/components/UnifiedChannelSearch.tsx`
  - **Impact**: Channels selected from search are now properly added to categories

### Channels Accessed via URL Not Added to Categories
- [X] BUG-004: Add auto-categorization when viewing channels via direct URL navigation
  - **Issue**: When navigating to a channel via URL (e.g., notification links), it wasn't added to categories
  - **Root Cause**: Only click handlers in sidebar/search were calling `addChannelToCategory`, not URL-based navigation
  - **Fix**: Add `useEffect` in `ChatPage` that watches `activeChannelId` and auto-adds to categories when rendered
  - **Architecture**: 
    - ChatPage `useEffect`: Catches all channel views (URL, deep links, bookmarks)
    - Sidebar click handlers: Optimization for instant feedback (kept as backup)
  - **Files**: 
    - `frontend/apps/web/src/app/workspace/chat/page.tsx`
    - `frontend/apps/web/src/app/workspace/chat/components/ChannelSidebar.tsx` (added comment)
  - **Impact**: All channel access paths now correctly update categories (robust solution)

### Infinite Loop When Auto-Adding Channels to Categories
- [X] BUG-005: Fix infinite loop in ChatPage useEffect dependency array
  - **Issue**: After navigating via global search, continuous requests to list messages (infinite loop)
  - **Root Cause**: `useEffect` dependency array included `addToCategoryMutation` which is recreated on every render
  - **Loop Flow**: Effect runs → mutation → invalidateQueries → config/recentChannels refetch → effect runs again
  - **Fix**: Remove `addToCategoryMutation` from dependency array (mutation function is stable, doesn't need to be a dependency)
  - **Files**: `frontend/apps/web/src/app/workspace/chat/page.tsx`
  - **Impact**: Effect only runs when `activeChannelId`, `config`, or `recentChannels` actually change

### "New messages" Badge Appearing When Scrolling Up
- [X] BUG-006: Fix "New messages" badge appearing incorrectly when loading older messages
  - **Issue**: When scrolling up in channel view to see older content, the "New messages" badge appears unexpectedly
  - **Root Cause**: VirtualizedMessageList was tracking `messages.length` to detect new messages, which increases both when:
    1. New messages arrive at the END (should show badge) ✅
    2. Old messages prepended at START via infinite scroll (should NOT show badge) ❌
  - **Fix**: Track last message ID (`messages[messages.length - 1].id`) instead of message count
    - Last message ID only changes when NEW messages arrive at the end
    - Prepending old messages doesn't change the last message ID
  - **Files**: `frontend/apps/web/src/app/workspace/chat/components/VirtualizedMessageList.tsx`
  - **Changes**:
    - Replaced `previousMessageCountRef` with `lastMessageIdRef`
    - Added logic to detect changes in last message ID only
    - Added debug logging to trace badge trigger conditions
  - **Impact**: Badge now only appears when actual new messages arrive, not when loading historical messages

### Infinite Scroll Stops at Middle (Cannot Load All Messages)
- [X] BUG-007: Fix infinite scroll stopping before reaching the beginning of message history
  - **Issue**: When scrolling up to see older messages, pagination stops in the middle even though more messages exist in database
  - **Root Cause 1 (Backend)**: Backend `ListMessages` was always returning `nextPageToken` when `len(messages) > 0`, even on the last page
    - React Query's `getNextPageParam` treats any non-empty token as "more data available"
    - When the last page is fetched, backend still returned a token, causing `hasNextPage = true`
    - But the next fetch with that token returns 0 messages, causing pagination to fail silently
  - **Root Cause 2 (Frontend)**: Virtuoso scroll position jumping when prepending items
    - Without `firstItemIndex` prop, Virtuoso treats data array as starting at index 0
    - When older messages are prepended, the array grows from the beginning
    - This causes scroll position to jump/reset, preventing further scroll-up
    - `startReached` callback may not fire correctly due to unstable indices
  - **Fix 1 (Backend)**: Only return `nextPageToken` when a FULL page of messages is returned (`len(messages) == pageSize`)
    - If fewer messages returned, it means we've reached the beginning (no more older messages)
    - This is the standard cursor pagination pattern for detecting end-of-data
  - **Fix 2 (Frontend)**: Configure Virtuoso for proper prepending behavior without `firstItemIndex`
    - **CRITICAL INSIGHT**: For simple prepending use case (chat app), DO NOT use `firstItemIndex` prop at all
      - ❌ WRONG: `firstItemIndex={10000000 - messages.length}` (recalculates, causes jumps)
      - ❌ WRONG: `firstItemIndex={CONSTANT}` (requires complex state tracking for prepending)
      - ✅ CORRECT: Omit `firstItemIndex` entirely, use `defaultItemHeight` + `increaseViewportBy` instead
    - Add `initialTopMostItemIndex={messages.length - 1}` to start at newest message
    - Add `defaultItemHeight={80}` for better scroll position estimation
    - Add `increaseViewportBy={{ top: 800, bottom: 200 }}` for smoother prepending
    - Fix `followOutput` to only auto-scroll when user is ALREADY at bottom (`return isAtBottom && atBottom ? 'smooth' : false`)
    - Remove manual `scrollToIndex` calls that conflict with Virtuoso's internal scroll management
    - Virtuoso automatically maintains scroll position when prepending with these settings
    - Allows `startReached` to fire correctly without jumps or unwanted auto-scrolls
  - **Files**: 
    - Backend: `backend/internal/chat/logic.go`
    - Frontend: `frontend/apps/web/src/app/workspace/chat/components/VirtualizedMessageList.tsx`
  - **Changes**:
    - Backend: Changed condition from `if len(messages) > 0` to `if len(messages) == int(pageSize)`
    - Backend: Added debug logging to track pagination state (more available vs reached end)
    - Frontend: **Removed `firstItemIndex` prop entirely** (simpler approach for chat prepending)
    - Frontend: Added `defaultItemHeight={80}` for scroll position estimation
    - Frontend: Added `increaseViewportBy={{ top: 800, bottom: 200 }}` for smooth prepending
    - Frontend: Added `initialTopMostItemIndex={messages.length - 1}` to start at newest message
    - Frontend: Fixed `followOutput` to only auto-scroll when user is at bottom (prevents unwanted scrolls)
    - Frontend: Removed manual scrollToIndex calls in useEffect to avoid conflicts with Virtuoso
    - Frontend: Added debug logging for `startReached`, `followOutput`, and `atBottomStateChange` callbacks
  - **Impact**: Users can now scroll all the way to the first message in channel history with smooth, stable scrolling (no jumps or resets)

## Enhancements

### Message Composer Formatting Toolbar
- [X] ENH-001: Add rich text formatting toolbar with emoji picker to MessageComposer
  - **Requirements**: 
    - Basic formatting tools: Bold (B), Italic (I), Underline (U), Bullet list, Numbered list, Code block, Link
    - Toggleable toolbar to save vertical space (show/hide with icon button)
    - Emoji picker with common emojis (50 emojis in grid)
    - Remove "Expand" functionality (editor auto-resizes)
  - **Implementation**:
    - Installed `@tiptap/extension-underline@^2.27.0` and `@tiptap/extension-link@^2.27.0`
    - Added TipTap extensions: Underline, Link
    - Added formatting button handlers for all text styles and lists
    - Created toggleable toolbar with Material-UI icons (EditIcon for toggle)
    - Created emoji picker with Popover component (grid layout, 10 columns)
    - Active state highlighting for formatting buttons (bgcolor: action.selected)
    - Removed expand/collapse functionality
    - Updated keyboard behavior: Shift+Enter for newline (always), plain Enter to send in compact mode only
  - **Files**: 
    - `frontend/apps/web/src/app/workspace/chat/components/MessageComposer.tsx`
    - `frontend/package.json` (added TipTap extensions)
  - **Impact**: Users can format messages with rich text, insert emojis easily, and toggle toolbar to save vertical space

### HTML Message Formatting with Server-Side Sanitization
- [X] ENH-002: Update schema to store sanitized HTML in message_text
  - **Requirements**:
    - Update `message_text` column comment to document it stores sanitized HTML
    - Plaintext messages (existing data) are valid HTML and render correctly
    - No separate column needed (simpler architecture, no duplication)
    - PGroonga automatically strips HTML tags for full-text search indexing
  - **Files**: `backend/database/scripts/schema.sql`
  - **Impact**: Schema documented to support HTML content in message_text

- [X] ENH-003: Create HTML sanitizer in backend
  - **Requirements**:
    - Create `sanitizeMessageHTML` function in `backend/internal/chat/sanitizer.go`
    - Use `bluemonday` package for HTML sanitization
    - Allow ONLY these tags: `<b>`, `<strong>`, `<i>`, `<em>`, `<u>`, `<code>`, `<pre>`, `<a href="">`, `<ul>`, `<ol>`, `<li>`, `<p>`, `<br>`
    - Strip all other tags, attributes (except `href` on `<a>`), JavaScript, styles
    - Handle plaintext input (no HTML) - pass through unchanged
    - Add unit tests in `sanitizer_test.go` for XSS prevention and plaintext handling
  - **Files**: `backend/internal/chat/sanitizer.go`, `backend/internal/chat/sanitizer_test.go`
  - **Dependencies**: `go get github.com/microcosm-cc/bluemonday`
  - **Impact**: Backend can safely sanitize user-provided HTML while preserving plaintext

- [X] ENH-004: Update SendMessage logic to sanitize HTML
  - **Requirements**:
    - In `SendMessage` logic layer, call `sanitizeMessageHTML(req.MessageText)` before storing
    - Store sanitized result in `message_text` column (replaces current plaintext storage)
    - Plaintext messages pass through unchanged (valid HTML)
    - No changes to SQL queries (still using message_text column)
  - **Files**: `backend/internal/chat/logic.go`
  - **Impact**: All new messages are sanitized (HTML stripped to safe subset, plaintext preserved)

- [X] ENH-005: Update ReplyToMessage logic to sanitize HTML
  - **Requirements**:
    - Similar to SendMessage, call `sanitizeMessageHTML(req.MessageText)` before storing
    - No SQL query changes needed
  - **Files**: `backend/internal/chat/logic.go`
  - **Impact**: All replies are sanitized

- [X] ENH-006: Update EditMessage logic to sanitize HTML
  - **Requirements**:
    - Call `sanitizeMessageHTML(req.NewText)` before updating message
    - Store sanitized version in both current message and edit_history
  - **Files**: `backend/internal/chat/logic.go`
  - **Impact**: Message edits are sanitized

- [X] ENH-007: Update MessageComposer to send HTML from TipTap
  - **Requirements**:
    - Get HTML from TipTap editor using `editor.getHTML()`
    - Send HTML string as `messageText` parameter (backend will sanitize)
    - Remove `editor.getText()` call (no longer needed, backend extracts plaintext if needed)
    - Update is straightforward - just change from `getText()` to `getHTML()`
  - **Files**: `frontend/apps/web/src/app/workspace/chat/components/MessageComposer.tsx`
  - **Impact**: Frontend sends formatted HTML to backend

- [X] ENH-008: Update MessageItem to render HTML safely
  - **Requirements**:
    - Render `message.messageText` as HTML (contains sanitized HTML or plaintext)
    - Use `dangerouslySetInnerHTML` (safe because backend sanitizes)
    - Apply consistent typography styles via CSS classes
    - Plaintext messages render correctly (text is valid HTML)
    - Test that old plaintext messages still display correctly
  - **Files**: `frontend/apps/web/src/app/workspace/chat/components/MessageItem.tsx`
  - **Implementation**:
    - Removed `renderMessageText()` function (manual mention highlighting)
    - Changed Typography component to use `dangerouslySetInnerHTML={{ __html: messageText }}`
    - Added `prose prose-sm max-w-none` CSS classes for rich text typography
    - Removed `whitespace-pre-wrap` (HTML handles its own whitespace)
  - **Bug Fix**: Removed obsolete `content_json` column from generated models
    - Deleted `backend/database/chat.query.sql.go` and `models.go`
    - Re-ran `sqlc generate` to regenerate from current schema
    - Fixed RPC error: `column m.content_json does not exist`
  - **Impact**: Users see formatted messages with rich text

- [ ] ENH-009: Add HTML sanitization integration tests
  - **Requirements**:
    - Test SendMessage with HTML containing XSS attempts (script tags, event handlers, onclick, etc.)
    - Verify sanitized HTML stored in `message_text` has no dangerous content
    - Test EditMessage with HTML
    - Test ReplyToMessage with HTML
    - Verify all allowed tags preserved, forbidden tags stripped
    - Test plaintext messages pass through unchanged
  - **Files**: `backend/internal/chat/sanitizer_test.go`, `backend/internal/chat/connect_test.go`
  - **Impact**: Verified that HTML sanitization prevents XSS attacks

- [ ] ENH-010: Manual verification of HTML formatting
  - **Verification Steps**:
    1. Open chat, format message with bold, italic, underline, lists, links
    2. Send message, verify it displays formatted correctly
    3. Reply to message with formatting, verify reply preserves formatting
    4. Edit formatted message, verify edits preserve formatting
    5. Test XSS attempt (try sending `<script>alert('xss')</script>`), verify it's stripped
    6. Verify existing plaintext messages (sent before this feature) still display correctly
  - **Document**: Verified behavior with screenshots/notes
  - **Impact**: Confirmed HTML formatting works correctly and safely

### Dependencies for HTML Formatting Tasks
- ENH-002 (schema docs) → ENH-003 (sanitizer implementation)
- ENH-003 (sanitizer) → ENH-004, ENH-005, ENH-006 (backend logic updates)
- ENH-004, ENH-005, ENH-006 (backend ready) → ENH-007 (frontend sends HTML)
- ENH-007 (frontend sends) → ENH-008 (frontend renders)
- ENH-008 (full flow working) → ENH-009 (tests)
- ENH-009 (tests pass) → ENH-010 (manual verification)

## Notes

- **[P] tasks** are in different files with no dependencies and can run in parallel
- **Schema changes first**: T001-T010 must complete before backend logic (sqlc-generated models needed)
- **Proto changes early**: T011-T015 must complete before RPC handlers (generated types needed)
- **MUST verify manually**: T044-T051 are REQUIRED gates before adding tests (Constitution v3.3.0)
- **Tests document verified behavior**: T052-T062 only after human verification confirms correctness
- **Commit after each task** to maintain atomic changes
- **Avoid vague tasks** and same-file conflicts

## Generated Artifacts & Codegen Tasks

This feature includes multiple codegen steps that MUST be completed before dependent implementation tasks:

1. **T010** (sqlc generate): Generates Go models from SQL queries → Blocks T021-T028 (backend logic)
2. **T015** (buf generate): Generates Go protobuf code → Blocks T024, T026 (RPC handlers)
3. **T018-T020** (frontend build + RPC re-exports): Generates TypeScript RPC client → Blocks T029-T043 (frontend components)

All generated files must be committed before moving to dependent implementation tasks.
