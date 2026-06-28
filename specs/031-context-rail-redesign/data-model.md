# Data Model: Workspace Context Rail Redesign

## Overview

This feature introduces a frontend-owned layout and registration model backed by existing live tenant data plus a small number of focused read summaries where current APIs are too coarse. No new primary business table is required by the design.

## Entities

### ContextRailState

- **Purpose**: Shared UI state for the right-side rail within a browser session.
- **Fields**:
  - `isOpen`: boolean; current user-visible rail state
  - `isAutoCollapsed`: boolean; whether the shell forced collapse due to narrow width
  - `lastManualState`: enum `open` or `closed`; tracks the user's explicit intent separate from responsive collapse
  - `hasBadgeAlert`: boolean (derived, never persisted); true when `overdueCount > 0 || unreadCount > 0`; drives the collapsed-toggle visual indicator (FR-017)
  - `activeRouteKey`: string; route segment or logical workspace page identifier
  - `updatedAt`: timestamp-like client value for stale-registration guards
- **Validation rules**:
  - `isOpen` must always be derivable from `lastManualState` plus responsive rules
  - session persistence stores only the manual preference, not transient layout width
  - `hasBadgeAlert` is recomputed from live summary data on each render and never written to `sessionStorage`

### ContextBlockDefinition

- **Purpose**: Declarative description of one renderable block in the rail.
- **Fields**:
  - `id`: stable string identifier
  - `scope`: enum `global` or `page`
  - `title`: user-facing heading
  - `priority`: integer or ordered token controlling vertical order
  - `emptyState`: meaningful empty-state copy and optional action label
  - `loadingPolicy`: enum `eager`, `deferred`, or `route-bound`
  - `visibilityRule`: condition describing when the block should render
  - `queryKey`: cache identity for live data, when applicable
- **Validation rules**:
  - `id` must be unique within the rail
  - page blocks must include a route-scoped visibility rule
  - empty states must never reuse the removed mock copy literally

### RailRegistryEntry

- **Purpose**: Route-contributed payload registered by a page into the shared shell.
- **Fields**:
  - `routeKey`: logical route identifier such as `calendar` or `chat`
  - `registrationToken`: unique token tied to the current mounted route instance
  - `blocks`: ordered list of `ContextBlockDefinition`
  - `contextPayload`: route-specific data needed by those blocks
  - `expiresOnRouteChange`: boolean; stale entries are removed when navigation changes
- **Validation rules**:
  - only the active route's registration may contribute page blocks
  - shell must discard entries whose token no longer matches the mounted route

### UserIdentitySummary

- **Purpose**: Global identity block content.
- **Fields**:
  - `employeeId`: current user identifier
  - `displayName`: preferred user name
  - `email`: secondary identity text
  - `avatarUrl`: optional image URL
  - `presenceStatus`: enum such as `online`, `idle`, `offline`, or `do_not_disturb`
- **Relationships**:
  - feeds the global identity block

### NextUpSummary

- **Purpose**: Global calendar preview block.
- **Fields**:
  - `eventId`: optional upcoming event identifier
  - `title`: event title when one exists
  - `startTime`: next start timestamp
  - `remainingTodayCount`: integer count of additional events on the same calendar day after this one; 0 when none
  - `isEmpty`: boolean for the meaningful empty state
- **Validation rules**:
  - populated from the user's single nearest upcoming event (any future event, regardless of how far ahead)
  - `remainingTodayCount` is derived client-side from the same calendar query result, not a separate API field
  - empty copy: "Nothing scheduled — enjoy the quiet"

### WorkTodaySummary

- **Purpose**: Cross-project summary of work assigned to the user and due today or overdue.
- **Fields**:
  - `employeeId`: assignee identity
  - `tasks`: list of `WorkTodayTaskRef`
  - `overdueCount`: count of overdue tasks in the summary slice
  - `todayCount`: count of tasks due today in the summary slice
  - `asOfDate`: local-date basis for summary calculation
- **Validation rules**:
  - summary must be organization-scoped and cross-project
  - items should include enough routing metadata for direct navigation from the rail

### WorkTodayTaskRef

- **Purpose**: Compact task reference for the rail.
- **Fields**:
  - `taskId`: task identifier
  - `projectId`: parent project identifier
  - `projectKey`: short project key for display
  - `title`: task title
  - `dueDate`: due date
  - `statusLabel`: compact derived label such as `Due today` or `Overdue`

### CalendarDayContext

- **Purpose**: Calendar route contribution to the rail.
- **Fields**:
  - `selectedDate`: current day driving the summary
  - `events`: list of `CalendarDayEventRef`
  - `pendingInvites`: subset of events awaiting RSVP
  - `defaultedToToday`: boolean when no explicit page selection exists
- **Validation rules**:
  - if no day is registered, the shell uses today's date
  - invite actions must only surface when the current user has a pending response

### CalendarDayEventRef

- **Purpose**: Compact event reference rendered inside calendar-specific blocks.
- **Fields**:
  - `eventId`: event identifier
  - `title`: event title
  - `startTime`: start timestamp
  - `endTime`: end timestamp
  - `responseStatus`: RSVP status for the current user
  - `resourceSummary`: optional room or resource snippet

### ChatChannelContext

- **Purpose**: Chat route contribution to the rail.
- **Fields**:
  - `channelId`: active channel identifier
  - `channelName`: display label
  - `isDirectMessage`: boolean
  - `memberCount`: numeric summary
  - `members`: list of `ChannelMemberSummary`
  - `pinnedMessages`: list of `PinnedMessageSummary`
  - `dmCounterpart`: optional `DirectMessageProfile`
- **Validation rules**:
  - must update when active channel changes without full page reload
  - direct-message mode swaps group summary content for counterpart identity content

### ChannelMemberSummary

- **Purpose**: Compact member display data for the chat rail block.
- **Fields**:
  - `employeeId`: member identifier
  - `displayName`: member name
  - `avatarUrl`: optional avatar
  - `presenceStatus`: optional live presence
  - `roleLabel`: optional membership role

### PinnedMessageSummary

- **Purpose**: Compact pinned-message preview for the chat rail.
- **Fields**:
  - `messageId`: pinned message identifier
  - `authorName`: author display name
  - `excerpt`: short preview text
  - `pinnedAt`: timestamp
  - `jumpTarget`: link or route fragment for in-channel navigation
- **Validation rules**:
  - summaries must be cheap to load and should not require full channel-history fetches

### DirectMessageProfile

- **Purpose**: Alternate chat rail payload for direct-message conversations.
- **Fields**:
  - `employeeId`: counterpart identifier
  - `displayName`: counterpart name
  - `avatarUrl`: optional avatar
  - `presenceStatus`: current live presence
  - `statusText`: optional custom presence text

## Relationships

- `ContextRailState` governs whether the shell renders registered blocks.
- The shell always renders global `ContextBlockDefinition` values and conditionally renders page blocks from the active `RailRegistryEntry`.
- `CalendarDayContext` and `ChatChannelContext` are mutually exclusive page contexts for their respective routes.
- `UserIdentitySummary`, `NextUpSummary`, and `WorkTodaySummary` are global summaries available across all routes.

## Notes For Persistence

- The frontend design does not require a new database table.
- If a new backend summary contract is introduced for cross-project work-today data or pinned-message summaries, it should derive from existing collaboration, chat, and notification tables and remain scoped by auth-derived organization context.
- Any new backend query or RPC surface must preserve tenant isolation and avoid exposing raw `organization_id` in frontend contracts.