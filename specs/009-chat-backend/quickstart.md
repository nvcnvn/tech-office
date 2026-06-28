# Quickstart: Chat Backend System

**Feature**: Chat Backend System  
**Date**: October 29, 2025  
**Purpose**: End-to-end test scenarios for chat functionality

## Prerequisites

- Backend server running with chat service registered
- Frontend dev server running
- Test organization created with at least 3 test employees
- Notification hub backend running (Feature #007)
- Database migrated with chat schema

**Note on Notification Delivery**: Chat service uses `PublishBatchNotification` RPC method from notification service (see `backend/internal/notification/publisher.go`). The notification service handles performance optimization with batched PostgreSQL UNNEST inserts, so chat tests focus on end-to-end notification delivery via the RPC interface rather than direct database inserts.

## Test Environment Setup

```bash
# Terminal 1: Start backend
cd backend
source .env
go run ./cmd server

# Terminal 2: Start frontend
cd frontend
pnpm web dev

# Terminal 3: Tail logs for debugging
tail -f backend/logs/server.log

# Terminal 4: Watch notification hub activity
psql -h localhost -U postgres -d techoffice \
  -c "SELECT * FROM notification.notification WHERE source_domain='chat' ORDER BY updated_at DESC LIMIT 10;"
```

### Test Users
- **Alice** (alice@testorg.com): Channel creator, admin
- **Bob** (bob@testorg.com): Regular member
- **Charlie** (charlie@testorg.com): Will be invited

---

## Scenario 1: Create Public Channel & Invite Members

### Goal
Verify channel creation, membership management, and invitation notifications.

### Steps

1. **Login as Alice**
   - Navigate to `https://testorg.tech-office.local:3000/workspace/chat`
   - Should see empty channel list with "Create Channel" button

2. **Create Public Channel**
   - Click "Create Channel"
   - Fill form:
     * Display Name: "General Discussion"
     * Slug: `general-discussion` (auto-generated from display name)
     * Description: "Team-wide announcements and discussions"
     * Type: Chat
     * Visibility: Public
   - Click "Create"
   - **Expected**: Channel appears in list, Alice is automatically a member with admin badge

3. **Verify Alice's Membership**
   - Click on "General Discussion" channel
   - Navigate to "Members" section
   - **Expected**: Alice listed as admin (badge visible)
   - **Database Check**:
     ```sql
     SELECT * FROM chat.channel WHERE title_slug = 'general-discussion';
     -- Should return 1 row with is_private=false
     
     SELECT * FROM chat.channel_membership 
     WHERE channel_id = (SELECT id FROM chat.channel WHERE title_slug = 'general-discussion')
       AND is_admin = true;
     -- Should return 1 row for Alice
     ```

4. **Invite Bob to Channel**
   - In "Members" section, click "Invite"
   - Select "Bob" from employee dropdown
   - Click "Send Invite"
   - **Expected**: 
     * Bob added to member list
     * Bob receives notification (check notification hub)
   - **Database Check**:
     ```sql
     SELECT * FROM notification.notification 
     WHERE target_user_id = (SELECT id FROM organization.employee WHERE email = 'bob@testorg.com')
       AND source_domain = 'chat' 
       AND notification_type = 'invite'
     ORDER BY updated_at DESC LIMIT 1;
     -- Should show invite notification with action_data containing channelId
     ```

5. **Bob Accepts Invite (Login as Bob)**
   - Logout Alice, login as Bob
   - Check notifications (bell icon in header)
   - **Expected**: Notification "You've been invited to #general-discussion"
   - Click notification → navigates to `workspace/chat?channel=general-discussion`
   - **Expected**: Bob can see channel and is listed as member (not admin)

### Success Criteria
- [x] Public channel created with unique slug
- [x] Creator automatically becomes admin member
- [x] Invited user receives notification
- [x] Invited user can access channel
- [x] Admin status correctly assigned

---

## Scenario 2: Send Message & Receive Real-Time Notification

### Goal
Verify message sending, real-time delivery via notification hub, and batched notifications for multiple members.

### Steps (Continue as Bob)

1. **Bob Sends Message**
   - In "General Discussion" channel, type message in composer: "Hello team! 👋"
   - Press Enter or click "Send"
   - **Expected**: 
     * Message appears immediately in thread (optimistic UI)
     * Message shows Bob's name and timestamp
     * Message composer clears

2. **Alice Receives Real-Time Notification**
   - Switch to Alice's browser session (keep logged in)
   - **Expected** (within 1-2 seconds):
     * Notification badge on "Chat" tab increments
     * SSE notification received (check browser DevTools Network tab)
     * Channel "General Discussion" shows unread indicator
   - Click channel → message visible in thread
   - **Database Check**:
     ```sql
     SELECT * FROM chat.message 
     WHERE channel_id = (SELECT id FROM chat.channel WHERE title_slug = 'general-discussion')
       AND author_employee_id = (SELECT id FROM organization.employee WHERE email = 'bob@testorg.com')
     ORDER BY updated_at DESC LIMIT 1;
     -- Should show Bob's message
     
     SELECT * FROM notification.notification
     WHERE target_user_id = (SELECT id FROM organization.employee WHERE email = 'alice@testorg.com')
       AND source_domain = 'chat'
       AND notification_type = 'message'
     ORDER BY updated_at DESC LIMIT 1;
     -- Should show notification for Bob's message
     ```

3. **Verify Notification Performance (Invite Charlie)**
   - As Alice, invite Charlie to channel (repeat Step 4 from Scenario 1)
   - As Alice, send message: "Welcome Charlie!"
   - **Expected**: Both Bob and Charlie receive notifications
   - **Performance Check**:
     ```sql
     -- Check batched notification insert
     SELECT COUNT(*) FROM notification.notification
     WHERE source_domain = 'chat'
       AND action_data->>'channelId' = (SELECT id::text FROM chat.channel WHERE title_slug = 'general-discussion')
       AND updated_at > now() - interval '5 seconds';
     -- Should show 2 notifications (Bob + Charlie) inserted nearly simultaneously
     ```
   - **Expected Latency**: <100ms for notification publish (check server logs)

### Success Criteria
- [x] Message sent successfully
- [x] Real-time notification delivered via SSE
- [x] Multiple members receive notifications (batched)
- [x] Notification latency <100ms

---

## Scenario 3: Threaded Reply (1-Level Only)

### Goal
Verify reply functionality with single-layer depth enforcement.

### Steps (As Alice)

1. **Reply to Bob's Message**
   - Hover over Bob's message "Hello team! 👋"
   - Click "Reply" button
   - Type: "Thanks for joining, Bob!"
   - Click "Send"
   - **Expected**:
     * Reply appears indented under Bob's message
     * Reply shows "Replying to Bob" context
     * Bob receives notification about reply

2. **Verify Reply Notification**
   - **Database Check**:
     ```sql
     SELECT * FROM chat.message
     WHERE parent_message_id = (
       SELECT id FROM chat.message 
       WHERE content LIKE '%Hello team%'
     );
     -- Should show Alice's reply
     
     SELECT * FROM notification.notification
     WHERE target_user_id = (SELECT id FROM organization.employee WHERE email = 'bob@testorg.com')
       AND notification_type = 'reply'
     ORDER BY updated_at DESC LIMIT 1;
     -- Should show reply notification to Bob
     ```

3. **Attempt Reply to Reply (Should Fail)**
   - As Bob, hover over Alice's reply
   - **Expected**: No "Reply" button visible (UI enforcement)
   - **API Test** (optional, via browser console):
     ```javascript
     // Attempt to reply to a reply via API
     fetch('/api/chat/reply', {
       method: 'POST',
       body: JSON.stringify({
         parent_message_id: '<alice-reply-id>',
         content: 'This should fail'
       })
     });
     ```
   - **Expected**: `400 Bad Request` error with message "Cannot reply to a reply"
   - **Database Check**:
     ```sql
     -- Verify CHECK constraint prevents reply to reply
     INSERT INTO chat.message (id, organization_id, channel_id, content, author_employee_id, parent_message_id)
     VALUES (
       uuidv7(),
       '<org-id>',
       '<channel-id>',
       'Test reply to reply',
       '<employee-id>',
       '<reply-message-id-with-parent>'
     );
     -- Should fail with CHECK constraint violation
     ```

### Success Criteria
- [x] Reply sent successfully
- [x] Reply indented/visually associated with parent
- [x] Original author receives reply notification
- [x] Reply to reply blocked (UI + backend)

---

## Scenario 4: Emoji Reactions

### Goal
Verify reaction functionality with aggregation and toggle behavior.

### Steps (As Charlie)

1. **Add Reaction to Bob's Message**
   - Hover over Bob's message "Hello team! 👋"
   - Click reaction picker (smiley face icon)
   - Select "👍" (thumbs up)
   - **Expected**:
     * Reaction appears on message: "👍 1"
     * Charlie's name in reaction tooltip

2. **Bob Adds Same Reaction**
   - As Bob, hover over own message
   - Click reaction picker, select "👍"
   - **Expected**:
     * Reaction count increments: "👍 2"
     * Tooltip shows "Charlie, Bob"

3. **Alice Adds Different Reaction**
   - As Alice, add "❤️" (heart) reaction to Bob's message
   - **Expected**:
     * Two reactions visible: "👍 2" and "❤️ 1"

4. **Toggle Reaction (Charlie Removes Thumbs Up)**
   - As Charlie, click "👍" reaction again
   - **Expected**:
     * Reaction count decrements: "👍 1"
     * Tooltip shows only "Bob"
   - **Database Check**:
     ```sql
     SELECT emoji_code, COUNT(*) as count
     FROM chat.reaction
     WHERE message_id = (SELECT id FROM chat.message WHERE content LIKE '%Hello team%')
     GROUP BY emoji_code;
     -- Should show: 👍 (count=1), ❤️ (count=1)
     ```

5. **Verify No Notification for Reactions**
   - **Database Check**:
     ```sql
     SELECT COUNT(*) FROM notification.notification
     WHERE source_domain = 'chat'
       AND notification_type = 'reaction'
       AND updated_at > now() - interval '5 minutes';
     -- Should return 0 (reactions don't trigger notifications)
     ```

### Success Criteria
- [x] Reactions added successfully
- [x] Reactions aggregated by emoji type
- [x] Toggle behavior works (remove duplicate reaction)
- [x] No notifications sent for reactions

---

## Scenario 5: Private Channel & Access Control

### Goal
Verify private channel creation, access control, and invitation-only membership.

### Steps (As Alice)

1. **Create Private Channel**
   - Click "Create Channel"
   - Fill form:
     * Display Name: "Leadership Team"
     * Slug: `leadership-team`
     * Description: "Private discussions for leads"
     * Type: Chat
     * Visibility: Private (toggle switch)
   - Click "Create"
   - **Expected**: Channel created with lock icon

2. **Verify Bob Cannot See Private Channel**
   - As Bob, navigate to "Chat" workspace
   - Check channel list and "Browse Channels"
   - **Expected**: "Leadership Team" NOT visible
   - **API Test** (as Bob, via browser console):
     ```javascript
     fetch('/api/chat/channel/<leadership-team-id>')
     ```
   - **Expected**: `403 Forbidden` or `404 Not Found`

3. **Alice Invites Charlie to Private Channel**
   - As Alice, in "Leadership Team" channel, click "Invite"
   - Select Charlie
   - Click "Send Invite"
   - **Expected**: Charlie receives invite notification

4. **Charlie Accesses Private Channel**
   - As Charlie, click notification
   - Navigate to "Leadership Team" channel
   - **Expected**: Charlie can see and send messages
   - **Expected**: Bob still cannot see channel

### Success Criteria
- [x] Private channel created
- [x] Non-members cannot discover or access private channel
- [x] Invited members can access private channel
- [x] Access control enforced at API level

---

## Scenario 6: Message Editing & Deletion

### Goal
Verify message editing with history tracking and soft deletion with reply preservation.

### Steps (As Alice)

1. **Edit Own Message**
   - In "General Discussion", hover over own message "Welcome Charlie!"
   - Click "Edit" (pencil icon)
   - Change text to: "Welcome Charlie! Glad to have you here."
   - Click "Save"
   - **Expected**:
     * Message updated with new text
     * "(edited)" indicator appears
     * Edit timestamp updated
   - **Database Check**:
     ```sql
     SELECT is_edited, content 
     FROM chat.message 
     WHERE content LIKE '%Welcome Charlie%';
     -- Should show is_edited=true
     ```

2. **Delete Message with Replies**
   - As Alice, delete Bob's original message "Hello team! 👋" (which has Alice's reply)
   - Confirm deletion modal
   - **Expected**:
     * Bob's message shows "[This message was deleted]"
     * Alice's reply remains visible (with "Replying to [deleted message]")
   - **Database Check**:
     ```sql
     SELECT is_deleted, content 
     FROM chat.message 
     WHERE content LIKE '%Hello team%';
     -- Should show is_deleted=true
     
     SELECT COUNT(*) FROM chat.message
     WHERE parent_message_id = (SELECT id FROM chat.message WHERE is_deleted=true AND content LIKE '%Hello team%');
     -- Should show 1 (Alice's reply still exists)
     ```

