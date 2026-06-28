# Implementation Tasks: Notification Hub Frontend

**Feature**: `#008-notification-hub-frontend` - Real-time notification center UI with SSE streaming  
**Based On**: `plan.md` v1.0.0  
**Total Tasks**: 31  
**Estimated Time**: 3-5 days

---

## Task Execution Instructions

**Parallel Execution**: Tasks marked with `[P]` can be executed simultaneously (different files)

**Dependencies**: Sequential phases must complete before next phase begins:
- Phase 0 (Backend Prerequisites) → Phase A → Phase B → Phase C → Phase D → Phase E → Phase F

**Implementation-First Approach**: 
1. Implement functionality
2. Human verification via quickstart.md
3. Write tests (post-verification)

**Quality Gates**:
- ✅ **Gate 0** (T000): Backend SSE authentication working → Frontend can proceed
- ✅ **Gate 1** (T016): All components implemented → Manual verification required
- ✅ **Gate 2** (T025): Human verification complete → Tests may be written

---

## Phase 0: Backend Prerequisites

### T000: Add WrapStreamingHandler to AuthInterceptor
**File**: `backend/internal/interceptor/auth.go`
**Action**: Implement streaming handler wrapper for SSE authentication support
**Background**: The current AuthInterceptor only wraps unary handlers. SSE streaming requires `WrapStreamingHandler` method to authenticate streaming RPCs.

**Implementation**:
```go
// Add to AuthInterceptor struct
func (i *AuthInterceptor) WrapStreamingHandler(next connect.StreamingHandlerFunc) connect.StreamingHandlerFunc {
    return func(ctx context.Context, conn connect.StreamingHandlerConn) error {
        // Extract JWT token from Authorization header
        authHeader := conn.RequestHeader().Get("Authorization")
        if authHeader == "" {
            return connect.NewError(connect.CodeUnauthenticated, errors.New("missing authorization header"))
        }

        // Validate token format: "Bearer <token>"
        tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
        if tokenStr == authHeader {
            return connect.NewError(connect.CodeUnauthenticated, errors.New("invalid authorization format"))
        }

        // Parse and validate JWT token (reuse existing validator)
        token, err := i.JWTValidator.ParseToken(ctx, tokenStr)
        if err != nil {
            return connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("invalid token: %w", err))
        }

        // Extract user claims and inject into context
        userID := token.Claims["sub"].(string)
        organizationID := token.Claims["organization_id"].(string)
        
        ctx = context.WithValue(ctx, "user_id", userID)
        ctx = context.WithValue(ctx, "organization_id", organizationID)

        // Call the next handler with authenticated context
        return next(ctx, conn)
    }
}
```

**Testing**:
1. Start backend server: `cd backend && air`
2. Test SSE endpoint with valid JWT:
```bash
curl -N -H "Authorization: Bearer <valid-jwt-token>" \
  http://localhost:18080/rpc.v1.NotificationService/StreamNotifications
```
3. Verify: Stream establishes and authentication context is available
4. Test with invalid token: Verify 401 Unauthenticated error

**Dependencies**: 
- Existing `backend/internal/interceptor/auth.go` with unary handler
- JWT validator already implemented

**Validation**:
- [X] Streaming handler authenticates valid JWT tokens
- [X] Invalid tokens return 401 Unauthenticated error
- [X] User context (user_id, organization_id) available in stream handlers
- [X] Frontend SSE connection can authenticate successfully

**Priority**: CRITICAL - Must complete before frontend Phase A (T001)

---

## Phase A: Shared Notification Package (Foundation)

### T001 [P]: Create notifications package structure ✅
**File**: `frontend/packages/notifications/package.json`
**Status**: COMPLETE
**Action**: Create new package with TypeScript configuration
```json
{
  "name": "@tech-office/notifications",
  "version": "0.1.0",
  "main": "dst/index.js",
  "types": "dst/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "rpc": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```
**Also Create**: `tsconfig.json`, `src/index.ts` (empty exports)

---

