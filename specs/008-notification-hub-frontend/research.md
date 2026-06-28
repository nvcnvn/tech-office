# Research: Notification Hub Frontend

## Overview
Research findings for implementing the notification hub frontend UI, focusing on real-time SSE connection patterns, React state management for notifications, and integration with existing workspace architecture.

## Research Questions Addressed

### 1. SSE Connection Management in React

**Decision**: Use custom React hook `useSSEConnection` with Connect-Web streaming API

**Rationale**:
- Connect-Web provides native support for server streaming RPCs (SSE)
- Existing `frontend/packages/apis/src/notification.ts` already has `streamNotifications()` async generator
- React hook pattern enables component-level connection management and cleanup
- Supports automatic reconnection with exponential backoff
- Last event ID persistence via localStorage for missed event replay

**Implementation Pattern**:
```typescript
// Async generator from Connect-Web
async function* streamNotifications(lastEventId?: string) {
  const stream = notificationClient.streamNotifications({ lastEventId: lastEventId ?? "" });
  for await (const event of stream) {
    yield event;
  }
}

// React hook wrapper
function useSSEConnection() {
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');
  const [lastEventId, setLastEventId] = useState<string>(() => localStorage.getItem('notification_last_event_id') || '');
  
  useEffect(() => {
    // Connection lifecycle management
    // Auto-reconnect on disconnect
    // 5-minute proactive disconnect/reconnect
  }, []);
  
  return { connectionStatus, messages, reconnect };
}
```

**Alternatives Considered**:
- EventSource API directly - rejected because Connect-Web abstracts RPC details and provides type safety
- WebSocket - rejected because backend already implements SSE, changing would require backend refactor
- Third-party SSE library (e.g., sse.js) - rejected because Connect-Web already handles streaming

**Existing Patterns to Follow**:
- `frontend/packages/apis/src/notification.ts` - Already has `streamNotifications()` generator
- `frontend/apps/web/src/lib/auth/hooks.ts` - Example of custom React hooks for shared logic

### 2. Notification State Management

**Decision**: Simple React state + optimistic updates, no complex state library

**Rationale**:
- Notification list is relatively simple: array of notification objects with CRUD operations
- TanStack Query (React Query) considered but overkill - notifications come via SSE, not REST polling
- Optimistic updates (mark as read) improve perceived performance
- Local state sufficient - no need for global Redux/Zustand store

**Implementation Pattern**:
```typescript
function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  
  // Optimistic mark as read
  const markAsRead = async (id: string) => {
    // Update UI immediately
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, readStatus: true } : n));
    setUnreadCount(prev => prev - 1);
    
    try {
      await markAsReadAPI(id);
    } catch (error) {
      // Rollback on error
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, readStatus: false } : n));
      setUnreadCount(prev => prev + 1);
      throw error;
    }
  };
  
  return { notifications, unreadCount, markAsRead, addNotification };
}
```

**Alternatives Considered**:
- TanStack Query - rejected because SSE provides real-time updates, no need for polling/caching
- Redux Toolkit - rejected for complexity; no need for global state sharing
- Zustand - rejected for simplicity; component-level state sufficient

**Existing Patterns to Follow**:
- Simple React hooks pattern used throughout frontend codebase
- `frontend/apps/web/src/lib/auth/hooks.ts` - useRequireAuth pattern

### 3. Workspace Layout Integration

**Decision**: Extend existing `workspace/layout.tsx` with notifications tab + right sidebar preview component

**Rationale**:
- Constitution v3.5.0 mandates: "ALL business features MUST be implemented under workspace/ and share layout"
- Existing layout already has tabs array structure - easy to add notifications
- Right sidebar already exists in layout - add NotificationSidebar component
- Maintains consistent UX across all workspace features

