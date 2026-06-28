# Feature Specification: Mobile Chat & Notification Parity

**Feature Branch**: `027-mobile-chat-notifications`  
**Created**: 2026-03-22  
**Status**: Draft  
**Input**: Port realtime SSE, online status presence tracking, unified smart search (channel/DM/create), chat sidebar with recents grouped by time, and message list with proper scroll UX (new messages pill, prepend without flicker, deep-link highlight) to the mobile app.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Real-Time Messages Arrive Without Refresh (Priority: P1)

A field worker receives a direct message from their manager while the app is open. Without any manual action, the new message appears at the bottom of the conversation and the list auto-scrolls to show it. If the worker is reading older history (scrolled up), a "↓ New messages" pill appears instead of forcibly jumping the viewport.

**Why this priority**: Chat is the primary communication channel. Users need confidence that messages arrive live; a "pull to refresh" mental model breaks trust for time-sensitive communication.

**Independent Test**: Open any DM or channel. From another device/browser send a message. Verify the message appears without manual refresh. Then scroll up in the list, send another message, and verify the pill indicator appears without disrupting the reading position.

**Acceptance Scenarios**:

1. **Given** the user is at the bottom of a channel conversation, **When** a new message is sent by another member, **Then** the message appears and the view scrolls smoothly to it within 2 seconds.
2. **Given** the user is scrolled up reading history, **When** a new message arrives, **Then** the viewport stays anchored and a "↓ New messages" pill appears at the bottom of the screen.
3. **Given** the "↓ New messages" pill is visible, **When** the user taps it, **Then** the list smooth-scrolls to the latest message and the pill disappears.
4. **Given** the user scrolls back to the bottom manually, **When** they reach the bottom threshold, **Then** the pill disappears automatically.
5. **Given** the app is in the foreground, **When** the SSE connection drops, **Then** connection is re-established automatically (exponential backoff, max 30s delay).

---

### User Story 2 — Load Older Messages by Scrolling Up (Priority: P1)

A user scrolls to the top of a conversation to read history from earlier today. The app silently fetches and prepends older messages without causing the viewport to jump or the current reading position to change.

**Why this priority**: Infinite scroll with flicker-free prepend is a baseline expectation for any professional chat app and directly affects readability.

**Independent Test**: Open a channel with more than one page of history. Scroll near the top. Verify older messages load and the current scroll position is preserved (no jump).

**Acceptance Scenarios**:

1. **Given** the user is near the top of the message list with more history available, **When** the top threshold is reached, **Then** older messages are fetched and prepended without any visible scroll jump.
2. **Given** older messages are being fetched, **When** the request is in flight, **Then** a loading indicator appears at the top of the list.
3. **Given** all available history is loaded, **When** the user scrolls to the top, **Then** no further fetch is triggered and no loading indicator appears.

---

### User Story 3 — Chat Sidebar: Recents Grouped by Time (Priority: P1)

The chat tab shows recent conversations grouped into meaningful time buckets (e.g., "Today", "This Week", "Earlier"). Within each group, conversations are ordered by most recent activity. Each group shows up to 5 entries covering the last activity across task discussions, direct messages, and general channels.

**Why this priority**: The chat landing screen is the entry point for all conversations. Grouping by recency helps users instantly find ongoing or new conversations without scrolling through a flat undifferentiated list.

**Independent Test**: Use a test account with channels involving different last-message times. Open the chat tab. Verify conversations are grouped under correct time headings and sorted by latest activity within each group.

**Acceptance Scenarios**:

1. **Given** the user opens the Chat tab, **When** the screen loads, **Then** conversations are displayed in collapsible time groups (Today, This Week, Earlier) sorted by most recent activity.
2. **Given** multiple conversation types (DM, general channel, task discussion), **When** they have recent activity, **Then** they appear in the same time-based groups interleaved by last-activity time.
3. **Given** a channel receives a new message via SSE, **When** the sidebar updates, **Then** that channel moves to the top of its time group without requiring a manual refresh.
4. **Given** the user is viewing an empty time group after all conversations move to a newer bucket, **When** the list renders, **Then** empty groups are hidden (not shown as empty sections).

---

### User Story 4 — Smart Channel/DM Search and Create (Priority: P2)

The user taps a search or compose button in the chat tab. They type any text. The app first filters visible channels by name, then queries the server for matches, and finally suggests employees (to start a DM) if no channel matches. Selecting an employee starts or resumes a DM. Selecting a channel opens it.

**Why this priority**: Without quick navigation between conversations, users resort to scrolling through the full list, which degrades usability as organizations grow.

**Independent Test**: Open the smart search. Type a partial channel name → verify local filter results appear instantly. Type an employee name with no matching channel → verify employee suggestions appear. Tap an employee → verify a DM is created or resumed.

