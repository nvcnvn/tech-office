
# Implementation Plan: Chat Frontend and Notification Integration

**Branch**: `010-chat-frontend-and-notification` | **Date**: 2025-10-29 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/010-chat-frontend-and-notification/spec.md`

## Execution Flow (/plan command scope)
```
1. Load feature spec from Input path
   → If not found: ERROR "No feature spec at {path}"
2. Fill Technical Context (scan for NEEDS CLARIFICATION)
   → Detect Project Type from file system structure or context (web=frontend+backend, mobile=app+api)
   → Set Structure Decision based on project type
3. Fill the Constitution Check section based on the content of the constitution document.
4. Evaluate Constitution Check section below
   → If violations exist: Document in Complexity Tracking
   → If no justification possible: ERROR "Simplify approach first"
   → Update Progress Tracking: Initial Constitution Check
5. Execute Phase 0 → research.md
   → If NEEDS CLARIFICATION remain: ERROR "Resolve unknowns"
6. Execute Phase 1 → contracts, data-model.md, quickstart.md, agent-specific template file (e.g., `CLAUDE.md` for Claude Code, `.github/copilot-instructions.md` for GitHub Copilot, `GEMINI.md` for Gemini CLI, `QWEN.md` for Qwen Code, or `AGENTS.md` for all other agents).
7. Re-evaluate Constitution Check section
   → If new violations: Refactor design, return to Phase 1
   → Update Progress Tracking: Post-Design Constitution Check