### T002 [P]: Implement TypeScript types ✅
**File**: `frontend/packages/notifications/src/types.ts`
**Status**: COMPLETE
**Action**: Copy types from `specs/008-notification-hub-frontend/contracts/types.ts`
**Content**: All interfaces (Notification, SSEConnectionState, NotificationFilters, etc.)
**Validation**: Types compile without errors

---

### T003 [P]: Implement utility functions ✅
**File**: `frontend/packages/notifications/src/utils.ts`
**Status**: COMPLETE
**Action**: Create helper functions for notification display
**Functions**:
- `formatRelativeTime(date: Date): string` - "2 minutes ago", "3 hours ago"
- `getDomainIcon(domain: string): IconName` - Map domain to MUI icon
- `getDomainColor(domain: string): string` - Map domain to Tailwind color
- `truncateContent(content: string, maxLength: number): string` - Truncate with ellipsis

**Reference**: Use `date-fns` for relative time formatting

---

### T004: Implement useSSEConnection hook ✅
**File**: `frontend/packages/notifications/src/useSSEConnection.ts`
**Status**: COMPLETE
**Action**: Create SSE connection hook with auto-reconnect
**Hook Interface**:
```typescript
export function useSSEConnection(
  organizationId: string,
  onNotification: (notification: Notification) => void,
  onError?: (error: Error) => void
): {
  status: SSEConnectionState['status'];
  error: Error | null;
  reconnect: () => void;
}
```
**Features**:
- Exponential backoff (1s, 2s, 4s, 8s, 16s max)
- Proactive 5-minute disconnect/reconnect
- Automatic cleanup on unmount
- Call `streamNotifications()` from `apis`

**Testing Hook**: Manual testing in Phase E

---

### T005: Implement useNotifications hook ✅
**File**: `frontend/packages/notifications/src/useNotifications.ts`
**Status**: COMPLETE
**Action**: Create notification state management hook
**Hook Interface**:
```typescript
export function useNotifications(organizationId: string): {
  notifications: Notification[];
  unreadCount: number;
  filters: NotificationFilters;
  loading: boolean;
  hasMore: boolean;
  
  // Actions
  loadMore: () => Promise<void>;
  markAsRead: (notificationId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteNotification: (notificationId: string) => Promise<void>;
  setFilters: (filters: Partial<NotificationFilters>) => void;
  
  // SSE integration
  addRealtimeNotification: (notification: Notification) => void;
}
```
**Features**:
- Optimistic UI updates for mark as read
- Client-side filtering (read/unread, domain)
- Pagination state management (page size: 20)
- Real-time notification prepending

**Dependencies**: Uses API functions from `apis`

---

### T006: Export package public API ✅
**File**: `frontend/packages/notifications/src/index.ts`
**Status**: COMPLETE
**Action**: Export all public types, hooks, and utils
```typescript
export * from './types';
export * from './utils';
export { useSSEConnection } from './useSSEConnection';
export { useNotifications } from './useNotifications';
```
**Validation**: Run `pnpm -r build` to ensure package compiles

---

## Phase B: Workspace Layout Integration

### T007: Add notifications tab to workspace layout
**File**: `frontend/apps/web/src/app/workspace/layout.tsx`
**Action**: Add notifications tab to `tabs` array
```typescript
const tabs: TabConfig[] = [
  // ... existing tabs
  {
    label: 'Notifications',
    href: '/workspace/notifications',
    icon: <NotificationsIcon />
  }
];
```
**Position**: Add after "Organization" tab (second position)

---

### T008: Create NotificationSidebar component
**File**: `frontend/apps/web/src/app/workspace/components/NotificationSidebar.tsx`
**Action**: Create collapsible sidebar for notification previews
**Component Props**:
```typescript
interface NotificationSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  organizationId: string;
}
```
**Features**:
- Show last 5 unread notifications
- "View All" link to `/workspace/notifications`
- Real-time updates via `useSSEConnection`
- Unread count badge
- Click notification → mark as read + navigate to detail

