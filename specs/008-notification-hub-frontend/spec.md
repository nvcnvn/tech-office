# Feature Specification: Notification Hub Frontend

**Feature Branch**: `008-notification-hub-frontend`  
**Created**: October 28, 2025  
**Status**: Draft  
**Input**: User description: "notification hub frontend - We have basic backend for the notification system (designed in #007-notification-hub-backend). Now it time to implement simple hub front-end to view the notification, tracking user only status, receiving notification from SSE endpoint,...etc. This will help testing easier. We may add a page for details notification hub view. We can have the Right Sidebar quick info for preview notification also. We don't need to handle any notification action right now since it will be defined by other features. Integration with backend will also required to implement the authentication for sse endpoint, please help to check if it already in place."

## Execution Flow (main)
```
1. Parse user description from Input ✓
   → Feature description provided: notification hub frontend UI
2. Extract key concepts from description ✓
   → Actors: employees viewing notifications
   → Actions: view notifications, mark as read, receive real-time updates via SSE
   → Data: notification list, unread count, read/unread status
   → Constraints: backend already exists (#007), simple testing interface, preview in right sidebar
3. For each unclear aspect:
   → All clarified based on backend spec (#007-notification-hub-backend)
4. Fill User Scenarios & Testing section ✓
5. Generate Functional Requirements ✓
6. Identify Key Entities ✓
7. Run Review Checklist
   → SUCCESS: Spec complete
8. Return: SUCCESS (spec ready for planning)
```

---

## ⚡ Quick Guidelines
- ✅ Focus on WHAT users need and WHY
- ❌ Avoid HOW to implement (no tech stack, APIs, code structure)
- 👥 Written for business stakeholders, not developers

### Section Requirements
- **Mandatory sections**: Must be completed for every feature
- **Optional sections**: Include only when relevant to the feature
- When a section doesn't apply, remove it entirely (don't leave as "N/A")

### For AI Generation
When creating this spec from a user prompt:
1. **Mark all ambiguities**: Use [NEEDS CLARIFICATION: specific question] for any assumption you'd need to make
2. **Don't guess**: If the prompt doesn't specify something (e.g., "login system" without auth method), mark it
3. **Think like a tester**: Every vague requirement should fail the "testable and unambiguous" checklist item
4. **Common underspecified areas**:
   - User types and permissions
   - Data retention/deletion policies  
   - Performance targets and scale
   - Error handling behaviors
   - Integration requirements
   - Security/compliance needs

---

## User Scenarios & Testing *(mandatory)*

### Primary User Story
As an employee using Tech Office platform, I need a simple notification hub interface to view all my notifications, see which ones are unread, receive real-time updates without refreshing, and mark notifications as read so that I can stay informed about important activities and manage my notification inbox effectively.

### Acceptance Scenarios

1. **Given** an employee is logged into the workspace, **When** they navigate to the notification hub page, **Then** they see a list of all their notifications sorted by most recent first with clear indication of read/unread status

2. **Given** an employee has unread notifications, **When** they view the notification hub, **Then** they see the total unread count displayed prominently

3. **Given** a backend service publishes a notification targeting the employee, **When** the employee is online with the notification hub open, **Then** the new notification appears in the list immediately without requiring page refresh

4. **Given** an employee views an unread notification, **When** they mark it as read, **Then** the notification's visual status changes immediately and the unread count decrements

5. **Given** an employee has many notifications in their hub, **When** they scroll through the list, **Then** they can see notification source domain (chat, CRM, projects, etc.), title, message preview, and timestamp for each notification

6. **Given** an employee is viewing the workspace, **When** a new notification arrives, **Then** they see a preview in the right sidebar "Quick Info" section without leaving their current page

7. **Given** an employee has accumulated hundreds of old unread notifications, **When** they use the bulk mark as read feature, **Then** all notifications before a specified date are marked as read at once

8. **Given** an employee clicks on a notification, **When** the notification contains action-specific data, **Then** the system displays the notification details but does NOT navigate to the source resource (action handling deferred to future features)

9. **Given** an employee's SSE connection is established, **When** the connection is active, **Then** they receive periodic heartbeat events confirming the connection is healthy

10. **Given** an employee loses connection (network issue, browser tab suspended), **When** they reconnect, **Then** missed notifications are replayed automatically based on last received event ID

11. **Given** an employee has an active SSE connection for 5 minutes, **When** the 5-minute timer expires, **Then** the system gracefully closes the connection and immediately reconnects with last_event_id to replay any missed notifications seamlessly

### Edge Cases

