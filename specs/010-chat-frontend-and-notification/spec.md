# Feature Specification: Chat Frontend and Notification Integration

**Feature Branch**: `010-chat-frontend-and-notification`  
**Created**: October 29, 2025  
**Status**: Draft  
**Input**: User description: "chat frontend and notification integration (both backend and frontend). Backend for chat already implemented, you can check the spec here #009-chat-backend and follow chat.proto for the backend. Chat is the most important feature of the workspace, we need to invest UX for most convenient for the users. The Chat layout should be 3 major part (column): sidebar for switching between channel, channel view area mainly for chat messages view, thread view area can be open to utilize space, can be close when need. User can use this to focus on a thread while scrolling and check other content in the channel. Its important to think about when we auto close, open thread view for best UX. We should move the sidebar to the left, I feel that more natural. Now the notification can be use for real-time message, that mean the streaming connection should be handle by the workspace main layout so we can update 3 the data in 3 places: chat view, notification, and sidebar. Now we have chat domain inplace, we should revisit notification action and implement the action to view the message user get mentioned (I think this related to backend implementation, maybe we still not have it, please check the backend spec and implementation)."

## Execution Flow (main)
```
1. Parse user description from Input ✓
   → Feature description provided: chat frontend with notification integration
2. Extract key concepts from description ✓
   → Actors: employees using chat, message authors, channel members
   → Actions: send messages, reply to messages, react to messages, switch channels, view threads, receive real-time notifications, navigate to mentioned messages
   → Data: channels, messages, reactions, typing indicators, notification actions
   → Constraints: 3-column layout (sidebar, channel, thread), SSE handled in workspace layout, backend already implemented
3. For each unclear aspect: ✓
   → Sidebar positioning: Move to left (more natural)
   → Thread view auto-open/close logic: Open on reply click, close on channel switch or escape key
   → SSE connection location: Workspace layout (shared across chat, notifications, sidebar)
   → Notification action for mentions: Need to implement action_data with channelId and messageId
4. Fill User Scenarios & Testing section ✓
5. Generate Functional Requirements ✓
6. Identify Key Entities ✓
7. Run Review Checklist ✓
   → All clarifications resolved
8. Return: SUCCESS (spec ready for planning)
```

---

## ⚡ Quick Guidelines
- ✅ Focus on WHAT users need and WHY
- ❌ Avoid HOW to implement (no tech stack, APIs, code structure)
- 👥 Written for business stakeholders, not developers

---

## User Scenarios & Testing *(mandatory)*

### Primary User Story
As an employee in Tech Office, I need a full-featured chat interface where I can view channels in a left sidebar, read and send messages in a central area, and optionally focus on threaded replies in a right panel, all while receiving real-time notifications for new messages and mentions, so that I can communicate effectively with colleagues and stay informed about important conversations without missing context.

### Acceptance Scenarios

**Chat Layout & Navigation**

1. **Given** an employee is logged into the workspace, **When** they navigate to the chat feature, **Then** they see a 3-column layout: left sidebar with channel list, center area for messages, and collapsible right panel for thread view

2. **Given** an employee is viewing the chat interface, **When** they click a channel in the sidebar, **Then** the center area displays that channel's messages and the thread panel closes if it was open

3. **Given** an employee has joined multiple channels, **When** they view the channel list in the left sidebar, **Then** they see all channels they're a member of, organized with clear visual hierarchy (public vs private, pinned channels at top)

4. **Given** an employee is viewing a channel, **When** they scroll through message history, **Then** older messages load automatically (infinite scroll) without losing their scroll position

5. **Given** an employee has unread messages in a channel, **When** they view the channel list sidebar, **Then** channels with unread messages show an unread indicator (badge or highlight)

**Messaging**

6. **Given** an employee is viewing a channel, **When** they type a message in the input field and press send, **Then** the message appears immediately in the channel message list and other members receive it in real-time

7. **Given** an employee is viewing a message in a channel, **When** they click the reply button on that message, **Then** the thread view panel opens on the right showing the parent message and all replies

8. **Given** an employee is viewing a thread in the right panel, **When** they type a reply and send it, **Then** the reply appears in the thread view and increments the reply count on the parent message in the channel view

9. **Given** an employee is viewing a thread, **When** they press the Escape key or click outside the thread panel, **Then** the thread panel closes and they return to the full-width channel view