**Styling**: 
- Width: `w-80` (320px)
- Height: `h-full`
- Position: Fixed right sidebar overlay

---

### T009: Integrate NotificationSidebar into workspace layout
**File**: `frontend/apps/web/src/app/workspace/layout.tsx`
**Action**: Add sidebar toggle to top navigation and render sidebar
**Changes**:
1. Add bell icon button to top-right navigation (next to user profile)
2. Add state: `const [sidebarOpen, setSidebarOpen] = useState(false)`
3. Render `<NotificationSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />`
4. Show unread count badge on bell icon

**Dependencies**: Needs `getUnreadCount()` API call

---

## Phase C: Notification Hub Page Components

### T010: Create notifications page structure
**File**: `frontend/apps/web/src/app/workspace/notifications/page.tsx`
**Action**: Create main notification hub page
**Layout**:
```tsx
export default function NotificationsPage() {
  const { user } = useRequireAuth();
  const organizationId = user.organizationId;
  
  return (
    <div className="h-full flex flex-col">
      {/* Header: 56px height */}
      <div className="h-14 shrink-0 flex items-center justify-between px-6 border-b">
        <h1 className="text-xl font-semibold">Notifications</h1>
        <SSEConnectionStatus />
      </div>
      
      {/* Filters: 48px height */}
      <div className="h-12 shrink-0 border-b px-6">
        <NotificationFilters />
      </div>
      
      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <NotificationList organizationId={organizationId} />
      </div>
    </div>
  );
}
```

---

### T011 [P]: Create NotificationList component
**File**: `frontend/apps/web/src/app/workspace/notifications/components/NotificationList.tsx`
**Action**: Create scrollable notification list with infinite scroll
**Component Props**:
```typescript
interface NotificationListProps {
  organizationId: string;
}
```
**Features**:
- Use `useNotifications` hook for state
- Render `<NotificationItem />` for each notification
- Show `<NotificationEmpty />` when no notifications
- Infinite scroll: Load more on scroll to bottom (intersection observer)
- Loading spinner at bottom when fetching more

---

### T012 [P]: Create NotificationItem component
**File**: `frontend/apps/web/src/app/workspace/notifications/components/NotificationItem.tsx`
**Action**: Create individual notification card
**Component Props**:
```typescript
interface NotificationItemProps {
  notification: Notification;
  onMarkAsRead: (id: string) => void;
  onDelete: (id: string) => void;
  onClick?: (notification: Notification) => void;
}
```
**Layout** (height: `h-20` / 80px):
```
+---------------------------------------------------------------+
| [Icon] Title (bold if unread)                    [•] [Delete] |
|        Content (truncated to 2 lines)            [Timestamp]  |
|        [Domain Badge]                                         |
+---------------------------------------------------------------+
```
**Styling**:
- Unread: `bg-blue-50 border-l-4 border-l-blue-500`
- Read: `bg-white border-l-4 border-l-transparent`
- Hover: `hover:bg-gray-50`

**Actions**:
- Click anywhere: Mark as read + show detail (optional modal)
- Click [•] button: Mark as read toggle
- Click [Delete]: Confirm delete

---

### T013 [P]: Create NotificationFilters component
**File**: `frontend/apps/web/src/app/workspace/notifications/components/NotificationFilters.tsx`
**Action**: Create filter bar (inline horizontal layout)
**Component Props**:
```typescript
interface NotificationFiltersProps {
  filters: NotificationFilters;
  onFiltersChange: (filters: Partial<NotificationFilters>) => void;
}
```
**Layout** (horizontal, 48px height):
```
[All • Unread • Read]  [All Domains ▼]  [Mark All as Read]
```
**Filters**:
1. **Read Status**: Toggle group (All, Unread, Read)
2. **Domain Filter**: Dropdown (All, Organization, CRM, Projects, etc.)
3. **Bulk Action**: "Mark All as Read" button

**Styling**: `flex items-center gap-4 h-12`

---

