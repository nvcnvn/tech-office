# Quickstart: Workspace Context Rail Redesign

## Goal

Implement a real right-side workspace context rail that is available on every workspace route, preserves open or closed state within the session, shows live global summaries everywhere, and swaps in calendar- or chat-specific blocks when those routes are active.

## Implementation Order

1. Add a shared workspace rail provider that owns open or closed state, session persistence, responsive auto-collapse, and route block registration.
2. Move the contextual surface from the current left Quick Info slot to a right-side rail in the shared workspace layout while preserving chat's left `ChannelSidebar`.
3. Replace the current hardcoded Quick Info cards and zero counters with global live blocks for identity, presence, next event, work today, and unread messages, each with independent loading and empty states.
4. Add calendar route registration so the rail can render selected-day summaries and pending-invite actions, defaulting to today when no explicit day is selected.
5. Add chat route registration so the rail can render active-channel member summaries, pinned messages, and direct-message counterpart context.
6. Add or extend focused backend and frontend API contracts for cross-project work-today summaries and pinned-message summaries if existing helpers are still insufficient.
7. Add backend integration scenarios for any new summary contracts and Playwright scenarios for layout availability, state persistence, responsive collapse, calendar rail content, and chat rail content.

## Expected Touch Points

### Frontend shell and registration

- Update the workspace shell in `frontend/apps/web/src/app/workspace/layout.tsx`.
- Add a shared provider under `frontend/apps/web/src/app/workspace/providers/` for rail state and route registration.
- Create reusable rail block components close to the workspace shell rather than embedding more JSX directly in `layout.tsx`.

### Frontend route integration

- Calendar route should publish selected-day context into the provider and reuse existing RSVP behavior.
- Chat route should publish active-channel context keyed from the current URL query parameter and preserve left-side navigation.
- Non-registering routes should render only the global block stack.

### Backend and API support

- Reuse existing APIs for identity, presence, unread counts, event listing, invite responses, and channel members.
- If still needed after implementation spike, add a collaboration summary read contract for cross-project assigned tasks due today or overdue.
- If still needed after implementation spike, add a chat summary read contract for pinned-message previews by channel.

## Validation Commands

### Frontend validation

```sh
pnpm --dir frontend exec eslint .
pnpm --dir frontend --filter web exec playwright test --config=e2e/playwright.config.ts
```

### Backend validation

```sh
cd backend && go test ./integration/...
```

### Optional focused checks during implementation

```sh
pnpm --dir frontend --filter web exec playwright test --config=e2e/playwright.config.ts --grep "context rail"
cd backend && go test ./integration/... -run ContextRail
```

## Expected Outcomes

- Every workspace route exposes a visible context-rail toggle and can render the right-side rail without breaking the main layout.
- Rail open or closed state survives navigation between workspace routes in the same browser session.
- Calendar and chat display visibly different contextual content from generic routes.
- Chat keeps `ChannelSidebar` on the left while rendering the context rail on the right.
- Removed mock strings do not remain in the final rail implementation.