# Data Model: Notification Hub Frontend

## Overview
Frontend data models for the notification hub UI. These are **client-side TypeScript types** that represent notification state, SSE connection status, and UI-specific models. Backend database schema already exists from #007-notification-hub-backend.

**Note**: This is NOT a database schema design document. All backend data models already exist. This document defines frontend-only state structures.

---

## Frontend State Models

### 1. Notification (Frontend Model)

**Purpose**: Client-side representation of notification data received from backend

**Source**: Mapped from backend `NotificationSummary` protobuf message

```typescript
interface Notification {
  // Identifiers
  notificationId: string;              // UUID of notification
  notificationRecipientId: string;     // UUID for mark as read operation
  
  // Content
  sourceDomain: SourceDomain;          // 'chat' | 'crm' | 'projects' | 'hr' | 'support' | 'finance' | 'system'
  notificationType: string;            // Dot-separated type (e.g., 'message.new', 'deal.assigned')
  title: string;                       // Notification title
  message: string;                     // Notification message body
  actionData: ActionData | null;       // Action-specific metadata (JSON)
  
  // Status
  readStatus: boolean;                 // true if read, false if unread
  readAt: Date | null;                 // Timestamp when marked as read
  deliveryStatus: DeliveryStatus;      // 'pending' | 'delivered' | 'failed'
  deliveredAt: Date | null;            // Timestamp when delivered via SSE
  
  // Timestamps
  createdAt: Date;                     // When notification was created
}

type SourceDomain = 
  | 'chat' 
  | 'crm' 
  | 'projects' 
  | 'hr' 
  | 'support' 
  | 'finance' 
  | 'system';

type DeliveryStatus = 'pending' | 'delivered' | 'failed';

interface ActionData {
  // Flexible JSON structure for action-specific data
  // Examples:
  // - Chat: { threadId: string, messageId: string }
  // - CRM: { dealId: string, contactId: string }
  // - Projects: { projectId: string, ticketId: string }
  [key: string]: unknown;
}
```

**Mapping from Backend**:
```typescript
function mapNotificationFromProto(proto: NotificationSummary): Notification {
  return {
    notificationId: proto.notificationId,
    notificationRecipientId: proto.notificationRecipientId,
    sourceDomain: proto.sourceDomain as SourceDomain,
    notificationType: proto.notificationType,
    title: proto.title,
    message: proto.message,
    actionData: proto.actionData ? JSON.parse(proto.actionData) : null,
    readStatus: proto.readStatus,
    readAt: proto.readAt ? new Date(proto.readAt) : null,
    deliveryStatus: proto.deliveryStatus as DeliveryStatus,
    deliveredAt: proto.deliveredAt ? new Date(proto.deliveredAt) : null,
    createdAt: new Date(proto.createdAt),
  };
}
```

**UI Usage**:
- Displayed in NotificationList component
- Filtered by readStatus and sourceDomain
- Used for mark as read operation via notificationRecipientId

---

### 2. SSEConnectionState

**Purpose**: Tracks real-time SSE connection status and health

**Lifecycle**: Managed by `useSSEConnection` hook

```typescript
interface SSEConnectionState {
  // Connection status
  status: ConnectionStatus;            // Current connection state
  lastEventId: string | null;          // UUID of last received event (for replay)
  
  // Connection metrics
  connectedAt: Date | null;            // When connection was established
  lastHeartbeat: Date | null;          // Last heartbeat event timestamp
  lastEventAt: Date | null;            // Last notification event timestamp
  eventCount: number;                  // Total events received this session
  
  // Reconnection state
  reconnectAttempt: number;            // Current reconnection attempt count
  nextReconnectDelay: number;          // Milliseconds until next reconnect
  
  // Proactive disconnect
  nextProactiveDisconnect: Date | null; // When 5-minute disconnect will occur
}

type ConnectionStatus = 
  | 'disconnected'  // Initial state, not connected
  | 'connecting'    // Attempting to establish connection
  | 'connected'     // Connection established, receiving events
  | 'error';        // Connection failed

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 30000]; // Exponential backoff (ms)
const PROACTIVE_DISCONNECT_INTERVAL = 5 * 60 * 1000;      // 5 minutes
```

**Storage**:
- `lastEventId` persisted to `localStorage.getItem('notification_last_event_id')`
- Other fields in React state only (not persisted)

**UI Usage**:
- Connection status indicator component
- Determines when to show "Connecting..." or "Reconnecting..." message
- Manual reconnect button enabled when status is 'error'

---

### 3. NotificationFilters

**Purpose**: User-selected filters for notification list

**Lifecycle**: Managed by notification page component state