### T014 [P]: Create SSEConnectionStatus component
**File**: `frontend/apps/web/src/app/workspace/notifications/components/SSEConnectionStatus.tsx`
**Action**: Create connection status indicator
**Component Props**:
```typescript
interface SSEConnectionStatusProps {
  status: SSEConnectionState['status'];
  error?: Error | null;
  onReconnect?: () => void;
}
```
**States**:
- `connected`: Green dot + "Live" text
- `connecting`: Yellow dot + "Connecting..." text
- `disconnected`: Red dot + "Disconnected" + [Reconnect] button
- `error`: Red dot + "Error: {message}" + [Retry] button

**Styling**: `flex items-center gap-2 text-sm`

---

### T015 [P]: Create NotificationEmpty component
**File**: `frontend/apps/web/src/app/workspace/notifications/components/NotificationEmpty.tsx`
**Action**: Create empty state for zero notifications
**Component Props**:
```typescript
interface NotificationEmptyProps {
  filters: NotificationFilters;
}
```
**Layout**:
```
        [Bell Icon]
    No notifications yet
 (Or "No unread notifications" if filtered)
```
**Styling**: Centered vertically with `py-12`, compact spacing

---

### T016 [P]: Create NotificationDetail component (optional)
**File**: `frontend/apps/web/src/app/workspace/notifications/components/NotificationDetail.tsx`
**Action**: Create modal/drawer for full notification content
**Component Props**:
```typescript
interface NotificationDetailProps {
  notification: Notification;
  isOpen: boolean;
  onClose: () => void;
  onMarkAsRead: () => void;
  onDelete: () => void;
}
```
**Layout**: MUI Dialog/Drawer with full notification content + action buttons
**Optional**: May defer to Phase F if not needed for MVP

---

## Phase D: State Integration & Wiring

### T017: Wire SSE connection to notification list
**File**: `frontend/apps/web/src/app/workspace/notifications/page.tsx`
**Action**: Connect `useSSEConnection` hook to `useNotifications` hook
**Implementation**:
```typescript
const { addRealtimeNotification } = useNotifications(organizationId);
const { status, error, reconnect } = useSSEConnection(
  organizationId,
  (notification) => {
    addRealtimeNotification(notification);
    // Show toast notification (optional)
  }
);
```
**Pass** `status`, `error`, `reconnect` to `<SSEConnectionStatus />`

---

### T018: Implement optimistic mark as read
**File**: `frontend/packages/notifications/src/useNotifications.ts`
**Action**: Add optimistic UI update for mark as read
**Flow**:
1. Immediately update local state (`isRead = true`)
2. Call `markAsRead()` API in background
3. If API fails, revert local state + show error toast
4. Update unread count immediately

**Validation**: Manual test in Phase E (quickstart.md scenario 3)

---

### T019: Implement delete notification
**File**: `frontend/packages/notifications/src/useNotifications.ts`
**Action**: Remove notification from local state after API call
**Flow**:
1. Show confirmation dialog (optional)
2. Call `deleteNotification()` API
3. Remove from local state on success
4. Show error toast on failure

---

### T020: Implement bulk mark all as read
**File**: `frontend/packages/notifications/src/useNotifications.ts`
**Action**: Mark all visible notifications as read
**Flow**:
1. Get timestamp of oldest notification in current list
2. Call `markAllBeforeTimestampAsRead(timestamp)` API
3. Update local state for all matching notifications
4. Update unread count

**Validation**: Manual test in Phase E (quickstart.md scenario 11)

---

### T021: Implement client-side filtering
**File**: `frontend/packages/notifications/src/useNotifications.ts`
**Action**: Filter notifications by read status and domain
**Logic**:
```typescript
const filteredNotifications = useMemo(() => {
  return notifications.filter(n => {
    // Filter by read status
    if (filters.readStatus === 'unread' && n.isRead) return false;
    if (filters.readStatus === 'read' && !n.isRead) return false;
    
    // Filter by domain
    if (filters.domain && n.source.domain !== filters.domain) return false;
    
    return true;
  });
}, [notifications, filters]);
```