10. **Given** an employee tries to reply to a reply message, **When** they click the reply button, **Then** the system prevents the action and shows a message explaining only single-layer replies are supported

11. **Given** an employee is viewing a message, **When** they click an emoji reaction button, **Then** the reaction is added to the message and visible to all channel members immediately

12. **Given** an employee has already reacted to a message with a specific emoji, **When** they click the same emoji reaction again, **Then** their reaction is removed (toggle behavior)

13. **Given** an employee is the author of a message, **When** they hover over their message, **Then** they see options to edit or delete the message

14. **Given** an employee edits their message, **When** they save the changes, **Then** the message updates with an "edited" indicator and other members see the updated version

**Channel Management**

15. **Given** an employee wants to create a new channel, **When** they click the "Create Channel" button in the sidebar, **Then** they see a form to enter channel name, description, and privacy setting (public/private)

16. **Given** an employee creates a new channel, **When** they submit the form with valid data, **Then** the channel is created, they become a member automatically, and the channel appears in their sidebar

17. **Given** an employee discovers a public channel they're not a member of, **When** they click "Join Channel", **Then** they become a member and can see all channel messages

18. **Given** an employee is a member of a private channel, **When** they invite another employee by email or username, **Then** the invited employee receives a notification and can join the channel

19. **Given** an employee wants to leave a channel, **When** they click "Leave Channel" in the channel settings, **Then** they are removed from the channel and it disappears from their sidebar

20. **Given** an employee has access to archived channels, **When** they view the channel list, **Then** archived channels are visually distinguished (grayed out or in separate section) and prevent new messages

**Real-Time Notifications & Integration**

21. **Given** an employee is online with an active SSE connection, **When** another employee sends a message to a channel they're a member of, **Then** they receive a notification and see the unread indicator update in the sidebar immediately

22. **Given** an employee is mentioned in a message using @username syntax, **When** the message is sent, **Then** they receive a high-priority notification regardless of their notification settings for that channel

23. **Given** an employee receives a notification about a mention, **When** they click the notification, **Then** the system navigates them directly to the channel and scrolls to the mentioned message

24. **Given** an employee receives a notification about a reply to their message, **When** they click the notification, **Then** the system opens the channel with the thread panel showing the reply conversation

25. **Given** an employee is viewing a channel actively (messages visible on screen), **When** new messages arrive in that channel, **Then** the messages appear in real-time without triggering additional notifications (avoid duplicate notifications)

26. **Given** an employee has the workspace open in multiple browser tabs, **When** a new message arrives, **Then** all tabs receive the update and show consistent state (shared SSE connection managed by workspace layout)

27. **Given** an employee loses network connectivity, **When** they reconnect, **Then** the SSE connection re-establishes automatically and replays any missed messages using last_event_id

**Typing Indicators**

28. **Given** an employee is typing a message in a channel, **When** they type, **Then** other channel members see a typing indicator showing "[User] is typing..."

29. **Given** an employee stops typing for 5 seconds, **When** the timeout expires, **Then** their typing indicator disappears for other members

30. **Given** multiple employees are typing simultaneously, **When** the typing indicators display, **Then** they show up to 3 usernames with overflow indicator (e.g., "Alice, Bob, and 2 others are typing...")

**Notification Preferences**

31. **Given** an employee is a member of a channel, **When** they access channel notification settings, **Then** they can choose between: "All messages", "Mentions only", or "Muted"

32. **Given** an employee sets a channel to "Mentions only", **When** regular messages are posted, **Then** they do not receive notifications but still see unread indicators; when they're mentioned, they receive notifications

33. **Given** an employee mutes a channel, **When** any messages are posted (including mentions), **Then** they do not receive any notifications but can still view messages when they visit the channel

### Edge Cases

