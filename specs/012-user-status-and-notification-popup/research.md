# Research: User Status and Notification Popup

**Date**: November 4, 2025  
**Feature**: User presence tracking, browser push notifications, and ephemeral signal routing

## Research Tasks

### 1. Browser Presence Detection Strategy

**Unknown**: How to reliably detect user presence states (online, hidden, idle, offline) given browser sleep mode limitations?

**Research Findings**:

**Decision**: Use multi-layered detection combining Page Visibility API, document focus events, user interaction tracking, and heartbeat mechanism.

**Approach**:
- **Page Visibility API**: Detect when tab is visible/hidden via `document.visibilityState` and `visibilitychange` event
- **Focus Events**: Track window focus via `focus` and `blur` events for multi-tab scenarios
- **User Interaction**: Listen to `mousemove`, `keydown`, `scroll` events to detect activity and reset idle timer
- **Idle Detection**: Start 5-minute timer on last interaction; fire when exceeded
- **Heartbeat**: Send presence status + active_channel_id every 30 seconds via SSE heartbeat
- **Browser Sleep**: When browser suspends JavaScript, heartbeat stops; backend marks offline after 60s of stale heartbeat
- **Reconnection**: On page visibility change to "visible", re-establish SSE and send updated presence

**Rationale**: 
- Page Visibility API is universally supported (95%+ browsers) and reliable for tab state detection
- Heartbeat approach handles network issues and browser sleep gracefully (timeout-based offline detection)
- Multi-layered events capture various user interaction patterns
- 5-minute idle timeout aligns with industry standards (Slack, Discord)
- 60-second stale heartbeat timeout balances responsiveness vs false-positive offline status

**Alternatives Considered**:
- **WebSockets with ping/pong**: More complex than SSE heartbeat; SSE already used in notification system
- **Shorter heartbeat interval (10s)**: Higher server load for 100k+ connections; 30s is sufficient for presence UX
- **Browser Wake Lock API**: Prevents sleep but drains battery; inappropriate for presence tracking

**Existing Tech Office Patterns**:
- Already using SSE for notifications in `internal/notification/sse.go`
- Connection tracking exists in `notification.active_connection` table
- Can extend existing heartbeat mechanism with presence fields

**References**:
- MDN Page Visibility API: https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
- Slack presence implementation: https://api.slack.com/docs/presence-and-status
- Browser sleep mode behavior: Modern browsers (Chrome 88+, Firefox 87+, Safari 14+) throttle timers in hidden tabs

---

### 2. Firebase Cloud Messaging (FCM) Integration

**Unknown**: How to integrate FCM for browser push notifications with token storage, multi-device support, and deep linking?

**Research Findings**:

**Decision**: Use FCM Web SDK with Service Worker registration, store tokens in `notification.push_token` table, implement deep link routing via URL query parameters.

**Approach**:
- **FCM Setup**:
  * Initialize FCM in frontend with Firebase config (project ID, API key, messaging sender ID)
  * Register Service Worker (`firebase-messaging-sw.js`) for background message handling
  * Request notification permissions via friendly in-app modal (not just browser native prompt)
  * Generate FCM token on permission grant, send to backend for storage
  
- **Token Management**:
  * Store tokens in `notification.push_token` table with columns: `token_id`, `employee_id`, `organization_id`, `device_identifier`, `endpoint`, `keys`, `registered_at`, `last_used_at`, `is_valid`
  * Support multiple tokens per employee (one per device/browser)
  * Implement token validation: send test notification on registration, mark invalid on send failure
  * Auto-cleanup: Remove tokens not used for 90+ days
  
- **Backend Sending**:
  * Use FCM Admin SDK for Go (`firebase.google.com/go/v4`)
  * Send multicast messages to all employee's valid tokens
  * Handle send failures: mark token invalid if error code indicates expired/unregistered
  * Rate limit: max 5 push notifications per minute per employee
  
- **Deep Linking**:
  * Include notification_id, action (e.g., "view_message"), channelId, messageId in push payload data
  * Service Worker handles notification click, opens/focuses Tech Office tab with URL: `/workspace/chat?channel={id}&message={id}&notification={id}`
  * Frontend routing detects params, navigates to channel, scrolls to message, marks notification read
  
- **Notification Grouping**:
  * Use FCM `tag` field with channel_id to group notifications by channel (browser collapses same-tag notifications)
  * Summary notification for 10+ grouped notifications: "You have 12 new messages in #general"

