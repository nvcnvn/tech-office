# Research: Mobile Chat & Notification Parity

**Feature**: `027-mobile-chat-notifications`  
**Branch**: `027-mobile-chat-notifications`

---

## Decision 1: Message List — FlatList vs FlashList

**Question**: Should we replace the current inverted `FlatList` with Shopify `FlashList` for improved performance?

**Findings**:
- `@shopify/flash-list` is **not installed** in `frontend/apps/mobile/package.json`.
- Current pattern across ALL mobile chat screens uses `FlatList` with `inverted` prop consistently.
- Adding FlashList would require a native rebuild and Reanimated dependency changes.
- The current `FlatList` inverted pattern is idiomatic in this codebase; prepend flicker is solvable with `maintainVisibleContentPosition`.

**Decision**: **Keep `FlatList`** with `inverted` prop. Add `maintainVisibleContentPosition={{ minIndexForVisible: 1 }}` to prevent viewport jump when prepending older pages. No FlashList introduction this release.

**Rationale**: Zero new native dependencies; consistent with existing codebase patterns; solves the real problem (prepend flicker) without scope creep.

---

## Decision 2: Sidebar Grouping — Client-Side vs Server-Side

**Question**: Should time-bucket grouping ("Today", "This Week", "Earlier") be done server-side in the `listRecentChannels` API or client-side in the mobile app?

**Findings**:
- `listRecentChannels` already returns `ChannelWithDetails[]` sorted by last activity. The data is already correct; only the display structure needs to change.
- Server-side grouping would require a backend API change and protobuf contract update just for a display concern.
- Client-side grouping is a pure view-layer transform: `groupChannelsByTime(channels: ChannelWithDetails[]): SidebarSection[]`.
- No other client (web) is affected by keeping this transform mobile-only.

**Decision**: **Client-side grouping** in the mobile `index.tsx` screen. A `groupChannelsByTime` utility function takes the flat `ChannelWithDetails[]` and returns `SidebarSection[]` ready for `SectionList` / SwiftUI `List`.

**Time bucket rules**:
- "Today" → `lastMessageAt` is on the current calendar day (local timezone).
- "This Week" → `lastMessageAt` is within the current ISO week but not today.
- "Earlier" → everything older.
- Empty buckets are omitted (not rendered as empty sections).

---

## Decision 3: iOS Sidebar — SwiftUI List vs React Native SectionList

**Question**: Should we use `@expo/ui/swift-ui` `List` + `Section` for the iOS sidebar, or stay with React Native `SectionList`?

**Findings**:
- `@expo/ui` is **not currently installed** in `frontend/apps/mobile/package.json`.
- `@expo/ui/swift-ui` `List` with `listStyle('insetGrouped')` and `refreshable` modifier provides native iOS grouped list appearance matching system apps (Settings, Contacts).
- `@expo/ui` is iOS/tvOS only. Android must use the React Native `SectionList` fallback.
- Installation requires `npx expo install @expo/ui` + a full native rebuild (`npx expo run:ios`). This is a one-time cost, not per-feature.
- The web reference (`ChannelSidebar.tsx`) uses a time-grouped design that maps directly to SwiftUI `Section` + time-bucket headers.
- The `refreshable` modifier on iOS `List` replaces the `RefreshControl` on Android's `SectionList`.

**Decision**: **Use `@expo/ui/swift-ui` `List` on iOS; `SectionList` on Android.** Guard with `Platform.OS === 'ios'` in the sidebar screen. Both paths receive the same `SidebarSection[]` data, only the render layer differs.

**Fallback strategy**: The `SidebarSection[]` data model is identical for both paths. Android renders first (SectionList is simpler); iOS upgrade is additive.

---

## Decision 4: Smart Search UX — Full-Screen Modal

**Question**: Where should the smart search UI live? Inline in the sidebar header, pushed stack screen, or modal?

**Findings**:
- Web equivalent (`UnifiedChannelSearch.tsx`) is a full-panel overlay expanding over the sidebar.
- iOS native convention for search (Maps, Messages, Contacts) uses a full-screen search modal or keyboard-expanding search bar.
- Expo Router supports pushing modals with `router.push("/(app)/(chat)/search")` with `presentation: 'modal'`.
- Current header in `index.tsx` already has two icon buttons; adding an inline search bar would be cluttered.
- No SwiftUI needed for search — cross-platform `TextInput` + `FlatList` results is sufficient and simpler.

**Decision**: **New route `/(app)/(chat)/search` presented as a `presentation: 'modal'` full-screen overlay.**  
Header search button (magnifier icon) pushes to this modal. The search modal handles:
1. Instant local filter of channels from `queryClient.getQueryData(['recentChannels'])`.
2. Debounced (300ms) `searchChannels` API call for server-side channel results.
3. If fewer than 3 channel results, debounced `searchEmployees` API call for DM starters.
4. Cancel button / tapping outside dismisses the modal (Expo Router back).

---

## Decision 5: Presence — Cache Strategy

**Question**: How should mobile track and display presence status per-employee? Should we maintain a separate presence store?