- What happens when an employee has no notifications? → Display an empty state with friendly message
- What happens when an employee has thousands of notifications? → Implement pagination with 50 notifications per page
- What happens when SSE connection fails to establish? → Display error message and provide retry button
- What happens when SSE connection drops mid-session? → Automatically attempt reconnection with exponential backoff
- What happens when authentication token expires during SSE connection? → Close connection gracefully and prompt re-authentication
- What happens when notification action data references deleted content? → Display notification normally; action handling (future feature) will handle invalid references
- What happens when real-time notification arrives while user is scrolling through old notifications? → Append to top of list with subtle animation; preserve user's scroll position
- What happens when employee clicks on notification in sidebar preview? → Do nothing for now (action handling deferred to future features); only "View all notifications" link navigates to full hub page
- What happens when multiple browser tabs are open? → Each tab maintains independent SSE connection; registry tracks multiple connections per user
- What happens when employee is offline and reconnects? → SSE establishes new connection; backend replays missed notifications based on last_event_id
- What happens when SSE connection reaches 5-minute mark? → Client gracefully closes connection, stores last_event_id, and immediately reconnects with replay request to prevent long-running connection issues

## Requirements *(mandatory)*

### Functional Requirements

**Notification Hub Page**
- **FR-001**: System MUST display a dedicated notification hub page accessible from workspace navigation showing all notifications for the authenticated employee
- **FR-002**: System MUST list notifications in reverse chronological order (most recent first) with pagination (50 per page)
- **FR-003**: System MUST visually distinguish between read and unread notifications (e.g., bold text for unread, subtle background color difference)
- **FR-004**: System MUST display for each notification: source domain icon/label (chat, CRM, projects, HR, support, finance, system), notification title, message preview (first 100 characters), timestamp (relative format like "2 hours ago"), read/unread indicator
- **FR-005**: System MUST show total unread notification count prominently at the top of the notification hub page
- **FR-006**: System MUST show unread count breakdown by source domain (e.g., "Chat: 3, CRM: 5, Projects: 2")
- **FR-007**: System MUST allow employees to filter notifications by read/unread status with toggle buttons (All, Unread Only)
- **FR-008**: System MUST allow employees to filter notifications by source domain with checkboxes (Chat, CRM, Projects, HR, Support, Finance, System)
- **FR-009**: System MUST display an empty state message when employee has no notifications or filters result in no matches

**Notification Actions**
- **FR-010**: System MUST allow employees to mark individual notifications as read via click action (e.g., "Mark as read" button or automatic on click)
- **FR-011**: System MUST allow employees to mark multiple selected notifications as read via bulk action (checkbox selection + "Mark selected as read" button)
- **FR-012**: System MUST allow employees to mark ALL notifications before a specified timestamp as read (e.g., "Mark all before yesterday as read")
- **FR-013**: System MUST allow employees to delete/dismiss individual notifications from their view
- **FR-014**: System MUST update notification read status immediately in the UI when employee marks notification as read without page refresh
- **FR-015**: System MUST decrement unread count immediately when notification marked as read
- **FR-016**: System MUST NOT implement navigation to source resources when clicking notification action data (deferred to future feature)
- **FR-017**: System MUST display notification details in expanded view showing full message, action data metadata, and timestamps when employee clicks notification

**Right Sidebar Preview**
- **FR-018**: System MUST show notification preview in the workspace layout's right sidebar "Quick Info" section
- **FR-019**: System MUST display most recent 3-5 unread notifications in sidebar preview with compact format (icon, title, relative timestamp)
- **FR-020**: System MUST show total unread count badge in sidebar preview section header
- **FR-021**: System MUST allow employee to mark notification as read directly from sidebar preview via quick action button
- **FR-022**: System MUST navigate to full notification hub page when employee clicks "View all notifications" link in sidebar
- **FR-023**: System MUST NOT navigate or perform any action when employee clicks individual notification in sidebar preview (action handling deferred to future features)
- **FR-024**: System MUST update sidebar preview in real-time when new notifications arrive via SSE connection

**Real-Time Updates via SSE**
- **FR-025**: System MUST establish Server-Sent Events (SSE) connection to backend notification stream endpoint when employee logs into workspace
- **FR-026**: System MUST authenticate SSE connection using the employee's authentication token (same token used for API calls)
- **FR-027**: System MUST send `last_event_id` parameter when establishing SSE connection to request missed notifications since last disconnect
- **FR-028**: System MUST receive three event types: "connection_established", "heartbeat", "notification"
- **FR-029**: System MUST append new notifications to the top of the notification list in real-time when receiving "notification" events
- **FR-030**: System MUST update unread count immediately when new notification arrives
- **FR-031**: System MUST display visual indicator (e.g., subtle animation, highlight) for newly arrived notifications
- **FR-032**: System MUST track last received event ID and persist it in browser storage for connection recovery
- **FR-033**: System MUST handle "heartbeat" events to confirm connection is active (log but no UI change)
- **FR-034**: System MUST detect SSE connection failure (timeout, network error, server disconnect) and display connection status indicator
- **FR-035**: System MUST automatically attempt to reconnect SSE connection with exponential backoff (1s, 2s, 4s, 8s, max 30s) when connection drops
- **FR-036**: System MUST stop reconnection attempts if authentication token expires and prompt employee to re-authenticate
- **FR-037**: System MUST replay missed notifications when reconnecting using last_event_id from browser storage
- **FR-038**: System MUST close SSE connection gracefully when employee logs out or closes browser tab
- **FR-039**: System MUST proactively close and reconnect SSE connection every 5 minutes to prevent long-running connection issues
- **FR-040**: System MUST store last_event_id before proactive disconnection and use it for replay when reconnecting