```typescript
interface NotificationFilters {
  // Read status filter
  showUnreadOnly: boolean;             // If true, filter to unread only
  
  // Source domain filter
  selectedSourceDomains: SourceDomain[]; // Empty array = all domains
  
  // Applied timestamp
  appliedAt: Date;                     // When filters were last changed (for UI feedback)
}

// Default filters (show all)
const DEFAULT_FILTERS: NotificationFilters = {
  showUnreadOnly: false,
  selectedSourceDomains: [],
  appliedAt: new Date(),
};
```

**UI Usage**:
- Filter toggle buttons (All / Unread Only)
- Source domain checkboxes
- Applied to notification list before rendering

**Filter Logic**:
```typescript
function applyFilters(
  notifications: Notification[],
  filters: NotificationFilters
): Notification[] {
  let filtered = notifications;
  
  // Apply read status filter
  if (filters.showUnreadOnly) {
    filtered = filtered.filter(n => !n.readStatus);
  }
  
  // Apply source domain filter
  if (filters.selectedSourceDomains.length > 0) {
    filtered = filtered.filter(n => 
      filters.selectedSourceDomains.includes(n.sourceDomain)
    );
  }
  
  return filtered;
}
```

---

### 4. PaginationState

**Purpose**: Tracks pagination position for notification list

**Lifecycle**: Managed by notification page component

```typescript
interface PaginationState {
  // Pagination tokens
  currentPageToken: string;            // Token for current page (empty for first page)
  nextPageToken: string | null;        // Token for next page (null if no more pages)
  
  // Page metadata
  itemsPerPage: number;                // Default 50
  currentPage: number;                 // 1-indexed page number
  hasNextPage: boolean;                // Derived from nextPageToken !== null
  
  // Loading state
  loadingState: LoadingState;          // Current loading status
  error: Error | null;                 // Error from last load attempt
}

type LoadingState = 
  | 'idle'      // No operation in progress
  | 'loading'   // Loading page
  | 'error';    // Load failed

// Default pagination state (first page)
const DEFAULT_PAGINATION: PaginationState = {
  currentPageToken: '',
  nextPageToken: null,
  itemsPerPage: 50,
  currentPage: 1,
  hasNextPage: false,
  loadingState: 'idle',
  error: null,
};
```

**UI Usage**:
- "Load More" button visibility (show if hasNextPage)
- Loading spinner display (show if loadingState === 'loading')
- Error message display (show if loadingState === 'error')

**Load More Pattern**:
```typescript
async function loadNextPage() {
  if (!pagination.hasNextPage || pagination.loadingState === 'loading') {
    return; // Prevent duplicate loads
  }
  
  setPagination(prev => ({ ...prev, loadingState: 'loading' }));
  
  try {
    const response = await listNotifications({
      pageToken: pagination.nextPageToken,
      pageSize: pagination.itemsPerPage,
    });
    
    // Append to existing notifications
    setNotifications(prev => [...prev, ...response.notifications]);
    
    setPagination(prev => ({
      ...prev,
      currentPageToken: pagination.nextPageToken!,
      nextPageToken: response.nextPageToken || null,
      currentPage: prev.currentPage + 1,
      hasNextPage: !!response.nextPageToken,
      loadingState: 'idle',
      error: null,
    }));
  } catch (error) {
    setPagination(prev => ({
      ...prev,
      loadingState: 'error',
      error: error as Error,
    }));
  }
}
```

---

### 5. UnreadCount

**Purpose**: Tracks total and per-domain unread notification counts

**Source**: Fetched from `GetUnreadCount` API and updated in real-time via SSE

```typescript
interface UnreadCount {
  // Total unread
  total: number;                       // Total unread notifications across all domains
  
  // Per-domain breakdown
  bySourceDomain: Record<SourceDomain, number>; // Unread count per domain
  
  // Metadata
  lastUpdated: Date;                   // When count was last fetched/updated
}

// Default unread count
const DEFAULT_UNREAD_COUNT: UnreadCount = {
  total: 0,
  bySourceDomain: {
    chat: 0,
    crm: 0,
    projects: 0,
    hr: 0,
    support: 0,
    finance: 0,
    system: 0,
  },
  lastUpdated: new Date(),
};
```

**Update Logic**:
```typescript
// On new notification via SSE
function incrementUnreadCount(sourceDomain: SourceDomain) {
  setUnreadCount(prev => ({
    total: prev.total + 1,
    bySourceDomain: {
      ...prev.bySourceDomain,
      [sourceDomain]: prev.bySourceDomain[sourceDomain] + 1,
    },
    lastUpdated: new Date(),
  }));
}

// On mark as read
function decrementUnreadCount(sourceDomain: SourceDomain) {
  setUnreadCount(prev => ({
    total: Math.max(0, prev.total - 1),
    bySourceDomain: {
      ...prev.bySourceDomain,
      [sourceDomain]: Math.max(0, prev.bySourceDomain[sourceDomain] - 1),
    },
    lastUpdated: new Date(),
  }));
}
```

