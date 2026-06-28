# Quickstart: Notification Hub Frontend

## Purpose
This quickstart provides step-by-step validation scenarios to verify the notification hub frontend implementation. Execute these scenarios after development to confirm all requirements are met.

**Target Audience**: QA testers, developers validating implementation, stakeholders reviewing feature

**Prerequisites**:
- Backend notification service running (#007-notification-hub-backend)
- Frontend dev server running: `cd frontend && pnpm web dev`
- Test user account with employee role
- Test organization set up in database

---

## Test Environment Setup

### 1. Start Backend Services

```bash
# Terminal 1: Start PostgreSQL
cd /path/to/tech-office
docker-compose up -d postgres

# Terminal 2: Start backend server
cd backend
source .env
go run cmd/main.go
# Expected: Server listening on :8080
```

### 2. Start Frontend Dev Server

```bash
# Terminal 3: Start Next.js dev server
cd frontend
pnpm web dev
# Expected: Ready on http://localhost:13000
```

### 3. Create Test Data (Optional)

```bash
# Insert test notifications via backend API (if test data needed)
# Or use existing notifications from other features
```

---

## Scenario 1: Initial Page Load & Authentication

**Objective**: Verify notification hub page loads correctly with authentication

### Steps:

1. **Navigate to workspace**
   - Open browser: `http://localhost:13000/workspace`
   - Login with test credentials if prompted
   - **Expected**: Workspace layout loads with top navigation tabs

2. **Click Notifications tab**
   - Look for 🔔 Notifications tab in top navigation
   - Click on it
   - **Expected**: 
     - URL changes to `/workspace/notifications`
     - Notification hub page loads
     - Authentication token sent with request

3. **Verify initial page structure**
   - **Expected elements visible**:
     - Page title: "Notifications"
     - Filter buttons: "All" and "Unread Only"
     - Source domain filter (Chat, CRM, Projects, etc.)
     - SSE connection status indicator
     - Notification list (or empty state if no notifications)

4. **Check loading state**
   - **Expected**: 
     - Loading skeletons appear briefly during initial fetch
     - Skeleton rows (10x 40px height rectangles)
     - Then replaced with actual notifications or empty state

### Success Criteria:
- ✅ Page loads within 2 seconds
- ✅ Authentication works (no redirect to login)
- ✅ All UI elements present
- ✅ No console errors

---

## Scenario 2: Notification List Display

**Objective**: Verify notifications display correctly with all metadata

### Steps:

1. **View notification list**
   - Ensure at least 5 test notifications exist
   - **Expected**: Notifications displayed in reverse chronological order (newest first)

2. **Check notification item structure**
   - Each notification should show:
     - ✅ Source domain icon/label (e.g., 💬 Chat, 🤝 CRM)
     - ✅ Notification title (bold if unread)
     - ✅ Message preview (first 100 characters)
     - ✅ Relative timestamp (e.g., "2 hours ago", "Just now")
     - ✅ Read/unread visual indicator (bold text or subtle background)
     - ✅ "Mark as read" button (if unread)
     - ✅ Delete button

3. **Verify unread count**
   - Top of page should show: "5 unread notifications" (or actual count)
   - **Expected**: Count matches number of unread notifications in list

4. **Check pagination**
   - If more than 50 notifications exist:
     - ✅ "Load More" button visible at bottom
     - ✅ Shows "Page 1 of X" indicator
   - If fewer than 50:
     - ✅ No "Load More" button

### Success Criteria:
- ✅ All notifications render correctly
- ✅ Unread count accurate
- ✅ Pagination works (if applicable)
- ✅ No layout overflow issues

---

## Scenario 3: Mark Notification as Read (Optimistic Update)

**Objective**: Verify mark as read action with optimistic UI update

### Steps:

1. **Find unread notification**
   - Identify notification with "unread" visual indicator (bold text)
   - Note the notification title for tracking

2. **Click "Mark as read" button**
   - Click button on unread notification
   - **Expected IMMEDIATE behavior** (optimistic update):
     - ✅ Notification visual changes instantly (no longer bold)
     - ✅ "Mark as read" button disappears or changes to "Read"
     - ✅ Unread count decrements by 1 immediately
     - ✅ No loading spinner (optimistic)

3. **Wait for backend confirmation**
   - Wait 1-2 seconds
   - **Expected**: 
     - ✅ No visual change (already updated optimistically)
     - ✅ No error message
     - ✅ Console shows successful API call (if dev mode)

4. **Refresh page**
   - Hard refresh (Cmd+R)
   - **Expected**: 
     - ✅ Notification still marked as read
     - ✅ Read status persisted to backend

### Success Criteria:
- ✅ Immediate UI feedback (< 50ms)
- ✅ Backend persistence confirmed
- ✅ Unread count updates correctly
- ✅ No visual glitches

---

## Scenario 4: Filter Notifications by Read Status

**Objective**: Verify filtering by unread/all status

### Steps:

1. **Initial state: "All" filter active**
   - **Expected**: Both read and unread notifications visible

2. **Click "Unread Only" filter button**
   - **Expected IMMEDIATE behavior**:
     - ✅ Only unread notifications shown
     - ✅ Read notifications hidden
     - ✅ "Unread Only" button visually active/highlighted
     - ✅ Count updates: "Showing 5 of 20 notifications" (example)

3. **Verify filter accuracy**
   - Check all visible notifications are unread (bold text indicator)
   - **Expected**: No read notifications visible

4. **Switch back to "All" filter**
   - Click "All" button
   - **Expected**: All notifications visible again (read + unread)

5. **Test filter persistence**
   - Set filter to "Unread Only"
   - Navigate to different workspace tab
   - Return to notifications tab
   - **Expected**: Filter resets to "All" (acceptable behavior)

### Success Criteria:
- ✅ Filter applies instantly (no loading)
- ✅ Correct notifications shown/hidden
- ✅ Filter state visually clear
- ✅ Smooth transitions

---

## Scenario 5: Filter Notifications by Source Domain

**Objective**: Verify filtering by business domain (Chat, CRM, etc.)

### Steps:

1. **Open source domain filter**
   - Click "Filter by Source" dropdown or checkboxes
   - **Expected**: List of domains with checkboxes:
     - 💬 Chat (3)
     - 🤝 CRM (2)
     - 📋 Projects (0)
     - 👔 HR (1)
     - 🎫 Support (0)
     - 💰 Finance (1)
     - ⚙️ System (0)

2. **Select single domain**
   - Check "Chat" checkbox
   - **Expected IMMEDIATE behavior**:
     - ✅ Only Chat notifications visible
     - ✅ Count updates: "Showing 3 notifications"
     - ✅ "Chat" checkbox checked

3. **Select multiple domains**
   - Additionally check "CRM" checkbox
   - **Expected**:
     - ✅ Chat + CRM notifications visible
     - ✅ Count updates: "Showing 5 notifications"

4. **Combine with read status filter**
   - Keep Chat + CRM selected
   - Click "Unread Only" button
   - **Expected**: 
     - ✅ Only unread notifications from Chat and CRM
     - ✅ Both filters applied correctly

5. **Clear domain filter**
   - Uncheck all domains
   - **Expected**: All domains shown again

### Success Criteria:
- ✅ Domain filter accurate
- ✅ Multiple domains work together
- ✅ Combines with read status filter
- ✅ Counts update correctly

---

## Scenario 6: SSE Real-Time Notifications

**Objective**: Verify real-time notification delivery via SSE

### Prerequisites:
- Notification hub page open
- SSE connection established (status indicator shows "Connected")

### Steps:

1. **Verify initial SSE connection**
   - Check SSE connection status indicator
   - **Expected**: 
     - ✅ Shows "Connected" with green dot
     - ✅ Connection time visible (e.g., "Connected 30s ago")
     - ✅ Console logs: `[SSE] Connection established`

2. **Trigger test notification** (via backend or another user action)
   - Use backend API to publish test notification:
     ```bash
     # Example curl command (adjust for your setup)
     curl -X POST http://localhost:18080/api/notification \
       -H "Authorization: Bearer $TOKEN" \
       -d '{"title":"Test Notification","message":"Real-time test"}'
     ```
   
3. **Observe real-time update**
   - **Expected IMMEDIATE behavior** (< 500ms):
     - ✅ New notification appears at TOP of list
     - ✅ Subtle animation or highlight on new item
     - ✅ Unread count increments immediately
     - ✅ No page refresh required
     - ✅ Scroll position preserved (if scrolled down)

4. **Verify notification details**
   - Check new notification shows:
     - ✅ Correct title and message
     - ✅ Source domain icon
     - ✅ "Just now" timestamp
     - ✅ Unread indicator (bold)

5. **Test multiple rapid notifications**
   - Send 3 notifications within 2 seconds
   - **Expected**: 
     - ✅ All 3 appear in order
     - ✅ Unread count increments correctly (+3)
     - ✅ No duplicate notifications

### Success Criteria:
- ✅ SSE connection establishes automatically
- ✅ New notifications appear within 500ms
- ✅ Unread count updates in real-time
- ✅ No page refresh needed
- ✅ UI stays responsive

---

## Scenario 7: SSE Connection Failure & Reconnection

**Objective**: Verify automatic reconnection when SSE connection drops

### Steps:

1. **Initial connected state**
   - Verify connection status: "Connected"

2. **Simulate connection failure**
   - Option A: Stop backend server temporarily
   - Option B: Use browser dev tools → Network tab → Throttle to "Offline"
   
3. **Observe reconnection attempt**
   - **Expected behavior within 1-2 seconds**:
     - ✅ Status changes to "Disconnected" or "Reconnecting"
     - ✅ Status indicator shows yellow/red color
     - ✅ Console logs: `[SSE] Connection lost, attempting reconnect in 1s`
     - ✅ Notification list still visible (no error page)

4. **Wait for automatic reconnection**
   - Restore backend server or set network to "Online"
   - **Expected** (within 5 seconds):
     - ✅ Status changes to "Connecting" then "Connected"
     - ✅ Status indicator green again
     - ✅ Console logs: `[SSE] Reconnected successfully`
     - ✅ Missed notifications replayed automatically

5. **Verify exponential backoff**
   - Simulate multiple connection failures in sequence
   - **Expected**: 
     - ✅ First reconnect: 1 second delay
     - ✅ Second reconnect: 2 seconds delay
     - ✅ Third reconnect: 4 seconds delay
     - ✅ Console logs show increasing delays

6. **Test manual reconnect button**
   - While disconnected, click "Reconnect" button
   - **Expected**: 
     - ✅ Immediate reconnection attempt
     - ✅ Resets exponential backoff counter

### Success Criteria:
- ✅ Connection failure detected < 5 seconds
- ✅ Automatic reconnection works
- ✅ Exponential backoff implemented correctly
- ✅ Manual reconnect button functional
- ✅ User notified of connection status

---

## Scenario 8: Proactive 5-Minute Disconnect/Reconnect

**Objective**: Verify SSE connection gracefully reconnects every 5 minutes

**Note**: This test requires patience or time manipulation

### Steps:

1. **Establish SSE connection**
   - Open notification hub page
   - Verify connection status: "Connected"
   - Note connection start time

2. **Wait 5 minutes** (or use time manipulation in dev tools)
   - Keep page open
   - Monitor console logs

3. **Observe proactive disconnect**
   - At 5-minute mark, **expected**:
     - ✅ Console log: `[SSE] Proactive disconnect after 5 minutes`
     - ✅ Connection gracefully closed
     - ✅ Status briefly shows "Connecting"
     - ✅ last_event_id stored in localStorage

4. **Observe immediate reconnection**
   - Within 1 second, **expected**:
     - ✅ Connection re-established with last_event_id
     - ✅ Status back to "Connected"
     - ✅ Any missed notifications replayed
     - ✅ No interruption to user experience (seamless)

5. **Verify no missed notifications**
   - If notifications were sent during brief disconnect:
     - ✅ All replayed after reconnection
     - ✅ No duplicates

### Success Criteria:
- ✅ Connection closes at 5-minute mark
- ✅ Reconnection immediate and automatic
- ✅ Missed events replayed correctly
- ✅ User experience seamless (no visible gap)

---

## Scenario 9: Right Sidebar Notification Preview

**Objective**: Verify notification preview in workspace sidebar

### Steps:

1. **Navigate to any workspace page** (e.g., Organization)
   - **Expected**: Right sidebar visible with "Quick Info" section

2. **Check sidebar notification section**
   - **Expected elements**:
     - ✅ Section header: "Notifications (5)" with unread count
     - ✅ List of 3-5 most recent unread notifications
     - ✅ Compact format (smaller text, less padding)
     - ✅ "View all notifications" link at bottom

3. **Verify notification preview items**
   - Each preview item should show:
     - ✅ Source domain icon (e.g., 💬)
     - ✅ Notification title (truncated if long)
     - ✅ Relative timestamp (e.g., "2h")
     - ✅ NO "Mark as read" button (click does nothing per spec)

4. **Test real-time update in sidebar**
   - Trigger new notification via backend
   - **Expected IMMEDIATE behavior**:
     - ✅ New notification appears at top of sidebar preview
     - ✅ Unread count increments
     - ✅ If already showing 5, oldest one removed

5. **Click individual notification in sidebar**
   - **Expected**: 
     - ✅ NO action (spec: action handling deferred to future)
     - ✅ Does not navigate anywhere

6. **Click "View all notifications" link**
   - **Expected**: 
     - ✅ Navigates to `/workspace/notifications`
     - ✅ Full notification hub page loads

### Success Criteria:
- ✅ Sidebar preview shows correct notifications
- ✅ Real-time updates work in sidebar
- ✅ Compact layout (saves vertical space)
- ✅ "View all" link navigates correctly
- ✅ Individual clicks do nothing (as designed)

---

## Scenario 10: Pagination & Load More

**Objective**: Verify pagination works correctly with 50 items per page

**Prerequisites**: Database has 100+ test notifications

### Steps:

1. **Initial page load**
   - Open `/workspace/notifications`
   - **Expected**: 
     - ✅ First 50 notifications shown
     - ✅ "Load More" button visible at bottom
     - ✅ Page indicator: "Page 1"

2. **Click "Load More" button**
   - **Expected**:
     - ✅ Loading spinner appears briefly
     - ✅ Next 50 notifications appended to list (total 100 visible)
     - ✅ "Load More" button still visible (if more pages exist)
     - ✅ Scroll position preserved (not jumped to top)

3. **Continue loading until no more pages**
   - Keep clicking "Load More"
   - **Expected when reaching last page**:
     - ✅ "Load More" button disappears
     - ✅ Message: "No more notifications"

4. **Test scroll preservation**
   - Scroll to middle of list
   - Click "Load More"
   - **Expected**: 
     - ✅ Scroll position maintained (not jumped)
     - ✅ New items added below without disruption

5. **Test filter + pagination**
   - Set filter to "Unread Only"
   - Load multiple pages
   - **Expected**: 
     - ✅ Pagination works with filter applied
     - ✅ Only unread notifications across all pages

### Success Criteria:
- ✅ 50 items per page loaded
- ✅ "Load More" button visibility correct
- ✅ Scroll position preserved
- ✅ Pagination works with filters
- ✅ No duplicate items loaded

---

## Scenario 11: Bulk Mark All as Read

**Objective**: Verify bulk mark all before timestamp action

### Prerequisites**: 50+ unread notifications

### Steps:

1. **View unread notifications**
   - Set filter to "Unread Only"
   - **Expected**: Many unread notifications visible

2. **Click "Mark All Read" button**
   - Look for button near top of page (e.g., in action bar)
   - Click it
   - **Expected**: Confirmation dialog appears:
     - "Mark all notifications as read?"
     - "This will mark X notifications as read"

3. **Confirm action**
   - Click "Confirm" in dialog
   - **Expected IMMEDIATE behavior**:
     - ✅ Loading spinner on button (300ms debounce)
     - ✅ All visible notifications change to "read" state
     - ✅ Unread count goes to 0
     - ✅ Filter "Unread Only" shows empty state

4. **Verify backend persistence**
   - Refresh page
   - **Expected**: 
     - ✅ Unread count still 0
     - ✅ All notifications marked as read

5. **Test debounce protection**
   - Rapidly click "Mark All Read" multiple times (< 300ms apart)
   - **Expected**: 
     - ✅ Only one API call made
     - ✅ Button disabled after first click until completion

### Success Criteria:
- ✅ Bulk action works correctly
- ✅ Confirmation dialog prevents accidents
- ✅ Debounce prevents duplicate calls
- ✅ Backend persistence confirmed
- ✅ Unread count updates correctly

---

## Scenario 12: Delete Notification

**Objective**: Verify notification deletion (soft delete)

### Steps:

1. **Find notification to delete**
   - Pick any notification in list
   - Note its title for tracking

2. **Click delete button** (trash icon)
   - **Expected**: Confirmation dialog appears:
     - "Delete this notification?"
     - "This action cannot be undone"

3. **Confirm deletion**
   - Click "Delete" in dialog
   - **Expected IMMEDIATE behavior**:
     - ✅ Notification removed from list instantly
     - ✅ If unread, unread count decrements
     - ✅ Smooth animation (fade out)

4. **Verify persistence**
   - Refresh page
   - **Expected**: 
     - ✅ Deleted notification NOT visible
     - ✅ Stays deleted (soft delete in backend)

5. **Test deletion with filters**
   - Set filter to "Unread Only"
   - Delete unread notification
   - **Expected**: 
     - ✅ Removed from filtered view immediately
     - ✅ Counts update correctly

### Success Criteria:
- ✅ Confirmation prevents accidental deletion
- ✅ Immediate UI feedback
- ✅ Backend persistence
- ✅ Works correctly with filters

---

## Scenario 13: Empty State Display

**Objective**: Verify empty state shown when no notifications

### Steps:

1. **Delete all notifications** (or use fresh test account)
   - Ensure notification list is empty

2. **View notification hub page**
   - Navigate to `/workspace/notifications`
   - **Expected empty state**:
     - ✅ Icon: 🔔 (notification bell icon, large, gray)
     - ✅ Message: "No notifications yet"
     - ✅ Subtext: "You'll see updates from projects, chat, and more here"
     - ✅ Compact vertical spacing (py-8, not excessive)

3. **Test with "Unread Only" filter**
   - Have some read notifications, no unread
   - Set filter to "Unread Only"
   - **Expected**: 
     - ✅ Empty state shows
     - ✅ Message adjusted: "No unread notifications"

4. **Test with source domain filter**
   - No Chat notifications
   - Filter to "Chat" only
   - **Expected**: 
     - ✅ Empty state shows
     - ✅ Message adjusted: "No Chat notifications"

### Success Criteria:
- ✅ Empty state visually appealing
- ✅ Compact (doesn't waste vertical space)
- ✅ Contextual messaging (changes with filters)
- ✅ No console errors

---

## Scenario 14: Connection Status Indicator

**Objective**: Verify SSE connection status indicator visibility and accuracy

### Steps:

1. **Connected state**
   - Normal operation
   - **Expected indicator**:
     - ✅ Green dot
     - ✅ Text: "Connected"
     - ✅ Tooltip: "Connected 2m ago" (or similar)

2. **Connecting state**
   - Page just loaded or reconnecting
   - **Expected indicator**:
     - ✅ Yellow dot (animated pulsing)
     - ✅ Text: "Connecting..."

3. **Disconnected state**
   - Connection lost
   - **Expected indicator**:
     - ✅ Red dot
     - ✅ Text: "Disconnected"
     - ✅ "Reconnect" button visible

4. **Error state**
   - Authentication failed or server error
   - **Expected indicator**:
     - ✅ Red dot
     - ✅ Text: "Connection error"
     - ✅ Error message tooltip
     - ✅ "Reconnect" button visible

5. **Indicator placement**
   - **Expected**: 
     - ✅ Visible in action bar (top right area)
     - ✅ Doesn't obstruct other UI elements
     - ✅ Always visible (fixed position)

### Success Criteria:
- ✅ Status accurate and real-time
- ✅ Visual indicators clear (color + text)
- ✅ User can act on errors (reconnect button)
- ✅ Placement doesn't interfere with content

---

## Scenario 15: Responsive Layout & Density

**Objective**: Verify UI follows Constitution v3.5.0 density principles

### Steps:

1. **Check top chrome height**
   - Measure top navigation + sub-navigation
   - **Expected**: 
     - ✅ Top nav: 56px (h-14)
     - ✅ Sub-nav (filters): 48px (h-12)
     - ✅ Total chrome: 104px maximum

2. **Check table row density**
   - Measure notification item height
   - **Expected**: 
     - ✅ Row height: 40px (h-10)
     - ✅ Compact padding: py-2, px-3

3. **Check horizontal space utilization**
   - View filter controls
   - **Expected**: 
     - ✅ Filters + actions in SINGLE ROW (not stacked vertically)
     - ✅ Layout: [Filter buttons] [Source dropdown] [Spacer] [Status] [Action buttons]

4. **Check typography**
   - **Expected**:
     - ✅ Page title: text-2xl (24px)
     - ✅ Notification title: text-sm (14px)
     - ✅ Message preview: text-sm (14px)
     - ✅ Timestamp: text-xs (12px)

5. **Check spacing**
   - Page padding: **Expected** py-4 or py-6 (16-24px)
   - Section gaps: **Expected** gap-4 (16px)
   - Card padding: **Expected** p-4 (16px)

6. **Test on 13-inch laptop resolution** (1440x900)
   - Resize browser to simulate 13-inch screen
   - **Expected**: 
     - ✅ Content fits without excessive scrolling
     - ✅ No horizontal scrollbar
     - ✅ All controls accessible
     - ✅ Text readable (not too small)

### Success Criteria:
- ✅ Follows Constitution density principles
- ✅ Maximizes content visible on 13-inch screens
- ✅ Horizontal space utilized (not stacked vertically)
- ✅ Typography readable and consistent

---

## Performance Validation

### Metrics to Measure:

1. **Initial Page Load**
   - Target: < 2 seconds
   - Measure: Time from navigation to first notification visible
   - Use: Browser DevTools Performance tab

2. **Real-Time Notification Render**
   - Target: < 500ms from SSE event to UI update
   - Measure: Console timestamp SSE event → notification appears
   - Use: Console logs + manual timing

3. **SSE Connection Establishment**
   - Target: < 1 second
   - Measure: Page load → connection status "Connected"
   - Use: Console logs

4. **Pagination Load**
   - Target: < 1 second
   - Measure: Click "Load More" → new items visible
   - Use: Manual timing

5. **Mark as Read Response**
   - Target: Immediate (< 50ms optimistic update)
   - Measure: Click → UI updates (before backend confirmation)
   - Use: Manual observation

### Performance Test Commands:

```bash
# Lighthouse performance audit
npx lighthouse http://localhost:13000/workspace/notifications --view

# Network throttling test (slow 3G)
# Chrome DevTools → Network tab → Throttle to "Slow 3G"
# Verify SSE reconnection works
```

---

## Regression Test Checklist

Run these quick checks after any code changes:

- [ ] **Authentication**: Login required, no access without token
- [ ] **Notification List**: Displays correctly, sorted by date
- [ ] **Real-Time Updates**: New notifications appear without refresh
- [ ] **Mark as Read**: Optimistic update works, persists
- [ ] **Filters**: All/Unread and source domain filters work
- [ ] **Pagination**: "Load More" works, no duplicates
- [ ] **SSE Connection**: Auto-connects, auto-reconnects on failure
- [ ] **Sidebar Preview**: Shows in workspace sidebar, updates real-time
- [ ] **Empty State**: Shows when no notifications match filters
- [ ] **UI Density**: Follows Constitution spacing principles
- [ ] **Console Errors**: No errors in browser console
- [ ] **Mobile**: Responsive on mobile devices (future enhancement)

---

## Known Issues / Limitations

### Expected Behavior (Per Spec):
1. **Clicking notification in sidebar**: Does nothing (action handling deferred to future features)
2. **Clicking notification action data**: Shows details, does NOT navigate (action handling deferred)
3. **Authentication token expiration**: Handled by backend; frontend shows error and redirects to login

### Out of Scope (Future Enhancements):
- Sound notifications for new messages
- Browser push notifications when tab inactive
- Per-employee notification preferences (mute types)
- Rich notification content (images, attachments)
- Navigation to source resources from notifications

---

## Troubleshooting Common Issues

### Issue: SSE Connection Won't Establish

**Symptoms**: Status stuck on "Connecting", console errors

**Checks**:
1. Backend server running? `curl http://localhost:18080/health`
2. Auth token valid? Check localStorage or useRequireAuth
3. CORS configured? Backend should allow frontend origin
4. Streaming interceptor implemented? Check `backend/internal/interceptor/auth.go` has `WrapStreamingHandler` method

**Fix**: 
- Restart backend server
- Re-login to get fresh token
- Check backend logs for auth errors

### Issue: Notifications Not Appearing in Real-Time

**Symptoms**: Manual refresh shows notifications, but no SSE updates

**Checks**:
1. SSE connection status: Should be "Connected"
2. Console logs: Should show `[SSE] Event received: notification`
3. Backend LISTEN/NOTIFY: Check backend logs for notification publish events

**Fix**:
- Check `backend/internal/notification/listener.go` running
- Verify PostgreSQL LISTEN channels active
- Test with manual notification publish via API

### Issue: Optimistic Update Rollback

**Symptoms**: Notification marked as read, then reverts to unread

**Checks**:
1. Console error: Should show API call failure reason
2. Network tab: Check response status code (401, 403, 500)
3. Backend logs: Check for permission or database errors

**Fix**:
- Verify user has correct role (ROLE_EMPLOYEE or higher)
- Check notification belongs to user's organization (tenant isolation)
- Restart backend if database connection issue

---

## Success Criteria Summary

**Feature is READY FOR PRODUCTION when**:

✅ All 15 scenarios pass without errors  
✅ Performance metrics within targets (< 2s load, < 500ms render)  
✅ SSE connection reliable (auto-reconnect works)  
✅ UI follows Constitution density principles  
✅ No console errors in normal operation  
✅ Authentication works correctly  
✅ Multi-tenant isolation enforced (can't see other org's notifications)  
✅ Regression test checklist passes  

---

**Document Version**: 1.0  
**Last Updated**: October 28, 2025  
**Validation Status**: ⏳ Pending Implementation