3. **Verify Admin Can Delete Any Message**
   - As Alice (admin), delete Bob's message (Bob is author, not admin)
   - **Expected**: Deletion succeeds (admin privilege)

4. **Verify Non-Admin Cannot Delete Others' Messages**
   - As Bob (non-admin), attempt to delete Alice's message
   - **Expected**: Delete button not visible OR `403 Forbidden` error

### Success Criteria
- [x] Author can edit own messages
- [x] Edit history tracked with "(edited)" indicator
- [x] Soft delete preserves replies
- [x] Admin can delete any message
- [x] Non-admin cannot delete others' messages

---

## Scenario 7: Notification Preferences

### Goal
Verify per-channel notification preferences (all/mentions/muted) with @mention override.

### Steps (As Charlie)

1. **Set Channel to Mentions Only**
   - In "General Discussion" channel, click settings cog
   - Change notification preference to "Mentions only"
   - Save
   - **Database Check**:
     ```sql
     SELECT notification_preference 
     FROM chat.channel_membership
     WHERE channel_id = (SELECT id FROM chat.channel WHERE title_slug = 'general-discussion')
       AND employee_id = (SELECT id FROM organization.employee WHERE email = 'charlie@testorg.com');
     -- Should show 'mentions'
     ```

2. **Bob Sends Regular Message (No Mention)**
   - As Bob, send message: "Anyone around?"
   - **Expected**: Charlie does NOT receive notification
   - **Database Check**:
     ```sql
     SELECT COUNT(*) FROM notification.notification
     WHERE target_user_id = (SELECT id FROM organization.employee WHERE email = 'charlie@testorg.com')
       AND source_domain = 'chat'
       AND notification_type = 'message'
       AND updated_at > now() - interval '1 minute';
     -- Should return 0
     ```