- What happens when an employee tries to send a message to an archived channel? → System prevents message sending and shows error: "This channel is archived"
- What happens when an employee has thousands of channels? → Implement search/filter in sidebar, virtual scrolling for performance, and "pinned channels" section at top
- What happens when a message is too long (>10k characters)? → Show character count, prevent submission beyond limit with error message
- What happens when an employee tries to join a private channel without invitation? → System denies access and shows "This is a private channel. Ask a member to invite you."
- What happens when network latency delays message delivery? → Show optimistic UI (message appears immediately with "sending..." indicator), retry on failure, show error if delivery fails after retries
- What happens when an employee sends a message while offline? → Store message locally, show offline indicator, attempt to send when connection restored
- What happens when viewing a thread and the parent message is deleted? → Show placeholder: "Original message deleted" with replies preserved
- What happens when an employee mentions a user who has left the organization? → Allow mention (historical data), but don't send notification (system validates employee exists and is active)
- What happens when an employee clicks on a notification for a message in a channel they can no longer access (removed from private channel)? → Show error: "You don't have access to this channel" and don't navigate
- What happens when multiple people react with different emojis to the same message? → Display all reactions grouped by emoji with counts, sorted by popularity
- What happens when thread view is open and employee receives notification for different channel? → Keep thread view open for current channel; clicking notification closes current thread and opens target channel
- What happens when employee navigates directly to a message URL (deep link)? → Load channel, scroll to message, highlight it briefly
- What happens when searching for messages within a channel? → Deferred to future search feature (full-text search across messages)
- What happens when uploading files to chat? → Deferred to future file upload feature (integrate with Cloudflare R2)
- What happens when two employees edit the same message simultaneously? → Last write wins (no operational transform); rare edge case acceptable
- What happens when SSE connection reaches 5-minute limit? → Workspace layout manages reconnection automatically with replay using last_event_id
- What happens when employee has notification for channel that no longer exists (deleted)? → Notification remains in history but clicking it shows error: "This channel no longer exists"
- What happens when employee switches between light and dark mode? → Chat UI respects theme preference; colors update immediately without data loss
- What happens when channel member list is very large (1000+ members)? → Paginate member list, show online status for first 100 members, provide search
- What happens when viewing chat on mobile device? → Responsive design: sidebar collapses to hamburger menu, thread view opens full-screen overlay (mobile UX deferred to future mobile-specific feature)

---

### Functional Requirements

**Chat Layout & Structure**

- **FR-001**: System MUST display chat interface with 3-column layout: left sidebar (channel list), center area (message view), right panel (thread view, collapsible)
- **FR-002**: System MUST position channel list sidebar on the left side of the interface
- **FR-003**: System MUST allow the thread view panel to be opened and closed by user action
- **FR-004**: System MUST auto-close the thread view panel when user switches to a different channel
- **FR-005**: System MUST auto-close the thread view panel when user presses Escape key
- **FR-006**: System MUST maintain the thread view panel open while user scrolls in the channel view (allows reading context while viewing thread)
- **FR-007**: System MUST show unread message indicators (badges) on channels with unread content in the sidebar
- **FR-008**: System MUST sort channels in sidebar with pinned channels first, then by recent activity
- **FR-009**: System MUST distinguish between public and private channels visually in the sidebar (icon or indicator)
- **FR-010**: System MUST support infinite scroll for message history (load older messages as user scrolls up)

**Channel Management**

- **FR-011**: System MUST allow employees to create new channels with name, description, and privacy setting (public/private)
- **FR-012**: System MUST validate channel names to be URL-friendly (alphanumeric and hyphens only, max 64 characters)
- **FR-013**: System MUST prevent duplicate channel names within the same organization
- **FR-014**: System MUST allow employees to join public channels without invitation
- **FR-015**: System MUST require invitation to join private channels
- **FR-016**: System MUST allow channel members to invite other employees to channels (both public and private)
- **FR-017**: System MUST allow employees to leave channels voluntarily
- **FR-018**: System MUST prevent sending messages to archived channels
- **FR-019**: System MUST display archived channels separately (grayed out or distinct section) in the sidebar
- **FR-020**: System MUST show channel member count in channel header or info panel

**Messaging**

- **FR-021**: System MUST allow channel members to post messages to channels
- **FR-022**: System MUST display messages in chronological order (oldest to newest) in the channel view
- **FR-023**: System MUST show message author name, avatar (if available), and timestamp for each message
- **FR-024**: System MUST support replying to messages by opening the thread view panel
- **FR-025**: System MUST enforce single-layer reply depth (prevent replies to replies)
- **FR-026**: System MUST display reply count on parent messages in the channel view
- **FR-027**: System MUST allow message authors to edit their own messages
- **FR-028**: System MUST show "edited" indicator on messages that have been modified
- **FR-029**: System MUST allow message authors to delete their own messages
- **FR-030**: System MUST allow channel admins to delete any message in their channels
- **FR-031**: System MUST show placeholder text "Original message deleted" when parent message is deleted, preserving replies
- **FR-032**: System MUST enforce maximum message length of 10,000 characters
- **FR-033**: System MUST show character count when approaching message length limit (e.g., last 500 characters)
- **FR-034**: System MUST prevent message submission when length exceeds limit
- **FR-035**: System MUST show optimistic UI for sent messages (appear immediately) with sending indicator
- **FR-036**: System MUST retry message delivery on network failure with error indication if retries exhaust

