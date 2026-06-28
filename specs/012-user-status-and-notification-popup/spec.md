# Feature Specification: User Status and Notification Popup

**Feature Branch**: `012-user-status-and-notification-popup`  
**Created**: November 4, 2025  
**Status**: Draft  
**Input**: User description: "user status and notification popup. We need to find a way to determine if user is: online and active using the app, or looking at specific chat channel; online and not looking at the app; online and have the app hidden; offline. Most of this will rely on frontend and it will be very difficult since now browser have sleep mode. Our web application will also need to ask the browser/os for notification permission, check it every time user login and store some sort of push notification token in the backend so we can use it as a fallback notification method. ofcourse we need to have deeplink action for this notification. We also need to find a way to silent sending some notification without storing them in the backend to avoid flooding db /spamming user, for example for chat typing signal and reaction (priority 4), we need to find a way to only stream the signal to user looking directly at the chat channel."

## Execution Flow (main)
```
1. Parse user description from Input ✓
   → Feature: user presence tracking + browser notifications + ephemeral signals
2. Extract key concepts from description ✓
   → Actors: online/idle/offline employees, active channel viewers
   → Actions: track presence, request permissions, store push tokens, 
      send browser notifications with deep links, stream ephemeral signals
   → Data: presence state, active_channel_id, push tokens, notification routing
   → Constraints: browser sleep mode, permission UX, privacy, no DB spam
3. For each unclear aspect: ✓
   → Browser sleep: Use Page Visibility API + Focus events + Heartbeat
   → Push service: [NEEDS CLARIFICATION: provider - VAPID/FCM/OneSignal?]
   → Ephemeral routing: Filter by active_channel_id in SSE (no DB writes)
4. Fill User Scenarios & Testing section ✓
5. Generate Functional Requirements ✓
6. Identify Key Entities ✓
7. Run Review Checklist
   → [NEEDS CLARIFICATION]: Push notification provider selection
#
## Clarifications

### Session 2025-11-04
- Q: Which push notification service should be used? → A: Firebase Cloud Messaging (FCM), later we can use them for mobiles, so keep in mind that a user can have many devices
8. Return: WARN "Spec has uncertainties - push provider"
```

---

## ⚡ Quick Guidelines
- ✅ Focus on WHAT users need and WHY
- ❌ Avoid HOW to implement (no tech stack, APIs, code structure)
- 👥 Written for business stakeholders, not developers

---

## User Scenarios & Testing *(mandatory)*

### Primary User Story
As an employee using Tech Office, I need the system to track my presence status (online, idle, offline) and what I'm actively viewing (specific chat channels), so that my colleagues can see my availability and I receive appropriate notifications (browser push when app is hidden, in-app alerts when active, ephemeral signals like typing indicators only when I'm viewing the relevant channel), enabling more contextual and less intrusive communication.

### Acceptance Scenarios

**Presence Status Detection**

1. **Given** an employee opens Tech Office in their browser, **When** the page loads and SSE connection establishes, **Then** their presence status is "online" and visible to colleagues

2. **Given** an employee is viewing Tech Office (tab active), **When** they switch to another browser tab or application, **Then** their presence status changes to "online_hidden"

3. **Given** an employee has Tech Office open but hasn't interacted for 5 minutes, **When** the idle timeout expires, **Then** their presence status changes to "idle"

4. **Given** an employee closes Tech Office or loses network connection, **When** SSE connection breaks and heartbeat stops, **Then** their presence status changes to "offline" after 60 seconds

5. **Given** an employee's browser enters sleep mode (laptop closed), **When** the browser suspends JavaScript, **Then** presence becomes "offline" after 60 seconds of stale heartbeat

6. **Given** an employee wakes their device from sleep, **When** the browser resumes and page becomes visible, **Then** SSE reconnects and presence returns to "online"

**Active Channel Context**

7. **Given** an employee is viewing a specific chat channel, **When** they navigate to that channel, **Then** the system records active_channel_id in their SSE connection registry