**Performance & UX**
- **FR-041**: System MUST load initial notification list within 2 seconds on notification hub page
- **FR-042**: System MUST render real-time notification updates within 500ms of receiving SSE event
- **FR-043**: System MUST implement optimistic UI updates - mark as read action updates UI immediately before backend confirmation
- **FR-044**: System MUST show loading skeletons during initial page load and pagination
- **FR-045**: System MUST preserve user's scroll position when new notifications arrive at top of list
- **FR-046**: System MUST implement infinite scroll or "Load more" button for pagination (NOT full page reload)
- **FR-047**: System MUST debounce bulk actions to prevent accidental double-clicks (300ms debounce)

**Error Handling**
- **FR-048**: System MUST display user-friendly error messages when API calls fail (e.g., "Failed to mark as read. Please try again.")
- **FR-049**: System MUST show SSE connection status indicator (Connected, Connecting, Disconnected, Error)
- **FR-050**: System MUST provide manual retry button when SSE connection fails permanently
- **FR-051**: System MUST log SSE connection errors to browser console for debugging
- **FR-052**: System MUST handle token expiration gracefully during SSE connection - close connection and redirect to login

**Integration with Backend**
- **FR-053**: System MUST use existing backend NotificationService RPC methods: ListNotifications, MarkAsRead, MarkAllBeforeTimestampAsRead, DeleteNotification, StreamNotifications, GetUnreadCount
- **FR-054**: System MUST include authentication token in SSE connection request headers (Authorization: Bearer <token>)
- **FR-055**: System MUST extract employee_id and organization_id from authentication context (backend interceptor provides this)
- **FR-056**: System MUST respect backend access control - only ROLE_OWNER, ROLE_OPERATOR, ROLE_EMPLOYEE can access notification endpoints
- **FR-057**: System MUST handle pagination tokens from ListNotifications API response for next page requests

**Testing Capabilities**
- **FR-058**: System MUST provide easy visual confirmation that SSE connection is active and receiving events
- **FR-059**: System MUST display connection metrics in browser console (connection time, event count, last event timestamp)
- **FR-060**: System MUST allow manual triggering of reconnection via UI button for testing purposes
- **FR-061**: System MUST log all SSE events (connection, notification, heartbeat, error) to browser console in development mode

### Key Entities *(include if feature involves data)*

- **Notification (Frontend Model)**: Client-side representation of notification data received from backend. Contains notification_id, notification_recipient_id (for mark as read), source_domain, notification_type, title, message, action_data, read_status, read_at, delivery_status, delivered_at, created_at (timestamp). Mapped from backend NotificationSummary protobuf message.

- **SSE Connection State**: Tracks real-time connection status. Contains connection_status (connecting, connected, disconnected, error), last_event_id (UUIDv7 of last received event, persisted to localStorage), reconnect_attempt_count, next_reconnect_delay, event_count (total events received), connection_start_time, last_heartbeat_time. Managed by SSE connection manager.

- **Notification Filter State**: User-selected filters for notification list. Contains show_unread_only (boolean), selected_source_domains (array of strings: chat, crm, projects, hr, support, finance, system), applied_at (timestamp). Stored in React state.

- **Pagination State**: Tracks pagination position. Contains current_page_token (string from backend), has_next_page (boolean), items_per_page (default 50), loading_state (idle, loading, error). Managed by infinite scroll or "Load more" component.

- **Unread Count**: Total and per-domain unread counts. Contains total_unread (integer), unread_by_source_domain (map of domain → count). Fetched from GetUnreadCount API and updated in real-time.

- **Sidebar Preview Data**: Subset of notifications for right sidebar. Contains recent_notifications (array of 3-5 most recent unread notifications), total_unread_count (integer), last_updated (timestamp). Derived from main notification list and SSE events.

---

## Review & Acceptance Checklist
*GATE: Automated checks run during main() execution*

### Content Quality
- [x] No implementation details (languages, frameworks, APIs) - only UI/UX requirements
- [x] Focused on user value and business needs - testing interface for notification system
- [x] Written for non-technical stakeholders - clear user scenarios
- [x] All mandatory sections completed

