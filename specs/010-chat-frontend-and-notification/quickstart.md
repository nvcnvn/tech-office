# Quickstart Guide: Chat Frontend and Notification Integration

**Feature**: 010-chat-frontend-and-notification  
**Date**: 2025-10-29  
**Status**: Test Scenarios Defined

## Purpose

This quickstart provides end-to-end test scenarios for validating the chat frontend with notification integration. These scenarios serve as:
1. Acceptance criteria for feature completion
2. Manual testing checklist before deployment
3. Automated E2E test specifications
4. Onboarding guide for new developers

---

## Prerequisites

### Backend Services Running
```bash
# Start backend server
cd backend
go run ./cmd server

# Verify chat service registered
curl http://localhost:18080/health
```

### Frontend Dev Server Running
```bash
# Start Next.js dev server
cd frontend
pnpm web dev

# Access at http://localhost:13000
```

### Test Data Setup

```bash
# Create test organization and employees
# (Assuming organization "tech-startup" with employees "alice", "bob", "charlie")

# Create test channel
curl -X POST http://localhost:18080/rpc.v1.ChatService/CreateChannel \
  -H "Authorization: Bearer <alice-token>" \
  -d '{
    "title_slug": "general",
    "display_name": "General",
    "description": "General team chat",
    "channel_type": "CHANNEL_TYPE_CHAT",
    "is_private": false
  }'

# Bob and Charlie join the channel
curl -X POST http://localhost:18080/rpc.v1.ChatService/JoinChannel \
  -H "Authorization: Bearer <bob-token>" \
  -d '{"channel_id": "<channel-id>"}'
```

---

## Scenario 1: Basic Chat Navigation

**Goal**: Verify 3-column layout and channel switching

**Steps**:
1. Navigate to `/workspace` as Alice
2. Click "Chat" tab in top navigation (or press Cmd+5)
3. Observe 3-column layout:
   - Left: Channel sidebar with "general" channel
   - Center: Message list (empty)
   - Right: Thread view (closed)
4. Click "general" channel in sidebar
5. Verify center area shows channel header: "# General"

**Expected Result**:
- ✅ Chat layout renders without errors
- ✅ Channel sidebar shows "general" channel
- ✅ Center area displays channel name
- ✅ Thread view is collapsed by default
- ✅ URL updates to `/workspace/chat?channel=<channel-id>`

**Acceptance Criteria**:
- 3-column layout is responsive (works on 13-inch laptop)
- Channel switch is instant (<100ms)
- No console errors

---

## Scenario 2: Send and Receive Messages

**Goal**: Verify real-time message delivery and display

**Steps**:
1. Alice is viewing "general" channel
2. Bob opens "general" channel in separate browser/tab
3. Alice types "Hello team!" in message composer
4. Alice clicks Send (or presses Enter)
5. Bob observes message appears in real-time

**Expected Result**:
- ✅ Alice's message appears immediately (optimistic UI)
- ✅ Bob receives message via SSE within 1 second
- ✅ Message displays author name "Alice Smith" and timestamp
- ✅ Message text is rendered correctly

**Acceptance Criteria**:
- Real-time delivery <60s (SLA)
- Optimistic UI: Alice sees message before server confirmation
- SSE reconnection works if connection drops

---

## Scenario 3: @Mention Notification and Navigation

**Goal**: Verify mention detection, notification, and deep linking

**Steps**:
1. Bob is viewing "general" channel
2. Charlie is viewing a different channel or page
3. Bob types "@charlie can you review this?" and sends
4. Charlie receives notification (bell icon shows badge)
5. Charlie clicks notification
6. Charlie is navigated to "general" channel with Bob's message highlighted

**Expected Result**:
- ✅ Bob's message parses @charlie mention (highlighted in blue)
- ✅ Charlie receives notification: "Bob mentioned you in #general"
- ✅ Notification includes preview: "@charlie can you review this?"
- ✅ Clicking notification navigates to `/workspace/chat?channel=<id>&message=<id>`
- ✅ Bob's message is scrolled into view and briefly highlighted

**Acceptance Criteria**:
- Mention notification arrives <5s
- Deep link navigates to correct message
- Message highlight effect is visible (yellow background fade out)
- Invalid mentions (non-existent users) don't create notifications

---

## Scenario 4: Reply to Message (Threading)

**Goal**: Verify single-layer reply threading and thread view

**Steps**:
1. Alice is viewing "general" channel with Bob's message visible
2. Alice hovers over Bob's message
3. Alice clicks "Reply" button
4. Right panel opens showing thread view with Bob's message as parent
5. Alice types "Good point!" in thread composer
6. Alice sends reply
7. Bob receives notification: "Alice replied to your message"
8. Bob clicks notification and sees reply in thread view

**Expected Result**:
- ✅ Thread view auto-opens on "Reply" click
- ✅ Bob's message displays as parent in thread
- ✅ Alice's reply appears as child message
- ✅ Bob's original message shows reply count badge (1 reply)
- ✅ Bob receives reply notification
- ✅ Thread view closes when Alice presses Escape or switches channels