8. **Given** an employee switches from channel A to channel B, **When** the new channel loads, **Then** active_channel_id updates to channel B

9. **Given** an employee navigates away from chat, **When** the page changes to organization or projects, **Then** active_channel_id is cleared (NULL)

10. **Given** an employee opens multiple tabs with different channels, **When** they switch tabs, **Then** only the focused tab's channel is marked as active_channel_id

**Browser Notification Permissions**

11. **Given** an employee logs in for the first time, **When** they reach the workspace dashboard, **Then** the system prompts for browser notification permissions with clear benefits explanation

12. **Given** an employee clicks "Allow", **When** permissions granted, **Then** system registers push token and stores it in backend

13. **Given** an employee clicks "Block" or dismisses prompt, **When** permissions denied, **Then** system records denial and shows banner explaining in-app-only notifications

14. **Given** an employee previously denied permissions, **When** they log in again, **Then** system shows non-intrusive banner with browser settings instructions (not repeated browser prompt)

15. **Given** an employee granted permissions, **When** they log in on new device/browser, **Then** system requests permissions again for that device and stores new token

16. **Given** an employee revokes permissions via browser settings, **When** system attempts push send, **Then** send fails gracefully and token marked invalid

**Push Notifications with Deep Links**

17. **Given** an employee has Tech Office open but tab hidden, **When** they receive a mention, **Then** system sends browser push notification with message preview and "View Message" action

18. **Given** an employee receives browser push notification, **When** they click it, **Then** browser focuses Tech Office tab (or opens new if closed) and navigates to mentioned message

19. **Given** an employee has Tech Office closed, **When** they receive notification, **Then** browser push appears in OS notification center with action buttons

20. **Given** an employee clicks "View Message" on push notification, **When** action triggers, **Then** Tech Office opens and navigates to specific channel scrolled to message

21. **Given** an employee receives multiple notifications while away, **When** they return, **Then** browser push notifications are grouped by channel (when browser supports grouping)

**Ephemeral Signal Routing**

22. **Given** an employee is typing in a channel, **When** typing indicator events generate, **Then** system streams ONLY to users with that channel as active_channel_id (no DB writes)

23. **Given** an employee reacts to a message with emoji, **When** reaction event generates with priority=4, **Then** system streams reaction update ONLY to users actively viewing that channel

24. **Given** an employee is viewing channel A, **When** another employee starts typing in channel A, **Then** first employee sees typing indicator appear in real-time via SSE

25. **Given** an employee is viewing channel A, **When** typing indicators generate in channel B, **Then** employee does NOT receive those indicators (filtered by active_channel_id)

26. **Given** an employee switches from channel A to channel B, **When** active_channel_id updates, **Then** they start receiving indicators for B and stop for A (immediate context switch)

27. **Given** an employee's browser tab is hidden, **When** typing indicators generate in any channel, **Then** they do NOT receive indicators (only sent to active viewers)

**In-App vs Push Notification Logic**

28. **Given** an employee is actively viewing Tech Office with tab focused, **When** they receive notification, **Then** system shows in-app toast and does NOT send browser push (avoids duplicate)

29. **Given** an employee is viewing the specific channel where message sent, **When** message arrives, **Then** system suppresses all notifications (already viewing content)

30. **Given** an employee has Tech Office open but tab hidden, **When** they receive notification, **Then** system sends browser push AND updates in-app notification badge

31. **Given** an employee is offline (no SSE), **When** notification created with priority=0, **Then** notification stored and push sent when device reachable

32. **Given** an employee is offline, **When** notification created with priority=1, **Then** notification stored but push NOT sent (appears when online)

**Presence Visibility Controls**

33. **Given** an employee wants to control presence visibility, **When** they access presence settings, **Then** they can choose: "Visible to everyone", "Visible to my department", "Appear offline"

34. **Given** an employee sets "Appear offline", **When** colleagues view their status, **Then** they see "Offline" even though employee is active

35. **Given** an employee is in "Appear offline" mode, **When** they send messages or react, **Then** their actions are still visible (setting only affects status indicator)

