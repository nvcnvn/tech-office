# Tasks: User Status and Notification Popup

**Input**: Design documents from `/Users/nvcnvn/Codes/tech-office/specs/012-user-status-and-notification-popup/`
**Prerequisites**: plan.md, research.md, data-model.md, contracts/, quickstart.md

## Execution Flow (main)
```
1. Load plan.md from feature directory ✅
   → Tech stack: Go 1.25+, PostgreSQL 18+, TypeScript 5.x, Next.js 15
   → Structure: Web app (backend + frontend monorepo)
2. Load design documents ✅
   → data-model.md: 3 tables (active_connection extended, push_token, presence_visibility)
   → contracts/: notification_presence_extensions.proto (8 RPCs), notification_queries.sql (20+ queries)
   → research.md: 5 decisions (presence detection, FCM, ephemeral routing, visibility, routing)
   → quickstart.md: 8 scenarios with 38 test cases
3. Generate tasks by category ✅
   → Setup: Dependencies, Firebase config, migration prep
   → Core: Schema changes, proto extensions, service logic, frontend components
   → Integration: FCM, SSE routing, presence tracking
   → Verification: Manual testing (developer responsibility)
   → Tests: Backend integration tests (RPC client pattern)
   → Polish: Performance, documentation
4. Task rules applied ✅
   → Different files marked [P]
   → Same file sequential
   → Implementation → Verification → Tests
5. Tasks numbered T001-T065
6. Dependencies documented below
7. Parallel execution examples included
8. Validation complete ✅
```

## Format: `[ID] [P?] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- File paths included for each task

---

## Phase 3.1: Setup & Dependencies

- [X] **T001** Review constitution.md v5.4.0 for golang-migrate workflow, two-layer architecture, Citus constraints
  - File: `.specify/memory/constitution.md`
  - Verify understanding of AdminPool/TenantPool usage, composite keys, ON CONFLICT rules

- [X] **T002** [P] Install Firebase Admin SDK for Go
  - File: `backend/go.mod`
  - Add: `firebase.google.com/go/v4` and `google.golang.org/api/option`
  - Run: `cd backend && go mod tidy`

- [X] **T003** [P] Install Firebase Web SDK for frontend
  - File: `frontend/package.json`
  - Add: `firebase@^10.0.0` dependency
  - Run: `cd frontend && pnpm install`

- [X] **T004** [P] Configure FCM service account credentials
  - File: `backend/k8s/base/fcm-secret.yaml` (for k8s) or `backend/.env` (for local dev)
  - Add: `GOOGLE_APPLICATION_CREDENTIALS` path or `FCM_SERVICE_ACCOUNT_JSON` content
  - Documentation: Add setup instructions to `backend/docs/FCM-SETUP.md`

- [X] **T005** [P] Create Firebase config for frontend
  - File: `frontend/apps/web/public/firebase-config.json`
  - Add: Firebase project config (apiKey, projectId, messagingSenderId, appId)
  - Documentation: Add setup instructions to `frontend/apps/web/README.md`

- [X] **T006** Create Firebase Service Worker for background notifications
  - File: `frontend/apps/web/public/firebase-messaging-sw.js`
  - Implement: FCM message handling, notification display, click handling with deep links
  - Import: Firebase messaging SDK in service worker context

---

## Phase 3.2: Core Implementation - Backend Schema & Migrations

- [X] **T007** Update authoritative schema with presence tracking fields
  - File: `backend/database/scripts/schema.sql`
  - Extend `notification.active_connection` table with:
    - `presence_status TEXT NOT NULL DEFAULT 'online'` (CHECK constraint: online, online_hidden, idle, offline)
    - `active_channel_id UUID NULL` (FK to chat.channel)
    - `last_interaction_at TIMESTAMPTZ NOT NULL DEFAULT now()`
  - Add comments documenting field purposes

- [X] **T008** Create push_token table in authoritative schema
  - File: `backend/database/scripts/schema.sql` (continued)
  - Create: `notification.push_token` table with composite PK `(organization_id, token_id)`
  - Columns: token_id, employee_id, organization_id, device_identifier, fcm_token, endpoint, keys, is_valid, registered_at, last_used_at, updated_at
  - Add: Composite FK `(organization_id, employee_id)` referencing `organization.employee`
  - Add: Unique constraint `(organization_id, employee_id, device_identifier)`
  - Add: CHECK constraint for presence_status values

- [X] **T009** Create presence_visibility table in authoritative schema
  - File: `backend/database/scripts/schema.sql` (continued)
  - Create: `notification.presence_visibility` table with composite PK `(organization_id, employee_id)`
  - Columns: employee_id, organization_id, visibility_mode, custom_status_text, custom_status_emoji, updated_at
  - Add: CHECK constraint for visibility_mode values (everyone, departments, offline)
  - Add: Composite FK `(organization_id, employee_id)` referencing `organization.employee`