**Acceptance Criteria**:
- Thread view renders correctly (320px width on desktop)
- Reply count updates in real-time
- Cannot reply to a reply (single-layer enforced)
- Thread view persists when sending new messages in channel

---

## Scenario 5: Reactions

**Goal**: Verify emoji reaction UI and real-time updates

**Steps**:
1. Alice is viewing Bob's message in "general"
2. Alice hovers over Bob's message
3. Alice clicks emoji reaction button
4. Native emoji picker appears (OS-dependent)
5. Alice selects 👍 emoji
6. Reaction appears on message with count "1"
7. Charlie also reacts with 👍 to same message
8. Reaction count updates to "2" in real-time

**Expected Result**:
- ✅ Emoji picker appears on click
- ✅ Reaction saves to database
- ✅ Alice sees reaction immediately (optimistic UI)
- ✅ Charlie's reaction updates count via SSE
- ✅ Clicking same emoji again removes reaction (toggle)

**Acceptance Criteria**:
- Reaction count updates <1s via SSE
- Multiple emojis supported per message
- Reaction summary groups by emoji type

---

## Scenario 6: Unread Message Tracking

**Goal**: Verify unread badges and mark-as-read functionality

**Steps**:
1. Charlie is viewing "announcements" channel
2. Alice sends message to "general" channel
3. Sidebar shows unread badge on "general" (red dot with count)
4. Charlie clicks "general" channel
5. Unread badge disappears
6. Charlie switches to "announcements" again
7. No unread badge on "general" (marked as read)

**Expected Result**:
- ✅ Unread badge appears on "general" channel
- ✅ Badge shows count (e.g., "1")
- ✅ Badge disappears when Charlie views "general"
- ✅ MarkChannelAsRead RPC called automatically
- ✅ Badge persists across page refresh (server-side tracking)

**Acceptance Criteria**:
- Unread count accurate across multiple devices
- Mark-as-read triggered on channel view (not message scroll)
- Unread count syncs within 1s

---

## Scenario 7: Typing Indicators

**Goal**: Verify typing indicators work without overwhelming server

**Steps**:
1. Alice and Bob both viewing "general" channel
2. Bob starts typing in message composer
3. Alice sees "Bob is typing..." indicator below last message
4. Bob stops typing (no send)
5. After 5 seconds, indicator disappears for Alice
6. Bob resumes typing
7. Alice sees indicator reappear

**Expected Result**:
- ✅ Typing indicator appears <300ms after Bob starts typing
- ✅ Indicator auto-expires after 5s idle
- ✅ Indicator reappears on resume typing (3s debounce)
- ✅ Multiple users typing shows stacked indicators

**Acceptance Criteria**:
- Typing indicator doesn't spam server (3s debounce)
- Server auto-expires stale indicators (5s TTL)
- No indicator shown for own typing

---

## Scenario 8: Message Composer WYSIWYG

**Goal**: Verify Markdown editor works for short and long messages

**Steps**:
1. Alice opens "general" channel
2. Alice types short message: "Quick update"
3. Alice presses Enter → message sends (inline mode)
4. Alice clicks "Compose" or presses Cmd+Enter → editor expands
5. Alice types long-form content with formatting:
   ```markdown
   ## Sprint Review
   - Completed feature X
   - **Blocker**: API rate limit
   ```
6. Alice clicks "Send" → formatted message displays

**Expected Result**:
- ✅ Short messages send inline (single-line input)
- ✅ Long messages display formatted (Markdown rendered)
- ✅ TipTap editor provides toolbar for bold, italic, lists
- ✅ @mention autocomplete works in editor
- ✅ Editor supports paste, undo/redo

**Acceptance Criteria**:
- Editor supports Markdown syntax (bold, italic, lists, headings, code)
- Markdown bidirectional (edit rendered message shows source)
- Editor is mobile-responsive

---

## Scenario 9: Virtual Scrolling Performance

**Goal**: Verify smooth scrolling with 1000+ messages

**Steps**:
1. Load "general" channel with 1000 pre-seeded messages
2. Observe initial render time (<1s)
3. Scroll to top → messages load dynamically (pagination)
4. Scroll to bottom → latest messages visible
5. New message arrives → auto-scroll to bottom (if at bottom)
6. User scrolled up → new message shows "New messages" badge (no auto-scroll)

**Expected Result**:
- ✅ Initial render <1s for 1000 messages
- ✅ Smooth 60fps scrolling (no janky re-renders)
- ✅ "Load more" at top when scrolling up
- ✅ Auto-scroll to bottom on new message (if user at bottom)
- ✅ "Jump to latest" button appears if user scrolled up

**Acceptance Criteria**:
- Virtual scrolling handles dynamic heights (messages vary in size)
- Scroll position preserved on window resize
- Memory usage <100MB for 1000 messages

---

## Scenario 10: Mobile Responsive Design

**Goal**: Verify chat works on mobile viewports (375px width)

**Steps**:
1. Open chat on mobile browser (or resize to 375px width)
2. Sidebar auto-collapses → hamburger menu appears
3. Tap hamburger → sidebar slides in from left
4. Tap "general" channel → sidebar closes, message list fills screen
5. Tap "Reply" on message → thread view replaces message list (full-width modal)
6. Tap back button → thread closes, message list restored