### Edge Cases

- What happens when browser doesn't support Push API? → System detects lack of support, disables push features gracefully, shows warning banner explaining SSE-only notifications
- What happens when employee denies permissions multiple times? → System stops showing prompt, displays persistent banner in settings with browser help docs link
- What happens when push token expires/invalid? → System detects send failures, marks token invalid, attempts re-register on next active session
- What happens with Tech Office open on multiple devices? → Each device has separate SSE connection with own active_channel_id; presence shows "online" if ANY device active
- What happens when switching channels rapidly? → Active_channel_id updates debounced (500ms) to avoid excessive writes
- What happens with unstable network (frequent reconnects)? → SSE has exponential backoff; presence flaps online/offline only if disconnected > 60s
- What happens when typing indicator heartbeat stops? → Indicator auto-expires after 5 seconds in frontend (no explicit "stopped typing" signal)
- What happens when 100+ notifications while offline? → Push rate-limited (max 5/min); excess stored but not pushed; summary notification sent
- What happens when browser notification quota exceeded? → Falls back to in-app only; logs warning; shows message to clear old notifications
- What happens when deep link fails (channel deleted)? → Shows error: "This channel is no longer accessible" with option to return home
- What happens when permissions granted but browser blocks? → System detects grant but send fails; shows troubleshooting guide (OS settings, extensions)
- What happens when push service down? → Falls back to in-app only; logs status; retries with exponential backoff
- What happens with stale presence (stuck "online")? → Background cleanup every 60s marks connections with last_heartbeat > 60s as "offline"
- What happens when active_channel_id invalid (not a member)? → System validates membership; clears invalid active_channel_id on next heartbeat
- What happens with OS "Do Not Disturb"? → Browser push suppressed by OS; system can't detect; notifications remain in center for later
- What happens with multiple browser profiles? → Each profile has separate permissions and tokens; treated as independent devices
- What happens on logout? → Closes SSE, removes active_connection, invalidates/removes push token for that session
- What happens when org admin disables push for security? → Admin setting disables push org-wide; existing tokens invalidated; only in-app allowed

---

## Requirements *(mandatory)*

### Functional Requirements

**Presence Status Tracking**

- **FR-001**: System MUST track employee presence with four states: "online" (active with tab focused), "online_hidden" (active but tab not focused), "idle" (inactive 5+ minutes), "offline" (no connection)
- **FR-002**: System MUST update presence to "online" when employee establishes SSE connection with tab focused
- **FR-003**: System MUST update presence to "online_hidden" when browser tab loses focus (Page Visibility API "hidden")
- **FR-004**: System MUST update presence to "idle" when no user interaction for 5 minutes (mouse, keyboard, scroll)
- **FR-005**: System MUST update presence to "offline" when SSE breaks and last_heartbeat > 60 seconds
- **FR-006**: System MUST reset idle timer to "online" when employee performs any interaction after being idle
- **FR-007**: System MUST display presence indicators next to employee names in channel member lists, notification headers, employee directories
- **FR-008**: System MUST use distinct visual indicators: green dot (online), yellow dot (idle), gray dot (offline), hollow dot (online_hidden)
- **FR-009**: System MUST allow employees to set custom status text (e.g., "In meeting") appearing alongside presence indicator

**Active Channel Context Tracking**