**Rationale**:
- FCM is free for unlimited notifications, enterprise-grade reliability, multi-platform (web + future mobile)
- Service Worker enables background notifications even when Tech Office closed
- Multi-token support handles employees with multiple devices/browsers naturally
- Deep linking provides seamless navigation from notification to content
- Token validation prevents spam to invalid endpoints

**Alternatives Considered**:
- **Web Push Protocol (VAPID)**: Lower-level, requires managing push service endpoints manually; FCM simplifies
- **OneSignal**: Third-party service with cost at scale; FCM more suitable for self-hosted SaaS
- **In-app only notifications**: Misses employees when app closed/hidden; push is core UX requirement

**Existing Tech Office Patterns**:
- Already have notification priority system (0-4) in `notification.notification` table
- Can map priority to push send logic: priority=0 always push, priority=1 push if hidden, priority=4 never push
- Frontend already has Next.js App Router for deep link routing

**FCM SDK Versions**:
- Backend: `firebase.google.com/go/v4` (latest stable Go SDK)
- Frontend: `firebase@11.x` (latest Firebase JS SDK)

**References**:
- FCM Web documentation: https://firebase.google.com/docs/cloud-messaging/js/client
- FCM Admin SDK for Go: https://firebase.google.com/docs/cloud-messaging/admin/send-messages?hl=en
- Service Worker API: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API

---

### 3. Ephemeral Signal Routing (Priority 4)

**Unknown**: How to route typing indicators and reactions only to employees actively viewing the relevant channel without database writes?

**Research Findings**:

**Decision**: Extend SSE connection registry with `active_channel_id` field, filter ephemeral signals (priority=4) by matching active_channel_id before broadcasting.

**Approach**:
- **Active Channel Tracking**:
  * Add `active_channel_id UUID NULL` column to `notification.active_connection` table
  * Frontend sends active channel updates via heartbeat (every 30 seconds) or immediate update on channel navigation
  * Backend updates active_connection record with new active_channel_id
  * Clear active_channel_id (set NULL) when employee navigates away from chat
  
- **Ephemeral Signal Generation**:
  * Typing indicators: When employee types in channel, generate ephemeral event with `channel_id`, `employee_id`, `event_type: "typing"`
  * Reactions: When employee reacts (priority=4 per spec), generate ephemeral event with `channel_id`, `message_id`, `reaction_emoji`
  * **Critical**: These events MUST NOT write to `notification.notification` table (in-memory only)
  
- **Routing Logic** (in `internal/notification/sse.go`):
  ```go
  // Pseudo-code for ephemeral signal routing
  func BroadcastEphemeralSignal(ctx, signal EphemeralSignal) {
      // Get all active connections with matching active_channel_id AND tab visible (presence_status = "online")
      connections := queries.GetActiveConnectionsByChannelID(ctx, signal.ChannelID, "online")
      
      for _, conn := range connections {
          // Validate employee is channel member (prevent leaks)
          if !isMember(conn.EmployeeID, signal.ChannelID) {
              continue
          }
          
          // Send via SSE (non-blocking)
          conn.SendEvent(signal.ToSSEEvent())
      }
  }
  ```
  
- **Frontend Handling**:
  * SSE client listens for ephemeral event types: "typing", "reaction_update"
  * Display typing indicator in channel for 5 seconds (auto-expire, no explicit "stopped typing")
  * Update reaction counts in real-time without page refresh
  