---

### T022: Implement pagination (load more)
**File**: `frontend/packages/notifications/src/useNotifications.ts`
**Action**: Load next page of notifications on scroll
**Implementation**:
- Track `currentPage` and `hasMore` state
- `loadMore()`: Increment page, call `listNotifications(page)`, append to array
- Stop when API returns fewer than page size (20)

**UI**: Show "Loading..." spinner at bottom of list

---

## Phase E: Manual Verification & Testing (Post-Verification)

### T023: Manual verification - Backend integration
**Action**: Verify backend SSE streaming works end-to-end
**Prerequisites**: Backend running with T000 complete

**Tests**:
1. **Authentication Test**:
   - Frontend SSE connection includes valid JWT token
   - Backend accepts connection and authenticates
   - No 401 errors in browser console or backend logs

2. **Streaming Test**:
   - Backend sends NotificationEvent messages
   - Frontend receives and renders notifications in real-time
   - Connection stays open (no premature disconnects)

3. **Multi-tenant Isolation**:
   - Create notification for Organization A
   - Verify only users in Organization A receive it
   - Users in Organization B should not see it

**Tools**:
- Browser DevTools Network tab (check EventSource connection)
- Backend logs (verify authentication and message sending)
- Database query: Check `notification.active_connection` table

**Output**: Document authentication flow and any issues

---

### T024: Manual verification - Core flows
**Action**: Execute quickstart.md scenarios 1-7
**Scenarios**:
1. Page load and initial notification list
2. SSE real-time notification arrival
3. Mark notification as read (optimistic update)
4. Filter by unread status
5. Filter by domain (organization, CRM, etc.)
6. Pagination - Load more notifications
7. Delete notification

### T024: Manual verification - Core flows
**Action**: Execute quickstart.md scenarios 1-7
**Scenarios**:
1. Page load and initial notification list
2. SSE real-time notification arrival
3. Mark notification as read (optimistic update)
4. Filter by unread status
5. Filter by domain (organization, CRM, etc.)
6. Pagination - Load more notifications
7. Delete notification

**Output**: Document any bugs or unexpected behavior

---

### T025: Manual verification - SSE reconnection
**Action**: Execute quickstart.md scenarios 8-10
**Scenarios**:
8. SSE connection failure & auto-reconnect
9. Proactive 5-minute disconnect/reconnect
10. Manual reconnect via UI button

**Validation**: Connection status indicator updates correctly

---

### T026: Manual verification - Sidebar & bulk actions
**Action**: Execute quickstart.md scenarios 11-15
**Scenarios**:
11. Right sidebar notification preview
12. Bulk mark all as read
13. Empty state display
14. Connection status indicator
15. Responsive layout & density

### T026: Manual verification - Sidebar & bulk actions
**Action**: Execute quickstart.md scenarios 11-15
**Scenarios**:
11. Right sidebar notification preview
12. Bulk mark all as read
13. Empty state display
14. Connection status indicator
15. Responsive layout & density

**Validation**: All UI components render correctly on 13-inch screen

---

**🚨 QUALITY GATE 🚨**: Human verification MUST PASS before proceeding to tests

---

### T027 [P]: Write component unit tests
**Files**: `frontend/apps/web/src/app/workspace/notifications/components/*.test.tsx`
**Action**: Test each component with React Testing Library
**Tests**:
- `NotificationItem.test.tsx`: Render unread/read states, click actions
- `NotificationFilters.test.tsx`: Filter toggle, dropdown selection
- `SSEConnectionStatus.test.tsx`: Status indicator colors, reconnect button
- `NotificationEmpty.test.tsx`: Empty state messages

### T027 [P]: Write component unit tests
**Files**: `frontend/apps/web/src/app/workspace/notifications/components/*.test.tsx`
**Action**: Test each component with React Testing Library
**Tests**:
- `NotificationItem.test.tsx`: Render unread/read states, click actions
- `NotificationFilters.test.tsx`: Filter toggle, dropdown selection
- `SSEConnectionStatus.test.tsx`: Status indicator colors, reconnect button
- `NotificationEmpty.test.tsx`: Empty state messages