**Acceptance Scenarios**:

1. **Given** the smart search is open and a query is entered, **When** local channels match the query, **Then** matching channels appear instantly (no network request needed).
2. **Given** local channels match fewer than a threshold count for the query, **When** the debounce delay elapses, **Then** an API channel search runs and appends server-side results below local results.
3. **Given** no channels match and the query looks like a person's name, **When** the API search completes, **Then** a section of employee suggestions appears, allowing the user to start a DM.
4. **Given** the user selects a channel from results, **When** they tap it, **Then** they navigate directly to that channel's message list.
5. **Given** the user selects an employee from results, **When** they tap it, **Then** a DM channel is created or retrieved and navigation goes to the message list.
6. **Given** the user clears the search query or taps a cancel/close control, **When** the action completes, **Then** the search view dismisses and the sidebar returns to normal.

---

### User Story 5 — Online Status Shown on DM Avatars (Priority: P2)

When the user views a DM conversation or the channel list, they can see a colored presence indicator on the other person's avatar (green = online, amber = away, grey = offline). Status updates reflectively when an SSE presence event arrives.

**Why this priority**: Presence visibility informs message timing (whether to expect an instant reply), reducing follow-up messages and improving communication efficiency.

**Independent Test**: Open the chat list with an active DM. Observe the presence dot on the contact's avatar. Have the contact change their status (e.g., go offline). Verify the dot updates without refreshing.

**Acceptance Scenarios**:

1. **Given** a DM conversation partner is online, **When** the DM channel row or conversation header renders, **Then** a green presence dot overlays their avatar.
2. **Given** a presence SSE event is received indicating a status change, **When** the list re-renders, **Then** the dot color updates to match the new status (green/amber/grey).
3. **Given** the user's own screen transitions from foreground to background, **When** the system detects this change, **Then** the app sends an "away" or "offline" status update to the server.
4. **Given** the user returns the app to the foreground, **When** the app resumes, **Then** an "online" status update is sent to the server.

---

### User Story 6 — Navigate Between Channel List and Message Thread (Priority: P2)

On mobile, the user can fluidly move between the channel list (sidebar) and an open conversation. Opening a channel pushes the message view onto the navigation stack. Pressing the back button returns to the recents list. The navigation state is preserved: the user's scroll position in the channel list is not lost.

**Why this priority**: On a single-pane mobile layout, the transition between list and detail is the core navigation interaction. Losing position causes disorientation.

**Independent Test**: Open the chat tab. Open a channel. Press back. Verify the channel list is at the same position. Open the channel again. Verify the message list starts where expected (latest messages visible).

**Acceptance Scenarios**:

1. **Given** the user is on the channel list, **When** they tap a channel, **Then** the message view slides into view (standard native push transition).
2. **Given** the user is in a message view, **When** they press the hardware or in-app back button, **Then** they return to the channel list at the same scroll position.
3. **Given** the user opens a message view, **When** the screen renders, **Then** the list starts at the latest message (bottom of list visible immediately).
4. **Given** the user switches between channels rapidly, **When** each channel opens, **Then** scroll state, unread indicators, and loading state reset correctly for the new channel.

---

### User Story 7 — Deep-Link Highlight to Specific Message (Priority: P3)

A notification tapped from the notification hub opens the relevant channel and smoothly scrolls to the specific message, which is briefly highlighted so the user can identify it in context.

**Why this priority**: Without this, deep-link navigation from notifications is not actionable — users can't find which message triggered the notification.

**Independent Test**: Receive a chat notification. Tap it from the notification hub. Verify the correct channel opens, the list scrolls to center the referenced message, and the message appears highlighted for about 3 seconds before the highlight fades.

**Acceptance Scenarios**:

1. **Given** a notification deep-link targets a specific message ID, **When** the user taps the notification, **Then** the channel opens and scroll jumps to that message.
2. **Given** the channel opens with a targeted message, **When** the list is ready, **Then** the message appears visually highlighted (distinct background) for 3 seconds, then the highlight clears automatically.
3. **Given** the targeted message is not in the current page of history, **When** it is loaded, **Then** the one-time scroll fires only after the message is present in the list.

---

### Edge Cases