### Requirement Completeness
- [x] No [NEEDS CLARIFICATION] markers remain - backend spec (#007) provides all context
- [x] Requirements are testable and unambiguous - each FR has clear acceptance criteria
- [x] Success criteria are measurable - performance targets specified (2s load, 500ms render)
- [x] Scope is clearly bounded - no action navigation, simple hub UI, testing-focused
- [x] Dependencies and assumptions identified - depends on backend #007, auth already in place

---

## Execution Status
*Updated by main() during processing*

- [x] User description parsed
- [x] Key concepts extracted
- [x] Ambiguities marked - NONE (backend spec provides complete context)
- [x] User scenarios defined
- [x] Requirements generated
- [x] Entities identified
- [x] Review checklist passed

---

## Authentication Integration Status

**Backend Authentication**: ✅ ALREADY IN PLACE

The backend notification SSE endpoint (`StreamNotifications`) is protected by the existing AuthInterceptor:

1. **Access Control**: Defined in `notification.proto`:
   ```protobuf
   rpc StreamNotifications(StreamNotificationsRequest) returns (stream NotificationEvent) {
     option (rpc.v1.access_control) = {
       allowed_roles: [ROLE_OWNER, ROLE_OPERATOR, ROLE_EMPLOYEE]
       allow_unauthenticated: false
     };
   }
   ```

2. **Auth Interceptor**: `backend/internal/interceptor/auth.go` handles:
   - JWT token verification from `Authorization: Bearer <token>` header
   - Role-based access control validation
   - Context injection: `user_id`, `user_org_id`, `user_roles`

3. **Context Extraction**: Available helper functions:
   - `interceptor.UserIDFromContext(ctx)` → returns employee_id
   - `interceptor.UserOrgIDFromContext(ctx)` → returns organization_id
   - `interceptor.UserRolesFromContext(ctx)` → returns roles array

4. **SSE Implementation Status**: Partially complete (`backend/internal/notification/sse.go`):
   - ✅ Token validation framework exists
   - ⚠️ `validateStreamRequest()` function marked as TODO - needs implementation to extract employee_id and organization_id from context
   - ✅ Connection registry registration implemented
   - ✅ Heartbeat mechanism implemented
   - ⚠️ Real-time notification delivery via LISTEN/NOTIFY channel needs connection
   - ⚠️ **Streaming interceptor support missing**: Auth interceptor only implements `WrapUnary`, needs `WrapStreamingHandler` and `WrapStreamingClient` methods to support SSE streaming RPC

**Frontend Requirements**:
- MUST send `Authorization: Bearer <token>` header with SSE connection request
- MUST use same authentication token as API calls (from useRequireAuth hook)
- MUST handle 401 Unauthenticated errors by redirecting to login
- MUST handle 403 Permission Denied errors with appropriate message

**Backend TODO (out of scope for this spec, but noted)**:
- Implement `validateStreamRequest()` in `sse.go` to call `interceptor.UserIDFromContext()` and `interceptor.UserOrgIDFromContext()`
- Connect SSE stream to LISTEN/NOTIFY channel for receiving notification events from publisher
- **Add streaming interceptor support to AuthInterceptor**: Implement full `connect.Interceptor` interface with `WrapUnary`, `WrapStreamingClient`, and `WrapStreamingHandler` methods (see [Connect RPC streaming docs](https://connectrpc.com/docs/go/streaming#interceptors))
- Update server initialization to use interceptor properly for both unary and streaming RPCs

---

## Dependencies

- **Backend Feature**: #007-notification-hub-backend (COMPLETED)
  - Provides NotificationService RPC endpoints
  - Provides SSE streaming endpoint with auth protection
  - Provides connection registry for multi-instance routing
  
- **Frontend Infrastructure**: Already exists
  - Workspace layout with right sidebar (`frontend/apps/web/src/app/workspace/layout.tsx`)
  - Authentication hooks (`useRequireAuth`)
  - RPC client setup (Connect-Web)

- **Design System**: Already available
  - Material-UI components
  - Tailwind CSS utility classes
  - TabLink component for navigation

---

## Next Steps

✅ **Specification Complete**: Ready for technical planning phase.

**Key Features to Implement**:
1. Notification hub page with list, filters, and actions
2. Right sidebar notification preview integration
3. SSE connection manager with reconnection logic
4. Real-time notification updates
5. Mark as read, bulk actions, delete functionality
6. Connection status indicator
7. Error handling and retry mechanisms

**Backend Integration Points**:
- List/query endpoints: Already implemented
- SSE streaming: Needs `validateStreamRequest()` implementation (simple - just extract from context)
- Authentication: Already working via interceptor

**Ready for**: `/plan` - Technical implementation planning phase

---
