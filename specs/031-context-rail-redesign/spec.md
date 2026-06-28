# Feature Specification: Workspace Context Rail Redesign

**Feature Branch**: `031-context-rail-redesign`  
**Created**: 2026-04-27  
**Status**: Draft

## Background

The web workspace currently has a "Quick Info" panel that lives in the shared layout's left sidebar slot. It is rendered on all pages except chat (where the channel list takes that slot), but its content is entirely mock data. It contains a user card, "Next Up" (no upcoming events), "My Active Tasks" (no active tasks), "Recent Activity" (no recent activity), and a 2×2 grid of zero-counters.

The core problem is a mismatch between three concerns:
- **Placement**: the left side is structural navigation territory; the right side is contextual/supplementary territory
- **Visibility**: chat page has no version of this panel at all
- **Content model**: every page shows the same generic blocks regardless of what the user is doing

This feature fixes all three.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Context rail is available and consistent on every workspace page (Priority: P1)

An employee opens the workspace and navigates between Tasks, Calendar, Chat, and Organization. On every page they should be able to access a contextual side panel without hunting for it or experiencing it disappear.

**Why this priority**: This is the foundational contract. If the panel does not appear consistently, all subsequent improvements have no surface to live on.

**Independent Test**: Open each top-level workspace route. Confirm the rail toggle affordance and the rail itself appear on every route, including chat, without breaking existing page layouts.

**Acceptance Scenarios**:

1. **Given** the user is on any workspace page (tasks, calendar, chat, organization, docs), **When** the page loads, **Then** a context rail toggle is visible in a consistent location
2. **Given** the context rail is open on the Tasks page, **When** the user navigates to Calendar, **Then** the rail remains open (state is preserved across navigation within the same session)
3. **Given** the user is on the Chat page, **When** the page loads, **Then** the channel list (ChannelSidebar) still occupies the left side and the context rail toggle is still available on the right side independently
4. **Given** the context rail is open, **When** the user closes it with the dismiss control, **Then** it collapses and the main content expands to fill the space

---

### User Story 2 — Global context blocks show real user data (Priority: P2)

Every page shares a common set of blocks that are relevant regardless of which page the user is on: who they are, what is next on their calendar, what tasks are assigned to them today, and an unread-message count. These blocks should show live data, not static zeros.

**Why this priority**: Showing "0 active tasks" and "no upcoming events" permanently destroys user trust in the panel. Global blocks must be real before page-specific blocks are worth adding.

**Independent Test**: With real calendar events, assigned tasks, and unread messages in the system, open any workspace page with the context rail visible. Confirm each global block reflects the actual data for the logged-in user.

**Acceptance Scenarios**:

1. **Given** the user has a calendar event starting within the next 2 hours *(test-seeding condition — the block always shows the single nearest upcoming event regardless of how far ahead it is)*, **When** they view the context rail, **Then** the "Next Up" block shows that event title, start time, and a count of any additional events remaining that day ("+ N more today")
2. **Given** the user has tasks assigned to them with a due date of today, **When** they view the context rail, **Then** the "My Work Today" block lists those tasks
3. **Given** the user has unread messages in one or more channels, **When** they view the context rail, **Then** the unread count displayed is accurate and updates when messages are read
4. **Given** none of the above data exists, **When** the user views the context rail, **Then** each block shows a meaningful empty state ("Nothing scheduled today", not "No upcoming events")

---

### User Story 3 — Calendar page shows day-specific context, not generic info (Priority: P3)

When a user is on the Calendar page, the context rail shows information that complements the calendar view rather than duplicating it. Specifically it should surface the selected day's event summary, resource/room availability relevant to that day, and quick RSVP actions for pending invites.

**Why this priority**: The calendar page is the clearest case where generic Quick Info is actively harmful — it wastes space repeating what the main view already shows. Fixing this establishes the page-specific content model pattern for all other pages.

**Independent Test**: On the Calendar page, click a day that has events and pending invites. Confirm the rail content changes to reflect that day, and that RSVP action buttons in the rail work end-to-end.

**Acceptance Scenarios**:

1. **Given** the user is on the Calendar page, **When** they select a day, **Then** the context rail's page-specific section updates to show events for that day including any room or resource summaries associated with each event
2. **Given** the user has a pending invite for an event, **When** they view the event in the context rail, **Then** Accept/Decline buttons are present and functional
3. **Given** the user is on the Calendar page with no day selected, **When** they open the rail, **Then** it defaults to showing today's summary, not the generic user/tasks/messages blocks
4. **Given** the user navigates away from Calendar to Tasks, **When** they return to Calendar, **Then** the rail reverts to calendar-specific content

---

### User Story 4 — Chat page context rail shows channel-specific details (Priority: P4)

When a user is in an active chat channel, the right-side context rail shows channel members, pinned messages, and shared files for that channel rather than generic workspace info.

**Why this priority**: Chat currently has no version of this panel at all. Adding channel context on the right completes the consistent-across-all-pages goal while giving chat a genuinely useful surface.

**Independent Test**: Open a chat channel with at least two members and a pinned message. Confirm the context rail shows member list and the pinned message. Confirm it is distinct from the channel navigation sidebar on the left.

**Acceptance Scenarios**:

1. **Given** the user is in a chat channel, **When** the context rail is open, **Then** it shows the channel name, member count, and member avatars
2. **Given** the channel has pinned messages, **When** the context rail is open, **Then** pinned messages are listed with a link to jump to them
3. **Given** the user switches to a different channel, **When** the switch completes, **Then** the context rail content updates to the new channel's details without a full page reload
4. **Given** the user is in a direct message conversation, **When** the context rail is open, **Then** it shows the other person's profile and presence status