- **Performance**:
  * Ephemeral signals bypass database entirely (no INSERT, no notification records)
  * Filter by active_channel_id in backend reduces broadcast set (e.g., 5 viewers vs 100 channel members)
  * Exclude employees with `presence_status != "online"` (hidden/idle tabs don't get typing indicators)

**Rationale**:
- Active channel tracking enables precise routing (only send to viewers, not all channel members)
- No DB writes for ephemeral signals prevents database spam (typing indicators can fire every 2-3 seconds)
- Filtering by presence_status="online" avoids sending to hidden tabs (user won't see typing indicator anyway)
- 5-second auto-expire on frontend handles "stopped typing" without backend signal
- In-memory routing via SSE aligns with existing notification infrastructure

**Alternatives Considered**:
- **WebRTC data channels**: Too complex for simple typing indicators; SSE sufficient
- **Broadcast to all channel members**: Unnecessary load when only 2-3 actively viewing
- **Store ephemeral signals in DB with TTL**: Adds write load; ephemeral means "don't persist"

**Existing Tech Office Patterns**:
- SSE infrastructure already handles event broadcasting in `internal/notification/sse.go`
- Connection registry exists in `notification.active_connection` table
- Can add `active_channel_id` as new column, extend routing logic

**Edge Cases**:
- **Rapid channel switching**: Debounce active_channel_id updates by 500ms to avoid excessive writes
- **Multiple tabs same channel**: Each tab has separate SSE connection; both receive ephemeral signals (expected behavior)
- **Channel membership validation**: Always check employee is member before routing (prevent cross-channel leaks)

**References**:
- Slack typing indicators: https://api.slack.com/docs/presence-and-status#typing_indicators
- Discord ephemeral events: https://discord.com/developers/docs/topics/gateway-events#typing-start

---

### 4. Presence Visibility Controls

**Unknown**: How to implement presence visibility settings (everyone, departments, appear offline) with department-based filtering?

**Research Findings**:

**Decision**: Store visibility settings in `notification.presence_visibility` table, filter presence broadcast based on employee departments and visibility mode.

**Approach**:
- **Schema**:
  * `notification.presence_visibility` table: `employee_id`, `organization_id`, `visibility_mode` (enum: everyone, departments, offline), `custom_status_text`, `custom_status_emoji`
  * Default to "everyone" for new employees
  
- **Visibility Filtering**:
  ```go
  // Pseudo-code for presence visibility
  func GetVisiblePresence(ctx, viewerEmployeeID, targetEmployeeID) (*PresenceStatus, error) {
      // Get target's visibility settings
      visibility := queries.GetPresenceVisibility(ctx, targetEmployeeID)
      
      switch visibility.Mode {
      case "everyone":
          return getRealPresence(targetEmployeeID), nil
      case "departments":
          if sharesDepartment(viewerEmployeeID, targetEmployeeID) {
              return getRealPresence(targetEmployeeID), nil
          }
          return &PresenceStatus{Status: "offline"}, nil
      case "offline":
          return &PresenceStatus{Status: "offline"}, nil
      }
  }
  ```
  
- **Department Membership**:
  * Query `organization.department_member` table to check if viewer and target share any departments
  * Cache department memberships in employee session context (avoid repeated queries)
  
- **Activity Visibility**:
  * Visibility setting affects ONLY presence indicator (green/yellow/gray dot)
  * Activities (messages sent, reactions) are still visible (can't hide participation)
  * Custom status text shown regardless of visibility (e.g., "In meeting" visible even if "appear offline")

**Rationale**:
- Department-based visibility aligns with organizational privacy (hide status from other departments)
- "Appear offline" mode for employees needing focus time (like Slack's "Do Not Disturb")
- Separating presence from activity prevents confusion (offline but still sending messages)
- Default to "everyone" provides transparency unless employee opts for privacy

**Alternatives Considered**:
- **Individual allowlist/blocklist**: Too granular, high maintenance; department-level sufficient
- **Always show to managers**: Complicates filtering; employees control their visibility
- **Hide all activity when offline**: Confusing UX; better to show activity but hide online status

**Existing Tech Office Patterns**:
- Department memberships already tracked in `organization.department_member` table
- Employee records in `organization.employee` table for FK references
- Can add new `presence_visibility` table following same multi-tenant patterns

**Privacy Considerations**:
- Employees must be able to hide presence without hiding work (messages, files)
- Department filtering requires validating department membership for every presence check
- Admin dashboard (org-wide presence stats) bypasses visibility for monitoring

**References**:
- Slack presence visibility: https://slack.com/help/articles/201864558-Set-your-Slack-status-and-availability
- Microsoft Teams presence: https://support.microsoft.com/en-us/office/change-your-status-in-teams-ce36ed14-6bc9-4775-a33e-6629ba4ff78e

---

### 5. Notification Routing Logic (In-App vs Push)

**Unknown**: How to decide whether to send in-app notification, browser push, or both?

**Research Findings**:

**Decision**: Implement priority-based routing with presence-aware logic: check employee's presence status and active_channel_id, route accordingly.

**Routing Rules**:
```
1. Employee viewing channel where event occurs:
   → Suppress ALL notifications (already seeing content)
   
2. Employee has Tech Office tab focused (presence="online") but not viewing relevant channel:
   → Send in-app toast/banner only (NO push)
   
3. Employee has Tech Office open but tab hidden (presence="online_hidden"):
   → Send browser push AND update in-app notification list
   
4. Employee is offline (no SSE connection):
   → Send browser push only (if priority allows)
   
5. Respect notification priority:
   → Priority 0: Always deliver via push (critical mentions)
   → Priority 1: Push only if online_hidden or offline
   → Priority 2: Push only if online (normal mentions)
   → Priority 4: Never push, ephemeral SSE only
```

**Implementation**:
```go
// Pseudo-code for notification routing
func RouteNotification(ctx, notification Notification) error {
    employee := notification.RecipientEmployeeID
    presence := getPresenceStatus(employee)
    
    // Check if viewing relevant content
    if presence.ActiveChannelID == notification.ChannelID && presence.Status == "online" {
        // Suppress: already viewing
        return nil
    }
    
    // Routing based on presence and priority
    switch {
    case presence.Status == "online" && presence.ActiveChannelID != notification.ChannelID:
        // Send in-app only
        sendInApp(employee, notification)
        
    case presence.Status == "online_hidden":
        // Send both
        sendInApp(employee, notification)
        sendPush(employee, notification)
        
    case presence.Status == "offline" || presence.Status == "idle":
        // Send push only (if priority allows)
        if notification.Priority <= 1 {
            sendPush(employee, notification)
        }
    }
    
    return nil
}
```

**Rationale**:
- Viewing content suppression prevents redundant alerts (user already sees the message)
- In-app only when focused avoids double-notification (toast + push spam)
- Push when hidden ensures user gets notified even if not looking at app
- Priority system allows fine-grained control (critical vs normal vs ephemeral)

**Alternatives Considered**:
- **Always send both**: Annoying double-notifications
- **Push only when offline**: Misses hidden tab scenario (common when multitasking)
- **No suppression for viewing channel**: Spams user with redundant alerts

**Existing Tech Office Patterns**:
- Notification priority already defined in `notification.notification` table
- SSE already delivers in-app notifications
- Can extend routing logic in `internal/notification/logic.go`

**Edge Cases**:
- **Tab visibility changes during routing**: Use presence status at notification creation time (race condition acceptable)
- **Multiple devices**: Each device has separate presence; send to all devices not viewing content
- **Browser notifications disabled**: Fall back to in-app only; show banner prompting re-enable

**References**:
- Slack notification preferences: https://slack.com/help/articles/201355156-Configure-your-Slack-notifications
- Discord notification routing: https://support.discord.com/hc/en-us/articles/215253258-Notifications-Settings-101

---

## Summary of Key Decisions

1. **Presence Detection**: Multi-layered approach with Page Visibility API, focus events, interaction tracking, and 30s heartbeat. Offline after 60s stale heartbeat.

2. **FCM Integration**: Firebase Cloud Messaging with Service Worker, multi-token support, deep linking via URL params, token validation on send failures.

3. **Ephemeral Routing**: Filter by `active_channel_id` + `presence_status="online"` in backend before broadcasting. No DB writes for priority=4 signals.

4. **Visibility Controls**: Department-based filtering with "everyone", "departments", "offline" modes. Activities always visible, only presence hidden.

5. **Notification Routing**: Presence-aware routing with suppression when viewing content, in-app when focused, push when hidden/offline, priority-based delivery.

---

## Technical Risks and Mitigations

**Risk 1: Browser sleep mode breaking presence tracking**
- Mitigation: 60s heartbeat timeout is generous; reconnection on wake restores state. Frontend logs reconnection events for debugging.

**Risk 2: FCM token invalidation causing missed notifications**
- Mitigation: Validate tokens on registration, mark invalid on send failures, auto-cleanup stale tokens, show in-app banner if all tokens invalid.

**Risk 3: Ephemeral signal spam (typing indicators every keystroke)**
- Mitigation: Debounce typing events to max 1 per 2 seconds per employee. Auto-expire after 5s on frontend.

**Risk 4: Department membership changes affecting visibility**
- Mitigation: Cache department memberships with TTL; invalidate cache on membership updates. Log visibility filtering for audit.

**Risk 5: Deep link failures (channel deleted, no access)**
- Mitigation: Validate channel access before navigation; show error message; fallback to notification list page.

---

## Next Steps (Phase 1)

1. Design database schema for `notification.push_token`, `notification.presence_visibility`, and `notification.active_connection` extensions
2. Define Protocol Buffer contracts for presence RPCs and push token management
3. Create sqlc queries for presence updates, push token CRUD, visibility filtering
4. Design FCM integration architecture (token lifecycle, send logic, deep link routing)
5. Plan frontend hooks for presence tracking, push permissions, and notification routing