**Implementation Approach**:
```typescript
// workspace/layout.tsx modification
const tabs: TabConfig[] = [
  // ... existing tabs
  { id: 'notifications', label: 'Notifications', emoji: '🔔', path: '/workspace/notifications', shortcut: '⌘0', enabled: true },
];

// Add to right sidebar section
{sidebarOpen && (
  <aside className="w-80 shrink-0 border-l bg-white overflow-y-auto">
    <NotificationSidebar /> {/* NEW */}
    {/* ... other sidebar content */}
  </aside>
)}
```

**Alternatives Considered**:
- Separate layout for notifications - REJECTED per Constitution: "DO NOT create duplicate layouts"
- Modal/popup for notifications - rejected because spec requires dedicated page
- Global header notification bell - rejected because spec wants sidebar preview

**Existing Patterns to Follow**:
- `frontend/apps/web/src/app/workspace/layout.tsx` - Shared workspace layout (MANDATORY reference)
- `frontend/apps/web/src/app/workspace/organization/page.tsx` - Example domain page with sub-navigation
- `frontend/apps/web/src/components/TabLink.tsx` - Tab navigation component

### 4. UI/UX Density & Spacing (Constitution v3.5.0)

**Decision**: Apply content density principles optimized for 13-inch laptops

**Key Measurements**:
- Top nav height: 56px (h-14) - FIXED, do not modify
- Sub-nav/tabs height: 48px (h-12)
- Combined chrome: 104px maximum
- Page padding: py-4 (16px) to py-6 (24px)
- Section gaps: gap-4 (16px) to gap-6 (24px)
- Table row height: h-10 (40px) for dense data
- Component padding: p-4 (16px) standard

**Horizontal Space Utilization**:
```tsx
// GOOD: Spread controls horizontally
<div className="flex items-center justify-between h-12">
  <div className="flex gap-2">
    <FilterButtons /> {/* All/Unread toggles */}
    <SourceFilter />  {/* Domain filter dropdown */}
  </div>
  <div className="flex gap-2 items-center">
    <SSEConnectionStatus />
    <Button size="sm">Mark All Read</Button>
  </div>
</div>

// BAD: Vertical stacking wastes horizontal space
<div className="flex flex-col gap-4">
  <FilterButtons />
  <SourceFilter />
  <ActionButtons />
</div>
```

**Typography**:
- Page title: text-2xl (24px)
- Section heading: text-lg (18px)
- Body text: text-sm (14px) - STANDARD
- Small text: text-xs (12px) for metadata

**Rationale**:
- Maximizes content visible without scrolling on 13-inch screens
- Horizontal distribution prevents excessive vertical stacking
- Dense layouts improve productivity for data-heavy interfaces

**Reference**:
- `.github/copilot-instructions.md` section "UI/UX Design Principles for Wide Screens"
- `frontend/apps/web/src/app/workspace/organization/page.tsx` - Example of density principles applied

### 5. SSE Reconnection Strategy

**Decision**: Exponential backoff with 5-minute proactive disconnect/reconnect

**Rationale**:
- Spec requirement: "System MUST close SSE connection gracefully every 5 minutes to prevent long-running connection issues"
- Exponential backoff prevents thundering herd: 1s → 2s → 4s → 8s → max 30s
- Last event ID persistence enables missed event replay after reconnection
- Proactive disconnect prevents proxy/load balancer timeouts

**Implementation Pattern**:
```typescript
// Reconnection state machine
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 30000]; // ms
const PROACTIVE_DISCONNECT_INTERVAL = 5 * 60 * 1000; // 5 minutes

useEffect(() => {
  let reconnectAttempt = 0;
  let proactiveTimer: NodeJS.Timeout;
  
  const connect = async () => {
    try {
      setStatus('connecting');
      const stream = streamNotifications(lastEventId);
      
      // Set proactive disconnect timer
      proactiveTimer = setTimeout(() => {
        console.log('[SSE] Proactive disconnect after 5 minutes');
        // Close stream gracefully
        // Reconnect immediately with last_event_id
      }, PROACTIVE_DISCONNECT_INTERVAL);
      
      for await (const event of stream) {
        handleEvent(event);
        reconnectAttempt = 0; // Reset on successful event
      }
    } catch (error) {
      setStatus('error');
      // Exponential backoff reconnect
      const delay = RECONNECT_DELAYS[Math.min(reconnectAttempt, RECONNECT_DELAYS.length - 1)];
      setTimeout(connect, delay);
      reconnectAttempt++;
    }
  };
  
  connect();
  return () => clearTimeout(proactiveTimer);
}, [lastEventId]);
```