3. **Bob Mentions Charlie**
   - As Bob, send message: "@charlie can you review the docs?"
   - **Expected**: 
     * Charlie receives notification (overrides "mentions only" setting)
     * Notification type is "mention" not "message"
   - **Database Check**:
     ```sql
     SELECT notification_type 
     FROM notification.notification
     WHERE target_user_id = (SELECT id FROM organization.employee WHERE email = 'charlie@testorg.com')
       AND source_domain = 'chat'
     ORDER BY updated_at DESC LIMIT 1;
     -- Should show 'mention'
     ```

4. **Mute Channel Completely**
   - As Charlie, change preference to "Muted"
   - **Expected**: No notifications for any messages (even mentions)
   - **Verification**: Bob sends "@charlie are you there?" → Charlie gets NO notification

### Success Criteria
- [x] Notification preferences saved per channel
- [x] "Mentions only" prevents regular message notifications
- [x] @mentions override "mentions only" setting
- [x] "Muted" blocks all notifications (including mentions)

---

## Scenario 8: Typing Indicators

### Goal
Verify ephemeral typing indicator broadcasts via SSE.

### Steps

1. **Alice Starts Typing**
   - As Alice, focus message composer in "General Discussion"
   - Start typing: "I'm typing..." (don't send yet)
   - **Expected** (Bob's browser):
     * Within 1 second, "Alice is typing..." appears below message list
     * Indicator updates every 3 seconds while Alice continues typing

2. **Alice Stops Typing**
   - As Alice, wait 5 seconds without typing
   - **Expected** (Bob's browser):
     * "Alice is typing..." disappears after 5-second timeout

3. **Verify No Database Writes**
   - **Database Check**:
     ```sql
     SELECT COUNT(*) FROM chat.typing_indicator;
     -- Should return 0 (typing state not persisted)
     
     -- Or if table doesn't exist:
     \dt chat.typing_indicator
     -- Should show table does not exist (in-memory only)
     ```

### Success Criteria
- [x] Typing indicator appears for other members
- [x] Indicator auto-expires after inactivity
- [x] No database writes (ephemeral state)

---

## Scenario 9: Channel Archival

### Goal
Verify archived channels prevent new messages/notifications but preserve read access.

### Steps (As Alice, Admin)

1. **Archive Channel**
   - In "General Discussion", click "Archive Channel" from settings
   - Confirm archival
   - **Expected**:
     * Channel moves to "Archived" section in channel list
     * Lock icon with "Archived" badge

2. **Attempt to Send Message in Archived Channel**
   - As Bob, navigate to archived "General Discussion"
   - Try to type in message composer
   - **Expected**:
     * Message composer disabled with text: "This channel is archived"
     * Send button grayed out
   - **API Test**:
     ```javascript
     fetch('/api/chat/send-message', {
       method: 'POST',
       body: JSON.stringify({
         channel_id: '<archived-channel-id>',
         content: 'Should fail'
       })
     });
     ```
   - **Expected**: `400 Bad Request` error "Cannot send messages to archived channel"

3. **Verify Read Access Preserved**
   - As Bob, scroll through message history in archived channel
   - **Expected**: All previous messages visible

4. **Unarchive Channel (Admin Only)**
   - As Alice, click "Unarchive Channel"
   - **Expected**:
     * Channel moves back to active list
     * Message composer re-enabled
     * Bob can send messages again

### Success Criteria
- [x] Archived channels prevent new messages
- [x] Read access preserved for historical messages
- [x] Admin can unarchive channels
- [x] Unarchived channels restore full functionality

---

## Scenario 10: Large Channel Performance (1000+ Members)

### Goal
Verify notification delivery performance for channels with many members using `PublishBatchNotification` RPC.

### Setup (Admin Script)

```bash
# Seed database with large channel
cd backend
go run ./scripts/seed-large-channel.go \
  --org-id <test-org-id> \
  --channel-slug large-team \
  --member-count 1000
```

### Steps

1. **Send Message to Large Channel**
   - As Alice, in "Large Team" channel (1000 members), send: "All hands meeting in 10 minutes"
   - **Performance Monitoring**:
     * Check server logs for `PublishBatchNotification` RPC call duration
     * Monitor notification service logs for batched UNNEST insert timing
     * Expected: RPC call completes in <200ms (includes network + batch insert)

2. **Verify Batched Notification via RPC**
   - **Server Logs Check** (chat service):
     ```
     [INFO] Publishing notifications for message messageID=<id> to 1000 members
     [DEBUG] Calling NotificationService.PublishBatchNotification with 1000 notifications
     [INFO] Batch notification published duration=150ms
     ```
   - **Notification Service Logs Check**:
     ```
     [DEBUG] PublishBatchNotification: batching 1000 notifications
     [DEBUG] Executing UNNEST batch insert
     [INFO] Batch insert completed rows=1000 duration=85ms
     ```
   - **Database Check** (result of RPC):
     ```sql
     -- Count notifications created by notification service
     SELECT COUNT(*) FROM notification.notification
     WHERE source_domain = 'chat'
       AND action_data->>'channelId' = (SELECT id::text FROM chat.channel WHERE title_slug = 'large-team')
       AND updated_at > now() - interval '10 seconds';
     -- Should show ~1000 notifications (inserted by notification service)
     ```

3. **Verify Member Query Performance (Chat Service)**
   - **Database Explain Plan** (query used before RPC call):
     ```sql
     EXPLAIN ANALYZE
     SELECT employee_id FROM chat.channel_membership
     WHERE channel_id = (SELECT id FROM chat.channel WHERE title_slug = 'large-team')
       AND organization_id = '<org-id>'
       AND notification_preference != 'muted';
     -- Expected: Index scan on idx_membership_channel, <50ms
     ```
   - This query filters eligible recipients before calling notification service

### Success Criteria
- [x] Message sent to 1000+ member channel succeeds
- [x] `PublishBatchNotification` RPC call <200ms (chat service side)
- [x] Batched UNNEST insert <100ms (notification service side, check logs)
- [x] Member query with index <50ms (chat service filtering)
- [x] No timeout or blocking issues

---

## Cleanup

```bash
# Remove test channels (optional)
psql -h localhost -U postgres -d techoffice <<EOF
DELETE FROM chat.channel WHERE organization_id = '<test-org-id>';
DELETE FROM notification.notification WHERE source_domain = 'chat' AND organization_id = '<test-org-id>';
EOF
```

---

## Summary

These scenarios validate:
- ✅ Channel creation (public/private)
- ✅ Membership management (invite, join, leave, admin roles)
- ✅ Real-time messaging with notification hub integration
- ✅ Threaded replies (1-level enforcement)
- ✅ Emoji reactions (aggregation, toggle)
- ✅ Message editing/deletion (soft delete, reply preservation)
- ✅ Per-channel notification preferences
- ✅ Typing indicators (ephemeral state)
- ✅ Channel archival (read-only mode)
- ✅ Large channel performance (1000+ members)

**Next Steps**: Use these scenarios as basis for automated integration tests in `backend/internal/chat/chat_integration_test.go` and E2E tests with Playwright.