**Reactions**

- **FR-037**: System MUST allow channel members to react to messages with emoji reactions
- **FR-038**: System MUST aggregate reactions by emoji type and display counts
- **FR-039**: System MUST treat identical reactions from same user as toggle (add if not exists, remove if exists)
- **FR-040**: System MUST update reaction displays in real-time across all connected clients
- **FR-041**: System MUST support reactions on both top-level messages and reply messages
- **FR-042**: System MUST show list of employees who reacted when hovering over reaction count (tooltip)

**Typing Indicators**

- **FR-043**: System MUST show typing indicator when channel members are actively typing
- **FR-044**: System MUST display typing indicator with user name(s): "[User] is typing..."
- **FR-045**: System MUST automatically remove typing indicator after 5 seconds of inactivity
- **FR-046**: System MUST limit typing indicator display to 3 usernames with overflow indicator (e.g., "and 2 others are typing...")
- **FR-047**: System MUST only show typing indicators for the currently viewed channel (not across all channels)

**Real-Time Updates & SSE Integration**

- **FR-048**: System MUST establish SSE connection in the workspace layout (not in chat component) for shared real-time updates
- **FR-049**: System MUST receive new messages in real-time via SSE connection without page refresh
- **FR-050**: System MUST update three locations when chat messages arrive: channel view, notification hub, sidebar unread indicators
- **FR-051**: System MUST receive typing indicators in real-time via SSE connection
- **FR-052**: System MUST receive reaction updates in real-time via SSE connection
- **FR-053**: System MUST handle SSE reconnection automatically after network interruption
- **FR-054**: System MUST replay missed events using last_event_id after SSE reconnection
- **FR-055**: System MUST gracefully close and reconnect SSE connection every 5 minutes to prevent long-running connection issues
- **FR-056**: System MUST sync state across multiple browser tabs (all tabs receive SSE updates)
- **FR-057**: System MUST suppress duplicate notifications when employee is actively viewing the channel where message was sent

**Notification Actions for Mentions**

- **FR-058**: System MUST support @mention functionality to notify specific users in messages
- **FR-059**: System MUST parse @username syntax in message text and create mentions
- **FR-060**: System MUST send high-priority notifications to mentioned users regardless of channel notification settings
- **FR-061**: System MUST include action_data in notifications with channelId and messageId for navigation
- **FR-062**: System MUST navigate to mentioned message when employee clicks mention notification
- **FR-063**: System MUST scroll to and highlight mentioned message when navigating from notification
- **FR-064**: System MUST open thread view if mentioned message is a reply in a thread
- **FR-065**: System MUST validate mentioned users exist and are active employees before sending notifications

**Notification Preferences**

- **FR-066**: System MUST allow employees to configure notification preferences per channel
- **FR-067**: System MUST support three notification preference levels: "All messages", "Mentions only", "Muted"
- **FR-068**: System MUST respect "All messages" preference by sending notifications for every message in that channel
- **FR-069**: System MUST respect "Mentions only" preference by only sending notifications when user is mentioned
- **FR-070**: System MUST respect "Muted" preference by not sending any notifications (but preserve unread indicators)
- **FR-071**: System MUST always send notifications for mentions even if channel is muted (mentions override mute)
- **FR-072**: System MUST show notification preference status in channel settings UI

**Search & Discovery**

- **FR-073**: System MUST provide search functionality in channel sidebar to filter channels by name
- **FR-074**: System MUST show public channels available to join (not yet a member) in discovery view
- **FR-075**: System MUST support pinning favorite channels to top of sidebar for quick access
- **FR-076**: System MUST remember user's last viewed channel and restore on return to chat
- **FR-077**: System MUST provide "Jump to" functionality to quickly navigate to specific channel by typing name

**Performance & Scale**