**Expected Result**:
- ✅ Sidebar collapses to hamburger on <768px width
- ✅ Message list is full-width on mobile
- ✅ Thread view is full-screen modal on mobile
- ✅ Composer is sticky at bottom (doesn't scroll away)
- ✅ Touch gestures work (swipe to close thread)

**Acceptance Criteria**:
- All interactions work on touch devices
- No horizontal scroll on mobile
- Font sizes readable on small screens

---

## Scenario 11: Offline Resilience

**Goal**: Verify graceful handling of network issues

**Steps**:
1. Alice is viewing "general" channel
2. Disconnect network (airplane mode or dev tools)
3. Alice types message and clicks send
4. Message shows "Sending..." indicator
5. Reconnect network
6. Message delivers and indicator changes to checkmark

**Expected Result**:
- ✅ SSE connection shows "Reconnecting..." in UI
- ✅ Pending messages show "Sending..." state
- ✅ Messages queue and retry on reconnect
- ✅ SSE reconnects with exponential backoff
- ✅ Missed messages fetched on reconnect (last_event_id)

**Acceptance Criteria**:
- No data loss during network interruptions
- Reconnect <5s with healthy network
- User notified of connection status

---

## Scenario 12: Channel Creation and Membership

**Goal**: Verify channel management features

**Steps**:
1. Alice clicks "Create Channel" button in sidebar
2. Dialog opens with form fields
3. Alice enters:
   - Title: "project-alpha"
   - Display Name: "Project Alpha"
   - Description: "Alpha project discussions"
   - Privacy: Private (checkbox)
4. Alice clicks "Create"
5. Channel appears in sidebar
6. Alice invites Bob via member management
7. Bob receives invitation notification
8. Bob accepts and channel appears in his sidebar

**Expected Result**:
- ✅ Create channel dialog validates inputs (no special chars in slug)
- ✅ New channel appears immediately in Alice's sidebar
- ✅ Private channel not visible to non-members
- ✅ Invitation notification sent to Bob
- ✅ Bob can join and view messages

**Acceptance Criteria**:
- Channel slug validation enforced (alphanumeric + hyphens)
- Private channels enforce invite-only access
- Channel creator auto-becomes admin

---

## Performance Benchmarks

| Metric | Target | Measurement |
|--------|--------|-------------|
| Initial chat page load | <2s | Time to interactive |
| Channel switch | <100ms | UI update latency |
| Message send (optimistic) | <50ms | Time to UI update |
| Message send (confirmed) | <500ms | Round-trip time |
| SSE notification delivery | <60s | P95 latency (SLA) |
| Typing indicator | <300ms | Time from keystroke |
| Unread count update | <1s | Time from message arrival |
| Virtual scroll FPS | 60fps | No dropped frames |
| 1000 messages render | <1s | Initial load time |

---

## Error Handling Scenarios

### 1. Invalid Message Content
- Send empty message → validation error shown
- Send message >10k chars → truncate with warning
- Send message with invalid @mention → mention not clickable

### 2. Network Failures
- SSE disconnect → "Reconnecting..." banner
- Message send failure → "Failed to send, retry?" button
- Concurrent edits → last-write-wins with notification

### 3. Authorization Errors
- Non-member tries to view private channel → 403 error page
- Deleted user's messages → show "[deleted user]"
- Removed from channel mid-session → redirect to channel list

---

## Accessibility Testing

1. **Keyboard Navigation**: Tab through all interactive elements
2. **Screen Reader**: Announce new messages and notifications
3. **High Contrast**: All text meets WCAG AA contrast ratios
4. **Focus Indicators**: Visible focus rings on all inputs
5. **ARIA Labels**: Buttons and icons have accessible names

---

## Security Testing

1. **Tenant Isolation**: Alice cannot access Bob's org messages
2. **Channel Privacy**: Non-members cannot view private channels
3. **XSS Prevention**: Malicious scripts in messages don't execute
4. **CSRF Protection**: All mutations require valid auth token
5. **Rate Limiting**: Typing indicators throttled (no spam)

---

## CI/CD Integration

```bash
# Run automated E2E tests
cd frontend
pnpm test:e2e --spec="chat.spec.ts"

# Expected: All 12 scenarios pass
```

**Test Coverage**:
- Unit tests: 80% for new components
- Integration tests: All RPC methods covered
- E2E tests: All 12 quickstart scenarios automated

---

## Rollback Checklist

If critical issues found post-deployment:

1. Disable chat tab in workspace layout (feature flag)
2. Revert proto changes (backend stays compatible)
3. Rollback database migration (drop new columns)
4. Clear SSE event queue (avoid stale events)
5. Monitor error rates and latency

**Safe Rollback**: All changes are additive; existing features unaffected

---

## Summary

**12 Test Scenarios Defined**  
**Performance Targets Specified**  
**Accessibility & Security Validated**  
**CI/CD Integration Planned**

**Ready for Phase 2 Task Planning and Implementation**
