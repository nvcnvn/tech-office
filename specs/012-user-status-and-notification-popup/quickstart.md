# Quickstart & Validation: User Status and Notification Popup

**Date**: November 4, 2025  
**Feature**: Presence tracking, browser push notifications, and ephemeral signal routing

## Prerequisites

1. **Backend Services Running**:
   ```bash
   cd backend
   go run cmd/main.go
   # Backend listening on http://localhost:18080
   ```

2. **Database Migrations Applied**:
   ```bash
   cd backend
   ./scripts/migrate.sh
   # Verify: SELECT * FROM notification.push_token LIMIT 1;
   # Verify: SELECT * FROM notification.presence_visibility LIMIT 1;
   ```

3. **Frontend Development Server**:
   ```bash
   cd frontend
   pnpm web dev
   # Frontend listening on http://localhost:13000
   ```

4. **FCM Configuration**:
   - Firebase project created with Cloud Messaging enabled
   - FCM service account key configured in backend env vars
   - `firebase-messaging-sw.js` deployed to `/public/` in frontend
   - Firebase config added to frontend `.env.local`

5. **Test Data**:
   - At least 2 test organizations with 5+ employees each
   - Employees assigned to multiple departments
   - At least 3 chat channels with multiple members

---

## Quick Validation Scenarios

### Scenario 1: Basic Presence Tracking

**Objective**: Verify presence status updates based on tab visibility and user interaction

**Steps**:
1. Open Tech Office in browser, log in as Employee A
2. Verify SSE connection established (check Network tab for `EventSource` connection)
3. Open browser DevTools, check Console for presence heartbeat logs (every 30s)
4. **Expected**: Presence status = "online", active_channel_id = NULL

**Validation**:
```sql
-- Check active connection record
SELECT employee_id, presence_status, active_channel_id, last_heartbeat, last_interaction_at
FROM notification.active_connection
WHERE employee_id = 'EMPLOYEE_A_UUID'
  AND organization_id = 'ORG_UUID';

-- Expected: presence_status = 'online', active_channel_id = NULL
```

5. Switch to different browser tab (hide Tech Office tab)
6. Wait 5 seconds for heartbeat update
7. **Expected**: Presence status changes to "online_hidden"

**Validation**:
```sql
-- Verify status changed to online_hidden
SELECT presence_status FROM notification.active_connection
WHERE employee_id = 'EMPLOYEE_A_UUID' AND organization_id = 'ORG_UUID';

-- Expected: 'online_hidden'
```

8. Switch back to Tech Office tab
9. Wait 5 seconds for heartbeat update
10. **Expected**: Presence status back to "online"

11. Stop all interaction (don't move mouse, don't type) for 5 minutes
12. Wait for idle detection
13. **Expected**: Presence status changes to "idle"

14. Move mouse or press any key
15. Wait 5 seconds for interaction detection
16. **Expected**: Presence status back to "online"

17. Close Tech Office tab completely
18. Wait 60 seconds for stale heartbeat cleanup
19. **Expected**: Active connection deleted, presence = offline

**Validation**:
```sql
-- Verify connection cleaned up
SELECT COUNT(*) FROM notification.active_connection
WHERE employee_id = 'EMPLOYEE_A_UUID' AND organization_id = 'ORG_UUID';

-- Expected: 0 (no active connections)
```

---

### Scenario 2: Active Channel Tracking

**Objective**: Verify active_channel_id updates when navigating to chat channels

**Steps**:
1. Log in as Employee A, presence = "online"
2. Navigate to workspace dashboard (not chat)
3. **Expected**: active_channel_id = NULL

**Validation**:
```sql
SELECT active_channel_id FROM notification.active_connection
WHERE employee_id = 'EMPLOYEE_A_UUID' AND organization_id = 'ORG_UUID';

-- Expected: NULL
```

4. Navigate to Chat → #general channel
5. Wait 5 seconds for heartbeat update
6. **Expected**: active_channel_id = general channel UUID

**Validation**:
```sql
SELECT active_channel_id FROM notification.active_connection
WHERE employee_id = 'EMPLOYEE_A_UUID' AND organization_id = 'ORG_UUID';

-- Expected: 'GENERAL_CHANNEL_UUID'
```

7. Navigate to Chat → #engineering channel
8. Wait 5 seconds for heartbeat update
9. **Expected**: active_channel_id = engineering channel UUID

10. Navigate to Organization → Employees page
11. Wait 5 seconds for heartbeat update
12. **Expected**: active_channel_id = NULL (left chat)

