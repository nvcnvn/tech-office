# Contract: Workspace Context Rail

## Purpose

Define the shell, registration, and data-loading contract for the workspace context rail so implementation can proceed without re-litigating ownership, route integration, or failure behavior.

## Shell Contract

- The shared workspace layout is the single owner of the right-side rail container.
- The rail toggle is always visible on every workspace route, regardless of whether the rail is open.
- The chat route keeps `ChannelSidebar` in the left slot and the context rail in the right slot simultaneously.
- Closing the rail expands the main content area instead of overlaying it.
- Narrow widths (viewport width < 1024 px) auto-collapse the rail; the user must still be able to reopen it from the visible toggle.
- On the chat route at narrow widths, the context rail collapses first; the ChannelSidebar is not affected by the rail's responsive auto-collapse rules.
- When the rail is collapsed, the toggle MUST display a visual indicator (badge or accent dot) when the user has at least one overdue task or unread message (FR-017).

## Visibility And Persistence Contract

- Rail visibility persists for the current browser session only, stored in `sessionStorage` under the key `contextRail.preference`.
- The shell persists the user's manual open or closed preference separately from responsive auto-collapse.
- Route navigation inside `/workspace/*` must not reset the manual preference.

## Registration Contract

- Pages do not render the rail directly.
- Pages register zero or more page blocks through a shared provider or registry exposed by the shell.
- Each registration includes:
  - `routeKey`
  - stable block IDs
  - any route-specific context payload needed to render those blocks
  - a token or lifecycle guard that lets the shell discard stale page data on navigation
- When no page blocks are registered for the active route, the shell renders only the global block stack.

## Global Block Contract

The shell always owns these blocks:

1. Identity block
   - Source: authenticated user profile plus presence status
   - Output: name, avatar, presence

2. Next Up block
   - Source: live calendar events
   - Output: next upcoming event title and start time; when additional events remain that day, show a count ("+ N more today") derived client-side from the same calendar query
   - Empty state: "Nothing scheduled — enjoy the quiet"

3. My Work Today block
   - Source: cross-project assigned tasks due today or overdue
   - Output: compact task list and counts; each item is a navigable link to the task's detail page
   - Empty state: "All caught up for today"

4. Unread Messages block
   - Source: live unread notification or chat summary count via the existing `NotificationStreamProvider` SSE stream (no new polling interval)
   - Output: unread count that updates in real-time when messages arrive or are read
   - Empty state: "No unread messages"

## Page Block Contract

### Calendar route

- Page key: `calendar`
- Registered blocks:
  - selected-day summary
  - pending invites with Accept and Decline actions
- Default behavior: if no explicit selected day is registered, the shell uses today's date
- Update behavior: the calendar page must refresh the registration when selected day changes

### Chat route

- Page key: `chat`
- Registered blocks:
  - active-channel summary with name and member count
  - channel member list
  - pinned message previews
  - direct-message counterpart identity when the active conversation is a DM
- Update behavior: when the `channel` query parameter changes, the registration updates without full-page reload

## Data Contract

- Existing live contracts should be reused for:
  - authenticated user profile
  - presence lookup
  - calendar event listing (`remainingTodayCount` derived client-side from the same query result)
  - invite response mutation
  - unread count (SSE-driven via `NotificationStreamProvider`)
  - channel members
- Focused read contracts may be added for:
  - cross-project work-today summaries
  - pinned-message summaries per channel
- Client-derived state (no new backend contract needed):
  - `hasBadgeAlert` = `overdueCount > 0 || unreadCount > 0` (drives the collapsed-toggle indicator, FR-017)
- New summary contracts must remain auth-scoped and tenant-safe; no user-facing contract may require raw `organization_id`.

## Backend RPC Contract

The feature introduces two focused backend read contracts so the rail does not have to over-fetch or stitch project-scoped responses on the client.

### CollaborationService.GetAssignedWorkSummary

- **Purpose**: Provide the global `My Work Today` rail block with one organization-scoped read for the authenticated employee.
- **Transport**: Connect RPC / gRPC method on `CollaborationService`
- **Request shape**:
  - `optional int32 limit`
  - `bool include_ritual_instances`
  - no `organization_id`
  - no `employee_id`
- **Response shape**:
  - `string as_of_date`
  - `int32 due_today_count`
  - `int32 overdue_count`
  - `repeated AssignedWorkSummaryItem items`
- **AssignedWorkSummaryItem fields**:
  - `string task_id`
  - `string project_id`
  - `string project_key`
  - `string title`
  - `optional string due_date`
  - `string urgency_bucket` with values `due_today` or `overdue`
  - `optional string state_name`
- **Authorization and tenancy**:
  - caller identity is resolved from auth context
  - organization scope is resolved from auth context
  - response contains only tasks assigned to the caller in the active organization
- **Behavior rules**:
  - returns both due-today and overdue assigned work across projects
  - excludes closed tasks
  - returns an empty `items` list with zero counts when no work exists
  - must be stable for compact rail rendering without per-project client stitching

### ChatService.GetChannelContextSummary

- **Purpose**: Provide the chat rail with one read contract for active-channel summary content.
- **Transport**: Connect RPC / gRPC method on `ChatService`
- **Request shape**:
  - `string channel_id`
  - `optional int32 pinned_limit`
  - `optional int32 member_limit`
- **Response shape**:
  - `Channel channel`
  - `int32 member_count`
  - `repeated ChannelMembership memberships`
  - `repeated PinnedMessageSummary pinned_messages`
  - `optional DirectMessageParticipant dm_counterpart`
- **PinnedMessageSummary fields**:
  - `string message_id`
  - `string author_employee_id`
  - `string author_display_name`
  - `string excerpt`
  - `google.protobuf.Timestamp pinned_at`
  - `string jump_message_id`
- **Authorization and tenancy**:
  - caller must be allowed to view the target channel
  - organization scope is resolved from auth context
- **Behavior rules**:
  - returns member and pinned-message summaries sized for the rail rather than full channel history
  - returns `dm_counterpart` only when the channel is a direct message
  - returns an empty `pinned_messages` list when the channel has no pins
  - does not require the client to derive pinned-message summaries by scanning paginated message history

## Failure And Empty-State Contract

- Each block fails independently.
- A failed block renders a local error or fallback state and must not suppress sibling blocks.
- Empty states must be meaningful and task-oriented.
- Removed mock text such as `No upcoming events`, `No active tasks`, and zero-only stat cards must not remain in rail rendering.