- [X] **T010** Create golang-migrate migration for active_connection extension
  - Files: 
    - `backend/k8s/base/database/migrations/YYYYMMDDHHMMSS_extend_active_connection_presence.up.sql`
    - `backend/k8s/base/database/migrations/YYYYMMDDHHMMSS_extend_active_connection_presence.down.sql`
  - Up: Add presence_status, active_channel_id, last_interaction_at columns with CHECK constraint
  - Up: Add composite FK for active_channel_id referencing chat.channel
  - Up: Add indexes (org_presence, org_channel)
  - Down: Remove indexes, drop FK, drop columns
  - Ensure Citus compliance (organization_id in all constraints)

- [X] **T011** Create golang-migrate migration for push_token table
  - Files:
    - `backend/k8s/base/database/migrations/YYYYMMDDHHMMSS_create_push_token_table.up.sql`
    - `backend/k8s/base/database/migrations/YYYYMMDDHHMMSS_create_push_token_table.down.sql`
  - Up: CREATE TABLE with Citus composite PK, CHECK constraint, unique constraint, indexes
  - Down: DROP TABLE CASCADE
  - Validate: No triggers, no forbidden cascade actions

- [X] **T012** Create golang-migrate migration for presence_visibility table
  - Files:
    - `backend/k8s/base/database/migrations/YYYYMMDDHHMMSS_create_presence_visibility_table.up.sql`
    - `backend/k8s/base/database/migrations/YYYYMMDDHHMMSS_create_presence_visibility_table.down.sql`
  - Up: CREATE TABLE with Citus composite PK, CHECK constraint, FK, indexes
  - Down: DROP TABLE CASCADE

- [X] **T013** Apply migrations locally via migrate.sh
  - Command: `cd backend && ./scripts/migrate.sh`
  - Verify: Check for dirty states, resolve with `migrate force <version>` if needed
  - Validate: Query new tables/columns exist in local database

- [X] **T014** Add sqlc queries for presence status updates
  - File: `backend/database/scripts/notification.query.sql`
  - Add queries:
    - `UpdatePresenceStatus` (update presence_status, active_channel_id, last_interaction_at, last_heartbeat)
    - `GetActiveConnectionsByPresence` (filter by statuses array, stale threshold)
    - `GetActiveConnectionsByChannel` (filter by channel_id, presence_status)
    - `GetEmployeeActiveConnections` (filter by employee_id)
    - `CleanupStaleConnections` (delete where last_heartbeat < threshold)

- [X] **T015** Add sqlc queries for push token management
  - File: `backend/database/scripts/notification.query.sql` (continued)
  - Add queries:
    - `InsertPushToken` (insert new token with all fields)
    - `UpsertPushToken` (ON CONFLICT update with parameterized timestamp - Citus compliant)
    - `GetEmployeePushTokens` (filter by employee_id, is_valid=true)
    - `GetPushTokenByID` (get single token by token_id)
    - `MarkPushTokenInvalid` (set is_valid=false)
    - `UpdatePushTokenLastUsed` (update last_used_at with parameterized timestamp)
    - `DeletePushToken` (delete by token_id)
    - `CleanupStalePushTokens` (delete where last_used_at < 90 days ago)