---

### Scenario 3: Browser Push Notification Permissions

**Objective**: Request browser notification permissions and register FCM token

**Steps**:
1. Log in as Employee A (first time, permissions not yet requested)
2. **Expected**: In-app modal appears prompting for notification permissions
3. Modal text: "Get notified of mentions and important messages even when Tech Office isn't visible"
4. Modal buttons: "Allow Notifications", "Maybe Later"

5. Click "Allow Notifications"
6. **Expected**: Browser native permission prompt appears
7. Click "Allow" in browser prompt

8. **Expected**: 
   - Frontend registers FCM token with Firebase
   - Frontend sends RegisterPushToken RPC to backend
   - Backend stores token in notification.push_token table
   - Success toast: "Browser notifications enabled"

**Validation**:
```sql
-- Verify push token stored
SELECT token_id, device_identifier, fcm_token, is_valid, registered_at
FROM notification.push_token
WHERE employee_id = 'EMPLOYEE_A_UUID' AND organization_id = 'ORG_UUID';

-- Expected: 1 row, is_valid = true
```

9. Open Tech Office in different browser (e.g., Safari if tested in Chrome)
10. Log in as Employee A again
11. **Expected**: Permission prompt appears again (new device/browser)
12. Grant permissions
13. **Expected**: Second push token registered with different device_identifier

**Validation**:
```sql
-- Verify multiple tokens for same employee
SELECT COUNT(*), device_identifier FROM notification.push_token
WHERE employee_id = 'EMPLOYEE_A_UUID' AND organization_id = 'ORG_UUID'
GROUP BY device_identifier;

-- Expected: 2 rows (one per device)
```

---

### Scenario 4: Push Notification Sending with Deep Links

**Objective**: Verify push notifications sent when app hidden and deep links work

**Steps**:
1. Open Tech Office as Employee A, grant push permissions
2. Ensure Tech Office tab is **hidden** (switch to different tab)
3. Log in as Employee B in different browser/incognito
4. Navigate to Chat → #general channel
5. Mention Employee A: "@EmployeeA Please review the report"

6. **Expected (Employee A device)**:
   - Browser push notification appears in OS notification center
   - Notification title: "Employee B mentioned you in #general"
   - Notification body: "@EmployeeA Please review the report"
   - Notification has action button: "View Message"

**Backend Validation**:
```bash
# Check backend logs for FCM send
# Expected log: "Sent push notification to 1 devices" with notification_id
```

7. Click notification in OS notification center
8. **Expected**:
   - Tech Office tab focuses (or opens if closed)
   - Browser navigates to: `/workspace/chat?channel=GENERAL_UUID&message=MESSAGE_UUID`
   - Channel opens, scrolls to mentioned message
   - Message is highlighted briefly (e.g., yellow background fade)

9. **Expected**: Notification marked as read in backend

**Validation**:
```sql
-- Verify notification marked as read
SELECT read FROM notification.notification
WHERE id = 'NOTIFICATION_UUID';

-- Expected: true
```

10. Verify push token last_used_at updated

**Validation**:
```sql
SELECT last_used_at FROM notification.push_token
WHERE employee_id = 'EMPLOYEE_A_UUID' AND organization_id = 'ORG_UUID';

-- Expected: timestamp within last 5 seconds
```

---

### Scenario 5: Ephemeral Typing Indicators

**Objective**: Verify typing indicators route only to active viewers

**Setup**:
- Employee A viewing #general channel (active_channel_id = general UUID)
- Employee B viewing #engineering channel (active_channel_id = engineering UUID)
- Employee C viewing #general channel (active_channel_id = general UUID)
- Employee D not in chat (active_channel_id = NULL)

**Steps**:
1. Ensure all employees online and active_channel_id set as above
2. Employee D starts typing in #general channel

3. **Expected**:
   - Employee A sees typing indicator: "Employee D is typing..."
   - Employee C sees typing indicator: "Employee D is typing..."
   - Employee B does NOT see indicator (viewing different channel)
   - Employee D sees own typing (client-side)

**Backend Validation**:
```sql
-- Verify active connections that should receive typing indicator
SELECT employee_id, active_channel_id, presence_status
FROM notification.active_connection
WHERE organization_id = 'ORG_UUID'
  AND active_channel_id = 'GENERAL_CHANNEL_UUID'
  AND presence_status = 'online';

-- Expected: 2 rows (Employee A and Employee C)
```