- What happens when the SSE connection is lost mid-conversation? → Connection must auto-reconnect with exponential backoff; the message list must remain usable (stale data visible, polling or re-connect restores live state).
- What happens when a user scrolls to the very top and no more pages exist? → The "load more" request is not triggered; no spinner is shown.
- What happens when the user rapidly switches channels before the previous channel's data has loaded? → All in-flight requests are cancelled or ignored; only the newly selected channel's data is shown and scroll state is fresh.
- What happens when a DM partner changes their presence status rapidly? → Each SSE event updates the indicator; no batching delay exceeds 5 seconds.
- What happens when the smart search returns no results for a query? → A clear empty state message is shown; tapping outside the search dismisses it.
- What happens when the user tries to create a DM with themselves? → The create-DM action is not offered for the current user's own employee entry.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The app MUST maintain a persistent SSE connection for the authenticated session and receive real-time events for new messages, reactions, presence changes, and notifications.
- **FR-002**: The message list MUST start at the latest message whenever a channel is opened or switched, with no visible delay.
- **FR-003**: The message list MUST auto-scroll to new messages when the user is at the bottom of the list, using a smooth animation.
- **FR-004**: When the user is scrolled up, the message list MUST show a "↓ New messages" pill when new messages arrive, and tapping it MUST smooth-scroll to the latest message.
- **FR-005**: The message list MUST support infinite scroll upward: reaching the top threshold MUST trigger a fetch of older messages that prepends to the list without any viewport jump.
- **FR-006**: When the user's channel context changes (opens a new channel), all transient scroll and indicator state MUST reset for the new channel.
- **FR-007**: The chat sidebar MUST display conversations grouped into time buckets (Today, This Week, Earlier), ordered by most recent activity within each group.
- **FR-008**: The chat sidebar MUST update live when a new message arrives via SSE, moving the relevant channel to the top of its time group.
- **FR-009**: The app MUST provide a unified search that first filters visible channels locally, then queries server-side channel search, then falls back to employee search for DM creation.
- **FR-010**: Employee presence dots MUST be shown on DM conversation avatars, reflecting the current online/away/offline status from the backend.
- **FR-011**: The app MUST send presence status updates to the server when the app moves between foreground and background.
- **FR-012**: Deep-link navigation from notification taps MUST open the target channel and scroll to the specific message, which MUST be highlighted for 3 seconds.
- **FR-013**: The SSE connection MUST automatically re-establish after network interruption using exponential backoff with a maximum delay of 30 seconds.
- **FR-014**: The chat search MUST be accessible via a single tap (icon or button) from the main chat tab without navigating away from the sidebar.

### Key Entities

- **Channel**: A conversation container (DM, general, or task-linked). Has a type, display name, participants, and most-recent-message timestamp used for sidebar sorting.
- **Message**: A single message within a channel. Has ID, author, text, timestamp, reactions, reply count, and file attachments. The message ID is used as the deep-link and highlight anchor.
- **Presence Status**: A real-time indicator per employee: online, away, busy, or offline. Delivered via SSE presence events and stored client-side for rendering.
- **SSE Event**: A server-pushed event carrying payload for chat messages, reactions, presence changes, notifications, or typing indicators.
- **Sidebar Group**: A time-bucketed section in the chat list: "Today", "This Week", "Earlier". Each group contains channels sorted by latest activity.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: New messages appear in an open conversation within 2 seconds of being sent, without any manual user action.
- **SC-002**: Scrolling up to load older messages prepends history with zero visible scroll jump (the user's reading position remains on the same message).
- **SC-003**: The "↓ New messages" pill appears within 1 second of a new message arriving while the user is scrolled up.
- **SC-004**: Opening the smart search and typing a query produces visible local filter results instantaneously (no perceptible delay).
- **SC-005**: The sidebar correctly groups 100% of visible conversations into time buckets on initial load and after live updates.
- **SC-006**: Presence dots for direct message contacts update within 5 seconds of a status change event being received.
- **SC-007**: Deep-link navigation from a notification opens the correct channel and scrolls to the target message in under 3 seconds on a standard device on a cellular connection.
- **SC-008**: After a network interruption, the SSE connection re-establishes automatically without any user interaction and resumes live updates.

## Assumptions

- The backend already supports all required SSE event types (`chat_message`, `presence`, `notification`, `chat_reaction`) — no new backend protocol changes are needed.
- The `searchChannels` and `searchEmployees` APIs used by the web app are equally available to mobile clients.
- Presence status tracking on mobile uses `AppState` (foreground/background transitions) as the equivalent of the web's page-visibility API — no additional platform API is needed.
- The `listRecentChannels` API returns enough metadata (last-message timestamp, channel type) to perform client-side time grouping without a dedicated "grouped recents" endpoint.
- Grouping thresholds are: "Today" = same calendar day, "This Week" = same ISO week, "Earlier" = everything older.
- The mobile navigation stack (Expo Router) already supports the push/pop channel navigation pattern; only the UI and data layers need updating.
- The `firstItemIndex` prepend strategy used in the web's Virtuoso component maps to React Native's `FlatList`/`FlashList` `maintainVisibleContentPosition` prop or an equivalent library scroll preservation technique.