**Coverage Target**: 80% line coverage for components

---

### T028 [P]: Write hook unit tests
**Files**: `frontend/packages/notifications/src/*.test.ts`
**Action**: Test hooks with @testing-library/react-hooks
**Tests**:
- `useSSEConnection.test.ts`: Connection lifecycle, reconnection logic, cleanup
- `useNotifications.test.ts`: Load notifications, mark as read, filters, pagination

### T028 [P]: Write hook unit tests
**Files**: `frontend/packages/notifications/src/*.test.ts`
**Action**: Test hooks with @testing-library/react-hooks
**Tests**:
- `useSSEConnection.test.ts`: Connection lifecycle, reconnection logic, cleanup
- `useNotifications.test.ts`: Load notifications, mark as read, filters, pagination

**Mocks**: Mock API functions from `apis`

---

### T029: Write integration test - SSE reconnection flow
**File**: `frontend/apps/web/src/app/workspace/notifications/__tests__/sse-reconnection.test.tsx`
**Action**: Test full SSE connection failure and reconnection
**Flow**:
1. Establish SSE connection
2. Simulate connection drop
3. Verify auto-reconnect with exponential backoff
4. Verify notification continues to arrive after reconnect

### T029: Write integration test - SSE reconnection flow
**File**: `frontend/apps/web/src/app/workspace/notifications/__tests__/sse-reconnection.test.tsx`
**Action**: Test full SSE connection failure and reconnection
**Flow**:
1. Establish SSE connection
2. Simulate connection drop
3. Verify auto-reconnect with exponential backoff
4. Verify notification continues to arrive after reconnect

**Duration**: ~30 seconds (includes retry delays)

---

### T030: Write integration test - Notification hub user journey
**File**: `frontend/apps/web/src/app/workspace/notifications/__tests__/notification-hub.test.tsx`
**Action**: Test complete user journey
**Steps**:
1. Load notification page
2. Receive real-time notification via SSE (mocked)
3. Mark notification as read (optimistic)
4. Apply filter (unread only)
5. Load more (pagination)
6. Delete notification

### T030: Write integration test - Notification hub user journey
**File**: `frontend/apps/web/src/app/workspace/notifications/__tests__/notification-hub.test.tsx`
**Action**: Test complete user journey
**Steps**:
1. Load notification page
2. Receive real-time notification via SSE (mocked)
3. Mark notification as read (optimistic)
4. Apply filter (unread only)
5. Load more (pagination)
6. Delete notification

**Validation**: All state transitions work correctly

---

## Phase F: Documentation & Polish

### T031: Create notification hub README
**File**: `frontend/apps/web/src/app/workspace/notifications/README.md`
**Action**: Document notification hub feature
**Sections**:
1. **Overview**: Real-time notification center with SSE
2. **Components**: List all components with responsibilities
3. **Hooks**: Document `useSSEConnection` and `useNotifications`
4. **State Management**: Explain optimistic updates and filtering
5. **Testing**: Link to quickstart.md and test files
6. **Performance**: SSE reconnection strategy, pagination

### T031: Create notification hub README
**File**: `frontend/apps/web/src/app/workspace/notifications/README.md`
**Action**: Document notification hub feature
**Sections**:
1. **Overview**: Real-time notification center with SSE
2. **Components**: List all components with responsibilities
3. **Hooks**: Document `useSSEConnection` and `useNotifications`
4. **State Management**: Explain optimistic updates and filtering
5. **Testing**: Link to quickstart.md and test files
6. **Performance**: SSE reconnection strategy, pagination
7. **Backend Integration**: Authentication flow, streaming protocol

---

## Parallel Execution Guide

**Phase 0** (Backend - MUST complete first):
```bash
# T000 is CRITICAL prerequisite - blocks all frontend work
Task: Add WrapStreamingHandler to AuthInterceptor
```