4. Employee D stops typing for 5 seconds
5. **Expected**: Typing indicator auto-expires on frontend (no backend signal)

6. Verify NO database writes for typing indicators

**Validation**:
```sql
-- Verify no notification records created
SELECT COUNT(*) FROM notification.notification
WHERE notification_type = 'typing'
  AND created_at > now() - interval '10 seconds';

-- Expected: 0 (ephemeral signals don't write to DB)
```

---

### Scenario 6: Presence Visibility Controls

**Objective**: Verify visibility settings control who sees presence status

**Setup**:
- Employee A (Engineering department)
- Employee B (Engineering department) 
- Employee C (Sales department)

**Steps**:
1. Employee A logs in, sets visibility to "Visible to everyone"
2. Navigate to Settings → Presence → Visibility Mode
3. Select "Visible to everyone"
4. **Expected**: Presence status visible to all organization members

**Validation**:
```sql
-- Verify visibility setting
SELECT visibility_mode FROM notification.presence_visibility
WHERE employee_id = 'EMPLOYEE_A_UUID' AND organization_id = 'ORG_UUID';

-- Expected: 'everyone'
```

5. Employee B queries Employee A's presence
6. **Expected**: Employee B sees Employee A as "online" (real status)

7. Employee C queries Employee A's presence
8. **Expected**: Employee C sees Employee A as "online" (real status)

---

9. Employee A changes visibility to "Visible to my departments only"
10. Save settings

**Validation**:
```sql
-- Verify visibility updated
SELECT visibility_mode FROM notification.presence_visibility
WHERE employee_id = 'EMPLOYEE_A_UUID' AND organization_id = 'ORG_UUID';

-- Expected: 'departments'
```

11. Employee B queries Employee A's presence
12. **Expected**: Employee B sees Employee A as "online" (shares Engineering dept)

**Validation**:
```sql
-- Verify department sharing
SELECT * FROM organization.department_member
WHERE organization_id = 'ORG_UUID'
  AND employee_id IN ('EMPLOYEE_A_UUID', 'EMPLOYEE_B_UUID');

-- Expected: Both have same department_id
```

13. Employee C queries Employee A's presence
14. **Expected**: Employee C sees Employee A as "offline" (different department)

---

15. Employee A changes visibility to "Appear offline"
16. Save settings

17. Employee B queries Employee A's presence
18. **Expected**: Employee B sees Employee A as "offline" (despite being online)

19. Employee A sends message in #general channel
20. **Expected**: Message appears normally (activity still visible)

---

### Scenario 7: Notification Routing Logic

**Objective**: Verify correct routing between in-app toast and browser push

**Setup**:
- Employee A with push permissions granted
- Employee B sending notifications

**Test Case 1: Employee A viewing channel where event occurs**
1. Employee A viewing #general channel (active_channel_id = general UUID)
2. Employee B mentions Employee A in #general
3. **Expected**: 
   - NO notification shown to Employee A (already viewing content)
   - Notification NOT created in database (suppressed)

---

**Test Case 2: Employee A has tab focused but not viewing channel**
1. Employee A viewing Organization page (active_channel_id = NULL, presence = "online")
2. Employee B mentions Employee A in #general
3. **Expected**:
   - In-app toast appears in Employee A's Tech Office: "Employee B mentioned you in #general"
   - NO browser push sent (tab focused, in-app sufficient)

---

**Test Case 3: Employee A has tab hidden**
1. Employee A has Tech Office open but tab hidden (presence = "online_hidden")
2. Employee B mentions Employee A in #general
3. **Expected**:
   - Browser push notification sent to Employee A's device(s)
   - In-app notification list updated (red badge on notification icon)

**Validation**:
```bash
# Backend logs should show:
# "Routing notification: employee=A, presence=online_hidden, route=push+in-app"
```

---

**Test Case 4: Employee A is offline**
1. Employee A has Tech Office closed (no active connection)
2. Employee B mentions Employee A in #general (priority=0 notification)
3. **Expected**:
   - Browser push sent to all Employee A's devices
   - Notification stored in database for later retrieval

**Validation**:
```sql
-- Verify notification stored
SELECT * FROM notification.notification
WHERE recipient_employee_id = 'EMPLOYEE_A_UUID'
  AND created_at > now() - interval '1 minute';

-- Expected: 1 row
```

---

### Scenario 8: Push Token Validation and Invalidation

**Objective**: Verify invalid tokens are detected and marked