**UI Usage**:
- Badge on notifications tab: `🔔 (${unreadCount.total})`
- Sidebar preview header: "Notifications (5)"
- Filter button labels: "Chat (3)", "CRM (2)", etc.

---

### 6. SidebarPreviewData

**Purpose**: Subset of notifications for right sidebar preview

**Source**: Derived from main notification list (most recent unread)

```typescript
interface SidebarPreviewData {
  // Recent unread notifications (max 5)
  recentNotifications: Notification[]; // Most recent 3-5 unread notifications
  
  // Badge count
  totalUnread: number;                 // Total unread count for badge
  
  // Metadata
  lastUpdated: Date;                   // When preview was last updated
}

// Derive from main notification list
function getSidebarPreview(
  notifications: Notification[],
  unreadCount: number
): SidebarPreviewData {
  const unreadNotifications = notifications
    .filter(n => !n.readStatus)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 5); // Take max 5 most recent
  
  return {
    recentNotifications: unreadNotifications,
    totalUnread: unreadCount,
    lastUpdated: new Date(),
  };
}
```

**UI Usage**:
- Right sidebar "Quick Info" section
- Compact notification items (icon, title, relative timestamp)
- "View all notifications" link to full hub page

---

## Component State Architecture

### NotificationsPage Component

**State**:
```typescript
const [notifications, setNotifications] = useState<Notification[]>([]);
const [filters, setFilters] = useState<NotificationFilters>(DEFAULT_FILTERS);
const [pagination, setPagination] = useState<PaginationState>(DEFAULT_PAGINATION);
const [unreadCount, setUnreadCount] = useState<UnreadCount>(DEFAULT_UNREAD_COUNT);

// From hooks
const { status: connectionStatus, reconnect } = useSSEConnection({
  onNotification: handleNewNotification,
});
```

**Data Flow**:
1. Initial load: Fetch first page via `listNotifications()`
2. SSE events: Append to top of `notifications` array
3. Mark as read: Optimistic update → API call → rollback on error
4. Filter change: Re-filter displayed notifications
5. Load more: Append next page to `notifications` array

### NotificationSidebar Component

**State**:
```typescript
const [preview, setPreview] = useState<SidebarPreviewData>({
  recentNotifications: [],
  totalUnread: 0,
  lastUpdated: new Date(),
});

// Derive from parent notification state
useEffect(() => {
  const derived = getSidebarPreview(notifications, unreadCount);
  setPreview(derived);
}, [notifications, unreadCount]);
```

---

## Backend Data Models (Reference Only)

**Note**: These exist in backend already; included for reference to understand frontend mapping.

### Database Tables (from #007-notification-hub-backend)

**notification.notification**:
- `id UUID PRIMARY KEY` - Notification UUID v7
- `organization_id UUID NOT NULL` - Tenant isolation
- `source_domain TEXT` - Business domain
- `notification_type TEXT` - Dot-separated type
- `title TEXT` - Notification title
- `message TEXT` - Message body
- `action_data JSONB` - Flexible action metadata
- `updated_at TIMESTAMPTZ` - Last modified

**notification.notification_recipient**:
- `id UUID PRIMARY KEY` - Recipient UUID v7
- `notification_id UUID` - FK to notification
- `employee_id UUID` - Target employee
- `organization_id UUID` - Tenant isolation
- `read_status BOOLEAN` - Read/unread flag
- `read_at TIMESTAMPTZ` - When marked as read
- `delivery_status TEXT` - pending/delivered/failed
- `delivered_at TIMESTAMPTZ` - When delivered via SSE
- `updated_at TIMESTAMPTZ`

**notification.active_connection** (UNLOGGED):
- `employee_id UUID PRIMARY KEY`
- `instance_id TEXT` - Backend instance identifier
- `department_ids TEXT[]` - Cached department membership
- `connected_at TIMESTAMPTZ`
- `last_heartbeat TIMESTAMPTZ`

### Protobuf Messages (from backend/rpc/v1/notification.proto)

**NotificationSummary**:
```protobuf
message NotificationSummary {
  string notification_id = 1;
  string notification_recipient_id = 2;
  string source_domain = 3;
  string notification_type = 4;
  string title = 5;
  string message = 6;
  string action_data = 7; // JSON string
  bool read_status = 8;
  google.protobuf.Timestamp read_at = 9;
  string delivery_status = 10;
  google.protobuf.Timestamp delivered_at = 11;
  google.protobuf.Timestamp created_at = 12;
}
```