**Alternatives Considered**:
- Fixed retry interval - rejected because can cause thundering herd on server restart
- No proactive disconnect - rejected per spec requirement
- Keep connection alive indefinitely - rejected due to proxy timeout issues

**Existing Patterns to Follow**:
- React useEffect cleanup pattern for connection lifecycle
- localStorage for persisting last_event_id across page reloads

### 6. Authentication with SSE Endpoint

**Decision**: Reuse existing auth token from useRequireAuth hook in Authorization header

**Rationale**:
- Backend spec confirms: "MUST send Authorization: Bearer <token> header with SSE connection request"
- AuthInterceptor already validates JWT tokens from Authorization header
- Connect-Web transport allows custom headers
- Same token used for all RPC calls - consistent auth pattern

**Implementation**:
```typescript
// Get token from auth context
const { token } = useRequireAuth();

// Connect-Web streaming with custom headers
const transport = createConnectTransport({
  baseUrl: '/api',
  interceptors: [
    (next) => async (req) => {
      req.header.set('Authorization', `Bearer ${token}`);
      return await next(req);
    }
  ]
});
```

**Backend Status**: ✅ Already in place
- `backend/internal/interceptor/auth.go` handles token validation
- Proto access_control: `allowed_roles: [ROLE_OWNER, ROLE_OPERATOR, ROLE_EMPLOYEE]`
- ⚠️ Minor fix needed: Add `WrapStreamingHandler` method to AuthInterceptor for full streaming support

**Alternatives Considered**:
- Query parameter token - rejected for security (logged in URLs)
- Cookie-based auth - rejected because JWT token pattern already established
- Separate SSE auth endpoint - rejected for complexity

**Existing Patterns to Follow**:
- `frontend/apps/web/src/lib/auth/hooks.ts` - useRequireAuth provides token
- `frontend/packages/apis/src/rpc.ts` - RPC client setup with transport configuration

### 7. Empty State & Loading Patterns

**Decision**: MUI Skeleton loaders + compact empty state

**Rationale**:
- Constitution: "System MUST show loading skeletons during initial page load and pagination"
- Empty states should be compact (py-8, not py-12 or py-16) to save vertical space
- MUI already provides Skeleton components

**Implementation**:
```tsx
// Loading skeleton
<div className="space-y-2">
  {Array.from({ length: 10 }).map((_, i) => (
    <Skeleton key={i} variant="rectangular" height={40} />
  ))}
</div>

// Empty state - compact vertical spacing
<div className="py-8 text-center"> {/* NOT py-16 */}
  <NotificationsOffIcon className="w-12 h-12 mx-auto text-gray-400" />
  <p className="mt-2 text-sm text-gray-600">No notifications yet</p>
  <p className="mt-1 text-xs text-gray-500">
    You'll see updates from projects, chat, and more here
  </p>
</div>
```

**Existing Patterns to Follow**:
- MUI Skeleton component (already in project dependencies)
- Compact spacing patterns per Constitution v3.5.0

## Technical Dependencies

### Backend (Already Implemented in #007)
- ✅ NotificationService RPC endpoints (List, MarkAsRead, Stream, GetUnreadCount)
- ✅ SSE streaming with LISTEN/NOTIFY
- ✅ Connection registry for multi-instance routing
- ✅ Authentication via AuthInterceptor
- ⚠️ Minor fix: Streaming interceptor support (WrapStreamingHandler method)

### Frontend Packages
- ✅ `@connectrpc/connect-web` - RPC client with streaming
- ✅ `@mui/material` - UI components
- ✅ `next` - App Router framework
- ✅ `react` - Component library
- ✅ `frontend/packages/apis` - Existing notification API client
- ✅ `frontend/packages/rpc` - Generated protobuf types