**Findings**:
- `NotificationStreamProvider` already handles `presence` SSE events and calls `queryClient.invalidateQueries({ queryKey: ['presence'] })` when they arrive.
- No `usePresence` hook exists yet in mobile; the `PresenceIndicator` component exists but is not wired to live data.
- React Query is the state management layer used throughout this codebase — no separate store (MobX, Zustand, Redux) is used.
- Web does not have a presence system to reference for mobile (mobile needs to build this from scratch).

**Decision**: **React Query cache for presence, keyed `['presence', employeeId]`.**
- A new `usePresence(employeeId: string): PresenceStatus` hook reads from the cache via `useQuery`.
- The `queryFn` calls a `getEmployeePresence(employeeId)` API function.
- When SSE fires a `presence` event, `NotificationStreamProvider` must be updated to call `queryClient.setQueryData(['presence', payload.employeeId], payload.status)` (optimistic update, no re-fetch needed).
- This gives instant UI updates from SSE without extra network requests.
- `AppState` listener in a new `useAppStatePresence()` hook calls `updatePresenceStatus` on foreground/background transitions.

---

## Decision 6: Deep-Link Highlight

**Question**: How should the channel screen receive and act on a `highlightedMessageId` from a notification deep-link?

**Findings**:
- Expo Router supports query params: `router.push({ pathname: '/(app)/(chat)/[channelId]', params: { channelId, highlightedMessageId } })`.
- `useLocalSearchParams` in `[channelId].tsx` can read the optional `highlightedMessageId` param.
- `FlatList.scrollToIndex` can scroll to a specific index once the item is rendered.
- If the highlighted message is not on the first page (too old), the infinite query must fetch until it is found — this is complex. Per spec Priority P3, initial implementation targets messages within the first page only; older message highlight is a future enhancement.
- 3-second highlight: local `useState<string|null>` + `setTimeout` clears it.

**Decision**: **`highlightedMessageId` as optional search param.** On screen mount, if present, find the message in the first page; if found, call `FlatList.scrollToIndex` after a short delay (wait for render). Set a 3s timeout to clear the highlight state. If not in first page, no scroll — just open the channel normally (acceptable P3 limitation documented in spec assumptions).

---

## Decision 7: New Messages Pill vs Scroll Auto-Anchor

**Question**: The current `[channelId].tsx` already has `atBottom`, `showNewMessages`, and `lastMessageIdRef` state. Is the existing implementation complete or does it need changes?

**Findings**:
- Reading `[channelId].tsx` lines 530–700: `atBottom` is tracked via `atBottomRef`; `showNewMessages` state exists; SSE callback already calls `scrollToOffset({ offset: 0 })` when `atBottomRef.current` is true.
- Missing: there is no rendered pill UI element yet despite the state existing.
- `maintainVisibleContentPosition` is not set on the `FlatList` — this causes the prepend jump (Story 2 regression).
- `onScroll` handler needs to update `atBottomRef.current` based on `contentOffset.y` threshold.

**Decision**: The scaffold is correct; three concrete changes needed:
1. Add `maintainVisibleContentPosition={{ minIndexForVisible: 1 }}` to `FlatList`.
2. Render the "↓ New messages" pill as a floating `Pressable` (absolute position, bottom of safe area) conditionally shown when `showNewMessages` is true.
3. Wire `onScroll` to update `atBottomRef` / `atBottom` state: when `contentOffset.y < 80` on an inverted list, the user is at the bottom.

---

## Findings: What Already Exists

| Concern | Status |
|---|---|
| SSE connection + reconnect | ✅ Complete in `use-sse.ts` + `NotificationStreamProvider` |
| `chat_message` SSE invalidation | ✅ In both `index.tsx` and `[channelId].tsx` |
| `presence` SSE event routing | ⚠️ Routed to `queryClient.invalidateQueries(['presence'])` but no per-employee key |
| `PresenceIndicator` component | ✅ Exists in `src/components/common/presence-indicator.tsx` |
| Inverted `FlatList` + infinite scroll | ✅ In `[channelId].tsx` |
| `atBottom` / `showNewMessages` state | ✅ State declared; ❌ pill UI not rendered |
| `maintainVisibleContentPosition` | ❌ Not set — prepend will jump |
| Sidebar time grouping | ❌ Flat type-sections: "Direct Messages" / "Channels" |
| Smart search | ❌ Not implemented on mobile |
| `@expo/ui` SwiftUI List | ❌ Not installed |
| `usePresence` hook | ❌ Not implemented |
| `useAppStatePresence` hook | ❌ Not implemented |
| Maestro chat flows | ⚠️ Placeholder stubs only |
| Deep-link `highlightedMessageId` | ❌ Not implemented |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `@expo/ui` native rebuild breaks CI | Medium | High | Add to quickstart; test on real device before merging |
| `maintainVisibleContentPosition` conflicts with `inverted` on Android | Low | Medium | Test on both platforms; apply only when `Platform.OS !== 'android'` if needed |
| Smart search API `searchChannels` not available in `apis` package | Low | Medium | Verify in `packages/apis`; add thin wrapper if missing |
| Presence SSE key mismatch (field name in payload vs assumed `employeeId`) | Medium | Low | Inspect SSE payload structure from `NotificationStreamProvider` before implementing |
| SwiftUI `List` `refreshable` conflicts with pull-to-refresh on Android fallback | N/A | N/A | Paths are separate: `Platform.OS === 'ios'` for SwiftUI; no conflict |