- **FR-010**: System MUST track which specific chat channel each employee is actively viewing (active_channel_id) in SSE connection registry
- **FR-011**: System MUST update active_channel_id when employee navigates to chat channel page
- **FR-012**: System MUST clear active_channel_id (NULL) when employee navigates away from chat to other workspace sections
- **FR-013**: System MUST update active_channel_id when employee switches browser tabs with different channels (only focused tab's channel is active)
- **FR-014**: System MUST send active_channel_id updates via heartbeat (every 30 seconds) to maintain accuracy
- **FR-015**: System MUST validate active_channel_id corresponds to channel employee is member of before recording

**Browser Notification Permission Management**

- **FR-016**: System MUST request browser notification permissions when employee first logs into Tech Office
- **FR-017**: System MUST display permission request with clear explanation: "Get notified of mentions and important messages even when Tech Office isn't visible"
- **FR-018**: System MUST show permission request as friendly in-app modal (not just browser native) with "Allow Notifications" and "Maybe Later" options
- **FR-019**: System MUST register push notification token when employee grants permissions and store in backend associated with employee_id and device/browser identifier
- **FR-020**: System MUST record permission denial status when employee blocks or dismisses prompt
- **FR-021**: System MUST show non-intrusive settings banner (not modal) when employee previously denied, with link to browser re-enable instructions
- **FR-022**: System MUST NOT repeatedly prompt for permissions if employee denied (respect choice, show banner only)
- **FR-023**: System MUST request new push token for each unique device/browser combination (multiple tokens per employee allowed)
- **FR-024**: System MUST validate push tokens by attempting test send during registration
- **FR-025**: System MUST detect invalid/expired push tokens when send attempts fail and mark for removal
- **FR-026**: System MUST provide settings page showing list of devices with active notification permissions and revoke option per device

**Push Notifications with Deep Links**

- **FR-027**: System MUST send browser push notifications when employee receives notification while Tech Office tab hidden or closed
- **FR-028**: System MUST include message preview text (first 100 characters) in push notification body for chat mentions
- **FR-029**: System MUST include notification title with sender name and context (e.g., "Alice mentioned you in #general")
- **FR-030**: System MUST attach deep link action to push notifications opening Tech Office and navigating to specific message
- **FR-031**: System MUST focus existing Tech Office tab (if open) when push notification clicked, not always open new tab
- **FR-032**: System MUST open new Tech Office tab if none exists when push notification clicked
- **FR-033**: System MUST pass notification_id and action_data (channelId, messageId) via URL query params when deep linking
- **FR-034**: System MUST scroll to and highlight mentioned message after navigation from push notification
- **FR-035**: System MUST show error "This channel is no longer accessible" if deep link points to deleted channel or no access
- **FR-036**: System MUST group push notifications by channel (when browser supports grouping) to avoid spam
- **FR-037**: System MUST rate-limit push notifications to max 5 per minute per employee to prevent flooding
- **FR-038**: System MUST send summary notification "You have 10+ new messages" if rate limit exceeded, with action to view notification list

**Ephemeral Signal Routing (Priority 4)**

- **FR-039**: System MUST route ephemeral signals (priority=4) ONLY to employees with active_channel_id matching signal's target channel
- **FR-040**: System MUST NOT write ephemeral signals to notification.notification table (in-memory routing via SSE only)
- **FR-041**: System MUST send typing indicators to employees actively viewing channel where typing occurs
- **FR-042**: System MUST send reaction updates (priority=4) to employees actively viewing channel where reaction added
- **FR-043**: System MUST filter ephemeral signals by active_channel_id in backend before sending via SSE (not filtered on frontend)
- **FR-044**: System MUST exclude employees with tab hidden (online_hidden) from receiving ephemeral signals
- **FR-045**: System MUST immediately stop sending ephemeral signals when employee's active_channel_id changes (context switch)
- **FR-046**: System MUST handle multiple employees viewing same channel by broadcasting ephemeral signal to all matching connections
- **FR-047**: System MUST debounce active_channel_id updates with 500ms delay to avoid excessive writes during rapid channel switching

**In-App vs Push Notification Routing Logic**

- **FR-048**: System MUST send in-app notification (toast/banner) when employee actively viewing Tech Office with tab focused
- **FR-049**: System MUST NOT send browser push when employee actively viewing Tech Office with tab focused (avoid duplicate alerts)
- **FR-050**: System MUST suppress ALL notifications (in-app and push) when employee viewing specific channel where notification originates (already viewing content)
- **FR-051**: System MUST send BOTH browser push AND update in-app notification list when employee has Tech Office tab hidden
- **FR-052**: System MUST send ONLY browser push (not in-app) when employee has no active SSE connection (offline or app closed)
- **FR-053**: System MUST respect notification priority: priority=0 (always deliver via push even offline), priority=1 (push only if online_hidden), priority=2 (push only if online), priority=4 (ephemeral, no push)
- **FR-054**: System MUST fall back to in-app notifications only if push send fails due to invalid token or service unavailability

**Presence Visibility Controls**

- **FR-055**: System MUST allow employees to configure presence visibility: "Visible to everyone in organization", "Visible to my departments only", "Appear offline"
- **FR-056**: System MUST respect "Visible to everyone" by showing actual presence to all organization members
- **FR-057**: System MUST respect "Visible to my departments" by showing actual presence only to employees in same departments
- **FR-058**: System MUST respect "Appear offline" by always showing "Offline" regardless of actual connection state
- **FR-059**: System MUST still allow activity visibility (messages sent, reactions) when employee in "Appear offline" mode (visibility affects status indicator only)
- **FR-060**: System MUST default new employees to "Visible to everyone" presence visibility setting
- **FR-061**: System MUST show employee's own actual presence status in their profile settings regardless of visibility setting

**Notification Badge & Unread Counts**

- **FR-062**: System MUST display notification badge count (unread notifications) in workspace header navigation
- **FR-063**: System MUST update notification badge in real-time when new notifications arrive via SSE
- **FR-064**: System MUST decrement notification badge when employee marks notifications as read
- **FR-065**: System MUST show notification badge on browser tab icon/title when Tech Office tab hidden (favicon badge or title prefix)
- **FR-066**: System MUST clear notification badge on browser tab when employee refocuses the tab
- **FR-067**: System MUST display unread channel indicators (dots) in chat sidebar for channels with new messages
- **FR-068**: System MUST clear unread channel indicator when employee views that channel
- **FR-069**: System MUST persist unread counts across sessions (survive browser restart)

**System Health & Cleanup**

- **FR-070**: System MUST run background cleanup every 60 seconds to mark connections with last_heartbeat > 60s as offline and remove stale records
- **FR-071**: System MUST automatically re-establish SSE connection with exponential backoff (1s, 2s, 4s, 8s, max 30s) when connection drops
- **FR-072**: System MUST send heartbeat ping every 30 seconds to maintain active_connection record freshness
- **FR-073**: System MUST include last_event_id in SSE reconnection request to replay missed events
- **FR-074**: System MUST detect and remove duplicate SSE connections for same employee (only keep most recent connection per device)
- **FR-075**: System MUST close SSE connection and remove active_connection record when employee logs out
- **FR-076**: System MUST invalidate and remove push notification token when employee logs out from that device/browser
- **FR-077**: System MUST detect browser Push API support and disable push features gracefully if unsupported
- **FR-078**: System MUST log push notification send failures for debugging and monitoring
- **FR-079**: System MUST provide admin dashboard showing organization-wide presence statistics (online/idle/offline counts, notification delivery metrics)

**Privacy & Security**

- **FR-080**: System MUST only show presence status to employees within same organization (no cross-organization visibility)
- **FR-081**: System MUST validate employee membership before displaying presence status in any UI component
- **FR-082**: System MUST encrypt push notification tokens at rest in database
- **FR-083**: System MUST use HTTPS for all push notification endpoints
- **FR-084**: System MUST not include sensitive content (passwords, personal data beyond name) in push notification bodies
- **FR-085**: System MUST allow organization admins to disable push notifications entirely via organization settings (security policy override)
- **FR-086**: System MUST invalidate all push notification tokens for organization when admin disables push notifications

### Key Entities *(include if feature involves data)*

- **Presence Status**: Enumeration of employee connection states: "online" (actively viewing with tab focused), "online_hidden" (connected but tab not focused), "idle" (no interaction for 5+ minutes), "offline" (no SSE connection or heartbeat stale). Displayed as colored indicators throughout UI. Affects notification routing logic (ephemeral signals only sent to "online" users).

- **Active Connection**: Existing entity in `notification.active_connection` table tracking SSE connections. Extended with new fields: `presence_status` (enum: online, online_hidden, idle, offline), `active_channel_id` (UUID or NULL indicating which chat channel employee is currently viewing), `last_interaction_at` (timestamp of last user interaction for idle detection), `device_identifier` (browser fingerprint or UUID for distinguishing multiple devices).

- **Push Notification Token**: New entity storing browser push notification subscriptions. Contains: `token_id` (UUID), `employee_id` (UUID), `organization_id` (UUID), `device_identifier` (browser fingerprint), `endpoint` (push service URL), `keys` (public/private keys for encryption), `registered_at` (timestamp), `last_used_at` (timestamp), `is_valid` (boolean, false if send failures detected), `token_metadata` (JSONB: browser, OS, user_agent). One employee can have multiple tokens (one per device/browser).

- **Notification Permission Status**: New entity or field tracking permission state per device. Contains: `employee_id` (UUID), `device_identifier` (UUID), `permission_state` (enum: granted, denied, prompt), `last_checked_at` (timestamp), `prompt_count` (how many times requested), `denial_count` (how many times denied). Used to avoid repeated prompts for denied permissions.

- **Presence Visibility Setting**: New entity or field on employee profile. Contains: `employee_id` (UUID), `visibility_mode` (enum: everyone, departments, offline), `custom_status_text` (optional custom message like "In meeting"), `custom_status_emoji` (optional emoji code). Affects who can see employee's actual presence status.

- **Ephemeral Signal Event**: Not persisted to database. In-memory or Redis-based routing metadata. Contains: `event_type` (typing_indicator, reaction, presence_update), `channel_id` (UUID), `employee_id` (UUID source), `event_data` (JSONB: emoji_code, message_id, etc.), `target_channel_id` (for filtering recipients). Routed via SSE to employees with matching active_channel_id.

- **Deep Link Action**: Metadata structure attached to push notifications. Contains: `action_type` (view_message, view_channel, view_notification_list), `channel_id` (UUID), `message_id` (UUID), `notification_id` (UUID), `url_path` (constructed navigation path). Used to navigate employee to specific content when clicking push notification.

---

## Review & Acceptance Checklist
*GATE: Automated checks run during main() execution*

### Content Quality
- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

### Requirement Completeness
- [x] No [NEEDS CLARIFICATION] markers remain → **RESOLVED**: Push notification service provider selected: Firebase Cloud Messaging (FCM)
- [x] Requirements are testable and unambiguous  
- [x] Success criteria are measurable
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

---

## Execution Status
*Updated by main() during processing*

- [x] User description parsed
- [x] Key concepts extracted
- [x] Ambiguities marked
- [x] User scenarios defined
- [x] Requirements generated
- [x] Entities identified
- [ ] Review checklist passed → **BLOCKED**: Clarification needed

---

## Dependencies & Assumptions

**Dependencies**:
- Existing SSE infrastructure in `notification.active_connection` (from spec 007/008)
- Chat channel membership validation (from spec 009/010)
- Notification service PublishNotification RPC (from spec 007)
- Browser Page Visibility API support (widely supported, graceful degradation for old browsers)
- Browser Push API support (fallback to in-app only for unsupported browsers)

**Assumptions**:
- Organization employees can see each other's presence by default (single-tenant per organization)
- Employees trust the system with their presence information (privacy policy covers this)
- Browser notification permissions requested post-login (not blocking signup flow)
- Push notification rate limits (5/min) sufficient for typical usage (can be tuned based on monitoring)
- Active_channel_id updates every 30 seconds via heartbeat frequent enough for ephemeral signal routing
- 60-second stale connection timeout is acceptable trade-off between accuracy and server load

**Push Notification Service Provider**:
- Firebase Cloud Messaging (FCM) is selected for browser push notifications. This supports multiple devices per user and aligns with future mobile app integration. Token storage format, API integration, and device management will follow FCM requirements. GDPR compliance and reliability will be reviewed during planning.