**NotificationEvent** (SSE stream):
```protobuf
message NotificationEvent {
  string event_id = 1; // UUID v7
  string event_type = 2; // "connection_established", "heartbeat", "notification"
  NotificationSummary notification = 3; // Only set if event_type == "notification"
  google.protobuf.Timestamp timestamp = 4;
}
```

---

## Type Assertions for RPC Responses

**Problem**: ConnectRPC client methods return generic `Message<string>` type, causing TypeScript to lose specific response type information.

**Solution**: Explicit type assertions in API wrapper functions (per Constitution guidance).

```typescript
import { notification } from "rpc";

// Type aliases at file top
type ListNotificationsResponse = notification.ListNotificationsResponse;
type GetUnreadCountResponse = notification.GetUnreadCountResponse;
type NotificationEvent = notification.NotificationEvent;

// API wrapper with type assertion
export async function listNotifications(params?: {...}): Promise<ListNotificationsResponse> {
  return rpcCall(async () => {
    const resp = await notificationClient.listNotifications({...});
    return resp as ListNotificationsResponse; // ✅ Explicit assertion
  });
}

export async function getUnreadCount(): Promise<GetUnreadCountResponse> {
  return rpcCall(async () => {
    const resp = await notificationClient.getUnreadCount({});
    return resp as GetUnreadCountResponse; // ✅ Explicit assertion
  });
}

// SSE stream generator (no assertion needed - async generator type)
export async function* streamNotifications(lastEventId?: string) {
  const stream = notificationClient.streamNotifications({
    lastEventId: lastEventId ?? "",
  });
  
  for await (const event of stream) {
    yield event; // Type: NotificationEvent
  }
}
```

**Pattern already exists**: `frontend/packages/apis/src/notification.ts` already implements this correctly.

---

## Persistence Strategy

### LocalStorage (Persistent)
- `notification_last_event_id`: Last received SSE event UUID (for replay)
- ✅ Survives page reloads and browser restarts
- ✅ Enables missed event replay after offline period

### React State (Ephemeral)
- `notifications` array: In-memory notification list (cleared on page reload)
- `connectionStatus`: Current SSE connection state
- `filters`, `pagination`: UI state (reset on page reload)
- ✅ Fast access, no serialization overhead
- ❌ Lost on page reload (acceptable - refetch from server)

### No Server-Side Storage
- Frontend does not persist any notification data
- Backend is source of truth
- Initial page load always fetches from backend API

---

## State Synchronization

### SSE Event → State Update Flow

```typescript
// SSE event handler
async function handleSSEEvent(event: NotificationEvent) {
  // Store last event ID for replay
  localStorage.setItem('notification_last_event_id', event.eventId);
  setLastEventId(event.eventId);
  
  if (event.eventType === 'notification') {
    const notification = mapNotificationFromProto(event.notification);
    
    // Add to top of list
    setNotifications(prev => [notification, ...prev]);
    
    // Increment unread count
    if (!notification.readStatus) {
      incrementUnreadCount(notification.sourceDomain);
    }
  } else if (event.eventType === 'heartbeat') {
    setLastHeartbeat(new Date());
  }
}
```

### Mark as Read → State Update Flow

```typescript
async function markAsRead(notificationRecipientId: string) {
  const notification = notifications.find(n => n.notificationRecipientId === notificationRecipientId);
  if (!notification || notification.readStatus) return;
  
  // Optimistic update
  setNotifications(prev => prev.map(n =>
    n.notificationRecipientId === notificationRecipientId
      ? { ...n, readStatus: true, readAt: new Date() }
      : n
  ));
  decrementUnreadCount(notification.sourceDomain);
  
  try {
    await markAsReadAPI(notificationRecipientId);
  } catch (error) {
    // Rollback on error
    setNotifications(prev => prev.map(n =>
      n.notificationRecipientId === notificationRecipientId
        ? { ...n, readStatus: false, readAt: null }
        : n
    ));
    incrementUnreadCount(notification.sourceDomain);
    throw error;
  }
}
```

---

## Migration & Compatibility

**No Database Migrations**: Frontend-only feature, no backend schema changes.

**API Compatibility**: Uses existing RPC endpoints from #007-notification-hub-backend.

**Browser Compatibility**: 
- LocalStorage: Supported in all modern browsers
- SSE (EventSource): Supported in all modern browsers
- React 18: Requires modern browser (ES2020+)

**Backward Compatibility**: 
- Frontend can be deployed independently of backend
- Backend streaming interceptor fix is non-breaking (adds missing method)

---

**Status**: ✅ Data model complete - Frontend state models defined, ready for contract generation