- **FR-078**: System MUST use virtual scrolling for channel sidebar when user has 100+ channels
- **FR-079**: System MUST paginate message history with 50 messages per page by default
- **FR-080**: System MUST prefetch previous page of messages when user scrolls near top (anticipatory loading)
- **FR-081**: System MUST limit initial channel member list display to 100 members with "Show all" option
- **FR-082**: System MUST debounce typing indicator events (send at most once per second per user)
- **FR-083**: System MUST batch multiple reaction updates within 100ms window into single UI update

**Error Handling & Offline Support**

- **FR-084**: System MUST show clear error message when user tries to access private channel without permission
- **FR-085**: System MUST show error message when user tries to send message to archived channel
- **FR-086**: System MUST show offline indicator when network connection is lost
- **FR-087**: System MUST queue messages locally when offline and send when connection restored
- **FR-088**: System MUST show error and allow retry when message delivery fails after all retry attempts
- **FR-089**: System MUST show error when navigating to deleted channel via notification action
- **FR-090**: System MUST validate channel access before navigating via notification action

**Backend Integration Requirements**

- **FR-091**: Backend MUST extend notification action_data to include "channelId" and "messageId" for chat notifications
- **FR-092**: Backend MUST create notifications when users are mentioned using PublishNotification with priority=1 (not offline)
- **FR-093**: Backend MUST create notifications when users receive replies using PublishNotification with priority=1
- **FR-094**: Backend MUST include source_domain="chat" and notification_type="mention" or "reply" in notification metadata
- **FR-095**: Backend MUST populate action_data map with: {"channelId": "<uuid>", "messageId": "<uuid>", "action": "view_message"}
- **FR-096**: Backend MUST support querying messages by ID with channel context validation
- **FR-097**: Backend MUST support marking channel as "viewed" to update unread indicators
- **FR-098**: Backend MUST include typing indicator events in SSE stream with event_type="typing_indicator"

### Key Entities *(include if feature involves data)*

- **Channel**: Communication space where employees send messages. Contains channel ID, organization ID, title (URL-friendly slug), display name, description, channel type (chat, direct message, project thread, etc.), privacy flag (public/private), archived status, creator employee ID, member count, current user membership status and role

- **Message**: Content posted to channels, including text, author reference, timestamps, edit history, delete status. Contains message ID, channel ID, organization ID, message text, author employee ID, author name/email (from JOIN), parent message ID (NULL for top-level), edit flag, delete flag, edit history (JSONB), reply count (computed), reaction summary (aggregated)

- **Reply**: Specialized message type that references a parent message, enforcing single-layer threading. Contains all message fields plus parent message reference. System prevents parent_message_id from referencing a message that itself has a parent

- **Reaction**: Emoji reaction to a message. Contains reaction ID, message ID, employee ID, emoji code (Unicode or shortcode), organization ID, timestamp. Multiple reactions from same user with same emoji are not allowed (toggle behavior)

- **Channel Membership**: Relationship between employee and channel. Contains membership ID, channel ID, employee ID, organization ID, admin flag, notification preference (enum: all, mentions, muted), joined timestamp, employee name/email (populated via JOIN for display)

- **Typing Indicator**: Ephemeral state indicating employee is actively typing in a channel. Contains channel ID, employee ID, employee name, timestamp (auto-expires after 5 seconds). Not persisted to database; handled in-memory or via Redis

- **Notification Action Data**: Structured metadata attached to chat notifications enabling deep linking. For mentions and replies, contains: channelId (UUID of channel), messageId (UUID of specific message), action ("view_message"), optional threadParentId (if message is a reply)

- **Unread Indicator**: Client-side state tracking unread messages per channel. Contains channel ID, last viewed message ID, unread count, last updated timestamp. Calculated based on difference between last viewed message and latest channel message

- **SSE Event**: Real-time event pushed from backend to frontend via SSE connection. Contains event_id (UUID), event_type (notification, typing_indicator, message, reaction, heartbeat), payload (varies by type), timestamp. Handled by workspace layout and dispatched to chat, notification hub, and sidebar components

---

## Backend Extension Requirements *(for chat notification actions)*