**Steps**:
1. Employee A registers push token, token stored as valid
2. Revoke notification permissions via browser settings (Chrome: Settings → Privacy → Notifications → Block Tech Office)

3. Employee B mentions Employee A
4. Backend attempts to send push notification
5. **Expected**: FCM send fails with "InvalidRegistration" or "NotRegistered" error

**Validation**:
```bash
# Backend logs should show:
# "FCM send failed: token_id=X, error=InvalidRegistration"
# "Marked push token as invalid: token_id=X"
```

6. Verify token marked invalid in database

**Validation**:
```sql
SELECT is_valid FROM notification.push_token
WHERE employee_id = 'EMPLOYEE_A_UUID' AND organization_id = 'ORG_UUID';

-- Expected: false
```

7. Employee A re-grants notification permissions
8. Frontend detects invalid token, registers new token
9. **Expected**: Old token deleted or remains invalid, new token created as valid

---

## Integration Test Checklist

### Backend Integration Tests (in `backend/integration/presence_integration_test.go`)

- [ ] `TestUpdatePresenceStatus_Online`: Update presence to online, verify DB record
- [ ] `TestUpdatePresenceStatus_Idle`: Update to idle after inactivity, verify transition
- [ ] `TestActiveChannelTracking`: Set active_channel_id, verify update
- [ ] `TestPresenceCleanup`: Stale connections (60s+) cleaned up by background job
- [ ] `TestRegisterPushToken`: Register FCM token, verify DB storage
- [ ] `TestRegisterMultipleTokens`: Same employee, different devices, verify multiple tokens
- [ ] `TestInvalidatePushToken`: Mark token invalid after send failure
- [ ] `TestRevokePushToken`: Employee revokes token, verify deletion
- [ ] `TestPresenceVisibility_Everyone`: Visibility mode "everyone", all see real status
- [ ] `TestPresenceVisibility_Departments`: Visibility mode "departments", filter by dept
- [ ] `TestPresenceVisibility_Offline`: Visibility mode "offline", always show offline
- [ ] `TestEphemeralSignalRouting`: Typing indicator sent only to active channel viewers
- [ ] `TestNotificationRouting_Suppression`: Suppress notification when viewing content
- [ ] `TestNotificationRouting_InApp`: In-app toast when tab focused
- [ ] `TestNotificationRouting_Push`: Browser push when tab hidden
- [ ] `TestNotificationRouting_Offline`: Push only when offline
- [ ] `TestPushDeepLink`: Notification data includes channel_id, message_id for deep linking
- [ ] `TestBatchPresenceQuery`: Get presence for multiple employees efficiently

### Frontend Manual Tests

- [ ] Page Visibility API: Tab visibility changes detected correctly
- [ ] Focus Events: Window focus/blur tracked correctly
- [ ] User Interaction: Mouse/keyboard/scroll reset idle timer
- [ ] Idle Detection: No interaction for 5 min triggers idle status
- [ ] Heartbeat: Presence updates sent every 30 seconds
- [ ] Channel Navigation: active_channel_id updates on chat navigation
- [ ] Permission Request: Modal appears on first login, friendly UX
- [ ] Permission Granted: FCM token registered, success toast shown
- [ ] Permission Denied: Banner shown with re-enable instructions
- [ ] Push Notification: Appears in OS notification center when tab hidden
- [ ] Deep Link: Clicking notification navigates to correct channel + message
- [ ] Typing Indicator: Shows when other employee typing in current channel
- [ ] Typing Indicator: Does NOT show for other channels
- [ ] Presence Indicator: Green dot for online, yellow for idle, gray for offline
- [ ] Custom Status: Status text + emoji displayed alongside presence dot
- [ ] Visibility Settings: UI to change visibility mode (everyone/departments/offline)
- [ ] Multi-Device: Multiple browser tabs show separate presence (each has own SSE)

---

## Performance Validation

### Load Testing Presence Tracking

**Objective**: Verify backend handles 10k+ concurrent SSE connections with presence updates

**Setup**:
```bash
# Use k6 or similar load testing tool
k6 run --vus 10000 --duration 5m presence-load-test.js
```

**Test Script** (pseudo-code):
```javascript
// presence-load-test.js
import { check } from 'k6';

export default function() {
  // Establish SSE connection
  const sse = connectSSE('http://localhost:18080/sse');
  
  // Send heartbeat every 30s
  setInterval(() => {
    const response = http.post('http://localhost:18080/rpc/v1/UpdatePresenceStatus', {
      status: 'online',
      active_channel_id: randomChannelID(),
      last_interaction_at: new Date().toISOString()
    });
    
    check(response, {
      'heartbeat response time < 100ms': (r) => r.timings.duration < 100,
      'heartbeat status 200': (r) => r.status === 200,
    });
  }, 30000);
}
```