- [X] **T016** Add sqlc queries for presence visibility
  - File: `backend/database/scripts/notification.query.sql` (continued)
  - Add queries:
    - `UpsertPresenceVisibility` (ON CONFLICT update with parameterized timestamp)
    - `GetPresenceVisibility` (get by employee_id)
    - `GetEmployeeVisiblePresence` (join with visibility settings, filter by viewer's departments)
    - `SharesDepartment` (check if two employees share any department)

- [X] **T017** Run sqlc generate and commit generated models
  - Command: `cd backend && sqlc generate`
  - Files generated: `backend/database/models.go`, `backend/database/notification.query.sql.go`
  - Verify: New structs for PushToken, PresenceVisibility, extended ActiveConnection
  - Commit: Generated files with schema changes in same commit
  - **BLOCKS**: T025-T038 (service implementation needs generated types)

---

## Phase 3.3: Core Implementation - Backend Proto & RPC

- [X] **T018** Extend notification.proto with presence enums
  - File: `backend/rpc/v1/notification.proto`
  - Add: `PresenceStatus` enum (ONLINE, ONLINE_HIDDEN, IDLE, OFFLINE)
  - Add: `PermissionState` enum (PROMPT, GRANTED, DENIED)
  - Add: `VisibilityMode` enum (EVERYONE, DEPARTMENTS, OFFLINE)

- [X] **T019** Add presence status RPC messages to notification.proto
  - File: `backend/rpc/v1/notification.proto` (continued)
  - Add: `UpdatePresenceStatusRequest` (status, active_channel_id, last_interaction_at)
  - Add: `UpdatePresenceStatusResponse` (status, updated_at)
  - Add: `GetEmployeePresenceRequest` (employee_id)
  - Add: `GetEmployeePresenceResponse` (employee_id, status, active_channel_id, custom_status)
  - Add: `GetBatchEmployeePresenceRequest` (employee_ids array)
  - Add: `GetBatchEmployeePresenceResponse` (presences array)

- [X] **T020** Add push token RPC messages to notification.proto
  - File: `backend/rpc/v1/notification.proto` (continued)
  - Add: `RegisterPushTokenRequest` (fcm_token, device_identifier, endpoint, keys_json)
  - Add: `RegisterPushTokenResponse` (token_id, registered_at, is_valid)
  - Add: `RevokePushTokenRequest` (token_id OR device_identifier)
  - Add: `RevokePushTokenResponse` (revoked_count)
  - Add: `ListPushTokensRequest` (empty - uses auth context)
  - Add: `PushTokenInfo` message (token_id, device_identifier, is_valid, registered_at, last_used_at)
  - Add: `ListPushTokensResponse` (tokens array)

- [X] **T021** Add presence visibility RPC messages to notification.proto
  - File: `backend/rpc/v1/notification.proto` (continued)
  - Add: `SetPresenceVisibilityRequest` (visibility_mode, custom_status_text, custom_status_emoji)
  - Add: `SetPresenceVisibilityResponse` (visibility_mode, updated_at)
  - Add: `GetPresenceSettingsRequest` (empty - uses auth context)
  - Add: `GetPresenceSettingsResponse` (visibility_mode, custom_status_text, custom_status_emoji)

- [X] **T022** Add presence RPC methods to NotificationService
  - File: `backend/rpc/v1/notification.proto` (service definition)
  - Add to `service NotificationService`:
    - `rpc UpdatePresenceStatus(UpdatePresenceStatusRequest) returns (UpdatePresenceStatusResponse)`
    - `rpc GetEmployeePresence(GetEmployeePresenceRequest) returns (GetEmployeePresenceResponse)`
    - `rpc GetBatchEmployeePresence(GetBatchEmployeePresenceRequest) returns (GetBatchEmployeePresenceResponse)`
    - `rpc RegisterPushToken(RegisterPushTokenRequest) returns (RegisterPushTokenResponse)`
    - `rpc RevokePushToken(RevokePushTokenRequest) returns (RevokePushTokenResponse)`
    - `rpc ListPushTokens(ListPushTokensRequest) returns (ListPushTokensResponse)`
    - `rpc SetPresenceVisibility(SetPresenceVisibilityRequest) returns (SetPresenceVisibilityResponse)`
    - `rpc GetPresenceSettings(GetPresenceSettingsRequest) returns (GetPresenceSettingsResponse)`
  - Add: `access_control` annotations requiring authenticated employee role

- [X] **T023** Run buf generate and commit backend RPC code
  - Command: `cd backend && buf generate`
  - Files generated: `backend/rpc/v1/*.pb.go`, `backend/rpc/v1/*connect.pb.go`
  - Verify: New service methods in `NotificationServiceClient` and `NotificationServiceHandler`
  - Commit: Generated proto files
  - **BLOCKS**: T025-T038 (service implementation needs proto types)

- [X] **T024** Update frontend RPC package exports
  - File: `frontend/packages/rpc/index.ts`
  - Add exports: `PresenceStatus`, `PermissionState`, `VisibilityMode`, presence-related request/response types
  - Run: `cd frontend && pnpm -r build`
  - Commit: Updated exports and `dst/` artifacts
  - **BLOCKS**: T039-T052 (frontend implementation needs RPC types)

---

## Phase 3.4: Core Implementation - Backend Service Logic

- [X] **T025** Create presence logic layer in notification service
  - File: `backend/internal/notification/presence_logic.go`
  - Create: `PresenceLogic` interface with methods:
    - `UpdatePresenceStatus(ctx, tx, employeeID, orgID, status, channelID, lastInteraction) (*ActiveConnection, error)`
    - `GetEmployeePresence(ctx, tx, employeeID, orgID) (*EmployeePresence, error)`
    - `GetBatchEmployeePresence(ctx, tx, employeeIDs, orgID, viewerID) ([]*EmployeePresence, error)`
    - `CleanupStaleConnections(ctx, tx, staleThreshold) (int, error)`
  - Implement: `presenceLogicImpl` struct with `Queries *database.Queries`
  - Logic: Apply visibility filtering in GetBatchEmployeePresence (check SharesDepartment query)

- [X] **T026** Create push token logic layer in notification service
  - File: `backend/internal/notification/push_logic.go`
  - Create: `PushLogic` interface with methods:
    - `RegisterPushToken(ctx, tx, employeeID, orgID, fcmToken, deviceID, endpoint, keys) (*PushToken, error)`
    - `ValidatePushToken(ctx, tx, tokenID, orgID) error`
    - `GetEmployeePushTokens(ctx, tx, employeeID, orgID) ([]*PushToken, error)`
    - `MarkTokenInvalid(ctx, tx, tokenID, orgID) error`
    - `RevokePushToken(ctx, tx, employeeID, orgID, tokenID, deviceID) (int, error)`
    - `SendPushNotification(ctx, employeeID, orgID, notification) error`
  - Implement: `pushLogicImpl` struct with `Queries *database.Queries`, `FCMClient *messaging.Client`
  - Logic: Validate tokens on registration, handle FCM send failures, mark invalid tokens

- [X] **T027** Create presence visibility logic layer
  - File: `backend/internal/notification/visibility_logic.go`
  - Create: `VisibilityLogic` interface with methods:
    - `SetPresenceVisibility(ctx, tx, employeeID, orgID, mode, statusText, emoji) (*PresenceVisibility, error)`
    - `GetPresenceVisibility(ctx, tx, employeeID, orgID) (*PresenceVisibility, error)`
    - `FilterVisiblePresence(ctx, tx, presences, viewerID, orgID) ([]*EmployeePresence, error)`
  - Implement: `visibilityLogicImpl` struct with `Queries *database.Queries`
  - Logic: Apply EVERYONE, DEPARTMENTS, OFFLINE filtering rules

- [X] **T028** Initialize FCM client in notification service
  - File: `backend/internal/notification/fcm_client.go`
  - Create: `InitFCMClient(ctx) (*messaging.Client, error)`
  - Logic: Load FCM service account from env var, initialize Firebase app, return messaging client
  - Handle: Errors gracefully, log initialization status

- [X] **T029** Implement UpdatePresenceStatus RPC handler
  - File: `backend/internal/notification/presence_connect.go`
  - Implement: `NotificationServiceConnect.UpdatePresenceStatus` method
  - Extract: employeeID, orgID from context via interceptor
  - Use: `txn.WithTxn(ctx, s.TenantPool, func(ctx, tx) {...})`
  - Call: `s.PresenceLogic.UpdatePresenceStatus(ctx, tx, employeeID, orgID, ...)`
  - Return: Connect response with updated status and timestamp

- [X] **T030** Implement GetEmployeePresence and GetBatchEmployeePresence RPC handlers
  - File: `backend/internal/notification/presence_connect.go` (continued)
  - Implement: `GetEmployeePresence` - get single employee presence with visibility filtering
  - Implement: `GetBatchEmployeePresence` - get multiple employees' presence (batch query)
  - Use: `txn.WithTxn(ctx, s.TenantPool, ...)`
  - Apply: Visibility filtering via `VisibilityLogic.FilterVisiblePresence`

- [X] **T031** Implement RegisterPushToken RPC handler
  - File: `backend/internal/notification/push_connect.go`
  - Implement: `NotificationServiceConnect.RegisterPushToken` method
  - Extract: employeeID, orgID from context
  - Use: `txn.WithTxn(ctx, s.TenantPool, ...)`
  - Call: `s.PushLogic.RegisterPushToken(ctx, tx, ...)`
  - Validate: Token on registration with test FCM send
  - Return: Token ID and registration timestamp

- [X] **T032** Implement RevokePushToken and ListPushTokens RPC handlers
  - File: `backend/internal/notification/push_connect.go` (continued)
  - Implement: `RevokePushToken` - delete token by ID or device identifier
  - Implement: `ListPushTokens` - list employee's valid tokens
  - Use: `txn.WithTxn(ctx, s.TenantPool, ...)`

- [X] **T033** Implement SetPresenceVisibility and GetPresenceSettings RPC handlers
  - File: `backend/internal/notification/visibility_connect.go`
  - Implement: `SetPresenceVisibility` - upsert visibility settings
  - Implement: `GetPresenceSettings` - get employee's current visibility settings
  - Use: `txn.WithTxn(ctx, s.TenantPool, ...)`
  - Call: `s.VisibilityLogic` methods

- [X] **T034** Extend SSE connection registry with active_channel_id filtering
  - File: `backend/internal/notification/sse.go`
  - Extend: Connection registry struct to store active_channel_id per connection
  - Implement: `GetConnectionsByChannel(orgID, channelID) []*Connection` method
  - Use: For routing ephemeral signals (priority=4) to only channel-viewing connections

- [X] **T035** Implement notification routing logic with presence awareness
  - File: `backend/internal/notification/routing_logic.go`
  - Implement: `RouteNotification(ctx, employeeID, orgID, notification) error` method
  - Logic:
    - Get employee's active connections via `PresenceLogic.GetEmployeeActiveConnections`
    - If priority=4 (typing, reactions): Send ONLY to connections with matching active_channel_id, skip DB write
    - If priority=0 (critical): Always send push AND SSE
    - If priority=1-3: Send SSE if online, send push if offline/hidden
    - Check visibility settings before routing
  - Use: `PushLogic.SendPushNotification` for push, SSE registry for in-app

- [X] **T036** Implement background cleanup goroutine for stale connections
  - File: `backend/internal/notification/cleanup.go`
  - Implement: `StartCleanupRoutine(ctx, interval)` goroutine
  - Use: `context.Background()` for system-scope (documented justification)
  - Use: `txn.WithTxn(ctx, s.AdminPool, ...)` - system operations across all organizations
  - Call: `PresenceLogic.CleanupStaleConnections(ctx, tx, 60s threshold)` every 30 seconds
  - Document: "System-scope required to scan all organizations' stale connections for timeout cleanup"

- [X] **T037** Implement background cleanup for stale push tokens
  - File: `backend/internal/notification/cleanup.go` (continued)
  - Add: `CleanupStalePushTokens` to cleanup routine
  - Use: AdminPool for cross-organization cleanup
  - Delete: Tokens not used in 90+ days
  - Document: System-scope justification

- [X] **T038** Wire up presence/push logic in notification service initialization
  - File: `backend/cmd/server.go`
  - Initialize: FCM client via `InitFCMClient(ctx)`
  - Create: `PresenceLogic`, `PushLogic`, `VisibilityLogic` instances
  - Inject: Into `NotificationServiceConnect` struct
  - Start: Cleanup goroutine with signal handling for graceful shutdown

---

## Phase 3.5: Core Implementation - Frontend Components

- [X] **T039** [P] Create presence tracking hook with Page Visibility API
  - File: `frontend/apps/web/src/hooks/usePresenceTracking.ts`
  - Implement: `usePresenceTracking()` hook
  - Listen: `visibilitychange`, `focus`, `blur` events for tab state
  - Listen: `mousemove`, `keydown`, `scroll` for interaction detection
  - Track: Idle timer (5 minutes), update presence status
  - Call: RPC `UpdatePresenceStatus` on state changes
  - Heartbeat: Send presence + active_channel_id every 30 seconds

- [X] **T040** [P] Create push notification permission hook
  - File: `frontend/apps/web/src/hooks/usePushPermission.ts`
  - Implement: `usePushPermission()` hook
  - Check: `Notification.permission` state
  - Request: Permissions via friendly modal (not just native prompt)
  - Register: FCM token on permission grant
  - Call: RPC `RegisterPushToken` with token, device ID, endpoint, keys
  - Handle: Permission denied, quota exceeded errors

- [X] **T041** [P] Create FCM service worker registration hook
  - File: `frontend/apps/web/src/hooks/useServiceWorker.ts`
  - Implement: `useServiceWorker()` hook
  - Register: `/firebase-messaging-sw.js` service worker
  - Handle: Registration success/failure
  - Request: Push notification token from FCM after registration
  - Return: Token for backend registration

- [X] **T042** [P] Create API wrapper for presence RPC methods
  - File: `frontend/packages/apis/src/presence.ts`
  - Define: Custom TypeScript types (PresenceStatus, EmployeePresence, UpdatePresenceParams)
  - Implement: Wrapper functions:
    - `updatePresenceStatus(status, channelId, lastInteraction): Promise<{status, updatedAt}>`
    - `getEmployeePresence(employeeId): Promise<EmployeePresence>`
    - `getBatchEmployeePresence(employeeIds): Promise<EmployeePresence[]>`
  - Convert: Protobuf Timestamp to Date using `protoTimestampToDate`
  - Export: From `packages/apis/src/index.ts`

- [X] **T043** [P] Create API wrapper for push token RPC methods
  - File: `frontend/packages/apis/src/push-tokens.ts`
  - Define: Custom types (PushToken, RegisterPushTokenParams)
  - Implement: Wrapper functions:
    - `registerPushToken(params): Promise<PushToken>`
    - `revokePushToken(tokenId): Promise<{revokedCount}>`
    - `listPushTokens(): Promise<PushToken[]>`
  - Convert: Timestamps to Date
  - Export: From `packages/apis/src/index.ts`

- [X] **T044** [P] Create API wrapper for visibility RPC methods
  - File: `frontend/packages/apis/src/visibility.ts`
  - Define: Custom types (VisibilityMode, PresenceVisibility, SetVisibilityParams)
  - Implement: Wrapper functions:
    - `setPresenceVisibility(params): Promise<PresenceVisibility>`
    - `getPresenceSettings(): Promise<PresenceVisibility>`
  - Export: From `packages/apis/src/index.ts`

- [X] **T045** Integrate presence tracking into workspace layout
  - File: `frontend/apps/web/src/app/workspace/layout.tsx`
  - Add: `usePresenceTracking()` hook at top level
  - Track: Current route to detect active_channel_id (e.g., `/workspace/chat?channel={id}`)
  - Pass: active_channel_id to presence hook for SSE heartbeat
  - Initialize: On workspace mount, cleanup on unmount

- [X] **T046** Create notification permission prompt component
  - File: `frontend/apps/web/src/components/NotificationPermissionPrompt.tsx`
  - Implement: Modal/banner prompting user to enable notifications
  - Show: Only once per session or after dismissal timeout
  - Call: `usePushPermission()` hook on "Enable Notifications" button
  - Store: Permission state in localStorage to avoid repeated prompts
  - Add: `data-testid="notification-permission-prompt"`

- [X] **T047** Integrate FCM in workspace layout for push handling
  - File: `frontend/apps/web/src/app/workspace/layout.tsx` (continued)
  - Initialize: Firebase app with config from public/firebase-config.json
  - Register: Service worker via `useServiceWorker()` hook
  - Handle: Foreground FCM messages (display in-app notification)
  - Handle: Token refresh events, re-register with backend
  - Handle: Deep link params on mount (e.g., `?channel={id}&message={id}&notification={id}`)

- [X] **T048** [P] Create presence indicator component for employee avatars
  - File: `frontend/apps/web/src/components/PresenceIndicator.tsx`
  - Props: `employeeId: string`, `size?: 'small' | 'medium' | 'large'`
  - Implement: Fetch presence via `getEmployeePresence(employeeId)`
  - Display: Status badge (green=online, yellow=idle, gray=offline, hidden=no badge)
  - Update: On SSE presence change events
  - Add: `data-testid="presence-indicator-{employeeId}"`

- [X] **T049** [P] Create batch presence display for employee lists
  - File: `frontend/apps/web/src/components/BatchPresenceDisplay.tsx`
  - Props: `employeeIds: string[]`
  - Implement: Fetch via `getBatchEmployeePresence(employeeIds)`
  - Display: Map of employeeId → presence status
  - Update: On SSE batch presence events
  - Optimize: Batch requests to avoid N+1 queries

- [X] **T050** [P] Create presence visibility settings UI
  - File: `frontend/apps/web/src/app/workspace/settings/presence/page.tsx`
  - Implement: Settings page with radio buttons for visibility mode (Everyone, Departments Only, Offline)
  - Add: Custom status text input (e.g., "In meeting")
  - Add: Custom status emoji picker
  - Call: `setPresenceVisibility(params)` on save
  - Fetch: Current settings via `getPresenceSettings()` on mount
  - Add: `data-testid="presence-settings-form"`

- [X] **T051** Extend notification popup to respect routing logic
  - File: `frontend/apps/web/src/components/NotificationPopup.tsx` (or similar)
  - Logic: Don't show in-app notification if viewing related content (e.g., message notification while viewing that channel)
  - Check: Current route + active_channel_id context
  - Show: Only if notification is not for current context
  - Mark: Notification as read when shown

- [X] **T052** Add push token management UI in user settings
  - File: `frontend/apps/web/src/app/workspace/settings/notifications/page.tsx`
  - Implement: List of registered push tokens with device identifiers
  - Fetch: Via `listPushTokens()`
  - Add: "Revoke" button for each token calling `revokePushToken(tokenId)`
  - Display: Registration date, last used date, validity status
  - Add: `data-testid="push-token-list"`

---

## Phase 3.6: Integration & Configuration

- [X] **T053** Configure Firebase project and download service account
  - Action: Create Firebase project (or use existing)
  - Enable: Cloud Messaging API
  - Download: Service account JSON from Firebase Console
  - Store: In `backend/.env` or k8s secret for production
  - Document: Setup steps in `backend/docs/FCM-SETUP.md`

- [X] **T054** Add environment variables for FCM configuration
  - Files: `backend/.env.example`, `backend/k8s/base/deployment.yaml`
  - Add: `GOOGLE_APPLICATION_CREDENTIALS` or `FCM_SERVICE_ACCOUNT_JSON`
  - Add: `FCM_PROJECT_ID` (optional, can be derived from service account)
  - Document: Required env vars in README

- [X] **T055** Update frontend environment config for Firebase
  - Files: `frontend/apps/web/.env.example`, `frontend/apps/web/.env.local`
  - Add: Firebase config (NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_PROJECT_ID, etc.)
  - Document: How to obtain from Firebase Console

- [X] **T056** Add logging for presence tracking events
  - Files: `backend/internal/notification/presence_logic.go`, `backend/internal/notification/routing_logic.go`
  - Add: `slog.DebugContext` logs for presence updates, routing decisions, cleanup operations
  - Log: orgID, employeeID, status changes, channel context
  - Follow: Constitution logging standards (structured key-value pairs)

- [X] **T057** Add logging for push notification sending
  - File: `backend/internal/notification/push_logic.go`
  - Add: `slog.DebugContext` for token registration, validation, send operations
  - Add: `slog.ErrorContext` for send failures, invalid tokens
  - Log: tokenID, employeeID, orgID, FCM response codes

---

## Phase 3.7: Manual Verification (Developer Responsibility)
SKIP this Phase for now
<!-- **Developer MUST manually verify each scenario in quickstart.md before writing integration tests. Not an explicit task - Constitution v5.2.0.**

Key verification steps (not tasks, but developer checklist):
- Scenario 1: Basic presence tracking (online → hidden → idle → offline transitions)
- Scenario 2: Active channel tracking (NULL → channel_id → NULL)
- Scenario 3: Push permission request and token registration
- Scenario 4: Push notification with deep link navigation
- Scenario 5: Ephemeral typing indicators routing to active channel viewers only
- Scenario 6: Presence visibility controls (everyone, departments, offline)
- Scenario 7: Smart notification routing (suppress if viewing, push if hidden)
- Scenario 8: Multi-device push token management -->

---

## Phase 3.8: Backend Integration Tests (Constitution v5.2.0 - REQUIRED)

- [X] **T058** [P] Integration test for UpdatePresenceStatus RPC endpoint
  - File: `backend/integration/presence_status_test.go`
  - Use: `GetRandomTestIdentityAndKey(iam.IdentityRoleEmployee)` to get test employee with token
  - Create: RPC client `rpcv1connect.NewNotificationServiceClient`
  - Test: Call `UpdatePresenceStatus` with different statuses (online, online_hidden, idle, offline)
  - Validate: Response contains updated status and timestamp
  - Validate: Database record updated correctly
  - Test: active_channel_id updates when provided

- [X] **T059** [P] Integration test for RegisterPushToken and token validation
  - File: `backend/integration/push_token_test.go`
  - Use: `GetRandomTestIdentityAndKey` for test employee
  - Test: Register FCM token with device identifier
  - Validate: Token stored in database with is_valid=true
  - Test: Duplicate registration (same device_identifier) updates existing token
  - Test: Token validation fails for invalid FCM token format

- [X] **T060** [P] Integration test for presence visibility filtering
  - File: `backend/integration/presence_visibility_test.go`
  - Setup: Create test employees in multiple departments
  - Test: Set visibility mode to DEPARTMENTS for employee A
  - Test: Call `GetBatchEmployeePresence` as employee B (same dept) → should see employee A
  - Test: Call `GetBatchEmployeePresence` as employee C (different dept) → should NOT see employee A
  - Test: Set visibility to OFFLINE → no employees see presence
  - Test: Set visibility to EVERYONE → all employees see presence

- [X] **T061** [P] Integration test for ephemeral signal routing by active_channel_id
  - File: `backend/integration/ephemeral_routing_test.go`
  - Setup: Create test channel, establish SSE connections for 3 employees
  - Test: Update employee A's active_channel_id to test_channel
  - Test: Send priority=4 notification (typing indicator) to test_channel
  - Validate: Only employee A receives SSE event (others don't)
  - Validate: No database record created for priority=4 notification

- [X] **T062** [P] Integration test for notification routing logic with presence
  - File: `backend/integration/notification_routing_test.go`
  - Setup: Establish SSE connection (online), register push token
  - Test: Send priority=0 notification → both SSE and push sent
  - Test: Update presence to online_hidden → priority=1 notification sends push only
  - Test: Update presence to online, active_channel_id=target_channel → priority=1 notification sends SSE only (no push)
  - Test: Offline (no connection) → push sent for priority=1-3

- [X] **T063** [P] Integration test for multi-tenant isolation in presence queries
  - File: `backend/integration/presence_multi_tenant_test.go`
  - Setup: Create employees in 2 different organizations
  - Test: Call `GetBatchEmployeePresence` for org A employees using org B token → returns empty or error
  - Test: Update presence for org A employee → org B cannot see the update
  - Validate: All queries include organization_id filter

- [X] **T064** [P] Integration test for stale connection cleanup
  - File: `backend/integration/stale_cleanup_test.go`
  - Setup: Create active connection with stale last_heartbeat (>60s ago)
  - Test: Trigger cleanup routine (call cleanup method directly)
  - Validate: Stale connection deleted from database
  - Test: Recent connection (heartbeat <60s) NOT deleted

---

## Phase 3.9: Polish & Documentation

- [ ] **T065** [P] Add performance logging for critical paths
  - Files: `backend/internal/notification/routing_logic.go`, `backend/internal/notification/presence_logic.go`
  - Add: Latency logging for presence updates, push sends, routing decisions
  - Target: <100ms p95 for presence updates, <5s for push delivery
  - Use: `slog.DebugContext` with duration fields

- [ ] **T066** [P] Update API documentation for new RPC endpoints
  - File: `backend/docs/API.md` (or similar)
  - Document: All 8 new RPC methods with request/response examples
  - Document: Presence status enum values and transitions
  - Document: FCM token registration flow
  - Document: Visibility filtering rules

- [ ] **T067** [P] Add troubleshooting guide for presence tracking issues
  - File: `backend/docs/PRESENCE-TROUBLESHOOTING.md`
  - Document: Common issues (browser sleep, network loss, stale tokens)
  - Document: How to debug presence status inconsistencies
  - Document: How to verify FCM configuration
  - Document: Database queries for debugging (active connections, push tokens)

- [ ] **T068** Verify all interactive UI elements have data-testid attributes
  - Files: All frontend components created in T046-T052
  - Check: Buttons, inputs, forms, lists have data-testid
  - Pattern: `data-testid="{component}-{purpose}-{type}"`
  - Examples: `notification-permission-prompt`, `presence-indicator-{employeeId}`, `push-token-list`

- [ ] **T069** Final smoke test across all scenarios
  - Action: Run through all 8 quickstart scenarios manually
  - Verify: No console errors, no failed network requests
  - Verify: Database state consistent with UI state
  - Verify: Push notifications delivered successfully
  - Verify: Presence indicators update in real-time

- [ ] **T070** Review code for duplication and refactoring opportunities
  - Files: All newly created files
  - Action: Extract common logic into helper functions
  - Action: Remove duplicated queries or business logic
  - Action: Ensure DRY principle followed

---

## Dependencies

### Critical Blockers
- **T017 (sqlc generate)** blocks T025-T038 (service implementation needs generated types)
- **T023 (buf generate)** blocks T025-T038 (service needs proto types)
- **T024 (frontend RPC exports)** blocks T039-T052 (frontend needs RPC types)
- **T001-T024 (backend setup)** block T058-T064 (integration tests need implementation)
- **T053-T055 (FCM config)** block T031-T032 (push handlers need FCM client)

### Phase Dependencies
- Setup (T001-T006) → Schema (T007-T017) → Proto (T018-T024) → Service Logic (T025-T038)
- Proto (T018-T024) → Frontend Components (T039-T052)
- Implementation (T001-T057) → Manual Verification (developer) → Integration Tests (T058-T064)
- Integration Tests (T058-T064) → Polish (T065-T070)

### Parallel Execution Groups
- **Group A (Setup)**: T002, T003, T004, T005 can run in parallel (different files)
- **Group B (Schema)**: T010, T011, T012 can run in parallel after T007-T009 (different migration files)
- **Group C (Proto Messages)**: T019, T020, T021 can run in parallel (same file, but different sections - coordinate)
- **Group D (Frontend Hooks)**: T039, T040, T041 can run in parallel (different files)
- **Group E (API Wrappers)**: T042, T043, T044 can run in parallel (different files)
- **Group F (Frontend Components)**: T048, T049, T050 can run in parallel (different files)
- **Group G (Integration Tests)**: T058-T064 can run in parallel (different test files)
- **Group H (Polish)**: T065, T066, T067 can run in parallel (different files)

---

## Parallel Execution Examples

### Backend Schema + Migrations (After T007-T009 complete)
```bash
# Launch T010, T011, T012 together (different migration files):
Task: "Create golang-migrate migration for active_connection extension"
Task: "Create golang-migrate migration for push_token table"
Task: "Create golang-migrate migration for presence_visibility table"
# Then run T013 to apply all migrations
```

### Frontend Hooks (After T024 complete)
```bash
# Launch T039, T040, T041 together (different files):
Task: "Create presence tracking hook with Page Visibility API in hooks/usePresenceTracking.ts"
Task: "Create push notification permission hook in hooks/usePushPermission.ts"
Task: "Create FCM service worker registration hook in hooks/useServiceWorker.ts"
```

### Backend Integration Tests (After T057 complete)
```bash
# Launch T058-T064 together (different test files):
Task: "Integration test for UpdatePresenceStatus RPC endpoint"
Task: "Integration test for RegisterPushToken and token validation"
Task: "Integration test for presence visibility filtering"
Task: "Integration test for ephemeral signal routing by active_channel_id"
Task: "Integration test for notification routing logic with presence"
Task: "Integration test for multi-tenant isolation in presence queries"
Task: "Integration test for stale connection cleanup"
```

---

## Notes

- **[P]** marks tasks that operate on different files and have no dependencies - safe to parallelize
- Developer manually verifies behavior before writing integration tests (Constitution v5.2.0)
- Backend integration tests REQUIRED - use RPC client pattern with dev tokens
- Frontend unit/snapshot/component tests FORBIDDEN - manual testing only
- All interactive UI elements MUST have data-testid attributes
- Commit after each task or logical group of parallel tasks
- String constants aligned across layers (CHECK constraints, Go constants, TypeScript types)
- Follow golang-migrate workflow: update schema.sql first, then create migrations, then run migrate.sh

---

## Validation Checklist

✅ All proto messages have corresponding RPC implementations (T018-T038)
✅ All tables have sqlc queries and generated models (T007-T017)
✅ Backend integration tests present with RPC client pattern (T058-T064)
✅ NO frontend unit/snapshot/component test tasks (Constitution v5.2.0)
✅ All interactive UI elements have data-testid tasks (T046-T052, verified in T068)
✅ Parallel tasks truly independent (different files, marked [P])
✅ Each task specifies exact file path
✅ No task modifies same file as another [P] task (except coordinated proto sections)
✅ String constants (presence_status, visibility_mode) have CHECK constraints (T007-T009)
✅ Generated artifacts (sqlc, buf, pnpm build) committed in proper order (T017, T023, T024)

---

## Phase 3.6: Bug Fixes & Polish (November 7, 2025)

- [X] **T066** Add notification sound playback to NotificationPopup component
  - File: `frontend/apps/web/src/components/NotificationPopup.tsx`
  - Added: Sound playback logic with `playNotificationSound()` function
  - Logic: Plays different sounds for channel vs. direct messages (detected by title format)
  - Implementation: Uses HTML5 Audio API with volume control and error handling
  - Sound files: `message.mp3` and `dm.mp3` placeholders in `/public/sounds/` directory

- [X] **T067** Fix direct message notification title to show sender name
  - File: `backend/internal/chat/logic.go`
  - Functions: `broadcastNewMessage`, `ReplyToMessage`, `notifyMentionedUsers`
  - Logic: Detect direct message channels (`channel_type = 'direct_message'`)
  - For DM new message: "{{authorName}} direct messaged you"
  - For DM reply: "{{authorName}} replied to you"
  - For DM mention: "{{authorName}} mentioned you"
  - Preserved existing format for regular channels: "{{authorName}} in #{{channelSlug}}"

- [X] **T068** Make notification popup more compact
  - File: `frontend/apps/web/src/components/NotificationPopup.tsx`
  - Reduced: Popup width from 400px to 320px
  - Reduced: Font sizes (title: 0.9rem, message: 0.8rem, timestamp: 0.7rem)
  - Reduced: Message preview truncation from 100 chars to 60 chars
  - Adjusted: Padding and spacing for compact display

- [ ] **T069** Fix backend typing indicator SSE broadcasting (DEFERRED)
  - File: `backend/internal/chat/connect.go`
  - Functions: `StartTyping`, `StopTyping`
  - Status: DEFERRED - Requires notification hub integration for ephemeral event broadcasting
  - Note: Typing indicators are currently stored in-memory but not broadcast via SSE
  - Future work: Implement ephemeral event routing in NotificationHub to broadcast typing state to active channel viewers
  - TODO comment exists in code: "TODO: Optionally broadcast via notification hub for real-time updates"

````