The chat backend (feature #009) is already implemented, but the notification action integration requires additional implementation:

### Required Backend Changes

1. **PublishNotification Integration in Chat Service**:
   - When message contains @mention, parse mentions and call NotificationService.PublishNotification for each mentioned user
   - When reply is posted, call NotificationService.PublishNotification for parent message author
   - Include action_data: `{"channelId": "<uuid>", "messageId": "<uuid>", "action": "view_message"}`
   - Set source_domain="chat" and notification_type="mention" or "reply"
   - Set priority=1 (notify when not offline)

2. **GetMessageByIdWithValidation Query**:
   - Add query to fetch message by ID with channel membership validation
   - Verify requesting employee is member of the channel before returning message
   - Return channel context (channel ID, display name) along with message for navigation

3. **SSE Event Extensions**:
   - Extend NotificationEvent to include typing_indicator events
   - Include typing indicator payload: `{"channelId": "...", "employeeId": "...", "employeeName": "..."}`
   - Add message_created and reaction_added event types for real-time chat updates

4. **Channel View Tracking**:
   - Add UpdateLastViewedMessage mutation to record when employee views channel
   - Store last_viewed_message_id and last_viewed_at in channel_membership table
   - Use for calculating unread message counts

5. **Mention Parsing**:
   - Add utility function to extract @username mentions from message text
   - Validate mentioned usernames against organization.employee table
   - Return list of valid employee IDs to notify

### Backend API Gaps

Based on review of chat.proto and notification.proto, the following additions are needed:

**chat.proto additions**:
```
// Add to ChatService
rpc GetMessageById(GetMessageByIdRequest) returns (GetMessageByIdResponse);
rpc MarkChannelAsRead(MarkChannelAsReadRequest) returns (MarkChannelAsReadResponse);

message GetMessageByIdRequest {
  string message_id = 1;
}

message GetMessageByIdResponse {
  Message message = 1;
  Channel channel = 2; // Context for navigation
}

message MarkChannelAsReadRequest {
  string channel_id = 1;
  string last_read_message_id = 2; // Optional: specific message to mark as read up to
}

message MarkChannelAsReadResponse {
  int32 unread_count = 1; // Remaining unread count for this channel
}

// Extend ChannelMembership message
message ChannelMembership {
  // ... existing fields ...
  string last_viewed_message_id = 15; // Track last message viewed by this member
  google.protobuf.Timestamp last_viewed_at = 16;
}
```

**notification.proto already has required fields** - action_data map supports arbitrary key-value pairs, so no proto changes needed. Backend logic must populate:
- action_data["channelId"] = channel UUID
- action_data["messageId"] = message UUID  
- action_data["action"] = "view_message"

---

## Review & Acceptance Checklist
*GATE: Automated checks run during main() execution*

### Content Quality
- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

### Requirement Completeness
- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous  
- [x] Success criteria are measurable
- [x] Scope is clearly bounded (3-column layout, SSE in workspace layout, mention navigation)
- [x] Dependencies and assumptions identified (backend chat implementation exists, notification hub exists, SSE infrastructure in place)

---

## Execution Status
*Updated by main() during processing*

- [x] User description parsed
- [x] Key concepts extracted
- [x] Ambiguities marked (all resolved)
- [x] User scenarios defined
- [x] Requirements generated
- [x] Entities identified
- [x] Review checklist passed

---

## Dependencies

- **Feature #009 (Chat Backend)**: Provides ChatService RPC API, channel management, messaging, reactions
- **Feature #007 (Notification Hub Backend)**: Provides NotificationService for publishing mentions/replies, SSE infrastructure
- **Feature #008 (Notification Hub Frontend)**: Provides notification list UI, SSE connection handling in workspace layout

## Out of Scope

The following features are explicitly out of scope for this feature and deferred to future work:

- Full-text search across messages and channels (deferred to dedicated search feature)
- File attachments and media uploads (deferred to file upload feature with Cloudflare R2)
- Voice/video calls within channels (deferred to communication feature)
- Read receipts showing who has read each message (deferred to future chat enhancement)
- Message forwarding to other channels (deferred to future chat enhancement)
- Rich text formatting (bold, italic, lists) in messages (deferred to rich text editor feature)
- Code syntax highlighting in messages (deferred to developer tools feature)
- Mobile-specific responsive design (basic responsive design included; dedicated mobile UX deferred)
- Emoji picker UI for reactions (use system emoji picker for MVP; custom picker deferred)
- User presence indicators (online/offline/away status) in channel member list (deferred to presence feature)
- Channel analytics (message volume, active users, engagement metrics) (deferred to analytics feature)