**Success Criteria**:
- [ ] All 10k connections established successfully
- [ ] Heartbeat p95 latency < 100ms
- [ ] No SSE connection drops (stable for 5 minutes)
- [ ] Backend memory usage < 2GB (connection registry efficient)
- [ ] Database CPU < 50% (indexes effective)

---

### Load Testing Push Notification Sending

**Objective**: Verify FCM send performance with 1000+ concurrent sends

**Setup**:
```bash
k6 run --vus 1000 --duration 1m push-send-test.js
```

**Test Script**:
```javascript
// Trigger notification creation (mention)
// Backend should send push to 1+ devices per employee
// Measure: FCM send latency, error rate, throughput
```

**Success Criteria**:
- [ ] Push send p95 latency < 5 seconds (from notification creation to FCM send)
- [ ] Push send error rate < 1% (excluding invalid tokens)
- [ ] Throughput: 1000+ pushes/second
- [ ] Invalid token detection: Marked invalid within 1 send attempt

---

## Troubleshooting Guide

### Issue: Presence status stuck on "online_hidden" when tab is focused

**Diagnosis**:
- Check browser console for Page Visibility API events
- Verify `document.visibilityState` returns "visible"
- Check if heartbeat is being sent with correct status

**Resolution**:
- Ensure `usePresenceTracking` hook listens to `visibilitychange` event
- Verify heartbeat payload includes `status: 'online'` when tab focused
- Check backend logs for heartbeat processing errors

---

### Issue: Push notifications not appearing

**Diagnosis**:
```sql
-- Check if push token registered
SELECT * FROM notification.push_token
WHERE employee_id = 'EMPLOYEE_UUID' AND is_valid = true;

-- Check if notification created
SELECT * FROM notification.notification
WHERE recipient_employee_id = 'EMPLOYEE_UUID'
ORDER BY created_at DESC LIMIT 5;
```

**Resolution**:
- Verify browser permissions granted (Browser Settings → Notifications)
- Check FCM service account credentials in backend env vars
- Ensure Service Worker registered: Open DevTools → Application → Service Workers
- Check FCM token validity: Try re-registering token
- Verify notification routing logic: Check employee presence status at send time

---

### Issue: Typing indicators not showing

**Diagnosis**:
```sql
-- Check active_channel_id for both employees
SELECT employee_id, active_channel_id, presence_status
FROM notification.active_connection
WHERE organization_id = 'ORG_UUID'
  AND employee_id IN ('TYPER_UUID', 'VIEWER_UUID');
```

**Resolution**:
- Ensure both employees have `active_channel_id` set to same channel
- Verify viewer has `presence_status = 'online'` (not hidden/idle)
- Check SSE connection established for viewer
- Ensure typing event routed correctly in backend (filter by active_channel_id)
- Verify no database writes for typing indicators (ephemeral only)

---

### Issue: Presence visibility not filtering correctly

**Diagnosis**:
```sql
-- Check visibility settings
SELECT * FROM notification.presence_visibility
WHERE employee_id = 'TARGET_UUID';

-- Check department memberships
SELECT employee_id, department_id
FROM organization.department_member
WHERE organization_id = 'ORG_UUID'
  AND employee_id IN ('VIEWER_UUID', 'TARGET_UUID');
```

**Resolution**:
- Verify visibility mode set correctly in database
- Ensure department membership query includes both viewer and target
- Check `GetEmployeeVisiblePresence` query logic applies visibility filtering
- Verify frontend displays filtered presence, not raw status

---

## Success Metrics

After completing quickstart validation, feature is considered functional if:

- [x] Presence status transitions work for all states (online, hidden, idle, offline)
- [x] Active channel tracking updates correctly on navigation
- [x] Browser push permissions requested and tokens stored
- [x] Push notifications delivered when tab hidden/offline
- [x] Deep links navigate to correct content
- [x] Ephemeral signals (typing) route only to active viewers
- [x] Presence visibility filtering works for all modes
- [x] Notification routing logic (in-app vs push) correct for all cases
- [x] Multi-device support: Each device has separate token and connection
- [x] Performance: 10k+ concurrent connections, <100ms heartbeat latency
- [x] Invalid token detection and marking works
- [x] Background cleanup removes stale connections and unused tokens