---

### Edge Cases

- What happens when the user's screen is too narrow to show both main content and the context rail? The rail must collapse automatically and be togglable rather than crushing the main content.
- What happens if the data API for a global block fails? Each block must degrade independently — a failed "Next Up" block must not affect the "My Work Today" block.
- What happens when the user rapidly navigates between pages? Page-specific block content must not flash stale data from the previous page.
- What happens on pages that do not yet have page-specific content defined? The rail shows only global blocks without empty section placeholders.
- What happens on the chat page at narrow widths when both the ChannelSidebar and context rail cannot fit simultaneously? The context rail collapses first; the ChannelSidebar remains visible as structural navigation and is not affected by the rail's responsive auto-collapse rules.
- What happens when the context rail is collapsed but the user has overdue tasks or unread messages? The collapsed toggle displays a visual indicator (badge or accent dot) so the user knows there is actionable content without reopening the rail.

---

## Requirements *(mandatory)*

### Functional Requirements

**Layout & Placement**

- **FR-001**: The context rail MUST be positioned on the right side of the main content area on all workspace pages
- **FR-002**: The context rail MUST be independent of the left-side structural navigation (channel list, section trees) on all pages
- **FR-003**: The context rail MUST be collapsible via a toggle affordance that is always visible regardless of rail state
- **FR-004**: The context rail's open/closed state MUST persist within a session as the user navigates between workspace pages
- **FR-005**: When the context rail is open, the main content area MUST reflow to use the remaining width rather than being obscured
- **FR-017**: When the context rail is collapsed, the toggle affordance MUST display a visual indicator (badge or accent dot) when the authenticated user has at least one overdue task or unread message, so the user can discover actionable content without manually reopening the rail

**Global Content Blocks**

- **FR-006**: The context rail MUST display a user identity block showing the logged-in user's name, avatar, and current presence status
- **FR-007**: The context rail MUST display a "Next Up" block showing the user's single nearest upcoming calendar event with title and start time, sourced from the live calendar API; when additional events remain on the same calendar day, the block MUST also display a count ("+ N more today") to give a quick day-at-a-glance
- **FR-008**: The context rail MUST display a "My Work Today" block showing tasks assigned to the user that are due today or overdue, sourced from the live tasks API; each task item MUST be a navigable link that takes the user directly to that task's detail page
- **FR-009**: The context rail MUST display an unread messages indicator sourced from the live chat API
- **FR-010**: Each global block MUST display a meaningful empty state when no data is available

**Page-Specific Content Blocks**

- **FR-011**: The context rail architecture MUST support a registration mechanism by which each workspace page (or route segment) can declare additional content blocks to render in the rail
- **FR-012**: On the Calendar page, the context rail MUST show the selected-day event summary as a page-specific block
- **FR-013**: On the Calendar page, pending calendar invites for the user MUST be surfaced in the context rail with Accept/Decline actions
- **FR-014**: On the Chat page, the context rail MUST show the active channel's member list and pinned messages as page-specific blocks; when the active channel is a direct message conversation, the rail MUST instead show the other participant's identity, avatar, and current presence status in place of the member list
- **FR-015**: On pages with no page-specific blocks registered, the rail MUST show only global blocks without placeholder sections

**Mock Data Removal**

- **FR-016**: All hardcoded mock/static content in the current Quick Info panel MUST be removed; every block MUST source its data from an API or show an empty state

### Key Entities

- **Context Rail**: The collapsible right-side panel present in the workspace layout shell
- **Global Block**: A content module always shown in the rail regardless of current page (user identity, next event, today's tasks, unread count)
- **Page Block**: A content module contributed by a specific page/route; only shown when that route is active
- **Rail Registry**: The mechanism (e.g., React context) by which pages declare their page-specific blocks to the shell layout

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The context rail is accessible (open/close toggle present) on every workspace route — tasks, calendar, chat, organization, docs, settings — with no exceptions
- **SC-002**: Global blocks display live data: a user with at least one calendar event today sees that event in the rail on every workspace page within the same session
- **SC-003**: The Calendar page's context rail content is visibly different from the Tasks page's context rail content when viewed back-to-back
- **SC-004**: The Chat page renders the ChannelSidebar on the left and the context rail on the right simultaneously with no layout overlap
- **SC-005**: Zero hardcoded mock strings ("No upcoming events", "No active tasks", zero-counters) remain in the context rail codebase after the feature is complete
- **SC-006**: Collapsing the context rail on any page results in main content occupying the full available width without a page reload
- **SC-007**: Context rail state (open/closed) survives navigation between at least 3 different workspace pages within the same session
- **SC-008**: Clicking any task item in the "My Work Today" block navigates the user directly to that task's detail page without requiring a full page reload
- **SC-009**: A user with at least one overdue task or unread message sees a visual indicator on the collapsed rail toggle; the indicator clears when there are no longer any overdue tasks and all messages are marked as read

---

## Assumptions

- The existing workspace layout shell (`layout.tsx`) will be the single owner of the rail slot; individual pages will contribute blocks via a React context/provider pattern, not by rendering the rail directly
- The calendar-day selection state already exists or will be easily accessible from the calendar page for use by the page-block registration
- Chat channel ID for rail context will be derived from the active URL query parameter (`?channel=...`), which the layout already reads
- The right-side rail will be a fixed width (e.g., 280–320 px) when open; no resizing handle is in scope for this feature
- Mobile responsive behavior (hiding rail on small screens) inherits the existing sidebar collapse pattern and is not a new implementation concern for this feature
