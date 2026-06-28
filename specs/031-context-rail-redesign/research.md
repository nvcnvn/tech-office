# Research: Workspace Context Rail Redesign

## Decision: Move the contextual panel into a right-side rail owned by the shared workspace layout

- **Rationale**: The current mock Quick Info panel lives inside the shared workspace shell, and the shell already decides whether the left slot shows Quick Info or chat navigation. That makes the layout the correct owner for consistent rail availability and prevents each route from reinventing placement rules.
- **Alternatives considered**:
  - Let each page render its own side panel: rejected because consistency across routes is the core requirement and chat already proves that the shell controls structural placement.
  - Keep the rail on the left and only swap content: rejected because the spec explicitly distinguishes left-side structural navigation from right-side contextual information.

## Decision: Use a shared provider or registry for page-specific blocks instead of hardcoding route checks in the shell

- **Rationale**: Calendar and chat need different contextual blocks, while other routes should fall back to global blocks only. A provider or registry keeps the shell generic, lets pages register blocks and selected context, and gives a single place to clear stale page state during navigation.
- **Alternatives considered**:
  - Add more `pathname` conditionals directly in `layout.tsx`: rejected because it would quickly become a monolithic route switch with stale-state risk.
  - Let pages render directly into the rail DOM with portals: rejected because it complicates ownership and loading behavior compared with a plain provider contract.

## Decision: Persist rail visibility in browser session state owned by the provider

- **Rationale**: FR-004 requires state persistence only within a session. Browser session persistence gives the behavior without introducing a backend preference dependency or cross-device synchronization requirement.
- **Alternatives considered**:
  - Keep visibility only in component state: rejected because navigation inside the app would reset the rail.
  - Persist as a backend profile preference: rejected because the requirement stops at same-session persistence.

## Decision: Fetch global blocks independently and keep failures isolated per block

- **Rationale**: The spec explicitly requires a failed block, such as Next Up, not to break My Work Today or unread messages. Independent queries or query boundaries satisfy that requirement and keep empty or error states local.
- **Alternatives considered**:
  - Build one large aggregate request for all global data: rejected because a partial failure would make graceful degradation harder.
  - Keep hardcoded fallback content on error: rejected because FR-016 removes mock content from the rail.

## Decision: Reuse existing live contracts where they are already shaped for the rail, and add focused read contracts where they are not

- **Rationale**: Existing frontend APIs already cover user identity, presence, event listing, invite responses, unread counts, and channel members. The rail should reuse those instead of adding redundant backend surfaces. The two gaps discovered during exploration are cross-project work-today data, because `listTasks` is project-scoped, and pinned-message summaries, because there is no compact pinned-message read contract.
- **Alternatives considered**:
  - Stitch work-today by iterating every visible project client-side: rejected because it is brittle, expensive, and not guaranteed to cover all assigned work.
  - Build pinned-message content by loading general message history and filtering client-side: rejected because it is too heavy for a compact rail summary.

## Decision: Calendar-specific rail content should be keyed by selected day, defaulting to today when no day is registered

- **Rationale**: The calendar page already has event detail and RSVP actions, but it does not expose a selected-day concept to the shared shell. Registering a selected day or day summary into the rail gives calendar-specific context without duplicating the full event detail panel.
- **Alternatives considered**:
  - Always derive calendar rail content from the currently selected event only: rejected because the spec requires a day summary even when no event is selected.
  - Show global blocks above calendar blocks on the calendar page: rejected because the spec says the calendar route should show day-specific context instead of the generic global stack.

## Decision: Chat-specific rail content in v1 should cover channel members, pinned messages, and DM counterpart identity, while leaving the existing left channel navigation untouched

- **Rationale**: The user story requires a useful right-side rail in chat without displacing `ChannelSidebar`. Existing member data is available, direct-message context can be derived from active conversation data, and pinned messages need a compact summary contract.
- **Alternatives considered**:
  - Merge the rail into the left channel sidebar: rejected because the spec requires independent left structural navigation and right contextual content.
  - Include shared files in v1 despite missing dedicated contract support: rejected for planning scope because the formal requirements lock in members and pinned messages, and there is no dedicated shared-file summary contract today.

## Decision: Responsive behavior should auto-collapse the rail and preserve a visible toggle rather than compressing main content

- **Rationale**: The spec's edge cases prioritize content readability on narrow screens. This matches the current sidebar collapse pattern better than shrinking both surfaces.
- **Alternatives considered**:
  - Keep the rail open at all widths and let content compress: rejected because it harms primary task content.
  - Disable the rail entirely on narrow widths: rejected because the rail still needs to be accessible through a toggle.