8. Plan Phase 2 → Describe task generation approach (DO NOT create tasks.md)
9. STOP - Ready for /tasks command
```

**IMPORTANT**: The /plan command STOPS at step 7. Phases 2-4 are executed by other commands:
- Phase 2: /tasks command creates tasks.md
- Phase 3-4: Implementation execution (manual or via tools)

## Summary

This feature implements the complete chat frontend experience with real-time notification integration. The chat backend (#009) is already implemented with channels, messages, reactions, and typing indicators. This plan focuses on:

**Frontend Implementation**:
- 3-column layout: left sidebar (channels), center (messages), right (thread view)
- Real-time message updates via existing SSE infrastructure
- Mention navigation from notifications to specific messages
- WYSIWYG Markdown editor for message composition (supporting both short and long-form content)
- Reaction UI, reply threading, typing indicators

**Backend Extensions**:
- Notification integration for @mentions and replies
- GetMessageById with channel membership validation
- MarkChannelAsRead for unread tracking
- SSE event extensions for typing indicators and chat events
- Mention parsing and validation

**Technical Approach**:
- Leverage existing notification SSE connection from workspace layout
- Add chat-specific event handling to existing notification stream
- Use MUI components for consistent UI/UX
- Implement efficient message pagination and caching
- Find and integrate a suitable WYSIWYG Markdown editor library (e.g., TipTap, Lexical, or similar)

## Technical Context
**Project Type**: web (frontend + backend monorepo)  
**Frontend Stack**: 
- Language: TypeScript 5.x
- Framework: Next.js 15 (App Router)
- UI Library: Material-UI (MUI) v5
- Package Manager: pnpm workspace
- Testing: Vitest, React Testing Library
- Markdown Editor: TipTap or Lexical (WYSIWYG with Markdown support) - to be researched

**Backend Stack**:
- Language: Go 1.25+
- Database: PostgreSQL 18+ (multi-tenant, schema-per-domain: `chat` schema)
- ORM: sqlc (type-safe SQL code generation)
- RPC: Protocol Buffers + ConnectRPC
- Auth: Zitadel integration
- Workflow: https://github.com/nvcnvn/flows
- Testing: Go testing with testify

**Infrastructure**:
- Container: Docker
- Orchestration: Kubernetes (StackGres for PostgreSQL)
- Migration: Atlas
- Deployment: dev/prod overlays

**Performance Goals**: 
- Message load <300ms p95
- Typing indicator latency <100ms
- SSE reconnect <1s
- Smooth scrolling with 1000+ messages via virtual scrolling

**Constraints**: 
- Multi-tenant isolation via `organization_id`
- SSE connection managed by workspace layout (single connection for all features)
- Chat must integrate with existing notification hub infrastructure
- Backend chat service already implemented (feature #009)
- Two-layer backend architecture (logic + connect layers)

**Scale/Scope**: 
- 10k organizations
- 100k users
- 50 channels per user average
- 10k messages per channel average
- Real-time delivery target: <60s SLA

**User Input from Arguments**:
- Chat input should support WYSIWYG Markdown format for both short and long-form messages
- Need to research and select appropriate editor library with Markdown support

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Backend Service Architecture Checks
This plan involves extending the existing chat backend service (feature #009):
- [x] Service implements two-layer architecture: Logic layer (business logic) + Connect layer (RPC handlers) - Already implemented in #009
- [x] Logic layer has NO connection pools (only Queries and NotificationLogic dependencies) - Verified in chat/logic.go
- [x] Logic layer methods accept `tx database.DBTX` parameter for all database operations - Verified
- [x] Logic layer receives parsed auth context as parameters (employeeID, orgID) not raw request context - Verified
- [x] Connect layer owns both `AdminPool` and `TenantPool` - Verified in chat/connect.go
- [x] Connect layer extracts auth context from request and passes to logic layer - Verified
- [x] Connect layer manages transactions using `txn.WithTxn` helper - Verified
- [x] Connect layer chooses appropriate pool: TenantPool for user operations, AdminPool for system operations - Verified (uses TenantPool)
- [N/A] AdminPool usage is documented with justification - Not used in chat service (all user-facing)
- [x] All tenant-data queries include `organization_id` filters - Verified in database/chat.query.sql
- [x] Simple authorization uses proto-level `access_control` options where appropriate - Verified in chat.proto

**Extensions Needed**:
- [ ] Add GetMessageById method to chat logic layer with channel membership validation
- [ ] Add MarkChannelAsRead method to track last viewed message per member
- [ ] Integrate NotificationLogic.PublishNotification for @mentions (TODO markers exist)
- [ ] Add mention parsing utility function in chat logic layer

### Cross-Domain Integration Checks
This plan involves chat backend calling notification logic for mentions/replies:
- [x] Avoid SQL-level cross-schema data access; use service logic layer methods instead - NotificationLogic interface already injected
- [x] Reuse existing logic layer methods rather than duplicating SQL queries or domain logic - Will use NotificationLogic.PublishNotification
- [x] Services depend on other services' **logic layer interfaces** (not connect layer) - Verified: chat depends on notification.NotificationLogic
- [x] Declare logic layer dependencies in logic layer constructor (connect layer is separate) - Verified in NewChatLogic
- [x] Initialize logic layers first, then wrap with connect layers in `backend/cmd/server.go` - Verified (notifLogic → chatLogic → chatConnect)
- [x] Cross-domain calls use direct Go method invocations on logic layer (NOT RPC layer internally) - Will call s.NotificationLogic.PublishNotification
- [x] Explicitly document context propagation: user-scope (request context) vs system-scope (background context) - User-scope for all chat operations
- [x] User-scope calls MUST pass request context through logic layers to preserve organization_id and auth claims - Verified: ctx passed through
- [N/A] System-scope calls MUST justify why system context is needed and document in code comments - Not applicable (all user-scope)
- [x] Cross-domain logic methods are stable, well-defined, and versioned if breaking changes needed - NotificationLogic interface is stable
- [x] All cross-domain calls include structured logging with source/target service and operation - Will add slog calls
- [x] Logic layer methods accept `tx database.DBTX` parameter to support atomic cross-domain operations - Verified
- [x] Connect layer passes same transaction to multiple logic layer calls when atomicity is required - Verified in chat/connect.go
- [x] NEVER nest `txn.WithTxn` calls; only connect layer manages transactions - Verified: logic layer receives tx parameter

### Codegen & Generated-Client Checks
This plan requires proto changes and frontend regeneration:
- [ ] SQL changes => `cd backend && sqlc generate` (commit generated outputs) - YES, new queries for GetMessageById and MarkChannelAsRead
- [ ] Proto changes => `cd backend && buf generate` (commit backend generated outputs) - YES, extending chat.proto with new methods
- [ ] Frontend package `frontend/packages/rpc` will be updated after proto changes - YES, must re-export new chat service methods
- [ ] Frontend build step (`pnpm -r build` or `pnpm -w -r build`) to refresh workspace artifacts - YES, required after proto update
- [ ] CI validation of generated clients - Will be included in PR checklist

**Constitution Compliance**: ✅ PASS - All checks satisfied or planned
When the plan requires DB schema changes or new/updated RPC contracts, include explicit codegen steps in the plan and mark them as prerequisites for implementation:
- SQL changes => `cd backend && sqlc generate` (commit generated outputs)
- Proto changes => `cd backend && buf generate` (commit backend generated outputs)
- After proto changes, the frontend package `frontend/packages/rpc` will be updated; the plan MUST include re-exporting new services from `frontend/packages/rpc/index.ts` and a frontend build step (`pnpm -r build` or `pnpm -w -r build`) so workspace artifacts are refreshed.

These checks are enforced by the Constitution Check gate: plans that modify schemas or proto contracts MUST document how generated clients are produced and validated in CI.

## Project Structure

### Documentation (this feature)
```
specs/[###-feature]/
├── plan.md              # This file (/plan command output)
├── research.md          # Phase 0 output (/plan command)
├── data-model.md        # Phase 1 output (/plan command)
├── quickstart.md        # Phase 1 output (/plan command)
├── contracts/           # Phase 1 output (/plan command)
└── tasks.md             # Phase 2 output (/tasks command - NOT created by /plan)
```

### Source Code (Tech Office Monorepo)

**Backend Structure** (Extensions to existing chat service #009):
```
backend/
├── database/
│   ├── scripts/
│   │   ├── chat.query.sql          # [MODIFY] Add GetMessageById, MarkChannelAsRead, ParseMentions queries
│   ├── chat.query.sql.go           # [GENERATED by sqlc]
│   └── models.go                   # [GENERATED by sqlc]
├── internal/
│   └── chat/                       # [MODIFY existing service]
│       ├── logic.go                # [MODIFY] Add notification integration, GetMessageById, MarkChannelAsRead
│       ├── connect.go              # [MODIFY] Add RPC handlers for new methods
│       ├── helpers.go              # [MODIFY] Add mention parsing utilities
│       ├── logic_test.go           # [ADD] Unit tests for new logic
│       └── connect_test.go         # [ADD] Integration tests for new endpoints
├── rpc/
│   └── v1/
│       ├── chat.proto              # [MODIFY] Add GetMessageById, MarkChannelAsRead RPCs
│       ├── chat.pb.go              # [GENERATED from proto]
│       └── chat_connect.pb.go      # [GENERATED from proto]

Database Schemas Involved: 
- chat.channel
- chat.channel_membership (extend with last_viewed_message_id, last_viewed_at)
- chat.message
- notification.notification (for @mention notifications)
- organization.employee (for mention validation)

**Backend Changes Summary**:
1. Proto additions: GetMessageById, MarkChannelAsRead methods
2. sqlc queries: GetMessageByIdWithChannel, UpdateChannelMembershipLastViewed, GetEmployeesByUsernames
3. Logic layer: Implement TODO comments for notification integration
4. Helpers: Add mention parsing (@username extraction and validation)
```

**Frontend Structure**:
```
frontend/
├── apps/
│   └── web/
│       └── src/
│           └── app/
│               └── workspace/
│                   ├── layout.tsx              # [MODIFY] Enable chat tab, add chat event handlers
│                   └── chat/                   # [ADD] New chat domain
│                       ├── page.tsx            # [ADD] Main chat page with 3-column layout
│                       ├── README.md           # [ADD] Chat feature documentation
│                       ├── components/         # [ADD] Chat-specific components
│                       │   ├── ChatSidebar.tsx           # [ADD] Channel list sidebar
│                       │   ├── ChannelList.tsx           # [ADD] Channel list with unread badges
│                       │   ├── CreateChannelDialog.tsx   # [ADD] Channel creation form
│                       │   ├── ChannelSettings.tsx       # [ADD] Channel settings panel
│                       │   ├── MessageList.tsx           # [ADD] Virtual scrolling message list
│                       │   ├── MessageItem.tsx           # [ADD] Individual message component
│                       │   ├── MessageComposer.tsx       # [ADD] WYSIWYG Markdown editor
│                       │   ├── ReactionPicker.tsx        # [ADD] Emoji reaction selector
│                       │   ├── ThreadView.tsx            # [ADD] Right panel for thread view
│                       │   ├── TypingIndicator.tsx       # [ADD] "User is typing..." indicator
│                       │   └── MentionAutocomplete.tsx   # [ADD] @mention autocomplete
│                       ├── hooks/              # [ADD] Chat-specific hooks
│                       │   ├── useChannel.ts             # [ADD] Channel data management
│                       │   ├── useMessages.ts            # [ADD] Message list with pagination
│                       │   ├── useReactions.ts           # [ADD] Reaction management
│                       │   ├── useTyping.ts              # [ADD] Typing indicator state
│                       │   └── useMentions.ts            # [ADD] Mention parsing and navigation
│                       ├── utils/              # [ADD] Chat utilities
│                       │   ├── markdown.ts              # [ADD] Markdown parsing utilities
│                       │   ├── mentions.ts              # [ADD] Mention detection
│                       │   └── scroll.ts                # [ADD] Scroll position management
│                       └── types.ts            # [ADD] Chat-specific TypeScript types
└── packages/
    ├── apis/                            # [MODIFY] Add chat client utilities
    │   └── src/
    │       └── chat.ts                  # [ADD] Chat API client with type assertions
    ├── notifications/                   # [MODIFY] Extend for chat events
    │   └── src/
    │       ├── types.ts                 # [MODIFY] Add chat event types
    │       ├── useSSEConnection.ts      # [MODIFY] Add chat event handlers
    │       └── useChatEvents.ts         # [ADD] Chat-specific event hook
    └── rpc/                             # [GENERATED from backend protos]
        ├── index.ts                     # [MODIFY] Re-export chat service updates
        └── rpc/v1/
            ├── chat_pb.ts               # [GENERATED] Updated chat messages
            └── chat_connect.ts          # [GENERATED] Updated chat service

**Frontend Architecture Notes**:
- Main layout: `/workspace/chat/page.tsx` implements 3-column responsive grid
- Left sidebar (256px fixed): Channel list with search, create button, unread badges
- Center area (flex-grow): Message list (virtual scroll) + message composer (WYSIWYG Markdown)
- Right panel (320px, collapsible): Thread view for focused reply context
- SSE integration: Workspace layout manages connection, chat subscribes to events
- State management: React hooks + TanStack Query for server state
- Real-time: SSE events update local state, optimistic UI for sends
- Markdown editor: TipTap or Lexical with Markdown plugin (to be researched in Phase 0)
```

**Testing Structure**:
```
backend/
└── internal/chat/
    ├── logic_test.go               # [ADD] Unit tests for notification integration, new methods
    ├── connect_test.go             # [ADD] Integration tests for GetMessageById, MarkChannelAsRead
    └── helpers_test.go             # [ADD] Tests for mention parsing

frontend/apps/web/src/app/workspace/chat/
└── components/
    ├── ChatSidebar.test.tsx        # [ADD] Component tests
    ├── MessageList.test.tsx        # [ADD] Component tests with virtual scrolling
    ├── MessageComposer.test.tsx    # [ADD] Tests for WYSIWYG editor
    └── ThreadView.test.tsx         # [ADD] Component tests
```

**Structure Decision**: Extend existing chat backend service with notification integration and build complete frontend chat UI following Tech Office workspace patterns:
- Backend extends feature #009 (chat backend) with notification hooks
- Frontend creates new `/workspace/chat` domain with 3-column layout
- Reuse existing SSE infrastructure from notification hub
- Follow MUI theme and workspace layout patterns
- Implement WYSIWYG Markdown editor for message composition

## Phase 0: Outline & Research
*Prerequisites: None - Initial research phase*

### Research Tasks

**1. WYSIWYG Markdown Editor Selection** [CRITICAL]:
   - **Question**: Which editor library best supports both short messages and long-form WYSIWYG Markdown?
   - **Candidates**: 
     * TipTap (ProseMirror-based, extensible, good Markdown support)
     * Lexical (Meta's framework-agnostic, modern architecture)
     * Slate (React-first, fully customizable)
     * SimpleMDE (lightweight, pure Markdown)
   - **Evaluation Criteria**:
     * Bundle size impact (<100KB gzipped preferred)
     * React/Next.js integration quality
     * Markdown bidirectional conversion
     * @mention support/extensibility
     * Emoji picker integration
     * Mobile responsiveness
     * TypeScript support
     * Active maintenance and community
   - **Decision Target**: Select one editor and document integration approach

**2. Virtual Scrolling Library** [IMPORTANT]:
   - **Question**: How to efficiently render 1000+ messages with smooth scrolling?
   - **Candidates**:
     * react-window (lightweight, well-tested)
     * react-virtuoso (feature-rich, reverse scroll support)
     * TanStack Virtual (modern, framework-agnostic core)
   - **Evaluation Criteria**:
     * Reverse scrolling support (chat messages bottom-up)
     * Dynamic height items (messages vary in size)
     * "Scroll to bottom" on new message
     * "Load more" at top when scrolling up
     * Integration with React Query
   - **Decision Target**: Select virtual scroll library

**3. SSE Chat Event Schema** [CRITICAL]:
   - **Question**: How to extend existing NotificationEvent for chat-specific events?
   - **Existing Schema**: NotificationEvent with event_type and notification payload
   - **Required Chat Events**:
     * `message_created` - New message in channel
     * `message_updated` - Message edited
     * `message_deleted` - Message deleted
     * `reaction_added` - Reaction added to message
     * `reaction_removed` - Reaction removed
     * `typing_indicator` - User typing in channel (ephemeral, 5s TTL)
     * `channel_updated` - Channel settings changed
     * `member_joined` - User joined channel
     * `member_left` - User left channel
   - **Design Decision**:
     * Option A: Add chat_event field to NotificationEvent (union type)
     * Option B: Use action_data map in notification for chat events
     * Option C: Create separate SSE endpoint for chat events
   - **Recommendation**: Option B - reuse notification infrastructure, add chat-specific action_data payloads
   - **Verification**: Check backend notification.proto extensibility

**4. Unread Message Tracking** [IMPORTANT]:
   - **Question**: How to efficiently track and display unread message counts per channel?
   - **Approaches**:
     * Option A: Client-side tracking (last_viewed_message_id in local storage)
     * Option B: Server-side tracking (channel_membership.last_viewed_at)
     * Option C: Hybrid (server persists, client caches)
   - **Considerations**:
     * Multi-device sync requirements
     * Real-time updates when messages arrive
     * Efficient query for "unread count" badge
     * "Mark all as read" bulk operation
   - **Recommendation**: Option C - server persists last_viewed_message_id in channel_membership, client caches and optimistically updates
   - **Schema Changes**: Add `last_viewed_message_id UUID`, `last_viewed_at TIMESTAMPTZ` to `chat.channel_membership`

**5. Mention Detection & Navigation** [IMPORTANT]:
   - **Question**: How to implement @mention detection, autocomplete, and notification navigation?
   - **Components**:
     * **Parsing**: Regex to extract @username from message text
     * **Validation**: Check mentioned users exist in organization and are channel members
     * **Autocomplete**: Show channel member list filtered by typed text
     * **Rendering**: Highlight @mentions in message display
     * **Navigation**: Jump to message from notification action_data
   - **Integration Points**:
     * Backend: Parse mentions in SendMessage/ReplyToMessage, call NotificationLogic.PublishNotification
     * Frontend: Autocomplete in message composer, render mentions with styling, handle notification click
   - **Decision Target**: Define mention syntax (@username only, no @channel/@here for MVP)

**6. Thread View Auto-Open/Close Logic** [UX]:
   - **Question**: When should the right thread panel automatically open or close?
   - **User Scenarios**:
     * User clicks "Reply" on message → Open thread with that message
     * User clicks existing reply count → Open thread with parent message
     * User sends message in channel (not reply) → Keep thread open (don't auto-close)
     * User switches channels → Close thread
     * User presses Escape → Close thread
     * User clicks outside thread panel → Do NOT auto-close (explicit action required)
   - **Design Decision**: 
     * Auto-open: On "Reply" click or reply count click
     * Auto-close: On channel switch or Escape key
     * Manual close: X button on thread panel
   - **Mobile Behavior**: Thread view replaces message list (full-width modal)

**7. Typing Indicator Debouncing** [PERFORMANCE]:
   - **Question**: How to implement efficient typing indicators without overwhelming the server?
   - **Requirements**:
     * Send "start typing" on first keystroke
     * Debounce: Don't send more events until 3s idle
     * Send "stop typing" after 5s idle or on send/blur
     * Server auto-expires indicators after 5s (no explicit stop needed)
   - **Implementation**:
     * Client: Debounce with 3s delay, track last sent timestamp
     * Backend: Ephemeral state (Redis or in-memory), auto-expire after 5s
     * SSE: Broadcast typing events only to channel members
   - **Decision Target**: Use in-memory state for MVP (Redis for production scale)

**8. Emoji Reaction Picker** [UX]:
   - **Question**: Which emoji picker library to use?
   - **Candidates**:
     * Native browser emoji picker (minimal, OS-dependent UX)
     * emoji-mart (popular, customizable)
     * emoji-picker-react (React-specific)
   - **Evaluation Criteria**:
     * Bundle size
     * Custom emoji support (future)
     * Recently used emojis
     * Search functionality
   - **Decision Target**: Use native for MVP, evaluate emoji-mart for v2

### Tech Office Specific Research

**9. Existing MUI Patterns**:
   - Review `workspace/organization/` for sidebar, dialog, and table patterns
   - Review `workspace/notifications/` for SSE integration patterns
   - Review `packages/notifications/useSSEConnection.ts` for event handling

**10. Frontend API Client Patterns**:
   - Review `packages/apis/src/` for type assertion wrappers
   - Pattern: Import generated RPC types, wrap with type assertions, export typed functions
   - Example: `packages/apis/src/organization.ts`

**11. Backend Notification Integration**:
   - Review `backend/internal/notification/logic.go` for PublishNotification interface
   - Review `backend/rpc/v1/notification.proto` for action_data structure
   - Verify: action_data supports arbitrary key-value pairs (YES)
   - Required keys for chat mentions: `channelId`, `messageId`, `action`=`view_message`

**12. Database Query Patterns**:
   - Review `backend/database/scripts/chat.query.sql` for existing query patterns
   - Verify: All queries include `organization_id` filter (YES)
   - Pattern: Use `-- name: MethodName :one/:many/:exec` for sqlc generation

### Research Output Format

For each research task, document in `research.md`:
- **Decision**: What was chosen
- **Rationale**: Why chosen - performance, bundle size, maintainability, Tech Office patterns
- **Alternatives Considered**: What else was evaluated
- **Integration Plan**: How to integrate with existing Tech Office architecture
- **Dependencies**: New packages to add to package.json/go.mod
- **Migration Notes**: Any breaking changes or deprecations

**Output**: `research.md` with all decisions documented, ready for Phase 1 design

## Phase 1: Design & Contracts
*Prerequisites: research.md complete*

1. **Database Schema Design** → `data-model.md`:
   - **Schema Selection**: Which domain schema(s) (iam, organization, finance, crm, support, etc.)?
   - **Entity Design**: 
     - Table name (plural, snake_case)
     - Primary key (UUID v7)
     - Foreign keys (organization_id REQUIRED for multi-tenant isolation)
     - Timestamps (created_at, updated_at, deleted_at for soft deletes)
     - JSONB fields for flexible metadata
   - **Relationships**:
     - References to central entities (organization.employee, organization.customer)
     - Cross-schema foreign keys
     - One-to-many, many-to-many relationships
   - **Indexes**: Performance-critical queries
   - **Constraints**: CHECK constraints, NOT NULL, UNIQUE
   - **Migration Strategy**: Atlas migration from schema.sql changes

2. **RPC Contract Design** → `/contracts/`:
   - **Protocol Buffer Definitions** (`.proto` files):
     - Service definitions with methods
     - Request/Response message types
     - Validation rules (buf validate)
     - RBAC annotations for access control
   - **Generated Code Locations**:
     - Backend: `backend/rpc/v1/[feature].pb.go`
     - Frontend: `frontend/packages/rpc/rpc/v1/[feature]_pb.ts`

3. **Backend Service Architecture**:
   - **Service Struct Design**:
     - Include `AdminPool database.AdminDatabaseConnector` for system-scope operations
     - Include `TenantPool database.TenantDatabaseConnector` for tenant-aware operations
     - Include `Queries *database.Queries` for sqlc-generated methods
     - Include external clients as needed (e.g., `ZClient *zitadelcli.Client`)
   - **Method Implementation**:
     - Document which pool each method uses (AdminPool vs TenantPool)
     - Use `TenantPool` for user-facing operations (default for most methods)
     - Use `AdminPool` for system operations (onboarding, background jobs, cross-tenant)
     - Always use `txn.WithTxn(ctx, pool, func(ctx context.Context, tx database.DBTX) error {...})` for transactions
     - Never manually call `Begin()`, `Commit()`, or `Rollback()`
   - **Tenant Isolation**:
     - TenantPool methods MUST validate organization context from auth token
     - AdminPool methods MUST document why system scope is required
     - All queries MUST include `organization_id` filters for tenant data

4. **API Endpoint Design** (if REST needed):
   - For each user action → endpoint
   - Follow ConnectRPC patterns for RPC
   - Authentication: Bearer token from Zitadel
   - Authorization: Check organization context + RBAC

5. **sqlc Query Design**:
   - SQL queries in `backend/database/scripts/[domain].query.sql`
   - Name queries: `-- name: GetFeatureByID :one`
   - Always include `organization_id` in WHERE clauses for tenant isolation
   - Use prepared statements (`:param` syntax)

6. **Frontend Component Design**:
   - Page components (`page.tsx`) with App Router patterns
   - Reuse existing MUI theme and components
   - Auth context integration (`useAuth()`)
   - Tenant check hooks (`useTenantCheck()`)
   - API client utilities in `packages/apis/`

7. **Generate contract tests** from contracts:
   - Backend: Go unit tests for service methods
   - Backend: Integration tests with test database
   - Frontend: Component tests with React Testing Library
   - E2E: Quickstart test scenarios

8. **Extract test scenarios** from user stories:
   - Each story → integration test scenario
   - Multi-tenant isolation verification
   - RBAC permission checks
   - Quickstart test = story validation steps

8. **Update agent file incrementally** (O(1) operation):
   - Run `.specify/scripts/bash/update-agent-context.sh copilot`
     **IMPORTANT**: Execute it exactly as specified above. Do not add or remove any arguments.
   - If exists: Add only NEW tech from current plan
   - Preserve manual additions between markers
   - Update recent changes (keep last 3)
   - Keep under 150 lines for token efficiency
   - Output to `.github/copilot-instructions.md`

**Output**: 
- `data-model.md` with complete schema design
- `/contracts/*.proto` for RPC definitions
- `/contracts/*.sql` for sqlc queries
- `quickstart.md` with test scenarios
- `.github/copilot-instructions.md` updated
- Failing test stubs (Go and TypeScript)

## Phase 2: Task Planning Approach
*This section describes what the /tasks command will do - DO NOT execute during /plan*

**Task Generation Strategy**:
- Load `.specify/templates/tasks-template.md` as base
- Generate tasks from Phase 1 design docs (contracts, data model, quickstart)
- Follow Tech Office development workflow with implementation-first ordering

### Backend Tasks (Extensions to Feature #009)

**Database & Schema**:
1. Add unread tracking columns to `chat.channel_membership` [P] - SQL migration
2. Generate Atlas migration: `./scripts/atlas/01_migration_create.sh add_chat_unread_tracking` [depends on 1]
3. Apply migration: `./scripts/atlas/02_migrate_apply.sh` [depends on 2]
4. Verify indexes created with EXPLAIN ANALYZE [depends on 3]

**sqlc Queries**:
5. Add GetMessageByIdWithChannel query to `chat.query.sql` [P]
6. Add UpdateChannelMembershipLastViewed query [P]
7. Add GetEmployeesByUsernames query [P]
8. Add CheckChannelMembership query [P]
9. Add GetUnreadMessageCount query [P]
10. Run `sqlc generate` to regenerate Go models [depends on 5-9]

**Proto Extensions**:
11. Add GetMessageById RPC method to `chat.proto` [P]
12. Add MarkChannelAsRead RPC method to `chat.proto` [P]
13. Extend ChannelMembership message with unread fields [depends on 11,12]
14. Extend Message message with mention fields [depends on 11,12]
15. Run `buf generate` to regenerate Go/TypeScript code [depends on 11-14]

**Backend Logic Implementation**:
16. Add mention parsing utility in `chat/helpers.go` [P]
17. Implement GetMessageById in chat logic layer [depends on 10,16]
18. Add channel membership validation in GetMessageById [depends on 17]
19. Implement MarkChannelAsRead in chat logic layer [depends on 10]
20. Integrate NotificationLogic.PublishNotification in SendMessage for @mentions [depends on 10,16]
21. Integrate NotificationLogic.PublishNotification in ReplyToMessage for replies [depends on 10]
22. Add typing indicator handlers (StartTyping, StopTyping) [depends on 10]

**Backend Connect Layer**:
23. Add GetMessageById RPC handler in `chat/connect.go` [depends on 17,18]
24. Add MarkChannelAsRead RPC handler in `chat/connect.go` [depends on 19]
25. Update existing handlers to call notification logic [depends on 20,21,22]

**Backend Testing**:
26. Unit tests for mention parsing utility [depends on 16]
27. Unit tests for GetMessageById logic [depends on 17,18]
28. Unit tests for MarkChannelAsRead logic [depends on 19]
29. Unit tests for notification integration [depends on 20,21]
30. Integration tests for GetMessageById RPC [depends on 23]
31. Integration tests for MarkChannelAsRead RPC [depends on 24]
32. Integration tests for mention notifications [depends on 25]

### Frontend Tasks

**Package Setup & Dependencies**:
33. Install TipTap packages: `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-markdown`, `@tiptap/extension-mention` [P]
34. Install react-virtuoso for virtual scrolling [P]
35. Update `frontend/packages/rpc/index.ts` to re-export updated chat service [depends on 15]
36. Run `pnpm -r build` to refresh workspace artifacts [depends on 35]

**API Client Layer**:
37. Add getMessageById to `packages/apis/src/chat.ts` [depends on 36]
38. Add markChannelAsRead to `packages/apis/src/chat.ts` [depends on 36]
39. Add mention navigation handler to chat utils [depends on 37]

**Notification Integration**:
40. Extend `packages/notifications/src/types.ts` with chat event types [P]
41. Add useChatEvents hook in `packages/notifications/src/` [depends on 40]
42. Update workspace layout SSE handler for chat events [depends on 41]

**Chat Page Structure**:
43. Create `/workspace/chat/page.tsx` with 3-column layout [P]
44. Enable chat tab in `workspace/layout.tsx` tabs array [P]
45. Create chat types in `/workspace/chat/types.ts` [P]

**Chat Sidebar Components**:
46. Create `ChatSidebar.tsx` component (256px left column) [depends on 43,45]
47. Create `ChannelList.tsx` with unread badges [depends on 46]
48. Create `CreateChannelDialog.tsx` form component [depends on 46]
49. Create `ChannelSettings.tsx` panel [depends on 46]

**Message List Components**:
50. Create `MessageList.tsx` with react-virtuoso [depends on 43,45]
51. Create `MessageItem.tsx` for individual messages [depends on 50]
52. Create `ReactionPicker.tsx` with native emoji input [depends on 51]
53. Add message hover actions (reply, react, edit, delete) [depends on 51]

**Message Composer**:
54. Create `MessageComposer.tsx` with TipTap editor [depends on 43,45]
55. Add Markdown support with `@tiptap/extension-markdown` [depends on 54]
56. Add mention autocomplete with `@tiptap/extension-mention` [depends on 54]
57. Add typing indicator detection (3s debounce) [depends on 54]
58. Add Cmd+Enter for send, Enter for newline in expanded mode [depends on 54]

**Thread View Components**:
59. Create `ThreadView.tsx` right panel component (320px) [depends on 43,45]
60. Add auto-open logic on reply click [depends on 59]
61. Add auto-close on channel switch or Escape [depends on 59]
62. Add thread-specific message composer [depends on 59]

**Real-Time Features**:
63. Create `TypingIndicator.tsx` component [depends on 50]
64. Add useTyping hook for typing state management [depends on 63]
65. Integrate SSE events for new messages [depends on 42,50]
66. Integrate SSE events for reactions [depends on 42,51]
67. Integrate SSE events for typing indicators [depends on 42,63]

**Chat Hooks**:
68. Create useChannel hook for channel data [depends on 37,38]
69. Create useMessages hook with infinite query [depends on 37]
70. Create useReactions hook for reaction management [depends on 37]
71. Create useMentions hook for mention parsing and navigation [depends on 39]

**Utilities**:
72. Create markdown parsing utilities in `utils/markdown.ts` [P]
73. Create mention detection utilities in `utils/mentions.ts` [P]
74. Create scroll position management in `utils/scroll.ts` [P]

**Styling & Responsiveness**:
75. Add mobile responsive styles (<768px breakpoints) [depends on 43]
76. Add thread view mobile modal behavior [depends on 59]
77. Add sidebar collapse on mobile (hamburger menu) [depends on 46]

**Component Testing**:
78. Add tests for ChatSidebar component [depends on 46]
79. Add tests for MessageList with virtual scrolling [depends on 50]
80. Add tests for MessageComposer with TipTap [depends on 54]
81. Add tests for ThreadView component [depends on 59]
82. Add tests for mention parsing utilities [depends on 73]

### Integration Testing

83. E2E test: Basic chat navigation (Scenario 1) [depends on 43-49]
84. E2E test: Send and receive messages (Scenario 2) [depends on 50-57]
85. E2E test: @Mention notification and navigation (Scenario 3) [depends on 56,65,71]
86. E2E test: Reply threading (Scenario 4) [depends on 59-62]
87. E2E test: Reactions (Scenario 5) [depends on 52,70]
88. E2E test: Unread tracking (Scenario 6) [depends on 47,68]
89. E2E test: Typing indicators (Scenario 7) [depends on 63-64,67]
90. E2E test: WYSIWYG editor (Scenario 8) [depends on 54-58]
91. E2E test: Virtual scrolling performance (Scenario 9) [depends on 50]
92. E2E test: Mobile responsive (Scenario 10) [depends on 75-77]

### Documentation

93. Create chat feature README.md [P]
94. Update main README with chat feature documentation [P]
95. Document keyboard shortcuts (Cmd+5 for chat, Escape to close thread) [P]

**Ordering Strategy**:
- Backend first: Schema → Queries → Logic → Connect → Tests
- Frontend after backend: API Client → Components → Hooks → Tests
- Mark [P] for parallelizable tasks (independent implementations)
- Generated code tasks always depend on definition tasks
- Tests added after core functionality verified by human
- E2E tests run last after all components integrated

**Estimated Task Count**: 95 numbered tasks  
**Estimated Effort**: 
- Backend: ~3-4 days (mostly implementing TODOs, adding queries)
- Frontend: ~7-10 days (new UI from scratch with TipTap integration)
- Testing: ~2-3 days (after human verification)
- **Total**: ~12-17 days for complete implementation

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan

## Phase 3+: Future Implementation
*These phases are beyond the scope of the /plan command*

**Phase 3**: Task execution (/tasks command creates tasks.md)  
**Phase 4**: Implementation (execute tasks.md following constitutional principles)  
**Phase 5**: Validation (run tests, execute quickstart.md, performance validation)

## Complexity Tracking
*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |


## Progress Tracking
*This checklist is updated during execution flow*

**Phase Status**:
- [x] Phase 0: Research complete (/plan command) - research.md generated with all decisions
- [x] Phase 1: Design complete (/plan command) - data-model.md, contracts/, quickstart.md created
- [x] Phase 2: Task planning approach documented (/plan command - 95 tasks outlined)
- [ ] Phase 3: Tasks generated (/tasks command) - Execute `/tasks` to generate tasks.md
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS (All architecture patterns followed)
- [x] Post-Design Constitution Check: PASS (Two-layer architecture, cross-domain integration verified)
- [x] All NEEDS CLARIFICATION resolved (TipTap, react-virtuoso, SSE events, unread tracking)
- [x] Complexity deviations documented: None (follows constitutional patterns)

**Artifacts Generated**:
- [x] research.md - 12 research decisions documented
- [x] data-model.md - Schema extensions and query contracts
- [x] contracts/RPC_CONTRACTS.md - Proto extensions and API client contracts
- [x] quickstart.md - 12 E2E test scenarios with acceptance criteria
- [x] plan.md - Complete implementation plan with 95 task outline

**Next Command**: Run `/tasks` to generate tasks.md from this plan

---
*Based on Constitution v4.0.0 - See `/memory/constitution.md`*

---

## Plan Execution Summary

### ✅ Phase 0: Research Complete

**12 Key Decisions Made**:
1. **Markdown Editor**: TipTap (~60KB) - Best React integration, extensible for @mentions
2. **Virtual Scrolling**: react-virtuoso - Native reverse scroll, dynamic heights
3. **SSE Events**: Extend NotificationEvent with action_data - Reuse infrastructure
4. **Unread Tracking**: Hybrid (server + client) - Multi-device sync + instant UX
5. **Mentions**: Regex `@(\w+)` + validation - Simple, fast, sufficient for MVP
6. **Thread UX**: Auto-open on reply, auto-close on channel switch - Intuitive
7. **Typing**: 3s debounce + 5s expire - Efficient, graceful
8. **Emoji**: Native browser picker - Zero bundle size for MVP
9. **Existing Patterns**: Reviewed workspace, notification, API patterns
10. **Notification Integration**: Verified NotificationLogic interface compatibility
11. **Query Patterns**: Reviewed existing chat.query.sql, all tenant-isolated
12. **Backend Architecture**: Verified two-layer architecture, cross-domain integration

**Output**: `research.md` with complete decision rationale and integration plans

### ✅ Phase 1: Design Complete

**Data Model**: `data-model.md`
- Extended `chat.channel_membership` with 2 columns for unread tracking
- 5 new sqlc queries (GetMessageById, MarkChannelAsRead, mention validation)
- Performance optimized with 2 new indexes
- All queries tenant-isolated with `organization_id` filters

**RPC Contracts**: `contracts/RPC_CONTRACTS.md`
- 2 new RPC methods: GetMessageById, MarkChannelAsRead
- 4 proto message extensions (unread tracking, mention metadata)
- Frontend API client wrappers with type safety
- Notification event schema for chat events (message, mention, reply, typing)
- All changes backward-compatible

**Test Scenarios**: `quickstart.md`
- 12 end-to-end test scenarios covering all acceptance criteria
- Performance benchmarks defined (60fps scroll, <60s notification SLA)
- Error handling and accessibility scenarios
- CI/CD integration with automated E2E tests

### ✅ Phase 2: Task Planning Approach Documented

**95 Tasks Outlined** (for /tasks command):
- **Backend** (32 tasks): Schema migrations, sqlc queries, proto extensions, notification integration, testing
- **Frontend** (60 tasks): 3-column layout, TipTap composer, virtual scrolling, SSE integration, components, hooks, testing
- **Integration** (10 tasks): E2E test automation covering all 12 quickstart scenarios
- **Documentation** (3 tasks): Feature README, shortcuts guide

**Estimated Effort**: 12-17 days full implementation
- Backend: 3-4 days (extend existing #009 service)
- Frontend: 7-10 days (new UI with TipTap + real-time)
- Testing: 2-3 days (post human verification)

### Constitutional Compliance ✅

**Two-Layer Architecture**: Chat service already implements logic + connect layers correctly  
**Cross-Domain Integration**: NotificationLogic interface properly injected, user-scope context preserved  
**Tenant Isolation**: All queries filter by `organization_id`, channel membership validated  
**Codegen**: Proto and sqlc changes documented with generation commands  
**Observability**: Structured logging included in all new methods  

### Key Technical Decisions

| Area | Decision | Impact |
|------|----------|--------|
| Markdown Editor | TipTap | +60KB bundle, rich editing, extensible |
| Virtual Scroll | react-virtuoso | Smooth 60fps with 1000+ messages |
| SSE Integration | Reuse NotificationEvent | Single connection, efficient |
| Unread Tracking | Server + Client Hybrid | Multi-device sync |
| Mobile UX | Responsive 3-column → modal | Works on 13-inch laptops + mobile |

### Dependencies

**Backend**: Feature #009 (chat backend) - Already implemented ✅  
**Frontend**: Feature #007 (notification hub backend) - Already implemented ✅  
**Frontend**: Feature #008 (notification hub frontend) - Already implemented ✅  
**New Packages**: TipTap (~60KB), react-virtuoso (~20KB) = ~80KB total

### Risk Mitigation

**Performance**: Virtual scrolling + pagination prevent memory issues  
**Real-Time**: SSE auto-reconnect with exponential backoff  
**Offline**: Message queueing with retry on reconnect  
**Security**: All queries tenant-isolated, channel membership validated  
**Rollback**: All changes additive, safe to revert without data loss

### Next Steps

1. **Run `/tasks` command** to generate `tasks.md` with 95 ordered tasks
2. Begin implementation following task order (backend → frontend → tests)
3. Execute quickstart scenarios after human verification
4. Deploy to dev environment for QA testing
5. Production deployment with feature flag (enable for beta users first)

---

**Plan Status**: ✅ COMPLETE - Ready for task generation (`/tasks` command)

**Branch**: `010-chat-frontend-and-notification`  
**Feature Spec**: `specs/010-chat-frontend-and-notification/spec.md`  
**Estimated Completion**: 12-17 days from task start