**Phase A** (All parallel - after Phase 0):
```bash
# Execute T001-T006 simultaneously (6 different files)
Task: Create notifications package structure
Task: Implement TypeScript types
Task: Implement utility functions
Task: Implement useSSEConnection hook
Task: Implement useNotifications hook
Task: Export package public API
```

**Phase B** (Sequential):
```bash
# T007 → T008 → T009 (workspace layout integration)
```

**Phase C** (Mostly parallel after T010):
```bash
# T010 must complete first, then T011-T016 in parallel
Task: Create NotificationList component
Task: Create NotificationItem component
Task: Create NotificationFilters component
Task: Create SSEConnectionStatus component
Task: Create NotificationEmpty component
Task: Create NotificationDetail component (optional)
```

**Phase D** (Sequential - state wiring):
```bash
# T017 → T018 → T019 → T020 → T021 → T022
```

**Phase E** (Parallel test execution - after manual verification):
```bash
# T027-T030 can run in parallel (different test files)
Task: Write component unit tests
Task: Write hook unit tests
Task: Write integration test - SSE reconnection flow
Task: Write integration test - Notification hub user journey
```

---

## Dependencies Summary

```
Phase 0 (T000) ← CRITICAL: Backend SSE authentication
  ↓
Phase A (T001-T006) ← Frontend package foundation
  ↓
Phase B (T007-T009) ← Workspace integration
  ↓
Phase C (T010-T016) ← UI components
  ↓
Phase D (T017-T022) ← State wiring & logic
  ↓
Phase E (T023-T026) ← Manual Verification Gate (includes backend integration test)
  ↓
Phase E (T027-T030) ← Tests ONLY after verification
  ↓
Phase F (T031) ← Documentation
```

---

## Quality Checklist

**Before Starting Implementation**:
- [ ] Backend notification service running (#007 complete)
- [ ] **Backend SSE authentication fixed (T000 complete)**
- [ ] Frontend API client exists (`frontend/packages/apis/src/notification.ts`)
- [ ] Workspace layout structure understood
- [ ] Constitution v3.5.0 UI/UX principles reviewed

**After Phase 0** (Backend Prerequisites):
- [ ] AuthInterceptor has `WrapStreamingHandler` method
- [ ] SSE streaming endpoint accepts authenticated connections
- [ ] JWT token validation works for streaming RPCs
- [ ] User context (user_id, organization_id) available in stream handlers

**After Phase D** (Implementation Complete):
- [ ] All components render without errors
- [ ] SSE connection establishes successfully
- [ ] Real-time notifications appear in UI
- [ ] Mark as read works (optimistic update)
- [ ] Filters work (read/unread, domain)
- [ ] Pagination loads more notifications
- [ ] No console errors or warnings

**After Phase E** (Verification & Tests):
- [ ] **Backend integration verified (T023)**: SSE auth + streaming + multi-tenant isolation
- [ ] All 15 quickstart.md scenarios pass
- [ ] Component tests pass (80%+ coverage)
- [ ] Hook tests pass
- [ ] Integration tests pass
- [ ] No TypeScript errors (`pnpm web build`)
- [ ] Linting passes (`pnpm web lint`)

**Production Readiness**:
- [ ] SSE reconnection tested with network throttling
- [ ] Performance: Page load < 2s, real-time render < 500ms
- [ ] Responsive layout works on 13-inch screens
- [ ] UI density follows Constitution spacing guidelines
- [ ] Documentation complete (README.md)
- [ ] **End-to-end integration verified: Backend SSE → Frontend UI**

---

**Total Estimated Time**: 3-5 days  
**Complexity**: Medium (frontend-focused with backend integration)  
**Risk**: Low (backend API exists, needs auth fix for streaming)

**Next Step**: Execute T000 - Add WrapStreamingHandler to AuthInterceptor (CRITICAL)

---

*Based on: `specs/008-notification-hub-frontend/plan.md` v1.0.0*  
*Constitution: v3.5.0*  
*Generated: 2025-10-26*