### New Frontend Package
- 🆕 `frontend/packages/notifications` - Shared notification utilities
  - `useSSEConnection.ts` - SSE connection hook
  - `useNotifications.ts` - Notification state hook
  - `types.ts` - Frontend notification types
  - `utils.ts` - Helper functions

## Performance Considerations

### Initial Load Performance
- Target: <2 seconds for first 50 notifications
- Strategy: Server-side pagination with page_token
- Implementation: React Suspense boundaries for loading states

### Real-Time Update Performance
- Target: <500ms from SSE event to UI update
- Strategy: Optimistic UI updates, minimal re-renders
- Implementation: React.memo for NotificationItem components

### Memory Management
- Keep max 200 notifications in memory (4 pages)
- Older notifications cleared on pagination
- localStorage for last_event_id only (not full notification history)

### Network Optimization
- SSE connection reuse (don't create multiple connections)
- Debounce bulk actions (300ms) to prevent double-clicks
- Connection pooling handled by Connect-Web transport

## Security Considerations

### Authentication
- ✅ JWT token from Zitadel via useRequireAuth
- ✅ Authorization header for SSE connection
- ✅ Backend validates token and extracts employee_id + organization_id

### Tenant Isolation
- ✅ Backend enforces organization_id filters (TenantPool)
- Frontend cannot bypass tenant isolation (all validation at backend)

### XSS Prevention
- Use React JSX (auto-escapes content)
- Sanitize notification message content if rendering HTML (currently plain text)

### CSRF Protection
- Not applicable (no cookies, token-based auth)

## Testing Strategy (Post-Verification)

### Unit Tests
- `useSSEConnection.test.ts` - Connection state machine
- `useNotifications.test.ts` - Notification state management
- `NotificationItem.test.tsx` - Component rendering

### Integration Tests
- SSE reconnection flow (simulate disconnect)
- Mark as read optimistic update + rollback on error
- Filter and pagination behavior

### E2E Tests (Quickstart Validation)
- Employee logs in → sees notification hub
- New notification arrives via SSE → appears in list
- Mark notification as read → status persists
- Filter by unread → only unread shown
- Sidebar preview shows recent notifications

## Open Questions / Future Enhancements

### Immediate Scope (This Feature)
- ✅ All questions resolved from spec
- ✅ No NEEDS CLARIFICATION markers
- ✅ Backend provides all required APIs

### Future Enhancements (Out of Scope)
- 🔮 Sound notifications for new messages
- 🔮 Browser push notifications when tab inactive
- 🔮 Notification action navigation (click to open source item)
- 🔮 Per-employee notification preferences (mute types)
- 🔮 Rich notification content (images, attachments)

## References

### Constitution & Guidelines
- `.specify/memory/constitution.md` v3.5.0 - Frontend UI/UX density principles
- `.github/copilot-instructions.md` - AI development guide with frontend patterns
- `.github/instructions/sql.instructions.md` - Database standards (not applicable here)

### Backend Specification
- `specs/007-notification-hub-backend/spec.md` - Notification system design
- `backend/rpc/v1/notification.proto` - RPC contract

### Existing Implementations (Reference)
- `frontend/apps/web/src/app/workspace/layout.tsx` - Workspace layout pattern
- `frontend/apps/web/src/app/workspace/organization/` - Domain feature example
- `frontend/packages/apis/src/notification.ts` - Existing notification API client
- `frontend/packages/apis/src/rpcWrapper.ts` - RPC error handling pattern

### Technical Documentation
- [Connect-Web Streaming](https://connectrpc.com/docs/web/streaming) - SSE implementation guide
- [React Hooks Patterns](https://react.dev/reference/react) - Hook best practices
- [MUI Component Library](https://mui.com/material-ui/) - UI components

---

**Status**: ✅ Research complete - All technical unknowns resolved, ready for Phase 1 design
